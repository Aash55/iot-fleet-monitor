import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startApp } from "./helpers.js";

let t;
let alice;
let bob;
before(async () => {
  t = await startApp();
  alice = await t.newUser();
  bob = await t.newUser();
});
after(() => t.stop());

test("create: 201, starts offline in detect mode, API key shown once", async () => {
  const res = await t.request("POST", "/devices", { token: alice.token, body: { name: "  gate-1  " } });
  assert.equal(res.status, 201);
  assert.equal(res.body.device.name, "gate-1", "name is trimmed");
  assert.equal(res.body.device.status, "offline");
  assert.equal(res.body.device.last_seen, null);
  assert.equal(res.body.device.mode, "detect");
  assert.match(res.body.api_key, /^dev_[0-9a-f]{64}$/);

  const list = await t.request("GET", "/devices", { token: alice.token });
  assert.equal(list.body.devices[0].api_key, undefined, "the key is never returned again");
});

test("only the SHA-256 of the API key is stored", async () => {
  const { device, api_key } = await t.newDevice(alice.token, "gate-2");
  const { rows } = await t.pool.query("SELECT api_key_hash FROM devices WHERE id = $1", [device.id]);
  const expected = crypto.createHash("sha256").update(api_key).digest("hex");
  assert.equal(rows[0].api_key_hash, expected);
  assert.notEqual(rows[0].api_key_hash, api_key);
});

test("same name twice for one owner -> 409, but another owner may use it", async () => {
  const dup = await t.request("POST", "/devices", { token: alice.token, body: { name: "gate-1" } });
  const other = await t.request("POST", "/devices", { token: bob.token, body: { name: "gate-1" } });
  assert.equal(dup.status, 409);
  assert.equal(other.status, 201);
});

test("no token -> 401 on every device route", async () => {
  const res = await t.request("GET", "/devices");
  assert.equal(res.status, 401);
});

test("another user's device is 404 (not 403) for read, mode change, readings and delete", async () => {
  const { device } = await t.newDevice(alice.token, "alice-private");
  const id = device.id;

  const read = await t.request("GET", `/devices/${id}`, { token: bob.token });
  const patch = await t.request("PATCH", `/devices/${id}`, { token: bob.token, body: { mode: "prevent" } });
  const readings = await t.request("GET", `/devices/${id}/readings`, { token: bob.token });
  const del = await t.request("DELETE", `/devices/${id}`, { token: bob.token });

  for (const res of [read, patch, readings, del]) assert.equal(res.status, 404);

  const still = await t.request("GET", `/devices/${id}`, { token: alice.token });
  assert.equal(still.body.device.mode, "detect", "bob's PATCH changed nothing");
});

test("a user's list only contains their own devices", async () => {
  const res = await t.request("GET", "/devices", { token: bob.token });
  assert.deepEqual(res.body.devices.map((d) => d.name), ["gate-1"]);
});

test("PATCH mode: detect <-> prevent works, anything else -> 400", async () => {
  const { device } = await t.newDevice(alice.token, "mode-switch");
  const toPrevent = await t.request("PATCH", `/devices/${device.id}`, {
    token: alice.token,
    body: { mode: "prevent" },
  });
  const invalid = await t.request("PATCH", `/devices/${device.id}`, {
    token: alice.token,
    body: { mode: "block-everything" },
  });
  assert.equal(toPrevent.status, 200);
  assert.equal(toPrevent.body.device.mode, "prevent");
  assert.equal(invalid.status, 400);
});

test("bad ids and bad ?limit -> 400", async () => {
  const badId = await t.request("GET", "/devices/abc", { token: alice.token });
  const zeroLimit = await t.request("GET", "/devices/1/readings?limit=0", { token: alice.token });
  const bigLimit = await t.request("GET", "/devices/1/readings?limit=501", { token: alice.token });
  assert.equal(badId.status, 400);
  assert.equal(zeroLimit.status, 400);
  assert.equal(bigLimit.status, 400);
});

test("delete: 204, then the device is gone (404)", async () => {
  const { device } = await t.newDevice(alice.token, "to-delete");
  const del = await t.request("DELETE", `/devices/${device.id}`, { token: alice.token });
  const again = await t.request("GET", `/devices/${device.id}`, { token: alice.token });
  assert.equal(del.status, 204);
  assert.equal(again.status, 404);
});
