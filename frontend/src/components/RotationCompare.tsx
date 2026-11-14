/**
 * The decision the brief scores: three rotations, side by side, selectable.
 *
 * From Kaif's U2 branch, adapted to this shell's data shapes. It sits
 * beside SplitCore rather than replacing it: the cutaway panels show what
 * happens to the soil, this list says what it costs and — the part only
 * this has — HOW GOOD THE EVIDENCE IS behind each cover crop.
 *
 * Selecting a row drives the ring, so the comparison is not just a table.
 */

import { evidenceTier, formatChange, tierLabel } from '../lib/tiers'

export interface CompareRotation {
  id: string
  label: string
  isCurrent: boolean
  sequence: string[]
  bareDays: number
  bareDaysByPhase?: number[] | null
  seedCostUsdHa: number
  nCreditKgHa: number
  deltaPct: number
}

export default function RotationCompare({
  rotations,
  speciesNames,
  cropCurves,
  observedCurveIds,
  phaseLabels,
  selectedId,
  onSelect,
}: {
  rotations: CompareRotation[]
  speciesNames: Map<string, string>
  /** From the bundle: where each curve really came from. */
  cropCurves: Record<string, { source?: string; n_fields?: number }>
  /** Which species the fit actually had a curve for. */
  observedCurveIds: Set<string>
  phaseLabels: string[] | null
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  if (!rotations.length) return null

  return (
    <section className="rotation-compare" aria-label="Compare rotations">
      <div className="planner-heading">
        <div>
          <span className="eyebrow">The decision</span>
          <h2>Three futures for this field</h2>
        </div>
      </div>

      <div className="rotation-list">
        {rotations.map((r) => {
          const covers = [...new Set(r.sequence.filter((id) => speciesNames.has(id)))]
          const active = r.isCurrent ? selectedId === null : selectedId === r.id
          const byPhase =
            r.bareDaysByPhase && phaseLabels && phaseLabels.length === r.bareDaysByPhase.length
              ? r.bareDaysByPhase.map((n, i) => `${n} ${phaseLabels[i]}`).join(' · ')
              : null

          return (
            <button
              type="button"
              key={r.id}
              className="rotation-option"
              aria-pressed={active}
              onClick={() => onSelect(r.isCurrent ? null : r.id)}
            >
              <span className="rotation-copy">
                <strong>{r.label}</strong>
                <small>
                  <b>{r.bareDays} bare days</b> a typical year{byPhase ? ` (${byPhase})` : ''}
                </small>
                <small>
                  {r.seedCostUsdHa > 0 ? `+$${r.seedCostUsdHa.toFixed(0)}/ha seed` : 'No added seed cost'}
                  {r.nCreditKgHa > 0 ? ` · ${r.nCreditKgHa.toFixed(0)} kg N/ha credit` : ''}
                </small>
                {covers.length > 0 && (
                  <span className="tier-chips">
                    {covers.map((id) => {
                      const tier = evidenceTier(cropCurves[id]?.source, observedCurveIds.has(id))
                      return (
                        <span key={id} className={`tier-chip tier-${tier}`}>
                          {speciesNames.get(id)}: {tierLabel(tier, cropCurves[id]?.n_fields)}
                        </span>
                      )
                    })}
                  </span>
                )}
              </span>
              <span className="rotation-delta">
                {r.isCurrent ? 'Baseline' : formatChange(r.deltaPct)}
                <small>{r.isCurrent ? 'current practice' : 'erosion exposure'}</small>
              </span>
            </button>
          )
        })}
      </div>

      <p className="proposal-note">
        Erosion exposure is rainfall erosivity weighted by how bare the soil is (the RUSLE cover
        factor), summed over the year and averaged across crop years. Trust the comparison between
        rotations more than any absolute number.
      </p>
    </section>
  )
}
