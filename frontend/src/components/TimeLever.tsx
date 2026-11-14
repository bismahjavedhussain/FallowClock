import { doyToDate } from './YearRing'
import { SEASON_STARTS, seasonAtDoy } from '../lib/seasons'

export default function TimeLever({ doy, onChange }: { doy: number; onChange: (doy: number) => void }) {
  return (
    <div className="time-lever" aria-label="Travel through the agricultural year">
      <div className="time-lever-heading">
        <div><span className="eyebrow">Travel through the year</span><strong>{doyToDate(doy).label}</strong><small>Day {doy} of 365 · {seasonAtDoy(doy)}</small></div>
        <span className="time-lever-mark" aria-hidden="true">✦</span>
      </div>
      <input aria-label="Selected day of year" type="range" min="1" max="365" step="1" value={doy} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="season-jumps" aria-label="Jump to a season">
        {SEASON_STARTS.map(({ season, doy: start, label }) => <button type="button" key={season} onClick={() => onChange(start)} aria-pressed={seasonAtDoy(doy) === season}>{label}</button>)}
      </div>
    </div>
  )
}
