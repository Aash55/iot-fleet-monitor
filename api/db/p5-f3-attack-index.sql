-- Run on EXISTING databases (local fleet + Neon) via the pgAdmin Query Tool. The code works
-- whether this runs before or after it (the index is only for speed; answers are correct
-- without it) - but run it first anyway.
-- Partial index: only rows WHERE is_attack. Attacks are ~3%, so the index stays small.
CREATE INDEX IF NOT EXISTS readings_attack_idx ON readings (device_id, received_at DESC)
  WHERE is_attack;

-- Check: 1 row, and indexdef should contain "WHERE is_attack"
SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'readings_attack_idx';
