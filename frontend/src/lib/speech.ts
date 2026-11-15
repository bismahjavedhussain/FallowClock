/**
 * Spoken narration, via the browser's own speech synthesiser.
 *
 * WHY NOT A RECORDED TTS FILE: this app must work in airplane mode, so any
 * audio has to be a committed asset. A narration track per farm, per line,
 * would be megabytes of WAV in the repo next to the 6.5 MB of ambience
 * already there. speechSynthesis ships with the browser, costs nothing, and
 * re-reads whatever the bundle says — so when the farm changes, the voice
 * changes with it instead of going stale.
 *
 * THE TRADE: voice quality is whatever the operating system provides, and
 * on a bare Linux box there may be no voice at all. Every call here is
 * therefore best-effort and silent on failure; the caption on screen always
 * carries the same words, so nothing is only available in audio.
 */

import { useStore } from '../store'

let warmed = false

export function isNarrationEnabled(): boolean {
  return useStore.getState().narrationEnabled
}

/** Voices load asynchronously on Chrome; the first call often returns []. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  // The narrator IS the farmer, and the farmer is male, so prefer a male
  // voice. The Web Speech API exposes no gender field -- SpeechSynthesisVoice
  // has name, lang, localService and default, and nothing else -- so this
  // has to go by name against the known male voices each platform ships.
  const male = [
    /Google UK English Male/i,
    /Microsoft (Guy|Andrew|Christopher|Eric|Brian|Roger|Steffan|David|Mark)/i,
    /\b(Daniel|Alex|Fred|Tom|Aaron|Oliver|Arthur|Rishi)\b/i,
    // Guarded: "Female" contains "male".
    /(^|[^fe])\bmale\b/i,
  ]
  for (const re of male) {
    const hit = voices.find((v) => re.test(v.name) && v.lang?.startsWith('en'))
    if (hit) return hit
  }
  // No named male voice on this machine. Fall back to any English voice;
  // the caller drops the pitch so it at least does not read as female.
  return voices.find((v) => v.lang?.startsWith('en')) ?? voices[0]
}

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.speechSynthesis
}

/** True when we found a voice whose name says it is male. */
export function hasMaleVoice(): boolean {
  if (!speechAvailable()) return false
  const v = pickVoice()
  return !!v && /male|guy|andrew|christopher|eric|brian|roger|steffan|david|mark|daniel|alex|fred|tom|aaron|oliver|arthur|rishi/i.test(v.name)
}

/**
 * Speak a line. Cancels anything already speaking, so paging quickly
 * between acts never stacks two voices on top of each other.
 */
export function speak(
  text: string,
  { rate = 0.95, pitch = 1.0, volume = 0.95 } = {},
): void {
  if (!speechAvailable() || !text || !useStore.getState().narrationEnabled) return
  const synth = window.speechSynthesis
  try {
    synth.cancel()
    // Touching getVoices() once primes the async list for the next call.
    if (!warmed) {
      synth.getVoices()
      warmed = true
    }
    const utter = new SpeechSynthesisUtterance(text)
    const voice = pickVoice()
    if (voice) utter.voice = voice
    utter.lang = voice?.lang ?? 'en-US'
    utter.rate = rate
    // If we could not find a named male voice, drop the pitch so the
    // narrator still reads as the farmer rather than as someone else.
    utter.pitch = hasMaleVoice() ? pitch : Math.max(0.1, pitch - 0.25)
    utter.volume = volume
    synth.speak(utter)
  } catch {
    // No voice engine, or the tab lost permission. The caption still shows.
  }
}

/** One spoken clause, with its own delivery. */
export interface SpeechPart {
  text: string
  /** Multiplier on the base rate. Below 1 slows a phrase for weight. */
  rate?: number
  /** Multiplier on the base pitch. Slightly lower lands a point. */
  pitch?: number
  /** Silence after this clause, in milliseconds. */
  pauseMs?: number
}

let scriptTimer = 0
/** Fires if a clause's onend never arrives. See WATCHDOG below. */
let watchdogTimer = 0

/**
 * Roughly how long a clause will take, in ms, generously.
 *
 * WATCHDOG. Chrome's speechSynthesis drops `onend` -- after a cancel(),
 * when a tab is backgrounded, and sometimes for no reason at all. The
 * chain here is driven BY onend, so one dropped event used to end the
 * narration silently: you heard the opening line and then nothing, and
 * the only thing that eventually moved the film on was the caller's
 * 26-second safety net.
 *
 * So every clause also arms a timer. Whichever arrives first, the real
 * onend or this, advances the script exactly once. Deliberately slack --
 * about 2.2x a normal speaking rate plus a second -- because cutting a
 * clause off early is worse than a beat of extra silence.
 */
function clauseBudgetMs(text: string, rate: number): number {
  const words = Math.max(1, text.trim().split(/\s+/).length)
  return 1000 + (words / Math.max(0.5, rate)) * 600
}
/**
 * Which script run is the live one.
 *
 * speakScript chains its clauses through onend, so the chain is a closure
 * that outlives the call. Two calls therefore used to leave TWO chains
 * running against one shared scriptTimer: each spoke its own clauses, each
 * overwrote the other's pending timer, and cancelSpeech could only clear
 * whichever timer happened to be last. What you heard was the opening
 * line spoken, cut off, and spoken again -- "Monona County, Iowa, Loess
 * Hills" twice before the rest of the script settled down.
 *
 * Every run takes a ticket. A chain whose ticket is stale stops dead.
 */
let scriptGeneration = 0

/**
 * Speak a scripted sequence of clauses.
 *
 * WHY NOT ONE UTTERANCE: speechSynthesis gives a flat reading of whatever
 * string you hand it. There is no SSML in practice -- Chrome ignores it,
 * Safari ignores it -- so the only levers that actually work are splitting
 * the line into clauses and varying rate and pitch per clause, with real
 * silence in between. That is how you get a pitch read rather than a
 * satnav read: the claim slows down, the aside speeds up, and the number
 * gets a beat of silence in front of it.
 *
 * Queueing every utterance at once would ignore the pauses, because the
 * engine runs its own queue back to back. So each clause is scheduled by
 * timer off the end of the previous one.
 */
export function speakScript(
  parts: SpeechPart[],
  { rate = 1, pitch = 1, volume = 0.95, onEnd }: {
    rate?: number
    pitch?: number
    volume?: number
    /** Fired once the last clause has finished, or immediately if the
     *  platform cannot speak at all. Callers use it to drive the visuals
     *  off the voice instead of guessing a duration. */
    onEnd?: () => void
  } = {},
): void {
  if (!speechAvailable() || !parts.length || !useStore.getState().narrationEnabled) {
    onEnd?.()
    return
  }
  cancelSpeech()
  const generation = ++scriptGeneration

  let i = 0
  const next = () => {
    // Superseded by a later call, or cancelled outright. Say nothing more
    // and do not fire onEnd: the run that replaced this one owns that.
    if (generation !== scriptGeneration || !useStore.getState().narrationEnabled) return
    if (i >= parts.length) {
      onEnd?.()
      return
    }
    const part = parts[i]
    i += 1
    const synth = window.speechSynthesis
    try {
      const utter = new SpeechSynthesisUtterance(part.text)
      const voice = pickVoice()
      if (voice) utter.voice = voice
      utter.lang = voice?.lang ?? 'en-US'
      utter.rate = rate * (part.rate ?? 1)
      const base = hasMaleVoice() ? pitch : Math.max(0.1, pitch - 0.25)
      utter.pitch = Math.max(0.1, base * (part.pitch ?? 1))
      utter.volume = volume
      // Exactly one of onend, onerror and the watchdog may advance the
      // script. Without this latch a late onend and a fired watchdog
      // would both call next() and the script would skip a clause.
      let advanced = false
      const advance = (delay: number) => {
        if (advanced || generation !== scriptGeneration) return
        advanced = true
        window.clearTimeout(watchdogTimer)
        window.clearTimeout(scriptTimer)
        scriptTimer = window.setTimeout(next, delay)
      }

      utter.onend = () => advance(part.pauseMs ?? 0)
      utter.onerror = () => advance(150)

      synth.speak(utter)
      window.clearTimeout(watchdogTimer)
      watchdogTimer = window.setTimeout(
        () => advance(0),
        clauseBudgetMs(part.text, rate * (part.rate ?? 1)),
      )
    } catch {
      next()
    }
  }
  next()
}

export function cancelSpeech(): void {
  // Retire whatever chain is running. synth.cancel() alone is not enough:
  // it is asynchronous in Chrome, and an utterance already in flight can
  // still fire onend afterwards and schedule the next clause.
  scriptGeneration += 1
  // A platform with no speech engine may also be a bare stub, so do not
  // assume clearTimeout exists just because window does.
  if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
    window.clearTimeout(scriptTimer)
    window.clearTimeout(watchdogTimer)
  }
  if (!speechAvailable()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* nothing to cancel */
  }
}
