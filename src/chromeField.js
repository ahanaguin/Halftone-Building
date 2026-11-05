import * as THREE from 'three'
import { hexToRgb } from './palette.js'
import { biggestDropTimes } from './metaballs.js'
import { metricsAt } from './profileTrack.js'
import { PAPER, isHex, labelKind, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

export const CHROME_COUNT = { min: 0, max: 16, count: 6 }
export const CHROME_GREY = '#8A8A8C'
export const DEFAULT_CHROME_COLORS = ['#E8E4DC', '#7A8CA8', '#C4A574']

const DROPLET_MAX = 16
const SPLASH_MAX = 2

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function easeInOut(amount) {
  const t = clamp(amount, 0, 1)
  return t * t * (3 - 2 * t)
}

function easeOut(amount) {
  const t = clamp(amount, 0, 1)
  return 1 - (1 - t) * (1 - t)
}

function hashUnit(index, salt) {
  let h = Math.imul((index + 1) >>> 0, 0x9e3779b1) ^ Math.imul((salt + 1) >>> 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function editOf(spec, section) {
  if (!section) return {}
  return spec.edits?.[sectionKey(section)] || {}
}

function sectionSeedOf(spec, section, index) {
  if (!section) return spec.seed || 1
  const saved = spec.seeds?.[sectionKey(section)]
  if (saved != null) return saved >>> 0
  return sectionSeed(section, index)
}

function countOf(spec, section) {
  const value = editOf(spec, section).count
  const count = value == null ? CHROME_COUNT.count : Math.round(Number(value))
  return clamp(count || 0, CHROME_COUNT.min, CHROME_COUNT.max)
}

function sizeOf(spec, section) {
  return clamp(Number(editOf(spec, section).size ?? 50), 0, 100) / 100
}

function tintOf(spec, section) {
  return clamp(Number(editOf(spec, section).tint ?? 40), 0, 100) / 100
}

function backgroundOf(spec, section) {
  const saved = editOf(spec, section).background
  if (isHex(saved)) return saved
  if (isHex(spec.background) && spec.background.toLowerCase() !== PAPER.toLowerCase()) return spec.background
  return CHROME_GREY
}

function colorsOf(spec, section) {
  const edit = editOf(spec, section)
  const palette = spec.palette || []
  if (Array.isArray(edit.colors) && edit.colors.length >= 2 && palette.length) {
    const allowed = new Set(edit.colors)
    const picked = palette.filter((swatch) => allowed.has(swatch.id)).map((swatch) => swatch.hex).filter(isHex)
    if (picked.length) return picked.slice(0, 4)
  }
  const listed = (spec.colors || []).filter(isHex)
  if (listed.length) return listed.slice(0, 4)
  const fromPalette = palette.map((swatch) => swatch.hex).filter(isHex)
  return (fromPalette.length ? fromPalette : DEFAULT_CHROME_COLORS).slice(0, 4)
}

function sampleAt(spec, time) {
  const metrics = metricsAt(spec.profile, time)
  if (metrics) return metrics
  return {
    loud: spec.loud ?? 0.35,
    bass: spec.bass ?? 0.4,
    high: spec.high ?? 0.25,
  }
}

function smoothMetric(spec, time, key, tau) {
  let total = 0
  let weight = 0
  const steps = 10
  const dt = tau / 6
  for (let step = 0; step < steps; step += 1) {
    const age = step * dt
    const gain = Math.exp(-age / tau)
    total += (sampleAt(spec, Math.max(0, time - age))[key] ?? 0.35) * gain
    weight += gain
  }
  return total / Math.max(1e-6, weight)
}

function lookFor(kind) {
  if (kind === 'Quiet' || kind === 'Intro' || kind === 'Break' || kind === 'Outro') {
    return { amp: 0.06, freq: 1.15, warp: 0.08, flow: 0.32, stretch: 0.02, splash: 0.22, peak: 0.35 }
  }
  if (kind === 'Build') return { amp: 0.16, freq: 1.45, warp: 0.2, flow: 0.62, stretch: 0.38, splash: 0.55, peak: 0.7 }
  if (kind === 'Drop') return { amp: 0.24, freq: 1.7, warp: 0.28, flow: 0.82, stretch: 0.22, splash: 1, peak: 1.15 }
  if (kind === 'High' || kind === 'Main' || kind === 'Peak') {
    return { amp: 0.22, freq: 1.62, warp: 0.26, flow: 0.95, stretch: 0.18, splash: 0.88, peak: 1 }
  }
  return { amp: 0.12, freq: 1.35, warp: 0.16, flow: 0.55, stretch: 0.1, splash: 0.45, peak: 0.6 }
}

function lerpLook(from, to, amount) {
  const t = clamp(amount, 0, 1)
  const mix = (a, b) => a + (b - a) * t
  return {
    amp: mix(from.amp, to.amp),
    freq: mix(from.freq, to.freq),
    warp: mix(from.warp, to.warp),
    flow: mix(from.flow, to.flow),
    stretch: mix(from.stretch, to.stretch),
    splash: mix(from.splash, to.splash),
    peak: mix(from.peak, to.peak),
  }
}

function lookAt(spec, time) {
  const sections = spec.sections || []
  const section = sectionAt(sections, time)
  const index = section ? sections.findIndex((item) => item.start === section.start && item.label === section.label) : 0
  const tempo = Math.max(40, spec.tempo || 100)
  const bar = (60 / tempo) * 4
  const now = lookFor(labelKind(section?.label))
  if (!section || index <= 0) return now
  const prev = lookFor(labelKind(sections[index - 1].label))
  return lerpLook(prev, now, easeInOut((time - section.start) / bar))
}

function dropMotion(spec, time) {
  const sections = spec.sections || []
  const section = sectionAt(sections, time)
  const tempo = Math.max(40, spec.tempo || 100)
  const settle = (60 / tempo) * 8
  const times = biggestDropTimes(spec).slice()
  if (section && labelKind(section.label) === 'Drop') times.push(section.start)
  times.sort((left, right) => left - right)
  let pull = 0
  let burst = 0
  for (const stamp of times) {
    const age = time - stamp
    if (age < -0.02 || age > settle) continue
    if (age < 0.2) {
      pull = Math.max(pull, easeInOut(age / 0.2))
    } else {
      const t = (age - 0.2) / Math.max(0.2, settle - 0.2)
      burst = Math.max(burst, easeOut(1 - t) * (1 - easeInOut(t)))
    }
  }
  return { pull, burst }
}

function unitOnSphere(seed, salt) {
  const u = hashUnit(salt, seed)
  const v = hashUnit(salt + 17, seed ^ 0x9e3779b1)
  const z = u * 2 - 1
  const t = v * Math.PI * 2
  const r = Math.sqrt(Math.max(0, 1 - z * z))
  return [Math.cos(t) * r, z, Math.sin(t) * r]
}

function splashesAt(spec, time, seed, tempo, quiet, energy) {
  const period = 60 / Math.max(40, tempo)
  const duration = 0.6
  const beatNow = Math.floor(Math.max(0, time) / period)
  const stride = quiet ? 8 : energy > 0.72 ? 1 : 2
  const list = []
  for (let beat = beatNow; beat >= 0 && list.length < SPLASH_MAX; beat -= 1) {
    const start = beat * period
    if (time - start > duration) break
    if (beat % stride !== 0) continue
    if (hashUnit(beat, seed ^ 0x61) > (quiet ? 0.35 : 0.78 + energy * 0.18)) continue
    const origin = unitOnSphere(seed, beat + 11)
    const count = 3 + Math.floor(hashUnit(beat, seed ^ 0x27) * 4)
    list.push({
      origin,
      progress: clamp((time - start) / duration, 0, 1),
      count,
      spin: hashUnit(beat, seed ^ 0x44),
    })
  }
  return list
}

function lobesAt(time, seed, look, flow, stretch, burst) {
  return [0, 1, 2, 3].map((index) => {
    const home = unitOnSphere(seed, index + 70)
    const wander = time * (0.11 + hashUnit(index, seed ^ 0xd1) * 0.1) * flow
    const x = home[0] + Math.sin(wander) * 0.32
    const y = home[1] + stretch * 0.42 + Math.cos(wander * 0.7) * 0.2
    const z = home[2] + Math.sin(wander * 1.15) * 0.28
    const length = Math.hypot(x, y, z) || 1
    const strength = (look.amp * 0.95 + burst * 0.12) * (0.55 + hashUnit(index, seed ^ 0xe2) * 0.4)
    return [x / length, y / length, z / length, strength]
  })
}

function dropletPose(index, time, seed, high, quiet, burst, flow, stretch) {
  const home = unitOnSphere(seed, index + 41)
  const cycle = 3.8 + hashUnit(index, seed ^ 0x71) * 4.6
  const phase = (time / cycle + hashUnit(index, seed ^ 0x82)) % 1
  const wave = Math.sin(phase * Math.PI)
  const chance = hashUnit(index, seed ^ 0x93)
  let out = 0
  if (quiet) {
    out = chance < 0.28 + high * 0.25 ? wave * high * 0.45 : 0
  } else {
    out = chance < 0.42 + high * 0.5 ? wave * (0.22 + high * 0.78) : wave * high * 0.2
  }
  out = Math.max(out, burst * (0.55 + chance * 0.45))
  const wander = time * (0.18 + hashUnit(index, seed ^ 0xa4) * 0.22) * flow
  const lift = 1.02 + out * (0.28 + hashUnit(index, seed ^ 0xb5) * 0.62) + stretch * out * 0.22
  const wobble = out * 0.16
  return {
    x: (home[0] + Math.sin(wander) * wobble) * lift,
    y: (home[1] + Math.cos(wander * 0.83) * wobble) * lift + stretch * out * 0.12,
    z: (home[2] + Math.sin(wander * 1.27) * wobble) * lift,
    scale: (0.045 + hashUnit(index, seed ^ 0xc6) * 0.08) * easeInOut(out),
    out,
  }
}

const DISPLACE = `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(p);
    p = p * 2.05 + vec3(0.17, 0.31, 0.13);
    amp *= 0.5;
  }
  return sum;
}

float lobePull(vec3 n, vec4 lobe) {
  if (lobe.w < 0.001) return 0.0;
  return pow(max(dot(n, normalize(lobe.xyz)), 0.0), 3.4) * lobe.w;
}

float splashSpike(vec3 n, vec3 origin, float progress, float count, float height, float spin) {
  if (progress < 0.001 || progress > 0.999 || height < 0.001) return 0.0;
  float env = progress < 0.28 ? progress / 0.28 : 1.0 - (progress - 0.28) / 0.72;
  env = env * env * (3.0 - 2.0 * env);
  vec3 axis = normalize(origin);
  vec3 helper = abs(axis.y) < 0.84 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(helper, axis));
  vec3 v = normalize(cross(axis, u));
  float sum = 0.0;
  for (int i = 0; i < 6; i++) {
    float alive = step(float(i), count - 0.5);
    float a = (float(i) + spin) * 1.0471976;
    vec3 dir = normalize(axis * 0.42 + (cos(a) * u + sin(a) * v) * 0.92);
    sum += pow(max(dot(n, dir), 0.0), 22.0) * alive;
  }
  return sum * env * height;
}

vec3 chromeDisplace(vec3 p) {
  vec3 n = normalize(p);
  vec3 flow = vec3(uTime * 0.048, uTime * 0.031, -uTime * 0.022) * uFlow + vec3(uSeed);
  vec3 q = p * uFreq + flow;
  vec3 warped = p + uWarp * vec3(
    fbm(q + vec3(11.2, 3.4, 7.1)),
    fbm(q + vec3(2.8, 9.6, 1.5)),
    fbm(q + vec3(6.3, 1.2, 8.4))
  );
  float n1 = fbm(warped * uFreq + flow);
  float n2 = fbm(warped * (uFreq * 1.85) + flow.yzx * 1.2);
  float ridge = 1.0 - abs(n1 * 2.0 - 1.0);
  float disp = (n1 - 0.48) * uAmp * 0.55;
  disp += (n2 - 0.5) * uAmp * 0.18;
  disp += pow(ridge, 4.2) * uPeak * uAmp * 0.42;
  disp += lobePull(n, uLobe0) + lobePull(n, uLobe1) + lobePull(n, uLobe2) + lobePull(n, uLobe3);
  disp += uStretch * smoothstep(-0.05, 1.0, n.y) * (0.2 + n1 * 0.7);
  disp += splashSpike(n, uSplashOrigin0, uSplashProgress0, uSplashCount0, uSplashHeight0, uSplashSpin0);
  disp += splashSpike(n, uSplashOrigin1, uSplashProgress1, uSplashCount1, uSplashHeight1, uSplashSpin1);
  return n * (1.0 + disp);
}

vec3 chromeNormal(vec3 p) {
  float e = 0.014;
  vec3 n = normalize(p);
  vec3 t1 = normalize(cross(abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n));
  vec3 t2 = normalize(cross(n, t1));
  vec3 p0 = chromeDisplace(p);
  vec3 p1 = chromeDisplace(normalize(p + t1 * e));
  vec3 p2 = chromeDisplace(normalize(p + t2 * e));
  return normalize(cross(p1 - p0, p2 - p0));
}
`

const UNIFORM_DECL = `
uniform float uAmp;
uniform float uFreq;
uniform float uWarp;
uniform float uFlow;
uniform float uTime;
uniform float uStretch;
uniform float uPeak;
uniform float uSeed;
uniform vec3 uSplashOrigin0;
uniform vec3 uSplashOrigin1;
uniform float uSplashProgress0;
uniform float uSplashProgress1;
uniform float uSplashCount0;
uniform float uSplashCount1;
uniform float uSplashHeight0;
uniform float uSplashHeight1;
uniform float uSplashSpin0;
uniform float uSplashSpin1;
uniform vec4 uLobe0;
uniform vec4 uLobe1;
uniform vec4 uLobe2;
uniform vec4 uLobe3;
`

let renderer = null
let scene = null
let camera = null
let group = null
let mainMesh = null
let dropletMeshes = []
let shadowMesh = null
let bodyMaterial = null
let dropMaterial = null
let envMap = null
let envTarget = null
let pmrem = null
let envKey = ''
let uniforms = null

export function resetChrome() {
  dropletMeshes.forEach((mesh) => {
    group?.remove(mesh)
    mesh.geometry?.dispose()
  })
  if (mainMesh) {
    group?.remove(mainMesh)
    mainMesh.geometry?.dispose()
  }
  if (shadowMesh) {
    scene?.remove(shadowMesh)
    shadowMesh.geometry?.dispose()
    shadowMesh.material?.map?.dispose()
    shadowMesh.material?.dispose()
  }
  bodyMaterial?.dispose()
  dropMaterial?.dispose()
  envMap?.dispose()
  envTarget?.dispose()
  pmrem?.dispose()
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
  group = null
  mainMesh = null
  dropletMeshes = []
  shadowMesh = null
  bodyMaterial = null
  dropMaterial = null
  envMap = null
  envTarget = null
  pmrem = null
  envKey = ''
  uniforms = null
}

if (import.meta.hot) import.meta.hot.dispose(resetChrome)

function mixHex(hex, tint) {
  const [r, g, b] = hexToRgb(hex)
  return [
    Math.round(255 * (1 - tint) + r * tint),
    Math.round(255 * (1 - tint) + g * tint),
    Math.round(255 * (1 - tint) + b * tint),
  ]
}

function paintStudioMap(ctx, width, height, colors, tint, seed) {
  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#c5c5ca')
  sky.addColorStop(0.46, '#6a6a70')
  sky.addColorStop(0.54, '#3f3f44')
  sky.addColorStop(1, '#1c1c20')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)

  const stripY = height * 0.2
  const strip = ctx.createLinearGradient(0, stripY - 18, 0, stripY + 18)
  strip.addColorStop(0, 'rgba(255,255,255,0)')
  strip.addColorStop(0.5, `rgba(255,255,255,${0.72 - tint * 0.2})`)
  strip.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = strip
  ctx.fillRect(0, stripY - 20, width, 40)

  const lights = 2 + (seed % 3)
  for (let i = 0; i < lights; i += 1) {
    const [r, g, b] = mixHex(colors[i % colors.length], Math.max(0.15, tint))
    const u = (0.1 + hashUnit(i, seed ^ 0x11) * 0.8) * width
    const v = (0.1 + hashUnit(i, seed ^ 0x22) * 0.34) * height
    const rw = (0.08 + hashUnit(i, seed ^ 0x33) * 0.12) * width
    const rh = (0.045 + hashUnit(i, seed ^ 0x44) * 0.07) * height
    const glow = ctx.createRadialGradient(u, v, 0, u, v, Math.max(rw, rh))
    glow.addColorStop(0, `rgba(${r},${g},${b},1)`)
    glow.addColorStop(0.22, `rgba(${r},${g},${b},0.85)`)
    glow.addColorStop(0.55, `rgba(${r},${g},${b},0.28)`)
    glow.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = glow
    ctx.fillRect(u - rw, v - rh, rw * 2, rh * 2)
  }
}

function makeShadowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  const glow = ctx.createRadialGradient(128, 128, 12, 128, 128, 120)
  glow.addColorStop(0, 'rgba(20,20,22,0.38)')
  glow.addColorStop(0.45, 'rgba(20,20,22,0.16)')
  glow.addColorStop(1, 'rgba(20,20,22,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 256, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function setEnvironment(colors, tint, seed) {
  const key = `v3|${colors.join('|')}|${tint.toFixed(2)}|${seed % 7}`
  if (envKey === key && envMap) return
  envKey = key
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  paintStudioMap(canvas.getContext('2d'), 512, 256, colors, tint, seed)
  const source = new THREE.CanvasTexture(canvas)
  source.mapping = THREE.EquirectangularReflectionMapping
  source.colorSpace = THREE.SRGBColorSpace
  if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer)
  const next = pmrem.fromEquirectangular(source)
  source.dispose()
  envMap?.dispose()
  envTarget?.dispose()
  envTarget = next
  envMap = next.texture
  scene.environment = envMap
  if (bodyMaterial) {
    bodyMaterial.envMap = envMap
    bodyMaterial.needsUpdate = true
  }
  if (dropMaterial) {
    dropMaterial.envMap = envMap
    dropMaterial.needsUpdate = true
  }
}

function makeUniforms() {
  return {
    uAmp: { value: 0.12 },
    uFreq: { value: 1.35 },
    uWarp: { value: 0.16 },
    uFlow: { value: 0.55 },
    uTime: { value: 0 },
    uStretch: { value: 0.1 },
    uPeak: { value: 0.6 },
    uSeed: { value: 0 },
    uSplashOrigin0: { value: new THREE.Vector3(1, 0, 0) },
    uSplashOrigin1: { value: new THREE.Vector3(0, 1, 0) },
    uSplashProgress0: { value: 0 },
    uSplashProgress1: { value: 0 },
    uSplashCount0: { value: 4 },
    uSplashCount1: { value: 4 },
    uSplashHeight0: { value: 0 },
    uSplashHeight1: { value: 0 },
    uSplashSpin0: { value: 0 },
    uSplashSpin1: { value: 0 },
    uLobe0: { value: new THREE.Vector4(1, 0, 0, 0.1) },
    uLobe1: { value: new THREE.Vector4(0, 1, 0, 0.1) },
    uLobe2: { value: new THREE.Vector4(0, 0, 1, 0.1) },
    uLobe3: { value: new THREE.Vector4(-1, 0.4, 0, 0.1) },
  }
}

function makeChromeMaterial(displaced) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.025,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.7,
    ior: 1.5,
    reflectivity: 1,
  })
  if (!displaced) return material
  material.customProgramCacheKey = () => 'chrome-displace-v2'
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = UNIFORM_DECL + DISPLACE + shader.vertexShader
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        `
        vec3 objectNormal = chromeNormal(position);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif
        `,
      )
      .replace(
        '#include <begin_vertex>',
        `
        vec3 transformed = chromeDisplace(position);
        `,
      )
  }
  return material
}

function ensureRenderer() {
  if (renderer) return true
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
  } catch {
    return false
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.setPixelRatio(1)
  renderer.autoClear = true
  renderer.debug.checkShaderErrors = true
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 24)
  camera.position.set(0, 0.32, 4.35)
  camera.lookAt(0, 0.06, 0)
  group = new THREE.Group()
  scene.add(group)
  uniforms = makeUniforms()
  bodyMaterial = makeChromeMaterial(true)
  dropMaterial = makeChromeMaterial(false)
  mainMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 6), bodyMaterial)
  group.add(mainMesh)
  dropletMeshes = []
  for (let i = 0; i < DROPLET_MAX; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), dropMaterial)
    mesh.visible = false
    group.add(mesh)
    dropletMeshes.push(mesh)
  }
  const shadowTexture = makeShadowTexture()
  shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
  )
  shadowMesh.rotation.x = -Math.PI / 2
  shadowMesh.position.y = -1.12
  scene.add(shadowMesh)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6e6e72, 0.28))
  return true
}

function hexToColor(hex) {
  const [r, g, b] = hexToRgb(hex)
  return new THREE.Color(r / 255, g / 255, b / 255)
}

export function explainChrome() {
  return 'A silver blob is pushed by slow noise until it folds into waves and splash peaks. Beats throw a ring of spikes, highs shake droplets loose, and the palette lives in the reflections rather than painting the metal.'
}

export function paintChrome(ctx, spec) {
  const width = Math.max(1, spec.width || 1)
  const height = Math.max(1, spec.height || 1)
  const time = spec.time || 0
  const sections = spec.sections || []
  const section = sectionAt(sections, time)
  const index = section ? sections.findIndex((item) => item.start === section.start && item.label === section.label) : 0
  const seed = sectionSeedOf(spec, section, Math.max(0, index))
  const background = backgroundOf(spec, section)
  if (!ensureRenderer()) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
    return
  }

  const count = countOf(spec, section)
  const kind = labelKind(section?.label)
  const quiet = kind === 'Quiet' || kind === 'Intro' || kind === 'Break' || kind === 'Outro'
  const tempo = Math.max(40, spec.tempo || 100)
  const speed = clamp(Number(spec.speed ?? 50), 0, 100) / 100
  const look = lookAt(spec, time)
  const bass = smoothMetric(spec, time, 'bass', 0.5)
  const high = smoothMetric(spec, time, 'high', 0.35)
  const loud = smoothMetric(spec, time, 'loud', 0.4)
  const drop = dropMotion(spec, time)
  const tint = tintOf(spec, section)
  const colors = colorsOf(spec, section)
  const amp = look.amp * (quiet ? 0.55 + bass * 0.35 : 0.62 + bass * 0.9) + drop.burst * 0.16
  const flow = look.flow * (0.22 + speed * 2.15)
  const stretch = look.stretch * (quiet ? 0.35 : 0.85 + bass * 0.4) + drop.burst * 0.12
  const peak = look.peak * (0.55 + loud * 0.55) + drop.burst * 0.35
  const spin = time * ((Math.PI * 2) / Math.max(10, 72 - speed * 58))
  const formScale = (0.6 + sizeOf(spec, section) * 0.15) * 0.78 * (1 - drop.pull * 0.08 + drop.burst * 0.03)
  const splashes = splashesAt(spec, time, seed, tempo, quiet, look.splash)

  setEnvironment(colors, tint, seed)
  const tintColor = hexToColor(colors[0] || DEFAULT_CHROME_COLORS[0])
  const silver = new THREE.Color(0xffffff)
  bodyMaterial.color.copy(silver).lerp(tintColor, tint * 0.28)
  dropMaterial.color.copy(bodyMaterial.color)

  uniforms.uAmp.value = amp
  uniforms.uFreq.value = look.freq
  uniforms.uWarp.value = look.warp
  uniforms.uFlow.value = flow
  uniforms.uTime.value = time
  uniforms.uStretch.value = stretch
  uniforms.uPeak.value = peak
  uniforms.uSeed.value = (seed % 1024) / 1024
  const lobes = lobesAt(time, seed, look, flow, stretch, drop.burst)
  uniforms.uLobe0.value.set(lobes[0][0], lobes[0][1], lobes[0][2], lobes[0][3])
  uniforms.uLobe1.value.set(lobes[1][0], lobes[1][1], lobes[1][2], lobes[1][3])
  uniforms.uLobe2.value.set(lobes[2][0], lobes[2][1], lobes[2][2], lobes[2][3])
  uniforms.uLobe3.value.set(lobes[3][0], lobes[3][1], lobes[3][2], lobes[3][3])
  const splashSlots = [
    ['uSplashOrigin0', 'uSplashProgress0', 'uSplashCount0', 'uSplashHeight0', 'uSplashSpin0'],
    ['uSplashOrigin1', 'uSplashProgress1', 'uSplashCount1', 'uSplashHeight1', 'uSplashSpin1'],
  ]
  for (let i = 0; i < SPLASH_MAX; i += 1) {
    const splash = splashes[i]
    const [originKey, progressKey, countKey, heightKey, spinKey] = splashSlots[i]
    if (splash) {
      uniforms[originKey].value.set(splash.origin[0], splash.origin[1], splash.origin[2])
      uniforms[progressKey].value = splash.progress
      uniforms[countKey].value = splash.count
      uniforms[heightKey].value = (0.28 + look.splash * 0.28 + drop.burst * 0.2) * (quiet ? 0.4 : 1)
      uniforms[spinKey].value = splash.spin
    } else {
      uniforms[progressKey].value = 0
      uniforms[heightKey].value = 0
    }
  }

  group.rotation.set(0.12, spin, 0.04)
  group.scale.setScalar(formScale)
  group.position.y = 0.08 + stretch * 0.06

  for (let i = 0; i < DROPLET_MAX; i += 1) {
    const mesh = dropletMeshes[i]
    if (i >= count) {
      mesh.visible = false
      continue
    }
    const pose = dropletPose(i, time, seed, high, quiet, drop.burst, flow, stretch)
    mesh.visible = pose.out > 0.05
    mesh.position.set(pose.x, pose.y, pose.z)
    mesh.scale.setScalar(Math.max(0.001, pose.scale))
  }

  shadowMesh.position.y = -1.08 * formScale
  shadowMesh.scale.setScalar(0.7 + formScale * 0.45)

  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : { a: 1, d: 1, e: 0, f: 0 }
  const sx = Math.max(1, transform.a || 1)
  const sy = Math.max(1, transform.d || 1)
  const drawW = Math.max(1, Math.round(width * sx))
  const drawH = Math.max(1, Math.round(height * sy))
  camera.aspect = drawW / drawH
  camera.updateProjectionMatrix()
  if (renderer.domElement.width !== drawW || renderer.domElement.height !== drawH) {
    renderer.setSize(drawW, drawH, false)
  }
  renderer.setClearColor(new THREE.Color(background), 1)
  renderer.render(scene, camera)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(renderer.domElement, transform.e || 0, transform.f || 0, drawW, drawH)
  ctx.restore()
}
