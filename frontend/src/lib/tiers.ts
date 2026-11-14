/**
 * Evidence tiers for a cover crop curve.
 *
 * Ported from Kaif's U2 branch (`lib/metrics.ts`), adapted to take plain
 * arguments instead of his `FieldModel` so it drops into this shell
 * without pulling the whole data layer across.
 *
 * HIS CATCH, KEPT: cropFit labels ANY curve it was handed 'observed',
 * including the Midwest-literature rye fallback used when no cover-cropped
 * neighbour was found — which is exactly Monona County's case. So the tier
 * cannot be read off the fit result; it has to be asked of the bundle,
 * which records where the curve really came from.
 */

export type EvidenceTier = 'observed' | 'literature' | 'modelled'

export function formatChange(pct: number): string {
  const rounded = Math.round(pct)
  if (rounded === 0) return 'no change'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`
}

export function evidenceTier(
  curveSourceFromBundle: string | undefined,
  haveObservedCurve: boolean,
): EvidenceTier {
  if (!haveObservedCurve) return 'modelled'
  return curveSourceFromBundle === 'literature' ? 'literature' : 'observed'
}

export function tierLabel(tier: EvidenceTier, nFields?: number): string {
  if (tier === 'observed') {
    return nFields && nFields > 1 ? `measured on ${nFields} nearby fields` : 'measured'
  }
  if (tier === 'literature') return 'extension literature, not measured here'
  return 'modelled estimate'
}
