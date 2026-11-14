import { BARE_THRESHOLD, PRE_GAP_SEEDING_DAYS, candidateSeedDoys, exposedErosivity, spliceRotationCover } from './cropFit'
import type { FitResult, Gap, Species } from './cropFit'
import { doyToDate } from '../components/YearRing'

export function knownBareDays(cover: number[], nObs: number[]): number {
  return cover.reduce((count, value, i) => count + (nObs[i] > 0 && Number.isFinite(value) && value < BARE_THRESHOLD ? 1 : 0), 0)
}

/**
 * Can this crop be dropped on this day? `earliestSeedDoy` is the field's
 * median observed harvest (lib/bundle.ts medianHarvestDoy): nothing is drilled
 * into a standing crop, which is the rule the backend scored rotations with.
 */
export function placeDecision(fit: FitResult | undefined, species: Species | undefined, gap: Gap | undefined, doy: number, earliestSeedDoy?: number): { accepted: boolean; reason: string } {
  if (!fit || !species || !gap) return { accepted: false, reason: 'No fit result is available for this crop.' }
  if (!fit.feasible || fit.coverCurve.length !== 365) return { accepted: false, reason: fit.reason || 'This crop has no feasible fit.' }
  if (!candidateSeedDoys(species, gap, PRE_GAP_SEEDING_DAYS, earliestSeedDoy).includes(doy)) {
    return { accepted: false, reason: `${fit.speciesName} cannot be placed on ${doyToDate(doy).label}. Its suggested seeding date is ${doyToDate(fit.seedDoy).label}.` }
  }
  return { accepted: true, reason: `${fit.speciesName} added to your plan, seeded around ${doyToDate(fit.seedDoy).label} (${fit.curveSource} cover curve).` }
}

/** Mean-curve preview, kept for the seasonal tests. The UI scores with lib/metrics scoreCover. */
export function proposalPreview(baseCover: number[], fits: FitResult[], erosivity: number[], nObs: number[]) {
  const cover = fits.length ? spliceRotationCover(baseCover, fits.map((fit) => fit.coverCurve)) : baseCover
  return {
    cover,
    baselineBare: knownBareDays(baseCover, nObs),
    proposedBare: knownBareDays(cover, nObs),
    baselineExposure: exposedErosivity(baseCover, erosivity),
    proposedExposure: exposedErosivity(cover, erosivity),
  }
}
