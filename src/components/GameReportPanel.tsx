import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { coachGame } from '../lib/coach'
import { lessonById } from '../content/lessons'
import { addGame, hasGame, loadProgress, subscribe } from '../lib/progress'
import { gameId, ownExercises, summarize } from '../lib/training'
import { askAiCoach, getApiKey } from '../lib/aiCoach'
import type { GameReview } from '../lib/review'

/** Tiny, safe Markdown renderer for the AI coach (headings, bullets, bold). */
function Markdown({ text }: { text: string }) {
  const bold = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{bold(b)}</li>)}</ul>)
    bullets = []
  }
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (/^[-*] /.test(t)) { bullets.push(t.slice(2)); continue }
    flush()
    if (!t) continue
    if (t.startsWith('#')) blocks.push(<h4 key={blocks.length}>{t.replace(/^#+\s*/, '')}</h4>)
    else blocks.push(<p key={blocks.length}>{bold(t)}</p>)
  }
  flush()
  return <div className="markdown">{blocks}</div>
}

export function GameReportPanel({ review, player, onGo, onLesson, onPractice }: {
  review: GameReview
  player?: 'w' | 'b'
  onGo: (ply: number) => void
  onLesson: (id: string) => void
  onPractice: (id?: string) => void
}) {
  const [side, setSide] = useState<'w' | 'b' | undefined>(player)
  const report = useMemo(() => (side ? coachGame(review, side) : null), [review, side])
  const saved = useSyncExternalStore(subscribe, () => hasGame(gameId(review)))
  const [ai, setAi] = useState<{ text: string; busy: boolean; error?: string } | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  useEffect(() => {
    if (!side || saved) return
    addGame(summarize(review, side), ownExercises(review, side))
  }, [side, saved, review])

  if (!side || !report) {
    return (
      <div className="report">
        <p>Which side did you play? The coach report and your training plan are written from your point of view.</p>
        <div className="row">
          <button className="pill" onClick={() => setSide('w')}>White · {review.white}</button>
          <button className="pill" onClick={() => setSide('b')}>Black · {review.black}</button>
        </div>
      </div>
    )
  }

  const own = loadProgress().own.filter(o => o.game === gameId(review)).length

  return (
    <div className="report">
      <p className="lead">{report.overview}</p>

      <h3>Phases</h3>
      {report.phases.map(p => (
        <div key={p.phase} className="phase">
          <div className="phase-head">
            <strong>{p.phase[0].toUpperCase() + p.phase.slice(1)}</strong>
            {p.moves > 0 && <span className="muted small">{p.accuracy.toFixed(0)}% · {p.moves} moves</span>}
          </div>
          {p.moves > 0 && <div className="bar"><div style={{ width: `${p.accuracy}%` }} /></div>}
          <p className="small">{p.text}</p>
        </div>
      ))}

      {report.structures.length > 0 && (
        <>
          <h3>Pawn structure</h3>
          {report.structures.map(s => (
            <div key={s.id} className="structure">
              <p><strong>{s.name}</strong> <span className="muted small">(from move {Math.ceil(s.fromPly / 2)})</span></p>
              <p className="small">{s.plan}</p>
              {s.lesson && <button className="chip" onClick={() => onLesson(s.lesson!)}>Lesson: {lessonById(s.lesson)?.title}</button>}
            </div>
          ))}
        </>
      )}

      {report.moments.length > 0 && (
        <>
          <h3>Key moments</h3>
          {report.moments.map(m => (
            <button key={m.ply} className="moment-row" onClick={() => onGo(m.ply)}>{m.text}</button>
          ))}
        </>
      )}

      {report.strengths.length > 0 && (
        <>
          <h3>What went well</h3>
          <ul>{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}

      {report.improve.length > 0 && (
        <>
          <h3>Work on</h3>
          {report.improve.map(i => (
            <div key={i.lesson} className="improve">
              <button className="link" onClick={() => onLesson(i.lesson)}>{lessonById(i.lesson)?.title ?? i.lesson}</button>
              <span className="muted small"> — {i.why}</span>
              <button className="pill" onClick={() => onPractice(i.lesson)}>Practise</button>
            </div>
          ))}
        </>
      )}

      <div className="row">
        {own > 0 && <button className="primary" onClick={() => onPractice(`game-${gameId(review)}`)}>Train on this game ({own} positions)</button>}
        <span className="muted small">{saved ? 'Saved to your training profile.' : ''}</span>
      </div>

      <h3>AI coach</h3>
      {!getApiKey() ? (
        <p className="muted small">Optional: add your Anthropic API key in Profile to get a written review from Claude, based only on the verified analysis above.</p>
      ) : ai ? (
        <div className="ai">
          {ai.error ? <p className="error">{ai.error}</p> : <Markdown text={ai.text || 'Thinking…'} />}
          {ai.busy && <button className="link" onClick={() => abort.current?.abort()}>Stop</button>}
        </div>
      ) : (
        <button className="pill" onClick={() => {
          abort.current = new AbortController()
          setAi({ text: '', busy: true })
          const lang = navigator.language?.startsWith('el') ? 'Greek' : undefined
          askAiCoach(review, side, text => setAi({ text, busy: true }), lang, abort.current.signal)
            .then(text => setAi({ text, busy: false }))
            .catch(e => setAi(a => ({ text: a?.text ?? '', busy: false, error: (e as Error).name === 'AbortError' ? undefined : (e as Error).message })))
        }}>Ask the AI coach</button>
      )}
    </div>
  )
}
