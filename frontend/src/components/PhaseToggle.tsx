/**
 * Which crop year the ring draws. Originally Kaif's; reduced to three
 * pills that sit on the dial rather than a card above it, because the
 * dial is meant to be the hero and the card was competing with it.
 */
export default function PhaseToggle({
  phases,
  active,
  onChange,
  locked = false,
}: {
  phases: { key: string; label: string; days: number }[]
  active: string | null
  onChange: (key: string | null) => void
  /** A preset rotation that only exists as an average curve. */
  locked?: boolean
}) {
  return (
    <div className="phase-pills" role="group" aria-label="Which crop year the ring shows">
      {phases.map((p) => (
        <button
          type="button"
          key={p.key}
          aria-pressed={active === p.key}
          disabled={locked}
          onClick={() => onChange(p.key)}
          title={`${p.days} bare days`}
        >
          {p.label}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={active === null}
        onClick={() => onChange(null)}
        title="The mean of the crop years — a curve no real year followed"
      >
        Average
      </button>
    </div>
  )
}
