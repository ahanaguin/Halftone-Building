import { hexToRgb } from './palette.js'
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
const BLOBS = [
  { x: -0.18, y: 0.02, r: 0.16, group: 0, parent: 0, droplet: false },
  { x: 0.1, y: -0.14, r: 0.13, group: 1, parent: 1, droplet: false },
  { x: 0.2, y: 0.12, r: 0.12, group: 2, parent: 2, droplet: false },
  { x: -0.02, y: 0.15, r: 0.09, group: 0, parent: 0, droplet: false },
  { x: 0.2, y: -0.02, r: 0.085, group: 1, parent: 1, droplet: false },
  { x: -0.14, y: 0.05, r: 0.055, group: 0, parent: 0, droplet: true },
  { x: 0.12, y: -0.1, r: 0.048, group: 1, parent: 1, droplet: true },
  { x: 0.16, y: 0.08, r: 0.044, group: 2, parent: 2, droplet: true },
]

const VERT = `#version 300 es
void main() {
  vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uThreshold;
uniform float uSoftness;
uniform int uCount;
uniform vec4 uBlobs[8];
uniform vec3 uColors[4];
out vec4 outColor;

float edgeOf(float field) {
  float width = fwidth(field) + uSoftness;
  return smoothstep(uThreshold - width, uThreshold + width, field);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  p.y = uResolution.y - p.y;
  float field0 = 0.0;
  float field1 = 0.0;
  float field2 = 0.0;
  float field3 = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    float radius = uBlobs[i].z;
    if (radius < 0.5) continue;
    vec2 delta = p - uBlobs[i].xy;
    float dist2 = max(dot(delta, delta), 0.35);
    float add = (radius * radius) / dist2;
    int group = int(uBlobs[i].w + 0.5);
    if (group == 0) field0 += add;
    else if (group == 1) field1 += add;
    else if (group == 2) field2 += add;
    else field3 += add;
  }
  vec3 ink = vec3(1.0);
  ink *= mix(vec3(1.0), uColors[0], edgeOf(field0));
  ink *= mix(vec3(1.0), uColors[1], edgeOf(field1));
  ink *= mix(vec3(1.0), uColors[2], edgeOf(field2));
  ink *= mix(vec3(1.0), uColors[3], edgeOf(field3));
  outColor = vec4(ink, 1.0);
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
  return gl ? 'webgl2' : 'cpu'
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
  const blobs = BLOBS.map((spot) => ({
    x: spot.x + (rand() - 0.5) * 0.045,
    y: spot.y + (rand() - 0.5) * 0.045,
    vx: (rand() - 0.5) * 0.015,
    vy: (rand() - 0.5) * 0.015,
    r: spot.r,
    group: spot.group,
    parent: spot.parent,
    droplet: spot.droplet,
    phase: rand() * Math.PI * 2,
  }))
  for (const blob of blobs) {
    if (!blob.droplet) continue
    const parent = blobs[blob.parent]
    blob.x = parent.x + Math.cos(blob.phase) * 0.03
    blob.y = parent.y + Math.sin(blob.phase) * 0.03
  }
  for (const blob of blobs) {
    blob.homeX = blob.x
    blob.homeY = blob.y
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

function step(state, time, dt, spec) {
  const sections = sectionsOf(spec)
  const section = sectionAt(sections, time) || sections[0]
  const params = sectionParams(spec, section, sections)
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

  const attract = 0.08 + state.gather * 0.42 + state.bass * 0.55
  const blobs = state.blobs
  for (let i = 0; i < blobs.length; i += 1) {
    for (let j = i + 1; j < blobs.length; j += 1) {
      const dx = blobs[j].x - blobs[i].x
      const dy = blobs[j].y - blobs[i].y
      const dist = Math.hypot(dx, dy) + 0.001
      const same = blobs[i].group === blobs[j].group
      const rest = same ? 0.04 : 0.17
      const falloff = Math.exp(-Math.max(0, dist - rest) * 1.3)
      const pull = (same ? 1.2 : 0.38) * attract
      const accel = (dist - rest) * pull * falloff
      const ux = dx / dist
      const uy = dy / dist
      blobs[i].vx += ux * accel * dt
      blobs[i].vy += uy * accel * dt
      blobs[j].vx -= ux * accel * dt
      blobs[j].vy -= uy * accel * dt
    }
  }

  for (const blob of blobs) {
    const drift = 0.1 * tempo
    blob.vx += Math.cos(state.angle + blob.phase + time * 0.22 * tempo) * drift * dt
    blob.vy += Math.sin(state.angle * 0.85 + blob.phase * 1.35 + time * 0.17 * tempo) * drift * dt
    const hold = 0.7 - state.gather * 0.45
    blob.vx += (blob.homeX - blob.x) * hold * dt
    blob.vy += (blob.homeY - blob.y) * hold * dt
    if (blob.droplet) {
      const parent = blobs[blob.parent]
      const dx = blob.x - parent.x
      const dy = blob.y - parent.y
      const dist = Math.hypot(dx, dy) + 0.001
      const outward = state.split * 0.55 * tempo
      const home = state.bass * 0.85 - 0.12
      blob.vx += (dx / dist) * outward * dt
      blob.vy += (dy / dist) * outward * dt
      blob.vx += ((parent.x + (dx / dist) * 0.028 - blob.x) * home) * dt
      blob.vy += ((parent.y + (dy / dist) * 0.028 - blob.y) * home) * dt
    }
    const margin = 0.3
    if (blob.x < -margin) blob.vx += (-margin - blob.x) * 2.4 * dt
    if (blob.x > margin) blob.vx -= (blob.x - margin) * 2.4 * dt
    if (blob.y < -margin) blob.vy += (-margin - blob.y) * 2.4 * dt
    if (blob.y > margin) blob.vy -= (blob.y - margin) * 2.4 * dt
    blob.vx *= Math.exp(-dt * 0.85)
    blob.vy *= Math.exp(-dt * 0.85)
    const speed = Math.hypot(blob.vx, blob.vy)
    const limit = 0.42 * tempo
    if (speed > limit) {
      blob.vx *= limit / speed
      blob.vy *= limit / speed
    }
    blob.x += blob.vx * dt
    blob.y += blob.vy * dt
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

function rgbOf(color) {
  if (typeof color === 'string' && color.startsWith('rgb')) {
    const parts = color.match(/\d+/g) || [0, 0, 0]
    return [Number(parts[0]) / 255, Number(parts[1]) / 255, Number(parts[2]) / 255]
  }
  const [red, green, blue] = hexToRgb(color)
  return [red / 255, green / 255, blue / 255]
}

function blobPixels(spec, state, width, height, bufferWidth, bufferHeight) {
  const params = paramsAt(spec, spec.time || 0)
  const unit = Math.min(width, height)
  const scaleX = bufferWidth / width
  const scaleY = bufferHeight / height
  const data = new Float32Array(8 * 4)
  for (let index = 0; index < state.blobs.length; index += 1) {
    const blob = state.blobs[index]
    const fade = Math.min(1, Math.max(0, params.count - index))
    const radius = blob.r * unit * params.scale * fade
    const x = (width / 2 + blob.x * unit + params.offsetX * width) * scaleX
    const y = (height / 2 + blob.y * unit + params.offsetY * height) * scaleY
    data[index * 4] = x
    data[index * 4 + 1] = y
    data[index * 4 + 2] = radius * ((scaleX + scaleY) / 2)
    data[index * 4 + 3] = blob.group
  }
  const colors = new Float32Array(12)
  for (let group = 0; group < 4; group += 1) {
    const rgb = rgbOf(params.colors[group % params.colors.length])
    colors[group * 3] = rgb[0]
    colors[group * 3 + 1] = rgb[1]
    colors[group * 3 + 2] = rgb[2]
  }
  const roundness = Math.min(1, Math.max(0, spec.roundness ?? 0.7))
  const threshold = 1.18 - roundness * 0.38 - state.loud * 0.2
  const softness = 0.012 + roundness * 0.03
  return { data, colors, threshold, softness, count: state.blobs.length }
}

function renderGL(spec, state, width, height) {
  if (!ensureGL()) return null
  const longest = Math.max(width, height)
  const pixelScale = Math.min(2, 1400 / longest)
  const bufferWidth = Math.max(2, Math.round(width * pixelScale))
  const bufferHeight = Math.max(2, Math.round(height * pixelScale))
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
  gl.uniform1f(gl.getUniformLocation(glProgram, 'uSoftness'), field.softness)
  gl.uniform1i(gl.getUniformLocation(glProgram, 'uCount'), field.count)
  gl.uniform4fv(gl.getUniformLocation(glProgram, 'uBlobs'), field.data)
  gl.uniform3fv(gl.getUniformLocation(glProgram, 'uColors'), field.colors)
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
  const field = renderGL(spec, state, width, height)
  if (field) {
    ctx.imageSmoothingEnabled = true
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(field, 0, 0, width, height)
  }
  ctx.restore()
}
