/**
 * Root systems, soil flecks and the erosion gate — pure geometry.
 *
 * No React, no DOM, no `getTotalLength()`. Everything here is deterministic
 * given a seed, which is what lets it be unit-tested in the default node
 * test environment the way `yearRing3dGeometry.ts` is.
 *
 * THE LOAD-BEARING IDEA: the root skeleton is generated ONCE and then
 * REVEALED. Each segment carries a threshold `t` — the green-cover value at
 * which that segment exists. Scrubbing the year changes two attributes per
 * path and regenerates no geometry at all. Winter retreat costs nothing
 * either, because the same expression simply runs backwards as cover falls.
 */

/** mulberry32, the same generator ProceduralTree.ts uses. One noise source. */
export function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export interface RootSegment {
  /** SVG path data, a single quadratic. */
  d: string
  /** Green cover at which this segment appears, 0-1. */
  t: number
  /** Stroke width in viewBox units. */
  w: number
  /** Branch depth, 0 = tap root. */
  order: number
}

export interface RootOptions {
  width: number
  height: number
  /** y of the soil surface; roots live below this. */
  surfaceY: number
  seed?: number
  /** Separate plants across the width. Several beats one big tree. */
  plants?: number
  /** Hard stop so a bad seed cannot run away. */
  maxSegments?: number
}

/** Deepest a tap root may reach, as a fraction of the space below surfaceY. */
const MAX_DEPTH_FRACTION = 0.94
const MAX_ORDER = 4
const MIN_WIDTH = 0.4

/**
 * Branching probability by order. It FALLS with depth on purpose: real root
 * systems fan out densely near the surface and taper to a few deep tips.
 * Rising probability produces a bush, which reads as a scribble.
 */
const BRANCH_P = [0.92, 0.72, 0.46, 0.22, 0]

export function buildRootSystem(opts: RootOptions): RootSegment[] {
  const { width, height, surfaceY } = opts
  const seed = opts.seed ?? 1
  const plants = opts.plants ?? 4
  const maxSegments = opts.maxSegments ?? 400

  const random = rng(seed)
  const segments: RootSegment[] = []
  const span = Math.max(1, height - surfaceY)
  const maxDepth = surfaceY + span * MAX_DEPTH_FRACTION

  const grow = (
    x: number,
    y: number,
    angle: number, // radians, PI/2 is straight down
    w: number,
    order: number,
  ): void => {
    if (order > MAX_ORDER || w < MIN_WIDTH || y >= maxDepth) return
    if (segments.length >= maxSegments) return

    // Shorter steps as the root thins, so tips are finely drawn.
    const len = (span * 0.17 + random() * span * 0.1) * (0.55 + w / 7)
    // Gravitropism: always nudged back toward straight down.
    const drift = (random() - 0.5) * 0.85
    const nextAngle = angle * 0.78 + (Math.PI / 2) * 0.22 + drift * 0.3
    const x1 = x + Math.cos(nextAngle) * len
    const y1 = y + Math.sin(nextAngle) * len

    // Control point offset perpendicular to travel gives an organic bow
    // rather than a straight stick.
    const bow = (random() - 0.5) * len * 0.55
    const cx = (x + x1) / 2 + Math.cos(nextAngle + Math.PI / 2) * bow
    const cy = (y + y1) / 2 + Math.sin(nextAngle + Math.PI / 2) * bow

    const normDepth = clamp01((y1 - surfaceY) / span)
    // Deeper and finer segments need more cover before they exist.
    const t = clamp01(normDepth * 0.72 + order * 0.07 + (random() - 0.5) * 0.08)

    segments.push({
      d: `M${x.toFixed(2)} ${y.toFixed(2)}Q${cx.toFixed(2)} ${cy.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      t,
      w: Math.round(w * 100) / 100,
      order,
    })

    // Continue the same root.
    grow(x1, y1, nextAngle, w * 0.84, order)

    // Spawn laterals, fanning less as we go deeper.
    const p = BRANCH_P[Math.min(order, BRANCH_P.length - 1)]
    const children = random() < p ? (random() < 0.3 ? 2 : 1) : 0
    for (let i = 0; i < children; i++) {
      const side = i === 0 ? 1 : -1
      const spread = (0.35 + random() * 0.45) * side
      grow(x1, y1, nextAngle + spread, w * 0.62, order + 1)
    }
  }

  for (let i = 0; i < plants; i++) {
    // Spread the crowns evenly, jittered, and keep them off the edges.
    const x = width * ((i + 0.5) / plants) + (random() - 0.5) * (width / plants) * 0.45
    grow(x, surfaceY, Math.PI / 2 + (random() - 0.5) * 0.3, 3.1 + random() * 0.8, 0)
  }

  return segments
}

export interface Fleck {
  x: number
  size: number
  /** Animation delay in seconds. */
  delay: number
  /** Horizontal drift in viewBox units. */
  driftX: number
  rotate: number
}

/** A fixed pool, reused forever. Spawning per frame is what we are avoiding. */
export function buildFleckPool(seed = 7, count = 16, width = 420): Fleck[] {
  const random = rng(seed)
  return Array.from({ length: count }, () => ({
    x: Math.round(random() * width * 100) / 100,
    size: Math.round((1.1 + random() * 2.2) * 100) / 100,
    delay: Math.round(random() * 2800) / 1000,
    driftX: Math.round((random() - 0.5) * 46 * 100) / 100,
    rotate: Math.round(random() * 360),
  }))
}

/** Bare threshold, mirrored from the backend and lib/cropFit.ts. */
export const BARE_THRESHOLD = 0.3

/**
 * How hard this day is eroding, 0-1. Drives fleck opacity and speed.
 *
 * Two rules that are not negotiable:
 *
 *  - `nObs === 0` means UNKNOWN, never bare. The whole project refuses to
 *    treat an unobserved day as exposed, and shedding soil on one would
 *    contradict the contract stated in YearRing.tsx and in the schema.
 *  - Covered soil does not erode here. Above the 0.30 NRCS threshold the
 *    answer is flatly zero, so the picture and the panel numbers agree.
 */
export function erosionIntensity(
  cover: number,
  r: number,
  rMax: number,
  nObs = 1,
): number {
  if (nObs <= 0) return 0
  if (!Number.isFinite(cover) || cover >= BARE_THRESHOLD) return 0
  if (!(rMax > 0) || !Number.isFinite(r) || r <= 0) return 0
  // Exposure rises as cover falls away from the threshold, scaled by how
  // heavy the rain is relative to the year's worst day.
  const exposure = clamp01((BARE_THRESHOLD - cover) / BARE_THRESHOLD)
  return clamp01(exposure * clamp01(r / rMax))
}
