-- Run on EXISTING databases (local fleet + Neon) via the pgAdmin Query Tool, BEFORE PUSHING CODE.
-- The new consumer writes these columns. If a column is missing, INSERT fails with 42703 -> the
-- consumer treats it as "transient" and retries forever -> readings stay stuck.
-- IF NOT EXISTS: safe to re-run. NULL default: existing rows are not touched, so this is
-- instant even on a big table (no table rewrite).
ALTER TABLE readings ADD COLUMN IF NOT EXISTS attack_proba REAL;
ALTER TABLE readings ADD COLUMN IF NOT EXISTS is_attack BOOLEAN;

-- Check: both new columns should show up (2 rows)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'readings' AND column_name IN ('attack_proba', 'is_attack')
ORDER BY column_name;
