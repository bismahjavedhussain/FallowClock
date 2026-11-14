/**
 * Shared state between U1 (the ring) and U2 (shell, panels, evidence).
 *
 * The boundary: U1 reads soilCover / erosivity / selected rotation and
 * writes hoveredDoy. U2 owns everything else. Keeping that line clean is
 * what lets the two work in parallel without stepping on each other.
 */
import { create } from 'zustand'

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
  setRusleB: (rusleB) => set({ rusleB }),
}))
