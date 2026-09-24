-- api/db/p7-f1-device-mode.sql  -> ye f-step P7-f1 pe daalni hai (NAYI file)
-- PURANE database pe chalao (local fleet + Neon), pgAdmin Query Tool se. CODE PUSH SE PEHLE:
-- naya devices.js har SELECT mein `mode` padhta hai. Column na ho to GET /devices = 500
-- (expand-then-deploy: pehle DB phailao, phir code bhejo).
--
-- mode = device kis tarah chalega:
--   'detect'  = IDS: sirf pehchaan ke alert (aaj tak ka behaviour)
--   'prevent' = IPS: attack lage to reading BLOCK (P7-f2 mein /ingest ye padhega)
-- DEFAULT 'detect' -> purane saare devices apne-aap detect mein, kuch nahi badalta.
-- NOT NULL -> "mode pata nahi" wali teesri halat hi nahi banti.
-- CHECK -> sirf ye 2 shabd. API ka zod bhi rokta hai; CHECK = DB ki aakhri deewar
--          (pgAdmin se ya kisi bug se galat value na ghuse).
-- IF NOT EXISTS -> dobara chalao to kuch nahi hota (constraint bhi isi ADD COLUMN ka hissa hai).
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'detect'
    CONSTRAINT devices_mode_check CHECK (mode IN ('detect', 'prevent'));

-- Check 1: har purana device 'detect' mein. Ek hi line aani chahiye: detect | <sab devices>
SELECT mode, count(*) AS devices FROM devices GROUP BY mode;

-- Check 2: 1 row, CHECK wala rule dikhna chahiye
SELECT conname, pg_get_constraintdef(oid) AS rule
FROM pg_constraint WHERE conname = 'devices_mode_check';
