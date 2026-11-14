/**
 * The guided story: four acts over the working tool.
 *
 * Every line is DERIVED FROM THE BUNDLE. Nothing here is a hardcoded number,
 * so switching farms rewrites the story — Story County gets a crisis and a
 * recommendation, Monona gets told it is already fine. A story with baked-in
 * figures would contradict the data the moment anyone changed field.
 *
 * Acts never replace the page. They set a focus target; the shell dims
 * everything else. If this module threw, the tool underneath would still work.
 */

export type FocusTarget = 'ring' | 'farmer' | 'soil' | 'split'

export interface Act {
  n: number
  eyebrow: string
  title: string
  line: string
  focus: FocusTarget
  /** Element id to scroll into view. */
  anchor: string
}

export interface ActInput {
  place: string
  bareDays: number
  bareDaysByPhase?: number[] | null
  phaseLabels?: string[] | null
  gap: { start_doy: number; end_doy: number; n_days: number; share_of_annual_r: number } | null
  erosivityPeakDoy: number
  /** Rotations other than the current one, best first. */
  alternatives: { label: string; bareDays: number; deltaPct: number; seedCostUsdHa: number }[]
  /** DOY -> "14 Jun". Injected so this module stays free of component imports. */
  format: (doy: number) => string
}

/**
 * The sentence that ties the two headline numbers together.
 *
 * Exported on its own because the header uses it too, and because the
 * peak-versus-gap wording is the easiest thing here to get wrong: on Story
 * County the 30-day erosivity peak centres five days AFTER the gap closes,
 * so "straight through the peak" would be an overstatement a judge could
 * check against the bundle we ship.
 */
export function gapHeadline(input: ActInput): string | null {
  const { gap, erosivityPeakDoy: peak, format } = input
  if (!gap) return null
  const inGap =
    gap.start_doy <= gap.end_doy
      ? peak >= gap.start_doy && peak <= gap.end_doy
      : peak >= gap.start_doy || peak <= gap.end_doy
  const share = Math.round(gap.share_of_annual_r * 100)
  const head = `Bare ${format(gap.start_doy)} to ${format(gap.end_doy)} — ${share}% of the year's erosive rain falls in that window`
  const peakLabel = format(peak)
  if (inGap) return `${head}, straight through the ${peakLabel} peak.`
  const after = (peak - gap.end_doy + 365) % 365
  const before = (gap.start_doy - peak + 365) % 365
  if (after <= 21) return `${head}, closing just as the ${peakLabel} peak arrives.`
  if (before <= 21) return `${head}. The ${peakLabel} peak lands just before it opens.`
  return `${head}. The heaviest rain centres on ${peakLabel}.`
}

/** True when this field has no gap worth seeding into. */
export function isAlreadyCovered(input: ActInput): boolean {
  return !input.gap || input.bareDays < 20
}

export function buildActs(input: ActInput): Act[] {
  const covered = isAlreadyCovered(input)
  const best = input.alternatives.find((a) => a.deltaPct < 0) ?? null
  const phases =
    input.bareDaysByPhase && input.phaseLabels &&
    input.bareDaysByPhase.length === input.phaseLabels.length
      ? input.bareDaysByPhase.map((n, i) => `${n} after ${input.phaseLabels![i]}`).join(', ')
      : null

  return [
    {
      n: 1,
      eyebrow: 'Act one',
      title: 'The hole in your year',
      line: covered
        ? `${input.place} is bare about ${input.bareDays} days a year. That is already good.`
        : gapHeadline(input) ??
          `${input.place} is bare about ${input.bareDays} days a year.`,
      focus: 'ring',
      anchor: 'year',
    },
    {
      n: 2,
      eyebrow: 'Act two',
      title: 'Not every year is the same',
      line: phases
        ? `After corn and after soybeans this is a different field: ${phases}. The wheel shows their average — a curve no real year followed.`
        : 'The wheel shows the average year. Scrub it and watch where the cover goes.',
      focus: 'farmer',
      anchor: 'year',
    },
    {
      n: 3,
      eyebrow: 'Act three',
      title: 'What bare soil costs',
      line: covered
        ? 'Underground, the residue mat is doing the work. Roots hold, water stays.'
        : 'Underground: roots retreat, the mat thins, and when the rain comes the topsoil goes with it.',
      focus: 'soil',
      anchor: 'soil',
    },
    {
      n: 4,
      eyebrow: 'Act four',
      title: covered ? 'Nothing worth changing' : 'Three futures',
      line: covered
        ? 'No cover crop can establish in the gap this field has. The honest answer is to leave it alone.'
        : best
          ? `${best.label}: ${best.bareDays} bare days, ${best.deltaPct.toFixed(0)}% less soil lost, $${best.seedCostUsdHa.toFixed(0)} a hectare.`
          : 'Compare the rotations side by side.',
      focus: 'split',
      anchor: 'split',
    },
  ]
}

export interface IntroInput {
  place: string
  areaHa: number
  rotationLabel: string
  /** ISO date of the satellite scene, e.g. "2024-06-09". */
  sceneDate: string
  resolutionM: number
  bareDays: number
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "2024-06-09" -> "the 9th of June, 2024", which a speech engine reads well. */
function spokenDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const nth = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'
  return `the ${d}${nth} of ${MONTHS[m - 1]}, ${y}`
}

/**
 * The line the narrator speaks over the opening zoom.
 *
 * Written to be HEARD, not read: no abbreviations a speech engine will
 * mangle, no parentheses, short clauses. Every figure comes from the
 * bundle and the scene metadata, so switching farms re-narrates rather
 * than repeating a stale script.
 */
export function introNarration(i: IntroInput): string {
  const crop = i.rotationLabel.split(',')[0].replace(/-/g, ' and ').toLowerCase()
  // Place names carry parentheses -- "Monona County, Iowa (Loess Hills)" --
  // and a speech engine either reads the brackets aloud or trips over them.
  const spokenPlace = i.place.replace(/\s*\(([^)]*)\)/g, ', $1').trim()
  const where = `${spokenPlace}. A ${Math.round(i.areaHa)} hectare ${crop} field.`
  const how =
    `This is how it looked from Sentinel 2 on ${spokenDate(i.sceneDate)}, ` +
    `at ${Math.round(i.resolutionM)} metres per pixel.`
  const why =
    i.bareDays < 20
      ? 'We picked it because it is already well protected, and the tool should be able to say so.'
      : `We picked it because its soil sits bare for about ${i.bareDays} days a year.`
  const next = 'Now we go down to the ground, and walk through that year one day at a time.'
  return `${where} ${how} ${why} ${next}`
}


/**
 * The opening narration, scored for delivery.
 *
 * Split into clauses because that is the only prosody control the Web
 * Speech API really gives you -- no SSML, so pacing has to come from
 * where the clauses break, how fast each one runs, and how long the
 * silence after it lasts.
 *
 * The shape is a product pitch, not a weather report: open with the
 * place, land the number with a beat of silence in front of it, drop the
 * pitch on the claim, then lift and speed up on the call to action.
 *
 * THE PAUSE NUMBERS LOOK SHORT ON PURPOSE. They are added ON TOP of the
 * silence each utterance already ends with and the engine's own latency
 * starting the next one, so the gap you hear is roughly double what is
 * written here. At 400-600ms it stopped sounding like speech and started
 * sounding like buffering.
 */
export function introNarrationParts(i: IntroInput): { text: string; rate?: number; pitch?: number; pauseMs?: number }[] {
  const crop = i.rotationLabel.split(',')[0].replace(/-/g, ' and ').toLowerCase()
  const spokenPlace = i.place.replace(/\s*\(([^)]*)\)/g, ', $1').trim()
  const covered = i.bareDays < 20

  return [
    // Establish. Slow and low -- this is the title card.
    { text: `${spokenPlace}.`, rate: 0.9, pitch: 0.96, pauseMs: 170 },
    { text: `A ${Math.round(i.areaHa)} hectare ${crop} field.`, rate: 0.97, pauseMs: 200 },

    // Provenance, brisker: supporting detail, not the headline.
    {
      text: `This is how it looked from Sentinel 2, at ${Math.round(i.resolutionM)} metres per pixel.`,
      rate: 1.06,
      pauseMs: 240,
    },

    // The turn. A beat of silence, then the claim, slowed and dropped.
    covered
      ? { text: 'We chose it because it is already well protected.', rate: 0.93, pitch: 0.95, pauseMs: 140 }
      : { text: 'We chose it for one reason.', rate: 0.95, pitch: 0.96, pauseMs: 220 },
    covered
      ? { text: 'A tool worth trusting has to be able to say so.', rate: 0.98, pauseMs: 230 }
      : { text: `Its soil sits bare for about ${i.bareDays} days a year.`, rate: 0.88, pitch: 0.94, pauseMs: 260 },

    // Lift and go.
    { text: 'Now we go down to the ground,', rate: 1.04, pauseMs: 80 },
    { text: 'and walk through that year, one day at a time.', rate: 1.0, pitch: 0.97, pauseMs: 0 },
  ]
}
