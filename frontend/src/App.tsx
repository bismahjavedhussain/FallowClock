/** Fallow Clock shell. U2 owns this file. Every scientific value comes from the bundle, via lib/metrics. */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import YearRing, { doyToDate } from './components/YearRing'
import TimeLever from './components/TimeLever'
import CropPlanner from './components/CropPlanner'
import PhaseToggle from './components/PhaseToggle'
import RotationCompare from './components/RotationCompare'
import FieldNotes from './components/FieldNotes'
import ErrorBoundary from './components/ErrorBoundary'
import AudioAtmosphere from './components/seasonal/AudioAtmosphere'
import AtmosphereReadout from './components/seasonal/AtmosphereReadout'
import { BARE_THRESHOLD, PRE_GAP_SEEDING_DAYS, candidateSeedDoys, rankSpeciesForGap, spliceRotationCover, type FitResult } from './lib/cropFit'
import { FALLBACK_PATH, FARMS, buildFieldModel, loadBundle, type Bundle } from './lib/bundle'
import { defaultPhaseKey, evidenceTier, fieldFacts, rotationFillCurves, scoreCover, tierLabel, usableFit, type CoverScore } from './lib/metrics'
import { placeDecision } from './lib/proposal'
import { findingSentence, personaFor } from './content/story'
import { isWebGLAvailable } from './lib/webgl'
import { seasonAtDoy } from './lib/seasons'
import { useStore } from './store'

const SeasonalWorld = lazy(() => import('./components/seasonal/SeasonalWorld'))

/** Phones, reduced motion and no-WebGL start in 2D: the 3D ring is ~150 KB gzipped. */
function pickInitialMode(): '2D' | '3D' {
  const small = window.matchMedia('(max-width: 700px)').matches
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return small || reduced || !isWebGLAvailable() ? '2D' : '3D'
}

export default function App() {
  const bundle = useStore((s) => s.bundle)
  const bundleError = useStore((s) => s.bundleError)
  const setBundle = useStore((s) => s.setBundle)
  const setBundleError = useStore((s) => s.setBundleError)
  const setReducedMotion = useStore((s) => s.setReducedMotion)
  const [farmId, setFarmId] = useState<string>(FARMS[0].id)
  const [skipped, setSkipped] = useState<string[]>([])

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(motion.matches)
    sync()
    motion.addEventListener('change', sync)
    return () => motion.removeEventListener('change', sync)
  }, [setReducedMotion])

  useEffect(() => {
    let alive = true
    const chosen = FARMS.find((f) => f.id === farmId) ?? FARMS[0]
    loadBundle([chosen.path, FALLBACK_PATH])
      .then((loaded) => {
        if (!alive) return
        setSkipped(loaded.skipped)
        setBundle(loaded.bundle)
      })
      .catch((error: unknown) => {
        if (alive) setBundleError(error instanceof Error ? error.message : String(error))
      })
    return () => { alive = false }
  }, [farmId, setBundle, setBundleError])

  if (bundleError) {
    return <div className="state-screen"><div className="state-panel"><span aria-hidden="true">✺</span><h1>The field journal could not open.</h1><p>{bundleError}</p><p>Run <code>python scripts/make_fixture.py</code> in backend/ first.</p></div></div>
  }
  if (!bundle) {
    return <div className="state-screen"><div className="state-panel" role="status"><span aria-hidden="true">✺</span><h1>Gathering the seasons…</h1><p>Opening the field journal.</p></div></div>
  }
  return <Workspace bundle={bundle} skipped={skipped} farmId={farmId} onSelectFarm={setFarmId} />
}

function Workspace({ bundle, skipped, farmId, onSelectFarm }: {
  bundle: Bundle
  skipped: string[]
  farmId: string
  onSelectFarm: (id: string) => void
}) {
  const field = useMemo(() => buildFieldModel(bundle), [bundle])
  const facts = useMemo(() => fieldFacts(field), [field])
  const finding = useMemo(() => findingSentence(bundle), [bundle])
  const persona = personaFor(bundle)
  const synthetic = bundle.provenance.is_synthetic ?? false
  const clim = bundle.climatology
  const {
    selectedRotationId, selectRotation, hoveredDoy, setHoveredDoy, selectedDoy, setSelectedDoy,
    draggingSpeciesId, setDraggingSpecies, placedFills, addPlacedFill, removePlacedFill, resetPlacedFills,
    reducedMotion, rusleB, phaseKey, setPhaseKey,
  } = useStore()
  const [initialMode] = useState(pickInitialMode)
  const [mode, setMode] = useState<'2D' | '3D'>(initialMode)
  const [placementMessage, setPlacementMessage] = useState<string | null>(null)

  // Open on the crop year where the hole is clearest.
  useEffect(() => setPhaseKey(defaultPhaseKey(field)), [field, setPhaseKey])

  // Nothing can be drilled into a field that still has a crop standing on
  // it. The backend gates its own fit on the observed harvest; the client
  // fit uses the same gate (field.earliestSeedDoy) or the UI recommends
  // seeding cereal rye on 15 Aug, six weeks before this field's 29 Sep harvest.
  const fits = useMemo(
    () => (field.mainGap ? rankSpeciesForGap(field.species, field.mainGap, field.slice, field.observedCurves, rusleB, field.earliestSeedDoy) : []),
    [field, rusleB],
  )
  const fitById = useMemo(() => new Map(fits.map((fit) => [fit.speciesId, fit])), [fits])
  const speciesById = useMemo(() => new Map(field.species.map((s) => [s.id, s])), [field])
  const tierOf = (fit: FitResult) => tierLabel(evidenceTier(field, fit.speciesId, fit.curveSource), bundle.crop_curves[fit.speciesId]?.n_fields)

  // What is proposed: the user's own plan, else a preset rotation, else nothing.
  const selected = bundle.rotations.find((r) => r.id === selectedRotationId && !r.is_current) ?? null
  const presetCurves = useMemo(() => (selected ? rotationFillCurves(field, selected) : null), [field, selected])
  const customFits = useMemo(() => placedFills.map((id) => fitById.get(id)).filter(usableFit), [placedFills, fitById])
  const proposalCurves = useMemo(() => (customFits.length ? customFits.map((fit) => fit.coverCurve) : presetCurves ?? []), [customFits, presetCurves])
  const proposing = customFits.length > 0 || selected !== null
  // A preset the client cannot rebuild exactly is shown only as the bundle's own average curve.
  const averageOnly = selected !== null && customFits.length === 0 && presetCurves === null

  // The headline and the planner must both be the bundle's phase-averaged
  // figures, NOT counts taken off the mean cover curve. Thresholding a mean
  // is not the mean of the thresholds: Story County reads 110 instead of 104
  // that way, and Monona reads 0 for a field that is bare 14 days after corn.
  const baseline = useMemo(() => scoreCover(field, [], rusleB), [field, rusleB])
  const proposed: CoverScore = useMemo(
    () => (averageOnly && selected
      ? { bareDays: selected.bare_days, bareDaysByPhase: selected.bare_days_by_phase ?? null, exposedR: selected.exposed_r }
      : scoreCover(field, proposalCurves, rusleB)),
    [averageOnly, selected, field, proposalCurves, rusleB],
  )
  const phaseSplit = facts.byPhase.length ? facts.byPhase.map((p) => `${p.days} after ${p.key}`).join(', ') : null

  // What the ring draws: one crop year (or the average), plus the proposal.
  const phase = averageOnly ? null : field.phases.find((p) => p.key === phaseKey) ?? null
  const baseCover: number[] = phase ? phase.cover : clim.soil_cover
  const ringCover = useMemo(
    () => (averageOnly && selected ? selected.soil_cover : proposalCurves.length ? spliceRotationCover(baseCover, proposalCurves) : baseCover),
    [averageOnly, selected, proposalCurves, baseCover],
  )

  const pickedFit = draggingSpeciesId ? fitById.get(draggingSpeciesId) : undefined
  const plantingDoys = useMemo(() => {
    const species = pickedFit ? speciesById.get(pickedFit.speciesId) : undefined
    return pickedFit?.feasible && species && field.mainGap
      ? candidateSeedDoys(species, field.mainGap, PRE_GAP_SEEDING_DAYS, field.earliestSeedDoy)
      : []
  }, [pickedFit, speciesById, field])

  const placeCrop = (day: number) => {
    if (!draggingSpeciesId) return
    const decision = placeDecision(fitById.get(draggingSpeciesId), speciesById.get(draggingSpeciesId), field.mainGap ?? undefined, day, field.earliestSeedDoy)
    setPlacementMessage(decision.reason)
    if (!decision.accepted) return
    addPlacedFill(draggingSpeciesId)
    setDraggingSpecies(null)
  }

  const switchFarm = (id: string) => {
    if (id === farmId) return
    // A plan or a preset belongs to the field it was made on.
    selectRotation(null)
    resetPlacedFills()
    setDraggingSpecies(null)
    setPlacementMessage(null)
    onSelectFarm(id)
  }

  const season = seasonAtDoy(selectedDoy)
  const hoverObs = hoveredDoy ? clim.n_obs_per_doy[hoveredDoy - 1] : 0
  const hoverText = hoveredDoy
    ? `${doyToDate(hoveredDoy).label} · ${hoverObs > 0 ? `soil cover ${(ringCover[hoveredDoy - 1] * 100).toFixed(0)}%` : 'soil cover unknown'} · ${hoverObs} ${synthetic ? 'simulated samples' : 'satellite observations'}`
    : synthetic
      ? 'Interactive synthetic sample. No satellite cover observations are claimed.'
      : 'Hover or select a day to read the field. The painted season is decoration; the numbers are data.'
  // A day can read covered on the average and still sit inside a gap that is
  // bare in one phase. Give the per-phase figures and say what the ring shows.
  const phaseCaption = field.phases.length > 1
    ? `This day by rotation phase: ${field.phases.map((p) => `${p.key} ${(p.cover[selectedDoy - 1] * 100).toFixed(0)}% (${p.cover[selectedDoy - 1] < BARE_THRESHOLD ? 'bare' : 'covered'})`).join(' · ')}. ${phase ? `The ring is showing the ${phase.key} year.` : 'The ring shows their mean, so a day can read covered here and still sit inside a gap that is bare in one phase.'}`
    : null

  const ringProps = {
    showLegend: false,
    soilCover: ringCover,
    erosivity: clim.erosivity_r,
    nObs: clim.n_obs_per_doy,
    frostProb: clim.frost_prob,
    // Green and residue evidence exist only for the all-years average.
    greenCover: phase ? undefined : clim.green_cover,
    residueCover: phase ? undefined : clim.residue_cover,
    compareCover: proposing ? baseCover : undefined,
    highlightDoys: plantingDoys.length ? plantingDoys : undefined,
    yearLabel: phase ? phase.label : 'Average year',
    selectedDoy,
    onHoverDay: setHoveredDoy,
    onSelectDay: setSelectedDoy,
    onActivateDay: (day: number) => { if (draggingSpeciesId) placeCrop(day) },
    onModeChange: setMode,
    reducedMotion,
    synthetic,
  }

  return <div className="site-shell" data-season={season} id="top">
    {synthetic && <div className="fixture-banner" role="status"><span>✳</span> SYNTHETIC SAMPLE — simulated soil cover; no satellite observations. <span>✳</span>{skipped.length > 0 && <small className="fixture-detail">Real field bundle unavailable: {skipped.join(' · ')}</small>}</div>}
    <nav className="topbar" aria-label="Site navigation">
      <a className="brand" href="#top"><span className="brand-seal" aria-hidden="true">✺</span><span>Fallow Clock<small>THE LIVING YEAR</small></span></a>
      <div className="top-links"><a href="#year">The year</a><a href="#planner">The decision</a><a href="#evidence">Evidence</a></div>
      <AudioAtmosphere doy={selectedDoy} />
    </nav>

    <header className="workspace-intro" id="year">
      <div className="overview-copy">
        <span className="eyebrow">✦ THE LIVING YEAR · {bundle.farm.place}</span>
        <h1>Find the <em>hole</em> in your year.</h1>
        <p>{finding ?? 'Explore soil cover, rainfall erosivity, and the seasons around one field.'}</p>
        <div className="farm-switch" role="group" aria-label="Choose a field">
          {FARMS.map((f) => <button type="button" key={f.id} onClick={() => switchFarm(f.id)} aria-pressed={farmId === f.id} className={farmId === f.id ? 'is-active' : ''}>{f.label}</button>)}
        </div>
        <small>{synthetic ? 'Interactive sample field' : persona ? persona.disclosure : bundle.observed_rotation.inferred_label} · {bundle.farm.area_ha} ha</small>
      </div>
      <div className="field-summary overview-summary" aria-label="Field overview">
        <div>
          <span className="eyebrow">{synthetic ? 'From this sample' : 'Bare soil, typical year'}</span>
          <strong>{facts.bareDays} <small>days</small></strong>
          <p>{phaseSplit ?? `of ${synthetic ? 'simulated' : 'observed'} bare soil expected per year`}{facts.unknownDays > 0 ? ` · ${facts.unknownDays} days unobserved` : ''}</p>
        </div>
        <div>
          <span className="eyebrow">Rain on bare soil</span>
          <strong>{facts.gapSharePct}<small>%</small></strong>
          <p>of the year&rsquo;s erosive rain falls in the main bare gap</p>
        </div>
      </div>
    </header>

    <main className="workspace-main">
      <div className="main-grid">
        <section className="ring-column" aria-label="Interactive agricultural calendar">
          {field.phases.length > 0 && <PhaseToggle phases={facts.byPhase} active={phase?.key ?? null} onChange={setPhaseKey} locked={averageOnly} />}
          <div className="hero-world" data-season={season} data-mode={mode} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setPlacementMessage('Drop the packet onto a highlighted day on the wheel, or use “Place at suggested date”.') }}>
            <Suspense fallback={null}><SeasonalWorld doy={selectedDoy} /></Suspense>
            <ErrorBoundary fallback={<YearRing {...ringProps} initialMode="2D" />}>
              <YearRing {...ringProps} initialMode={initialMode} />
            </ErrorBoundary>
          </div>
          <TimeLever doy={selectedDoy} onChange={setSelectedDoy} />
          {placementMessage && <p className="placement-message" role="status">{placementMessage}</p>}
        </section>

        <aside className="planner-column" id="planner">
          <RotationCompare field={field} selectedId={selected?.id ?? null} onSelect={(id) => { selectRotation(id); setPlacementMessage(null) }} />
          <CropPlanner species={field.species} fits={fits} picked={draggingSpeciesId} placed={placedFills} onPick={setDraggingSpecies} onPlace={() => pickedFit && placeCrop(pickedFit.seedDoy)} onRemove={removePlacedFill} onReset={resetPlacedFills} baseline={baseline} proposed={proposed} tierOf={tierOf} />
          <details className="sidebar-section sidebar-day" open><summary>Selected day &amp; climate</summary>
            <AtmosphereReadout doy={selectedDoy} climate={{ ...clim, soil_cover: baseCover }} synthetic={synthetic} />
            <p className="ring-caption">{hoverText}</p>
            {phaseCaption && <p className="ring-caption phase-caption">{phaseCaption}</p>}
          </details>
        </aside>
      </div>
      <FieldNotes field={field} fits={fits} />
    </main>
    <footer className="site-footer"><span className="footer-mark" aria-hidden="true">✺</span><div><strong>Fallow Clock</strong><small>A living view of the agricultural year.</small></div><p>Seasonal artwork illustrates time and atmosphere. Field values and planning estimates come from the loaded data bundle.</p><nav aria-label="Footer navigation"><a href="#year">The year</a><a href="#planner">The decision</a><a href="#evidence">Evidence</a><a href="#top">Back to top ↑</a></nav></footer>
  </div>
}
