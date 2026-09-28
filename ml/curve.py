#
# LEARNING CURVE. Question: "how much better does the model get with more data, and where does it level off?"
# From the TRAIN split of data/pool.npz take 2k, 20k, 100k rows per bucket (benign N + attack N),
# train a Random Forest each time, and measure on the VALIDATION split. TEST is NOT TOUCHED here -
# test is used only once, on the chosen model, in train.py.
#
# Two configs, both 100 trees:
#   full   = the current setup (no limit on the trees)  -> more data = bigger trees = bigger ONNX file
#   capped = max_leaf_nodes 1000 (at most 1000 leaves per tree) -> caps the file size
# Render free tier = 512 MB RAM, 0.1 CPU -> our budget: ONNX <= 10 MB.
#
# First row "old": the currently deployed ml/model.onnx (3,200 train rows) - on the new val split. This is the baseline.
#
# Run (Git Bash, from the ml/ folder):   uv run python curve.py
# Output: table + attack-type recall + RECOMMENDATION. Numbers go to ml/curve.json (no data rows - safe to commit).

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from sklearn.ensemble import RandomForestClassifier
from skl2onnx import to_onnx
from skl2onnx.common.data_types import FloatTensorType

HERE = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", HERE.parent / "data"))
POOL = DATA_DIR / "pool.npz"
TMP_ONNX = DATA_DIR / "_curve_tmp.onnx"      # only used to measure the size, deleted afterwards
OLD_SAMPLES = HERE.parent / "api" / "scripts" / "samples.local.json"
OUT = HERE / "curve.json"
SEED = 42
BENIGN = "BenignTraffic"
SIZES = [2_000, 20_000, 100_000]              # per bucket (benign N + attack N)
CONFIGS = {"full": {}, "capped": {"max_leaf_nodes": 1000}}
BUDGET_MB = 10.0
THRESHOLD = 0.5                               # detection threshold; the block threshold is chosen later on val

if not POOL.exists():
    print(f"FAIL: {POOL} not found - run first: uv run python pool.py")
    sys.exit(1)

z = np.load(POOL)
pool_features = list(z["features"])
labels = np.array(z["labels"])
splits = list(z["splits"])
label_id, split_id, rank = z["label_id"], z["split_id"], z["rank"]

meta = json.loads((HERE / "model.json").read_text(encoding="utf-8"))
FEATURES = meta["features"]                   # 9, NO iat, same ORDER that Node sends
if len(FEATURES) != 9 or "iat" in FEATURES:
    print(f"FAIL: model.json must have 9 features (without iat), got {FEATURES}")
    sys.exit(1)
X = z["X"][:, [pool_features.index(f) for f in FEATURES]]
kind = labels[label_id]                       # label name of each row
y = (kind != BENIGN).astype(np.int8)          # 1 = attack

TRAIN, VAL = splits.index("train"), splits.index("val")
val = split_id == VAL
X_val, y_val, kind_val = X[val].astype(np.float32), y[val], kind[val]
attack_types = sorted(set(labels) - {BENIGN})


def attack_quota(n):
    """Split N attack rows evenly across the 33 types. A small type (Uploading 813) gives all it
    has, and the remainder goes to the other types (water-filling)."""
    avail = {t: int(((kind == t) & (split_id == TRAIN)).sum()) for t in attack_types}
    quota, left = {}, n
    items = sorted(avail.items(), key=lambda kv: kv[1])
    for i, (t, a) in enumerate(items):
        take = min(a, left // (len(items) - i))
        quota[t] = take
        left -= take
    return quota


def train_rows(n):
    """N benign + N attack from the train split. rank < k = the first k rows in tag order -> nested."""
    parts = [np.flatnonzero((kind == BENIGN) & (split_id == TRAIN) & (rank < n))]
    for t, k in attack_quota(n).items():
        parts.append(np.flatnonzero((kind == t) & (split_id == TRAIN) & (rank < k)))
    return np.concatenate(parts)


def score(p_attack):
    """On VAL: recall, FPR, precision, F1 (threshold 0.5) + recall for each attack type."""
    flag = p_attack >= THRESHOLD
    tp = int((flag & (y_val == 1)).sum()); fn = int((~flag & (y_val == 1)).sum())
    fp = int((flag & (y_val == 0)).sum()); tn = int((~flag & (y_val == 0)).sum())
    recall = tp / (tp + fn); fpr = fp / (fp + tn)
    precision = tp / (tp + fp) if tp + fp else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    per_type = {t: float(flag[kind_val == t].mean()) for t in attack_types}
    return {"tp": tp, "fn": fn, "fp": fp, "tn": tn, "recall": recall, "fpr": fpr,
            "precision": precision, "f1": f1, "per_type": per_type}


def onnx_run(path):
    """Val probabilities from the ONNX file + time for 1 row (a single reading arrives like this on Render)."""
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    _, proba = sess.run(["label", "probabilities"], {meta["input"]: X_val})
    one = X_val[:1]
    times = []
    for _ in range(200):
        t = time.perf_counter()
        sess.run(["probabilities"], {meta["input"]: one})
        times.append((time.perf_counter() - t) * 1000)
    return proba[:, 1], float(np.median(times))


runs = []
print(f"pool: {len(X):,} rows   val: {len(y_val):,} (attack {int(y_val.sum()):,}, benign {int((y_val == 0).sum()):,})")
print(f"FPR resolution: 1/{int((y_val == 0).sum()):,}   threshold {THRESHOLD}   test: NOT touched\n")

# ---- baseline: the currently deployed model ----
p_old, ms_old = onnx_run(HERE / "model.onnx")
old = {"run": "old", "train_rows": meta["test"]["rows"] * 4, "nodes": None,
       "onnx_mb": (HERE / "model.onnx").stat().st_size / 1e6, "train_s": None, "ms_1row": ms_old, **score(p_old)}
runs.append(old)
if OLD_SAMPLES.exists():  # are any of the old model's training rows in the new val? (that would make the baseline look slightly better)
    s = json.loads(OLD_SAMPLES.read_text(encoding="utf-8"))
    old_rows = {np.array([r["metrics"][f] for f in FEATURES], dtype=np.float64).astype(np.float32).tobytes()
                for r in s["benign"] + s["attack"]}
    overlap = sum(r.tobytes() in old_rows for r in X_val)
    print(f"rows from the old model's sample file that are also in the new val: {overlap:,} / {len(y_val):,}")

# ---- learning curve ----
idx_by_n = {n: train_rows(n) for n in SIZES}
for a, b in zip(SIZES, SIZES[1:]):
    if not np.isin(idx_by_n[a], idx_by_n[b]).all():
        print(f"FAIL: train rows not nested (the {a:,} set is not fully inside the {b:,} set)")
        sys.exit(1)
if any((split_id[i] != TRAIN).any() for i in idx_by_n.values()):
    print("FAIL: a non-train row got into train")
    sys.exit(1)
for n, i in idx_by_n.items():
    print(f"  train {n // 1000}k: benign {int((y[i] == 0).sum()):,} + attack {int(y[i].sum()):,}")
print()

for cfg, extra in CONFIGS.items():
    for n in SIZES:
        idx = idx_by_n[n]
        t0 = time.time()
        model = RandomForestClassifier(n_estimators=100, class_weight="balanced", random_state=SEED,
                                       n_jobs=-1, **extra).fit(X[idx], y[idx])
        train_s = time.time() - t0
        onx = to_onnx(model, initial_types=[("input", FloatTensorType([None, len(FEATURES)]))],
                      options={id(model): {"zipmap": False}})
        TMP_ONNX.write_bytes(onx.SerializeToString())
        p, ms = onnx_run(TMP_ONNX)
        mb = TMP_ONNX.stat().st_size / 1e6
        TMP_ONNX.unlink()
        nodes = int(sum(e.tree_.node_count for e in model.estimators_))
        r = {"run": f"{cfg} {n // 1000}k", "train_rows": len(idx), "nodes": nodes, "onnx_mb": mb,
             "train_s": train_s, "ms_1row": ms, **score(p)}
        runs.append(r)
        print(f"  {r['run']:<12} recall {r['recall']:.4f}  FPR {r['fpr']:.4f}  {mb:6.1f} MB  {train_s:5.0f} s")
        del model, onx

# ---- report ----
print(f"\n[1] on VAL (threshold {THRESHOLD})")
print(f"  {'run':<12}{'train rows':>11}{'recall':>8}{'FPR':>8}{'prec':>8}{'F1':>8}{'nodes':>11}{'ONNX MB':>9}{'train s':>8}{'1-row ms':>9}")
for r in runs:
    nodes = f"{r['nodes']:,}" if r["nodes"] else "-"
    ts = f"{r['train_s']:.0f}" if r["train_s"] is not None else "-"
    print(f"  {r['run']:<12}{r['train_rows']:>11,}{r['recall']:>8.4f}{r['fpr']:>8.4f}{r['precision']:>8.4f}"
          f"{r['f1']:>8.4f}{nodes:>11}{r['onnx_mb']:>9.1f}{ts:>8}{r['ms_1row']:>9.2f}")

print("\n[2] recall for each attack type (VAL) - weakest first")
names = [r["run"] for r in runs]
print(f"  {'type':<24}" + "".join(f"{n:>12}" for n in names))
for t in sorted(attack_types, key=lambda t: runs[-1]["per_type"][t]):
    print(f"  {t:<24}" + "".join(f"{r['per_type'][t]:>12.3f}" for r in runs))

# RECOMMENDATION: only runs within budget (<= 10 MB). Look at BOTH recall and FPR (in an IPS, FPR = blocking
# real traffic). Pick the SMALLEST data size within 0.002 below the best recall and within 0.0005 above the best FPR.
# "Plateau" means: more data than this does not make even that much difference. If no run meets both, take the best F1.
ok = [r for r in runs[1:] if r["onnx_mb"] <= BUDGET_MB]
if not ok:
    print(f"\nRECOMMENDATION: no run within {BUDGET_MB} MB - STOP and review the output")
    sys.exit(1)
best_recall = max(r["recall"] for r in ok)
best_fpr = min(r["fpr"] for r in ok)
near = [r for r in ok if r["recall"] >= best_recall - 0.002 and r["fpr"] <= best_fpr + 0.0005]
pick = min(near, key=lambda r: (r["train_rows"], r["onnx_mb"])) if near else max(ok, key=lambda r: r["f1"])
why = "plateau: recall and FPR both close to the best" if near else "no run met both -> best F1"
print(f"\nwithin budget ({BUDGET_MB:.0f} MB): best recall {best_recall:.4f}, best FPR {best_fpr:.4f}")
print(f"RECOMMENDATION (for compare.py): {pick['run']}  ({why})")
print(f"  recall {pick['recall']:.4f} (old {old['recall']:.4f})   FPR {pick['fpr']:.4f} (old {old['fpr']:.4f})   "
      f"{pick['onnx_mb']:.1f} MB")

OUT.write_text(json.dumps({"split": "val", "threshold": THRESHOLD, "budget_mb": BUDGET_MB,
                           "val_rows": int(len(y_val)), "pick": pick["run"],
                           "runs": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()
                                     if k != "per_type"} | {"per_type": {t: round(v, 4) for t, v in r["per_type"].items()}}
                                    for r in runs]}, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"-> {OUT}")
print("\nSELF-CHECK PASS: 6 runs + old, train rows nested, learned only from train, measured only on val, test not touched")
