import { useRef } from 'react'
import type { FitResult, Species } from '../lib/cropFit'
import { doyToDate } from './YearRing'
import { playLift, playPick } from '../lib/sound'
import { seedCursor } from '../lib/seedCursor'
import { seedBody, seedSpec } from '../lib/seedArt'
import SeedIcon from './SeedIcon'

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

  // The chip that follows the pointer during a drag. setDragImage
  // snapshots the node SYNCHRONOUSLY at dragstart, so it has to be in the
  // document and laid out before the call -- hence a real element parked
  // off-screen rather than a detached one, which Safari and Firefox both
  // render as an empty box.
  const ghost = useRef<HTMLDivElement | null>(null)

  const makeGhost = (speciesId: string, name: string): HTMLDivElement => {
    const el = document.createElement('div')
    el.className = 'seed-ghost'
    // The cursor is capped at 32px by the platform; the chip is not, so
    // this is where the seed can actually be seen. 56px.
    el.innerHTML =
      `<svg width="56" height="56" viewBox="0 0 32 32" aria-hidden="true">${seedBody(seedSpec(speciesId))}</svg>` +
      '<strong></strong>'
    el.querySelector('strong')!.textContent = name
    document.body.appendChild(el)
    return el
  }

  const clearGhost = () => {
    ghost.current?.remove()
    ghost.current = null
  }
  return <section className="crop-planner" aria-label="Propose cover crops">
    <div className="planner-heading"><div><span className="eyebrow">Plan a better season</span><h2>Seed the open window</h2></div><span className="planner-badge">Proposed</span></div>
    <p className="planner-intro">Pick a packet, then tap a lit-up day on the wheel.</p>
    <div className="seed-grid">
      {fits.slice(0, 8).map((fit) => {
        const sp = species.find((item) => item.id === fit.speciesId)
        return <button
          key={fit.speciesId}
          type="button"
          draggable
          // An infeasible packet keeps the ordinary pointer: carrying a
          // seed you cannot plant anywhere is a promise the wheel will
          // not keep.
          style={fit.feasible ? { cursor: seedCursor(fit.speciesId) } : undefined}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', fit.speciesId)
            e.dataTransfer.effectAllowed = 'copy'
            clearGhost()
            ghost.current = makeGhost(fit.speciesId, fit.speciesName)
            // Offset so the chip sits below-right of the pointer and does
            // not cover the day being aimed at.
            e.dataTransfer.setDragImage(ghost.current, 22, 16)
            playPick()
            onPick(fit.speciesId)
          }}
          onDragEnd={clearGhost}
          onClick={() => { playPick(); onPick(picked === fit.speciesId ? null : fit.speciesId) }}
          aria-pressed={picked === fit.speciesId}
          className={`seed-packet ${picked === fit.speciesId ? 'selected' : ''} ${fit.feasible ? '' : 'infeasible'}`}
        >
          <span className="seed-art" aria-hidden="true"><SeedIcon speciesId={fit.speciesId} size={44} /></span>
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
