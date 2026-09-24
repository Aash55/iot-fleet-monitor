<!-- README.md -> ye f-step P7-f5 pe daalni hai (P6.4: diagram + screenshots + cold start; P5-f5: ML section; P7-f5: IPS mode) -->
# IoT Fleet Monitor

Devices send telemetry over HTTP. The API accepts it fast, queues it in a Redis stream,
and a consumer scores every reading with an intrusion-detection model (Random Forest,
exported to ONNX) and writes it to Postgres. A React dashboard shows each device's status,
a live chart, and the readings the model flagged as attacks. A device can also run in
**prevent** mode (IPS): the API scores the reading before it replies and tells the gateway to
block it. Built solo, deployed on free tiers.

- **Live app:** https://iot-fleet-monitor.vercel.app
- **API health:** https://iot-fleet-monitor-api.onrender.com/status
- **Note:** the API is on Render's free plan and sleeps after 15 minutes without traffic.
  The first request wakes it (see [Cold start](#cold-start-measured-not-guessed)).

## Screenshots

Device page: status badge and the live chart (refreshes every 5 seconds).

![Device page with status and live chart](docs/screenshots/device-chart.png)

Attack alerts: the red badge counts readings the model flagged in the last 15 minutes, and
red dots on the chart mark them (local run with the simulator in `--anomaly` mode).

![Device page with the attack badge and red attack dots](docs/screenshots/attack-chart.png)

Cold start: the API was asleep, so the `/status` request had to wait (see its Time column)
before the header could say "API ok, database ok".

![Cold start: the /status request in DevTools and the header after the API woke up](docs/screenshots/cold-start.png)

Prevent mode (production, device 4): the black badge counts readings blocked in the last
15 minutes, and each blocked reading is a ✕ on the chart. Both blocked readings were also
attacks, so they show as ✕ instead of red dots.

![Device page in prevent mode with the blocked badge and blocked markers](docs/screenshots/ips-blocked.png)

## Architecture

```mermaid
flowchart TD
    D["Device / simulator<br/>POST /ingest + x-api-key"] --> API
    B["Browser<br/>React app on Vercel"] -- "JWT: /auth, /devices, /status" --> API
    API["Express API on Render"] -- "XADD telemetry" --> R[("Upstash Redis<br/>stream: telemetry")]
    R -- "XREADGROUP telemetry-writers" --> C["Consumer<br/>same Render process"]
    C -- "score batch (in-process)" --> M["ONNX model<br/>onnxruntime-node"]
    C -- "XACK after insert" --> R
    C -- "INSERT ... ON CONFLICT (stream_id) DO NOTHING" --> P[("Neon Postgres")]
    API -- "SELECT devices, readings" --> P
```

1. A device sends `POST /ingest` with its API key. The API checks the key, validates the body
   (zod), adds the reading to the Redis stream and replies **202 Accepted**. 202, not 201:
   nothing is in Postgres yet. In prevent mode the API also scores the reading first and puts
   its decision in the reply (see [IPS mode](#ips-mode-detect-or-prevent)).
2. The consumer reads the stream as part of a consumer group, scores the whole batch with
   the model in one call, inserts readings and scores together into Postgres, and only then
   acknowledges (`XACK`) the batch.
3. The dashboard reads devices, readings and attack counts from Postgres through the API and
   refreshes every 5 seconds.

## Tech stack

| Part | Choice |
|---|---|
| API | Node 24, Express 5, zod, argon2, jsonwebtoken, node-redis, pg |
| Queue | Redis Streams + consumer group (Upstash in prod, Memurai locally) |
| Database | PostgreSQL (Neon in prod, Postgres 15 locally) |
| Web | React 19, Vite 8, React Router, TanStack Query, Recharts, Tailwind 4 |
| ML | Python 3.14 (uv), pandas, scikit-learn (Random Forest), skl2onnx; onnxruntime-node in the API |
| Hosting | Render (API), Vercel (web), all free tiers |
| Tests | `node:test` (built in) for web, Postman / newman collections for the deployed stack |

## Design decisions (and why)

**At-least-once delivery, made safe by a UNIQUE key.** Redis can deliver the same stream
entry twice (for example after a crash before `XACK`). `readings.stream_id` is `UNIQUE`, and
the insert uses `ON CONFLICT (stream_id) DO NOTHING`, so a redelivery is a no-op.
*Limit:* this only protects against Redis redelivery. If a device times out and retries, the
first request may already have arrived, and the retry gets a **new** stream id. That creates a
duplicate. A timeout does not mean "not delivered". Fix planned: an idempotency key on `/ingest`.

**Online/offline is computed, not stored.** A stored `status` column went stale. Now
`GET /devices` derives it on every request: online if `last_seen` is within 2 minutes.

**`/status` as well as `/health`.** The EasyPrivacy filter list blocks
`||onrender.com/health`, so Brave Shields and uBlock blocked the dashboard's health check.
The web app calls `/status` (same handler). `/health` stays for Render's health check.
Filter lists change, so this is a workaround, not a guarantee.

**The header says "ok" only for our JSON.** Vercel rewrites every unknown path to
`index.html` with status **200**. So "HTTP 200" alone can be a lie. `getHealth()` reports
"API ok" only when the reply is JSON with `status: "ok"`, and it does not crash on broken JSON.
Five unit tests cover this (`web/tests/getHealth.test.js`).

**The build fails without a valid `VITE_API_URL`.** Vite bakes this value into the JavaScript
at build time. Missing, it would silently become `undefined`, so `vite.config.js` stops the build.

## ML: intrusion detection

**Data.** CICIoT2023 from the Canadian Institute for Cybersecurity, University of New Brunswick
(Neto et al., *Sensors* 23(13):5941, 2023, https://doi.org/10.3390/s23135941). The model is
**binary**: benign vs attack (all 33 attack types in one class). I sampled 4,000 rows
(2,000 benign, 2,000 attack) and split them 80/20, stratified: 3,200 to train, 800 held out.

**The leak I found first.** With one feature, `iat`, the model scored F1 **0.991**. That was too
good. The values showed why: benign `iat` is 0 or about 166.5 million, attacks sit near
83 million, and each attack type has its own narrow band (DoS-TCP 82.93-82.96M, Mirai
83.68-83.79M). The number records *which capture session* a row came from, not packet
timing, so the model was learning the recording setup. I removed `iat`
(`ml/leak_check.py` shows the evidence). Worth noting: `iat` was **not** in the top 3 of the
feature importances, so low importance does not prove a feature is innocent. Correlated
features share importance. The test is to train with the feature alone and without it.

**Model and results.** Random Forest, 100 trees, 9 features (`ml/model.json` has the list and
order). On the 800 held-out rows (400 benign, 400 attack):

| | Predicted attack | Predicted benign |
|---|---|---|
| **Actual attack** | 387 (TP) | 13 (FN) |
| **Actual benign** | 2 (FP) | 398 (TN) |

Precision 0.995, recall 0.968, F1 **0.981**, false-positive rate 0.005.

**Why that precision will not hold in a real fleet.** The test set is 50% attacks. A fleet is
mostly benign. At the simulator's 3% attack rate, the same recall and false-positive rate give
precision of about **0.86**. And that FPR comes from only 2 mistakes in 400 benign rows, so
its 95% range (Clopper-Pearson) puts precision anywhere from **0.63 to 0.98**. More benign test
data is needed before trusting the number.

`class_weight="balanced"` is set, but on 50/50 data both weights come out as 1.00, so it does
not fix any imbalance here.

**Serving: ONNX inside the Node API.** `ml/train.py` exports the model to ONNX, and the
consumer runs it with `onnxruntime-node` in the same process. On all 800 test rows the Node
output matches scikit-learn: max probability difference 1.1e-7, zero label mismatches
(`npm run parity`), about 6 microseconds per row. On Render's free instance the model loads in
under a second at startup and the process uses about 127 MB of the 512 MB limit.
Rejected: a separate Python service (a second free service to host and wake up, plus a network
hop per batch).

**Failure behaviour.** If the model cannot load, the API still starts, `/status` reports
`"model": "unavailable"`, and readings are stored with a `NULL` score. A missing or
non-numeric feature also gives `NULL`, never a guess with 0. The dashboard shows a red dot only
for a real `is_attack = true`.

**Alerts.** `GET /devices` returns `recent_attacks`: flagged readings in the last 15 minutes,
counted by `received_at` (the API's clock, not the device's). There is no separate alerts
table, because an alert has no state of its own yet (no acknowledge or resolve).

**Caveat about the live demo.** The simulator replays rows from the same 4,000-row sample,
and 80% of those rows were training data. So a red dot in the demo shows that the pipeline
works end to end. It is **not** evidence of accuracy. The accuracy evidence is the held-out
table above.

## IPS mode: detect or prevent

Every device has a `mode`: `detect` (the default) or `prevent`. It is changed with
`PATCH /devices/:id` or the Detect | Prevent toggle on the device page.

- **Detect (IDS):** nothing changes. `/ingest` replies 202 at once and the consumer scores the
  reading later. The model only raises alerts.
- **Prevent (IPS):** `/ingest` scores the reading inside the request, before it replies, and the
  202 body carries `action: "block"` or `"allow"`, a `reason` and the `attack_proba`.

**Who decides and who blocks.** The API is the decision point (PDP): it only says allow or
block. Stopping the traffic is the job of the gateway in front of the device, the enforcement
point (PEP). Here the simulator plays the gateway: it prints `BLOCKED` and counts the reading as
not forwarded. The API still stores a blocked reading, with `readings.action = 'blocked'`, as an
audit record of what was stopped and why. The reply is 202 even for a block. The request was
valid and was recorded, and the decision is in the body, so a client does not mistake a block
for a failed request.

**Two thresholds: 0.5 to alert, 0.9 to block.** Same 800 held-out rows and the same exported
ONNX model as above (`ml/threshold_check.py`):

| Block if score ≥ | TP | FN | FP | TN | Recall | FPR |
|---|---|---|---|---|---|---|
| 0.50 | 387 | 13 | 2 | 398 | 0.9675 | 0.0050 |
| 0.60 | 387 | 13 | 1 | 399 | 0.9675 | 0.0025 |
| 0.70 | 386 | 14 | 0 | 400 | 0.9650 | 0 |
| 0.80 | 386 | 14 | 0 | 400 | 0.9650 | 0 |
| **0.90** | **385** | **15** | **0** | **400** | **0.9625** | **0** |
| 0.95 | 380 | 20 | 0 | 400 | 0.9500 | 0 |
| 0.99 | 364 | 36 | 0 | 400 | 0.9100 | 0 |

A wrong alert is a stray red dot. A wrong block drops a real device's data, so blocking needs
a higher bar. 0.70 is the first row with no false positives, but one benign row sits between
0.6 and 0.7, right at that edge. The threshold was also picked on the same 800 rows it is
measured on, so these numbers are optimistic. 0.90 adds margin, and the cost is one more
missed attack than at 0.70 (385 vs 386 caught). "0 FP" is also not "never": with 0 mistakes in
400 benign rows, the rule of three puts the real false-positive rate as high as about 0.0075
(95%). A proper fix is to choose the threshold on a separate validation split.

**Fail open or fail closed, depending on whose fault it is.**
- The model did not load (our fault): **allow**, with `reason: "model_unavailable"`, logged
  once. Telemetry keeps flowing. The cost: during a model outage, prevent mode protects nothing.
- The model is loaded but the reading is missing a feature (the device's input): **block**,
  with `reason: "missing_features"`. Allowing it would let an attacker skip scoring by dropping
  one field.

**What it cannot stop.**
- At 0.5, the model missed all 4 `MITM-ArpSpoofing` rows in the test set, and the single test
  row of each of `Recon-OSScan`, `DNS_Spoofing` and `DoS-HTTP_Flood`. Spoofing and scanning
  look like normal traffic in these 9 flow features. The counts are tiny (1 to 4 rows per type),
  so this is a pattern to check, not a measured rate.
- No IP blocklist. CICIoT2023's features do not include the attacker's IP, so the system blocks
  a reading (a flow), not a source.
- Each reading is scored on its own. There is no memory of a device's recent behaviour.

**Latency.** Prevent replies carry a `Server-Timing: predict;dur=...` header, so the model's
share of each request is visible in DevTools or Postman. In a Linux test environment (not on
Render) scoring one row took about 0.15 ms (p50), and `/ingest` took about 2.5 ms (p50) in
both modes. From my laptop a prevent request took about 220 ms, but requests that never reach
the model (`missing_features`) took just as long, so that time is not the model.

**A production bug this found.** Blocked readings were missing from the production database,
while the API kept replying `block`. The consumer's log said `attack_proba not in 0..1`. The
log did not print the value, but the evidence points to a score just above 1: in float32 the
next number after 1 is 1.0000001, which fails that check yet shows as `p=1.00` in the
simulator (it rounds to 2 decimals). It happened on Render (Linux) and not in my local runs on
Windows. Fix: clamp the score to 0..1 where the model runs, keep the strict check in the
consumer, and print the bad value in the log. After the fix, blocked rows reached the
production database. Lesson: check a deploy in the database, not in the API reply.

## Security notes

- **XSS:** React escapes text by default, and the code has no `dangerouslySetInnerHTML`.
  Device names (user input) are rendered as text.
- **Known trade-off:** the JWT is kept in `localStorage`, so any XSS on the site could read it.
  Mitigations today: tokens expire after 2 hours, and the app re-checks the token with `/me`
  on load. Not done yet: a Content-Security-Policy header, or httpOnly cookies.
- Passwords are hashed with argon2id. Device API keys are random 256-bit values; only their
  SHA-256 hash is stored.
- Private API replies send `Cache-Control: no-store`. CORS allows only the Vercel origin.
- Secrets live in git-ignored `.env*.local` files and in the Render/Vercel dashboards.

## Cold start (measured, not guessed)

Render's docs say a sleeping free service can take **up to about a minute** to wake up.
I measured it **twice** on 24 Sept 2026 in the browser DevTools (Brave): `/status` took
**22.9 s** and **34.3 s** cold, and **0.48 s** warm. In the first run the Timing tab showed
almost all of it as "waiting for server response", which includes Neon waking up. The second
run is in the screenshot above. Two samples only, so treat them as examples, not a constant.

**Why no uptime pinger:** keeping Render awake would keep the consumer polling Redis all
month. The consumer blocks for 5 s per read, so it makes about 12 Redis calls per minute while
awake: 12 x 60 x 24 x 30 = 518,400 calls a month. Upstash's free tier is 500,000 commands
a month. A pinger alone would use up the budget.

## Run it locally

Needs Node 24, PostgreSQL and a Redis-compatible server on `127.0.0.1:6379`.

1. Create a database and run `api/db/schema.sql` on it.
2. `cd api`, copy `.env.example` to `.env`, fill in your values, then `npm ci` and `npm run dev`
   (API on port 4000). Start the consumer with `npm run consumer`, or set
   `RUN_CONSUMER_IN_API=true`.
3. `cd web`, then `npm ci` and `npm run dev` (web on port 5173, reads `web/.env.development`).
4. The web app has login only. Create a user first with `POST /auth/register`
   (JSON body `email`, `password`), for example from Postman. Then log in and add a device.
   `npm run provision` and `npm run simulate` (in `api/`) create devices and send readings.

## How to run tests

Web unit tests use Node's built-in test runner (`node:test`), so there is no extra test
package. Five cases check `getHealth()` (the header text) against a fake local server, so no
network and no running API are needed: the real JSON "ok" reply, an HTML page with status 200,
JSON without `status: "ok"`, broken JSON, and a 503. Two more check that only
`is_attack === true` becomes a red dot on the chart. One checks that only
`action === 'blocked'` becomes a ✕, and two check `setDeviceMode()`: it sends a `PATCH` with the
token and `{ mode }`, and a 404 or 401 throws an `ApiError` carrying the status.

From the repo root, after `npm ci` in `web/`:

```bash
cd web
npm test
```

Expected: `pass 10` and `fail 0`.

The model has two checks of its own. Both need the sample file `api/scripts/samples.local.json`,
which `npm run extract` (in `api/`) builds from the CICIoT2023 CSVs in `data/`. Neither is in the
repo. `cd ml && uv run python train.py` retrains, exports and ends with `SELF-CHECK PASS`; it also
writes the test rows that `cd api && npm run parity` then uses to compare the Node output with
scikit-learn.

The deployed stack (API on Render, web on Vercel) is checked with Postman collections that
assert on body content, not only status codes: the JSON health reply, the CORS header and the
current JavaScript bundle name. These collections are kept outside the repo.

## What's next

- A separate demo sample that shares no rows with the training data, and a block threshold
  chosen on a separate validation split instead of the test set.
- Idempotency key on `/ingest`, a Content-Security-Policy header, retry with backoff in the consumer.
