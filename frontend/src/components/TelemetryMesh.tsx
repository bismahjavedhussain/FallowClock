/**
 * The telemetry constellation over the title card's orbital backdrop.
 *
 * Decorative, so it is aria-hidden: there is nothing here a screen reader
 * should be told about, and announcing "image" over a background texture
 * is noise between the heading and the Begin button.
 *
 * The geometry is solved once by lib/telemetryMesh.ts and never touched
 * again -- see the note there on why the group drifts and the nodes only
 * pulse. Everything that moves, moves in CSS.
 */

import { useMemo } from 'react'
import { buildMesh } from '../lib/telemetryMesh'

export default function TelemetryMesh({
  seed = 7,
  count = 46,
}: {
  seed?: number
  count?: number
}) {
  const mesh = useMemo(() => buildMesh({ seed, count }), [seed, count])

  return (
    <svg
      className="telemetry-mesh"
      viewBox={`0 0 ${mesh.width} ${mesh.height}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="tm-node-glow">
          <stop offset="0%" stopColor="#7ff2c6" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#4fd6c0" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#4fd6c0" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Edges first, so the dots sit on top of their own lines. */}
      <g className="tm-edges">
        {mesh.edges.map((e, i) => {
          const a = mesh.nodes[e.a]
          const b = mesh.nodes[e.b]
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              /* Closer pairs read brighter, which is what stops the mesh
                 looking like a flat wireframe. */
              strokeOpacity={0.16 + e.strength * 0.4}
              style={{ animationDelay: `${(a.delay + b.delay) / 2}s` }}
            />
          )
        })}
      </g>

      <g className="tm-nodes">
        {mesh.nodes.map((n, i) => (
          <g key={i} style={{ animationDelay: `${n.delay}s` }}>
            <circle className="tm-halo" cx={n.x} cy={n.y} r={n.r * 4.2} fill="url(#tm-node-glow)" />
            <circle className="tm-dot" cx={n.x} cy={n.y} r={n.r} />
          </g>
        ))}
      </g>
    </svg>
  )
}
