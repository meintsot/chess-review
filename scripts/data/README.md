# Exercise data pipeline

Generates the static exercise files under `public/data/` (committed; the app lazy-loads them).

Requirements: Python 3.11+ with `python-chess zstandard torch`, a native Stockfish 18 binary,
and Maia-2 (`pip install --no-deps maia2 && pip install einops gdown pyyaml tqdm pyzstd`;
maia2's pinned deps don't build on Python 3.13). Set `PYTHONUTF8=1` on Windows.
Run from `scripts/data/`; `--work` is a scratch dir for caches (analyses resume from it).

```sh
SF=/path/to/stockfish
# 1. Tactical puzzles -> public/data/puzzles/<theme>.json + index.json (~1 min)
python build_puzzles.py                       # or --src lichess_db_puzzle.csv.zst
# 2. Strategic Test Suite -> public/data/strategy/sts.json (SF MultiPV 5, depth 20)
curl -LO https://raw.githubusercontent.com/fsmosca/STS-Rating/master/STS1-STS15_LAN_v3.epd
python build_sts.py --epd STS1-STS15_LAN_v3.epd --stockfish $SF --work WORK
# 3. Pawn-structure exercises -> public/data/strategy/structures.json
#    streams lichess_db_standard_rated_2026-09.pgn.zst (first 2M games), SF MultiPV 3, depth 18
python build_structures.py --stockfish $SF --work WORK
# 4. Maia-2 difficulty (rapid model, CPU; downloads the model on first run)
python difficulty.py --models WORK/maia2_models ../../public/data/strategy/sts.json ../../public/data/strategy/structures.json
```

Files: `structures.py` is the Python version of `docs/structures.md` (keep it in sync with
`src/lib/structures.ts`); `common.py` holds the Stockfish pool and the points formula
(best move 10, others `round(10*exp(-loss_cp/60))`, dropped below 2).

Formats
- `puzzles/<theme>.json`: `[id, fen, "uci ...", rating, "themes"]`. FEN is before the opponent's
  first move; the solver plays moves[1], moves[3], ... Up to 25 per (theme, 200-pt band 400-2800).
- `strategy/sts.json`: `{id, theme, fen, side, answers: [[uci, points]], difficulty, structures}`.
- `strategy/structures.json`: `{id, structure, owner, fen, side, answers, difficulty, game, structures}`;
  `game` is the Lichess URL with `#ply`.

Licenses: Lichess puzzle and game databases are CC0 (database.lichess.org); the Strategic Test
Suite (STS 1-15, fsmosca/STS-Rating) is MIT; Maia-2 (CSSLab/maia2) is MIT. Stockfish is GPLv3
and is only used as a tool, not distributed.
