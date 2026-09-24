// api/src/routes/devices.js  -> ye f-step P7-f4a pe daalni hai (P3.1; P5-f3: recent_attacks + score; P7-f1: mode + PATCH; P7-f4a: recent_blocked + action)
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { generateApiKey, hashApiKey } from "../apiKey.js";

export const devicesRouter = Router();

const deviceInput = z.object({ name: z.string().trim().min(1).max(100) });
const idParam = z.coerce.number().int().positive();

// P7-f1: PATCH /devices/:id ka body. Sirf ye 2 shabd - baaki sab 400.
// DB ka CHECK (devices_mode_check) bhi yahi rokta hai; zod pehle rokta hai taaki user ko
// saaf 400 mile, 500 nahi. Body mein aur kuch (jaise name) aaye to zod use chupchaap hata deta hai.
const modeInput = z.object({ mode: z.enum(["detect", "prevent"]) });

// ?limit=N. Query string mein sab TEXT aata hai ("50"), isliye coerce.
// Khaali ?limit= -> Number("") = 0 -> min(1) pakad leta hai. Na bheja -> 100.
const readingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// P3.1: status ab STORE nahi hota. Har request pe last_seen se NIKALTA hai, isliye
// kabhi purana (stale) nahi ho sakta. last_seen NULL (kabhi data nahi aaya) ->
// comparison NULL -> ELSE -> 'offline'.
const STATUS_SQL = `CASE WHEN last_seen > now() - interval '2 minutes'
       THEN 'online' ELSE 'offline' END AS status`;

// P5-f3: "alert" = pichhle 15 min mein model ne kitni readings ko attack kaha. Alag alerts
// table NAHI (acknowledge/resolve jaisa state MVP mein nahi) - readings se hi ginti.
// received_at (API ki ghadi), ts (device ki ghadi) NAHI: device ka clock galat ya jhootha ho
// sakta hai; last_seen bhi received_at se hi banta hai. NULL score (unscored) attack nahi ginta.
// Subquery ka `devices.id` bahar wali devices row hai - isliye har query mein FROM devices.
const ALERT_WINDOW = "15 minutes";
const RECENT_ATTACKS_SQL = `(SELECT count(*)::int FROM readings r
       WHERE r.device_id = devices.id AND r.is_attack
         AND r.received_at > now() - interval '${ALERT_WINDOW}') AS recent_attacks`;

// P7-f4a: "N blocked · 15 min" badge. recent_attacks jaisa hi: same 15 min, same received_at.
// Do alag ginti kyun: recent_attacks = model ne attack KAHA (detect + prevent dono);
// recent_blocked = gateway ko ROKNE ko kaha (sirf prevent). 0.5-0.9 wali reading pehle mein
// aati hai, doosre mein nahi. action NULL (detect / purani rows) -> 'blocked' nahi -> nahi ginta.
const RECENT_BLOCKED_SQL = `(SELECT count(*)::int FROM readings r
       WHERE r.device_id = devices.id AND r.action = 'blocked'
         AND r.received_at > now() - interval '${ALERT_WINDOW}') AS recent_blocked`;

// P7-f1: mode bhi har jagah (list, ek device, POST, PATCH) - web ka toggle (f4b) isi se chalega.
const PUBLIC_COLUMNS = `id, name, mode, ${STATUS_SQL}, last_seen, created_at, ${RECENT_ATTACKS_SQL}, ${RECENT_BLOCKED_SQL}`;

// Naam ki uniqueness DB ka constraint enforce karta hai, code nahi.
// Ye naam schema.sql aur migration dono mein same hai.
const NAME_CONSTRAINT = "devices_owner_id_name_key";

devicesRouter.post("/", async (req, res, next) => {
  const parsed = deviceInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: z.flattenError(parsed.error).fieldErrors });
  }

  const apiKey = generateApiKey();

  try {
    const { rows } = await pool.query(
      `INSERT INTO devices (owner_id, name, api_key_hash)
       VALUES ($1, $2, $3)
       RETURNING ${PUBLIC_COLUMNS}`,
      [req.user.id, parsed.data.name, hashApiKey(apiKey)]
    );
    // api_key is shown exactly once; only its hash is stored
    res.status(201).json({ device: rows[0], api_key: apiKey });
  } catch (err) {
    // 23505 = unique_violation. Constraint ka naam bhi check karo: api_key_hash bhi
    // UNIQUE hai - wahan takraav "naam le liya" nahi, asli server error (500) hai.
    if (err.code === "23505" && err.constraint === NAME_CONSTRAINT) {
      return res
        .status(409)
        .json({ error: { name: ["you already have a device with this name"] } });
    }
    next(err);
  }
});

devicesRouter.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM devices
       WHERE owner_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ devices: rows });
  } catch (err) {
    next(err);
  }
});

devicesRouter.get("/:id", async (req, res, next) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM devices WHERE id = $1 AND owner_id = $2`,
      [id.data, req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "device not found" });
    }
    res.json({ device: rows[0] });
  } catch (err) {
    next(err);
  }
});

// P7-f1: device ka mode badlo (detect <-> prevent). PATCH = record ka EK hissa badalna
// (PUT = poora record badalna). Sirf apna device: WHERE owner_id. Doosre ka device = 404,
// 403 nahi - "ye device hai" itna bhi pata na chale (GET /:id jaisa hi).
devicesRouter.patch("/:id", async (req, res, next) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  // Body hi na ho (Content-Type JSON nahi) to Express 5 mein req.body = undefined ->
  // zod fail -> 400. Isliye alag check nahi chahiye.
  const parsed = modeInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { mode: ['mode must be "detect" or "prevent"'] } });
  }

  try {
    // Ek hi query: badlo AUR naya device wapas lo. Pehle SELECT phir UPDATE = 2 chakkar,
    // aur beech mein koi aur badal de to jawab purana. RETURNING naya (badla hua) row deta hai.
    const { rows } = await pool.query(
      `UPDATE devices SET mode = $1
       WHERE id = $2 AND owner_id = $3
       RETURNING ${PUBLIC_COLUMNS}`,
      [parsed.data.mode, id.data, req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "device not found" });
    }
    res.json({ device: rows[0] });
  } catch (err) {
    next(err);
  }
});

// P3.1: chart ke liye ek device ki latest N readings.
devicesRouter.get("/:id/readings", async (req, res, next) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  const query = readingsQuery.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: "limit must be a whole number from 1 to 500" });
  }

  try {
    // 1) Kya ye device ISI user ka hai? Nahi to 404 (403 nahi) - doosre ka device
    //    "hai" ye bhi pata na chale. Iske bina "tumhara nahi" aur "tumhara hai par
    //    abhi reading nahi" dono khaali list dete - farq hi nahi dikhta.
    const owned = await pool.query(
      "SELECT 1 FROM devices WHERE id = $1 AND owner_id = $2",
      [id.data, req.user.id]
    );
    if (owned.rowCount === 0) {
      return res.status(404).json({ error: "device not found" });
    }

    // 2) Latest N. Index readings_device_ts_idx (device_id, ts DESC) isi ORDER BY ke
    //    liye bana hai. owner_id yahan dobara = defence in depth.
    const { rows } = await pool.query(
      // P5-f3: score bhi bhejo - chart attack wale points alag rang mein dikhayega (f4).
      // P7-f4a: action bhi ('allowed' | 'blocked' | null) - chart pe blocked point = ✕ (f4b).
      `SELECT id, ts, metrics, attack_proba, is_attack, action FROM readings
       WHERE device_id = $1 AND owner_id = $2
       ORDER BY ts DESC
       LIMIT $3`,
      [id.data, req.user.id, query.data.limit]
    );

    // DB ne naya -> purana diya (LIMIT ke liye zaroori). Chart purana -> naya chalta hai.
    rows.reverse();
    // ts pg se JS Date aata hai; res.json() usse toISOString() = UTC "...Z" banata hai.
    // IST mein badalna BROWSER ka kaam hai (P3.3). Yahan +5:30 jodna = bug.
    res.json({ readings: rows });
  } catch (err) {
    next(err);
  }
});

devicesRouter.delete("/:id", async (req, res, next) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM devices WHERE id = $1 AND owner_id = $2",
      [id.data, req.user.id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: "device not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
