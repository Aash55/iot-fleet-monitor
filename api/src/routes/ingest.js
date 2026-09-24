// api/src/routes/ingest.js  -> ye f-step P7-f2 pe daalni hai (P2: XADD; P7-f2: prevent mode = IPS faisla)
import { Router } from "express";
import { z } from "zod";
import { redis, TELEMETRY_STREAM, STREAM_MAXLEN } from "../redis.js";
import { predict, modelStatus } from "../model.js";

export const ingestRouter = Router();

// P7-f2: block tabhi jab model kam se kam 90% pakka ho. 0.5 ya 0.70 kyun NAHI (P7-f0 table):
// 0.70 pe FP 0 tha, par ek FP 0.6-0.7 ke beech tha - bilkul kinare pe. Aur threshold usi test set
// pe chuna tha, to numbers optimistic hain. 0.90 = margin; keemat: 800 mein sirf 1 aur attack miss.
// 0.5-0.9 = model "attack" kehta hai (is_attack = true, dashboard pe alert), par block NAHI:
// galat block = sahi device ka data kho gaya.
export const BLOCK_THRESHOLD = 0.9;

const readingInput = z.object({
  // Device clock, ISO-8601. Optional: if the device does not send one we stamp it.
  ts: z.iso.datetime({ offset: true }).optional(),
  metrics: z
    .record(z.string().trim().min(1).max(64), z.number())
    .refine((m) => Object.keys(m).length >= 1, { message: "at least 1 metric required" })
    .refine((m) => Object.keys(m).length <= 50, { message: "at most 50 metrics allowed" }),
});

let warnedFailOpen = false;

// P7-f2: prevent mode ka faisla. API = decision point (PDP): sirf BATATI hai "allow" ya "block".
// Asli rokna gateway/simulator (PEP) karta hai - wo f3 mein. Kabhi throw nahi karta.
async function decide(metrics) {
  const t0 = performance.now();
  const [pred] = await predict([metrics]); // 1 row, request ke andar hi (sync faisla)
  const ms = performance.now() - t0;

  if (pred) {
    return {
      action: pred.attack_proba >= BLOCK_THRESHOLD ? "block" : "allow",
      reason: "score",
      pred,
      ms,
    };
  }

  // Score nahi mila. Do alag wajah, do alag faisle:
  if (modelStatus() !== "loaded") {
    // 1) Model hi nahi hai = HAMARI galti. FAIL-OPEN: allow. IoT telemetry ka ruk jaana
    //    (availability) zyada bura hai. Ulta (fail-closed) README mein trade-off ke saath.
    if (!warnedFailOpen) {
      console.error("IPS fail-open: model unavailable - prevent mode devices allowed without score");
      warnedFailOpen = true;
    }
    return { action: "allow", reason: "model_unavailable", pred: null, ms };
  }
  // 2) Model hai, par reading mein koi feature gayab / number nahi = DEVICE ki taraf se.
  //    Yahan allow karte to attacker ek feature hata ke har baar bach nikalta (evasion).
  //    Isliye BLOCK. (Detect mode mein aisi reading pehle jaisi bina score store hoti hai.)
  return { action: "block", reason: "missing_features", pred: null, ms };
}

ingestRouter.post("/", async (req, res, next) => {
  const parsed = readingInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: z.flattenError(parsed.error).fieldErrors });
  }

  // Never trust the device for identity: req.device comes from the API-key lookup.
  const entry = {
    device_id: String(req.device.id),
    owner_id: String(req.device.owner_id),
    ts: parsed.data.ts ?? new Date().toISOString(),
    received_at: new Date().toISOString(),
    metrics: JSON.stringify(parsed.data.metrics),
  };

  // Detect mode (IDS) = bilkul pehle jaisa: yahan score NAHI, consumer baad mein lagata hai.
  // Isliye detect mode ki latency nahi badhti. Jawab mein action "allow" - gateway ke liye
  // ek hi shape: har jawab mein action hota hai.
  const body = { accepted: true, mode: req.device.mode, action: "allow" };

  if (req.device.mode === "prevent") {
    const d = await decide(parsed.data.metrics);
    body.action = d.action;
    body.reason = d.reason;
    body.attack_proba = d.pred?.attack_proba ?? null;
    // Postman -> Headers tab mein dikhta hai: predict ne kitne ms liye.
    res.set("Server-Timing", `predict;dur=${d.ms.toFixed(2)}`);

    // Score + faisla stream mein bhi -> consumer DOBARA score nahi karta (same model, same
    // input = same number; dobara = sirf CPU barbaad). Stream fields sirf string hote hain.
    if (d.pred) {
      entry.attack_proba = String(d.pred.attack_proba);
      entry.is_attack = String(d.pred.is_attack);
    }
    // DB mein past tense: 'blocked'/'allowed' = "ye hua tha". Jawab mein "block" = hukm.
    entry.action = d.action === "block" ? "blocked" : "allowed";
  }

  try {
    // Blocked reading bhi STORE hoti hai (audit): baad mein dikhana padega ki kya roka aur kyun.
    // "Rokna" matlab gateway use aage (asli system tak) nahi bhejta - hamare DB se chhupana nahi.
    const streamId = await redis.xAdd(TELEMETRY_STREAM, "*", entry, {
      TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STREAM_MAXLEN },
    });
    // 202 block pe bhi: request sahi thi aur record ho gayi. Block = body ka `action`, HTTP
    // error nahi. (4xx dete to simulator/gateway use "request fail" samajhta.)
    res.status(202).json({ ...body, stream_id: streamId });
  } catch (err) {
    next(err);
  }
});
