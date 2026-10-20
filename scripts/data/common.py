"""Shared helpers for the strategy data builders (Stockfish pool, scoring)."""
import atexit
import math
import os

import chess
import chess.engine

HERE = os.path.dirname(os.path.abspath(__file__))
STRATEGY_OUT = os.path.join(HERE, "..", "..", "public", "data", "strategy")
MATE = 100000

_engine = None


def init_engine(path, hash_mb=64):
    """Pool initializer: one single-threaded Stockfish per worker process."""
    global _engine
    _engine = chess.engine.SimpleEngine.popen_uci(path)
    _engine.configure({"Threads": 1, "Hash": hash_mb})
    atexit.register(_engine.quit)


def engine():
    return _engine


def cp(pov_score):
    """Score from the side to move's point of view, in centipawns (mates = +-100000)."""
    return pov_score.relative.score(mate_score=MATE)


def multipv(board, depth, n):
    """[(uci, cp)] best first, scores for the side to move."""
    infos = _engine.analyse(board, chess.engine.Limit(depth=depth), multipv=n)
    return [(i["pv"][0].uci(), cp(i["score"])) for i in infos if i.get("pv")]


def eval_move(board, uci, depth):
    """Score of a single root move (searched with searchmoves), side-to-move POV."""
    info = _engine.analyse(board, chess.engine.Limit(depth=depth),
                           root_moves=[chess.Move.from_uci(uci)])
    return cp(info["score"])


def points_from_scores(scores, min_points=2):
    """scores: {uci: cp}. Best move = 10, others round(10*exp(-loss/60)); drop < min_points.
    Returns [[uci, points], ...] sorted by points desc (ties: higher score first)."""
    best = max(scores.values())
    out = []
    for u, s in sorted(scores.items(), key=lambda kv: -kv[1]):
        loss = best - s
        p = 10 if loss <= 0 else round(10 * math.exp(-loss / 60))
        if p >= min_points:
            out.append([u, p])
    return out


def material_diff(board):
    vals = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
    return sum(v * (len(board.pieces(p, chess.WHITE)) - len(board.pieces(p, chess.BLACK)))
               for p, v in vals.items())
