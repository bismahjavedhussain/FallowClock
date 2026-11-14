import * as THREE from 'three'

export const DAYS_IN_RING = 365
export const DAY_STEP = Math.PI * 2 / DAYS_IN_RING

/** A wedge at 12 o'clock, with its depth along positive Y. Rotate instances around Y. */
export function wedgeGeometry(inner: number, outer: number, depth = 1): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  const subdivisions = 3
  for (let i = 0; i <= subdivisions; i++) {
    const angle = DAY_STEP * i / subdivisions
    const x = outer * Math.sin(angle)
    const z = outer * Math.cos(angle)
    if (i === 0) shape.moveTo(x, z)
    else shape.lineTo(x, z)
  }
  for (let i = subdivisions; i >= 0; i--) {
    const angle = DAY_STEP * i / subdivisions
    shape.lineTo(inner * Math.sin(angle), inner * Math.cos(angle))
  }
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 2 })
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

const position = new THREE.Vector3()
const scale = new THREE.Vector3(1, 1, 1)
const rotation = new THREE.Quaternion()
const axis = new THREE.Vector3(0, 1, 0)

export function dayMatrix(index: number, height: number, target = new THREE.Matrix4()): THREE.Matrix4 {
  rotation.setFromAxisAngle(axis, -index * DAY_STEP)
  scale.set(1, height, 1)
  return target.compose(position, rotation, scale)
}
