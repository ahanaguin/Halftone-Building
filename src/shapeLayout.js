export const SHAPE_COUNT = 36
const PRESENCE = 72

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function lerp(from, to, amount) {
  return from + (to - from) * amount
}

function wrap(value, width, size) {
  const span = width + size * 2
  return ((((value + size) % span) + span) % span) - size
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

export function layoutShapes({ seed, width, height, time, loud, bass, high, tempo, roundness }) {
  const rand = mulberry32(seed || 1)
  const speed = lerp(0.35, 2.5, clamp((tempo - 70) / 90, 0, 1))
  const shapes = []

  for (let index = 0; index < SHAPE_COUNT; index += 1) {
    const band = index % 3 === 0 ? 'low' : index % 3 === 1 ? 'mid' : 'high'
    const baseX = rand() * width
    const y =
      band === 'low'
        ? height * (0.7 + rand() * 0.24)
        : band === 'high'
          ? height * (0.05 + rand() * 0.19)
          : height * (0.36 + rand() * 0.26)
    const drift = rand() * 2 - 1
    const wobble = rand() * Math.PI * 2
    const spin = (rand() * 2 - 1) * 0.02
    const rot = rand() * Math.PI * 2
    const roll = rand()
    const size =
      band === 'low'
        ? lerp(48, 156, bass) * lerp(0.68, 1.28, loud)
        : band === 'high'
          ? lerp(8, 26, high)
          : lerp(18, 58, loud)
    const spiky = roll > roundness
    shapes.push({
      index,
      band,
      x: wrap(baseX + drift * speed * time * 60, width, size),
      y: y + Math.sin(wobble + time * 0.72 * speed) * (band === 'low' ? 5 : 10),
      size,
      rot: rot + spin * speed * time * 60,
      kind: spiky ? (band === 'low' ? 'wedge' : 'triangle') : band === 'high' ? 'arc' : 'circle',
    })
  }

  const visibleCount = Math.max(5, Math.round(lerp(6, SHAPE_COUNT, loud)))
  const order = { high: 0, mid: 1, low: 2 }
  const shown = shapes.slice(0, visibleCount).sort((left, right) => order[left.band] - order[right.band])
  if (!shown.some((shape) => shape.size >= PRESENCE)) {
    const host = shown.find((shape) => shape.band === 'low') ?? shown[0]
    if (host) host.size = Math.max(host.size, PRESENCE)
  }
  return shown
}
