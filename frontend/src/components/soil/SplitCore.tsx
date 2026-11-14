/**
 * Three rotations, side by side, each with its own soil profile.
 *
 * The comparison is the actual argument of this project — "here is what you
 * do now, here is what one change buys you" — and until now it was a list.
 *
 * TWO THINGS THAT WOULD MAKE THIS LIE, both handled:
 *
 * 1. `erosivityMax` is computed ONCE and passed to all three panels. Three
 *    panels each normalising to their own maximum would render identically
 *    and compare nothing.
 *
 * 2. The schema gives each Rotation only its own `soil_cover` — there is no
 *    per-rotation `green_cover`. Feeding the observed green cover to all
 *    three would grow identical roots in every panel, which is exactly the
 *    comparison failing silently. Instead: on days a scenario raises cover
 *    above the baseline, a LIVING cover crop is what raised it, so living
 *    cover is at least the scenario's cover that day. Elsewhere it is the
 *    observed green cover. Derived, and captioned as derived.
 */

import { useMemo } from 'react'
import SoilCutaway from './SoilCutaway'

export interface SplitScenario {
  id: string
  label: string
  isCurrent: boolean
  soilCover: number[]
  bareDays: number
  bareDaysByPhase?: number[] | null
  seedCostUsdHa: number
  deltaPct: number
  nCreditKgHa: number
}

export interface SplitCoreProps {
  doy: number
  scenarios: SplitScenario[]
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  greenCover: number[]
  residueCover: number[]
  soilMoisture: number[]
  erosivity: number[]
  nObs: number[]
  phaseLabels?: string[] | null
  reducedMotion?: boolean
}

/** See the header: living cover for a scenario, derived not measured. */
function livingCoverFor(scenario: number[], baseline: number[], green: number[]): number[] {
  return green.map((g, i) =>
    scenario[i] > baseline[i] + 1e-9 ? Math.max(g, scenario[i]) : g,
  )
}

export default function SplitCore({
  doy,
  scenarios,
  selectedId = null,
  onSelect,
  greenCover,
  residueCover,
  soilMoisture,
  erosivity,
  nObs,
  phaseLabels,
  reducedMotion = false,
}: SplitCoreProps) {
  // Shared across every panel, or the three are not comparable.
  const erosivityMax = useMemo(() => Math.max(...erosivity, 0), [erosivity])
  const baseline = useMemo(
    () => scenarios.find((s) => s.isCurrent)?.soilCover ?? scenarios[0]?.soilCover ?? greenCover,
    [scenarios, greenCover],
  )
  const baselineBare = scenarios.find((s) => s.isCurrent)?.bareDays ?? 0

  if (!scenarios.length) return null

  return (
    <section className="split-core" id="split" aria-label="Compare rotations side by side">
      <div className="section-heading">
        <span className="section-number">03 / THE CHOICE</span>
        <h2>Three futures for the same ground.</h2>
      </div>

      <div className="split-grid">
        {scenarios.map((s, i) => {
          const living = livingCoverFor(s.soilCover, baseline, greenCover)
          const daysSaved = baselineBare - s.bareDays
          const phases =
            s.bareDaysByPhase && phaseLabels && s.bareDaysByPhase.length === phaseLabels.length
              ? s.bareDaysByPhase.map((n, j) => `${n} after ${phaseLabels[j]}`).join(' · ')
              : null

          return (
            <article key={s.id} className={`split-panel ${s.isCurrent ? 'is-current' : ''}`} data-selected={selectedId === (s.isCurrent ? null : s.id) ? 'true' : 'false'}>
              <header>
                <div className="split-panel-actions">
                  <span className="split-tag">{s.isCurrent ? 'Today' : `Option ${i}`}</span>
                  {onSelect && <button type="button" className="split-select" aria-pressed={selectedId === (s.isCurrent ? null : s.id)} onClick={() => onSelect(s.isCurrent ? null : s.id)}>{selectedId === (s.isCurrent ? null : s.id) ? 'On year wheel ✓' : 'View on year wheel →'}</button>}
                </div>
                <h3>{s.label}</h3>
              </header>

              <SoilCutaway
                doy={doy}
                greenCover={living}
                residueCover={residueCover}
                soilCover={s.soilCover}
                soilMoisture={soilMoisture}
                erosivity={erosivity}
                nObs={nObs}
                erosivityMax={erosivityMax}
                seed={i + 2}
                label={s.label}
                reducedMotion={reducedMotion}
                variant="compact"
              />

              <dl className="split-metrics">
                <div>
                  <dt>Bare days</dt>
                  <dd>
                    {s.bareDays}
                    {daysSaved > 0 && <span className="split-win"> −{daysSaved}</span>}
                  </dd>
                </div>
                <div>
                  <dt>Soil loss</dt>
                  <dd className={s.deltaPct < 0 ? 'split-win' : undefined}>
                    {s.isCurrent ? 'baseline' : `${s.deltaPct.toFixed(0)}%`}
                  </dd>
                </div>
                <div>
                  <dt>Seed cost</dt>
                  <dd>{s.seedCostUsdHa > 0 ? `$${s.seedCostUsdHa.toFixed(0)}/ha` : '—'}</dd>
                </div>
              </dl>

              {phases && <p className="split-phases">{phases}</p>}
              {s.nCreditKgHa > 0 && (
                <p className="split-phases">{s.nCreditKgHa.toFixed(0)} kg N/ha credit</p>
              )}
            </article>
          )
        })}
      </div>

      <details className="comparison-note">
        <summary>How to read these soil pictures</summary>
        <p>All three panels share one erosivity scale, so the pictures are comparable. Root depth is <strong>derived</strong> from each scenario&apos;s own cover. It is a proxy, not a measurement.</p>
      </details>
    </section>
  )
}
