import { describe, expect, it } from 'vitest'
import { fieldMode } from './atmosphere'

describe('fieldMode', () => {
  it('shows nothing on a day no satellite observed', () => {
    // Unknown is not bare. Blowing dust here would say in pictures what
    // the ring refuses to say in words.
    expect(fieldMode(0.05, 24, 24, 0).mode).toBe('none')
    expect(fieldMode(null, 24, 24).mode).toBe('none')
  })

  it('rains when bare ground meets heavy rain', () => {
    expect(fieldMode(0.08, 22, 24).mode).toBe('rain')
  })

  it('blows dust when the ground is bare but the weather is dry', () => {
    expect(fieldMode(0.08, 1, 24).mode).toBe('dust')
  })

  it('stays calm when the soil is protected, however hard it rains', () => {
    expect(fieldMode(0.85, 24, 24).mode).toBe('calm')
    expect(fieldMode(0.31, 24, 24).mode).toBe('calm')
  })

  it('treats the 0.30 threshold the same way the rest of the app does', () => {
    expect(fieldMode(0.3, 1, 24).mode).toBe('calm')
    expect(fieldMode(0.29, 1, 24).mode).toBe('dust')
  })

  it('gets more intense as cover falls and rain rises', () => {
    const mild = fieldMode(0.25, 9, 24).intensity
    const barer = fieldMode(0.02, 9, 24).intensity
    const wetter = fieldMode(0.25, 24, 24).intensity
    expect(barer).toBeGreaterThan(mild)
    expect(wetter).toBeGreaterThan(mild)
  })

  it('keeps intensity inside 0..1', () => {
    for (const c of [0, 0.15, 0.3, 0.9]) {
      for (const r of [0, 12, 1000]) {
        const { intensity } = fieldMode(c, r, 24)
        expect(intensity).toBeGreaterThanOrEqual(0)
        expect(intensity).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is safe when the year has no erosivity at all', () => {
    expect(fieldMode(0.1, 0, 0).mode).toBe('dust')
  })
})
