import * as THREE from 'three'
import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'
import { biggestDropTimes } from './metaballs.js'
import { metricsAt } from './profileTrack.js'
import { INK_BLACK, PAPER, isHex, labelKind, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

export const ORB_COUNT = { min: 8000, max: 25000, count: 14000 }
export const DEFAULT_ORB_COLORS = ['#FF7A18', '#5B35C7']
export const MAX_DOT_COLORS = 4

const GOLDEN = Math.PI * (3 - Math.sqrt(5))
const RIPPLE_MAX = 3

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

export function orbDotColorsOf(edit) {
  const list = Array.isArray(edit?.dotColors) ? edit.dotColors.filter(isHex) : []
  return list.length ? list.slice(0, MAX_DOT_COLORS) : DEFAULT_ORB_COLORS.slice()
}

function countOf(spec, section) {
  const value = editOf(spec, section).count
  const count = value == null ? ORB_COUNT.count : Math.round(Number(value))
  return clamp(count || ORB_COUNT.count, ORB_COUNT.min, ORB_COUNT.max)
}

function sizeOf(spec, section) {
  return clamp(Number(editOf(spec, section).size ?? 50), 0, 100) / 100
}

function visibleInk(hex, background) {
  const ink = isHex(hex) ? hex : DEFAULT_ORB_COLORS[0]
  const ground = isHex(background) ? background : INK_BLACK
  const [r, g, b] = hexToRgb(ink)
  const [br, bg, bb] = hexToRgb(ground)
  const [h, s, l] = rgbToHsl(r, g, b)
  const [, , bl] = rgbToHsl(br, bg, bb)
  const gap = 0.2
  if (Math.hypot(r - br, g - bg, b - bb) / 441.67 >= gap && Math.abs(l - bl) >= gap) return ink
  let target
  if (l >= bl) {
    target = Math.min(0.94, Math.max(l, bl + gap))
    if (target - bl < gap) target = Math.max(0.08, bl - gap)
  } else {
    target = Math.max(0.08, Math.min(l, bl - gap))
    if (bl - target < gap) target = Math.min(0.94, bl + gap)
  }
  if (Math.abs(target - l) < 0.002) return ink
  return hslToHex(h, s, target)
}

function backgroundOf(spec, section) {
  const saved = editOf(spec, section).background
  if (isHex(saved)) return saved
  if (isHex(spec.background) && spec.background.toLowerCase() !== PAPER.toLowerCase()) return spec.background
  return INK_BLACK
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
    return { amp: 0.028, freq: 1.15, warp: 0.045, flow: 0.34, detail: 0.5 }
  }
  if (kind === 'Build') return { amp: 0.2, freq: 1.55, warp: 0.28, flow: 0.7, detail: 0.95 }
  if (kind === 'Drop') return { amp: 0.34, freq: 1.7, warp: 0.4, flow: 0.9, detail: 1.1 }
  if (kind === 'High' || kind === 'Main' || kind === 'Peak') {
    return { amp: 0.42, freq: 1.85, warp: 0.52, flow: 1.12, detail: 1.28 }
  }
  return { amp: 0.16, freq: 1.45, warp: 0.22, flow: 0.6, detail: 0.82 }
}

function lerpLook(from, to, amount) {
  const t = clamp(amount, 0, 1)
  const mix = (a, b) => a + (b - a) * t
  return {
    amp: mix(from.amp, to.amp),
    freq: mix(from.freq, to.freq),
    warp: mix(from.warp, to.warp),
    flow: mix(from.flow, to.flow),
    detail: mix(from.detail, to.detail),
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

function ripplesAt(spec, time, seed, tempo, quiet) {
  const period = 60 / Math.max(40, tempo)
  const duration = period * (quiet ? 3.2 : 2.4)
  const beatNow = Math.floor(Math.max(0, time) / period)
  const stride = quiet ? 6 : 2
  const list = []
  for (let beat = beatNow; beat >= 0 && list.length < RIPPLE_MAX; beat -= 1) {
    const start = beat * period
    if (time - start > duration) break
    if (beat % stride !== 0) continue
    if (hashUnit(beat, seed ^ 0x51) > (quiet ? 0.55 : 0.82)) continue
    const origin = unitOnSphere(seed, beat + 3)
    list.push({ origin, progress: clamp((time - start) / duration, 0, 1) })
  }
  return list
}

function fibonacciSphere(count) {
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const hashes = new Float32Array(count)
  const n = Math.max(2, count)
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (i / (n - 1)) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = GOLDEN * i
    const x = Math.cos(theta) * radius
    const z = Math.sin(theta) * radius
    const o = i * 3
    positions[o] = x
    positions[o + 1] = y
    positions[o + 2] = z
    normals[o] = x
    normals[o + 1] = y
    normals[o + 2] = z
    hashes[i] = hashUnit(i, 19)
  }
  return { positions, normals, hashes }
}

function fibonacciTorus(count) {
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const hashes = new Float32Array(count)
  const major = 0.78
  const minor = 0.3
  for (let i = 0; i < count; i += 1) {
    const v = ((i + 0.5) / count) * Math.PI * 2
    const u = i * GOLDEN
    const cx = Math.cos(v)
    const cy = Math.sin(v)
    const cu = Math.cos(u)
    const su = Math.sin(u)
    const o = i * 3
    positions[o] = (major + minor * cu) * cx
    positions[o + 1] = (major + minor * cu) * cy
    positions[o + 2] = minor * su
    normals[o] = cu * cx
    normals[o + 1] = cu * cy
    normals[o + 2] = su
    hashes[i] = hashUnit(i, 23)
  }
  return { positions, normals, hashes }
}

const VERTEX = `
uniform float uAmp;
uniform float uFreq;
uniform float uWarp;
uniform float uDetail;
uniform float uTime;
uniform float uFlow;
uniform float uSpin;
uniform float uScale;
uniform float uBreathe;
uniform float uPointSize;
uniform float uHigh;
uniform float uSeed;
uniform vec3 uRippleOrigin0;
uniform vec3 uRippleOrigin1;
uniform vec3 uRippleOrigin2;
uniform float uRippleProgress0;
uniform float uRippleProgress1;
uniform float uRippleProgress2;
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uColorCount;
attribute float aHash;
varying vec3 vColor;
varying float vAlpha;

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
  float amp = 0.52;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(p);
    p = p * 2.03 + vec3(0.13, 0.27, 0.19);
    amp *= 0.5;
  }
  return sum;
}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 palette(float t) {
  float x = clamp(t, 0.0, 1.0);
  if (uColorCount < 1.5) return uColor0;
  if (uColorCount < 2.5) return mix(uColor0, uColor1, x);
  if (uColorCount < 3.5) {
    float u = x * 2.0;
    if (u < 1.0) return mix(uColor0, uColor1, u);
    return mix(uColor1, uColor2, u - 1.0);
  }
  float u = x * 3.0;
  if (u < 1.0) return mix(uColor0, uColor1, u);
  if (u < 2.0) return mix(uColor1, uColor2, u - 1.0);
  return mix(uColor2, uColor3, u - 2.0);
}

float rippleAt(vec3 p, vec3 origin, float progress) {
  if (progress <= 0.001) return 0.0;
  float wave = acos(clamp(dot(normalize(p), origin), -1.0, 1.0)) - progress * 3.2;
  return exp(-wave * wave * 18.0) * (1.0 - progress) * 0.09;
}

void main() {
  vec3 p = position;
  vec3 nrm = normal;
  if (dot(nrm, nrm) < 0.0001) nrm = p;
  nrm = normalize(nrm);
  vec3 flow = vec3(uTime * 0.071, uTime * 0.044, -uTime * 0.033) * uFlow + vec3(uSeed);
  vec3 q = p * uFreq + flow;
  vec3 warped = p + uWarp * vec3(
    fbm(q + vec3(17.2, 4.1, 2.7)),
    fbm(q + vec3(3.8, 9.4, 1.2)),
    fbm(q + vec3(8.6, 1.7, 6.3))
  );
  float n = fbm(warped * (uFreq * 0.72 * uDetail) + flow * 0.65);
  float disp = (n - 0.42) * uAmp;
  float ripple = rippleAt(p, uRippleOrigin0, uRippleProgress0)
    + rippleAt(p, uRippleOrigin1, uRippleProgress1)
    + rippleAt(p, uRippleOrigin2, uRippleProgress2);
  vec3 displaced = p + nrm * (disp + ripple);
  displaced *= uScale * (1.0 + uBreathe);
  displaced = rotateY(displaced, uSpin);

  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mv;

  vec3 viewN = normalize(mat3(modelViewMatrix) * rotateY(nrm, uSpin));
  float ridge = smoothstep(0.04, 0.18, abs(disp));
  float facing = clamp(viewN.z, 0.0, 1.0) * (1.0 - ridge * 0.62);
  vColor = palette(facing);
  float depth = clamp((-mv.z - 3.0) / 2.2, 0.0, 1.0);
  float back = 1.0 - smoothstep(-0.12, 0.22, viewN.z);
  float shimmer = 1.0 + uHigh * 0.1 * sin(uTime * 3.1 + aHash * 6.2832);
  float size = uPointSize * mix(1.2, 0.4, depth) * (1.0 + ridge * 0.32) * shimmer * mix(1.0, 0.55, back);
  gl_PointSize = max(1.0, size);
  vAlpha = mix(0.38, 0.08, depth) * (0.78 + ridge * 0.7) * mix(1.0, 0.18, back);
  vColor *= 0.88 + facing * 0.08 + ridge * 0.12;
}
`

const FRAGMENT = `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float soft = 1.0 - smoothstep(0.5, 1.0, d);
  vec3 color = min(vColor, vec3(0.9));
  gl_FragColor = vec4(color, vAlpha * soft);
}
`

let renderer = null
let scene = null
let camera = null
let points = null
let geometry = null
let material = null
let cacheKey = ''

export function resetOrb() {
  if (points && scene) scene.remove(points)
  geometry?.dispose()
  material?.dispose()
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
  points = null
  geometry = null
  material = null
  cacheKey = ''
}

if (import.meta.hot) import.meta.hot.dispose(resetOrb)

function hexToVec(hex) {
  const [r, g, b] = hexToRgb(hex)
  return new THREE.Vector3(r / 255, g / 255, b / 255)
}

function hexToClear(hex) {
  const [r, g, b] = hexToRgb(hex)
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255)
}

function ensureRenderer() {
  if (renderer) return true
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
  } catch {
    return false
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setPixelRatio(1)
  renderer.autoClear = true
  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 12)
  camera.position.set(0, 0, 4)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  renderer.debug.checkShaderErrors = true
  material = new THREE.ShaderMaterial({
    uniforms: {
      uAmp: { value: 0.14 },
      uFreq: { value: 2 },
      uWarp: { value: 0.18 },
      uDetail: { value: 0.8 },
      uTime: { value: 0 },
      uFlow: { value: 0.6 },
      uSpin: { value: 0 },
      uScale: { value: 0.84 },
      uBreathe: { value: 0 },
      uPointSize: { value: 3 },
      uHigh: { value: 0 },
      uSeed: { value: 0 },
      uRippleOrigin0: { value: new THREE.Vector3(1, 0, 0) },
      uRippleOrigin1: { value: new THREE.Vector3(0, 1, 0) },
      uRippleOrigin2: { value: new THREE.Vector3(0, 0, 1) },
      uRippleProgress0: { value: 0 },
      uRippleProgress1: { value: 0 },
      uRippleProgress2: { value: 0 },
      uColor0: { value: hexToVec(DEFAULT_ORB_COLORS[0]) },
      uColor1: { value: hexToVec(DEFAULT_ORB_COLORS[1]) },
      uColor2: { value: hexToVec(DEFAULT_ORB_COLORS[1]) },
      uColor3: { value: hexToVec(DEFAULT_ORB_COLORS[1]) },
      uColorCount: { value: 2 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: false,
  })
  return true
}

function setGeometry(count, ring) {
  const next = `${count}:${ring ? 'ring' : 'sphere'}`
  if (geometry && cacheKey === next) return
  cacheKey = next
  const data = ring ? fibonacciTorus(count) : fibonacciSphere(count)
  if (points) {
    scene.remove(points)
    geometry.dispose()
  }
  geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
  geometry.setAttribute('aHash', new THREE.BufferAttribute(data.hashes, 1))
  geometry.computeBoundingSphere()
  points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  scene.add(points)
}

function frameCamera(width, height) {
  const shortSide = Math.min(width, height)
  const span = 2.48
  const aspect = width / Math.max(1, height)
  if (aspect >= 1) {
    camera.left = (-span * aspect) / 2
    camera.right = (span * aspect) / 2
    camera.top = span / 2
    camera.bottom = -span / 2
  } else {
    camera.left = -span / 2
    camera.right = span / 2
    camera.top = span / 2 / aspect
    camera.bottom = -span / 2 / aspect
  }
  camera.updateProjectionMatrix()
  return shortSide
}

export function explainOrb() {
  return 'A sphere of dots is pushed by slow noise so folds gather into brighter ridges. Bass deepens those folds, a beat sends a ripple around the surface, and the rim keeps the first color while the face takes the later ones.'
}

export function paintOrb(ctx, spec) {
  const width = Math.max(1, spec.width || 1)
  const height = Math.max(1, spec.height || 1)
  const time = spec.time || 0
  const sections = spec.sections || []
  const section = sectionAt(sections, time)
  const index = section ? sections.findIndex((item) => item.start === section.start && item.label === section.label) : 0
  const seed = sectionSeedOf(spec, section, Math.max(0, index))
  const edit = editOf(spec, section)
  const background = backgroundOf(spec, section)
  if (!ensureRenderer()) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
    return
  }

  const count = countOf(spec, section)
  const ring = edit.composition === 'ring'
  const kind = labelKind(section?.label)
  const quiet = kind === 'Quiet' || kind === 'Intro' || kind === 'Break' || kind === 'Outro'
  const tempo = Math.max(40, spec.tempo || 100)
  const speed = clamp(Number(spec.speed ?? 50), 0, 100) / 100
  const look = lookAt(spec, time)
  const bass = smoothMetric(spec, time, 'bass', 0.5)
  const high = smoothMetric(spec, time, 'high', 0.35)
  const loud = smoothMetric(spec, time, 'loud', 0.4)
  const mids = clamp(loud * 1.05 - bass * 0.38 - high * 0.22, 0, 1)
  const drop = dropMotion(spec, time)
  const amp = look.amp * (quiet ? 0.45 + bass * 0.25 : 0.55 + bass * 0.95) + drop.burst * 0.22
  const freq = look.freq * (0.78 + mids * 0.55)
  const flow = look.flow * (0.7 + speed * 0.55)
  const spin = time * ((Math.PI * 2) / (48 - speed * 16))
  const scale = 1 - drop.pull * 0.085 + drop.burst * 0.04
  const breathe = quiet ? Math.sin(time * 0.7) * 0.018 : Math.sin(time * 0.55) * 0.01
  const shortSide = frameCamera(width, height)
  const pointSize = (1.35 + sizeOf(spec, section) * 3.6) * (shortSide / 540)
  const colors = orbDotColorsOf(edit).map((hex) => visibleInk(hex, background))
  const ripples = ripplesAt(spec, time, seed, tempo, quiet)
  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : { a: 1, d: 1, e: 0, f: 0 }
  const sx = Math.max(1, transform.a || 1)
  const sy = Math.max(1, transform.d || 1)
  const drawW = Math.max(1, Math.round(width * sx))
  const drawH = Math.max(1, Math.round(height * sy))

  setGeometry(count, ring)
  const uniforms = material.uniforms
  uniforms.uAmp.value = amp
  uniforms.uFreq.value = freq
  uniforms.uWarp.value = look.warp
  uniforms.uDetail.value = look.detail * (0.75 + mids * 0.5)
  uniforms.uTime.value = time
  uniforms.uFlow.value = flow
  uniforms.uSpin.value = spin
  uniforms.uScale.value = 0.84 * scale
  uniforms.uBreathe.value = breathe
  uniforms.uPointSize.value = pointSize * sx
  uniforms.uHigh.value = quiet ? high * 0.25 : high
  uniforms.uSeed.value = (seed % 1024) / 1024
  uniforms.uColorCount.value = colors.length
  const resolved = [0, 1, 2, 3].map((index) => hexToVec(colors[Math.min(index, colors.length - 1)]))
  uniforms.uColor0.value.copy(resolved[0])
  uniforms.uColor1.value.copy(resolved[1])
  uniforms.uColor2.value.copy(resolved[2])
  uniforms.uColor3.value.copy(resolved[3])
  const rippleSlots = [
    ['uRippleOrigin0', 'uRippleProgress0'],
    ['uRippleOrigin1', 'uRippleProgress1'],
    ['uRippleOrigin2', 'uRippleProgress2'],
  ]
  for (let i = 0; i < RIPPLE_MAX; i += 1) {
    const ripple = ripples[i]
    const [originKey, progressKey] = rippleSlots[i]
    if (ripple) {
      uniforms[originKey].value.set(ripple.origin[0], ripple.origin[1], ripple.origin[2])
      uniforms[progressKey].value = ripple.progress
    } else {
      uniforms[progressKey].value = 0
    }
  }

  if (renderer.domElement.width !== drawW || renderer.domElement.height !== drawH) {
    renderer.setSize(drawW, drawH, false)
  }
  renderer.setClearColor(hexToClear(background), 1)
  renderer.render(scene, camera)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(renderer.domElement, transform.e || 0, transform.f || 0, drawW, drawH)
  ctx.restore()
}
