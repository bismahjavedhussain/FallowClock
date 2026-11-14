/**
 * App shell — U2 owns this file.
 *
 * Deliberately thin. It loads the bundle, renders the ring, and puts the
 * rotation comparison and evidence beside it. The scaffolding is here so
 * both UI people have somewhere to build from at H2; the panels are stubs
 * with the right shape, not finished work.
 */

import { useEffect, useMemo, useState } from 'react'
import YearRing from './components/YearRing'
import { bareDays, rankSpeciesForGap } from './lib/cropFit'
import type { ClimatologySlice, Gap, Species } from './lib/cropFit'
import { useStore } from './store'

interface Rotation {
  id: string
  label: string
  is_current: boolean
  soil_cover: number[]
  bare_days: number
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
    soil_moisture: number[]
  }
  gaps: Gap[]
  species: Species[]
  rotations: Rotation[]
  crop_curves: Record<string, { green_cover: number[]; n_fields: number; detection: string }>
  uncertainty: { field: string; level: string; reason: string; affects: string }[]
}

/**
 * Real NASA POWER weather first; the pure-synthetic fixture only as a
 * fallback so the UI still renders if the bundle has not been built.
 * Both still set provenance.is_synthetic while B1's cover curves are
 * placeholders, which is what drives the red banner.
 */
const BUNDLE_URLS = [
  '/bundles/farm_story-county-ia.json',
  '/bundles/farm_synthetic.json',
]

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { selectedRotationId, selectRotation, hoveredDoy, setHoveredDoy } = useStore()

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
    return rankSpeciesForGap(bundle.species, bundle.gaps[0], slice, observed)
  }, [bundle, slice])

  if (error) {
    return (
      <div className="p-8 font-mono text-sm text-risk-high">
        Failed to load bundle: {error}
        <p className="mt-2 text-ink-soft">
          Run <code>python scripts/make_fixture.py</code> in backend/ first.
        </p>
      </div>
    )
  }

  if (!bundle || !clim || !current) {
    return <div className="p-8 text-ink-soft">Loading…</div>
  }

  const ringCover = selected?.soil_cover ?? current.soil_cover

  return (
    <div className="min-h-screen">
      {/* The one unforgivable demo failure is showing fake data by accident. */}
      {bundle.provenance.is_synthetic && (
        <div className="bg-risk-high px-4 py-2 text-center text-sm font-semibold text-white">
          SYNTHETIC FIXTURE — no satellite data. Not for demo.
        </div>
      )}

      <header className="mx-auto max-w-6xl px-6 pt-10">
        <h1 className="text-4xl font-bold tracking-tight">Fallow Clock</h1>
        <p className="mt-1 text-lg text-ink-soft">Find the hole in your year.</p>
        <p className="mt-4 max-w-2xl text-ink">
          <strong>{bundle.farm.owner_name}</strong> farms {bundle.farm.area_ha} ha in{' '}
          {bundle.farm.place}. This field is bare{' '}
          <strong>{bareDays(current.soil_cover)} days a year</strong>, and{' '}
          <strong>
            {Math.round((bundle.gaps[0]?.share_of_annual_r ?? 0) * 100)}%
          </strong>{' '}
          of the year&rsquo;s erosive rain falls while it is.
        </p>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <YearRing
            soilCover={ringCover}
            erosivity={clim.erosivity_r}
            nObs={clim.n_obs_per_doy}
            frostProb={clim.frost_prob}
            compareCover={selected ? current.soil_cover : undefined}
            onHoverDay={setHoveredDoy}
          />
          <p className="mt-3 text-center text-sm text-ink-soft">
            {hoveredDoy
              ? `DOY ${hoveredDoy} — cover ${(ringCover[hoveredDoy - 1] * 100).toFixed(0)}%, ` +
                `${clim.n_obs_per_doy[hoveredDoy - 1]} observations`
              : 'Hover the ring for a single day. Outer bars are rainfall erosivity.'}
          </p>
        </section>

        <aside className="space-y-8">
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Compare rotations
            </h2>
            <div className="space-y-2">
              {bundle.rotations.map((r) => (
                <button
                  key={r.id}
                  onClick={() => selectRotation(r.is_current ? null : r.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    (selected?.id ?? current.id) === r.id
                      ? 'border-canopy-mid bg-white shadow-sm'
                      : 'border-black/10 hover:border-black/25'
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{r.label}</span>
                    <span
                      className={
                        r.delta_vs_current_pct < 0
                          ? 'font-mono text-sm text-canopy-deep'
                          : 'font-mono text-sm text-ink-soft'
                      }
                    >
                      {r.delta_vs_current_pct === 0
                        ? 'baseline'
                        : `${r.delta_vs_current_pct.toFixed(0)}% soil loss`}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-ink-soft">
                    {r.bare_days} bare days
                    {r.added_seed_cost_usd_ha > 0 && ` · +$${r.added_seed_cost_usd_ha}/ha seed`}
                    {r.n_credit_kg_ha > 0 && ` · ${r.n_credit_kg_ha} kg N/ha credit`}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
              What fits the biggest gap
            </h2>
            <ul className="space-y-1.5 text-sm">
              {ranked.slice(0, 6).map((f) => (
                <li
                  key={f.speciesId}
                  className={`flex items-baseline justify-between gap-3 rounded border px-3 py-2 ${
                    f.feasible ? 'border-canopy-light/50 bg-white' : 'border-black/5 opacity-55'
                  }`}
                >
                  <span className="font-medium">{f.speciesName}</span>
                  <span className="text-right text-xs text-ink-soft">
                    {f.feasible
                      ? `−${f.pctReduction.toFixed(0)}% · seed DOY ${f.seedDoy} · ${f.curveSource}`
                      : f.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
              What we don&rsquo;t know
            </h2>
            <ul className="space-y-2 text-sm">
              {bundle.uncertainty.map((u, i) => (
                <li key={i} className="rounded border border-black/10 bg-white p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        u.level === 'high'
                          ? 'bg-risk-high text-white'
                          : u.level === 'medium'
                            ? 'bg-residue-base text-white'
                            : 'bg-black/10'
                      }`}
                    >
                      {u.level}
                    </span>
                    <code className="text-xs text-ink-soft">{u.field}</code>
                  </div>
                  <p className="mt-1.5">{u.reason}</p>
                  <p className="mt-1 text-ink-soft">{u.affects}</p>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  )
}
