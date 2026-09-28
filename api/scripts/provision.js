// Creates N simulator devices and writes their API keys to a gitignored file.
// Usage (Git Bash, from the api/ folder):
//   npm run provision -- 6                                  -> local API, scripts/fleet.local.json
//   node --env-file=.env.provision.local scripts/provision.js 3 --fleet fleet.prod.local.json
import { access, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DEFAULT_FLEET, fleetPath } from "./fleetFile.js";

const BASE = process.env.PROVISION_API_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
const EMAIL = process.env.PROVISION_EMAIL;
const PASSWORD = process.env.PROVISION_PASSWORD;

let values, positionals, OUT;
try {
  ({ values, positionals } = parseArgs({
    options: {
      force: { type: "boolean", default: false },
      fleet: { type: "string", default: DEFAULT_FLEET },
    },
    allowPositionals: true, // device count: "6"
    strict: true,           // unknown flag -> caught right here
  }));
  if (positionals.length > 1) throw new Error(`expected only one number, got: ${positionals.join(" ")}`);
  OUT = fleetPath(values.fleet);
} catch (err) {
  console.error(`Invalid flag: ${err.message}`);
  console.error("Usage: npm run provision -- [6] [--fleet fleet.local.json] [--force]");
  process.exit(1);
}
const COUNT = Number(positionals[0] ?? 6);
const FORCE = values.force;

if (!EMAIL || !PASSWORD) {
  console.error("Missing env variables: PROVISION_EMAIL, PROVISION_PASSWORD");
  process.exit(1);
}
if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 50) {
  console.error(`Device count must be 1-50, got: ${positionals[0]}`);
  process.exit(1);
}

// GUARD: this file is OVERWRITTEN on every run. If it already exists and you run this again,
// the old keys stored in it are lost FOREVER - the devices stay in the DB but their keys can
// never be recovered (there is no key rotation endpoint).
try {
  await access(OUT);
  if (!FORCE) {
    console.error(`Already exists: ${OUT}`);
    console.error("Running again would lose the API keys stored in it FOREVER.");
    console.error(`Really want a new fleet? ->  provision ${COUNT} --fleet ${values.fleet} --force`);
    process.exit(1);
  }
  console.log(`--force: the old ${values.fleet} will be overwritten`);
} catch (err) {
  if (err.code !== "ENOENT") throw err;   // file missing = normal, any other error is real
}

async function post(pathname, body, token) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${pathname} -> ${res.status} ${text}`);
  return JSON.parse(text);
}

// Show the target FIRST (local or Render), so devices created in the wrong place get noticed.
console.log(`API: ${BASE}   fleet file: ${OUT}`);

const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");

const { token } = await post("/auth/login", { email: EMAIL, password: PASSWORD });
console.log(`Logged in as ${EMAIL}`);

const devices = [];
for (let i = 1; i <= COUNT; i++) {
  const name = `sim-${stamp}-${String(i).padStart(2, "0")}`;
  const { device, api_key } = await post("/devices", { name }, token);
  // device.id stays a string: it is a Postgres BIGINT. Never convert it with Number().
  devices.push({ id: device.id, name: device.name, api_key });
  console.log(`  ${i}/${COUNT}  id=${device.id}  ${device.name}`);
}

const payload = { base_url: BASE, created_at: new Date().toISOString(), devices };
await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
console.log(`Wrote ${devices.length} device keys -> ${OUT}`);
console.log("This file is gitignored. The repo is PUBLIC - never commit it.");
