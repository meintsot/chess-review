"""Build public/data/strategy/sts.json from the Strategic Test Suite (MIT).

Usage: python build_sts.py --epd STS1-STS15_LAN_v3.epd --stockfish <path> [--work dir] [--procs 12]

Every position is re-verified with Stockfish (MultiPV 5, depth 20). A position is kept only if
the STS top move is within 30 cp of Stockfish's best. Points are recomputed for every STS
candidate (c9) plus Stockfish's top 5: 10 for the best, round(10*exp(-loss/60)) for the rest,
dropping moves under 2. `difficulty` is left null here and filled in by difficulty.py.
"""
import argparse
import json
import os
import re
from multiprocessing import Pool

import chess

import common
from structures import structure_ids

URL = "https://raw.githubusercontent.com/fsmosca/STS-Rating/master/STS1-STS15_LAN_v3.epd"
DEPTH, MPV, TOLERANCE = 20, 5, 30
SLUGS = {1: "undermine", 2: "open-files", 3: "knight-outposts", 4: "square-vacancy",
         5: "bishop-vs-knight", 6: "recapturing", 7: "offer-simplification", 8: "kingside-pawns",
         9: "queenside-pawns", 10: "simplification", 11: "king-activity", 12: "center-control",
         13: "center-pawns", 14: "seventh-rank", 15: "avoid-exchange"}


def parse(line):
    fen = " ".join(line.split()[:4]) + " 0 1"
    ops = dict(re.findall(r'(\w+) "([^"]*)"', line))
    m = re.match(r"STS\(v(\d+)\.\d+\).*\.(\d+)$", ops["id"])
    num, idx = int(m.group(1)), m.group(2)
    moves, pts = ops["c9"].split(), [int(x) for x in ops["c8"].split()]
    return {"id": f"{SLUGS[num]}.{idx}", "theme": SLUGS[num], "fen": fen,
            "sts": dict(zip(moves, pts))}


def analyse(p):
    board = chess.Board(p["fen"])
    scores = dict(common.multipv(board, DEPTH, MPV))
    for u in p["sts"]:
        if u not in scores:
            scores[u] = common.eval_move(board, u, DEPTH)
    return {"id": p["id"], "scores": scores}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epd", required=True)
    ap.add_argument("--stockfish", required=True)
    ap.add_argument("--work", default=".")
    ap.add_argument("--out", default=common.STRATEGY_OUT)
    ap.add_argument("--procs", type=int, default=12)
    a = ap.parse_args()

    with open(a.epd, encoding="utf-8") as f:
        positions = [parse(l) for l in f if l.strip()]
    cache_path = os.path.join(a.work, "sts_analysis.jsonl")
    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            for l in f:
                r = json.loads(l)
                cache[r["id"]] = r["scores"]
    todo = [p for p in positions if p["id"] not in cache]
    print(f"{len(positions)} positions, {len(todo)} to analyse")
    with Pool(a.procs, initializer=common.init_engine, initargs=(a.stockfish,)) as pool, \
            open(cache_path, "a", encoding="utf-8") as cf:
        for i, r in enumerate(pool.imap_unordered(analyse, todo, chunksize=1), 1):
            cache[r["id"]] = r["scores"]
            cf.write(json.dumps(r) + "\n")
            cf.flush()
            if i % 100 == 0:
                print(f"  analysed {i}/{len(todo)}", flush=True)

    out, per_theme = [], {}
    for p in positions:
        scores = cache[p["id"]]
        top = max(p["sts"], key=p["sts"].get)
        if max(scores.values()) - scores[top] > TOLERANCE:
            continue
        board = chess.Board(p["fen"])
        out.append({"id": p["id"], "theme": p["theme"], "fen": p["fen"],
                    "side": "w" if board.turn else "b",
                    "answers": common.points_from_scores(scores),
                    "difficulty": None, "structures": structure_ids(board)})
        per_theme[p["theme"]] = per_theme.get(p["theme"], 0) + 1
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, "sts.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"kept {len(out)}/{len(positions)} -> {path} ({os.path.getsize(path) / 1024:.0f} KB)")
    print("  " + ", ".join(f"{k}:{v}" for k, v in per_theme.items()))


if __name__ == "__main__":
    main()
