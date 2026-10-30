import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'

export const PAPER = '#EDE8DF'
export const INK_BLACK = '#111111'
export const SECTION_BLEND = 1.7

const POOLS = {
  calm: ['eclipse', 'eclipse', 'beam'],
  build: ['diagonal', 'beam', 'burst'],
  high: ['burst', 'grid', 'eclipse'],
}

export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function sectionAt(sections, time) {
  if (!sections?.length) return null
  return sections.find((section) => time >= section.start && time < section.end) ?? sections[sections.length - 1]
}

export function sectionKey(section) {
  return `${Number(section.start).toFixed(3)}:${section.label}`
}

export function labelKind(label) {
  return String(label || 'Quiet').replace(/\s+\d+$/, '')
}

export function isHex(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

export function mixHex(from, to, amount) {
  const start = hexToRgb(from)
  const end = hexToRgb(to)
  const channel = (index) => Math.round(start[index] + (end[index] - start[index]) * clamp(amount, 0, 1)).toString(16).padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function sectionBackground(spec, section) {
  const fallback = isHex(spec?.background) ? spec.background : PAPER
  if (!section) return fallback
  const saved = spec?.edits?.[sectionKey(section)]?.background
  return isHex(saved) ? saved : fallback
}

export function backgroundAt(spec, time) {
  const sections = spec?.sections || []
  if (!sections.length) return sectionBackground(spec, null)
  const now = Math.max(0, time || 0)
  const fade = 1.5
  for (let index = 1; index < sections.length; index += 1) {
    const boundary = sections[index].start
    const begin = boundary - fade
    if (now < begin || now >= boundary) continue
    const eased = ((now - begin) / fade) ** 2 * (3 - 2 * ((now - begin) / fade))
    return mixHex(sectionBackground(spec, sections[index - 1]), sectionBackground(spec, sections[index]), eased)
  }
  return sectionBackground(spec, sectionAt(sections, now) || sections[0])
}

export function sectionSeed(section, index) {
  let hash = 2166136261
  const text = `${index}:${sectionKey(section)}`
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function energyOf(label) {
  const kind = labelKind(label)
  if (kind === 'High' || kind === 'Main' || kind === 'Drop' || kind === 'Peak') return 'high'
  if (kind === 'Build') return 'build'
  return 'calm'
}

export function pickRecipe(seed, label, _roundness, dropIndex = 0) {
  const pool = POOLS[energyOf(label)]
  const rand = mulberry32(seed || 1)
  const base = Math.floor(rand() * pool.length)
  if (!dropIndex) return pool[base]
  for (let step = 0; step < pool.length; step += 1) {
    const next = pool[(base + dropIndex + step) % pool.length]
    if (next !== pool[base]) return next
  }
  return pool[base]
}

export function previousSection(sections, section) {
  if (!section || !sections?.length) return null
  const index = sections.findIndex((item) => item.start === section.start && item.label === section.label)
  return index > 0 ? sections[index - 1] : null
}

export function dropCount(profile, from, to) {
  const timeline = profile?.timeline
  if (!timeline?.rms?.length || !(to > from)) return 0
  const { hop, rms } = timeline
  let count = 0
  const start = Math.max(1, Math.floor(from / hop))
  const end = Math.min(rms.length - 1, Math.floor(to / hop))
  for (let index = start; index <= end; index += 1) {
    const prev = unitLoud(rms[index - 1], profile.rms)
    const now = unitLoud(rms[index], profile.rms)
    if (prev < 0.48 && now > 0.62 && now - prev > 0.34) count += 1
  }
  return count
}

function unitLoud(value, range) {
  if (!range) return value
  const width = range.hi - range.lo
  if (width <= 1e-8) return 0.5
  return Math.min(1, Math.max(0, (value - range.lo) / width))
}

export function envelopeAt(delta, release = 0.52) {
  if (delta == null || delta < 0 || delta > 0.05 + release) return 0
  const attack = 0.05
  if (delta <= attack) {
    const t = delta / attack
    return 1 - (1 - t) ** 3
  }
  const t = Math.min(1, (delta - attack) / release)
  return (1 - t) ** 2
}

function bandSample(profile, index) {
  const timeline = profile.timeline
  return {
    loud: unitLoud(timeline.rms[index], profile.rms),
    bass: unitLoud(timeline.bass[index], profile.bass),
    high: unitLoud(timeline.high[index], profile.high),
    harsh: unitLoud(timeline.zcr?.[index] ?? 0, profile.zcr),
  }
}

function isKick(prev, now) {
  if (!prev || !now) return false
  const bassJump = now.bass - prev.bass
  const loudJump = now.loud - prev.loud
  const highJump = now.high - prev.high
  if (bassJump > 0.2 && now.bass > 0.5 && bassJump >= highJump) return true
  if (highJump > bassJump) return false
  return loudJump > 0.3 && now.loud > 0.66 && now.bass > 0.45 && bassJump > 0.08
}

function isSnare(prev, now) {
  if (!prev || !now || isKick(prev, now)) return false
  const highJump = now.high - prev.high
  const loudJump = now.loud - prev.loud
  const harshJump = now.harsh - prev.harsh
  if (highJump > 0.2 && now.high > 0.5 && loudJump > 0.12) return true
  return harshJump > 0.22 && now.harsh > 0.55 && loudJump > 0.16
}

function latestOnset(profile, time, kind) {
  const timeline = profile?.timeline
  if (!timeline?.rms?.length) return null
  const hop = timeline.hop || 0.05
  const end = Math.min(timeline.rms.length - 1, Math.max(1, Math.floor(time / hop)))
  const start = Math.max(1, end - Math.ceil(0.7 / hop))
  const test = kind === 'kick' ? isKick : isSnare
  for (let index = end; index >= start; index -= 1) {
    if (test(bandSample(profile, index - 1), bandSample(profile, index))) return index * hop
  }
  return null
}

const FRAMES = [
  { zoom: 1, mirror: 1, x: 0, y: 0 },
  { zoom: 1.48, mirror: 1, x: 0, y: 0 },
  { zoom: 1, mirror: -1, x: 0, y: 0 },
  { zoom: 1.12, mirror: 1, x: 0.16, y: -0.1 },
]

export function phraseLength(tempo) {
  const bpm = tempo > 0 ? tempo : 100
  return (60 / bpm) * 32
}

export function frameCut(time, tempo, seed) {
  const phrase = phraseLength(tempo)
  const index = Math.max(0, Math.floor((time || 0) / phrase))
  if (index === 0) return FRAMES[0]
  const mix = ((seed || 1) ^ Math.imul(index, 0x9e3779b9)) >>> 0
  let pick = 1 + (mix % 3)
  if (index > 1) {
    const previousMix = ((seed || 1) ^ Math.imul(index - 1, 0x9e3779b9)) >>> 0
    const previous = 1 + (previousMix % 3)
    if (pick === previous) pick = 1 + (pick % 3)
  }
  return FRAMES[pick]
}

export function tensionAt(section, time, profile) {
  if (!section || labelKind(section.label) !== 'Build') return 0
  if (dropCount(profile, section.start, time || 0) > 0) return 0
  const span = Math.max(0.001, section.end - section.start)
  const t = Math.min(1, Math.max(0, ((time || 0) - section.start) / span))
  return t * t * (3 - 2 * t)
}

export function motionAt({ profile, time = 0, tempo = 100, seed = 1, section = null }) {
  const bpm = tempo > 0 ? tempo : 100
  const beats = (time * bpm) / 60
  const kick = latestOnset(profile, time, 'kick')
  const snare = latestOnset(profile, time, 'snare')
  const bass = envelopeAt(kick == null ? null : time - kick)
  const mid = envelopeAt(snare == null ? null : time - snare)
  const high = envelopeAt(snare == null ? null : time - snare, 0.46)
  const ink = Math.max(envelopeAt(kick == null ? null : time - kick, 0.16), envelopeAt(snare == null ? null : time - snare, 0.16))
  return {
    bass,
    mid,
    high,
    ink,
    swell: bassLevel(profile, time),
    beats,
    tension: tensionAt(section, time, profile),
    frame: frameCut(time, bpm, seed),
  }
}

function bassLevel(profile, time) {
  const timeline = profile?.timeline
  if (!timeline?.bass?.length) return 0
  const hop = timeline.hop || 0.05
  const index = Math.min(timeline.bass.length - 1, Math.max(0, Math.floor((time || 0) / hop)))
  let sum = 0
  let count = 0
  for (let step = 0; step < 3; step += 1) {
    const at = index - step
    if (at < 0) break
    sum += unitLoud(timeline.bass[at], profile.bass)
    count += 1
  }
  return count ? sum / count : 0
}

function parseColor(hex) {
  const [red, green, blue] = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(red, green, blue)
  return { hex, h, s, l }
}

function hueDistance(left, right) {
  const delta = Math.abs(left.h - right.h) % 360
  return Math.min(delta, 360 - delta)
}

function sameHex(left, right) {
  return (left || '').toLowerCase() === (right || '').toLowerCase()
}

export function pickInks(colors, seed) {
  const source = colors?.length ? colors : ['#ff4d8d', '#ffd23a', '#3a96d6']
  const ranked = source
    .map(parseColor)
    .map((color) => ({
      ...color,
      score: color.s * (1 - Math.abs(color.l - 0.5) * 0.8) + (color.l < 0.12 || color.l > 0.9 ? 0.28 : 0),
    }))
    .sort((left, right) => right.score - left.score)
  const vivid = ranked.filter((color) => color.s >= 0.28 || color.l < 0.14 || color.l > 0.9)
  const pool = (vivid.length >= 2 ? vivid : ranked).slice(0, 5)
  const rand = mulberry32((seed || 1) ^ 0x1a7)
  const first = pool[Math.floor(rand() * pool.length)] || ranked[0]
  let second = null
  let best = -1
  for (const color of pool) {
    if (sameHex(color.hex, first.hex)) continue
    const score = hueDistance(first, color) + Math.abs(first.l - color.l) * 140
    if (score > best) {
      best = score
      second = color
    }
  }
  const chosen = [first]
  if (second) chosen.push(second)
  let third = null
  let thirdScore = -1
  for (const color of pool) {
    if (chosen.some((item) => sameHex(item.hex, color.hex))) continue
    const score = Math.min(...chosen.map((item) => hueDistance(item, color) + Math.abs(item.l - color.l) * 100))
    if (score > thirdScore) {
      thirdScore = score
      third = color
    }
  }
  if (third && thirdScore > 28) chosen.push(third)
  if (chosen.length === 1) {
    const color = chosen[0]
    chosen.push({
      hex: hslToHex((color.h + 32) % 360, Math.max(color.s, 0.55), color.l > 0.5 ? 0.32 : 0.7),
    })
  }
  return chosen.slice(0, 3).map((color) => color.hex)
}

function luminance(hex) {
  const [red, green, blue] = hexToRgb(hex)
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
}

export function pickGround(colors, seed) {
  const rand = mulberry32((seed || 1) ^ 0x60d)
  const strong = (colors || [])
    .map(parseColor)
    .filter((color) => color.s >= 0.5 && color.l >= 0.36 && color.l <= 0.64)
    .sort((left, right) => right.s - left.s)
    .slice(0, 3)
  const roll = rand()
  if (strong.length && roll < 0.4) return strong[Math.floor(rand() * strong.length)].hex
  if (roll < 0.72) return PAPER
  return INK_BLACK
}

export const SHAPE_RANGE = {
  eclipse: { min: 8, max: 32, count: 18 },
  beam: { min: 8, max: 32, count: 18 },
  diagonal: { min: 8, max: 32, count: 18 },
  burst: { min: 8, max: 32, count: 18 },
  grid: { min: 8, max: 32, count: 18 },
}

export const GRID_COUNT = { min: 4, max: 40, count: 14 }

export function shapeScale(size) {
  if (size == null) return 1
  return 0.62 + (Math.min(100, Math.max(0, size)) / 100) * 0.76
}

export function shapeCount(recipe, count, composition) {
  const range = composition === 'grid' ? GRID_COUNT : SHAPE_RANGE[recipe] || SHAPE_RANGE.eclipse
  const value = count == null ? range.count : count
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

export function leadColors(entries, sectionIndex, selectedIds) {
  const source = (entries || []).filter((entry) => entry?.hex)
  let enabled = source
  if (selectedIds?.length >= 2) {
    const picked = source.filter((entry) => selectedIds.includes(entry.id))
    if (picked.length >= 2) enabled = picked
  }
  if (enabled.length < 2) {
    return source.length ? source.map((entry) => entry.hex) : ['#ff4d8d', '#ffd23a']
  }
  const lead = ((sectionIndex % enabled.length) + enabled.length) % enabled.length
  return [...enabled.slice(lead), ...enabled.slice(0, lead)].map((entry) => entry.hex)
}

export function posterStyle(colors, seed) {
  const lead = colors?.[0]
  const groundPool = (colors || []).filter((hex) => !sameHex(hex, lead))
  let ground = pickGround(groundPool.length ? groundPool : colors, seed)
  if (lead && sameHex(ground, lead)) ground = PAPER
  let inks = pickInks(colors, seed).filter((hex) => !sameHex(hex, ground))
  if (lead && !sameHex(lead, ground)) inks = [lead, ...inks.filter((hex) => !sameHex(hex, lead))]
  if (inks.length < 2) {
    ground = sameHex(ground, PAPER) ? INK_BLACK : PAPER
    inks = pickInks(colors, seed).filter((hex) => !sameHex(hex, ground))
    if (lead && !sameHex(lead, ground)) inks = [lead, ...inks.filter((hex) => !sameHex(hex, lead))]
  }
  if (inks.length < 2) inks = pickInks(colors, seed).slice(0, 3)
  return {
    ground,
    inks: inks.slice(0, 3),
    mode: sameHex(ground, PAPER) ? 'multiply' : 'source-over',
    line: luminance(ground) > 0.28 ? INK_BLACK : PAPER,
  }
}

export function explainPoster() {
  return 'Same-color blobs merge into one liquid shape. Bass draws them together, bright hits let a droplet drift off, and louder passages melt the edges a little fuller. A new section eases the pull instead of cutting.'
}
