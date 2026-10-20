"""Build public/data/puzzles/<theme>.json from the Lichess puzzle database (CC0).

Usage: python build_puzzles.py [--src lichess_db_puzzle.csv.zst | URL] [--out public/data/puzzles]

The .csv.zst is stream-decompressed; the CSV is never written to disk.
Row format: [id, fen, "uci uci ...", rating, "theme1 theme2 ..."].
FEN is the position BEFORE the opponent's first move: moves[0] is the opponent's
move, the solver plays moves[1], moves[3], ...
"""
import argparse
import csv
import heapq
import io
import json
import os
import urllib.request

import zstandard

URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
THEMES = ("fork pin skewer discoveredAttack doubleCheck hangingPiece trappedPiece sacrifice "
          "deflection attraction capturingDefender interference intermezzo xRayAttack clearance "
          "backRankMate smotheredMate mateIn1 mateIn2 mateIn3 exposedKing kingsideAttack quietMove "
          "defensiveMove advancedPawn promotion rookEndgame pawnEndgame zugzwang").split()
BAND_LO, BAND_HI, BAND = 400, 2800, 200
PER_BUCKET = 25
HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=URL)
    ap.add_argument("--out", default=os.path.join(HERE, "..", "..", "public", "data", "puzzles"))
    a = ap.parse_args()

    raw = urllib.request.urlopen(a.src) if a.src.startswith("http") else open(a.src, "rb")
    text = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(raw), encoding="utf-8")
    themeset = set(THEMES)
    buckets = {}  # (theme, band) -> min-heap of (nbPlays, id, row)
    n = kept = 0
    for r in csv.DictReader(text):
        n += 1
        rating = int(r["Rating"])
        if not (BAND_LO <= rating < BAND_HI):
            continue
        if int(r["RatingDeviation"]) > 90 or int(r["Popularity"]) < 80 or int(r["NbPlays"]) < 300:
            continue
        themes = r["Themes"].split()
        hit = themeset.intersection(themes)
        if not hit:
            continue
        kept += 1
        band = (rating - BAND_LO) // BAND
        key = (int(r["NbPlays"]), r["PuzzleId"])
        row = [r["PuzzleId"], r["FEN"], r["Moves"], rating, r["Themes"]]
        for t in hit:
            h = buckets.setdefault((t, band), [])
            item = (key[0], key[1], row)
            if len(h) < PER_BUCKET:
                heapq.heappush(h, item)
            elif item[:2] > h[0][:2]:
                heapq.heapreplace(h, item)
    print(f"read {n} puzzles, {kept} passed filters")

    os.makedirs(a.out, exist_ok=True)
    index, total_bytes = {}, 0
    for t in THEMES:
        rows = []
        for band in range((BAND_HI - BAND_LO) // BAND):
            rows += [it[2] for it in sorted(buckets.get((t, band), []), key=lambda x: (-x[0], x[1]))]
        rows.sort(key=lambda r: (r[3], r[0]))
        path = os.path.join(a.out, f"{t}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(rows, f, separators=(",", ":"), ensure_ascii=False)
        total_bytes += os.path.getsize(path)
        index[t] = {"count": len(rows),
                    "minRating": min((r[3] for r in rows), default=None),
                    "maxRating": max((r[3] for r in rows), default=None)}
    with open(os.path.join(a.out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, separators=(",", ":"))
    print(f"wrote {len(THEMES)} theme files, {total_bytes / 1024:.0f} KB, "
          f"{sum(v['count'] for v in index.values())} rows")
    for t, v in index.items():
        print(f"  {t}: {v['count']} ({v['minRating']}-{v['maxRating']})")


if __name__ == "__main__":
    main()
