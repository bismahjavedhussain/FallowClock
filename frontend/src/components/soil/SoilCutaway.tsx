/**
 * A side-on slice of the field, animated across the year.
 *
 * Inline SVG, because every layer is one shape whose attributes come from a
 * 365-length array, it has to render three-up in the comparison (viewBox
 * scaling is free), it stays legible to a screen reader, and it renders in
 * the node test environment the rest of this codebase tests in.
 *
 * WHAT IS REAL AND WHAT IS DERIVED, because the picture must not overclaim:
 *   residue mat thickness  <- residue_cover      observed (NDTI)
 *   topsoil darkness       <- soil_moisture      MODELLED (bucket balance)
 *   water line height      <- soil_moisture      MODELLED
 *   root depth and density <- green cover        DERIVED, a proxy, not measured
 *   detaching soil flecks  <- erosivity x bare   computed
 *
 * There is deliberately NO organic-matter layer. We have no data for it, and
 * animating soil carbon accruing from a cover-crop decision would be exactly
 * the kind of unverifiable projection this project exists to avoid.
 */

import { useMemo } from 'react'
import {
  buildFleckPool,
  buildRootSystem,
  clamp01,
  erosionIntensity,
} from './rootGeometry'

export interface SoilCutawayProps {
  /** 1-based day of year. */
  doy: number
  /** Living cover driving root growth, 0-1 x 365. For a scenario, splice the
   *  cover-crop curves onto green_cover so each panel grows its own roots. */
  greenCover: number[]
  residueCover: number[]
  /** Total cover, for the bare/covered decision at the 0.30 threshold. */
  soilCover: number[]
  soilMoisture: number[]
  erosivity: number[]
  /** 0 means no satellite saw this day: unknown, never bare. */
  nObs?: number[]
  /** MUST be shared across panels in the 3-up, or they are not comparable. */
  erosivityMax?: number
  seed?: number
  label?: string
  reducedMotion?: boolean
  variant?: 'full' | 'compact'
  className?: string
}

const W = 420
const FULL_W = 700
const H = 300
const SURFACE_Y = 96

/** How much green cover a segment spans between invisible and fully drawn. */
const REVEAL_BAND = 0.18

const at = (arr: number[] | undefined, doy: number, fallback = 0): number => {
  const v = arr?.[doy - 1]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Blend two hex colours. Mirrors the lerp pattern in YearRing. */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [r1, g1, b1] = p(a)
  const [r2, g2, b2] = p(b)
  const k = clamp01(t)
  const c = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0')
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`
}

const SOIL_DRY = '#7d5c3c'
const SOIL_WET = '#3a2817'
const SUBSOIL = '#9a7a56'
const PARENT = '#b09a7d'
const ROOT = '#efe3c6'
const RESIDUE = '#c7a74e'
const WATER = '#4a7fb5'

export default function SoilCutaway({
  doy,
  greenCover,
  residueCover,
  soilCover,
  soilMoisture,
  erosivity,
  nObs,
  erosivityMax,
  seed = 1,
  label,
  reducedMotion = false,
  variant = 'full',
  className = '',
}: SoilCutawayProps) {
  const compact = variant === 'compact'
  const width = compact ? W : FULL_W

  // Generated once. `doy` is deliberately NOT a dependency -- the whole point
  // is that scrubbing changes attributes, never geometry.
  const roots = useMemo(
    () => buildRootSystem({ width, height: H, surfaceY: SURFACE_Y, seed, plants: compact ? 3 : 6 }),
    [seed, compact, width],
  )
  const flecks = useMemo(() => buildFleckPool(seed + 11, compact ? 8 : 24, width), [seed, compact, width])
  const rMax = useMemo(
    () => erosivityMax ?? Math.max(...erosivity, 0),
    [erosivityMax, erosivity],
  )

  const green = at(greenCover, doy)
  const residue = at(residueCover, doy)
  const cover = at(soilCover, doy)
  const moisture = at(soilMoisture, doy)
  const r = at(erosivity, doy)
  const obs = nObs ? at(nObs, doy, 0) : 1
  const unknown = obs <= 0

  const erosion = erosionIntensity(cover, r, rMax, obs)
  const status = unknown ? 'Cover unknown today' : erosion > 0.02 ? 'Topsoil at risk today' : cover < 0.3 ? 'Bare soil today' : 'Soil protected today'

  // Residue sits ON the surface, so it grows upward from the ground line.
  const matH = 3 + residue * 20
  // Water table rises from the base of the profile.
  const waterY = H - 8 - moisture * (H - SURFACE_Y - 30)

  const uid = `sc${seed}`
  const desc = unknown
    ? 'No satellite observation for this day, so cover is unknown.'
    : `${Math.round(cover * 100)}% ground cover, ${Math.round(residue * 100)}% of it residue. ` +
      `Modelled soil water ${Math.round(moisture * 100)}% of capacity. ` +
      (erosion > 0 ? 'Bare soil under erosive rain: topsoil is being lost.' : 'Soil is protected today.')

  return (
    <figure className={`soil-cutaway ${compact ? 'is-compact' : ''} ${className}`} data-unknown={unknown ? 'on' : 'off'}>
      {!compact && <div className="soil-scene-head">
        <div><span className="eyebrow">Field profile</span><strong>Under the surface</strong></div>
        <span className={`soil-scene-status ${erosion > 0.02 ? 'is-at-risk' : ''}`}>{status}</span>
      </div>}
      <svg
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-labelledby={`${uid}-t ${uid}-d`}
        preserveAspectRatio="none"
      >
        <title id={`${uid}-t`}>{label ? `Soil profile — ${label}` : 'Soil profile'}</title>
        <desc id={`${uid}-d`}>{desc}</desc>

        <defs>
          {/* Generated grain. No image assets, themes with the fill. */}
          <filter id={`${uid}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed={seed} result="n" />
            <feColorMatrix in="n" type="saturate" values="0" result="g" />
            <feComponentTransfer in="g" result="a">
              <feFuncA type="linear" slope="0.16" intercept="0" />
            </feComponentTransfer>
            <feComposite in="a" in2="SourceGraphic" operator="in" result="speck" />
            <feBlend in="SourceGraphic" in2="speck" mode="multiply" />
          </filter>
          <clipPath id={`${uid}-soil`}>
            <rect x="0" y={SURFACE_Y} width={width} height={H - SURFACE_Y} />
          </clipPath>
        </defs>

        {/* ---- sky above the ground line ---- */}
        <rect x="0" y="0" width={width} height={SURFACE_Y} fill="transparent" />

        <g clipPath={`url(#${uid}-soil)`}>
          {/* ---- parent material, subsoil, topsoil ---- */}
          <rect x="0" y={H - 46} width={width} height="46" fill={PARENT} />
          <rect x="0" y={H - 118} width={width} height="72" fill={SUBSOIL} />
          <rect
            x="0"
            y={SURFACE_Y}
            width={width}
            height={H - SURFACE_Y - 118}
            fill={unknown ? '#8e8c86' : mix(SOIL_DRY, SOIL_WET, moisture)}
            filter={`url(#${uid}-grain)`}
            className="soil-topsoil"
          />

          {/* ---- water table ---- */}
          <rect
            x="0"
            y={waterY}
            width={width}
            height={Math.max(0, H - waterY)}
            fill={WATER}
            opacity={unknown ? 0.06 : 0.3}
            className="soil-water"
          />
          <line
            x1="0"
            x2={width}
            y1={waterY}
            y2={waterY}
            stroke={WATER}
            strokeWidth="1.5"
            opacity={unknown ? 0.15 : 0.6}
            className="soil-waterline"
          />

          {/* ---- roots: generated once, revealed by cover ---- */}
          <g className="soil-roots" fill="none" stroke={ROOT} strokeLinecap="round" opacity={unknown ? 0.25 : 1}>
            {roots.map((s, i) => {
              const reveal = clamp01((green - s.t) / REVEAL_BAND)
              if (reveal <= 0) return null
              return (
                <path
                  key={i}
                  d={s.d}
                  strokeWidth={s.w}
                  pathLength={1}
                  strokeDasharray={1}
                  /* pathLength=1 normalises the dash units, so the reveal
                     never needs getTotalLength() and stays SSR-safe. */
                  strokeDashoffset={1 - reveal}
                  opacity={0.35 + reveal * 0.55}
                />
              )
            })}
          </g>
        </g>

        {/* ---- the ground line ---- */}
        <line x1="0" x2={width} y1={SURFACE_Y} y2={SURFACE_Y} stroke="#2f2317" strokeWidth="1.5" opacity=".5" />

        {/* ---- residue mat, sitting on top ---- */}
        <rect
          x="0"
          y={SURFACE_Y - matH}
          width={width}
          height={matH}
          fill={unknown ? '#a9a59c' : RESIDUE}
          opacity={unknown ? 0.3 : 0.55 + residue * 0.35}
          className="soil-residue"
        />

        {/* ---- topsoil leaving, only when genuinely eroding ---- */}
        <g
          className="soil-flecks"
          data-eroding={erosion > 0.02 && !reducedMotion ? 'on' : 'off'}
          style={{ ['--erosion' as string]: erosion.toFixed(3) }}
          aria-hidden="true"
        >
          {flecks.map((f, i) => (
            <rect
              key={i}
              x={f.x}
              y={SURFACE_Y - matH - 2}
              width={f.size}
              height={f.size}
              fill={mix(SOIL_DRY, SOIL_WET, moisture)}
              transform={`rotate(${f.rotate} ${f.x} ${SURFACE_Y})`}
              style={{
                ['--d' as string]: `${f.delay}s`,
                ['--dx' as string]: `${f.driftX}px`,
              }}
            />
          ))}
        </g>

      </svg>
      {!compact && <div className="soil-scene-labels" aria-hidden="true">
        <span className="soil-scene-residue" style={{ top: `${((SURFACE_Y - matH) / H) * 100}%` }}>Residue {Math.round(residue * 100)}%</span>
        <span className="soil-scene-topsoil">Topsoil</span>
        <span className="soil-scene-roots">Roots · derived</span>
        <span className="soil-scene-subsoil">Subsoil</span>
        <span className="soil-scene-water" style={{ top: `${(waterY / H) * 100}%` }}>Water {Math.round(moisture * 100)}% · modelled</span>
      </div>}
    </figure>
  )
}
