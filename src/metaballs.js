import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'
import { metricsAt } from './profileTrack.js'
import {
  PAPER,
  SECTION_BLEND,
  leadColors,
  mulberry32,
  pickRecipe,
  previousSection,
  sectionAt,
  sectionKey,
  sectionSeed,
  shapeCount,
  shapeScale,
} from './shapeLayout.js'

const DT = 1 / 30
const AUDIO_TAU = 0.3
const SECTION_TAU = 1.15
const GROUPS = 8
const PER_GROUP = 8
const MAX_BLOBS = 32
const SIZES = [0.056, 0.044, 0.032, 0.022, 0.018, 0.015, 0.013, 0.011]
const PAPER_RGB = hexToRgb(PAPER).map((channel) => channel / 255)

export const TUNE_DEFAULTS = {
  perColor: 6,
  falloff: 2.7,
  threshold: 0.82,
  opacity: 0.8,
  attract: 1,
  drift: 1,
}

const VERT = `#version 300 es
void main() {
  vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uThreshold;
uniform float uFalloff;
uniform float uOpacity;
uniform int uCount;
uniform int uGroups;
uniform vec4 uBlobs[32];
uniform vec3 uColors[8];
uniform vec3 uPaper;
out vec4 outColor;

float edgeOf(float field) {
  float width = max(fwidth(field) * 0.625, 0.0001);
  return smoothstep(uThreshold - width, uThreshold + width, field);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  p.y = uResolution.y - p.y;
  float fields[8];
  for (int group = 0; group < 8; group++) fields[group] = 0.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uCount) break;
    float radius = uBlobs[i].z;
    if (radius < 0.5) continue;
    vec2 delta = p - uBlobs[i].xy;
    float dist2 = max(dot(delta, delta), 0.35);
    float add = uFalloff * (radius * radius) / dist2;
    int group = int(uBlobs[i].w + 0.5);
    if (group >= 0 && group < 8) fields[group] += add;
  }
  vec3 color = uPaper;
  for (int group = 0; group < 8; group++) {
    if (group >= uGroups) break;
    color = mix(color, uColors[group], edgeOf(fields[group]) * uOpacity);
  }
  outColor = vec4(color, 1.0);
}`

let glCanvas = null
let gl = null
let glProgram = null
let glVao = null
let glError = ''
let simCache = null

function compile(context, type, source) {
  const shader = context.createShader(type)
  context.shaderSource(shader, source)
  context.compileShader(shader)
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    const message = context.getShaderInfoLog(shader) || 'shader failed'
    context.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function ensureGL() {
  if (gl) return true
  if (glError) return false
  try {
    glCanvas = document.createElement('canvas')
    gl = glCanvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    })
    if (!gl) throw new Error('webgl2 unavailable')
    const vertex = compile(gl, gl.VERTEX_SHADER, VERT)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    glProgram = gl.createProgram()
    gl.attachShader(glProgram, vertex)
    gl.attachShader(glProgram, fragment)
    gl.linkProgram(glProgram)
    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(glProgram) || 'link failed')
    }
    glVao = gl.createVertexArray()
    gl.bindVertexArray(glVao)
    gl.useProgram(glProgram)
  } catch (error) {
    glError = error?.message || String(error)
    gl = null
    return false
  }
  return true
}

export function metaballRenderer() {
  ensureGL()
  return gl ? 'webgl2' : glError || 'cpu'
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function tuneOf(spec) {
  const tune = spec?.tune || {}
  return {
    perColor: clamp(tune.perColor ?? TUNE_DEFAULTS.perColor, 4, 8),
    falloff: clamp(tune.falloff ?? TUNE_DEFAULTS.falloff, 0.6, 5),
    threshold: clamp(tune.threshold ?? TUNE_DEFAULTS.threshold, 0.2, 2.4),
    opacity: clamp(tune.opacity ?? TUNE_DEFAULTS.opacity, 0.05, 1),
    attract: clamp(tune.attract ?? TUNE_DEFAULTS.attract, 0, 3),
    drift: clamp(tune.drift ?? TUNE_DEFAULTS.drift, 0, 3),
  }
}

function sectionsOf(spec) {
  if (spec.sections?.length) return spec.sections
  return [{ start: 0, end: Number.POSITIVE_INFINITY, label: spec.sectionLabel || 'Quiet' }]
}

function seedFor(spec, section, sections) {
  if (!section) return spec.seed || 1
  const key = sectionKey(section)
  if (spec.seeds && spec.seeds[key] != null) return spec.seeds[key]
  const index = Math.max(0, sections.findIndex((item) => item.start === section.start && item.label === section.label))
  return spec.seed || sectionSeed(section, index)
}

function paletteEntries(spec) {
  if (spec.palette?.length) return spec.palette
  return (spec.colors || []).map((hex) => ({ id: hex, hex }))
}

function gatherFor(label) {
  if (label === 'Peak') return 1
  if (label === 'Build') return 0.35
  if (label === 'Drop') return 0.05
  return -0.12
}

function smoothToward(current, target, dt, tau) {
  const amount = 1 - Math.exp(-dt / tau)
  return current + (target - current) * amount
}

function wrapAngle(delta) {
  let value = delta
  while (value > Math.PI) value -= Math.PI * 2
  while (value < -Math.PI) value += Math.PI * 2
  return value
}

function sectionParams(spec, section, sections) {
  const seed = seedFor(spec, section, sections)
  const recipe = pickRecipe(seed, section?.label || spec.sectionLabel || 'Quiet', spec.roundness ?? 0.7)
  const index = Math.max(0, sections.findIndex((item) => item.start === section?.start && item.label === section?.label))
  const edit = section ? spec.edits?.[sectionKey(section)] : null
  return {
    seed,
    label: section?.label || 'Quiet',
    count: shapeCount(recipe, edit?.count),
    scale: shapeScale(edit?.size),
    offsetX: edit?.x || 0,
    offsetY: edit?.y || 0,
    colors: leadColors(paletteEntries(spec), index, edit?.colors),
  }
}

function mixHex(from, to, amount) {
  const start = hexToRgb(from)
  const end = hexToRgb(to)
  const channel = (index) => Math.round(start[index] + (end[index] - start[index]) * amount)
  return [channel(0), channel(1), channel(2)]
}

function paramsAt(spec, time) {
  const sections = sectionsOf(spec)
  const section = sectionAt(sections, time) || sections[0]
  const current = sectionParams(spec, section, sections)
  const previous = previousSection(sections, section)
  const elapsed = (time || 0) - (section?.start || 0)
  if (!previous || elapsed < 0 || elapsed >= SECTION_BLEND) return current
  const t = elapsed / SECTION_BLEND
  const eased = t * t * (3 - 2 * t)
  const before = sectionParams(spec, previous, sections)
  const colors = current.colors.map((hex, index) => {
    const from = before.colors[index % before.colors.length]
    const mixed = mixHex(from, hex, eased)
    return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`
  })
  return {
    ...current,
    count: before.count + (current.count - before.count) * eased,
    scale: before.scale + (current.scale - before.scale) * eased,
    offsetX: before.offsetX + (current.offsetX - before.offsetX) * eased,
    offsetY: before.offsetY + (current.offsetY - before.offsetY) * eased,
    colors,
  }
}

function specKey(spec) {
  const sections = sectionsOf(spec).map((section) => `${Number(section.start).toFixed(3)}:${section.label}`).join('|')
  const seeds = spec.seeds ? JSON.stringify(spec.seeds) : String(spec.seed || 1)
  const bass = spec.profile?.timeline?.bass
  const audio = bass?.length ? `${bass.length}:${Math.round((bass[0] || 0) * 1000)}:${Math.round((bass[bass.length - 1] || 0) * 1000)}` : '0'
  return `${spec.tempo || 100}|${sections}|${seeds}|${audio}|${spec.seed || 1}`
}

function createState(spec) {
  const sections = sectionsOf(spec)
  const rand = mulberry32((seedFor(spec, sections[0], sections) || 1) ^ 0x5eed)
  const blobs = []
  for (let group = 0; group < GROUPS; group += 1) {
    const baseAngle = group * 2.399 + (rand() - 0.5) * 0.35
    const baseR = 0.04 + (group % 2) * 0.028 + rand() * 0.012
    const hx = Math.cos(baseAngle) * baseR
    const hy = Math.sin(baseAngle) * baseR
    const parent = blobs.length
    for (let slot = 0; slot < PER_GROUP; slot += 1) {
      const angle = slot * 2.15 + rand() * 0.55
      const dist = slot === 0 ? 0 : (SIZES[0] + SIZES[slot]) * (1.45 + rand() * 0.55)
      const x = hx + Math.cos(angle) * dist
      const y = hy + Math.sin(angle) * dist
      blobs.push({
        x,
        y,
        homeX: x,
        homeY: y,
        vx: (rand() - 0.5) * 0.012,
        vy: (rand() - 0.5) * 0.012,
        r: SIZES[slot],
        group,
        slot,
        parent,
        droplet: slot >= 3,
        phase: rand() * Math.PI * 2,
      })
    }
  }
  return {
    blobs,
    bass: 0,
    high: 0,
    loud: 0,
    split: 0,
    splitHold: 0,
    gather: gatherFor(sections[0]?.label),
    angle: 0,
  }
}

function shownShare(count, groups) {
  const used = Math.max(1, Math.min(GROUPS, groups))
  return Math.min(PER_GROUP, Math.max(0, count) / used, MAX_BLOBS / used)
}

function step(state, time, dt, spec) {
  const params = paramsAt(spec, time)
  const tune = tuneOf(spec)
  const metrics = metricsAt(spec.profile, time)
  const previous = metricsAt(spec.profile, Math.max(0, time - dt))
  const tempo = (spec.tempo || 100) / 110
  state.bass = smoothToward(state.bass, metrics?.bass || 0, dt, AUDIO_TAU)
  state.high = smoothToward(state.high, metrics?.high || 0, dt, AUDIO_TAU)
  state.loud = smoothToward(state.loud, metrics?.loud || 0, dt, AUDIO_TAU)
  state.gather = smoothToward(state.gather, gatherFor(params.label), dt, SECTION_TAU)
  const seedAngle = ((params.seed % 360) * Math.PI) / 180
  state.angle += wrapAngle(seedAngle - state.angle) * (1 - Math.exp(-dt / SECTION_TAU))

  const bassJump = metrics && previous ? metrics.bass - previous.bass : 0
  const highJump = metrics && previous ? metrics.high - previous.high : 0
  const loudJump = metrics && previous ? metrics.loud - previous.loud : 0
  const strongBeat = Boolean(
    metrics &&
      ((bassJump > 0.16 && metrics.bass > 0.45 && bassJump >= highJump) ||
        (loudJump > 0.22 && metrics.loud > 0.62 && metrics.bass > 0.35)),
  )
  const bright = Boolean(metrics && highJump > 0.14 && metrics.high > 0.4)
  if (strongBeat || bright) state.splitHold = Math.max(state.splitHold, 0.22)
  const splitTarget = state.splitHold > 0 ? Math.max(state.high, 0.85) : state.high
  state.split = smoothToward(state.split, splitTarget, dt, AUDIO_TAU)
  state.splitHold = Math.max(0, state.splitHold - dt)

  const groups = Math.max(1, params.colors.length)
  const share = shownShare(params.count, groups)
  const shown = []
  for (const blob of state.blobs) {
    if (blob.group < groups && blob.slot < share) shown.push(blob)
    else {
      blob.x = blob.homeX
      blob.y = blob.homeY
      blob.vx = 0
      blob.vy = 0
    }
  }

  const attract = (0.08 + state.gather * 0.42 + state.bass * 0.55) * tune.attract
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      const dx = shown[j].x - shown[i].x
      const dy = shown[j].y - shown[i].y
      const dist = Math.hypot(dx, dy) + 0.001
      const same = shown[i].group === shown[j].group
      const rest = same ? (shown[i].r + shown[j].r) * 1.7 : 0.22
      const falloff = Math.exp(-Math.max(0, dist - rest) * 1.15)
      const pull = (same ? 1.15 : 0.34) * attract
      const accel = (dist - rest) * pull * falloff
      const ux = dx / dist
      const uy = dy / dist
      shown[i].vx += ux * accel * dt
      shown[i].vy += uy * accel * dt
      shown[j].vx -= ux * accel * dt
      shown[j].vy -= uy * accel * dt
    }
  }

  let cx = 0
  let cy = 0
  let mass = 0
  for (const blob of shown) {
    cx += blob.x * blob.r
    cy += blob.y * blob.r
    mass += blob.r
  }
  if (mass > 0) {
    cx /= mass
    cy /= mass
  }

  const drift = 0.1 * tempo * tune.drift
  for (const blob of shown) {
    blob.vx += Math.cos(state.angle + blob.phase + time * 0.22 * tempo) * drift * dt
    blob.vy += Math.sin(state.angle * 0.85 + blob.phase * 1.35 + time * 0.17 * tempo) * drift * dt
    const hold = (0.62 - state.gather * 0.4) * (blob.droplet ? 1 - state.split * 0.7 : 1)
    blob.vx += (blob.homeX - blob.x) * hold * dt
    blob.vy += (blob.homeY - blob.y) * hold * dt
    blob.vx -= cx * 1.05 * dt
    blob.vy -= cy * 1.05 * dt
    if (blob.droplet) {
      const parent = state.blobs[blob.parent]
      const dx = blob.x - parent.x
      const dy = blob.y - parent.y
      const dist = Math.hypot(dx, dy) + 0.001
      const outward = state.split * 0.72 * tempo
      const home = state.bass * 0.9 - 0.08
      blob.vx += (dx / dist) * outward * dt
      blob.vy += (dy / dist) * outward * dt
      blob.vx += (parent.x + (dx / dist) * 0.03 - blob.x) * home * dt
      blob.vy += (parent.y + (dy / dist) * 0.03 - blob.y) * home * dt
    }
    const reach = blob.r * params.scale * Math.sqrt(Math.max(0.6, tune.falloff) / 0.75)
    const limit = Math.max(0.06, 0.5 - reach * 0.62)
    const box = limit * 0.84
    if (blob.x < -box) blob.vx += (-box - blob.x) * 3.4 * dt
    if (blob.x > box) blob.vx -= (blob.x - box) * 3.4 * dt
    if (blob.y < -box) blob.vy += (-box - blob.y) * 3.4 * dt
    if (blob.y > box) blob.vy -= (blob.y - box) * 3.4 * dt
    blob.vx *= Math.exp(-dt * 0.85)
    blob.vy *= Math.exp(-dt * 0.85)
    const speed = Math.hypot(blob.vx, blob.vy)
    const cap = 0.38 * tempo
    if (speed > cap) {
      blob.vx *= cap / speed
      blob.vy *= cap / speed
    }
    blob.x += blob.vx * dt
    blob.y += blob.vy * dt
    blob.x = clamp(blob.x, -limit, limit)
    blob.y = clamp(blob.y, -limit, limit)
  }
}

function simulate(spec, time) {
  const key = specKey(spec)
  const target = Math.max(0, time || 0)
  if (!simCache || simCache.key !== key || target + 1e-4 < simCache.time) {
    simCache = { key, time: 0, state: createState(spec) }
  }
  let guard = 0
  while (simCache.time < target - 1e-4 && guard < 20000) {
    const dt = Math.min(DT, target - simCache.time)
    step(simCache.state, simCache.time, dt, spec)
    simCache.time += dt
    guard += 1
  }
  return simCache.state
}

function liftColor(red, green, blue) {
  const [hue, saturation, lightness] = rgbToHsl(red, green, blue)
  if (lightness >= 0.48) return [red / 255, green / 255, blue / 255]
  const next = 0.48 + (0.48 - lightness) * 0.2
  const [r, g, b] = hexToRgb(hslToHex(hue, saturation, next))
  return [r / 255, g / 255, b / 255]
}

function rgbOf(color) {
  if (typeof color === 'string' && color.startsWith('rgb')) {
    const parts = color.match(/\d+/g) || [0, 0, 0]
    return liftColor(Number(parts[0]), Number(parts[1]), Number(parts[2]))
  }
  const [red, green, blue] = hexToRgb(color)
  return liftColor(red, green, blue)
}

function blobPixels(spec, state, width, height, bufferWidth, bufferHeight) {
  const params = paramsAt(spec, spec.time || 0)
  const tune = tuneOf(spec)
  const unit = Math.min(width, height)
  const scaleX = bufferWidth / width
  const scaleY = bufferHeight / height
  const pixelScale = (scaleX + scaleY) / 2
  const groups = Math.max(1, Math.min(GROUPS, params.colors.length))
  const share = shownShare(params.count, groups)
  const roundness = clamp(spec.roundness ?? 0.7, 0, 1)
  const threshold = tune.threshold + (0.5 - roundness) * 0.22 - state.loud * 0.08
  const data = new Float32Array(MAX_BLOBS * 4)
  let count = 0
  const spread = Math.sqrt(tune.falloff / Math.max(0.25, threshold))
  for (const blob of state.blobs) {
    if (blob.group >= groups || blob.slot >= share || count >= MAX_BLOBS) continue
    const fade = blob.slot + 1 <= share ? 1 : Math.max(0, share - blob.slot)
    const radius = blob.r * unit * params.scale * fade
    if (radius < 0.5) continue
    let x = width / 2 + blob.x * unit + params.offsetX * width
    let y = height / 2 + blob.y * unit + params.offsetY * height
    const margin = radius * spread * 0.62
    x = clamp(x, margin, Math.max(margin, width - margin))
    y = clamp(y, margin, Math.max(margin, height - margin))
    data[count * 4] = x * scaleX
    data[count * 4 + 1] = y * scaleY
    data[count * 4 + 2] = radius * pixelScale
    data[count * 4 + 3] = blob.group
    count += 1
  }
  const colors = new Float32Array(GROUPS * 3)
  for (let group = 0; group < GROUPS; group += 1) {
    const rgb = rgbOf(params.colors[group % params.colors.length])
    colors[group * 3] = rgb[0]
    colors[group * 3 + 1] = rgb[1]
    colors[group * 3 + 2] = rgb[2]
  }
  return {
    data,
    colors,
    threshold,
    falloff: tune.falloff,
    opacity: tune.opacity,
    count,
    groups,
  }
}

function bufferSize(ctx, width, height) {
  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
  const scaleX = Math.abs(transform?.a || 1) || 1
  const scaleY = Math.abs(transform?.d || 1) || 1
  let bufferWidth = Math.max(2, Math.round(width * scaleX))
  let bufferHeight = Math.max(2, Math.round(height * scaleY))
  const longest = Math.max(bufferWidth, bufferHeight)
  if (longest > 4096) {
    const fit = 4096 / longest
    bufferWidth = Math.max(2, Math.round(bufferWidth * fit))
    bufferHeight = Math.max(2, Math.round(bufferHeight * fit))
  }
  return { bufferWidth, bufferHeight, scaleX, scaleY }
}

function renderGL(ctx, spec, state, width, height) {
  if (!ensureGL()) return null
  const { bufferWidth, bufferHeight } = bufferSize(ctx, width, height)
  if (glCanvas.width !== bufferWidth || glCanvas.height !== bufferHeight) {
    glCanvas.width = bufferWidth
    glCanvas.height = bufferHeight
  }
  const field = blobPixels(spec, state, width, height, bufferWidth, bufferHeight)
  gl.viewport(0, 0, bufferWidth, bufferHeight)
  gl.useProgram(glProgram)
  gl.bindVertexArray(glVao)
  gl.uniform2f(gl.getUniformLocation(glProgram, 'uResolution'), bufferWidth, bufferHeight)
  gl.uniform1f(gl.getUniformLocation(glProgram, 'uThreshold'), field.threshold)
  gl.uniform1f(gl.getUniformLocation(glProgram, 'uFalloff'), field.falloff)
  gl.uniform1f(gl.getUniformLocation(glProgram, 'uOpacity'), field.opacity)
  gl.uniform1i(gl.getUniformLocation(glProgram, 'uCount'), field.count)
  gl.uniform1i(gl.getUniformLocation(glProgram, 'uGroups'), field.groups)
  gl.uniform4fv(gl.getUniformLocation(glProgram, 'uBlobs'), field.data)
  gl.uniform3fv(gl.getUniformLocation(glProgram, 'uColors'), field.colors)
  gl.uniform3f(gl.getUniformLocation(glProgram, 'uPaper'), PAPER_RGB[0], PAPER_RGB[1], PAPER_RGB[2])
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  return glCanvas
}

export function paintMetaballs(ctx, spec) {
  const width = spec.width
  const height = spec.height
  if (!(width > 0) || !(height > 0)) return
  const state = simulate(spec, spec.time || 0)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, width, height)
  const field = renderGL(ctx, spec, state, width, height)
  if (field) {
    const { bufferWidth, bufferHeight, scaleX, scaleY } = bufferSize(ctx, width, height)
    const exact = Math.abs(width * scaleX - bufferWidth) < 0.75 && Math.abs(height * scaleY - bufferHeight) < 0.75
    ctx.imageSmoothingEnabled = !exact
    ctx.drawImage(field, 0, 0, width, height)
  }
  ctx.restore()
}
