/**
 * What the farmer says.
 *
 * Every line is derived from the loaded bundle. Nothing here invents a
 * number, a date or a verdict -- if the guide says "34% of the rain", that
 * came out of gaps[0].share_of_annual_r. A chatty companion that makes
 * figures up would quietly undo the whole point of the uncertainty work.
 *
 * Lines are short on purpose. This is a speech bubble, not a paragraph:
 * anything longer than about 110 characters belongs in Field Notes.
 */

import { doyToDate } from '../components/YearRing'

export type GuideTone = 'neutral' | 'warn' | 'good'

export interface GuideLine {
  text: string
  tone: GuideTone
  /** Stable id so the bubble only re-animates when the line really changes. */
  key: string
}

export interface GuideContext {
  place: string
  /** 1-based DOY currently selected. */
  doy: number
  /** climatology.soil_cover for the selected day, or null when unobserved. */
  cover: number | null
  /** Erosivity for the selected day, and the annual maximum, for "is it heavy". */
  erosivity: number
  erosivityMax: number
  /** The largest gap, if the field has one. */
  gap: { start_doy: number; end_doy: number; n_days: number; share_of_annual_r: number } | null
  /** Expected bare days from the bundle (already phase-averaged). */
  bareDays: number
  /** Live proposal figures from proposalPreview. */
  baselineBare: number
  proposedBare: number
  /** Species currently held, if any. */
  picked: { name: string; feasible: boolean; reason: string; seedDoy: number } | null
  placedCount: number
  /** Which act is on screen, 0-3. The farmer should talk about what the
   *  user is looking at: a line about today's rainfall is the right thing
   *  beside the wheel and noise beside the rotation comparison. */
  act: number
  /** Per-phase cover for the selected day, for the act-two line. */
  phases?: { label: string; cover: number }[] | null
  /** Modelled soil water for the selected day, for the act-three line. */
  moisture?: number
  /** Best alternative rotation, for the act-four line. */
  best?: { label: string; bareDays: number; deltaPct: number; seedCostUsdHa: number } | null
  /** What just happened, so the guide can react rather than only describe. */
  event: 'idle' | 'placed' | 'denied' | 'removed' | 'farm' | 'picked'
  eventDetail?: string
}

const BARE = 0.3

function inGap(doy: number, gap: GuideContext['gap']): boolean {
  if (!gap) return false
  return gap.start_doy <= gap.end_doy
    ? doy >= gap.start_doy && doy <= gap.end_doy
    : doy >= gap.start_doy || doy <= gap.end_doy
}

export function guideLine(c: GuideContext): GuideLine {
  // --- things that just happened win over ambient description ----------
  if (c.event === 'denied' && c.eventDetail) {
    return { text: c.eventDetail, tone: 'warn', key: `denied:${c.eventDetail}` }
  }

  if (c.event === 'placed') {
    const saved = c.baselineBare - c.proposedBare
    if (saved > 0) {
      return {
        text: `That closes ${saved} bare ${saved === 1 ? 'day' : 'days'} — down to ${c.proposedBare}.`,
        tone: 'good',
        key: `placed:${c.proposedBare}`,
      }
    }
    return {
      text: 'In it goes. The wheel keeps the observed year on the inner band.',
      tone: 'good',
      key: 'placed:none',
    }
  }

  if (c.event === 'removed') {
    return { text: `Pulled it back out. Baseline is ${c.baselineBare} bare days.`, tone: 'neutral', key: 'removed' }
  }

  if (c.event === 'farm') {
    if (!c.gap || c.bareDays < 20) {
      return {
        text: `${c.place}. Honestly — barely any bare ground here. Have a look.`,
        tone: 'good',
        key: `farm:${c.place}`,
      }
    }
    return {
      text: `${c.place}. Bare ${c.bareDays} days a year. Let's find the hole.`,
      tone: 'neutral',
      key: `farm:${c.place}`,
    }
  }

  if (c.event === 'picked' && c.picked) {
    if (!c.picked.feasible) {
      return { text: c.picked.reason, tone: 'warn', key: `pick:${c.picked.name}:no` }
    }
    return {
      text: `${c.picked.name}. Sow it around ${doyToDate(c.picked.seedDoy).label} — tap a lit-up day.`,
      tone: 'neutral',
      key: `pick:${c.picked.name}`,
    }
  }

  // --- otherwise, talk about whatever act is on screen -----------------
  const heavy = c.erosivityMax > 0 && c.erosivity >= c.erosivityMax * 0.55
  const date = doyToDate(c.doy).label

  // ACT 2 - the desk. The story here is that the average year is a fiction.
  if (c.act === 1) {
    if (c.phases && c.phases.length >= 2) {
      const bare = c.phases.filter((p) => p.cover < BARE)
      if (bare.length && bare.length < c.phases.length) {
        const other = c.phases.find((p) => p.cover >= BARE)!
        return {
          text: `${date} is bare after ${bare[0].label} and covered after ${other.label}. Same field, different year.`,
          tone: 'warn',
          key: `desk-split:${c.doy}`,
        }
      }
      const all = c.phases.map((p) => `${p.label} ${Math.round(p.cover * 100)}%`).join(', ')
      return { text: `${date}: ${all}. Both phases agree for once.`, tone: 'good', key: `desk-same:${c.doy}` }
    }
    return { text: 'Scrub the year and I will note down what changes.', tone: 'neutral', key: 'desk-idle' }
  }

  // ACT 3 - underground. Roots and water, not the calendar.
  if (c.act === 2) {
    const wet = typeof c.moisture === 'number' ? Math.round(c.moisture * 100) : null
    if (c.cover !== null && c.cover < BARE && heavy) {
      return { text: 'There it goes. Nothing holding the top layer down today.', tone: 'warn', key: 'root-losing' }
    }
    if (wet !== null && wet < 30) {
      return { text: `Soil water down to ${wet}% of capacity. Roots are working for it.`, tone: 'warn', key: 'root-dry' }
    }
    if (c.cover !== null && c.cover >= BARE) {
      return { text: `Roots are in and the mat is on top. ${wet !== null ? `Water at ${wet}%.` : ''}`.trim(), tone: 'good', key: 'root-held' }
    }
    return { text: 'Bare up top. Run the storm and watch what happens.', tone: 'warn', key: 'root-bare' }
  }

  // ACT 4 - the comparison.
  if (c.act === 3) {
    if (c.best && c.best.deltaPct < 0) {
      return {
        text: `${c.best.label} is the one I would try: ${c.best.bareDays} bare days for $${c.best.seedCostUsdHa.toFixed(0)} a hectare.`,
        tone: 'good',
        key: 'futures-best',
      }
    }
    return {
      text: 'Nothing here beats what you already do. That is a result, not a failure.',
      tone: 'good',
      key: 'futures-none',
    }
  }

  // ACT 1 - the wheel. The day under the cursor is the subject.
  if (c.cover === null) {
    return { text: `${date}: cloud got in the way. No reading this day.`, tone: 'neutral', key: 'unknown' }
  }

  if (c.cover < BARE) {
    if (heavy) {
      return {
        text: `Oof — bare dirt on ${date}, and the rain is heavy. This is where soil leaves.`,
        tone: 'warn',
        key: 'bare-heavy',
      }
    }
    if (inGap(c.doy, c.gap) && c.gap) {
      return {
        text: `Bare, and we're inside the big gap — ${Math.round(c.gap.share_of_annual_r * 100)}% of the year's hard rain lands in it.`,
        tone: 'warn',
        key: 'bare-in-gap',
      }
    }
    return { text: `${date}: soil's exposed, but the rain is quiet for now.`, tone: 'neutral', key: 'bare-quiet' }
  }

  if (heavy) {
    return { text: `Hard rain on ${date} — but there's cover taking the hit. Good.`, tone: 'good', key: 'covered-heavy' }
  }

  if (c.cover > 0.75) {
    return { text: `${date}: canopy's closed. Nothing is moving off this field.`, tone: 'good', key: 'covered-full' }
  }

  return { text: `${date}: stubble's holding at ${Math.round(c.cover * 100)}%. That counts.`, tone: 'good', key: 'covered-partial' }
}
