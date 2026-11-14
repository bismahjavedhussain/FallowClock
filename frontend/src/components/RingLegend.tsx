/**
 * RingLegend.tsx — Visual language and scientific guide for the Year Ring.
 *
 * Owned by U1 (The Ring).
 * Communicates the four distinct concepts in the visualization:
 *   1. Covered soil (green: living vegetation or protective crop residue >= 30%)
 *   2. Bare soil (brown: exposed surface < 30%, vulnerable to runoff)
 *   3. Unknown / missing observations (neutral grey: n_obs_per_doy = 0)
 *   4. Rainfall erosion risk (orange-to-red: independent overlay based on R * C)
 */

import React from 'react'

export interface RingLegendProps {
  className?: string
  compact?: boolean
  showDetails?: boolean
}

export const RingLegend: React.FC<RingLegendProps> = ({
  className = '',
  compact = false,
  showDetails = true,
}) => {
  return (
    <aside
      className={`rounded-lg border border-black/10 bg-white/90 p-4 backdrop-blur-sm ${className}`}
      aria-label="Year ring legend and scientific classification key"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 pb-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
          Calendar Legend & Soil Cover Key
        </h3>
        <span className="rounded bg-black/5 px-2 py-0.5 font-mono text-[11px] text-ink-soft">
          Threshold: 30% USDA-NRCS
        </span>
      </div>

      <div className={`mt-3 grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
        {/* 1. Covered Soil */}
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border border-black/10 shadow-sm"
            style={{ backgroundColor: '#1f6f43' }}
            aria-hidden="true"
          />
          <div>
            <div className="text-xs font-semibold text-ink">Covered Soil</div>
            <div className="text-[11px] leading-tight text-ink-soft">
              &ge; 30% cover from green canopy or protective residue
            </div>
          </div>
        </div>

        {/* 2. Bare Soil */}
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border border-black/10 shadow-sm"
            style={{ backgroundColor: '#8a6240' }}
            aria-hidden="true"
          />
          <div>
            <div className="text-xs font-semibold text-ink">Bare Soil</div>
            <div className="text-[11px] leading-tight text-ink-soft">
              &lt; 30% cover; exposed to detachment &amp; runoff
            </div>
          </div>
        </div>

        {/* 3. Unknown Observations */}
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border border-dashed border-black/30"
            style={{ backgroundColor: '#9ca3af' }}
            aria-hidden="true"
          />
          <div>
            <div className="text-xs font-semibold text-ink">Unknown / Masked</div>
            <div className="text-[11px] leading-tight text-ink-soft">
              0 usable observations; cloud/snow masked
            </div>
          </div>
        </div>

        {/* 4. Erosion Risk Overlay */}
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-black/10 bg-gradient-to-t from-risk-mid to-risk-high shadow-sm" aria-hidden="true">
            <div className="h-1.5 w-0.5 bg-white/80 rounded-full" />
          </div>
          <div>
            <div className="text-xs font-semibold text-risk-high">Erosion Risk (Overlay)</div>
            <div className="text-[11px] leading-tight text-ink-soft">
              Rain erosivity &Sigma; R &times; C; separate layer from cover
            </div>
          </div>
        </div>
      </div>

      {showDetails && (
        <div className="mt-3.5 border-t border-black/5 pt-2.5 text-[11px] leading-relaxed text-ink-soft">
          <p>
            <strong className="text-ink">Scientific Rule:</strong> Soil cover is determined strictly by{' '}
            <code className="font-mono text-ink">soil_cover = max(green_cover, residue_cover)</code>. Green canopy (NDVI) and crop stubble residue (NDTI) provide dual supporting evidence. Rainfall erosivity appears as an independent outer height/bar layer, never as the soil classification itself.
          </p>
        </div>
      )}
    </aside>
  )
}

export default RingLegend
