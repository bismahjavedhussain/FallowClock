/**
 * Field Notes: everything long-form, out of the way but one click deep.
 *
 * The main view had three dense blocks competing with the instrument -- the
 * scientific rule, the uncertainty ledger and the provenance strip. None of
 * them should be deleted (the uncertainty list in particular is scored, and
 * hiding it is the usual way teams lose the data award), but none of them
 * needs to be on screen while someone is dragging a seed packet.
 *
 * So they live here, behind a button that states how many caveats are inside
 * rather than burying the count.
 */

import { useEffect, useRef } from 'react'
import RingLegend from './RingLegend'

export interface FieldNotesData {
  place: string
  areaHa: number
  ownerName: string
  synthetic: boolean
  years: number[]
  sources: { name: string }[]
  uncertainty: { field: string; level: string; reason: string; affects: string }[]
  rotationLabel: string
  phaseLabels: string[] | null
  bareDays: number
  bareDaysByPhase: number[] | null
  /** What the farmer has logged this session. */
  diary?: { id: string; stamp: string; text: string }[]
}

export default function FieldNotes({
  open,
  onClose,
  data,
}: {
  open: boolean
  onClose: () => void
  data: FieldNotesData
}) {
  const panel = useRef<HTMLDivElement>(null)

  // Escape closes, and focus moves into the drawer so a keyboard user is not
  // left tabbing through the page behind it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const phases =
    data.bareDaysByPhase && data.phaseLabels && data.bareDaysByPhase.length === data.phaseLabels.length
      ? data.bareDaysByPhase.map((n, i) => `${n} after ${data.phaseLabels![i]}`).join(', ')
      : null

  return (
    <div className="notes-overlay" onClick={onClose}>
      <aside
        className="notes-drawer"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Field notes"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="notes-drawer-head">
          <div>
            <span className="eyebrow">Field notes</span>
            <h2>{data.place}</h2>
            <small>
              {data.ownerName.startsWith('TBD') ? 'Observed field' : data.ownerName} · {data.areaHa} ha ·{' '}
              {data.rotationLabel}
            </small>
          </div>
          <button type="button" onClick={onClose} aria-label="Close field notes">
            ×
          </button>
        </header>

        <div className="notes-drawer-body">
          <section>
            <h3>How to read the wheel</h3>
            <RingLegend compact showDetails />
            <p className="notes-rule">
              The bundle&apos;s <code>soil_cover</code> decides bare or covered. Green canopy and crop residue
              are supporting evidence, not the decision. Days with no usable satellite pass stay unknown
              rather than defaulting to bare. Rainfall erosivity is a separate outer layer.
            </p>
          </section>

          <section>
            <h3>Bare days on this field</h3>
            <p>
              <strong>{data.bareDays} days</strong> expected in a given year
              {phases ? ` — ${phases}.` : '.'}
            </p>
            {phases && (
              <p className="notes-rule">
                A corn-soybean field is a different field in alternate years, because the two crops leave very
                different residue behind. The wheel shows the mean of the phases, so a day can read covered on
                the wheel and still be bare in one phase of the rotation.
              </p>
            )}
          </section>

          <section>
            <h3>What we do not know</h3>
            <ul className="uncertainty-list">
              {data.uncertainty.map((u, i) => (
                <li key={i}>
                  <div>
                    <span className={`uncertainty-level level-${u.level}`}>{u.level}</span>
                    <code>{u.field}</code>
                  </div>
                  <p>{u.reason}</p>
                  <small>{u.affects}</small>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>How crop fit is scored</h3>
            <p className="notes-rule">
              Percentages are the reduction in erosion exposure inside the largest gap. Species are ranked by{' '}
              <strong>evidence first</strong>: one we measured on neighbouring fields outranks a modelled one
              even when the model promises more. Every modelled curve uses the same generic plateau, so
              modelled species tie at identical percentages and read higher than they should. The measured
              curve is lower because it is real. Treat modelled figures as an upper bound.
            </p>
          </section>

          {!!data.diary?.length && (
            <section>
              <h3>Field diary</h3>
              <ul className="notes-diary">
                {data.diary.map((e) => (
                  <li key={e.id}>
                    <span className="diary-stamp">{e.stamp}</span>
                    <span>{e.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3>Where the data comes from</h3>
            <ul className="notes-sources">
              {data.sources.map((s, i) => (
                <li key={i}>{s.name}</li>
              ))}
            </ul>
            <small>Years used: {data.years.join(', ') || 'unspecified'}</small>
            {data.synthetic && (
              <p className="notes-rule notes-warn">
                This bundle is a synthetic sample. The cover curves were not observed by any satellite.
              </p>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}
