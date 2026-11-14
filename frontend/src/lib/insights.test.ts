import { describe, expect, it } from 'vitest'
import { buildInsights, thinkingLines } from './insights'
import type { InsightInput } from './insights'

const format = (d: number) => `D${d}`

const story: InsightInput = {
  place: 'Story County, Iowa',
  areaHa: 39.3,
  bareDays: 104,
  bareDaysByPhase: [112, 96],
  phaseLabels: ['soybean', 'corn'],
  gap: { start_doy: 83, end_doy: 165, n_days: 83, share_of_annual_r: 0.337 },
  erosivityPeakDoy: 170,
  rotations: [
    { label: 'Corn-Soybean (current)', isCurrent: true, bareDays: 104, deltaPct: 0, seedCostUsdHa: 0, nCreditKgHa: 0 },
    { label: 'Corn-Soybean + cereal rye', isCurrent: false, bareDays: 62, deltaPct: -26.9, seedCostUsdHa: 62, nCreditKgHa: 0 },
    { label: 'Corn-Soybean + best-fit cover', isCurrent: false, bareDays: 46, deltaPct: -30.5, seedCostUsdHa: 132, nCreditKgHa: 0 },
  ],
  ryeSource: 'observed',
  bareDaysBand: [40, 203],
  format,
}

const monona: InsightInput = {
  ...story,
  place: 'Monona County, Iowa',
  areaHa: 14.9,
  bareDays: 7,
  bareDaysByPhase: [14, 0],
  phaseLabels: ['corn', 'soybean'],
  gap: { start_doy: 148, end_doy: 154, n_days: 7, share_of_annual_r: 0.03 },
  erosivityPeakDoy: 132,
  rotations: [
    { label: 'Corn-Soybean (current)', isCurrent: true, bareDays: 7, deltaPct: 0, seedCostUsdHa: 0, nCreditKgHa: 0 },
    { label: 'Corn-Soybean + cereal rye', isCurrent: false, bareDays: 7, deltaPct: 0, seedCostUsdHa: 62, nCreditKgHa: 0 },
  ],
  ryeSource: 'literature',
  bareDaysBand: [0, 5],
}

describe('buildInsights', () => {
  it('leads with how long the ground is open, split by phase', () => {
    const bare = buildInsights(story).find((x) => x.id === 'bare')!
    expect(bare.figure).toBe('104 days')
    expect(bare.body).toContain('112 after soybean')
    expect(bare.body).toContain('96 after corn')
  })

  it('states the window and the share of erosive rain', () => {
    const w = buildInsights(story).find((x) => x.id === 'window')!
    expect(w.figure).toBe('34%')
    expect(w.body).toContain('D83 to D165')
    expect(w.body).toContain('83 days')
  })

  it('does not claim the peak is inside the window when it is not', () => {
    const w = buildInsights(story).find((x) => x.id === 'window')!
    expect(w.body).toContain('closes just as the D170 peak arrives')
    expect(w.body).not.toContain('inside it')
  })

  it('picks the best rotation and gives the real numbers', () => {
    const [doIt, cost] = ['do', 'cost'].map((id) => buildInsights(story).find((x) => x.id === id)!)
    expect(doIt.body).toContain('104 → 46')
    expect(doIt.body).toContain('58 fewer')
    expect(doIt.figure).toBe('-31%')
    expect(cost.figure).toBe('$132/ha')
    // Cost across the whole field, not just per hectare.
    expect(cost.body).toContain('5188')
  })

  it('refuses to invent a recommendation for a field that has none', () => {
    const doIt = buildInsights(monona).find((x) => x.id === 'do')!
    expect(doIt.figure).toBe('nothing')
    expect(doIt.body).toContain('leave it alone')
    expect(buildInsights(monona).find((x) => x.id === 'cost')).toBeUndefined()
  })

  it('always carries the uncertainty band as a caution', () => {
    const band = buildInsights(story).find((x) => x.id === 'band')!
    expect(band.kind).toBe('caution')
    expect(band.figure).toBe('40–203')
  })

  it('says whether the cover curve was measured or assumed', () => {
    expect(buildInsights(story).find((x) => x.id === 'evidence')!.body).toContain('measured on neighbouring fields')
    expect(buildInsights(monona).find((x) => x.id === 'evidence')!.body).toContain('not observed here')
  })

  it('is fully derived: no figure survives a change of field', () => {
    const a = buildInsights(story).map((x) => `${x.figure} ${x.body}`).join(' ')
    const b = buildInsights(monona).map((x) => `${x.figure} ${x.body}`).join(' ')
    expect(a).not.toBe(b)
    expect(b).not.toContain('104')
    expect(b).not.toContain('34%')
  })

  it('survives a bundle with no gap at all', () => {
    const none = buildInsights({ ...monona, gap: null, bareDaysBand: null, ryeSource: undefined })
    expect(none.find((x) => x.id === 'window')).toBeUndefined()
    expect(none.length).toBeGreaterThan(0)
  })
})

describe('thinkingLines', () => {
  it('names this field, not a generic progress message', () => {
    const lines = thinkingLines(story)
    expect(lines.join(' ')).toContain('Story County')
    expect(lines.join(' ')).toContain('104 bare days')
    expect(lines.join(' ')).toContain('34%')
  })

  it('adapts to a field with nothing worth seeding', () => {
    expect(thinkingLines(monona).join(' ')).toContain('whether anything is worth seeding')
  })

  it('gives at least a few lines to cycle', () => {
    expect(thinkingLines(story).length).toBeGreaterThanOrEqual(4)
  })
})
