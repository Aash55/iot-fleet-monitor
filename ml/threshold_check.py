# ml/threshold_check.py   <-- ye P7 f-step 0 pe daalni hai (NAYI file)
#
# Kaam (IPS se pehle): "block kab karein?" ka threshold ANDAZE se nahi, data se chunna.
# Detect (IDS) mein galat alarm = ek faltu laal dot. Prevent (IPS) mein galat alarm = asli
# traffic DROP. Isliye block ka threshold 0.5 se upar ho sakta hai - kitna, ye yahan naapte hain.
#
# Wahi 800 held-out rows (train.py jaisa split, SEED 42) aur wahi EXPORTED ml/model.onnx
# (dobara train NAHI). Saath mein: 0.5 pe jo attack chhoot gaye (FN), wo kaunse attack types hain.
#
# Chalana (Git Bash, ml/ folder se):   uv run python threshold_check.py

import json
import os
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pandas as pd
from sklearn.model_selection import train_test_split

HERE = Path(__file__).resolve().parent
DEFAULT = HERE.parent / "api" / "scripts" / "samples.local.json"
SAMPLES = Path(os.environ.get("SAMPLES", DEFAULT))
SEED = 42  # train.py jaisa - alag hua to test rows alag, aur numbers bekaar
SIM_ATTACK_RATIO = 0.03
THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]

if not SAMPLES.exists():
    print(f"FAIL: sample file nahi mili: {SAMPLES}")
    sys.exit(1)

meta = json.loads((HERE / "model.json").read_text(encoding="utf-8"))
features = meta["features"]  # ORDER yahin se, jaise Node leta hai

data = json.loads(SAMPLES.read_text(encoding="utf-8"))
rows = data["benign"] + data["attack"]
X = pd.DataFrame([r["metrics"] for r in rows])[features]
y = pd.Series([0 if r["label"] == "BenignTraffic" else 1 for r in rows])
kind = pd.Series([r["label"] for r in rows])  # attack ka naam (DDoS-..., Mirai-...)

# train.py wala split: same X ke columns order, same y, same test_size/stratify/seed -> same rows
_, X_test, _, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=SEED)
if len(y_test) != meta["test"]["rows"]:
    print(f"FAIL: test rows {len(y_test)}, model.json kehta {meta['test']['rows']} - split alag hai")
    sys.exit(1)

sess = ort.InferenceSession(str(HERE / "model.onnx"), providers=["CPUExecutionProvider"])
_, proba = sess.run(["label", "probabilities"], {meta["input"]: X_test.to_numpy(dtype=np.float32)})
p_attack = proba[:, 1]
truth = y_test.to_numpy()
n_benign = int((truth == 0).sum())

print(f"test rows {len(truth)} (attack {int(truth.sum())}, benign {n_benign})   model.onnx (exported)")
print("\n[1] threshold ke hisaab se (block agar attack_proba >= T)")
print("     T     TP   FN   FP   TN   recall   FPR      precision@3%")
r = SIM_ATTACK_RATIO
for t in THRESHOLDS:
    flag = p_attack >= t
    tp = int((flag & (truth == 1)).sum()); fn = int((~flag & (truth == 1)).sum())
    fp = int((flag & (truth == 0)).sum()); tn = int((~flag & (truth == 0)).sum())
    recall = tp / (tp + fn); fpr = fp / (fp + tn)
    prec = recall * r / (recall * r + fpr * (1 - r)) if recall else 0.0
    print(f"  {t:>5.2f}  {tp:>4} {fn:>4} {fp:>4} {tn:>4}   {recall:.4f}   {fpr:.4f}   {prec:.4f}")

# FP = 0 ka matlab FPR = 0 NAHI: 400 mein 0 dikha. "Rule of three": 95% upper bound ~ 3/n.
print(f"\n    Note: FP 0/{n_benign} pe bhi asli FPR ~{3 / n_benign:.4f} tak ho sakta (rule of three, 95%).")

# 0.5 wale default pe chhoote attacks (FN) kis type ke hain - interview: "kaunse attack miss hote?"
missed = (p_attack < 0.5) & (truth == 1)
missed_kinds = Counter(kind.loc[y_test.index[missed]])
total_kinds = Counter(kind.loc[y_test.index[truth == 1]])
print(f"\n[2] 0.5 pe chhoote attack ({int(missed.sum())}) - type ke hisaab se")
for name, c in missed_kinds.most_common():
    print(f"    {name:<28} {c:>3} miss  /  {total_kinds[name]:>3} test mein")

print("\nSELF-CHECK PASS: split model.json se match, har threshold ki ginti 800 rows ki")
