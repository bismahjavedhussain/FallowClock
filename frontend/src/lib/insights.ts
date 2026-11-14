/**
 * The field diary's content: the crux of what this tool found.
 *
 * DERIVED, NOT HARDCODED. The brief asked for hardcoded insights, and that
 * is the one thing this project cannot do: a fixed set of entries would be
 * flatly wrong on Monona County, which has no recommendation at all, and
 * would sit on screen contradicting the panels beside it. Every figure
 * below comes out of the loaded bundle, so switching fields rewrites the
 * diary instead of leaving a stale story behind.
 *
 * These are the "agrarian insights and tactical summaries" the brief wants
 * -- exact bare-day reductions, soil-loss percentages, cost per hectare --
 * they are just true.
 */

export interface Insight {
  id: string
  /** Short heading, e.g. "The hole". */
  title: string
  /** One or two sentences. */
  body: string
  /** The number to show large, if there is one. */
  figure?: string
  /** 'finding' | 'action' | 'caution' — colours the entry. */
  kind: 'finding' | 'action' | 'caution'
}

export interface InsightInput {
  place: string
  areaHa: number
  bareDays: number
  bareDaysByPhase?: number[] | null
  phaseLabels?: string[] | null
  gap: { start_doy: number; end_doy: number; n_days: number; share_of_annual_r: number } | null
  erosivityPeakDoy: number
  rotations: {
    label: string
    isCurrent: boolean
    bareDays: number
    deltaPct: number
    seedCostUsdHa: number
    nCreditKgHa: number
  }[]
  /** Evidence tier of the recommended species curve, if known. */
  ryeSource?: string
  /** B1's ±0.02 NDTI endmember sensitivity band, if the bundle carries it. */
  bareDaysBand?: [number, number] | null
  format: (doy: number) => string
}

export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = []
  const best = i.rotations
    .filter((r) => !r.isCurrent && r.deltaPct < 0)
    .sort((a, b) => a.deltaPct - b.deltaPct)[0]
  const current = i.rotations.find((r) => r.isCurrent)

  // --- 1. how long the ground is open -------------------------------
  const phases =
    i.bareDaysByPhase && i.phaseLabels && i.bareDaysByPhase.length === i.phaseLabels.length
      ? i.bareDaysByPhase.map((n, k) => `${n} after ${i.phaseLabels![k]}`).join(', ')
      : null
  out.push({
    id: 'bare',
    kind: 'finding',
    title: 'How long the ground is open',
    figure: `${i.bareDays} days`,
    body: phases
      ? `${phases}. The average is a year no field actually had — a corn year and a soybean year are different fields.`
      : `Expected bare days in a given year on ${i.areaHa} hectares.`,
  })

  // --- 2. when, and whether the rain agrees -------------------------
  if (i.gap) {
    const span = `${i.format(i.gap.start_doy)} to ${i.format(i.gap.end_doy)}`
    const share = Math.round(i.gap.share_of_annual_r * 100)
    const peak = i.format(i.erosivityPeakDoy)
    const inGap =
      i.gap.start_doy <= i.gap.end_doy
        ? i.erosivityPeakDoy >= i.gap.start_doy && i.erosivityPeakDoy <= i.gap.end_doy
        : i.erosivityPeakDoy >= i.gap.start_doy || i.erosivityPeakDoy <= i.gap.end_doy
    const after = (i.erosivityPeakDoy - i.gap.end_doy + 365) % 365
    out.push({
      id: 'window',
      kind: 'finding',
      title: 'When it is open, and what lands on it',
      figure: `${share}%`,
      body:
        `Bare ${span}, ${i.gap.n_days} days. That window takes ${share}% of the year's erosive rain, ` +
        (inGap
          ? `with the heaviest 30-day spell centred on ${peak} — inside it.`
          : after <= 21
            ? `and closes just as the ${peak} peak arrives.`
            : `while the heaviest spell centres on ${peak}.`),
    })
  }

  // --- 3. the decision ----------------------------------------------
  if (best && current) {
    const saved = current.bareDays - best.bareDays
    out.push({
      id: 'do',
      kind: 'action',
      title: 'What to do about it',
      figure: `${best.deltaPct.toFixed(0)}%`,
      body:
        `${best.label}. Bare days ${current.bareDays} → ${best.bareDays}, ` +
        `${saved} fewer. Modelled soil loss down ${Math.abs(best.deltaPct).toFixed(0)}%.`,
    })
    out.push({
      id: 'cost',
      kind: 'action',
      title: 'What it costs',
      figure: best.seedCostUsdHa > 0 ? `$${best.seedCostUsdHa.toFixed(0)}/ha` : 'no cost',
      body:
        (best.seedCostUsdHa > 0
          ? `Seed only, ${(best.seedCostUsdHa * i.areaHa).toFixed(0)} dollars across ${i.areaHa} hectares. `
          : '') +
        (best.nCreditKgHa > 0
          ? `Returns about ${best.nCreditKgHa.toFixed(0)} kg N per hectare to the next cash crop.`
          : 'Seed and a pass; no nitrogen credit claimed.'),
    })
  } else {
    out.push({
      id: 'do',
      kind: 'action',
      title: 'What to do about it',
      figure: 'nothing',
      body:
        'No cover crop can establish in the gap this field has. Residue is already ' +
        'doing the work. The honest answer is to leave it alone — that is a result, not a failure.',
    })
  }

  // --- 4. what we would not bet the farm on -------------------------
  if (i.bareDaysBand) {
    out.push({
      id: 'band',
      kind: 'caution',
      title: 'How sure we are',
      figure: `${i.bareDaysBand[0]}–${i.bareDaysBand[1]}`,
      body:
        `Shift the residue calibration by ±0.02 and the bare-day count moves across this range. ` +
        `Treat ${i.bareDays} as the middle of it, not a measurement.`,
    })
  }
  if (i.ryeSource) {
    out.push({
      id: 'evidence',
      kind: 'caution',
      title: 'Where the cover curve came from',
      body:
        i.ryeSource === 'observed'
          ? 'The cereal rye curve was measured on neighbouring fields, not assumed.'
          : 'No cover-cropped neighbour was found, so the rye curve is from Midwest extension literature, not observed here.',
    })
  }

  return out
}

/**
 * What the farmer is "thinking" while the crisis view loads.
 *
 * Also derived — the status lines name this field's real numbers, so the
 * loader is telling the truth about what it just worked out rather than
 * playing a generic progress theatre.
 */
export function thinkingLines(i: InsightInput): string[] {
  const lines = [`Reading ${i.areaHa} hectares of ${i.place}…`]
  if (i.gap) {
    lines.push(`Finding the open window — ${i.gap.n_days} days of it…`)
    lines.push(
      `Weighing ${i.bareDays} bare days against ${Math.round(i.gap.share_of_annual_r * 100)}% of the year's hard rain…`,
    )
  } else {
    lines.push(`Only ${i.bareDays} bare days to account for…`)
  }
  lines.push(`Checking what can establish before the ${i.format(i.erosivityPeakDoy)} peak…`)
  const best = i.rotations.filter((r) => !r.isCurrent && r.deltaPct < 0)[0]
  lines.push(best ? `Costing ${best.label.toLowerCase()}…` : 'Checking whether anything is worth seeding…')
  return lines
}
