import { Router } from "express";
import { z } from "zod";
import { redis, TELEMETRY_STREAM, STREAM_MAXLEN } from "../redis.js";

export const ingestRouter = Router();

const readingInput = z.object({
  // Device clock, ISO-8601. Optional: if the device does not send one we stamp it.
  ts: z.iso.datetime({ offset: true }).optional(),
  metrics: z
    .record(z.string().trim().min(1).max(64), z.number())
    .refine((m) => Object.keys(m).length >= 1, { message: "at least 1 metric required" })
    .refine((m) => Object.keys(m).length <= 50, { message: "at most 50 metrics allowed" }),
});

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

  try {
    const streamId = await redis.xAdd(TELEMETRY_STREAM, "*", entry, {
      TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STREAM_MAXLEN },
    });
    // 202, not 201: nothing is stored in Postgres yet. The consumer does that in step 2.
    res.status(202).json({ accepted: true, stream_id: streamId });
  } catch (err) {
    next(err);
  }
});
