// api/src/middleware/deviceAuth.js  -> ye f-step P7-f2 pe daalni hai (P7-f2: mode bhi padho)
import { pool } from "../db.js";
import { hashApiKey } from "../apiKey.js";

export async function requireDevice(req, res, next) {
  const apiKey = req.get("x-api-key");
  if (!apiKey) {
    return res.status(401).json({ error: "missing x-api-key header" });
  }

  try {
    const { rows } = await pool.query(
      // P7-f2: mode bhi - /ingest isi se tay karta hai ki wahin score + faisla karna hai ya nahi.
      // Isi ek query mein, alag query nahi: har reading pe ek aur DB chakkar bachta hai.
      "SELECT id, owner_id, name, mode FROM devices WHERE api_key_hash = $1",
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
