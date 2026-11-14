/**
 * What the farmer tells you before the tool appears.
 *
 * Four beats, each one problem, each one derived from the loaded bundle.
 * Nothing here is a fixed script: switch to Monona and the same four beats
 * describe a field that does not have the problem, because a story that
 * contradicts the data on screen is worse than no story.
 */

export interface IntroBeat {
  id: string
  text: string
}

export interface IntroInput {
  place: string
  ownerName: string
  bareDays: number
  bareDaysByPhase?: number[] | null
  phaseLabels?: string[] | null
  gap: { start_doy: number; end_doy: number; share_of_annual_r: number } | null
  erosivityPeakDoy: number
  best: { label: string; bareDays: number; deltaPct: number; seedCostUsdHa: number } | null
  /** DOY -> "14 Jun". Injected so this file imports no components. */
  format: (doy: number) => string
}

export function buildIntroBeats(i: IntroInput): IntroBeat[] {
  const who = i.ownerName.startsWith('TBD') ? 'I farm' : `${i.ownerName}. I farm`
  const beats: IntroBeat[] = [
    {
      id: 'hello',
      text: `${who} ${i.place}. Corn one year, soybeans the next, same as everyone here.`,
    },
  ]

  if (!i.gap || i.bareDays < 20) {
    // The honest version of the story for a field that is already covered.
    beats.push(
      {
        id: 'problem',
        text:
          'Soil only washes away when it is bare. Every day with nothing growing and nothing ' +
          'lying on top is a day the rain can take some.',
      },
      {
        id: 'mine',
        text: `On my ground that is only about ${i.bareDays} days a year. The stubble stays on and it does its job.`,
      },
      {
        id: 'ask',
        text: 'So I am not here for a fix. I am here to check whether I need one. Come and see.',
      },
    )
    return beats
  }

  const span = `${i.format(i.gap.start_doy)} to ${i.format(i.gap.end_doy)}`
  const share = Math.round(i.gap.share_of_annual_r * 100)
  const phases =
    i.bareDaysByPhase && i.phaseLabels && i.bareDaysByPhase.length === i.phaseLabels.length
      ? i.bareDaysByPhase.map((n, k) => `${n} after ${i.phaseLabels![k]}`).join(', ')
      : null

  beats.push({
    id: 'bare',
    text:
      `Soil only washes away when it is bare. Mine is bare about ${i.bareDays} days a year` +
      (phases ? ` — ${phases}.` : '.'),
  })
  beats.push({
    id: 'when',
    text:
      `And it is not the winter I worry about. The stubble holds through the cold. It goes bare in ` +
      `spring, ${span}, once the old stalks thin out and before the new crop covers the ground.`,
  })
  beats.push({
    id: 'rain',
    text:
      `That is exactly when the hard rain comes. ${share}% of the year's damaging rain lands in ` +
      `that one window, and the worst of it around ${i.format(i.erosivityPeakDoy)}. ` +
      `Bare ground and heavy rain in the same weeks is how a farm loses its topsoil.`,
  })
  beats.push({
    id: 'ask',
    text: i.best
      ? `So the question is simple: can anything grow in that hole? Let us look at the year and find out.`
      : 'So the question is simple: can anything grow in that hole? Let us look at the year.',
  })
  return beats
}
