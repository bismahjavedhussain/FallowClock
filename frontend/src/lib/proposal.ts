import { BARE_THRESHOLD, candidateSeedDoys, exposedErosivity, spliceRotationCover } from './cropFit'
import type { FitResult, Gap, Species } from './cropFit'

export function knownBareDays(cover: number[], nObs: number[]): number {
  return cover.reduce((count, value, i) => count + (nObs[i] > 0 && Number.isFinite(value) && value < BARE_THRESHOLD ? 1 : 0), 0)
}

export function placeDecision(fit: FitResult | undefined, species: Species | undefined, gap: Gap | undefined, doy: number): { accepted: boolean; reason: string } {
  if (!fit || !species || !gap) return { accepted: false, reason: 'No fit result is available for this crop.' }
  if (!fit.feasible || fit.coverCurve.length !== 365) return { accepted: false, reason: fit.reason || 'This crop has no feasible fit.' }
  if (!candidateSeedDoys(species, gap).includes(doy)) return { accepted: false, reason: `${fit.speciesName} cannot be placed on this day. Its suggested seeding date is day ${fit.seedDoy}.` }
  return { accepted: true, reason: `${fit.speciesName} added as a proposed cover crop, seeded on day ${fit.seedDoy}. ${fit.curveSource} cover curve.` }
}

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
