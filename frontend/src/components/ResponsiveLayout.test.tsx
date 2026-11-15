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

describe('ResponsiveLayout - PhaseYearChart Horizontal Scroll Wrapper', () => {
  it('wraps the SVG line chart and month axis inside a scrollable container', async () => {
    const { default: PhaseYearChart } = await import('./PhaseYearChart')
    const sampleCover = new Array(365).fill(0.5)
    const html = renderToStaticMarkup(
      <PhaseYearChart average={sampleCover} doy={180} />
    )

    expect(html).toContain('class="phase-chart-scroll-wrap"')
    expect(html).toContain('class="phase-chart-canvas"')
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Scrollable year soil cover chart"')
  })
})

describe('ResponsiveLayout - Act 2 Single Farmer Diary CTA', () => {
  it('renders the single farmer diary button matching the home page style', () => {
    const html = renderToStaticMarkup(
      <div className="farmer-thinking is-done desk-diary-cta">
        <img
          src="/sprite/farmer-write/south-east.png"
          width={48}
          height={48}
          alt=""
          aria-hidden="true"
        />
        <button type="button" className="diary-cta">
          See the farmer&rsquo;s diary
          <span className="diary-cta-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    )

    expect(html).toContain('class="farmer-thinking is-done desk-diary-cta"')
    expect(html).toContain('class="diary-cta"')
    expect(html).toContain('See the farmer’s diary')
    expect(html).toContain('class="diary-cta-arrow"')
  })
})

describe('ResponsiveLayout - Mobile Menu Navigation & Audio Controls', () => {
  it('renders mobile menu acts navigation and audio controls markup', () => {
    const html = renderToStaticMarkup(
      <nav className="topbar-mobile-menu" aria-label="Mobile navigation">
        <div className="mobile-menu-section mobile-acts-section">
          <span className="mobile-section-label">Jump to Act</span>
          <div className="mobile-acts-list">
            <button type="button" className="mobile-act-btn is-active">
              <span className="mobile-act-num">Act 1</span>
              <span className="mobile-act-label">The crisis</span>
              <span className="mobile-act-current">Active</span>
            </button>
          </div>
        </div>
        <div className="mobile-menu-section mobile-audio-section">
          <span className="mobile-section-label">Sound &amp; Narration</span>
          <div className="mobile-audio-controls">
            <div className="mobile-audio-row">
              <span className="mobile-audio-label">Voice Narration</span>
            </div>
            <div className="mobile-audio-row">
              <span className="mobile-audio-label">Atmospheric Sound</span>
              <button type="button" className="mobile-sound-toggle-btn">Sound On 🔊</button>
            </div>
          </div>
        </div>
      </nav>
    )

    expect(html).toContain('class="mobile-menu-section mobile-acts-section"')
    expect(html).toContain('class="mobile-act-btn is-active"')
    expect(html).toContain('Act 1')
    expect(html).toContain('The crisis')
    expect(html).toContain('class="mobile-menu-section mobile-audio-section"')
    expect(html).toContain('Voice Narration')
    expect(html).toContain('Atmospheric Sound')
    expect(html).toContain('Sound On 🔊')
  })
})

describe('ResponsiveLayout - SplitCore Plan Candidate Selection', () => {
  it('supports selecting and viewing user plan on year wheel', async () => {
    const { default: SplitCore } = await import('./soil/SplitCore')
    const sampleCover = new Array(365).fill(0.5)
    const onSelect = vi.fn()

    const html = renderToStaticMarkup(
      <SplitCore
        doy={180}
        scenarios={[
          {
            id: 'current',
            label: 'Current Rotation',
            isCurrent: true,
            soilCover: sampleCover,
            bareDays: 104,
            seedCostUsdHa: 0,
            deltaPct: 0,
            nCreditKgHa: 0,
          },
          {
            id: 'your-plan',
            label: 'Your plan: Cereal rye',
            isCurrent: false,
            isPlan: true,
            soilCover: sampleCover,
            bareDays: 62,
            seedCostUsdHa: 45,
            deltaPct: -40,
            nCreditKgHa: 30,
          },
        ]}
        selectedId="your-plan"
        onSelect={onSelect}
        greenCover={sampleCover}
        residueCover={sampleCover}
        soilMoisture={sampleCover}
        erosivity={sampleCover}
        nObs={new Array(365).fill(5)}
      />
    )

    expect(html).toContain('split-panel')
    expect(html).toContain('is-plan')
    expect(html).toContain('data-selected="true"')
    expect(html).toContain('On year wheel ✓')
  })
})
