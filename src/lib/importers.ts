export interface GameSummary {
  id: string
  pgn: string
  white: string
  black: string
  result: string
  date: number // ms
  speed: string
  source: 'chess.com' | 'lichess'
}

export async function fetchChessCom(username: string): Promise<GameSummary[]> {
  const user = username.trim().toLowerCase()
  const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`)
  if (!res.ok) throw new Error(res.status === 404 ? `No chess.com player "${username}".` : `chess.com error ${res.status}`)
  const { archives } = (await res.json()) as { archives: string[] }
  const games: GameSummary[] = []
  for (const url of [...archives].reverse().slice(0, 3)) {
    const month = (await (await fetch(url)).json()) as { games: any[] }
    for (const g of month.games.reverse()) {
      if (!g.pgn || g.rules !== 'chess') continue
      games.push({
        id: g.url,
        pgn: g.pgn,
        white: `${g.white.username} (${g.white.rating})`,
        black: `${g.black.username} (${g.black.rating})`,
        result: /\[Result "([^"]+)"\]/.exec(g.pgn)?.[1] ?? '*',
        date: g.end_time * 1000,
        speed: g.time_class,
        source: 'chess.com',
      })
    }
    if (games.length >= 25) break
  }
  return games.slice(0, 25)
}

export async function fetchLichess(username: string): Promise<GameSummary[]> {
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(username.trim())}?max=25&pgnInJson=true&clocks=false&evals=false`,
    { headers: { Accept: 'application/x-ndjson' } },
  )
  if (!res.ok) throw new Error(res.status === 404 ? `No lichess player "${username}".` : `lichess error ${res.status}`)
  const text = await res.text()
  return text
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
    .filter(g => g.variant === 'standard' && g.pgn)
    .map(g => {
      const name = (p: any) => `${p.user?.name ?? (p.aiLevel ? `Stockfish L${p.aiLevel}` : 'Anonymous')}${p.rating ? ` (${p.rating})` : ''}`
      return {
        id: g.id,
        pgn: g.pgn,
        white: name(g.players.white),
        black: name(g.players.black),
        result: /\[Result "([^"]+)"\]/.exec(g.pgn)?.[1] ?? '*',
        date: g.createdAt,
        speed: g.speed,
        source: 'lichess' as const,
      }
    })
}
