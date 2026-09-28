//
// Purpose: act as simulated devices and send real CICIoT2023 rows to POST /ingest.
//   - config + file loading + row selection + --dry-run self-check
//   - the real sending loop + Ctrl-C shutdown + summary   (sections 8-10)
//   - the simulator acts as the GATEWAY (PEP). The API (PDP) returns an `action` in its reply;
//     on "block" this script prints BLOCKED and counts the reading as blocked.
//
// Usage (Git Bash, from the api/ folder):
//   npm run simulate -- --count 5          -> 5 POSTs per device, then exits on its own
//   node scripts/simulate.js               -> runs forever, stop with Ctrl-C
//   npm run simulate -- --fleet fleet.prod.local.json --remote --count 10   -> the Render fleet
//   Run the Ctrl-C mode DIRECTLY with node. If npm sits in between, it forwards Ctrl-C to the
//   child, and on Windows that forwarding is a forced kill - the summary can get cut off.

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { DEFAULT_FLEET, fleetPath } from "./fleetFile.js";

// ---------------- 1. Tuning constants ----------------
// A real fleet is mostly BENIGN. The samples file (ml/demo.py) has ~10k benign + ~9k attack
// rows, but sending them half-and-half would keep the dashboard permanently red and make the
// demo look fake. So the default is only 3% attack. --anomaly is for demos.
const ATTACK_RATIO_NORMAL = 0.03;
const ATTACK_RATIO_ANOMALY = 0.4;

// If the API hangs (never replies), a single POST waits at most this long, then counts as FAIL.
const REQUEST_TIMEOUT_MS = 5000;

const SAMPLES_FILE = path.join(import.meta.dirname, "samples.local.json");

// ---------------- 2. CLI flags ----------------
let values, FLEET_FILE;
try {
  ({ values } = parseArgs({
    options: {
      devices: { type: "string" },                    // default = every device in the fleet
      rate: { type: "string", default: "5" },         // gap between sends per device, seconds
      count: { type: "string", default: "0" },        // 0 = run forever
      url: { type: "string" },                        // default = fleet.base_url
      fleet: { type: "string", default: DEFAULT_FLEET }, // inside scripts/, *.local.json
      anomaly: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,       // unknown flag or extra word -> caught right here
  }));
  FLEET_FILE = fleetPath(values.fleet);
} catch (err) {
  console.error(`Invalid flag: ${err.message}`);
  console.error("Usage: npm run simulate -- [--fleet fleet.local.json] [--devices 6] [--rate 5] [--count 0] [--anomaly] [--dry-run]");
  process.exit(1);
}

// Numeric flags arrive as strings. Check + convert in one place.
function toInt(name, raw, min, max) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.error(`--${name} must be a whole number between ${min} and ${max}, got: ${raw}`);
    process.exit(1);
  }
  return n;
}

const RATE_SEC = toInt("rate", values.rate, 1, 3600);
const COUNT = toInt("count", values.count, 0, 1000000);
const DRY_RUN = values["dry-run"];
const ATTACK_RATIO = values.anomaly ? ATTACK_RATIO_ANOMALY : ATTACK_RATIO_NORMAL;

// ---------------- 3. Local files load ----------------
async function loadLocalJson(file, hint) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(`File not found: ${file}`);
      console.error(hint);
    } else {
      // don't report a REAL problem (permissions, truncated JSON) as "file missing"
      console.error(`Could not read ${file}: ${err.message}`);
    }
    process.exit(1);
  }
}

const fleet = await loadLocalJson(FLEET_FILE, `Run this first:  provision ... --fleet ${values.fleet}`);
const samples = await loadLocalJson(SAMPLES_FILE, "Run this first (from the ml/ folder):  uv run python demo.py");

if (!Array.isArray(fleet.devices) || fleet.devices.length === 0) {
  console.error(`${values.fleet} contains no devices`);
  process.exit(1);
}
for (const b of ["benign", "attack"]) {
  if (!Array.isArray(samples[b]) || samples[b].length === 0) {
    console.error(`samples.local.json: the "${b}" bucket is empty`);
    process.exit(1);
  }
}

const MAX_DEVICES = fleet.devices.length;
const DEVICE_COUNT =
  values.devices === undefined ? MAX_DEVICES : toInt("devices", values.devices, 1, MAX_DEVICES);
const DEVICES = fleet.devices.slice(0, DEVICE_COUNT);

// ---------------- 4. Base URL + remote guard ----------------
const BASE = String(values.url ?? fleet.base_url ?? "http://127.0.0.1:4000").replace(/\/+$/, "");

let host;
try {
  host = new URL(BASE).hostname;
} catch {
  console.error(`Invalid URL: ${BASE}`);
  process.exit(1);
}

const IS_LOCAL = host === "127.0.0.1" || host === "localhost" || host === "::1";
if (!IS_LOCAL && !values.remote) {
  const perDay = Math.round((DEVICE_COUNT * 86400) / RATE_SEC);
  console.error(`This is not a local URL: ${BASE}`);
  // Every 202 = at least 2 Upstash commands (the API's XADD + the consumer's XACK).
  // Upstash free tier (docs, 23 Sept 2026): 500K commands / MONTH (~16K/day) - the consumer's
  // idle polling (BLOCK 5000 = ~12 XREADGROUP/min while Render is awake) also counts toward it.
  console.error(`At this rate ~${perDay.toLocaleString()} POST/day = ~${(perDay * 2).toLocaleString()}+ Upstash commands/day.`);
  console.error("Upstash free: 500K commands/month (~16K/day) - this would use up the budget in a few days.");
  console.error("Really send to the deployed API? ->  --remote --rate 60 --count 50");
  process.exit(1);
}

// ---------------- 5. Row selection and body building ----------------
// Weighted pick: Math.random() returns a value between 0 and 1. It lands below 0.03
// 3% of the time - that becomes our attack ratio.
function pickRow() {
  const isAttack = Math.random() < ATTACK_RATIO;
  const bucket = isAttack ? samples.attack : samples.benign;
  const row = bucket[Math.floor(Math.random() * bucket.length)];
  return { row, kind: isAttack ? "attack" : "benign" };
}

function buildBody(row) {
  // The label is DELIBERATELY not sent. A real device does not know its own label, and if
  // it were sent the model would effectively see the answer - making all scoring meaningless.
  // device_id/owner_id are not sent either - the server derives them from the API key.
  return { ts: new Date().toISOString(), metrics: row.metrics };
}

function maskKey(k) {
  return `${k.slice(0, 8)}...${k.slice(-4)}`;   // never print the full key to the console
}

// ---------------- 6. Config print ----------------
console.log("--- simulator config ---");
console.log(`fleet file    : ${values.fleet}`);
console.log(`base url      : ${BASE}`);
console.log(`devices       : ${DEVICE_COUNT} / ${MAX_DEVICES}`);
console.log(`rate          : every ${RATE_SEC}s per device`);
console.log(`count         : ${COUNT === 0 ? "infinite (stop with Ctrl-C)" : COUNT + " round"}`);
console.log(`anomaly mode  : ${values.anomaly ? "ON" : "off"}`);
console.log(`quiet mode    : ${values.quiet ? "ON" : "off"}`);
console.log(`attack ratio  : ${(ATTACK_RATIO * 100).toFixed(0)}%`);
console.log(`samples       : ${samples.benign.length} benign + ${samples.attack.length} attack, ${samples.features.length} feature`);
for (const d of DEVICES) console.log(`  device ${d.id}  ${d.name}  ${maskKey(d.api_key)}`);

// ---------------- 7. --dry-run self-check ----------------
if (DRY_RUN) {
  const N = 1000;
  let attacks = 0;
  for (let i = 0; i < N; i++) if (pickRow().kind === "attack") attacks++;
  console.log(`\n${N} draw   : ${attacks} attack (${((attacks / N) * 100).toFixed(1)}%), target ${(ATTACK_RATIO * 100).toFixed(0)}%`);

  const sample = pickRow();
  const body = buildBody(sample.row);
  console.log(`example row : label = ${sample.row.label}   <- console only, NOT in the body`);
  console.log("POST /ingest body that will be sent:");
  console.log(JSON.stringify(body, null, 2));

  const keys = Object.keys(body.metrics);
  const problems = [];
  if ("label" in body) problems.push("label ended up in the body");
  if (keys.includes("label")) problems.push("label ended up in metrics");
  if (keys.length !== samples.features.length) problems.push(`expected ${samples.features.length} features, got ${keys.length}`);
  if (!keys.every((k) => Number.isFinite(body.metrics[k]))) problems.push("a metric is not a number");
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(body.ts)) problems.push("ts is not ISO-8601");

  if (problems.length === 0) {
    console.log(`\nSELF-CHECK PASS: label is hidden, ${samples.features.length} features present, all numeric, ts is valid`);
    process.exit(0);
  }
  console.error("\nSELF-CHECK FAIL:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// ---------------- 8. One POST ----------------
const stop = new AbortController();   // Ctrl-C -> stop.abort() -> every pending sleep ends at once
const stats = {
  ok: 0, fail: 0, benign: 0, attack: 0, totalMs: 0, reasons: {},
  // Gateway counters. `prevent` = how many replies came from prevent-mode devices.
  allowed: 0, blocked: 0, blockReasons: {}, prevent: 0, noAction: 0,
  // Prevent-mode replies only: the simulator KNOWS the row's label (the API does not), so here
  // we can measure whether the gateway blocked correctly or wrongly. Detect mode never blocks.
  prevAttack: 0, prevAttackBlocked: 0, prevBenign: 0, prevBenignBlocked: 0,
};

function bump(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

function clock() {
  return new Date().toTimeString().slice(0, 8);   // "11:42:05" - your local time, for humans only
}

// attack_proba can be null (missing_features / model_unavailable) -> "p=-"
function fmtP(p) {
  return typeof p === "number" ? `p=${p.toFixed(2)}` : "p=-";
}

function failed(device, reason) {
  stats.fail++;
  stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
  console.log(`${clock()}  ${device.name}  FAIL    ${reason}`);
}

async function sendOne(device) {
  const { row, kind } = pickRow();
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": device.api_key },
      body: JSON.stringify(buildBody(row)),
      // ONLY the timeout signal. The Ctrl-C `stop.signal` is DELIBERATELY left out here:
      // a POST that is already in flight gets to finish, it is never cut off midway.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.status !== 202) return failed(device, `HTTP ${res.status} ${text.slice(0, 80)}`);

    const reply = JSON.parse(text);   // { accepted, mode, action, reason?, attack_proba?, stream_id }
    const ms = Date.now() - t0;
    stats.ok++;
    stats[kind]++;
    stats.totalMs += ms;
    const tag = kind === "attack" ? "ATTACK" : "benign";

    // No `action` at all = the API is older than the gateway change (not deployed yet).
    // Silently assuming "allow" would be wrong - warn loudly once, then keep counting.
    if (reply.action !== "allow" && reply.action !== "block") {
      if (stats.noAction++ === 0) {
        console.log(`${clock()}  ${device.name}  WARN    no action in reply - outdated API (pre-gateway)?`);
      }
    }
    if (reply.mode === "prevent") {
      stats.prevent++;
      bump(stats, kind === "attack" ? "prevAttack" : "prevBenign");
    }

    // ---- PEP: the API makes the decision, ENFORCEMENT happens here ----
    if (reply.action === "block") {
      stats.blocked++;
      bump(stats.blockReasons, reply.reason ?? "?");
      if (reply.mode === "prevent") bump(stats, kind === "attack" ? "prevAttackBlocked" : "prevBenignBlocked");
      // BLOCKED lines print even in quiet mode: a block must always be visible.
      console.log(
        `${clock()}  ${device.name}  BLOCKED ${row.label.padEnd(24)} ${reply.reason} ${fmtP(reply.attack_proba)}  ${ms}ms`
      );
      return;   // "blocked" = a real gateway would NOT forward this reading on to the real system
    }

    stats.allowed++;
    // in prevent mode also show the score (below block threshold = allow; alert/block both in model.json)
    const why = reply.mode === "prevent" ? `allow ${fmtP(reply.attack_proba)}` : "allow";
    if (kind === "attack" || !values.quiet) {
      console.log(`${clock()}  ${device.name}  ${tag}  ${row.label.padEnd(24)} 202  ${why}  ${ms}ms`);
    }
  } catch (err) {
    // API down  -> TypeError "fetch failed", the real cause is err.cause.code = ECONNREFUSED
    // API hung  -> err.name = TimeoutError
    failed(device, err.cause?.code || err.name || "network error");
  }
}

// ---------------- 9. Per-device loop ----------------
// true = slept the full time, false = Ctrl-C interrupted the sleep
async function pause(ms) {
  try {
    await sleep(ms, undefined, { signal: stop.signal });
    return true;
  } catch (err) {
    if (err.name === "AbortError") return false;
    throw err;
  }
}

async function runDevice(device) {
  // First POST at a random moment between 0 and RATE_SEC, so devices don't all send at once.
  if (!(await pause(Math.random() * RATE_SEC * 1000))) return;

  for (let round = 1; COUNT === 0 || round <= COUNT; round++) {
    if (stop.signal.aborted) return;
    await sendOne(device);                        // FINISH this POST first...
    if (round === COUNT) return;                  // (no point sleeping after the last round)
    if (!(await pause(RATE_SEC * 1000))) return;  // ...THEN wait for the next. Not setInterval.
  }
}

// ---------------- 10. Ctrl-C + summary ----------------
process.on("SIGINT", () => {
  // A second copy of the same Ctrl-C can arrive (npm also forwards it to the child). Ignore it.
  if (stop.signal.aborted) return;
  console.log(`\nCtrl-C received: no new POSTs. Waiting up to ${REQUEST_TIMEOUT_MS / 1000}s for in-flight POSTs...`);
  stop.abort();
  // Safety net: even if something hangs, exit after a fixed time. unref() = this timer does not
  // keep the process alive by itself - if all goes well, the process exits before it fires.
  setTimeout(() => {
    console.error("Shutdown hung - forcing exit");
    process.exit(1);
  }, REQUEST_TIMEOUT_MS + 2000).unref();
});

const startedAt = Date.now();
console.log(`\nStarted: ${DEVICE_COUNT} devices -> ${BASE}/ingest` + (COUNT === 0 ? "   (stop with Ctrl-C)" : ""));
await Promise.all(DEVICES.map(runDevice));

const sent = stats.ok + stats.fail;
console.log("\n--- summary ---");
console.log(`sent        : ${sent}   (202 ok: ${stats.ok}, fail: ${stats.fail})`);
console.log(`mix         : ${stats.benign} benign, ${stats.attack} attack`);
console.log(`avg latency : ${stats.ok ? Math.round(stats.totalMs / stats.ok) + " ms" : "-"}`);
for (const [reason, n] of Object.entries(stats.reasons)) console.log(`fail reason : ${reason}  x${n}`);
// Gateway tally
console.log(`gateway     : ${stats.allowed} forwarded (allow), ${stats.blocked} stopped (block)`);
for (const [reason, n] of Object.entries(stats.blockReasons)) console.log(`block reason: ${reason}  x${n}`);
if (stats.prevent) {
  console.log(`prevent     : of ${stats.prevAttack} attacks, ${stats.prevAttackBlocked} blocked, ` +
    `${stats.prevAttack - stats.prevAttackBlocked} got through   (score below block threshold - ml/model.json)`);
  console.log(`false block : of ${stats.prevBenign} benign, ${stats.prevBenignBlocked} blocked   (should be 0)`);
} else if (stats.ok > stats.noAction) {
  // (an old API does not report mode at all - claiming "all detect" would then be false, hence this check)
  console.log("prevent     : no device in prevent mode - all detect, nothing blocked");
}
if (stats.noAction) console.log(`WARN        : ${stats.noAction} replies without action - outdated API?`);
console.log(`ran for     : ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
if (stats.ok) console.log(`DB check    : if the consumer is running, readings should grow by exactly +${stats.ok}`);

// exit code: 0 = all 202, 1 = some failed. No process.exit() - the process exits cleanly by itself.
process.exitCode = stats.fail > 0 ? 1 : 0;
