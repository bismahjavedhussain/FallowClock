/** Seasonal application shell. Scientific values always come from the bundle. */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import YearRing from './components/YearRing'
import TimeLever from './components/TimeLever'
import CropPlanner from './components/CropPlanner'
import AudioAtmosphere from './components/seasonal/AudioAtmosphere'
import AtmosphereReadout from './components/seasonal/AtmosphereReadout'
import PhaseYearChart from './components/PhaseYearChart'
import ShiftReadout from './components/ShiftReadout'
import type { ClimateTrend } from './types/bundle'
import FarmerGuide from './components/FarmerGuide'
import FieldNotes from './components/FieldNotes'
import SoilCutaway from './components/soil/SoilCutaway'
import SplitCore from './components/soil/SplitCore'
import SkipNarration from './components/SkipNarration'
import NarrationToggle from './components/NarrationToggle'
import { planScenario, PLAN_ID } from './lib/plan'
import { syncDetails } from './lib/syncDetails'
import RotationCompare from './components/RotationCompare'
import SlideDeck from './components/SlideDeck'
import PhaseToggle from './components/PhaseToggle'
import { sourceLines } from './lib/sources'
import SatelliteIntro from './components/SatelliteIntro'
import FarmerIntro from './components/FarmerIntro'
import { buildIntroBeats } from './lib/intro'
import FarmerThinking from './components/FarmerThinking'
import FieldDiaryModal from './components/FieldDiaryModal'
import LegendFlyout from './components/LegendFlyout'
import TelemetryMesh from './components/TelemetryMesh'
import { buildInsights, thinkingLines } from './lib/insights'
import type { DiaryEntry } from './components/FarmerDiary'
import { buildActs, gapHeadline } from './lib/acts'
import { guideLine } from './lib/guide'
import type { GuideContext } from './lib/guide'
import { playChime, playDeny, playSeedDrop, playSwitch, playTick, primeOnFirstGesture, setSoundEnabled as setEngineSound } from './lib/sound'
import { PRE_GAP_SEEDING_DAYS, RUSLE_B_DEFAULT, candidateSeedDoys, rankSpeciesForGap, spliceRotationCover } from './lib/cropFit'
import { placeDecision, proposalPreview } from './lib/proposal'
import type { ClimatologySlice, Gap, Species } from './lib/cropFit'
import { useStore } from './store'
import { seasonAtDoy } from './lib/seasons'
import { doyToDate } from './components/YearRing'

const SeasonalWorld = lazy(() => import('./components/seasonal/SeasonalWorld'))

interface Rotation {
  id: string
  label: string
  is_current: boolean
  soil_cover: number[]
  /** e.g. ["corn","cereal_rye","soybean","cereal_rye"] */
  sequence: string[]
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
    erosivity_peak_doy: number
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
  crop_curves: Record<string, { green_cover: number[]; n_fields: number; detection: string; source?: string }>
  uncertainty: { field: string; level: string; reason: string; affects: string }[]
  /** How the weather has moved across the record. See lib trends. */
  trends?: ClimateTrend[]
}

/**
 * Both observed fields are selectable. Showing only one wastes the most
 * useful thing the tool does: run the same model on two real fields in the
 * same state and get opposite answers. Story County needs a cover crop.
 * Monona County is already conservation tillage and the honest answer there
 * is "nothing to do" -- which is worth more than a recommendation we made up.
 */
const FARMS = [
  { id: 'story-county-ia', label: 'Story County', url: '/bundles/farm_story-county-ia.json' },
  { id: 'monona-county-ia', label: 'Monona County', url: '/bundles/farm_monona-county-ia.json' },
] as const

/** Only reached if both observed bundles fail to load; carries a red banner. */
const FALLBACK_URL = '/bundles/farm_synthetic.json'

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const {
    selectedRotationId,
    selectRotation,
    setHoveredDoy,
    selectedDoy,
    setSelectedDoy,
    draggingSpeciesId,
    setDraggingSpecies,
    placedFills,
    addPlacedFill,
    removePlacedFill,
    resetPlacedFills,
    reducedMotion,
    setReducedMotion,
    soundEnabled,
    setSoundEnabled,
  } = useStore()
  const [mode, setMode] = useState<'2D' | '3D'>('3D')
  const [farmId, setFarmId] = useState<string>(FARMS[0].id)
  const [notesOpen, setNotesOpen] = useState(false)
  const [slide, setSlide] = useState(0)
  const [entered, setEntered] = useState(false)
  const [introDone, setIntroDone] = useState(false)
  const [briefDone, setBriefDone] = useState(false)
  const finishSatellite = useCallback(() => setIntroDone(true), [])
  const finishBrief = useCallback(() => setBriefDone(true), [])
  const setAudioStage = useStore((st) => st.setAudioStage)

  useEffect(() => {
    // Narration alone over the descent; a faded bed under the brief; the
    // full atmosphere once the tool is in the user's hands.
    setAudioStage(!introDone ? 'intro' : !briefDone ? 'brief' : 'tool')
  }, [introDone, briefDone, setAudioStage])
  const [storm, setStorm] = useState(0)
  /** Which crop year the ring draws. null = the averaged curve. */
  const [activePhase, setActivePhase] = useState<string | null>(null)
  const [diary, setDiary] = useState<DiaryEntry[]>([])
  const [diaryOpen, setDiaryOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // The dial's bottom-right corner. Both pills render into this one box so
  // the space between them is a flex `gap` and not two guesses.
  const [dialCorner, setDialCorner] = useState<HTMLDivElement | null>(null)
  const [writing, setWriting] = useState(false)
  const writeTimer = useRef(0)
  const stormTimers = useRef<number[]>([])
  // What the farmer should react to. Cleared after a few seconds so the
  // bubble falls back to describing whatever day you are standing on.
  const [guideEvent, setGuideEvent] = useState<{ type: GuideContext['event']; detail?: string; nonce: number }>({ type: 'idle', nonce: 0 })

  useEffect(() => {
    if (guideEvent.type === 'idle') return
    const t = window.setTimeout(() => setGuideEvent({ type: 'idle', nonce: 0 }), 4200)
    return () => window.clearTimeout(t)
  }, [guideEvent])
  const [placementMessage, setPlacementMessage] = useState<string | null>(null)

  // Audio is on from the start, but a context made before any gesture is
  // born suspended. Prime it so the first click anywhere wakes it.
  useEffect(() => { primeOnFirstGesture() }, [])

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(motion.matches)
    sync()
    motion.addEventListener('change', sync)
    return () => motion.removeEventListener('change', sync)
  }, [setReducedMotion])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const chosen = FARMS.find((f) => f.id === farmId) ?? FARMS[0]
      for (const url of [chosen.url, FALLBACK_URL]) {
        try {
          const r = await fetch(url)
          if (r.ok) {
            const next = await r.json()
            if (!cancelled) {
              setBundle(next)
              setError(null)
            }
            return
          }
        } catch {
          // try the fallback
        }
      }
      if (!cancelled) setError(`Could not load ${chosen.label}. Tried: ${chosen.url}`)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [farmId])

  useEffect(() => {
    setGuideEvent({ type: 'farm', nonce: Date.now() })
    const narrationOn = useStore.getState().narrationEnabled
    if (narrationOn) {
      setIntroDone(false)
      setBriefDone(false)
    } else {
      setIntroDone(true)
      setBriefDone(true)
    }
    setSlide(0)
    setActivePhase(null)
    // The session belongs to the field it happened on. Without this, a
    // rye placement made on Story County survived the switch to Monona --
    // so the diary read "Sowed Cereal rye, -27% erosion exposure" while
    // the panel beside it said nothing is worth seeding here, and the
    // proposal arrows showed Story's crop scored against Monona's year.
    // Switching fields has to rewrite everything, the session included.
    setDiary([])
    setWriting(false)
    // Reached through getState() rather than the destructured actions.
    // Listing those in the deps made this effect's identity depend on the
    // store, and this effect RESETS THE WHOLE INTRO -- introDone,
    // briefDone, the slide. One stray re-run mid-brief tears the user
    // back to the start of a sequence they cannot then finish. The only
    // thing that may retrigger a session reset is the farm changing.
    useStore.getState().resetPlacedFills()
    useStore.getState().selectRotation(null)
  }, [farmId])

  const clim = bundle?.climatology
  const current = bundle?.rotations.find((r) => r.is_current)

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

  // The worst single day in 25 years of NASA POWER rainfall. The storm
  // button jumps here rather than inventing weather: the point is to show
  // how each rotation handles a storm this field has really had.
  const worstStormDoy = useMemo(() => {
    const r = clim?.erosivity_r
    if (!r?.length) return 1
    let best = -Infinity
    let idx = 0
    r.forEach((v, i) => {
      if (v > best) {
        best = v
        idx = i
      }
    })
    return idx + 1
  }, [clim])

  useEffect(() => () => {
    stormTimers.current.forEach((t) => window.clearTimeout(t))
    window.clearTimeout(writeTimer.current)
  }, [])

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

  const accepted = useMemo(
    () => placedFills.map((id) => fitById.get(id)).filter((fit) => fit?.feasible && fit.coverCurve.length === 365),
    [placedFills, fitById],
  )

  const planCandidate = useMemo(() => {
    if (!current || !clim) return null
    const plans = planScenario({
      fits: accepted,
      baseCover: current.soil_cover,
      erosivity: clim.erosivity_r,
      nObs: clim.n_obs_per_doy,
      phaseCovers,
    })
    if (!plans.length) return null
    const p = plans[0]
    return {
      id: p.id,
      label: p.label,
      is_current: false,
      soil_cover: p.soilCover,
      bare_days: p.bareDays,
      bare_days_by_phase: p.bareDaysByPhase,
      added_seed_cost_usd_ha: p.seedCostUsdHa,
      delta_vs_current_pct: p.deltaPct,
      n_credit_kg_ha: p.nCreditKgHa,
      sequence: [],
    }
  }, [current, clim, accepted, phaseCovers])

  const selected = useMemo(
    () =>
      selectedRotationId === PLAN_ID
        ? planCandidate
        : bundle?.rotations.find((r) => r.id === selectedRotationId) ?? null,
    [selectedRotationId, planCandidate, bundle],
  )

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

  // Both the header sentence and the Act copy now come from lib/acts.ts,
  // which derives every figure from the bundle and is unit-tested. Switching
  // farms rewrites the story instead of leaving stale numbers behind.
  const actInput = {
    place: bundle.farm.place,
    bareDays: current.bare_days,
    bareDaysByPhase: current.bare_days_by_phase ?? null,
    phaseLabels,
    gap: bundle.gaps[0] ?? null,
    erosivityPeakDoy: clim.erosivity_peak_doy,
    alternatives: bundle.rotations
      .filter((r) => !r.is_current)
      .map((r) => ({
        label: r.label,
        bareDays: r.bare_days,
        deltaPct: r.delta_vs_current_pct,
        seedCostUsdHa: r.added_seed_cost_usd_ha,
      }))
      .sort((a, b) => a.deltaPct - b.deltaPct),
    format: (doy: number) => doyToDate(doy).label,
  }
  const introBeats = buildIntroBeats({
    place: bundle.farm.place,
    ownerName: bundle.farm.owner_name,
    bareDays: current.bare_days,
    bareDaysByPhase: current.bare_days_by_phase ?? null,
    phaseLabels,
    gap: bundle.gaps[0] ?? null,
    erosivityPeakDoy: clim.erosivity_peak_doy,
    best: actInput.alternatives[0] ?? null,
    format: (doy: number) => doyToDate(doy).label,
  })
  const insightInput = {
    place: bundle.farm.place,
    areaHa: bundle.farm.area_ha,
    bareDays: current.bare_days,
    bareDaysByPhase: current.bare_days_by_phase ?? null,
    phaseLabels,
    gap: bundle.gaps[0] ?? null,
    erosivityPeakDoy: clim.erosivity_peak_doy,
    rotations: bundle.rotations.map((r) => ({
      label: r.label,
      isCurrent: r.is_current,
      bareDays: r.bare_days,
      deltaPct: r.delta_vs_current_pct,
      seedCostUsdHa: r.added_seed_cost_usd_ha,
      nCreditKgHa: r.n_credit_kg_ha,
    })),
    ryeSource: bundle.crop_curves?.cereal_rye?.source,
    bareDaysBand: null,
    format: (doy: number) => doyToDate(doy).label,
  }
  const insights = buildInsights(insightInput)
  const thinking = thinkingLines(insightInput)

  const headline = gapHeadline(actInput)
  const acts = buildActs(actInput)

  // Scrubbing the wheel should tick like the time lever does. playTick
  // throttles itself, so wrapping the setter is safe at pointer-move rates.
  const scrubTo = (doy: number) => {
    playTick()
    setSelectedDoy(doy)
  }

  const logDiary = (text: string, doy = selectedDoy) => {
    setDiary((d) => [{ id: `${Date.now()}`, stamp: doyToDate(doy).label, text }, ...d].slice(0, 12))
    // Hold the pen for as long as the diary takes to type the line out
    // (22 ms a character), so sprite and text finish together.
    setWriting(true)
    window.clearTimeout(writeTimer.current)
    writeTimer.current = window.setTimeout(() => setWriting(false), Math.min(4000, 700 + text.length * 22))
  }

  const runStorm = () => {
    stormTimers.current.forEach((t) => window.clearTimeout(t))
    stormTimers.current = []
    playSwitch()
    scrubTo(worstStormDoy)
    setStorm(1)
    // Build, hold, clear. Three timeouts beat a rAF ramp here: nothing
    // reads the intermediate values, only CSS transitions do.
    stormTimers.current.push(window.setTimeout(() => setStorm(0.5), 2800))
    stormTimers.current.push(window.setTimeout(() => setStorm(0), 4400))
    logDiary(`Ran the heaviest storm on record (${doyToDate(worstStormDoy).label}).`, worstStormDoy)
    setGuideEvent({
      type: 'denied',
      detail: `This is ${doyToDate(worstStormDoy).label} \u2014 the heaviest rain in the whole record. Watch the bare ground.`,
      nonce: Date.now(),
    })
  }

  // A phase is a real year; the average is a curve no year followed. When
  // a phase is picked, everything downstream draws THAT year -- otherwise
  // the toggle would relabel the same mean curve and mean nothing.
  const phaseIndex = activePhase && phaseLabels ? phaseLabels.indexOf(activePhase) : -1
  const phaseBase = phaseIndex >= 0 && phaseCovers ? phaseCovers[phaseIndex] : null

  const baselineCover = selected?.soil_cover ?? current.soil_cover

  // The figures in the seeding panel are averaged over the real rotation
  // phases, never read off the mean curve -- see the Jensen note on
  // proposalPreview. Without this the panel printed 110 bare days three
  // lines under a card reading 104, and on Monona it printed 0 for a field
  // with 7 real bare days. The phase covers belong to the OBSERVED
  // rotation, so the panel always measures from the real field; a
  // hypothetical rotation picked in Act four has its own figures beside it
  // there and must not silently become the baseline here.
  const metricPhases = phaseCovers && phaseCovers.length
    ? (phaseIndex >= 0 ? [phaseCovers[phaseIndex]] : phaseCovers)
    : null
  const { cover: ringCover, baselineBare, proposedBare, baselineExposure, proposedExposure } = proposalPreview(baselineCover, accepted as NonNullable<typeof accepted[number]>[], clim.erosivity_r, clim.n_obs_per_doy, metricPhases)

  const placeCrop = (day: number, speciesId = draggingSpeciesId) => {
    if (!speciesId) return
    const fit = fitById.get(speciesId)
    const species = bundle.species.find((s) => s.id === speciesId)
    const decision = placeDecision(fit, species, bundle.gaps[0], day, earliestSeedDoy)
    if (!decision.accepted) {
      playDeny()
      setGuideEvent({ type: 'denied', detail: decision.reason, nonce: Date.now() })
      setPlacementMessage(decision.reason)
      return
    }
    playSeedDrop()
    logDiary(
      fit
        ? `Sowed ${fit.speciesName} on day ${day}. Model says −${fit.pctReduction.toFixed(0)}% erosion exposure in this gap (${fit.curveSource} curve).`
        : `Sowed ${speciesId} on day ${day}.`,
    )
    // The chime is the reward, so it only fires when the placement actually
    // buys something. A crop that changes nothing gets the thud alone.
    if ((fit?.deltaExposedR ?? 0) > 0) window.setTimeout(playChime, 190)
    addPlacedFill(speciesId)
    setDraggingSpecies(null)
    setGuideEvent({ type: 'placed', nonce: Date.now() })
    setPlacementMessage(decision.reason)
  }

  // Soil thickening: how much of the baseline bare ground the current
  // proposal has closed, 0..1. Drives a green wash over the field art and a
  // pulse on the wheel, so placing a crop is felt and not only tabulated.
  const lush = baselineBare > 0 ? Math.max(0, Math.min(1, (baselineBare - proposedBare) / baselineBare)) : 0

  const acceptedCurves = (accepted as NonNullable<typeof accepted[number]>[]).map((f) => f.coverCurve)
  const shownCover = phaseBase
    ? (acceptedCurves.length ? spliceRotationCover(phaseBase, acceptedCurves) : phaseBase)
    : ringCover
  const shownBareDays =
    phaseIndex >= 0 && current.bare_days_by_phase
      ? current.bare_days_by_phase[phaseIndex]
      : current.bare_days

  // The wheel draws the mean curve when no phase is picked, and a gap found
  // on that mean is shorter than the real one -- 72 days against the 83 the
  // bundle reports, because the union of the two phases' gaps is wider than
  // the gap in their average. Hand it the bundle's own gap instead. With a
  // phase picked the wheel is drawing a real year, so let it find its own.
  const wheelGap = phaseIndex >= 0 || !bundle.gaps[0]
    ? null
    : {
        startDoy: bundle.gaps[0].start_doy,
        endDoy: bundle.gaps[0].end_doy,
        nDays: bundle.gaps[0].n_days,
        wraps: bundle.gaps[0].wraps_year,
      }

  const livingCover = accepted.length
    ? spliceRotationCover(clim.green_cover, (accepted as NonNullable<typeof accepted[number]>[]).map((f) => f.coverCurve))
    : clim.green_cover

  const guide = guideLine({
    place: bundle.farm.place,
    doy: selectedDoy,
    cover: clim.n_obs_per_doy[selectedDoy - 1] > 0 ? ringCover[selectedDoy - 1] : null,
    erosivity: clim.erosivity_r[selectedDoy - 1] ?? 0,
    erosivityMax: Math.max(...clim.erosivity_r),
    gap: bundle.gaps[0] ?? null,
    bareDays: current.bare_days,
    baselineBare,
    proposedBare,
    picked: pickedFit
      ? { name: pickedFit.speciesName, feasible: pickedFit.feasible, reason: pickedFit.reason, seedDoy: pickedFit.seedDoy }
      : null,
    placedCount: placedFills.length,
    act: slide,
    phases:
      phaseCovers && phaseLabels && phaseCovers.length === phaseLabels.length
        ? phaseCovers.map((pc, i) => ({ label: phaseLabels[i], cover: pc[selectedDoy - 1] ?? 0 }))
        : null,
    moisture: clim.soil_moisture[selectedDoy - 1],
    best: actInput.alternatives[0] ?? null,
    event: guideEvent.type,
    eventDetail: guideEvent.detail,
  })

  const SLIDES = [
    { id: 'year', eyebrow: 'Act one', label: 'The crisis' },
    { id: 'desk', eyebrow: 'Act two', label: "The farmer's desk" },
    { id: 'soil', eyebrow: 'Act three', label: 'The root zone' },
    { id: 'futures', eyebrow: 'Act four', label: 'Three futures' },
  ]
  const actCopy = acts[slide] ?? acts[0]

  return <div
    className="site-shell is-deck"
    data-season={seasonAtDoy(selectedDoy)}
    data-act={SLIDES[slide]?.id}
    /* Lets the CSS stop the deck doing any rendering work while the
       opening covers it -- see .site-shell[data-intro='playing']. */
    data-intro={briefDone ? 'done' : 'playing'}
    id="top"
  >

    {bundle.provenance.is_synthetic && <div className="fixture-banner" role="status"><span>&#10035;</span> SYNTHETIC SAMPLE &mdash; simulated soil cover; no satellite observations. <span>&#10035;</span></div>}

    <header className="topbar" aria-label="Fallow Clock">
      <a className="brand" href="#top" onClick={() => setMobileMenuOpen(false)}><span className="brand-seal" aria-hidden="true">&#10042;</span><span>Fallow Clock<small>THE LIVING YEAR</small></span></a>
      <h1 className="topbar-title">{slide === 0 ? <>Find the <em>hole</em> in your year.</> : actCopy.title}</h1>
      <div className="farm-switch" role="group" aria-label="Choose a field">{FARMS.map((f) => <button type="button" key={f.id} onClick={() => { playSwitch(); setFarmId(f.id) }} aria-pressed={farmId === f.id} className={farmId === f.id ? 'is-active' : ''}>{f.label}</button>)}</div>
      <button type="button" className="notes-trigger" onClick={() => { playSwitch(); setNotesOpen(true) }} aria-haspopup="dialog" title={`${bundle.uncertainty.length} known limits of this data: what we measured, modelled, and do not know`}>Field notes <span>{bundle.uncertainty.length}</span></button>
      <div className="topbar-actions">
        <div className="topbar-audio-tablet">
          <NarrationToggle onStopNarration={() => {
            setIntroDone(true)
            setBriefDone(true)
          }} />
          <AudioAtmosphere doy={selectedDoy} />
        </div>
        <button
          type="button"
          className="topbar-hamburger"
          onClick={() => { playSwitch(); setMobileMenuOpen((o) => !o) }}
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        >
          <span className="hamburger-icon" aria-hidden="true">{mobileMenuOpen ? '✕' : '☰'}</span>
          <span className="hamburger-label">{mobileMenuOpen ? 'Close' : 'Menu'}</span>
        </button>
      </div>
    </header>

    {mobileMenuOpen && (
      <>
        <div className="mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)} />
        <nav className="topbar-mobile-menu" aria-label="Mobile navigation">
          <div className="mobile-menu-head">
            <span className="eyebrow">Menu &amp; Navigation</span>
            <button
              type="button"
              className="mobile-menu-close"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation menu"
            >
              &times;
            </button>
          </div>

          {/* Acts Navigation for Mobile & Tablet */}
          <div className="mobile-menu-section mobile-acts-section">
            <span className="mobile-section-label">Jump to Act</span>
            <div className="mobile-acts-list">
              {SLIDES.map((s, i) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => {
                    playSwitch()
                    setSlide(i)
                    setMobileMenuOpen(false)
                  }}
                  className={`mobile-act-btn ${slide === i ? 'is-active' : ''}`}
                >
                  <span className="mobile-act-num">Act {i + 1}</span>
                  <span className="mobile-act-label">{s.label}</span>
                  {slide === i && <span className="mobile-act-current" aria-hidden="true">Active</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Sound & Narration Controls for Mobile */}
          <div className="mobile-menu-section mobile-audio-section">
            <span className="mobile-section-label">Sound &amp; Narration</span>
            <div className="mobile-audio-controls">
              <div className="mobile-audio-row">
                <span className="mobile-audio-label">Voice Narration</span>
                <NarrationToggle onStopNarration={() => {
                  setIntroDone(true)
                  setBriefDone(true)
                }} />
              </div>
              <div className="mobile-audio-row">
                <span className="mobile-audio-label">Atmospheric Sound</span>
                <button
                  type="button"
                  className="mobile-sound-toggle-btn"
                  aria-pressed={soundEnabled}
                  onClick={() => {
                    playSwitch()
                    const next = !soundEnabled
                    setEngineSound(next)
                    setSoundEnabled(next)
                  }}
                >
                  {soundEnabled ? 'Sound On 🔊' : 'Sound Off 🔇'}
                </button>
              </div>
            </div>
          </div>

          <div className="mobile-menu-section">
            <span className="mobile-section-label">Select Field</span>
            <div className="mobile-farm-switch">
              {FARMS.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  onClick={() => {
                    playSwitch()
                    setFarmId(f.id)
                    setMobileMenuOpen(false)
                  }}
                  className={`mobile-farm-btn ${farmId === f.id ? 'is-active' : ''}`}
                >
                  <span className="farm-check" aria-hidden="true">{farmId === f.id ? '✓ ' : ''}</span>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mobile-menu-section">
            <span className="mobile-section-label">Documentation</span>
            <button
              type="button"
              className="mobile-notes-btn"
              onClick={() => {
                playSwitch()
                setNotesOpen(true)
                setMobileMenuOpen(false)
              }}
            >
              <span>Field Notes &amp; Uncertainties</span>
              <span className="notes-badge">{bundle.uncertainty.length}</span>
            </button>
          </div>
          <div className="mobile-menu-foot">
            <p className="mobile-menu-act">
              <strong>Act {slide + 1}: {SLIDES[slide]?.label}</strong>
              <small>{actCopy.title}</small>
            </p>
          </div>
        </nav>
      </>
    )}

    {!entered && (
      <div className="enter-gate" role="dialog" aria-label="Start Fallow Clock">
        <TelemetryMesh />
        <div className="enter-card">
          <span className="eyebrow">NASA Space Apps 2026 &middot; Field Shift</span>
          <h1>Fallow Clock</h1>
          <p>Find the hole in your year.</p>
          <p className="enter-epigraph">Look down before you look up. The ground that feeds us is running out of cover.</p>
          <button
            type="button"
            className="enter-begin"
            onClick={() => {
              // The one gesture browsers require before audio can play.
              // Narration, typing and atmosphere are all unblocked here.
              setEngineSound(true)
              useStore.getState().setSoundEnabled(true)
              primeOnFirstGesture()
              setEntered(true)
              if (!useStore.getState().narrationEnabled) {
                setIntroDone(true)
                setBriefDone(true)
              }
            }}
          >
            &#9654; Begin
          </button>
          <small>Narrated. Best with sound on.</small>
          <small className="enter-credit">Built by team Moon Breaker</small>
        </div>
      </div>
    )}

    {/* A dumb, stateless plate under the whole opening sequence.
        The deck is always mounted, so any instant where neither the
        descent nor the brief is painting shows Act one through the gap --
        which is the split second of the wheel between the zoom and the
        farmer. The old cure was to pre-mount the brief underneath the
        descent, but that left a long-lived INACTIVE brief, and a stuck
        flag then stranded the farmer on screen with no text box.
        This is the cure without the cost: no state, no effects, no
        props. It cannot freeze, and it covers every gap in the handoff
        because it outlives both overlays. z-60 puts it under the brief
        (68) and the descent (70) and over everything in the deck. */}
    {entered && !briefDone && <div className="intro-backdrop" aria-hidden="true" />}

    {/* Mounted only ONCE THE DESCENT IS DONE.
        It used to mount underneath the descent so the deck could not
        flash through the cross-fade. That is no longer needed -- the
        descent now paints its own dark plate from the moment it mounts,
        so it covers the gap itself.
        Pre-mounting it cost more than it bought: it created a long-lived
        INACTIVE instance whose walk-in, typing and speech were all gated
        off, and a brief that is mounted but inactive is one stuck flag
        away from a farmer standing on screen with no text box and no way
        forward. With this gate the component only ever exists in its
        working state, and `active` is no longer a thing that can be
        wrong. */}
    {entered && introDone && !briefDone && (
      <FarmerIntro key={farmId} farmId={farmId} beats={introBeats} reducedMotion={reducedMotion} onDone={finishBrief} active />
    )}

    {entered && !introDone && (
      <SatelliteIntro key={farmId} farmId={farmId} place={bundle.farm.place} areaHa={bundle.farm.area_ha} rotationLabel={bundle.observed_rotation?.inferred_label ?? 'Corn-Soybean'} bareDays={current.bare_days} reducedMotion={reducedMotion} onDone={finishSatellite} />
    )}

    <SlideDeck slides={SLIDES} index={slide} onIndex={setSlide} reducedMotion={reducedMotion}>

      {/* ---------------- Act 1 - the crisis ---------------- */}
      <div className="act-pane pane-crisis">
        <div className="pane-grid">
          <div className="pane-main">
            <div className="hero-world" data-season={seasonAtDoy(selectedDoy)} data-mode={mode} data-lush={lush > 0.02 ? 'on' : 'off'} style={{ ['--lush' as string]: lush.toFixed(3) }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
              e.preventDefault()
              // Caught a drop that missed the wheel entirely -- the gap
              // between the panel edge and the ring, or the scene behind
              // it. Rather than scold, plant on the suggested date: the
              // user asked for this crop by dragging it here, and the
              // suggested day is the one the model would pick anyway.
              const id = e.dataTransfer.getData('text/plain') || draggingSpeciesId
              const fit = id ? fitById.get(id) : undefined
              if (fit?.feasible) placeCrop(fit.seedDoy, id!)
              else setPlacementMessage('That crop has no feasible fit on this field.')
            }}>
              <Suspense fallback={null}><SeasonalWorld doy={selectedDoy} storm={storm} /></Suspense>
              {phaseCovers && phaseLabels && phaseCovers.length === phaseLabels.length && current.bare_days_by_phase && (
                <div className="hero-phase-bar">
                  <PhaseToggle
                    phases={phaseLabels.map((label, i) => ({
                      key: label,
                      label: label.charAt(0).toUpperCase() + label.slice(1),
                      days: current.bare_days_by_phase![i],
                    }))}
                    active={activePhase}
                    onChange={(k) => { playSwitch(); setActivePhase(k) }}
                    locked={!!selected && !selected.is_current}
                  />
                </div>
              )}
              {selected && !selected.is_current && (
                <div className="rotation-preview-banner" role="status">
                  <span className="preview-tag">{selected.id === PLAN_ID ? 'Your Plan' : 'Candidate'}</span>
                  <span className="preview-label">
                    <strong>{selected.label}</strong>: {selected.bare_days} bare days ({selected.delta_vs_current_pct > 0 ? '+' : ''}{selected.delta_vs_current_pct.toFixed(0)}% vs baseline)
                  </span>
                  <button
                    type="button"
                    className="preview-reset"
                    onClick={() => { playSwitch(); selectRotation(null) }}
                    title="Return to current field rotation"
                  >
                    Return to current &times;
                  </button>
                </div>
              )}
              <YearRing initialMode="3D" cornerSlot={dialCorner} showLegend={false} bareDaysOverride={selected && phaseIndex < 0 ? selected.bare_days : shownBareDays} gapOverride={selected ? null : wheelGap} soilCover={shownCover} erosivity={clim.erosivity_r} nObs={clim.n_obs_per_doy} frostProb={clim.frost_prob} greenCover={clim.green_cover} residueCover={clim.residue_cover} compareCover={selected ? current.soil_cover : accepted.length ? baselineCover : undefined} highlightDoys={plantingDoys} selectedDoy={selectedDoy} onHoverDay={setHoveredDoy} onSelectDay={scrubTo} onActivateDay={(day) => draggingSpeciesId && placeCrop(day)} onModeChange={(m) => { playSwitch(); setMode(m) }} reducedMotion={reducedMotion} synthetic={bundle.provenance.is_synthetic} />
              <div className="dial-corner" ref={setDialCorner}>
                <LegendFlyout
                  open={legendOpen}
                  onOpen={() => { playSwitch(); setLegendOpen(true) }}
                  onClose={() => setLegendOpen(false)}
                />
              </div>
            </div>
            <TimeLever doy={selectedDoy} onChange={setSelectedDoy} />
            {lush > 0.02 && (
              <div className="lush-meter">
                <span style={{ width: `${Math.round(lush * 100)}%` }} />
                <small>{baselineBare - proposedBare} bare days closed</small>
              </div>
            )}
          </div>
          <aside className="pane-side">
            <FarmerThinking
              lines={thinking}
              reducedMotion={reducedMotion}
              active={briefDone && slide === 0}
              onOpenDiary={() => { playSwitch(); setSlide(1); setDiaryOpen(true) }}
            />
            <div className="field-summary" aria-label="Field overview">
              <div>
                <span className="eyebrow">{selected && !selected.is_current ? 'Candidate rotation' : bundle.provenance.is_synthetic ? 'From this sample' : 'From this field'}</span>
                <strong>{selected && !selected.is_current ? selected.bare_days : shownBareDays} <small>days</small></strong>
                <p>{selected && !selected.is_current ? `expected bare in ${selected.label}` : activePhase ? `bare in a ${activePhase} year` : (phaseSplit ?? 'of bare soil expected per year')}</p>
              </div>
              <div><span className="eyebrow">Erosivity overlap</span><strong>{Math.round((bundle.gaps[0]?.share_of_annual_r ?? 0) * 100)}<small>%</small></strong><p>of annual erosivity overlaps the largest bare gap</p></div>
            </div>
            <CropPlanner species={bundle.species} fits={ranked} picked={draggingSpeciesId} placed={placedFills} onPick={setDraggingSpecies} onPlace={() => pickedFit && placeCrop(pickedFit.seedDoy)} onRemove={removePlacedFill} onReset={resetPlacedFills} baselineBare={baselineBare} proposedBare={proposedBare} baselineExposure={baselineExposure} proposedExposure={proposedExposure} hasProposal={accepted.length > 0} phaseNote={phaseIndex >= 0 && phaseLabels ? `in a ${phaseLabels[phaseIndex]} year` : (metricPhases ? 'averaged over both rotation years' : null)} />
            {placementMessage && <p className="placement-message" role="status">{placementMessage}</p>}
          </aside>
        </div>
      </div>

      {/* ---------------- Act 2 - the farmer's desk ---------------- */}
      <div className="act-pane pane-desk">
        <div className="act-head desk-head">
          <p>{acts[1].line}</p>
          <div className="farmer-thinking is-done desk-diary-cta">
            <img
              src="/sprite/farmer-write/south-east.png"
              width={48}
              height={48}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <button type="button" className="diary-cta" onClick={() => { playSwitch(); setDiaryOpen(true) }}>
              See the farmer&rsquo;s diary
              <span className="diary-cta-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
        <div className="pane-grid">
          <div className="pane-main desk-readout">
            <AtmosphereReadout doy={selectedDoy} climate={clim} synthetic={bundle.provenance.is_synthetic} />
            <PhaseYearChart average={clim.soil_cover} phases={phaseCovers} labels={phaseLabels} doy={selectedDoy} />
            <TimeLever doy={selectedDoy} onChange={setSelectedDoy} />
          </div>
          {/* "Not every year is the same" is this act's whole point, and
              the phase chart only makes it about corn years versus bean
              years. This makes it about 2000 versus 2024 as well -- the
              question the challenge is named after. */}
          <aside className="pane-side">
            <ShiftReadout trends={bundle.trends ?? []} />
          </aside>
        </div>
      </div>

      {/* ---------------- Act 3 - the root zone ---------------- */}
      <div className="act-pane pane-root">
        <div className="act-head">
          <p>{acts[2].line}</p>
        </div>
        <div className="pane-grid">
          <div className="pane-main">
            <button type="button" className="storm-run" onClick={runStorm} disabled={storm > 0}>
              <span className="storm-run-icon" aria-hidden="true">↯</span>
              <span>{storm > 0 ? 'Storm running…' : "Run the year's worst storm"}<small>{doyToDate(worstStormDoy).label} · watch the soil respond</small></span>
              <span className="storm-run-arrow" aria-hidden="true">→</span>
            </button>
            <SoilCutaway doy={selectedDoy} greenCover={livingCover} residueCover={clim.residue_cover} soilCover={shownCover} soilMoisture={clim.soil_moisture} erosivity={clim.erosivity_r} nObs={clim.n_obs_per_doy} label={bundle.farm.place} reducedMotion={reducedMotion} />
            <TimeLever doy={selectedDoy} onChange={setSelectedDoy} />
          </div>
          <aside className="pane-side">
            <article className="notes-card"><div className="notes-card-title"><span className="notes-ornament">&#10086;</span><div><span className="eyebrow">Crop fit</span><h3>What fits the longest gap</h3></div></div><ol className="fit-list">{ranked.slice(0, 6).map((fit, index) => <li key={fit.speciesId} className={fit.feasible ? '' : 'unavailable'}><span className="fit-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{fit.speciesName}</strong><small>{fit.feasible ? `${fit.curveSource} \u00b7 sow ${doyToDate(fit.seedDoy).label}` : fit.reason}</small></span><span className="fit-benefit">{fit.feasible ? `\u2212${fit.pctReduction.toFixed(0)}%` : '\u2014'}</span></li>)}</ol><button type="button" className="fit-more" onClick={() => { playSwitch(); setNotesOpen(true) }}>How this is scored &rarr;</button></article>
            <p className="soil-caption">Residue is <strong>observed</strong>. Water line and topsoil darkness are <strong>modelled</strong>. Root depth is <strong>derived</strong> from green cover. Soil only sheds on days that were actually observed.</p>
          </aside>
        </div>
      </div>

      {/* ---------------- Act 4 - three futures ---------------- */}
      <div className="act-pane pane-futures" id="planner">
        <div className="act-head">
          <p>{acts[3].line}</p>
        </div>
        <SplitCore
          doy={selectedDoy}
          selectedId={selectedRotationId}
          onSelect={(id) => {
            // The button says "view on year wheel", so go there. A rotation
            // only exists as an average curve, so drop any crop-year view.
            playSwitch()
            selectRotation(id)
            if (id) setActivePhase(null)
            setSlide(0)
          }}
          scenarios={[...bundle.rotations.map((r) => ({
            id: r.id,
            label: r.label,
            isCurrent: r.is_current,
            soilCover: r.soil_cover,
            bareDays: r.bare_days,
            bareDaysByPhase: r.bare_days_by_phase ?? null,
            seedCostUsdHa: r.added_seed_cost_usd_ha,
            deltaPct: r.delta_vs_current_pct,
            nCreditKgHa: r.n_credit_kg_ha,
          })),
          // Whatever the user has sown (and the diary has logged) joins the
          // comparison as a card of its own.
          ...planScenario({ fits: accepted, baseCover: current.soil_cover, erosivity: clim.erosivity_r, nObs: clim.n_obs_per_doy, phaseCovers })]}
          greenCover={clim.green_cover}
          residueCover={clim.residue_cover}
          soilMoisture={clim.soil_moisture}
          erosivity={clim.erosivity_r}
          nObs={clim.n_obs_per_doy}
          phaseLabels={phaseLabels}
          reducedMotion={reducedMotion}
        />
        <div className="futures-detail-row" ref={syncDetails}>
          <RotationCompare
            rotations={bundle.rotations.map((r) => ({ id: r.id, label: r.label, isCurrent: r.is_current, sequence: r.sequence }))}
            speciesNames={new Map(bundle.species.map((sp) => [sp.id, sp.name]))}
            cropCurves={bundle.crop_curves}
            observedCurveIds={new Set(Object.keys(bundle.crop_curves))}
          />
          <details className="futures-sources">
            <summary><strong>Data sources</strong><small>Where these field values come from</small></summary>
            <ul className="source-strip" aria-label="Data sources">
              {sourceLines(bundle.provenance.sources).map((src, i) => (
                <li key={i} data-nasa={src.nasa ? 'yes' : 'no'}>
                  <strong>{src.name}</strong> {src.gives}{src.count ? ` \u00b7 ${src.count}` : ''}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>

    </SlideDeck>

    {/* He keeps to his bottom-left corner in every act. */}
    <FarmerGuide line={guide} reducedMotion={reducedMotion} writing={writing} />
    {/* Not on the title card. On the descent it moves on to the farmer's
        brief; on the brief it moves on to the dashboard. */}
    {entered && !briefDone && (
      <SkipNarration onSkip={() => {
        if (!introDone) setIntroDone(true)
        else setBriefDone(true)
      }} />
    )}
    <FieldDiaryModal
      open={diaryOpen}
      onClose={() => setDiaryOpen(false)}
      place={bundle.farm.place}
      insights={insights}
      log={diary}
    />

    <FieldNotes open={notesOpen} onClose={() => setNotesOpen(false)} data={{
      place: bundle.farm.place,
      areaHa: bundle.farm.area_ha,
      ownerName: bundle.farm.owner_name,
      synthetic: bundle.provenance.is_synthetic,
      years: bundle.provenance.years_used,
      sources: bundle.provenance.sources,
      uncertainty: bundle.uncertainty,
      rotationLabel: bundle.observed_rotation?.inferred_label ?? 'Rotation unknown',
      phaseLabels: phaseLabels,
      bareDays: current.bare_days,
      bareDaysByPhase: current.bare_days_by_phase ?? null,
      diary,
      finding: headline,
    }} />
  </div>
}
