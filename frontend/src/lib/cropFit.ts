/**
 * Cover-crop fitting, client side.
 *
 * MIRROR OF backend/fallowclock/cropfit.py. The two must agree.
 *
 * Why duplicated: fitting runs on every drag, and a round trip to the API
 * per pointer event would make the hero interaction feel broken. Running
 * Python in the browser (Pyodide) was not worth ~80 lines.
 *
 * The guard against drift is backend/tests/vectors.json, generated from the
 * Python and asserted by BOTH test suites. If you change a rule here,
 * change it there, then run `python scripts/gen_vectors.py` and let the
 * tests tell you whether the two sides still agree. Do not change one side
 * only — a silent divergence shows up as the UI claiming 94 bare days while
 * the pitch deck says 96, which is the kind of thing a judge notices.
 */

const DOY_LEN = 365
export const BARE_THRESHOLD = 0.3
export const RUSLE_B_DEFAULT = 0.035
/**
 * Ceiling on cover for a MODELLED (thermal-ramp) species — one with no
 * observed or literature curve. Deliberately conservative: at 0.85 the
 * fallback beat every curve we had real evidence for, so the tool
 * recommended the species it knew least about. A guess must never outrank
 * evidence.
 */
export const DEFAULT_PLATEAU = 0.55
export const MIN_SEEDING_MOISTURE = 0.15

/**
 * The bare gap opens well AFTER harvest, because stover keeps protecting the
 * soil until it decays or is tilled under. But the seeding decision is driven
 * by harvest, not by the day the cover estimate crosses a threshold. In Iowa
 * the practical window is late Aug to mid Sep — aerially interseeded into
 * senescing corn, or drilled straight after an early soybean harvest. Pass
 * `earliestSeedDoy` from the observed harvest date when you have it.
 */
export const PRE_GAP_SEEDING_DAYS = 60

/**
 * A winter-hardy cover crop is seeded in autumn precisely so that it is
 * standing the FOLLOWING spring, and on a reduced-tillage field the spring
 * window is the one that matters: Story County's residue mat holds cover
 * above the bare threshold all winter, then thins after planting, leaving
 * the field bare DOY 83-165 — straight through the DOY 170 erosivity peak.
 *
 * With a flat 60-day lead, cereal rye's seeding window (DOY 227-319) misses
 * that gap by four months and every winter-hardy species comes back
 * "seeding window does not overlap this gap".
 *
 * Mirrors WINTER_HARDY_PRE_GAP_DAYS in backend/fallowclock/cropfit.py.
 */
export const WINTER_HARDY_PRE_GAP_DAYS = 300

/** Frost-killed residue decomposes: roughly halves over a winter, floors at
 *  a persistent mat. Without this every species scores identically. */
export const RESIDUE_DECAY_PER_DAY = 0.006
export const RESIDUE_DECAY_FLOOR = 0.35

/**
 * Every cover crop is terminated before the cash crop is planted. Without
 * this a modelled species held full cover straight through the spring
 * erosivity peak and out-scored real cereal rye, whose literature curve
 * terminates because that is what actually happens in a field.
 */
export const TERMINATION_DAYS = 12
export const TERMINATION_RESIDUAL = 0.15

export interface Species {
  id: string
  name: string
  seeding_window: [number, number]
  tbase_c: number
  gdd_establish: number
  winterkill_c: number
  water_mm: number
  n_credit_kg_ha: number
  biomass_kg_ha: number
  seed_cost_usd_ha: number
  winter_hardy: boolean
  citation: string
}

export interface Gap {
  start_doy: number
  end_doy: number
  n_days: number
  exposed_r: number
  share_of_annual_r: number
  wraps_year: boolean
}

export interface FitResult {
  speciesId: string
  speciesName: string
  seedDoy: number
  feasible: boolean
  reason: string
  gddAvailable: number
  gddRequired: number
  establishByDoy: number | null
  coverCurve: number[]
  deltaExposedR: number
  pctReduction: number
  nCreditKgHa: number
  seedCostUsdHa: number
  curveSource: 'observed' | 'modelled'
}

export interface ClimatologySlice {
  gddBase4: number[]
  gddBase10: number[]
  frostProb: number[]
  soilMoisture: number[]
  erosivityR: number[]
  soilCover: number[]
}

/** C = exp(-b * cover_percent). Bare soil gives 1.0. */
export function rusleCFactor(soilCover: number, b = RUSLE_B_DEFAULT): number {
  if (soilCover < 0 || soilCover > 1) {
    throw new Error(`soilCover must be a 0-1 fraction, got ${soilCover}`)
  }
  return Math.exp(-b * soilCover * 100)
}

export function exposedErosivity(
  soilCover: number[],
  erosivityR: number[],
  b = RUSLE_B_DEFAULT,
): number {
  checkLen(soilCover, 'soilCover')
  checkLen(erosivityR, 'erosivityR')
  let total = 0
  for (let i = 0; i < DOY_LEN; i++) total += erosivityR[i] * rusleCFactor(soilCover[i], b)
  return total
}

/** Inclusive 0-based run -> DOY indices, wrap-aware. */
export function doysInRun(startIdx: number, endIdx: number): number[] {
  if (startIdx <= endIdx) {
    return Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i)
  }
  const head = Array.from({ length: DOY_LEN - startIdx }, (_, i) => startIdx + i)
  const tail = Array.from({ length: endIdx + 1 }, (_, i) => i)
  return [...head, ...tail]
}

/** Seeding windows wrap the year the same way gaps do. */
function inWindow(doy: number, [start, end]: [number, number]): boolean {
  return start <= end ? doy >= start && doy <= end : doy >= start || doy <= end
}

export function accumulateGdd(gddDaily: number[], startDoy: number, endDoy: number): number {
  checkLen(gddDaily, 'gddDaily')
  return doysInRun(startDoy - 1, endDoy - 1).reduce((s, i) => s + gddDaily[i], 0)
}

/**
 * Daily frost probability at which we call a stand killed.
 *
 * NOT 0.5. Calibrated against Story County 2000-2024: thresholding at 0.5
 * puts first fall frost at DOY 314 when the true per-year median is 288,
 * overstating the frost-free season by ~47 days and handing every cover
 * crop a month of growth it never gets. 0.10 reproduces the true dates and
 * matches published station normals.
 */
export const KILLING_FROST_PROB = 0.1

export function firstKillingFrostDoy(
  frostProb: number[],
  afterDoy: number,
  probThreshold = KILLING_FROST_PROB,
  searchDays = 200,
): number | null {
  for (let step = 1; step <= searchDays; step++) {
    const idx = (afterDoy - 1 + step) % DOY_LEN
    if (frostProb[idx] >= probThreshold) return idx + 1
  }
  return null
}

export function candidateSeedDoys(
  species: Species,
  gap: Gap,
  preGapDays = PRE_GAP_SEEDING_DAYS,
  earliestSeedDoy?: number,
): number[] {
  let startIdx: number
  if (earliestSeedDoy !== undefined) {
    startIdx = earliestSeedDoy - 1
  } else {
    let lead = species.winter_hardy
      ? Math.max(preGapDays, WINTER_HARDY_PRE_GAP_DAYS)
      : preGapDays
    // The seeding period is lead + gap and must not exceed a year. Without
    // this cap it wraps PAST itself and doysInRun returns the complement —
    // the window the species may NOT be seeded in.
    lead = Math.max(0, Math.min(lead, DOY_LEN - gap.n_days))
    startIdx = (((gap.start_doy - 1 - lead) % DOY_LEN) + DOY_LEN) % DOY_LEN
  }
  return doysInRun(startIdx, gap.end_doy - 1)
    .map((i) => i + 1)
    .filter((d) => inWindow(d, species.seeding_window))
}

/**
 * The DOY by which the stand must be established.
 *
 *  - Winter-hardy (rye, wheat, vetch): frost does not kill them. They
 *    establish in autumn, go dormant, finish in spring. Deadline is the end
 *    of the gap. Dormancy needs no special handling — GDD is zero below the
 *    base temperature, so winter contributes nothing on its own.
 *  - Not hardy (oats, radish, buckwheat): the first killing frost ends them.
 */
export function establishmentDeadline(
  species: Species,
  gap: Gap,
  frostProb: number[],
  seedDoy: number,
): number {
  if (species.winter_hardy) return gap.end_doy
  return firstKillingFrostDoy(frostProb, seedDoy) ?? gap.end_doy
}

/**
 * cover(d) = plateau * min(1, GDD(seed -> d) / gdd_establish)
 *
 * Runs from the SEEDING date to the end of the gap, not from the gap start —
 * cover crops are routinely seeded while the cash crop still stands, and a
 * curve starting only once the field reads bare would credit them nothing.
 * The erosivity delta still counts only days inside the gap, so pre-gap
 * growth cannot inflate the benefit.
 *
 * After `stopGrowthDoy` (the killing frost, for non-hardy species) the stand
 * stops growing and its residue decays — it does not vanish. Dead residue
 * still protects soil.
 */
export function thermalRampCurve(
  species: Species,
  seedDoy: number,
  gap: Gap,
  gddDaily: number[],
  plateau = DEFAULT_PLATEAU,
  stopGrowthDoy?: number,
): number[] {
  const curve = new Array<number>(DOY_LEN).fill(0)
  let accumulated = 0
  let frozenAt: number | null = null
  let daysSinceKill = 0

  for (const idx of doysInRun(seedDoy - 1, gap.end_doy - 1)) {
    if (frozenAt !== null) {
      daysSinceKill += 1
      curve[idx] =
        frozenAt * Math.max(RESIDUE_DECAY_FLOOR, 1 - RESIDUE_DECAY_PER_DAY * daysSinceKill)
      continue
    }
    accumulated += gddDaily[idx]
    curve[idx] = plateau * Math.min(1, accumulated / species.gdd_establish)
    if (stopGrowthDoy !== undefined && idx + 1 === stopGrowthDoy) frozenAt = curve[idx]
  }

  // Terminate into the cash crop over the last TERMINATION_DAYS of the gap.
  const span = doysInRun(seedDoy - 1, gap.end_doy - 1)
  const nTerm = Math.min(TERMINATION_DAYS, span.length)
  for (let offset = 0; offset < nTerm; offset++) {
    const idx = span[span.length - nTerm + offset]
    const frac = 1 - (offset + 1) / nTerm
    curve[idx] = curve[idx] * Math.max(TERMINATION_RESIDUAL, frac)
  }
  return curve
}

export function fitSpeciesInGap(
  species: Species,
  gap: Gap,
  clim: ClimatologySlice,
  observedCurve?: number[],
  b = RUSLE_B_DEFAULT,
  earliestSeedDoy?: number,
): FitResult {
  const gddDaily = species.tbase_c >= 10 ? clim.gddBase10 : clim.gddBase4
  const candidates = candidateSeedDoys(
    species,
    gap,
    PRE_GAP_SEEDING_DAYS,
    earliestSeedDoy,
  )

  const base = (over: Partial<FitResult>): FitResult => ({
    speciesId: species.id,
    speciesName: species.name,
    seedDoy: 0,
    feasible: false,
    reason: '',
    gddAvailable: 0,
    gddRequired: species.gdd_establish,
    establishByDoy: null,
    coverCurve: [],
    deltaExposedR: 0,
    pctReduction: 0,
    nCreditKgHa: species.n_credit_kg_ha,
    seedCostUsdHa: species.seed_cost_usd_ha,
    curveSource: 'modelled',
    ...over,
  })

  if (candidates.length === 0) {
    return base({
      reason:
        `Seeding window (DOY ${species.seeding_window[0]}-` +
        `${species.seeding_window[1]}) does not overlap this gap`,
    })
  }

  let best: FitResult | null = null
  let lastFailure: FitResult | null = null

  for (const seedDoy of candidates) {
    if (clim.soilMoisture[seedDoy - 1] < MIN_SEEDING_MOISTURE) {
      lastFailure = base({
        seedDoy,
        reason: 'Modelled soil water too low at seeding (bucket model, not a measurement)',
      })
      continue
    }

    const establishBy = establishmentDeadline(species, gap, clim.frostProb, seedDoy)
    const gddAvailable = accumulateGdd(gddDaily, seedDoy, establishBy)
    const deadlineLabel = species.winter_hardy
      ? 'before the next cash crop'
      : 'before first frost'

    if (gddAvailable < species.gdd_establish) {
      lastFailure = base({
        seedDoy,
        gddAvailable,
        establishByDoy: establishBy,
        reason:
          `Only ${gddAvailable.toFixed(0)} GDD ${deadlineLabel}; needs ` +
          `${species.gdd_establish.toFixed(0)} to establish`,
      })
      continue
    }

    const curve = observedCurve
      ? [...observedCurve]
      : thermalRampCurve(
          species,
          seedDoy,
          gap,
          gddDaily,
          DEFAULT_PLATEAU,
          species.winter_hardy ? undefined : establishBy,
        )
    const curveSource: 'observed' | 'modelled' = observedCurve ? 'observed' : 'modelled'

    const gapIdxs = doysInRun(gap.start_doy - 1, gap.end_doy - 1)
    let before = 0
    let after = 0
    for (const i of gapIdxs) {
      before += clim.erosivityR[i] * rusleCFactor(clim.soilCover[i], b)
      after += clim.erosivityR[i] * rusleCFactor(Math.max(clim.soilCover[i], curve[i]), b)
    }
    const delta = before - after

    const result = base({
      seedDoy,
      feasible: true,
      gddAvailable,
      establishByDoy: establishBy,
      coverCurve: curve,
      deltaExposedR: delta,
      pctReduction: before > 0 ? (delta / before) * 100 : 0,
      curveSource,
      reason: `Establishes with ${gddAvailable.toFixed(0)} GDD ${deadlineLabel}`,
    })

    if (best === null || result.deltaExposedR > best.deltaExposedR) best = result
  }

  return best ?? lastFailure ?? base({ reason: 'No feasible seeding date' })
}

/** Lower sorts first. Observed beats literature beats our own model. */
export const EVIDENCE_ORDER: Record<string, number> = {
  observed: 0,
  literature: 1,
  modelled: 2,
}

export function rankSpeciesForGap(
  speciesList: Species[],
  gap: Gap,
  clim: ClimatologySlice,
  observedCurves: Record<string, number[]> = {},
  b = RUSLE_B_DEFAULT,
  /** Observed cash-crop harvest: nothing is drilled into a standing crop. */
  earliestSeedDoy?: number,
): FitResult[] {
  return speciesList
    .map((sp) =>
      fitSpeciesInGap(sp, gap, clim, observedCurves[sp.id], b, earliestSeedDoy),
    )
    // Feasible first, then EVIDENCE TIER, then benefit. Evidence outranks
    // magnitude deliberately: a modelled thermal ramp often out-scores a
    // species we have a real curve for, because the model is a smooth
    // idealisation and a measurement is not. Show both, put what we can
    // defend first, and always print the tier beside the number.
    .sort((a, x) => {
      if (a.feasible !== x.feasible) return a.feasible ? -1 : 1
      const ra = EVIDENCE_ORDER[a.curveSource] ?? 99
      const rx = EVIDENCE_ORDER[x.curveSource] ?? 99
      if (ra !== rx) return ra - rx
      return x.deltaExposedR - a.deltaExposedR
    })
}

/** Union, not replacement: a cover crop never makes a covered day barer. */
export function spliceRotationCover(baseCover: number[], curves: number[][]): number[] {
  const out = [...baseCover]
  for (const curve of curves) {
    for (let i = 0; i < DOY_LEN; i++) out[i] = Math.max(out[i], curve[i])
  }
  return out
}

export function bareDays(cover: number[], threshold = BARE_THRESHOLD): number {
  return cover.reduce((n, v) => n + (v < threshold ? 1 : 0), 0)
}

function checkLen(values: number[], name: string): void {
  if (values.length !== DOY_LEN) {
    throw new Error(`${name} must have length ${DOY_LEN}, got ${values.length}`)
  }
}
