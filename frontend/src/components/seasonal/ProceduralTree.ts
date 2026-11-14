import * as THREE from 'three'
import type { Season } from '../../lib/seasons'

/* Procedural seasonal tree with leaf clusters, branch sway, and falling leaves. */
export interface LivingTree {
  update: (time: number, weights: Record<Season, number>, reduced: boolean) => void
  dispose: () => void
}

function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const foliageColors: Record<Season, string[]> = {
  spring: ['#f7a8c0', '#ffc6d0', '#fff0cf', '#b9ddb4'],
  summer: ['#3f9c6e', '#65bc77', '#9bd488', '#d8e7a3'],
  autumn: ['#ba493c', '#e47938', '#f1ad43', '#f7ce77'],
  winter: ['#a4b8ca', '#d4e4ed', '#f4f8fb', '#c5dbe4'],
}

function leafGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(0, -0.04)
  shape.bezierCurveTo(-0.17, 0.1, -0.19, 0.33, 0, 0.53)
  shape.bezierCurveTo(0.19, 0.33, 0.17, 0.1, 0, -0.04)
  return new THREE.ShapeGeometry(shape, 4)
}

function limb(start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material) {
  const delta = end.clone().sub(start)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.44, radius, delta.length(), 7), material)
  mesh.position.copy(start).add(end).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
  mesh.castShadow = true
  return mesh
}

export function createProceduralTree(scene: THREE.Scene, x: number, z: number, scale: number, seed: number, quality = 1): LivingTree {
  const random = rng(seed)
  const root = new THREE.Group()
  root.position.set(x, -0.8, z)
  root.scale.setScalar(scale)
  scene.add(root)
  const wood = new THREE.MeshStandardMaterial({ color: '#80716d', roughness: 0.93, flatShading: true })
  const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.88, flatShading: true, vertexColors: false })
  const fallingMat = leafMat.clone()
  const branchGroups: { group: THREE.Group; phase: number; strength: number }[] = []
  const leafSets: { mesh: THREE.InstancedMesh; positions: THREE.Vector3[]; hues: number[] }[] = []
  const canopy: THREE.Vector3[] = []
  const geometries: THREE.BufferGeometry[] = []
  const trunkPoints = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.1, 1.1, 0), new THREE.Vector3(0.12, 2.3, 0), new THREE.Vector3(0, 3.5, 0)]
  for (let i = 0; i < trunkPoints.length - 1; i++) root.add(limb(trunkPoints[i], trunkPoints[i + 1], 0.27 - i * 0.055, wood))
  const leafGeo = leafGeometry()
  geometries.push(leafGeo)
  const countPerBranch = Math.max(24, Math.round(72 * quality))
  for (let b = 0; b < 9; b++) {
    const height = 1.12 + b * 0.26
    const angle = b * 2.39996
    const reach = 1.25 + random() * 0.68
    const pivot = new THREE.Group()
    pivot.position.set((b % 2 ? 0.05 : -0.08), height, 0)
    root.add(pivot)
    branchGroups.push({ group: pivot, phase: random() * Math.PI * 2, strength: 0.014 + 0.016 * random() })
    const tip = new THREE.Vector3(Math.cos(angle) * reach, 0.25 + random() * 0.32, Math.sin(angle) * reach)
    const mid = tip.clone().multiplyScalar(0.58).add(new THREE.Vector3(0, 0.14, 0))
    pivot.add(limb(new THREE.Vector3(), mid, 0.095, wood), limb(mid, tip, 0.049, wood))
    for (let t = 0; t < 3; t++) {
      const off = new THREE.Vector3((random() - 0.5) * 0.75, 0.24 + random() * 0.42, (random() - 0.5) * 0.75)
      pivot.add(limb(tip.clone().multiplyScalar(0.55 + t * 0.16), tip.clone().add(off), 0.021, wood))
    }
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, countPerBranch)
    leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    leaves.frustumCulled = false
    const positions: THREE.Vector3[] = []
    const hues: number[] = []
    for (let i = 0; i < countPerBranch; i++) {
      const phi = random() * Math.PI * 2
      const radial = Math.cbrt(random())
      const pos = tip.clone().multiplyScalar(0.76 + random() * 0.3).add(new THREE.Vector3(Math.cos(phi) * radial * 0.87, (random() - 0.5) * 1.12, Math.sin(phi) * radial * 0.7))
      positions.push(pos)
      hues.push(Math.floor(random() * 4))
      canopy.push(pos.clone().add(pivot.position))
    }
    pivot.add(leaves)
    leafSets.push({ mesh: leaves, positions, hues })
  }
  const fallCount = Math.max(20, Math.round(52 * quality))
  const falls = new THREE.InstancedMesh(leafGeo, fallingMat, fallCount)
  falls.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  falls.frustumCulled = false
  root.add(falls)
  const fallState = Array.from({ length: fallCount }, (_, i) => ({
    origin: canopy[Math.floor(random() * canopy.length)].clone(),
    phase: (i / fallCount) * 9,
    speed: 0.4 + random() * 0.55,
    sway: 0.35 + random() * 0.65,
    spin: random() * 6,
  }))
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  const target = new THREE.Color()
  let lastPalette = ''
  const update = (time: number, weights: Record<Season, number>, reduced: boolean) => {
    const paletteKey = Object.values(weights).map((v) => v.toFixed(2)).join(':')
    const winter = weights.winter
    const autumn = weights.autumn
    const visibility = clamp(1 - winter * 0.88)
    const wind = reduced ? 0 : 1
    for (const { group, phase, strength } of branchGroups) {
      group.rotation.z = wind * strength * (Math.sin(time * 0.8 + phase) + 0.38 * Math.sin(time * 1.9 + phase * 1.7))
      group.rotation.x = wind * strength * Math.sin(time * 1.1 + phase * 0.7)
    }
    for (const { mesh, positions, hues } of leafSets) {
      for (let i = 0; i < positions.length; i++) {
        dummy.position.copy(positions[i])
        dummy.rotation.set(wind * 0.11 * Math.sin(time * 2.5 + i), i * 2.4, wind * 0.15 * Math.sin(time * 2.1 + i * 0.65))
        const size = (0.48 + (i % 7) * 0.055) * visibility
        dummy.scale.set(size, size, size)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        if (paletteKey !== lastPalette) {
          color.setRGB(0, 0, 0)
          for (const season of Object.keys(weights) as Season[]) {
            target.set(foliageColors[season][hues[i]])
            color.r += target.r * weights[season]
            color.g += target.g * weights[season]
            color.b += target.b * weights[season]
          }
          mesh.setColorAt(i, color)
        }
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor && paletteKey !== lastPalette) mesh.instanceColor.needsUpdate = true
    }
    lastPalette = paletteKey
    for (let i = 0; i < fallCount; i++) {
      const state = fallState[i]
      const cycle = (time * state.speed + state.phase) % 9
      const active = (autumn + weights.spring * 0.55) * (reduced ? 0 : 1)
      dummy.position.copy(state.origin)
      dummy.position.y = Math.max(0.03, state.origin.y - cycle * 0.48)
      dummy.position.x += Math.sin(cycle * 1.6 + state.spin) * state.sway + cycle * 0.12
      dummy.position.z += Math.cos(cycle * 1.2 + state.spin) * state.sway * 0.55
      dummy.rotation.set(cycle * 1.8 + state.spin, cycle * 1.3, cycle * 2.1)
      const size = (cycle < 7 ? 0.4 : 0.4 * (9 - cycle) / 2) * active
      dummy.scale.setScalar(Math.max(0.0001, size))
      dummy.updateMatrix()
      falls.setMatrixAt(i, dummy.matrix)
      color.set(autumn >= weights.spring ? foliageColors.autumn[i % 4] : foliageColors.spring[i % 4])
      falls.setColorAt(i, color)
    }
    falls.instanceMatrix.needsUpdate = true
    if (falls.instanceColor) falls.instanceColor.needsUpdate = true
  }
  return {
    update,
    dispose() {
      scene.remove(root)
      root.traverse((object) => {
        if (object instanceof THREE.Mesh && object.geometry !== leafGeo) object.geometry.dispose()
      })
      for (const geometry of geometries) geometry.dispose()
      wood.dispose(); leafMat.dispose(); fallingMat.dispose()
    },
  }
}
