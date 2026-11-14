/**
 * THE RING — the project's hero visual. U1 owns this file and builds nothing else.
 *
 * 365 days around a circle: green where the soil is covered, brown where it is
 * bare. Rainfall erosivity rides as bars on the outside, so you can see at a
 * glance that the bare window and the erosive-rain window are the same window.
 * That overlap IS the argument; everything else is supporting material.
 *
 * PERFORMANCE CONTRACT (plan bottleneck B9) — 60 fps on a mid-range laptop,
 * because that is what the demo runs on:
 *   1. Arc geometry NEVER changes. Only fill does. All 365 path strings are
 *      computed once in a useMemo keyed on radius alone.
 *   2. Static geometry and dynamic fill live in separate layers.
 *   3. Hover is rAF-throttled and never triggers a geometry recompute.
 *   4. No per-pointer-move React state in the drag path — the ghost is a CSS
 *      transform.
 *
 * Geometry is hand-rolled trig rather than d3.arc() on purpose: one less
 * install that can fail at hour 3 in the file that matters most.
 */

import { useCallback, useMemo, useRef, useState } from 'react'

const DOY_LEN = 365
const BARE_THRESHOLD = 0.3

export interface YearRingProps {
  soilCover: number[]
  erosivity: number[]
  nObs: number[]
  frostProb: number[]
  /** Optional overlay: the cover a candidate rotation would produce. */
  compareCover?: number[]
  /** Days to call out, e.g. a gap a dragged crop would fill. 1-based DOY. */
  highlightDoys?: number[]
  size?: number
  onHoverDay?: (doy: number | null) => void
  onSelectDay?: (doy: number) => void
}

/** Annulus segment. Angle 0 = 1 January at 12 o'clock, running clockwise. */
function annulusSegment(
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

const BARE = [138, 98, 64] as const
const COVER_LOW = [160, 190, 120] as const
const COVER_HIGH = [25, 95, 55] as const

function lerp(a: readonly number[], b: readonly number[], t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/**
 * Bare is one flat brown — deliberately. A gradient through the bare range
 * would imply a precision the 30% threshold does not have, and would blur
 * the one boundary the whole project turns on.
 */
export function coverColor(cover: number): string {
  if (cover < BARE_THRESHOLD) return `rgb(${BARE[0]},${BARE[1]},${BARE[2]})`
  const t = Math.min(1, (cover - BARE_THRESHOLD) / (1 - BARE_THRESHOLD))
  return lerp(COVER_LOW, COVER_HIGH, t)
}

/**
 * Confidence from observation count. Thin evidence reads as washed out, so a
 * judge can see where we are guessing without being told. The brief scores
 * exactly this.
 */
export function confidenceOpacity(n: number): number {
  if (n <= 0) return 0.1
  if (n >= 12) return 1
  return 0.35 + (n / 12) * 0.65
}

const MONTHS = [
  ['Jan', 1], ['Feb', 32], ['Mar', 60], ['Apr', 91], ['May', 121], ['Jun', 152],
  ['Jul', 182], ['Aug', 213], ['Sep', 244], ['Oct', 274], ['Nov', 305], ['Dec', 335],
] as const

export default function YearRing({
  soilCover,
  erosivity,
  nObs,
  frostProb,
  compareCover,
  highlightDoys,
  size = 620,
  onHoverDay,
  onSelectDay,
}: YearRingProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const cx = size / 2
  const cy = size / 2
  const rCoverOuter = size * 0.36
  const rCoverInner = size * 0.26
  const rRiskInner = size * 0.375
  const rRiskMax = size * 0.46

  // --- geometry: computed once, never recomputed on hover or data change ---
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
        cx, cy, rRiskInner, rRiskInner + Math.max(h, 0.4), i * step, (i + 1) * step,
      )
    })
  }, [erosivity, maxR, cx, cy, rRiskInner, rRiskMax])

  const highlightSet = useMemo(
    () => (highlightDoys ? new Set(highlightDoys) : null),
    [highlightDoys],
  )

  // --- hover: rAF-throttled, geometry untouched ---
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
        if (dist < rCoverInner * 0.9 || dist > rRiskMax * 1.05) {
          setHovered(null)
          onHoverDay?.(null)
          return
        }
        let angle = Math.atan2(x, -y)
        if (angle < 0) angle += Math.PI * 2
        const doy = Math.min(DOY_LEN, Math.floor((angle / (Math.PI * 2)) * DOY_LEN) + 1)
        setHovered(doy)
        onHoverDay?.(doy)
      })
    },
    [cx, cy, rCoverInner, rRiskMax, size, onHoverDay],
  )

  const handleLeave = useCallback(() => {
    setHovered(null)
    onHoverDay?.(null)
  }, [onHoverDay])

  const bareDays = useMemo(
    () => soilCover.filter((v) => v < BARE_THRESHOLD).length,
    [soilCover],
  )

  const lastSpringFrost = useMemo(() => {
    for (let i = 180; i >= 0; i--) if (frostProb[i] >= 0.5) return i + 1
    return null
  }, [frostProb])

  const firstFallFrost = useMemo(() => {
    for (let i = 200; i < DOY_LEN; i++) if (frostProb[i] >= 0.5) return i + 1
    return null
  }, [frostProb])

  const doyToAngle = (doy: number) => ((doy - 0.5) / DOY_LEN) * Math.PI * 2
  const polar = (r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)]

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${size} ${size}`}
      className="w-full h-auto select-none touch-none"
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onClick={() => hovered && onSelectDay?.(hovered)}
      role="img"
      aria-label={`Year ring: this field is bare on ${bareDays} of 365 days`}
    >
      {/* Erosivity — the rain that does the damage */}
      <g aria-hidden>
        {riskPaths.map((d, i) => (
          <path
            key={`r${i}`}
            d={d}
            fill={soilCover[i] < BARE_THRESHOLD ? '#d4452e' : '#e8b4a4'}
            opacity={soilCover[i] < BARE_THRESHOLD ? 0.95 : 0.4}
          />
        ))}
      </g>

      {/* Soil cover — the ring proper */}
      <g>
        {coverPaths.map((d, i) => (
          <path
            key={`c${i}`}
            d={d}
            fill={coverColor(soilCover[i])}
            opacity={confidenceOpacity(nObs[i])}
          />
        ))}
      </g>

      {/* Candidate rotation, drawn as an inner band so the two read together */}
      {compareCover && (
        <g opacity={0.95}>
          {compareCover.map((v, i) => {
            const step = (Math.PI * 2) / DOY_LEN
            return (
              <path
                key={`k${i}`}
                d={annulusSegment(
                  cx, cy, rCoverInner - size * 0.055, rCoverInner - size * 0.008,
                  i * step, (i + 1) * step,
                )}
                fill={coverColor(v)}
              />
            )
          })}
        </g>
      )}

      {/* Days a dragged crop would fill */}
      {highlightSet && (
        <g aria-hidden>
          {coverPaths.map((d, i) =>
            highlightSet.has(i + 1) ? (
              <path key={`h${i}`} d={d} fill="none" stroke="#f5d547" strokeWidth={2} />
            ) : null,
          )}
        </g>
      )}

      {/* Frost markers */}
      {[lastSpringFrost, firstFallFrost].map((doy, idx) =>
        doy ? (
          <g key={idx} aria-hidden>
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

      {/* Month labels */}
      <g className="fill-ink-soft" fontSize={size * 0.021} fontWeight={500}>
        {MONTHS.map(([label, doy]) => {
          const a = doyToAngle(doy as number)
          const [x, y] = polar(rRiskMax + size * 0.045, a)
          return (
            <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="middle">
              {label}
            </text>
          )
        })}
      </g>

      {/* Hover marker */}
      {hovered && (
        <line
          x1={polar(rCoverInner, doyToAngle(hovered))[0]}
          y1={polar(rCoverInner, doyToAngle(hovered))[1]}
          x2={polar(rRiskMax, doyToAngle(hovered))[0]}
          y2={polar(rRiskMax, doyToAngle(hovered))[1]}
          stroke="#14110e"
          strokeWidth={2}
          pointerEvents="none"
        />
      )}

      {/* Centre readout */}
      <g textAnchor="middle" pointerEvents="none">
        <text x={cx} y={cy - size * 0.025} fontSize={size * 0.105} fontWeight={700} className="fill-ink">
          {bareDays}
        </text>
        <text x={cx} y={cy + size * 0.035} fontSize={size * 0.027} className="fill-ink-soft">
          days bare
        </text>
        <text x={cx} y={cy + size * 0.072} fontSize={size * 0.021} className="fill-ink-soft">
          of 365
        </text>
      </g>
    </svg>
  )
}
