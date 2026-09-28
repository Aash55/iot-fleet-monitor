import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startApp, fullMetrics, waitFor } from "./helpers.js";

let t;
let owner;
let dev;
let consumer;

before(async () => {
  t = await startApp({ withModel: true });
  consumer = await import("../src/consumer.js");
  owner = await t.newUser();
  dev = await t.newDevice(owner.token, "consumer-device");
});
after(async () => {
  await consumer.stopConsumer();
  await t.stop();
});

async function countReadings() {
  const { rows } = await t.pool.query(
    "SELECT count(*)::int AS n FROM readings WHERE device_id = $1",
    [dev.device.id]
  );
  return rows[0].n;
}

async function pendingCount() {
  const info = await t.redis.xPending("telemetry", consumer.CONSUMER_GROUP);
  return info.pending;
}

test("the consumer writes each reading to Postgres with a score, then acks it", async () => {
  for (let i = 0; i < 3; i++) {
    const res = await t.request("POST", "/ingest", { apiKey: dev.api_key, body: { metrics: fullMetrics() } });
    assert.equal(res.status, 202);
  }
  await consumer.startConsumer();

  await waitFor(async () => (await countReadings()) === 3);
  await waitFor(async () => (await pendingCount()) === 0);

  const { rows } = await t.pool.query(
    "SELECT attack_proba, is_attack FROM readings WHERE device_id = $1",
    [dev.device.id]
  );
  for (const r of rows) {
    assert.ok(r.attack_proba >= 0 && r.attack_proba <= 1);
    assert.equal(typeof r.is_attack, "boolean");
  }
});

test("a written reading makes the device online (status is derived from last_seen)", async () => {
  const res = await t.request("GET", `/devices/${dev.device.id}`, { token: owner.token });
  assert.equal(res.body.device.status, "online");
  assert.ok(res.body.device.last_seen);
});

test("redelivery of the same stream entries writes nothing twice (stream_id is UNIQUE)", async () => {
  await consumer.stopConsumer();
  // Rewind the group so every entry is delivered again, like after a crash before XACK.
  await t.redis.xGroupSetId("telemetry", consumer.CONSUMER_GROUP, "0");
  await consumer.startConsumer();

  // Wait until the redelivered batch has been read and acked again.
  await waitFor(async () => {
    const info = await t.redis.xInfoGroups("telemetry");
    const group = info.find((g) => g.name === consumer.CONSUMER_GROUP);
    return group && group.pending === 0 && group["entries-read"] >= 3;
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await countReadings(), 3);
});

test("a malformed stream entry is dropped and acked, and the consumer keeps going", async () => {
  await t.redis.xAdd("telemetry", "*", {
    device_id: "not-a-number",
    owner_id: String(owner.user.id),
    ts: new Date().toISOString(),
    received_at: new Date().toISOString(),
    metrics: "{}",
  });
  const good = await t.request("POST", "/ingest", { apiKey: dev.api_key, body: { metrics: fullMetrics() } });
  assert.equal(good.status, 202);

  await waitFor(async () => (await countReadings()) === 4);
  await waitFor(async () => (await pendingCount()) === 0);
});

test("readings API: oldest -> newest, UTC timestamps, scores included, never the label", async () => {
  const res = await t.request("GET", `/devices/${dev.device.id}/readings?limit=5`, { token: owner.token });
  assert.equal(res.status, 200);
  const readings = res.body.readings;
  assert.equal(readings.length, 4);
  for (let i = 1; i < readings.length; i++) {
    assert.ok(new Date(readings[i].ts) >= new Date(readings[i - 1].ts));
  }
  for (const r of readings) {
    assert.ok(r.ts.endsWith("Z"));
    assert.ok("attack_proba" in r && "is_attack" in r && "action" in r);
    assert.equal(r.metrics.label, undefined);
  }
});
