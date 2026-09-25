# ml/curve.py   <-- ye P9-b pe daalni hai (NAYI file)
#
# Kaam: LEARNING CURVE. Sawaal: "zyada data dene se model kitna behtar hota hai, aur kahan ruk jaata hai?"
# data/pool.npz (P9-a) ke TRAIN hisse se 2k, 20k, 100k rows per bucket (benign N + attack N) lo,
# har baar Random Forest train karo, aur VALIDATION hisse pe naapo. TEST ko yahan CHHOOTE BHI NAHI -
# test sirf P9-c mein, chune hue model pe, ek baar.
#
# Do config, dono 100 trees:
#   full   = abhi wala (trees ki koi limit nahi)  -> bada data = bade trees = badi ONNX file
#   capped = max_leaf_nodes 1000 (har tree max 1000 patte) -> file size pe chhat
# Render free = 512 MB RAM, 0.1 CPU -> hamara budget: ONNX <= 10 MB.
#
# Pehli line "old": abhi deployed ml/model.onnx (P4, 3,200 train rows) - naye val pe. Yahi baseline.
#
# Chalana (Git Bash, ml/ folder se):   uv run python curve.py
# Output: table + attack-type recall + SUJHAAV. Numbers ml/curve.json mein (koi data row nahi - commit ho sakti).

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
TMP_ONNX = DATA_DIR / "_curve_tmp.onnx"      # sirf size naapne ke liye, baad mein delete
OLD_SAMPLES = HERE.parent / "api" / "scripts" / "samples.local.json"
OUT = HERE / "curve.json"
SEED = 42
BENIGN = "BenignTraffic"
SIZES = [2_000, 20_000, 100_000]              # har bucket mein (benign N + attack N)
CONFIGS = {"full": {}, "capped": {"max_leaf_nodes": 1000}}
BUDGET_MB = 10.0
THRESHOLD = 0.5                               # detect wala; block threshold P9-c mein val pe

if not POOL.exists():
    print(f"FAIL: {POOL} nahi mili - pehle P9-a: uv run python pool.py")
    sys.exit(1)

z = np.load(POOL)
pool_features = list(z["features"])
labels = np.array(z["labels"])
splits = list(z["splits"])
label_id, split_id, rank = z["label_id"], z["split_id"], z["rank"]

meta = json.loads((HERE / "model.json").read_text(encoding="utf-8"))
FEATURES = meta["features"]                   # 9, iat NAHI, ORDER wahi jo Node bhejta hai
if len(FEATURES) != 9 or "iat" in FEATURES:
    print(f"FAIL: model.json mein 9 feature (bina iat) chahiye, mile {FEATURES}")
    sys.exit(1)
X = z["X"][:, [pool_features.index(f) for f in FEATURES]]
kind = labels[label_id]                       # har row ka label naam
y = (kind != BENIGN).astype(np.int8)          # 1 = attack

TRAIN, VAL = splits.index("train"), splits.index("val")
val = split_id == VAL
X_val, y_val, kind_val = X[val].astype(np.float32), y[val], kind[val]
attack_types = sorted(set(labels) - {BENIGN})


def attack_quota(n):
    """N attack rows ko 33 types mein barabar baanto. Chhote type (Uploading 813) jitna hai utna
    dete hain, bacha hua hissa baaki types mein chala jaata hai (water-filling)."""
    avail = {t: int(((kind == t) & (split_id == TRAIN)).sum()) for t in attack_types}
    quota, left = {}, n
    items = sorted(avail.items(), key=lambda kv: kv[1])
    for i, (t, a) in enumerate(items):
        take = min(a, left // (len(items) - i))
        quota[t] = take
        left -= take
    return quota


def train_rows(n):
    """Train hisse se N benign + N attack. rank < k = tag-order ki pehli k rows -> nested."""
    parts = [np.flatnonzero((kind == BENIGN) & (split_id == TRAIN) & (rank < n))]
    for t, k in attack_quota(n).items():
        parts.append(np.flatnonzero((kind == t) & (split_id == TRAIN) & (rank < k)))
    return np.concatenate(parts)


def score(p_attack):
    """VAL pe: recall, FPR, precision, F1 (threshold 0.5) + har attack type ka recall."""
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
    """ONNX file se val ke probabilities + 1 row ka time (Render pe ek reading aisi hi aati hai)."""
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
print(f"FPR ki resolution: 1/{int((y_val == 0).sum()):,}   threshold {THRESHOLD}   test: NAHI chhua\n")

# ---- baseline: abhi deployed model ----
p_old, ms_old = onnx_run(HERE / "model.onnx")
old = {"run": "old", "train_rows": meta["test"]["rows"] * 4, "nodes": None,
       "onnx_mb": (HERE / "model.onnx").stat().st_size / 1e6, "train_s": None, "ms_1row": ms_old, **score(p_old)}
runs.append(old)
if OLD_SAMPLES.exists():  # purane model ki training rows kahin naye val mein to nahi? (baseline thoda meetha ho jaata)
    s = json.loads(OLD_SAMPLES.read_text(encoding="utf-8"))
    old_rows = {np.array([r["metrics"][f] for f in FEATURES], dtype=np.float64).astype(np.float32).tobytes()
                for r in s["benign"] + s["attack"]}
    overlap = sum(r.tobytes() in old_rows for r in X_val)
    print(f"old model ki sample file ki rows jo naye val mein bhi hain: {overlap:,} / {len(y_val):,}")

# ---- learning curve ----
idx_by_n = {n: train_rows(n) for n in SIZES}
for a, b in zip(SIZES, SIZES[1:]):
    if not np.isin(idx_by_n[a], idx_by_n[b]).all():
        print(f"FAIL: train rows nested nahi ({a:,} wala set {b:,} mein poora nahi)")
        sys.exit(1)
if any((split_id[i] != TRAIN).any() for i in idx_by_n.values()):
    print("FAIL: train mein non-train row aa gayi")
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
print(f"\n[1] VAL pe (threshold {THRESHOLD})")
print(f"  {'run':<12}{'train rows':>11}{'recall':>8}{'FPR':>8}{'prec':>8}{'F1':>8}{'nodes':>11}{'ONNX MB':>9}{'train s':>8}{'1-row ms':>9}")
for r in runs:
    nodes = f"{r['nodes']:,}" if r["nodes"] else "-"
    ts = f"{r['train_s']:.0f}" if r["train_s"] is not None else "-"
    print(f"  {r['run']:<12}{r['train_rows']:>11,}{r['recall']:>8.4f}{r['fpr']:>8.4f}{r['precision']:>8.4f}"
          f"{r['f1']:>8.4f}{nodes:>11}{r['onnx_mb']:>9.1f}{ts:>8}{r['ms_1row']:>9.2f}")

print("\n[2] har attack type ka recall (VAL) - sabse kamzor upar")
names = [r["run"] for r in runs]
print(f"  {'type':<24}" + "".join(f"{n:>12}" for n in names))
for t in sorted(attack_types, key=lambda t: runs[-1]["per_type"][t]):
    print(f"  {t:<24}" + "".join(f"{r['per_type'][t]:>12.3f}" for r in runs))

# SUJHAAV: sirf budget (<= 10 MB) wale runs. Recall aur FPR DONO dekho (IPS mein FPR = asli traffic
# block). Sabse CHHOTA data jo best recall se 0.002 tak neeche aur best FPR se 0.0005 tak upar ho.
# "Plateau" ka matlab: isse zyada data se itna bhi fark nahi. Koi dono pe na tike to best F1.
ok = [r for r in runs[1:] if r["onnx_mb"] <= BUDGET_MB]
if not ok:
    print(f"\nSUJHAAV: koi run {BUDGET_MB} MB ke andar nahi - RUK, output paste karo")
    sys.exit(1)
best_recall = max(r["recall"] for r in ok)
best_fpr = min(r["fpr"] for r in ok)
near = [r for r in ok if r["recall"] >= best_recall - 0.002 and r["fpr"] <= best_fpr + 0.0005]
pick = min(near, key=lambda r: (r["train_rows"], r["onnx_mb"])) if near else max(ok, key=lambda r: r["f1"])
why = "plateau: recall aur FPR dono best ke paas" if near else "koi dono pe nahi tika -> best F1"
print(f"\nbudget ({BUDGET_MB:.0f} MB) ke andar: best recall {best_recall:.4f}, best FPR {best_fpr:.4f}")
print(f"SUJHAAV (P9-c ke liye): {pick['run']}  ({why})")
print(f"  recall {pick['recall']:.4f} (old {old['recall']:.4f})   FPR {pick['fpr']:.4f} (old {old['fpr']:.4f})   "
      f"{pick['onnx_mb']:.1f} MB")

OUT.write_text(json.dumps({"split": "val", "threshold": THRESHOLD, "budget_mb": BUDGET_MB,
                           "val_rows": int(len(y_val)), "pick": pick["run"],
                           "runs": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()
                                     if k != "per_type"} | {"per_type": {t: round(v, 4) for t, v in r["per_type"].items()}}
                                    for r in runs]}, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"-> {OUT}")
print("\nSELF-CHECK PASS: 6 run + old, train rows nested, sirf train se seekha, sirf val pe naapa, test nahi chhua")
