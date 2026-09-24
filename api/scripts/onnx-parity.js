// api/scripts/onnx-parity.js   <-- ye P4 f-step 4 pe api/scripts/ mein daalni hai
//
// Kaam: Node (onnxruntime-node) mein ml/model.onnx chala ke dekhna ki sklearn jaisa hi jawab
// aata hai. Test rows + sklearn ki probability ml/parity.local.json mein hain (train.py banata hai,
// git mein nahi). P5 ka consumer yahi raasta lega: features ka order model.json se, float32 tensor.
//
// Chalana (Git Bash, api/ folder se):   npm run parity

import { readFile } from "node:fs/promises";
import path from "node:path";
import * as ort from "onnxruntime-node";

const ML_DIR = process.env.ML_DIR || path.join(import.meta.dirname, "..", "..", "ml");
const TOLERANCE = 1e-5; // float32 ka jod + parity file ki 6-decimal rounding dono is se kaafi chhote

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(ML_DIR, name), "utf8"));
  } catch (err) {
    fail(`${name} nahi padh paaya (${err.code || err.message}) - ml/ se pehle: uv run python train.py`);
  }
}

const meta = await readJson("model.json");
const parity = await readJson("parity.local.json");

// Order galat = model galat column padhega, aur koi error nahi aayega. Isliye sabse pehle yahi.
if (JSON.stringify(meta.features) !== JSON.stringify(parity.features)) {
  fail(`features ka order alag: model.json ${meta.features} vs parity ${parity.features}`);
}
const n = parity.rows.length;
const k = meta.features.length;
if (n === 0) fail("parity mein 0 row - khaali check PASS nahi hota");
if (parity.proba_attack.length !== n) fail("rows aur proba_attack ki ginti alag");
if (parity.rows.some((r) => r.length !== k)) fail(`har row mein ${k} number chahiye`);

// [row0 ke 9, row1 ke 9, ...] ek lambi float32 line -> shape [n, k] batata hai kahan kaatna hai
const data = new Float32Array(n * k);
parity.rows.forEach((row, i) => data.set(row, i * k));

const session = await ort.InferenceSession.create(path.join(ML_DIR, "model.onnx"));
console.log(`model  : inputs [${session.inputNames}]  outputs [${session.outputNames}]`);
console.log(`rows   : ${n} x ${k} features (${meta.features.join(", ")})`);

const t0 = performance.now();
const out = await session.run({ [meta.input]: new ort.Tensor("float32", data, [n, k]) });
const ms = performance.now() - t0;

const proba = out.probabilities.data; // Float32Array, har row ke 2 number: [benign, attack]
const label = out.label.data; // BigInt64Array (int64) -> Number() se milao

let maxDiff = 0;
let mismatch = 0;
let ties = 0;
for (let i = 0; i < n; i++) {
  const expected = parity.proba_attack[i];
  maxDiff = Math.max(maxDiff, Math.abs(proba[i * 2 + 1] - expected));
  if (expected === 0.5) ties++; // sklearn tie pe pehli class (0) chunta hai
  const expectedLabel = expected > 0.5 ? 1 : 0;
  if (Number(label[i]) !== expectedLabel) mismatch++;
}

console.log(`parity : max |proba diff| ${maxDiff.toExponential(2)}   label mismatch ${mismatch}   50-50 ties ${ties}`);
console.log(`time   : ${ms.toFixed(1)} ms for ${n} rows (${((ms / n) * 1000).toFixed(1)} us/row)`);

if (maxDiff < TOLERANCE && mismatch <= ties) {
  console.log("\nSELF-CHECK PASS: Node ka ONNX jawab sklearn se har row pe match");
} else {
  fail("Node aur sklearn alag jawab de rahe");
}
