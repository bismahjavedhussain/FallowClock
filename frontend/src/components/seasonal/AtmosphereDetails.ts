import * as THREE from 'three'
import type { Season } from '../../lib/seasons'

export function createAtmosphereDetails(scene: THREE.Scene, seed = 91, quality = 1) {
  let state = seed >>> 0
  const rand = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296)
  const snowShape = new THREE.Shape()
  const points: THREE.Vector2[] = []
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2
    const radius = i % 4 === 0 ? 0.17 : i % 2 === 0 ? 0.065 : 0.028
    points.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius))
  }
  snowShape.setFromPoints(points)
  const snowGeo = new THREE.ShapeGeometry(snowShape)
  const snowMat = new THREE.MeshBasicMaterial({ color: '#f9fdff', side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false })
  const snowCount = Math.round(95 * quality)
  const snow = new THREE.InstancedMesh(snowGeo, snowMat, snowCount)
  snow.frustumCulled = false
  scene.add(snow)
  const snowSeed = Array.from({ length: snowCount }, () => ({ x: (rand() - 0.5) * 27, y: rand() * 10, z: -8 + rand() * 15, speed: 0.35 + rand() * 0.8, phase: rand() * 7 }))

  const bladeShape = new THREE.Shape()
  bladeShape.moveTo(-0.055, 0); bladeShape.quadraticCurveTo(-0.07, 0.32, 0.04, 0.63); bladeShape.quadraticCurveTo(0.015, 0.18, 0.065, 0)
  const grassGeo = new THREE.ShapeGeometry(bladeShape)
  const grassMat = new THREE.MeshStandardMaterial({ color: '#91ba82', side: THREE.DoubleSide, roughness: 1 })
  const grassCount = Math.round(230 * quality)
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, grassCount)
  grass.frustumCulled = false
  scene.add(grass)
  const grassSeed = Array.from({ length: grassCount }, () => ({ x: (rand() - 0.5) * 28, z: -7 + rand() * 10, height: 0.45 + rand() * 1.1, phase: rand() * 7 }))
  const dummy = new THREE.Object3D()
  return {
    update(time: number, weights: Record<Season, number>, reduced: boolean) {
      for (let i = 0; i < snowCount; i++) {
        const s = snowSeed[i]
        dummy.position.set(s.x + (reduced ? 0 : Math.sin(time * 0.7 + s.phase) * 0.75), ((s.y - (reduced ? 0 : time * s.speed)) % 10 + 10) % 10 - 0.8, s.z)
        dummy.rotation.set(0, 0, reduced ? 0 : time * (0.3 + s.speed) + s.phase)
        const size = weights.winter * (0.45 + (i % 4) * 0.16)
        dummy.scale.setScalar(Math.max(0.0001, size))
        dummy.updateMatrix(); snow.setMatrixAt(i, dummy.matrix)
      }
      snow.instanceMatrix.needsUpdate = true
      for (let i = 0; i < grassCount; i++) {
        const g = grassSeed[i]
        dummy.position.set(g.x, -0.79, g.z)
        dummy.rotation.set(0, i * 2.4, reduced ? 0 : Math.sin(time * 1.25 + g.phase) * 0.12)
        const size = Math.max(0.03, 1 - weights.winter * 0.86)
        dummy.scale.set(0.8 * size, g.height * size, 0.8 * size)
        dummy.updateMatrix(); grass.setMatrixAt(i, dummy.matrix)
      }
      grass.instanceMatrix.needsUpdate = true
      grassMat.color.set('#72bd7e').lerp(new THREE.Color('#c99665'), weights.autumn * 0.82).lerp(new THREE.Color('#d4e3eb'), weights.winter)
    },
    dispose() {
      scene.remove(snow, grass)
      snowGeo.dispose(); snowMat.dispose(); grassGeo.dispose(); grassMat.dispose()
    },
  }
}
