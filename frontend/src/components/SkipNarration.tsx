/**
 * Skip the narrated opening and go straight to the dashboard.
 *
 * Sits in the bottom-right corner from the title card until the farmer's
 * brief ends. It is a sibling of the intro overlays, not a child, so a click
 * on it never reaches their "click to continue" handlers.
 */
import { cancelSpeech } from '../lib/speech'

export default function SkipNarration({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      className="skip-narration"
      // The brief advances on any window pointerdown or Space/Enter; keep
      // those from firing underneath this button.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={() => {
        cancelSpeech()
        onSkip()
      }}
    >
      Skip narration <span aria-hidden="true">&#9197;</span>
    </button>
  )
}
