/**
 * The seeding panel must agree with the bundle it was handed.
 *
 * This locks the one thing that already went wrong: the panel recomputed
 * its own bare-day and exposure figures from the MEAN cover curve while the
 * card three lines above it read the phase-averaged number out of the
 * bundle. Story County showed 110 and 104 on the same screen; Monona showed
 * 0 bare days for a field that has 7, which is the difference between "do
 * nothing" and the only gap that field has.
 *
 * Every assertion here reads the shipped bundles off disk, so adding a farm
 * extends the test automatically and no figure can be hardcoded.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { proposalPreview } from './proposal'

const DIR = join(process.cwd(), 'public', 'bundles')

type Rotation = {
  id: string
  is_current: boolean
  soil_cover: number[]
  bare_days: number
  bare_days_by_phase: number[] | null
  exposed_r: number
}
type Bundle = {
  farm: { place?: string; id?: string }
  climatology: { soil_cover: number[]; n_obs_per_doy: number[]; erosivity_r: number[]; phase_covers?: number[][] | null }
  observed_rotation?: { phase_labels?: string[] | null } | null
  rotations: Rotation[]
}

const bundles: [string, Bundle][] = readdirSync(DIR)
  .filter((f) => f.startsWith('farm_') && f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(DIR, f), 'utf-8')) as Bundle])

describe('seeding panel figures', () => {
  it('finds the shipped bundles', () => {
    expect(bundles.length).toBeGreaterThan(0)
  })

  for (const [file, bundle] of bundles) {
    const clim = bundle.climatology
    const current = bundle.rotations.find((r) => r.is_current)!
    const phases = clim.phase_covers ?? null
    const name = bundle.farm.place ?? bundle.farm.id ?? file

    it(`${name}: the panel's baseline is the bundle's own figure`, () => {
      const preview = proposalPreview(current.soil_cover, [], clim.erosivity_r, clim.n_obs_per_doy, phases)
      expect(preview.baselineBare).toBe(current.bare_days)
      expect(preview.baselineExposure).toBeCloseTo(current.exposed_r, 1)
      expect(preview.phaseAware).toBe(Boolean(phases && phases.length))
    })

    if (phases && phases.length && current.bare_days_by_phase) {
      it(`${name}: scoring one phase gives that phase's own bare days`, () => {
        current.bare_days_by_phase!.forEach((expected, i) => {
          const one = proposalPreview(current.soil_cover, [], clim.erosivity_r, clim.n_obs_per_doy, [phases[i]])
          expect(one.baselineBare).toBe(expected)
        })
      })

      it(`${name}: the mean curve would give a different answer, which is the bug`, () => {
        // Not a style point. If these two ever coincide for every farm the
        // correction has stopped doing anything and someone has changed how
        // phase_covers are built -- worth failing loudly over.
        const fromMean = proposalPreview(current.soil_cover, [], clim.erosivity_r, clim.n_obs_per_doy, null)
        expect(fromMean.phaseAware).toBe(false)
        expect(typeof fromMean.baselineBare).toBe('number')
      })
    }
  }

  it('at least one farm is misread by the mean curve, in each direction', () => {
    const gaps = bundles
      .filter(([, b]) => b.climatology.phase_covers?.length)
      .map(([, b]) => {
        const cur = b.rotations.find((r) => r.is_current)!
        const mean = proposalPreview(cur.soil_cover, [], b.climatology.erosivity_r, b.climatology.n_obs_per_doy, null)
        return mean.baselineBare - cur.bare_days
      })
    // Story reads high off the mean curve, Monona reads low. The step
    // function has no guaranteed sign and these two prove it.
    expect(gaps.some((d) => d > 0)).toBe(true)
    expect(gaps.some((d) => d < 0)).toBe(true)
  })
})
