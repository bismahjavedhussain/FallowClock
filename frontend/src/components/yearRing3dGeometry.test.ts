import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DAY_STEP, DAYS_IN_RING, dayMatrix, wedgeGeometry } from './yearRing3dGeometry'
import { dayColor, instanceIdToDoy } from './YearRing3D'

describe('instanced 3D calendar geometry', () => {
  it('builds an upward-facing physical wedge with a single shared shape', () => {
    const geometry = wedgeGeometry(6.2, 8.6)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0)
    expect(geometry.boundingBox!.max.y).toBeCloseTo(1)
    expect(geometry.boundingBox!.min.z).toBeLessThan(-6)
    const normals = geometry.getAttribute('normal')
    const positions = geometry.getAttribute('position')
    expect(Array.from({ length: positions.count }, (_, i) => positions.getY(i) > 0.99 && normals.getY(i) > 0.9).some(Boolean)).toBe(true)
    geometry.dispose()
  })

  it('places 365 segments clockwise, with day 365 next to day 1', () => {
    expect(DAYS_IN_RING).toBe(365)
    expect(DAY_STEP * DAYS_IN_RING).toBeCloseTo(Math.PI * 2)
    const first = new THREE.Vector3(0, 0, -8.6).applyMatrix4(dayMatrix(0, 1))
    const summer = new THREE.Vector3(0, 0, -8.6).applyMatrix4(dayMatrix(182, 1))
    const last = new THREE.Vector3(0, 0, -8.6).applyMatrix4(dayMatrix(364, 1))
    expect(first.z).toBeCloseTo(-8.6)
    expect(summer.z).toBeGreaterThan(8.5)
    expect(last.distanceTo(first)).toBeLessThan(0.15)
    expect(instanceIdToDoy(0)).toBe(1)
    expect(instanceIdToDoy(364)).toBe(365)
    expect(instanceIdToDoy(undefined)).toBeNull()
  })

  it('keeps missing days grey and soil classification independent of erosivity', () => {
    expect(dayColor(0.1, 0).getHexString()).toBe('9ca3af')
    expect(dayColor(0.1, 5).getHexString()).toBe('8a6240')
    expect(dayColor(0.3, 5).getHexString()).not.toBe('8a6240')
  })
})
