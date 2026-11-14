/**
 * One seed, at whatever size the caller needs.
 *
 * The body comes from lib/seedArt.ts as markup rather than JSX so the
 * same definition feeds this component and the `cursor:` data URI. A
 * cursor cannot mount a component, and keeping two copies of the paths
 * would let the packet and the cursor drift apart.
 */

import { seedBody, seedSpec } from '../lib/seedArt'

export default function SeedIcon({
  speciesId,
  size = 32,
  title,
}: {
  speciesId: string
  size?: number
  /** Omit for decoration; supply only where the seed is the sole label. */
  title?: string
}) {
  const spec = seedSpec(speciesId)
  return (
    <svg
      className="seed-icon"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: seedBody(spec) }}
    />
  )
}
