// api/scripts/extract.js   <-- ye f-step 2 pe api/scripts/ mein daalni hai
//
// Kaam: data/ ke CICIoT2023 CSV padho, 10 chune hue column nikalo, aur benign + attack
// ke do bucket mein N-N row SAMPLE karke ek chhoti JSON file likh do.
// CSV gigabytes ka hai, ye output kuchh sau KB ka. Simulator isi ko padhega.
//
// Chalane ka tareeka (Git Bash, api/ folder se):
//   npm run extract -- 2000

import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";

const PER_BUCKET = Number(process.argv[2] || 2000);
const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, "..", "..", "data");
const OUT = path.join(import.meta.dirname, "samples.local.json");

// Ye wahi 10 features hain jo lock hue. NORMALIZED naam - CSV ke naam nahi.
const FEATURES = [
  "flow_duration", "header_length", "protocol_type", "duration", "rate",
  "syn_count", "rst_count", "urg_count", "tot_size", "iat",
];
const LABEL = "label";

// CSV ke teeno convention ko ek shakal mein laata hai:
//   "Tot size" -> tot_size   |   "Header_Length" -> header_length   |   "IAT" -> iat
function normalize(header) {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

if (!Number.isInteger(PER_BUCKET) || PER_BUCKET < 100 || PER_BUCKET > 20000) {
  console.error(`Per-bucket count 100-20000 hona chahiye, mila: ${process.argv[2]}`);
  process.exit(1);
}

let files;
try {
  files = (await readdir(DATA_DIR)).filter((f) => f.toLowerCase().endsWith(".csv")).sort();
} catch {
  console.error(`data folder nahi mila: ${DATA_DIR}`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`${DATA_DIR} mein ek bhi .csv nahi hai`);
  process.exit(1);
}
console.log(`${files.length} CSV mile: ${files.join(", ")}`);

// ---- Reservoir sampling (Algorithm R) ----
// Poori file RAM mein nahi aa sakti, aur "pehli 2000 rows" le lena bhi galat hai -
// CSV attack-type ke hisaab se sorted ho sakta hai, to saara sample ek hi class ka aa jaata.
// Reservoir har row ko barabar mauka deta hai, ek hi pass mein, fixed memory mein.
function makeReservoir(k) {
  const items = [];
  let seen = 0;
  return {
    offer(row) {
      if (items.length < k) items.push(row);
      else {
        const j = Math.floor(Math.random() * (seen + 1));
        if (j < k) items[j] = row;
      }
      seen++;
    },
    get items() { return items; },
    get seen() { return seen; },
  };
}

const benign = makeReservoir(PER_BUCKET);
const attack = makeReservoir(PER_BUCKET);

let colIndex = null;   // normalized naam -> CSV ka column number
let totalRows = 0;
let skipped = 0;

for (const file of files) {
  const full = path.join(DATA_DIR, file);
  const rl = createInterface({ input: createReadStream(full), crlfDelay: Infinity });
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      if (colIndex) continue;   // pehli file ka header hi sabke liye kaafi hai

      const cols = line.split(",").map(normalize);
      colIndex = {};
      for (const want of [...FEATURES, LABEL]) {
        const at = cols.indexOf(want);
        if (at === -1) {
          console.error(`Column nahi mila: "${want}"`);
          console.error(`CSV mein ye the: ${cols.join(", ")}`);
          process.exit(1);
        }
        colIndex[want] = at;
      }
      console.log(`Header OK - saare ${FEATURES.length} feature + label mil gaye`);
      continue;
    }

    const cells = line.split(",");
    if (cells.length < 2) continue;   // khaali aakhri line
    totalRows++;

    const metrics = {};
    let bad = false;
    for (const f of FEATURES) {
      const raw = (cells[colIndex[f]] ?? "").trim();
      const n = Number(raw);
      // Teen alag khatre ek saath: khaali cell (Number("") = 0, chupchaap galat),
      // "inf"/"Infinity" (CICIoT2023 ke derived columns mein sach mein hote hain),
      // aur NaN. isFinite teeno pakad leta hai.
      if (raw === "" || !Number.isFinite(n)) { bad = true; break; }
      metrics[f] = n;
    }
    if (bad) { skipped++; continue; }

    const label = (cells[colIndex[LABEL]] ?? "").trim();
    if (!label) { skipped++; continue; }

    // label sample file mein rehta hai (simulator print karega, P4 sanity check karega)
    // par POST body mein KABHI nahi jaayega - asli device apna label nahi janta.
    const row = { metrics, label };
    if (label === "BenignTraffic") benign.offer(row);
    else attack.offer(row);
  }
  console.log(`  ${file} padh liya - ab tak ${totalRows.toLocaleString()} row`);
}

const payload = {
  source: "CICIoT2023",
  features: FEATURES,
  extracted_at: new Date().toISOString(),
  stats: {
    rows_read: totalRows,
    rows_skipped: skipped,
    benign_seen: benign.seen,
    attack_seen: attack.seen,
  },
  benign: benign.items,
  attack: attack.items,
};
await writeFile(OUT, JSON.stringify(payload) + "\n");

console.log("");
console.log(`rows read     : ${totalRows.toLocaleString()}`);
console.log(`rows skipped  : ${skipped.toLocaleString()}  (khaali / inf / NaN cell)`);
console.log(`benign sampled: ${benign.items.length} / ${benign.seen.toLocaleString()} dekhe`);
console.log(`attack sampled: ${attack.items.length} / ${attack.seen.toLocaleString()} dekhe`);

// Sabse zaroori check: attack bucket mein kitni alag class aayi.
// Sirf 1-2 class dikhi to sampling toot gayi hai aur P4 ka model ek hi hamla
// pehchan payega. Kai class dikhi = reservoir sahi kaam kar raha hai.
const spread = {};
for (const r of attack.items) spread[r.label] = (spread[r.label] || 0) + 1;
const classes = Object.entries(spread).sort((a, b) => b[1] - a[1]);
console.log(`\nattack classes : ${classes.length}`);
for (const [label, n] of classes.slice(0, 12)) console.log(`   ${label.padEnd(24)} ${n}`);
if (classes.length > 12) console.log(`   ... aur ${classes.length - 12} aur`);

console.log(`\n-> ${OUT}`);
