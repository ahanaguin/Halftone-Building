import { biggestDropTimes } from './metaballs.js'
import { metricsAt } from './profileTrack.js'
import { PAPER, labelKind, mulberry32, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

export const PANEL_COUNT = { min: 3, max: 8 }
export const GUTTER_DEFAULT = 35
export const FOCUS_SPAN = 0.36

const DT = 1 / 30
const CHANGE = 0.6

const images = new Map()
const details = new Map()
const loading = new Map()
let simCache = null
let grainCanvas = null

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function easeInOut(amount) {
  const t = clamp(amount, 0, 1)
  return t * t * (3 - 2 * t)
}

function smoothToward(value, goal, dt, tau) {
  const rate = 1 - Math.exp(-dt / Math.max(0.04, tau))
  return value + (goal - value) * rate
}

function sectionSeedOf(spec, section, sections) {
  if (!section) return spec.seed || 1
  const key = sectionKey(section)
  if (spec.seeds && spec.seeds[key] != null) return spec.seeds[key]
  const index = Math.max(0, sections.findIndex((item) => item.start === section.start && item.label === section.label))
  return spec.seed || sectionSeed(section, index)
}

export function imageComposition(spec) {
  if (spec?.style !== 'image') return ''
  const sections = spec.sections || []
  const section = sectionAt(sections, spec.time || 0)
  const saved = section ? spec.edits?.[sectionKey(section)]?.composition : spec.composition
  if (saved === 'collage') return 'collage'
  if (saved === 'mosaic') return 'mosaic'
  return 'halftone'
}

export function collageCount(spec, section) {
  if (!section) return 5
  const key = sectionKey(section)
  const saved = spec?.edits?.[key]?.count
  if (saved != null && Number.isFinite(Number(saved))) return clamp(Math.round(Number(saved)), PANEL_COUNT.min, PANEL_COUNT.max)
  const kind = labelKind(section.label)
  const seed = (spec?.seeds?.[key] ?? sectionSeed(section, 0)) >>> 0
  if (kind === 'Main' || kind === 'High' || kind === 'Peak' || kind === 'Drop') return 6 + (seed % 3)
  if (kind === 'Build') return 5
  return 3 + (seed % 2)
}

function gutterPx(width) {
  return Math.max(2, width * (0.004 + (GUTTER_DEFAULT / 100) * 0.046))
}

function flag(spec, section, name) {
  return Boolean(section && spec.edits?.[sectionKey(section)]?.[name])
}

function measure(image) {
  const longest = Math.max(image.width, image.height)
  const scale = Math.min(1, 96 / Math.max(1, longest))
  const width = Math.max(8, Math.round(image.width * scale))
  const height = Math.max(8, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height).data
  const tone = new Float32Array(width * height)
  for (let index = 0; index < tone.length; index += 1) {
    const offset = index * 4
    tone[index] = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255
  }
  const edge = new Float32Array(tone.length)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const gx = tone[index + 1] - tone[index - 1]
      const gy = tone[index + width] - tone[index - width]
      edge[index] = Math.hypot(gx, gy)
    }
  }
  const cols = 8
  const rows = 8
  const cells = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((col * width) / cols)
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / cols))
      const y0 = Math.floor((row * height) / rows)
      const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows))
      let mean = 0
      let energy = 0
      let count = 0
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = y * width + x
          mean += tone[index]
          energy += edge[index]
          count += 1
        }
      }
      mean /= count || 1
      let variance = 0
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const delta = tone[y * width + x] - mean
          variance += delta * delta
        }
      }
      variance /= count || 1
      const border = col === 0 || row === 0 || col === cols - 1 || row === rows - 1 ? 0.4 : 1
      cells.push({
        x: (col + 0.5) / cols,
        y: (row + 0.5) / rows,
        score: (energy / (count || 1) + Math.sqrt(variance)) * border,
      })
    }
  }
  cells.sort((a, b) => b.score - a.score)
  const points = []
  for (const cell of cells) {
    if (points.length >= 6) break
    if (points.some((point) => Math.hypot(point.x - cell.x, point.y - cell.y) < 0.16)) continue
    points.push({ x: cell.x, y: cell.y })
  }
  if (!points.length) points.push({ x: 0.5, y: 0.45 })
  return { points }
}

function loadImage(url) {
  if (!url) return Promise.resolve(null)
  if (images.has(url)) return Promise.resolve(images.get(url))
  if (loading.has(url)) return loading.get(url)
  const task = new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      images.set(url, image)
      details.set(url, measure(image))
      loading.delete(url)
      resolve(image)
    }
    image.onerror = () => {
      loading.delete(url)
      resolve(null)
    }
    image.src = url
  })
  loading.set(url, task)
  return task
}

export function prepareCollage(spec) {
  if (spec?.style !== 'image') return Promise.resolve()
  const urls = (spec.images || []).filter(Boolean)
  return Promise.all(urls.map((url) => loadImage(url))).then(() => {})
}

export function ensureFocus(url) {
  return loadImage(url).then(() => (details.get(url)?.points || [{ x: 0.5, y: 0.45 }]).map((point) => ({ x: point.x, y: point.y })))
}

function pointsFor(spec, url, imageId) {
  const saved = imageId != null ? spec.focus?.[imageId] : undefined
  if (Array.isArray(saved)) {
    const points = saved.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)).slice(0, 6)
    if (points.length) return points
    return [{ x: 0.5, y: 0.45 }]
  }
  return details.get(url)?.points || [{ x: 0.5, y: 0.45 }]
}

export function collageImageIds(spec, section) {
  const urls = spec.images || []
  const rawIds = spec.imageIds || []
  const ids = []
  for (let index = 0; index < urls.length; index += 1) {
    if (urls[index] && rawIds[index]) ids.push(rawIds[index])
  }
  if (!ids.length) return []
  const edit = section ? spec.edits?.[sectionKey(section)] : null
  if (Array.isArray(edit?.images)) {
    const picked = ids.filter((id) => edit.images.includes(id))
    if (picked.length) return picked
  }
  if (edit?.image && ids.includes(edit.image)) return [edit.image]
  if ((spec.imageSwitch || 'section') === 'off') return [ids[0]]
  const sections = spec.sections || []
  const index = section
    ? sections.findIndex((item) => item.start === section.start && item.label === section.label)
    : 0
  return [ids[Math.max(0, index) % ids.length]]
}

function groupsFor(spec, section) {
  const urls = (spec.images || []).filter(Boolean)
  const ids = spec.imageIds || []
  if (!urls.length) return []
  const allowed = new Set(collageImageIds(spec, section))
  const groups = []
  urls.forEach((url, index) => {
    const id = ids[index]
    if (allowed.size && id != null && !allowed.has(id)) return
    const points = pointsFor(spec, url, id)
    const shots = []
    for (const point of points) {
      const span = Number(point?.span)
      shots.push({
        url,
        x: point.x,
        y: point.y,
        span: Number.isFinite(span) && span > 0 ? span : FOCUS_SPAN,
      })
    }
    if (shots.length) groups.push(shots)
  })
  return groups
}

function shotAt(groups, slot, turn) {
  if (!groups.length) return null
  const group = groups[Math.abs(slot) % groups.length]
  const step = Math.floor(Math.abs(slot) / groups.length) + (slot === 0 ? 0 : turn)
  return group[Math.abs(step) % group.length]
}

function speedOf(spec, section) {
  const saved = section ? spec.edits?.[sectionKey(section)]?.speed : null
  const slider = saved == null ? spec.speed : saved
  const value = Number(slider)
  return clamp(Number.isFinite(value) ? value : 50, 0, 100)
}

function cutBeats(spec, section) {
  const t = speedOf(spec, section) / 100
  if (t <= 0.5) return 8 * 0.25 ** (t / 0.5)
  return 2 * 0.2 ** ((t - 0.5) / 0.5)
}

function layoutFor(spec, section, index, width, height) {
  const sections = spec.sections || []
  const count = collageCount(spec, section)
  const gutter = gutterPx(width)
  const rand = mulberry32((sectionSeedOf(spec, section, sections) || 1) ^ Math.imul(index + 1, 0x85ebca6b))
  const imageCount = Math.max(1, (spec.images || []).filter(Boolean).length)
  const minSide = Math.min(width, height) * 0.18
  let cells = [{ x: 0, y: 0, w: width, h: height }]
  while (cells.length < count) {
    const order = cells
      .map((cell, cursor) => ({ cell, cursor }))
      .sort((a, b) => b.cell.w * b.cell.h - a.cell.w * a.cell.h)
    let placed = false
    for (const item of order) {
      const cell = item.cell
      const canVertical = cell.w >= minSide * 2.15
      const canHorizontal = cell.h >= minSide * 2.15
      if (!canVertical && !canHorizontal) continue
      let vertical = cell.w > cell.h * 1.2 ? true : cell.h > cell.w * 1.2 ? false : rand() > 0.45
      if (vertical && !canVertical) vertical = false
      if (!vertical && !canHorizontal) vertical = true
      const ratio = 0.38 + rand() * 0.24
      cells.splice(item.cursor, 1)
      if (vertical) {
        const cut = clamp(cell.w * ratio, minSide, cell.w - minSide)
        const boundary = Math.round(cell.x + cut)
        cells.push({ x: cell.x, y: cell.y, w: Math.max(1, boundary - cell.x), h: cell.h })
        cells.push({ x: boundary, y: cell.y, w: Math.max(1, cell.x + cell.w - boundary), h: cell.h })
      } else {
        const cut = clamp(cell.h * ratio, minSide, cell.h - minSide)
        const boundary = Math.round(cell.y + cut)
        cells.push({ x: cell.x, y: cell.y, w: cell.w, h: Math.max(1, boundary - cell.y) })
        cells.push({ x: cell.x, y: boundary, w: cell.w, h: Math.max(1, cell.y + cell.h - boundary) })
      }
      placed = true
      break
    }
    if (!placed) break
  }
  const panels = cells.map((cell) => {
    const inset = gutter * 0.5
    const left = Math.round(cell.x + inset)
    const top = Math.round(cell.y + inset)
    const right = Math.round(cell.x + cell.w - inset)
    const bottom = Math.round(cell.y + cell.h - inset)
    return {
      x: left,
      y: top,
      w: Math.max(4, right - left),
      h: Math.max(4, bottom - top),
      imageIndex: Math.floor(rand() * imageCount),
      phase: rand() * Math.PI * 2,
      angle: rand() * Math.PI * 2,
      seed: Math.floor(rand() * 0x7fffffff) || 1,
    }
  })
  panels.sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x)
  const wideCount = count >= 5 ? 2 : 1
  return panels.map((panel, slot) => ({ ...panel, slot, wide: slot < wideCount }))
}

function blendLayouts(from, to, amount) {
  const count = Math.max(from.length, to.length)
  const panels = []
  for (let index = 0; index < count; index += 1) {
    const start = from[index]
    const end = to[index]
    if (start && end) {
      panels.push({
        ...end,
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
        w: start.w + (end.w - start.w) * amount,
        h: start.h + (end.h - start.h) * amount,
        alpha: 1,
      })
    } else if (end) {
      panels.push({
        ...end,
        x: end.x + end.w * (1 - amount) * 0.5,
        y: end.y + end.h * (1 - amount) * 0.5,
        w: Math.max(1, end.w * amount),
        h: Math.max(1, end.h * amount),
        alpha: amount,
      })
    } else if (start) {
      panels.push({
        ...start,
        x: start.x + start.w * amount * 0.5,
        y: start.y + start.h * amount * 0.5,
        w: Math.max(1, start.w * (1 - amount)),
        h: Math.max(1, start.h * (1 - amount)),
        alpha: 1 - amount,
      })
    }
  }
  return panels
}

function layoutsAt(spec, time, width, height) {
  const sections = spec.sections || []
  const section = sectionAt(sections, time) || sections[0] || null
  const index = section ? sections.findIndex((item) => item.start === section.start && item.label === section.label) : 0
  const next = layoutFor(spec, section, Math.max(0, index), width, height)
  if (!section || index <= 0) return next
  const elapsed = time - section.start
  if (elapsed < 0 || elapsed >= CHANGE) return next
  const previous = layoutFor(spec, sections[index - 1], index - 1, width, height)
  return blendLayouts(previous, next, easeInOut(elapsed / CHANGE))
}

function zoomOf(point, fallback) {
  const span = Number(point?.span)
  if (!Number.isFinite(span) || span <= 0) return fallback
  return clamp(1 / clamp(span, 0.12, 0.95), 1.05, 8)
}

function cropFor(shot) {
  const point = shot || { x: 0.5, y: 0.45, span: FOCUS_SPAN }
  return {
    x: clamp(point.x, 0.02, 0.98),
    y: clamp(point.y, 0.02, 0.98),
    zoom: zoomOf(point, 1 / FOCUS_SPAN),
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

function dropNow(spec, section, time, beat) {
  const bar = beat * 4
  if (section && labelKind(section.label) === 'Drop' && time >= section.start && time < section.start + bar) return true
  return biggestDropTimes(spec).some((hit) => time >= hit && time < hit + bar)
}

function specKey(spec) {
  const sections = (spec.sections || []).map((section) => `${Number(section.start).toFixed(3)}:${section.label}`).join('|')
  const seeds = spec.seeds ? JSON.stringify(spec.seeds) : String(spec.seed || 1)
  const bass = spec.profile?.timeline?.bass
  const audio = bass?.length ? `${bass.length}:${Math.round((bass[0] || 0) * 1000)}` : '0'
  const pictures = (spec.images || []).join(',')
  const focus = spec.focus ? JSON.stringify(spec.focus) : ''
  return `${spec.tempo || 100}|${sections}|${seeds}|${audio}|${pictures}|${focus}`
}

function createState() {
  return {
    bass: 0.2,
    crop: Array(PANEL_COUNT.max).fill(0),
    lastCut: Array(PANEL_COUNT.max).fill(-100),
    lastBeat: -1,
    lastBurst: -100,
    beatIndex: 0,
  }
}

function step(state, time, dt, spec) {
  const metrics = metricsAt(spec.profile, time)
  const previous = metricsAt(spec.profile, Math.max(0, time - dt))
  state.bass = smoothToward(state.bass, metrics?.bass ?? 0.2, dt, 0.16)
  const section = sectionAt(spec.sections || [], time)
  const count = collageCount(spec, section)
  const beat = 60 / Math.max(1, spec.tempo || 100)
  const gap = beat * cutBeats(spec, section)
  if (dropNow(spec, section, time, beat)) {
    if (time - state.lastBurst >= Math.max(beat * 0.2, gap * 0.35)) {
      for (let index = 0; index < count; index += 1) {
        state.crop[index] = (state.crop[index] + 1) % 12
        state.lastCut[index] = time
      }
      state.lastBurst = time
    }
    return
  }
  if (!strongBeat(metrics, previous) || time - state.lastBeat <= 0.22) return
  state.beatIndex += 1
  state.lastBeat = time
  const kind = labelKind(section?.label || '')
  const fast = kind === 'Main' || kind === 'High' || kind === 'Peak' || kind === 'Build' || kind === 'Drop'
  const speed = speedOf(spec, section)
  if (speed < 75 && !fast && state.beatIndex % 2 !== 0) return
  const ready = []
  for (let index = 0; index < count; index += 1) {
    const age = time - state.lastCut[index]
    if (age + 1e-4 >= gap) ready.push({ index, age })
  }
  if (!ready.length) return
  ready.sort((a, b) => b.age - a.age)
  const howMany = speed >= 85 ? Math.min(3, ready.length) : speed >= 65 ? Math.min(2, ready.length) : 1
  for (const item of ready.slice(0, howMany)) {
    state.crop[item.index] = (state.crop[item.index] + 1) % 12
    state.lastCut[item.index] = time
  }
}

function simulate(spec, time) {
  const key = specKey(spec)
  const target = Math.max(0, time || 0)
  if (!simCache || simCache.key !== key || target + 1e-4 < simCache.time) {
    simCache = { key, time: 0, state: createState() }
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

function sourceRect(image, panel, crop) {
  const aspect = panel.w / Math.max(1, panel.h)
  const zoom = crop.zoom
  let srcW = image.width / zoom
  let srcH = srcW / aspect
  if (srcH > image.height) {
    srcH = image.height
    srcW = srcH * aspect
  }
  srcW = Math.min(srcW, image.width)
  srcH = Math.min(srcH, image.height)
  const cx = crop.x * image.width
  const cy = crop.y * image.height
  return {
    sx: clamp(cx - srcW / 2, 0, Math.max(0, image.width - srcW)),
    sy: clamp(cy - srcH / 2, 0, Math.max(0, image.height - srcH)),
    srcW: Math.max(1, srcW),
    srcH: Math.max(1, srcH),
  }
}

function grainSource() {
  if (grainCanvas) return grainCanvas
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(size, size)
  let state = 20261102
  const data = image.data
  for (let index = 0; index < data.length; index += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const tone = 70 + (state % 120)
    data[index] = tone
    data[index + 1] = tone
    data[index + 2] = tone
    data[index + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  grainCanvas = canvas
  return canvas
}

export function paintCollage(ctx, spec) {
  const width = spec.width
  const height = spec.height
  if (!(width > 0) || !(height > 0)) return
  const time = spec.time || 0
  const urls = (spec.images || []).filter(Boolean)
  for (const url of urls) {
    if (!images.has(url) && !loading.has(url)) loadImage(url)
  }
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  ctx.fillStyle = spec.background || PAPER
  ctx.fillRect(0, 0, width, height)
  if (!urls.length) {
    ctx.restore()
    return
  }
  const section = sectionAt(spec.sections || [], time)
  const panels = layoutsAt(spec, time, width, height)
  const groups = groupsFor(spec, section)
  const state = simulate(spec, time)
  const mono = flag(spec, section, 'mono')
  const grain = flag(spec, section, 'grain')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  for (const panel of panels) {
    if (panel.w < 2 || panel.h < 2) continue
    const turned = panel.slot === 0 ? 0 : state.crop[panel.slot] || 0
    const shot = shotAt(groups, panel.slot, turned)
    const url = shot?.url || urls[panel.imageIndex % urls.length]
    const image = images.get(url)
    if (!image) continue
    const crop = cropFor(shot)
    const rect = panel
    const source = sourceRect(image, rect, crop)
    ctx.save()
    ctx.globalAlpha = panel.alpha == null ? 1 : panel.alpha
    ctx.beginPath()
    ctx.rect(rect.x, rect.y, rect.w, rect.h)
    ctx.clip()
    if (mono) ctx.filter = 'grayscale(1)'
    ctx.drawImage(image, source.sx, source.sy, source.srcW, source.srcH, rect.x, rect.y, rect.w, rect.h)
    ctx.filter = 'none'
    if (grain) {
      ctx.globalCompositeOperation = 'overlay'
      ctx.globalAlpha *= 0.28
      ctx.fillStyle = ctx.createPattern(grainSource(), 'repeat')
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    }
    ctx.restore()
  }
  ctx.restore()
}
