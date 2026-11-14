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

/** Wheel events arrive in bursts; one page per gesture, not per tick. */
const WHEEL_COOLDOWN_MS = 620
const SWIPE_THRESHOLD_PX = 56

/**
 * Walk up from the wheel's target looking for something that can still
 * scroll in the direction the user is pushing.
 *
 * Without this, scrolling the seed-packet rail pages the whole deck to the
 * next act — the rail swallows nothing, the event bubbles, and the user
 * loses their place while trying to read a list.
 */
function consumesWheel(target: EventTarget | null, deltaY: number, stop: HTMLElement | null): boolean {
  let el = target instanceof HTMLElement ? target : null
  while (el && el !== stop) {
    const overflow = getComputedStyle(el).overflowY
    if (overflow === 'auto' || overflow === 'scroll') {
      const slack = el.scrollHeight - el.clientHeight
      if (slack > 1) {
        const atTop = el.scrollTop <= 0
        const atBottom = el.scrollTop >= slack - 1
        if ((deltaY > 0 && !atBottom) || (deltaY < 0 && !atTop)) return true
      }
    }
    el = el.parentElement
  }
  return false
}

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
  const lastWheel = useRef(0)
  const touchX = useRef<number | null>(null)
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
    <div className="deck" ref={deck}>
      <div
        className="deck-track"
        style={{ transform: `translate3d(-${index * 100}%, 0, 0)` }}
        data-reduced={reducedMotion ? 'on' : 'off'}
        onWheel={(e) => {
          // Horizontal intent, or a decisive vertical flick, pages the deck.
          const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
          if (Math.abs(delta) < 14) return
          // A list the user is still scrolling keeps the gesture.
          if (consumesWheel(e.target, e.deltaY, deck.current)) return
          const now = Date.now()
          if (now - lastWheel.current < WHEEL_COOLDOWN_MS) return
          lastWheel.current = now
          go(index + (delta > 0 ? 1 : -1))
        }}
        onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null }}
        onTouchEnd={(e) => {
          if (touchX.current == null) return
          const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current
          touchX.current = null
          if (Math.abs(dx) > SWIPE_THRESHOLD_PX) go(index + (dx < 0 ? 1 : -1))
        }}
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
        <button
          type="button"
          className="deck-arrow"
          onClick={() => go(index + 1)}
          disabled={index === slides.length - 1}
          aria-label="Next act"
        >
          ›
        </button>
      </nav>

      {index < slides.length - 1 && (
        <button type="button" className="deck-next" onClick={() => go(index + 1)}>
          <span className="deck-next-label">
            <small>Next</small>
            {slides[index + 1].label}
          </span>
          <span className="deck-next-chev" aria-hidden="true">›</span>
        </button>
      )}
    </div>
  )
}
