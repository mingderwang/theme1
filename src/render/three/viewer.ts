/**
 * The three.js viewer: a second renderer over the same `World`.
 *
 * This exists to keep the generation/rendering boundary honest. The CPU ray
 * marcher is the primary renderer; if the `World` model were secretly shaped
 * around ray marching, a completely different renderer could not read it.
 * Everything here consumes only the public world data, through
 * terrainMesh.ts, which is deliberately free of any three.js dependency so it
 * can be tested in plain bun.
 */

import { buildTerrainBuffers, describeScene } from './terrainMesh.ts'
import type { World } from '../../world/types.ts'
import type { WorldTheme } from '../../theme/types.ts'

// three is pulled in at runtime with a dynamic import so the CPU renderer
// never pays for it; the type-only namespace import is what makes the
// annotations below resolve.
import type * as Three from 'three'

type ThreeModule = typeof import('three')
type Material = Three.Material
type ShaderMaterial = Three.ShaderMaterial

export interface ViewerOptions {
  theme?: WorldTheme
  /** Metres per terrain mesh segment. Smaller is more detailed and slower. */
  segmentSize?: number
  /** Animate the water and clouds. Off by default: renders should be stable. */
  animate?: boolean
  fovY?: number
  near?: number
  far?: number
}

export interface Viewer {
  dispose(): void
  readonly world: World
  /** Frame rate, averaged over the last second. */
  readonly fps: number
}

const DEFAULT_SEGMENT_SIZE = 6
const MAX_SEGMENTS = 768

export const createViewer = async (
  container: HTMLElement,
  world: World,
  options: ViewerOptions = {},
): Promise<Viewer> => {
  const THREE: ThreeModule = await import('three')
  const theme = options.theme ?? world.theme
  const field = world.terrain

  const width = container.clientWidth || 1280
  const height = container.clientHeight || 720

  // Every GPU resource is registered here as it is created. Collecting them in
  // one place keeps teardown correct and free of nullable bookkeeping.
  const disposables: Array<{ dispose(): void }> = []

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(
    options.fovY ?? 55,
    width / height,
    options.near ?? 1,
    options.far ?? field.size * 8,
  )

  // --- terrain ------------------------------------------------------------
  const segments = Math.max(2, Math.min(MAX_SEGMENTS, Math.round(field.size / (options.segmentSize ?? DEFAULT_SEGMENT_SIZE))))
  const buffers = buildTerrainBuffers(field, segments)
  const summary = describeScene(world, buffers.vertexCount)

  const geometry = new THREE.PlaneGeometry(field.size, field.size, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3))
  geometry.computeBoundingSphere()

  const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })
  disposables.push(geometry, terrainMaterial)
  const terrainMesh = new THREE.Mesh(geometry, terrainMaterial)
  terrainMesh.name = 'terrain'
  terrainMesh.receiveShadow = true
  scene.add(terrainMesh)

  // --- water --------------------------------------------------------------
  let waterMesh: Three.Mesh | null = null
  if (field.hasWater) {
    const waterGeometry = new THREE.PlaneGeometry(field.size * 4, field.size * 4, 1, 1)
    waterGeometry.rotateX(-Math.PI / 2)
    const waterMaterial = new THREE.MeshPhongMaterial({
      color: new THREE.Color(theme.water.deepColor),
      transparent: true,
      opacity: 0.85,
      shininess: 160,
      specular: new THREE.Color(0xffffff),
      depthWrite: false,
    })
    disposables.push(waterGeometry, waterMaterial)
    waterMesh = new THREE.Mesh(waterGeometry, waterMaterial)
    waterMesh.position.y = field.waterLevel
    waterMesh.renderOrder = 1
    waterMesh.name = 'water'
    scene.add(waterMesh)
  }

  // --- clouds -------------------------------------------------------------
  let cloudMesh: Three.Mesh | null = null
  if (theme.cloud.enabled) {
    const cloudGeometry = new THREE.PlaneGeometry(field.size * 6, field.size * 6, 1, 1)
    cloudGeometry.rotateX(-Math.PI / 2)
    const cloudMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCoverage: { value: theme.cloud.coverage },
        uFeatureSize: { value: theme.cloud.featureSize },
        uColor: { value: new THREE.Color(theme.cloud.litColor) },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vWorld;
        uniform float uTime;
        uniform float uCoverage;
        uniform float uFeatureSize;
        uniform vec3 uColor;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                         mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                         mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) {
          float sum = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 5; i++) {
            sum += amp * noise(p);
            p *= 2.07;
            amp *= 0.52;
          }
          return sum;
        }

        void main() {
          // The same coverage threshold the CPU cloud pass uses, so the two
          // renderers show roughly the same amount of sky.
          vec3 q = vWorld / uFeatureSize + vec3(uTime * 0.004, 0.0, 0.0);
          float d = fbm(q);
          float a = smoothstep(1.0 - uCoverage, 1.0 - uCoverage + 0.22, d);
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a * 0.82);
        }
      `,
    })
    disposables.push(cloudGeometry, cloudMaterial)
    cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial)
    cloudMesh.position.y = summary.cloudAltitude
    cloudMesh.renderOrder = 2
    cloudMesh.name = 'clouds'
    scene.add(cloudMesh)
  }

  // --- light --------------------------------------------------------------
  const light = world.light
  const sun = new THREE.DirectionalLight(
    new THREE.Color(theme.lighting.sunColor),
    light.sunIntensity,
  )
  sun.position
    .set(light.direction.x, light.direction.y, light.direction.z)
    .normalize()
    .multiplyScalar(field.size * 2)
  sun.castShadow = theme.lighting.shadows.enabled
  sun.shadow.mapSize.set(2048, 2048)
  const extent = field.size * 0.6
  sun.shadow.camera.left = -extent
  sun.shadow.camera.right = extent
  sun.shadow.camera.top = extent
  sun.shadow.camera.bottom = -extent
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = field.size * 5
  sun.shadow.bias = -0.0008
  scene.add(sun)
  scene.add(sun.target)

  scene.add(
    new THREE.HemisphereLight(
      new THREE.Color(theme.lighting.ambientSkyColor),
      new THREE.Color(theme.lighting.ambientGroundColor),
      light.ambientIntensity * 2,
    ),
  )

  // --- sky ----------------------------------------------------------------
  const skyGeometry = new THREE.SphereGeometry(field.size * 8, 32, 20)
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Vector3(...summary.skyZenith) },
      uHorizon: { value: new THREE.Vector3(...summary.skyHorizon) },
      uSunDirection: { value: new THREE.Vector3(light.direction.x, light.direction.y, light.direction.z) },
      uSunColor: { value: new THREE.Vector3(...summary.sunColor) },
      uSunIntensity: { value: light.sunIntensity * 0.22 },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vDirection;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform float uSunIntensity;
      void main() {
        // Mirrors skyRadiance in the CPU renderer: a two colour vertical
        // gradient plus a broad and a tight scattering lobe.
        float up = clamp(vDirection.y, 0.0, 1.0);
        vec3 color = mix(uZenith, uHorizon, pow(1.0 - up, 4.0));
        float s = max(dot(normalize(vDirection), uSunDirection), 0.0);
        color += uSunColor * (pow(s, 2.2) * 0.5 + pow(s, 24.0) * 0.8) * uSunIntensity;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  disposables.push(skyGeometry, skyMaterial)
  const sky = new THREE.Mesh(skyGeometry, skyMaterial)
  sky.name = 'sky'
  scene.add(sky)

  // --- renderer -----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  disposables.push(renderer)
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio ?? 1))
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = theme.lighting.shadows.enabled
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = theme.rendering.exposure
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  // --- orbit controls -----------------------------------------------------
  // Hand rolled. three's OrbitControls lives in the addons path, which needs
  // an import map or a bundler alias; this keeps the viewer buildable with
  // nothing but a bundler.
  const orbit = {
    targetX: 0,
    targetY: (field.minHeight + field.maxHeight) * 0.35,
    targetZ: 0,
    distance: field.size * 0.5,
    azimuth: 0.9,
    polar: 1.02,
  }

  const applyCamera = (): void => {
    const sinPolar = Math.sin(orbit.polar)
    camera.position.set(
      orbit.targetX + orbit.distance * sinPolar * Math.cos(orbit.azimuth),
      orbit.targetY + orbit.distance * Math.cos(orbit.polar),
      orbit.targetZ + orbit.distance * sinPolar * Math.sin(orbit.azimuth),
    )
    camera.lookAt(orbit.targetX, orbit.targetY, orbit.targetZ)
  }
  applyCamera()

  let dragging = false
  let lastX = 0
  let lastY = 0

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true
    lastX = event.clientX
    lastY = event.clientY
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return
    orbit.azimuth -= (event.clientX - lastX) * 0.005
    orbit.polar = Math.max(
      0.05,
      Math.min(Math.PI * 0.49, orbit.polar - (event.clientY - lastY) * 0.005),
    )
    lastX = event.clientX
    lastY = event.clientY
    applyCamera()
  }
  const onPointerUp = (): void => {
    dragging = false
  }
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const factor = 1 + Math.sign(event.deltaY) * 0.1
    orbit.distance = Math.max(20, Math.min(field.size * 5, orbit.distance * factor))
    applyCamera()
  }
  const onKey = (event: KeyboardEvent): void => {
    const step = field.size * 0.08
    switch (event.key) {
      case 'w':
      case 'W':
        orbit.targetZ -= step
        break
      case 's':
      case 'S':
        orbit.targetZ += step
        break
      case 'a':
      case 'A':
        orbit.targetX -= step
        break
      case 'd':
      case 'D':
        orbit.targetX += step
        break
      default:
        return
    }
    applyCamera()
  }
  const onResize = (): void => {
    const w = container.clientWidth || width
    const h = container.clientHeight || height
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }

  const domElement = renderer.domElement
  domElement.style.touchAction = 'none'
  domElement.style.cursor = 'grab'
  domElement.addEventListener('pointerdown', onPointerDown)
  globalThis.addEventListener('pointermove', onPointerMove)
  globalThis.addEventListener('pointerup', onPointerUp)
  globalThis.addEventListener('keydown', onKey)
  domElement.addEventListener('wheel', onWheel, { passive: false })
  globalThis.addEventListener('resize', onResize)

  // --- loop ---------------------------------------------------------------
  const clock = { last: performance.now(), elapsed: 0 }
  const perf = { frames: 0, accumulated: 0, fps: 0 }
  let frame = 0
  let disposed = false

  const tick = (): void => {
    if (disposed) return
    frame = requestAnimationFrame(tick)

    const now = performance.now()
    const delta = (now - clock.last) / 1000
    clock.last = now
    if (options.animate) clock.elapsed += delta

    perf.frames += 1
    perf.accumulated += delta
    if (perf.accumulated >= 0.5) {
      perf.fps = perf.frames / perf.accumulated
      perf.frames = 0
      perf.accumulated = 0
    }

    // Keep the sky and the cloud layer centred on the camera so neither ever
    // runs out at the horizon.
    sky.position.copy(camera.position)
    if (cloudMesh) {
      cloudMesh.position.x = camera.position.x
      cloudMesh.position.z = camera.position.z
      ;(cloudMesh.material as ShaderMaterial).uniforms.uTime.value = clock.elapsed
    }

    renderer.render(scene, camera)
  }
  tick()

  return {
    world,
    get fps() {
      return perf.fps
    },
    dispose: () => {
      disposed = true
      cancelAnimationFrame(frame)
      domElement.removeEventListener('pointerdown', onPointerDown)
      globalThis.removeEventListener('pointermove', onPointerMove)
      globalThis.removeEventListener('pointerup', onPointerUp)
      globalThis.removeEventListener('keydown', onKey)
      domElement.removeEventListener('wheel', onWheel)
      globalThis.removeEventListener('resize', onResize)
      for (const resource of disposables) resource.dispose()
      domElement.remove()
    },
  }
}
