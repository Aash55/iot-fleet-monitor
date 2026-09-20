import { createClient } from "redis";
import { errText } from "./errText.js";

export const TELEMETRY_STREAM = "telemetry";

// Ring-buffer cap: with `~` Redis trims to *about* this many entries, cheaply.
export const STREAM_MAXLEN = Number(process.env.STREAM_MAXLEN || 100000);

export const redis = createClient({ url: process.env.REDIS_URL });

// Without this listener a dropped connection becomes an unhandled 'error'
// event and Node kills the process. With it, node-redis reconnects quietly.
redis.on("error", (err) => {
  console.error("Redis client error:", errText(err));
});
