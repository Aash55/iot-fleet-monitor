// api/src/server.js  -> ye f-step P5-f1 pe daalni hai (P6.2-f1: boot timeout 8000; P5-f1: loadModel)
import app from "./app.js";
import { redis } from "./redis.js";
import { errText } from "./errText.js";
import { startConsumer } from "./consumer.js";
import { loadModel } from "./model.js";

const required = ["DATABASE_URL", "JWT_SECRET", "CORS_ORIGIN", "REDIS_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("Missing env variables:", missing.join(", "));
  process.exit(1);
}

// P5-f1: model EK BAAR yahan, listen() se pehle. Kabhi throw nahi karta - fail ho to
// /status "model: unavailable" dikhata hai aur API baaki kaam karti rehti hai.
await loadModel();

// Fail fast: if Redis is down at boot, /ingest can only 500. Better to not start.
// connect() alone is NOT enough: node-redis retries a dead socket forever, so an
// un-raced connect() hangs the boot silently. Race it against a hard deadline.
// 8000, not 5000: node-redis has its own 5000 ms connect timeout. Ours must lose
// that race, so node-redis prints its real reason ("Connection timeout") first.
// Render free has no shell - these log lines are all we get.
const REDIS_BOOT_TIMEOUT_MS = 8000;
try {
  await Promise.race([
    redis.connect(),
    new Promise((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`timed out after ${REDIS_BOOT_TIMEOUT_MS}ms`)),
        REDIS_BOOT_TIMEOUT_MS
      )
    ),
  ]);
  console.log("Redis connected");
} catch (err) {
  console.error("Redis connect failed:", errText(err));
  // exit(1) also kills the retry timer that would otherwise hold the event loop open
  process.exit(1);
}

if (process.env.RUN_CONSUMER_IN_API === "true") {
  try {
    await startConsumer();
  } catch (err) {
    console.error("Consumer start failed:", errText(err));
    process.exit(1);
  }
}
const PORT = process.env.PORT || 4000;

// Express 5 passes listen errors (e.g. EADDRINUSE) to this callback instead of throwing
app.listen(PORT, (err) => {
  if (err) {
    console.error(`Server start failed on port ${PORT}:`, errText(err));
    process.exit(1);
  }
  console.log(`API running on http://localhost:${PORT}`);
});
