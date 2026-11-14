/** Seasonal application shell. Scientific values always come from the bundle. */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import YearRing from './components/YearRing'
import RingLegend from './components/RingLegend'
import TimeLever from './components/TimeLever'
import CropPlanner from './components/CropPlanner'
import AudioAtmosphere from './components/seasonal/AudioAtmosphere'
import AtmosphereReadout from './components/seasonal/AtmosphereReadout'
import { PRE_GAP_SEEDING_DAYS, RUSLE_B_DEFAULT, candidateSeedDoys, rankSpeciesForGap } from './lib/cropFit'
import { placeDecision, proposalPreview } from './lib/proposal'
import type { ClimatologySlice, Gap, Species } from './lib/cropFit'
import { useStore } from './store'
import { seasonAtDoy } from './lib/seasons'

const SeasonalWorld = lazy(() => import('./components/seasonal/SeasonalWorld'))

interface Rotation {
  id: string
  label: string
  is_current: boolean
  soil_cover: number[]
  bare_days: number
  /** Bare days in each rotation phase, ordered as observed_rotation.phase_labels. */
  bare_days_by_phase?: number[] | null
  exposed_r: number
  delta_vs_current_pct: number
  added_seed_cost_usd_ha: number
  n_credit_kg_ha: number
}

interface Bundle {
  farm: { owner_name: string; place: string; area_ha: number }
  provenance: { is_synthetic: boolean; years_used: number[]; sources: { name: string }[] }
  climatology: {
    soil_cover: number[]
    green_cover: number[]
    residue_cover: number[]
    n_obs_per_doy: number[]
    erosivity_r: number[]
    gdd_base4: number[]
    gdd_base10: number[]
    frost_prob: number[]
    heat_stress_prob?: number[]
    soil_moisture: number[]
    /** One cover curve per rotation phase. soil_cover is their mean. */
    phase_covers?: number[][] | null
  }
  observed_rotation?: {
    inferred_label: string
    phase_labels?: string[] | null
    years: { harvest_doy?: number | null }[]
  }
  gaps: Gap[]
  species: Species[]
  rotations: Rotation[]
  crop_curves: Record<string, { green_cover: number[]; n_fields: number; detection: string }>
  uncertainty: { field: string; level: string; reason: string; affects: string }[]
}

/** Prefer the observed Story County field supplied by the upstream imagery pipeline. */
const BUNDLE_URLS = [
  '/bundles/farm_story-county-ia.json',
  '/bundles/farm_synthetic.json',
]

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { selectedRotationId, selectRotation, hoveredDoy, setHoveredDoy, selectedDoy, setSelectedDoy, draggingSpeciesId, setDraggingSpecies, placedFills, addPlacedFill, removePlacedFill, resetPlacedFills, reducedMotion, setReducedMotion } = useStore()
  const [mode, setMode] = useState<'2D' | '3D'>('3D')
  const [placementMessage, setPlacementMessage] = useState<string | null>(null)

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(motion.matches)
    sync()
    motion.addEventListener('change', sync)
    return () => motion.removeEventListener('change', sync)
  }, [setReducedMotion])

  useEffect(() => {
    const load = async () => {
      for (const url of BUNDLE_URLS) {
        try {
          const r = await fetch(url)
          if (r.ok) {
            setBundle(await r.json())
            return
          }
        } catch {
          // try the next one
        }
      }
      setError(`Could not load any bundle. Tried: ${BUNDLE_URLS.join(', ')}`)
    }
    void load()
  }, [])

  const clim = bundle?.climatology
  const current = bundle?.rotations.find((r) => r.is_current)
  const selected =
    bundle?.rotations.find((r) => r.id === selectedRotationId) ?? null

  // Nothing can be drilled into a field that still has a crop standing on
  // it. The backend already gates its own fit on the observed harvest; the
  // client-side fit has to use the same gate or the UI recommends seeding
  // cereal rye on 15 Aug, six weeks before this field's 29 Sep harvest.
  const earliestSeedDoy = useMemo(() => {
    const harvests = (bundle?.observed_rotation?.years ?? [])
      .map((y) => y.harvest_doy)
      .filter((d): d is number => typeof d === 'number')
      .sort((a, b) => a - b)
    return harvests.length ? harvests[Math.floor(harvests.length / 2)] : undefined
  }, [bundle])

  const phaseLabels = bundle?.observed_rotation?.phase_labels ?? null
  const phaseCovers = bundle?.climatology?.phase_covers ?? null

  const slice: ClimatologySlice | null = useMemo(
    () =>
      clim
        ? {
            gddBase4: clim.gdd_base4,
            gddBase10: clim.gdd_base10,
            frostProb: clim.frost_prob,
            soilMoisture: clim.soil_moisture,
            erosivityR: clim.erosivity_r,
            soilCover: clim.soil_cover,
          }
        : null,
    [clim],
  )

  const ranked = useMemo(() => {
    if (!bundle || !slice || bundle.gaps.length === 0) return []
    const observed: Record<string, number[]> = {}
    for (const [k, v] of Object.entries(bundle.crop_curves)) observed[k] = v.green_cover
    return rankSpeciesForGap(bundle.species, bundle.gaps[0], slice, observed, RUSLE_B_DEFAULT, earliestSeedDoy)
  }, [bundle, slice, earliestSeedDoy])

  const fitById = useMemo(() => new Map(ranked.map((fit) => [fit.speciesId, fit])), [ranked])
  const pickedFit = draggingSpeciesId ? fitById.get(draggingSpeciesId) : undefined
  const plantingDoys = useMemo(() => pickedFit?.feasible && bundle?.gaps[0] && bundle.species.find((s) => s.id === pickedFit.speciesId)
    ? candidateSeedDoys(bundle.species.find((s) => s.id === pickedFit.speciesId)!, bundle.gaps[0], PRE_GAP_SEEDING_DAYS, earliestSeedDoy) : [], [pickedFit, bundle, earliestSeedDoy])

  if (error) {
    return (
      <div className="state-screen"><div className="state-panel"><span aria-hidden="true">✺</span><h1>The field journal could not open.</h1><p>{error}</p><p>Run <code>python scripts/make_fixture.py</code> in backend/ first.</p></div>
      </div>
    )
  }

  if (!bundle || !clim || !current) {
    return <div className="state-screen"><div className="state-panel" role="status"><span aria-hidden="true">✺</span><h1>Gathering the seasons…</h1><p>Opening the field journal.</p></div></div>
  }

  // The headline must be the bundle's phase-averaged figure, NOT a count
  // taken off the mean cover curve. Thresholding a mean is not the mean of
  // the thresholds: on this field that reads 110 instead of 104, and on the
  // Monona field it reads 0 for a field that is bare 14 days after corn.
  const phaseSplit =
    current.bare_days_by_phase && phaseLabels &&
    current.bare_days_by_phase.length === phaseLabels.length
      ? current.bare_days_by_phase
          .map((n, i) => `${n} after ${phaseLabels[i]}`)
          .join(', ')
      : null

  const baselineCover = selected?.soil_cover ?? current.soil_cover
  const accepted = placedFills.map((id) => fitById.get(id)).filter((fit) => fit?.feasible && fit.coverCurve.length === 365)
  const { cover: ringCover, baselineBare, proposedBare, baselineExposure, proposedExposure } = proposalPreview(baselineCover, accepted as NonNullable<typeof accepted[number]>[], clim.erosivity_r, clim.n_obs_per_doy)

  const placeCrop = (day: number, speciesId = draggingSpeciesId) => {
    if (!speciesId) return
    const fit = fitById.get(speciesId)
    const species = bundle.species.find((s) => s.id === speciesId)
    const decision = placeDecision(fit, species, bundle.gaps[0], day, earliestSeedDoy)
    if (!decision.accepted) { setPlacementMessage(decision.reason); return }
    addPlacedFill(speciesId)
    setDraggingSpecies(null)
    setPlacementMessage(decision.reason)
  }

  return <div className="site-shell" data-season={seasonAtDoy(selectedDoy)} id="top">
    {bundle.provenance.is_synthetic && <div className="fixture-banner" role="status"><span>✳</span> SYNTHETIC SAMPLE — simulated soil cover; no satellite observations. <span>✳</span></div>}
    <nav className="topbar" aria-label="Site navigation">
      <a className="brand" href="#top"><span className="brand-seal" aria-hidden="true">✺</span><span>Fallow Clock<small>THE LIVING YEAR</small></span></a>
      <div className="top-links"><a href="#year">The year</a><a href="#planner">Crop studio</a><a href="#evidence">Field notes</a></div>
      <AudioAtmosphere doy={selectedDoy} />
    </nav>

    <header className="workspace-intro" id="year">
      <div className="overview-copy"><span className="eyebrow">✦ THE LIVING YEAR · {bundle.farm.place}</span><h1>Find the <em>hole</em> in your year.</h1><p>Explore soil cover, rainfall erosivity, and the seasons around one field.</p><small>{bundle.provenance.is_synthetic ? 'Interactive sample field' : bundle.farm.owner_name.startsWith('TBD') ? 'Observed Story County field' : bundle.farm.owner_name} · {bundle.farm.area_ha} ha</small></div>
      <div className="field-summary overview-summary" aria-label="Field overview">
        <div><span className="eyebrow">{bundle.provenance.is_synthetic ? 'From this sample' : 'From this field'}</span><strong>{current.bare_days} <small>days</small></strong><p>{phaseSplit ?? `of ${bundle.provenance.is_synthetic ? 'simulated' : 'observed'} bare soil expected per year`}</p></div>
        <div><span className="eyebrow">Erosivity overlap</span><strong>{Math.round((bundle.gaps[0]?.share_of_annual_r ?? 0) * 100)}<small>%</small></strong><p>of annual erosivity overlaps the largest bare gap</p></div>
      </div>
    </header>

    <main className="workspace-main">
      <div className="main-grid">
        <section className="ring-column" aria-label="Interactive agricultural calendar">
          <div className="hero-world" data-season={seasonAtDoy(selectedDoy)} data-mode={mode} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setPlacementMessage('Drop the packet onto a day on the wheel, or use the suggested date button.') }}>
            <Suspense fallback={null}><SeasonalWorld doy={selectedDoy} /></Suspense>
            <YearRing initialMode="3D" showLegend={false} soilCover={ringCover} erosivity={clim.erosivity_r} nObs={clim.n_obs_per_doy} frostProb={clim.frost_prob} greenCover={clim.green_cover} residueCover={clim.residue_cover} compareCover={selected ? current.soil_cover : accepted.length ? baselineCover : undefined} highlightDoys={plantingDoys} selectedDoy={selectedDoy} onHoverDay={setHoveredDoy} onSelectDay={setSelectedDoy} onActivateDay={(day) => draggingSpeciesId && placeCrop(day)} onModeChange={setMode} reducedMotion={reducedMotion} synthetic={bundle.provenance.is_synthetic} />
          </div>
          <TimeLever doy={selectedDoy} onChange={setSelectedDoy} />
          {placementMessage && <p className="placement-message" role="status">{placementMessage}</p>}
        </section>

        <aside className="planner-column" id="planner">
          <details className="sidebar-section sidebar-day" open><summary>Selected day & climate</summary><AtmosphereReadout doy={selectedDoy} climate={clim} synthetic={bundle.provenance.is_synthetic} /><p className="ring-caption">{hoveredDoy ? `DOY ${hoveredDoy} · ${clim.n_obs_per_doy[hoveredDoy - 1] > 0 ? `soil cover ${(ringCover[hoveredDoy - 1] * 100).toFixed(0)}%` : 'soil cover unknown'} · ${clim.n_obs_per_doy[hoveredDoy - 1]} ${bundle.provenance.is_synthetic ? 'simulated' : 'observations'}` : bundle.provenance.is_synthetic ? 'Interactive synthetic sample. No satellite cover observations are claimed.' : 'Hover or select a day to read the field. The illustrated season is decorative.'}</p>{phaseCovers && phaseLabels && phaseCovers.length === phaseLabels.length && <p className="ring-caption phase-caption">This day by rotation phase: {phaseCovers.map((pc, i) => `${phaseLabels[i]} ${(pc[selectedDoy - 1] * 100).toFixed(0)}% (${pc[selectedDoy - 1] < 0.3 ? 'bare' : 'covered'})`).join(' · ')}. The ring shows their mean, so a day can read covered here and still sit inside a gap that is bare in one phase.</p>}</details>
          <CropPlanner species={bundle.species} fits={ranked} picked={draggingSpeciesId} placed={placedFills} onPick={setDraggingSpecies} onPlace={() => pickedFit && placeCrop(pickedFit.seedDoy)} onRemove={removePlacedFill} onReset={resetPlacedFills} baselineBare={baselineBare} proposedBare={proposedBare} baselineExposure={baselineExposure} proposedExposure={proposedExposure} />
          <details className="sidebar-section"><summary>Rotation paths</summary>
<section className="rotation-card"><div className="card-title"><span className="eyebrow">Compare futures</span><h2>Rotation paths</h2></div><div className="rotation-list">{bundle.rotations.map((r) => <button type="button" key={r.id} onClick={() => selectRotation(r.is_current ? null : r.id)} aria-pressed={(selected?.id ?? current.id) === r.id} className="rotation-option"><span className="rotation-icon" aria-hidden="true">{r.is_current ? '◌' : '✿'}</span><span className="rotation-copy"><strong>{r.label}</strong><small>{r.bare_days} bare days · {r.added_seed_cost_usd_ha > 0 ? `+$${r.added_seed_cost_usd_ha}/ha seed` : 'current practice'}{r.n_credit_kg_ha > 0 ? ` · ${r.n_credit_kg_ha} kg N/ha credit` : ''}</small></span><span className="rotation-delta">{r.delta_vs_current_pct === 0 ? 'Baseline' : `${r.delta_vs_current_pct.toFixed(0)}% soil loss`}</span></button>)}</div></section>
          </details>
        </aside>
      </div>
<section className="field-notes" id="evidence"><div className="section-heading"><span className="section-number">02 / FIELD NOTES</span><h2>Beauty, with evidence beneath it.</h2><p>Planting ideas are proposals. We keep observations, modelled cover, and uncertainty visible.</p></div><div className="evidence-legend"><RingLegend compact showDetails /></div><div className="notes-grid">
        <article className="notes-card"><div className="notes-card-title"><span className="notes-ornament">❦</span><div><span className="eyebrow">Crop fit</span><h3>What fits the longest gap</h3></div></div><ol className="fit-list">{ranked.slice(0, 6).map((fit, index) => <li key={fit.speciesId} className={fit.feasible ? '' : 'unavailable'}><span className="fit-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{fit.speciesName}</strong><small>{fit.feasible ? `${fit.curveSource} cover · suggested seed day ${fit.seedDoy}` : fit.reason}</small></span><span className="fit-benefit">{fit.feasible ? `−${fit.pctReduction.toFixed(0)}%` : '—'}</span></li>)}</ol><p className="notes-footnote">Reduction in erosion exposure within the largest gap. Ranked by <strong>evidence first</strong>: a species we measured on neighbouring fields outranks a modelled one even when the model promises more. Every modelled curve uses the same generic plateau, so modelled species tie at identical percentages and read higher than they should — the measured curve is lower because it is real. Treat modelled figures as an upper bound.</p></article>
        <article className="notes-card"><div className="notes-card-title"><span className="notes-ornament">✧</span><div><span className="eyebrow">Uncertainty ledger</span><h3>What we do not know</h3></div></div><ul className="uncertainty-list">{bundle.uncertainty.map((u, i) => <li key={i}><div><span className={`uncertainty-level level-${u.level}`}>{u.level}</span><code>{u.field}</code></div><p>{u.reason}</p><small>{u.affects}</small></li>)}</ul></article>
      </div><div className="provenance-strip"><span>✦ &nbsp; DATA SOURCES</span><div>{bundle.provenance.sources.map((source, i) => <span key={i}>{source.name}</span>)}</div><small>Years: {bundle.provenance.years_used.join(', ') || 'unspecified'}</small></div></section>

    </main>
    <footer className="site-footer"><span className="footer-mark" aria-hidden="true">✺</span><div><strong>Fallow Clock</strong><small>A living view of the agricultural year.</small></div><p>Seasonal artwork illustrates time and atmosphere. Field values and planning estimates come from the loaded data bundle.</p><nav aria-label="Footer navigation"><a href="#year">The year</a><a href="#planner">Crop studio</a><a href="#evidence">Field notes</a><a href="#top">Back to top ↑</a></nav></footer>
  </div>
}
