/**
 * The constellation mesh behind the title card.
 *
 * GENERATED ONCE, ANIMATED WITH CSS. There is no requestAnimationFrame
 * loop here and no canvas: a seeded PRNG lays the nodes out at mount, the
 * edges are solved once, and everything after that is CSS. Same decision
 * as rootGeometry.ts, for the same reason -- a per-frame JS loop on the
 * landing screen would be competing with the narration, the audio graph
 * and a lazy WebGL chunk that is already being fetched.
 *
 * WHY THE WHOLE MESH DRIFTS AND THE NODES ONLY PULSE. If each node drifted
 * on its own the edges would have to be recomputed every frame, which is
 * the rAF loop this avoids -- and worse, lines would visibly detach from
 * the dots they connect. Translating the group keeps every edge attached
 * while still reading as motion; the per-node pulse, staggered by a
 * delay, is what makes it look alive rather than like a sliding picture.
 *
 * Seeded, so it is deterministic and testable in plain node.
 */

/** mulberry32, the generator rootGeometry.ts and ProceduralTree.ts use. */
export function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface MeshNode {
  x: number
  y: number
  /** Dot radius in viewBox units. */
  r: number
  /** Seconds, so each node pulses out of step with its neighbours. */
  delay: number
}

export interface MeshEdge {
  a: number
  b: number
  /** 0..1, brighter when the two nodes are closer. */
  strength: number
}

export interface Mesh {
  nodes: MeshNode[]
  edges: MeshEdge[]
  width: number
  height: number
}

export interface MeshOptions {
  width?: number
  height?: number
  count?: number
  /** Edges are drawn between nodes closer than this, in viewBox units. */
  linkRadius?: number
  /** Stop any one node hubbing the whole graph. */
  maxDegree?: number
  seed?: number
}

/**
 * Lay out `count` nodes on a jittered grid and link the near ones.
 *
 * A JITTERED GRID, NOT PURE RANDOM. Uniform random points clump: you get
 * three nodes on top of each other in one corner and a bare patch in the
 * next, which reads as a mistake rather than as a network. Walking a grid
 * and pushing each node off its cell centre keeps the spacing honest and
 * still looks unplanned.
 */
export function buildMesh(opts: MeshOptions = {}): Mesh {
  const width = opts.width ?? 1600
  const height = opts.height ?? 900
  const count = Math.max(0, opts.count ?? 46)
  const linkRadius = opts.linkRadius ?? 290
  const maxDegree = opts.maxDegree ?? 4
  const random = rng(opts.seed ?? 7)

  if (count === 0) return { nodes: [], edges: [], width, height }

  // Grid shaped to the canvas so cells stay roughly square.
  const cols = Math.max(1, Math.round(Math.sqrt((count * width) / height)))
  const rows = Math.max(1, Math.ceil(count / cols))
  const cellW = width / cols
  const cellH = height / rows

  const nodes: MeshNode[] = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    // 0.5 keeps the node inside its own cell, so two never collide.
    nodes.push({
      x: (col + 0.5 + (random() - 0.5) * 0.82) * cellW,
      y: (row + 0.5 + (random() - 0.5) * 0.82) * cellH,
      r: 1.3 + random() * 2.1,
      delay: random() * 9,
    })
  }

  // Nearest-first, so when a node hits maxDegree it keeps its closest
  // links rather than whichever happened to be tried first.
  const candidates: { a: number; b: number; d: number }[] = []
  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y)
      if (d <= linkRadius) candidates.push({ a, b, d })
    }
  }
  candidates.sort((p, q) => p.d - q.d)

  const degree = new Array(nodes.length).fill(0)
  const edges: MeshEdge[] = []
  for (const { a, b, d } of candidates) {
    if (degree[a] >= maxDegree || degree[b] >= maxDegree) continue
    degree[a]++
    degree[b]++
    edges.push({ a, b, strength: 1 - d / linkRadius })
  }

  return { nodes, edges, width, height }
}
