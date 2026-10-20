import { useEffect, useRef } from 'react'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

interface Props {
  fen: string
  orientation: 'white' | 'black'
  lastMove?: [string, string]
  shapes: DrawShape[]
  check?: boolean
}

export function Board({ fen, orientation, lastMove, shapes, check }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)

  useEffect(() => {
    api.current = Chessground(el.current!, {
      viewOnly: false,
      movable: { free: false, color: undefined },
      draggable: { enabled: false },
      selectable: { enabled: false },
      animation: { enabled: true, duration: 180 },
      coordinates: true,
      drawable: { enabled: true, visible: true, eraseOnClick: true },
    })
    return () => api.current?.destroy()
  }, [])

  const lastKey = lastMove?.join('')
  useEffect(() => {
    const cg = api.current
    if (!cg) return
    cg.set({ fen, orientation, lastMove: lastKey ? [lastKey.slice(0, 2), lastKey.slice(2, 4)] as Key[] : undefined, check: check ?? false, turnColor: fen.split(' ')[1] === 'b' ? 'black' : 'white' })
    cg.setAutoShapes(shapes)
  }, [fen, orientation, lastKey, shapes, check])

  return <div ref={el} className="cg-wrap board" />
}
