# ml/leak_check.py
#
# Tests an earlier suspicion: is the "iat" column secretly giving the model the answer?
# (leak = information that is in the data but would not be available at prediction time in the real world)
#
# Three pieces of evidence, in one run:
#   1) iat range: benign vs attack, and each attack type separately
#   2) SAME rows, SAME model, three feature sets: all 10 / 9 without iat / iat only
#   3) which feature the all-10 model relied on most (importance)
#
# Run (Git Bash, from the ml/ folder):   uv run python leak_check.py

import json
import os
import sys
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score
from sklearn.model_selection import train_test_split

# ml/demo.py creates this file (previously extract.js) - gitignored, it only exists on your machine
DEFAULT = Path(__file__).resolve().parent.parent / "api" / "scripts" / "samples.local.json"
SAMPLES = Path(os.environ.get("SAMPLES", DEFAULT))
SEED = 42  # same split + same trees every time -> numbers from different machines can be compared

if not SAMPLES.exists():
    print(f"FAIL: sample file not found: {SAMPLES}")
    print("      run this first, from the ml/ folder:  uv run python demo.py")
    sys.exit(1)

data = json.loads(SAMPLES.read_text(encoding="utf-8"))
FEATURES = data["features"]
rows = data["benign"] + data["attack"]

df = pd.DataFrame([r["metrics"] for r in rows])
df["label"] = [r["label"] for r in rows]
df["y"] = (df["label"] != "BenignTraffic").astype(int)  # 1 = attack, 0 = benign

n_benign = int((df["y"] == 0).sum())
n_attack = int((df["y"] == 1).sum())
print(f"file   : {SAMPLES.name}   rows = {len(df)}  (benign {n_benign}, attack {n_attack})")
if n_benign < 100 or n_attack < 100:
    print("FAIL: both classes need at least 100 rows")
    sys.exit(1)
if "iat" not in FEATURES:
    print(f"FAIL: iat is not in features: {FEATURES}")
    sys.exit(1)

# Another leak: the exact same row in both train and test -> the model passes by memorizing
dups = int(df.duplicated(subset=FEATURES).sum())
print(f"exact duplicate rows (10 features same): {dups}")

# ---- EVIDENCE 1: iat range ----
pd.set_option("display.float_format", "{:,.0f}".format)
pd.set_option("display.width", 120)
print("\n[1] iat - benign vs attack  (describe = count, mean, std, min, 25%, 50%, 75%, max)")
side = df.groupby("y")["iat"].describe()
side.index = side.index.map({0: "benign", 1: "attack"})
print(side.T)  # transposed: 8 stats as rows, 2 columns -> nothing gets hidden behind "..."

print("\n[1b] iat - per attack type (the 12 with the most rows)")
per_type = (
    df[df["y"] == 1]
    .groupby("label")["iat"]
    .agg(["count", "min", "median", "max"])
    .sort_values("count", ascending=False)
)
print(per_type.head(12))

# ---- EVIDENCE 2: same split, three feature sets ----
# split ONCE -> all three models see exactly the same train/test rows (fair comparison)
X_train, X_test, y_train, y_test = train_test_split(
    df[FEATURES], df["y"], test_size=0.2, stratify=df["y"], random_state=SEED
)


def train_and_score(cols):
    model = RandomForestClassifier(n_estimators=100, random_state=SEED, n_jobs=-1)
    model.fit(X_train[cols], y_train)
    return f1_score(y_test, model.predict(X_test[cols])), model  # F1 of class 1 (attack)


without_iat = [f for f in FEATURES if f != "iat"]
f1_all, model_all = train_and_score(FEATURES)
f1_no_iat, _ = train_and_score(without_iat)
f1_iat_only, _ = train_and_score(["iat"])

print(f"\n[2] F1 (attack = positive)   test rows = {len(y_test)}")
print(f"    all {len(FEATURES)} features   : {f1_all:.4f}")
print(f"    without iat ({len(without_iat)})   : {f1_no_iat:.4f}")
print(f"    iat ONLY (1)      : {f1_iat_only:.4f}")

# ---- EVIDENCE 3: which feature the model relies on ----
imp = pd.Series(model_all.feature_importances_, index=FEATURES).sort_values(ascending=False)
print("\n[3] importance (all-10 model, top 3; total = 1.00)")
for name, val in imp.head(3).items():
    print(f"    {name:<14} {val:.3f}")

ok = len(y_test) > 0 and all(0.0 <= s <= 1.0 for s in (f1_all, f1_no_iat, f1_iat_only))
print("\nSELF-CHECK PASS: 3 F1 scores computed, on the same test rows" if ok else "\nSELF-CHECK FAIL")
sys.exit(0 if ok else 1)
