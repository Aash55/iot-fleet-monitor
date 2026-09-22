-- api/db/schema.sql  -> ye f-step 5 pe daalni hai (P3.1)
-- Sirf NAYE database ke liye (P6 pe Neon). Purane local DB pe CREATE TABLE IF NOT EXISTS
-- kuch nahi badalta - wahan pgAdmin wali migration (Block B-E) chalti hai.
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  api_key_hash TEXT        NOT NULL UNIQUE,
  -- P3.1: `status` column hata diya. online/offline ab GET /devices har request pe
  -- last_seen se nikalta hai - stored copy 20 Sept ke baad bhi 'online' bol rahi thi.
  last_seen    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- P3.1: ek owner ke do device ka ek naam nahi. Alag owner same naam rakh sakte hain.
  -- Naam explicit hai kyunki routes/devices.js 409 dene ke liye isi naam ko pehchanta hai.
  CONSTRAINT devices_owner_id_name_key UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS devices_owner_id_idx ON devices (owner_id);

-- P2 Step 2: what the consumer writes. One row per accepted telemetry reading.
CREATE TABLE IF NOT EXISTS readings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Redis stream entry id. UNIQUE = the idempotency key: at-least-once delivery
  -- means the same entry can arrive twice, and the second insert must be a no-op.
  stream_id   TEXT        NOT NULL UNIQUE,
  device_id   BIGINT      NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  owner_id    BIGINT      NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  ts          TIMESTAMPTZ NOT NULL,   -- device clock
  received_at TIMESTAMPTZ NOT NULL,   -- API clock at /ingest
  metrics     JSONB       NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()  -- consumer clock
);

CREATE INDEX IF NOT EXISTS readings_device_ts_idx ON readings (device_id, ts DESC);
CREATE INDEX IF NOT EXISTS readings_owner_ts_idx  ON readings (owner_id,  ts DESC);
