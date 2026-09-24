// api/src/worker.js  -> ye f-step P5-f2 pe daalni hai (P5-f2: loadModel)
import { startConsumer, stopConsumer } from "./consumer.js";
import { pool } from "./db.js";
import { errText } from "./errText.js";
import { loadModel } from "./model.js";

const required = ["DATABASE_URL", "REDIS_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("Missing env variables:", missing.join(", "));
  process.exit(1);
}

// Local pe consumer alag process hai (RUN_CONSUMER_IN_API=false) - use bhi model chahiye.
// Render pe consumer API ke andar chalta hai, wahan server.js load karta hai.
await loadModel();

try {
  await startConsumer();
} catch (err) {
  console.error("Consumer start failed:", errText(err));
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`${signal} received, draining...`);
    await stopConsumer();
    // without this the pg pool's idle sockets keep the event loop alive
    await pool.end().catch(() => {});
    process.exit(0);
  });
}
