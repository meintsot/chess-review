# Game Review — a free chess coach in your browser

Review any chess game the way chess.com's Game Review does — every move labelled from Brilliant to Blunder,
accuracy and a game rating — and then get what a good coach adds: **why** each move was good or bad, tactically
and strategically, and a **training plan** built from your own mistakes.

Live: https://chess-review.meintsot.workers.dev

Everything runs in the browser (Stockfish 18 compiled to WebAssembly). No account, no server-side analysis,
your progress stays in your browser (export/import available).

## Features

- **Game review** — import from chess.com or Lichess by username, or paste a PGN. chess.com-style labels
  (Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder), accuracy, game rating,
  eval bar and graph, best lines you can step through.
- **Coach explanations** — for every move: the tactic you missed or allowed (forks, pins, skewers, discovered
  attacks, deflections, mating patterns … detected on the engine's lines), the positional change (outposts,
  weak/isolated/backward/passed pawns, open files, bishop pair, king safety, space), the pawn structure and its
  plans, and the habit behind the error.
- **Coach report** — the story of the game by phase (opening/middlegame/endgame), pawn structures with plans for
  your side, key moments, what went well and what to work on.
- **Training** — a daily session focused on your weaknesses across games:
  - positions from **your own games** where you went wrong,
  - **tactical puzzles** by theme and rating (Lichess puzzle database),
  - **strategic exercises** with partial credit (Strategic Test Suite, re-verified with Stockfish 18) and
    **pawn-structure exercises** mined from strong games, with difficulty estimated by the Maia-2 human-move model,
  - spaced repetition of anything you missed.
- **Lessons** — short coach's notes on tactics, strategy, pawn structures (IQP, hanging pawns, Carlsbad, Maróczy,
  Hedgehog, French/KID chains, Sicilian structures…), endgames and habits, each linked to exercises.
- **AI coach (optional)** — bring your own Anthropic API key (stored only in your browser) and Claude writes a
  narrative review of the game from the verified analysis only.

## How it works

| Piece | File |
|---|---|
| Engine pool (Stockfish 18 lite WASM, parallel workers) | `src/lib/engine.ts` |
| Move labels, accuracy, game rating (calibrated against chess.com) | `src/lib/review.ts`, `accuracy.ts`, `expectedPoints.ts` |
| Tactical motifs (port of the Lichess puzzle tagger) | `src/lib/motifs.ts` |
| Positional features (port of Stockfish's classical evaluation terms) | `src/lib/positional.ts` |
| Pawn structures (spec in `docs/structures.md`) | `src/lib/structures.ts` |
| Coach text | `src/lib/coach.ts` |
| Training, progress, spaced repetition | `src/lib/training.ts`, `progress.ts` |
| Lessons | `src/content/lessons.ts` |
| AI coach (bring your own key) | `src/lib/aiCoach.ts` |

### Calibration against chess.com
Measured on two independent sets of chess.com Game Reviews (~120 games, ~7,500 moves) with the app's own engine
(lite, depth 18); every rule was fitted on one set and checked on the other:
- Labels: ~60% identical, ~91% identical or one step apart. On chess.com's own evals the same rules reproduce 85%;
  our own lite and full Stockfish builds agree with each other on only 75% of labels, so the remaining gap is
  engine-vs-engine noise. chess.com's published thresholds (.02/.05/.10/.20) come out as the best fit.
- Accuracy: bias ≈ −0.2, RMSE ≈ 4 points (forced moves excluded, as chess.com does). Game rating: RMSE ≈ 160–170.
- Displayed evals use chess.com's scale: 748·tanh(cp/748).

Re-run the comparison with `npx tsx scripts/calibrate.ts <games.json> <analysis.json> <labels.json>`.

## Development

```bash
npm install
npm run dev       # local dev server
npm test          # unit tests (vitest)
npm run build     # type-check + production build
npm run deploy    # build + deploy to Cloudflare (wrangler)
```

Data rebuild: `node scripts/build-openings.mjs` (opening book) and the Python scripts in `scripts/data/`
(see `scripts/data/README.md`) for puzzles, strategic and structure exercises.

## Credits and licenses

This project is free software under the **GNU AGPL v3 or later** (see `LICENSE`). It builds on:

- [Stockfish](https://stockfishchess.org/) 18 (GPLv3) via [stockfish.js](https://github.com/nmrugg/stockfish.js) — `public/engine/Copying.txt`
- [chessground](https://github.com/lichess-org/chessground) (GPLv3) and [chess.js](https://github.com/jhlywa/chess.js) (BSD-2)
- [lichess-puzzler](https://github.com/ornicar/lichess-puzzler) tactical tagger (AGPLv3), ported to TypeScript
- [Stockfish Evaluation Guide](https://github.com/hxim/Stockfish-Evaluation-Guide) (GPLv3), classical evaluation terms
- [Lichess open database](https://database.lichess.org/) puzzles and games (CC0)
- [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0)
- [Strategic Test Suite](https://github.com/fsmosca/STS-Rating) by Dann Corbit, Swaminathan Natarajan and Ferdinand Mosca (MIT)
- [Maia-2](https://github.com/CSSLab/maia2) human move model (MIT), used offline for exercise difficulty
- Ideas from *Concept-guided Chess Commentary* (Kim et al., 2024) for grounding the AI coach

Not affiliated with chess.com or Lichess.
