/**
 * Shared state between U1 (the ring) and U2 (shell, panels, evidence).
 *
 * The boundary: U1 reads soilCover / erosivity / selected rotation and
 * writes hoveredDoy. U2 owns everything else. Keeping that line clean is
 * what lets the two work in parallel without stepping on each other.
 */
import { create } from 'zustand'
import type { Bundle } from './lib/bundle'

export interface AppState {
  bundle: Bundle | null
  bundleError: string | null
  /** A preset rotation from the bundle. Mutually exclusive with placedFills. */
  selectedRotationId: string | null
  hoveredDoy: number | null
  /** Species the user is dragging onto the ring, if any. */
  draggingSpeciesId: string | null
  selectedDoy: number
  /** The user's own plan. Choosing a preset rotation clears it, and vice versa. */
  placedFills: string[]
  reducedMotion: boolean
  /** RUSLE cover-subfactor coefficient, exposed so judges can test sensitivity. */
  rusleB: number
  /** Crop year on the ring, e.g. 'soybean'. null = the average of the phases. */
  phaseKey: string | null

  setBundle: (b: Bundle) => void
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
  setPhaseKey: (key: string | null) => void
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
  phaseKey: null,

  setBundle: (bundle) => set({ bundle, bundleError: null }),
  setBundleError: (bundleError) => set({ bundleError }),
  selectRotation: (id) => set((s) => ({ selectedRotationId: id, placedFills: id ? [] : s.placedFills })),
  setHoveredDoy: (hoveredDoy) => set({ hoveredDoy }),
  setDraggingSpecies: (draggingSpeciesId) => set({ draggingSpeciesId }),
  setSelectedDoy: (doy) => set({ selectedDoy: Math.max(1, Math.min(365, Math.round(doy))) }),
  addPlacedFill: (id) =>
    set((s) => ({ selectedRotationId: null, placedFills: s.placedFills.includes(id) ? s.placedFills : [...s.placedFills, id] })),
  removePlacedFill: (id) => set((s) => ({ placedFills: s.placedFills.filter((x) => x !== id) })),
  resetPlacedFills: () => set({ placedFills: [] }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  setRusleB: (rusleB) => set({ rusleB }),
  setPhaseKey: (phaseKey) => set({ phaseKey }),
}))
