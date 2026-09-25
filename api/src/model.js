// api/src/model.js  -> ye f-step P9-c2 pe daalni hai (P5-f1: loadModel; P5-f2: predict; P7-f4a-fix: proba 0..1 clamp; P9-c2: thresholds model.json se)
//
// Kaam: API process start hote hi ml/model.onnx EK BAAR load karna, aur /status ko batana
// ki model "loaded" hai ya "unavailable". P5-f2 mein consumer yahi session har reading pe
// use karega - har reading pe dobara load karna MBs ki file ko baar-baar parse karna hota.
//
// Jaan-boojh ke "fail soft": model na mile to API band NAHI hoti. /ingest aur readings ka
// store hona ML pe nirbhar nahi hai - ML sirf upar ki ek parat (alerts) hai. Isliye model
// ka haal /status mein alag field hai, aur status 200/503 sirf DB + Redis se tay hota hai.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { errText } from "./errText.js";

// Local: api/src/ se do upar = repo root, phir ml/. Render pe ye tabhi dikhega jab service ka
// Root Directory repo root ho (Render docs: root dir ke bahar ki files build/runtime pe nahi milti).
const ML_DIR = process.env.ML_DIR || path.join(import.meta.dirname, "..", "..", "ml");

const state = {
  status: "not_loaded", // not_loaded -> loaded | unavailable
  session: null,
  ort: null, // onnxruntime-node module, P5-f2 mein Tensor banane ke kaam aayega
  meta: null, // model.json: features ka ORDER, input ka naam
};

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

export async function loadModel() {
  if (state.status === "loaded") return; // worker + API dono bulaayen to bhi ek hi baar
  const rssBefore = process.memoryUsage().rss;
  const t0 = performance.now();
  const onnxPath = path.join(ML_DIR, "model.onnx");

  try {
    // Dynamic import, static NAHI: native binary na mile to static import poora server
    // boot pe hi gira deta. Yahan wo error try/catch mein aata hai -> "unavailable".
    const ort = await import("onnxruntime-node");

    const meta = JSON.parse(await readFile(path.join(ML_DIR, "model.json"), "utf8"));
    const k = meta.features?.length;
    if (!k) throw new Error("model.json mein features khaali");
    // P9-c2: alert/block threshold model ke SAATH aate hain (val pe chune, train.py). Code mein
    // hardcode NAHI: naya model = naye scores = naye threshold. Galat/gayab = model load hi nahi
    // (-> "unavailable" -> IPS fail-open), aadha-adhoora faisla nahi.
    const t = meta.thresholds;
    const inRange = (v) => Number.isFinite(v) && v > 0 && v <= 1;
    if (!inRange(t?.alert) || !inRange(t?.block) || t.alert > t.block) {
      throw new Error(`model.json thresholds galat: ${JSON.stringify(t)} (0 < alert <= block <= 1 chahiye)`);
    }

    const { size } = await stat(onnxPath);
    const session = await ort.InferenceSession.create(onnxPath);
    if (!session.inputNames.includes(meta.input)) {
      throw new Error(`model input "${meta.input}" nahi mila, mile: ${session.inputNames}`);
    }

    // Warm-up: ek nakli row (saare 0) chala ke dekho. File load hona != model chalna.
    // Feature ginti galat ho to yahin error aata hai, pehli asli reading pe nahi.
    const out = await session.run({
      [meta.input]: new ort.Tensor("float32", new Float32Array(k), [1, k]),
    });
    if (out.probabilities?.data.length !== 2) {
      throw new Error("warm-up: probabilities mein 2 number nahi aaye");
    }

    Object.assign(state, { status: "loaded", session, ort, meta });
    const ms = performance.now() - t0;
    console.log(
      `Model loaded: ${k} features, ${(size / 1024).toFixed(0)} KB, ${ms.toFixed(0)} ms, ` +
        `rss ${mb(rssBefore)} -> ${mb(process.memoryUsage().rss)} MB, ` +
        `alert >= ${t.alert.toFixed(3)}, block >= ${t.block.toFixed(3)}`
    );
  } catch (err) {
    state.status = "unavailable";
    // Path saath mein chhapo: Render pe shell nahi hai, ye log line hi saboot hai.
    console.error(`Model load failed (ML_DIR ${ML_DIR}):`, errText(err));
  }
}

export function modelStatus() {
  return state.status;
}

// P9-c2: ingest.js (prevent mode) isse block ka faisla leta hai. Model load nahi = null.
export function blockThreshold() {
  return state.meta?.thresholds.block ?? null;
}

let warnedUnavailable = false;

// P5-f2: ek batch ki saari readings ek hi session.run mein (parity: 800 rows 4.8 ms).
// Input : metrics objects ki list, jaise [{ flow_duration: 1.2, rate: 30, ... }, ...]
// Output: HAR input ke liye { attack_proba, is_attack } ya null, same order mein.
// is_attack = attack_proba >= thresholds.alert (P9-c2; pehle ONNX label = 0.5 tha).
// null = "score nahi hua" (model nahi hai, ya koi feature gayab/number nahi). Reading phir
// bhi store hoti hai - prediction na hona reading ko rokne ki wajah nahi. Kabhi throw nahi.
export async function predict(metricsList) {
  const results = metricsList.map(() => null);
  if (state.status !== "loaded") {
    if (!warnedUnavailable) {
      console.error("Predict: model unavailable - readings bina score ke store hongi");
      warnedUnavailable = true;
    }
    return results;
  }

  const { features, input } = state.meta;
  const k = features.length;
  const idx = []; // kaunsi input rows score hongi (baaki null rahengi)
  const data = new Float32Array(metricsList.length * k);

  metricsList.forEach((m, i) => {
    // ORDER model.json se, metrics object ke keys ke order se NAHI. Galat order = model galat
    // column padhega aur koi error nahi aayega. Ek bhi feature gayab = 0 maan ke guess NAHI.
    const row = features.map((f) => m[f]);
    if (!row.every(Number.isFinite)) return;
    data.set(row, idx.length * k);
    idx.push(i);
  });
  if (idx.length === 0) return results;

  try {
    const out = await state.session.run({
      [input]: new state.ort.Tensor("float32", data.subarray(0, idx.length * k), [idx.length, k]),
    });
    const proba = out.probabilities.data; // har row ke 2: [benign, attack]
    idx.forEach((inputRow, j) => {
      // P7-f4a-fix: float32 mein trees ka average kabhi 1 se ZARA upar aata hai (1.0000001 =
      // float32 mein 1 ke baad agla number). Prod (Render Linux) pe yahi hua: consumer ka
      // "0..1" check blocked readings DROP kar raha tha. Source pe hi 0..1 mein daba do -
      // ingest (prevent) aur consumer (detect) dono ko saaf number mile, DB mein bhi.
      const p = Math.min(1, Math.max(0, proba[j * 2 + 1]));
      results[inputRow] = { attack_proba: p, is_attack: p >= state.meta.thresholds.alert };
    });
  } catch (err) {
    console.error(`Predict failed for ${idx.length} rows:`, errText(err));
  }
  return results;
}
