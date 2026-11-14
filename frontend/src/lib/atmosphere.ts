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
