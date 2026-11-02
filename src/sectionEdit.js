import { sectionKey, sectionSeed } from './shapeLayout.js'

export const MIN_SECTION = 4
export const MAX_LABEL = 16

export function workingSections(track, studio) {
  if (studio?.sections?.length) return studio.sections
  return track?.sections || []
}

export function sameSections(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return item.label === other.label && Math.abs(item.start - other.start) < 0.0005 && Math.abs(item.end - other.end) < 0.0005
  })
}

export function cleanLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
}

export function snapBoundary(time, bpm, min, max) {
  if (!(max >= min)) return null
  const beat = 60 / Math.max(1, bpm || 120)
  let snapped = Math.round(time / beat) * beat
  if (snapped < min) snapped = Math.ceil((min - 1e-4) / beat) * beat
  if (snapped > max) snapped = Math.floor((max + 1e-4) / beat) * beat
  if (snapped < min - 1e-3 || snapped > max + 1e-3) return null
  return Math.round(snapped * 1000) / 1000
}

export function boundaryLimits(sections, index) {
  const left = sections[index - 1]
  const right = sections[index]
  if (!left || !right) return null
  const min = left.start + MIN_SECTION
  const max = right.end - MIN_SECTION
  if (max < min) return null
  return { min, max }
}

export function withBoundary(sections, index, time) {
  return sections.map((item, itemIndex) => {
    if (itemIndex === index - 1) return { ...item, end: time }
    if (itemIndex === index) return { ...item, start: time }
    return item
  })
}

export function splitAt(sections, time) {
  const index = sections.findIndex((item) => time >= item.start && time < item.end - 0.0001)
  if (index < 0) return null
  const current = sections[index]
  if (time - current.start < MIN_SECTION - 1e-3 || current.end - time < MIN_SECTION - 1e-3) return null
  const at = Math.round(time * 1000) / 1000
  const left = { ...current, end: at }
  const right = { ...current, start: at }
  const next = sections.slice()
  next.splice(index, 1, left, right)
  return { sections: next, index, left, right }
}

export function mergeAt(sections, index) {
  if (index < 0 || index >= sections.length - 1) return null
  const left = sections[index]
  const right = sections[index + 1]
  const merged = { ...left, end: right.end }
  const next = sections.slice()
  next.splice(index, 2, merged)
  return { sections: next, left, right, merged }
}

export function moveKey(map, from, to) {
  const source = map || {}
  if (from === to || source[from] == null) return source
  const next = { ...source }
  next[to] = next[from]
  delete next[from]
  return next
}

export function copyKey(map, from, to) {
  const source = map || {}
  if (source[from] == null) return source
  const next = { ...source }
  next[to] = JSON.parse(JSON.stringify(source[from]))
  return next
}

export function dropKey(map, key) {
  const source = map || {}
  if (source[key] == null) return source
  const next = { ...source }
  delete next[key]
  return next
}

export function freshSeed(section, index) {
  return (sectionSeed(section, index) ^ 0x51ed) >>> 0
}

export function rekeyBoundary(studio, before, after) {
  const from = sectionKey(before)
  const to = sectionKey(after)
  return {
    edits: moveKey(studio.edits, from, to),
    seeds: moveKey(studio.seeds, from, to),
  }
}
