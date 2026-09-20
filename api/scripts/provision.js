// api/scripts/provision.js  -> ye f-step 1 pe daalni hai
// N simulator device banata hai aur unki API key ek gitignored file mein likh deta hai.
// Chalane ka tareeka (Git Bash, api/ folder se):   npm run provision -- 6
import { access, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.PROVISION_API_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
const EMAIL = process.env.PROVISION_EMAIL;
const PASSWORD = process.env.PROVISION_PASSWORD;
const COUNT = Number(process.argv[2] || 6);
const FORCE = process.argv.includes("--force");
const OUT = path.join(import.meta.dirname, "fleet.local.json");

if (!EMAIL || !PASSWORD) {
  console.error("Missing env variables: PROVISION_EMAIL, PROVISION_PASSWORD");
  process.exit(1);
}
if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 50) {
  console.error(`Device count 1-50 hona chahiye, mila: ${process.argv[2]}`);
  process.exit(1);
}

// GUARD: ye file har run pe OVERWRITE hoti hai. Agar pehle se hai aur tu dobara chala
// deta hai, to usme rakhi purani keys HAMESHA ke liye chali jaati hain - device DB mein
// reh jaate hain par unki key kabhi wapas nahi milti (rotation endpoint nahi hai).
try {
  await access(OUT);
  if (!FORCE) {
    console.error(`Pehle se maujood: ${OUT}`);
    console.error("Dobara chalane se usme rakhi API keys HAMESHA ke liye chali jaayengi.");
    console.error("Sach mein nayi fleet chahiye? ->  npm run provision -- 6 --force");
    process.exit(1);
  }
  console.log("--force: purani fleet.local.json overwrite ho jaayegi");
} catch (err) {
  if (err.code !== "ENOENT") throw err;   // file nahi hai = normal, baaki error asli hai
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

const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");

const { token } = await post("/auth/login", { email: EMAIL, password: PASSWORD });
console.log(`Logged in as ${EMAIL}`);

const devices = [];
for (let i = 1; i <= COUNT; i++) {
  const name = `sim-${stamp}-${String(i).padStart(2, "0")}`;
  const { device, api_key } = await post("/devices", { name }, token);
  // device.id string hi rehta hai: Postgres BIGINT. Number() kabhi mat karna.
  devices.push({ id: device.id, name: device.name, api_key });
  console.log(`  ${i}/${COUNT}  id=${device.id}  ${device.name}`);
}

const payload = { base_url: BASE, created_at: new Date().toISOString(), devices };
await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
console.log(`Wrote ${devices.length} device keys -> ${OUT}`);
console.log("Ye file gitignored hai. Repo PUBLIC hai - kabhi commit mat karna.");
