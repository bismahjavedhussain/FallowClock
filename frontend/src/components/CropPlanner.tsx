import type { FitResult, Species } from '../lib/cropFit'
import { doyToDate } from './YearRing'
import { playLift, playPick } from '../lib/sound'

export default function CropPlanner({ species, fits, picked, placed, onPick, onPlace, onRemove, onReset, baselineBare, proposedBare, baselineExposure, proposedExposure, hasProposal = false, phaseNote = null }: {
  species: Species[]
  fits: FitResult[]
  picked: string | null
  placed: string[]
  onPick: (id: string | null) => void
  onPlace: () => void
  onRemove: (id: string) => void
  onReset: () => void
  baselineBare: number
  proposedBare: number
  baselineExposure: number
  proposedExposure: number
  /** True once a crop is actually placed. */
  hasProposal?: boolean
  /** Which year(s) these figures describe, e.g. "in a corn year". */
  phaseNote?: string | null
}) {
  const fitById = new Map(fits.map((fit) => [fit.speciesId, fit]))
  return <section className="crop-planner" aria-label="Propose cover crops">
    <div className="planner-heading"><div><span className="eyebrow">Plan a better season</span><h2>Seed the open window</h2></div><span className="planner-badge">Proposed</span></div>
    <p className="planner-intro">Pick a packet, then tap a lit-up day on the wheel.</p>
    <div className="seed-grid">
      {fits.slice(0, 8).map((fit, i) => {
        const sp = species.find((item) => item.id === fit.speciesId)
        return <button key={fit.speciesId} type="button" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', fit.speciesId); playPick(); onPick(fit.speciesId) }} onClick={() => { playPick(); onPick(picked === fit.speciesId ? null : fit.speciesId) }} aria-pressed={picked === fit.speciesId} className={`seed-packet ${picked === fit.speciesId ? 'selected' : ''} ${fit.feasible ? '' : 'infeasible'}`}>
          <span className="seed-art" aria-hidden="true">{['✿', '❦', '✾', '♧'][i % 4]}</span>
          <strong>{fit.speciesName}</strong>
          <small>{fit.feasible ? `${fit.curveSource} · seed ${doyToDate(fit.seedDoy).label}` : 'No feasible fit'}</small>
          <span className="seed-bottom">{sp ? `$${sp.seed_cost_usd_ha}/ha seed` : 'Cover crop'}<span>↗</span></span>
        </button>
      })}
    </div>
    {picked && <div className="picked-details" role="status">
      <strong>{fitById.get(picked)?.speciesName}</strong>
      <p>{fitById.get(picked)?.feasible ? `Sow around ${doyToDate(fitById.get(picked)!.seedDoy).label}.` : fitById.get(picked)?.reason}</p>
      <button type="button" onClick={onPlace}>Place at suggested date</button>
    </div>}
    <div className="proposal-results">
      <div>
        <span>Bare days</span>
        <strong>
          {baselineBare}
          {hasProposal && <> <span className="to" aria-label="becomes">→</span> <b>{proposedBare}</b></>}
        </strong>
      </div>
      <div>
        <span>Modelled erosion exposure</span>
        <strong>
          {baselineExposure.toFixed(1)}
          {hasProposal && <> <span className="to" aria-label="becomes">→</span> <b>{proposedExposure.toFixed(1)}</b></>}
        </strong>
      </div>
      {phaseNote && <p className="proposal-basis">{hasProposal ? 'Now and proposed, ' : 'As the field stands, '}{phaseNote}.</p>}
    </div>
        {placed.length > 0 && <div className="placed-list"><strong>Added proposals</strong>{placed.map((id) => <button key={id} type="button" onClick={() => { playLift(); onRemove(id) }} aria-label={`Remove ${fitById.get(id)?.speciesName ?? id}`}>{fitById.get(id)?.speciesName ?? id} <span>Remove ×</span></button>)}<button type="button" onClick={() => { playLift(); onReset() }}>Reset comparison</button></div>}
  </section>
}
