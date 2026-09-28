-- Run on EXISTING databases (local fleet + Neon) via the pgAdmin Query Tool. BEFORE PUSHING CODE:
-- the new devices.js reads `mode` in every SELECT. Without the column GET /devices = 500
-- (expand-then-deploy: widen the DB first, then ship the code).
--
-- mode = how the device is handled:
--   'detect'  = IDS: detect and alert only (the behaviour so far)
--   'prevent' = IPS: BLOCK the reading if it looks like an attack (/ingest reads this)
-- DEFAULT 'detect' -> all existing devices land in detect automatically, nothing changes.
-- NOT NULL -> no third "mode unknown" state can exist.
-- CHECK -> only these 2 words. The API's zod also rejects others; CHECK = the DB's last wall
--          (so a bad value cannot sneak in via pgAdmin or a bug).
-- IF NOT EXISTS -> re-running does nothing (the constraint is part of this same ADD COLUMN).
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'detect'
    CONSTRAINT devices_mode_check CHECK (mode IN ('detect', 'prevent'));

-- Check 1: every existing device is in 'detect'. Expect exactly one line: detect | <all devices>
SELECT mode, count(*) AS devices FROM devices GROUP BY mode;

-- Check 2: 1 row, showing the CHECK rule
SELECT conname, pg_get_constraintdef(oid) AS rule
FROM pg_constraint WHERE conname = 'devices_mode_check';
