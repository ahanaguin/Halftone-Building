import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'
import { metricsAt } from './profileTrack.js'
import { PAPER, isHex, labelKind, mulberry32, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

export const BLOOM_COUNT = { min: 150, max: 1200, count: 420 }
export const MAX_DOT_COLORS = 4
export const DEFAULT_DOT_COLOR = '#F3F0EA'
export const COLOR_MODES = [
  { id: 'single', label: 'Single color' },
  { id: 'arms', label: 'Along arms' },
  { id: 'rings', label: 'Center to edge' },
]

const DEG = Math.PI / 180
const GOLDEN = Math.PI * (3 - Math.sqrt(5))
const FILL = 0.74
const RING_INNER = 0.58
const FIB = [8, 13, 21, 34, 55]

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function easeInOut(amount) {
  const t = clamp(amount, 0, 1)
  return t * t * (3 - 2 * t)
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

export function countOf(spec, section) {
  const value = editOf(spec, section).count
  const count = value == null ? BLOOM_COUNT.count : Math.round(Number(value))
  return clamp(count || BLOOM_COUNT.count, BLOOM_COUNT.min, BLOOM_COUNT.max)
}

function sizeOf(spec, section) {
  return clamp(Number(editOf(spec, section).size ?? 50), 0, 100) / 100
}

export function bloomDotColorsOf(edit) {
  const list = Array.isArray(edit?.dotColors) ? edit.dotColors.filter(isHex) : []
  return list.length ? list.slice(0, MAX_DOT_COLORS) : [DEFAULT_DOT_COLOR]
}

export function colorModeOf(edit) {
  const mode = edit?.colorMode
  if (mode === 'arms' || mode === 'rings') return mode
  return 'single'
}

function visibleInk(hex, background) {
  const ink = isHex(hex) ? hex : DEFAULT_DOT_COLOR
  const ground = isHex(background) ? background : PAPER
  const [r, g, b] = hexToRgb(ink)
  const [br, bg, bb] = hexToRgb(ground)
  const [h, s, l] = rgbToHsl(r, g, b)
  const [, , bl] = rgbToHsl(br, bg, bb)
  const dist = Math.hypot(r - br, g - bg, b - bb) / 441.67
  if (dist >= 0.22 && Math.abs(l - bl) >= 0.18) return ink
  const target = bl > 0.55 ? Math.min(l, 0.32) : Math.max(l, 0.78)
  if (Math.abs(target - bl) < 0.18) return hslToHex(h, Math.max(s, 0.04), bl > 0.5 ? 0.16 : 0.9)
  return hslToHex(h, s, target)
}

function inksOf(spec, section, background) {
  return bloomDotColorsOf(editOf(spec, section)).map((hex) => visibleInk(hex, background))
}

function sectionAngle(seed) {
  const rand = mulberry32((seed || 1) >>> 0)
  return GOLDEN + (rand() - 0.5) * 0.1 * DEG
}

function divergenceAt(spec, time) {
  const sections = spec.sections || []
  const section = sectionAt(sections, time)
  const index = section ? sections.findIndex((item) => item.start === section.start && item.label === section.label) : -1
  const drift = Math.sin(time * 0.11) * 0.05 * DEG
  if (!section || index < 0) return GOLDEN + drift
  const targetOf = (item, i) => sectionAngle(sectionSeedOf(spec, item, i))
  const to = targetOf(section, index)
  const tempo = Math.max(40, spec.tempo || 100)
  const duration = (60 / tempo) * 8
  if (!index) return to + drift
  const from = targetOf(sections[index - 1], index - 1)
  const mix = easeInOut((time - section.start) / duration)
  return from + (to - from) * mix + drift
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

function bassBreathe(spec, time) {
  let total = 0
  let weight = 0
  const tau = 0.75
  for (let step = 0; step < 12; step += 1) {
    const age = step * 0.07
    const gain = Math.exp(-age / tau)
    total += (sampleAt(spec, Math.max(0, time - age)).bass ?? 0.4) * gain
    weight += gain
  }
  return clamp((total / weight - 0.44) * 0.055, -0.02, 0.02)
}

function waveCap(kind, loud) {
  if (kind === 'Quiet' || kind === 'Intro' || kind === 'Break' || kind === 'Outro') return 1
  const high = kind === 'High' || kind === 'Drop' || kind === 'Peak' || kind === 'Main'
  const cap = high ? 4 : 2
  return clamp(1 + Math.round(clamp(loud, 0, 1) * (cap - 1)), 1, cap)
}

function armStep(count, salt) {
  const steps = FIB.filter((step) => step < count / 3)
  const list = steps.length ? steps : [8]
  return list[Math.floor(hashUnit(salt, 11) * list.length)]
}

function wavesAt(spec, time, count, seed, tempo, kind, loud) {
  const period = 60 / Math.max(40, tempo)
  const speed = clamp(Number(spec.speed ?? 50), 0, 100) / 100
  const quiet = kind === 'Quiet' || kind === 'Intro' || kind === 'Break' || kind === 'Outro'
  const duration = period * (6.8 - speed * 1.4) * (quiet ? 1.15 : 1)
  const wanted = waveCap(kind, loud)
  const stride = quiet ? Math.max(5, Math.round(duration / period)) : 1
  const beatNow = Math.floor(Math.max(0, time) / period)
  const picked = []
  for (let beat = beatNow; beat >= 0; beat -= 1) {
    const start = beat * period
    if (time - start > duration) break
    if (beat % stride !== 0) continue
    if (!quiet && hashUnit(beat, seed ^ 0x45) > 0.78) continue
    const origin = Math.floor(hashUnit(beat, seed) * Math.max(1, count * 0.7))
    const step = armStep(count, (seed ^ Math.imul(beat + 3, 0x9e3779b1)) >>> 0)
    picked.push({ start, origin, step, duration, beat })
    if (picked.length >= wanted) break
  }
  return picked
}

function morphAlong(u, filled, starBias) {
  const rest = filled ? 'fill' : 'stroke'
  if (u <= 0 || u >= 1) return { mode: rest, scale: 1 }
  const fillEnd = 0.5 - starBias * 0.16
  const starEnd = 0.78 + starBias * 0.1
  let mode = rest
  if (u < 0.22) mode = rest
  else if (u < fillEnd) mode = 'fill'
  else if (u < starEnd) mode = 'star'
  else mode = rest
  return { mode, scale: 1 + Math.sin(u * Math.PI) * 0.22 }
}

function colorFor(n, count, colors, mode, armCount) {
  if (colors.length <= 1 || mode === 'single') return colors[0]
  if (mode === 'rings') {
    const t = count <= 1 ? 0 : Math.sqrt(n / (count - 1))
    return colors[Math.min(colors.length - 1, Math.floor(t * colors.length))]
  }
  return colors[((n % armCount) + armCount) % colors.length]
}

function traceStar(ctx, x, y, radius, rotation) {
  const points = 4
  ctx.beginPath()
  for (let i = 0; i < points * 2; i += 1) {
    const arm = i % 2 === 0 ? radius : radius * 0.42
    const angle = rotation - Math.PI / 2 + (i * Math.PI) / points
    const px = x + Math.cos(angle) * arm
    const py = y + Math.sin(angle) * arm
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

export function explainBloom() {
  return 'Dots sit in a sunflower spiral and stay still until a beat sends a small wave along one arm. The wave briefly fills a few rings or turns them into stars, then they settle; a new section eases the spiral to a slightly different angle.'
}

export function layoutBloom(spec) {
  const width = Math.max(1, spec.width || 1)
  const height = Math.max(1, spec.height || 1)
  const time = spec.time || 0
  const sections = spec.sections || []
  const section = sectionAt(sections, time)
  const index = section ? sections.findIndex((item) => item.start === section.start && item.label === section.label) : 0
  const seed = sectionSeedOf(spec, section, Math.max(0, index))
  const edit = editOf(spec, section)
  const count = countOf(spec, section)
  const size = sizeOf(spec, section)
  const ring = edit.composition === 'ring'
  const filled = edit.filled === true
  const kind = labelKind(section?.label)
  const tempo = Math.max(40, spec.tempo || 100)
  const speed = clamp(Number(spec.speed ?? 50), 0, 100) / 100
  const spin = time * ((Math.PI * 2) / (90 - speed * 30))
  const divergence = divergenceAt(spec, time)
  const shortSide = Math.min(width, height)
  const c = count > 1 ? (shortSide * (FILL / 2)) / Math.sqrt(count - 1) : shortSide * 0.08
  const breathe = 1 + bassBreathe(spec, time)
  const spacing = c
  const dotR = spacing * (0.14 + size * 0.17)
  const stroke = Math.min(dotR * 0.42, clamp(1.5 * (shortSide / 1080), 0.7, 2.2))
  const background = isHex(spec.background) ? spec.background : PAPER
  const colors = inksOf(spec, section, background)
  const mode = colorModeOf(edit)
  const armCount = FIB.find((step) => step >= 13 && step < count / 4) || 21
  const metrics = sampleAt(spec, time)
  const waves = wavesAt(spec, time, count, seed, tempo, kind, metrics.loud ?? 0.35)
  const starBias = clamp(((metrics.high ?? 0.25) - 0.28) * 1.5, 0, 1)
  const shiftAmt = 0.08 + clamp(metrics.bass ?? 0.4, 0, 1) * 0.28
  const inner = ring ? Math.floor(RING_INNER * RING_INNER * (count - 1)) : 0
  const dots = []
  for (let n = inner; n < count; n += 1) {
    const radius = c * Math.sqrt(n) * breathe
    const theta = n * divergence + spin
    const restX = width / 2 + Math.cos(theta) * radius
    const restY = height / 2 + Math.sin(theta) * radius
    let x = restX
    let y = restY
    let modeNow = filled ? 'fill' : 'stroke'
    let scale = 1
    let best = 0
    for (const wave of waves) {
      if (n < wave.origin || (n - wave.origin) % wave.step !== 0) continue
      const k = (n - wave.origin) / wave.step
      const chain = Math.max(1, Math.ceil((count - 1 - wave.origin) / wave.step))
      const span = count < 280 ? 2.6 : 3.4
      const head = clamp((time - wave.start) / wave.duration, 0, 1) * (chain + span * 0.4)
      const u = clamp((head - k) / span, 0, 1)
      const morph = morphAlong(u, filled, starBias)
      const env = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0
      if (env > best) {
        best = env
        modeNow = morph.mode
        scale = morph.scale
        const next = n + wave.step
        if (next < count && env > 0.04) {
          const radius2 = c * Math.sqrt(next) * breathe
          const theta2 = next * divergence + spin
          x = restX + (width / 2 + Math.cos(theta2) * radius2 - restX) * env * shiftAmt
          y = restY + (height / 2 + Math.sin(theta2) * radius2 - restY) * env * shiftAmt
        }
      }
    }
    dots.push({
      x,
      y,
      radius: dotR * scale,
      mode: modeNow,
      color: colorFor(n, count, colors, mode, armCount),
      spin: theta,
      stroke,
    })
  }
  return { dots, background, shortSide }
}

export function paintBloom(ctx, spec) {
  const { dots, background } = layoutBloom(spec)
  const width = spec.width
  const height = spec.height
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  for (const dot of dots) {
    ctx.fillStyle = dot.color
    ctx.strokeStyle = dot.color
    if (dot.mode === 'star') {
      traceStar(ctx, dot.x, dot.y, Math.max(1.1, dot.radius * 1.28), dot.spin)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.arc(dot.x, dot.y, Math.max(0.65, dot.radius), 0, Math.PI * 2)
    if (dot.mode === 'fill') ctx.fill()
    else {
      ctx.lineWidth = dot.stroke
      ctx.stroke()
    }
  }
}
