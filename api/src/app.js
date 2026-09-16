import express from "express";
import cors from "cors";
import { pool } from "./db.js";

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

export default app;