import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { Board } from './Board'
import { EvalBar, EvalGraph } from './EvalViews'
import { Badge } from './Badge'
import { CLASS_INFO, SUMMARY_ORDER, badgeSvg } from '../lib/classes'
import type { GameReview, MoveReview } from '../lib/review'
import { formatScore } from '../lib/score'

interface Preview {
  fens: string[]
  sans: string[]
  moves: [string, string][]
  index: number // 0..sans.length (0 = position before the line)
}

export function ReviewView({ review, onBack }: { review: GameReview; onBack: () => void }) {
  const total = review.moves.length
  const [ply, setPly] = useState(0)
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')
  const [preview, setPreview] = useState<Preview | null>(null)
  const move: MoveReview | undefined = review.moves[ply - 1]

  const go = useCallback((p: number) => {
    setPreview(null)
    setPly(Math.max(0, Math.min(total, p)))
  }, [total])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (preview) {
        if (e.key === 'ArrowRight') setPreview(p => p && { ...p, index: Math.min(p.sans.length, p.index + 1) })
        else if (e.key === 'ArrowLeft') setPreview(p => p && { ...p, index: Math.max(0, p.index - 1) })
        else if (e.key === 'Escape') setPreview(null)
        else return
      } else if (e.key === 'ArrowRight') go(ply + 1)
      else if (e.key === 'ArrowLeft') go(ply - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(total)
      else if (e.key === 'f') setOrientation(o => (o === 'white' ? 'black' : 'white'))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, ply, total, preview])

  const startLine = (fen: string, sans: string[], index: number) => {
    const c = new Chess(fen)
    const fens = [fen]
    const moves: [string, string][] = []
    for (const s of sans) {
      const m = c.move(s)
      fens.push(c.fen())
      moves.push([m.from, m.to])
    }
    setPreview({ fens, sans, moves, index })
  }

  const boardFen = preview ? preview.fens[preview.index] : move ? move.fenAfter : review.startFen
  const lastMove: [string, string] | undefined = preview
    ? preview.moves[preview.index - 1]
    : move && [move.from, move.to]

  const shapes = useMemo<DrawShape[]>(() => {
    if (preview || !move) return []
    const s: DrawShape[] = [{ orig: move.to as Key, customSvg: { html: `<g transform="translate(66 -10) scale(.42)">${badgeSvg(move.cls)}</g>` } }]
    const showBest = move.bestUci && !['best', 'book', 'forced', 'brilliant', 'great'].includes(move.cls)
    if (showBest) s.push({ orig: move.bestUci!.slice(0, 2) as Key, dest: move.bestUci!.slice(2, 4) as Key, brush: 'green' })
    return s
  }, [move, preview])

  const score = preview ? null : move ? move.scoreAfter : review.startScore
  const inCheck = new Chess(boardFen).inCheck()

  const counts = (color: 'w' | 'b') => {
    const c: Record<string, number> = {}
    for (const m of review.moves) if (m.color === color) c[m.cls] = (c[m.cls] ?? 0) + 1
    return c
  }
  const wc = counts('w')
  const bc = counts('b')
  const keyMoments = review.moves.filter(m => ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(m.cls))

  const top = orientation === 'white' ? 'b' : 'w'
  const playerLine = (c: 'w' | 'b') => (
    <div className="player">
      <span className={`dot ${c}`} />
      <span className="pname">{c === 'w' ? review.white : review.black}</span>
      {(c === 'w' ? review.whiteElo : review.blackElo) && <span className="elo">{c === 'w' ? review.whiteElo : review.blackElo}</span>}
    </div>
  )

  return (
    <div className="review">
      <section className="board-col">
        {playerLine(top)}
        <div className="board-row">
          <EvalBar score={score ?? move?.scoreAfter ?? review.startScore} orientation={orientation} />
          <Board fen={boardFen} orientation={orientation} lastMove={lastMove} shapes={shapes} check={inCheck} />
        </div>
        {playerLine(top === 'w' ? 'b' : 'w')}
        <div className="nav">
          <button onClick={() => go(0)} aria-label="First move">⏮</button>
          <button onClick={() => go(ply - 1)} aria-label="Previous move">◀</button>
          <button onClick={() => go(ply + 1)} aria-label="Next move">▶</button>
          <button onClick={() => go(total)} aria-label="Last move">⏭</button>
          <button onClick={() => setOrientation(o => (o === 'white' ? 'black' : 'white'))} aria-label="Flip board">⇅</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <button className="link" onClick={onBack}>← New game</button>
          <span className="muted">{review.opening?.replace(/^[A-E]\d\d /, '') ?? ''}</span>
        </div>

        <Coach
          move={move}
          review={review}
          preview={preview}
          onLine={startLine}
          onPreviewIndex={i => setPreview(p => p && { ...p, index: i })}
          onExit={() => setPreview(null)}
        />

        <EvalGraph review={review} ply={ply} onSelect={go} />

        <MoveList review={review} ply={ply} onSelect={go} />

        <div className="summary">
          <div className="acc-row">
            <div className="acc w"><span className="acc-num">{review.accuracy.w.toFixed(1)}</span><span className="muted">Accuracy · {short(review.white)}</span></div>
            <div className="acc b"><span className="acc-num">{review.accuracy.b.toFixed(1)}</span><span className="muted">Accuracy · {short(review.black)}</span></div>
          </div>
          <table className="counts">
            <tbody>
              {SUMMARY_ORDER.map(cls => (
                <tr key={cls} className={(wc[cls] ?? 0) + (bc[cls] ?? 0) === 0 ? 'zero' : ''}>
                  <td className="n" style={{ color: CLASS_INFO[cls].color }}>{wc[cls] ?? 0}</td>
                  <td className="lbl"><Badge cls={cls} size={20} /> {CLASS_INFO[cls].label}</td>
                  <td className="n" style={{ color: CLASS_INFO[cls].color }}>{bc[cls] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {keyMoments.length > 0 && (
            <div className="moments">
              <h3>Key moments</h3>
              {keyMoments.map(m => (
                <button key={m.ply} className={`moment${m.ply === ply ? ' on' : ''}`} onClick={() => go(m.ply)}>
                  <Badge cls={m.cls} size={18} /> {moveNo(m)} {m.san}
                </button>
              ))}
            </div>
          )}
          <p className="muted small">Stockfish 18 (lite) · depth {review.depth}</p>
        </div>
      </section>
    </div>
  )
}

const short = (name: string) => name.replace(/\s*\(.*\)$/, '')
const moveNo = (m: MoveReview) => `${Math.ceil(m.ply / 2)}${m.color === 'w' ? '.' : '…'}`

function Coach({ move, review, preview, onLine, onPreviewIndex, onExit }: {
  move?: MoveReview
  review: GameReview
  preview: Preview | null
  onLine: (fen: string, sans: string[], index: number) => void
  onPreviewIndex: (i: number) => void
  onExit: () => void
}) {
  if (!move) {
    return (
      <div className="coach">
        <div className="coach-title">Game review</div>
        <p>{review.white} vs {review.black} · {review.result}. Step through with ▶ or the arrow keys — each move gets a verdict and an explanation.</p>
      </div>
    )
  }
  const info = CLASS_INFO[move.cls]
  const lineSans = move.bestLineSan
  const showBestLine = !['book', 'forced'].includes(move.cls) && lineSans.length > 0
  const reply = move.replyLineSan
  return (
    <div className="coach" style={{ borderColor: info.color }}>
      <div className="coach-title">
        <Badge cls={move.cls} size={28} />
        <span>{moveNo(move)} {move.san}</span>
        <span style={{ color: info.color }}>{info.phrase}</span>
        <span className="score">{formatScore(move.scoreAfter)}</span>
      </div>
      <p>{move.comment}</p>
      {preview ? (
        <div className="line">
          <span className="muted">Exploring line:</span>
          {preview.sans.map((s, i) => (
            <button key={i} className={`chip${preview.index === i + 1 ? ' on' : ''}`} onClick={() => onPreviewIndex(i + 1)}>{s}</button>
          ))}
          <button className="link" onClick={onExit}>back to game ✕</button>
        </div>
      ) : (
        <div className="line">
          {showBestLine && (
            <>
              <span className="muted">Best line:</span>
              {lineSans.slice(0, 8).map((s, i) => (
                <button key={i} className="chip" onClick={() => onLine(move.fenBefore, lineSans.slice(0, 8), i + 1)}>{s}</button>
              ))}
            </>
          )}
          {reply.length > 0 && !['book', 'forced', 'best'].includes(move.cls) && !new Chess(move.fenAfter).isGameOver() && (
            <button className="link" onClick={() => onLine(move.fenAfter, reply.slice(0, 8), 1)}>{['brilliant', 'great', 'excellent', 'good'].includes(move.cls) ? 'see the follow-up' : `see why ${move.san} is bad`} →</button>
          )}
        </div>
      )}
    </div>
  )
}

function MoveList({ review, ply, onSelect }: { review: GameReview; ply: number; onSelect: (p: number) => void }) {
  const rows: [MoveReview | undefined, MoveReview | undefined][] = []
  const ms = review.moves
  let i = 0
  if (ms[0]?.color === 'b') rows.push([undefined, ms[i++]])
  for (; i < ms.length; i += 2) rows.push([ms[i], ms[i + 1]])
  useEffect(() => {
    document.querySelector('.movelist .on')?.scrollIntoView({ block: 'nearest' })
  }, [ply])
  const cell = (m?: MoveReview) =>
    m ? (
      <button className={`mv${m.ply === ply ? ' on' : ''}`} onClick={() => onSelect(m.ply)}>
        <Badge cls={m.cls} size={16} /> {m.san}
      </button>
    ) : <span className="mv" />
  return (
    <div className="movelist">
      {rows.map(([w, b], r) => (
        <div className="mrow" key={r}>
          <span className="mno">{Math.ceil((w ?? b)!.ply / 2)}.</span>
          {cell(w)}
          {cell(b)}
        </div>
      ))}
    </div>
  )
}
