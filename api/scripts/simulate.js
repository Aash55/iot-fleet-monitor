// api/scripts/simulate.js   <-- ye f-step 3.1 pe api/scripts/ mein daalni hai
//
// Kaam: sim device ban ke asli CICIoT2023 rows ko POST /ingest pe bhejna.
// Ye file DO hisson mein ban rahi hai:
//   f-step 3.1 (ABHI) -> config + file load + row chunna + --dry-run self-check
//   f-step 3.2 (agla) -> asli bhejne wala loop + Ctrl-C shutdown + stats
//
// Chalane ka tareeka (Git Bash, api/ folder se):
//   npm run simulate -- --dry-run

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import path from "node:path";

// ---------------- 1. Tuning constants ----------------
// Asli fleet mostly BENIGN hoti hai. samples file mein 2000 benign + 2000 attack
// hai (50/50), par 50/50 bhejne se dashboard hamesha laal rahega aur demo nakli
// lagega. Isliye default mein sirf 3% attack. --anomaly demo ke liye hai.
const ATTACK_RATIO_NORMAL = 0.03;
const ATTACK_RATIO_ANOMALY = 0.4;

const FLEET_FILE = path.join(import.meta.dirname, "fleet.local.json");
const SAMPLES_FILE = path.join(import.meta.dirname, "samples.local.json");

// ---------------- 2. CLI flags ----------------
let values;
try {
  ({ values } = parseArgs({
    options: {
      devices: { type: "string" },                    // default = fleet ke saare
      rate: { type: "string", default: "5" },         // har device ka gap, seconds
      count: { type: "string", default: "0" },        // 0 = hamesha chalta rahe
      url: { type: "string" },                        // default = fleet.base_url
      anomaly: { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,       // galat flag ya extra shabd -> yahin pakda jaayega
  }));
} catch (err) {
  console.error(`Flag galat hai: ${err.message}`);
  console.error("Sahi: npm run simulate -- [--devices 6] [--rate 5] [--count 0] [--anomaly] [--dry-run]");
  process.exit(1);
}

// Number wale flag string aate hain. Ek hi jagah check + convert.
function toInt(name, raw, min, max) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.error(`--${name} ${min} se ${max} ke beech poora number hona chahiye, mila: ${raw}`);
    process.exit(1);
  }
  return n;
}

const RATE_SEC = toInt("rate", values.rate, 1, 3600);
const COUNT = toInt("count", values.count, 0, 1000000);
const DRY_RUN = values["dry-run"];
const ATTACK_RATIO = values.anomaly ? ATTACK_RATIO_ANOMALY : ATTACK_RATIO_NORMAL;

// ---------------- 3. Local files load ----------------
async function loadLocalJson(file, hint) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(`File nahi mili: ${file}`);
      console.error(hint);
    } else {
      // permission / adhoora JSON jaisi ASLI dikkat ko "file nahi hai" mat samajhna
      console.error(`${file} padhne mein dikkat: ${err.message}`);
    }
    process.exit(1);
  }
}

const fleet = await loadLocalJson(FLEET_FILE, "Pehle chalao:  npm run provision -- 6");
const samples = await loadLocalJson(SAMPLES_FILE, "Pehle chalao:  npm run extract -- 2000");

if (!Array.isArray(fleet.devices) || fleet.devices.length === 0) {
  console.error("fleet.local.json mein ek bhi device nahi hai");
  process.exit(1);
}
for (const b of ["benign", "attack"]) {
  if (!Array.isArray(samples[b]) || samples[b].length === 0) {
    console.error(`samples.local.json ka "${b}" bucket khaali hai`);
    process.exit(1);
  }
}

const MAX_DEVICES = fleet.devices.length;
const DEVICE_COUNT =
  values.devices === undefined ? MAX_DEVICES : toInt("devices", values.devices, 1, MAX_DEVICES);
const DEVICES = fleet.devices.slice(0, DEVICE_COUNT);

// ---------------- 4. Base URL + remote guard ----------------
const BASE = String(values.url ?? fleet.base_url ?? "http://127.0.0.1:4000").replace(/\/+$/, "");

let host;
try {
  host = new URL(BASE).hostname;
} catch {
  console.error(`URL galat hai: ${BASE}`);
  process.exit(1);
}

const IS_LOCAL = host === "127.0.0.1" || host === "localhost" || host === "::1";
if (!IS_LOCAL && !values.remote) {
  const perDay = Math.round((DEVICE_COUNT * 86400) / RATE_SEC);
  console.error(`Ye local URL nahi hai: ${BASE}`);
  console.error(`Is rate pe ~${perDay.toLocaleString()} request/din jaayengi.`);
  console.error("Upstash free ka budget 10,000 request/din hai - wo ghanton mein khatam ho jaayega.");
  console.error("Sach mein deployed API pe bhejna hai? ->  --remote --rate 60 --count 50");
  process.exit(1);
}

// ---------------- 5. Row chunna aur body banana ----------------
// Weighted pick: Math.random() 0 se 1 ke beech deta hai. 0.03 se neeche girne ke
// 3% chance hain - yahi hamara attack ratio ban jaata hai.
function pickRow() {
  const isAttack = Math.random() < ATTACK_RATIO;
  const bucket = isAttack ? samples.attack : samples.benign;
  const row = bucket[Math.floor(Math.random() * bucket.length)];
  return { row, kind: isAttack ? "attack" : "benign" };
}

function buildBody(row) {
  // label JAAN-BOOJH KE nahi bhej rahe. Asli device apna label nahi janta, aur
  // bhej diya to P4 ka model jawab dekh ke "seekh" lega - poora scoring bekaar.
  // device_id/owner_id bhi nahi - wo API key se server khud nikalta hai.
  return { ts: new Date().toISOString(), metrics: row.metrics };
}

function maskKey(k) {
  return `${k.slice(0, 8)}...${k.slice(-4)}`;   // poori key kabhi console pe nahi
}

// ---------------- 6. Config print ----------------
console.log("--- simulator config ---");
console.log(`base url      : ${BASE}`);
console.log(`devices       : ${DEVICE_COUNT} / ${MAX_DEVICES}`);
console.log(`rate          : har device har ${RATE_SEC}s`);
console.log(`count         : ${COUNT === 0 ? "infinite (Ctrl-C se ruko)" : COUNT + " round"}`);
console.log(`anomaly mode  : ${values.anomaly ? "ON" : "off"}`);
console.log(`attack ratio  : ${(ATTACK_RATIO * 100).toFixed(0)}%`);
console.log(`samples       : ${samples.benign.length} benign + ${samples.attack.length} attack, ${samples.features.length} feature`);
for (const d of DEVICES) console.log(`  device ${d.id}  ${d.name}  ${maskKey(d.api_key)}`);

// ---------------- 7. --dry-run self-check ----------------
if (DRY_RUN) {
  const N = 1000;
  let attacks = 0;
  for (let i = 0; i < N; i++) if (pickRow().kind === "attack") attacks++;
  console.log(`\n${N} draw   : ${attacks} attack (${((attacks / N) * 100).toFixed(1)}%), target ${(ATTACK_RATIO * 100).toFixed(0)}%`);

  const sample = pickRow();
  const body = buildBody(sample.row);
  console.log(`example row : label = ${sample.row.label}   <- sirf console pe, body mein NAHI`);
  console.log("POST /ingest body jo jaayegi:");
  console.log(JSON.stringify(body, null, 2));

  const keys = Object.keys(body.metrics);
  const problems = [];
  if ("label" in body) problems.push("body mein label aa gaya");
  if (keys.includes("label")) problems.push("metrics mein label aa gaya");
  if (keys.length !== samples.features.length) problems.push(`${samples.features.length} feature chahiye the, mile ${keys.length}`);
  if (!keys.every((k) => Number.isFinite(body.metrics[k]))) problems.push("koi metric number nahi hai");
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(body.ts)) problems.push("ts ISO-8601 nahi hai");

  if (problems.length === 0) {
    console.log("\nSELF-CHECK PASS: label chhupa hua hai, 10 feature hain, sab number hain, ts sahi hai");
    process.exit(0);
  }
  console.error("\nSELF-CHECK FAIL:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("\nBhejne wala loop f-step 3.2 mein aayega. Abhi ke liye:  npm run simulate -- --dry-run");
