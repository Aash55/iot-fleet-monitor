-- api/db/p5-f3-attack-index.sql  -> ye f-step P5-f3 pe daalni hai (NAYI file)
-- PURANE database pe chalao (local fleet + Neon), pgAdmin Query Tool se. Code isse pehle ya baad
-- dono chal jaata hai (index sirf speed hai, sahi jawab iske bina bhi aata) - phir bhi pehle chalao.
-- Partial index: sirf WHERE is_attack wali rows. Attack ~3% hain, to index chhota rehta hai.
CREATE INDEX IF NOT EXISTS readings_attack_idx ON readings (device_id, received_at DESC)
  WHERE is_attack;

-- Check: 1 row, indexdef mein "WHERE is_attack" dikhna chahiye
SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'readings_attack_idx';
