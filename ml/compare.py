#
# Fixes a flaw in curve.py. curve.py compared all models at threshold 0.5 - but each model had a
# different FPR (old 0.4%, new 7-9%). Comparing recall at different FPRs = comparing times from different races.
# The right way: choose each model's threshold on VAL so that its FPR is within the same limit (1% / 0.5% /
# 0.1%), THEN compare recall. Test is still NOT touched.
#
# Two kinds of recall:
#   macro   = simple average over the 33 attack types (each type counts equally) - weak types cannot hide
#   natural = each type's recall weighted by that type's count in the DATASET (the view behind the README's 0.968,
#             where DDoS floods dominate)
# Plus AUC: a single number without a threshold (1.0 = every attack scores above every benign).
#
# Run (Git Bash, from the ml/ folder):   uv run python compare.py
# Output: table + weak types + RECOMMENDATION (model, alert threshold, block threshold). ml/compare.json

import json
import os
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score

HERE = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", HERE.parent / "data"))
POOL, STATS = DATA_DIR / "pool.npz", DATA_DIR / "pool_stats.json"
OUT = HERE / "compare.json"
SEED = 42
BENIGN = "BenignTraffic"
SIM_ATTACK_RATIO = 0.03
FPR_TARGETS = [0.01, 0.005, 0.001]   # 1% / 0.5% / 0.1% false alarms on benign
ALERT_FPR, BLOCK_FPR = 0.005, 0.001  # alert (red dot) up to 0.5%, block (actual drop) up to 0.1%
BUDGET_MB = 10.0
# Sizes measured by curve.py: capped = 7.8 MB (within budget), full 100k = 83.5 MB (comparison only)
CANDIDATES = [("capped 20k", 20_000, {"max_leaf_nodes": 1000}, 7.8),
              ("capped 100k", 100_000, {"max_leaf_nodes": 1000}, 7.8),
              ("full 100k", 100_000, {}, 83.5)]

for p in (POOL, STATS):
    if not p.exists():
        print(f"FAIL: {p} not found - run first: uv run python pool.py")
        sys.exit(1)

z = np.load(POOL)
stats = json.loads(STATS.read_text(encoding="utf-8"))
meta = json.loads((HERE / "model.json").read_text(encoding="utf-8"))
FEATURES = meta["features"]
pool_features = list(z["features"])
X = z["X"][:, [pool_features.index(f) for f in FEATURES]]
labels = np.array(z["labels"])
kind = labels[z["label_id"]]
split_id, rank = z["split_id"], z["rank"]
splits = list(z["splits"])
TRAIN, VAL = splits.index("train"), splits.index("val")
y = (kind != BENIGN).astype(np.int8)

val = split_id == VAL
X_val, y_val, kind_val = X[val].astype(np.float32), y[val], kind[val]
attack_types = sorted(set(labels) - {BENIGN})
seen = {t: stats["labels"][t]["seen"] for t in attack_types}   # count in the real dataset
seen_total = sum(seen.values())
benign_scores_n = int((y_val == 0).sum())


def train_rows(n):   # same as curve.py: N benign + N attack (water-filling across 33 types), nested
    avail = {t: int(((kind == t) & (split_id == TRAIN)).sum()) for t in attack_types}
    parts = [np.flatnonzero((kind == BENIGN) & (split_id == TRAIN) & (rank < n))]
    left, items = n, sorted(avail.items(), key=lambda kv: kv[1])
    for i, (t, a) in enumerate(items):
        k = min(a, left // (len(items) - i))
        left -= k
        parts.append(np.flatnonzero((kind == t) & (split_id == TRAIN) & (rank < k)))
    return np.concatenate(parts)


def threshold_for(p, target):
    """The lowest threshold whose VAL FPR <= target. Sort benign scores in descending order; place the
    threshold just above the k-th largest score -> at most k benign (target * benign) get flagged."""
    b = np.sort(p[y_val == 0])[::-1]
    k = int(np.floor(target * len(b)))
    return float(np.nextafter(b[k], np.inf))


def at(p, t):
    flag = p >= t
    per_type = {ty: float(flag[kind_val == ty].mean()) for ty in attack_types}
    macro = float(np.mean(list(per_type.values())))
    natural = sum(per_type[ty] * seen[ty] for ty in attack_types) / seen_total
    fpr = float(flag[y_val == 0].mean())
    r = SIM_ATTACK_RATIO
    prec3 = macro * r / (macro * r + fpr * (1 - r)) if macro else 0.0
    return {"threshold": round(t, 6), "fpr": fpr, "macro": macro, "natural": natural,
            "fp": int(flag[y_val == 0].sum()), "precision_at_3pct": prec3, "per_type": per_type}


results = []
sess = ort.InferenceSession(str(HERE / "model.onnx"), providers=["CPUExecutionProvider"])
p_old = sess.run(["probabilities"], {meta["input"]: X_val})[0][:, 1]
scored = [("old", p_old, (HERE / "model.onnx").stat().st_size / 1e6)]
for name, n, extra, mb in CANDIDATES:
    idx = train_rows(n)
    m = RandomForestClassifier(n_estimators=100, class_weight="balanced", random_state=SEED,
                               n_jobs=-1, **extra).fit(X[idx], y[idx])
    # float32 input: ONNX also takes float32; sklearn trees use float32 internally anyway
    scored.append((name, m.predict_proba(X_val)[:, 1], mb))
    print(f"  trained {name} ({len(idx):,} rows)")
    del m

print(f"\nVAL: {len(y_val):,} rows (benign {benign_scores_n:,})   test: NOT touched")
print(f"\n[1] recall at the same FPR  (macro = 33 types count equally, natural = dataset mix)")
print(f"  {'model':<12}{'AUC':>8}{'MB':>6}" + "".join(f"{'@FPR<=' + format(t, '.1%'):>30}" for t in FPR_TARGETS))
print(f"  {'':<26}" + "".join(f"{'macro   natural   thr':>30}" for _ in FPR_TARGETS))
for name, p, mb in scored:
    rows = {t: at(p, threshold_for(p, t)) for t in FPR_TARGETS}
    auc = roc_auc_score(y_val, p)
    results.append({"model": name, "onnx_mb": mb, "auc": auc, "at": rows})
    print(f"  {name:<12}{auc:>8.4f}{mb:>6.1f}" + "".join(
        f"{r['macro']:>13.4f}{r['natural']:>9.4f}{r['threshold']:>8.3f}" for r in rows.values()))

print(f"\n[2] recall for each type at the alert limit (FPR <= {ALERT_FPR:.1%}) - weakest 12")
names = [r["model"] for r in results]
print(f"  {'type':<24}" + "".join(f"{n:>13}" for n in names))
ref = results[2]["at"][ALERT_FPR]["per_type"]  # sorted by capped 100k
for ty in sorted(attack_types, key=lambda t: ref[t])[:12]:
    print(f"  {ty:<24}" + "".join(f"{r['at'][ALERT_FPR]['per_type'][ty]:>13.3f}" for r in results))

# RECOMMENDATION: among the within-budget (capped) models, the one with higher macro recall at the alert limit.
# A difference under 0.005 = a tie -> the smaller data (20k). If it is not better than old, STOP.
inb = [r for r in results if r["model"].startswith("capped")]
a = {r["model"]: r["at"][ALERT_FPR]["macro"] for r in inb}
pick = inb[1] if a["capped 100k"] - a["capped 20k"] >= 0.005 else inb[0]
old = results[0]
pa, pb = pick["at"][ALERT_FPR], pick["at"][BLOCK_FPR]
oa = old["at"][ALERT_FPR]
full_gap = results[3]["at"][ALERT_FPR]["macro"] - pa["macro"]
print(f"\nRECOMMENDATION (for train.py): {pick['model']}")
print(f"  alert threshold {pa['threshold']:.3f}  (FPR {pa['fpr']:.4f}, macro recall {pa['macro']:.4f}, "
      f"old {oa['macro']:.4f} at the same FPR limit)")
print(f"  block threshold {pb['threshold']:.3f}  (FPR {pb['fpr']:.4f}, macro recall {pb['macro']:.4f})")
print(f"  precision @3% attack (alert): {pa['precision_at_3pct']:.3f}   old: {oa['precision_at_3pct']:.3f}")
print(f"  cost of the 10 MB limit: full 100k (83.5 MB) gets {full_gap:+.4f} macro recall")

OUT.write_text(json.dumps({"split": "val", "alert_fpr": ALERT_FPR, "block_fpr": BLOCK_FPR,
                           "pick": pick["model"], "alert_threshold": pa["threshold"],
                           "block_threshold": pb["threshold"],
                           "results": [{"model": r["model"], "onnx_mb": r["onnx_mb"], "auc": round(r["auc"], 4),
                                        "at": {str(t): {k: (round(v, 4) if isinstance(v, float) else v)
                                                        for k, v in row.items() if k != "per_type"}
                                               | {"per_type": {ty: round(v, 4) for ty, v in row["per_type"].items()}}
                                               for t, row in r["at"].items()}} for r in results]},
                          indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"-> {OUT}")

bad = []
for r in results:
    for t, row in r["at"].items():
        if row["fpr"] > t:
            bad.append(f"{r['model']} FPR {row['fpr']:.4f} > {t}")
if pa["macro"] <= oa["macro"]:
    bad.append("chosen model is NOT better than old (at the same FPR) - STOP")
if bad:
    print("\nSELF-CHECK FAIL: " + "; ".join(bad))
    sys.exit(1)
print("\nSELF-CHECK PASS: every threshold's FPR within its limit, val only, test not touched, new > old")
