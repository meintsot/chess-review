import { useState, useSyncExternalStore } from 'react'
import { exportProgress, importProgress, loadProgress, resetProgress, setPlayer, streak, subscribe, weaknessProfile } from '../lib/progress'
import { getApiKey, setApiKey } from '../lib/aiCoach'

export function ProfileView({ onPractice, onLesson }: { onPractice: (id: string) => void; onLesson: (id: string) => void }) {
  const p = useSyncExternalStore(subscribe, loadProgress)
  const [name, setName] = useState(p.player?.name ?? '')
  const [key, setKey] = useState(getApiKey())
  const [msg, setMsg] = useState<string | null>(null)
  const weak = weaknessProfile().slice(0, 8)
  const max = Math.max(0.0001, ...weak.map(w => w.weight))
  const cards = Object.values(p.cards)
  const solved = cards.reduce((a, c) => a + c.correct, 0)
  const tried = cards.reduce((a, c) => a + c.seen, 0)
  const recent = p.games.slice(0, 10)
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

  return (
    <main className="page">
      <h2>Your profile</h2>
      <div className="stats">
        <div><span className="big">{p.games.length}</span><span className="muted small">games reviewed</span></div>
        <div><span className="big">{recent.length ? avg(recent.map(g => g.accuracy)).toFixed(1) : '–'}</span><span className="muted small">avg accuracy (last 10)</span></div>
        <div><span className="big">{solved}/{tried}</span><span className="muted small">exercises solved</span></div>
        <div><span className="big">{streak()}</span><span className="muted small">day streak</span></div>
      </div>

      <section>
        <h3>What to work on</h3>
        {weak.length === 0 ? (
          <p className="muted">Review a few of your games (with your username set below) and your weaknesses will show up here.</p>
        ) : (
          <div className="weak-list">
            {weak.map(w => (
              <div key={w.lesson} className="weak-row">
                <button className="link" onClick={() => onLesson(w.lesson)}>{w.title}</button>
                <div className="bar"><div style={{ width: `${(w.weight / max) * 100}%` }} /></div>
                <span className="muted small">{w.games} game{w.games > 1 ? 's' : ''}</span>
                <button className="pill" onClick={() => onPractice(w.lesson)}>Practise</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h3>Recent games</h3>
          <table className="games-table">
            <tbody>
              {recent.map(g => (
                <tr key={g.id}>
                  <td>{g.color === 'w' ? '♔' : '♚'} {g.color === 'w' ? g.black : g.white}</td>
                  <td>{g.result}</td>
                  <td>{g.accuracy.toFixed(1)}%</td>
                  <td className="muted">{g.rating}</td>
                  <td className="muted small">{g.opening?.replace(/^[A-E]\d\d /, '') ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h3>Settings</h3>
        <label className="field">
          <span>Your username (chess.com or Lichess) — used to know which side you played</span>
          <div className="row">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="username" />
            <button className="pill" onClick={() => { setPlayer(name.trim(), p.player?.source ?? 'chess.com'); setMsg('Saved.') }}>Save</button>
          </div>
        </label>
        <label className="field">
          <span>AI coach (optional): your Anthropic API key. It is stored only in this browser and sent only to Anthropic.</span>
          <div className="row">
            <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
            <button className="pill" onClick={() => { setApiKey(key); setMsg(key ? 'AI coach enabled.' : 'Key removed.') }}>Save</button>
          </div>
        </label>
        <div className="row">
          <button className="pill" onClick={() => {
            const blob = new Blob([exportProgress()], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = 'game-review-progress.json'
            a.click()
            URL.revokeObjectURL(a.href)
          }}>Export progress</button>
          <label className="pill file">
            Import progress
            <input type="file" accept="application/json" onChange={async e => {
              const f = e.target.files?.[0]
              if (!f) return
              try { importProgress(await f.text()); setMsg('Progress imported.') } catch (err) { setMsg((err as Error).message) }
            }} />
          </label>
          <button className="pill danger" onClick={() => { if (confirm('Delete all training progress in this browser?')) { resetProgress(); setMsg('Progress reset.') } }}>Reset</button>
        </div>
        {msg && <p className="muted small">{msg}</p>}
      </section>

      <section className="about">
        <h3>About &amp; credits</h3>
        <p className="small">
          Free and open source (<a href="https://github.com/meintsot/chess-review">source code</a>, AGPL-3.0). Analysis runs entirely in your
          browser; your games and progress are stored only on this device. Not affiliated with chess.com or Lichess.
        </p>
        <p className="small muted">
          Built on Stockfish 18 (GPLv3), chessground (GPLv3), chess.js (BSD), the lichess-puzzler tactic tagger (AGPLv3), the Stockfish
          Evaluation Guide (GPLv3), Lichess puzzles, games and openings (CC0), the Strategic Test Suite (MIT) and Maia-2 (MIT).
        </p>
      </section>
    </main>
  )
}
