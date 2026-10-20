import { useEffect, useState } from 'react'
import { ReviewView } from './components/ReviewView'
import { TrainView } from './components/TrainView'
import { LessonsView } from './components/LessonsView'
import { ProfileView } from './components/ProfileView'
import { reviewGame, type GameReview } from './lib/review'
import { fetchChessCom, fetchLichess, type GameSummary } from './lib/importers'
import { loadProgress, setPlayer } from './lib/progress'
import { playerSide } from './lib/training'

type View = 'review' | 'train' | 'lessons' | 'profile'

/** Hash routes: #/review, #/train, #/train/<lesson>, #/lessons, #/lessons/<lesson>, #/profile */
function readRoute(): { view: View; arg?: string } {
  const [, view = 'review', arg] = location.hash.replace(/^#/, '').split('/')
  return { view: (['review', 'train', 'lessons', 'profile'].includes(view) ? view : 'review') as View, arg: arg || undefined }
}
const goTo = (view: View, arg?: string) => { location.hash = `/${view}${arg ? `/${arg}` : ''}` }

function Nav({ view }: { view: View }) {
  const items: [View, string][] = [['review', 'Review'], ['train', 'Train'], ['lessons', 'Lessons'], ['profile', 'Profile']]
  return (
    <nav className="topnav">
      <a className="brand" href="#/review"><span className="logo">♞</span> Game Review</a>
      <div className="navlinks">
        {items.map(([v, label]) => <a key={v} href={`#/${v}`} className={view === v ? 'on' : ''}>{label}</a>)}
      </div>
    </nav>
  )
}

type Source = 'chess.com' | 'lichess' | 'pgn'

const DEPTHS = [
  { label: 'Fast', depth: 14 },
  { label: 'Standard', depth: 18 },
  { label: 'Deep', depth: 22 },
]

const SAMPLE = `[Event "Opera Game"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`

const savedUser = (k: string) => {
  try {
    return localStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}

export default function App() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const on = () => setRoute(readRoute())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return (
    <>
      <Nav view={route.view} />
      {route.view === 'train' ? (
        <TrainView key={route.arg ?? 'daily'} lesson={route.arg} onLesson={id => goTo('lessons', id)} />
      ) : route.view === 'lessons' ? (
        <LessonsView selected={route.arg} onSelect={id => goTo('lessons', id)} onPractice={id => goTo('train', id)} />
      ) : route.view === 'profile' ? (
        <ProfileView onPractice={id => goTo('train', id)} onLesson={id => goTo('lessons', id)} />
      ) : (
        <ReviewPage />
      )}
    </>
  )
}

function ReviewPage() {
  const [source, setSource] = useState<Source>(() => (savedUser('src') as Source) || 'chess.com')
  const [username, setUsername] = useState(() => savedUser('user'))
  const [pgn, setPgn] = useState('')
  const [games, setGames] = useState<GameSummary[] | null>(null)
  const [depth, setDepth] = useState(18)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<GameReview | null>(null)

  const loadGames = async () => {
    setError(null)
    setBusy('Fetching games…')
    try {
      const list = source === 'lichess' ? await fetchLichess(username) : await fetchChessCom(username)
      setGames(list)
      try {
        localStorage.setItem('user', username)
        if (!loadProgress().player) setPlayer(username.trim(), source)
        localStorage.setItem('src', source)
      } catch { /* storage unavailable */ }
      if (!list.length) setError('No recent standard games found.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const analyse = async (text: string) => {
    setError(null)
    setProgress(0)
    setBusy('Analysing with Stockfish…')
    try {
      setReview(await reviewGame(text, depth, (d, t) => setProgress(d / t)))
    } catch (e) {
      setError((e as Error).message || 'Could not read that PGN.')
    } finally {
      setBusy(null)
    }
  }

  if (review) {
    const name = loadProgress().player?.name ?? (source !== 'pgn' ? username : undefined)
    return (
      <ReviewView
        review={review}
        player={playerSide(review, name)}
        onBack={() => setReview(null)}
        onLesson={id => goTo('lessons', id)}
        onPractice={id => goTo('train', id)}
      />
    )
  }

  return (
    <main className="home">
      <header>
        <h1><span className="logo">♞</span> Game Review</h1>
        <p className="muted">Every move graded and explained by Stockfish — in plain words. Runs entirely in your browser.</p>
      </header>

      <div className="card">
        <div className="tabs" role="tablist">
          {(['chess.com', 'lichess', 'pgn'] as Source[]).map(s => (
            <button key={s} role="tab" aria-selected={source === s} className={source === s ? 'on' : ''} onClick={() => { setSource(s); setGames(null); setError(null) }}>
              {s === 'pgn' ? 'Paste PGN' : s === 'lichess' ? 'Lichess' : 'Chess.com'}
            </button>
          ))}
        </div>

        {source === 'pgn' ? (
          <div className="stack">
            <textarea value={pgn} onChange={e => setPgn(e.target.value)} placeholder="Paste a PGN here…" rows={9} spellCheck={false} />
            <div className="row">
              <button className="primary" disabled={!!busy || !pgn.trim()} onClick={() => analyse(pgn)}>Review game</button>
              <button className="link" onClick={() => setPgn(SAMPLE)}>Try Morphy's Opera Game</button>
            </div>
          </div>
        ) : (
          <form className="row" onSubmit={e => { e.preventDefault(); if (username.trim()) loadGames() }}>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder={`${source} username`} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <button className="primary" disabled={!!busy || !username.trim()}>Find games</button>
          </form>
        )}

        <div className="depth">
          <span className="muted">Analysis</span>
          {DEPTHS.map(d => (
            <button key={d.depth} className={`pill${depth === d.depth ? ' on' : ''}`} onClick={() => setDepth(d.depth)}>
              {d.label} <span className="muted">d{d.depth}</span>
            </button>
          ))}
        </div>

        {busy && (
          <div className="progress">
            <span>{busy}</span>
            {busy.startsWith('Analysing') && <div className="bar"><div style={{ width: `${progress * 100}%` }} /></div>}
          </div>
        )}
        {error && <p className="error">{error}</p>}

        {games && source !== 'pgn' && !busy && (
          <ul className="games">
            {games.map(g => (
              <li key={g.id}>
                <button onClick={() => analyse(g.pgn)}>
                  <span className="g-players">
                    <span><span className="dot w" />{g.white}</span>
                    <span><span className="dot b" />{g.black}</span>
                  </span>
                  <span className="g-meta">
                    <span className="result">{g.result}</span>
                    <span className="muted">{g.speed} · {new Date(g.date).toLocaleDateString()}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
