// api/src/app.js  -> ye f-step P5-f1 pe daalni hai (P6.3-f2C: /status alias; P5-f1: model field)
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
import { modelStatus } from "./model.js";

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

async function health(req, res) {
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

  // model 200/503 tay NAHI karta: ML na chale tab bhi readings store hoti hain. Aur Render
  // /health pe 503 dekhe to naya deploy live hi nahi karta - ML ki galti poori API rok deti.
  const ok = db === "up" && cache === "up";
  res
    .status(ok ? 200 : 503)
    .json({ status: ok ? "ok" : "degraded", db, redis: cache, model: modelStatus() });
}

// Same check, two names. /health stays for Render's Health Check Path.
// The web app calls /status: EasyPrivacy has "||onrender.com/health", so Brave
// Shields (and uBlock) block /health when it is fetched from another site.
app.get("/health", health);
app.get("/status", health);

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
