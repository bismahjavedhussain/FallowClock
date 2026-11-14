/** Which crop year the ring draws. U2 owns this file. */
export default function PhaseToggle({ phases, active, onChange, locked = false }: {
  phases: { key: string; label: string; days: number }[]
  active: string | null
  onChange: (key: string | null) => void
  /** A preset rotation that only exists as an average curve. */
  locked?: boolean
}) {
  return (
    <div className="phase-toggle" role="group" aria-label="Which crop year the ring shows">
      <span className="eyebrow">Ring shows</span>
      <div className="phase-buttons">
        {phases.map((p) => (
          <button type="button" key={p.key} aria-pressed={active === p.key} disabled={locked} onClick={() => onChange(p.key)}>
            {p.label}
            <small>{p.days} bare days</small>
          </button>
        ))}
        <button type="button" aria-pressed={active === null} onClick={() => onChange(null)}>
          Average
          <small>no real year</small>
        </button>
      </div>
      <p>A crop year runs May to April, so its winter shows that crop&rsquo;s residue.</p>
    </div>
  )
}
