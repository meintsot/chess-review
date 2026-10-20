# Game Review

chess.com-style game review that runs entirely in the browser: Stockfish 18 (lite WASM, parallel workers)
grades every move (Brilliant … Blunder), computes Lichess-style accuracy, and explains mistakes in plain words.

- `npm run dev` / `npm run build`
- Deploy: `npm run deploy` (Cloudflare Workers static assets, `wrangler.jsonc`) → https://chess-review.piano-for-hope-management.workers.dev
- Opening book: `node scripts/build-openings.mjs` (lichess-org/chess-openings, CC0) → `public/openings.json`
- Engine: `public/engine/` from the `stockfish` npm package (GPLv3, see `Copying.txt`)

Core logic lives in `src/lib/review.ts` (classification + explanations), `accuracy.ts`, `engine.ts`.
