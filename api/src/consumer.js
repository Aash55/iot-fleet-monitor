import { pool } from "./db.js";
import { redis, TELEMETRY_STREAM } from "./redis.js";
import { errText } from "./errText.js";

export const CONSUMER_GROUP = process.env.CONSUMER_GROUP || "telemetry-writers";

// Consumer NAME is the identity of a pending-entries list. Keep it stable across
// restarts, otherwise every restart orphans the previous name's unacked entries.
const CONSUMER_NAME = process.env.CONSUMER_NAME || "writer-1";
const BATCH_SIZE = Number(process.env.CONSUMER_BATCH_SIZE || 50);
const BLOCK_MS = Number(process.env.CONSUMER_BLOCK_MS || 5000);
const RETRY_MS = Number(process.env.CONSUMER_RETRY_MS || 1000);

let stream = null; // dedicated redis connection
let running = false;
let loop = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startConsumer() {
  if (running) return;

  // A blocking XREADGROUP owns its connection for the whole BLOCK window. On the
  // shared client that would park /health's PING and /ingest's XADD behind it.
  stream = redis.duplicate();
  stream.on("error", (err) => console.error("Consumer redis error:", errText(err)));
  await stream.connect();

  await ensureGroup();
  running = true;
  loop = run();
  console.log(`Consumer ${CONSUMER_NAME} started on group ${CONSUMER_GROUP}`);
}

export async function stopConsumer() {
  if (!running) return;
  running = false;
  // destroy(), not quit(): quit() waits for the in-flight blocked XREADGROUP to
  // return, which can be BLOCK_MS away. destroy() kills the socket now; the
  // blocked promise rejects and the loop exits because running is already false.
  stream?.destroy();
  await loop;
  stream = null;
  loop = null;
  console.log("Consumer stopped");
}

async function ensureGroup() {
  try {
    // "0" = start from the oldest entry still in the stream, so entries that were
    // XADDed before this group existed still get written. MKSTREAM creates the key
    // if /ingest has never run. On restart this throws BUSYGROUP and the group's
    // existing cursor survives - that is the behaviour we want, not a reset.
    await stream.xGroupCreate(TELEMETRY_STREAM, CONSUMER_GROUP, "0", { MKSTREAM: true });
    console.log(`Consumer group ${CONSUMER_GROUP} created`);
  } catch (err) {
    if (!errText(err).startsWith("BUSYGROUP")) throw err;
    console.log(`Consumer group ${CONSUMER_GROUP} already exists`);
  }
}

async function run() {
  // Start at "0" = re-read THIS consumer's own pending entries first. After a crash
  // or a Render spin-down those were delivered but never XACKed, and no other
  // consumer will ever pick them up because the PEL is per consumer name.
  let cursor = "0";

  while (running) {
    try {
      const res = await stream.xReadGroup(
        CONSUMER_GROUP,
        CONSUMER_NAME,
        { key: TELEMETRY_STREAM, id: cursor },
        // BLOCK only makes sense for ">" (new entries). A "0" read answers instantly.
        cursor === ">" ? { COUNT: BATCH_SIZE, BLOCK: BLOCK_MS } : { COUNT: BATCH_SIZE }
      );

      const messages = res?.[0]?.messages ?? [];

      if (cursor === "0" && messages.length === 0) {
        cursor = ">";
        console.log("Consumer: pending list drained, switching to live entries");
        continue;
      }
      if (messages.length === 0) continue; // BLOCK timed out: normal, just loop

      await handleBatch(messages);
    } catch (err) {
      if (!running) break; // stopConsumer() destroyed the socket - expected
      console.error("Consumer loop error:", errText(err));
      // Whatever failed left entries unacked in our PEL. Go back to "0" so the
      // next read re-delivers them instead of waiting for a process restart.
      cursor = "0";
      await sleep(RETRY_MS);
    }
  }
}

async function handleBatch(messages) {
  const rows = [];
  const dropIds = [];

  for (const m of messages) {
    const parsed = parseEntry(m.id, m.message);
    if (parsed.ok) rows.push(parsed.row);
    else {
      // Malformed entry. Retrying will never fix it, so ack it or it blocks the
      // pending list forever. Log loudly - this is data loss, on purpose.
      console.error(`Consumer: dropping ${m.id} - ${parsed.reason}`);
      dropIds.push(m.id);
    }
  }

  const { doneIds, poisonIds } = rows.length
    ? await insertReadings(rows)
    : { doneIds: [], poisonIds: [] };

  const done = new Set(doneIds);
  await touchDevices(rows.filter((r) => done.has(r.stream_id)));

  const ackIds = [...dropIds, ...doneIds, ...poisonIds];
  if (ackIds.length) {
    const acked = await stream.xAck(TELEMETRY_STREAM, CONSUMER_GROUP, ackIds);
    console.log(
      `Consumer: ${doneIds.length} written, ${dropIds.length + poisonIds.length} dropped, ${acked} acked`
    );
  }
}

async function insertReadings(rows) {
  if (rows.length > 1) {
    try {
      await insertMany(rows);
      return { doneIds: rows.map((r) => r.stream_id), poisonIds: [] };
    } catch (err) {
      // One bad row fails the whole multi-row INSERT. Split so the good rows land.
      console.error("Consumer: batch insert failed, retrying row by row:", errText(err));
    }
  }

  const doneIds = [];
  const poisonIds = [];
  for (const row of rows) {
    try {
      await insertMany([row]);
      doneIds.push(row.stream_id);
    } catch (err) {
      // pg class 23 = integrity constraint violation (e.g. 23503, device deleted
      // after ingest). Permanent: a retry gives the same error. Drop and ack.
      if (String(err.code || "").startsWith("23")) {
        console.error(`Consumer: dropping ${row.stream_id} - ${err.code} ${errText(err)}`);
        poisonIds.push(row.stream_id);
      } else {
        throw err; // transient (DB down): leave it unacked so the PEL retries it
      }
    }
  }
  return { doneIds, poisonIds };
}

async function insertMany(rows) {
  const tuples = [];
  const params = [];
  rows.forEach((r, i) => {
    const b = i * 6;
    tuples.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
    params.push(r.stream_id, r.device_id, r.owner_id, r.ts, r.received_at, r.metrics);
  });

  // ON CONFLICT DO NOTHING on stream_id is what turns at-least-once delivery into
  // exactly-once storage. Redelivery after a crash becomes a harmless no-op.
  await pool.query(
    `INSERT INTO readings (stream_id, device_id, owner_id, ts, received_at, metrics)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (stream_id) DO NOTHING`,
    params
  );
}

async function touchDevices(rows) {
  const latest = new Map();
  for (const r of rows) {
    const prev = latest.get(r.device_id);
    // toISOString() is fixed-width UTC, so string compare == time compare.
    if (!prev || r.received_at > prev) latest.set(r.device_id, r.received_at);
  }

  for (const [deviceId, seen] of latest) {
    // The guard keeps an out-of-order batch from moving last_seen backwards.
    await pool.query(
      `UPDATE devices SET last_seen = $2, status = 'online'
       WHERE id = $1 AND (last_seen IS NULL OR last_seen < $2)`,
      [deviceId, seen]
    );
  }
}

const DIGITS = /^\d+$/;

function parseEntry(id, f) {
  // Stream fields are flat strings - everything here arrives as text and is
  // untrusted, even though /ingest validated it. The stream is the boundary.
  if (!DIGITS.test(f.device_id ?? "")) return { ok: false, reason: "device_id not numeric" };
  if (!DIGITS.test(f.owner_id ?? "")) return { ok: false, reason: "owner_id not numeric" };
  if (Number.isNaN(Date.parse(f.ts ?? ""))) return { ok: false, reason: "ts not a date" };
  if (Number.isNaN(Date.parse(f.received_at ?? "")))
    return { ok: false, reason: "received_at not a date" };

  let metrics;
  try {
    metrics = JSON.parse(f.metrics ?? "");
  } catch {
    return { ok: false, reason: "metrics is not JSON" };
  }
  if (metrics === null || typeof metrics !== "object" || Array.isArray(metrics)) {
    return { ok: false, reason: "metrics is not a JSON object" };
  }

  return {
    ok: true,
    row: {
      stream_id: id,
      device_id: f.device_id, // stays a string: pg BIGINT, no 2^53 rounding
      owner_id: f.owner_id,
      ts: f.ts,
      received_at: f.received_at,
      metrics: f.metrics, // already a JSON string -> straight into JSONB
    },
  };
}
