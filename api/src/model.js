// api/src/model.js  -> ye f-step P5-f1 pe daalni hai (NAYI file)
//
// Kaam: API process start hote hi ml/model.onnx EK BAAR load karna, aur /status ko batana
// ki model "loaded" hai ya "unavailable". P5-f2 mein consumer yahi session har reading pe
// use karega - har reading pe dobara load karna 357 KB file ko baar-baar parse karna hota.
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
        `rss ${mb(rssBefore)} -> ${mb(process.memoryUsage().rss)} MB`
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
