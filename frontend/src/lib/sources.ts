/**
 * What each data source actually produced, in one line.
 *
 * The bundle carries long citations; this maps them to the short "which
 * number came from where" a judge needs to confirm the data is used. The
 * reasoning behind each choice lives in the README, not on the screen.
 */

export interface SourceLine {
  /** Shown in bold. */
  name: string
  /** NASA sources are what the challenge requires, so mark them. */
  nasa: boolean
  /** One clause: what this source gave us. */
  gives: string
  /** Scale of the evidence, e.g. "9,125 days" or "481 scenes". */
  count: string
}

const MAP: { match: RegExp; name: string; nasa: boolean; gives: string; unit: string }[] = [
  {
    match: /POWER/i,
    name: 'NASA POWER',
    nasa: true,
    gives: 'rainfall, temperature, frost, growing degree days, soil water',
    unit: 'days',
  },
  { match: /Landsat/i, name: 'NASA Landsat 8/9', nasa: true, gives: 'green cover and crop residue', unit: 'clear scenes' },
  { match: /IMERG|GPM/i, name: 'NASA GPM IMERG', nasa: true, gives: 'precipitation', unit: 'obs' },
  { match: /NASADEM|SRTM/i, name: 'NASADEM', nasa: true, gives: 'elevation', unit: 'tiles' },
  { match: /Sentinel-2/i, name: 'Sentinel-2 (ESA)', nasa: false, gives: 'green cover and crop residue', unit: 'clear scenes' },
  { match: /Cropland Data Layer|CDL/i, name: 'USDA CDL', nasa: false, gives: 'which year was corn, which was soybeans', unit: 'years' },
]

const groups = (n: number) => n.toLocaleString('en-US')

export function sourceLines(sources: { name: string; n_obs?: number }[]): SourceLine[] {
  return sources.map((s) => {
    const hit = MAP.find((m) => m.match.test(s.name))
    const n = typeof s.n_obs === 'number' ? s.n_obs : 0
    return {
      name: hit?.name ?? s.name,
      nasa: hit?.nasa ?? /nasa/i.test(s.name),
      gives: hit?.gives ?? 'input data',
      count: n > 0 ? `${groups(n)} ${hit?.unit ?? 'obs'}` : '',
    }
  })
}
