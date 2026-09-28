import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startApp, fullMetrics } from "./helpers.js";

let t;
let owner;
let detect; // { device, api_key } in detect mode
let prevent; // { device, api_key } in prevent mode
let blockThreshold;

before(async () => {
  t = await startApp({ withModel: true });
  owner = await t.newUser();
  detect = await t.newDevice(owner.token, "detect-device");
  prevent = await t.newDevice(owner.token, "prevent-device");
  await t.request("PATCH", `/devices/${prevent.device.id}`, {
    token: owner.token,
    body: { mode: "prevent" },
  });
  const { blockThreshold: getBlock, modelStatus } = await import("../src/model.js");
  assert.equal(modelStatus(), "loaded", "ml/model.onnx must load for these tests");
  blockThreshold = getBlock();
});
after(() => t.stop());

async function lastStreamEntry() {
  const entries = await t.redis.xRevRange("telemetry", "+", "-", { COUNT: 1 });
  return entries[0];
}

test("no API key or a wrong one -> 401, and nothing reaches the stream", async () => {
  const none = await t.request("POST", "/ingest", { body: { metrics: fullMetrics() } });
  const wrong = await t.request("POST", "/ingest", {
    apiKey: "dev_" + "0".repeat(64),
    body: { metrics: fullMetrics() },
  });
  assert.equal(none.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(await t.redis.xLen("telemetry"), 0);
});

test("invalid bodies -> 400", async () => {
  const empty = await t.request("POST", "/ingest", { apiKey: detect.api_key, body: { metrics: {} } });
  const text = await t.request("POST", "/ingest", {
    apiKey: detect.api_key,
    body: { metrics: { rate: "fast" } },
  });
  const badTs = await t.request("POST", "/ingest", {
    apiKey: detect.api_key,
    body: { ts: "yesterday", metrics: fullMetrics() },
  });
  for (const res of [empty, text, badTs]) assert.equal(res.status, 400);
});

test("detect mode: 202 at once, action allow, no score in the request", async () => {
  const res = await t.request("POST", "/ingest", {
    apiKey: detect.api_key,
    body: { metrics: fullMetrics() },
  });
  assert.equal(res.status, 202);
  assert.equal(res.body.mode, "detect");
  assert.equal(res.body.action, "allow");
  assert.equal(res.body.attack_proba, undefined, "detect mode scores later, in the consumer");
  assert.ok(res.body.stream_id);

  const entry = await lastStreamEntry();
  assert.equal(entry.id, res.body.stream_id);
  assert.equal(entry.message.action, undefined);
});

test("identity comes from the API key, never from the body", async () => {
  const res = await t.request("POST", "/ingest", {
    apiKey: detect.api_key,
    body: { device_id: 999, owner_id: 999, metrics: fullMetrics() },
  });
  assert.equal(res.status, 202);
  const entry = await lastStreamEntry();
  assert.equal(entry.message.device_id, String(detect.device.id));
  assert.equal(entry.message.owner_id, String(owner.user.id));
});

test("prevent mode: scores inside the request and decides with the model's block threshold", async () => {
  const res = await t.request("POST", "/ingest", {
    apiKey: prevent.api_key,
    body: { metrics: fullMetrics() },
  });
  assert.equal(res.status, 202, "a block is a decision in the body, not an HTTP error");
  assert.equal(res.body.reason, "score");
  const p = res.body.attack_proba;
  assert.ok(p >= 0 && p <= 1, `attack_proba ${p} must be in 0..1`);
  assert.equal(res.body.action, p >= blockThreshold ? "block" : "allow");
  assert.match(res.headers.get("server-timing") ?? "", /^predict;dur=\d+(\.\d+)?$/);

  // The decision travels with the reading, so the consumer does not score it again.
  const entry = await lastStreamEntry();
  assert.equal(entry.message.action, res.body.action === "block" ? "blocked" : "allowed");
  assert.equal(Number(entry.message.attack_proba), p);
});

test("prevent mode: a missing model feature is blocked (fail closed), not guessed", async () => {
  const { rate: _dropped, ...withoutRate } = fullMetrics();
  const res = await t.request("POST", "/ingest", {
    apiKey: prevent.api_key,
    body: { metrics: withoutRate },
  });
  assert.equal(res.status, 202);
  assert.equal(res.body.action, "block");
  assert.equal(res.body.reason, "missing_features");
  assert.equal(res.body.attack_proba, null);
});
