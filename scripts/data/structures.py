"""Named pawn-structure classifier. Python port of the rules in docs/structures.md.

Rules look only at pawns. Each rule is written for White; the mirrored rule
(ranks flipped, colours swapped) applies to Black. A position can match several
structures. Returns [{id, name, owner}] with owner in 'w' | 'b' | 'both'.
"""
from __future__ import annotations

import chess

FILES = "abcdefgh"


class Pawns:
    """Pawn squares of one side as a set of (file_char, rank_int)."""

    def __init__(self, squares):
        self.sq = set(squares)
        self.files = {f for f, _ in self.sq}

    def at(self, name: str) -> bool:  # e.g. "d4"
        return (name[0], int(name[1])) in self.sq

    def on_file(self, f: str) -> bool:
        return f in self.files

    def ranks_on(self, f: str):
        return [r for ff, r in self.sq if ff == f]


def _pawns(board: chess.Board, color: bool, flip: bool) -> Pawns:
    out = []
    for s in board.pieces(chess.PAWN, color):
        r = chess.square_rank(s) + 1
        out.append((FILES[chess.square_file(s)], 9 - r if flip else r))
    return Pawns(out)


# --- rules, White version: (W = white pawns, B = black pawns) -> bool -------------

def _iqp(W, B):
    return W.on_file("d") and not W.on_file("c") and not W.on_file("e")


def _hanging(W, B):
    same_rank = any(W.at(f"c{r}") and W.at(f"d{r}") for r in (3, 4, 5))
    return same_rank and not W.on_file("b") and not W.on_file("e")


def _carlsbad(W, B):
    return (W.at("d4") and not W.on_file("c") and (W.at("e3") or W.at("e2"))
            and B.at("d5") and B.at("c6") and not B.on_file("e"))


def _maroczy(W, B):
    return (W.at("c4") and W.at("e4") and not W.on_file("d")
            and (B.at("d6") or B.at("d7")) and not B.on_file("c"))


def _hedgehog(W, B):
    return ((B.at("a6") or B.at("a7")) and B.at("b6") and B.at("d6") and B.at("e6")
            and not B.on_file("c")
            and W.at("c4") and W.at("e4") and not W.on_file("d"))


def _stonewall(W, B):
    return W.at("c3") and W.at("d4") and W.at("e3") and W.at("f4")


def _french(W, B):
    return W.at("d4") and W.at("e5") and B.at("d5") and B.at("e6")


def _kid(W, B):
    return W.at("d5") and W.at("e4") and B.at("d6") and B.at("e5")


def _caro_slav(W, B):
    return B.at("c6") and B.at("d5") and (B.at("e6") or B.at("e7")) and W.at("d4")


def _small_center(W, B):
    return (B.at("d6") and B.at("e6") and not B.on_file("c")
            and W.at("e4") and not W.on_file("d"))


def _boleslavsky(W, B):
    return (B.at("d6") and B.at("e5") and not B.on_file("c")
            and W.at("e4") and not W.on_file("d"))


def _dragon(W, B):
    return (B.at("d6") and B.at("g6") and B.at("f7")
            and (B.at("h7") or B.at("h6") or B.at("h5")) and not B.on_file("c")
            and W.at("e4") and not W.on_file("d"))


def _open_center(W, B):
    return not any(P.on_file(f) for P in (W, B) for f in "de")


def _closed_center(W, B):
    for f in "de":
        if not W.on_file(f) or not B.on_file(f):
            return False
        if any(not B.at(f"{f}{r + 1}") for r in W.ranks_on(f)):
            return False
        if any(not W.at(f"{f}{r - 1}") for r in B.ranks_on(f)):
            return False
    return True


# (id, name, rule, owner-of-White-version: 'w' | 'b' | 'both')
STRUCTURES = [
    ("iqp", "Isolated queen's pawn", _iqp, "w"),
    ("hanging-pawns", "Hanging pawns", _hanging, "w"),
    ("carlsbad", "Carlsbad", _carlsbad, "w"),
    ("maroczy", "Maróczy bind", _maroczy, "w"),
    ("hedgehog", "Hedgehog", _hedgehog, "b"),
    ("stonewall", "Stonewall", _stonewall, "w"),
    ("french-chain", "French pawn chain", _french, "both"),
    ("kid-chain", "King's Indian chain", _kid, "both"),
    ("caro-slav", "Slav / Caro-Kann triangle", _caro_slav, "b"),
    ("small-center", "Sicilian small centre (Scheveningen)", _small_center, "b"),
    ("boleslavsky", "Boleslavsky hole", _boleslavsky, "w"),
    ("dragon", "Dragon", _dragon, "b"),
    ("open-center", "Open centre", _open_center, "both"),
    ("closed-center", "Closed centre", _closed_center, "both"),
]
IDS = [s[0] for s in STRUCTURES]
_SWAP = {"w": "b", "b": "w", "both": "both"}


def classify(board: chess.Board) -> list[dict]:
    W, B = _pawns(board, chess.WHITE, False), _pawns(board, chess.BLACK, False)
    # Mirrored view: Black's pawns become "White" with ranks flipped, and vice versa.
    mW, mB = _pawns(board, chess.BLACK, True), _pawns(board, chess.WHITE, True)
    out, seen = [], set()
    for sid, name, rule, owner in STRUCTURES:
        for ok, own in ((rule(W, B), owner), (rule(mW, mB), _SWAP[owner])):
            if ok and (sid, own) not in seen:
                seen.add((sid, own))
                out.append({"id": sid, "name": name, "owner": own})
    return out


def structure_ids(board: chess.Board) -> list[str]:
    """Unique structure ids matching the position, in spec order."""
    ids = {m["id"] for m in classify(board)}
    return [i for i in IDS if i in ids]


if __name__ == "__main__":
    import sys
    for fen in sys.argv[1:] or [chess.STARTING_FEN]:
        print(fen, classify(chess.Board(fen)))
