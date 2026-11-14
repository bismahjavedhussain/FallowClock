/**
 * The soil-cover key, on demand.
 *
 * It used to sit permanently under the dial taking space from the thing
 * it explains. Now it is one friendly button away, which also means the
 * copy can be warmer than a legend usually gets.
 */

import { useEffect, useRef } from 'react'
import RingLegend from './RingLegend'

export default function LegendFlyout({
  open,
  onOpen,
  onClose,
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <button type="button" className="dial-pill legend-ask" onClick={onOpen} aria-haspopup="dialog">
        <span aria-hidden="true">?</span>
        How to read the dial
      </button>

      {open && (
        <div className="legend-flyout" ref={panel} tabIndex={-1} role="dialog" aria-label="How to read the dial">
          <button type="button" className="legend-close" onClick={onClose} aria-label="Close the key">
            ×
          </button>
          <RingLegend compact showDetails />
        </div>
      )}
    </>
  )
}
