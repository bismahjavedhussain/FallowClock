import { describe, expect, it } from 'vitest'
import {
  BARE_THRESHOLD,
  buildFleckPool,
  buildRootSystem,
  erosionIntensity,
  rng,
} from './rootGeometry'

const OPTS = { width: 420, height: 300, surfaceY: 92, seed: 1 }

describe('rng', () => {
  it('is deterministic for a seed and varies between seeds', () => {
    const a = Array.from({ length: 5 }, rng(42))
    const b = Array.from({ length: 5 }, rng(42))
    const c = Array.from({ length: 5 }, rng(43))
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    for (const v of a) expect(v).toBeGreaterThanOrEqual(0)
    for (const v of a) expect(v).toBeLessThan(1)
  })
})

describe('buildRootSystem', () => {
  it('is deterministic for a given seed', () => {
    expect(buildRootSystem(OPTS)).toEqual(buildRootSystem(OPTS))
  })

  it('produces a different system for a different seed', () => {
    expect(buildRootSystem(OPTS)).not.toEqual(buildRootSystem({ ...OPTS, seed: 2 }))
  })

  it('grows a usable number of segments', () => {
    const segs = buildRootSystem(OPTS)
    expect(segs.length).toBeGreaterThan(30)
    expect(segs.length).toBeLessThanOrEqual(400)
  })

  it('respects the hard segment cap', () => {
    const segs = buildRootSystem({ ...OPTS, plants: 12, maxSegments: 50 })
    expect(segs.length).toBeLessThanOrEqual(60) // cap is checked per-call, allow the tail of one recursion
  })

  it('keeps every reveal threshold inside 0..1', () => {
    for (const s of buildRootSystem(OPTS)) {
      expect(s.t).toBeGreaterThanOrEqual(0)
      expect(s.t).toBeLessThanOrEqual(1)
    }
  })

  it('never draws a root above the soil surface', () => {
    // Roots belong under the ground line. A segment poking into the sky is
    // the most obvious way this component could look broken.
    for (const s of buildRootSystem(OPTS)) {
      const ys = [...s.d.matchAll(/[ML Q](-?\d+\.?\d*) (-?\d+\.?\d*)/g)].map((m) => Number(m[2]))
      for (const y of ys) expect(y).toBeGreaterThanOrEqual(OPTS.surfaceY - 0.01)
    }
  })

  it('tapers: deeper orders are never thicker than the tap root', () => {
    const segs = buildRootSystem(OPTS)
    const widest = new Map<number, number>()
    for (const s of segs) widest.set(s.order, Math.max(widest.get(s.order) ?? 0, s.w))
    const orders = [...widest.keys()].sort((a, b) => a - b)
    for (let i = 1; i < orders.length; i++) {
      expect(widest.get(orders[i])!).toBeLessThanOrEqual(widest.get(orders[i - 1])!)
    }
  })

  it('shallow segments appear before deep ones', () => {
    // The reveal must read as growth downward, not as a random sparkle.
    const segs = buildRootSystem(OPTS)
    const shallow = segs.filter((s) => s.order === 0).slice(0, 3)
    const deep = segs.filter((s) => s.order >= 3)
    if (deep.length) {
      const meanShallow = shallow.reduce((a, s) => a + s.t, 0) / shallow.length
      const meanDeep = deep.reduce((a, s) => a + s.t, 0) / deep.length
      expect(meanShallow).toBeLessThan(meanDeep)
    }
  })
})

describe('buildFleckPool', () => {
  it('is deterministic and bounded', () => {
    const pool = buildFleckPool(7, 16, 420)
    expect(pool).toEqual(buildFleckPool(7, 16, 420))
    expect(pool).toHaveLength(16)
    for (const f of pool) {
      expect(f.x).toBeGreaterThanOrEqual(0)
      expect(f.x).toBeLessThanOrEqual(420)
      expect(f.size).toBeGreaterThan(0)
      expect(f.delay).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('erosionIntensity', () => {
  it('is zero on an unobserved day, however bare it looks', () => {
    // n_obs = 0 means UNKNOWN, never bare. Shedding soil here would
    // contradict the contract the rest of the app is built on.
    expect(erosionIntensity(0.0, 20, 24, 0)).toBe(0)
  })

  it('is zero when the soil is covered', () => {
    expect(erosionIntensity(BARE_THRESHOLD, 24, 24)).toBe(0)
    expect(erosionIntensity(0.8, 24, 24)).toBe(0)
  })

  it('is zero when there is no rain', () => {
    expect(erosionIntensity(0.05, 0, 24)).toBe(0)
  })

  it('rises as cover falls and as rain gets heavier', () => {
    const mild = erosionIntensity(0.25, 6, 24)
    const barer = erosionIntensity(0.05, 6, 24)
    const wetter = erosionIntensity(0.25, 24, 24)
    expect(barer).toBeGreaterThan(mild)
    expect(wetter).toBeGreaterThan(mild)
  })

  it('stays inside 0..1', () => {
    expect(erosionIntensity(0, 1000, 24)).toBeLessThanOrEqual(1)
    expect(erosionIntensity(0, 24, 24)).toBe(1)
  })
})
