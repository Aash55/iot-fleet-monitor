# ml/pool.py   <-- ye P9-a pe daalni hai (NAYI file)
#
# Kaam: data/ ke saare CICIoT2023 CSV (13 GB, ~170 file) EK baar padho, aur har label
# (BenignTraffic + 33 attack types) se ek random, fixed-size sample nikaalo. Phir har row
# ko 4 ALAG hisson mein baanto - koi row do hisson mein nahi:
#     train (65%)  -> model yahin seekhega (learning curve isi ke 2k/20k/100k tukde lega)
#     val   (15%)  -> threshold (0.5 / 0.9) yahin tune hoga
#     test  (15%)  -> final number, SIRF ek baar
#     demo  ( 5%)  -> simulator ke rows (model ne kabhi nahi dekhe)
# Output: data/pool.npz (~30 MB) + data/pool_stats.json. data/ gitignored hai.
#
# Chalana (Git Bash, ml/ folder se):   uv run python pool.py
#   --workers 4         kitne CSV ek saath padhein (har worker ~200-300 MB RAM)
#   --attack-cap 6000   har attack type se max itni rows
#   --benign-cap 200000 benign se max itni rows

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

# extract.js wale wahi 10 feature (NORMALIZED naam). iat pool mein rehta hai (simulator ka
# format same rahe); model train.py mein use nahi karta (leak).
FEATURES = [
    "flow_duration", "header_length", "protocol_type", "duration", "rate",
    "syn_count", "rst_count", "urg_count", "tot_size", "iat",
]
LABEL = "label"

# Hisse: [0, 0.15) test, [0.15, 0.30) val, [0.30, 0.35) demo, baaki train
SPLITS = ["train", "val", "test", "demo"]
CUTS = [("test", 0.15), ("val", 0.15), ("demo", 0.05)]


def normalize(name):
    # extract.js jaisa: "Tot size" -> tot_size, "Header_Length" -> header_length
    return "_".join(name.strip().lower().replace("-", " ").split())


def keep_smallest(keys, X, cap):
    """keys mein sabse chhote `cap` wale rakho (bottom-k). Chhota tag = sample mein."""
    if len(keys) <= cap:
        return keys, X
    idx = np.argpartition(keys, cap - 1)[:cap]
    return keys[idx], X[idx]


def read_one(path, caps):
    """Ek CSV: sirf 11 column padho, kharab rows hatao, har label ka bottom-k lautao."""
    header = pd.read_csv(path, nrows=0).columns
    by_norm = {normalize(c): c for c in header}
    missing = [w for w in FEATURES + [LABEL] if w not in by_norm]
    if missing:
        return {"file": path.name, "error": f"column nahi mile: {missing}"}

    df = pd.read_csv(path, usecols=[by_norm[w] for w in FEATURES + [LABEL]],
                     dtype={by_norm[LABEL]: str}, low_memory=False)
    df.columns = [normalize(c) for c in df.columns]
    rows = len(df)

    X = df[FEATURES].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=np.float64)
    labels = df[LABEL].fillna("").str.strip().to_numpy()
    good = np.isfinite(X).all(axis=1) & (labels != "")   # khaali / inf / NaN / text = bahar
    X, labels = X[good], labels[good]

    # Har row ko ek random "tag" (0-1). Seed FILE KE NAAM se - to workers kitne bhi hon,
    # kaun si file pehle khatam ho, har row ka tag wahi rahega -> output hamesha same.
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
        print(f"FAIL: {DATA_DIR} mein ek bhi .csv nahi")
        sys.exit(1)
    size_gb = sum(p.stat().st_size for p in files) / 1e9
    print(f"{len(files)} CSV, {size_gb:.1f} GB   workers {args.workers}   "
          f"cap: attack {args.attack_cap:,}/type, benign {args.benign_cap:,}")

    pool = {}      # label -> (tags, X): chalta hua bottom-k, har file ke baad merge
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
            # Merge: global bottom-k = (purana bottom-k + is file ka bottom-k) ka bottom-k.
            # RAM mein kabhi bhi sirf ~cap rows per label -> 13 GB bhi chhote RAM mein.
            for lab, (tg, X) in r["keep"].items():
                if lab in pool:
                    tg = np.concatenate([pool[lab][0], tg])
                    X = np.vstack([pool[lab][1], X])
                cap = caps["benign"] if lab == BENIGN else caps["attack"]
                pool[lab] = keep_smallest(tg, X, cap)
            done += 1
            if done % 10 == 0 or done == len(files):
                print(f"  {done}/{len(files)} file   {rows_read:,} row   {time.time() - t0:.0f} s")

    # ---- 4 hisse. Har label ke andar tag se sort -> random order. Pehle 15% test, agle
    # 15% val, agle 5% demo, baaki train. Train bhi tag-order mein -> learning curve ke
    # 2k, 20k, 100k tukde NESTED (2k wale rows 20k mein bhi hain), sirf data ka size badle.
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
        rank = np.zeros(n, dtype=np.int32)   # train ke andar position (0 = sabse pehle chuna)
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
    print(f"\nrows read {rows_read:,}   skipped {skipped:,} (khaali/inf/NaN)   {time.time() - t0:.0f} s")
    print(f"labels {len(labels)} (benign 1 + attack {len(labels) - (BENIGN in labels)})\n")
    print(f"  {'label':<26}{'dataset mein':>13}{'liya':>9}{'train':>8}{'val':>7}{'test':>7}{'demo':>7}")
    for lab in sorted(labels, key=lambda l: per_label[l]["seen"]):
        s = per_label[lab]
        print(f"  {lab:<26}{s['seen']:>13,}{s['kept']:>9,}{s['train']:>8,}{s['val']:>7,}{s['test']:>7,}{s['demo']:>7,}")
    tot = {sp: int((split_id == i).sum()) for i, sp in enumerate(SPLITS)}
    print(f"\n  total: {len(X):,} rows = " + " + ".join(f"{sp} {n:,}" for sp, n in tot.items()))

    # ---- Self-check ----
    problems = []
    if len(labels) != 34:
        problems.append(f"34 label chahiye (CICIoT2023), mile {len(labels)}")
    if BENIGN not in labels:
        problems.append("BenignTraffic nahi mila")
    if not np.isfinite(X).all():
        problems.append("pool mein inf/NaN bacha")
    if sum(tot.values()) != len(X):
        problems.append("hisson ka jod != total rows (koi row do jagah / gayab)")
    # Twin check: test ki kitni rows ka EXACT same feature vector train mein bhi hai.
    # Ye row-share nahi (alag packets), par flood attacks mein same shakal baar-baar aati hai.
    feat9 = [FEATURES.index(f) for f in FEATURES if f != "iat"]
    tr = {r.tobytes() for r in X[split_id == SPLITS.index("train")][:, feat9]}
    te = X[split_id == SPLITS.index("test")][:, feat9]
    twins = sum(r.tobytes() in tr for r in te)
    print(f"  test rows jinka exact twin (9 feature) train mein bhi: {twins:,} / {len(te):,} "
          f"({twins / max(len(te), 1):.1%})")

    mb = OUT_NPZ.stat().st_size / 1e6
    print(f"\n-> {OUT_NPZ} ({mb:.1f} MB)\n-> {OUT_STATS}")
    if problems:
        print("\nSELF-CHECK FAIL: " + "; ".join(problems))
        sys.exit(1)
    print("\nSELF-CHECK PASS: 34 label, koi inf/NaN nahi, har row sirf ek hisse mein")


if __name__ == "__main__":   # Windows pe workers "spawn" hote hain - ye guard zaroori
    main()
