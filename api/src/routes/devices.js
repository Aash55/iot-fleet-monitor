import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { generateApiKey, hashApiKey } from "../apiKey.js";

export const devicesRouter = Router();

const deviceInput = z.object({ name: z.string().trim().min(1).max(100) });
const idParam = z.coerce.number().int().positive();

// Body of PATCH /devices/:id. Only these 2 words - anything else is a 400.
// The DB's CHECK (devices_mode_check) rejects the same thing; zod catches it first so the
// user gets a clean 400, not a 500. Any other body field (e.g. name) is silently stripped by zod.
const modeInput = z.object({ mode: z.enum(["detect", "prevent"]) });

// ?limit=N. Everything in a query string arrives as TEXT ("50"), hence coerce.
// Empty ?limit= -> Number("") = 0 -> caught by min(1). Not sent -> 100.
const readingsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// Status is NOT stored. It is DERIVED from last_seen on every request, so it can
// never be stale. last_seen NULL (no data ever arrived) -> comparison is NULL ->
// ELSE -> 'offline'.
const STATUS_SQL = `CASE WHEN last_seen > now() - interval '2 minutes'
       THEN 'online' ELSE 'offline' END AS status`;

// "alert" = how many readings the model called an attack in the last 15 min. No separate
// alerts table (no acknowledge/resolve state in the MVP) - counted straight from readings.
// Uses received_at (the API's clock), NOT ts (the device's clock): a device clock can be wrong
// or spoofed; last_seen is also built from received_at. A NULL score (unscored) is not an attack.
// `devices.id` in the subquery is the outer devices row - so every query must use FROM devices.
const ALERT_WINDOW = "15 minutes";
const RECENT_ATTACKS_SQL = `(SELECT count(*)::int FROM readings r
       WHERE r.device_id = devices.id AND r.is_attack
         AND r.received_at > now() - interval '${ALERT_WINDOW}') AS recent_attacks`;

// The "N blocked · 15 min" badge. Same as recent_attacks: same 15 min, same received_at.
// Why two separate counts: recent_attacks = the model CALLED it an attack (detect + prevent);
// recent_blocked = the gateway was told to BLOCK it (prevent only). A reading between the
// alert and block thresholds counts in the first but not the second. action NULL (detect /
// older rows) -> not 'blocked' -> not counted.
const RECENT_BLOCKED_SQL = `(SELECT count(*)::int FROM readings r
       WHERE r.device_id = devices.id AND r.action = 'blocked'
         AND r.received_at > now() - interval '${ALERT_WINDOW}') AS recent_blocked`;

// mode is returned everywhere (list, single device, POST, PATCH) - the web toggle relies on it.
const PUBLIC_COLUMNS = `id, name, mode, ${STATUS_SQL}, last_seen, created_at, ${RECENT_ATTACKS_SQL}, ${RECENT_BLOCKED_SQL}`;

// Name uniqueness is enforced by a DB constraint, not by code.
// This constraint name is the same in schema.sql and in the migration.
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
    // 23505 = unique_violation. Check the constraint name too: api_key_hash is also
    // UNIQUE - a clash there is not "name taken", it is a real server error (500).
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

// Change a device's mode (detect <-> prevent). PATCH = change ONE part of a record
// (PUT = replace the whole record). Own devices only: WHERE owner_id. Someone else's device =
// 404, not 403 - don't even reveal that the device exists (same as GET /:id).
devicesRouter.patch("/:id", async (req, res, next) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  // With no body (Content-Type not JSON), Express 5 sets req.body = undefined ->
  // zod fails -> 400. So no separate check is needed.
  const parsed = modeInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { mode: ['mode must be "detect" or "prevent"'] } });
  }

  try {
    // One query: update AND get the new device back. SELECT then UPDATE = 2 round trips,
    // and if someone changes it in between the reply is stale. RETURNING gives the updated row.
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

// Latest N readings of one device, for the chart.
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
    // 1) Does this device belong to THIS user? If not, 404 (not 403) - don't even reveal
    //    that someone else's device exists. Without this check, "not yours" and "yours but
    //    no readings yet" would both return an empty list - indistinguishable.
    const owned = await pool.query(
      "SELECT 1 FROM devices WHERE id = $1 AND owner_id = $2",
      [id.data, req.user.id]
    );
    if (owned.rowCount === 0) {
      return res.status(404).json({ error: "device not found" });
    }

    // 2) Latest N. Index readings_device_ts_idx (device_id, ts DESC) exists for exactly
    //    this ORDER BY. Repeating owner_id here = defence in depth.
    const { rows } = await pool.query(
      // Send the score too - the chart draws attack points in a different colour.
      // And action ('allowed' | 'blocked' | null) - a blocked point is drawn as ✕ on the chart.
      `SELECT id, ts, metrics, attack_proba, is_attack, action FROM readings
       WHERE device_id = $1 AND owner_id = $2
       ORDER BY ts DESC
       LIMIT $3`,
      [id.data, req.user.id, query.data.limit]
    );

    // The DB returned newest -> oldest (needed for LIMIT). The chart runs oldest -> newest.
    rows.reverse();
    // ts comes from pg as a JS Date; res.json() turns it into toISOString() = UTC "...Z".
    // Converting to IST is the BROWSER's job. Adding +5:30 here = bug.
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
