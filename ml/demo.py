#
# Builds api/scripts/samples.local.json for the simulator - ONLY from the pool's DEMO split
# (5%). The model never saw these rows in train, val (threshold) or test.
# Previously 80% of the demo rows were training rows -> the dashboard's red dot was "memorized", not detected.
#
# Same format that simulate.js reads: { features (10, including iat), benign: [{metrics, label}],
# attack: [...] }. iat is sent in the body but the model does not use it (the 9 features in model.json).
#
# Run (Git Bash, from the ml/ folder):   uv run python demo.py

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", HERE.parent / "data"))
POOL = DATA_DIR / "pool.npz"
OUT = HERE.parent / "api" / "scripts" / "samples.local.json"
BENIGN = "BenignTraffic"

if not POOL.exists():
    print(f"FAIL: {POOL} not found - run first: uv run python pool.py")
    sys.exit(1)

z = np.load(POOL)
features = [str(f) for f in z["features"]]
labels = np.array(z["labels"])
kind = labels[z["label_id"]]
split_id = z["split_id"]
splits = list(z["splits"])
DEMO, TRAIN = splits.index("demo"), splits.index("train")
X = z["X"]

demo = split_id == DEMO
rows = {"benign": [], "attack": []}
for x, k in zip(X[demo], kind[demo]):
    # float() -> a plain number in JSON (json.dumps cannot serialize numpy float64)
    r = {"metrics": {f: float(v) for f, v in zip(features, x)}, "label": str(k)}
    rows["benign" if k == BENIGN else "attack"].append(r)

OUT.write_text(json.dumps({
    "source": "CICIoT2023 - ml/pool.py DEMO split (P9-d): no row used for train, val or test",
    "features": features,
    "extracted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "benign": rows["benign"],
    "attack": rows["attack"],
}) + "\n", encoding="utf-8", newline="\n")

types = sorted({r["label"] for r in rows["attack"]})
print(f"demo: {len(rows['benign']):,} benign + {len(rows['attack']):,} attack ({len(types)} attack types)")

# Twin check: how many demo rows have the EXACT same 9-feature vector as some train row (different
# packet, same shape - happens with floods). Not row sharing, but worth reporting.
nine = [features.index(f) for f in features if f != "iat"]
train_set = {r.tobytes() for r in X[split_id == TRAIN][:, nine]}
twins = sum(r.tobytes() in train_set for r in X[demo][:, nine])
print(f"demo rows with an exact twin (9 features) in train: {twins:,} / {int(demo.sum()):,} ({twins / demo.sum():.1%})")
mb = OUT.stat().st_size / 1e6
print(f"-> {OUT} ({mb:.1f} MB)")

problems = []
if len(types) != 33:
    problems.append(f"expected 33 attack types, got {len(types)}")
if any(r["label"] == BENIGN for r in rows["attack"]) or any(r["label"] != BENIGN for r in rows["benign"]):
    problems.append("wrong label in a bucket")
if len(features) != 10 or "iat" not in features:
    problems.append("need 10 features (including iat) - the simulator format")
if problems:
    print("\nSELF-CHECK FAIL: " + "; ".join(problems))
    sys.exit(1)
print("\nSELF-CHECK PASS: only demo-split rows, 33 attack types, simulator format")
