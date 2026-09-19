import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { devicesRouter } from "./routes/devices.js";
import { requireAuth } from "./middleware/auth.js";
import { requireDevice } from "./middleware/deviceAuth.js";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "up" });
  } catch (err) {
    console.error("Health check: DB unreachable ->", err.message || err.code);
    res.status(503).json({ status: "degraded", db: "down" });
  }
});

// human-facing routes: JWT
app.use("/auth", authRouter);
app.use("/devices", requireAuth, devicesRouter);

app.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, email, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "user not found" });
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
});

// machine-facing routes: device API key. /ingest joins this group in P2.
app.get("/device/whoami", requireDevice, (req, res) => {
  res.json({ device: req.device });
});

app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err.message || err.code);
  res.status(500).json({ error: "internal server error" });
});

export default app;
