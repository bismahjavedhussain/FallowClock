import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import NarrationToggle from './NarrationToggle'
import { useStore } from '../store'

describe('NarrationToggle & Global Audio State', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.clear()
      } catch {}
    }
    useStore.getState().setSoundEnabled(true)
    useStore.getState().setNarrationEnabled(true)
  })

  it('soundEnabled and narrationEnabled are true by default in the global store', () => {
    const state = useStore.getState()
    expect(state.soundEnabled).toBe(true)
    expect(state.narrationEnabled).toBe(true)
  })

  it('renders narration toggle button with accessible aria attributes when ON', () => {
    useStore.getState().setNarrationEnabled(true)
    const html = renderToStaticMarkup(<NarrationToggle />)
    expect(html).toContain('class="narration-toggle"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Narration is on')
  })

  it('renders narration toggle button with accessible aria attributes when OFF', () => {
    useStore.getState().setNarrationEnabled(false)
    const html = renderToStaticMarkup(<NarrationToggle />)
    expect(html).toContain('class="narration-toggle"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Narration is off')
  })

  it('toggles narrationEnabled in the store when called', () => {
    useStore.getState().setNarrationEnabled(false)
    expect(useStore.getState().narrationEnabled).toBe(false)

    useStore.getState().setNarrationEnabled(true)
    expect(useStore.getState().narrationEnabled).toBe(true)
  })

  it('soundEnabled can be set and read globally', () => {
    useStore.getState().setSoundEnabled(false)
    expect(useStore.getState().soundEnabled).toBe(false)

    useStore.getState().setSoundEnabled(true)
    expect(useStore.getState().soundEnabled).toBe(true)
  })
})
