import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./helpers.js";

let t;
before(async () => {
  t = await startApp();
});
after(() => t.stop());

test("register: 201, lowercases the email, returns a token, sends no-store", async () => {
  const res = await t.request("POST", "/auth/register", {
    body: { email: "Mixed.Case@Example.com", password: "correct-horse-1" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, "mixed.case@example.com");
  assert.equal(typeof res.body.token, "string");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.body.user.password_hash, undefined, "hash must never leave the server");
});

test("register: the same email twice (any case) -> 409", async () => {
  const res = await t.request("POST", "/auth/register", {
    body: { email: "MIXED.case@example.com", password: "another-pass-2" },
  });
  assert.equal(res.status, 409);
});

test("register: bad email or short password -> 400", async () => {
  const badEmail = await t.request("POST", "/auth/register", {
    body: { email: "not-an-email", password: "correct-horse-1" },
  });
  const shortPass = await t.request("POST", "/auth/register", {
    body: { email: "short@example.com", password: "1234567" },
  });
  assert.equal(badEmail.status, 400);
  assert.equal(shortPass.status, 400);
});

test("password is stored as an argon2id hash, not as text", async () => {
  const { rows } = await t.pool.query(
    "SELECT password_hash FROM users WHERE email = 'mixed.case@example.com'"
  );
  assert.match(rows[0].password_hash, /^\$argon2id\$/);
});

test("login: right password -> 200 + token, wrong password -> 401", async () => {
  const ok = await t.request("POST", "/auth/login", {
    body: { email: "mixed.case@example.com", password: "correct-horse-1" },
  });
  const wrong = await t.request("POST", "/auth/login", {
    body: { email: "mixed.case@example.com", password: "wrong-password" },
  });
  assert.equal(ok.status, 200);
  assert.equal(typeof ok.body.token, "string");
  assert.equal(wrong.status, 401);
});

test("login: unknown email gives the same 401 as a wrong password", async () => {
  const res = await t.request("POST", "/auth/login", {
    body: { email: "nobody@example.com", password: "whatever-123" },
  });
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: "invalid credentials" });
});

test("/me: no token -> 401, tampered token -> 401, valid token -> 200", async () => {
  const { token } = await t.newUser();

  const none = await t.request("GET", "/me");
  const tampered = await t.request("GET", "/me", { token: token.slice(0, -2) + "xx" });
  const valid = await t.request("GET", "/me", { token });

  assert.equal(none.status, 401);
  assert.equal(none.headers.get("cache-control"), "no-store", "401 replies are not cached either");
  assert.equal(tampered.status, 401);
  assert.equal(valid.status, 200);
  assert.ok(valid.body.user.email);
});
