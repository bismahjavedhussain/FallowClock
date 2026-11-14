import { atmosphereForDay } from '../../lib/atmosphere'
import type { DayAtmosphereInput } from '../../lib/atmosphere'

export default function AtmosphereReadout({ doy, climate, synthetic = false }: { doy: number; climate: DayAtmosphereInput; synthetic?: boolean }) {
  const data = atmosphereForDay(doy, climate)
  return <div className="atmosphere-readout" aria-label="Bundle values for selected day">
    <div><span>SOIL OBSERVATION</span><strong>{data.soil}</strong></div>
    <div><span>EROSIVITY INDEX</span><strong>{data.erosivity === null ? 'Unknown' : data.erosivity.toFixed(2)}</strong></div>
    <div><span>FROST PROBABILITY</span><strong>{data.frost === null ? 'Unknown' : `${Math.round(data.frost * 100)}%`}</strong></div>
    {data.heat !== null && <div><span>HEAT STRESS PROBABILITY</span><strong>{Math.round(data.heat * 100)}%</strong></div>}
    <p>{synthetic ? 'Synthetic sample values for this day.' : 'Bundle climatology for this day.'} Seasonal artwork and falling snow are illustrative, not measured weather.</p>
  </div>
}
