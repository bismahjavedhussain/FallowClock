/**
 * Zero-scroll, full-screen act pagination.
 *
 * All slides stay MOUNTED in a horizontal track and the track translates.
 * Conditionally rendering one slide at a time would be cheaper, but it would
 * throw away the ring's memoised arc geometry on every move, restart the
 * cutaway's root reveal, and drop an in-flight drag — so the track wins.
 *
 * ACCESSIBILITY, because `overflow: hidden` on a page is a trap:
 *  - every slide is a labelled region and stays in the tab order
 *  - focus moving into an off-screen slide pages the deck to it
 *  - arrows, Home/End, PageUp/PageDown, wheel and swipe all work
 *  - below the mobile breakpoint the deck becomes an ordinary scrolling
 *    column, because a locked viewport on a phone is hostile and the
 *    content does not fit anyway
 */

import { useCallback, useEffect, useRef } from 'react'
import { playSwitch } from '../lib/sound'

export interface Slide {
  id: string
  label: string
  eyebrow: string
}

/**
 * NOTHING SCROLLS BETWEEN ACTS.
 *
 * The deck used to page on a wheel gesture, deferring to any scrollable
 * child until that child hit its limit. Reading the seed-packet rail to
 * the bottom then threw you into the next act, which is the opposite of
 * what scrolling a list should do. Acts change only on a deliberate
 * control: the Next button, the arrows, the dots, or the keyboard.
 */

export default function SlideDeck({
  slides,
  index,
  onIndex,
  reducedMotion = false,
  children,
}: {
  slides: Slide[]
  index: number
  onIndex: (i: number) => void
  reducedMotion?: boolean
  children: React.ReactNode[]
}) {
  const deck = useRef<HTMLDivElement>(null)

  const go = useCallback(
    (next: number, quiet = false) => {
      const clamped = Math.max(0, Math.min(slides.length - 1, next))
      if (clamped === index) return
      if (!quiet) playSwitch()
      onIndex(clamped)
    },
    [index, slides.length, onIndex],
  )

  // Keyboard. Ignored while the user is typing or using a slider, so the
  // time lever's own arrow handling still works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(index + 1) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(index - 1) }
      else if (e.key === 'Home') { e.preventDefault(); go(0) }
      else if (e.key === 'End') { e.preventDefault(); go(slides.length - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, index, slides.length])

  // Touch swipe support across acts for mobile and tablet touch devices
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (
      target?.closest('canvas') ||
      target?.closest('input') ||
      target?.closest('button') ||
      target?.closest('.year-ring-stage-3d') ||
      target?.closest('.time-lever') ||
      target?.closest('.seed-packet') ||
      target?.closest('[draggable="true"]')
    ) {
      touchStartX.current = null
      touchStartY.current = null
      return
    }
    if (e.touches.length === 1) {
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
    }
  }

  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current == null || touchStartY.current == null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null

    // If swipe is primarily horizontal and reaches threshold, navigate
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) go(index + 1)
      else go(index - 1)
    }
  }

  // A slide the user tabs into must be the slide they can see.
  useEffect(() => {
    const node = deck.current
    if (!node) return
    const onFocus = (e: FocusEvent) => {
      const slide = (e.target as HTMLElement).closest<HTMLElement>('[data-slide-index]')
      if (!slide) return
      const i = Number(slide.dataset.slideIndex)
      if (!Number.isNaN(i) && i !== index) go(i, true)
    }
    node.addEventListener('focusin', onFocus)
    return () => node.removeEventListener('focusin', onFocus)
  }, [go, index])

  return (
    <div className="deck" ref={deck} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div
        className="deck-track"
        style={{ transform: `translate3d(-${index * 100}%, 0, 0)` }}
        data-reduced={reducedMotion ? 'on' : 'off'}
      >
        {slides.map((s, i) => (
          <section
            key={s.id}
            className="deck-slide"
            data-slide-index={i}
            id={s.id}
            aria-label={`${s.eyebrow}: ${s.label}`}
            aria-hidden={i !== index ? 'true' : undefined}
            // inert would be ideal but React 18 does not type it; aria-hidden
            // plus the focus handler above covers the same ground.
          >
            {children[i]}
          </section>
        ))}
      </div>

      <nav className="deck-nav" aria-label="Acts">
        <button
          type="button"
          className="deck-arrow"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label="Previous act"
        >
          ‹
        </button>
        <ol>
          {slides.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === index ? 'step' : undefined}
                className={i === index ? 'is-on' : i < index ? 'is-done' : ''}
              >
                <span className="deck-dot" aria-hidden="true" />
                <span className="deck-name">{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
        {index < slides.length - 1 ? (
          <button type="button" className="deck-next" onClick={() => go(index + 1)}>
            <span className="deck-next-label">
              <small>Next</small>
              {slides[index + 1].label}
            </span>
            <span className="deck-next-chev" aria-hidden="true">›</span>
          </button>
        ) : (
          <button type="button" className="deck-arrow" disabled aria-label="Next act">
            ›
          </button>
        )}
      </nav>
    </div>
  )
}
