-- Run on EXISTING databases (local fleet + Neon) via the pgAdmin Query Tool. BEFORE PUSHING CODE:
-- the new consumer writes `action` in every INSERT. Without the column the INSERT fails (42703)
-- -> the consumer takes it for "a temporary DB problem" and keeps retrying -> new readings STOP
-- being stored until the column exists. (A missing `mode` column gave a GET 500; here it is a
-- silent stall.)
--
-- action = what the IPS did with this reading:
--   'allowed' = prevent mode, the model said it is fine (or there was no model -> fail-open)
--   'blocked' = prevent mode, attack_proba >= the model's block threshold (model.json), or features were missing
--   NULL      = detect mode - the IPS made no decision at all. All existing rows are NULL too.
-- That is why NULL is allowed and there is no DEFAULT: writing 'allowed' into old rows would be
-- a LIE - no decision was made back then.
-- CHECK: NULL passes the CHECK (NULL IN (...) = NULL, not false) - which is what we want.
ALTER TABLE readings
  ADD COLUMN IF NOT EXISTS action TEXT
    CONSTRAINT readings_action_check CHECK (action IN ('allowed', 'blocked'));

-- Check 1: all existing rows are NULL. Expect exactly one line: (empty) | <all readings>
SELECT action, count(*) AS readings FROM readings GROUP BY action;

-- Check 2: 1 row, showing the CHECK rule
SELECT conname, pg_get_constraintdef(oid) AS rule
FROM pg_constraint WHERE conname = 'readings_action_check';
