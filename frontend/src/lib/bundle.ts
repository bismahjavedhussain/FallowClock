/**
 * Load, check and adapt the data bundle. U2 owns this file.
 *
 * The bundle is the only interface between the backend and the UI
 * (backend/fallowclock/schema.py). Types come from the generated
 * src/types/bundle.ts, so a backend field rename breaks `npm run build`
 * instead of quietly rendering an empty ring.
 */
import type { Bundle, Rotation } from '../types/bundle'
import type { ClimatologySlice, Gap, Species } from './cropFit'

export type { Bundle, Rotation }
export type BundleSpecies = Bundle['species'][number]
export type BundleGap = Bundle['gaps'][number]
export type UncertaintyEntry = Bundle['uncertainty'][number]
export type SourceEntry = Bundle['provenance']['sources'][number]
export type ObservedYear = Bundle['observed_rotation']['years'][number]

export const DOY_LEN = 365

/**
 * Both observed fields are selectable. Showing only one wastes the most
 * useful thing the tool does: run the same model on two real fields in the
 * same state and get opposite answers. Story County needs a cover crop.
 * Monona County is already conservation tillage and the honest answer there
 * is "nothing to do" -- which is worth more than a recommendation we made up.
 */
export const FARMS = [
  { id: 'story-county-ia', label: 'Story County', path: 'bundles/farm_story-county-ia.json' },
  { id: 'monona-county-ia', label: 'Monona County', path: 'bundles/farm_monona-county-ia.json' },
] as const

/** Only reached if the chosen field's bundle is unusable; carries a red banner. */
export const FALLBACK_PATH = 'bundles/farm_synthetic.json'

const DOY_ARRAYS = [
  'green_cover',
  'green_cover_p25',
  'green_cover_p75',
  'residue_cover',
  'soil_cover',
  'n_obs_per_doy',
  'erosivity_r',
  'gdd_base4',
  'gdd_base10',
  'frost_prob',
  'heat_stress_prob',
  'soil_moisture',
] as const

function fail(message: string): never {
  throw new Error(`Bundle failed its contract check: ${message}`)
}

function isDoyArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === DOY_LEN && value.every((v) => typeof v === 'number' && Number.isFinite(v))
}

/**
 * The checks the UI depends on, in the words a teammate needs to fix them.
 * The backend validates far more (schema.py); this only guards what would
 * otherwise render as a silently wrong ring.
 */
export function checkBundle(raw: unknown): Bundle {
  if (!raw || typeof raw !== 'object') fail('not a JSON object')
  const b = raw as Bundle
  if (!b.farm || !b.provenance || !b.climatology || !b.observed_rotation) {
    fail('missing farm, provenance, climatology or observed_rotation')
  }
  for (const key of DOY_ARRAYS) {
    if (!isDoyArray(b.climatology[key])) fail(`climatology.${key} must hold ${DOY_LEN} numbers`)
  }
  const peak = b.climatology.erosivity_peak_doy
  if (!Number.isInteger(peak) || peak < 1 || peak > DOY_LEN) fail('climatology.erosivity_peak_doy must be a day of year')
  const phases = b.climatology.phase_covers
  if (phases) {
    if (!phases.every(isDoyArray)) fail(`every phase_covers curve must hold ${DOY_LEN} numbers`)
    const labels = b.observed_rotation.phase_labels
    if (labels && labels.length !== phases.length) {
      fail(`${labels.length} phase labels for ${phases.length} phase curves`)
    }
  }
  if (!Array.isArray(b.rotations) || b.rotations.filter((r) => r.is_current).length !== 1) {
    fail('exactly one rotation must be the current practice')
  }
  if (!b.rotations.every((r) => isDoyArray(r.soil_cover))) fail(`every rotation needs ${DOY_LEN} soil_cover values`)
  if (!Array.isArray(b.species) || b.species.length === 0) fail('the species list is empty')
  if (!Array.isArray(b.uncertainty) || b.uncertainty.length === 0) fail('the uncertainty list is empty')
  return b
}

export interface LoadedBundle {
  bundle: Bundle
  path: string
  /** Why earlier bundles were skipped. Non-empty means we fell back. */
  skipped: string[]
}

/**
 * Paths are relative to the page, so the build works at a domain root and
 * under a sub-path alike. Nothing here calls out of the deployed site.
 */
export async function loadBundle(paths: string[] = [FARMS[0].path, FALLBACK_PATH]): Promise<LoadedBundle> {
  const skipped: string[] = []
  for (const path of paths) {
    try {
      const response = await fetch(path)
      if (!response.ok) {
        skipped.push(`${path}: HTTP ${response.status}`)
        continue
      }
      return { bundle: checkBundle(await response.json()), path, skipped }
    } catch (error) {
      skipped.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Could not load any bundle. ${skipped.join(' · ')}`)
}

/** One crop-year cover curve, e.g. the soybean year (May to April). */
export interface PhaseCurve {
  key: string
  label: string
  cover: number[]
}

/**
 * The bundle plus everything derived from it once, in the shapes the
 * fitting code (cropFit.ts) expects.
 */
export interface FieldModel {
  bundle: Bundle
  current: Rotation
  species: Species[]
  /** Sorted by exposed erosivity, most erosive first (gaps.py build_gaps). */
  gaps: Gap[]
  mainGap: Gap | null
  phases: PhaseCurve[]
  observedCurves: Record<string, number[]>
  slice: ClimatologySlice
  /** Nothing is drilled into a standing crop: the median observed harvest. */
  earliestSeedDoy: number | undefined
}

/** Mirrors backend/fallowclock/bundle.py: sorted harvest DOYs, element len // 2. */
export function medianHarvestDoy(years: ObservedYear[]): number | undefined {
  const harvests = years
    .map((y) => y.harvest_doy)
    .filter((d): d is number => typeof d === 'number')
    .sort((a, b) => a - b)
  return harvests.length ? harvests[Math.floor(harvests.length / 2)] : undefined
}

export function phaseLabel(key: string): string {
  const name = key.replace(/[_-]+/g, ' ').trim()
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} year`
}

/** The generated types leave tuple members as `unknown`; cropFit wants numbers. */
function toFitSpecies(s: BundleSpecies): Species {
  return { ...s, seeding_window: [Number(s.seeding_window[0]), Number(s.seeding_window[1])] }
}

function toFitGap(g: BundleGap): Gap {
  return { ...g, wraps_year: g.wraps_year ?? g.start_doy > g.end_doy }
}

export function buildFieldModel(bundle: Bundle): FieldModel {
  const c = bundle.climatology
  const labels = bundle.observed_rotation.phase_labels ?? []
  const phases = (c.phase_covers ?? []).map((cover, i) => {
    const key = labels[i] ?? `phase-${i + 1}`
    return { key, label: phaseLabel(key), cover: [...cover] }
  })
  const observedCurves: Record<string, number[]> = {}
  for (const [id, curve] of Object.entries(bundle.crop_curves)) observedCurves[id] = [...curve.green_cover]
  const gaps = bundle.gaps.map(toFitGap)
  return {
    bundle,
    current: bundle.rotations.find((r) => r.is_current)!,
    species: bundle.species.map(toFitSpecies),
    gaps,
    mainGap: gaps[0] ?? null,
    phases,
    observedCurves,
    slice: {
      gddBase4: c.gdd_base4,
      gddBase10: c.gdd_base10,
      frostProb: c.frost_prob,
      soilMoisture: c.soil_moisture,
      erosivityR: c.erosivity_r,
      soilCover: c.soil_cover,
    },
    earliestSeedDoy: medianHarvestDoy(bundle.observed_rotation.years),
  }
}
