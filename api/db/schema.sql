-- Only for a NEW database (e.g. Neon). On an existing local DB, CREATE TABLE IF NOT EXISTS
-- changes nothing - there the migration files in this folder are run by hand in pgAdmin.
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
  -- No `status` column. GET /devices derives online/offline from last_seen on every
  -- request - the stored copy was still saying 'online' after 20 Sept.
  last_seen    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'detect' = IDS (alert only), 'prevent' = IPS (block on attack). Existing DB: p7-f1-device-mode.sql
  mode         TEXT        NOT NULL DEFAULT 'detect'
    CONSTRAINT devices_mode_check CHECK (mode IN ('detect', 'prevent')),
  -- One owner cannot give two devices the same name. Different owners can reuse a name.
  -- The constraint is named explicitly because routes/devices.js matches this name to return 409.
  CONSTRAINT devices_owner_id_name_key UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS devices_owner_id_idx ON devices (owner_id);

-- What the consumer writes. One row per accepted telemetry reading.
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
  -- The model's score. NULL = not scored (model unavailable / feature missing).
  attack_proba REAL,                  -- float32, exactly what ONNX returned
  is_attack    BOOLEAN,               -- attack_proba >= model.json thresholds.alert (previously 0.5)
  -- The IPS decision. NULL = detect mode (no decision). Existing DB: p7-f2-reading-action.sql
  action       TEXT
    CONSTRAINT readings_action_check CHECK (action IN ('allowed', 'blocked')),
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()  -- consumer clock
);

CREATE INDEX IF NOT EXISTS readings_device_ts_idx ON readings (device_id, ts DESC);
CREATE INDEX IF NOT EXISTS readings_owner_ts_idx  ON readings (owner_id,  ts DESC);
-- A small (partial) index over attack rows only - GET /devices reads recent_attacks from it.
-- The 97% benign rows are not in the index at all.
CREATE INDEX IF NOT EXISTS readings_attack_idx ON readings (device_id, received_at DESC)
  WHERE is_attack;
