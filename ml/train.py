# ml/train.py   <-- ye P4 f-step 2 pe ml/ mein daalni hai
#
# Kaam: B1 ka asli model. Random Forest, 9 features - iat NAHI.
# Kyun iat nahi: leak_check.py (24 Sept) mein SIRF iat se F1 = 0.9913 aaya. benign ka iat
# 0 ya ~166.5M, attack ka ~83M - ye packet ka gap nahi, recording ki chhaap hai (shortcut).
#
# Output: confusion matrix, precision / recall / F1, FPR, aur simulator ke 3% attack pe
# precision kitni hogi. Model abhi save NAHI hota - f3 mein ONNX export yahin judega.
#
# Chalana (Git Bash, ml/ folder se):   uv run python train.py

import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight

DEFAULT = Path(__file__).resolve().parent.parent / "api" / "scripts" / "samples.local.json"
SAMPLES = Path(os.environ.get("SAMPLES", DEFAULT))
SEED = 42
SIM_ATTACK_RATIO = 0.03  # api/scripts/simulate.js ka ATTACK_RATIO_NORMAL - dono same rakhna

if not SAMPLES.exists():
    print(f"FAIL: sample file nahi mili: {SAMPLES}")
    sys.exit(1)

data = json.loads(SAMPLES.read_text(encoding="utf-8"))
MODEL_FEATURES = [f for f in data["features"] if f != "iat"]
if len(MODEL_FEATURES) != 9:
    print(f"FAIL: 9 feature chahiye the, mile {len(MODEL_FEATURES)}: {MODEL_FEATURES}")
    sys.exit(1)

rows = data["benign"] + data["attack"]
X = pd.DataFrame([r["metrics"] for r in rows])[MODEL_FEATURES]
y = pd.Series([0 if r["label"] == "BenignTraffic" else 1 for r in rows])  # 1 = attack

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, stratify=y, random_state=SEED
)
print(f"features ({len(MODEL_FEATURES)}): {', '.join(MODEL_FEATURES)}")
print(f"train {len(y_train)} (attack {int(y_train.sum())})   test {len(y_test)} (attack {int(y_test.sum())})")


model = RandomForestClassifier(
    n_estimators=100, class_weight="balanced", random_state=SEED, n_jobs=-1
).fit(X_train, y_train)
pred = model.predict(X_test)

# labels=[0, 1] -> order pakka: pehli line benign, doosri attack
tn, fp, fn, tp = confusion_matrix(y_test, pred, labels=[0, 1]).ravel()
precision = tp / (tp + fp) if tp + fp else 0.0
recall = tp / (tp + fn) if tp + fn else 0.0
fpr = fp / (fp + tn) if fp + tn else 0.0  # benign mein se kitno pe jhootha alarm
f1 = f1_score(y_test, pred)

print("\n[1] confusion matrix (test)")
print("                    model: ATTACK   model: BENIGN")
print(f"    asli ATTACK     TP {tp:>6}      FN {fn:>6}")
print(f"    asli BENIGN     FP {fp:>6}      TN {tn:>6}")

print("\n[2] metrics (attack = positive)")
print(f"    precision {precision:.4f}   recall {recall:.4f}   F1 {f1:.4f}")
print(f"    FPR       {fpr:.4f}   (resolution 1/{fp + tn} = {1 / (fp + tn):.4f})")

# Precision base-rate pe tikti hai; recall aur FPR nahi. Isliye simulator ke ratio pe dobara:
#   precision = recall*r / (recall*r + FPR*(1-r))
r = SIM_ATTACK_RATIO
def precision_at(fpr_value):
    return recall * r / (recall * r + fpr_value * (1 - r)) if recall else 0.0

print(f"\n[3] simulator ratio ({r:.0%} attack) pe precision: {precision_at(fpr):.4f}")
if fp == 0:
    one_fp = 1 / (fp + tn)
    print(f"    (FP = 0 tha; agar 1 FP hota: {precision_at(one_fp):.4f})")

imp = pd.Series(model.feature_importances_, index=MODEL_FEATURES).sort_values(ascending=False)
print("\n[4] importance top 3")
for name, val in imp.head(3).items():
    print(f"    {name:<14} {val:.3f}")

# 'balanced' ka formula: rows / (2 * us class ki rows). 50/50 pe dono = 1.00 -> koi reweighting nahi.
# Phir bhi rakha: kal bada / imbalanced extract aaya to model khud sambhal lega.
w = compute_class_weight("balanced", classes=np.array([0, 1]), y=y_train)
print(f"\n[5] class_weight 'balanced' (train): benign {w[0]:.2f}, attack {w[1]:.2f}")

ok = tp + fn == int(y_test.sum()) and tn + fp == int((y_test == 0).sum()) and 0 <= f1 <= 1
print("\nSELF-CHECK PASS: confusion matrix ke 4 dabbe test rows se match" if ok else "\nSELF-CHECK FAIL")
sys.exit(0 if ok else 1)
