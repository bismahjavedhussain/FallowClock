import { describe, expect, it } from 'vitest'
import { buildIntroBeats } from './intro'
import type { IntroInput } from './intro'

const format = (doy: number) => `D${doy}`

const story: IntroInput = {
  place: 'Story County, Iowa',
  ownerName: 'TBD -- U2 to name a real farmer',
  bareDays: 104,
  bareDaysByPhase: [112, 96],
  phaseLabels: ['soybean', 'corn'],
  gap: { start_doy: 83, end_doy: 165, share_of_annual_r: 0.337 },
  erosivityPeakDoy: 170,
  best: { label: 'Corn-Soybean + cereal rye', bareDays: 62, deltaPct: -26.9, seedCostUsdHa: 62 },
  format,
}

const monona: IntroInput = {
  ...story,
  place: 'Monona County, Iowa',
  bareDays: 7,
  bareDaysByPhase: [14, 0],
  phaseLabels: ['corn', 'soybean'],
  gap: { start_doy: 148, end_doy: 154, share_of_annual_r: 0.03 },
  best: null,
}

describe('buildIntroBeats', () => {
  it('opens by placing us somewhere real', () => {
    expect(buildIntroBeats(story)[0].text).toContain('Story County, Iowa')
  })

  it('states the problem with this field, from its own numbers', () => {
    const all = buildIntroBeats(story).map((b) => b.text).join(' ')
    expect(all).toContain('104 days')
    expect(all).toContain('112 after soybean')
    expect(all).toContain('D83 to D165')
    expect(all).toContain('34%')
    expect(all).toContain('D170')
  })

  it('says the bare window is spring, not winter', () => {
    const all = buildIntroBeats(story).map((b) => b.text).join(' ')
    expect(all).toMatch(/goes bare in\s+spring/)
    expect(all).toContain('stubble holds through the cold')
  })

  it('tells the opposite story on a field that is already covered', () => {
    const all = buildIntroBeats(monona).map((b) => b.text).join(' ')
    expect(all).toContain('only about 7 days a year')
    expect(all).toContain('not here for a fix')
    // It must not claim a crisis this field does not have.
    expect(all).not.toContain('how a farm loses its topsoil')
  })

  it('gives every beat a stable id for keying', () => {
    const ids = buildIntroBeats(story).map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the brief brief', () => {
    const beats = buildIntroBeats(story)
    expect(beats.length).toBeLessThanOrEqual(5)
    for (const b of beats) expect(b.text.length).toBeLessThan(260)
  })

  it('does not put a placeholder owner name in the farmer’s mouth', () => {
    expect(buildIntroBeats(story)[0].text).not.toContain('TBD')
  })

  it('uses a real owner name when the bundle has one', () => {
    expect(buildIntroBeats({ ...story, ownerName: 'Dale Hartman' })[0].text).toContain('Dale Hartman')
  })
})
