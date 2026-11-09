import * as THREE from 'three'
import { hexToRgb } from './palette.js'
import { biggestDropTimes } from './metaballs.js'
import { metricsAt } from './profileTrack.js'
import { PAPER, isHex, labelKind, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

export const CHROME_COUNT = { min: 0, max: 12, count: 5 }
export const CHROME_GREY = '#7E7F83'
export const CHROME_SILVER = '#C8C8CC'
export const CHROME_GOLD = '#D4AF37'
export const CHROME_COPPER = '#B87333'
export const CHROME_METALS = [
  { hex: CHROME_SILVER, label: 'Silver' },
  { hex: CHROME_GOLD, label: 'Gold' },
  { hex: CHROME_COPPER, label: 'Copper' },
]
export const DEFAULT_CHROME_COLORS = ['#E8E4DC', '#7A8CA8', '#C4A574']
export const MAX_METALS = 8

const SPHERE_MAX = 24
const CAP_MAX = 24
const BODY_N = 5
const SPLASH_N = 5
const DROP_N = 12
const DT = 1 / 30
const ATTACK = 0.3
const RELEASE = 0.6
const SPRING_W = 9.2

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

function metalOf(spec, section) {
  const saved = editOf(spec, section).metal
  if (isHex(saved)) return saved
  if (isHex(spec.metal)) return spec.metal
  return CHROME_SILVER
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

function follow(prev, next, dt) {
  const tau = next > prev ? ATTACK : RELEASE
  return prev + (next - prev) * (1 - Math.exp(-dt / Math.max(1e-4, tau)))
}

function springStep(x, v, target, dt, w) {
  const y = x - target
  const b = v + w * y
  const e = Math.exp(-w * dt)
  return [target + (y + b * dt) * e, (b - w * y - w * b * dt) * e]
}

function lookFor(kind) {
  if (kind === 'Quiet' || kind === 'Intro' || kind === 'Break' || kind === 'Outro') {
    return { amp: 0.55, warp: 0.07, flow: 0.22, stretch: 0.18, bend: 0.38, splash: 0.14, k: 0.46 }
  }
  if (kind === 'Build') return { amp: 0.82, warp: 0.1, flow: 0.48, stretch: 0.92, bend: 0.62, splash: 0.45, k: 0.4 }
  if (kind === 'Drop') return { amp: 1, warp: 0.12, flow: 0.62, stretch: 0.55, bend: 0.78, splash: 1, k: 0.38 }
  if (kind === 'High' || kind === 'Main' || kind === 'Peak') {
    return { amp: 0.94, warp: 0.11, flow: 0.7, stretch: 0.5, bend: 0.7, splash: 0.82, k: 0.4 }
  }
  return { amp: 0.72, warp: 0.08, flow: 0.42, stretch: 0.3, bend: 0.48, splash: 0.4, k: 0.42 }
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
  const x = (t - 0.5) * (1.08 + stretch * 0.5) + Math.sin(t * Math.PI * 2 + twist) * 0.1
  const y = Math.sin(t * Math.PI * 1.28 + twist * 0.7) * (0.2 + bend * 0.3) + Math.sin(t * Math.PI * 2.15 + twist * 0.4) * 0.07
  const z = Math.cos(t * Math.PI * 0.85 + twist * 0.45) * (0.08 + bend * 0.1)
  return [x, y, z]
}

function splashGain(age, duration) {
  if (age < 0 || age > duration) return 0
  if (age < 0.18) return easeOut(age / 0.18)
  return 1 - easeInOut((age - 0.18) / Math.max(0.05, duration - 0.18))
}

function emptySpheres() {
  return Array.from({ length: SPHERE_MAX }, () => ({ p: [0, 0, 0], r: 0 }))
}

function emptyCapsules() {
  return Array.from({ length: CAP_MAX }, () => ({ a: [0, 0, 0], b: [0, 0, 0], r: 0 }))
}

function layoutForm(spec, time, seed, look, bass, high, quiet, speed, size, drop, dropletCount) {
  const spheres = emptySpheres()
  const capsules = emptyCapsules()
  const setS = (i, p, r) => {
    if (i < 0 || i >= SPHERE_MAX) return
    spheres[i] = { p, r: r > 0.012 ? r : 0 }
  }
  const setC = (i, a, b, r) => {
    if (i < 0 || i >= CAP_MAX) return
    const len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    capsules[i] = { a, b, r: r > 0.01 && len >= 0.03 ? r : 0 }
  }

  const twist = time * (0.12 + speed * 0.48) + hashUnit(3, seed) * 6.28
  const bend = look.bend * (0.65 + bass * 0.8) + drop.burst * 0.16
  const stretch = look.stretch * (quiet ? 0.45 : 1) * (0.78 + bass * 0.4) - drop.pull * 0.18
  const swell = (quiet ? 0.82 : 0.9) * (0.88 + bass * 0.22) * (1 - drop.pull * 0.08 + drop.burst * 0.06)
  const flow = look.flow * (0.22 + speed * 1.6)
  const fit = (1.02 + size * 0.14) * (quiet ? 1.04 : 0.98) * (1 - drop.burst * 0.12)

  const core = [0.02 * fit, 0.02 * fit, 0]
  setS(0, core, 0.28 * fit * swell)

  const nodes = []
  for (let i = 0; i < BODY_N; i += 1) {
    const s = i / Math.max(1, BODY_N - 1)
    const drift = Math.sin(time * flow * 0.48 + i * 0.85) * 0.02
    const p = scale(spinePoint(clamp(s + drift, 0, 1), twist, bend, stretch), fit)
    const fat = Math.sin(s * Math.PI) ** 0.55
    const r = (0.125 + fat * 0.09) * fit * swell
    nodes.push({ p, r, s })
    setS(1 + i, p, r)
  }
  for (let i = 0; i < BODY_N - 1; i += 1) {
    setC(i, nodes[i].p, nodes[i + 1].p, Math.min(nodes[i].r, nodes[i + 1].r) * 0.92)
  }
  setC(4, core, nodes[0].p, Math.min(0.14 * fit * swell, nodes[0].r))
  setC(5, core, nodes[BODY_N - 1].p, Math.min(0.13 * fit * swell, nodes[BODY_N - 1].r * 0.95))

  const lobeAt = 0.36 + hashUnit(9, seed) * 0.22
  const lobe = scale(spinePoint(lobeAt, twist, bend, stretch), fit)
  const side = normalize3(cross(spinePoint(lobeAt + 0.05, twist, bend, stretch), [0, 1, 0]))
  const lobeEnd = add(lobe, scale(side, (0.16 + bend * 0.08) * fit * swell))
  setS(6, lobeEnd, 0.085 * fit * swell)
  setC(6, lobe, lobeEnd, 0.07 * fit * swell)

  const tempo = Math.max(40, spec.tempo || 100)
  const period = 60 / tempo
  const splashDur = 0.7
  const beatNow = Math.floor(Math.max(0, time) / period)
  const stride = quiet ? 8 : look.splash > 0.7 ? 1 : 2
  const splashes = []
  if (drop.burst > 0.08) {
    splashes.push({ origin: nodes[BODY_N - 1].p, gain: drop.burst, salt: 19, crown: true })
  }
  for (let beat = beatNow; beat >= 0 && splashes.length < 2; beat -= 1) {
    const start = beat * period
    const age = time - start
    if (age > splashDur) break
    if (beat % stride !== 0) continue
    if (hashUnit(beat, seed ^ 0x61) > (quiet ? 0.28 : 0.74 + look.splash * 0.2)) continue
    const gain = splashGain(age, splashDur) * (quiet ? 0.45 : 0.7 + look.splash * 0.35)
    if (gain <= 0.02) continue
    const pick = look.splash > 0.6 ? BODY_N - 1 : Math.floor(hashUnit(beat, seed ^ 0x27) * BODY_N)
    const node = nodes[pick] || nodes[BODY_N - 1]
    splashes.push({ origin: node.p, gain, salt: beat + 3, crown: look.splash > 0.85 })
  }

  const splash = splashes[0]
  if (splash) {
    const n = Math.round(splash.crown ? 5 : 3 + hashUnit(splash.salt, seed) * 2)
    const helper = Math.abs(splash.origin[1]) < 0.7 ? [0, 1, 0] : [1, 0, 0]
    const tangent = normalize3(cross(helper, splash.origin[0] || splash.origin[2] ? splash.origin : [0, 1, 0.2]))
    const bitan = normalize3(cross(splash.origin[1] > 0.1 ? splash.origin : [0, 1, 0], tangent))
    const axis = normalize3(add(normalize3(splash.origin[1] > -0.1 ? splash.origin : [0, 1, 0.15]), [0, 0.7, 0]))
    for (let i = 0; i < SPLASH_N; i += 1) {
      if (i >= n) continue
      const a = ((i + hashUnit(i, splash.salt)) / n) * Math.PI * 2
      const dir = normalize3(add(scale(axis, 0.42), add(scale(tangent, Math.cos(a) * 1.05), scale(bitan, Math.sin(a) * 1.05))))
      const len = (splash.crown ? 0.7 : 0.5) * splash.gain * fit
      const root = add(splash.origin, scale(dir, 0.08 * fit))
      const tip = add(splash.origin, scale(dir, len))
      setC(7 + i, root, tip, (0.055 - i * 0.005) * fit * (0.6 + splash.gain * 0.4))
      setS(7 + i, tip, (0.048 + hashUnit(i, splash.salt ^ 8) * 0.028) * fit * (0.55 + splash.gain * 0.5))
    }
  }

  for (let i = 0; i < DROP_N; i += 1) {
    if (i >= dropletCount) continue
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
    const tip = add(base, scale(dir, (0.14 + out * 0.42) * fit))
    setC(12 + i, base, tip, 0.038 * fit * (0.35 + out * 0.65))
    setS(12 + i, tip, (0.042 + hashUnit(i, seed ^ 0xf9) * 0.028) * fit * (0.4 + out * 0.65))
  }

  return { spheres, capsules, k: look.k, warp: look.warp * (quiet ? 0.55 : 1), flow: look.flow * (0.3 + speed * 1.6) }
}

function motionKey(spec) {
  const edits = spec.edits || {}
  let editPart = ''
  for (const key of Object.keys(edits).sort()) {
    const item = edits[key] || {}
    editPart += `${key}:${item.count ?? ''}:${item.size ?? ''};`
  }
  let seedPart = ''
  const seeds = spec.seeds || {}
  for (const key of Object.keys(seeds).sort()) seedPart += `${key}:${seeds[key]};`
  const sections = spec.sections || []
  return [
    spec.seed || 1,
    Math.round(spec.tempo || 100),
    Math.round(spec.speed ?? 50),
    sections.map((item) => `${item.start}:${item.label}`).join(','),
    seedPart,
    editPart,
    spec.profile ? 1 : 0,
  ].join('|')
}

function restState(form) {
  return {
    bass: 0.4,
    high: 0.25,
    loud: 0.35,
    k: form.k,
    warp: form.warp,
    flow: form.flow,
    vk: 0,
    vwarp: 0,
    vflow: 0,
    spheres: form.spheres.map((item) => ({ p: item.p.slice(), r: item.r, v: [0, 0, 0], vr: 0 })),
    capsules: form.capsules.map((item) => ({
      a: item.a.slice(),
      b: item.b.slice(),
      r: item.r,
      va: [0, 0, 0],
      vb: [0, 0, 0],
      vr: 0,
    })),
  }
}

function layoutAt(spec, time) {
  const sections = spec.sections || []
  const section = sectionAt(sections, time)
  const index = section ? sections.findIndex((item) => item.start === section.start && item.label === section.label) : 0
  const seed = sectionSeedOf(spec, section, Math.max(0, index))
  const kind = labelKind(section?.label)
  const quiet = kind === 'Quiet' || kind === 'Intro' || kind === 'Break' || kind === 'Outro'
  const speed = clamp(Number(spec.speed ?? 50), 0, 100) / 100
  const look = lookAt(spec, time)
  const drop = dropMotion(spec, time)
  const size = sizeOf(spec, section)
  return {
    seed,
    quiet,
    speed,
    look,
    drop,
    size,
    count: countOf(spec, section),
    form: (bass, high) => layoutForm(spec, time, seed, look, bass, high, quiet, speed, size, drop, countOf(spec, section)),
  }
}

function springVec(vec, vel, target, dt) {
  const x = springStep(vec[0], vel[0], target[0], dt, SPRING_W)
  const y = springStep(vec[1], vel[1], target[1], dt, SPRING_W)
  const z = springStep(vec[2], vel[2], target[2], dt, SPRING_W)
  vec[0] = x[0]
  vec[1] = y[0]
  vec[2] = z[0]
  vel[0] = x[1]
  vel[1] = y[1]
  vel[2] = z[1]
}

function stepState(state, spec, time, dt) {
  const raw = sampleAt(spec, time)
  state.bass = follow(state.bass, raw.bass ?? 0.4, dt)
  state.high = follow(state.high, raw.high ?? 0.25, dt)
  state.loud = follow(state.loud, raw.loud ?? 0.35, dt)
  const target = layoutAt(spec, time).form(state.bass, state.high)
  const k = springStep(state.k, state.vk, target.k, dt, SPRING_W)
  const warp = springStep(state.warp, state.vwarp, target.warp, dt, SPRING_W)
  const flow = springStep(state.flow, state.vflow, target.flow, dt, SPRING_W)
  state.k = k[0]
  state.vk = k[1]
  state.warp = warp[0]
  state.vwarp = warp[1]
  state.flow = flow[0]
  state.vflow = flow[1]
  for (let i = 0; i < SPHERE_MAX; i += 1) {
    const slot = state.spheres[i]
    const next = target.spheres[i]
    springVec(slot.p, slot.v, next.p, dt)
    const sprung = springStep(slot.r, slot.vr, next.r, dt, SPRING_W)
    slot.r = sprung[0]
    slot.vr = sprung[1]
  }
  for (let i = 0; i < CAP_MAX; i += 1) {
    const slot = state.capsules[i]
    const next = target.capsules[i]
    springVec(slot.a, slot.va, next.a, dt)
    springVec(slot.b, slot.vb, next.b, dt)
    const sprung = springStep(slot.r, slot.vr, next.r, dt, SPRING_W)
    slot.r = sprung[0]
    slot.vr = sprung[1]
  }
}

let simCache = null

function simulate(spec, time) {
  const key = motionKey(spec)
  const target = Math.max(0, time || 0)
  if (!simCache || simCache.key !== key || target + 1e-4 < simCache.time) {
    const start = Math.max(0, target - 1.5)
    const raw = sampleAt(spec, start)
    const form = layoutAt(spec, start).form(raw.bass ?? 0.4, raw.high ?? 0.25)
    simCache = { key, time: start, state: restState(form) }
    simCache.state.bass = raw.bass ?? 0.4
    simCache.state.high = raw.high ?? 0.25
    simCache.state.loud = raw.loud ?? 0.35
  }
  let guard = 0
  while (simCache.time < target - 1e-4 && guard < 20000) {
    const dt = Math.min(DT, target - simCache.time)
    simCache.time += dt
    stepState(simCache.state, spec, simCache.time, dt)
    guard += 1
  }
  return simCache.state
}

function hexToVec(hex) {
  const [r, g, b] = hexToRgb(hex)
  return new THREE.Vector3(r / 255, g / 255, b / 255)
}

function mapGlsl() {
  return `
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
  p.x += uWarp * 1.15 * sin(p.y * 0.82 + t * 0.58);
  p.z += uWarp * 0.7 * sin(p.x * 0.64 + t * 0.44);
  p.y += uWarp * 0.55 * sin(p.x * 0.5 + t * 0.36);
  return p;
}

float map(vec3 p) {
  p = warp(p);
  p.z *= 1.65;
  float d = 1e5;
  float k = uK;
  for (int i = 0; i < ${SPHERE_MAX}; i++) {
    if (uS[i].w > 0.001) d = smin(d, length(p - uS[i].xyz) - uS[i].w, k);
  }
  for (int i = 0; i < ${CAP_MAX}; i++) {
    if (uCA[i].w > 0.001) d = smin(d, sdCapsule(p, uCA[i].xyz, uCB[i], uCA[i].w), k);
  }
  return d / 1.65;
}
`
}

function lightGlsl() {
  return `
vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * map(p + e.xyy) +
    e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) +
    e.xxx * map(p + e.xxx)
  );
}

float softBox(vec3 r, vec3 dir, vec2 size, float feather) {
  vec3 w = normalize(dir);
  vec3 u = normalize(cross(abs(w.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), w));
  vec3 v = cross(w, u);
  vec2 q = vec2(dot(r, u), dot(r, v));
  float facing = pow(max(dot(r, w), 0.0), 1.15);
  vec2 d = abs(q) - size;
  float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float light = 1.0 - smoothstep(-feather, feather, dist);
  return light * facing;
}

float softStrip(vec3 r, vec3 dir, float width, float feather) {
  vec3 w = normalize(dir);
  vec3 u = normalize(cross(abs(w.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), w));
  float along = abs(dot(r, u));
  float facing = pow(max(dot(r, w), 0.0), 1.1);
  return (1.0 - smoothstep(width, width + feather, along)) * facing;
}

vec3 studio(vec3 r) {
  vec3 rd = normalize(r);
  float y = rd.y;
  vec3 down = vec3(0.07, 0.072, 0.078);
  vec3 up = vec3(0.78, 0.8, 0.83);
  vec3 col = mix(down, up, smoothstep(-0.85, 0.92, y));
  col = mix(col, vec3(0.18, 0.185, 0.195), exp(-y * y * 8.0) * 0.32);
  col += vec3(0.2) * pow(max(dot(rd, normalize(vec3(-0.7, 0.22, 0.48))), 0.0), 2.2);
  col += vec3(1.05) * 1.25 * softBox(rd, normalize(vec3(-0.28, 0.62, 0.58)), vec2(0.22, 0.13), 0.12);
  col += vec3(1.0) * 0.9 * softBox(rd, normalize(vec3(0.55, 0.38, 0.5)), vec2(0.16, 0.1), 0.12);
  col += vec3(0.95) * 0.42 * softBox(rd, normalize(vec3(0.06, 0.08, 0.92)), vec2(0.24, 0.08), 0.15);
  col += uC0 * uTint * 0.42 * softStrip(rd, normalize(vec3(0.38, 0.78, 0.28)), 0.036, 0.09);
  col += uC1 * uTint * 0.32 * softStrip(rd, normalize(vec3(-0.42, 0.74, 0.22)), 0.028, 0.08);
  col += uC2 * uTint * 0.24 * softStrip(rd, normalize(vec3(0.1, 0.48, 0.82)), 0.022, 0.07);
  return col;
}

vec3 shade(vec3 p, vec3 rd) {
  vec3 n = calcNormal(p);
  vec3 ref = reflect(rd, n);
  float ndv = clamp(dot(n, -rd), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.15);
  float peak = max(uMetal.r, max(uMetal.g, uMetal.b));
  vec3 metal = uMetal / max(peak, 0.18);
  vec3 env = studio(ref);
  vec3 col = env * metal * mix(0.95, 1.28, fres);
  col += metal * 0.05 * fres;
  float occ = clamp(map(p + n * 0.08) / 0.08, 0.0, 1.0);
  col *= mix(0.82, 1.0, occ);
  return col;
}

vec4 trace(vec2 frag) {
  vec2 uv = (frag - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(0.0, 0.04, 3.05);
  vec3 rd = normalize(vec3(uv, -1.28));
  float t = 0.0;
  float hit = 0.0;
  float closest = 1e5;
  float closestT = 0.0;
  for (int i = 0; i < 72; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < closest) {
      closest = d;
      closestT = t;
    }
    if (d < 0.0012 * (1.0 + t)) { hit = 1.0; break; }
    t += d * 0.9;
    if (t > 7.5) break;
  }

  float px = 1.35 / uRes.y;
  float cover = hit > 0.5 ? 1.0 : 1.0 - smoothstep(0.0, px * max(closestT, 1.0), closest);
  if (cover < 0.003) return vec4(uBg, 1.0);

  vec3 p = ro + rd * (hit > 0.5 ? t : max(closestT, 0.02));
  vec3 col = mix(uBg, shade(p, rd), cover);
  return vec4(col, 1.0);
}
`
}

function uniformDecl() {
  return `
uniform vec2 uRes;
uniform float uTime;
uniform float uWarp;
uniform float uFlow;
uniform float uK;
uniform float uTint;
uniform float uAA;
uniform vec3 uBg;
uniform vec3 uMetal;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec4 uS[${SPHERE_MAX}];
uniform vec4 uCA[${CAP_MAX}];
uniform vec3 uCB[${CAP_MAX}];
`
}

function fragmentSrc() {
  return `
varying vec2 vUv;
${uniformDecl()}
${mapGlsl()}
${lightGlsl()}

void main() {
  vec4 col = trace(gl_FragCoord.xy);
  if (uAA > 0.5) {
    col = 0.5 * col + 0.5 * trace(gl_FragCoord.xy + vec2(0.45, 0.2));
  }
  gl_FragColor = col;
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

let renderer = null
let scene = null
let camera = null
let mesh = null
let material = null
let uniforms = null
let paintEma = 16
let playScale = 1

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
  simCache = null
  paintEma = 16
  playScale = 1
}

if (import.meta.hot) import.meta.hot.dispose(resetChrome)

function makeUniforms() {
  return {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uWarp: { value: 0.06 },
    uFlow: { value: 0.4 },
    uK: { value: 0.18 },
    uTint: { value: 0.4 },
    uAA: { value: 1 },
    uBg: { value: hexToVec(CHROME_GREY) },
    uMetal: { value: hexToVec(CHROME_SILVER) },
    uC0: { value: hexToVec(DEFAULT_CHROME_COLORS[0]) },
    uC1: { value: hexToVec(DEFAULT_CHROME_COLORS[1]) },
    uC2: { value: hexToVec(DEFAULT_CHROME_COLORS[2]) },
    uS: { value: Array.from({ length: SPHERE_MAX }, () => new THREE.Vector4()) },
    uCA: { value: Array.from({ length: CAP_MAX }, () => new THREE.Vector4()) },
    uCB: { value: Array.from({ length: CAP_MAX }, () => new THREE.Vector3()) },
  }
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

function marchSize(drawW, drawH, spec) {
  const exportPass = spec.exportPass === true
  const playing = spec.playing === true
  if (exportPass || !playing) {
    playScale = 1
    return [drawW, drawH]
  }
  if (paintEma > 34) playScale = Math.max(0.5, playScale * 0.9)
  else if (paintEma < 22) playScale = Math.min(1, playScale + 0.05)
  return [Math.max(1, Math.round(drawW * playScale)), Math.max(1, Math.round(drawH * playScale))]
}

export function explainChrome() {
  return 'A thin liquid-metal sculpture melts together along a twisting spine. Beats throw splash-crown tips, highs shake droplets loose, and the metal color tints the whole reflection while the palette only shows up as light streaks.'
}

export function paintChrome(ctx, spec) {
  const started = typeof performance !== 'undefined' ? performance.now() : 0
  const width = Math.max(1, spec.width || 1)
  const height = Math.max(1, spec.height || 1)
  const time = spec.time || 0
  const sections = spec.sections || []
  const section = sectionAt(sections, time)
  const background = backgroundOf(spec, section)
  if (!ensureRenderer()) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
    return
  }

  const tint = tintOf(spec, section)
  const colors = colorsOf(spec, section)
  const form = simulate(spec, time)

  for (let i = 0; i < SPHERE_MAX; i += 1) {
    const item = form.spheres[i]
    uniforms.uS.value[i].set(item.p[0], item.p[1], item.p[2], Math.max(0, item.r))
  }
  for (let i = 0; i < CAP_MAX; i += 1) {
    const item = form.capsules[i]
    uniforms.uCA.value[i].set(item.a[0], item.a[1], item.a[2], Math.max(0, item.r))
    uniforms.uCB.value[i].set(item.b[0], item.b[1], item.b[2])
  }
  uniforms.uTime.value = time
  uniforms.uWarp.value = form.warp
  uniforms.uFlow.value = form.flow
  uniforms.uK.value = Math.max(0.22, form.k)
  uniforms.uTint.value = tint
  uniforms.uBg.value.copy(hexToVec(background))
  uniforms.uMetal.value.copy(hexToVec(metalOf(spec, section)))
  uniforms.uC0.value.copy(hexToVec(colors[0] || DEFAULT_CHROME_COLORS[0]))
  uniforms.uC1.value.copy(hexToVec(colors[1] || colors[0] || DEFAULT_CHROME_COLORS[1]))
  uniforms.uC2.value.copy(hexToVec(colors[2] || colors[0] || DEFAULT_CHROME_COLORS[2]))

  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : { a: 1, d: 1, e: 0, f: 0 }
  const sx = Math.abs(transform.a) || 1
  const sy = Math.abs(transform.d) || 1
  const destW = Math.max(1, Math.round(width * sx))
  const destH = Math.max(1, Math.round(height * sy))
  const drawW = Math.max(destW, Math.round(width))
  const drawH = Math.max(destH, Math.round(height))
  const [marchW, marchH] = marchSize(drawW, drawH, spec)
  const exportPass = spec.exportPass === true
  const playing = spec.playing === true
  uniforms.uAA.value = exportPass || !playing ? 1 : 0
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
  ctx.drawImage(renderer.domElement, transform.e || 0, transform.f || 0, destW, destH)
  ctx.restore()
  if (playing && typeof performance !== 'undefined') {
    paintEma = paintEma * 0.82 + (performance.now() - started) * 0.18
  }
}
