import { doyToDate } from './YearRing'
import { playSeasonTick, playSwitch, playTick } from '../lib/sound'
import { SEASON_STARTS, seasonAtDoy } from '../lib/seasons'

export default function TimeLever({ doy, onChange }: { doy: number; onChange: (doy: number) => void }) {
  const season = seasonAtDoy(doy)
  // A tick per day would be 365 clicks across one drag. playTick throttles
  // itself; crossing into a new season gets a warmer, unthrottled note so the
  // ear can hear the year turning.
  const scrub = (next: number) => {
    if (seasonAtDoy(next) !== season) playSeasonTick()
    else playTick()
    onChange(next)
  }
  return (
    <div className="time-lever" aria-label="Travel through the agricultural year">
      <div className="time-lever-heading">
        <div><span className="eyebrow">Travel through the year</span><strong>{doyToDate(doy).label}</strong><small>Day {doy} of 365 · {season}</small></div>
        <span className="time-lever-mark" aria-hidden="true">✦</span>
      </div>
      <input aria-label="Selected day of year" type="range" min="1" max="365" step="1" value={doy} onChange={(e) => scrub(Number(e.target.value))} />
      <div className="season-jumps" aria-label="Jump to a season">
        {SEASON_STARTS.map(({ season, doy: start, label }) => <button type="button" key={season} onClick={() => { playSwitch(); onChange(start) }} aria-pressed={seasonAtDoy(doy) === season}>{label}</button>)}
      </div>
    </div>
  )
}
