import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'
import { biggestDropTimes } from './metaballs.js'
import { metricsAt } from './profileTrack.js'
import { INK_BLACK, PAPER, labelKind, mulberry32, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

const DT = 1 / 30
const AUDIO_TAU = 0.3

export const DOT_DENSITY = { min: 12, max: 42, count: 24 }
export const DOT_SIZE_DEFAULT = 64

const VERT = `#version 300 es
void main() {
  vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec2 uOrigin;
uniform float uSpacing;
uniform float uMinR;
uniform float uMaxR;
uniform float uReveal;
uniform float uFuse;
uniform float uBloom;
uniform float uContrast;
uniform float uThreshold;
uniform int uZoneCount;
uniform vec3 uZones[3];
uniform int uRippleCount;
uniform vec4 uRipples[3];
uniform vec3 uInk;
uniform vec3 uPaper;
uniform sampler2D uLum;
out vec4 outColor;

float edgeOf(float field) {
  float width = max(fwidth(field) * 0.75, 0.012);
  return smoothstep(uThreshold - width, uThreshold + width, field);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  p.y = uResolution.y - p.y;
  vec2 uv = p / uResolution;
  float shortSide = min(uResolution.x, uResolution.y);
  vec2 frame = uResolution / shortSide;
  float zone = uBloom;
  for (int i = 0; i < 3; i++) {
    if (i >= uZoneCount) break;
    float dist = length((uv - uZones[i].xy) * frame);
    float radius = max(uZones[i].z, 0.001);
    zone = max(zone, 1.0 - smoothstep(radius * 0.7, radius, dist));
  }
  float ripple = 0.0;
  for (int i = 0; i < 3; i++) {
    if (i >= uRippleCount) break;
    float dist = length((uv - uRipples[i].xy) * frame);
    float band = exp(-pow((dist - uRipples[i].z) / 0.045, 2.0));
    ripple = max(ripple, band * uRipples[i].w);
  }
  vec2 local = (p - uOrigin) / uSpacing;
  ivec2 cell = ivec2(floor(local + 0.5));
  float field = 0.0;
  for (int j = 0; j < 25; j++) {
    int dx = j - (j / 5) * 5 - 2;
    int dy = j / 5 - 2;
    ivec2 spot = cell + ivec2(dx, dy);
    vec2 center = uOrigin + vec2(spot) * uSpacing;
    vec2 dotUv = center / uResolution;
    if (dotUv.x < 0.0 || dotUv.y < 0.0 || dotUv.x > 1.0 || dotUv.y > 1.0) continue;
    float lum = texture(uLum, dotUv).r;
    float curved = clamp((lum - 0.5) * uContrast + 0.5, 0.0, 1.0);
    float darkness = pow(clamp(1.0 - curved, 0.0, 1.0), 0.9);
    float pictured = mix(uMinR, uMaxR * mix(0.2, 1.0, darkness), uReveal);
    float radius = mix(uMinR, pictured, zone);
    radius *= 1.0 + zone * smoothstep(0.78, 0.96, darkness) * uFuse * 0.8 + ripple * 0.22;
    vec2 delta = p - center;
    float limit = max(radius * radius, 0.0001);
    float falloff = clamp(1.0 - dot(delta, delta) / limit, 0.0, 1.0);
    field += falloff * falloff;
  }
  vec3 color = mix(uPaper, uInk, edgeOf(field));
  outColor = vec4(color, 1.0);
}`

let glCanvas = null
let gl = null
let glProgram = null
let glVao = null
let glTexture = null
let glError = ''
let boundField = null
let simCache = null

const fields = new Map()
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

let compiledFrag = ''

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
    glTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, glTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
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

function smoothToward(current, target, dt, tau) {
  const amount = 1 - Math.exp(-dt / Math.max(0.04, tau))
  return current + (target - current) * amount
}

function hexOf(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

function channels(hex) {
  const [red, green, blue] = hexToRgb(hex)
  return [red / 255, green / 255, blue / 255]
}

function mixHex(from, to, amount) {
  const start = hexToRgb(from)
  const end = hexToRgb(to)
  const channel = (index) => Math.round(start[index] + (end[index] - start[index]) * amount).toString(16).padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

function sectionDots(spec, section) {
  const fallback = hexOf(spec.dots, INK_BLACK)
  if (!section) return fallback
  const saved = spec.edits?.[sectionKey(section)]?.dots
  return hexOf(saved, fallback)
}

function dotsAt(spec, time) {
  const sections = spec.sections || []
  if (!sections.length) return sectionDots(spec, null)
  const now = Math.max(0, time || 0)
  const fade = 1.5
  for (let index = 1; index < sections.length; index += 1) {
    const boundary = sections[index].start
    const begin = boundary - fade
    if (now < begin || now >= boundary) continue
    const t = (now - begin) / fade
    const eased = t * t * (3 - 2 * t)
    return mixHex(sectionDots(spec, sections[index - 1]), sectionDots(spec, sections[index]), eased)
  }
  return sectionDots(spec, sectionAt(sections, now) || sections[0])
}

function darkGround(hex) {
  const [red, green, blue] = hexToRgb(hex)
  const [hue, saturation, lightness] = rgbToHsl(red, green, blue)
  return hslToHex(hue, Math.min(saturation, 0.62), lightness > 0.2 ? 0.08 : lightness)
}

export function halftoneColors(spec, time) {
  const paper = hexOf(spec.background, PAPER)
  const ink = dotsAt(spec, time)
  if (!invertedAt(spec, time)) return { ink, paper }
  return { ink: paper, paper: darkGround(ink) }
}

function invertedAt(spec, time) {
  const sections = spec.sections || []
  const section = sectionAt(sections, time || 0)
  if (!section) return false
  if (labelKind(section.label) === 'Drop') return true
  const drops = biggestDropTimes(spec)
  return drops.some((hit) => hit >= section.start - 0.04 && hit <= (time || 0) + 0.001)
}

function densityOf(spec, time) {
  let count = DOT_DENSITY.count
  if (spec.sections?.length) {
    const section = sectionAt(spec.sections, time || 0)
    const saved = section ? spec.edits?.[sectionKey(section)]?.count : null
    if (saved != null) count = saved
  }
  return clamp(count, DOT_DENSITY.min, DOT_DENSITY.max)
}

function sizeOf(spec, time) {
  let size = DOT_SIZE_DEFAULT
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

function zoneFraction(label, loud) {
  const kind = labelKind(label)
  const level = clamp(loud, 0, 1)
  if (kind === 'Main' || kind === 'High' || kind === 'Peak') return 0.6 + level * 0.2
  if (kind === 'Build') return 0.34 + level * 0.16
  if (kind === 'Drop') return 0.6 + level * 0.2
  return 0.2 + level * 0.1
}

function coverRadius(fraction, count, width, height) {
  const shortSide = Math.max(1, Math.min(width, height))
  const aspect = Math.max(width, height) / shortSide
  const each = (fraction * aspect) / Math.max(1, count)
  return Math.sqrt(Math.max(0.012, each / Math.PI)) / 0.58
}

function wantedImage(spec, section, sections) {
  const urls = (spec.images || []).filter(Boolean)
  if (!urls.length || !section) return 0
  const ids = spec.imageIds || []
  const saved = spec.edits?.[sectionKey(section)]?.image
  if (saved) {
    const found = ids.indexOf(saved)
    if (found >= 0) return found % urls.length
  }
  if (spec.imageSwitch === 'off') return -1
  const index = sections.findIndex((item) => item.start === section.start && item.label === section.label)
  return Math.max(0, index) % urls.length
}

function motionOf(spec, time) {
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

function aspectKey(width, height) {
  if (!(width > 0) || !(height > 0)) return '1'
  return (width / height).toFixed(4)
}

function sampleSize(aspect) {
  const longSide = 180
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

function encodeLuminance(pixels) {
  const bytes = new Uint8Array(pixels.length / 4)
  for (let index = 0; index < bytes.length; index += 1) {
    const offset = index * 4
    const lum = (0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]) / 255
    bytes[index] = Math.round(clamp(lum, 0, 1) * 255)
  }
  return bytes
}

function fieldKey(url, aspect) {
  return `${url}|${aspectKey(aspect, 1)}|lum`
}

function decodeField(url, aspect) {
  const key = fieldKey(url, aspect)
  if (fields.has(key)) return Promise.resolve(fields.get(key))
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
        const pixels = ctx.getImageData(0, 0, size.width, size.height).data
        const field = { width: size.width, height: size.height, bytes: encodeLuminance(pixels) }
        fields.set(key, field)
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

export function prepareHalftone(spec) {
  if (spec?.style !== 'image') return Promise.resolve()
  const aspect = (spec.width || 1) / Math.max(1, spec.height || 1)
  const urls = (spec.images || []).filter(Boolean)
  return Promise.all(urls.map((url) => decodeField(url, aspect))).then(() => {})
}

function specKey(spec) {
  const sections = (spec.sections || []).map((section) => `${Number(section.start).toFixed(3)}:${section.label}`).join('|')
  const seeds = spec.seeds ? JSON.stringify(spec.seeds) : String(spec.seed || 1)
  const bass = spec.profile?.timeline?.bass
  const audio = bass?.length ? `${bass.length}:${Math.round((bass[0] || 0) * 1000)}` : '0'
  const images = (spec.images || []).join(',')
  return `${spec.tempo || 100}|${sections}|${seeds}|${audio}|${images}|${spec.imageSwitch || 'section'}|${spec.seed || 1}`
}

function sectionSeedOf(spec, section, sections) {
  if (!section) return spec.seed || 1
  const key = sectionKey(section)
  if (spec.seeds && spec.seeds[key] != null) return spec.seeds[key]
  const index = Math.max(0, sections.findIndex((item) => item.start === section.start && item.label === section.label))
  return spec.seed || sectionSeed(section, index)
}

function createState(spec) {
  const sections = spec.sections || []
  const first = sections[0]
  const rand = mulberry32(sectionSeedOf(spec, first, sections) || 1)
  const count = 1 + Math.floor(rand() * 3)
  const zones = []
  for (let index = 0; index < count; index += 1) {
    zones.push({
      x: rand(),
      y: rand(),
      angle: rand() * Math.PI * 2,
      turn: rand() * Math.PI * 2,
    })
  }
  return {
    zones,
    ripples: [],
    lastRipple: -1,
    loud: 0.35,
    bass: 0.2,
    reach: 0.2,
    fuse: 0,
    bloom: 0,
    reveal: 1,
    revealHold: 0,
    imageIndex: 0,
    pendingIndex: null,
    sectionKey: '',
    beatSalt: (sectionSeedOf(spec, first, sections) || 1) >>> 0,
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

function step(state, time, dt, spec) {
  const sections = spec.sections || []
  const section = sectionAt(sections, time) || sections[0]
  const metrics = metricsAt(spec.profile, time)
  const previous = metricsAt(spec.profile, Math.max(0, time - dt))
  state.loud = smoothToward(state.loud, metrics?.loud ?? 0.35, dt, AUDIO_TAU)
  state.bass = smoothToward(state.bass, metrics?.bass ?? 0.2, dt, AUDIO_TAU)
  const bassJump = (metrics?.bass ?? 0) - (previous?.bass ?? 0)
  if (bassJump > 0.16 && (metrics?.bass ?? 0) > 0.45) state.fuse = 1
  else state.fuse = Math.max(0, state.fuse * Math.exp(-dt / 0.09))
  const fraction = zoneFraction(section?.label, state.loud)
  const radius = coverRadius(fraction, state.zones.length, spec.width || 1, spec.height || 1)
  state.reach = smoothToward(state.reach || radius, radius, dt, 0.35)
  const hits = biggestDropTimes(spec)
  if (hits.some((hit) => hit > time - dt - 0.02 && hit <= time + 0.001)) state.bloom = 1
  state.bloom = Math.max(0, state.bloom - dt / 0.72)
  const drift = (0.045 + ((spec.tempo || 100) / 120) * 0.03) * Math.sqrt(Math.max(0.2, motionOf(spec, time)))
  for (const zone of state.zones) {
    zone.angle += Math.sin(time * 0.37 + zone.turn) * 0.55 * dt
    zone.x += Math.cos(zone.angle) * drift * dt
    zone.y += Math.sin(zone.angle) * drift * dt
    if (zone.x < -0.2) zone.x += 1.4
    if (zone.x > 1.2) zone.x -= 1.4
    if (zone.y < -0.2) zone.y += 1.4
    if (zone.y > 1.2) zone.y -= 1.4
  }
  if (strongBeat(metrics, previous) && time - state.lastRipple > 0.22) {
    const rand = mulberry32((state.beatSalt ^ Math.imul(Math.floor(time * 30) + 1, 1664525)) >>> 0)
    state.ripples.push({ x: rand(), y: rand(), born: time })
    state.lastRipple = time
    if (state.ripples.length > 3) state.ripples.shift()
  }
  state.ripples = state.ripples.filter((ripple) => time - ripple.born < 0.9)
  const key = section ? sectionKey(section) : ''
  let firstSection = false
  let justEntered = false
  if (key !== state.sectionKey) {
    justEntered = state.sectionKey !== ''
    firstSection = state.sectionKey === ''
    state.sectionKey = key
    state.beatSalt = (sectionSeedOf(spec, section, sections) || 1) >>> 0
    if ((justEntered || firstSection) && labelKind(section?.label || '') === 'Drop') state.bloom = 1
  }
  const wanted = wantedImage(spec, section, sections)
  if (wanted >= 0 && wanted !== state.imageIndex && state.pendingIndex == null && state.revealHold <= 0) {
    if (firstSection) state.imageIndex = wanted
    else {
      state.pendingIndex = wanted
      state.revealHold = 0.46
    }
  }
  if (state.revealHold > 0) {
    state.reveal = smoothToward(state.reveal, 0, dt, 0.1)
    state.revealHold = Math.max(0, state.revealHold - dt)
    if (state.revealHold <= 0 && state.pendingIndex != null) {
      state.imageIndex = state.pendingIndex
      state.pendingIndex = null
    }
  } else {
    state.reveal = smoothToward(state.reveal, 1, dt, 0.34)
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

function activeField(spec, state) {
  const images = (spec.images || []).filter(Boolean)
  if (!images.length) return null
  const url = images[state.imageIndex % images.length]
  const aspect = (spec.width || 1) / Math.max(1, spec.height || 1)
  return fields.get(fieldKey(url, aspect)) || null
}

function bindField(field) {
  if (!gl) return
  gl.bindTexture(gl.TEXTURE_2D, glTexture)
  if (field === boundField) return
  boundField = field
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  if (!field) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
    return
  }
  const rgba = new Uint8Array(field.width * field.height * 4)
  for (let index = 0; index < field.bytes.length; index += 1) {
    const tone = field.bytes[index]
    rgba[index * 4] = tone
    rgba[index * 4 + 1] = tone
    rgba[index * 4 + 2] = tone
    rgba[index * 4 + 3] = 255
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, field.width, field.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
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

function paintCPU(ctx, spec, state, width, height) {
  const { ink, paper } = halftoneColors(spec, spec.time || 0)
  const density = densityOf(spec, spec.time || 0)
  const spacing = Math.min(width, height) / density
  const amount = sizeOf(spec, spec.time || 0)
  const maxR = spacing * (0.22 + amount * 0.36)
  const minR = spacing * 0.085
  const contrast = contrastOf(spec, spec.time || 0)
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = ink
  const cols = Math.max(1, Math.floor(width / spacing))
  const rows = Math.max(1, Math.floor(height / spacing))
  const originX = (width - (cols - 1) * spacing) / 2
  const originY = (height - (rows - 1) * spacing) / 2
  const field = activeField(spec, state)
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const cx = originX + x * spacing
      const cy = originY + y * spacing
      if (cx < 0 || cy < 0 || cx > width || cy > height) continue
      let darkness = 0
      if (field) {
        const px = clamp(Math.floor((cx / width) * field.width), 0, field.width - 1)
        const py = clamp(Math.floor((cy / height) * field.height), 0, field.height - 1)
        const lum = field.bytes[py * field.width + px] / 255
        const curved = clamp((lum - 0.5) * contrast + 0.5, 0, 1)
        darkness = (1 - curved) ** 0.9
      }
      const pictured = minR + (maxR * (0.2 + 0.8 * darkness) - minR) * state.reveal
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(0.5, pictured), 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

export function paintHalftone(ctx, spec) {
  const width = spec.width
  const height = spec.height
  if (!(width > 0) || !(height > 0)) return
  const time = spec.time || 0
  const state = simulate(spec, time)
  const urls = (spec.images || []).filter(Boolean)
  if (urls.length) {
    const aspect = width / height
    for (const url of urls) {
      if (!fields.has(fieldKey(url, aspect)) && !loading.has(fieldKey(url, aspect))) decodeField(url, aspect)
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
  const density = densityOf(spec, time)
  const spacing = (Math.min(width, height) / density) * (bufferWidth / width)
  const amount = sizeOf(spec, time)
  const maxR = spacing * (0.22 + amount * 0.36)
  const minR = spacing * 0.085
  const cols = Math.max(1, Math.floor(bufferWidth / spacing))
  const rows = Math.max(1, Math.floor(bufferHeight / spacing))
  const originX = (bufferWidth - (cols - 1) * spacing) / 2
  const originY = (bufferHeight - (rows - 1) * spacing) / 2
  const { ink, paper } = halftoneColors(spec, time)
  const reach = state.reach
  const zones = state.zones.slice(0, 3)
  while (zones.length < 3) zones.push({ x: 0, y: 0 })
  const ripples = state.ripples.slice(-3)
  while (ripples.length < 3) ripples.push(null)
  gl.viewport(0, 0, bufferWidth, bufferHeight)
  gl.useProgram(glProgram)
  gl.bindVertexArray(glVao)
  bindField(activeField(spec, state))
  const location = (name) => gl.getUniformLocation(glProgram, name)
  gl.uniform2f(location('uResolution'), bufferWidth, bufferHeight)
  gl.uniform2f(location('uOrigin'), originX, originY)
  gl.uniform1f(location('uSpacing'), spacing)
  gl.uniform1f(location('uMinR'), minR)
  gl.uniform1f(location('uMaxR'), maxR)
  gl.uniform1f(location('uReveal'), state.reveal)
  gl.uniform1f(location('uFuse'), state.fuse)
  gl.uniform1f(location('uBloom'), state.bloom)
  gl.uniform1f(location('uContrast'), contrastOf(spec, time))
  gl.uniform1f(location('uThreshold'), 0.16)
  gl.uniform1i(location('uZoneCount'), Math.min(3, state.zones.length))
  gl.uniform3fv(location('uZones'), new Float32Array(zones.flatMap((zone) => [zone.x, zone.y, reach])))
  gl.uniform1i(location('uRippleCount'), state.ripples.length)
  gl.uniform4fv(
    location('uRipples'),
    new Float32Array(
      ripples.flatMap((ripple) => {
        if (!ripple) return [0, 0, 0, 0]
        const age = Math.max(0, time - ripple.born)
        return [ripple.x, ripple.y, age * 0.95, Math.max(0, 1 - age / 0.8)]
      }),
    ),
  )
  gl.uniform3fv(location('uInk'), channels(ink))
  gl.uniform3fv(location('uPaper'), channels(paper))
  gl.uniform1i(location('uLum'), 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  const exact = Math.abs(width * scaleX - bufferWidth) < 0.75 && Math.abs(height * scaleY - bufferHeight) < 0.75
  ctx.imageSmoothingEnabled = !exact
  ctx.drawImage(glCanvas, 0, 0, width, height)
}
