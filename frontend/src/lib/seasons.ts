export type Season = 'winter' | 'spring' | 'summer' | 'autumn'

export const SEASON_STARTS: { season: Season; doy: number; label: string }[] = [
  { season: 'spring', doy: 60, label: 'Spring' },
  { season: 'summer', doy: 152, label: 'Summer' },
  { season: 'autumn', doy: 244, label: 'Autumn' },
  { season: 'winter', doy: 335, label: 'Winter' },
]

export function seasonAtDoy(doy: number): Season {
  if (doy < 60 || doy >= 335) return 'winter'
  if (doy < 152) return 'spring'
  if (doy < 244) return 'summer'
  return 'autumn'
}

/** Continuous seasonal weights around the December/January seam. */
export function seasonWeights(doy: number): Record<Season, number> {
  const centers: Record<Season, number> = { winter: 15, spring: 106, summer: 198, autumn: 289 }
  const weights = {} as Record<Season, number>
  for (const season of Object.keys(centers) as Season[]) {
    const distance = Math.abs(doy - centers[season])
    const circular = Math.min(distance, 365 - distance)
    weights[season] = Math.max(0, 1 - circular / 94)
  }
  const sum = Object.values(weights).reduce((a, b) => a + b, 0) || 1
  for (const season of Object.keys(weights) as Season[]) weights[season] /= sum
  return weights
}
