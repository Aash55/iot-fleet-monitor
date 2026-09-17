import { pool } from "../db.js";
import { hashApiKey } from "../apiKey.js";

export async function requireDevice(req, res, next) {
  const apiKey = req.get("x-api-key");
  if (!apiKey) {
    return res.status(401).json({ error: "missing x-api-key header" });
  }

  try {
    const { rows } = await pool.query(
      "SELECT id, owner_id, name FROM devices WHERE api_key_hash = $1",
      [hashApiKey(apiKey)]
    );
    if (!rows[0]) {
      return res.status(401).json({ error: "invalid api key" });
    }
    req.device = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}
