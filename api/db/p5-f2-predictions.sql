-- api/db/p5-f2-predictions.sql  -> ye f-step P5-f2 pe daalni hai (NAYI file)
-- PURANE database pe chalao (local fleet + Neon), pgAdmin Query Tool se, CODE PUSH SE PEHLE.
-- Naya consumer in columns mein likhta hai. Column na ho to INSERT 42703 deta hai -> consumer
-- use "transient" maan ke hamesha retry karta hai -> readings atki rehti hain.
-- IF NOT EXISTS: dobara chalana safe hai. NULL default: purani rows ko chhoona nahi padta,
-- isliye bade table pe bhi ye turant hota hai (table rewrite nahi hoti).
ALTER TABLE readings ADD COLUMN IF NOT EXISTS attack_proba REAL;
ALTER TABLE readings ADD COLUMN IF NOT EXISTS is_attack BOOLEAN;

-- Check: dono naye column dikhne chahiye (2 rows)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'readings' AND column_name IN ('attack_proba', 'is_attack')
ORDER BY column_name;
