import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'

describe('test setup', () => {
  it('runs chess.js', () => {
    expect(new Chess().moves().length).toBe(20)
  })
})
