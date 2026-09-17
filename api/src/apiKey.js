import crypto from "node:crypto";

// 32 random bytes = 256 bits of entropy. Prefix helps secret scanners spot a leak.
export function generateApiKey() {
  return "dev_" + crypto.randomBytes(32).toString("hex");
}

// Deterministic (no salt) so we can look the device up by hash on an index.
export function hashApiKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}
