/** Evidence beneath the ring: what we measured, how sure we are, what we do not know. U2 owns this file. */
import type { FieldModel } from '../lib/bundle'
import type { FitResult } from '../lib/cropFit'
import { evidenceTier, formatChange, tierLabel } from '../lib/metrics'
import RingLegend from './RingLegend'
import { doyToDate } from './YearRing'

const LEVEL_ORDER = { high: 0, medium: 1, low: 2 } as const

export default function FieldNotes({ field, fits }: { field: FieldModel; fits: FitResult[] }) {
  const b = field.bundle
  const ledger = [...b.uncertainty].sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level])
  const tierOf = (fit: FitResult) => evidenceTier(field, fit.speciesId, fit.curveSource)
  const measured = fits.filter((f) => f.feasible && f.curveSource === 'observed')
  const modelled = fits.filter((f) => f.feasible && f.curveSource === 'modelled')
  const unfit = fits.filter((f) => !f.feasible)
  const rye = b.crop_curves.cereal_rye
  const gap = field.mainGap
  const years = b.provenance.years_used
  const fitRow = (fit: FitResult) => (
    <li key={fit.speciesId} className={fit.feasible ? '' : 'unavailable'}>
      <span>
        <strong>{fit.speciesName}</strong>
        <small>{fit.feasible ? `${tierLabel(tierOf(fit), b.crop_curves[fit.speciesId]?.n_fields)} · seed ${doyToDate(fit.seedDoy).label}` : fit.reason}</small>
      </span>
      <span className="fit-benefit">{fit.feasible ? formatChange(-fit.pctReduction) : '—'}</span>
    </li>
  )

  return (
    <section className="field-notes" id="evidence">
      <div className="section-heading">
        <span className="section-number">02 / FIELD NOTES</span>
        <h2>Every number, with its evidence.</h2>
        <p>What was measured, how sure we are, and what we do not know. Planting ideas are proposals for a farmer and an extension agent to check, not prescriptions.</p>
      </div>
      <div className="evidence-legend"><RingLegend compact showDetails /></div>

      <div className="evidence-grid">
        <article className="notes-card evidence-card">
          <span className="eyebrow">What is grown here</span>
          <h3>{b.observed_rotation.inferred_label}</h3>
          <ol className="year-list">
            {b.observed_rotation.years.map((y) => (
              <li key={y.year}>
                <b>{y.year}</b>
                <span>{y.cdl_crop}</span>
                <small>
                  {y.planting_doy ? `green-up ${doyToDate(y.planting_doy).label}` : ''}
                  {y.harvest_doy ? ` · senescence ${doyToDate(y.harvest_doy).label}` : ''}
                  {y.cover_crop_detected ? ' · winter cover seen' : ''}
                </small>
              </li>
            ))}
          </ol>
          <p className="notes-footnote">Crop from the USDA Cropland Data Layer. Dates are satellite green-up and senescence, which trail planting and harvest by weeks.</p>
        </article>

        {rye && (
          <article className="notes-card evidence-card">
            <span className="eyebrow">Cover crops nearby</span>
            <h3>{rye.source === 'literature' ? 'Rye curve from the literature, not measured here' : `${rye.n_fields} nearby fields already grow a winter cover`}</h3>
            <p>{rye.detection}</p>
            <p className="notes-footnote">Nothing is simulated where a measurement exists: the rye curve on the ring is the median of these fields.</p>
          </article>
        )}

        <article className="notes-card evidence-card">
          <span className="eyebrow">How we measured</span>
          <h3>{b.provenance.sources.length} data sources</h3>
          <ul className="source-list">
            {b.provenance.sources.map((s) => (
              <li key={`${s.collection_id}-${s.name}`}>
                <strong>{s.name}</strong>
                <small>{s.n_obs.toLocaleString()} records{s.resolution_m ? ` · ${s.resolution_m} m` : ''} · <code>{s.collection_id}</code></small>
                <small className="source-citation">{s.citation}</small>
              </li>
            ))}
          </ul>
          <p className="notes-footnote">Weather years {years[0]}–{years[years.length - 1]}. Bare means under 30% soil cover, the USDA NRCS conservation-tillage line.</p>
        </article>
      </div>

      <div className="notes-grid">
        <article className="notes-card">
          <div className="notes-card-title"><span className="notes-ornament">❦</span><div><span className="eyebrow">Crop fit</span><h3>What fits {gap ? `${doyToDate(gap.start_doy).label} – ${doyToDate(gap.end_doy).label}` : 'the gap'}</h3></div></div>
          {measured.length > 0 && <><h4 className="fit-group">{measured.every((f) => tierOf(f) === 'observed') ? 'Measured on real fields' : 'Measured or published curves'}</h4><ol className="fit-list">{measured.map(fitRow)}</ol></>}
          {modelled.length > 0 && <><h4 className="fit-group">Modelled estimates</h4><ol className="fit-list">{modelled.map(fitRow)}</ol></>}
          {unfit.length > 0 && <><h4 className="fit-group">Does not fit</h4><ol className="fit-list">{unfit.map(fitRow)}</ol></>}
          <p className="notes-footnote">Change in erosion exposure within this gap. Ranked by <strong>evidence first</strong>: a species we measured on neighbouring fields outranks a modelled one even when the model promises more. Every modelled curve uses the same generic plateau, so modelled species tie at identical percentages and read higher than they should — the measured curve is lower because it is real. Treat modelled figures as an upper bound.</p>
        </article>

        <article className="notes-card">
          <div className="notes-card-title"><span className="notes-ornament">✧</span><div><span className="eyebrow">Uncertainty ledger</span><h3>What we do not know</h3></div></div>
          <ul className="uncertainty-list">
            {ledger.map((u, i) => (
              <li key={i}>
                <div><span className={`uncertainty-level level-${u.level}`}>{u.level}</span><code>{u.field}</code></div>
                <p>{u.reason}</p>
                <small><b>What to do:</b> {u.affects}</small>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  )
}
