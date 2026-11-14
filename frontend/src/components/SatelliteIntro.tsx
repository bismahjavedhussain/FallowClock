/**
 * The opening shot: a real Sentinel-2 scene that zooms onto this field.
 *
 * The image is a committed asset fetched by scripts/fetch_field_image.py,
 * not a map tile pulled at runtime — the demo has to survive airplane mode,
 * and anything fetched while a judge is watching can fail while a judge is
 * watching. The sidecar JSON carries where the field sits inside the chip,
 * so the zoom lands on the right quarter-section instead of assuming centre.
 *
 * HONEST LIMIT: Sentinel-2 is ~10 m per pixel, so this field is about 70
 * pixels across. The zoom therefore establishes where we are and hands off
 * to the ring; it does not pretend to dive to ground truth on imagery that
 * has none. The narration still states the resolution aloud, so the claim
 * is made somewhere even though the on-screen caption was cut.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { introNarrationParts } from '../lib/acts'

import { cancelSpeech, speakScript } from '../lib/speech'

export interface FieldChip {
  date: string
  cloud_cover: number
  resolution_m: number
  field: { x0: number; x1: number; y0: number; y1: number }
  credit: string
}

/** How much of the viewport the field should fill once the zoom lands. */
const TARGET_FRACTION = 0.42

export default function SatelliteIntro({
  farmId,
  place,
  areaHa,
  rotationLabel,
  bareDays,
  onDone,
  reducedMotion = false,
}: {
  farmId: string
  place: string
  areaHa: number
  rotationLabel: string
  bareDays: number
  onDone: () => void
  reducedMotion?: boolean
}) {
  const [chip, setChip] = useState<FieldChip | null>(null)
  // No gate: the descent begins as soon as the imagery is ready.
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState<'wide' | 'zoom' | 'gone'>('wide')
  const timers = useRef<number[]>([])
  const handedOff = useRef(false)

  /**
   * TESTING AFFORDANCE — click anywhere to skip the descent.
   *
   * Added on request so the opening does not have to be sat through on
   * every reload while the rest of the app is being worked on. There is
   * deliberately no visible control, because the intro is meant to be
   * unavoidable for a judge.
   *
   * REMOVE BEFORE SUBMISSION: delete this callback and the onClick on the
   * root element below. Nothing else depends on it.
   */
  const skip = useCallback(() => {
    if (handedOff.current) return
    handedOff.current = true
    cancelSpeech()
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
    setPhase('gone')
    window.setTimeout(onDone, 420)
  }, [onDone])

  useEffect(() => {
    let cancelled = false
    fetch(`/scene/field-${farmId}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setChip(d))
      // No chip, no intro. The page behind is already rendered.
      .catch(() => !cancelled && onDone())
    return () => {
      cancelled = true
    }
  }, [farmId, onDone])

  // Decode the chip before starting. Zooming a frame that has not painted
  // yet shows a black rectangle for the first second of the film.
  useEffect(() => {
    if (!chip) return
    let cancelled = false
    const img = new Image()
    img.src = `/scene/field-${farmId}.webp`
    const go = () => !cancelled && setReady(true)
    img.decode().then(go).catch(go)
    return () => {
      cancelled = true
    }
  }, [chip, farmId])

  useEffect(() => {
    if (!chip || !ready) return
    if (reducedMotion) {
      onDone()
      return
    }
    const t = timers.current
    const handOff = () => {
      if (handedOff.current) return
      handedOff.current = true
      setPhase('gone')
      t.push(window.setTimeout(onDone, 700))
    }

    // No descent sweep here on purpose: the brief is narration only, and
    // anything else under a voiceover competes with the one line that has
    // to land.
    t.push(window.setTimeout(() => setPhase('zoom'), 450))
    t.push(
      window.setTimeout(() => {
        speakScript(
          introNarrationParts({
            place,
            areaHa,
            rotationLabel,
            sceneDate: chip.date,
            resolutionM: chip.resolution_m,
            bareDays,
          }),
          // The visuals follow the voice rather than a guessed duration,
          // so a slower platform voice simply gets a slower descent.
          { rate: 1.02, volume: 0.95, onEnd: handOff },
        )
      }, 900),
    )
    // Safety net: if the engine never reports the end -- muted tab, a
    // voice that drops onend, autoplay refusal -- the film still moves on.
    t.push(window.setTimeout(handOff, 26000))
    return () => {
      t.forEach((id) => window.clearTimeout(id))
      timers.current = []
      cancelSpeech()
    }
  }, [chip, ready, reducedMotion, onDone, place, areaHa, rotationLabel, bareDays])

  if (!chip || reducedMotion) return null

  const { x0, x1, y0, y1 } = chip.field
  const cx = ((x0 + x1) / 2) * 100
  const cy = ((y0 + y1) / 2) * 100
  // Scale so the field occupies TARGET_FRACTION of the frame, clamped so a
  // tiny field does not magnify into a block of four pixels.
  const span = Math.max(x1 - x0, y1 - y0, 0.01)
  const scale = Math.min(9, Math.max(3, TARGET_FRACTION / span))

  return (
    <div
      className={`sat-intro phase-${phase}`}
      role="presentation"
      /* TESTING: click anywhere to skip. Remove with the `skip` callback. */
      onClick={skip}
    >
      <div
        className="sat-frame"
        style={{
          backgroundImage: `url('/scene/field-${farmId}.webp')`,
          transformOrigin: `${cx}% ${cy}%`,
          ['--sat-scale' as string]: String(scale),
        }}
      />
      <div className="sat-reticle" style={{ left: `${cx}%`, top: `${cy}%` }} aria-hidden="true">
        <span />
      </div>

      <div className="sat-caption">
        <span className="eyebrow">Sentinel-2 · {chip.date}</span>
        <h2>{place}</h2>
        <small>{chip.credit}</small>
      </div>

      {!ready && (
        <div className="sat-loading" role="status" aria-live="polite">
          <span className="sat-spinner" aria-hidden="true" />
          <p>Acquiring scene&hellip;</p>
        </div>
      )}

    </div>
  )
}
