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
  status       TEXT        NOT NULL DEFAULT 'offline'
                           CHECK (status IN ('online', 'offline')),
  last_seen    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
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
