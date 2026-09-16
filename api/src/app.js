import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();

app.use(cors());
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

app.use("/auth", authRouter);

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

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message || err.code);
  res.status(500).json({ error: "internal server error" });
});

export default app;
