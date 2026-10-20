// Pool of single-threaded Stockfish WASM workers. Each position is an independent job,
// so a game is analysed in parallel across workers (no cross-origin isolation needed).

export type RawScore = { cp: number } | { mate: number } // side-to-move POV

export interface EngineLine {
  score: RawScore
  pv: string[] // UCI moves
}

export interface EngineResult {
  depth: number
  lines: EngineLine[] // sorted by multipv rank
}

export interface EngineJob {
  startFen: string
  moves: string[] // UCI moves from startFen
  depth: number
  multiPv: number
}

const ENGINE_URL = '/engine/stockfish-18-lite-single.js'

class EngineWorker {
  private worker: Worker
  private ready: Promise<void>
  private listener: ((line: string) => void) | null = null

  constructor() {
    this.worker = new Worker(ENGINE_URL)
    this.worker.onmessage = e => this.listener?.(String(e.data))
    this.ready = this.waitFor('uciok', 'uci').then(() => {
      this.send('setoption name Hash value 16')
      return this.waitFor('readyok', 'isready')
    }).then(() => undefined)
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd)
  }

  private waitFor(token: string, cmd: string, onLine?: (line: string) => void): Promise<string> {
    return new Promise(resolve => {
      this.listener = line => {
        onLine?.(line)
        if (line.startsWith(token)) {
          this.listener = null
          resolve(line)
        }
      }
      this.send(cmd)
    })
  }

  async analyse(job: EngineJob): Promise<EngineResult> {
    await this.ready
    this.send(`setoption name MultiPV value ${job.multiPv}`)
    this.send(`position fen ${job.startFen}${job.moves.length ? ' moves ' + job.moves.join(' ') : ''}`)
    const lines: EngineLine[] = []
    let depth = 0
    await this.waitFor('bestmove', `go depth ${job.depth}`, line => {
      if (!line.startsWith('info') || !line.includes(' pv ') || line.includes('bound')) return
      const d = Number(/ depth (\d+)/.exec(line)?.[1] ?? 0)
      const rank = Number(/ multipv (\d+)/.exec(line)?.[1] ?? 1)
      const cp = / score cp (-?\d+)/.exec(line)
      const mate = / score mate (-?\d+)/.exec(line)
      const pv = line.split(' pv ')[1].trim().split(/\s+/)
      if (d < depth && rank === 1) return
      if (rank === 1) depth = d
      lines[rank - 1] = { score: mate ? { mate: Number(mate[1]) } : { cp: Number(cp?.[1] ?? 0) }, pv }
    })
    return { depth, lines: lines.filter(Boolean) }
  }

  terminate() {
    this.worker.terminate()
  }
}

export class EnginePool {
  private workers: EngineWorker[]

  constructor(size = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 2))) {
    this.workers = Array.from({ length: size }, () => new EngineWorker())
  }

  get size() {
    return this.workers.length
  }

  /** Runs all jobs across the pool; results keep job order. */
  async analyseAll(jobs: EngineJob[], onProgress?: (done: number) => void): Promise<EngineResult[]> {
    const results: EngineResult[] = new Array(jobs.length)
    let next = 0
    let done = 0
    const run = async (w: EngineWorker) => {
      while (next < jobs.length) {
        const i = next++
        results[i] = await w.analyse(jobs[i])
        onProgress?.(++done)
      }
    }
    await Promise.all(this.workers.map(run))
    return results
  }

  terminate() {
    this.workers.forEach(w => w.terminate())
  }
}
