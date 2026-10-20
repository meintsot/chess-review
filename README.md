# Game Review

chess.com-style game review that runs entirely in the browser: Stockfish 18 (lite WASM, parallel workers)
grades every move (Brilliant … Blunder), computes Lichess-style accuracy, and explains mistakes in plain words.

- `npm run dev` / `npm run build`
- Deploy: `npm run deploy` (Cloudflare Workers static assets, `wrangler.jsonc`) → https://chess-review.meintsot.workers.dev
- Opening book: `node scripts/build-openings.mjs` (lichess-org/chess-openings, CC0) → `public/openings.json`
- Engine: `public/engine/` from the `stockfish` npm package (GPLv3, see `Copying.txt`)

Core logic lives in `src/lib/review.ts` (classification + explanations), `accuracy.ts`, `engine.ts`.

## Calibration against chess.com
Measured on 51 scraped chess.com Game Reviews (3,799 moves) with the app's own engine (lite, depth 18):
- Labels: 60% identical, 91% identical or one step apart. On chess.com's *own* evals the same rules reproduce 85%
  of labels, so the remaining gap is engine-vs-engine noise. Expected-points curve k = 1.75e-6·rating + 0.002;
  chess.com's published thresholds (.02/.05/.10/.20) come out as the best fit.
- Great / Miss / Brilliant rules fitted on the same reviews (see comments in `src/lib/review.ts`).
- Accuracy: bias −0.1, RMSE 4.0 points (forced moves excluded, as chess.com does). Game rating: RMSE ~185.
- Noise floor: our own lite and full Stockfish builds agree on only 75% of labels with identical code, so ~60% exact
  vs chess.com's server engine is close to the ceiling without chess.com's evals. Deeper search helps slightly
  (d12 57% → d14 60% → d18 61%); the Deep preset (d22) is the closest setting.
- Displayed evals use chess.com's scale: 748·tanh(cp/748).
- Book: lichess-org/chess-openings plus positions reached ≥ 25 times in 150k strong Lichess games.

Re-run the comparison with `npx tsx scripts/calibrate.ts <games.json> <analysis.json> <labels.json>`.
