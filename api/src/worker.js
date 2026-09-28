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

// Locally the consumer is a separate process (RUN_CONSUMER_IN_API=false), so it needs the
// model too. On Render the consumer runs inside the API, and server.js loads it there.
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
