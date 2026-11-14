import { seasonAtDoy, seasonWeights } from '../../lib/seasons'

/** Decorative scene shared by the SVG and WebGL rings; CSS handles all motion. */
export default function SeasonalWorld({ doy, storm = 0 }: { doy: number; storm?: number }) {
  const weights = seasonWeights(doy)
  return <div className={`seasonal-world season-${seasonAtDoy(doy)}`} aria-hidden="true" data-storm={storm > 0.02 ? 'on' : 'off'} style={{ ['--storm' as string]: storm.toFixed(3) }}>
    {(['spring', 'summer', 'autumn', 'winter'] as const).map((season) => <div key={season} className={`season-layer layer-${season}`} style={{ opacity: weights[season] }} />)}
    <div className="forest-light" /><div className="forest-haze" /><div className="forest-rain" /><div className="forest-flash" />
    <div className="forest-motes">{Array.from({ length: 12 }, (_, i) => <span key={i} />)}</div>
  </div>
}
