# ml/pool.py
#
# Reads every CICIoT2023 CSV in data/ (13 GB, ~170 files) ONCE and draws a random, fixed-size
# sample from each label (BenignTraffic + 33 attack types). Each sampled row is then assigned
# to one of 4 SEPARATE splits - no row is in two splits:
#     train (65%)  -> the model learns from this (the learning curve takes its 2k/20k/100k slices)
#     val   (15%)  -> the threshold (0.5 / 0.9) is tuned here
#     test  (15%)  -> the final number, used ONLY once
#     demo  ( 5%)  -> rows for the simulator (never seen by the model)
# Output: data/pool.npz (~30 MB) + data/pool_stats.json. data/ is gitignored.
#
# Run (Git Bash, from the ml/ folder):   uv run python pool.py
#   --workers 4         how many CSVs to read in parallel (each worker ~200-300 MB RAM)
#   --attack-cap 6000   max rows kept per attack type
#   --benign-cap 200000 max benign rows kept

import argparse
import json
import os
import sys
import time
import zlib
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", HERE.parent / "data"))
OUT_NPZ = DATA_DIR / "pool.npz"
OUT_STATS = DATA_DIR / "pool_stats.json"
SEED = 42
BENIGN = "BenignTraffic"

# The same 10 features fixed early in the project (previously in api/scripts/extract.js; NORMALIZED names). iat stays
# in the pool (so the simulator format stays the same); the model in train.py does not use it (leak).
FEATURES = [
    "flow_duration", "header_length", "protocol_type", "duration", "rate",
    "syn_count", "rst_count", "urg_count", "tot_size", "iat",
]
LABEL = "label"

# Splits: [0, 0.15) test, [0.15, 0.30) val, [0.30, 0.35) demo, the rest train
SPLITS = ["train", "val", "test", "demo"]
CUTS = [("test", 0.15), ("val", 0.15), ("demo", 0.05)]


def normalize(name):
    # Column-name normalization: "Tot size" -> tot_size, "Header_Length" -> header_length
    return "_".join(name.strip().lower().replace("-", " ").split())


def keep_smallest(keys, X, cap):
    """Keep the `cap` smallest keys (bottom-k). A small tag = in the sample."""
    if len(keys) <= cap:
        return keys, X
    idx = np.argpartition(keys, cap - 1)[:cap]
    return keys[idx], X[idx]


def read_one(path, caps):
    """One CSV: read only the 11 columns, drop bad rows, return the bottom-k for each label."""
    header = pd.read_csv(path, nrows=0).columns
    by_norm = {normalize(c): c for c in header}
    missing = [w for w in FEATURES + [LABEL] if w not in by_norm]
    if missing:
        return {"file": path.name, "error": f"columns not found: {missing}"}

    df = pd.read_csv(path, usecols=[by_norm[w] for w in FEATURES + [LABEL]],
                     dtype={by_norm[LABEL]: str}, low_memory=False)
    df.columns = [normalize(c) for c in df.columns]
    rows = len(df)

    X = df[FEATURES].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=np.float64)
    labels = df[LABEL].fillna("").str.strip().to_numpy()
    good = np.isfinite(X).all(axis=1) & (labels != "")   # empty / inf / NaN / text = dropped
    X, labels = X[good], labels[good]

    # Give each row a random "tag" (0-1). Seeded by the FILE NAME - so no matter how many workers
    # run or which file finishes first, each row keeps the same tag -> the output is always identical.
    rng = np.random.default_rng([SEED, zlib.crc32(path.name.encode())])
    tags = rng.random(len(X))

    out = {}
    seen = {}
    for lab in np.unique(labels):
        m = labels == lab
        seen[lab] = int(m.sum())
        cap = caps["benign"] if lab == BENIGN else caps["attack"]
        out[lab] = keep_smallest(tags[m], X[m], cap)
    return {"file": path.name, "rows": rows, "skipped": int((~good).sum()), "seen": seen, "keep": out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    ap.add_argument("--attack-cap", type=int, default=6000)
    ap.add_argument("--benign-cap", type=int, default=200_000)
    args = ap.parse_args()
    caps = {"attack": args.attack_cap, "benign": args.benign_cap}

    files = sorted(p for p in DATA_DIR.iterdir() if p.suffix.lower() == ".csv") if DATA_DIR.exists() else []
    if not files:
        print(f"FAIL: no .csv files in {DATA_DIR}")
        sys.exit(1)
    size_gb = sum(p.stat().st_size for p in files) / 1e9
    print(f"{len(files)} CSV, {size_gb:.1f} GB   workers {args.workers}   "
          f"cap: attack {args.attack_cap:,}/type, benign {args.benign_cap:,}")

    pool = {}      # label -> (tags, X): running bottom-k, merged after each file
    seen, rows_read, skipped, done = {}, 0, 0, 0
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(read_one, p, caps) for p in files]
        for fut in as_completed(futs):
            r = fut.result()
            if "error" in r:
                print(f"FAIL: {r['file']}: {r['error']}")
                ex.shutdown(cancel_futures=True)
                sys.exit(1)
            rows_read += r["rows"]
            skipped += r["skipped"]
            for lab, n in r["seen"].items():
                seen[lab] = seen.get(lab, 0) + n
            # Merge: global bottom-k = bottom-k of (previous bottom-k + this file's bottom-k).
            # RAM only ever holds ~cap rows per label -> even 13 GB fits in a small amount of RAM.
            for lab, (tg, X) in r["keep"].items():
                if lab in pool:
                    tg = np.concatenate([pool[lab][0], tg])
                    X = np.vstack([pool[lab][1], X])
                cap = caps["benign"] if lab == BENIGN else caps["attack"]
                pool[lab] = keep_smallest(tg, X, cap)
            done += 1
            if done % 10 == 0 or done == len(files):
                print(f"  {done}/{len(files)} file   {rows_read:,} row   {time.time() - t0:.0f} s")

    # ---- 4 splits. Within each label, sort by tag -> random order. First 15% test, next
    # 15% val, next 5% demo, the rest train. Train is also in tag order -> the learning curve's
    # 2k, 20k, 100k slices are NESTED (the 2k rows are also in the 20k), only the data size changes.
    labels = sorted(pool)
    Xs, lab_ids, split_ids, ranks = [], [], [], []
    per_label = {}
    for i, lab in enumerate(labels):
        tg, X = pool[lab]
        order = np.argsort(tg, kind="stable")
        X = X[order]
        n = len(X)
        split = np.full(n, SPLITS.index("train"), dtype=np.int8)
        start = 0
        counts = {}
        for name, frac in CUTS:
            k = int(round(n * frac))
            split[start:start + k] = SPLITS.index(name)
            counts[name] = k
            start += k
        counts["train"] = n - start
        rank = np.zeros(n, dtype=np.int32)   # position within train (0 = picked first)
        rank[start:] = np.arange(n - start)
        Xs.append(X)
        lab_ids.append(np.full(n, i, dtype=np.int16))
        split_ids.append(split)
        ranks.append(rank)
        per_label[lab] = {"seen": seen[lab], "kept": n, **counts}

    X = np.vstack(Xs)
    label_id = np.concatenate(lab_ids)
    split_id = np.concatenate(split_ids)
    rank = np.concatenate(ranks)
    np.savez_compressed(OUT_NPZ, X=X, label_id=label_id, split_id=split_id, rank=rank,
                        labels=np.array(labels), features=np.array(FEATURES), splits=np.array(SPLITS))

    stats = {"files": len(files), "gb": round(size_gb, 2), "rows_read": rows_read,
             "rows_skipped": skipped, "caps": caps, "seed": SEED, "labels": per_label}
    OUT_STATS.write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8", newline="\n")

    # ---- Report ----
    print(f"\nrows read {rows_read:,}   skipped {skipped:,} (empty/inf/NaN)   {time.time() - t0:.0f} s")
    print(f"labels {len(labels)} (benign 1 + attack {len(labels) - (BENIGN in labels)})\n")
    print(f"  {'label':<26}{'in dataset':>13}{'kept':>9}{'train':>8}{'val':>7}{'test':>7}{'demo':>7}")
    for lab in sorted(labels, key=lambda l: per_label[l]["seen"]):
        s = per_label[lab]
        print(f"  {lab:<26}{s['seen']:>13,}{s['kept']:>9,}{s['train']:>8,}{s['val']:>7,}{s['test']:>7,}{s['demo']:>7,}")
    tot = {sp: int((split_id == i).sum()) for i, sp in enumerate(SPLITS)}
    print(f"\n  total: {len(X):,} rows = " + " + ".join(f"{sp} {n:,}" for sp, n in tot.items()))

    # ---- Self-check ----
    problems = []
    if len(labels) != 34:
        problems.append(f"expected 34 labels (CICIoT2023), got {len(labels)}")
    if BENIGN not in labels:
        problems.append("BenignTraffic not found")
    if not np.isfinite(X).all():
        problems.append("inf/NaN left in the pool")
    if sum(tot.values()) != len(X):
        problems.append("sum of splits != total rows (a row is in two splits / missing)")
    # Twin check: how many test rows have the EXACT same feature vector as some train row.
    # This is not row sharing (different packets), but flood attacks repeat the same shape over and over.
    feat9 = [FEATURES.index(f) for f in FEATURES if f != "iat"]
    tr = {r.tobytes() for r in X[split_id == SPLITS.index("train")][:, feat9]}
    te = X[split_id == SPLITS.index("test")][:, feat9]
    twins = sum(r.tobytes() in tr for r in te)
    print(f"  test rows with an exact twin (9 features) in train: {twins:,} / {len(te):,} "
          f"({twins / max(len(te), 1):.1%})")

    mb = OUT_NPZ.stat().st_size / 1e6
    print(f"\n-> {OUT_NPZ} ({mb:.1f} MB)\n-> {OUT_STATS}")
    if problems:
        print("\nSELF-CHECK FAIL: " + "; ".join(problems))
        sys.exit(1)
    print("\nSELF-CHECK PASS: 34 labels, no inf/NaN, every row in exactly one split")


if __name__ == "__main__":   # on Windows workers are "spawned" - this guard is required
    main()
