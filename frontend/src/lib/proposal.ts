import { BARE_THRESHOLD, candidateSeedDoys, exposedErosivity, spliceRotationCover } from './cropFit'
import type { FitResult, Gap, Species } from './cropFit'

export function knownBareDays(cover: number[], nObs: number[]): number {
  return cover.reduce((count, value, i) => count + (nObs[i] > 0 && Number.isFinite(value) && value < BARE_THRESHOLD ? 1 : 0), 0)
}

export function placeDecision(fit: FitResult | undefined, species: Species | undefined, gap: Gap | undefined, doy: number, earliestSeedDoy?: number): { accepted: boolean; reason: string } {
  if (!fit || !species || !gap) return { accepted: false, reason: 'No fit result is available for this crop.' }
  if (!fit.feasible || fit.coverCurve.length !== 365) return { accepted: false, reason: fit.reason || 'This crop has no feasible fit.' }
  if (!candidateSeedDoys(species, gap, undefined, earliestSeedDoy).includes(doy)) return { accepted: false, reason: `${fit.speciesName} cannot be placed on this day. Its suggested seeding date is day ${fit.seedDoy}.` }
  return { accepted: true, reason: `${fit.speciesName} added as a proposed cover crop, seeded on day ${fit.seedDoy}. ${fit.curveSource} cover curve.` }
}

export type ProposalPreview = {
  /** The curve the ring draws: still the mean, because that is the picture. */
  cover: number[]
  baselineBare: number
  proposedBare: number
  baselineExposure: number
  proposedExposure: number
  /** True when the figures were averaged over the real rotation phases. */
  phaseAware: boolean
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * Baseline and proposed figures for the seeding panel.
 *
 * JENSEN'S INEQUALITY, TWICE -- this is the whole reason the function takes
 * `phaseCovers`. A corn-soybean field is in corn one year and soybeans the
 * next. Averaging those two cover curves and then measuring the average is
 * not the same as measuring each real year and averaging the answers:
 *
 *     WRONG:  f(mean over phases of cover)
 *     RIGHT:  mean over phases of f(cover)
 *
 * Erosivity runs through exp(-b*cover), which is convex, so Jensen fixes the
 * direction -- the mean curve always flatters the field. Bare days run
 * through a step, 1[cover < threshold], which is neither convex nor concave,
 * so the mean curve can hide a gap OR invent one, and the sign differs
 * between fields. Both of ours bite, in opposite directions:
 *
 *     Story County    mean curve 110 bare days,  phase-averaged 104
 *     Monona County   mean curve   0 bare days,  phase-averaged   7
 *
 * Monona is the one that matters. Read off the mean curve, the panel says
 * this field is never bare and there is nothing to fix. Seven real bare days
 * exist, all of them in the corn year. This mirrors score_rotation() in
 * backend/fallowclock/rotations.py; with no fills placed it reproduces the
 * bundle's own bare_days and exposed_r exactly, and a test asserts that.
 *
 * Pass a single-element `phaseCovers` to score one phase on its own -- that
 * is what the phase toggle does, because a chosen phase IS the year on
 * screen. Omit it entirely (the synthetic bundle has no phases) and the
 * mean-curve path is used, with `phaseAware: false` to say so.
 */
export function proposalPreview(
  baseCover: number[],
  fits: FitResult[],
  erosivity: number[],
  nObs: number[],
  phaseCovers?: number[][] | null,
): ProposalPreview {
  const curves = fits.map((fit) => fit.coverCurve)
  const cover = curves.length ? spliceRotationCover(baseCover, curves) : baseCover

  if (phaseCovers && phaseCovers.length) {
    // Splice into each real year, then measure each one. Never the reverse.
    const proposed = curves.length ? phaseCovers.map((p) => spliceRotationCover(p, curves)) : phaseCovers
    return {
      cover,
      baselineBare: Math.round(mean(phaseCovers.map((p) => knownBareDays(p, nObs)))),
      proposedBare: Math.round(mean(proposed.map((p) => knownBareDays(p, nObs)))),
      baselineExposure: mean(phaseCovers.map((p) => exposedErosivity(p, erosivity))),
      proposedExposure: mean(proposed.map((p) => exposedErosivity(p, erosivity))),
      phaseAware: true,
    }
  }

  return {
    cover,
    baselineBare: knownBareDays(baseCover, nObs),
    proposedBare: knownBareDays(cover, nObs),
    baselineExposure: exposedErosivity(baseCover, erosivity),
    proposedExposure: exposedErosivity(cover, erosivity),
    phaseAware: false,
  }
}
