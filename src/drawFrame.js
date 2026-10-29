import { shapeFill } from './calibrate.js'
import { artworkColor, paletteColors } from './palette.js'
import { metricsAt } from './profileTrack.js'
import { layoutShapes, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

export function paintFrame(ctx, spec) {
  const { width, height } = spec
  const colors = spec.colors?.length ? spec.colors : ['#2a6d78', '#314878', '#243d38']
  ctx.save()
  ctx.fillStyle = spec.background || '#1c3a44'
  ctx.fillRect(0, 0, width, height)
  const shown = layoutShapes({
    seed: spec.seed || 1,
    width,
    height,
    time: spec.time || 0,
    loud: spec.loud ?? 0.35,
    bass: spec.bass ?? 0.4,
    high: spec.high ?? 0.25,
    tempo: spec.tempo || 100,
    roundness: spec.roundness ?? 0.7,
  })

  for (const shape of shown) {
    const fill = spec.groups
      ? shapeFill(shape, spec.groups, spec.sectionLabel, spec.references)
      : colors[shape.index % colors.length]
    ctx.save()
    ctx.translate(shape.x, shape.y)
    ctx.rotate(shape.rot)
    ctx.globalAlpha = shape.band === 'low' ? 0.92 : 0.78
    ctx.fillStyle = fill
    traceShape(ctx, shape)
    ctx.fill()
    ctx.restore()
  }
  ctx.restore()
}

function traceShape(ctx, shape) {
  const radius = shape.size / 2
  ctx.beginPath()
  if (shape.kind === 'circle') {
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
  } else if (shape.kind === 'arc') {
    ctx.arc(0, 0, radius, 0, Math.PI)
    ctx.closePath()
  } else if (shape.kind === 'wedge') {
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, radius, -0.5, 0.85)
    ctx.closePath()
  } else {
    ctx.moveTo(-shape.size / 2, shape.size / 2.5)
    ctx.lineTo(shape.size / 2, shape.size / 2.5)
    ctx.lineTo(0, -shape.size / 2.1)
    ctx.closePath()
  }
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
    roundness: studio.roundness ?? 0.7,
    tempo: track?.bpm ?? 100,
    colors,
    background: artworkColor(colors),
    groups: studio.calibration?.groups ?? null,
    references: studio.calibration?.references ?? [],
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
