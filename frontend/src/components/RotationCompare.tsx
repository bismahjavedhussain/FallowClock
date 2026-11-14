/** Evidence behind the crop options, kept close to the visual comparison. */
import { evidenceTier, tierLabel } from '../lib/tiers'

export interface CompareRotation {
  id: string
  label: string
  isCurrent: boolean
  sequence: string[]
}

export default function RotationCompare({
  rotations,
  speciesNames,
  cropCurves,
  observedCurveIds,
}: {
  rotations: CompareRotation[]
  speciesNames: Map<string, string>
  cropCurves: Record<string, { source?: string; n_fields?: number }>
  observedCurveIds: Set<string>
}) {
  const options = rotations.filter((r) => !r.isCurrent)
  if (!options.length) return null

  return <details className="rotation-compare">
    <summary><strong>Evidence behind the options</strong><small>Measured and modelled crop curves</small></summary>
    <div className="rotation-evidence-list">
      {options.map((r) => {
        const covers = [...new Set(r.sequence.filter((id) => speciesNames.has(id)))]
        return <div className="rotation-evidence" key={r.id}>
          <strong>{r.label}</strong>
          <div className="tier-chips">
            {covers.length ? covers.map((id) => {
              const tier = evidenceTier(cropCurves[id]?.source, observedCurveIds.has(id))
              return <span key={id} className={`tier-chip tier-${tier}`}>{speciesNames.get(id)}: {tierLabel(tier, cropCurves[id]?.n_fields)}</span>
            }) : <span className="tier-chip tier-modelled">No crop curve in this option</span>}
          </div>
        </div>
      })}
    </div>
    <p>Erosion exposure compares rainfall weighted by bare soil across the year. The percentages are relative to today&apos;s rotation.</p>
  </details>
}
