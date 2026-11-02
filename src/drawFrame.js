import { paletteColors, swatchHex } from './palette.js'
import { frameMode, paintMetaballs, TUNE_DEFAULTS } from './metaballs.js'
import { paintGrid } from './gridField.js'
import { metricsAt } from './profileTrack.js'
import { workingSections } from './sectionEdit.js'
import { PAPER, backgroundAt, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

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
    const tone = 86 + (state % 92)
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
  ctx.globalAlpha = 0.22
  ctx.fillStyle = ctx.createPattern(grainSource(), 'repeat')
  if (transform) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillRect(0, 0, Math.max(1, Math.ceil(width * transform.a)), Math.max(1, Math.ceil(height * transform.d)))
  } else {
    ctx.fillRect(0, 0, width, height)
  }
  ctx.restore()
}

export function paintFrame(ctx, spec) {
  const width = spec.width
  const height = spec.height
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  if (frameMode(spec) === 'grid') paintGrid(ctx, spec)
  else paintMetaballs(ctx, spec)
  paintGrain(ctx, width, height)
  ctx.restore()
}

export function frameInput({ track, studio, profile, time, width, height }) {
  const sections = workingSections(track, studio)
  const section = sectionAt(sections, time)
  const index = section ? sections.findIndex((item) => item.start === section.start && item.label === section.label) : 0
  const key = section ? sectionKey(section) : ''
  const edit = section ? studio.edits?.[key] : null
  const palette = edit?.palette?.swatches?.length ? edit.palette : studio.palette
  const colors = paletteColors(palette)
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
    roundness: edit?.roundness ?? studio.roundness ?? 0.7,
    tempo: track?.bpm ?? 100,
    colors,
    palette: (studio.palette?.swatches || []).map((swatch) => ({ id: swatch.id, hex: swatchHex(swatch) })),
    print: edit?.print !== false,
    tune: { ...TUNE_DEFAULTS, ...(studio.tune || {}) },
    background: backgroundAt({ background: studio.background, edits: studio.edits || {}, sections }, time),
    shine: studio.shine !== false,
    speed: edit?.speed ?? studio.speed ?? 50,
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
