# Game Review

chess.com-style game review that runs entirely in the browser: Stockfish 18 (lite WASM, parallel workers)
grades every move (Brilliant … Blunder), computes Lichess-style accuracy, and explains mistakes in plain words.

- `npm run dev` / `npm run build`
- Deploy: `npm run deploy` (Cloudflare Workers static assets, `wrangler.jsonc`) → https://chess-review.meintsot.workers.dev
- Opening book: `node scripts/build-openings.mjs` (lichess-org/chess-openings, CC0) → `public/openings.json`
- Engine: `public/engine/` from the `stockfish` npm package (GPLv3, see `Copying.txt`)

Core logic lives in `src/lib/review.ts` (classification + explanations), `accuracy.ts`, `engine.ts`.

## Calibration against chess.com
Measured on two independent sets of scraped chess.com Game Reviews (~120 games, ~7,500 moves) with the app's own
engine (lite, depth 18); every rule was fitted on one set and checked on the other:
- Labels: ~60% identical, ~91% identical or one step apart, the same on both sets. On chess.com's *own* evals the same
  rules reproduce 85%; our own lite and full Stockfish builds agree with each other on only 75% of labels, so the
  remaining gap is engine-vs-engine noise. Curve k = 1.75e-6·rating + 0.002; chess.com's published thresholds
  (.02/.05/.10/.20) come out as the best fit. A gradient-boosted model on the same signals gains < 0.5%.
- Great / Miss / Brilliant: threshold rules cross-validated across the two sets (comments in `src/lib/review.ts`).
- Accuracy: bias ≈ −0.2, RMSE 4.0–4.2 points (forced moves excluded, as chess.com does).
- Game rating: RMSE 159–171 vs chess.com's Game Rating.
- Displayed evals use chess.com's scale: 748·tanh(cp/748) (mean abs error 31 cp on 3,000 positions).
- Book: lichess-org/chess-openings plus positions reached ≥ 25 times in 150k strong Lichess games (book recall ~93%).
- Depth: deeper search helps slightly (d12 57% → d14 60% → d18 61%); the Deep preset (d22) is the closest setting.

Re-run the comparison with `npx tsx scripts/calibrate.ts <games.json> <analysis.json> <labels.json>`.
