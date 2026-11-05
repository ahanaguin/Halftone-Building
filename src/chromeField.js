import * as THREE from 'three'
import { hexToRgb } from './palette.js'
import { biggestDropTimes } from './metaballs.js'
import { metricsAt } from './profileTrack.js'
import { PAPER, isHex, labelKind, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

export const CHROME_COUNT = { min: 0, max: 12, count: 5 }
export const CHROME_GREY = '#7E7F83'
export const DEFAULT_CHROME_COLORS = ['#E8E4DC', '#7A8CA8', '#C4A574']

const SPHERE_MAX = 18
const CAP_MAX = 18

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
    return { amp: 0.55, warp: 0.045, flow: 0.28, stretch: 0.1, bend: 0.32, splash: 0.18, k: 0.34 }
  }
  if (kind === 'Build') return { amp: 0.82, warp: 0.08, flow: 0.55, stretch: 0.86, bend: 0.6, splash: 0.5, k: 0.28 }
  if (kind === 'Drop') return { amp: 1, warp: 0.1, flow: 0.72, stretch: 0.52, bend: 0.74, splash: 1, k: 0.26 }
  if (kind === 'High' || kind === 'Main' || kind === 'Peak') {
    return { amp: 0.94, warp: 0.09, flow: 0.8, stretch: 0.46, bend: 0.68, splash: 0.85, k: 0.27 }
  }
  return { amp: 0.72, warp: 0.06, flow: 0.48, stretch: 0.26, bend: 0.44, splash: 0.45, k: 0.3 }
}

function lerpLook(from, to, amount) {
  const t = clamp(amount, 0, 1)
  const mix = (a, b) => a + (b - a) * t
  return {
    amp: mix(from.amp, to.amp),
    warp: mix(from.warp, to.warp),
    flow: mix(from.flow, to.flow),
    stretch: mix(from.stretch, to.stretch),
    bend: mix(from.bend, to.bend),
    splash: mix(from.splash, to.splash),
    k: mix(from.k, to.k),
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
    if (age < 0.2) pull = Math.max(pull, easeInOut(age / 0.2))
    else {
      const t = (age - 0.2) / Math.max(0.2, settle - 0.2)
      burst = Math.max(burst, easeOut(1 - t) * (1 - easeInOut(t)))
    }
  }
  return { pull, burst }
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function length3(a) {
  return Math.hypot(a[0], a[1], a[2]) || 1
}

function normalize3(a) {
  const len = length3(a)
  return [a[0] / len, a[1] / len, a[2] / len]
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function spinePoint(s, twist, bend, stretch) {
  const t = clamp(s, 0, 1)
  const y = (t - 0.36) * (0.92 + stretch * 1.28)
  const x = Math.sin(t * Math.PI * 1.35 + twist) * (0.24 + bend * 0.4)
  const z = Math.cos(t * Math.PI * 0.92 + twist * 0.55) * (0.16 + bend * 0.26)
  return [x, y, z]
}

function splashGain(age, duration) {
  if (age < 0 || age > duration) return 0
  if (age < 0.18) return easeOut(age / 0.18)
  return 1 - easeInOut((age - 0.18) / Math.max(0.05, duration - 0.18))
}

function layoutForm(spec, time, seed, look, bass, high, quiet, speed, size, drop, dropletCount) {
  const spheres = []
  const capsules = []
  const pushS = (p, r) => {
    if (spheres.length < SPHERE_MAX && r > 0.012) spheres.push({ p, r })
  }
  const pushC = (a, b, r) => {
    if (capsules.length >= CAP_MAX || r <= 0.01) return
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.03) return
    capsules.push({ a, b, r })
  }

  const twist = time * (0.16 + speed * 0.55) + hashUnit(3, seed) * 6.28
  const bend = look.bend * (0.7 + bass * 0.85) + drop.burst * 0.18
  const stretch = look.stretch * (quiet ? 0.4 : 1) * (0.75 + bass * 0.45) - drop.pull * 0.2
  const swell = (quiet ? 1.02 : 1.12) * (0.9 + bass * 0.28) * (1 - drop.pull * 0.1 + drop.burst * 0.08)
  const flow = look.flow * (0.25 + speed * 1.8)
  const fit = (0.76 + size * 0.16) * (quiet ? 1.04 : 0.94) * (1 - drop.burst * 0.16)

  const core = [0, 0.04 * fit, 0]
  pushS(core, (quiet ? 0.46 : 0.3) * fit * swell)

  const body = quiet ? 4 : 6
  const nodes = []
  for (let i = 0; i < body; i += 1) {
    const s = i / Math.max(1, body - 1)
    const drift = Math.sin(time * flow * 0.55 + i * 0.9) * 0.028
    const p = scale(spinePoint(clamp(s + drift, 0, 1), twist, bend, stretch), fit)
    const fat = Math.sin(s * Math.PI) ** 0.45
    const r = (0.2 + fat * 0.16) * fit * swell
    nodes.push({ p, r, s })
    pushS(p, r)
  }
  for (let i = 0; i < nodes.length - 1; i += 1) {
    pushC(nodes[i].p, nodes[i + 1].p, Math.min(nodes[i].r, nodes[i + 1].r) * 0.88)
  }
  pushC(core, nodes[0].p, Math.min(0.24 * fit * swell, nodes[0].r))
  pushC(core, nodes[nodes.length - 1].p, Math.min(0.2 * fit * swell, nodes[nodes.length - 1].r * 0.95))

  const lobeAt = 0.42 + hashUnit(9, seed) * 0.16
  const lobe = scale(spinePoint(lobeAt, twist, bend, stretch), fit)
  const side = normalize3(cross(spinePoint(lobeAt + 0.04, twist, bend, stretch), [0, 1, 0]))
  const lobeEnd = add(lobe, scale(side, (0.2 + bend * 0.1) * fit * swell))
  pushS(lobeEnd, 0.16 * fit * swell)
  pushC(lobe, lobeEnd, 0.12 * fit * swell)

  const tempo = Math.max(40, spec.tempo || 100)
  const period = 60 / tempo
  const splashDur = 0.7
  const beatNow = Math.floor(Math.max(0, time) / period)
  const stride = quiet ? 8 : look.splash > 0.7 ? 1 : 2
  const splashes = []
  if (drop.burst > 0.08) {
    splashes.push({ origin: nodes[Math.min(nodes.length - 1, 5)]?.p || [0, 0.4, 0], gain: drop.burst, salt: 19, crown: true })
  }
  for (let beat = beatNow; beat >= 0 && splashes.length < 2; beat -= 1) {
    const start = beat * period
    const age = time - start
    if (age > splashDur) break
    if (beat % stride !== 0) continue
    if (hashUnit(beat, seed ^ 0x61) > (quiet ? 0.28 : 0.74 + look.splash * 0.2)) continue
    const gain = splashGain(age, splashDur) * (quiet ? 0.45 : 0.7 + look.splash * 0.35)
    if (gain <= 0.02) continue
    const pick = look.splash > 0.6
      ? nodes.length - 1
      : Math.floor(hashUnit(beat, seed ^ 0x27) * nodes.length)
    const node = nodes[pick] || nodes[nodes.length - 1]
    splashes.push({ origin: node.p, gain, salt: beat + 3, crown: look.splash > 0.85 })
  }

  for (const splash of splashes) {
    const n = Math.round(splash.crown ? 5 : 3 + hashUnit(splash.salt, seed) * 2)
    const helper = Math.abs(splash.origin[1]) < 0.7 ? [0, 1, 0] : [1, 0, 0]
    const tangent = normalize3(cross(helper, splash.origin[0] || splash.origin[2] ? splash.origin : [0, 1, 0.2]))
    const bitan = normalize3(cross(splash.origin[1] > 0.1 ? splash.origin : [0, 1, 0], tangent))
    const axis = normalize3(add(normalize3(splash.origin[1] > -0.1 ? splash.origin : [0, 1, 0.15]), [0, 0.7, 0]))
    for (let i = 0; i < n; i += 1) {
      const a = ((i + hashUnit(i, splash.salt)) / n) * Math.PI * 2
      const dir = normalize3(add(scale(axis, 0.42), add(scale(tangent, Math.cos(a) * 1.05), scale(bitan, Math.sin(a) * 1.05))))
      const len = (splash.crown ? 0.76 : 0.58) * splash.gain * fit
      const root = add(splash.origin, scale(dir, 0.1 * fit))
      const tip = add(splash.origin, scale(dir, len))
      pushC(root, tip, (0.085 - i * 0.006) * fit * (0.65 + splash.gain * 0.45))
      pushS(tip, (0.075 + hashUnit(i, splash.salt ^ 8) * 0.04) * fit * (0.6 + splash.gain * 0.55))
    }
  }

  for (let i = 0; i < dropletCount; i += 1) {
    const cycle = 3.5 + hashUnit(i, seed ^ 0x71) * 4.2
    const phase = (time / cycle + hashUnit(i, seed ^ 0x82)) % 1
    const wave = Math.sin(phase * Math.PI)
    let out = quiet ? wave * high * 0.4 : wave * (0.2 + high * 0.8)
    if (hashUnit(i, seed ^ 0x93) > 0.55 + high * 0.35) out *= 0.2
    out = Math.max(out, drop.burst * (0.45 + hashUnit(i, seed ^ 0xa4) * 0.4))
    if (out < 0.06) continue
    const along = (hashUnit(i, seed ^ 0xb5) + time * 0.07 * flow) % 1
    const base = scale(spinePoint(along, twist, bend, stretch), fit)
    const dir = normalize3([
      hashUnit(i, seed ^ 0xc6) * 2 - 1,
      0.35 + hashUnit(i, seed ^ 0xd7) * 0.8,
      hashUnit(i, seed ^ 0xe8) * 2 - 1,
    ])
    const tip = add(base, scale(dir, (0.16 + out * 0.48) * fit))
    pushC(base, tip, 0.055 * fit * (0.4 + out * 0.7))
    pushS(tip, (0.06 + hashUnit(i, seed ^ 0xf9) * 0.04) * fit * (0.45 + out * 0.7))
  }

  return { spheres, capsules, k: look.k }
}

function hexToVec(hex) {
  const [r, g, b] = hexToRgb(hex)
  return new THREE.Vector3(r / 255, g / 255, b / 255)
}

function mapGlsl() {
  let src = `
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

vec3 warp(vec3 p) {
  float t = uTime * uFlow;
  p.x += uWarp * sin(p.y * 1.05 + t * 0.72);
  p.z += uWarp * sin(p.x * 0.82 + t * 0.54);
  p.y += uWarp * 0.45 * sin(p.z * 0.7 + t * 0.4);
  return p;
}

float map(vec3 p) {
  p = warp(p);
  float d = 1e5;
  float k = uK;
`
  for (let i = 0; i < SPHERE_MAX; i += 1) {
    src += `  if (uS${i}.w > 0.001) d = smin(d, length(p - uS${i}.xyz) - uS${i}.w, k);\n`
  }
  for (let i = 0; i < CAP_MAX; i += 1) {
    src += `  if (uCA${i}.w > 0.001) d = smin(d, sdCapsule(p, uCA${i}.xyz, uCB${i}, uCA${i}.w), k);\n`
  }
  src += `  return d;\n}\n`
  return src
}

function lightGlsl() {
  return `
vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0016;
  return normalize(
    e.xyy * map(p + e.xyy) +
    e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) +
    e.xxx * map(p + e.xxx)
  );
}

float boxLight(vec3 r, vec3 dir, vec2 size, float edge) {
  vec3 w = normalize(dir);
  vec3 u = normalize(cross(abs(w.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), w));
  vec3 v = cross(w, u);
  vec2 q = vec2(dot(r, u), dot(r, v));
  float facing = max(dot(r, w), 0.0);
  vec2 d = abs(q) - size;
  float inside = 1.0 - smoothstep(0.0, edge, max(d.x, d.y));
  return inside * facing;
}

float stripLight(vec3 r, vec3 dir, float width, float edge) {
  vec3 w = normalize(dir);
  vec3 u = normalize(cross(abs(w.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), w));
  float along = abs(dot(r, u));
  float facing = max(dot(r, w), 0.0);
  return (1.0 - smoothstep(0.0, edge, along - width)) * facing;
}

vec3 studio(vec3 r) {
  vec3 col = uBg * 0.78;
  col += vec3(0.08) * max(r.y, 0.0);
  col += vec3(1.02) * 1.85 * boxLight(r, normalize(vec3(-0.22, 0.55, 0.72)), vec2(0.46, 0.28), 0.007);
  col += vec3(1.0) * 1.4 * boxLight(r, normalize(vec3(0.58, 0.38, 0.52)), vec2(0.3, 0.2), 0.007);
  col += vec3(0.82) * 0.55 * boxLight(r, normalize(vec3(0.04, -0.5, 0.74)), vec2(0.42, 0.12), 0.016);
  col += uC0 * uTint * 0.62 * stripLight(r, normalize(vec3(0.35, 0.88, 0.28)), 0.08, 0.028);
  col += uC1 * uTint * 0.48 * stripLight(r, normalize(vec3(-0.4, 0.82, 0.22)), 0.065, 0.024);
  col += uC2 * uTint * 0.38 * stripLight(r, normalize(vec3(0.12, 0.55, 0.78)), 0.05, 0.026);
  return col;
}
`
}

function uniformDecl() {
  let src = `
uniform vec2 uRes;
uniform float uTime;
uniform float uWarp;
uniform float uFlow;
uniform float uK;
uniform float uTint;
uniform vec3 uBg;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
`
  for (let i = 0; i < SPHERE_MAX; i += 1) src += `uniform vec4 uS${i};\n`
  for (let i = 0; i < CAP_MAX; i += 1) src += `uniform vec4 uCA${i};\nuniform vec3 uCB${i};\n`
  return src
}

function fragmentSrc() {
  return `
varying vec2 vUv;
${uniformDecl()}
${mapGlsl()}
${lightGlsl()}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(0.0, 0.08, 3.28);
  vec3 rd = normalize(vec3(uv, -1.22));
  float t = 0.0;
  float hit = 0.0;
  for (int i = 0; i < 80; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0012 * (1.0 + t)) { hit = 1.0; break; }
    t += d * 0.9;
    if (t > 7.5) break;
  }

  vec3 bg = uBg;
  if (rd.y < -0.02) {
    float tf = (-1.12 - ro.y) / rd.y;
    if (tf > 0.0) {
      vec3 gp = ro + rd * tf;
      float sh = smoothstep(1.55, 0.12, length(gp.xz - vec2(0.02, 0.06)));
      bg = mix(bg, bg * 0.52, sh * 0.72);
    }
  }

  if (hit < 0.5) {
    gl_FragColor = vec4(bg, 1.0);
    return;
  }

  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  vec3 r = reflect(rd, n);
  float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.6);
  vec3 env = studio(r);
  vec3 col = env * mix(0.94, 1.22, fres);
  col += vec3(0.08) * fres;
  gl_FragColor = vec4(col, 1.0);
}
`
}

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

function emptyVec4() {
  return new THREE.Vector4(0, 0, 0, 0)
}

function emptyVec3() {
  return new THREE.Vector3(0, 0, 0)
}

let renderer = null
let scene = null
let camera = null
let mesh = null
let material = null
let uniforms = null

export function resetChrome() {
  mesh?.geometry?.dispose()
  material?.dispose()
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
  mesh = null
  material = null
  uniforms = null
}

if (import.meta.hot) import.meta.hot.dispose(resetChrome)

function makeUniforms() {
  const map = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uWarp: { value: 0.06 },
    uFlow: { value: 0.4 },
    uK: { value: 0.18 },
    uTint: { value: 0.4 },
    uBg: { value: hexToVec(CHROME_GREY) },
    uC0: { value: hexToVec(DEFAULT_CHROME_COLORS[0]) },
    uC1: { value: hexToVec(DEFAULT_CHROME_COLORS[1]) },
    uC2: { value: hexToVec(DEFAULT_CHROME_COLORS[2]) },
  }
  for (let i = 0; i < SPHERE_MAX; i += 1) map[`uS${i}`] = { value: emptyVec4() }
  for (let i = 0; i < CAP_MAX; i += 1) {
    map[`uCA${i}`] = { value: emptyVec4() }
    map[`uCB${i}`] = { value: emptyVec3() }
  }
  return map
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
  renderer.debug.checkShaderErrors = true
  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  uniforms = makeUniforms()
  material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: fragmentSrc(),
    depthTest: false,
    depthWrite: false,
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  mesh = new THREE.Mesh(geometry, material)
  scene.add(mesh)
  return true
}

function clearSlots() {
  for (let i = 0; i < SPHERE_MAX; i += 1) uniforms[`uS${i}`].value.set(0, 0, 0, 0)
  for (let i = 0; i < CAP_MAX; i += 1) {
    uniforms[`uCA${i}`].value.set(0, 0, 0, 0)
    uniforms[`uCB${i}`].value.set(0, 0, 0)
  }
}

export function explainChrome() {
  return 'A liquid-metal sculpture is built from blobs and stretched capsules that melt together along a twisting spine. Beats throw splash-crown tips, highs shake droplets loose, and the palette only shows up as sharp light streaks in the chrome.'
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

  const kind = labelKind(section?.label)
  const quiet = kind === 'Quiet' || kind === 'Intro' || kind === 'Break' || kind === 'Outro'
  const speed = clamp(Number(spec.speed ?? 50), 0, 100) / 100
  const look = lookAt(spec, time)
  const bass = smoothMetric(spec, time, 'bass', 0.5)
  const high = smoothMetric(spec, time, 'high', 0.35)
  const drop = dropMotion(spec, time)
  const size = sizeOf(spec, section)
  const tint = tintOf(spec, section)
  const colors = colorsOf(spec, section)
  const form = layoutForm(spec, time, seed, look, bass, high, quiet, speed, size, drop, countOf(spec, section))

  clearSlots()
  form.spheres.forEach((item, i) => {
    uniforms[`uS${i}`].value.set(item.p[0], item.p[1], item.p[2], item.r)
  })
  form.capsules.forEach((item, i) => {
    uniforms[`uCA${i}`].value.set(item.a[0], item.a[1], item.a[2], item.r)
    uniforms[`uCB${i}`].value.set(item.b[0], item.b[1], item.b[2])
  })
  uniforms.uTime.value = time
  uniforms.uWarp.value = look.warp * (quiet ? 0.55 : 1)
  uniforms.uFlow.value = look.flow * (0.3 + speed * 1.6)
  uniforms.uK.value = form.k
  uniforms.uTint.value = tint
  uniforms.uBg.value.copy(hexToVec(background))
  uniforms.uC0.value.copy(hexToVec(colors[0] || DEFAULT_CHROME_COLORS[0]))
  uniforms.uC1.value.copy(hexToVec(colors[1] || colors[0] || DEFAULT_CHROME_COLORS[1]))
  uniforms.uC2.value.copy(hexToVec(colors[2] || colors[0] || DEFAULT_CHROME_COLORS[2]))

  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : { a: 1, d: 1, e: 0, f: 0 }
  const sx = Math.max(1, transform.a || 1)
  const sy = Math.max(1, transform.d || 1)
  const drawW = Math.max(1, Math.round(width * sx))
  const drawH = Math.max(1, Math.round(height * sy))
  const exportPass = spec.exportPass === true
  const cap = exportPass ? Math.max(drawW, drawH) : Math.min(Math.max(drawW, drawH), 512)
  const scale = cap / Math.max(drawW, drawH)
  const marchW = Math.max(1, Math.round(drawW * scale))
  const marchH = Math.max(1, Math.round(drawH * scale))
  uniforms.uRes.value.set(marchW, marchH)
  if (renderer.domElement.width !== marchW || renderer.domElement.height !== marchH) {
    renderer.setSize(marchW, marchH, false)
  }
  renderer.setClearColor(new THREE.Color(background), 1)
  renderer.render(scene, camera)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(renderer.domElement, transform.e || 0, transform.f || 0, drawW, drawH)
  ctx.restore()
}
