/** Design your own plan: seed packets onto the ring. U2 owns this file. */
import type { FitResult, Species } from '../lib/cropFit'
import { formatChange, pctChange, type CoverScore } from '../lib/metrics'
import { doyToDate } from './YearRing'

export default function CropPlanner({ species, fits, picked, placed, onPick, onPlace, onRemove, onReset, baseline, proposed, tierOf }: {
  species: Species[]
  fits: FitResult[]
  picked: string | null
  placed: string[]
  onPick: (id: string | null) => void
  onPlace: () => void
  onRemove: (id: string) => void
  onReset: () => void
  baseline: CoverScore
  proposed: CoverScore
  /** Plain-language evidence tier: measured, literature or modelled. */
  tierOf: (fit: FitResult) => string
}) {
  const fitById = new Map(fits.map((fit) => [fit.speciesId, fit]))
  const pickedFit = picked ? fitById.get(picked) : undefined
  const pickedSpecies = picked ? species.find((item) => item.id === picked) : undefined
  return <section className="crop-planner" aria-label="Propose cover crops">
    <div className="planner-heading"><div><span className="eyebrow">Or design your own</span><h2>Seed the open window</h2></div><span className="planner-badge">Proposal</span></div>
    <p className="planner-intro">Choose a seed packet, then tap a highlighted day on the wheel. Your plan replaces the preset rotation on the ring.</p>
    <div className="seed-grid">
      {fits.slice(0, 8).map((fit, i) => {
        const sp = species.find((item) => item.id === fit.speciesId)
        return <button key={fit.speciesId} type="button" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', fit.speciesId); onPick(fit.speciesId) }} onClick={() => onPick(picked === fit.speciesId ? null : fit.speciesId)} aria-pressed={picked === fit.speciesId} className={`seed-packet ${picked === fit.speciesId ? 'selected' : ''} ${fit.feasible ? '' : 'infeasible'}`}>
          <span className="seed-art" aria-hidden="true">{['✿', '❦', '✾', '♧'][i % 4]}</span>
          <strong>{fit.speciesName}</strong>
          <small>{fit.feasible ? `${tierOf(fit)} · seed ${doyToDate(fit.seedDoy).label}` : 'Does not fit this gap'}</small>
          <span className="seed-bottom">{sp ? `$${sp.seed_cost_usd_ha}/ha seed` : 'Cover crop'}<span>↗</span></span>
        </button>
      })}
    </div>
    {pickedFit && <div className="picked-details" role="status">
      <strong>{pickedFit.speciesName}</strong>
      <p>{pickedFit.feasible ? `Suggested seeding: ${doyToDate(pickedFit.seedDoy).label}, after this field's typical harvest. ${pickedFit.reason}.` : pickedFit.reason}</p>
      {pickedSpecies?.citation && <p className="seed-citation">Evidence: {pickedSpecies.citation}</p>}
      <button type="button" onClick={onPlace}>Place at suggested date</button>
    </div>}
    <div className="proposal-results">
      <div><span>Bare days, typical year</span><strong>{baseline.bareDays} <span aria-hidden="true">→</span> {proposed.bareDays}</strong></div>
      <div><span>Erosion exposure</span><strong>{formatChange(pctChange(proposed.exposedR, baseline.exposedR))}</strong></div>
    </div>
    <p className="proposal-note">A plan is spliced into each crop year of this field&rsquo;s own satellite record, the same way the three rotations are scored.</p>
    {placed.length > 0 && <div className="placed-list"><strong>Your plan</strong>{placed.map((id) => <button key={id} type="button" onClick={() => onRemove(id)} aria-label={`Remove ${fitById.get(id)?.speciesName ?? id}`}>{fitById.get(id)?.speciesName ?? id} <span>Remove ×</span></button>)}<button type="button" onClick={onReset}>Clear my plan</button></div>}
  </section>
}
