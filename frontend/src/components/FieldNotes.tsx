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
import { sourceLines } from '../lib/sources'

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
  /** The one-sentence finding. Off the main screen, but not lost. */
  finding?: string | null
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
          {data.finding && (
            <section>
              <h3>What this field shows</h3>
              <p className="notes-finding">{data.finding}</p>
            </section>
          )}

          <section>
            <h3>How the call is made</h3>
            <p className="notes-rule">
              <code>soil_cover</code> decides bare or covered. No observation stays unknown, never bare.
            </p>
          </section>

          <section>
            <h3>Bare days on this field</h3>
            <p>
              <strong>{data.bareDays} days</strong> expected in a given year
              {phases ? ` — ${phases}.` : '.'}
            </p>
            {phases && (
              <p className="notes-rule">The wheel&apos;s average is a curve no real year followed.</p>
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
              Ranked by <strong>evidence first</strong>. Modelled curves share one generic plateau, so treat
              them as an upper bound.
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
            <h3>Data sources</h3>
            <ul className="source-lines">
              {sourceLines(data.sources).map((s, i) => (
                <li key={i} data-nasa={s.nasa ? 'yes' : 'no'}>
                  <strong>{s.name}</strong>
                  <span>{s.gives}</span>
                  {s.count && <em>{s.count}</em>}
                </li>
              ))}
            </ul>
            <small>{data.years.length ? `${data.years[0]}\u2013${data.years[data.years.length - 1]}` : 'years unspecified'} \u00b7 full method in the README</small>
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
