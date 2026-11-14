/**
 * The seed you are carrying, as the mouse cursor.
 *
 * The artwork is the species' real seed, from lib/seedArt.ts -- the same
 * paths the packet and the drag chip draw, so the thing under the pointer
 * is the thing you picked up.
 *
 * SIZE IS CAPPED BY THE PLATFORM, NOT BY TASTE. Windows refuses cursor
 * images much over 32x32 and drops them entirely rather than scaling, so
 * 32 is the ceiling here however large the drag chip gets. There is
 * always a keyword fallback at the end of the value for the case where
 * the data URI is rejected outright.
 */

import { seedSpec, seedSvgDocument } from './seedArt'

/** The largest a cursor image can be before Windows discards it. */
export const CURSOR_PX = 32

export function seedCursor(
  speciesId: string,
  fallback: 'grab' | 'grabbing' = 'grab',
): string {
  const svg = seedSvgDocument(seedSpec(speciesId), CURSOR_PX)
  // encodeURIComponent handles the '#' in every colour, which would
  // otherwise start a fragment and truncate the URI.
  const hot = Math.round(CURSOR_PX / 2)
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hot} ${hot}, ${fallback}`
}
