/**
 * Interaction sound manager.
 *
 * Every sound here is SYNTHESISED with the Web Audio API rather than loaded
 * from a file. Two reasons:
 *
 *  1. The repo already carries ~6.5 MB of ambience audio. Interaction sounds
 *     fire constantly and must be instant; a network fetch on first scrub
 *     would land late and feel broken.
 *  2. An oscillator costs nothing to ship and can be tuned in code.
 *
 * Ambience (wind, leaves, music) stays in AudioAtmosphere, which streams real
 * recordings. This file is only the short tactile stuff.
 *
 * AUTOPLAY: browsers refuse to start an AudioContext outside a user gesture,
 * so the context is created lazily on the first enable() call -- which is
 * always a click -- and resumed defensively before every sound.
 */

type Ctx = AudioContext & { _fallowMaster?: GainNode }

let ctx: Ctx | null = null
let master: GainNode | null = null
let enabled = true
let lastTickAt = 0

/** Scrubbing a 365-step range fires far more events than ears can resolve. */
const TICK_THROTTLE_MS = 55

function context(): Ctx | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Impl: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Impl) return null
    try {
      ctx = new Impl() as Ctx
      master = ctx.createGain()
      master.gain.value = 0.9
      master.connect(ctx.destination)
    } catch {
      return null // no audio device, private mode, etc. Never throw at a caller.
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}

export function isSoundEnabled(): boolean {
  return enabled
}

let primed = false

/**
 * Unblock audio on the first user gesture of the session.
 *
 * An AudioContext created before any interaction starts suspended and
 * stays that way, so every sound is silently discarded. There is no way
 * around that from script -- it is the autoplay policy, not a bug -- but
 * we can resume the moment the user touches anything, so the FIRST click
 * anywhere makes everything after it audible.
 */
export function primeOnFirstGesture(): void {
  if (primed || typeof window === 'undefined') return
  primed = true
  const wake = () => {
    context()
    window.removeEventListener('pointerdown', wake)
    window.removeEventListener('keydown', wake)
    window.removeEventListener('touchstart', wake)
    window.removeEventListener('click', wake)
  }
  window.addEventListener('pointerdown', wake, { once: true, passive: true })
  window.addEventListener('keydown', wake, { once: true })
  window.addEventListener('touchstart', wake, { once: true, passive: true })
  window.addEventListener('click', wake, { once: true })
}

if (typeof window !== 'undefined') {
  primeOnFirstGesture()
}

/** Call from a click handler. Returns whether audio is actually usable. */
export function setSoundEnabled(next: boolean): boolean {
  enabled = next
  if (!next) return false
  return context() !== null
}

/**
 * One shaped tone. `type`, frequency sweep and envelope are all the voice
 * we need -- no samples, no impulse responses.
 */
function tone(
  freq: number,
  {
    type = 'sine',
    duration = 0.18,
    gain = 0.2,
    sweepTo,
    delay = 0,
    attack = 0.005,
  }: {
    type?: OscillatorType
    duration?: number
    gain?: number
    sweepTo?: number
    delay?: number
    attack?: number
  } = {},
): void {
  const ac = context()
  if (!ac || !master) return
  const t0 = ac.currentTime + delay
  const osc = ac.createOscillator()
  const env = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + duration)
  // Ramp both edges: a gain that jumps straight to a value clicks audibly.
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(gain, t0 + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(env)
  env.connect(master)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

/** Filtered white noise -- the grain in a thud, the rustle in leaves. */
function noise({
  duration = 0.12,
  gain = 0.12,
  cutoff = 1400,
  type = 'lowpass',
  delay = 0,
}: {
  duration?: number
  gain?: number
  cutoff?: number
  type?: BiquadFilterType
  delay?: number
} = {}): void {
  const ac = context()
  if (!ac || !master) return
  const t0 = ac.currentTime + delay
  const frames = Math.max(1, Math.floor(ac.sampleRate * duration))
  const buffer = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    // Fade the tail inside the buffer so the filter never cuts off hard.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
  }
  const src = ac.createBufferSource()
  src.buffer = buffer
  const filter = ac.createBiquadFilter()
  filter.type = type
  filter.frequency.value = cutoff
  const env = ac.createGain()
  env.gain.setValueAtTime(gain, t0)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  src.connect(filter)
  filter.connect(env)
  env.connect(master)
  src.start(t0)
  src.stop(t0 + duration + 0.02)
}

/** Timeline scrub: a soft mechanical escapement click. Throttled. */
export function playTick(): void {
  if (!enabled) return
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - lastTickAt < TICK_THROTTLE_MS) return
  lastTickAt = now
  tone(1180, { type: 'triangle', duration: 0.035, gain: 0.055, sweepTo: 820 })
  noise({ duration: 0.022, gain: 0.03, cutoff: 3200, type: 'highpass' })
}

/** Crossing into a new season while scrubbing. A touch warmer than a tick. */
export function playSeasonTick(): void {
  if (!enabled) return
  tone(560, { type: 'sine', duration: 0.16, gain: 0.07, sweepTo: 760 })
}

/** Picking up a seed packet. Light, dry, paper-ish. */
export function playPick(): void {
  if (!enabled) return
  tone(720, { type: 'triangle', duration: 0.07, gain: 0.07, sweepTo: 940 })
  noise({ duration: 0.05, gain: 0.035, cutoff: 2600, type: 'highpass' })
}

/** Seed hitting soil: a low earthy thud with a rustle of leaves over it. */
export function playSeedDrop(): void {
  if (!enabled) return
  tone(104, { type: 'sine', duration: 0.26, gain: 0.26, sweepTo: 46 })
  noise({ duration: 0.2, gain: 0.1, cutoff: 900 })
  noise({ duration: 0.3, gain: 0.05, cutoff: 5200, type: 'highpass', delay: 0.03 })
}

/** A gap closed. Two notes a fifth apart, which reads as resolution. */
export function playChime(): void {
  if (!enabled) return
  tone(659.25, { type: 'sine', duration: 0.5, gain: 0.14, attack: 0.012 }) // E5
  tone(987.77, { type: 'sine', duration: 0.62, gain: 0.1, delay: 0.1, attack: 0.012 }) // B5
  tone(1318.5, { type: 'sine', duration: 0.5, gain: 0.05, delay: 0.19, attack: 0.012 }) // E6
}

/** Mode switch, drawer, farm change. Neutral and quick. */
export function playSwitch(): void {
  if (!enabled) return
  tone(480, { type: 'triangle', duration: 0.09, gain: 0.08, sweepTo: 640 })
}

/** A placement the model rejects. Dull, not harsh -- it is information. */
export function playDeny(): void {
  if (!enabled) return
  tone(168, { type: 'sine', duration: 0.17, gain: 0.13, sweepTo: 132 })
  noise({ duration: 0.1, gain: 0.04, cutoff: 600 })
}

/** Removing a proposal: the seed drop, reversed in spirit. */
export function playLift(): void {
  if (!enabled) return
  tone(300, { type: 'sine', duration: 0.14, gain: 0.1, sweepTo: 520 })
}

/**
 * Pen nib on paper. Several short noise bursts rather than one long hiss --
 * writing is a sequence of strokes, and a continuous hiss reads as static.
 */
export function playPenScratch(strokes = 5): void {
  if (!enabled) return
  for (let i = 0; i < strokes; i++) {
    const delay = i * (0.07 + Math.random() * 0.05)
    noise({ duration: 0.045, gain: 0.03, cutoff: 2400, type: 'bandpass', delay })
    tone(2100 + Math.random() * 700, {
      type: 'triangle',
      duration: 0.03,
      gain: 0.012,
      sweepTo: 1500,
      delay,
    })
  }
}

/** A page turning: one filtered swish, no pitch. */
export function playPageFlip(): void {
  if (!enabled) return
  noise({ duration: 0.22, gain: 0.07, cutoff: 1800, type: 'bandpass' })
  noise({ duration: 0.14, gain: 0.04, cutoff: 4200, type: 'highpass', delay: 0.07 })
}

/**
 * The descent. A low tone rising under a brightening noise bed, landing on
 * a soft impact — the sound of a camera falling out of orbit onto a field.
 *
 * Built from the same two primitives as everything else here rather than a
 * sample, so it costs nothing to ship and can be retuned in one line.
 */
export function playZoomSweep(seconds = 3.6): void {
  if (!enabled) return
  // Sub-bass swell: the weight of the move.
  tone(44, { type: 'sine', duration: seconds, gain: 0.16, sweepTo: 128, attack: 0.5 })
  tone(88, { type: 'sine', duration: seconds * 0.9, gain: 0.07, sweepTo: 196, attack: 0.6 })
  // Air rushing past, opening up as the ground approaches.
  for (let i = 0; i < 5; i++) {
    noise({
      duration: seconds / 3,
      gain: 0.022 + i * 0.006,
      cutoff: 400 + i * 900,
      type: 'bandpass',
      delay: (i * seconds) / 6,
    })
  }
  // Touchdown.
  tone(150, { type: 'sine', duration: 0.5, gain: 0.2, sweepTo: 58, delay: seconds - 0.25 })
  noise({ duration: 0.4, gain: 0.08, cutoff: 700, delay: seconds - 0.25 })
}

/**
 * One typewriter key. Deliberately not a single click: a real key is a
 * hammer strike plus the clack of the typebar returning, and the pitch
 * jitters slightly from key to key. Without that jitter a run of them
 * sounds like a machine gun rather than someone typing.
 */
export function playTypeKey(): void {
  if (!enabled) return
  const jitter = 0.88 + Math.random() * 0.26
  tone(2000 * jitter, { type: 'square', duration: 0.014, gain: 0.025, sweepTo: 900 * jitter })
  noise({ duration: 0.02, gain: 0.03, cutoff: 3600, type: 'highpass' })
  noise({ duration: 0.035, gain: 0.014, cutoff: 700, delay: 0.012 })
}

/** The carriage going back: end of a line of dialogue. */
export function playCarriageReturn(): void {
  if (!enabled) return
  noise({ duration: 0.26, gain: 0.05, cutoff: 2600, type: 'bandpass' })
  tone(420, { type: 'triangle', duration: 0.07, gain: 0.07, sweepTo: 300, delay: 0.2 })
  tone(1400, { type: 'square', duration: 0.02, gain: 0.03, delay: 0.24 })
}
