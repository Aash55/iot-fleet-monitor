// api/src/app.js  -> ye f-step P6.2-f4 pe daalni hai (f1: noStore + err.status; f4: cors maxAge)
import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { devicesRouter } from "./routes/devices.js";
import { requireAuth } from "./middleware/auth.js";
import { requireDevice } from "./middleware/deviceAuth.js";
import { ingestRouter } from "./routes/ingest.js";
import { redis } from "./redis.js";
import { errText } from "./errText.js";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN, maxAge: 600 }));
app.use(express.json());

// Private data (JWT, devices, readings) must never be written to the browser's disk
// cache or kept by any shared cache on the way. Runs BEFORE requireAuth so the 401
// reply carries it too.
function noStore(req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
}

app.get("/health", async (req, res) => {
  const [db, cache] = await Promise.all([
    pool.query("SELECT 1").then(() => "up").catch((err) => {
      console.error("Health check: DB unreachable ->", errText(err));
      return "down";
    }),
    redis.ping().then(() => "up").catch((err) => {
      console.error("Health check: Redis unreachable ->", errText(err));
      return "down";
    }),
  ]);

  const ok = db === "up" && cache === "up";
  res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", db, redis: cache });
});

// human-facing routes: JWT
app.use("/auth", noStore, authRouter);
app.use("/devices", noStore, requireAuth, devicesRouter);

app.get("/me", noStore, requireAuth, async (req, res, next) => {
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

app.use("/ingest", requireDevice, ingestRouter);

app.use((err, req, res, _next) => {
  // express.json() marks the client's mistakes with err.status: broken JSON = 400,
  // body over 100 kB = 413. Pass those through - they are not server bugs.
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: err.expose ? err.message : "bad request" });
  }
  console.error("Unhandled error:", errText(err));
  res.status(500).json({ error: "internal server error" });
});

export default app;
