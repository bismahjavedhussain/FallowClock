import { doyToDate } from './YearRing'

const WIDTH = 1000
const HEIGHT = 300
const TOP = 12
const BOTTOM = 278

function point(day: number, cover: number) {
  return `${((day - 1) / 364) * WIDTH},${BOTTOM - Math.max(0, Math.min(1, cover)) * (BOTTOM - TOP)}`
}

function line(values: number[]) {
  return values.slice(0, 365).map((cover, index) => point(index + 1, cover)).join(' ')
}

export default function PhaseYearChart({ average, phases, labels, doy }: {
  average: number[]
  phases?: number[][] | null
  labels?: string[] | null
  doy: number
}) {
  const hasPhases = !!phases && !!labels && phases.length === labels.length
  const markerX = ((doy - 1) / 364) * WIDTH
  const series = hasPhases ? phases.map((values, index) => ({
    values,
    label: `After ${labels[index]}`,
    color: index === 0 ? '#b66e3e' : '#6b78a9',
  })) : []

  return <figure className="phase-year-chart" aria-label="Soil cover across the year by crop phase">
    <figcaption>
      <div><span className="eyebrow">Soil cover through the year</span><strong>{hasPhases ? 'Two crop phases, one average' : 'Average soil cover'}</strong></div>
      <span className="phase-chart-day">{doyToDate(doy).label}</span>
    </figcaption>
    <div className="phase-chart-legend">
      {series.map((item) => <span key={item.label} style={{ ['--series-color' as string]: item.color }}>{item.label}: {Math.round((item.values[doy - 1] ?? 0) * 100)}%</span>)}
      <span style={{ ['--series-color' as string]: '#176a52' }}>Average: {Math.round((average[doy - 1] ?? 0) * 100)}% (Act one wheel's starting view)</span>
    </div>
    <div className="phase-chart-scroll-wrap" tabIndex={0} role="region" aria-label="Scrollable year soil cover chart">
      <div className="phase-chart-canvas">
        <div className="phase-chart-plot">
          <div className="phase-chart-axis" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`Soil cover curves from January through December; selected day ${doyToDate(doy).label}`}>
            {[TOP, (TOP + BOTTOM) / 2, BOTTOM].map((y) => <line key={y} x1="0" x2={WIDTH} y1={y} y2={y} className="phase-chart-gridline" />)}
            <rect x="0" y={BOTTOM - .3 * (BOTTOM - TOP)} width={WIDTH} height={.3 * (BOTTOM - TOP)} className="phase-chart-bare-band" />
            {series.map((item) => <polyline key={item.label} points={line(item.values)} fill="none" stroke={item.color} className="phase-chart-series" />)}
            <polyline points={line(average)} fill="none" stroke="#176a52" className="phase-chart-average" />
            <line x1={markerX} x2={markerX} y1={TOP} y2={BOTTOM} className="phase-chart-marker" />
            {[...series, { values: average, label: 'Average', color: '#176a52' }].map((item) => <circle key={item.label} cx={markerX} cy={BOTTOM - Math.max(0, Math.min(1, item.values[doy - 1] ?? 0)) * (BOTTOM - TOP)} r="6" fill={item.color} className="phase-chart-dot" />)}
          </svg>
        </div>
        <div className="phase-chart-months" aria-hidden="true"><span>Jan</span><span>Mar</span><span>May</span><span>Jul</span><span>Sep</span><span>Nov</span><span>Dec</span></div>
      </div>
    </div>
    <p>The shaded band marks less than 30% soil cover. Move the date slider to compare the same day after each crop.</p>
  </figure>
}
