import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import GUI from 'lil-gui'
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  DepthOfFieldEffect,
  VignetteEffect,
  NoiseEffect,
  HueSaturationEffect,
  BrightnessContrastEffect,
  ToneMappingEffect,
  ToneMappingMode,
  Effect,
  BlendFunction,
} from 'postprocessing'
import { Terrain } from './terrain.js'
import { createLabels, disposeLabels } from './labels.js'
import { createHud3D, findPois } from './hud3d.js'
import { createHud2D } from './hud2d.js'
import { loadDem } from './dem.js'
import { TerrainEditor } from './editor/terrainEditor.js'

// ------------------------------------------------------------------ params

const DEM_PRESETS = {
  'Monument Valley': [36.998, -110.0984],
  'Grand Canyon': [36.0997, -112.1124],
  Matterhorn: [45.9766, 7.6585],
  'Mount Fuji': [35.3606, 138.7274],
  'Death Valley': [36.2679, -116.8253],
  'Everest Massif': [27.9881, 86.925],
  Landmannalaugar: [63.983, -19.056],
  Custom: null,
}

const params = {
  // terrain source
  source: 'real',
  demLocation: 'Monument Valley',
  demLat: 36.998,
  demLon: -110.0984,
  demZoom: 12,
  demExaggeration: 1.6,

  // terrain generation
  seed: 7,
  scale: 0.055,
  octaves: 6,
  lacunarity: 2.2,
  gain: 0.55,
  amplitude: 1.8,
  warp: 2.0,
  detail: 0.0,
  detailScale: 1.9,
  resolution: 1024,

  // surface material
  color: '#c2c2c2',
  roughness: 1.0,
  roughnessVariation: 0.5,
  roughnessScale: 1,
  bumpScale: 0.2,
  envMapIntensity: 1.5,

  // camera & depth of field
  fov: 43,
  autoFocus: true,
  focusDistance: 24.74,
  focusRange: 25,
  bokehScale: 0,

  // map overlay
  mapTint: 1.0,
  heightContrast: 5.1,
  heightPivot: 0.53,
  gradLow: '#ffffff',
  gradMid1: '#ffffff',
  gradMid2: '#ffffff',
  gradHigh: '#ffa861',
  gradMid1Pos: 0.35,
  gradMid2Pos: 0.36,
  slopeTint: 0.5,
  contourInterval: 0.11,
  contourOpacity: 1,
  contourColor: '#000000',
  gridStep: 5,
  gridOpacity: 1,
  labels: false,

  // HUD
  hud: true,
  hudOpacity: 1,
  uiBlur: 9,
  uiBgOpacity: 0.4,
  hudAccent: '#ff4d00',
  hudInk: '#17191b',
  sweepSpeed: 2.5,
  scanColor: '#ccd6ff',
  scanDuration: 4.6,
  scanWidth: 0.8,
  scanBlur: 0.86,
  scanDispHeight: 1.16,
  scanDispFalloff: 1.2,

  // look
  exposure: 0.96,
  contrast: 0.07,
  saturation: -0.35,
  vignette: 0.6,
  grain: 0.35,
  surveyLines: true,

  // motion
  ringSpeed: 1.0,
  flyDuration: 1.8,
  flyEasing: 'smooth',
  paused: false,

  // tour
  tourFrom: 'PK-01',
  tourTo: 'PK-02',
  tourDuration: 14,
  tourAltitude: 2.5,
  tourSmoothing: 0.7,
  tourLook: 0.1,
  tourBank: 0.8,

  // performance
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  shadowMode: 'static',
  shadowRes: 2048,

  // light
  sunIntensity: 8.3,
  sunAzimuth: 64,
  sunElevation: 19,
  hemiIntensity: 0.0,
  envLight: 0.3,
  shadowSoftness: 15,
}

// ------------------------------------------------------------------ renderer / scene

const container = document.getElementById('app')
const loadingEl = document.getElementById('loading')

const renderer = new THREE.WebGLRenderer({
  powerPreference: 'high-performance',
  antialias: false, // SMAA runs in the post chain
  stencil: false,
  depth: false,
})
renderer.setPixelRatio(params.pixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
// VSM so the shadow blur radius is a real, adjustable softness control
renderer.shadowMap.type = THREE.VSMShadowMap
// tone mapping happens in the post chain (three skips renderer tone mapping
// when drawing into the composer's HDR buffer, which is why exposure felt dead)
renderer.toneMapping = THREE.NoToneMapping
container.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xffffff)

const camera = new THREE.PerspectiveCamera(params.fov, window.innerWidth / window.innerHeight, 0.5, 220)
camera.position.set(0, 18, 19)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, -0.3, 0)
controls.enableDamping = true
controls.dampingFactor = 0.06
controls.maxPolarAngle = Math.PI * 0.49
controls.minDistance = 6
controls.maxDistance = 60
controls.update()

// image-based lighting for believable PBR speculars
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = params.envLight
pmrem.dispose()

// ------------------------------------------------------------------ lights

const sun = new THREE.DirectionalLight(0xffffff, params.sunIntensity)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -26
sun.shadow.camera.right = 26
sun.shadow.camera.top = 26
sun.shadow.camera.bottom = -26
sun.shadow.camera.near = 4
sun.shadow.camera.far = 80
sun.shadow.bias = -0.0001
sun.shadow.normalBias = 0.02
sun.shadow.radius = params.shadowSoftness
sun.shadow.blurSamples = 16
scene.add(sun)

const hemi = new THREE.HemisphereLight(0xdadada, 0x5c5c5c, params.hemiIntensity)
scene.add(hemi)

function placeSun() {
  const az = THREE.MathUtils.degToRad(params.sunAzimuth)
  const el = THREE.MathUtils.degToRad(params.sunElevation)
  const r = 34
  sun.position.set(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r)
  sun.intensity = params.sunIntensity
  hemi.intensity = params.hemiIntensity
  if (params.shadowMode === 'static') renderer.shadowMap.needsUpdate = true
}
placeSun()

function applyShadowMode() {
  sun.castShadow = params.shadowMode !== 'off'
  renderer.shadowMap.autoUpdate = params.shadowMode === 'dynamic'
  if (params.shadowMode === 'static') renderer.shadowMap.needsUpdate = true
}
applyShadowMode()

// ------------------------------------------------------------------ world

let gui = null

const terrain = new Terrain(params)
scene.add(terrain.mesh)

function applyTerrainPreset(preset) {
  Object.assign(params, preset)
  terrain.setDem(null)
  terrain.rebuild(params)
  terrain.rebuildRoughness(params)
  terrain.updateMaterial(params)
  terrain.rebuildRamp(params)
  terrain.mapUniforms.uTint.value = params.mapTint
  terrain.mapUniforms.uContourInterval.value = params.contourInterval
  terrain.mapUniforms.uContourOpacity.value = params.contourOpacity
  terrain.mapUniforms.uGridStep.value = params.gridStep
  terrain.mapUniforms.uGridOpacity.value = params.gridOpacity
  terrain.mapUniforms.uHeightContrast.value = params.heightContrast
  terrain.mapUniforms.uHeightPivot.value = params.heightPivot
  terrain.mapUniforms.uSlopeTint.value = params.slopeTint
  terrain.mapUniforms.uContourColor.value.set(params.contourColor)
  placeSun()
  applyShadowMode()
  gui?.controllersRecursive().forEach((controller) => controller.updateDisplay())
}

const editor = new TerrainEditor({
  scene,
  camera,
  renderer,
  controls,
  terrain,
  params,
  onTerrainPreset: applyTerrainPreset,
})

const labelOpts = () => ({ real: params.source === 'real', toFeet: (h) => terrain.heightToFeet(h) })
let labels = createLabels(terrain.sample, params.seed, labelOpts())
labels.visible = params.labels
scene.add(labels)

function regenerateLabels() {
  scene.remove(labels)
  disposeLabels(labels)
  labels = createLabels(terrain.sample, params.seed, labelOpts())
  labels.visible = params.labels
  scene.add(labels)
}

// ------------------------------------------------------------------ HUD + interactivity

const HOME = { pos: new THREE.Vector3(0, 18, 19), target: new THREE.Vector3(0, -0.3, 0) }
const EASINGS = {
  smooth: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), // cubic in-out
  glide: (t) => 1 - Math.pow(1 - t, 5), // quintic out
  linear: (t) => t,
}
const tween = {
  active: false,
  t: 0,
  p0: new THREE.Vector3(),
  p1: new THREE.Vector3(),
  t0: new THREE.Vector3(),
  t1: new THREE.Vector3(),
}
let selectedPoi = -1
let fps = 60
let scanStart = -1

const poiFeet = (h) => terrain.heightToFeet(h)
let pois = findPois(terrain.sample, params.seed, poiFeet)
let hud3 = createHud3D(params.seed, pois, { ink: params.hudInk, accent: params.hudAccent })
hud3.lines.visible = params.surveyLines
scene.add(hud3.group)

function flyTo(pos, target) {
  tween.p0.copy(camera.position)
  tween.t0.copy(controls.target)
  tween.p1.copy(pos)
  tween.t1.copy(target)
  tween.t = 0
  tween.active = true
}

// pose to restore when a selection is closed: wherever the camera was pre-click
const returnPose = { saved: false, pos: new THREE.Vector3(), target: new THREE.Vector3() }

// ------------------------------------------------------------------ tour mode

// One continuous Catmull-Rom spline: current camera pose → above the FROM poi →
// arc across the terrain → standoff short of the TO poi. Sampled by ARC LENGTH
// (uniform speed), driven by a trapezoidal velocity profile, with all rotation
// going through a damped "gimbal" controller so snaps are impossible.

const TOUR_N = 240
const tour = {
  active: false,
  t: 0,
  bank: 0,
  uA: 0.2, // arc-length fraction where the path passes over the FROM poi
  curve: null,
  aTop: new THREE.Vector3(),
  bTop: new THREE.Vector3(),
}
const _tp = new THREE.Vector3()
const _tg = new THREE.Vector3()
const _tt0 = new THREE.Vector3()
const _tt1 = new THREE.Vector3()
const _tm = new THREE.Matrix4()
const _tq = new THREE.Quaternion()
const _tqr = new THREE.Quaternion()
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const UP = new THREE.Vector3(0, 1, 0)

function boxBlur(arr, radius, passes = 1) {
  let a = arr
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(a.length)
    for (let i = 0; i < a.length; i++) {
      let s = 0
      let c = 0
      for (let j = Math.max(0, i - radius); j <= Math.min(a.length - 1, i + radius); j++) {
        s += a[j]
        c++
      }
      out[i] = s / c
    }
    a = out
  }
  return a
}

// trapezoidal velocity: accelerate → cruise at constant speed → decelerate
function trapezoid(t, r) {
  t = THREE.MathUtils.clamp(t, 0, 1)
  if (t < r) return (t * t) / (2 * r * (1 - r))
  if (t > 1 - r) {
    const u = 1 - t
    return 1 - (u * u) / (2 * r * (1 - r))
  }
  return (t - r / 2) / (1 - r)
}

function startTour() {
  const A = pois.find((p) => p.id === params.tourFrom)
  const B = pois.find((p) => p.id === params.tourTo)
  if (!A || !B || A === B) return

  // ground path A → standoff short of B (ending on B itself would degenerate
  // to a vertical view), arced sideways for a more interesting line
  const a = new THREE.Vector3(A.x, 0, A.z)
  const bFull = new THREE.Vector3(B.x, 0, B.z)
  const dist = a.distanceTo(bFull)
  const dirAB = bFull.clone().sub(a).normalize()
  const b = bFull.clone().addScaledVector(dirAB, -Math.min(7, dist * 0.4))
  const mid = a.clone().add(b).multiplyScalar(0.5)
  mid.addScaledVector(new THREE.Vector3(-dirAB.z, 0, dirAB.x), dist * 0.22)

  const px = new Float32Array(TOUR_N)
  const pz = new Float32Array(TOUR_N)
  const ground = new Float32Array(TOUR_N)
  for (let i = 0; i < TOUR_N; i++) {
    const t = i / (TOUR_N - 1)
    const u = 1 - t
    px[i] = u * u * a.x + 2 * u * t * mid.x + t * t * b.x
    pz[i] = u * u * a.z + 2 * u * t * mid.z + t * t * b.z
    ground[i] = terrain.sample(px[i], pz[i])
  }

  // altitude: clearance envelope (rolling max) blurred hard — rises over
  // mountains as one long swell, never tracks bumps
  const radius = Math.round(4 + params.tourSmoothing * 30)
  const envelope = new Float32Array(TOUR_N)
  for (let i = 0; i < TOUR_N; i++) {
    let m = -Infinity
    for (let j = Math.max(0, i - radius); j <= Math.min(TOUR_N - 1, i + radius); j++) m = Math.max(m, ground[j])
    envelope[i] = m
  }
  const smoothY = boxBlur(envelope, radius, 3)

  // one continuous spline starting at the CURRENT camera position — the
  // approach is just the first leg of the same flight, no phase transition
  const pts = [camera.position.clone()]
  for (let i = 0; i < TOUR_N; i += 20) pts.push(new THREE.Vector3(px[i], smoothY[i] + params.tourAltitude, pz[i]))
  pts.push(new THREE.Vector3(px[TOUR_N - 1], smoothY[TOUR_N - 1] + params.tourAltitude, pz[TOUR_N - 1]))
  tour.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5)
  tour.curve.arcLengthDivisions = 400
  tour.curve.updateArcLengths()

  // arc-length fraction where we pass over the FROM poi (gaze switches there)
  let bestD = Infinity
  for (let i = 0; i <= 200; i++) {
    const s = i / 200
    tour.curve.getPointAt(s, _tp)
    const d = Math.hypot(_tp.x - A.x, _tp.z - A.z)
    if (d < bestD) {
      bestD = d
      tour.uA = s
    }
  }

  tour.aTop.set(A.x, A.h + 0.6, A.z)
  tour.bTop.set(B.x, B.h + 0.6, B.z)
  tour.bank = 0
  tour.t = 0
  tour.active = true
  tween.active = false
}

// gaze target along the flight: frame the FROM poi on approach, then look
// ahead down the path, converging onto the TO poi at the end
function tourGaze(s, camPos, out) {
  const ahead = Math.min(s + params.tourLook, 1)
  tour.curve.getPointAt(ahead, out)
  out.y -= params.tourAltitude * 0.7 // gaze slightly below the flight line
  // hand the gaze off BEFORE we're overhead the FROM poi — looking straight
  // down while passing over it flips the heading violently
  const fromBlend = THREE.MathUtils.smoothstep(s, tour.uA * 0.15, tour.uA * 0.75)
  out.lerp(tour.aTop, 1 - fromBlend)
  out.lerp(tour.bTop, THREE.MathUtils.smoothstep(s, 0.85, 1))

  // pitch clamp: never look down steeper than ~72°, pushing the gaze point
  // forward instead — guards against gimbal flips in every configuration
  const dx = out.x - camPos.x
  const dz = out.z - camPos.z
  const horiz = Math.hypot(dx, dz)
  const drop = camPos.y - out.y
  const minHoriz = drop * 0.33
  if (drop > 0 && horiz < minHoriz) {
    if (horiz > 1e-4) {
      const k = minHoriz / horiz
      out.x = camPos.x + dx * k
      out.z = camPos.z + dz * k
    } else {
      tour.curve.getTangentAt(s, _tt0)
      out.x = camPos.x + _tt0.x * minHoriz
      out.z = camPos.z + _tt0.z * minHoriz
    }
  }
  return out
}

const hud2 = createHud2D({
  onSelectPoi(i) {
    if (selectedPoi === -1) {
      returnPose.pos.copy(camera.position)
      returnPose.target.copy(controls.target)
      returnPose.saved = true
    }
    selectedPoi = i
    const p = pois[i]
    hud2.setSelected(i, p)
    const dir = new THREE.Vector3(p.x, 0, p.z).normalize()
    flyTo(new THREE.Vector3(p.x + dir.x * 6.5, p.h + 4.2, p.z + dir.z * 6.5), new THREE.Vector3(p.x, p.h + 0.6, p.z))
  },
  onDeselect() {
    selectedPoi = -1
    hud2.setSelected(-1, null)
    flyTo(returnPose.saved ? returnPose.pos : HOME.pos, returnPose.saved ? returnPose.target : HOME.target)
    returnPose.saved = false
  },
})
hud2.setPois(pois)
hud2.setStatic(params)
hud2.setVisible(params.hud)
hud2.setOpacity(params.hudOpacity)
hud2.root.remove()
document.documentElement.style.setProperty('--hud-accent', params.hudAccent)
document.documentElement.style.setProperty('--hud-ink', params.hudInk)
document.documentElement.style.setProperty('--hud-blur', `${params.uiBlur}px`)
document.documentElement.style.setProperty('--hud-bg-alpha', params.uiBgOpacity)

// user grabbing the camera cancels any fly-to or tour
controls.addEventListener('start', () => {
  tween.active = false
  tour.active = false
  camera.up.set(0, 1, 0)
})

// synthetic terrain keeps the fictional dial platform; real DEMs do not
function applySourceMode() {
  hud3.platform.visible = params.source !== 'real'
}

function regenerateHud() {
  scene.remove(hud3.group)
  hud3.dispose()
  pois = findPois(terrain.sample, params.seed, poiFeet)
  hud3 = createHud3D(params.seed, pois, { ink: params.hudInk, accent: params.hudAccent })
  hud3.lines.visible = params.surveyLines
  scene.add(hud3.group)
  hud2.setPois(pois)
  hud2.setStatic(params)
  selectedPoi = -1
  hud2.setSelected(-1, null)
  applySourceMode()
}
applySourceMode()

// ------------------------------------------------------------------ post: real depth-based DOF

const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
composer.addPass(new RenderPass(scene, camera))

const dof = new DepthOfFieldEffect(camera, {
  focusDistance: 0.02,
  focalLength: 0.06,
  bokehScale: params.bokehScale,
  height: 720,
})
// drive the circle-of-confusion in world units so focus params are intuitive
dof.cocMaterial.worldFocusDistance = params.focusDistance
dof.cocMaterial.worldFocusRange = params.focusRange

// pre-tonemap exposure multiplier, operating on the HDR buffer
class ExposureEffect extends Effect {
  constructor(exposure) {
    super(
      'ExposureEffect',
      'uniform float exposure; void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb * exposure, inputColor.a); }',
      { uniforms: new Map([['exposure', new THREE.Uniform(exposure)]]) }
    )
  }
}

const exposureFx = new ExposureEffect(params.exposure)
const toneMap = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
const contrastFx = new BrightnessContrastEffect({ brightness: 0, contrast: params.contrast })
const hueSat = new HueSaturationEffect({ saturation: params.saturation })
const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false })
grain.blendMode.opacity.value = params.grain
const vignette = new VignetteEffect({ darkness: params.vignette, offset: 0.28 })

const dofPass = new EffectPass(camera, dof)
const finalPostPass = new EffectPass(camera, exposureFx, toneMap, hueSat, contrastFx, grain, vignette)
composer.addPass(finalPostPass)
// DepthOfFieldEffect requires a depth texture. Keep its pass out of the composer
// while bokeh is zero so the renderer doesn't blit depth every frame for a disabled effect.
let dofPassActive = false
function setDofEnabled(enabled) {
  if (enabled === dofPassActive) return
  if (enabled) {
    const finalIndex = composer.passes.indexOf(finalPostPass)
    composer.addPass(dofPass, finalIndex >= 0 ? finalIndex : undefined)
  } else {
    composer.removePass(dofPass)
  }
  dofPassActive = enabled
}
setDofEnabled(params.bokehScale > 0)

// ------------------------------------------------------------------ regeneration helpers

// ------------------------------------------------------------------ real-world DEM loading

let dem = null
let demBusy = false
async function loadRealTerrain() {
  if (demBusy) return
  demBusy = true
  loadingEl.textContent = '正在获取高程瓦片…'
  loadingEl.classList.remove('hidden')
  try {
    dem = await loadDem({ lat: params.demLat, lon: params.demLon, zoom: params.demZoom })
    terrain.setDem(dem)
    params.source = 'real'
    gui.controllersRecursive().forEach((c) => c.updateDisplay())
    loadingEl.textContent = '正在生成地形…'
    regenerateTerrain()
  } catch (err) {
    console.error('DEM load failed:', err)
    loadingEl.textContent = '高程获取失败，请检查网络连接'
    setTimeout(() => {
      loadingEl.classList.add('hidden')
      loadingEl.textContent = '正在生成地形…'
    }, 2600)
  } finally {
    demBusy = false
  }
}

let rebuildPending = false
function regenerateTerrain() {
  if (rebuildPending) return
  rebuildPending = true
  loadingEl.classList.remove('hidden')
  // let the indicator paint before the synchronous rebuild blocks the thread
  requestAnimationFrame(() =>
    setTimeout(() => {
      terrain.rebuild(params)
      terrain.rebuildRoughness(params)
      editor.setBaseSampler(terrain.sample)
      regenerateLabels()
      regenerateHud()
      if (params.shadowMode === 'static') renderer.shadowMap.needsUpdate = true
      rebuildPending = false
      loadingEl.classList.add('hidden')
    }, 30)
  )
}

// ------------------------------------------------------------------ GUI

gui = new GUI({ title: '实验 / 001' })

const copyCtrl = gui
  .add(
    {
      async copy() {
        const json = JSON.stringify(params, null, 2)
        try {
          await navigator.clipboard.writeText(json)
        } catch {
          const ta = document.createElement('textarea')
          ta.value = json
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          ta.remove()
        }
        copyCtrl.name('已复制 ✓')
        setTimeout(() => copyCtrl.name('复制参数'), 1200)
      },
    },
    'copy'
  )
  .name('复制参数')

const fSource = gui.addFolder('地形来源')
fSource
  .add(params, 'source', { '程序噪声': 'noise', '真实世界（DEM）': 'real' })
  .name('来源')
  .onChange((v) => {
    if (v === 'real') loadRealTerrain()
    else regenerateTerrain()
  })
const latCtrl = { lat: null, lon: null }
fSource
  .add(params, 'demLocation', Object.keys(DEM_PRESETS))
  .name('地点')
  .onChange((name) => {
    const p = DEM_PRESETS[name]
    if (!p) return // Custom: use the lat/lon fields below
    params.demLat = p[0]
    params.demLon = p[1]
    latCtrl.lat.updateDisplay()
    latCtrl.lon.updateDisplay()
    if (params.source === 'real') loadRealTerrain()
  })
latCtrl.lat = fSource.add(params, 'demLat', -85, 85, 0.0001).name('纬度')
latCtrl.lon = fSource.add(params, 'demLon', -180, 180, 0.0001).name('经度')
fSource
  .add(params, 'demZoom', [10, 11, 12, 13, 14])
  .name('细节（缩放）')
  .onChange(() => {
    if (params.source === 'real') loadRealTerrain()
  })
fSource
  .add(params, 'demExaggeration', 0.5, 5, 0.1)
  .name('垂直夸张')
  .onFinishChange(() => {
    if (params.source === 'real') regenerateTerrain()
  })
fSource.add({ load: () => loadRealTerrain() }, 'load').name('加载地点 ⤓')

const fTerrain = gui.addFolder('地形')
fTerrain.add(params, 'seed', 1, 9999, 1).onFinishChange(regenerateTerrain)
fTerrain
  .add(
    {
      randomize() {
        editor.generateFromSeed(Math.floor(Math.random() * 999999) + 1)
      },
    },
    'randomize'
  )
  .name('随机种子')
fTerrain.add(params, 'scale', 0.04, 0.4, 0.005).onFinishChange(regenerateTerrain)
fTerrain.add(params, 'octaves', 2, 8, 1).onFinishChange(regenerateTerrain)
fTerrain.add(params, 'lacunarity', 1.6, 3.2, 0.05).onFinishChange(regenerateTerrain)
fTerrain.add(params, 'gain', 0.3, 0.7, 0.01).onFinishChange(regenerateTerrain)
fTerrain.add(params, 'amplitude', 0.5, 7, 0.1).onFinishChange(regenerateTerrain)
fTerrain.add(params, 'warp', 0, 6, 0.1).name('域扭曲').onFinishChange(regenerateTerrain)
fTerrain.add(params, 'detail', 0, 0.8, 0.01).name('细节噪声').onFinishChange(regenerateTerrain)
fTerrain.add(params, 'detailScale', 0.5, 6, 0.1).onFinishChange(regenerateTerrain)
fTerrain.add(params, 'resolution', [256, 384, 512, 768, 1024]).onFinishChange(regenerateTerrain)

const fSurface = gui.addFolder('表面材质')
fSurface.addColor(params, 'color').name('颜色').onChange(() => terrain.updateMaterial(params))
fSurface.add(params, 'roughness', 0, 1, 0.01).name('粗糙度').onFinishChange(() => terrain.rebuildRoughness(params))
fSurface
  .add(params, 'roughnessVariation', 0, 0.6, 0.01)
  .name('粗糙度噪声')
  .onFinishChange(() => terrain.rebuildRoughness(params))
fSurface
  .add(params, 'roughnessScale', 1, 16, 0.5)
  .name('粗糙度尺度')
  .onFinishChange(() => terrain.rebuildRoughness(params))
fSurface.add(params, 'bumpScale', 0, 2, 0.05).name('微表面凹凸').onChange(() => terrain.updateMaterial(params))
fSurface.add(params, 'envMapIntensity', 0, 1.5, 0.05).name('环境反射').onChange(() => terrain.updateMaterial(params))

const fCamera = gui.addFolder('相机与焦点')
fCamera.add(params, 'fov', 20, 60, 1).onChange((v) => {
  camera.fov = v
  camera.updateProjectionMatrix()
})
fCamera.add(params, 'autoFocus').name('自动对焦地形中心')
fCamera.add(params, 'focusDistance', 5, 60, 0.1).name('焦点距离').listen()
fCamera.add(params, 'focusRange', 0.5, 25, 0.1).name('焦点范围').onChange((v) => {
  dof.cocMaterial.worldFocusRange = v
})
fCamera.add(params, 'bokehScale', 0, 8, 0.1).name('散景强度').onChange((v) => {
  dof.bokehScale = v
  setDofEnabled(v > 0)
})

const fMap = gui.addFolder('地图叠加')
fMap.add(params, 'mapTint', 0, 1, 0.02).name('高程着色').onChange((v) => (terrain.mapUniforms.uTint.value = v))
fMap
  .add(params, 'heightContrast', 0.5, 20, 0.1)
  .name('高度对比度')
  .onChange((v) => (terrain.mapUniforms.uHeightContrast.value = v))
fMap
  .add(params, 'heightPivot', 0, 1, 0.01)
  .name('高度中心')
  .onChange((v) => (terrain.mapUniforms.uHeightPivot.value = v))
const rebuildRamp = () => terrain.rebuildRamp(params)
fMap.addColor(params, 'gradLow').name('渐变：低').onChange(rebuildRamp)
fMap.addColor(params, 'gradMid1').name('渐变：中低').onChange(rebuildRamp)
fMap.addColor(params, 'gradMid2').name('渐变：中高').onChange(rebuildRamp)
fMap.addColor(params, 'gradHigh').name('渐变：高').onChange(rebuildRamp)
fMap.add(params, 'gradMid1Pos', 0, 1, 0.01).name('中低位置').onChange(rebuildRamp)
fMap.add(params, 'gradMid2Pos', 0, 1, 0.01).name('中高位置').onChange(rebuildRamp)
fMap
  .add(params, 'slopeTint', 0, 1, 0.02)
  .name('坡面棕色')
  .onChange((v) => (terrain.mapUniforms.uSlopeTint.value = v))
fMap
  .add(params, 'contourInterval', 0.04, 0.6, 0.01)
  .name('等高线间隔')
  .onChange((v) => (terrain.mapUniforms.uContourInterval.value = v))
fMap
  .add(params, 'contourOpacity', 0, 1, 0.02)
  .name('等高线不透明度')
  .onChange((v) => (terrain.mapUniforms.uContourOpacity.value = v))
fMap
  .addColor(params, 'contourColor')
  .name('等高线颜色')
  .onChange((v) => terrain.mapUniforms.uContourColor.value.set(v))
fMap.add(params, 'gridStep', 2, 14, 0.5).name('网格尺寸').onChange((v) => (terrain.mapUniforms.uGridStep.value = v))
fMap.add(params, 'gridOpacity', 0, 1, 0.02).name('网格不透明度').onChange((v) => (terrain.mapUniforms.uGridOpacity.value = v))
fMap.add(params, 'labels').name('地点标签').onChange((v) => (labels.visible = v))

const fLook = gui.addFolder('画面效果')
fLook.add(params, 'exposure', 0.2, 3, 0.02).name('曝光').onChange((v) => (exposureFx.uniforms.get('exposure').value = v))
fLook.add(params, 'contrast', -0.2, 0.5, 0.01).name('对比度').onChange((v) => (contrastFx.uniforms.get('contrast').value = v))
fLook.add(params, 'saturation', -1, 0, 0.02).name('饱和度').onChange((v) => (hueSat.saturation = v))
fLook.add(params, 'vignette', 0, 1, 0.02).name('暗角').onChange((v) => (vignette.darkness = v))
fLook.add(params, 'grain', 0, 0.5, 0.01).name('颗粒').onChange((v) => (grain.blendMode.opacity.value = v))
fLook.add(params, 'surveyLines').name('测绘圆环').onChange((v) => (hud3.lines.visible = v))

const fHud = gui.addFolder('界面 HUD')
fHud.add(params, 'hud').name('显示 HUD').onChange((v) => hud2.setVisible(v))
fHud.add(params, 'hudOpacity', 0, 1, 0.02).name('HUD 不透明度').onChange((v) => hud2.setOpacity(v))
fHud
  .add(params, 'uiBlur', 0, 30, 1)
  .name('面板模糊')
  .onChange((v) => document.documentElement.style.setProperty('--hud-blur', `${v}px`))
fHud
  .add(params, 'uiBgOpacity', 0, 1, 0.02)
  .name('面板背景不透明度')
  .onChange((v) => document.documentElement.style.setProperty('--hud-bg-alpha', v))
fHud
  .addColor(params, 'hudAccent')
  .name('强调色')
  .onChange((v) => {
    document.documentElement.style.setProperty('--hud-accent', v)
    regenerateHud()
  })
fHud
  .addColor(params, 'hudInk')
  .name('墨色')
  .onChange((v) => {
    document.documentElement.style.setProperty('--hud-ink', v)
    regenerateHud()
  })
fHud.add(params, 'sweepSpeed', 0, 3, 0.05).name('扫描速度')
fHud
  .addColor(params, 'scanColor')
  .name('扫描颜色')
  .onChange((v) => terrain.mapUniforms.uScanColor.value.set(v))
fHud.add(params, 'scanDuration', 1, 8, 0.1).name('扫描时长')
fHud
  .add(params, 'scanWidth', 0.05, 4, 0.05)
  .name('扫描宽度')
  .onChange((v) => (terrain.mapUniforms.uScanWidth.value = v))
fHud
  .add(params, 'scanBlur', 0, 3, 0.02)
  .name('扫描模糊')
  .onChange((v) => (terrain.mapUniforms.uScanBlur.value = v))
fHud
  .add(params, 'scanDispHeight', 0, 2, 0.02)
  .name('波峰高度')
  .onChange((v) => (terrain.mapUniforms.uScanDispH.value = v))
fHud
  .add(params, 'scanDispFalloff', 0.1, 6, 0.05)
  .name('波峰衰减')
  .onChange((v) => (terrain.mapUniforms.uScanDispW.value = v))
fHud.add({ scan: () => (scanStart = performance.now() / 1000) }, 'scan').name('触发扫描')

const fMotion = gui.addFolder('动态')
fMotion.add(params, 'ringSpeed', 0, 6, 0.1).name('环速度')
fMotion.add(params, 'flyDuration', 0.4, 4, 0.1).name('飞行时长')
fMotion.add(params, 'flyEasing', ['smooth', 'glide', 'linear']).name('飞行缓动')

const POI_IDS = ['PK-01', 'PK-02', 'PK-03', 'PK-04', 'DEP-05']
const fTour = gui.addFolder('导览')
fTour.add(params, 'tourFrom', POI_IDS).name('起点')
fTour.add(params, 'tourTo', POI_IDS).name('终点')
fTour.add(params, 'tourDuration', 4, 40, 0.5).name('时长（秒）')
fTour.add(params, 'tourAltitude', 0.8, 10, 0.1).name('高度')
fTour.add(params, 'tourSmoothing', 0, 1, 0.02).name('路径平滑')
fTour.add(params, 'tourLook', 0.02, 0.3, 0.01).name('前视距离')
fTour.add(params, 'tourBank', 0, 3, 0.05).name('转弯倾斜')
fTour.add({ start: startTour }, 'start').name('▶ 开始导览')
fTour.add(
  {
    stop: () => {
      tour.active = false
      camera.up.set(0, 1, 0)
    },
  },
  'stop'
).name('■ 停止')

const fPerf = gui.addFolder('性能')
fPerf
  .add(params, 'pixelRatio', 0.5, 2, 0.05)
  .name('渲染比例')
  .onChange((v) => {
    renderer.setPixelRatio(v)
    composer.setSize(window.innerWidth, window.innerHeight)
  })
fPerf.add(params, 'shadowMode', ['dynamic', 'static', 'off']).name('阴影').onChange(applyShadowMode)
fPerf
  .add(params, 'shadowRes', [1024, 2048, 4096])
  .name('阴影分辨率')
  .onChange((v) => {
    sun.shadow.mapSize.set(v, v)
    if (sun.shadow.map) {
      sun.shadow.map.dispose()
      sun.shadow.map = null
    }
    if (params.shadowMode === 'static') renderer.shadowMap.needsUpdate = true
  })
fMotion.add(params, 'paused').name('暂停')

const fLight = gui.addFolder('光照')
fLight.add(params, 'sunIntensity', 0, 16, 0.1).name('太阳强度').onChange(placeSun)
fLight.add(params, 'sunAzimuth', 0, 360, 1).name('太阳方位').onChange(placeSun)
fLight.add(params, 'sunElevation', 5, 85, 1).name('太阳高度').onChange(placeSun)
fLight.add(params, 'hemiIntensity', 0, 2, 0.05).name('环境光').onChange(placeSun)
fLight
  .add(params, 'envLight', 0, 1.5, 0.02)
  .name('环境补光')
  .onChange((v) => (scene.environmentIntensity = v))
fLight
  .add(params, 'shadowSoftness', 0, 30, 0.5)
  .name('阴影柔和度')
  .onChange((v) => (sun.shadow.radius = v))

// only Terrain source and Tour start expanded
fTerrain.close()
fSurface.close()
fCamera.close()
fMap.close()
fLook.close()
fHud.close()
fMotion.close()
fPerf.close()
fLight.close()

// The original inspector is intentionally removed from the first terrain-editor workflow.
// Terrain editing stays focused on the dedicated editor workbench.
gui.domElement.remove()

// ------------------------------------------------------------------ loop

// console access for debugging/scripting
window.__exp = { scene, camera, controls, params, terrain, editor, loadRealTerrain, get labels() { return labels } }

// real world is the default source — fetch its tiles on startup
if (params.source === 'real') loadRealTerrain()

const clock = new THREE.Clock()

function tick() {
  requestAnimationFrame(tick)
  const dt = Math.min(clock.getDelta(), 0.05)
  const t = clock.elapsedTime

  // cinematic tour: arc-length uniform speed + trapezoid profile + damped gimbal
  if (tour.active) {
    tour.t = Math.min(1, tour.t + dt / params.tourDuration)
    const s = trapezoid(tour.t, 0.18)

    // position: exact on the spline, constant speed thanks to getPointAt
    tour.curve.getPointAt(s, _tp)
    camera.position.copy(_tp)

    // desired orientation: look at the gaze target, rolled into the turn
    tourGaze(s, _tp, _tg)
    controls.target.copy(_tg)
    _tm.lookAt(camera.position, _tg, UP)
    _tq.setFromRotationMatrix(_tm)
    tour.curve.getTangentAt(s, _tt0)
    tour.curve.getTangentAt(Math.min(s + 0.02, 1), _tt1)
    const curl = _tt0.x * _tt1.z - _tt0.z * _tt1.x // signed xz turn over the window
    const arrived = tour.t >= 1
    // after arrival: settle — unwind the bank and let the gimbal fully converge
    // before handing off, so OrbitControls has nothing to snap to
    const bankTarget = arrived ? 0 : THREE.MathUtils.clamp(curl * 15 * params.tourBank, -0.5, 0.5)
    tour.bank = THREE.MathUtils.damp(tour.bank, bankTarget, 2.5, dt)
    _tq.multiply(_tqr.setFromAxisAngle(Z_AXIS, tour.bank))

    // gimbal: rotation chases the desired orientation with a max slew rate,
    // so it can never jump — 80°/s hard ceiling
    const angle = camera.quaternion.angleTo(_tq)
    if (angle > 1e-5) {
      const f = Math.min(1 - Math.exp(-3.2 * dt), (1.4 * dt) / angle)
      camera.quaternion.slerp(_tq, f)
    }

    if (arrived && angle < 0.001 && Math.abs(tour.bank) < 0.001) tour.active = false
  } else if (tween.active) {
    tween.t = Math.min(1, tween.t + dt / params.flyDuration)
    const e = EASINGS[params.flyEasing](tween.t)
    camera.position.lerpVectors(tween.p0, tween.p1, e)
    controls.target.lerpVectors(tween.t0, tween.t1, e)
    camera.lookAt(controls.target)
    if (tween.t >= 1) tween.active = false
  } else {
    controls.update()
  }

  // refresh camera matrices NOW so DOM projections match this frame's render
  // (otherwise labels are projected with last frame's matrices and lag behind)
  camera.updateMatrixWorld()

  if (!params.paused) {
    hud3.update(dt, t, params)
  }

  // terrain scan ripple progress
  if (scanStart >= 0) {
    const p = (performance.now() / 1000 - scanStart) / params.scanDuration
    if (p >= 1) {
      scanStart = -1
      terrain.mapUniforms.uScanT.value = -1
    } else {
      terrain.mapUniforms.uScanT.value = p
    }
  }

  if (params.autoFocus) {
    params.focusDistance = camera.position.distanceTo(controls.target)
  }
  dof.cocMaterial.worldFocusDistance = params.focusDistance

  if (params.hud) {
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05
    const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target))
    const secs = Math.floor(t)
    hud2.update(dt, camera, window.innerWidth, window.innerHeight, {
      pois,
      az: THREE.MathUtils.radToDeg(sph.theta),
      el: 90 - THREE.MathUtils.radToDeg(sph.phi),
      focus: params.focusDistance,
      fps,
      clock: `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`,
    })
  }

  composer.render(dt)
}
tick()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})
