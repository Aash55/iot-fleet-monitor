-- api/db/p7-f2-reading-action.sql  -> ye f-step P7-f2 pe daalni hai (NAYI file)
-- PURANE database pe chalao (local fleet + Neon), pgAdmin Query Tool se. CODE PUSH SE PEHLE:
-- naya consumer har INSERT mein `action` likhta hai. Column na ho to INSERT fail (42703) ->
-- consumer ise "DB ki kuch der ki dikkat" samajh ke retry karta rehta hai -> nayi readings
-- store hona BAND, jab tak column na aaye. (f1 mein GET 500 tha; yahan chupchaap ruk jaana.)
--
-- action = IPS ne is reading ke saath kya kiya:
--   'allowed' = prevent mode, model ne kaha theek hai (ya model tha hi nahi -> fail-open)
--   'blocked' = prevent mode, attack_proba >= 0.90 (ya features gayab the)
--   NULL      = detect mode - IPS ne koi faisla kiya hi nahi. Purani saari rows bhi NULL.
-- Isliye NULL allowed hai aur DEFAULT nahi: purani rows ko 'allowed' likhna JHOOTH hota -
-- us waqt koi faisla hua hi nahi tha.
-- CHECK: NULL CHECK ko pass kar jaata hai (NULL IN (...) = NULL, false nahi) - yahi chahiye.
ALTER TABLE readings
  ADD COLUMN IF NOT EXISTS action TEXT
    CONSTRAINT readings_action_check CHECK (action IN ('allowed', 'blocked'));

-- Check 1: saari purani rows NULL. Ek hi line aani chahiye: (khaali) | <sab readings>
SELECT action, count(*) AS readings FROM readings GROUP BY action;

-- Check 2: 1 row, CHECK wala rule dikhna chahiye
SELECT conname, pg_get_constraintdef(oid) AS rule
FROM pg_constraint WHERE conname = 'readings_action_check';
