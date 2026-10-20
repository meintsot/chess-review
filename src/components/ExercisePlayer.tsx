import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { Board } from './Board'
import { exerciseEngine as engine } from '../lib/exerciseEngine'
import { conceptDeltas } from '../lib/positional'
import { explainLine, voice } from '../lib/coach'
import { lessonById } from '../content/lessons'
import { recordAttempt } from '../lib/progress'
import type { Exercise } from '../lib/training'
import { structuresIn } from '../lib/training'
import { STRUCTURES } from '../lib/structures'


const sanOf = (fen: string, uci: string) => {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
  } catch {
    return uci
  }
}
const fenAfter = (fen: string, uci: string) => {
  const c = new Chess(fen)
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  return c.fen()
}
const arrow = (uci: string, brush: string): DrawShape => ({ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush })

/** Plain-language reasons why `uci` is good in `fen`: tactics in the line plus positional gains. */
function explainMove(fen: string, uci: string, line: string[] = []): string[] {
  const out: string[] = []
  const side = fen.split(' ')[1] as 'w' | 'b'
  const tactic = explainLine(fen, [uci, ...line])
  if (tactic) out.push(`${tactic[0].toUpperCase() === tactic[0] || /^[a-h]/.test(tactic) ? tactic : tactic[0].toUpperCase() + tactic.slice(1)}.`)
  try {
    const gains = conceptDeltas(fen, fenAfter(fen, uci)).filter(c => c.side === side && c.delta > 0 && !/mobility/i.test(c.concept)).slice(0, 2)
    if (gains.length && !tactic) out.push(voice(`Positionally it ${gains.map(g => g.text).join(' and ')}.`, side))
  } catch {
    // ignore
  }
  return out
}

type State =
  | { stage: 'playing' }
  | { stage: 'checking' }
  | { stage: 'done'; success: boolean; points?: number; best: string; played?: string; notes: string[] }

export function ExercisePlayer({ exercise, onNext }: { exercise: Exercise; onNext: (success: boolean) => void }) {
  const isPuzzle = exercise.kind === 'puzzle'
  // Lichess puzzles start one move earlier: the opponent's move is played automatically.
  const [fen, setFen] = useState(exercise.fen)
  const [step, setStep] = useState(isPuzzle ? 0 : 1)
  const [last, setLast] = useState<[string, string] | undefined>()
  const [state, setState] = useState<State>({ stage: 'playing' })
  const [shapes, setShapes] = useState<DrawShape[]>([])
  const recorded = useRef(false)

  const solverColor = useMemo(() => {
    if (!isPuzzle) return exercise.fen.split(' ')[1] as 'w' | 'b'
    return exercise.fen.split(' ')[1] === 'w' ? 'b' : 'w'
  }, [exercise, isPuzzle])

  // The parent remounts this component per exercise (key), so state starts fresh; only the opening
  // opponent move of a Lichess puzzle needs a timer.
  useEffect(() => {
    if (exercise.kind === 'puzzle') {
      const first = exercise.moves[0]
      const t = setTimeout(() => {
        setFen(fenAfter(exercise.fen, first))
        setLast([first.slice(0, 2), first.slice(2, 4)])
        setStep(1)
      }, 600)
      return () => clearTimeout(t)
    }
  }, [exercise, isPuzzle])

  const finish = (success: boolean, info: Omit<Extract<State, { stage: 'done' }>, 'stage' | 'success'>) => {
    if (!recorded.current) {
      recordAttempt(exercise.id, success)
      recorded.current = true
    }
    setState({ stage: 'done', success, ...info })
  }

  const onMove = async (uci: string) => {
    if (state.stage !== 'playing') return
    if (exercise.kind === 'puzzle') {
      const expected = exercise.moves[step]
      const after = fenAfter(fen, uci)
      const mates = new Chess(after).isCheckmate()
      if (uci === expected || mates) {
        setFen(after)
        setLast([uci.slice(0, 2), uci.slice(2, 4)])
        const next = step + 1
        if (next >= exercise.moves.length || mates) {
          // Explain the whole solution from the position the solver faced, not just the last move.
          const start = fenAfter(exercise.fen, exercise.moves[0])
          const notes = explainMove(start, exercise.moves[1], exercise.moves.slice(2))
          finish(true, { best: sanOf(fen, expected), played: sanOf(fen, uci), notes })
          return
        }
        const reply = exercise.moves[next]
        setTimeout(() => {
          setFen(fenAfter(after, reply))
          setLast([reply.slice(0, 2), reply.slice(2, 4)])
          setStep(next + 1)
        }, 450)
        setStep(next)
      } else {
        setShapes([arrow(expected, 'green'), arrow(uci, 'red')])
        finish(false, { best: sanOf(fen, expected), played: sanOf(fen, uci), notes: explainMove(fen, expected, exercise.moves.slice(step + 1)) })
      }
      return
    }

    // Choice exercises: one move, scored from the answer table (or by the engine for own-game positions).
    const bestUci = exercise.answers[0][0]
    let points = exercise.answers.find(a => a[0] === uci)?.[1]
    if (points === undefined && exercise.engineCheck) {
      setState({ stage: 'checking' })
      try {
        const [res] = await engine().analyseAll([{ startFen: fenAfter(fen, uci), moves: [], depth: 14, multiPv: 1 }])
        const [bestRes] = await engine().analyseAll([{ startFen: fenAfter(fen, bestUci), moves: [], depth: 14, multiPv: 1 }])
        const cp = (r: typeof res) => { const s = r.lines[0]?.score; return !s ? 0 : 'mate' in s ? (s.mate > 0 ? -10000 : 10000) : -s.cp }
        const loss = Math.max(0, cp(bestRes) - cp(res))
        points = loss <= 20 ? 10 : Math.round(10 * Math.exp(-loss / 60))
      } catch {
        points = 0
      }
    }
    points ??= 0
    const success = points >= 7
    setFen(fenAfter(fen, uci))
    setLast([uci.slice(0, 2), uci.slice(2, 4)])
    setShapes(uci === bestUci ? [] : [arrow(bestUci, 'green')])
    const notes = explainMove(fen, bestUci)
    if (exercise.note) notes.push(exercise.note)
    finish(success, { points, best: sanOf(fen, bestUci), played: sanOf(fen, uci), notes })
  }

  const lesson = exercise.lesson ? lessonById(exercise.lesson) : undefined
  const structures = structuresIn(exercise.fen)
  const toMove = solverColor === 'w' ? 'White' : 'Black'
  const prompt = isPuzzle
    ? `${toMove} to move — find the best continuation.`
    : exercise.title === 'From your game'
      ? `${toMove} to move. In your game you went wrong here — find the engine's move.`
      : `${toMove} to move — find the strongest plan.`

  return (
    <div className="exercise" data-fen={fen}>
      <div className="exercise-board">
        <Board
          fen={fen}
          orientation={solverColor === 'w' ? 'white' : 'black'}
          lastMove={last}
          shapes={shapes}
          check={new Chess(fen).inCheck()}
          onMove={state.stage === 'playing' && step % 2 === 1 ? onMove : undefined}
        />
      </div>
      <div className="exercise-side">
        <div className="ex-title">
          <span className="pill on">{exercise.kind === 'puzzle' ? 'Tactics' : exercise.title === 'From your game' ? 'Your game' : 'Strategy'}</span>
          {exercise.rating > 0 && <span className="muted small">≈{exercise.rating}</span>}
        </div>
        <p className="ex-prompt">{prompt}</p>
        {structures.length > 0 && (
          <p className="muted small">Structure: {structures.map(s => STRUCTURES[s.id]?.name ?? s.name).join(', ')}</p>
        )}
        {state.stage === 'checking' && <p className="muted">Checking your move with Stockfish…</p>}
        {state.stage === 'done' && (
          <div className={`ex-result ${state.success ? 'ok' : 'bad'}`}>
            <strong>{state.success ? (state.points !== undefined && state.points < 10 ? `Good — ${state.points}/10` : 'Correct!') : 'Not quite.'}</strong>
            {!state.success && <span> The key move was <b>{state.best}</b>{state.played ? ` (you played ${state.played})` : ''}.</span>}
            {state.success && state.played !== state.best && state.best && <span> The engine's top choice was <b>{state.best}</b>.</span>}
            {state.notes.map((n, i) => <p key={i}>{n}</p>)}
            {lesson && <p className="muted small">Lesson: {lesson.title} — {lesson.summary}</p>}
            <button className="primary" onClick={() => onNext(state.success)}>Next →</button>
          </div>
        )}
        {state.stage === 'playing' && (
          <button className="link" onClick={() => {
            const best = exercise.kind === 'puzzle' ? exercise.moves[step] : exercise.answers[0][0]
            setShapes([arrow(best, 'green')])
            finish(false, { best: sanOf(fen, best), notes: explainMove(fen, best, exercise.kind === 'puzzle' ? exercise.moves.slice(step + 1) : []) })
          }}>Show solution</button>
        )}
      </div>
    </div>
  )
}
