import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import * as THREE from 'three'
import { createProceduralTree } from './seasonal/ProceduralTree'
import { createAtmosphereDetails } from './seasonal/AtmosphereDetails'
import { seasonWeights } from '../lib/seasons'
import { DAYS_IN_RING, DAY_STEP, dayMatrix, wedgeGeometry } from './yearRing3dGeometry'

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
  onActivateDay?: (doy: number) => void
  onWebGLUnavailable?: () => void
  reducedMotion?: boolean
}

export const MONTH_START_DOYS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const bare = new THREE.Color('#8a6240')
const coverLow = new THREE.Color('#a0be78')
const coverHigh = new THREE.Color('#1f6f43')
const unknown = new THREE.Color('#9ca3af')
const selected = new THREE.Color('#f5d547')
const hovered = new THREE.Color('#f9df79')
const candidate = new THREE.Color('#ead072')
const compareBare = new THREE.Color('#5c412a')
const compareCovered = new THREE.Color('#2f9e5f')
const colorScratch = new THREE.Color()

export function dayColor(cover: number, observations: number, target = new THREE.Color()): THREE.Color {
  if (observations <= 0 || !Number.isFinite(cover)) return target.copy(unknown)
  if (cover < 0.3) return target.copy(bare)
  return target.copy(coverLow).lerp(coverHigh, Math.max(0, Math.min(1, (cover - 0.3) / 0.7)))
}

export function instanceIdToDoy(instanceId: number | undefined): number | null {
  return instanceId !== undefined && instanceId >= 0 && instanceId < DAYS_IN_RING ? instanceId + 1 : null
}

function monthLabels(scene: THREE.Scene) {
  const group = new THREE.Group()
  const textures: THREE.CanvasTexture[] = []
  const materials: THREE.Material[] = []
  const geometries: THREE.BufferGeometry[] = []
  MONTH_START_DOYS.forEach((start, index) => {
    const next = index === 11 ? 366 : MONTH_START_DOYS[index + 1]
    const mid = start + (next - start) / 2
    const angle = (mid - 1) * DAY_STEP
    const x = 10.1 * Math.sin(angle)
    const z = -10.1 * Math.cos(angle)
    const pinGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.35, 6)
    const pinMat = new THREE.MeshBasicMaterial({ color: '#607767' })
    const pin = new THREE.Mesh(pinGeo, pinMat)
    pin.position.set(x, 0.17, z)
    group.add(pin)
    geometries.push(pinGeo)
    materials.push(pinMat)
    const surface = document.createElement('canvas')
    surface.width = 128; surface.height = 64
    const ctx = surface.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#fffaf0'
    ctx.beginPath(); ctx.roundRect(3, 3, 122, 58, 14); ctx.fill()
    ctx.fillStyle = '#315142'
    ctx.font = 'bold 28px system-ui'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(MONTH_NAMES[index], 64, 32)
    const texture = new THREE.CanvasTexture(surface)
    texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
    const sprite = new THREE.Sprite(material)
    sprite.position.set(x * 1.075, 0.55, z * 1.075)
    sprite.scale.set(1.55, 0.77, 1)
    group.add(sprite)
    textures.push(texture); materials.push(material)
  })
  scene.add(group)
  return () => {
    scene.remove(group)
    textures.forEach((texture) => texture.dispose())
    materials.forEach((material) => material.dispose())
    geometries.forEach((geometry) => geometry.dispose())
  }
}

export default function YearRing3D({ soilCover, erosivity, nObs, compareCover, highlightDoys, selectedDoy, hoveredDoy, onHoverDay, onSelectDay, onActivateDay, onWebGLUnavailable, reducedMotion = false }: YearRing3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const ringRef = useRef<THREE.InstancedMesh | null>(null)
  const compareRef = useRef<THREE.InstancedMesh | null>(null)
  const seasonRef = useRef(selectedDoy)
  const motionRef = useRef(reducedMotion)
  const fallbackRef = useRef(onWebGLUnavailable)
  const anglesRef = useRef({ theta: 0.38, phi: 0.92, radius: 29 })
  const dragRef = useRef({ active: false, moved: false, x: 0, y: 0, startX: 0, startY: 0 })
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const lastHoverRef = useRef<number | null>(null)
  const hoverFrameRef = useRef(0)
  const [webglSupported, setWebglSupported] = useState(true)
  seasonRef.current = selectedDoy
  motionRef.current = reducedMotion
  fallbackRef.current = onWebGLUnavailable

  const highlightSet = useMemo(() => new Set(highlightDoys ?? []), [highlightDoys])

  useEffect(() => {
    if (!webglSupported || !containerRef.current || !canvasRef.current) return
    const container = containerRef.current
    const canvas = canvasRef.current
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
    } catch {
      setWebglSupported(false)
      fallbackRef.current?.()
      return
    }
    rendererRef.current = renderer
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    const scene = new THREE.Scene()
    scene.background = null
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 90)
    cameraRef.current = camera
    const ambient = new THREE.AmbientLight('#ffffff', 1.2)
    const sun = new THREE.DirectionalLight('#fff1d0', 2)
    sun.position.set(9, 16, 11)
    sun.castShadow = true
    sun.shadow.mapSize.set(512, 512)
    sun.shadow.camera.near = 0.5
    sun.shadow.camera.far = 50
    sun.shadow.camera.left = -17; sun.shadow.camera.right = 17
    sun.shadow.camera.top = 17; sun.shadow.camera.bottom = -17
    scene.add(ambient, sun)
    const trees = [createProceduralTree(scene, -12, -7, 1.25, 115, 0.45), createProceduralTree(scene, 12, -6, 1.4, 316, 0.45)]
    const atmosphere = createAtmosphereDetails(scene, 122, 0.28)
    const floorGeo = new THREE.PlaneGeometry(32, 32)
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.13 })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.04
    floor.receiveShadow = true
    scene.add(floor)

    const dayGeo = wedgeGeometry(6.2, 8.6)
    const dayMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, metalness: 0.02 })
    const ring = new THREE.InstancedMesh(dayGeo, dayMat, DAYS_IN_RING)
    ring.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    ring.castShadow = true
    ring.receiveShadow = true
    ring.frustumCulled = false
    scene.add(ring)
    ringRef.current = ring
    const initialMax = Math.max(1e-6, ...erosivity.filter(Number.isFinite))
    const matrix = new THREE.Matrix4()
    const initialHighlights = new Set(highlightDoys ?? [])
    for (let i = 0; i < DAYS_IN_RING; i++) {
      const risk = Number.isFinite(erosivity[i]) ? Math.max(0, erosivity[i]) / initialMax : 0
      ring.setMatrixAt(i, dayMatrix(i, 0.5 + risk * 1.5, matrix))
      ring.setColorAt(i, i + 1 === selectedDoy ? selected : i + 1 === hoveredDoy ? hovered : initialHighlights.has(i + 1) ? candidate : dayColor(soilCover[i], nObs[i] ?? 0, colorScratch))
    }
    ring.instanceMatrix.needsUpdate = true
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true

    const compareGeo = wedgeGeometry(5.42, 5.98, 0.18)
    const compareMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.83 })
    const comparison = new THREE.InstancedMesh(compareGeo, compareMat, DAYS_IN_RING)
    comparison.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    comparison.frustumCulled = false
    comparison.count = 0
    for (let i = 0; i < DAYS_IN_RING; i++) comparison.setMatrixAt(i, dayMatrix(i, 1))
    comparison.instanceMatrix.needsUpdate = true
    if (compareCover?.length === DAYS_IN_RING) {
      comparison.count = DAYS_IN_RING
      for (let i = 0; i < DAYS_IN_RING; i++) comparison.setColorAt(i, (nObs[i] ?? 0) <= 0 ? unknown : compareCover[i] < 0.3 ? compareBare : compareCovered)
      if (comparison.instanceColor) comparison.instanceColor.needsUpdate = true
    }
    scene.add(comparison)
    compareRef.current = comparison
    const disposeLabels = monthLabels(scene)

    const updateCamera = () => {
      const { theta, phi, radius } = anglesRef.current
      // A narrow canvas has a narrower horizontal field of view. Keep the
      // complete wheel visible without changing the user's zoom setting.
      const framedRadius = radius * Math.max(1, 1.1 / camera.aspect)
      camera.position.set(framedRadius * Math.sin(phi) * Math.sin(theta), framedRadius * Math.cos(phi), framedRadius * Math.sin(phi) * Math.cos(theta))
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
    }
    const resize = () => {
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      renderer.setSize(rect.width, rect.height, false)
      camera.aspect = rect.width / rect.height
      camera.updateProjectionMatrix()
      updateCamera()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    const current = seasonWeights(seasonRef.current ?? 274)
    const clock = new THREE.Clock()
    const sunWarm = new THREE.Color('#fff1d0')
    const sunCool = new THREE.Color('#dbe8ff')
    let visible = true
    let frame = 0
    let running = false
    let lastFrame = 0
    const render = (now: number) => {
      if (!visible || document.hidden) { running = false; return }
      frame = requestAnimationFrame(render)
      if (now - lastFrame < (dragRef.current.active ? 16 : 33)) return
      lastFrame = now
      updateCamera()
      const target = seasonWeights(seasonRef.current ?? 274)
      const easing = motionRef.current ? 1 : 0.025
      for (const key of Object.keys(current) as (keyof typeof current)[]) current[key] += (target[key] - current[key]) * easing
      const time = clock.getElapsedTime()
      trees.forEach((tree) => tree.update(time, current, motionRef.current))
      atmosphere.update(time, current, motionRef.current)
      sun.color.copy(sunWarm).lerp(sunCool, current.winter)
      renderer.render(scene, camera)
    }
    const start = () => { if (!running && visible && !document.hidden) { running = true; frame = requestAnimationFrame(render) } }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) start() })
    observer.observe(container)
    const visibilityChanged = () => { if (!document.hidden) start() }
    document.addEventListener('visibilitychange', visibilityChanged)
    const contextLost = (event: Event) => { event.preventDefault(); setWebglSupported(false); fallbackRef.current?.() }
    canvas.addEventListener('webglcontextlost', contextLost)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      anglesRef.current.radius = Math.max(19, Math.min(43, anglesRef.current.radius + event.deltaY * 0.014))
    }
    container.addEventListener('wheel', wheel, { passive: false })
    start()

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(hoverFrameRef.current)
      document.removeEventListener('visibilitychange', visibilityChanged)
      canvas.removeEventListener('webglcontextlost', contextLost)
      container.removeEventListener('wheel', wheel)
      observer.disconnect(); resizeObserver.disconnect()
      ringRef.current = null; compareRef.current = null; cameraRef.current = null; rendererRef.current = null
      scene.remove(ring, comparison, floor)
      dayGeo.dispose(); dayMat.dispose(); compareGeo.dispose(); compareMat.dispose()
      floorGeo.dispose(); floorMat.dispose()
      disposeLabels(); trees.forEach((tree) => tree.dispose()); atmosphere.dispose()
      renderer.dispose()
      // React Strict Mode immediately sets this effect up again on the same
      // canvas in development. Forcing context loss here breaks that remount.
    }
  }, [webglSupported])

  useEffect(() => {
    const ring = ringRef.current
    if (!ring) return
    const max = Math.max(1e-6, ...erosivity.filter(Number.isFinite))
    const matrix = new THREE.Matrix4()
    for (let i = 0; i < DAYS_IN_RING; i++) {
      const risk = Number.isFinite(erosivity[i]) ? Math.max(0, erosivity[i]) / max : 0
      ring.setMatrixAt(i, dayMatrix(i, 0.5 + risk * 1.5, matrix))
    }
    ring.instanceMatrix.needsUpdate = true
    ring.computeBoundingSphere()
  }, [erosivity, webglSupported])

  useEffect(() => {
    const ring = ringRef.current
    if (!ring) return
    for (let i = 0; i < DAYS_IN_RING; i++) {
      const doy = i + 1
      const color = doy === selectedDoy ? selected : doy === hoveredDoy ? hovered : highlightSet.has(doy) ? candidate : dayColor(soilCover[i], nObs[i] ?? 0, colorScratch)
      ring.setColorAt(i, color)
    }
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true
  }, [soilCover, nObs, selectedDoy, hoveredDoy, highlightSet, webglSupported])

  useEffect(() => {
    const comparison = compareRef.current
    if (!comparison) return
    comparison.count = compareCover?.length === DAYS_IN_RING ? DAYS_IN_RING : 0
    if (!comparison.count) return
    for (let i = 0; i < DAYS_IN_RING; i++) {
      const color = (nObs[i] ?? 0) <= 0 ? unknown : compareCover![i] < 0.3 ? compareBare : compareCovered
      comparison.setColorAt(i, color)
    }
    if (comparison.instanceColor) comparison.instanceColor.needsUpdate = true
  }, [compareCover, nObs, webglSupported])

  const pickDay = useCallback((clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current
    const camera = cameraRef.current
    const ring = ringRef.current
    if (!canvas || !camera || !ring) return null
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
    pointerRef.current.set((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height * 2 - 1))
    camera.updateMatrixWorld()
    raycasterRef.current.setFromCamera(pointerRef.current, camera)
    return instanceIdToDoy(raycasterRef.current.intersectObject(ring, false)[0]?.instanceId)
  }, [])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== canvasRef.current) return
    dragRef.current = { active: true, moved: false, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])
  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      drag.x = event.clientX; drag.y = event.clientY
      if (drag.moved) {
        anglesRef.current.theta += dx * 0.007
        anglesRef.current.phi = Math.max(0.25, Math.min(Math.PI / 2.05, anglesRef.current.phi - dy * 0.007))
      }
      return
    }
    cancelAnimationFrame(hoverFrameRef.current)
    const x = event.clientX, y = event.clientY
    hoverFrameRef.current = requestAnimationFrame(() => {
      const doy = pickDay(x, y)
      if (doy !== lastHoverRef.current) { lastHoverRef.current = doy; onHoverDay?.(doy) }
    })
  }, [pickDay, onHoverDay])
  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag.active) return
    drag.active = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag.moved) {
      const doy = pickDay(event.clientX, event.clientY)
      if (doy) { onSelectDay?.(doy); onActivateDay?.(doy) }
    }
  }, [pickDay, onSelectDay, onActivateDay])
  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  if (!webglSupported) return <div className="flex h-full flex-col items-center justify-center p-8 text-center text-ink-soft"><p className="font-semibold text-risk-high">3D graphics are unavailable in this browser.</p><p className="mt-1 text-sm">Use the 2D Year Ring to continue.</p></div>
  return <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-xl border border-black/10 bg-paper" style={{ touchAction: 'none' }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} onLostPointerCapture={() => { dragRef.current.active = false }} onPointerLeave={() => { if (!dragRef.current.active && lastHoverRef.current !== null) { lastHoverRef.current = null; onHoverDay?.(null) } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const doy = pickDay(event.clientX, event.clientY); if (doy) { onSelectDay?.(doy); onActivateDay?.(doy) } }} role="region" aria-label="3D Year Ring Interactive Calendar">
    <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" />
    {/* Bottom-left: top-left is the day tooltip, top-centre the phase pills, bottom-right Reset camera. */}
    <div className="pointer-events-none absolute bottom-3 left-3 max-w-[48%] rounded-md bg-white/85 px-2 py-1 text-[11px] font-medium text-ink-soft backdrop-blur">Drag to orbit · scroll to zoom · click a day</div>
    {/* Shares .dial-pill with the legend trigger so the two corner
        controls cannot drift apart visually. */}
    <button type="button" className="dial-pill ring-reset" onPointerDown={(event) => event.stopPropagation()} onClick={() => { anglesRef.current = { theta: 0.38, phi: 0.92, radius: 29 } }}>
      <span aria-hidden="true">⟳</span>
      Reset camera
    </button>
  </div>
}
