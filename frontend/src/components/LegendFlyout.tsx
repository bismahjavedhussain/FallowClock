/**
 * The soil-cover key, on demand.
 *
 * It used to sit permanently under the wheel taking space from the thing
 * it explains. Now it is one friendly button away, which also means the
 * copy can be warmer than a legend usually gets.
 *
 * THE PANEL IS PORTALLED, and that is not optional. `position: fixed`
 * normally resolves against the viewport, but ANY ancestor carrying a
 * transform, filter or will-change becomes the containing block instead --
 * and .deck-track has both `transform: translate3d(...)` and
 * `will-change: transform`, because the four acts are one horizontal strip
 * that slides. So the panel was being positioned against the strip and
 * then clipped by `.act-pane { overflow: hidden }`, which cut its top off
 * -- the close button included -- and left the rest scrollable inside a
 * box whose real height nothing agreed on. A portal to document.body puts
 * it back on the viewport, where its `bottom` and `100dvh` already assume
 * it is. The trigger button stays behind in the dial frame.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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
        How to read the wheel
      </button>

      {open && createPortal(
        <>
          <div className="legend-backdrop" onClick={onClose} aria-hidden="true" />
          <div className="legend-flyout" ref={panel} tabIndex={-1} role="dialog" aria-label="How to read the wheel">
            <button type="button" className="legend-close" onClick={onClose} aria-label="Close the key">
              ×
            </button>
            <RingLegend compact showDetails />
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
