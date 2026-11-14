/**
 * THE DRIFT GUARD.
 *
 * Asserts this TypeScript implementation against vectors generated from the
 * Python one. Python is the reference; if these fail, TypeScript is wrong.
 *
 * Regenerate after any rule change:  cd backend && python scripts/gen_vectors.py
 *
 * Without this, the two implementations drift silently and the UI ends up
 * quoting a different number than the pitch deck.
 */

import { describe, expect, it } from 'vitest'
import vectors from './__vectors__.json'
import {
  accumulateGdd,
  bareDays,
  candidateSeedDoys,
  doysInRun,
  exposedErosivity,
  firstKillingFrostDoy,
  fitSpeciesInGap,
  rusleCFactor,
  thermalRampCurve,
  type ClimatologySlice,
  type Gap,
  type Species,
} from './cropFit'

const TOL = 1e-3

const clim = vectors.climatology as Record<string, number[]>
const gap = vectors.gap as Gap
const cases = vectors.cases as any

const slice: ClimatologySlice = {
  gddBase4: clim.gdd_base4,
  gddBase10: clim.gdd_base10,
  frostProb: clim.frost_prob,
  soilMoisture: clim.soil_moisture,
  erosivityR: clim.erosivity_r,
  soilCover: clim.soil_cover,
}

/**
 * Species parameters are duplicated from backend/data/species.csv for the
 * five species the vectors cover. If a row changes there, change it here —
 * the fit vectors will fail loudly if you forget.
 */
const SPECIES: Record<string, Species> = {
  cereal_rye: {
    id: 'cereal_rye', name: 'Cereal rye', seeding_window: [227, 319], tbase_c: 4,
    gdd_establish: 200, winterkill_c: -99, water_mm: 25, n_credit_kg_ha: 0,
    biomass_kg_ha: 3400, seed_cost_usd_ha: 62, winter_hardy: true, citation: '',
  },
  forage_radish: {
    id: 'forage_radish', name: 'Forage radish', seeding_window: [213, 252], tbase_c: 4,
    gdd_establish: 150, winterkill_c: -7, water_mm: 30, n_credit_kg_ha: 0,
    biomass_kg_ha: 2600, seed_cost_usd_ha: 78, winter_hardy: false, citation: '',
  },
  hairy_vetch: {
    id: 'hairy_vetch', name: 'Hairy vetch', seeding_window: [213, 258], tbase_c: 4,
    gdd_establish: 300, winterkill_c: -99, water_mm: 35, n_credit_kg_ha: 110,
    biomass_kg_ha: 2500, seed_cost_usd_ha: 120, winter_hardy: true, citation: '',
  },
  buckwheat: {
    id: 'buckwheat', name: 'Buckwheat', seeding_window: [152, 227], tbase_c: 10,
    gdd_establish: 300, winterkill_c: 0, water_mm: 30, n_credit_kg_ha: 0,
    biomass_kg_ha: 1500, seed_cost_usd_ha: 60, winter_hardy: false, citation: '',
  },
  oats: {
    id: 'oats', name: 'Oats', seeding_window: [213, 258], tbase_c: 4,
    gdd_establish: 250, winterkill_c: -8, water_mm: 30, n_credit_kg_ha: 0,
    biomass_kg_ha: 1800, seed_cost_usd_ha: 50, winter_hardy: false, citation: '',
  },
}

describe('rusleCFactor', () => {
  it.each(cases.rusle_c_factor)('cover=$cover', (c: any) => {
    expect(rusleCFactor(c.cover, c.b)).toBeCloseTo(c.expect, 4)
  })

  it('rejects a percent passed where a fraction belongs', () => {
    expect(() => rusleCFactor(50)).toThrow()
  })
})

describe('doysInRun', () => {
  it.each(cases.doys_in_run)('$start -> $end', (c: any) => {
    expect(doysInRun(c.start, c.end)).toEqual(c.expect)
  })
})

describe('accumulateGdd', () => {
  it.each(cases.accumulate_gdd)('DOY $start_doy -> $end_doy', (c: any) => {
    expect(accumulateGdd(clim.gdd_base4, c.start_doy, c.end_doy)).toBeCloseTo(c.expect, 2)
  })
})

describe('firstKillingFrostDoy', () => {
  it.each(cases.first_killing_frost_doy)('after DOY $after_doy', (c: any) => {
    expect(firstKillingFrostDoy(clim.frost_prob, c.after_doy)).toBe(c.expect)
  })
})

describe('exposedErosivity', () => {
  it.each(cases.exposed_erosivity)('$label', (c: any) => {
    const cover =
      c.cover_const !== undefined
        ? new Array(365).fill(c.cover_const)
        : clim.soil_cover
    expect(exposedErosivity(cover, clim.erosivity_r)).toBeCloseTo(c.expect, 2)
  })
})

describe('gap detection agrees with the Python build_gaps', () => {
  it('the main gap wraps the year', () => {
    expect(gap.wraps_year).toBe(true)
    expect(gap.start_doy).toBeGreaterThan(gap.end_doy)
  })

  it('bare day count matches the climatology it was built from', () => {
    const total = (cases.gaps as any[]).reduce((s, g) => s + g.n_days, 0)
    expect(bareDays(clim.soil_cover)).toBe(total)
  })
})

describe('candidateSeedDoys', () => {
  it.each(cases.candidate_seed_doys)('$species_id', (c: any) => {
    const got = candidateSeedDoys(SPECIES[c.species_id], gap)
    expect(got.length).toBe(c.expect_count)
    expect(got[0] ?? null).toBe(c.expect_first)
    expect(got[got.length - 1] ?? null).toBe(c.expect_last)
  })
})

describe('thermalRampCurve', () => {
  it.each(cases.thermal_ramp_curve)('$species_id seeded DOY $seed_doy', (c: any) => {
    const sp = SPECIES[c.species_id]
    const gdd = sp.tbase_c >= 10 ? clim.gdd_base10 : clim.gdd_base4
    const curve = thermalRampCurve(sp, c.seed_doy, gap, gdd)
    expect(curve.reduce((a, b) => a + b, 0)).toBeCloseTo(c.expect_sum, 2)
    expect(Math.max(...curve)).toBeCloseTo(c.expect_max, 4)
    expect(curve.filter((v) => v > 0).length).toBe(c.expect_nonzero_days)
  })
})

describe('fitSpeciesInGap — the whole pipeline end to end', () => {
  it.each(cases.fit_species_in_gap)('$species_id', (c: any) => {
    const fit = fitSpeciesInGap(SPECIES[c.species_id], gap, slice)
    expect(fit.feasible).toBe(c.expect_feasible)
    expect(fit.seedDoy).toBe(c.expect_seed_doy)
    expect(fit.gddAvailable).toBeCloseTo(c.expect_gdd_available, 2)
    expect(fit.deltaExposedR).toBeCloseTo(c.expect_delta_exposed_r, TOL)
    expect(fit.pctReduction).toBeCloseTo(c.expect_pct_reduction, 2)
    expect(fit.curveSource).toBe(c.expect_curve_source)
  })

  it('winter-hardy species beat frost-killed ones in a fall gap', () => {
    const rye = fitSpeciesInGap(SPECIES.cereal_rye, gap, slice)
    const oats = fitSpeciesInGap(SPECIES.oats, gap, slice)
    expect(rye.feasible && oats.feasible).toBe(true)
    expect(rye.pctReduction).toBeGreaterThan(oats.pctReduction)
  })

  it('a summer crop cannot fill a fall-winter gap', () => {
    expect(fitSpeciesInGap(SPECIES.buckwheat, gap, slice).feasible).toBe(false)
  })

  it('an observed curve is labelled observed, not modelled', () => {
    const observed = new Array(365).fill(0.6)
    const fit = fitSpeciesInGap(SPECIES.cereal_rye, gap, slice, observed)
    expect(fit.curveSource).toBe('observed')
  })
})
