import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'

export const PAPER = '#EDE8DF'
export const INK_BLACK = '#111111'
export const SECTION_BLEND = 0.9

const POOLS = {
  calm: {
    soft: ['eclipse', 'eclipse', 'beam'],
    mid: ['eclipse', 'beam'],
    sharp: ['beam', 'diagonal'],
  },
  build: {
    soft: ['diagonal', 'eclipse'],
    mid: ['diagonal', 'beam'],
    sharp: ['diagonal', 'burst'],
  },
  high: {
    soft: ['grid', 'grid', 'eclipse'],
    mid: ['grid', 'burst'],
    sharp: ['burst', 'burst', 'diagonal'],
  },
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
  if (label === 'Peak') return 'high'
  if (label === 'Build') return 'build'
  return 'calm'
}

function feelOf(roundness) {
  if (roundness >= 0.62) return 'soft'
  if (roundness <= 0.38) return 'sharp'
  return 'mid'
}

export function pickRecipe(seed, label, roundness, dropIndex = 0) {
  const pool = POOLS[energyOf(label)][feelOf(roundness)]
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
  if (!section || section.label !== 'Build') return 0
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
    beats,
    tension: tensionAt(section, time, profile),
    frame: frameCut(time, bpm, seed),
  }
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

export function posterStyle(colors, seed) {
  let ground = pickGround(colors, seed)
  let inks = pickInks(colors, seed).filter((hex) => !sameHex(hex, ground))
  if (inks.length < 2) {
    ground = sameHex(ground, PAPER) ? INK_BLACK : PAPER
    inks = pickInks(colors, seed).filter((hex) => !sameHex(hex, ground))
  }
  if (inks.length < 2) inks = pickInks(colors, seed).slice(0, 3)
  return {
    ground,
    inks: inks.slice(0, 3),
    mode: sameHex(ground, PAPER) ? 'multiply' : 'source-over',
    line: luminance(ground) > 0.28 ? INK_BLACK : PAPER,
  }
}

export function explainPoster(recipe) {
  if (recipe === 'eclipse') {
    return 'Two huge halves enter from opposite edges and face each other. Kicks slide them, snares shift the center, and the lines draw themselves in.'
  }
  if (recipe === 'beam') {
    return 'Tall triangles fan around a sphere at the bottom. The sphere rides the kicks, and the beams sway on the snare.'
  }
  if (recipe === 'diagonal') {
    return 'A single large triangle cuts across the frame, with a circle that slides along the cut. Brighter hits draw the guides in.'
  }
  if (recipe === 'burst') {
    return 'Thick wedges fan around one center and keep turning with the tempo. Kicks move the arcs, and a build opens the fan until the drop lets it go.'
  }
  if (recipe === 'grid') {
    return 'Large circles sit on a four by four grid. Kicks lift them, and the overlapping circles slide out on the snare.'
  }
  return 'Each section holds one poster. Bass, mids, and highs each move a different part, and the frame keeps drifting with the tempo.'
}
