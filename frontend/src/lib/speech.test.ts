import { describe, expect, it, beforeEach, vi } from 'vitest'

/** Minimal stand-in for the voices a platform reports. */
function voice(name: string, lang = 'en-US'): SpeechSynthesisVoice {
  return { name, lang, default: false, localService: true, voiceURI: name } as SpeechSynthesisVoice
}

function withVoices(names: string[]) {
  const spoken: SpeechSynthesisUtterance[] = []
  vi.stubGlobal('window', {
    speechSynthesis: {
      getVoices: () => names.map((n) => voice(n)),
      cancel: () => {},
      speak: (u: SpeechSynthesisUtterance) => spoken.push(u),
    },
  })
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    text: string
    voice: SpeechSynthesisVoice | null = null
    lang = ''
    rate = 1
    pitch = 1
    volume = 1
    constructor(t: string) { this.text = t }
  })
  return spoken
}

async function fresh() {
  vi.resetModules()
  return import('./speech')
}

beforeEach(() => vi.unstubAllGlobals())

describe('voice selection', () => {
  it('picks the male voice when one is offered', async () => {
    const spoken = withVoices(['Microsoft Aria', 'Microsoft Guy', 'Samantha'])
    const { speak } = await fresh()
    speak('hello')
    expect(spoken[0].voice?.name).toBe('Microsoft Guy')
  })

  it('does not mistake Alexandra for Alex', async () => {
    // Without a word boundary the substring "Alex" matches "Alexandra",
    // and the farmer gets narrated by a female voice.
    const spoken = withVoices(['Alexandra', 'Daniel'])
    const { speak } = await fresh()
    speak('hello')
    expect(spoken[0].voice?.name).toBe('Daniel')
  })

  it('does not mistake Female for male', async () => {
    const spoken = withVoices(['Google UK English Female', 'Microsoft David'])
    const { speak } = await fresh()
    speak('hello')
    expect(spoken[0].voice?.name).toBe('Microsoft David')
  })

  it('drops the pitch when no male voice exists, so it still reads as him', async () => {
    const spoken = withVoices(['Samantha', 'Victoria'])
    const { speak, hasMaleVoice } = await fresh()
    expect(hasMaleVoice()).toBe(false)
    speak('hello', { pitch: 1 })
    expect(spoken[0].pitch).toBeLessThan(1)
  })

  it('keeps the asked-for pitch when a male voice is found', async () => {
    const spoken = withVoices(['Microsoft Guy'])
    const { speak } = await fresh()
    speak('hello', { pitch: 1 })
    expect(spoken[0].pitch).toBe(1)
  })

  it('only considers English voices', async () => {
    vi.stubGlobal('window', {
      speechSynthesis: {
        getVoices: () => [voice('Microsoft Guy', 'de-DE'), voice('Samantha', 'en-US')],
        cancel: () => {},
        speak: () => {},
      },
    })
    const { hasMaleVoice } = await fresh()
    // The only male-named voice is German, so we fall back to English.
    expect(hasMaleVoice()).toBe(false)
  })

  it('never throws when the platform has no speech engine', async () => {
    vi.stubGlobal('window', {})
    const { speak, hasMaleVoice, cancelSpeech } = await fresh()
    expect(() => speak('hello')).not.toThrow()
    expect(() => cancelSpeech()).not.toThrow()
    expect(hasMaleVoice()).toBe(false)
  })
})

/**
 * A speech stub that lets the test drive onend, so the clause chain can
 * actually be stepped. The default harness never fires it, which is why
 * the two-chains-at-once bug survived the existing tests.
 */
function withChain() {
  const spoken: { text: string; utter: SpeechSynthesisUtterance }[] = []
  let cancels = 0
  vi.stubGlobal('window', {
    speechSynthesis: {
      getVoices: () => [voice('Daniel')],
      cancel: () => { cancels += 1 },
      speak: (u: SpeechSynthesisUtterance) => spoken.push({ text: u.text, utter: u }),
    },
    setTimeout: (fn: () => void) => globalThis.setTimeout(fn, 0) as unknown as number,
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
  })
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    text: string
    voice: SpeechSynthesisVoice | null = null
    lang = ''
    rate = 1
    pitch = 1
    volume = 1
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(t: string) { this.text = t }
  })
  const tick = () => new Promise((r) => globalThis.setTimeout(r, 1))
  return { spoken, tick, cancelCount: () => cancels }
}

describe('one script at a time', () => {
  it('a second call replaces the first instead of racing it', async () => {
    const { spoken, tick } = withChain()
    const { speakScript } = await fresh()

    speakScript([{ text: 'Monona County.' }, { text: 'Second clause.' }, { text: 'Third clause.' }])
    expect(spoken.map((s) => s.text)).toEqual(['Monona County.'])

    // The first clause finishes; the chain schedules the second.
    spoken[0].utter.onend?.()

    // A re-render restarts the script before that timer fires. This is
    // the real sequence that spoke the field name twice.
    speakScript([{ text: 'Monona County.' }, { text: 'Replacement clause.' }])
    await tick()

    const texts = spoken.map((s) => s.text)
    // The retired chain must not have queued its second clause.
    expect(texts).not.toContain('Second clause.')
    expect(texts).not.toContain('Third clause.')
    // Exactly two utterances: one per call, no interleaving.
    expect(texts).toEqual(['Monona County.', 'Monona County.'])
  })

  it('a retired chain does not fire onEnd and hand off early', async () => {
    const { spoken, tick } = withChain()
    const { speakScript } = await fresh()
    let firstEnded = 0
    let secondEnded = 0

    speakScript([{ text: 'A.' }], { onEnd: () => { firstEnded += 1 } })
    speakScript([{ text: 'B.' }], { onEnd: () => { secondEnded += 1 } })
    // The superseded chain's utterance can still report completion.
    spoken[0].utter.onend?.()
    await tick()
    expect(firstEnded).toBe(0)

    spoken[1].utter.onend?.()
    await tick()
    expect(secondEnded).toBe(1)
  })

  it('cancelSpeech stops the chain dead', async () => {
    const { spoken, tick } = withChain()
    const { speakScript, cancelSpeech } = await fresh()
    let ended = 0

    speakScript([{ text: 'One.' }, { text: 'Two.' }], { onEnd: () => { ended += 1 } })
    cancelSpeech()
    spoken[0].utter.onend?.()
    await tick()

    expect(spoken.map((s) => s.text)).toEqual(['One.'])
    expect(ended).toBe(0)
  })
})
