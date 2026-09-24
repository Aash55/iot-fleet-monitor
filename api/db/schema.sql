-- api/db/schema.sql  -> ye f-step P7-f2 pe daalni hai (P5-f2: attack_proba + is_attack; P5-f3: attack index; P7-f1: devices.mode; P7-f2: readings.action)
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
  -- P7-f1: 'detect' = IDS (sirf alert), 'prevent' = IPS (attack pe block). Purana DB: p7-f1-device-mode.sql
  mode         TEXT        NOT NULL DEFAULT 'detect'
    CONSTRAINT devices_mode_check CHECK (mode IN ('detect', 'prevent')),
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
  -- P5-f2: model ka score. NULL = score nahi hua (model unavailable / feature gayab).
  attack_proba REAL,                  -- float32, wahi jo ONNX ne diya
  is_attack    BOOLEAN,               -- ONNX label (tie 0.5 -> false, sklearn jaisa)
  -- P7-f2: IPS ka faisla. NULL = detect mode (koi faisla nahi). Purana DB: p7-f2-reading-action.sql
  action       TEXT
    CONSTRAINT readings_action_check CHECK (action IN ('allowed', 'blocked')),
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()  -- consumer clock
);

CREATE INDEX IF NOT EXISTS readings_device_ts_idx ON readings (device_id, ts DESC);
CREATE INDEX IF NOT EXISTS readings_owner_ts_idx  ON readings (owner_id,  ts DESC);
-- P5-f3: sirf attack wali rows ka chhota (partial) index - GET /devices ka recent_attacks isse
-- padhta hai. 97% benign rows index mein hoti hi nahi.
CREATE INDEX IF NOT EXISTS readings_attack_idx ON readings (device_id, received_at DESC)
  WHERE is_attack;
