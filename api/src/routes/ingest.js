import { Router } from "express";
import { z } from "zod";
import { redis, TELEMETRY_STREAM, STREAM_MAXLEN } from "../redis.js";
import { predict, modelStatus, blockThreshold } from "../model.js";

export const ingestRouter = Router();

// The block threshold now comes from model.json (train.py picked it on VALIDATION data: FPR on
// benign <= 0.1%). It used to be a hardcoded 0.9 chosen on the TEST set - that was leakage.
// Between the alert threshold (FPR <= 0.5%) and block = the model says "attack" (is_attack, alert
// on the dashboard), but NO block: a wrong block loses a healthy device's data, so the block bar
// is stricter.

const readingInput = z.object({
  // Device clock, ISO-8601. Optional: if the device does not send one we stamp it.
  ts: z.iso.datetime({ offset: true }).optional(),
  metrics: z
    .record(z.string().trim().min(1).max(64), z.number())
    .refine((m) => Object.keys(m).length >= 1, { message: "at least 1 metric required" })
    .refine((m) => Object.keys(m).length <= 50, { message: "at most 50 metrics allowed" }),
});

let warnedFailOpen = false;

// The prevent-mode decision. The API is the decision point (PDP): it only SAYS "allow" or "block".
// The actual blocking is done by the gateway/simulator (PEP). Never throws.
async function decide(metrics) {
  const t0 = performance.now();
  const [pred] = await predict([metrics]); // 1 row, inside the request (synchronous decision)
  const ms = performance.now() - t0;

  if (pred) {
    return {
      action: pred.attack_proba >= blockThreshold() ? "block" : "allow",
      reason: "score",
      pred,
      ms,
    };
  }

  // No score. Two different causes, two different decisions:
  if (modelStatus() !== "loaded") {
    // 1) No model at all = OUR fault. FAIL-OPEN: allow. Stopping IoT telemetry (losing
    //    availability) is worse. The opposite (fail-closed) is in the README with the trade-off.
    if (!warnedFailOpen) {
      console.error("IPS fail-open: model unavailable - prevent mode devices allowed without score");
      warnedFailOpen = true;
    }
    return { action: "allow", reason: "model_unavailable", pred: null, ms };
  }
  // 2) The model is there, but the reading has a missing / non-numeric feature = the DEVICE's
  //    side. Allowing it would let an attacker escape every time by dropping one feature
  //    (evasion). So BLOCK. (In detect mode such a reading is still stored without a score.)
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

  // Detect mode (IDS): NO scoring here, the consumer adds the score later. So detect-mode
  // latency does not grow. The reply still has action "allow" - one shape for the gateway:
  // every reply carries an action.
  const body = { accepted: true, mode: req.device.mode, action: "allow" };

  if (req.device.mode === "prevent") {
    const d = await decide(parsed.data.metrics);
    body.action = d.action;
    body.reason = d.reason;
    body.attack_proba = d.pred?.attack_proba ?? null;
    // Shows in Postman's Headers tab: how many ms predict took.
    res.set("Server-Timing", `predict;dur=${d.ms.toFixed(2)}`);

    // Score + decision go into the stream too -> the consumer does NOT score again (same model,
    // same input = same number; redoing it only wastes CPU). Stream fields are strings only.
    if (d.pred) {
      entry.attack_proba = String(d.pred.attack_proba);
      entry.is_attack = String(d.pred.is_attack);
    }
    // Past tense in the DB: 'blocked'/'allowed' = "this happened". "block" in the reply = a command.
    entry.action = d.action === "block" ? "blocked" : "allowed";
  }

  try {
    // Blocked readings are STORED too (audit): later we must be able to show what was blocked
    // and why. "Block" means the gateway does not forward it (to the real system) - not hiding
    // it from our DB.
    const streamId = await redis.xAdd(TELEMETRY_STREAM, "*", entry, {
      TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STREAM_MAXLEN },
    });
    // 202 even on block: the request was valid and got recorded. Block = the body's `action`,
    // not an HTTP error. (A 4xx would make the simulator/gateway treat it as a failed request.)
    res.status(202).json({ ...body, stream_id: streamId });
  } catch (err) {
    next(err);
  }
});
