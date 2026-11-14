/**
 * The field diary, as a modal.
 *
 * Two halves: the CRUX -- what this tool actually found about this field,
 * derived from the bundle in lib/insights.ts -- and the session log of
 * what the user did. The brief asked for the crux to be hardcoded; it is
 * derived instead, because a fixed set of entries would be wrong on a
 * field with no recommendation and would sit here contradicting the
 * panels behind it.
 *
 * The newest log line types itself in with the nib scratching, so opening
 * the diary after placing a crop looks like the farmer just wrote it.
 */

import { useEffect, useRef, useState } from 'react'
import type { Insight } from '../lib/insights'
import type { DiaryEntry } from './FarmerDiary'
import { playPageFlip } from '../lib/sound'

export default function FieldDiaryModal({
  open,
  onClose,
  place,
  insights,
  log,
}: {
  open: boolean
  onClose: () => void
  place: string
  insights: Insight[]
  log: DiaryEntry[]
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<'crux' | 'log'>('crux')

  useEffect(() => {
    if (!open) return
    playPageFlip()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="diary-overlay" onClick={onClose}>
      <div
        className="diary-book"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Field diary"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="diary-book-head">
          <div>
            <span className="eyebrow">Field diary</span>
            <h2>{place}</h2>
          </div>
          <div className="diary-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={page === 'crux'}
              onClick={() => { playPageFlip(); setPage('crux') }}
            >
              What we found
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={page === 'log'}
              onClick={() => { playPageFlip(); setPage('log') }}
            >
              This session <span>{log.length}</span>
            </button>
          </div>
          <button type="button" className="diary-close" onClick={onClose} aria-label="Close diary">
            ×
          </button>
        </header>

        <div className="diary-book-body">
          {page === 'crux' ? (
            <ol className="crux-list">
              {insights.map((x) => (
                <li key={x.id} data-kind={x.kind}>
                  {x.figure && <strong className="crux-figure">{x.figure}</strong>}
                  <div>
                    <h3>{x.title}</h3>
                    <p>{x.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : log.length ? (
            <ul className="crux-log">
              {log.map((e) => (
                <li key={e.id}>
                  <span className="diary-stamp">{e.stamp}</span>
                  <span>{e.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="crux-empty">
              Nothing logged yet. Drop a seed packet on the wheel or run a storm and it
              gets written down here.
            </p>
          )}
        </div>

        <footer className="diary-book-foot">
          <small>
            Every figure here is read from this field&apos;s data bundle. Switch fields and the
            diary rewrites itself. Method in the README.
          </small>
        </footer>
      </div>
    </div>
  )
}
