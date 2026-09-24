# ml/train.py   <-- ye P4 f-step 4 pe badli (f4: JSON files LF mein, har OS pe same bytes)
#
# Kaam: B1 ka asli model. Random Forest, 9 features - iat NAHI.
# Kyun iat nahi: leak_check.py (24 Sept) mein SIRF iat se F1 = 0.9913 aaya. benign ka iat
# 0 ya ~166.5M, attack ka ~83M - ye packet ka gap nahi, recording ki chhaap hai (shortcut).
#
# Output: confusion matrix, precision / recall / F1, FPR, aur simulator ke 3% attack pe
# precision kitni hogi. f3: wahi model ml/model.onnx mein, uski meta ml/model.json mein, aur
# test rows + sklearn ke jawab ml/parity.local.json mein (git mein nahi; Node f4 isi se milayega).
#
# Chalana (Git Bash, ml/ folder se):   uv run python train.py

import json
import os
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pandas as pd
import skl2onnx
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight
from skl2onnx import to_onnx
from skl2onnx.common.data_types import FloatTensorType

DEFAULT = Path(__file__).resolve().parent.parent / "api" / "scripts" / "samples.local.json"
SAMPLES = Path(os.environ.get("SAMPLES", DEFAULT))
SEED = 42
SIM_ATTACK_RATIO = 0.03  # api/scripts/simulate.js ka ATTACK_RATIO_NORMAL - dono same rakhna
HERE = Path(__file__).resolve().parent
MODEL_PATH = HERE / "model.onnx"
META_PATH = HERE / "model.json"
PARITY_PATH = HERE / "parity.local.json"  # dataset rows -> .gitignore ke *.local.json rule se bahar

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
if not ok:
    print("\nSELF-CHECK FAIL: confusion matrix test rows se match nahi")
    sys.exit(1)

# ---- f3: ONNX export ----
# float32: sklearn ke trees andar se X ko float32 mein hi badalte hain, isliye ONNX ka
# float32 input wahi threshold comparison karta hai. zipmap False -> probabilities ek
# saada [rows, 2] array; zipmap True hota to har row ek {0: p, 1: p} dict (Node mein jhanjhat).
onx = to_onnx(
    model,
    initial_types=[("input", FloatTensorType([None, len(MODEL_FEATURES)]))],
    options={id(model): {"zipmap": False}},
)
MODEL_PATH.write_bytes(onx.SerializeToString())

# ---- parity: likhi hui FILE ko wapas padh ke, sklearn se har test row pe milao ----
X32 = X_test.to_numpy(dtype=np.float32)
sess = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
onnx_label, onnx_proba = sess.run(["label", "probabilities"], {"input": X32})
sk_proba = model.predict_proba(X_test)[:, 1]
max_diff = float(np.abs(onnx_proba[:, 1] - sk_proba).max())
label_mismatch = int((onnx_label != pred).sum())
ties = int((sk_proba == 0.5).sum())  # 50-50 vote: float32 ka jod kisi bhi taraf jhuk sakta

size_kb = MODEL_PATH.stat().st_size / 1024
ops = sorted({n.op_type for n in onx.graph.node})
print(f"\n[6] ONNX: {MODEL_PATH.name} {size_kb:,.0f} KB   op {', '.join(ops)}")
print(f"    parity ({len(X32)} test rows): max |proba diff| {max_diff:.2e}   label mismatch {label_mismatch}   50-50 ties {ties}")

META_PATH.write_text(json.dumps({
    "features": MODEL_FEATURES,
    "dropped": {"iat": "leak: IAT alone gave F1 0.9913 (ml/leak_check.py)"},
    "input": "input",
    "outputs": ["label", "probabilities"],
    "positive_class": 1,
    "versions": {"scikit-learn": sklearn.__version__, "skl2onnx": skl2onnx.__version__,
                 "onnxruntime": ort.__version__},
    "test": {"rows": len(y_test), "precision": round(precision, 4), "recall": round(recall, 4),
             "f1": round(float(f1), 4), "fpr": round(fpr, 4),
             "precision_at_sim_ratio": round(precision_at(fpr), 4), "sim_attack_ratio": r},
}, indent=2) + "\n", encoding="utf-8", newline="\n")  # Windows pe bhi LF (warna CRLF)

# Node (f4) yahi rows Float32Array bana ke chalayega aur ye probabilities milayega.
PARITY_PATH.write_text(json.dumps({
    "features": MODEL_FEATURES,
    "rows": X_test.to_numpy().tolist(),
    "proba_attack": [round(float(p), 6) for p in sk_proba],
}) + "\n", encoding="utf-8", newline="\n")
print(f"    likha: {MODEL_PATH.name}, {META_PATH.name}, {PARITY_PATH.name}")

if max_diff < 1e-5 and label_mismatch <= ties:
    print("\nSELF-CHECK PASS: metrics sahi + ONNX file sklearn se har test row pe match")
    sys.exit(0)
print("\nSELF-CHECK FAIL: ONNX aur sklearn alag jawab de rahe")
sys.exit(1)
