import { describe, expect, it } from 'vitest'
import { buildMesh, rng } from './telemetryMesh'

describe('telemetry mesh', () => {
  it('is deterministic for a seed, and different across seeds', () => {
    const a = buildMesh({ seed: 7 })
    const b = buildMesh({ seed: 7 })
    const c = buildMesh({ seed: 8 })
    expect(a.nodes).toEqual(b.nodes)
    expect(a.edges).toEqual(b.edges)
    expect(a.nodes).not.toEqual(c.nodes)
  })

  it('keeps every node inside the frame', () => {
    const m = buildMesh({ seed: 3, width: 1600, height: 900, count: 80 })
    for (const n of m.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x).toBeLessThanOrEqual(m.width)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeLessThanOrEqual(m.height)
    }
  })

  it('never puts two nodes on top of each other', () => {
    // The jittered grid exists to prevent clumping; a pair closer than a
    // few units would render as one smudged dot.
    const m = buildMesh({ seed: 11, count: 60 })
    let closest = Infinity
    for (let i = 0; i < m.nodes.length; i++) {
      for (let j = i + 1; j < m.nodes.length; j++) {
        closest = Math.min(closest, Math.hypot(m.nodes[i].x - m.nodes[j].x, m.nodes[i].y - m.nodes[j].y))
      }
    }
    expect(closest).toBeGreaterThan(8)
  })

  it('only links nodes within the link radius', () => {
    const linkRadius = 200
    const m = buildMesh({ seed: 5, linkRadius })
    for (const e of m.edges) {
      const d = Math.hypot(m.nodes[e.a].x - m.nodes[e.b].x, m.nodes[e.a].y - m.nodes[e.b].y)
      expect(d).toBeLessThanOrEqual(linkRadius + 1e-9)
    }
  })

  it('honours the degree cap, so no node hubs the whole graph', () => {
    const maxDegree = 3
    const m = buildMesh({ seed: 2, maxDegree, count: 70 })
    const degree = new Array(m.nodes.length).fill(0)
    for (const e of m.edges) { degree[e.a]++; degree[e.b]++ }
    expect(Math.max(...degree)).toBeLessThanOrEqual(maxDegree)
  })

  it('reports strength in 0..1, brighter for closer pairs', () => {
    const m = buildMesh({ seed: 4 })
    expect(m.edges.length).toBeGreaterThan(0)
    for (const e of m.edges) {
      expect(e.strength).toBeGreaterThanOrEqual(0)
      expect(e.strength).toBeLessThanOrEqual(1)
    }
    const dist = (e: { a: number; b: number }) =>
      Math.hypot(m.nodes[e.a].x - m.nodes[e.b].x, m.nodes[e.a].y - m.nodes[e.b].y)
    const sorted = [...m.edges].sort((p, q) => dist(p) - dist(q))
    expect(sorted[0].strength).toBeGreaterThan(sorted[sorted.length - 1].strength)
  })

  it('staggers the pulse so nodes do not blink in unison', () => {
    const m = buildMesh({ seed: 9 })
    const delays = new Set(m.nodes.map((n) => n.delay.toFixed(4)))
    expect(delays.size).toBeGreaterThan(m.nodes.length * 0.8)
    for (const n of m.nodes) expect(n.delay).toBeGreaterThanOrEqual(0)
  })

  it('degrades rather than throwing on empty or tiny meshes', () => {
    expect(buildMesh({ count: 0 })).toMatchObject({ nodes: [], edges: [] })
    const one = buildMesh({ count: 1 })
    expect(one.nodes).toHaveLength(1)
    expect(one.edges).toHaveLength(0)
  })

  it('rng is mulberry32 in 0..1', () => {
    const r = rng(1)
    const vals = Array.from({ length: 200 }, r)
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(new Set(vals).size).toBeGreaterThan(190)
  })
})
