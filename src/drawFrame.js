import { paletteColors, swatchHex } from './palette.js'
import { drawPoster } from './posters.js'
import { metricsAt } from './profileTrack.js'
import {
  SECTION_BLEND,
  leadColors,
  motionAt,
  posterStyle,
  previousSection,
  pickRecipe,
  sectionAt,
  sectionKey,
  sectionSeed,
  shapeCount,
  shapeScale,
} from './shapeLayout.js'

const buffers = [null, null]

function scratch(index, width, height) {
  const pixelWidth = Math.max(1, Math.round(width))
  const pixelHeight = Math.max(1, Math.round(height))
  let canvas = buffers[index]
  if (!canvas) {
    canvas = document.createElement('canvas')
    buffers[index] = canvas
  }
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }
  return canvas
}

let grainCanvas = null

function grainSource() {
  if (grainCanvas) return grainCanvas
  const size = 160
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(size, size)
  let state = 20260329
  const data = image.data
  for (let index = 0; index < data.length; index += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const tone = 112 + (state % 48)
    data[index] = tone
    data[index + 1] = tone
    data[index + 2] = tone
    data[index + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  grainCanvas = canvas
  return canvas
}

function paintGrain(ctx, width, height) {
  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
  ctx.save()
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = 0.1
  ctx.fillStyle = ctx.createPattern(grainSource(), 'repeat')
  if (transform) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillRect(0, 0, Math.max(1, Math.ceil(width * transform.a)), Math.max(1, Math.ceil(height * transform.d)))
  } else {
    ctx.fillRect(0, 0, width, height)
  }
  ctx.restore()
}

function smoothstep(amount) {
  const t = Math.min(1, Math.max(0, amount))
  return t * t * (3 - 2 * t)
}

function sectionList(spec) {
  if (spec.sections?.length) return spec.sections
  return [{ start: 0, end: Number.POSITIVE_INFINITY, label: spec.sectionLabel || 'Quiet' }]
}

function seedFor(spec, section, sections) {
  if (!section) return spec.seed || 1
  const key = sectionKey(section)
  if (spec.seeds && spec.seeds[key] != null) return spec.seeds[key]
  const index = Math.max(0, sections.findIndex((item) => item.start === section.start && item.label === section.label))
  return spec.seed || sectionSeed(section, index)
}

function paletteEntries(spec) {
  if (spec.palette?.length) return spec.palette
  return (spec.colors || []).map((hex) => ({ id: hex, hex }))
}

function describe(spec, section, sections) {
  const seed = seedFor(spec, section, sections)
  const recipe = pickRecipe(seed, section?.label || spec.sectionLabel || 'Quiet', spec.roundness ?? 0.7)
  const index = Math.max(0, sections.findIndex((item) => item.start === section?.start && item.label === section?.label))
  const edit = section ? spec.edits?.[sectionKey(section)] : null
  const colors = leadColors(paletteEntries(spec), index, edit?.colors)
  const style = posterStyle(colors, seed)
  return {
    recipe,
    seed,
    ...style,
    count: shapeCount(recipe, edit?.count),
    scale: shapeScale(edit?.size),
    offsetX: edit?.x || 0,
    offsetY: edit?.y || 0,
    motion: motionAt({
      profile: spec.profile,
      time: spec.time || 0,
      tempo: spec.tempo || 100,
      seed,
      section,
    }),
  }
}

export function paintFrame(ctx, spec) {
  const width = spec.width
  const height = spec.height
  const sections = sectionList(spec)
  const section = sectionAt(sections, spec.time || 0) || sections[0]
  const current = describe(spec, section, sections)
  const elapsed = (spec.time || 0) - (section?.start || 0)
  const previous = previousSection(sections, section)
  const blending = previous && current && elapsed >= 0 && elapsed < SECTION_BLEND
  const blend = blending ? smoothstep(elapsed / SECTION_BLEND) : 1

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  if (blending && blend < 1) {
    const from = scratch(0, width, height)
    const to = scratch(1, width, height)
    const outgoing = describe({ ...spec, time: Math.max(0, section.start - 0.001) }, previous, sections)
    drawPoster(from.getContext('2d'), { ...outgoing, width, height })
    drawPoster(to.getContext('2d'), { ...current, width, height })
    ctx.drawImage(from, 0, 0, width, height)
    ctx.globalAlpha = blend
    ctx.drawImage(to, 0, 0, width, height)
  } else {
    drawPoster(ctx, { ...current, width, height })
  }
  paintGrain(ctx, width, height)
  ctx.restore()
}

export function frameInput({ track, studio, profile, time, width, height }) {
  const sections = track?.sections || []
  const section = sectionAt(sections, time)
  const index = section ? sections.findIndex((item) => item.start === section.start && item.label === section.label) : 0
  const key = section ? sectionKey(section) : ''
  const colors = paletteColors(studio.palette)
  const metrics = metricsAt(profile, time) || { loud: 0.35, bass: 0.4, high: 0.25, harsh: 0.2 }
  return {
    width,
    height,
    time,
    seed: studio.seeds?.[key] ?? (section ? sectionSeed(section, Math.max(0, index)) : 1),
    seeds: studio.seeds || {},
    edits: studio.edits || {},
    sections,
    profile,
    roundness: studio.roundness ?? 0.7,
    tempo: track?.bpm ?? 100,
    colors,
    palette: (studio.palette?.swatches || []).map((swatch) => ({ id: swatch.id, hex: swatchHex(swatch) })),
    sectionLabel: section?.label || '',
    loud: metrics.loud,
    bass: metrics.bass,
    high: metrics.high,
  }
}

export function paintScaled(canvas, logical, spec) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.setTransform(canvas.width / logical.width, 0, 0, canvas.height / logical.height, 0, 0)
  paintFrame(ctx, { ...spec, width: logical.width, height: logical.height })
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
