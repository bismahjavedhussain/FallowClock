import { describe, expect, it } from 'vitest'
import { seasonAtDoy, seasonWeights } from './seasons'
import { knownBareDays, placeDecision, proposalPreview } from './proposal'
import type { FitResult, Gap, Species } from './cropFit'
import { findBareRuns } from '../components/YearRing'
import { useStore } from '../store'
import { atmosphereForDay } from './atmosphere'

const species = { id: 'rye', name: 'Rye', seeding_window: [300, 40], tbase_c: 4, gdd_establish: 1, winterkill_c: -20, water_mm: 1, n_credit_kg_ha: 0, biomass_kg_ha: 0, seed_cost_usd_ha: 0, winter_hardy: true, citation: 'test' } satisfies Species
const gap = { start_doy: 330, end_doy: 35, n_days: 71, exposed_r: 0, share_of_annual_r: 0, wraps_year: true } satisfies Gap
const fit = { speciesId: 'rye', speciesName: 'Rye', seedDoy: 335, feasible: true, reason: 'Fits', gddAvailable: 50, gddRequired: 1, establishByDoy: 350, coverCurve: new Array(365).fill(0.4), deltaExposedR: 1, pctReduction: 10, nCreditKgHa: 0, seedCostUsdHa: 0, curveSource: 'modelled' } satisfies FitResult

describe('seasonal planning', () => {
  it('navigates all four seasons and blends across the year seam', () => {
    expect([1, 60, 152, 244, 335].map(seasonAtDoy)).toEqual(['winter', 'spring', 'summer', 'autumn', 'winter'])
    expect(seasonWeights(365).winter).toBeCloseTo(seasonWeights(1).winter, 1)
    expect(Object.values(seasonWeights(320)).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('accepts valid year-wrapping seed days and explains invalid drops', () => {
    expect(placeDecision(fit, species, gap, 335).accepted).toBe(true)
    expect(placeDecision(fit, species, gap, 10).accepted).toBe(true)
    const invalid = placeDecision(fit, species, gap, 200)
    expect(invalid.accepted).toBe(false)
    expect(invalid.reason).toContain('cannot be placed')
    expect(placeDecision({ ...fit, feasible: false, reason: 'Moisture too low' }, species, gap, 335).reason).toBe('Moisture too low')
  })

  it('keeps unknown observations out of bare counts and circular bare gaps', () => {
    const cover = new Array(365).fill(0.8)
    const nObs = new Array(365).fill(5)
    for (let i = 330; i < 365; i++) cover[i] = 0.1
    for (let i = 0; i < 35; i++) cover[i] = 0.1
    nObs[0] = 0
    expect(knownBareDays(cover, nObs)).toBe(69)
    expect(findBareRuns(cover, 0.3, nObs).some((run) => run.wraps)).toBe(false)
  })

  it('previews a modelled proposal without mutating baseline data, then resets shared state', () => {
    const cover = new Array(365).fill(0.1)
    const nObs = new Array(365).fill(5)
    const erosivity = new Array(365).fill(1)
    const preview = proposalPreview(cover, [fit], erosivity, nObs)
    expect(preview.proposedBare).toBe(0)
    expect(preview.baselineBare).toBe(365)
    expect(preview.proposedExposure).toBeLessThan(preview.baselineExposure)
    expect(cover[0]).toBe(0.1)
    useStore.getState().addPlacedFill('rye')
    expect(useStore.getState().placedFills).toContain('rye')
    useStore.getState().resetPlacedFills()
    expect(useStore.getState().placedFills).toEqual([])
  })

  it('keeps selected-day climate values separate from illustrative weather', () => {
    const values = { soil_cover: new Array(365).fill(0.1), n_obs_per_doy: new Array(365).fill(5), erosivity_r: new Array(365).fill(2.5), frost_prob: new Array(365).fill(0.2) }
    values.n_obs_per_doy[0] = 0
    expect(atmosphereForDay(1, values).soil).toBe('Unknown observation')
    expect(atmosphereForDay(2, values)).toMatchObject({ soil: 'Bare soil', erosivity: 2.5, frost: 0.2, heat: null })
  })
})
