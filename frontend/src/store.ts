/**
 * Shared state between U1 (the ring) and U2 (shell, panels, evidence).
 *
 * The boundary: U1 reads soilCover / erosivity / selected rotation and
 * writes hoveredDoy. U2 owns everything else. Keeping that line clean is
 * what lets the two work in parallel without stepping on each other.
 */
import { create } from 'zustand'

function getInitialStorage(key: string, defaultVal: boolean): boolean {
  if (typeof window === 'undefined') return defaultVal
  try {
    const val = localStorage.getItem(key)
    if (val === null) return defaultVal
    return val === 'true'
  } catch {
    return defaultVal
  }
}

function setStorage(key: string, val: boolean): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, String(val))
  } catch {
    // Ignore storage quota or access errors
  }
}

export interface AppState {
  bundle: unknown | null
  bundleError: string | null
  selectedRotationId: string | null
  hoveredDoy: number | null
  /** Species the user is dragging onto the ring, if any. */
  draggingSpeciesId: string | null
  selectedDoy: number
  placedFills: string[]
  reducedMotion: boolean
  /** One switch for ambience AND interaction sound. The header owns it. */
  soundEnabled: boolean
  /** Global switch for spoken voiceover and cinematic descent narration. */
  narrationEnabled: boolean
  /**
   * Which part of the experience is playing, so the audio bed can differ.
   * 'intro' is narration only -- music under a voiceover competes with it
   * and the opening line is the one that has to land.
   */
  audioStage: 'intro' | 'brief' | 'tool'
  /** RUSLE cover-subfactor coefficient, exposed so judges can test sensitivity. */
  rusleB: number

  setBundle: (b: unknown) => void
  setBundleError: (e: string | null) => void
  selectRotation: (id: string | null) => void
  setHoveredDoy: (doy: number | null) => void
  setDraggingSpecies: (id: string | null) => void
  setSelectedDoy: (doy: number) => void
  addPlacedFill: (id: string) => void
  removePlacedFill: (id: string) => void
  resetPlacedFills: () => void
  setReducedMotion: (reduced: boolean) => void
  setSoundEnabled: (on: boolean) => void
  setNarrationEnabled: (on: boolean) => void
  setAudioStage: (s: 'intro' | 'brief' | 'tool') => void
  setRusleB: (b: number) => void
}

export const useStore = create<AppState>((set) => ({
  bundle: null,
  bundleError: null,
  selectedRotationId: null,
  hoveredDoy: null,
  draggingSpeciesId: null,
  selectedDoy: 274,
  placedFills: [],
  reducedMotion: false,
  soundEnabled: getInitialStorage('fallowclock_sound_enabled', true),
  narrationEnabled: getInitialStorage('fallowclock_narration_enabled', true),
  audioStage: 'intro',
  rusleB: 0.035,

  setBundle: (bundle) => set({ bundle }),
  setBundleError: (bundleError) => set({ bundleError }),
  selectRotation: (selectedRotationId) => set({ selectedRotationId }),
  setHoveredDoy: (hoveredDoy) => set({ hoveredDoy }),
  setDraggingSpecies: (draggingSpeciesId) => set({ draggingSpeciesId }),
  setSelectedDoy: (doy) => set({ selectedDoy: Math.max(1, Math.min(365, Math.round(doy))) }),
  addPlacedFill: (id) => set((s) => ({ placedFills: s.placedFills.includes(id) ? s.placedFills : [...s.placedFills, id] })),
  removePlacedFill: (id) => set((s) => ({ placedFills: s.placedFills.filter((x) => x !== id) })),
  resetPlacedFills: () => set({ placedFills: [] }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  setSoundEnabled: (soundEnabled) => {
    setStorage('fallowclock_sound_enabled', soundEnabled)
    set({ soundEnabled })
  },
  setNarrationEnabled: (narrationEnabled) => {
    setStorage('fallowclock_narration_enabled', narrationEnabled)
    set({ narrationEnabled })
  },
  setAudioStage: (audioStage) => set({ audioStage }),
  setRusleB: (rusleB) => set({ rusleB }),
}))
