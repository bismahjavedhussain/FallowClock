/**
 * The farmer working something out, then handing you the diary.
 *
 * Runs for a fixed spell and stops. A loader that spins forever says the
 * app is stuck; this one finishes, because the work really is finished --
 * every figure it cycles through was computed before the page rendered.
 *
 * THE TIMER STARTS WHEN THE ACT IS SEEN, not when this mounts. The deck
 * renders underneath the entry gate and the intro, so on mount this is
 * behind roughly thirty seconds of opening sequence -- the seven seconds
 * elapsed during the descent and the user only ever met the finished
 * button. `active` is what fixes that.
 *
 * The status lines are NOT progress theatre: each names a real number from
 * this field, so the loop reports what the model weighed. Switch fields
 * and the thoughts change with them.
 */

import { useEffect, useState } from 'react'

const LINE_MS = 1700
/** How long the farmer "thinks" before offering the diary. */
const THINK_MS = 7000

export default function FarmerThinking({
  lines,
  reducedMotion = false,
  onOpenDiary,
  active = true,
}: {
  lines: string[]
  reducedMotion?: boolean
  onOpenDiary: () => void
  /** True only while this act is the one on screen. */
  active?: boolean
}) {
  const [i, setI] = useState(0)
  const [done, setDone] = useState(reducedMotion)

  useEffect(() => {
    if (reducedMotion || !active || done || lines.length < 2) return
    const id = window.setInterval(() => setI((n) => (n + 1) % lines.length), LINE_MS)
    return () => window.clearInterval(id)
  }, [lines.length, reducedMotion, active, done])

  useEffect(() => {
    if (reducedMotion || !active) return
    const id = window.setTimeout(() => setDone(true), THINK_MS)
    return () => window.clearTimeout(id)
  }, [reducedMotion, active])

  if (!lines.length) return null

  if (done) {
    return (
      <div className="farmer-thinking is-done">
        <img
          src="/sprite/farmer-write/south-east.png"
          width={48}
          height={48}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <button type="button" className="diary-cta" onClick={onOpenDiary}>
          See the farmer&rsquo;s diary
          <span className="diary-cta-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    )
  }

  return (
    <div className="farmer-thinking" role="status" aria-live="polite">
      <span className="thinking-ring" aria-hidden="true" />
      <img
        src="/sprite/farmer-write/south-east.png"
        width={48}
        height={48}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <div className="thinking-copy">
        <span className="eyebrow">Working it out</span>
        <p key={i}>{lines[i]}</p>
      </div>
    </div>
  )
}
