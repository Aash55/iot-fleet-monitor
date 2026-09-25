// api/scripts/simulate.js   <-- ye f-step P9-d pe daalni hai (P1 3.1/3.2: simulator; P6.3-f3: --fleet flag; P7-f3: gateway/PEP; P9-d: samples ab ml/demo.py se)
//
// Kaam: sim device ban ke asli CICIoT2023 rows ko POST /ingest pe bhejna.
//   f-step 3.1 -> config + file load + row chunna + --dry-run self-check
//   f-step 3.2 -> asli bhejne wala loop + Ctrl-C shutdown + summary   (section 8-10)
//   P7-f3     -> simulator = GATEWAY (PEP). API (PDP) jawab mein `action` batati hai;
//                "block" pe yahan BLOCKED chhapta hai aur reading ko "roka" ginta hai.
//
// Chalane ka tareeka (Git Bash, api/ folder se):
//   npm run simulate -- --count 5          -> har device 5 POST, phir khud band
//   node scripts/simulate.js               -> hamesha chalta rahe, Ctrl-C se band
//   npm run simulate -- --fleet fleet.prod.local.json --remote --count 10   -> Render wali fleet
//   Ctrl-C wala run SEEDHA node se. npm beech mein ho to wo Ctrl-C ko child pe aage bhejta hai,
//   aur Windows pe ye 'aage bhejna' zabardasti kill hai - summary kat sakti hai.

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { DEFAULT_FLEET, fleetPath } from "./fleetFile.js";

// ---------------- 1. Tuning constants ----------------
// Asli fleet mostly BENIGN hoti hai. samples file (ml/demo.py, P9-d) mein ~10k benign +
// ~9k attack hai, par aadha-aadha bhejne se dashboard hamesha laal rahega aur demo nakli
// lagega. Isliye default mein sirf 3% attack. --anomaly demo ke liye hai.
const ATTACK_RATIO_NORMAL = 0.03;
const ATTACK_RATIO_ANOMALY = 0.4;

// API atak jaaye (jawab hi na de) to ek POST max itna rukega, phir FAIL gina jaayega.
const REQUEST_TIMEOUT_MS = 5000;

const SAMPLES_FILE = path.join(import.meta.dirname, "samples.local.json");

// ---------------- 2. CLI flags ----------------
let values, FLEET_FILE;
try {
  ({ values } = parseArgs({
    options: {
      devices: { type: "string" },                    // default = fleet ke saare
      rate: { type: "string", default: "5" },         // har device ka gap, seconds
      count: { type: "string", default: "0" },        // 0 = hamesha chalta rahe
      url: { type: "string" },                        // default = fleet.base_url
      fleet: { type: "string", default: DEFAULT_FLEET }, // scripts/ ke andar, *.local.json
      anomaly: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,       // galat flag ya extra shabd -> yahin pakda jaayega
  }));
  FLEET_FILE = fleetPath(values.fleet);
} catch (err) {
  console.error(`Flag galat hai: ${err.message}`);
  console.error("Sahi: npm run simulate -- [--fleet fleet.local.json] [--devices 6] [--rate 5] [--count 0] [--anomaly] [--dry-run]");
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

const fleet = await loadLocalJson(FLEET_FILE, `Pehle chalao:  provision ... --fleet ${values.fleet}`);
const samples = await loadLocalJson(SAMPLES_FILE, "Pehle chalao (ml/ folder se):  uv run python demo.py");

if (!Array.isArray(fleet.devices) || fleet.devices.length === 0) {
  console.error(`${values.fleet} mein ek bhi device nahi hai`);
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
  // Har 202 = kam se kam 2 Upstash command (API ka XADD + consumer ka XACK).
  // Upstash free (docs, 23 Sept 2026): 500K command / MAHINA (~16K/din) - consumer ki
  // idle polling (BLOCK 5000 = ~12 XREADGROUP/min jab Render jaga ho) bhi isi mein se.
  console.error(`Is rate pe ~${perDay.toLocaleString()} POST/din = ~${(perDay * 2).toLocaleString()}+ Upstash command/din.`);
  console.error("Upstash free: 500K command/mahina (~16K/din) - ye budget kuch hi din mein khatam.");
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
console.log(`fleet file    : ${values.fleet}`);
console.log(`base url      : ${BASE}`);
console.log(`devices       : ${DEVICE_COUNT} / ${MAX_DEVICES}`);
console.log(`rate          : har device har ${RATE_SEC}s`);
console.log(`count         : ${COUNT === 0 ? "infinite (Ctrl-C se ruko)" : COUNT + " round"}`);
console.log(`anomaly mode  : ${values.anomaly ? "ON" : "off"}`);
console.log(`quiet mode    : ${values.quiet ? "ON" : "off"}`);
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
    console.log(`\nSELF-CHECK PASS: label chhupa hua hai, ${samples.features.length} feature hain, sab number hain, ts sahi hai`);
    process.exit(0);
  }
  console.error("\nSELF-CHECK FAIL:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// ---------------- 8. Ek POST (f-step 3.2) ----------------
const stop = new AbortController();   // Ctrl-C -> stop.abort() -> saari neend turant tootti hai
const stats = {
  ok: 0, fail: 0, benign: 0, attack: 0, totalMs: 0, reasons: {},
  // P7-f3 gateway ginti. `prevent` = kitne jawab prevent-mode device ke aaye.
  allowed: 0, blocked: 0, blockReasons: {}, prevent: 0, noAction: 0,
  // Sirf prevent-mode jawab: simulator row ka label JAANTA hai (API nahi), to yahan
  // naap sakte hain ki gateway ne sahi roka ya galat. Detect mode kabhi rokta hi nahi.
  prevAttack: 0, prevAttackBlocked: 0, prevBenign: 0, prevBenignBlocked: 0,
};

function bump(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

function clock() {
  return new Date().toTimeString().slice(0, 8);   // "11:42:05" - tera local time, sirf insaan ke liye
}

// attack_proba null ho sakta hai (missing_features / model_unavailable) -> "p=-"
function fmtP(p) {
  return typeof p === "number" ? `p=${p.toFixed(2)}` : "p=-";
}

function failed(device, reason) {
  stats.fail++;
  stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
  console.log(`${clock()}  ${device.name}  FAIL    ${reason}`);
}

async function sendOne(device) {
  const { row, kind } = pickRow();
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": device.api_key },
      body: JSON.stringify(buildBody(row)),
      // SIRF timeout wala signal. Ctrl-C wala `stop.signal` yahan JAAN-BOOJH KE nahi:
      // jo POST nikal chuka hai use poora hone do, beech mein kaatna nahi.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.status !== 202) return failed(device, `HTTP ${res.status} ${text.slice(0, 80)}`);

    const reply = JSON.parse(text);   // { accepted, mode, action, reason?, attack_proba?, stream_id }
    const ms = Date.now() - t0;
    stats.ok++;
    stats[kind]++;
    stats.totalMs += ms;
    const tag = kind === "attack" ? "ATTACK" : "benign";

    // `action` hi nahi aaya = API f2 se purani hai (deploy nahi hua). Chupchaap "allow" maan
    // lena galat hoga - ek baar zor se batao, phir gino.
    if (reply.action !== "allow" && reply.action !== "block") {
      if (stats.noAction++ === 0) {
        console.log(`${clock()}  ${device.name}  WARN    jawab mein action nahi - API purani (P7-f2 se pehle)?`);
      }
    }
    if (reply.mode === "prevent") {
      stats.prevent++;
      bump(stats, kind === "attack" ? "prevAttack" : "prevBenign");
    }

    // ---- PEP: faisla API ka, AMAL yahan ----
    if (reply.action === "block") {
      stats.blocked++;
      bump(stats.blockReasons, reply.reason ?? "?");
      if (reply.mode === "prevent") bump(stats, kind === "attack" ? "prevAttackBlocked" : "prevBenignBlocked");
      // BLOCKED line quiet mode mein bhi: rokna hamesha dikhna chahiye.
      console.log(
        `${clock()}  ${device.name}  BLOCKED ${row.label.padEnd(24)} ${reply.reason} ${fmtP(reply.attack_proba)}  ${ms}ms`
      );
      return;   // "roka" = asli gateway yahan reading aage (asli system ko) NAHI bhejta
    }

    stats.allowed++;
    // prevent mode mein score bhi dikhao (0.5-0.9 = alert hai par block nahi)
    const why = reply.mode === "prevent" ? `allow ${fmtP(reply.attack_proba)}` : "allow";
    if (kind === "attack" || !values.quiet) {
      console.log(`${clock()}  ${device.name}  ${tag}  ${row.label.padEnd(24)} 202  ${why}  ${ms}ms`);
    }
  } catch (err) {
    // API band  -> TypeError "fetch failed", asli wajah err.cause.code = ECONNREFUSED
    // API atki  -> err.name = TimeoutError
    failed(device, err.cause?.code || err.name || "network error");
  }
}

// ---------------- 9. Har device ka apna loop ----------------
// true = poora so liya, false = Ctrl-C ne neend tod di
async function pause(ms) {
  try {
    await sleep(ms, undefined, { signal: stop.signal });
    return true;
  } catch (err) {
    if (err.name === "AbortError") return false;
    throw err;
  }
}

async function runDevice(device) {
  // Pehla POST 0 se RATE_SEC ke beech kabhi bhi, taaki saare device ek hi pal pe na bhejein.
  if (!(await pause(Math.random() * RATE_SEC * 1000))) return;

  for (let round = 1; COUNT === 0 || round <= COUNT; round++) {
    if (stop.signal.aborted) return;
    await sendOne(device);                        // pehle ye POST KHATAM...
    if (round === COUNT) return;                  // (aakhri round ke baad sona bekaar)
    if (!(await pause(RATE_SEC * 1000))) return;  // ...PHIR agle ka intezaar. setInterval nahi.
  }
}

// ---------------- 10. Ctrl-C + summary ----------------
process.on("SIGINT", () => {
  // Ek hi Ctrl-C ki doosri copy aa sakti hai (npm bhi child ko aage bhejta hai). Doosri copy ignore.
  if (stop.signal.aborted) return;
  console.log(`\nCtrl-C mila: naye POST band. Chal rahe POST ko max ${REQUEST_TIMEOUT_MS / 1000}s...`);
  stop.abort();
  // Safety net: kuch atak bhi jaaye to tay waqt pe band. unref() = ye timer khud process ko
  // zinda nahi rakhta - sab theek raha to process isse pehle hi nikal jaayega.
  setTimeout(() => {
    console.error("Shutdown atak gaya - zabardasti band");
    process.exit(1);
  }, REQUEST_TIMEOUT_MS + 2000).unref();
});

const startedAt = Date.now();
console.log(`\nChalu: ${DEVICE_COUNT} device -> ${BASE}/ingest` + (COUNT === 0 ? "   (Ctrl-C se band)" : ""));
await Promise.all(DEVICES.map(runDevice));

const sent = stats.ok + stats.fail;
console.log("\n--- summary ---");
console.log(`bheje       : ${sent}   (202 ok: ${stats.ok}, fail: ${stats.fail})`);
console.log(`mix         : ${stats.benign} benign, ${stats.attack} attack`);
console.log(`avg latency : ${stats.ok ? Math.round(stats.totalMs / stats.ok) + " ms" : "-"}`);
for (const [reason, n] of Object.entries(stats.reasons)) console.log(`fail reason : ${reason}  x${n}`);
// P7-f3: gateway ka hisaab
console.log(`gateway     : ${stats.allowed} aage gaye (allow), ${stats.blocked} roke (block)`);
for (const [reason, n] of Object.entries(stats.blockReasons)) console.log(`block reason: ${reason}  x${n}`);
if (stats.prevent) {
  console.log(`prevent     : attack ${stats.prevAttack} mein se ${stats.prevAttackBlocked} roke, ` +
    `${stats.prevAttack - stats.prevAttackBlocked} nikal gaye   (0.5-0.9 = alert, block nahi)`);
  console.log(`galat block : benign ${stats.prevBenign} mein se ${stats.prevBenignBlocked} roke   (ye 0 hona chahiye)`);
} else if (stats.ok > stats.noAction) {
  // (purani API mode batati hi nahi - tab "sab detect" kehna jhooth hota, isliye ye shart)
  console.log("prevent     : koi device prevent mode mein nahi - sab detect, kuch roka nahi");
}
if (stats.noAction) console.log(`WARN        : ${stats.noAction} jawab bina action ke - API purani hai?`);
console.log(`chala       : ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
if (stats.ok) console.log(`DB check    : consumer chal raha hai to readings theek +${stats.ok} badhni chahiye`);

// exit code: 0 = sab 202, 1 = kuch fail. process.exit() nahi - process khud saaf nikalta hai.
process.exitCode = stats.fail > 0 ? 1 : 0;
