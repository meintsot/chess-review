# Named pawn structures (shared spec)

Both the data pipeline (Python) and the app (`src/lib/structures.ts`) classify structures with these rules.
Rules look only at pawns. Each rule is written for White; the mirrored rule (ranks flipped, colours swapped)
applies to Black. A position can match several structures. `owner` = the side the structure is named after.

| id | name | rule (White version) | owner |
|---|---|---|---|
| `iqp` | Isolated queen's pawn | White has a d-pawn and no pawns on the c- or e-files | White |
| `hanging-pawns` | Hanging pawns | White has pawns on c4 and d4 (same rank, c- and d-file, any rank 3–5), and no white pawns on the b- or e-files | White |
| `carlsbad` | Carlsbad | White: d4 pawn, no c-pawn, pawn on e3 or e2. Black: d5 and c6 pawns, no e-pawn | White (minority attack side) |
| `maroczy` | Maróczy bind | White: c4 and e4, no d-pawn. Black: d6 or d7 pawn, no c-pawn | White |
| `hedgehog` | Hedgehog | Black: a6 (or a7), b6, d6, e6, no c-pawn. White: c4 and e4, no d-pawn | Black |
| `stonewall` | Stonewall | White: c3, d4, e3, f4 | White |
| `french-chain` | French pawn chain | White: d4 and e5. Black: d5 and e6 | both |
| `kid-chain` | King's Indian chain | White: d5 and e4. Black: d6 and e5 | both |
| `caro-slav` | Slav / Caro-Kann triangle | Black: c6, d5, e6 (or e7). White: d4 | Black |
| `small-center` | Sicilian small centre (Scheveningen) | Black: d6 and e6, no c-pawn. White: e4, no d-pawn | Black |
| `boleslavsky` | Boleslavsky hole | Black: d6 and e5, no c-pawn. White: e4, no d-pawn (d5 is a hole) | White (d5 outpost) |
| `dragon` | Dragon | Black: d6, g6, f7, h7 (or h5/h6), no c-pawn. White: e4, no d-pawn | Black |
| `open-center` | Open centre | No pawns of either colour on the d- or e-files | both |
| `closed-center` | Closed centre | Both d- and e-pawns of each side are present and each is blocked by an enemy pawn directly in front of it | both |

Output shape: `{ id, name, owner: 'w' | 'b' | 'both' }`.
