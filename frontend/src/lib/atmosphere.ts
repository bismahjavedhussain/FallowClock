import { BARE_THRESHOLD } from './cropFit'

export interface DayAtmosphereInput {
  soil_cover: number[]
  n_obs_per_doy: number[]
  erosivity_r: number[]
  frost_prob: number[]
  heat_stress_prob?: number[]
}

export function atmosphereForDay(doy: number, input: DayAtmosphereInput) {
  const i = Math.max(0, Math.min(364, Math.round(doy) - 1))
  const observations = input.n_obs_per_doy[i] ?? 0
  const cover = observations > 0 && Number.isFinite(input.soil_cover[i]) ? input.soil_cover[i] : null
  const erosivity = Number.isFinite(input.erosivity_r[i]) ? input.erosivity_r[i] : null
  const frost = Number.isFinite(input.frost_prob[i]) ? input.frost_prob[i] : null
  const heat = input.heat_stress_prob && Number.isFinite(input.heat_stress_prob[i]) ? input.heat_stress_prob[i] : null
  return {
    soil: cover === null ? 'Unknown observation' : cover < BARE_THRESHOLD ? 'Bare soil' : 'Covered soil',
    cover,
    erosivity,
    frost,
    heat,
  }
}

import type { FieldMode } from '../components/seasonal/ParallaxField'

/**
 * What the weather over the field should be doing on a given day.
 *
 * Driven by the same two numbers the rest of the app argues from, so the
 * particles can never contradict the panels: rain when bare ground meets
 * heavy rain, dust when bare ground meets dry weather, a calm green drift
 * when the soil is protected.
 *
 * An unobserved day gets 'none'. The project refuses to treat a day no
 * satellite saw as bare, and blowing dust across one would do exactly
 * that in pictures while the ring says "unknown" in words.
 */
export function fieldMode(
  cover: number | null,
  erosivity: number,
  erosivityMax: number,
  nObs = 1,
): { mode: FieldMode; intensity: number } {
  if (nObs <= 0 || cover === null || !Number.isFinite(cover)) {
    return { mode: 'none', intensity: 0 }
  }
  const wet = erosivityMax > 0 ? Math.max(0, Math.min(1, erosivity / erosivityMax)) : 0
  if (cover >= BARE_THRESHOLD) {
    // Protected. Rain still falls, but it is not taking anything with it,
    // so the picture stays calm rather than alarming.
    return { mode: 'calm', intensity: 0.25 + wet * 0.3 }
  }
  const exposure = Math.max(0, Math.min(1, (BARE_THRESHOLD - cover) / BARE_THRESHOLD))
  if (wet > 0.3) return { mode: 'rain', intensity: Math.min(1, exposure * 0.5 + wet) }
  return { mode: 'dust', intensity: Math.min(1, 0.25 + exposure * 0.6) }
}
