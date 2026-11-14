import { describe, expect, it } from 'vitest'
import { buildActs, gapHeadline, introNarration, isAlreadyCovered } from './acts'
import type { ActInput } from './acts'

const format = (doy: number) => `D${doy}`

/** Story County as the shipped bundle actually reads. */
const story: ActInput = {
  place: 'Story County, Iowa',
  bareDays: 104,
  bareDaysByPhase: [112, 96],
  phaseLabels: ['soybean', 'corn'],
  gap: { start_doy: 83, end_doy: 165, n_days: 83, share_of_annual_r: 0.337 },
  erosivityPeakDoy: 170,
  alternatives: [
    { label: 'Corn-Soybean + cereal rye', bareDays: 62, deltaPct: -26.9, seedCostUsdHa: 62 },
  ],
  format,
}

/** Monona: conservation tillage, essentially no gap. */
const monona: ActInput = {
  place: 'Monona County, Iowa',
  bareDays: 7,
  bareDaysByPhase: [14, 0],
  phaseLabels: ['corn', 'soybean'],
  gap: { start_doy: 148, end_doy: 154, n_days: 7, share_of_annual_r: 0.03 },
  erosivityPeakDoy: 132,
  alternatives: [],
  format,
}

describe('gapHeadline', () => {
  it('does not claim the peak is inside the gap when it is not', () => {
    // Story's peak centres on DOY 170, five days AFTER the gap closes at 165.
    // "Straight through the peak" would be checkable and wrong.
    const line = gapHeadline(story)!
    expect(line).toContain('closing just as the D170 peak arrives')
    expect(line).not.toContain('straight through')
  })

  it('says straight through when the peak really is inside', () => {
    const line = gapHeadline({ ...story, erosivityPeakDoy: 120 })!
    expect(line).toContain('straight through the D120 peak')
  })

  it('says so when the peak lands before the window opens', () => {
    expect(gapHeadline(monona)!).toContain('lands just before it opens')
  })

  it('handles a gap that wraps the new year', () => {
    const wrapped = gapHeadline({
      ...story,
      gap: { start_doy: 300, end_doy: 120, n_days: 186, share_of_annual_r: 0.5 },
      erosivityPeakDoy: 20,
    })!
    expect(wrapped).toContain('straight through')
  })

  it('returns null for a field with no gap', () => {
    expect(gapHeadline({ ...story, gap: null })).toBeNull()
  })

  it('reports the share of erosive rain from the bundle, not a constant', () => {
    expect(gapHeadline(story)!).toContain('34%')
    expect(gapHeadline({ ...story, gap: { ...story.gap!, share_of_annual_r: 0.61 } })!).toContain('61%')
  })
})

describe('isAlreadyCovered', () => {
  it('is false for a field with a real bare window', () => {
    expect(isAlreadyCovered(story)).toBe(false)
  })
  it('is true for a conservation-tillage field', () => {
    expect(isAlreadyCovered(monona)).toBe(true)
  })
  it('is true when there is no gap at all', () => {
    expect(isAlreadyCovered({ ...story, gap: null })).toBe(true)
  })
})

describe('buildActs', () => {
  it('always returns four acts in order', () => {
    const acts = buildActs(story)
    expect(acts.map((a) => a.n)).toEqual([1, 2, 3, 4])
    expect(acts.map((a) => a.focus)).toEqual(['ring', 'farmer', 'soil', 'split'])
  })

  it('tells a crisis story on a field that has one', () => {
    const acts = buildActs(story)
    expect(acts[0].line).toContain('34%')
    expect(acts[3].title).toBe('Three futures')
    expect(acts[3].line).toContain('cereal rye')
    expect(acts[3].line).toContain('$62')
  })

  it('refuses to invent a recommendation for a field that is already fine', () => {
    const acts = buildActs(monona)
    expect(acts[3].title).toBe('Nothing worth changing')
    expect(acts[3].line).toContain('leave it alone')
  })

  it('names the phase split rather than averaging it away', () => {
    expect(buildActs(story)[1].line).toContain('112 after soybean')
    expect(buildActs(story)[1].line).toContain('96 after corn')
  })

  it('falls back cleanly when a field has no phases', () => {
    const acts = buildActs({ ...story, bareDaysByPhase: null, phaseLabels: null })
    expect(acts[1].line).toContain('average soil cover')
  })

  it('never hardcodes a number: changing the bundle changes the story', () => {
    const other = buildActs({ ...story, bareDays: 200, place: 'Elsewhere' })
    expect(other[0].line + other[1].line).not.toContain('104')
    expect(buildActs({ ...story, gap: null })[0].line).toContain('Story County')
  })
})

describe('introNarration', () => {
  const story = {
    place: 'Story County, Iowa',
    areaHa: 39.3,
    rotationLabel: 'Corn-Soybean, no cover crop; reduced tillage',
    sceneDate: '2024-06-09',
    resolutionM: 9.77,
    bareDays: 104,
  }

  it('names the place, the crop and the scene', () => {
    const line = introNarration(story)
    expect(line).toContain('Story County, Iowa')
    expect(line).toContain('39 hectare corn and soybean field')
    expect(line).toContain('Sentinel 2')
    expect(line).toContain('the 9th of June, 2024')
    expect(line).toContain('10 metres per pixel')
  })

  it('says why this field was picked, from its own bare-day count', () => {
    expect(introNarration(story)).toContain('bare for about 104 days')
  })

  it('changes the reason for a field that is already protected', () => {
    const line = introNarration({ ...story, place: 'Monona County, Iowa', bareDays: 7 })
    expect(line).toContain('already well protected')
    expect(line).not.toContain('bare for about')
  })

  it('is written to be spoken: no abbreviations a voice would mangle', () => {
    const line = introNarration(story)
    expect(line).not.toMatch(/\bha\b|\bm\/px\b|\bS2\b|\(|\)/)
  })

  it('handles the ordinal suffixes a date needs', () => {
    const on = (d: string) => introNarration({ ...story, sceneDate: d })
    expect(on('2024-06-01')).toContain('the 1st of June')
    expect(on('2024-06-02')).toContain('the 2nd of June')
    expect(on('2024-06-03')).toContain('the 3rd of June')
    expect(on('2024-06-11')).toContain('the 11th of June')
    expect(on('2024-06-21')).toContain('the 21st of June')
  })
})

describe('introNarration, spoken-text hygiene', () => {
  it('unwraps parentheses in a place name rather than reading them aloud', () => {
    const line = introNarration({
      place: 'Monona County, Iowa (Loess Hills)',
      areaHa: 14.9,
      rotationLabel: 'Corn-Soybean, no cover crop; conservation tillage',
      sceneDate: '2024-06-05',
      resolutionM: 9.77,
      bareDays: 7,
    })
    expect(line).toContain('Monona County, Iowa, Loess Hills.')
    expect(line).not.toContain('(')
    expect(line).not.toContain(')')
  })
})
