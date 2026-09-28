// Shared setup for the API integration tests.
//
// The tests run against a real PostgreSQL and a real Redis, because the guarantees
// they check (UNIQUE constraints, ON CONFLICT, consumer groups, XACK) only exist there.
//
// Safety: the tests never read DATABASE_URL / REDIS_URL from your shell or .env.
// They use TEST_DATABASE_URL (must point at a database whose name ends in "_test")
// and TEST_REDIS_URL (Redis logical DB 15 by default), so a test run can never
// truncate your dev or production data.
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const TEST_DB =
  process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/fleet_test";
const TEST_REDIS = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379/15";

const dbName = new URL(TEST_DB).pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`TEST_DATABASE_URL must point at a *_test database, got "${dbName}"`);
}

// Set BEFORE the app modules are imported: db.js and redis.js read these at import time.
Object.assign(process.env, {
  DATABASE_URL: TEST_DB,
  REDIS_URL: TEST_REDIS,
  JWT_SECRET: "test-secret-not-used-anywhere-else",
  CORS_ORIGIN: "http://localhost:5173",
  CONSUMER_NAME: "test-writer",
  CONSUMER_BLOCK_MS: "200",
  CONSUMER_RETRY_MS: "100",
});

const SCHEMA = path.join(import.meta.dirname, "..", "db", "schema.sql");

// Create the test database on first run, so `npm test` works without a manual createdb.
async function ensureDatabase() {
  const admin = new URL(TEST_DB);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
}

/**
 * Starts the real Express app on a random port against a clean database and an
 * empty Redis DB. Returns helpers for the tests and a stop() for after().
 */
export async function startApp({ withModel = false } = {}) {
  await ensureDatabase();

  const { default: app } = await import("../src/app.js");
  const { pool } = await import("../src/db.js");
  const { redis } = await import("../src/redis.js");
  const { loadModel } = await import("../src/model.js");

  await pool.query(await fs.readFile(SCHEMA, "utf8"));
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");

  if (!redis.isOpen) await redis.connect();
  await redis.flushDb();

  if (withModel) await loadModel();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, url, { body, token, apiKey, headers = {} } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(apiKey && { "x-api-key": apiKey }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, body: json };
  }

  let userCount = 0;
  // Registers a fresh user and returns { token, user }.
  async function newUser() {
    userCount += 1;
    const res = await request("POST", "/auth/register", {
      body: { email: `user${userCount}@example.com`, password: "correct-horse-1" },
    });
    if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
    return res.body;
  }

  // Creates a device for the given token and returns { device, api_key }.
  async function newDevice(token, name = `device-${Date.now()}-${Math.random()}`) {
    const res = await request("POST", "/devices", { token, body: { name } });
    if (res.status !== 201) throw new Error(`create device failed: ${res.status}`);
    return res.body;
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    if (redis.isOpen) await redis.quit();
    await pool.end();
  }

  return { base, request, newUser, newDevice, pool, redis, stop };
}

// One flow row with all 9 model features. The values are arbitrary: tests compare the
// decision with the model's own threshold instead of expecting a fixed label.
export function fullMetrics(overrides = {}) {
  return {
    flow_duration: 0.5,
    header_length: 120,
    protocol_type: 6,
    duration: 64,
    rate: 2.5,
    syn_count: 0,
    rst_count: 0,
    urg_count: 0,
    tot_size: 60,
    ...overrides,
  };
}

// Polls until check() returns a truthy value or the timeout passes.
export async function waitFor(check, { timeoutMs = 5000, stepMs = 50 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
