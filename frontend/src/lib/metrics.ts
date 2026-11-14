/**
 * Every bare-day and erosion number the UI shows comes from here.
 * U2 owns this file.
 *
 * It mirrors backend/fallowclock/rotations.py score_rotation(): a cover crop
 * is spliced into EACH crop-year curve, bare days are counted per phase and
 * averaged, and erosion exposure is averaged across phases. Doing the same
 * on the mean curve gives different answers -- Story County 110 bare days
 * instead of 104, Monona County 0 instead of 7 -- which is the mismatch a
 * judge spots when the headline and the rotation list disagree. The reason
 * is in gaps.py, phase_averaged_bare_days().
 */
import type { FieldModel, PhaseCurve, Rotation } from './bundle'
import {
  BARE_THRESHOLD,
  RUSLE_B_DEFAULT,
  exposedErosivity,
  fitSpeciesInGap,
  spliceRotationCover,
  type FitResult,
} from './cropFit'

/**
 * Python's round(): exact halves go to the even neighbour. The backend
 * rounds the per-phase mean with it, so 62.5 is 62 there -- Math.round would
 * print 63 beside a rotation list that says 62.
 */
export function pyRound(x: number): number {
  const floor = Math.floor(x)
  if (Math.abs(x - floor - 0.5) > 1e-9) return Math.round(x)
  return floor % 2 === 0 ? floor : floor + 1
}

/** gaps.py bare_days(): cover below the NRCS 30% line. */
export function bareDaysOf(cover: readonly number[], threshold = BARE_THRESHOLD): number {
  let n = 0
  for (const v of cover) if (v < threshold) n++
  return n
}

export interface CoverScore {
  /** Expected bare days in a randomly chosen year of the rotation. */
  bareDays: number
  bareDaysByPhase: number[] | null
  /** Sum over the year of R x C, averaged across phases. MJ.mm/ha/h. */
  exposedR: number
}

/** score_rotation() for the current practice plus any cover-crop curves. */
export function scoreCover(field: FieldModel, fills: number[][], b = RUSLE_B_DEFAULT): CoverScore {
  const erosivity = field.bundle.climatology.erosivity_r
  if (field.phases.length) {
    const combined = field.phases.map((p) => spliceRotationCover(p.cover, fills))
    const byPhase = combined.map((cover) => bareDaysOf(cover))
    const exposed = combined.reduce((sum, cover) => sum + exposedErosivity(cover, erosivity, b), 0) / combined.length
    return {
      bareDays: pyRound(byPhase.reduce((a, n) => a + n, 0) / byPhase.length),
      bareDaysByPhase: byPhase,
      exposedR: exposed,
    }
  }
  const cover = spliceRotationCover(field.bundle.climatology.soil_cover, fills)
  return { bareDays: bareDaysOf(cover), bareDaysByPhase: null, exposedR: exposedErosivity(cover, erosivity, b) }
}

/** Negative is better: less erosive rain lands on exposed soil. */
export function pctChange(value: number, baseline: number): number {
  return baseline > 0 ? ((value - baseline) / baseline) * 100 : 0
}

/** "-27%", "+3%", or "no change" for differences that round to zero. */
export function formatChange(pct: number): string {
  const rounded = Math.round(pct)
  if (rounded === 0) return 'no change'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`
}

export function usableFit(fit: FitResult | undefined): fit is FitResult {
  return Boolean(fit?.feasible && fit.coverCurve.length === 365)
}

/**
 * The cover-crop curves behind one of the bundle's rotations, rebuilt the
 * way rotations.py best_fills_for_gaps() built them: the n-th cover species
 * in the sequence fills the n-th most erosive gap, each scored against the
 * cover the earlier picks already give.
 *
 * Returned only when re-scoring them reproduces the bundle's own numbers,
 * so the ring can never draw a rotation the backend did not compute. Rebuilt
 * at the default RUSLE b, because that is the b the bundle was scored with.
 */
export function rotationFillCurves(field: FieldModel, rotation: Rotation): number[][] | null {
  const byId = new Map(field.species.map((s) => [s.id, s]))
  const ids = [...new Set(rotation.sequence.filter((id) => byId.has(id)))]
  const curves: number[][] = []
  let running = [...field.slice.soilCover]
  for (let i = 0; i < ids.length; i++) {
    const gap = field.gaps[i]
    if (!gap) return null
    const fit = fitSpeciesInGap(
      byId.get(ids[i])!,
      gap,
      { ...field.slice, soilCover: running },
      field.observedCurves[ids[i]],
      RUSLE_B_DEFAULT,
      field.earliestSeedDoy,
    )
    if (!usableFit(fit)) return null
    curves.push(fit.coverCurve)
    running = spliceRotationCover(running, [fit.coverCurve])
  }
  const score = scoreCover(field, curves)
  const tolerance = Math.max(1e-6, rotation.exposed_r * 1e-4)
  const reproduces = score.bareDays === rotation.bare_days && Math.abs(score.exposedR - rotation.exposed_r) <= tolerance
  return reproduces ? curves : null
}

export type EvidenceTier = 'observed' | 'literature' | 'modelled'

/**
 * cropFit labels any supplied curve 'observed', including a literature
 * fallback (Monona County's rye). The bundle knows which it is, so ask it.
 */
export function evidenceTier(field: FieldModel, speciesId: string, curveSource: 'observed' | 'modelled'): EvidenceTier {
  if (curveSource === 'modelled') return 'modelled'
  return field.bundle.crop_curves[speciesId]?.source === 'literature' ? 'literature' : 'observed'
}

/** Tier of a cover species inside a bundle rotation: did it use a curve? */
export function speciesTier(field: FieldModel, speciesId: string): EvidenceTier {
  return evidenceTier(field, speciesId, field.observedCurves[speciesId] ? 'observed' : 'modelled')
}

export function tierLabel(tier: EvidenceTier, nFields?: number): string {
  if (tier === 'observed') return nFields && nFields > 1 ? `measured on ${nFields} nearby fields` : 'measured'
  if (tier === 'literature') return 'extension literature, not measured here'
  return 'modelled estimate'
}

/** Default view: the crop year with the most bare days, where the hole is clearest. */
export function defaultPhaseKey(field: FieldModel): string | null {
  if (!field.phases.length) return null
  const byPhase = field.current.bare_days_by_phase
  let best: PhaseCurve = field.phases[0]
  let bestDays = -1
  field.phases.forEach((phase, i) => {
    const days = byPhase?.[i] ?? bareDaysOf(phase.cover)
    if (days > bestDays) {
      best = phase
      bestDays = days
    }
  })
  return best.key
}

export interface FieldFacts {
  bareDays: number
  byPhase: { key: string; label: string; days: number }[]
  /** Share of the year's raw erosivity falling inside the main gap, 0-100. */
  gapSharePct: number
  /**
   * Centre of the heaviest 30-day erosivity window, from the backend. Never
   * recomputed here: a single-day argmax picks the wrong month (late August
   * for Monona, whose real peak is May).
   */
  peakErosivityDoy: number
  /** Days with no usable satellite observation: shown, never hidden. */
  unknownDays: number
}

export function fieldFacts(field: FieldModel): FieldFacts {
  const c = field.bundle.climatology
  return {
    bareDays: field.current.bare_days,
    byPhase: field.phases.map((p, i) => ({
      key: p.key,
      label: p.label,
      days: field.current.bare_days_by_phase?.[i] ?? bareDaysOf(p.cover),
    })),
    gapSharePct: Math.round((field.mainGap?.share_of_annual_r ?? 0) * 100),
    peakErosivityDoy: c.erosivity_peak_doy,
    unknownDays: c.n_obs_per_doy.filter((n) => n <= 0).length,
  }
}
