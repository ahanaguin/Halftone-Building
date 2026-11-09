import { CALM_PALETTE, paletteForSection, paletteFromPreset, swatchFromHex } from './palette.js'

export const STORAGE_KEY = 'halftone.calibration'

export const CALIBRATION_COLORS = ['#e24a3b', '#e06a3a', '#e6a33a', '#e4d23a', '#3cba62', '#2eb5a8', '#3a96d6']

export const DEFAULT_GROUPS = {
  low: CALM_PALETTE.colors[0],
  mid: CALM_PALETTE.colors[1],
  high: CALM_PALETTE.colors[1],
  major: CALM_PALETTE.colors[0],
  minor: CALM_PALETTE.colors[2],
}

export const ROLE_SWATCHES = [
  { key: 'low', label: 'Low sounds', hint: 'Big, low shapes', soundId: '01-pitch-low' },
  { key: 'high', label: 'High sounds', hint: 'Small accents', soundId: '03-pitch-high' },
  { key: 'major', label: 'Bright, major sounds', hint: 'Energetic sections', soundId: '06-major-chord' },
  { key: 'minor', label: 'Dark, minor sounds', hint: 'Calm sections', soundId: '07-minor-chord' },
]

const SHAPE_SCORE = { round: 1, between: 0.5, spiky: 0 }

const SOUNDS = [
  { id: '01-pitch-low', file: '01-pitch-low.mp3', title: 'Low cello note' },
  { id: '02-pitch-mid', file: '02-pitch-mid.mp3', title: 'Mid note' },
  { id: '03-pitch-high', file: '03-pitch-high.mp3', title: 'High note' },
  { id: '04-soft', file: '04-soft.mp3', title: 'Soft' },
  { id: '05-harsh', file: '05-harsh.mp3', title: 'Harsh' },
  { id: '06-major-chord', file: '06-major-chord.mp3', title: 'Major chord' },
  { id: '07-minor-chord', file: '07-minor-chord.mp3', title: 'Minor chord' },
  { id: '08-dissonant', file: '08-dissonant.mp3', title: 'Dissonant' },
  { id: '09-kick', file: '09-kick.mp3', title: 'Kick' },
  { id: '10-hihat', file: '10-hihat.mp3', title: 'Hi-hat' },
  { id: '11-rain', file: '11-rain.mp3', title: 'Rain' },
  { id: '12-loudness-quiet', file: '12-loudness-quiet.mp3', title: 'Quiet' },
  { id: '13-loudness-loud', file: '13-loudness-loud.mp3', title: 'Loud' },
]

function repeat(id) {
  const sound = SOUNDS.find((item) => item.id === id)
  return { ...sound, id: `${id}-repeat`, repeatOf: id }
}

export const CALIBRATION_SOUNDS = SOUNDS

export const SEQUENCE = [...SOUNDS, repeat('07-minor-chord'), repeat('11-rain')]

export function soundSrc(sound) {
  return `/sounds/${sound.file}`
}

export function loadCalibration() {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export function hasCalibration() {
  const saved = loadCalibration()
  return Boolean(saved && (saved.skipped || saved.groups))
}

export function saveCalibration(value) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...value }))
}

function sameColor(left, right) {
  return (left || '').toLowerCase() === (right || '').toLowerCase()
}

export function roundnessFromAnswers(answers) {
  const soft = SHAPE_SCORE[answers['04-soft']?.shape]
  const harsh = SHAPE_SCORE[answers['05-harsh']?.shape]
  if (soft == null && harsh == null) return 0.7
  if (soft == null) return harsh
  if (harsh == null) return soft
  return (soft + harsh) / 2
}

export function resultFromAnswers(answers, references) {
  const groups = {
    low: answers['01-pitch-low']?.color,
    mid: answers['02-pitch-mid']?.color,
    high: answers['03-pitch-high']?.color,
    major: answers['06-major-chord']?.color,
    minor: answers['07-minor-chord']?.color,
  }
  const minorRepeat = answers['07-minor-chord-repeat']?.color
  const rainRepeat = answers['11-rain-repeat']?.color
  return {
    skipped: false,
    groups,
    references: references || [],
    roundness: roundnessFromAnswers(answers),
    answers,
    consistency: {
      minor: {
        match: sameColor(groups.minor, minorRepeat),
        original: groups.minor,
        repeat: minorRepeat,
      },
      rain: {
        match: sameColor(answers['11-rain']?.color, rainRepeat),
        original: answers['11-rain']?.color,
        repeat: rainRepeat,
      },
    },
  }
}

export function filledGroups(saved) {
  const groups = { ...DEFAULT_GROUPS, ...(saved?.groups || {}) }
  return groups
}

export function fillCalibration(result, previous) {
  const groups = {
    ...DEFAULT_GROUPS,
    ...(previous?.groups || {}),
    ...Object.fromEntries(Object.entries(result.groups || {}).filter(([, color]) => color)),
  }
  return {
    ...result,
    skipped: false,
    groups,
    roundness: result.roundness ?? previous?.roundness ?? 0.7,
  }
}

export function studioFromCalibration(saved) {
  const data = saved === undefined ? loadCalibration() : saved
  if (data?.groups && !data.skipped) {
    return {
      style: 'shapes',
      roundness: data.roundness ?? 0.7,
      seeds: {},
      palette: paletteFromCalibration({ ...data, groups: filledGroups(data) }),
      calibration: data,
      shine: true,
    }
  }
  return {
    style: 'shapes',
    roundness: 0.7,
    seeds: {},
    palette: paletteFromPreset(paletteForSection('Quiet')),
    calibration: data,
    shine: true,
  }
}

export function paletteFromCalibration(saved) {
  const ordered = [
    saved.groups.low,
    saved.groups.mid,
    saved.groups.high,
    saved.groups.major,
    saved.groups.minor,
    ...(saved.references || []),
  ]
  const unique = []
  for (const color of ordered) {
    if (!color) continue
    if (unique.some((item) => sameColor(item, color))) continue
    unique.push(color)
  }
  return {
    source: 'custom',
    warmth: 0.5,
    lightness: 0.5,
    swatches: unique.map((color) => swatchFromHex(color)),
  }
}

export function shapeFill(shape, groups, sectionLabel, references) {
  if (shape.band === 'low') return groups.low
  if (shape.band === 'high') return groups.high
  const accent =
    sectionLabel === 'Quiet' ? groups.minor : sectionLabel === 'Peak' || sectionLabel === 'Build' ? groups.major : groups.mid
  const extras = references?.length ? [accent, ...references] : [accent]
  return extras[shape.index % extras.length]
}

export function describePick(answer) {
  if (!answer?.shape || !answer?.texture) return ''
  const shape = answer.shape === 'between' ? 'in-between' : answer.shape
  return `${shape}, ${answer.texture}`
}

export function colorsSoFar(answers, references) {
  const colors = []
  const add = (color) => {
    if (!color) return
    if (colors.some((item) => sameColor(item, color))) return
    colors.push(color)
  }
  for (const sound of SEQUENCE) add(answers[sound.id]?.color)
  for (const color of references || []) add(color)
  return colors
}

function quantizeKey(red, green, blue) {
  return `${red >> 4},${green >> 4},${blue >> 4}`
}

function distance(left, right) {
  const dr = left.r - right.r
  const dg = left.g - right.g
  const db = left.b - right.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function toHex(color) {
  const channel = (value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

export function dominantColors(pixels) {
  const buckets = new Map()
  for (const [red, green, blue] of pixels) {
    const key = quantizeKey(red, green, blue)
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 }
    bucket.r += red
    bucket.g += green
    bucket.b += blue
    bucket.n += 1
    buckets.set(key, bucket)
  }
  const ranked = [...buckets.values()]
    .map((bucket) => ({ r: bucket.r / bucket.n, g: bucket.g / bucket.n, b: bucket.b / bucket.n, n: bucket.n }))
    .sort((left, right) => right.n - left.n)
  const picked = []
  const take = (gap) => {
    for (const color of ranked) {
      if (picked.length >= 5) return
      if (picked.some((other) => distance(other, color) < gap)) continue
      picked.push(color)
    }
  }
  take(60)
  if (picked.length < 3) take(28)
  if (picked.length < 3) {
    for (const color of ranked) {
      if (picked.length >= 3) break
      if (picked.includes(color)) continue
      picked.push(color)
    }
  }
  return picked.slice(0, 5).map(toHex)
}

export async function colorsFromImages(files) {
  const pixels = []
  for (const file of files) {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 40
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(bitmap, 0, 0, 40, 40)
    const data = context.getImageData(0, 0, 40, 40).data
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 200) continue
      pixels.push([data[index], data[index + 1], data[index + 2]])
    }
    bitmap.close?.()
  }
  return dominantColors(pixels)
}
