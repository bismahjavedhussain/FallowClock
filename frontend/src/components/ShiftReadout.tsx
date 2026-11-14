/**
 * What has moved across the record.
 *
 * The rest of this tool answers a static question -- what does an average
 * year look like -- and an average built from 2000-2024 is exactly the
 * thing that hides whether 2024 differs from 2000. This is the answer to
 * the question the challenge is named after.
 *
 * MOST OF THESE ARE NULLS, AND THEY ARE SHOWN. A panel that listed only
 * the significant trends would imply the others were never tested, which
 * is the same overclaiming the rest of the project refuses. A flat result
 * over 25 years is a finding: it says this part of the year is NOT
 * moving, which is why the spring gap can be treated as stable.
 *
 * Nothing here is computed in the browser. Every figure is read from the
 * bundle, fitted with Theil-Sen and tested with Mann-Kendall on the NASA
 * POWER record -- see backend/fallowclock/trends.py for why those two.
 */

import type { ClimateTrend } from '../types/bundle'

/** Human labels. Unknown metrics fall through to the raw name. */
const LABELS: Record<string, { title: string; what: string }> = {
  first_fall_frost_doy: {
    title: 'First autumn frost',
    what: 'how late the season can run',
  },
  last_spring_frost_doy: {
    title: 'Last spring frost',
    what: 'when the ground can be worked',
  },
  growing_season_days: {
    title: 'Frost-free season',
    what: 'days a cover crop has to establish',
  },
  annual_erosivity: {
    title: 'Erosive rain, whole year',
    what: 'how hard the rain falls',
  },
  bare_window_erosivity_share: {
    title: 'Erosive rain inside the bare window',
    what: 'whether the hard rain is moving into the gap',
  },
}

function describe(t: ClimateTrend): string {
  if (!t.significant) return 'No detectable change'
  const n = Math.abs(t.slope_per_decade)
  const span = t.years.length ? t.years[t.years.length - 1] - t.years[0] : 0
  const over = (n / 10) * span
  switch (t.direction) {
    case 'later':
      return `${n.toFixed(1)} days later per decade · about ${Math.round(over)} days across the record`
    case 'earlier':
      return `${n.toFixed(1)} days earlier per decade · about ${Math.round(over)} days across the record`
    case 'up':
      return `+${n.toFixed(1)} ${t.unit} per decade · about +${Math.round(over)} across the record`
    default:
      return `-${n.toFixed(1)} ${t.unit} per decade · about -${Math.round(over)} across the record`
  }
}

export default function ShiftReadout({ trends }: { trends: ClimateTrend[] }) {
  if (!trends.length) return null

  const moved = trends.filter((t) => t.significant)
  const still = trends.filter((t) => !t.significant)
  const span = trends[0].years
  const period = `${span[0]}–${span[span.length - 1]}`

  // The one consequence that reaches the recommendation. A later autumn
  // frost lengthens the run between harvest and the killing frost, which
  // is exactly the window a winter-hardy cover crop has to establish in.
  // Taken from the FITTED slope, not the first and last years -- the
  // endpoints of a noisy series are two samples, which is the whole
  // reason the fit is Theil-Sen. Stated in days, which is what was
  // measured; how much growth those days buy is a GDD question this
  // panel does not answer.
  const frost = trends.find((t) => t.metric === 'first_fall_frost_doy' && t.significant)
  const extraDays = frost
    ? Math.round((Math.abs(frost.slope_per_decade) / 10) * (frost.years[frost.years.length - 1] - frost.years[0]))
    : 0

  return (
    <section className="shift-readout" aria-label="What has shifted">
      <div className="shift-head">
        <span className="eyebrow">The shift &middot; {period}</span>
        <h3>
          {moved.length
            ? 'Some of this year is moving.'
            : 'Nothing here has measurably moved.'}
        </h3>
        <p>
          Fitted on {span.length} whole years of NASA POWER with Theil&ndash;Sen, tested with
          Mann&ndash;Kendall. <strong>Observed</strong>, not projected.
        </p>
      </div>

      <ul className="shift-list">
        {[...moved, ...still].map((t) => {
          const label = LABELS[t.metric] ?? { title: t.metric, what: '' }
          return (
            <li key={t.metric} data-moved={t.significant ? 'yes' : 'no'}>
              <div className="shift-row">
                <strong>{label.title}</strong>
                <span className="shift-verdict">{t.significant ? 'shifting' : 'steady'}</span>
              </div>
              <p className="shift-change">{describe(t)}</p>
              <p className="shift-why">
                {label.what}
                {/* The p-value is on screen so a reader can disagree with
                    the 0.05 line rather than take the verdict on faith. */}
                <span className="shift-p"> &middot; p&nbsp;=&nbsp;{t.p_value.toFixed(3)}</span>
              </p>
            </li>
          )
        })}
      </ul>

      {frost && frost.direction === 'later' && extraDays > 0 && (
        <p className="shift-consequence">
          <strong>What that buys.</strong> The run between harvest and the killing frost is about{' '}
          {extraDays} days longer than it was in {frost.years[0]}, so a cover crop drilled after
          harvest has that much more of the autumn to establish in than it used to.
        </p>
      )}

      {/* Short on purpose, but it stays: it is the line that says why
          the obvious metric is missing. The full reasoning lives in
          backend/fallowclock/trends.py. */}
      <p className="shift-note">
        Bare days aren&rsquo;t trended &mdash; at about seventy clear scenes a year, the trend would
        follow cloud as much as cropping.
      </p>
    </section>
  )
}
