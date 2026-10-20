"""Fill in `difficulty` for strategy exercises with Maia-2 (MIT, rapid model, CPU).

Usage: python difficulty.py [--models maia2_models_dir] FILE.json [FILE.json ...]

For each exercise and each rating R in 800, 1000, ..., 2200 (both players at R), P(R) is the
Maia-2 probability that a human plays any answer worth >= 8 points. difficulty = the lowest R
with P(R) >= 0.4; 2400 if never reached. Files are updated in place.

Install: maia2 pins old versions (pyzstd 0.15.9 does not build on Python 3.13), so use
  pip install --no-deps maia2 && pip install einops gdown pyyaml tqdm pyzstd
Note: Maia-2 buckets ratings as <1100, 1100..1999 by 100, >=2000, so 800/1000 and 2000/2200
get identical predictions.
"""
import argparse
import json
import os

import torch
from maia2 import inference, model as maia_model
from maia2.utils import mirror_move

RATINGS = list(range(800, 2201, 200))
THRESHOLD, GOOD_POINTS, CAP = 0.4, 8, 2400


def good_move_probs(net, prepared, items, batch_size=256):
    """items: [(fen, [good uci moves])] -> [[P(good) for each rating]]."""
    all_moves_dict, elo_dict, _ = prepared
    rows = []  # (item index, rating index, board, elo, legal mask, good indices)
    for i, (fen, good) in enumerate(items):
        black = fen.split()[1] == "b"
        idx = [all_moves_dict[mirror_move(u) if black else u] for u in good]
        for j, r in enumerate(RATINGS):
            b, es, eo, legal = inference.preprocessing(fen, r, r, elo_dict, all_moves_dict)
            rows.append((i, j, b, es, legal, idx))
    out = [[0.0] * len(RATINGS) for _ in items]
    net.eval()
    with torch.no_grad():
        for k in range(0, len(rows), batch_size):
            chunk = rows[k:k + batch_size]
            boards = torch.stack([c[2] for c in chunk])
            elos = torch.tensor([c[3] for c in chunk])
            legal = torch.stack([c[4] for c in chunk])
            logits, _, _ = net(boards, elos, elos)
            probs = inference._masked_softmax(logits, legal)
            for c, p in zip(chunk, probs):
                out[c[0]][c[1]] = float(p[c[5]].sum())
    return out


def difficulty(ps):
    for r, p in zip(RATINGS, ps):
        if p >= THRESHOLD:
            return r
    return CAP


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--models", default="./maia2_models")
    ap.add_argument("--threads", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    net = maia_model.from_pretrained(type="rapid", device="cpu", save_root=a.models)
    prepared = inference.prepare()
    for path in a.files:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        items = [(e["fen"], [u for u, p in e["answers"] if p >= GOOD_POINTS]) for e in data]
        probs = good_move_probs(net, prepared, items)
        hist = {}
        for e, ps in zip(data, probs):
            e["difficulty"] = difficulty(ps)
            hist[e["difficulty"]] = hist.get(e["difficulty"], 0) + 1
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"{os.path.basename(path)}: {len(data)} exercises, difficulty histogram "
              + ", ".join(f"{k}:{hist[k]}" for k in sorted(hist)))


if __name__ == "__main__":
    main()
