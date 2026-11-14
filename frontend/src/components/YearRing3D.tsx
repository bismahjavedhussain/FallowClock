/**
 * YearRing3D.tsx — 3D WebGL Year Ring visualization using Three.js.
 *
 * Owned by U1 (The Ring).
 * Renders an elevated 3D physical agricultural ring with 365 daily segments:
 * - Annular 3D structure with extruded segments
 * - Soil cover color coding (green = covered, brown = bare, grey = unknown)
 * - Physical elevation corresponding to rainfall erosivity R
 * - Smooth Orbit/Pitch controls with clamped tilt and zoom limits
 * - Raycasting/polar day picking for hover and selection
 * - 3D Month billboard labels and camera reset button
 * - Graceful WebGL fallback if WebGL is unavailable
 * - Full resource disposal on unmount to prevent memory leaks
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { isWebGLAvailable } from '../lib/webgl'

const DOY_LEN = 365
const BARE_THRESHOLD = 0.3

export interface YearRing3DProps {
  soilCover: number[]
  erosivity: number[]
  nObs: number[]
  frostProb: number[]
  compareCover?: number[]
  highlightDoys?: number[]
  selectedDoy: number | null
  hoveredDoy: number | null
  onHoverDay?: (doy: number | null) => void
  onSelectDay?: (doy: number) => void
  onWebGLUnavailable?: () => void
}

export const MONTH_START_DOYS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Colors in Three.js Color format */
const COLOR_BARE = new THREE.Color(0x8a, 0x62, 0x40) // #8a6240
const COLOR_COVER_LOW = new THREE.Color(0xa0, 0xbe, 0x78) // #a0be78
const COLOR_COVER_HIGH = new THREE.Color(0x1f, 0x6f, 0x43) // #1f6f43
const COLOR_UNKNOWN = new THREE.Color(0x9c, 0xa3, 0xaf) // #9ca3af neutral grey
const COLOR_SELECTED = new THREE.Color(0xf5, 0xd5, 0x47) // #f5d547
const COLOR_COMPARE_BARE = new THREE.Color(0x5c, 0x41, 0x2a)
const COLOR_COMPARE_COVER = new THREE.Color(0x2f, 0x9e, 0x5f)

function getDayColor(cover: number, n: number): THREE.Color {
  if (n <= 0) return COLOR_UNKNOWN.clone()
  if (cover < BARE_THRESHOLD) return COLOR_BARE.clone()
  const t = Math.min(1, Math.max(0, (cover - BARE_THRESHOLD) / (1 - BARE_THRESHOLD)))
  return COLOR_COVER_LOW.clone().lerp(COLOR_COVER_HIGH, t)
}

export const YearRing3D: React.FC<YearRing3DProps> = ({
  soilCover,
  erosivity,
  nObs,
  compareCover,
  highlightDoys,
  selectedDoy,
  hoveredDoy,
  onHoverDay,
  onSelectDay,
  onWebGLUnavailable,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDraggingRef = useRef(false)
  const prevPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const cameraAngleRef = useRef({ theta: Math.PI / 4, phi: Math.PI / 3.4, radius: 24 })
  const targetLookAt = useRef(new THREE.Vector3(0, 0, 0))

  const [webglSupported, setWebglSupported] = useState(true)
  const animFrameRef = useRef<number | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const dayMeshesRef = useRef<THREE.Mesh[]>([])
  const innerMeshesRef = useRef<THREE.Mesh[]>([])

  const highlightSet = useMemo(
    () => (highlightDoys ? new Set(highlightDoys) : null),
    [highlightDoys],
  )

  const maxErosivity = useMemo(
    () => Math.max(...erosivity, 1e-6),
    [erosivity],
  )

  // Verify WebGL availability on mount
  useEffect(() => {
    if (!isWebGLAvailable()) {
      setWebglSupported(false)
      onWebGLUnavailable?.()
    }
  }, [onWebGLUnavailable])

  // Setup Three.js scene
  useEffect(() => {
    if (!webglSupported || !containerRef.current || !canvasRef.current) return

    const container = containerRef.current
    const canvas = canvasRef.current
    const width = container.clientWidth || 600
    const height = Math.max(container.clientHeight || 520, 480)

    // 1. Scene & Camera
    const scene = new THREE.Scene()
    sceneRef.current = scene
    scene.background = new THREE.Color(0xfb, 0xf9, 0xf6) // Soft paper background

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100)
    cameraRef.current = camera

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    rendererRef.current = renderer

    // 3. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75)
    scene.add(ambientLight)

    const sunLight = new THREE.DirectionalLight(0xfff7ea, 1.2)
    sunLight.position.set(12, 20, 15)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.width = 1024
    sunLight.shadow.mapSize.height = 1024
    sunLight.shadow.camera.near = 0.5
    sunLight.shadow.camera.far = 50
    sunLight.shadow.bias = -0.0005
    scene.add(sunLight)

    const fillLight = new THREE.DirectionalLight(0xdce7f0, 0.4)
    fillLight.position.set(-15, -10, -10)
    scene.add(fillLight)

    // 4. Ground subtle shadow plane
    const shadowGeo = new THREE.PlaneGeometry(32, 32)
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.15 })
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat)
    shadowPlane.rotation.x = -Math.PI / 2
    shadowPlane.position.y = -0.8
    shadowPlane.receiveShadow = true
    scene.add(shadowPlane)

    // 5. Build Ring Geometry for 365 Days
    // Radii in 3D units
    const rInner = 6.2
    const rOuter = 8.6
    const baseThickness = 0.55
    const erosivityMaxHeight = 1.6

    const dayMeshes: THREE.Mesh[] = []

    for (let i = 0; i < DOY_LEN; i++) {
      const a0 = (i / DOY_LEN) * Math.PI * 2
      const a1 = ((i + 1) / DOY_LEN) * Math.PI * 2

      // Erosivity height elevation on outer edge
      const erosFactor = (erosivity[i] ?? 0) / maxErosivity
      const extraHeight = Math.max(0.05, erosFactor * erosivityMaxHeight)
      const height = baseThickness + extraHeight

      // Create wedge shape
      const shape = new THREE.Shape()
      const segSteps = 4
      for (let s = 0; s <= segSteps; s++) {
        const a = a0 + (a1 - a0) * (s / segSteps)
        const x = rOuter * Math.sin(a)
        const z = -rOuter * Math.cos(a)
        if (s === 0) shape.moveTo(x, z)
        else shape.lineTo(x, z)
      }
      for (let s = segSteps; s >= 0; s++) {
        const a = a0 + (a1 - a0) * (s / segSteps)
        const x = rInner * Math.sin(a)
        const z = -rInner * Math.cos(a)
        shape.lineTo(x, z)
      }
      shape.closePath()

      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.02,
        bevelThickness: 0.02,
      })
      // Rotate geometry so depth extrudes along Y (upwards)
      geom.rotateX(Math.PI / 2)

      const color = getDayColor(soilCover[i] ?? 0, nObs[i] ?? 0)
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.12,
      })

      const mesh = new THREE.Mesh(geom, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData = { doy: i + 1 }
      scene.add(mesh)
      dayMeshes.push(mesh)
    }
    dayMeshesRef.current = dayMeshes

    // 6. Candidate Rotation Inner Band
    if (compareCover && compareCover.length >= DOY_LEN) {
      const innerMeshes: THREE.Mesh[] = []
      const rCompIn = 5.4
      const rCompOut = 6.0
      for (let i = 0; i < DOY_LEN; i++) {
        const a0 = (i / DOY_LEN) * Math.PI * 2
        const a1 = ((i + 1) / DOY_LEN) * Math.PI * 2
        const shape = new THREE.Shape()
        shape.moveTo(rCompOut * Math.sin(a0), -rCompOut * Math.cos(a0))
        shape.lineTo(rCompOut * Math.sin(a1), -rCompOut * Math.cos(a1))
        shape.lineTo(rCompIn * Math.sin(a1), -rCompIn * Math.cos(a1))
        shape.lineTo(rCompIn * Math.sin(a0), -rCompIn * Math.cos(a0))
        shape.closePath()

        const geom = new THREE.ExtrudeGeometry(shape, {
          depth: 0.35,
          bevelEnabled: false,
        })
        geom.rotateX(Math.PI / 2)

        const v = compareCover[i]
        const mat = new THREE.MeshStandardMaterial({
          color: v < BARE_THRESHOLD ? COLOR_COMPARE_BARE : COLOR_COMPARE_COVER,
          roughness: 0.65,
        })
        const mesh = new THREE.Mesh(geom, mat)
        scene.add(mesh)
        innerMeshes.push(mesh)
      }
      innerMeshesRef.current = innerMeshes
    }

    // 7. Month Billboards / Markers
    const monthGroup = new THREE.Group()
    const rMonth = rOuter + 1.2
    for (let m = 0; m < 12; m++) {
      const doy = MONTH_START_DOYS[m]
      const a = ((doy - 0.5) / DOY_LEN) * Math.PI * 2
      const x = rMonth * Math.sin(a)
      const z = -rMonth * Math.cos(a)

      // Month marker small pin
      const pinGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8)
      const pinMat = new THREE.MeshBasicMaterial({ color: 0x6b625a })
      const pin = new THREE.Mesh(pinGeo, pinMat)
      pin.position.set(x, 0.25, z)
      monthGroup.add(pin)
    }
    scene.add(monthGroup)

    // 8. Render loop
    const updateCameraPos = () => {
      const { theta, phi, radius } = cameraAngleRef.current
      const x = radius * Math.sin(phi) * Math.sin(theta)
      const y = radius * Math.cos(phi)
      const z = radius * Math.sin(phi) * Math.cos(theta)
      camera.position.set(x, y, z)
      camera.lookAt(targetLookAt.current)
    }

    const render = () => {
      updateCameraPos()
      renderer.render(scene, camera)
      animFrameRef.current = requestAnimationFrame(render)
    }
    render()

    // 9. Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        const h = Math.max(entry.contentRect.height, 460)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
    })
    resizeObserver.observe(container)

    // Cleanup on unmount or rebuild
    return () => {
      resizeObserver.disconnect()
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)

      // Dispose day meshes
      dayMeshes.forEach((mesh) => {
        mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose())
        else mesh.material.dispose()
        scene.remove(mesh)
      })
      innerMeshesRef.current.forEach((mesh) => {
        mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose())
        else mesh.material.dispose()
        scene.remove(mesh)
      })

      renderer.dispose()
    }
  }, [webglSupported, soilCover, erosivity, nObs, compareCover, maxErosivity])

  // Update dynamic colors and highlight / selected states without recreating geometries
  useEffect(() => {
    const meshes = dayMeshesRef.current
    if (!meshes || meshes.length === 0) return

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i]
      const doy = i + 1
      const isSelected = doy === selectedDoy
      const isHovered = doy === hoveredDoy
      const isHighlighted = highlightSet?.has(doy)

      const mat = mesh.material as THREE.MeshStandardMaterial
      if (!mat) continue

      if (isSelected) {
        mat.color.set(COLOR_SELECTED)
        mat.emissive.set(0x4a3a10)
      } else if (isHovered) {
        mat.color.set(COLOR_SELECTED.clone().lerp(COLOR_BARE, 0.4))
        mat.emissive.set(0x2a2208)
      } else if (isHighlighted) {
        mat.color.set(COLOR_SELECTED)
        mat.emissive.set(0x1a1505)
      } else {
        const baseCol = getDayColor(soilCover[i] ?? 0, nObs[i] ?? 0)
        mat.color.copy(baseCol)
        mat.emissive.set(0x000000)
      }
    }
  }, [soilCover, nObs, selectedDoy, hoveredDoy, highlightSet])

  // Pointer interactions for Camera Orbit & Day Raycasting
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = true
    prevPointerRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const getDoyUnderPointer = useCallback(
    (clientX: number, clientY: number): number | null => {
      if (!canvasRef.current || !cameraRef.current || !sceneRef.current) return null
      const rect = canvasRef.current.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * 2 - 1
      const y = -(((clientY - rect.top) / rect.height) * 2 - 1)

      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current)

      const hits = raycaster.intersectObjects(dayMeshesRef.current, false)
      if (hits.length > 0 && hits[0].object.userData.doy) {
        return hits[0].object.userData.doy as number
      }
      return null
    },
    [],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isDraggingRef.current) {
        const dx = e.clientX - prevPointerRef.current.x
        const dy = e.clientY - prevPointerRef.current.y
        prevPointerRef.current = { x: e.clientX, y: e.clientY }

        const rotSpeed = 0.007
        const angles = cameraAngleRef.current
        angles.theta += dx * rotSpeed
        // Clamp pitch so ring remains viewable and doesn't flip
        angles.phi = Math.max(0.25, Math.min(Math.PI / 2.05, angles.phi - dy * rotSpeed))
        return
      }

      // Hover Raycasting
      const doy = getDoyUnderPointer(e.clientX, e.clientY)
      onHoverDay?.(doy)
    },
    [getDoyUnderPointer, onHoverDay],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false

      // If drag distance was very small, treat as click/selection
      const dist = Math.hypot(
        e.clientX - prevPointerRef.current.x,
        e.clientY - prevPointerRef.current.y,
      )
      if (dist < 4) {
        const doy = getDoyUnderPointer(e.clientX, e.clientY)
        if (doy) onSelectDay?.(doy)
      }
    },
    [getDoyUnderPointer, onSelectDay],
  )

  const handlePointerLeave = useCallback(() => {
    isDraggingRef.current = false
    onHoverDay?.(null)
  }, [onHoverDay])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const zoomSpeed = 0.015
    const angles = cameraAngleRef.current
    angles.radius = Math.max(14, Math.min(36, angles.radius + e.deltaY * zoomSpeed))
  }, [])

  const resetCamera = useCallback(() => {
    cameraAngleRef.current = {
      theta: Math.PI / 4,
      phi: Math.PI / 3.4,
      radius: 24,
    }
  }, [])

  if (!webglSupported) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-ink-soft">
        <p className="font-semibold text-risk-high">WebGL is unavailable in this environment.</p>
        <p className="mt-1 text-sm">Please switch to the 2D View to explore the Year Ring.</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-[500px] w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-black/10 bg-paper"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onWheel={handleWheel}
      role="region"
      aria-label="3D Year Ring Interactive Calendar"
    >
      <canvas ref={canvasRef} className="h-full w-full cursor-grab active:cursor-grabbing" />

      {/* Floating 3D Controls */}
      <div className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-2">
        <button
          onClick={resetCamera}
          className="rounded-md border border-black/15 bg-white/90 px-2.5 py-1 text-xs font-medium text-ink shadow-sm backdrop-blur hover:bg-white hover:text-canopy-deep"
          title="Reset 3D camera to default isometric view"
          type="button"
        >
          Reset Camera
        </button>
      </div>

      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-white/80 px-2 py-1 text-[11px] font-medium text-ink-soft backdrop-blur">
        Drag to orbit · Scroll to zoom · Click day to inspect
      </div>
    </div>
  )
}

export default YearRing3D
