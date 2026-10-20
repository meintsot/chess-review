import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { Board } from './Board'
import { exerciseEngine as engine } from '../lib/exerciseEngine'
import { conceptDeltas, type ConceptDelta } from '../lib/positional'
import { conceptTextEl } from '../lib/positional.el'
import { explainLine, voice } from '../lib/coach'
import { localizedLesson } from '../content/lessons'
import { recordAttempt } from '../lib/progress'
import type { Exercise } from '../lib/training'
import { structuresIn } from '../lib/training'
import { structureInfo } from '../lib/structures'
import { tr, useLang, type Lang } from '../i18n'


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

/** Concept change as a verb phrase from the mover's point of view ("improves your bishop"). */
const conceptText = (c: ConceptDelta, mover: 'w' | 'b', lang: Lang) => (lang === 'el' ? conceptTextEl(c, mover) : c.text)

/** Plain-language reasons why `uci` is good in `fen`: tactics in the line plus positional gains. */
function explainMove(fen: string, uci: string, line: string[], lang: Lang): string[] {
  const out: string[] = []
  const side = fen.split(' ')[1] as 'w' | 'b'
  const tactic = explainLine(fen, [uci, ...line], undefined, lang)
  if (tactic) out.push(`${tactic[0].toUpperCase() === tactic[0] || /^[a-h]/.test(tactic) ? tactic : tactic[0].toUpperCase() + tactic.slice(1)}.`)
  try {
    const gains = conceptDeltas(fen, fenAfter(fen, uci)).filter(c => c.side === side && c.delta > 0 && !/mobility/i.test(c.concept)).slice(0, 2)
    if (gains.length && !tactic) {
      out.push(lang === 'el'
        ? `Θεσιακά, η κίνηση ${gains.map(g => conceptText(g, side, lang)).join(' και ')}.`
        : voice(`Positionally it ${gains.map(g => g.text).join(' and ')}.`, side))
    }
  } catch {
    // ignore
  }
  return out
}

/** Own-game notes saved before Greek notes existed: translate at least the lead-in. */
const localNote = (note: string, lang: Lang) => (lang === 'el' ? note.replace(/^In your game you played (\S+)\./, 'Στην παρτίδα σου έπαιξες $1.') : note)

type State =
  | { stage: 'playing' }
  | { stage: 'checking' }
  | { stage: 'done'; success: boolean; points?: number; best: string; played?: string; notes: (lang: Lang) => string[] }

export function ExercisePlayer({ exercise, onNext }: { exercise: Exercise; onNext: (success: boolean) => void }) {
  const lang = useLang()
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
          const notes = (l: Lang) => explainMove(start, exercise.moves[1], exercise.moves.slice(2), l)
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
        finish(false, { best: sanOf(fen, expected), played: sanOf(fen, uci), notes: l => explainMove(fen, expected, exercise.moves.slice(step + 1), l) })
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
    const side = fen.split(' ')[1] as 'w' | 'b'
    let worse: ConceptDelta | undefined
    if (uci !== bestUci) {
      try {
        worse = conceptDeltas(fen, fenAfter(fen, uci)).filter(c => c.side === side && c.delta < 0 && !/mobility/i.test(c.concept))[0]
      } catch {
        // best-effort
      }
    }
    const s0 = structuresIn(fen)[0]
    const note = exercise.note
    const notes = (l: Lang) => {
      const out = explainMove(fen, bestUci, [], l)
      if (worse) {
        out.push(l === 'el'
          ? `Η κίνησή σου ${sanOf(fen, uci)} ${conceptText(worse, side, l)}.`
          : voice(`Your move ${sanOf(fen, uci)} ${worse.text}.`, side))
      }
      // Structure exercises: remind the plan for this side of the structure.
      const info = s0 && structureInfo(s0.id, l)
      if (info) out.push(`${info.name}: ${s0.owner === 'both' || s0.owner === side ? info.plansFor.owner : info.plansFor.opponent}`)
      if (l === 'el' && exercise.kind === 'choice' && exercise.noteEl) out.push(exercise.noteEl)
      else if (note) out.push(localNote(note, l))
      return out
    }
    finish(success, { points, best: sanOf(fen, bestUci), played: sanOf(fen, uci), notes })
  }

  const lesson = exercise.lesson ? localizedLesson(exercise.lesson, lang) : undefined
  const structures = structuresIn(exercise.fen)
  const ownGame = exercise.title === 'From your game'
  const notes = useMemo(() => (state.stage === 'done' ? state.notes(lang) : []), [state, lang])
  const toMove = solverColor === 'w' ? 'White' : 'Black'
  const toMoveEl = solverColor === 'w' ? 'Παίζουν τα λευκά' : 'Παίζουν τα μαύρα'
  const prompt = isPuzzle
    ? tr({ en: `${toMove} to move — find the best continuation.`, el: `${toMoveEl} — βρες την καλύτερη συνέχεια.` }, lang)
    : ownGame
      ? tr({ en: `${toMove} to move. In your game you went wrong here — find the engine's move.`, el: `${toMoveEl}. Σε αυτή τη θέση έκανες λάθος στην παρτίδα σου — βρες την κίνηση της μηχανής.` }, lang)
      : tr({ en: `${toMove} to move — find the strongest plan.`, el: `${toMoveEl} — βρες το ισχυρότερο σχέδιο.` }, lang)

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
          <span className="pill on">{exercise.kind === 'puzzle'
            ? tr({ en: 'Tactics', el: 'Τακτική' }, lang)
            : ownGame ? tr({ en: 'Your game', el: 'Η παρτίδα σου' }, lang) : tr({ en: 'Strategy', el: 'Στρατηγική' }, lang)}</span>
          {exercise.rating > 0 && <span className="muted small">≈{exercise.rating}</span>}
        </div>
        <p className="ex-prompt">{prompt}</p>
        {structures.length > 0 && (
          <p className="muted small">
            {tr({ en: 'Structure', el: structures.length > 1 ? 'Δομές' : 'Δομή' }, lang)}: {structures.map(s => structureInfo(s.id, lang)?.name ?? s.name).join(', ')}
          </p>
        )}
        {state.stage === 'checking' && <p className="muted">{tr({ en: 'Checking your move with Stockfish…', el: 'Ελέγχω την κίνησή σου με το Stockfish…' }, lang)}</p>}
        {state.stage === 'done' && (
          <div className={`ex-result ${state.success ? 'ok' : 'bad'}`}>
            <strong>{state.success
              ? (state.points !== undefined && state.points < 10 ? tr({ en: `Good — ${state.points}/10`, el: `Καλή κίνηση — ${state.points}/10` }, lang) : tr({ en: 'Correct!', el: 'Σωστά!' }, lang))
              : tr({ en: 'Not quite.', el: 'Όχι ακριβώς.' }, lang)}</strong>
            {!state.success && (lang === 'el'
              ? <span> Η σωστή κίνηση ήταν το <b>{state.best}</b>{state.played ? ` (εσύ έπαιξες ${state.played})` : ''}.</span>
              : <span> The key move was <b>{state.best}</b>{state.played ? ` (you played ${state.played})` : ''}.</span>)}
            {state.success && state.played !== state.best && state.best && (lang === 'el'
              ? <span> Η πρώτη επιλογή της μηχανής ήταν το <b>{state.best}</b>.</span>
              : <span> The engine's top choice was <b>{state.best}</b>.</span>)}
            {notes.map((n, i) => <p key={i}>{n}</p>)}
            {lesson && <p className="muted small">{tr({ en: 'Lesson', el: 'Μάθημα' }, lang)}: {lesson.title} — {lesson.summary}</p>}
            <button className="primary" onClick={() => onNext(state.success)}>{tr({ en: 'Next →', el: 'Επόμενη →' }, lang)}</button>
          </div>
        )}
        {state.stage === 'playing' && (
          <button className="link" onClick={() => {
            const best = exercise.kind === 'puzzle' ? exercise.moves[step] : exercise.answers[0][0]
            const rest = exercise.kind === 'puzzle' ? exercise.moves.slice(step + 1) : []
            setShapes([arrow(best, 'green')])
            finish(false, { best: sanOf(fen, best), notes: l => explainMove(fen, best, rest, l) })
          }}>{tr({ en: 'Show solution', el: 'Δείξε τη λύση' }, lang)}</button>
        )}
      </div>
    </div>
  )
}
