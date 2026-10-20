import { useEffect, useRef } from 'react'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { Chess, type Square } from 'chess.js'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

interface Props {
  fen: string
  orientation: 'white' | 'black'
  lastMove?: [string, string]
  shapes: DrawShape[]
  check?: boolean
  /** When set, the side to move can play legal moves; called with the UCI move (auto-queens). */
  onMove?: (uci: string) => void
}

function legalDests(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>()
  try {
    const c = new Chess(fen)
    for (const m of c.moves({ verbose: true })) {
      const list = dests.get(m.from as Key) ?? []
      if (!list.includes(m.to as Key)) list.push(m.to as Key)
      dests.set(m.from as Key, list)
    }
  } catch {
    // invalid FEN: no moves
  }
  return dests
}

function toUci(fen: string, from: string, to: string): string {
  const c = new Chess(fen)
  const piece = c.get(from as Square)
  const promo = piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : ''
  return from + to + promo
}

export function Board({ fen, orientation, lastMove, shapes, check, onMove }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  const moveRef = useRef(onMove)
  const fenRef = useRef(fen)
  useEffect(() => {
    moveRef.current = onMove
    fenRef.current = fen
  })

  useEffect(() => {
    api.current = Chessground(el.current!, {
      viewOnly: false,
      movable: { free: false, color: undefined },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      animation: { enabled: true, duration: 180 },
      coordinates: true,
      drawable: { enabled: true, visible: true, eraseOnClick: true },
      events: { move: (from, to) => moveRef.current?.(toUci(fenRef.current, from, to)) },
    })
    if (import.meta.env.DEV) (window as unknown as { __boards?: Api[] }).__boards = [...((window as unknown as { __boards?: Api[] }).__boards ?? []), api.current]
    return () => api.current?.destroy()
  }, [])

  const lastKey = lastMove?.join('')
  const interactive = !!onMove
  useEffect(() => {
    const cg = api.current
    if (!cg) return
    const turn = fen.split(' ')[1] === 'b' ? 'black' : 'white'
    cg.set({
      fen,
      orientation,
      lastMove: lastKey ? ([lastKey.slice(0, 2), lastKey.slice(2, 4)] as Key[]) : undefined,
      check: check ?? false,
      turnColor: turn,
      movable: interactive ? { free: false, color: turn, dests: legalDests(fen), showDests: true } : { free: false, color: undefined, dests: new Map() },
    })
    cg.setAutoShapes(shapes)
  }, [fen, orientation, lastKey, shapes, check, interactive])

  return <div ref={el} className="cg-wrap board" />
}
