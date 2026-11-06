import { hexToRgb } from './palette.js'
import { biggestDropTimes } from './metaballs.js'
import { metricsAt } from './profileTrack.js'
import { PAPER, isHex, labelKind, mulberry32, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

export const RISO_PAPER = '#F2EEE3'
export const RISO_PINK = '#FF48B0'
export const RISO_BLUE = '#0078BF'
export const RISO_YELLOW = '#FFE800'
export const RISO_TEAL = '#00838A'
export const RISO_ORANGE = '#FF6C2F'
export const RISO_BLACK = '#1A1A1A'
export const RISO_INKS = [
  { hex: RISO_PINK, label: 'Fluorescent pink' },
  { hex: RISO_BLUE, label: 'Blue' },
  { hex: RISO_YELLOW, label: 'Yellow' },
  { hex: RISO_TEAL, label: 'Teal' },
  { hex: RISO_ORANGE, label: 'Orange' },
  { hex: RISO_BLACK, label: 'Black' },
]
export const RISO_DEFAULT_INKS = [RISO_BLUE, RISO_PINK]
export const GRAIN_SIZE = { min: 0, max: 100, count: 28 }
export const MISREG_DEFAULT = 40
export const MAX_INKS = 16

const DT = 1 / 30
const SPRING_W = 13.2
const SPRING_Z = 0.86

const VERT = `#version 300 es
void main() {
  vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec3 uPaper;
uniform vec3 uInk1;
uniform vec3 uInk2;
uniform vec2 uOffset1;
uniform vec2 uOffset2;
uniform float uGrain;
uniform float uGrainSalt;
uniform float uDensity;
uniform float uSwap;
uniform float uPass1;
uniform float uPass2;
uniform float uContrast;
uniform float uHasCur;
uniform float uHasPrev;
uniform float uPaperSeed;
uniform sampler2D uCur;
uniform sampler2D uPrev;
out vec4 outColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float coverMask(float pass, float x) {
  if (pass >= 1.0) return 1.0;
  if (pass <= 0.0) return 0.0;
  return 1.0 - smoothstep(pass - 0.028, pass + 0.018, x);
}

vec3 samplePhoto(sampler2D photo, vec2 uv, float has) {
  vec2 clamped = clamp(uv, vec2(0.001), vec2(0.999));
  vec3 sampled = texture(photo, clamped).rgb;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return mix(uPaper, mix(uPaper, sampled, inside), has);
}

float coverageFromLum(float lum, float shadows) {
  float curved = clamp((lum - 0.5) * uContrast + 0.5, 0.0, 1.0);
  float ink1 = 1.0 - smoothstep(0.20, 0.64, curved);
  float ink2 = smoothstep(0.24, 0.58, curved);
  ink2 *= 1.0 - smoothstep(0.90, 0.995, curved) * 0.22;
  return mix(ink2, ink1, shadows);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  p.y = uResolution.y - p.y;
  vec2 uv = p / uResolution;
  float grain = max(uGrain, 0.85);
  vec2 cell = floor(p / grain);
  float speckle = mix(hash21(cell + uGrainSalt), ign(p + uGrainSalt * 12.7), 0.34);
  speckle = clamp(speckle * 0.92 + hash21(p * 0.73 + uGrainSalt) * 0.08, 0.0, 1.0);

  float starve = 0.80 + 0.24 * hash21(floor(p / (grain * 17.0)) + uPaperSeed);
  float paperN = hash21(p * 0.31 + uPaperSeed) * 0.62 + hash21(vec2(p.x * 0.11, floor(p.y / 2.4)) + uPaperSeed) * 0.38;
  vec3 paper = uPaper * (0.965 + paperN * 0.055);

  float mask1 = coverMask(uPass1, uv.x);
  float mask2 = coverMask(uPass2, uv.x);
  vec2 uv1 = uv - uOffset1 / uResolution;
  vec2 uv2 = uv - uOffset2 / uResolution;
  vec3 cur1 = samplePhoto(uCur, uv1, uHasCur);
  vec3 prev1 = samplePhoto(uPrev, uv1, uHasPrev);
  vec3 cur2 = samplePhoto(uCur, uv2, uHasCur);
  vec3 prev2 = samplePhoto(uPrev, uv2, uHasPrev);
  float lum1 = luma(mix(prev1, cur1, mask1));
  float lum2 = luma(mix(prev2, cur2, mask2));

  float dark1 = coverageFromLum(lum1, 1.0);
  float light1 = coverageFromLum(lum1, 0.0);
  float dark2 = coverageFromLum(lum2, 1.0);
  float light2 = coverageFromLum(lum2, 0.0);
  float printed = max(uHasCur, uHasPrev);
  float c1 = mix(dark1, light1, uSwap) * uDensity * starve * printed;
  float c2 = mix(light2, dark2, uSwap) * uDensity * starve * printed;

  float a1 = step(speckle, clamp(c1, 0.0, 1.0));
  float n2 = mix(hash21(cell + uGrainSalt + 91.3), ign(p + 41.2 + uGrainSalt), 0.34);
  float a2 = step(n2, clamp(c2, 0.0, 1.0));

  vec3 color = paper;
  color *= mix(vec3(1.0), uInk1, a1);
  color *= mix(vec3(1.0), uInk2, a2);
  outColor = vec4(color, 1.0);
}`

let glCanvas = null
let gl = null
let glProgram = null
let glVao = null
let glTextureCur = null
let glTexturePrev = null
let glError = ''
let boundCur = ''
let boundPrev = ''
let compiledFrag = ''
let simCache = null

const photos = new Map()
const loading = new Map()

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
  if (gl && compiledFrag === FRAG) return true
  if (gl && compiledFrag !== FRAG) {
    if (glProgram) gl.deleteProgram(glProgram)
    glProgram = null
    compiledFrag = ''
  }
  if (!gl && glError) return false
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
    glTextureCur = gl.createTexture()
    glTexturePrev = gl.createTexture()
    for (const texture of [glTextureCur, glTexturePrev]) {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([242, 238, 227, 255]))
    }
    compiledFrag = FRAG
  } catch (error) {
    glError = error?.message || String(error)
    gl = null
    return false
  }
  return true
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function easeInOut(amount) {
  const t = clamp(amount, 0, 1)
  return t * t * (3 - 2 * t)
}

function hexOf(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

function channels(hex) {
  const [red, green, blue] = hexToRgb(hex)
  return [red / 255, green / 255, blue / 255]
}

function lumaOf(red, green, blue) {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
}

export function risoInksOf(edit) {
  const saved = edit?.inks
  if (Array.isArray(saved) && saved.length >= 2 && isHex(saved[0]) && isHex(saved[1])) {
    return [saved[0], saved[1]]
  }
  return [...RISO_DEFAULT_INKS]
}

function editOf(spec, section) {
  return section ? spec.edits?.[sectionKey(section)] || null : null
}

function inksAt(spec, time) {
  const section = sectionAt(spec.sections || [], time || 0)
  return risoInksOf(editOf(spec, section))
}

function paperAt(spec, time) {
  const section = sectionAt(spec.sections || [], time || 0)
  const saved = section ? spec.edits?.[sectionKey(section)]?.background : null
  if (isHex(saved)) return saved
  const fallback = hexOf(spec.background, RISO_PAPER)
  if (fallback.toLowerCase() === PAPER.toLowerCase()) return RISO_PAPER
  return fallback
}

function grainControl(spec, time) {
  let count = GRAIN_SIZE.count
  if (spec.sections?.length) {
    const section = sectionAt(spec.sections, time || 0)
    const saved = section ? spec.edits?.[sectionKey(section)]?.count : null
    if (saved != null) count = saved
  }
  return clamp(count, GRAIN_SIZE.min, GRAIN_SIZE.max)
}

function grainPixels(control) {
  const t = clamp(control, 0, 100) / 100
  return 1.05 + t * 5.1
}

function misregControl(spec, time) {
  let size = MISREG_DEFAULT
  if (spec.sections?.length) {
    const section = sectionAt(spec.sections, time || 0)
    const saved = section ? spec.edits?.[sectionKey(section)]?.size : null
    if (saved != null) size = saved
  }
  return clamp(size, 0, 100) / 100
}

function contrastOf(spec, time) {
  let slider = 50
  if (spec.sections?.length) {
    const section = sectionAt(spec.sections, time || 0)
    const saved = section ? spec.edits?.[sectionKey(section)]?.contrast : null
    if (saved != null) slider = saved
  }
  return 0.85 + (clamp(slider, 0, 100) / 100) * 1.05
}

function speedOf(spec, time) {
  let slider = Number.isFinite(spec.speed) ? spec.speed : 50
  if (spec.sections?.length) {
    const section = sectionAt(spec.sections, time || 0)
    const saved = section ? spec.edits?.[sectionKey(section)]?.speed : null
    if (saved != null) slider = saved
  }
  const t = clamp(slider, 0, 100) / 100
  if (t <= 0.5) return Math.pow(8, t - 0.5)
  return Math.pow(20, (t - 0.5) * 2)
}

function sectionSeedOf(spec, section, sections) {
  if (!section) return spec.seed || 1
  const key = sectionKey(section)
  if (spec.seeds && spec.seeds[key] != null) return spec.seeds[key]
  const index = Math.max(0, sections.findIndex((item) => item.start === section.start && item.label === section.label))
  return spec.seed || sectionSeed(section, index)
}

function wantedImage(spec, section, sections) {
  const urls = (spec.images || []).filter(Boolean)
  if (!urls.length || !section) return -1
  const ids = spec.imageIds || []
  const saved = spec.edits?.[sectionKey(section)]?.image
  if (saved) {
    const found = ids.indexOf(saved)
    if (found >= 0) return found % urls.length
  }
  if (spec.imageSwitch === 'off') return 0
  const index = sections.findIndex((item) => item.start === section.start && item.label === section.label)
  return Math.max(0, index) % urls.length
}

function aspectKey(width, height) {
  if (!(width > 0) || !(height > 0)) return '1'
  return (width / height).toFixed(4)
}

function sampleSize(aspect) {
  const longSide = 720
  if (aspect >= 1) return { width: longSide, height: Math.max(8, Math.round(longSide / aspect)) }
  return { width: Math.max(8, Math.round(longSide * aspect)), height: longSide }
}

function coverRect(image, aspect) {
  const imageAspect = image.width / Math.max(1, image.height)
  if (imageAspect > aspect) {
    const width = image.height * aspect
    return { x: (image.width - width) / 2, y: 0, width, height: image.height }
  }
  const height = image.width / Math.max(0.01, aspect)
  return { x: 0, y: (image.height - height) / 2, width: image.width, height }
}

function photoKey(url, aspect) {
  return `${url}|${aspectKey(aspect, 1)}|riso`
}

function decodePhoto(url, aspect) {
  const key = photoKey(url, aspect)
  if (photos.has(key)) return Promise.resolve(photos.get(key))
  if (loading.has(key)) return loading.get(key)
  const job = new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        const size = sampleSize(aspect)
        const canvas = document.createElement('canvas')
        canvas.width = size.width
        canvas.height = size.height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const crop = coverRect(image, aspect)
        ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height)
        const pixels = ctx.getImageData(0, 0, size.width, size.height)
        const field = { width: size.width, height: size.height, canvas, pixels: pixels.data }
        photos.set(key, field)
        resolve(field)
      } catch {
        resolve(null)
      } finally {
        loading.delete(key)
      }
    }
    image.onerror = () => {
      loading.delete(key)
      resolve(null)
    }
    image.src = url
  })
  loading.set(key, job)
  return job
}

export function prepareRiso(spec) {
  if (spec?.style !== 'image') return Promise.resolve()
  const aspect = (spec.width || 1) / Math.max(1, spec.height || 1)
  const urls = (spec.images || []).filter(Boolean)
  return Promise.all(urls.map((url) => decodePhoto(url, aspect))).then(() => {})
}

function specKey(spec) {
  const sections = (spec.sections || []).map((section) => `${Number(section.start).toFixed(3)}:${section.label}`).join('|')
  const seeds = spec.seeds ? JSON.stringify(spec.seeds) : String(spec.seed || 1)
  const bass = spec.profile?.timeline?.bass
  const audio = bass?.length ? `${bass.length}:${Math.round((bass[0] || 0) * 1000)}` : '0'
  const images = (spec.images || []).join(',')
  return `${spec.tempo || 100}|${sections}|${seeds}|${audio}|${images}|${spec.imageSwitch || 'section'}|${spec.seed || 1}`
}

function hashUnit(index, salt) {
  let h = Math.imul((index + 1) >>> 0, 0x9e3779b1) ^ Math.imul((salt + 1) >>> 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function hash21(x, y, salt) {
  return hashUnit(Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663), salt)
}

function createState(spec) {
  const sections = spec.sections || []
  const first = sections[0]
  const seed = (sectionSeedOf(spec, first, sections) || 1) >>> 0
  return {
    x1: 1.2,
    y1: -0.9,
    x2: -1.1,
    y2: 1.0,
    v1x: 0,
    v1y: 0,
    v2x: 0,
    v2y: 0,
    density: 1,
    pulse: 0,
    swap: 0,
    grainSalt: seed % 2048,
    highHits: 0,
    beatIndex: -1,
    lastBeat: -10,
    dropTime: -10,
    passStart: -10,
    imageIndex: 0,
    fromIndex: -1,
    sectionKey: '',
    seed,
  }
}

function strongBeat(metrics, previous) {
  if (!metrics || !previous) return false
  const bassJump = metrics.bass - previous.bass
  const highJump = metrics.high - previous.high
  const loudJump = metrics.loud - previous.loud
  return (
    (bassJump > 0.16 && metrics.bass > 0.45 && bassJump >= highJump) ||
    (loudJump > 0.22 && metrics.loud > 0.62 && metrics.bass > 0.35)
  )
}

function barLength(spec) {
  return (60 / Math.max(40, spec.tempo || 100)) * 4
}

function beatLength(spec) {
  return 60 / Math.max(40, spec.tempo || 100)
}

function sectionProgress(section, time) {
  if (!section) return 0
  const span = Math.max(0.001, (section.end || 0) - (section.start || 0))
  return clamp(((time || 0) - (section.start || 0)) / span, 0, 1)
}

function misScale(kind, progress) {
  if (kind === 'Quiet' || kind === 'Intro' || kind === 'Break' || kind === 'Outro') return 0.18
  if (kind === 'Build') return 0.45 + progress * 0.9
  if (kind === 'Drop' || kind === 'Peak' || kind === 'High' || kind === 'Main') return 1.12
  return 0.7
}

function stepSpring(pos, vel, rest, dt) {
  const accel = -SPRING_W * SPRING_W * (pos - rest) - 2 * SPRING_Z * SPRING_W * vel
  const nextVel = vel + accel * dt
  return { pos: pos + nextVel * dt, vel: nextVel }
}

function step(state, time, dt, spec) {
  const sections = spec.sections || []
  const section = sectionAt(sections, time) || sections[0]
  const metrics = metricsAt(spec.profile, time)
  const previous = metricsAt(spec.profile, Math.max(0, time - dt))
  const kind = labelKind(section?.label || '')
  const quiet = kind === 'Quiet' || kind === 'Intro' || kind === 'Break' || kind === 'Outro'
  const progress = sectionProgress(section, time)
  const scale = misScale(kind, progress)
  const speed = Math.sqrt(Math.max(0.18, speedOf(spec, time)))
  const mis = misregControl(spec, time)
  const seed = (sectionSeedOf(spec, section, sections) || 1) >>> 0
  const beat = beatLength(spec)
  const beatIndex = Math.floor(Math.max(0, time) / Math.max(0.08, beat))
  if (beatIndex !== state.beatIndex) {
    state.beatIndex = beatIndex
    state.highHits = 0
  }

  const key = section ? sectionKey(section) : ''
  if (key !== state.sectionKey) {
    const first = state.sectionKey === ''
    state.sectionKey = key
    state.seed = seed
    const wanted = wantedImage(spec, section, sections)
    if (wanted >= 0 && wanted !== state.imageIndex) {
      if (first) {
        state.imageIndex = wanted
        state.fromIndex = -1
        state.passStart = -10
      } else {
        state.fromIndex = state.imageIndex
        state.imageIndex = wanted
        state.passStart = time
      }
    } else if (first && wanted >= 0) {
      state.imageIndex = wanted
    }
  } else {
    const wanted = wantedImage(spec, section, sections)
    if (wanted >= 0 && wanted !== state.imageIndex && time - state.passStart > beat * 0.8) {
      state.fromIndex = state.imageIndex
      state.imageIndex = wanted
      state.passStart = time
    }
  }

  const drift = (quiet ? 0.65 : 1.7) * (0.55 + speed * 0.45)
  const restAmp = (quiet ? 0.45 : 1.35) * (0.7 + mis * 0.6) * scale
  const rest1x = Math.sin(time * 0.11 + seed * 0.001) * drift + 1.15 * restAmp
  const rest1y = Math.cos(time * 0.09 + seed * 0.002) * drift * 0.85 - 0.85 * restAmp
  const rest2x = Math.sin(time * 0.13 + 2.1) * drift * 0.9 - 1.05 * restAmp
  const rest2y = Math.cos(time * 0.08 + 1.4) * drift + 0.95 * restAmp

  const hits = biggestDropTimes(spec)
  const dropHit = hits.some((hit) => hit > time - dt - 0.02 && hit <= time + 0.001)
  const dropEnter = kind === 'Drop' && time - dt < (section?.start || 0) && time >= (section?.start || 0)
  if (dropHit || dropEnter) {
    state.swap = 1
    state.dropTime = time
    const kick = 10 + mis * 5
    const rand = mulberry32((seed ^ Math.imul(Math.floor(time * 30) + 3, 1664525)) >>> 0)
    const a1 = rand() * Math.PI * 2
    const a2 = a1 + Math.PI * (0.6 + rand() * 0.8)
    state.v1x += Math.cos(a1) * kick * 18
    state.v1y += Math.sin(a1) * kick * 18
    state.v2x += Math.cos(a2) * kick * 18
    state.v2y += Math.sin(a2) * kick * 18
  }
  const bar = barLength(spec)
  if (state.swap > 0) state.swap = Math.max(0, 1 - (time - state.dropTime) / Math.max(0.2, bar))

  if (!quiet && strongBeat(metrics, previous) && time - state.lastBeat > 0.28) {
    state.lastBeat = time
    const jump = (3 + mis * 5) * scale * (0.7 + speed * 0.35)
    const rand = mulberry32((seed ^ Math.imul(Math.floor(time * 30) + 1, 1664525)) >>> 0)
    const a1 = rand() * Math.PI * 2
    const a2 = rand() * Math.PI * 2
    state.v1x += Math.cos(a1) * jump * 22
    state.v1y += Math.sin(a1) * jump * 22
    state.v2x += Math.cos(a2) * jump * 22
    state.v2y += Math.sin(a2) * jump * 22
  }

  const bassJump = (metrics?.bass ?? 0) - (previous?.bass ?? 0)
  if (bassJump > 0.14 && (metrics?.bass ?? 0) > 0.4) state.pulse = 1
  else state.pulse = Math.max(0, state.pulse * Math.exp(-dt / 0.2))

  const highJump = (metrics?.high ?? 0) - (previous?.high ?? 0)
  if (highJump > 0.12 && (metrics?.high ?? 0) > 0.38 && state.highHits < 2) {
    state.grainSalt = (state.grainSalt + 1 + Math.floor(hashUnit(beatIndex + 9, seed) * 7)) % 4096
    state.highHits += 1
  }

  const s1 = stepSpring(state.x1, state.v1x, rest1x, dt)
  const t1 = stepSpring(state.y1, state.v1y, rest1y, dt)
  const s2 = stepSpring(state.x2, state.v2x, rest2x, dt)
  const t2 = stepSpring(state.y2, state.v2y, rest2y, dt)
  state.x1 = s1.pos
  state.v1x = s1.vel
  state.y1 = t1.pos
  state.v1y = t1.vel
  state.x2 = s2.pos
  state.v2x = s2.vel
  state.y2 = t2.pos
  state.v2y = t2.vel
  state.density = 1 + state.pulse * 0.22 + (metrics?.bass ?? 0.2) * 0.05
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
    step(simCache.state, simCache.time + dt, dt, spec)
    simCache.time += dt
    guard += 1
  }
  return simCache.state
}

function passAmount(state, time, spec, delayBeats) {
  if (state.passStart < 0) return 1
  const duration = 0.52
  const delay = beatLength(spec) * delayBeats
  return easeInOut((time - state.passStart - delay) / duration)
}

function photoAt(spec, index) {
  const urls = (spec.images || []).filter(Boolean)
  if (!urls.length || index == null || index < 0) return null
  const url = urls[index % urls.length]
  const aspect = (spec.width || 1) / Math.max(1, spec.height || 1)
  return photos.get(photoKey(url, aspect)) || null
}

function bindPhoto(unit, texture, field, keyRef) {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  const key = field ? `${field.width}x${field.height}:${field.canvas ? 'c' : 'x'}:${keyRef}` : `empty:${unit}`
  if (unit === 0 && boundCur === key) return
  if (unit === 1 && boundPrev === key) return
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  if (!field) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([242, 238, 227, 255]))
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, field.canvas)
  }
  if (unit === 0) boundCur = key
  else boundPrev = key
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

function coverageFromLum(lum, contrast, shadows) {
  const curved = clamp((lum - 0.5) * contrast + 0.5, 0, 1)
  const ink1 = 1 - ((curved - 0.2) / 0.44)
  const dark = clamp(ink1 > 1 ? 1 : ink1 < 0 ? 0 : ink1 * ink1 * (3 - 2 * ink1), 0, 1)
  let light = clamp((curved - 0.24) / 0.34, 0, 1)
  light = light * light * (3 - 2 * light)
  const fade = clamp((curved - 0.9) / 0.095, 0, 1)
  light *= 1 - fade * fade * (3 - 2 * fade) * 0.22
  return shadows ? dark : light
}

function paintCPU(ctx, spec, state, width, height) {
  const time = spec.time || 0
  const [ink1, ink2] = inksAt(spec, time)
  const paper = paperAt(spec, time)
  const contrast = contrastOf(spec, time)
  const grain = grainPixels(grainControl(spec, time))
  const pass1 = passAmount(state, time, spec, 0)
  const pass2 = passAmount(state, time, spec, 0.5)
  const cur = photoAt(spec, state.imageIndex)
  const prev = photoAt(spec, state.fromIndex)
  const maxSide = 480
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const bw = Math.max(2, Math.round(width * scale))
  const bh = Math.max(2, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = bw
  canvas.height = bh
  const out = canvas.getContext('2d')
  const image = out.createImageData(bw, bh)
  const data = image.data
  const paperRgb = hexToRgb(paper)
  const ink1Rgb = hexToRgb(ink1)
  const ink2Rgb = hexToRgb(ink2)
  const salt = state.grainSalt || 1
  const paperSeed = (state.seed || 1) % 2048
  const sample = (field, ux, uy) => {
    if (!field) return paperRgb
    const x = clamp(Math.floor(ux * field.width), 0, field.width - 1)
    const y = clamp(Math.floor(uy * field.height), 0, field.height - 1)
    const i = (y * field.width + x) * 4
    return [field.pixels[i], field.pixels[i + 1], field.pixels[i + 2]]
  }
  const mixRgb = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const uvx = x / bw
      const uvy = y / bh
      const px = x / scale
      const py = y / scale
      const cellX = Math.floor(px / grain)
      const cellY = Math.floor(py / grain)
      const speckle = hash21(cellX, cellY, salt)
      const starve = 0.8 + 0.24 * hash21(Math.floor(px / (grain * 17)), Math.floor(py / (grain * 17)), paperSeed)
      const paperN = hash21(x, y, paperSeed)
      const mask1 = uvx < pass1 ? 1 : 0
      const mask2 = uvx < pass2 ? 1 : 0
      const ux1 = uvx - state.x1 / width
      const uy1 = uvy - state.y1 / height
      const ux2 = uvx - state.x2 / width
      const uy2 = uvy - state.y2 / height
      const cur1 = sample(cur, ux1, uy1)
      const prev1 = sample(prev, ux1, uy1)
      const cur2 = sample(cur, ux2, uy2)
      const prev2 = sample(prev, ux2, uy2)
      const c1 = mixRgb(prev1, cur1, mask1)
      const c2 = mixRgb(prev2, cur2, mask2)
      const lum1 = lumaOf(c1[0], c1[1], c1[2])
      const lum2 = lumaOf(c2[0], c2[1], c2[2])
      const dark1 = coverageFromLum(lum1, contrast, true)
      const light1 = coverageFromLum(lum1, contrast, false)
      const dark2 = coverageFromLum(lum2, contrast, true)
      const light2 = coverageFromLum(lum2, contrast, false)
      const a1 = (state.swap * light1 + (1 - state.swap) * dark1) * state.density * starve > speckle ? 1 : 0
      const a2 = (state.swap * dark2 + (1 - state.swap) * light2) * state.density * starve > hash21(cellX, cellY, salt + 91) ? 1 : 0
      let r = paperRgb[0] * (0.965 + paperN * 0.055)
      let g = paperRgb[1] * (0.965 + paperN * 0.055)
      let b = paperRgb[2] * (0.965 + paperN * 0.055)
      r *= 1 - a1 + a1 * (ink1Rgb[0] / 255)
      g *= 1 - a1 + a1 * (ink1Rgb[1] / 255)
      b *= 1 - a1 + a1 * (ink1Rgb[2] / 255)
      r *= 1 - a2 + a2 * (ink2Rgb[0] / 255)
      g *= 1 - a2 + a2 * (ink2Rgb[1] / 255)
      b *= 1 - a2 + a2 * (ink2Rgb[2] / 255)
      const index = (y * bw + x) * 4
      data[index] = clamp(Math.round(r), 0, 255)
      data[index + 1] = clamp(Math.round(g), 0, 255)
      data[index + 2] = clamp(Math.round(b), 0, 255)
      data[index + 3] = 255
    }
  }
  out.putImageData(image, 0, 0)
  ctx.imageSmoothingEnabled = scale < 0.99
  ctx.drawImage(canvas, 0, 0, width, height)
}

export function resetRiso() {
  simCache = null
  boundCur = ''
  boundPrev = ''
  photos.clear()
  loading.clear()
  if (glProgram && gl) gl.deleteProgram(glProgram)
  glProgram = null
  gl = null
  glCanvas = null
  compiledFrag = ''
  glError = ''
}

if (import.meta.hot) import.meta.hot.dispose(resetRiso)

export function explainRiso() {
  return 'The photo is split into two risograph inks that print on paper and mix where they overlap. The layers drift and kick out of register with the beat, then a new image is laid down in two print passes.'
}

export function paintRiso(ctx, spec) {
  const width = spec.width
  const height = spec.height
  if (!(width > 0) || !(height > 0)) return
  const time = spec.time || 0
  const state = simulate(spec, time)
  const urls = (spec.images || []).filter(Boolean)
  const aspect = width / Math.max(1, height)
  if (urls.length) {
    for (const url of urls) {
      if (!photos.has(photoKey(url, aspect)) && !loading.has(photoKey(url, aspect))) decodePhoto(url, aspect)
    }
  }
  if (!ensureGL()) {
    paintCPU(ctx, spec, state, width, height)
    return
  }
  const { bufferWidth, bufferHeight, scaleX, scaleY } = bufferSize(ctx, width, height)
  if (glCanvas.width !== bufferWidth || glCanvas.height !== bufferHeight) {
    glCanvas.width = bufferWidth
    glCanvas.height = bufferHeight
  }
  const [ink1, ink2] = inksAt(spec, time)
  const paper = paperAt(spec, time)
  const cur = photoAt(spec, state.imageIndex)
  const prev = state.fromIndex >= 0 && passAmount(state, time, spec, 0.5) < 0.999 ? photoAt(spec, state.fromIndex) : null
  gl.viewport(0, 0, bufferWidth, bufferHeight)
  gl.useProgram(glProgram)
  gl.bindVertexArray(glVao)
  bindPhoto(0, glTextureCur, cur, `c${state.imageIndex}`)
  bindPhoto(1, glTexturePrev, prev, `p${state.fromIndex}`)
  const location = (name) => gl.getUniformLocation(glProgram, name)
  gl.uniform2f(location('uResolution'), bufferWidth, bufferHeight)
  gl.uniform3fv(location('uPaper'), channels(paper))
  gl.uniform3fv(location('uInk1'), channels(ink1))
  gl.uniform3fv(location('uInk2'), channels(ink2))
  const pixelScale = bufferWidth / Math.max(1, width)
  gl.uniform2f(location('uOffset1'), state.x1 * pixelScale, state.y1 * pixelScale)
  gl.uniform2f(location('uOffset2'), state.x2 * pixelScale, state.y2 * pixelScale)
  gl.uniform1f(location('uGrain'), grainPixels(grainControl(spec, time)) * pixelScale)
  gl.uniform1f(location('uGrainSalt'), state.grainSalt || 1)
  gl.uniform1f(location('uDensity'), state.density || 1)
  gl.uniform1f(location('uSwap'), clamp(state.swap || 0, 0, 1))
  gl.uniform1f(location('uPass1'), passAmount(state, time, spec, 0))
  gl.uniform1f(location('uPass2'), passAmount(state, time, spec, 0.5))
  gl.uniform1f(location('uContrast'), contrastOf(spec, time))
  gl.uniform1f(location('uHasCur'), cur ? 1 : 0)
  gl.uniform1f(location('uHasPrev'), prev ? 1 : 0)
  gl.uniform1f(location('uPaperSeed'), (state.seed || 1) % 2048)
  gl.uniform1i(location('uCur'), 0)
  gl.uniform1i(location('uPrev'), 1)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  const exact = Math.abs(width * scaleX - bufferWidth) < 0.75 && Math.abs(height * scaleY - bufferHeight) < 0.75
  ctx.imageSmoothingEnabled = !exact
  ctx.drawImage(glCanvas, 0, 0, width, height)
}
