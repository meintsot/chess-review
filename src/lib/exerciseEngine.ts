import { EnginePool } from './engine'

// One shared engine worker for checking answers in training; created lazily, released when training closes.
let pool: EnginePool | null = null
export const exerciseEngine = () => (pool ??= new EnginePool(1))
export function releaseExerciseEngine() {
  pool?.terminate()
  pool = null
}
