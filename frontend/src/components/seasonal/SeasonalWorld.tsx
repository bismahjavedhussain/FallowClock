import { seasonAtDoy, seasonWeights } from '../../lib/seasons'

/** Decorative scene shared by the SVG and WebGL rings; CSS handles all motion. */
export default function SeasonalWorld({ doy }: { doy: number }) {
  const weights = seasonWeights(doy)
  return <div className={`seasonal-world season-${seasonAtDoy(doy)}`} aria-hidden="true">
    {(['spring', 'summer', 'autumn', 'winter'] as const).map((season) => <div key={season} className={`season-layer layer-${season}`} style={{ opacity: weights[season] }} />)}
    <div className="forest-light" /><div className="forest-haze" /><div className="forest-rain" />
    <div className="forest-motes">{Array.from({ length: 12 }, (_, i) => <span key={i} />)}</div>
  </div>
}
