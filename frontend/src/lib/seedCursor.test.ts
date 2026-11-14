import { describe, expect, it } from 'vitest'
import { CURSOR_PX, seedCursor } from './seedCursor'
import { seedBody, seedSpec, seedSvgDocument } from './seedArt'

/** Every species the shipped bundles offer. */
const SPECIES = [
  'cereal_rye', 'winter_wheat', 'triticale', 'winter_barley', 'oats',
  'annual_ryegrass', 'hairy_vetch', 'crimson_clover', 'red_clover',
  'austrian_winter_pea', 'forage_radish', 'buckwheat',
]

describe('seed art', () => {
  it('has a spec for every species in the bundles', () => {
    for (const id of SPECIES) {
      const spec = seedSpec(id)
      expect(spec.fill).toMatch(/^#[0-9a-f]{6}$/i)
      expect(spec.ink).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('falls back rather than returning undefined for an unknown species', () => {
    const spec = seedSpec('sorghum_sudangrass')
    expect(spec.fill).toMatch(/^#[0-9a-f]{6}$/i)
    expect(seedBody(spec).length).toBeGreaterThan(0)
  })

  it('draws buckwheat as a three-sided achene, not another ellipse', () => {
    // The one species whose seed is a different solid. If this ever
    // collapses into the default shape the packets stop being
    // distinguishable at a glance.
    expect(seedSpec('buckwheat').shape).toBe('pyramid')
    expect(seedBody(seedSpec('buckwheat'))).toContain('<path')
    expect(seedBody(seedSpec('buckwheat'))).not.toContain('<ellipse')
  })

  it('gives hulled grains an awn and bare caryopses a crease', () => {
    expect(seedSpec('winter_barley').shape).toBe('awned')
    expect(seedSpec('oats').shape).toBe('awned')
    expect(seedSpec('cereal_rye').shape).toBe('grain')
    expect(seedSpec('winter_wheat').shape).toBe('grain')
  })

  it('renders distinguishable bodies across the species', () => {
    const bodies = new Set(SPECIES.map((id) => seedBody(seedSpec(id))))
    // Shapes are shared by family, so not twelve, but a handful at least.
    expect(bodies.size).toBeGreaterThanOrEqual(5)
  })

  it('never emits text or an external reference', () => {
    for (const id of SPECIES) {
      const body = seedBody(seedSpec(id))
      // A cursor cannot load anything, and glyphs need a font that the
      // compositor may not have.
      expect(body).not.toContain('<text')
      expect(body).not.toMatch(/href=|url\(/)
    }
  })

  it('wraps into a well-formed standalone document', () => {
    const doc = seedSvgDocument(seedSpec('cereal_rye'), 32)
    expect(doc.startsWith('<svg')).toBe(true)
    expect(doc.endsWith('</svg>')).toBe(true)
    expect(doc).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(doc).toContain('viewBox="0 0 32 32"')
  })
})

describe('seed cursor', () => {
  it('escapes every colour, so no hex truncates the data URI', () => {
    for (const id of SPECIES) {
      const v = seedCursor(id)
      expect(v).toContain('%23')
      // A raw '#' inside the URI would start a fragment and cut it short.
      const uri = v.slice(v.indexOf('url("') + 5, v.indexOf('")'))
      expect(uri).not.toContain('#')
    }
  })

  it('stays within the size a browser will accept', () => {
    // Windows discards cursor images much over 32px rather than scaling.
    expect(CURSOR_PX).toBeLessThanOrEqual(32)
    // The value is percent-encoded, so decode before reading the markup.
    const v = seedCursor('cereal_rye')
    const svg = decodeURIComponent(v.slice(v.indexOf(',') + 1, v.indexOf('")')))
    expect(svg).toContain(`width="${CURSOR_PX}"`)
    expect(svg).toContain(`height="${CURSOR_PX}"`)
  })

  it('centres the hotspot and always ends in a keyword fallback', () => {
    expect(seedCursor('oats')).toMatch(/\) 16 16, grab$/)
    expect(seedCursor('oats', 'grabbing')).toMatch(/\) 16 16, grabbing$/)
  })

  it('gives different species different cursors', () => {
    const cursors = new Set(SPECIES.map((id) => seedCursor(id)))
    expect(cursors.size).toBeGreaterThanOrEqual(5)
    expect(seedCursor('buckwheat')).not.toBe(seedCursor('cereal_rye'))
  })
})
