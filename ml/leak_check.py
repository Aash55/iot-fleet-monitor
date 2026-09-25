# ml/leak_check.py   <-- ye P9-d pe badli (P4 f-step 1: nayi; P9-d: sirf hint - samples ab ml/demo.py se)
#
# Kaam: P3.4 ka shak check karna - kya "iat" column model ko jawab chupke se bata raha hai?
# (leak = aisi jaankari jo asli duniya mein prediction ke waqt nahi milegi, par data mein hai)
#
# Teen saboot, ek hi run mein:
#   1) iat ki range: benign vs attack, aur har attack type alag-alag
#   2) SAME rows, SAME model, teen feature set: saare 10 / iat hata ke 9 / sirf iat
#   3) saare-10 wale model ne kis feature pe sabse zyada bharosa kiya (importance)
#
# Chalana (Git Bash, ml/ folder se):   uv run python leak_check.py

import json
import os
import sys
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score
from sklearn.model_selection import train_test_split

# ml/demo.py ye file banata hai (P9-d; pehle extract.js) - gitignored, sirf tere laptop pe hai
DEFAULT = Path(__file__).resolve().parent.parent / "api" / "scripts" / "samples.local.json"
SAMPLES = Path(os.environ.get("SAMPLES", DEFAULT))
SEED = 42  # har baar same split + same trees -> tere aur mere numbers compare ho sakein

if not SAMPLES.exists():
    print(f"FAIL: sample file nahi mili: {SAMPLES}")
    print("      ml/ folder se pehle chala:  uv run python demo.py")
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
    print("FAIL: dono class mein kam se kam 100 row chahiye")
    sys.exit(1)
if "iat" not in FEATURES:
    print(f"FAIL: features mein iat nahi hai: {FEATURES}")
    sys.exit(1)

# Ek aur leak: bilkul same row train aur test dono mein -> model ratta maar ke pass
dups = int(df.duplicated(subset=FEATURES).sum())
print(f"exact duplicate rows (10 features same): {dups}")

# ---- SABOOT 1: iat ki range ----
pd.set_option("display.float_format", "{:,.0f}".format)
pd.set_option("display.width", 120)
print("\n[1] iat - benign vs attack  (describe = count, mean, std, min, 25%, 50%, 75%, max)")
side = df.groupby("y")["iat"].describe()
side.index = side.index.map({0: "benign", 1: "attack"})
print(side.T)  # ulta kiya: 8 stat neeche, 2 column -> "..." se kuchh nahi chhupta

print("\n[1b] iat - har attack type (sabse zyada row wale 12)")
per_type = (
    df[df["y"] == 1]
    .groupby("label")["iat"]
    .agg(["count", "min", "median", "max"])
    .sort_values("count", ascending=False)
)
print(per_type.head(12))

# ---- SABOOT 2: same split, teen feature set ----
# split EK baar -> teeno model bilkul same train/test rows dekhte hain (fair comparison)
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
print(f"    saare {len(FEATURES)} features : {f1_all:.4f}")
print(f"    iat HATA ke ({len(without_iat)})   : {f1_no_iat:.4f}")
print(f"    SIRF iat (1)       : {f1_iat_only:.4f}")

# ---- SABOOT 3: model ka bharosa kis pe ----
imp = pd.Series(model_all.feature_importances_, index=FEATURES).sort_values(ascending=False)
print("\n[3] importance (saare-10 model, top 3; total = 1.00)")
for name, val in imp.head(3).items():
    print(f"    {name:<14} {val:.3f}")

ok = len(y_test) > 0 and all(0.0 <= s <= 1.0 for s in (f1_all, f1_no_iat, f1_iat_only))
print("\nSELF-CHECK PASS: 3 F1 bane, same test rows pe" if ok else "\nSELF-CHECK FAIL")
sys.exit(0 if ok else 1)
