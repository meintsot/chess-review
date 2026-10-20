"""Build public/data/strategy/structures.json: pawn-structure exercises mined from the
Lichess standard game database (CC0).

Usage:
  python build_structures.py --stockfish <path> [--pgn URL-or-.pgn.zst] [--work dir]
         [--max-games 2000000] [--target 40] [--procs 12]

Stage 1 (mine): stream the .pgn.zst (never stored), keep games with both players >= 2000 and
  base + 40*increment >= 480 s. For plies 16..60 classify the pawn structure (structures.py,
  docs/structures.md); skip positions in check or with material unbalanced by more than a pawn.
  Each game contributes up to 3 (randomly chosen, seeded, >= 8 plies apart) candidates per
  structure; at most one exercise per game per structure is accepted.
  Stops when every structure has --cap candidates or after --max-games games.
  Candidates -> <work>/structure_candidates.jsonl.
Stage 2 (verify): Stockfish MultiPV 3, depth 18, candidates in seeded random order per structure,
  until --target exercises per structure. Keep a position if the best move is quiet (no capture,
  check or promotion), beats the 2nd best by >= 60 cp, and the best eval for the side to move is
  in [-150, +300]. Points over the top 3 moves as for STS. Analyses cached in
  <work>/structure_analysis.jsonl. `difficulty` is filled in later by difficulty.py.
"""
import argparse
import io
import json
import os
import random
import re
import urllib.request
from multiprocessing import Pool

import chess
import zstandard

import common
from structures import IDS, classify, structure_ids

URL = "https://database.lichess.org/standard/lichess_db_standard_rated_2026-09.pgn.zst"
PLY_MIN, PLY_MAX = 16, 60
DEPTH, MPV, MIN_GAP, EVAL_LO, EVAL_HI = 18, 3, 60, -150, 300
SEED = 20260901
PER_GAME, SPACING = 3, 8  # up to 3 candidates per game per structure, >= 8 plies apart

_HDR = re.compile(r'^\[(\w+) "(.*)"\]$')
_COMMENT = re.compile(r"\{[^}]*\}")
_MOVENUM = re.compile(r"^\d+\.+$")
_RESULTS = {"1-0", "0-1", "1/2-1/2", "*"}


def qualifies(h):
    try:
        if int(h.get("WhiteElo", 0)) < 2000 or int(h.get("BlackElo", 0)) < 2000:
            return False
        base, inc = h.get("TimeControl", "-").split("+")
        return int(base) + 40 * int(inc) >= 480
    except ValueError:
        return False


def mine_game(args):
    """(site, movetext) -> [{structure, owner, fen, game}] (one random ply per structure)."""
    site, movetext = args
    board = chess.Board()
    hits = {}  # structure id -> [(ply, owner)]
    ply = 0
    for tok in _COMMENT.sub(" ", movetext).split():
        if _MOVENUM.match(tok) or tok in _RESULTS:
            continue
        try:
            board.push_san(tok.rstrip("!?"))
        except ValueError:
            break
        ply += 1
        if ply > PLY_MAX:
            break
        if ply < PLY_MIN or board.is_check() or abs(common.material_diff(board)) > 1:
            continue
        owners = {}
        for m in classify(board):
            owners.setdefault(m["id"], set()).add(m["owner"])
        for sid, own in owners.items():
            o = own.pop() if len(own) == 1 else "both"
            hits.setdefault(sid, []).append((ply, o, board.fen()))
    rng = random.Random(f"{SEED}:{site}")
    out = []
    for sid, lst in hits.items():
        rng.shuffle(lst)
        picked = []
        for ply, owner, fen in lst:
            if len(picked) < PER_GAME and all(abs(ply - p) >= SPACING for p in picked):
                picked.append(ply)
                out.append({"structure": sid, "owner": owner, "fen": fen, "game": f"{site}#{ply}"})
    return out


def iter_games(src, max_games, stats):
    raw = urllib.request.urlopen(src) if src.startswith("http") else open(src, "rb")
    text = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(raw),
                            encoding="utf-8", errors="replace")
    h = {}
    for line in text:
        if line.startswith("["):
            m = _HDR.match(line.rstrip("\n"))
            if m:
                h[m.group(1)] = m.group(2)
            continue
        if not line.strip() or not h:
            continue
        stats["games"] += 1
        if qualifies(h):
            stats["qualifying"] += 1
            yield h.get("Site", ""), line
        h = {}
        if stats["games"] >= max_games:
            return


def mine(a, cand_path):
    counts = {s: 0 for s in IDS}
    stats = {"games": 0, "qualifying": 0}
    with Pool(a.procs) as pool, open(cand_path, "w", encoding="utf-8") as f:
        games = iter_games(a.pgn, a.max_games, stats)
        for i, res in enumerate(pool.imap(mine_game, games, chunksize=64), 1):
            for c in res:
                if counts[c["structure"]] < a.cap:
                    counts[c["structure"]] += 1
                    f.write(json.dumps(c) + "\n")
            if i % 20000 == 0:
                print(f"  mined {i} games (scanned {stats['games']}), "
                      f"min cands {min(counts.values())}", flush=True)
            if min(counts.values()) >= a.cap:
                break
    print(f"mined {stats['games']} games ({stats['qualifying']} qualifying)")
    print("  candidates: " + ", ".join(f"{k}:{v}" for k, v in counts.items()))
    with open(cand_path + ".stats.json", "w") as f:
        json.dump({"stats": stats, "counts": counts}, f)


def analyse(c):
    board = chess.Board(c["fen"])
    return {"fen": c["fen"], "pv": common.multipv(board, DEPTH, MPV)}


def accept(fen, pv):
    if len(pv) < 2:
        return False
    board = chess.Board(fen)
    mv = chess.Move.from_uci(pv[0][0])
    if board.is_capture(mv) or board.gives_check(mv) or mv.promotion:
        return False
    best, second = pv[0][1], pv[1][1]
    return best - second >= MIN_GAP and EVAL_LO <= best <= EVAL_HI


def verify(a, cand_path):
    by_s = {s: [] for s in IDS}
    with open(cand_path, encoding="utf-8") as f:
        for l in f:
            c = json.loads(l)
            by_s[c["structure"]].append(c)
    rng = random.Random(SEED)
    for s in IDS:
        rng.shuffle(by_s[s])
    cache_path = os.path.join(a.work, "structure_analysis.jsonl")
    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            for l in f:
                r = json.loads(l)
                cache[r["fen"]] = r["pv"]

    accepted = {s: [] for s in IDS}
    used_fens, pos = set(), {s: 0 for s in IDS}
    used_games = {s: set() for s in IDS}

    def skip(s, c):
        return (" ".join(c["fen"].split()[:4]) in used_fens
                or c["game"].split("#")[0] in used_games[s])
    tried = {s: 0 for s in IDS}

    def consume(s):
        """Walk structure s's candidates in order using cached analyses; return next uncached."""
        while pos[s] < len(by_s[s]) and len(accepted[s]) < a.target:
            c = by_s[s][pos[s]]
            key = " ".join(c["fen"].split()[:4])
            if skip(s, c):
                pos[s] += 1
                continue
            if c["fen"] not in cache:
                return c
            pos[s] += 1
            tried[s] += 1
            if accept(c["fen"], cache[c["fen"]]):
                used_fens.add(key)
                used_games[s].add(c["game"].split("#")[0])
                accepted[s].append((c, cache[c["fen"]]))
        return None

    with Pool(a.procs, initializer=common.init_engine, initargs=(a.stockfish,)) as pool, \
            open(cache_path, "a", encoding="utf-8") as cf:
        while True:
            batch = []
            for s in IDS:
                if consume(s) is None:
                    continue
                need = a.target - len(accepted[s])
                n = max(a.procs, need * 3)
                k = pos[s]
                while len(batch) < 100000 and n > 0 and k < len(by_s[s]):
                    c = by_s[s][k]
                    k += 1
                    if c["fen"] not in cache and not skip(s, c):
                        batch.append(c)
                        n -= 1
            batch = list({c["fen"]: c for c in batch}.values())
            if not batch:
                break
            for r in pool.imap_unordered(analyse, batch, chunksize=1):
                cache[r["fen"]] = r["pv"]
                cf.write(json.dumps(r) + "\n")
            cf.flush()
            print("  accepted: " + ", ".join(f"{s}:{len(accepted[s])}" for s in IDS), flush=True)
        for s in IDS:
            consume(s)

    out = []
    for s in IDS:
        for c, pv in accepted[s]:
            board = chess.Board(c["fen"])
            gid, ply = c["game"].rsplit("/", 1)[1].split("#")
            out.append({"id": f"{gid}-{ply}", "structure": s, "owner": c["owner"],
                        "fen": c["fen"], "side": "w" if board.turn else "b",
                        "answers": common.points_from_scores(dict(pv)),
                        "difficulty": None, "game": c["game"],
                        "structures": structure_ids(board)})
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, "structures.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {len(out)} exercises -> {path} ({os.path.getsize(path) / 1024:.0f} KB)")
    print("  " + ", ".join(f"{s}:{len(accepted[s])}/{tried[s]}" for s in IDS))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pgn", default=URL)
    ap.add_argument("--stockfish", required=True)
    ap.add_argument("--work", default=".")
    ap.add_argument("--out", default=common.STRATEGY_OUT)
    ap.add_argument("--max-games", type=int, default=2_000_000)
    ap.add_argument("--cap", type=int, default=3000, help="max candidates per structure")
    ap.add_argument("--target", type=int, default=40)
    ap.add_argument("--procs", type=int, default=12)
    ap.add_argument("--stage", choices=["all", "mine", "verify"], default="all")
    a = ap.parse_args()
    cand_path = os.path.join(a.work, "structure_candidates.jsonl")
    if a.stage in ("all", "mine"):
        mine(a, cand_path)
    if a.stage in ("all", "verify"):
        verify(a, cand_path)


if __name__ == "__main__":
    main()
