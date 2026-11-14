/**
 * THE NUMBERS-AGREE GUARD. Every figure the UI prints must equal the
 * bundle's own, for every committed bundle. If these fail, the headline and
 * the rotation list disagree on screen.
 */
import { describe, expect, it } from 'vitest'
import story from '../../public/bundles/farm_story-county-ia.json'
import monona from '../../public/bundles/farm_monona-county-ia.json'
import synthetic from '../../public/bundles/farm_synthetic.json'
import { buildFieldModel, checkBundle, medianHarvestDoy } from './bundle'
import { rankSpeciesForGap } from './cropFit'
import { defaultPhaseKey, evidenceTier, fieldFacts, pyRound, rotationFillCurves, scoreCover } from './metrics'
import { placeDecision } from './proposal'
import { findingSentence } from '../content/story'

const fieldOf = (raw: unknown) => buildFieldModel(checkBundle(raw))

describe('every number agrees with the bundle', () => {
  for (const [name, raw] of Object.entries({ story, monona, synthetic })) {
    it(`${name}: current practice re-scores to the bundle's own figures`, () => {
      const field = fieldOf(raw)
      const score = scoreCover(field, [])
      expect(score.bareDays).toBe(field.current.bare_days)
      expect(score.exposedR).toBeCloseTo(field.current.exposed_r, 3)
      if (field.current.bare_days_by_phase) expect(score.bareDaysByPhase).toEqual(field.current.bare_days_by_phase)
      expect(fieldFacts(field).bareDays).toBe(field.current.bare_days)
    })
  }

  it('Story County headline is 104 days (112 soybean / 96 corn), not the mean-curve 110', () => {
    const facts = fieldFacts(fieldOf(story))
    expect(facts.bareDays).toBe(104)
    expect(facts.byPhase.map((p) => [p.key, p.days])).toEqual([['soybean', 112], ['corn', 96]])
    expect(facts.gapSharePct).toBe(34)
  })

  it('states the finding from the backend peak, without overstating it', () => {
    // Story's peak (DOY 170) is five days after its gap ends: "closing just as", never "straight through".
    expect(findingSentence(checkBundle(story))).toBe("Bare Mar 24 to Jun 14 — 34% of the year's erosive rain falls in that window, closing just as the Jun 19 peak arrives.")
    expect(findingSentence(checkBundle(monona))).toBe("Bare May 28 to Jun 3 — 3% of the year's erosive rain falls in that window. The May 12 peak lands just before it opens.")
    // The peak is the backend's windowed value, not a client argmax (which says late August for Monona).
    expect(fieldFacts(fieldOf(monona)).peakErosivityDoy).toBe(132)
  })

  it('Monona County reads 7 days (14 after corn, 0 after soybean), not the mean-curve 0', () => {
    const field = fieldOf(monona)
    const facts = fieldFacts(field)
    expect(facts.bareDays).toBe(7)
    expect(facts.byPhase.map((p) => [p.key, p.days])).toEqual([['corn', 14], ['soybean', 0]])
    expect(defaultPhaseKey(field)).toBe('corn')
    for (const rotation of field.bundle.rotations) expect(() => rotationFillCurves(field, rotation)).not.toThrow()
  })

  it('rebuilds every Story County rotation exactly, so the ring can draw it per crop year', () => {
    const field = fieldOf(story)
    for (const rotation of field.bundle.rotations) expect(rotationFillCurves(field, rotation), rotation.id).not.toBeNull()
  })

  it('placing cereal rye in the planner reproduces the "+ cereal rye" rotation, including Python rounding', () => {
    const field = fieldOf(story)
    expect(field.earliestSeedDoy).toBe(272)
    const fits = rankSpeciesForGap(field.species, field.mainGap!, field.slice, field.observedCurves, undefined, field.earliestSeedDoy)
    const rye = fits.find((f) => f.speciesId === 'cereal_rye')!
    expect(rye.seedDoy).toBe(272) // after harvest, never 15 Aug into a standing crop
    const rotation = field.bundle.rotations.find((r) => r.id === 'corn_soy_rye')!
    const score = scoreCover(field, [rye.coverCurve])
    expect(score.bareDays).toBe(rotation.bare_days)
    expect(score.exposedR).toBeCloseTo(rotation.exposed_r, 3)
  })

  it('rejects seeding into a standing crop', () => {
    const field = fieldOf(story)
    const fits = rankSpeciesForGap(field.species, field.mainGap!, field.slice, field.observedCurves, undefined, field.earliestSeedDoy)
    const rye = fits.find((f) => f.speciesId === 'cereal_rye')!
    const species = field.species.find((s) => s.id === 'cereal_rye')!
    expect(placeDecision(rye, species, field.mainGap!, 227, field.earliestSeedDoy).accepted).toBe(false)
    expect(placeDecision(rye, species, field.mainGap!, 280, field.earliestSeedDoy).accepted).toBe(true)
  })

  it('labels a literature curve as literature, not observed', () => {
    const field = fieldOf(monona)
    expect(evidenceTier(field, 'cereal_rye', 'observed')).toBe('literature')
    expect(evidenceTier(fieldOf(story), 'cereal_rye', 'observed')).toBe('observed')
  })

  it('opens on the crop year with the most bare days', () => {
    expect(defaultPhaseKey(fieldOf(story))).toBe('soybean')
    expect(defaultPhaseKey(fieldOf(synthetic))).toBeNull()
  })

  it('rounds like Python, and finds the median harvest like bundle.py', () => {
    expect([pyRound(62.5), pyRound(63.5), pyRound(2.4), pyRound(2.6)]).toEqual([62, 64, 2, 3])
    expect(medianHarvestDoy([{ year: 1, cdl_crop: 'Corn', harvest_doy: 280 }, { year: 2, cdl_crop: 'Corn', harvest_doy: 260 }])).toBe(280)
  })

  it('refuses a bundle that breaks the contract, loudly', () => {
    const broken = JSON.parse(JSON.stringify(story))
    broken.climatology.soil_cover.pop()
    expect(() => checkBundle(broken)).toThrow(/soil_cover/)
  })
})
