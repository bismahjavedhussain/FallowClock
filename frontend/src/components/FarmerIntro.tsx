/**
 * The walk-in: the farmer arrives, waves, and sets out the problem.
 *
 * Runs after the satellite descent and before the deck. Click (or press
 * Space / Enter / arrow) to advance; a click mid-sentence completes the
 * line instead of skipping it, which is the behaviour anyone who has used
 * a dialogue box expects.
 *
 * There is NO SKIP, by decision: the brief is the argument, and a judge who
 * jumps straight to the wheel sees an instrument without the problem it
 * solves. Progress is forward-only but always one click away, and a
 * reduced-motion visitor gets the whole brief at once instead of typed.
 *
 * SPRITES: the pack has two poses, Idle and a raised-arm pose, eight
 * directions each. That is a real wave facing the viewer, and alternating
 * the two east-facing frames gives a two-frame walk cycle. There is no
 * writing pose, so Act 2's note-taking uses the raised arm beside the
 * notebook rather than pretending to animated handwriting we do not have.
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import type { IntroBeat } from '../lib/intro'
import type { FieldMode } from './seasonal/ParallaxField'

const ParallaxField = lazy(() => import('./seasonal/ParallaxField'))

/**
 * The weather follows what he is saying.
 *
 * Keyed off the beat id rather than a timer so the picture and the words
 * can never drift: the moment he says the rain lands on bare ground, it
 * starts raining behind him.
 */
const WEATHER: Record<string, { mode: FieldMode; intensity: number }> = {
  hello: { mode: 'calm', intensity: 0.25 },
  bare: { mode: 'dust', intensity: 0.5 },
  when: { mode: 'dust', intensity: 0.7 },
  rain: { mode: 'rain', intensity: 0.95 },
  problem: { mode: 'dust', intensity: 0.4 },
  mine: { mode: 'calm', intensity: 0.3 },
  ask: { mode: 'calm', intensity: 0.35 },
}
import { playCarriageReturn, playTypeKey } from '../lib/sound'
import { cancelSpeech, speak } from '../lib/speech'
import { useStore } from '../store'

/** Milliseconds per character. ~32 is brisk but still readable as typing. */
const CHAR_MS = 26
/** A key sound every Nth character: one per letter is a buzzsaw. */
const KEY_EVERY = 3

type Stage = 'walking' | 'waving' | 'talking'

export default function FarmerIntro({
  farmId,
  beats,
  onDone,
  reducedMotion = false,
  active = true,
}: {
  /** Which field's satellite chip the stage stands on. */
  farmId: string
  beats: IntroBeat[]
  onDone: () => void
  reducedMotion?: boolean
  /**
   * False while the satellite descent is still on top.
   *
   * This component mounts UNDER the descent rather than after it. Mounting
   * it afterwards left a gap: the satellite faded out over 700ms, and for
   * those frames the deck behind showed through -- the crisis act flashing
   * up for a split second before the farmer appeared. Now the farmer is
   * already there and the descent simply uncovers him.
   */
  active?: boolean
}) {
  const [stage, setStage] = useState<Stage>(reducedMotion ? 'talking' : 'walking')
  const [beat, setBeat] = useState(0)
  const [shown, setShown] = useState(reducedMotion ? Infinity : 0)
  const [step, setStep] = useState(false)
  const timers = useRef<number[]>([])
  const typeTimer = useRef(0)
  const soundOn = useStore((s) => s.soundEnabled)

  const text = beats[beat]?.text ?? ''
  const done = shown >= text.length
  const last = beat >= beats.length - 1

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }

  // Walk in, then wave, then start talking.
  useEffect(() => {
    if (reducedMotion || !active) return
    const t = timers.current
    t.push(window.setTimeout(() => setStage('waving'), 2400))
    t.push(window.setTimeout(() => setStage('talking'), 3800))
    return clearTimers
  }, [reducedMotion, active])

  // The two-frame walk cycle: swap poses while the stride is running.
  useEffect(() => {
    if (stage !== 'walking' || reducedMotion || !active) return
    const id = window.setInterval(() => setStep((s) => !s), 230)
    return () => window.clearInterval(id)
  }, [stage, reducedMotion])

  // Type the current line out.
  //
  // The interval id lives in a ref because the SKIP has to be able to stop
  // it. Previously the closure owned a local `i` and kept calling
  // setShown(i) on its own schedule, so setting shown to the full length
  // was overwritten on the very next tick -- "click to skip typing" looked
  // like it did nothing at all.
  useEffect(() => {
    if (stage !== 'talking' || reducedMotion || !active) return
    setShown(0)
    let i = 0
    typeTimer.current = window.setInterval(() => {
      i += 1
      setShown(i)
      if (i % KEY_EVERY === 0) playTypeKey()
      if (i >= text.length) {
        window.clearInterval(typeTimer.current)
        typeTimer.current = 0
        playCarriageReturn()
      }
    }, CHAR_MS)
    return () => {
      window.clearInterval(typeTimer.current)
      typeTimer.current = 0
    }
  }, [stage, beat, text, reducedMotion, active])

  // Read the line aloud too, when sound is on.
  useEffect(() => {
    if (stage !== 'talking' || !soundOn || !text || !active) return
    speak(text, { rate: 0.98, volume: 0.85 })
    return cancelSpeech
  }, [stage, beat, text, soundOn, active])

  /** Stop typing and show the whole line at once. */
  const finishLine = useCallback(() => {
    if (typeTimer.current) {
      window.clearInterval(typeTimer.current)
      typeTimer.current = 0
      playCarriageReturn()
    }
    setShown(text.length)
  }, [text.length])

  const advance = useCallback(() => {
    if (stage !== 'talking') {
      // Impatient click during the walk-in: get straight to the words.
      clearTimers()
      setStage('talking')
      return
    }
    if (!done) {
      // First click completes the sentence. The voice keeps reading -- it
      // is narration, not a subtitle, and cutting it off mid-word to show
      // text the user can already read would be worse.
      finishLine()
      return
    }
    cancelSpeech()
    if (last) onDone()
    else setBeat((b) => b + 1)
  }, [stage, done, last, finishLine, onDone])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, onDone])

  useEffect(() => cancelSpeech, [])

  const weather = WEATHER[beats[beat]?.id ?? ''] ?? { mode: 'calm' as FieldMode, intensity: 0.3 }

  const pose = stage === 'waving' ? 'wave' : stage === 'walking' && step ? 'wave' : 'idle'
  const facing = stage === 'walking' ? 'east' : 'south'
  const dir = pose === 'wave' ? 'farmer-wave' : 'farmer'

  return (
    <div
      className={`farmer-intro stage-${stage}`}
      onClick={advance}
      role="button"
      tabIndex={0}
      aria-label="Introduction. Click or press Space to continue."
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') e.preventDefault()
      }}
    >
      <Suspense fallback={<div className="intro-fallback" aria-hidden="true" />}>
        <ParallaxField
          farmId={farmId}
          act={0}
          mode={weather.mode}
          intensity={weather.intensity}
          reducedMotion={reducedMotion}
        />
      </Suspense>

      <div className="intro-actor">
        <img
          src={`/sprite/${dir}/${facing}.png`}
          width={64}
          height={64}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <span className="intro-shadow" aria-hidden="true" />
      </div>

      {stage === 'talking' && (
        <div className="intro-dialogue">
          <p aria-live="polite">
            {reducedMotion ? text : text.slice(0, shown)}
            {!done && <span className="intro-caret" aria-hidden="true" />}
          </p>
          <div className="intro-dialogue-foot">
            <ol className="intro-pips" aria-hidden="true">
              {beats.map((b, i) => (
                <li key={b.id} className={i === beat ? 'is-on' : i < beat ? 'is-done' : ''} />
              ))}
            </ol>
            <span className="intro-cue">{done ? (last ? 'Click to begin ›' : 'Click to continue ›') : 'Click to skip typing'}</span>
          </div>
        </div>
      )}

    </div>
  )
}
