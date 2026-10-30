export const LOOP_FPS = 30
export const FILM_FPS = 30
export const LOOP_FADE = 0.5

export const LOGICAL = {
  '9:16': { width: 540, height: 960 },
  '1:1': { width: 1000, height: 1000 },
  '16:9': { width: 960, height: 540 },
}

export const OUTPUT = {
  loop: { width: 1080, height: 1920 },
  cover: { width: 3000, height: 3000 },
  film: { width: 1920, height: 1080 },
}

export function lengthBounds(start, duration) {
  const room = Math.max(0.5, duration - Math.max(0, start))
  const max = Math.min(8, room)
  const min = Math.min(3, max)
  return { min, max }
}

export function sectionEnergy(section, profile) {
  const timeline = profile?.timeline
  if (!timeline?.rms?.length) {
    const kind = String(section.label || '').replace(/\s+\d+$/, '')
    if (kind === 'High' || kind === 'Drop' || kind === 'Peak') return 3
    if (kind === 'Main' || kind === 'Build') return 2
    return 1
  }
  const start = Math.max(0, Math.floor(section.start / timeline.hop))
  const end = Math.min(timeline.rms.length, Math.max(start + 1, Math.ceil(section.end / timeline.hop)))
  let sum = 0
  for (let index = start; index < end; index += 1) sum += timeline.rms[index]
  return sum / Math.max(1, end - start)
}

export function loudestSection(sections, profile) {
  if (!sections?.length) return null
  return sections.reduce((best, section) => {
    const score = sectionEnergy(section, profile)
    if (!best || score > best.score) return { section, score }
    return best
  }, null).section
}

export function loopFrames(start, length, fps = LOOP_FPS, fade = LOOP_FADE) {
  const count = Math.max(1, Math.round(length * fps))
  const fadeSeconds = Math.min(fade, length / 2)
  const fadeFrames = fadeSeconds > 0 ? Math.max(1, Math.round(fadeSeconds * fps)) : 0
  const frames = []
  for (let index = 0; index < count; index += 1) {
    const local = index / fps
    let mixTime = null
    let alpha = 0
    if (fadeFrames && index >= count - fadeFrames) {
      const step = index - (count - fadeFrames)
      alpha = (step + 1) / fadeFrames
      const incoming = (step + 1) / fps - fadeSeconds
      const incomingLocal = incoming < 0 ? length + incoming : incoming
      mixTime = start + incomingLocal
    }
    frames.push({ time: start + local, mixTime, alpha })
  }
  return frames
}

export function filmFrames(duration, fps = FILM_FPS) {
  const count = Math.max(1, Math.ceil(duration * fps))
  return Array.from({ length: count }, (_, index) => Math.min(duration, index / fps))
}

export function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  const remain = whole % 60
  return `${minutes}:${String(remain).padStart(2, '0')}`
}

export function fileBase(fileName) {
  const bare = (fileName || 'halftone').replace(/\.[^.]+$/, '')
  return bare || 'halftone'
}

export function sectionOptionLabel(section, sections) {
  const shared = sections.filter((item) => item.label === section.label).length > 1
  return shared ? `${section.label} · ${formatClock(section.start)}` : section.label
}
