# Game Review

chess.com-style game review that runs entirely in the browser: Stockfish 18 (lite WASM, parallel workers)
grades every move (Brilliant … Blunder), computes Lichess-style accuracy, and explains mistakes in plain words.

- `npm run dev` / `npm run build`
- Deploy: `npm run deploy` (Cloudflare Workers static assets, `wrangler.jsonc`) → https://chess-review.meintsot.workers.dev
- Opening book: `node scripts/build-openings.mjs` (lichess-org/chess-openings, CC0) → `public/openings.json`
- Engine: `public/engine/` from the `stockfish` npm package (GPLv3, see `Copying.txt`)

Core logic lives in `src/lib/review.ts` (classification + explanations), `accuracy.ts`, `engine.ts`.

## Calibration against chess.com
- Labels: chess.com's expected-points table (.02/.05/.10/.20) on a rating-aware curve (shape fitted on ~1M Lichess
  positions, level tuned to a fully labelled chess.com review); "Best" = engine move or ≤ 0.002 lost.
- Accuracy: curve and aggregation fitted to chess.com's official accuracies on 560 reviewed games (RMSE 4.8).
- Game rating: rating + 40 × (accuracy − typical accuracy for that rating and time control).
- Book: lichess-org/chess-openings plus positions reached ≥ 100 times in 150k strong Lichess games (`scripts/openings/popular.json`).
