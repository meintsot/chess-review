// The AI coach against a local mock of the Anthropic Messages API (streaming SSE): request shape,
// streamed text, refusal, API errors and cancelling. No real key or network is needed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import games from './fixtures/games.json'
import { buildReview, type GameReview } from '../review'
import type { EngineResult } from '../engine'
import { askAiCoach, factSheet, setApiKey } from '../aiCoach'

type Fixture = { pgn: string; pos: { lines?: { pv0: string; cp?: number; mate?: number }[] }[] }
const review: GameReview = (() => {
  const f = (games as Fixture[])[0]
  const results = f.pos.map(p =>
    p.lines ? ({ depth: 18, lines: p.lines.map(l => ({ score: l.mate !== undefined ? { mate: l.mate } : { cp: l.cp ?? 0 }, pv: [l.pv0] })) } as EngineResult) : (undefined as unknown as EngineResult),
  )
  return buildReview(f.pgn, results, {}, 18)
})()

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: k => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
  removeItem: k => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
}

const sse = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`
const start = sse('message_start', {
  message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } },
})
const block = sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
const delta = (text: string) => sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
const end = (stop: string) =>
  sse('content_block_stop', { index: 0 }) + sse('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }) + sse('message_stop', {})

let mode: 'ok' | 'refusal' | 'error' | 'hang' = 'ok'
let last: { url?: string; headers: IncomingMessage['headers']; body: Record<string, unknown> } | undefined
let server: Server
let baseURL = ''

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      last = { url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') }
      if (mode === 'error') {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(start + block)
      if (mode === 'hang') return void res.write(delta('## Η ιστορία'))
      if (mode === 'refusal') return void res.end(end('refusal'))
      for (const t of ['## Η ιστορία της παρτίδας\n', 'Έπαιξες ', 'καλά.']) res.write(delta(t))
      res.end(end('end_turn'))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

describe('AI coach', () => {
  it('needs a key', async () => {
    setApiKey('')
    await expect(askAiCoach(review, 'w', () => {}, 'English', undefined, { baseURL })).rejects.toThrow(/API key/)
  })

  it('streams the narrative and sends only verified facts with the right request', async () => {
    setApiKey('sk-ant-test')
    mode = 'ok'
    const seen: string[] = []
    const text = await askAiCoach(review, 'w', t => seen.push(t), 'Greek', undefined, { baseURL, maxRetries: 0 })
    expect(text).toBe('## Η ιστορία της παρτίδας\nΈπαιξες καλά.')
    expect(seen.length).toBe(3)
    expect(seen.at(-1)).toBe(text)

    expect(last!.url).toMatch(/^\/v1\/messages/)
    expect(last!.headers['x-api-key']).toBe('sk-ant-test')
    expect(String(last!.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01')
    const body = last!.body as { model: string; stream: boolean; thinking: { type: string }; system: string; messages: { content: string }[] }
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.stream).toBe(true)
    expect(body.thinking).toEqual({ type: 'adaptive' })
    expect(body.system).toMatch(/Use ONLY the facts provided/)
    const facts = JSON.parse(body.messages[0].content.slice(body.messages[0].content.indexOf('{')))
    expect(facts).toEqual(JSON.parse(JSON.stringify(factSheet(review, 'w', 'Greek'))))
    expect(facts.language).toBe('Greek')
    // Greek facts: the built-in coach's notes are in Greek too
    const notes = facts.keyMoments.flatMap((m: { verifiedTactics: string[]; verifiedStrategy: string[] }) => [...m.verifiedTactics, ...m.verifiedStrategy])
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) expect(n).toMatch(/[α-ω]/)
  })

  it('reports a refusal', async () => {
    mode = 'refusal'
    await expect(askAiCoach(review, 'w', () => {}, 'English', undefined, { baseURL, maxRetries: 0 })).rejects.toThrow(/declined|αρνήθηκε/)
  })

  it('surfaces API errors such as a wrong key', async () => {
    mode = 'error'
    await expect(askAiCoach(review, 'w', () => {}, 'English', undefined, { baseURL, maxRetries: 0 })).rejects.toThrow(/invalid x-api-key|401/)
  })

  it('can be cancelled mid-stream', async () => {
    mode = 'hang'
    const ctl = new AbortController()
    const run = askAiCoach(review, 'w', () => ctl.abort(), 'English', ctl.signal, { baseURL, maxRetries: 0 })
    await expect(run).rejects.toThrow()
  })
})
