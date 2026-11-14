import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createProceduralTree } from './ProceduralTree'
import { createAtmosphereDetails } from './AtmosphereDetails'
import { seasonAtDoy, seasonWeights } from '../../lib/seasons'

export default function SeasonalWorld({ doy, reducedMotion, active = true }: { doy: number; reducedMotion: boolean; active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const targetRef = useRef(seasonWeights(doy))
  const reducedRef = useRef(reducedMotion)
  targetRef.current = seasonWeights(doy)
  reducedRef.current = reducedMotion

  useEffect(() => {
    if (!active || !canvasRef.current) return
    const canvas = canvasRef.current
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-9, 9, 5.5, -5.5, 0.1, 100)
    camera.position.set(0, 3, 18)
    camera.lookAt(0, 1.7, 0)
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }) } catch { return }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const sunlight = new THREE.DirectionalLight('#fff1d0', 2.1)
    sunlight.position.set(-6, 12, 9)
    scene.add(sunlight, new THREE.AmbientLight('#d9e9ef', 1.35))
    const trees = [
      createProceduralTree(scene, -6.1, -2.5, 1.55, 115, 0.8),
      createProceduralTree(scene, 6.3, -3.2, 1.75, 316, 0.8),
      createProceduralTree(scene, -8.9, -7, 1.25, 772, 0.55),
    ]
    const details = createAtmosphereDetails(scene, 91, 0.6)
    const groundGeo = new THREE.CircleGeometry(10, 48)
    const groundMat = new THREE.MeshStandardMaterial({ color: '#9bc993', roughness: 1, side: THREE.DoubleSide })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.scale.set(1.5, 0.48, 1)
    ground.position.set(0, -0.84, -4)
    scene.add(ground)
    const current = seasonWeights(doy)
    const clock = new THREE.Clock()
    let frame = 0
    let visible = true
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    observer.observe(canvas)
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      renderer.setSize(rect.width, rect.height, false)
      const aspect = rect.width / rect.height
      camera.left = -8.5 * aspect; camera.right = 8.5 * aspect
      camera.updateProjectionMatrix()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()
    const render = () => {
      frame = requestAnimationFrame(render)
      if (!visible || document.hidden) return
      const elapsed = clock.getElapsedTime()
      const target = targetRef.current
      for (const key of Object.keys(current) as (keyof typeof current)[]) current[key] += (target[key] - current[key]) * (reducedRef.current ? 1 : 0.025)
      for (const tree of trees) tree.update(elapsed, current, reducedRef.current)
      details.update(elapsed, current, reducedRef.current)
      groundMat.color.set('#9bc993').lerp(new THREE.Color('#dbe8ef'), current.winter * 0.9).lerp(new THREE.Color('#dba76f'), current.autumn * 0.42)
      sunlight.color.set('#fff1d0').lerp(new THREE.Color('#dbe7ff'), current.winter * 0.8)
      renderer.render(scene, camera)
    }
    render()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect(); resizeObserver.disconnect()
      for (const tree of trees) tree.dispose()
      details.dispose()
      groundGeo.dispose(); groundMat.dispose(); renderer.dispose(); renderer.forceContextLoss()
    }
  }, [active])

  const weights = seasonWeights(doy)
  return <div className={`seasonal-world season-${seasonAtDoy(doy)}`} aria-hidden="true">
    {(['spring', 'summer', 'autumn', 'winter'] as const).map((season) => <div key={season} className={`season-layer layer-${season}`} style={{ opacity: weights[season] }} />)}
    <div className="scenic-sun" /><div className="scenic-cloud cloud-one" /><div className="scenic-cloud cloud-two" /><div className="scenic-hills" />{active && <canvas ref={canvasRef} />}
  </div>
}
