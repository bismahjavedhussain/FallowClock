/**
 * The user's own plan as a fourth card in Act four.
 *
 * Whatever has been sown on the wheel (and logged in the field diary) is
 * scored the same way the seeding panel scores it -- proposalPreview, which
 * averages over the real rotation phases -- so this card can never disagree
 * with the panel beside the wheel. No fills placed means no card.
 */
import type { FitResult } from './cropFit'
import { spliceRotationCover } from './cropFit'
import { knownBareDays, proposalPreview } from './proposal'
import type { SplitScenario } from '../components/soil/SplitCore'

export const PLAN_ID = 'your-plan'

export function planScenario({ fits, baseCover, erosivity, nObs, phaseCovers }: {
  fits: (FitResult | undefined)[]
  /** The current rotation's cover: the plan is today's field plus these crops. */
  baseCover: number[]
  erosivity: number[]
  nObs: number[]
  phaseCovers?: number[][] | null
}): SplitScenario[] {
  const placed = fits.filter((f): f is FitResult => !!f && f.feasible && f.coverCurve.length === 365)
  if (!placed.length) return []
  const curves = placed.map((f) => f.coverCurve)
  const phases = phaseCovers && phaseCovers.length ? phaseCovers : null
  const p = proposalPreview(baseCover, placed, erosivity, nObs, phases)
  return [{
    id: PLAN_ID,
    label: `Your plan: ${placed.map((f) => f.speciesName).join(' + ')}`,
    isCurrent: false,
    isPlan: true,
    soilCover: p.cover,
    bareDays: p.proposedBare,
    bareDaysByPhase: phases ? phases.map((ph) => knownBareDays(spliceRotationCover(ph, curves), nObs)) : null,
    seedCostUsdHa: placed.reduce((sum, f) => sum + f.seedCostUsdHa, 0),
    deltaPct: p.baselineExposure > 0 ? ((p.proposedExposure - p.baselineExposure) / p.baselineExposure) * 100 : 0,
    nCreditKgHa: placed.reduce((sum, f) => sum + f.nCreditKgHa, 0),
  }]
}
