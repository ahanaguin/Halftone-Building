import { hexToRgb } from './palette.js'
import { PAPER, mulberry32 } from './shapeLayout.js'

const STILL = {
  bass: 0,
  mid: 0,
  high: 0,
  ink: 0,
  swell: 0,
  beats: 0,
  tension: 0,
  frame: { zoom: 1, mirror: 1, x: 0, y: 0 },
}

const FALLBACK = ['#6ea8d6', '#e07a9a', '#e2c15a']

const ARRANGEMENTS = {
  eclipse: [
    { ax: 0.34, ay: 0.5, dx: 0, dy: 0, r: 0.2, body: 0, color: 0, role: 'main', kind: 'blob' },
    { ax: 0.34, ay: 0.5, dx: -0.18, dy: -0.14, r: 0.11, body: 0, color: 0, role: 'child', mode: 'pop', kind: 'blob' },
    { ax: 0.34, ay: 0.5, dx: 0.14, dy: -0.12, r: 0.095, body: 0, color: 0, role: 'child', mode: 'merge', kind: 'blob' },
    { ax: 0.2, ay: 0.74, r: 0.075, body: 1, color: 1, role: 'main', kind: 'blob' },
    { ax: 0.62, ay: 0.4, r: 0.055, long: 0.32, vertical: true, body: 2, color: 1, role: 'main', kind: 'bar' },
    { ax: 0.62, ay: 0.48, r: 0.05, body: 3, color: 2, role: 'main', kind: 'blob' },
    { ax: 0.8, ay: 0.7, r: 0.07, body: 4, color: 2, role: 'main', kind: 'blob' },
    { ax: 0.46, ay: 0.78, r: 0.05, long: 0.16, body: 5, color: 0, role: 'main', kind: 'bar' },
  ],
  beam: [
    { ax: 0.24, ay: 0.48, r: 0.055, long: 0.46, vertical: true, body: 0, color: 0, role: 'main', kind: 'bar' },
    { ax: 0.38, ay: 0.42, r: 0.048, long: 0.36, vertical: true, body: 1, color: 1, role: 'main', kind: 'bar' },
    { ax: 0.56, ay: 0.62, r: 0.05, long: 0.34, body: 2, color: 2, role: 'main', kind: 'bar' },
    { ax: 0.74, ay: 0.38, r: 0.046, long: 0.32, vertical: true, body: 3, color: 0, role: 'main', kind: 'bar' },
    { ax: 0.3, ay: 0.24, dx: 0.08, dy: 0, r: 0.07, body: 0, color: 0, role: 'child', mode: 'pop', kind: 'blob' },
    { ax: 0.56, ay: 0.62, dx: 0.02, dy: 0.14, r: 0.06, body: 2, color: 2, role: 'child', mode: 'merge', kind: 'blob' },
    { ax: 0.64, ay: 0.36, r: 0.055, body: 4, color: 1, role: 'main', kind: 'blob' },
    { ax: 0.82, ay: 0.66, r: 0.045, long: 0.22, vertical: true, body: 5, color: 2, role: 'main', kind: 'bar' },
  ],
  diagonal: [
    { ax: 0.28, ay: 0.68, dx: 0, dy: 0, r: 0.1, body: 0, color: 0, role: 'main', kind: 'blob' },
    { ax: 0.28, ay: 0.68, dx: 0.12, dy: -0.08, r: 0.08, body: 0, color: 0, role: 'child', mode: 'merge', kind: 'blob' },
    { ax: 0.48, ay: 0.5, r: 0.05, long: 0.26, body: 1, color: 1, role: 'main', kind: 'bar' },
    { ax: 0.64, ay: 0.36, dx: 0, dy: 0, r: 0.09, body: 2, color: 1, role: 'main', kind: 'blob' },
    { ax: 0.64, ay: 0.36, dx: 0.1, dy: -0.08, r: 0.065, body: 2, color: 1, role: 'child', mode: 'pop', kind: 'blob' },
    { ax: 0.78, ay: 0.24, r: 0.045, long: 0.2, body: 3, color: 2, role: 'main', kind: 'bar' },
    { ax: 0.4, ay: 0.32, r: 0.05, long: 0.18, vertical: true, body: 4, color: 2, role: 'main', kind: 'bar' },
    { ax: 0.55, ay: 0.74, r: 0.055, body: 5, color: 0, role: 'main', kind: 'blob' },
  ],
  burst: [
    { ax: 0.32, ay: 0.58, dx: 0, dy: 0, r: 0.18, body: 0, color: 0, role: 'main', kind: 'blob' },
    { ax: 0.32, ay: 0.58, dx: -0.12, dy: -0.12, r: 0.1, body: 0, color: 0, role: 'child', mode: 'merge', kind: 'blob' },
    { ax: 0.32, ay: 0.58, dx: 0.02, dy: 0.14, r: 0.08, body: 0, color: 0, role: 'child', mode: 'pop', kind: 'blob' },
    { ax: 0.68, ay: 0.46, dx: 0, dy: 0, r: 0.17, body: 1, color: 1, role: 'main', kind: 'blob' },
    { ax: 0.68, ay: 0.46, dx: 0.1, dy: -0.14, r: 0.09, body: 1, color: 1, role: 'child', mode: 'pop', kind: 'blob' },
    { ax: 0.52, ay: 0.64, r: 0.055, long: 0.34, body: 2, color: 2, role: 'main', kind: 'bar' },
    { ax: 0.74, ay: 0.22, r: 0.07, body: 3, color: 2, role: 'main', kind: 'blob' },
    { ax: 0.26, ay: 0.82, r: 0.04, long: 0.18, vertical: true, body: 4, color: 0, role: 'main', kind: 'bar' },
  ],
  grid: [
    { ax: 0.24, ay: 0.32, dx: 0, dy: 0, r: 0.1, body: 0, color: 0, role: 'main', kind: 'blob' },
    { ax: 0.24, ay: 0.32, dx: 0.12, dy: 0.1, r: 0.07, body: 0, color: 0, role: 'child', mode: 'pop', kind: 'blob' },
    { ax: 0.62, ay: 0.28, r: 0.05, long: 0.24, vertical: true, body: 1, color: 1, role: 'main', kind: 'bar' },
    { ax: 0.78, ay: 0.5, r: 0.05, long: 0.2, body: 2, color: 2, role: 'main', kind: 'bar' },
    { ax: 0.3, ay: 0.72, dx: 0, dy: 0, r: 0.08, body: 3, color: 1, role: 'main', kind: 'blob' },
    { ax: 0.3, ay: 0.72, dx: 0.12, dy: -0.02, r: 0.055, body: 3, color: 1, role: 'child', mode: 'merge', kind: 'blob' },
    { ax: 0.7, ay: 0.74, r: 0.065, body: 4, color: 2, role: 'main', kind: 'blob' },
    { ax: 0.48, ay: 0.42, r: 0.05, body: 5, color: 0, role: 'main', kind: 'blob' },
  ],
}

const mask = [null, null]

function live(poster) {
  return poster.motion || STILL
}

function inkAt(inks, index) {
  const list = inks?.length ? inks : FALLBACK
  return list[index % list.length]
}

function rgbOf(color) {
  if (typeof color === 'string' && color.startsWith('rgb')) {
    const parts = color.match(/\d+/g) || [0, 0, 0]
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])]
  }
  return hexToRgb(color)
}

function mixHex(from, to, amount) {
  const start = rgbOf(from)
  const end = rgbOf(to)
  const channel = (index) => Math.round(start[index] + (end[index] - start[index]) * amount)
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`
}

function layer(index, width, height) {
  let canvas = mask[index]
  if (!canvas) {
    canvas = document.createElement('canvas')
    mask[index] = canvas
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  return canvas
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function layoutForms(poster) {
  const width = poster.width
  const height = poster.height
  const unit = Math.min(width, height)
  const soft = Math.min(1, Math.max(0, poster.roundness ?? 0.7))
  const motion = live(poster)
  const count = Math.min(8, Math.max(0, poster.count ?? 6))
  const scale = poster.scale ?? 1
  const template = ARRANGEMENTS[poster.recipe] || ARRANGEMENTS.eclipse
  const rand = mulberry32((poster.seed || 1) ^ 0xb10b)
  const mirrorX = rand() > 0.5
  const mirrorY = rand() > 0.72
  const padX = width * 0.1
  const padY = height * 0.12
  const swell = 1 + (motion.swell || 0) * 0.2
  const spread = 0.78 + (1 - soft) * 1.45
  const sharpen = 1 - soft
  const bodyJitter = new Map()

  return template.map((spot, index) => {
    const visible = index < count
    if (!bodyJitter.has(spot.body)) {
      bodyJitter.set(spot.body, { x: (rand() - 0.5) * 0.04, y: (rand() - 0.5) * 0.04 })
    }
    const jitter = bodyJitter.get(spot.body)
    const sizeJitter = 0.94 + rand() * 0.12
    let ax = spot.ax + jitter.x
    let ay = spot.ay + jitter.y
    let dx = spot.dx || 0
    let dy = spot.dy || 0
    if (mirrorX) {
      ax = 1 - ax
      dx = -dx
    }
    if (mirrorY) {
      ay = 1 - ay
      dy = -dy
    }
    const phase = index * 1.7 + ((poster.seed || 1) % 11) * 0.2
    let breathe = 0
    if (spot.role === 'child') {
      const cycle = Math.sin(motion.beats * 0.09 + phase)
      const beat = spot.mode === 'merge' ? -motion.bass * 0.55 : motion.bass * 0.7
      breathe = cycle * 0.28 + beat
    }
    const anchorX = padX + ax * (width - padX * 2)
    const anchorY = padY + ay * (height - padY * 2)
    let x = anchorX + dx * unit * (spread + breathe)
    let y = anchorY + dy * unit * (spread + breathe)
    x += Math.sin(motion.beats * 0.2 + phase) * unit * 0.045
    y += Math.cos(motion.beats * 0.15 + phase * 1.3) * unit * 0.038
    x += (poster.offsetX || 0) * width
    y += (poster.offsetY || 0) * height

    const radius = spot.r * unit * sizeJitter * scale
    const length = (spot.long || spot.r * 2) * unit * sizeJitter * scale
    let rx = spot.vertical ? radius : length / 2
    let ry = spot.vertical ? length / 2 : radius
    if (!spot.long) {
      rx = radius
      ry = radius
    }
    if (spot.kind === 'blob' && sharpen > 0.4) {
      const stretch = (sharpen - 0.4) / 0.6
      if (index % 2) {
        rx *= 1 - stretch * 0.15
        ry *= 1 + stretch * 0.55
      } else {
        rx *= 1 + stretch * 0.55
        ry *= 1 - stretch * 0.15
      }
    }
    const grow = swell * (spot.role === 'main' ? 1 + motion.bass * 0.06 : 1 + motion.bass * 0.03)
    rx *= grow
    ry *= grow
    const cornerRate = spot.kind === 'bar' || sharpen > 0.45 ? 0.16 + soft * 0.84 : 0.72 + soft * 0.28
    return {
      x,
      y,
      rx: visible ? Math.max(0, rx) : 0,
      ry: visible ? Math.max(0, ry) : 0,
      corner: visible ? Math.min(rx, ry) * cornerRate : 0,
      body: soft < 0.42 ? spot.body * 8 + index : spot.body,
      color: inkAt(poster.inks, spot.color),
      role: spot.role,
      phase,
    }
  })
}

function lerpForms(from, to, amount) {
  const t = Math.min(1, Math.max(0, amount))
  return from.map((form, index) => {
    const next = to[index] || form
    return {
      ...form,
      x: form.x + (next.x - form.x) * t,
      y: form.y + (next.y - form.y) * t,
      rx: form.rx + (next.rx - form.rx) * t,
      ry: form.ry + (next.ry - form.ry) * t,
      corner: (form.corner || 0) + ((next.corner || 0) - (form.corner || 0)) * t,
      color: mixHex(form.color, next.color, t),
      body: t < 0.5 ? form.body : next.body,
    }
  })
}

function traceForm(ctx, form) {
  roundRect(ctx, form.x - form.rx, form.y - form.ry, form.rx * 2, form.ry * 2, form.corner || 0)
  ctx.fill()
}

function traceBridges(ctx, forms, soft) {
  const reach = 0.82 + soft * 0.72
  for (let left = 0; left < forms.length; left += 1) {
    for (let right = left + 1; right < forms.length; right += 1) {
      const a = forms[left]
      const b = forms[right]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy)
      const ra = Math.min(a.rx, a.ry)
      const rb = Math.min(b.rx, b.ry)
      const limit = (ra + rb) * reach
      if (dist < 1 || dist > limit) continue
      const closeness = 1 - dist / limit
      const radius = Math.min(ra, rb) * (0.22 + closeness * 0.9) * (0.4 + soft * 0.6)
      if (radius < 1) continue
      ctx.beginPath()
      ctx.arc(a.x + dx * 0.5, a.y + dy * 0.5, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function paintBodies(ctx, forms, poster) {
  const width = poster.width
  const height = poster.height
  const soft = Math.min(1, Math.max(0, poster.roundness ?? 0.7))
  const longest = Math.max(width, height)
  const scale = Math.min(1, 960 / longest)
  const pixelWidth = Math.max(2, Math.round(width * scale))
  const pixelHeight = Math.max(2, Math.round(height * scale))
  const sharp = layer(0, pixelWidth, pixelHeight)
  const blurred = layer(1, pixelWidth, pixelHeight)
  const sharpCtx = sharp.getContext('2d', { willReadFrequently: true })
  const blurCtx = blurred.getContext('2d', { willReadFrequently: true })
  const groups = new Map()
  for (const form of forms) {
    if (form.rx < 1 || form.ry < 1) continue
    const key = `${form.body}:${form.color}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(form)
  }
  const ordered = [...groups.values()].sort((a, b) => {
    const size = (list) => list.reduce((sum, form) => sum + form.rx * form.ry, 0)
    return size(b) - size(a)
  })
  const blur = Math.min(width, height) * (0.008 + soft * 0.03)
  const cutoff = 158 - soft * 28
  const feather = 10 + soft * 16
  const low = cutoff - feather
  const span = Math.max(1, feather * 2)
  const alpha = 204

  for (const group of ordered) {
    sharpCtx.setTransform(1, 0, 0, 1, 0, 0)
    sharpCtx.clearRect(0, 0, pixelWidth, pixelHeight)
    sharpCtx.setTransform(scale, 0, 0, scale, 0, 0)
    sharpCtx.fillStyle = '#fff'
    for (const form of group) traceForm(sharpCtx, form)
    traceBridges(sharpCtx, group, soft)

    blurCtx.setTransform(1, 0, 0, 1, 0, 0)
    blurCtx.clearRect(0, 0, pixelWidth, pixelHeight)
    blurCtx.filter = `blur(${Math.max(0.4, blur * scale).toFixed(2)}px)`
    blurCtx.drawImage(sharp, 0, 0)
    blurCtx.filter = 'none'
    const image = blurCtx.getImageData(0, 0, pixelWidth, pixelHeight)
    const [red, green, blue] = rgbOf(group[0].color)
    const data = image.data
    for (let index = 0; index < data.length; index += 4) {
      const coverage = data[index]
      if (coverage <= low) {
        data[index + 3] = 0
        continue
      }
      const fade = coverage >= cutoff + feather ? 1 : (coverage - low) / span
      data[index] = red
      data[index + 1] = green
      data[index + 2] = blue
      data[index + 3] = Math.round(alpha * fade)
    }
    blurCtx.putImageData(image, 0, 0)
    ctx.drawImage(blurred, 0, 0, width, height)
  }
}

export function drawPoster(ctx, poster) {
  const { width, height } = poster
  if (!(width > 0) || !(height > 0)) return
  const forms = poster.morphFrom ? lerpForms(layoutForms(poster.morphFrom), layoutForms(poster), poster.morph || 0) : layoutForms(poster)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, width, height)
  paintBodies(ctx, forms, poster)
  ctx.restore()
}
