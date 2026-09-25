# ml/train.py   <-- ye P9-c2 pe badli (P4: pehla model 4k rows; P9-c2: pool se, val pe threshold, test EK baar)
#
# Kaam: B1 ka FINAL model. P9-c1 (compare.py) ne val pe chuna: capped 100k.
#   - Random Forest, 100 trees, max_leaf_nodes 1000 (ONNX ~8 MB, Render budget 10 MB ke andar)
#   - 9 features, iat NAHI (leak: ml/leak_check.py)
#   - train: pool ke TRAIN hisse se 100k benign + 100k attack (33 types barabar, water-filling)
#   - threshold VAL pe: alert = FPR <= 0.5%, block = FPR <= 0.1%  (andaze wala 0.5 / 0.9 khatam)
#   - TEST pe sirf EK baar, sab chunne ke BAAD. Test dekh ke kuch badla to test ka number bekaar.
#
# Output: ml/model.onnx + ml/model.json (thresholds + test numbers) + ml/parity.local.json (Node check)
# Chalana (Git Bash, ml/ folder se):   uv run python train.py

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import skl2onnx
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score
from skl2onnx import to_onnx
from skl2onnx.common.data_types import FloatTensorType

HERE = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", HERE.parent / "data"))
POOL, STATS = DATA_DIR / "pool.npz", DATA_DIR / "pool_stats.json"
MODEL_PATH, META_PATH = HERE / "model.onnx", HERE / "model.json"
PARITY_PATH = HERE / "parity.local.json"   # dataset rows -> *.local.json = gitignored
COMPARE = HERE / "compare.json"
SEED = 42
BENIGN = "BenignTraffic"
FEATURES = ["flow_duration", "header_length", "protocol_type", "duration", "rate",
            "syn_count", "rst_count", "urg_count", "tot_size"]   # iat NAHI - ORDER yahi Node bhejta hai
N_PER_BUCKET = 100_000
RF_PARAMS = {"n_estimators": 100, "max_leaf_nodes": 1000, "class_weight": "balanced"}
ALERT_FPR, BLOCK_FPR = 0.005, 0.001
SIM_ATTACK_RATIO = 0.03
BUDGET_MB = 10.0

for p in (POOL, STATS, COMPARE):
    if not p.exists():
        print(f"FAIL: {p.name} nahi mili (P9-a pool.py / P9-c1 compare.py pehle)")
        sys.exit(1)

z = np.load(POOL)
stats = json.loads(STATS.read_text(encoding="utf-8"))
compare = json.loads(COMPARE.read_text(encoding="utf-8"))
if compare["pick"] != "capped 100k":
    print(f"FAIL: compare.json ka pick '{compare['pick']}' hai - ye train.py capped 100k ke liye bani hai")
    sys.exit(1)

pool_features = list(z["features"])
X = z["X"][:, [pool_features.index(f) for f in FEATURES]]
labels = np.array(z["labels"])
kind = labels[z["label_id"]]
split_id, rank = z["split_id"], z["rank"]
splits = list(z["splits"])
TRAIN, VAL, TEST = splits.index("train"), splits.index("val"), splits.index("test")
y = (kind != BENIGN).astype(np.int8)
attack_types = sorted(set(labels) - {BENIGN})
seen = {t: stats["labels"][t]["seen"] for t in attack_types}


def train_rows(n):   # curve.py / compare.py jaisa - same rows -> same model
    avail = {t: int(((kind == t) & (split_id == TRAIN)).sum()) for t in attack_types}
    parts = [np.flatnonzero((kind == BENIGN) & (split_id == TRAIN) & (rank < n))]
    left, items = n, sorted(avail.items(), key=lambda kv: kv[1])
    for i, (t, a) in enumerate(items):
        k = min(a, left // (len(items) - i))
        left -= k
        parts.append(np.flatnonzero((kind == t) & (split_id == TRAIN) & (rank < k)))
    return np.concatenate(parts)


def threshold_for(p, yy, target):   # compare.py jaisa: FPR <= target wala sabse neeche threshold
    b = np.sort(p[yy == 0])[::-1]
    return float(np.nextafter(b[int(np.floor(target * len(b)))], np.inf))


def report(p, yy, kk, t):
    flag = p >= t
    tp = int((flag & (yy == 1)).sum()); fn = int((~flag & (yy == 1)).sum())
    fp = int((flag & (yy == 0)).sum()); tn = int((~flag & (yy == 0)).sum())
    per_type = {ty: float(flag[kk == ty].mean()) for ty in attack_types}
    macro = float(np.mean(list(per_type.values())))
    natural = sum(per_type[ty] * seen[ty] for ty in attack_types) / sum(seen.values())
    fpr = fp / (fp + tn)
    r = SIM_ATTACK_RATIO
    return {"threshold": t, "tp": tp, "fn": fn, "fp": fp, "tn": tn, "fpr": fpr,
            "macro_recall": macro, "natural_recall": natural,
            "precision_at_3pct": macro * r / (macro * r + fpr * (1 - r)) if macro else 0.0,
            "per_type": per_type}


def onnx_proba(path, Xf):
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    label, proba = sess.run(["label", "probabilities"], {"input": Xf})
    return label, proba[:, 1]


# ---- 1. train (sirf TRAIN rows) ----
idx = train_rows(N_PER_BUCKET)
t0 = time.time()
model = RandomForestClassifier(random_state=SEED, n_jobs=-1, **RF_PARAMS).fit(X[idx], y[idx])
train_s = time.time() - t0
print(f"train: {len(idx):,} rows (benign {int((y[idx] == 0).sum()):,}, attack {int(y[idx].sum()):,})   "
      f"{train_s:.0f} s   nodes {sum(e.tree_.node_count for e in model.estimators_):,}")

# ---- 1b. purana P4 model TEST pe - export use overwrite kare usse PEHLE. Sirf tulna ke liye;
# threshold wahi jo compare.py ne VAL pe P4 ke liye chuna (FPR <= 0.5%). Dobara chalane pe
# model.json mein pehle se likha number hi aage le jaao.
test = split_id == TEST
X_test = X[test].astype(np.float32)
y_test, k_test = y[test], kind[test]
prev_meta = json.loads(META_PATH.read_text(encoding="utf-8")) if META_PATH.exists() else {}
if "thresholds" not in prev_meta:     # abhi disk pe P4 model hai
    old_t = compare["results"][0]["at"][str(ALERT_FPR)]["threshold"]
    _, p_old = onnx_proba(MODEL_PATH, X_test)
    o = report(p_old, y_test, k_test, old_t)
    old_test = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in o.items() if k != "per_type"}
else:
    old_test = prev_meta["test"].get("old_p4_at_alert")

# ---- 2. ONNX export (jo ship hoga, usi se thresholds aur test) ----
onx = to_onnx(model, initial_types=[("input", FloatTensorType([None, len(FEATURES)]))],
              options={id(model): {"zipmap": False}})
MODEL_PATH.write_bytes(onx.SerializeToString())
mb = MODEL_PATH.stat().st_size / 1e6
print(f"ONNX: {MODEL_PATH.name} {mb:.1f} MB (budget {BUDGET_MB:.0f})")

# ---- 3. thresholds VAL pe (ONNX ke scores se - wahi Node dekhega) ----
val = split_id == VAL
_, p_val = onnx_proba(MODEL_PATH, X[val].astype(np.float32))
t_alert = threshold_for(p_val, y[val], ALERT_FPR)
t_block = threshold_for(p_val, y[val], BLOCK_FPR)
c_alert, c_block = compare["alert_threshold"], compare["block_threshold"]
print(f"\n[1] thresholds (VAL): alert {t_alert:.6f} (compare.json {c_alert})   "
      f"block {t_block:.6f} (compare.json {c_block})")

# ---- 4. TEST - sirf ek baar. Iske baad kuch nahi badalna. ----
onnx_label, p_test = onnx_proba(MODEL_PATH, X_test)
auc = roc_auc_score(y_test, p_test)
alert = report(p_test, y_test, k_test, t_alert)
block = report(p_test, y_test, k_test, t_block)

print(f"\n[2] TEST ({len(y_test):,} rows: attack {int(y_test.sum()):,}, benign {int((y_test == 0).sum()):,})   AUC {auc:.4f}")
print(f"  {'':<7}{'thr':>8}{'FPR':>8}{'FP':>6}{'macro recall':>14}{'natural':>9}{'prec@3%':>9}")
rows_out = [("alert", alert), ("block", block)]
for name, r in rows_out:
    print(f"  {name:<7}{r['threshold']:>8.3f}{r['fpr']:>8.4f}{r['fp']:>6}{r['macro_recall']:>14.4f}"
          f"{r['natural_recall']:>9.4f}{r['precision_at_3pct']:>9.3f}")
if old_test:
    print(f"  {'old P4':<7}{old_test['threshold']:>8.3f}{old_test['fpr']:>8.4f}{old_test['fp']:>6}"
          f"{old_test['macro_recall']:>14.4f}{old_test['natural_recall']:>9.4f}{old_test['precision_at_3pct']:>9.3f}"
          "   <- purana model, same FPR limit (val pe chuna)")

print("\n[3] alert pe har attack type ka recall (TEST) - kamzor upar")
for ty in sorted(attack_types, key=lambda t: alert["per_type"][t]):
    bar = "#" * int(round(alert["per_type"][ty] * 20))
    print(f"  {ty:<24}{alert['per_type'][ty]:>7.3f}  {bar}")

# ---- 5. parity: sklearn vs ONNX, har test row ----
sk_proba = model.predict_proba(X_test)[:, 1]
sk_label = model.predict(X_test)
max_diff = float(np.abs(p_test - sk_proba).max())
mismatch = int((onnx_label != sk_label).sum())
ties = int((sk_proba == 0.5).sum())
print(f"\n[4] parity ({len(X_test):,} test rows): max |proba diff| {max_diff:.2e}   "
      f"label mismatch {mismatch}   50-50 ties {ties}")

r3 = lambda v: round(v, 4) if isinstance(v, float) else v
META_PATH.write_text(json.dumps({
    "features": FEATURES,
    "dropped": {"iat": "leak: IAT alone gave F1 0.9913 (ml/leak_check.py)"},
    "input": "input",
    "outputs": ["label", "probabilities"],
    "positive_class": 1,
    # Node yahi padhta hai. Full precision (round NAHI): round karne se threshold k-th benign
    # score se neeche aa sakta hai -> FPR limit se upar.
    "thresholds": {"alert": t_alert, "block": t_block,
                   "chosen_on": "val", "alert_max_fpr": ALERT_FPR, "block_max_fpr": BLOCK_FPR},
    "training": {"source": "CICIoT2023, ml/pool.py sample (P9-a)", "rows": int(len(idx)),
                 "per_bucket": N_PER_BUCKET, "attack_types": len(attack_types),
                 "model": "RandomForest", **RF_PARAMS, "onnx_mb": round(mb, 1), "train_s": round(train_s, 1)},
    "versions": {"scikit-learn": sklearn.__version__, "skl2onnx": skl2onnx.__version__,
                 "onnxruntime": ort.__version__},
    "test": {"rows": int(len(y_test)), "attack": int(y_test.sum()), "benign": int((y_test == 0).sum()),
             "auc": r3(auc), "sim_attack_ratio": SIM_ATTACK_RATIO,
             "alert": {k: r3(v) for k, v in alert.items() if k not in ("per_type", "threshold")},
             "block": {k: r3(v) for k, v in block.items() if k not in ("per_type", "threshold")},
             "old_p4_at_alert": old_test,
             "per_type_recall_at_alert": {t: r3(v) for t, v in alert["per_type"].items()}},
}, indent=2) + "\n", encoding="utf-8", newline="\n")

# Node (npm run parity) inhi rows pe ONNX chala ke ye probabilities milayega
PARITY_PATH.write_text(json.dumps({
    "features": FEATURES,
    "rows": X[test].tolist(),
    "proba_attack": [round(float(p), 6) for p in sk_proba],
}) + "\n", encoding="utf-8", newline="\n")
print(f"    likha: {MODEL_PATH.name}, {META_PATH.name}, {PARITY_PATH.name}")

problems = []
if mb > BUDGET_MB:
    problems.append(f"ONNX {mb:.1f} MB > {BUDGET_MB} MB")
if abs(t_alert - c_alert) > 1e-5 or abs(t_block - c_block) > 1e-5:
    problems.append("val thresholds compare.json se alag - model alag bana (seed/rows?)")
if not t_alert <= t_block:
    problems.append("alert threshold block se upar")
if not (max_diff < 1e-5 and mismatch <= ties):
    problems.append("ONNX aur sklearn alag jawab")
if problems:
    print("\nSELF-CHECK FAIL: " + "; ".join(problems))
    sys.exit(1)
print("\nSELF-CHECK PASS: budget ke andar, thresholds val pe (compare.json se match), test EK baar, ONNX = sklearn")
