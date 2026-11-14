/**
 * What each cover-crop seed actually looks like.
 *
 * DRAWN, NOT PHOTOGRAPHED. Twelve licensed seed photographs would be
 * twelve files to ship, twelve attributions to carry, and they would not
 * survive being shrunk to a 32px cursor -- a photo of a rye grain at that
 * size is a brown smudge. Vector silhouettes stay readable from 20px to
 * 80px and cost nothing to ship.
 *
 * THE SHAPES ARE REAL ONES. A buckwheat achene is a three-sided pyramid,
 * which is why it looks nothing like the others; cereal grains are
 * caryopses with a longitudinal crease and a germ at one end; barley and
 * oats keep a hull with an awn; clovers are small ovoids with a hilum
 * notch; peas and vetch are near-spherical. Someone who has handled these
 * should be able to tell which packet they are carrying, so the grouping
 * follows the seed, not the alphabet.
 *
 * Colours are approximate but in the right family: rye greenish-tan,
 * wheat amber, vetch almost black, radish reddish, buckwheat dark brown.
 */

export type SeedShape = 'grain' | 'awned' | 'ovoid' | 'round' | 'pyramid'

export interface SeedSpec {
  shape: SeedShape
  /** Body fill. */
  fill: string
  /** Outline and interior detail. */
  ink: string
}

const DEFAULT: SeedSpec = { shape: 'ovoid', fill: '#9a8757', ink: '#3d3524' }

const SEEDS: Record<string, SeedSpec> = {
  // Cereals: caryopsis with a crease.
  cereal_rye: { shape: 'grain', fill: '#9c8d5e', ink: '#443b22' },
  winter_wheat: { shape: 'grain', fill: '#cd9a4b', ink: '#5a3c15' },
  triticale: { shape: 'grain', fill: '#b08a4e', ink: '#4e381a' },
  // Hulled, so they keep an awn.
  winter_barley: { shape: 'awned', fill: '#d6b87c', ink: '#6a5121' },
  oats: { shape: 'awned', fill: '#ddc894', ink: '#6d5a2b' },
  annual_ryegrass: { shape: 'grain', fill: '#b6a06a', ink: '#4c411f' },
  // Legumes.
  hairy_vetch: { shape: 'round', fill: '#413b32', ink: '#17130e' },
  crimson_clover: { shape: 'ovoid', fill: '#dbb843', ink: '#6b531a' },
  red_clover: { shape: 'ovoid', fill: '#9a853c', ink: '#4a3c14' },
  austrian_winter_pea: { shape: 'round', fill: '#93a361', ink: '#45502a' },
  // Brassica.
  forage_radish: { shape: 'round', fill: '#ad5a31', ink: '#582313' },
  // The odd one out, and it should look it.
  buckwheat: { shape: 'pyramid', fill: '#4f3d2b', ink: '#1f1710' },
}

export function seedSpec(speciesId: string): SeedSpec {
  return SEEDS[speciesId] ?? DEFAULT
}

/**
 * The seed's SVG body, for a 32x32 viewBox.
 *
 * Returned as markup rather than JSX so one definition serves both the
 * React icon and the `cursor:` data URI -- a cursor cannot mount a
 * component, and two copies of these paths would drift apart.
 */
export function seedBody(spec: SeedSpec): string {
  const { fill, ink } = spec
  const edge = `stroke="${ink}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"`
  const hair = `stroke="${ink}" stroke-width="1.2" fill="none" stroke-linecap="round" opacity="0.75"`

  switch (spec.shape) {
    case 'grain':
      // Caryopsis: long axis tilted, crease down it, germ at the base.
      return (
        `<g transform="rotate(-20 16 16)">` +
        `<ellipse cx="16" cy="16" rx="6.4" ry="10.6" fill="${fill}" ${edge}/>` +
        `<path d="M16 6.6 L16 25.4" ${hair}/>` +
        `<path d="M13.2 23.6 Q16 26.2 18.8 23.6" ${hair}/>` +
        `</g>`
      )
    case 'awned':
      // Hulled grain, slimmer, with the awn that gives barley and oats
      // their silhouette in a seed bag.
      return (
        `<g transform="rotate(-20 16 16)">` +
        `<path d="M16 3.2 L16 8.4" ${hair}/>` +
        `<ellipse cx="16" cy="17.4" rx="5.4" ry="9.4" fill="${fill}" ${edge}/>` +
        `<path d="M16 9.2 L16 25.6" ${hair}/>` +
        `</g>`
      )
    case 'ovoid':
      // Clover: small, one flattened flank, hilum notch on it.
      return (
        `<g transform="rotate(-14 16 16)">` +
        `<path d="M16 6.4 C21 6.4 24.4 10.8 24.4 16 C24.4 21.2 21 25.6 16 25.6 ` +
        `C11.6 25.6 8.4 21.6 8.4 16.6 C8.4 11.2 11.6 6.4 16 6.4 Z" fill="${fill}" ${edge}/>` +
        `<path d="M10.6 14.4 L12.6 16.6" ${hair}/>` +
        `</g>`
      )
    case 'round':
      // Pea, vetch, radish: near-spherical, hilum scar, one highlight.
      return (
        `<circle cx="16" cy="16" r="9.4" fill="${fill}" ${edge}/>` +
        `<path d="M9.6 19.6 Q10.4 13.6 15.4 10.6" ${hair}/>` +
        `<ellipse cx="22" cy="18.6" rx="2.1" ry="1.3" transform="rotate(32 22 18.6)" ` +
        `fill="${ink}" opacity="0.55"/>`
      )
    case 'pyramid':
      // Buckwheat achene: three faces, and the ridge between two of them.
      return (
        `<path d="M16 4.6 L26 25.2 L6 25.2 Z" fill="${fill}" ${edge}/>` +
        `<path d="M16 4.6 L16 25.2" ${hair}/>` +
        `<path d="M16 4.6 L21.4 25.2" ${hair}/>`
      )
  }
}

/** A complete standalone SVG document, for a `cursor:` data URI. */
export function seedSvgDocument(spec: SeedSpec, size: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">` +
    seedBody(spec) +
    `</svg>`
  )
}
