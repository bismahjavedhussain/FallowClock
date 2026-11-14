/** The decision the brief scores: three rotations, side by side. U2 owns this file. */
import type { FieldModel } from '../lib/bundle'
import { formatChange, speciesTier, tierLabel } from '../lib/metrics'

export default function RotationCompare({ field, selectedId, onSelect }: {
  field: FieldModel
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const nameOf = new Map(field.species.map((s) => [s.id, s.name]))
  return (
    <section className="rotation-compare" aria-label="Compare rotations">
      <div className="planner-heading">
        <div><span className="eyebrow">The decision</span><h2>Three futures for this field</h2></div>
      </div>
      <div className="rotation-list">
        {field.bundle.rotations.map((r) => {
          const covers = [...new Set(r.sequence.filter((id) => nameOf.has(id)))]
          const active = r.is_current ? selectedId === null : selectedId === r.id
          const byPhase = r.bare_days_by_phase && field.phases.length === r.bare_days_by_phase.length
            ? field.phases.map((p, i) => `${r.bare_days_by_phase![i]} ${p.key}`).join(' · ')
            : null
          const cost = r.added_seed_cost_usd_ha ?? 0
          const nCredit = r.n_credit_kg_ha ?? 0
          return (
            <button type="button" key={r.id} className="rotation-option" aria-pressed={active} onClick={() => onSelect(r.is_current ? null : r.id)}>
              <span className="rotation-copy">
                <strong>{r.label}</strong>
                <small><b>{r.bare_days} bare days</b> a typical year{byPhase ? ` (${byPhase})` : ''}</small>
                <small>{cost > 0 ? `+$${cost.toFixed(0)}/ha seed` : 'No added seed cost'}{nCredit > 0 ? ` · ${nCredit.toFixed(0)} kg N/ha credit` : ''}</small>
                {covers.length > 0 && (
                  <span className="tier-chips">
                    {covers.map((id) => {
                      const tier = speciesTier(field, id)
                      return <span key={id} className={`tier-chip tier-${tier}`}>{nameOf.get(id)}: {tierLabel(tier, field.bundle.crop_curves[id]?.n_fields)}</span>
                    })}
                  </span>
                )}
              </span>
              <span className="rotation-delta">
                {r.is_current ? 'Baseline' : formatChange(r.delta_vs_current_pct)}
                <small>{r.is_current ? 'current practice' : 'erosion exposure'}</small>
              </span>
            </button>
          )
        })}
      </div>
      <p className="proposal-note">
        Erosion exposure is rainfall erosivity weighted by how bare the soil is (the RUSLE cover factor), summed over the
        year and averaged across crop years. Trust the comparison between rotations more than any absolute number.
      </p>
    </section>
  )
}
