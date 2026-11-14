/**
 * Narrative copy. U2 owns this file: one place for the words, so the app,
 * the video and the pitch say the same thing.
 *
 * THE PERSONA IS ILLUSTRATIVE. Dana is not this field's operator, and no
 * real person's name is attached to these coordinates. To feature a real
 * farmer: get their consent, change PERSONAS, and drop the disclosure.
 */
import type { Bundle } from '../lib/bundle'
import { doyToDate } from '../components/YearRing'

export interface Persona {
  name: string
  intro: string
  disclosure: string
}

const PERSONAS: Record<string, { name: string }> = {
  'story-county-ia': { name: 'Dana' },
}

export function personaFor(bundle: Bundle): Persona | null {
  if (bundle.provenance.is_synthetic) return null
  const persona = PERSONAS[bundle.farm.id]
  if (!persona) return null
  return {
    name: persona.name,
    intro: `${persona.name} grows corn and soybeans on these ${bundle.farm.area_ha} hectares. When is the soil bare, and what could fill the gap?`,
    disclosure: `${persona.name} is an illustrative persona, not this field's operator. The field and its satellite record are real.`,
  }
}

/**
 * The finding, as one sentence derived from the bundle.
 *
 * The two headline numbers are disconnected facts until something says how
 * they relate. On Story County the bare window is in SPRING and the heavy
 * rain lands in it -- that is the whole argument.
 *
 * Note the wording. "Straight through the peak" is only said when the peak
 * is inside the gap. Story's peak (DOY 170) is five days AFTER its gap ends
 * (DOY 165); claiming otherwise is an overstatement a judge could check in
 * the data we ship. So three wrap-aware cases are distinguished: peak inside
 * the gap, peak within 21 days after it, peak within 21 days before it.
 *
 * The peak comes from climatology.erosivity_peak_doy, computed by the
 * backend. Do not recompute it here.
 */
export function findingSentence(bundle: Bundle): string | null {
  const gap = bundle.gaps[0]
  if (!gap) return null
  const peak = bundle.climatology.erosivity_peak_doy
  const inGap =
    gap.start_doy <= gap.end_doy
      ? peak >= gap.start_doy && peak <= gap.end_doy
      : peak >= gap.start_doy || peak <= gap.end_doy
  const span = `${doyToDate(gap.start_doy).label} to ${doyToDate(gap.end_doy).label}`
  const share = Math.round(gap.share_of_annual_r * 100)
  const peakLabel = doyToDate(peak).label
  const head = `Bare ${span} — ${share}% of the year's erosive rain falls in that window`
  if (inGap) return `${head}, straight through the ${peakLabel} peak.`
  const after = (peak - gap.end_doy + 365) % 365
  const before = (gap.start_doy - peak + 365) % 365
  if (after <= 21) return `${head}, closing just as the ${peakLabel} peak arrives.`
  if (before <= 21) return `${head}. The ${peakLabel} peak lands just before it opens.`
  return `${head}. The heaviest rain centres on ${peakLabel}.`
}
