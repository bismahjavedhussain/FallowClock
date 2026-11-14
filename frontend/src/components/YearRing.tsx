/**
 * THE RING — the project's hero visual. U1 owns this file.
 *
 * NASA Space Apps 2026: Field Shift: Adapting Farms with NASA Data.
 *
 * 365 days around a circle:
 * - Mode A: 2D Year Ring (SVG) — high-performance, responsive, accessible circular calendar.
 * - Mode B: 3D Year Ring (Three.js WebGL) — physical extruded ring with depth, lighting, and orbit controls.
 *
 * STRICT SCIENTIFIC RULES:
 * 1. soil_cover is the ONLY value used to classify bare (< 0.30) vs covered (>= 0.30).
 * 2. green_cover and residue_cover are supporting evidence; they never independently classify.
 * 3. n_obs_per_doy === 0 produces an UNKNOWN state (neutral grey). It is never bare or covered.
 * 4. Rainfall erosivity R * C is an independent outer bar / height overlay, never the soil cover classification.
 * 5. Wrap-aware: the Iowa bare window runs October -> May across the 31 Dec / 1 Jan boundary.
 */

import React, { Suspense, useCallback, useId, useMemo, useRef, useState, lazy } from 'react'
import RingLegend from './RingLegend'
import { isWebGLAvailable } from '../lib/webgl'

const YearRing3D = lazy(() => import('./YearRing3D'))

export const DOY_LEN = 365
export const BARE_THRESHOLD = 0.3

export interface YearRingProps {
  soilCover: number[]
  erosivity: number[]
  nObs: number[]
  frostProb: number[]
  greenCover?: number[]
  residueCover?: number[]
  /** Optional overlay: the cover a candidate rotation would produce. */
  compareCover?: number[]
  /** Days to call out, e.g. a gap a dragged crop would fill. 1-based DOY. */
  highlightDoys?: number[]
  size?: number
  yearLabel?: string | number
  selectedDoy?: number | null
  initialMode?: '2D' | '3D'
  onHoverDay?: (doy: number | null) => void
  onSelectDay?: (doy: number) => void
}

export type DayClassification = 'covered' | 'bare' | 'unknown'

export function classifyDay(soilCover: number, nObs: number): DayClassification {
  if (nObs <= 0) return 'unknown'
  if (soilCover < BARE_THRESHOLD) return 'bare'
  return 'covered'
}

export const MONTHS = [
  { name: 'Jan', days: 31, startDoy: 1 },
  { name: 'Feb', days: 28, startDoy: 32 },
  { name: 'Mar', days: 31, startDoy: 60 },
  { name: 'Apr', days: 30, startDoy: 91 },
  { name: 'May', days: 31, startDoy: 121 },
  { name: 'Jun', days: 30, startDoy: 152 },
  { name: 'Jul', days: 31, startDoy: 182 },
  { name: 'Aug', days: 31, startDoy: 213 },
  { name: 'Sep', days: 30, startDoy: 244 },
  { name: 'Oct', days: 31, startDoy: 274 },
  { name: 'Nov', days: 30, startDoy: 305 },
  { name: 'Dec', days: 31, startDoy: 335 },
] as const

export function doyToDate(doy: number): { month: string; day: number; label: string } {
  const clamped = Math.max(1, Math.min(DOY_LEN, Math.floor(doy)))
  for (let i = MONTHS.length - 1; i >= 0; i--) {
    const m = MONTHS[i]
    if (clamped >= m.startDoy) {
      const day = clamped - m.startDoy + 1
      return { month: m.name, day, label: `${m.name} ${day}` }
    }
  }
  return { month: 'Jan', day: 1, label: 'Jan 1' }
}

/** Wrap-aware bare run detector matching backend/fallowclock/gaps.py */
export interface BareRun {
  startDoy: number
  endDoy: number
  nDays: number
  wraps: boolean
}

export function findBareRuns(soilCover: number[], threshold = BARE_THRESHOLD): BareRun[] {
  const len = soilCover.length
  if (len === 0) return []
  const bare = soilCover.map((v) => v < threshold)
  if (!bare.some(Boolean)) return []
  if (bare.every(Boolean)) {
    return [{ startDoy: 1, endDoy: len, nDays: len, wraps: false }]
  }

  const runs: [number, number][] = []
  let start: number | null = null
  for (let i = 0; i < len; i++) {
    if (bare[i] && start === null) {
      start = i
    } else if (!bare[i] && start !== null) {
      runs.push([start, i - 1])
      start = null
    }
  }
  if (start !== null) {
    runs.push([start, len - 1])
  }

  if (runs.length > 1 && bare[0] && bare[len - 1]) {
    const first = runs.shift()!
    const last = runs.pop()!
    const nDays = len - last[0] + (first[1] + 1)
    const result: BareRun[] = [
      {
        startDoy: last[0] + 1,
        endDoy: first[1] + 1,
        nDays,
        wraps: true,
      },
    ]
    for (const [s, e] of runs) {
      result.push({
        startDoy: s + 1,
        endDoy: e + 1,
        nDays: e - s + 1,
        wraps: false,
      })
    }
    return result
  }

  return runs.map(([s, e]) => ({
    startDoy: s + 1,
    endDoy: e + 1,
    nDays: e - s + 1,
    wraps: false,
  }))
}

/** Annulus segment. Angle 0 = 1 January at 12 o'clock, running clockwise. */
export function annulusSegment(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  a0: number,
  a1: number,
): string {
  const pt = (r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)]
  const [x0o, y0o] = pt(rOuter, a0)
  const [x1o, y1o] = pt(rOuter, a1)
  const [x1i, y1i] = pt(rInner, a1)
  const [x0i, y0i] = pt(rInner, a0)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return (
    `M${x0o.toFixed(2)},${y0o.toFixed(2)}` +
    `A${rOuter},${rOuter} 0 ${large} 1 ${x1o.toFixed(2)},${y1o.toFixed(2)}` +
    `L${x1i.toFixed(2)},${y1i.toFixed(2)}` +
    `A${rInner},${rInner} 0 ${large} 0 ${x0i.toFixed(2)},${y0i.toFixed(2)}Z`
  )
}

const BARE_RGB = [138, 98, 64] as const
const COVER_LOW_RGB = [160, 190, 120] as const
const COVER_HIGH_RGB = [25, 95, 55] as const
const UNKNOWN_HEX = '#9ca3af'

function lerp(a: readonly number[], b: readonly number[], t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function coverColor(cover: number, nObs = 10): string {
  if (nObs <= 0) return UNKNOWN_HEX
  if (cover < BARE_THRESHOLD) return `rgb(${BARE_RGB[0]},${BARE_RGB[1]},${BARE_RGB[2]})`
  const t = Math.min(1, Math.max(0, (cover - BARE_THRESHOLD) / (1 - BARE_THRESHOLD)))
  return lerp(COVER_LOW_RGB, COVER_HIGH_RGB, t)
}

export function confidenceOpacity(n: number): number {
  if (n <= 0) return 0.85
  if (n >= 12) return 1
  return 0.45 + (n / 12) * 0.55
}

export default function YearRing({
  soilCover,
  erosivity,
  nObs,
  frostProb,
  greenCover,
  residueCover,
  compareCover,
  highlightDoys,
  size = 620,
  yearLabel = 'Annual Cycle',
  selectedDoy: propSelectedDoy,
  initialMode = '2D',
  onHoverDay,
  onSelectDay,
}: YearRingProps) {
  const [mode, setMode] = useState<'2D' | '3D'>(initialMode)
  const [internalHovered, setInternalHovered] = useState<number | null>(null)
  const [internalSelected, setInternalSelected] = useState<number | null>(propSelectedDoy ?? null)
  const [webglError, setWebglError] = useState<string | null>(null)

  const activeSelectedDoy = propSelectedDoy !== undefined ? propSelectedDoy : internalSelected
  const activeHoveredDoy = internalHovered

  const rafRef = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const componentId = useId()

  const cx = size / 2
  const cy = size / 2
  const rCoverOuter = size * 0.36
  const rCoverInner = size * 0.26
  const rRiskInner = size * 0.375
  const rRiskMax = size * 0.46

  // Geometry: computed once, never recomputed on hover or data change
  const coverPaths = useMemo(() => {
    const step = (Math.PI * 2) / DOY_LEN
    return Array.from({ length: DOY_LEN }, (_, i) =>
      annulusSegment(cx, cy, rCoverInner, rCoverOuter, i * step, (i + 1) * step),
    )
  }, [cx, cy, rCoverInner, rCoverOuter])

  const maxR = useMemo(() => Math.max(...erosivity, 1e-9), [erosivity])

  const riskPaths = useMemo(() => {
    const step = (Math.PI * 2) / DOY_LEN
    return erosivity.map((r, i) => {
      const h = (r / maxR) * (rRiskMax - rRiskInner)
      return annulusSegment(
        cx,
        cy,
        rRiskInner,
        rRiskInner + Math.max(h, 0.4),
        i * step,
        (i + 1) * step,
      )
    })
  }, [erosivity, maxR, cx, cy, rRiskInner, rRiskMax])

  const highlightSet = useMemo(
    () => (highlightDoys ? new Set(highlightDoys) : null),
    [highlightDoys],
  )

  const bareDaysCount = useMemo(
    () => soilCover.filter((v, i) => (nObs[i] ?? 1) > 0 && v < BARE_THRESHOLD).length,
    [soilCover, nObs],
  )

  const unknownDaysCount = useMemo(
    () => nObs.filter((n) => n <= 0).length,
    [nObs],
  )

  const bareRuns = useMemo(
    () => findBareRuns(soilCover, BARE_THRESHOLD),
    [soilCover],
  )

  const longestGap = useMemo(() => {
    if (bareRuns.length === 0) return null
    return [...bareRuns].sort((a, b) => b.nDays - a.nDays)[0]
  }, [bareRuns])

  const lastSpringFrost = useMemo(() => {
    for (let i = 180; i >= 0; i--) if (frostProb[i] >= 0.5) return i + 1
    return null
  }, [frostProb])

  const firstFallFrost = useMemo(() => {
    for (let i = 200; i < DOY_LEN; i++) if (frostProb[i] >= 0.5) return i + 1
    return null
  }, [frostProb])

  const doyToAngle = useCallback(
    (doy: number) => ((doy - 0.5) / DOY_LEN) * Math.PI * 2,
    [],
  )

  const polar = useCallback(
    (r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)],
    [cx, cy],
  )

  // Hover: rAF-throttled
  const handleMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (rafRef.current !== null) return
      const { clientX, clientY } = e
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const rect = svgRef.current?.getBoundingClientRect()
        if (!rect) return
        const scale = size / rect.width
        const x = (clientX - rect.left) * scale - cx
        const y = (clientY - rect.top) * scale - cy
        const dist = Math.hypot(x, y)
        if (dist < rCoverInner * 0.85 || dist > rRiskMax * 1.08) {
          setInternalHovered(null)
          onHoverDay?.(null)
          return
        }
        let angle = Math.atan2(x, -y)
        if (angle < 0) angle += Math.PI * 2
        const doy = Math.min(DOY_LEN, Math.floor((angle / (Math.PI * 2)) * DOY_LEN) + 1)
        setInternalHovered(doy)
        onHoverDay?.(doy)
      })
    },
    [cx, cy, rCoverInner, rRiskMax, size, onHoverDay],
  )

  const handleLeave = useCallback(() => {
    setInternalHovered(null)
    onHoverDay?.(null)
  }, [onHoverDay])

  const handleSelect = useCallback(
    (doy: number) => {
      setInternalSelected(doy)
      onSelectDay?.(doy)
    },
    [onSelectDay],
  )

  // Keyboard navigation for DOY scrubbing
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const current = activeSelectedDoy ?? activeHoveredDoy ?? 1
      if (e.key === 'ArrowRight') {
        const next = current >= DOY_LEN ? 1 : current + 1
        handleSelect(next)
      } else if (e.key === 'ArrowLeft') {
        const prev = current <= 1 ? DOY_LEN : current - 1
        handleSelect(prev)
      } else if (e.key === 'Escape') {
        setInternalSelected(null)
        setInternalHovered(null)
        onHoverDay?.(null)
      }
    },
    [activeSelectedDoy, activeHoveredDoy, handleSelect, onHoverDay],
  )

  // Inspection day data for tooltip
  const activeDay = activeHoveredDoy ?? activeSelectedDoy

  const inspectedData = useMemo(() => {
    if (!activeDay) return null
    const idx = activeDay - 1
    const coverVal = soilCover[idx] ?? 0
    const n = nObs[idx] ?? 0
    const rVal = erosivity[idx] ?? 0
    const fVal = frostProb[idx] ?? 0
    const greenVal = greenCover ? greenCover[idx] : undefined
    const resVal = residueCover ? residueCover[idx] : undefined
    const classification = classifyDay(coverVal, n)
    const date = doyToDate(activeDay)

    return {
      doy: activeDay,
      date: date.label,
      classification,
      soilCover: coverVal,
      nObs: n,
      erosivity: rVal,
      frostProb: fVal,
      greenCover: greenVal,
      residueCover: resVal,
    }
  }, [activeDay, soilCover, nObs, erosivity, frostProb, greenCover, residueCover])

  const switchTo3D = () => {
    if (!isWebGLAvailable()) {
      setWebglError('WebGL is not available in your current browser session.')
      return
    }
    setWebglError(null)
    setMode('3D')
  }

  const switchTo2D = () => {
    setWebglError(null)
    setMode('2D')
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center gap-4 focus:outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Interactive Year Ring agricultural calendar"
    >
      {/* 2D / 3D Mode Toggle Header */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-black/10 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Visualization Mode:
          </span>
          <div className="inline-flex rounded-lg border border-black/10 bg-black/5 p-0.5 shadow-inner">
            <button
              type="button"
              onClick={switchTo2D}
              aria-pressed={mode === '2D'}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                mode === '2D'
                  ? 'bg-white text-canopy-deep shadow-sm'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              2D View
            </button>
            <button
              type="button"
              onClick={switchTo3D}
              aria-pressed={mode === '3D'}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                mode === '3D'
                  ? 'bg-white text-canopy-deep shadow-sm'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              3D View
            </button>
          </div>
        </div>

        {webglError && (
          <span className="text-xs font-medium text-risk-high">{webglError}</span>
        )}

        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <kbd className="rounded border border-black/15 bg-white px-1.5 py-0.5 font-mono text-[10px]">
            &larr; &rarr;
          </kbd>
          <span>Scrub DOY</span>
        </div>
      </div>

      {/* Main Visualization Display */}
      {mode === '2D' ? (
        <div className="relative w-full max-w-[620px]">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${size} ${size}`}
            className="h-auto w-full select-none touch-none drop-shadow-sm"
            onPointerMove={handleMove}
            onPointerLeave={handleLeave}
            onClick={() => activeHoveredDoy && handleSelect(activeHoveredDoy)}
            role="img"
            aria-label={`Year ring: this field is bare on ${bareDaysCount} of 365 days`}
          >
            <defs>
              <pattern
                id={`unknown-hatch-${componentId}`}
                width="4"
                height="4"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="4" stroke="#6b7280" strokeWidth="1.2" opacity="0.4" />
              </pattern>
            </defs>

            {/* Rainfall Erosivity Outer Bars */}
            <g aria-label="Rainfall erosivity layer">
              {riskPaths.map((d, i) => {
                const isBare = (nObs[i] ?? 1) > 0 && soilCover[i] < BARE_THRESHOLD
                return (
                  <path
                    key={`r${i}`}
                    d={d}
                    fill={isBare ? '#d4452e' : '#e8894a'}
                    opacity={isBare ? 0.95 : 0.45}
                  />
                )
              })}
            </g>

            {/* Soil Cover Ring Proper */}
            <g aria-label="365-day soil cover segments">
              {coverPaths.map((d, i) => {
                const cover = soilCover[i]
                const n = nObs[i] ?? 0
                const isUnknown = n <= 0
                return (
                  <g key={`c${i}`}>
                    <path
                      d={d}
                      fill={coverColor(cover, n)}
                      opacity={confidenceOpacity(n)}
                    />
                    {isUnknown && (
                      <path
                        d={d}
                        fill={`url(#unknown-hatch-${componentId})`}
                        pointerEvents="none"
                      />
                    )}
                  </g>
                )
              })}
            </g>

            {/* Candidate Rotation Comparison Band */}
            {compareCover && compareCover.length >= DOY_LEN && (
              <g opacity={0.95} aria-label="Candidate rotation comparison">
                {compareCover.map((v, i) => {
                  const step = (Math.PI * 2) / DOY_LEN
                  return (
                    <path
                      key={`comp${i}`}
                      d={annulusSegment(
                        cx,
                        cy,
                        rCoverInner - size * 0.055,
                        rCoverInner - size * 0.008,
                        i * step,
                        (i + 1) * step,
                      )}
                      fill={coverColor(v, 10)}
                    />
                  )
                })}
              </g>
            )}

            {/* Drag-to-fill highlight days */}
            {highlightSet && (
              <g aria-hidden>
                {coverPaths.map((d, i) =>
                  highlightSet.has(i + 1) ? (
                    <path
                      key={`h${i}`}
                      d={d}
                      fill="none"
                      stroke="#f5d547"
                      strokeWidth={2.5}
                    />
                  ) : null,
                )}
              </g>
            )}

            {/* Frost Risk Indicators */}
            {[lastSpringFrost, firstFallFrost].map((doy, idx) =>
              doy ? (
                <g key={`frost-${idx}`} aria-hidden>
                  <line
                    x1={polar(rCoverInner, doyToAngle(doy))[0]}
                    y1={polar(rCoverInner, doyToAngle(doy))[1]}
                    x2={polar(rRiskMax + 6, doyToAngle(doy))[0]}
                    y2={polar(rRiskMax + 6, doyToAngle(doy))[1]}
                    stroke="#4a7fb5"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                </g>
              ) : null,
            )}

            {/* Month Separator Lines */}
            <g aria-hidden stroke="#14110e" strokeWidth={0.8} opacity={0.25}>
              {MONTHS.map((m) => {
                const a = doyToAngle(m.startDoy)
                const [x1, y1] = polar(rCoverInner - 4, a)
                const [x2, y2] = polar(rRiskMax + 3, a)
                return <line key={`sep-${m.name}`} x1={x1} y1={y1} x2={x2} y2={y2} />
              })}
            </g>

            {/* 12 Month Labels */}
            <g className="fill-ink-soft" fontSize={size * 0.021} fontWeight={600}>
              {MONTHS.map((m) => {
                const midDoy = m.startDoy + Math.floor(m.days / 2)
                const a = doyToAngle(midDoy)
                const [x, y] = polar(rRiskMax + size * 0.045, a)
                return (
                  <text key={m.name} x={x} y={y} textAnchor="middle" dominantBaseline="middle">
                    {m.name}
                  </text>
                )
              })}
            </g>

            {/* October-to-May Circular Wrap Continuous Arc */}
            {longestGap?.wraps && (
              <g aria-label="Continuous winter-spring bare gap wrapping new year">
                <path
                  d={annulusSegment(
                    cx,
                    cy,
                    rCoverInner - size * 0.075,
                    rCoverInner - size * 0.065,
                    doyToAngle(longestGap.startDoy),
                    doyToAngle(longestGap.endDoy) + (doyToAngle(longestGap.endDoy) < doyToAngle(longestGap.startDoy) ? Math.PI * 2 : 0),
                  )}
                  fill="#8a6240"
                  opacity={0.65}
                />
              </g>
            )}

            {/* Active Selected Day Marker */}
            {activeSelectedDoy && (
              <g aria-label={`Selected day DOY ${activeSelectedDoy}`}>
                <line
                  x1={polar(rCoverInner - 6, doyToAngle(activeSelectedDoy))[0]}
                  y1={polar(rCoverInner - 6, doyToAngle(activeSelectedDoy))[1]}
                  x2={polar(rRiskMax + 8, doyToAngle(activeSelectedDoy))[0]}
                  y2={polar(rRiskMax + 8, doyToAngle(activeSelectedDoy))[1]}
                  stroke="#14110e"
                  strokeWidth={2.5}
                  pointerEvents="none"
                />
                <circle
                  cx={polar(rRiskMax + 10, doyToAngle(activeSelectedDoy))[0]}
                  cy={polar(rRiskMax + 10, doyToAngle(activeSelectedDoy))[1]}
                  r={3.5}
                  fill="#f5d547"
                  stroke="#14110e"
                  strokeWidth={1.5}
                />
              </g>
            )}

            {/* Hover Needle Marker */}
            {activeHoveredDoy && activeHoveredDoy !== activeSelectedDoy && (
              <line
                x1={polar(rCoverInner, doyToAngle(activeHoveredDoy))[0]}
                y1={polar(rCoverInner, doyToAngle(activeHoveredDoy))[1]}
                x2={polar(rRiskMax, doyToAngle(activeHoveredDoy))[0]}
                y2={polar(rRiskMax, doyToAngle(activeHoveredDoy))[1]}
                stroke="#14110e"
                strokeWidth={1.8}
                strokeDasharray="4 2"
                pointerEvents="none"
              />
            )}

            {/* Centre Readout */}
            <g textAnchor="middle" pointerEvents="none">
              <text
                x={cx}
                y={cy - size * 0.055}
                fontSize={size * 0.02}
                fontWeight={600}
                className="fill-ink-soft uppercase tracking-wider"
              >
                {yearLabel}
              </text>
              <text
                x={cx}
                y={cy + size * 0.015}
                fontSize={size * 0.11}
                fontWeight={700}
                className="fill-ink"
              >
                {bareDaysCount}
              </text>
              <text
                x={cx}
                y={cy + size * 0.065}
                fontSize={size * 0.026}
                fontWeight={500}
                className="fill-ink-soft"
              >
                days bare of 365{unknownDaysCount > 0 ? ` (${unknownDaysCount} unknown)` : ''}
              </text>
              {longestGap && (
                <text
                  x={cx}
                  y={cy + size * 0.1}
                  fontSize={size * 0.019}
                  className="fill-soil-bare font-medium"
                >
                  {longestGap.wraps ? '🔄 ' : ''}
                  Gap: {doyToDate(longestGap.startDoy).label} –{' '}
                  {doyToDate(longestGap.endDoy).label} ({longestGap.nDays}d)
                </text>
              )}
            </g>
          </svg>
        </div>
      ) : (
        <div className="w-full max-w-[620px]">
          <Suspense
            fallback={
              <div className="flex h-[500px] w-full flex-col items-center justify-center rounded-xl border border-black/10 bg-paper text-ink-soft">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-canopy-deep border-t-transparent" />
                <span className="mt-2 text-xs font-medium">Loading 3D Engine…</span>
              </div>
            }
          >
            <YearRing3D
              soilCover={soilCover}
              erosivity={erosivity}
              nObs={nObs}
              frostProb={frostProb}
              compareCover={compareCover}
              highlightDoys={highlightDoys}
              selectedDoy={activeSelectedDoy}
              hoveredDoy={activeHoveredDoy}
              onHoverDay={(d) => {
                setInternalHovered(d)
                onHoverDay?.(d)
              }}
              onSelectDay={handleSelect}
              onWebGLUnavailable={() => {
                setWebglError('WebGL is unsupported on this system. Falling back to 2D.')
                setMode('2D')
              }}
            />
          </Suspense>
        </div>
      )}

      {/* Interactive Floating Day Inspection Tooltip */}
      {inspectedData && (
        <div
          className="w-full max-w-[620px] rounded-lg border border-black/10 bg-white/95 p-3.5 shadow-sm backdrop-blur transition-all"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 pb-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-ink">
                {inspectedData.date}
              </span>
              <span className="font-mono text-xs text-ink-soft">
                (DOY {inspectedData.doy})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                  inspectedData.classification === 'covered'
                    ? 'bg-canopy-deep text-white'
                    : inspectedData.classification === 'bare'
                      ? 'bg-soil-bare text-white'
                      : 'bg-black/20 text-ink'
                }`}
              >
                {inspectedData.classification === 'covered'
                  ? 'Covered Soil'
                  : inspectedData.classification === 'bare'
                    ? 'Bare Soil'
                    : 'Unknown / Masked'}
              </span>
              {activeSelectedDoy === inspectedData.doy && (
                <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                  Selected Day
                </span>
              )}
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div>
              <div className="text-[11px] text-ink-soft">Soil Cover (Decision)</div>
              <div className="font-mono text-sm font-semibold text-ink">
                {(inspectedData.soilCover * 100).toFixed(1)}%
              </div>
            </div>

            <div>
              <div className="text-[11px] text-ink-soft">Supporting Evidence</div>
              <div className="font-mono text-xs text-ink">
                {inspectedData.greenCover !== undefined && (
                  <span>G: {(inspectedData.greenCover * 100).toFixed(0)}% </span>
                )}
                {inspectedData.residueCover !== undefined && (
                  <span>R: {(inspectedData.residueCover * 100).toFixed(0)}%</span>
                )}
                {inspectedData.greenCover === undefined &&
                  inspectedData.residueCover === undefined && (
                    <span className="text-ink-soft">max(green, res)</span>
                  )}
              </div>
            </div>

            <div>
              <div className="text-[11px] text-ink-soft">Satellite Passes</div>
              <div className="font-mono text-sm font-semibold text-ink">
                {inspectedData.nObs}{' '}
                <span className="text-[10px] font-normal text-ink-soft">obs</span>
              </div>
            </div>

            <div>
              <div className="text-[11px] text-ink-soft">Rain Erosivity R</div>
              <div className="font-mono text-sm font-semibold text-risk-high">
                {inspectedData.erosivity.toFixed(2)}
              </div>
            </div>
          </div>

          {inspectedData.nObs <= 0 && (
            <p className="mt-2 rounded bg-black/5 p-1.5 text-[11px] text-ink-soft">
              ⚠️ No usable satellite observations (cloud, snow, or shadow masked). Classified as unknown.
            </p>
          )}

          {inspectedData.classification === 'bare' && inspectedData.erosivity > maxR * 0.4 && (
            <p className="mt-2 rounded bg-risk-high/10 p-1.5 text-[11px] font-medium text-risk-high">
              ⚡ High Erosion Risk: Bare soil aligns with heavy erosive rainfall on this date.
            </p>
          )}
        </div>
      )}

      {/* Ring Scientific Legend Component */}
      <div className="w-full max-w-[620px]">
        <RingLegend compact={false} />
      </div>
    </div>
  )
}
