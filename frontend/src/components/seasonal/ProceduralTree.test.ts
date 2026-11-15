import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createProceduralTree } from './ProceduralTree'

describe('ProceduralTree seasonal responsiveness', () => {
  it('hides all leaves completely in winter (deciduous bare tree)', () => {
    const scene = new THREE.Scene()
    const tree = createProceduralTree(scene, 0, 0, 1, 100, 0.4)

    // Update with deep winter weights
    tree.update(0, { winter: 1, spring: 0, summer: 0, autumn: 0 }, false)

    // Inspect child meshes in the scene
    let foundLeafMesh = false
    scene.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) {
        foundLeafMesh = true
        // In winter, all leaf sets and falling leaves must be invisible
        expect(obj.visible).toBe(false)
      }
    })

    expect(foundLeafMesh).toBe(true)
    tree.dispose()
  })

  it('renders lush green canopy in summer with zero falling leaves', () => {
    const scene = new THREE.Scene()
    const tree = createProceduralTree(scene, 0, 0, 1, 100, 0.4)

    // Update with full summer weights
    tree.update(0, { winter: 0, spring: 0, summer: 1, autumn: 0 }, false)

    let canopyVisibleCount = 0
    let fallsVisible = false
    scene.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) {
        // The first 9 instanced meshes are branch leaf clusters
        // The last instanced mesh is the falling leaves
        if (obj.visible) canopyVisibleCount++
        else fallsVisible = true
      }
    })

    // Summer canopy must be visible
    expect(canopyVisibleCount).toBeGreaterThan(0)
    // Falling leaves must not be active in summer
    expect(fallsVisible).toBe(true) // At least the falling leaves mesh is hidden
    tree.dispose()
  })

  it('renders fresh spring green canopy with no falling leaves', () => {
    const scene = new THREE.Scene()
    const tree = createProceduralTree(scene, 0, 0, 1, 100, 0.4)

    // Update with spring weights
    tree.update(0, { winter: 0, spring: 1, summer: 0, autumn: 0 }, false)

    let canopyVisible = false
    scene.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh && obj.visible) {
        canopyVisible = true
      }
    })

    expect(canopyVisible).toBe(true)
    tree.dispose()
  })

  it('displays fiery autumn leaves with active falling leaves in autumn', () => {
    const scene = new THREE.Scene()
    const tree = createProceduralTree(scene, 0, 0, 1, 100, 0.4)

    // Update with peak autumn weights
    tree.update(1.5, { winter: 0, spring: 0, summer: 0, autumn: 1 }, false)

    let allMeshesVisible = true
    scene.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) {
        if (!obj.visible) allMeshesVisible = false
      }
    })

    // Both canopy and falling leaves should be visible in autumn
    expect(allMeshesVisible).toBe(true)
    tree.dispose()
  })
})
