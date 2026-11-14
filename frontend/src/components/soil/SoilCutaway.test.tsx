import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SoilCutaway from './SoilCutaway'
import SplitCore from './SplitCore'

const N = 365
const fill = (v: number) => Array.from({ length: N }, () => v)
/** Bare in the spring window, covered the rest of the year. */
const coverCurve = Array.from({ length: N }, (_, i) => (i >= 82 && i <= 164 ? 0.12 : 0.74))
/** One heavy storm on DOY 120, inside the bare window. */
const erosivity = Array.from({ length: N }, (_, i) => (i === 119 ? 24 : 1))

const base = {
  greenCover: coverCurve,
  residueCover: fill(0.4),
  soilCover: coverCurve,
  soilMoisture: fill(0.5),
  erosivity,
  nObs: fill(12),
}

describe('SoilCutaway', () => {
  it('renders without a DOM', () => {
    const html = renderToStaticMarkup(<SoilCutaway doy={200} {...base} />)
    expect(html).toContain('<svg')
    expect(html).toContain('Soil profile')
  })

  it('sheds soil on a bare day under heavy rain', () => {
    const html = renderToStaticMarkup(<SoilCutaway doy={120} {...base} />)
    expect(html).toContain('data-eroding="on"')
    expect(html).toContain('topsoil is being lost')
  })

  it('does not shed soil when the ground is covered', () => {
    const html = renderToStaticMarkup(<SoilCutaway doy={300} {...base} />)
    expect(html).toContain('data-eroding="off"')
    expect(html).toContain('Soil is protected')
  })

  it('never sheds soil on a day no satellite observed', () => {
    // n_obs = 0 is UNKNOWN, not bare. Eroding here would contradict the
    // contract the ring and the schema both state.
    const html = renderToStaticMarkup(
      <SoilCutaway doy={120} {...base} nObs={fill(0)} />,
    )
    expect(html).toContain('data-eroding="off"')
    expect(html).toContain('No satellite observation')
  })

  it('stills the flecks under reduced motion', () => {
    const html = renderToStaticMarkup(<SoilCutaway doy={120} {...base} reducedMotion />)
    expect(html).toContain('data-eroding="off"')
  })

  it('grows more root with more cover', () => {
    const count = (html: string) => (html.match(/<path /g) ?? []).length
    const winter = count(renderToStaticMarkup(<SoilCutaway doy={20} {...base} greenCover={fill(0.05)} />))
    const summer = count(renderToStaticMarkup(<SoilCutaway doy={200} {...base} greenCover={fill(0.95)} />))
    expect(summer).toBeGreaterThan(winter)
  })

  it('drops labels in the compact variant used by the 3-up', () => {
    const full = renderToStaticMarkup(<SoilCutaway doy={200} {...base} />)
    const compact = renderToStaticMarkup(<SoilCutaway doy={200} {...base} variant="compact" />)
    expect(full).toContain('>Topsoil</span>')
    expect(compact).not.toContain('>Topsoil</span>')
  })
})

const scenarios = [
  { id: 'a', label: 'Corn-Soybean (current)', isCurrent: true, soilCover: coverCurve, bareDays: 104, bareDaysByPhase: [112, 96], seedCostUsdHa: 0, deltaPct: 0, nCreditKgHa: 0 },
  { id: 'b', label: 'Corn-Soybean + cereal rye', isCurrent: false, soilCover: fill(0.62), bareDays: 62, bareDaysByPhase: [72, 53], seedCostUsdHa: 62, deltaPct: -26.9, nCreditKgHa: 0 },
  { id: 'c', label: 'Corn-Soybean + best-fit cover', isCurrent: false, soilCover: fill(0.8), bareDays: 46, bareDaysByPhase: [54, 37], seedCostUsdHa: 132, deltaPct: -30.5, nCreditKgHa: 0 },
]

describe('SplitCore', () => {
  const props = {
    doy: 120,
    scenarios,
    greenCover: coverCurve,
    residueCover: fill(0.4),
    soilMoisture: fill(0.5),
    erosivity,
    nObs: fill(12),
    phaseLabels: ['soybean', 'corn'],
  }

  it('renders one panel per scenario with its metrics', () => {
    const html = renderToStaticMarkup(<SplitCore {...props} />)
    expect((html.match(/<article class="split-panel/g) ?? []).length).toBe(3)
    expect(html).toContain('$62/ha')
    expect(html).toContain('-27%')
    expect(html).toContain('112 after soybean')
  })

  it('shows how many bare days each option saves', () => {
    const html = renderToStaticMarkup(<SplitCore {...props} />)
    expect(html).toContain('42') // 104 - 62
    expect(html).toContain('58') // 104 - 46
  })

  it('gives the alternatives different roots from the baseline', () => {
    // If every panel grew identical roots the comparison would be a lie.
    const html = renderToStaticMarkup(<SplitCore {...props} />)
    const panels = html.split('<article class="split-panel').slice(1)
    const paths = panels.map((p) => (p.match(/<path /g) ?? []).length)
    expect(paths[1]).not.toBe(paths[0])
  })

  it('renders nothing rather than breaking when a farm has no rotations', () => {
    expect(renderToStaticMarkup(<SplitCore {...props} scenarios={[]} />)).toBe('')
  })
})
