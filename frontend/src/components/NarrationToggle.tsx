import { useStore } from '../store'
import { cancelSpeech } from '../lib/speech'

export interface NarrationToggleProps {
  onStopNarration?: () => void
  enabled?: boolean
}

/**
 * Global narration toggle button.
 *
 * Placed in the topbar header so it is visible and accessible from every
 * slide, act, and screen in the application.
 *
 * When clicked:
 * - Toggles narrationEnabled in the global Zustand store and localStorage.
 * - If turned OFF while narration or dialogue is speaking, immediately
 *   cancels speech synthesis and drops straight to the tool.
 * - When OFF, switching between Story County and Monona County loads the
 *   new field data instantly without restarting the cinematic intro.
 */
export default function NarrationToggle({ onStopNarration, enabled }: NarrationToggleProps) {
  const storeNarrationEnabled = useStore((s) => s.narrationEnabled)
  const narrationEnabled =
    enabled !== undefined
      ? enabled
      : typeof window === 'undefined'
        ? useStore.getState().narrationEnabled
        : storeNarrationEnabled
  const setNarrationEnabled = useStore((s) => s.setNarrationEnabled)

  const toggle = () => {
    const next = !narrationEnabled
    setNarrationEnabled(next)
    if (!next) {
      cancelSpeech()
      onStopNarration?.()
    }
  }

  return (
    <button
      type="button"
      className="narration-toggle"
      aria-pressed={narrationEnabled}
      aria-label={
        narrationEnabled
          ? 'Narration is on. Click to stop narration.'
          : 'Narration is off. Click to enable narration.'
      }
      title={narrationEnabled ? 'Narration on (click to mute voice)' : 'Narration off (click to enable voice)'}
      onClick={toggle}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {/* Speech bubble outline */}
        <path
          d="M20 12c0 4.4-3.8 8-8.5 8-1.5 0-2.9-.4-4.1-1.1L3.5 20l1.3-3.6C3.9 15.1 3.5 13.6 3.5 12 3.5 7.6 7.3 4 12 4s8.5 3.6 8.5 8z"
          fill={narrationEnabled ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
          opacity={narrationEnabled ? 0.2 : 0.6}
        />
        {narrationEnabled ? (
          <>
            {/* Audio wave dots/bars inside bubble */}
            <circle cx="8.5" cy="12" r="1.2" fill="currentColor" />
            <circle cx="12" cy="12" r="1.2" fill="currentColor" />
            <circle cx="15.5" cy="12" r="1.2" fill="currentColor" />
          </>
        ) : (
          <>
            {/* Diagonal slash for muted/off state */}
            <line
              x1="4.5"
              y1="4.5"
              x2="19.5"
              y2="19.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </button>
  )
}
