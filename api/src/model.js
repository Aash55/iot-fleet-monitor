//
// Job: load ml/model.onnx ONCE when the process starts, and tell /status whether the
// model is "loaded" or "unavailable". The consumer reuses this one session for every
// reading - reloading per reading would mean parsing a multi-MB file over and over.
//
// Deliberately "fail soft": if the model is missing, the API does NOT stop. /ingest and
// storing readings do not depend on ML - ML is only a layer on top (alerts). So the model's
// state is a separate field in /status, and the 200/503 status comes only from DB + Redis.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { errText } from "./errText.js";

// Local: two levels up from api/src/ = repo root, then ml/. On Render this is only visible if
// the service's Root Directory is the repo root (Render docs: files outside the root dir are
// not available at build/runtime).
const ML_DIR = process.env.ML_DIR || path.join(import.meta.dirname, "..", "..", "ml");

const state = {
  status: "not_loaded", // not_loaded -> loaded | unavailable
  session: null,
  ort: null, // onnxruntime-node module, used to build input Tensors in predict()
  meta: null, // model.json: feature ORDER, input name
};

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

export async function loadModel() {
  if (state.status === "loaded") return; // only once, even if both worker and API call it
  const rssBefore = process.memoryUsage().rss;
  const t0 = performance.now();
  const onnxPath = path.join(ML_DIR, "model.onnx");

  try {
    // Dynamic import, NOT static: if the native binary is missing, a static import would
    // crash the whole server at boot. Here that error lands in try/catch -> "unavailable".
    const ort = await import("onnxruntime-node");

    const meta = JSON.parse(await readFile(path.join(ML_DIR, "model.json"), "utf8"));
    const k = meta.features?.length;
    if (!k) throw new Error("model.json has an empty features list");
    // The alert/block thresholds ship WITH the model (picked on the validation set, train.py).
    // NOT hardcoded: new model = new scores = new thresholds. Invalid/missing = the model does
    // not load at all (-> "unavailable" -> IPS fails open), rather than half-working decisions.
    const t = meta.thresholds;
    const inRange = (v) => Number.isFinite(v) && v > 0 && v <= 1;
    if (!inRange(t?.alert) || !inRange(t?.block) || t.alert > t.block) {
      throw new Error(`model.json thresholds invalid: ${JSON.stringify(t)} (need 0 < alert <= block <= 1)`);
    }

    const { size } = await stat(onnxPath);
    const session = await ort.InferenceSession.create(onnxPath);
    if (!session.inputNames.includes(meta.input)) {
      throw new Error(`model input "${meta.input}" not found, found: ${session.inputNames}`);
    }

    // Warm-up: run one dummy row (all zeros). Loading the file != the model actually running.
    // A wrong feature count fails here, not on the first real reading.
    const out = await session.run({
      [meta.input]: new ort.Tensor("float32", new Float32Array(k), [1, k]),
    });
    if (out.probabilities?.data.length !== 2) {
      throw new Error("warm-up: probabilities did not contain 2 numbers");
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
    // Print the path too: Render has no shell, so this log line is the only evidence.
    console.error(`Model load failed (ML_DIR ${ML_DIR}):`, errText(err));
  }
}

export function modelStatus() {
  return state.status;
}

// ingest.js (prevent mode) uses this to decide whether to block. Model not loaded = null.
export function blockThreshold() {
  return state.meta?.thresholds.block ?? null;
}

let warnedUnavailable = false;

// All readings of a batch in a single session.run (parity check: 800 rows in 4.8 ms).
// Input : a list of metrics objects, e.g. [{ flow_duration: 1.2, rate: 30, ... }, ...]
// Output: for EACH input, { attack_proba, is_attack } or null, in the same order.
// is_attack = attack_proba >= thresholds.alert (previously the ONNX label, i.e. 0.5).
// null = "not scored" (no model, or a feature is missing/not a number). The reading is still
// stored - a missing prediction is no reason to block a reading. Never throws.
export async function predict(metricsList) {
  const results = metricsList.map(() => null);
  if (state.status !== "loaded") {
    if (!warnedUnavailable) {
      console.error("Predict: model unavailable - readings will be stored without a score");
      warnedUnavailable = true;
    }
    return results;
  }

  const { features, input } = state.meta;
  const k = features.length;
  const idx = []; // which input rows get scored (the rest stay null)
  const data = new Float32Array(metricsList.length * k);

  metricsList.forEach((m, i) => {
    // ORDER comes from model.json, NOT from the metrics object's key order. Wrong order = the
    // model reads the wrong columns with no error. Any feature missing = do NOT guess it as 0.
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
    const proba = out.probabilities.data; // 2 per row: [benign, attack]
    idx.forEach((inputRow, j) => {
      // In float32 the average over the trees sometimes lands JUST above 1 (1.0000001 = the
      // next float32 after 1). That happened in prod (Render Linux): the consumer's "0..1"
      // check was DROPPING blocked readings. Clamp to 0..1 at the source, so both ingest
      // (prevent) and the consumer (detect) get a clean number, and so does the DB.
      const p = Math.min(1, Math.max(0, proba[j * 2 + 1]));
      results[inputRow] = { attack_proba: p, is_attack: p >= state.meta.thresholds.alert };
    });
  } catch (err) {
    console.error(`Predict failed for ${idx.length} rows:`, errText(err));
  }
  return results;
}
