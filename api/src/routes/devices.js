import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { generateApiKey, hashApiKey } from "../apiKey.js";

export const devicesRouter = Router();

const deviceInput = z.object({ name: z.string().trim().min(1).max(100) });
const idParam = z.coerce.number().int().positive();

const PUBLIC_COLUMNS = "id, name, status, last_seen, created_at";

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
