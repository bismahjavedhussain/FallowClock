/**
 * Copy the raw PixelLab drops in FarmerAnimations/ into public/sprite/.
 *
 *     npm run sync:sprites
 *
 * WHY THIS EXISTS: the generator names folders after the prompt, nests the
 * frames inconsistently (sometimes <state>/rotations, sometimes just
 * rotations) and sometimes omits metadata.json. Nothing in the app can
 * import from those paths, and Vite must not even watch them -- a folder
 * appearing or being deleted while the watcher is attached takes the dev
 * server down with an EBUSY on Windows, which has happened three times.
 *
 * So the drops stay as source material and this script publishes them to
 * stable names the components can rely on.
 */

import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'FarmerAnimations')
const OUT = join(ROOT, 'public', 'sprite')

/** Source folder (matched case-insensitively on a substring) -> served name. */
const POSES = [
  { match: 'standing', to: 'farmer', label: 'idle' },
  { match: 'walking', to: 'farmer-wave', label: 'wave (arm raised)' },
  { match: 'writing', to: 'farmer-write', label: 'writing' },
]

const DIRECTIONS = [
  'south', 'south-east', 'east', 'north-east',
  'north', 'north-west', 'west', 'south-west',
]

/** Find the folder holding the eight rotation PNGs, at any nesting depth. */
async function findRotations(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  if (entries.some((e) => e.isFile() && e.name === 'south.png')) return dir
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const hit = await findRotations(join(dir, e.name))
    if (hit) return hit
  }
  return null
}

if (!existsSync(SRC)) {
  console.error(`No ${SRC}. Drop the generator folders there first.`)
  process.exit(1)
}

const drops = (await readdir(SRC, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

let copied = 0
let missing = 0

for (const pose of POSES) {
  const drop = drops.find((d) => d.toLowerCase().includes(pose.match))
  if (!drop) {
    console.warn(`  SKIP  ${pose.to.padEnd(14)} no folder matching "${pose.match}"`)
    missing += 1
    continue
  }
  const from = await findRotations(join(SRC, drop))
  if (!from) {
    console.warn(`  SKIP  ${pose.to.padEnd(14)} ${drop} has no south.png anywhere`)
    missing += 1
    continue
  }
  const dest = join(OUT, pose.to)
  await mkdir(dest, { recursive: true })

  let n = 0
  for (const d of DIRECTIONS) {
    const file = join(from, `${d}.png`)
    if (!existsSync(file)) {
      console.warn(`  WARN  ${pose.to}/${d}.png missing in the drop`)
      continue
    }
    await cp(file, join(dest, `${d}.png`))
    n += 1
  }
  const size = (await stat(join(dest, 'south.png'))).size
  console.log(`  OK    ${pose.to.padEnd(14)} ${n}/8 frames  <- ${drop}  (${pose.label}, ${size} B)`)
  copied += n
}

console.log(`\n${copied} frames published to public/sprite.`)
if (missing) {
  console.log(`${missing} pose(s) had no source folder; the app keeps whatever was already published.`)
}
