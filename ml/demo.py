# ml/demo.py   <-- ye P9-d pe daalni hai (NAYI file; api/scripts/extract.js ki jagah)
#
# Kaam: simulator ke liye api/scripts/samples.local.json banana - SIRF pool ke DEMO hisse se
# (5%, P9-a). Ye rows model ne na train mein dekhi, na val (threshold) mein, na test mein.
# Pehle (P4) demo ki 80% rows training ki thi -> dashboard ka laal dot "yaad" tha, pehchaan nahi.
#
# Format wahi jo simulate.js padhta hai: { features (10, iat samet), benign: [{metrics, label}],
# attack: [...] }. iat body mein jaata hai par model use nahi karta (model.json ke 9 features).
#
# Chalana (Git Bash, ml/ folder se):   uv run python demo.py

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
    print(f"FAIL: {POOL} nahi mili - pehle P9-a: uv run python pool.py")
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
    # float() -> JSON mein saada number (numpy float64 json.dumps nahi hota)
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

# Twin check: demo ki kitni rows ka EXACT same 9-feature vector train mein bhi hai (alag packet,
# same shakal - floods mein hota hai). Row-share nahi, par batana zaroori.
nine = [features.index(f) for f in features if f != "iat"]
train_set = {r.tobytes() for r in X[split_id == TRAIN][:, nine]}
twins = sum(r.tobytes() in train_set for r in X[demo][:, nine])
print(f"demo rows jinka exact twin (9 feature) train mein: {twins:,} / {int(demo.sum()):,} ({twins / demo.sum():.1%})")
mb = OUT.stat().st_size / 1e6
print(f"-> {OUT} ({mb:.1f} MB)")

problems = []
if len(types) != 33:
    problems.append(f"33 attack types chahiye, mile {len(types)}")
if any(r["label"] == BENIGN for r in rows["attack"]) or any(r["label"] != BENIGN for r in rows["benign"]):
    problems.append("bucket mein galat label")
if len(features) != 10 or "iat" not in features:
    problems.append("10 features (iat samet) chahiye - simulator ka format")
if problems:
    print("\nSELF-CHECK FAIL: " + "; ".join(problems))
    sys.exit(1)
print("\nSELF-CHECK PASS: sirf demo hisse ki rows, 33 attack types, simulator wala format")
