/**
 * The farmer who talks you through the year.
 *
 * Uses the 8-direction pixel sprite in public/sprite/farmer. The asset is a
 * single idle frame per compass direction -- no animation frames -- so the
 * life comes from two places instead:
 *
 *   1. He TURNS TO FACE THE POINTER. Eight rotations is exactly enough to
 *      track a cursor, and a companion whose head follows what you are doing
 *      reads as alive in a way a static portrait never does. This is the
 *      whole reason to use the directional set rather than just south.png.
 *   2. A slow CSS bob, dropped entirely under prefers-reduced-motion.
 *
 * Everything he SAYS comes from lib/guide.ts, which derives each line from
 * the bundle. This component only decides how he looks and where he points.
 */

import { useEffect, useRef, useState } from 'react'
import type { GuideLine } from '../lib/guide'

/**
 * Ordered to match atan2: index 0 is due east and each step is +45 degrees
 * clockwise on screen (y grows downward, so positive angles head south).
 */
const DIRECTIONS = [
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
] as const

type Direction = (typeof DIRECTIONS)[number]

/** Back to facing the viewer once the pointer has been still this long. */
const SETTLE_MS = 2600

export default function FarmerGuide({
  line,
  reducedMotion,
  onDismiss,
  muted = false,
  walkTo = null,
  writing = false,
}: {
  line: GuideLine
  reducedMotion: boolean
  onDismiss?: () => void
  /** Hide the bubble when something else is doing the talking. */
  muted?: boolean
  /**
   * Walk across to a position, 0-1 of the viewport width.
   *
   * HONEST LIMIT: the sprite pack is one IDLE frame per direction with no
   * walk cycle, so this is a translate with a step-bob and the side-facing
   * sprite, not animated legs. At this size it reads as walking; claiming
   * a true walk cycle would be claiming art we do not have.
   */
  walkTo?: number | null
  /**
   * Pen in hand while a diary entry is being written.
   *
   * There is now a real writing pose -- pencil down on an open notebook --
   * so this is no longer the raised arm standing in for one. It is still a
   * single still per direction rather than a frame cycle, so the hand
   * motion comes from a small CSS bob over a sprite that is genuinely
   * holding a pencil.
   */
  writing?: boolean
}) {
  const [visible, setVisible] = useState(true)
  const [pulse, setPulse] = useState(0)
  const [facing, setFacing] = useState<Direction>('south')
  const [walking, setWalking] = useState(false)
  const spriteRef = useRef<HTMLButtonElement>(null)
  const lastKey = useRef(line.key)
  const frame = useRef(0)
  const settle = useRef(0)

  // Re-run the bubble animation only when the LINE changes, not on every
  // parent render -- otherwise scrubbing the year makes it flicker.
  useEffect(() => {
    if (lastKey.current === line.key) return
    lastKey.current = line.key
    setVisible(true)
    setPulse((n) => n + 1)
  }, [line.key])

  // Warm all eight rotations up front. They are ~2 KB each and swap on
  // pointer move; a lazy fetch mid-turn would show a one-frame gap.
  useEffect(() => {
    for (const d of DIRECTIONS) {
      const img = new Image()
      img.src = `/sprite/farmer/${d}.png`
    }
    // The writing pose swaps in the instant a diary entry starts, so it
    // cannot wait on a fetch.
    const pen = new Image()
    pen.src = '/sprite/farmer-write/south-east.png'
  }, [])

  useEffect(() => {
    if (walkTo == null) {
      setWalking(false)
      return
    }
    setWalking(true)
    setFacing('east')
    const t = window.setTimeout(() => {
      setWalking(false)
      setFacing('south')
    }, 2200)
    return () => window.clearTimeout(t)
  }, [walkTo])

  useEffect(() => {
    if (walking) return
    const onMove = (e: PointerEvent) => {
      // Pointer events fire far faster than the sprite can meaningfully
      // change, so coalesce to one read per frame and only touch state when
      // the direction actually differs.
      if (frame.current) return
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0
        const el = spriteRef.current
        if (!el) return
        const box = el.getBoundingClientRect()
        const dx = e.clientX - (box.left + box.width / 2)
        const dy = e.clientY - (box.top + box.height / 2)
        if (Math.hypot(dx, dy) < 48) return // too close to have a direction
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI
        const next = DIRECTIONS[(((Math.round(deg / 45) % 8) + 8) % 8)]
        setFacing((prev) => (prev === next ? prev : next))
      })
      window.clearTimeout(settle.current)
      settle.current = window.setTimeout(() => setFacing('south'), SETTLE_MS)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (frame.current) window.cancelAnimationFrame(frame.current)
      window.clearTimeout(settle.current)
    }
  }, [walking])

  return (
    <div
      className={`farmer-guide ${reducedMotion ? 'is-still' : ''} ${walking ? 'is-walking' : ''} ${walkTo != null ? 'is-placed' : ''} ${writing ? 'is-writing' : ''}`}
      data-tone={line.tone}
      style={walkTo != null ? ({ ['--walk-x' as string]: `${(walkTo * 100).toFixed(1)}vw` }) : undefined}
    >
      {visible && !muted && (
        <div className="farmer-bubble" key={pulse} role="status" aria-live="polite">
          <p>{line.text}</p>
          <button
            type="button"
            className="farmer-bubble-close"
            onClick={() => {
              setVisible(false)
              onDismiss?.()
            }}
            aria-label="Dismiss this tip"
          >
            ×
          </button>
        </div>
      )}

      <button
        ref={spriteRef}
        type="button"
        className="farmer-sprite"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide the guide' : `Show the guide. Last tip: ${line.text}`}
        aria-expanded={visible}
      >
        <span className="farmer-shadow" aria-hidden="true" />
        <img
          src={`/sprite/${writing ? 'farmer-write' : 'farmer'}/${writing ? 'south-east' : facing}.png`}
          width={64}
          height={64}
          alt=""
          aria-hidden="true"
          draggable={false}
          /* All eight are tiny and swap on pointer move; letting the browser
             fetch one lazily mid-turn would show a gap. */
          loading="eager"
          decoding="sync"
        />
      </button>
    </div>
  )
}
