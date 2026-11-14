import { describe, expect, it } from 'vitest'
import { candidateSeedDoys } from './cropFit'
import type { Gap, Species } from './cropFit'

const rye = {
  id: 'cereal_rye',
  name: 'Cereal rye',
  seeding_window: [227, 319],
  winter_hardy: true,
  tbase_c: 4,
} as unknown as Species

const springGap: Gap = {
  start_doy: 83,
  end_doy: 165,
  n_days: 83,
  exposed_r: 1,
  share_of_annual_r: 0.34,
  wraps_year: false,
}

describe('harvest gate', () => {
  it('without the gate, rye is seeded before the observed harvest', () => {
    const doys = candidateSeedDoys(rye, springGap)
    expect(Math.min(...doys)).toBe(227) // 15 Aug — six weeks early
  })

  it('with the gate, nothing is seeded into a standing crop', () => {
    const harvest = 272 // observed median, 29 Sep
    const doys = candidateSeedDoys(rye, springGap, undefined, harvest)
    expect(doys.length).toBeGreaterThan(0)
    expect(Math.min(...doys)).toBe(272)
    expect(Math.max(...doys)).toBe(319)
    for (const d of doys) expect(d >= harvest || d <= springGap.end_doy).toBe(true)
  })
})
