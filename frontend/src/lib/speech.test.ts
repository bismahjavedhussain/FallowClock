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
