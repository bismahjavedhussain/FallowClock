import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import SlideDeck, { Slide } from './SlideDeck'
import LegendFlyout from './LegendFlyout'

const TEST_SLIDES: Slide[] = [
  { id: 'act-1', label: 'The crisis', eyebrow: 'Act 1' },
  { id: 'act-2', label: "The farmer's desk", eyebrow: 'Act 2' },
  { id: 'act-3', label: 'The root zone', eyebrow: 'Act 3' },
  { id: 'act-4', label: 'Three futures', eyebrow: 'Act 4' },
]

describe('ResponsiveLayout - SlideDeck Static Markup & Navigation Structure', () => {
  it('renders four full-width slides with accessibility attributes and deck navigation', () => {
    const onIndex = vi.fn()
    const html = renderToStaticMarkup(
      <SlideDeck slides={TEST_SLIDES} index={0} onIndex={onIndex}>
        <div key="1">Slide 1 Content</div>
        <div key="2">Slide 2 Content</div>
        <div key="3">Slide 3 Content</div>
        <div key="4">Slide 4 Content</div>
      </SlideDeck>,
    )

    expect(html).toContain('class="deck"')
    expect(html).toContain('class="deck-track"')
    expect(html).toContain('class="deck-slide"')
    expect(html).toContain('aria-label="Act 1: The crisis"')
    expect(html).toContain('aria-label="Act 2: The farmer&#x27;s desk"')
    expect(html).toContain('class="deck-nav"')
    expect(html).toContain('class="deck-arrow"')
    expect(html).toContain('class="deck-next"')
  })

  it('sets aria-current on the active step', () => {
    const onIndex = vi.fn()
    const html = renderToStaticMarkup(
      <SlideDeck slides={TEST_SLIDES} index={1} onIndex={onIndex}>
        <div key="1">Slide 1</div>
        <div key="2">Slide 2</div>
        <div key="3">Slide 3</div>
        <div key="4">Slide 4</div>
      </SlideDeck>,
    )

    expect(html).toContain('aria-current="step"')
    expect(html).toContain('class="is-on"')
  })
})

describe('ResponsiveLayout - LegendFlyout Trigger Markup', () => {
  it('renders trigger button with accessible attributes', () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const html = renderToStaticMarkup(<LegendFlyout open={false} onOpen={onOpen} onClose={onClose} />)

    expect(html).toContain('class="dial-pill legend-ask"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('How to read the wheel')
  })
})

describe('ResponsiveLayout - Field Summary Card Resilience', () => {
  it('renders field summary card with bare days and erosivity overlap elements', () => {
    const html = renderToStaticMarkup(
      <aside className="pane-side">
        <div className="field-summary" aria-label="Field overview">
          <div>
            <span className="eyebrow">From this field</span>
            <strong>104 <small>days</small></strong>
            <p>of bare soil expected per year</p>
          </div>
          <div>
            <span className="eyebrow">Erosivity overlap</span>
            <strong>62<small>%</small></strong>
            <p>of annual erosivity overlaps the largest bare gap</p>
          </div>
        </div>
      </aside>
    )

    expect(html).toContain('class="field-summary"')
    expect(html).toContain('aria-label="Field overview"')
    expect(html).toContain('From this field')
    expect(html).toContain('104 <small>days</small>')
    expect(html).toContain('Erosivity overlap')
    expect(html).toContain('62<small>%</small>')
  })
})
