import { mulberry32 } from './shapeLayout.js'

const STILL = {
  bass: 0,
  mid: 0,
  high: 0,
  ink: 0,
  beats: 0,
  tension: 0,
  frame: { zoom: 1, mirror: 1, x: 0, y: 0 },
}

function live(poster) {
  return poster.motion || STILL
}

function fill(ctx, color, mode, moved) {
  ctx.save()
  if (moved) ctx.translate(moved.x, moved.y)
  ctx.globalCompositeOperation = mode
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

function stroke(ctx, color, width) {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  ctx.stroke()
  ctx.restore()
}

function lineWidth(width, height) {
  return Math.max(1, Math.min(2, Math.min(width, height) / 640))
}

function inkAt(inks, index) {
  return inks[index % inks.length]
}

function scaleOf(poster) {
  return poster.scale ?? 1
}

function countOf(poster, fallback) {
  return Number.isFinite(poster.count) ? poster.count : fallback
}

function shiftOf(poster) {
  return {
    x: (poster.offsetX || 0) * poster.width,
    y: (poster.offsetY || 0) * poster.height,
  }
}

function misregister(poster, layer) {
  const amount = Math.min(poster.width, poster.height) * 0.005 * (live(poster).ink || 0)
  if (amount < 0.4) return null
  if (layer === 'main') return { x: amount, y: -amount * 0.4 }
  return { x: -amount * 0.9, y: amount * 0.35 }
}

function lineAmount(poster) {
  const motion = live(poster)
  const drift = 0.26 + 0.18 * Math.sin(motion.beats * 0.5)
  return Math.min(1, Math.max(0.08, drift + motion.high * 0.58 + motion.tension * 0.28))
}

function strokePortion(ctx, x1, y1, x2, y2, amount, color, width) {
  const t = Math.min(1, Math.max(0, amount))
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
  stroke(ctx, color, width)
}

function turnPoint(x, y, cx, cy, angle) {
  const dx = x - cx
  const dy = y - cy
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

function drawEclipse(ctx, poster) {
  const { width, height, inks, mode, seed } = poster
  const motion = live(poster)
  const rand = mulberry32((seed || 1) ^ 0xec11)
  const upper = rand() > 0.5
  const y1 = height * (upper ? 0.44 : 0.56)
  const y2 = height * (upper ? 0.58 : 0.42)
  const scale = scaleOf(poster)
  const count = countOf(poster, 3)
  const r1 = height * (0.56 + rand() * 0.06) * scale
  const r2 = height * (0.52 + rand() * 0.06) * scale
  const x1 = -r1 * 0.05
  const x2 = width + r2 * 0.05
  const leftFirst = rand() > 0.5
  const shift = shiftOf(poster)
  const drift = Math.sin(motion.beats * 0.22) * width * 0.018
  const slide = drift + motion.bass * width * 0.075 + motion.tension * width * 0.02
  const bob = Math.sin(motion.beats * 0.17 + 0.6) * height * 0.016

  const half = (x, y, radius, faceRight, color, moved) => {
    ctx.beginPath()
    if (faceRight) ctx.arc(x, y, radius, -Math.PI / 2, Math.PI / 2)
    else ctx.arc(x, y, radius, Math.PI / 2, -Math.PI / 2)
    ctx.closePath()
    fill(ctx, color, mode, moved)
  }

  half(x1 + slide + shift.x, y1 + bob + shift.y, r1, true, inkAt(inks, leftFirst ? 0 : 1), misregister(poster, 'main'))
  half(x2 - slide * 0.65 + shift.x, y2 - bob + shift.y, r2, false, inkAt(inks, leftFirst ? 1 : 0), misregister(poster, 'main'))
  const midX = width / 2 + Math.sin(motion.beats * 0.19 + 2) * width * 0.01 + shift.x
  const midY = (y1 + y2) / 2 - motion.bass * height * 0.055 - motion.mid * height * 0.03 + Math.sin(motion.beats * 0.21) * height * 0.02 + shift.y
  const gap = x2 - r2 - (x1 + r1)
  const bridge = Math.max(height * 0.2, gap / 2 + height * 0.08) * (1 - motion.tension * 0.06) * scale
  if (count >= 3) {
    ctx.beginPath()
    ctx.arc(midX, midY, bridge, 0, Math.PI * 2)
    fill(ctx, inks[0], mode, misregister(poster, 'main'))
  }
  for (let extra = 0; extra < count - 3; extra += 1) {
    const angle = extra * 2.2 + 0.4
    ctx.beginPath()
    ctx.arc(midX + Math.cos(angle) * bridge * 0.85, midY + Math.sin(angle) * bridge * 0.55, bridge * 0.28, 0, Math.PI * 2)
    fill(ctx, inkAt(inks, extra + 1), mode, misregister(poster, 'second'))
  }

  const guide = lineWidth(width, height)
  const drawn = lineAmount(poster)
  strokePortion(ctx, 0, midY, width, midY, drawn, poster.line, guide)
  strokePortion(ctx, midX, 0, midX, height, motion.tension > 0.45 ? drawn : drawn * 0.35, poster.line, guide)
}

function drawBeam(ctx, poster) {
  const { width, height, inks, mode, seed } = poster
  const motion = live(poster)
  const rand = mulberry32((seed || 1) ^ 0xbea1)
  const scale = scaleOf(poster)
  const shift = shiftOf(poster)
  const sx = width * (0.42 + rand() * 0.16) + shift.x
  const sy = height * 0.84 + Math.sin(motion.beats * 0.2) * height * 0.02 - motion.bass * height * 0.1 + shift.y
  const sr = height * (0.26 + rand() * 0.06) * scale
  const count = countOf(poster, 3)
  const fan = Math.sin(motion.beats * 0.16) * 0.1 + motion.mid * 0.34
  const spread = sr * (0.38 + motion.tension * 0.7)
  const triangles = []

  for (let index = 0; index < count; index += 1) {
    const across = index / (count - 1)
    const center = width * (-0.02 + across * 1.04)
    const baseLeft = center - width * (0.18 + motion.tension * 0.06) * scale
    const baseRight = center + width * (0.18 + motion.tension * 0.06) * scale
    const apexX = sx + (across - 0.5) * spread
    const apexY = sy - sr * 0.05
    const angle = fan * (across - 0.5) * 2
    const left = turnPoint(baseLeft, -height * 0.12, sx, sy, angle)
    const right = turnPoint(baseRight, -height * 0.04, sx, sy, angle)
    const apex = turnPoint(apexX, apexY, sx, sy, angle)
    triangles.push({ left, right, apex, top: turnPoint((baseLeft + baseRight) / 2, -height * 0.08, sx, sy, angle) })
    ctx.beginPath()
    ctx.moveTo(left.x, left.y)
    ctx.lineTo(right.x, right.y)
    ctx.lineTo(apex.x, apex.y)
    ctx.closePath()
    fill(ctx, inkAt(inks, index), mode, misregister(poster, 'second'))
  }

  ctx.beginPath()
  ctx.arc(sx, sy, sr, 0, Math.PI * 2)
  fill(ctx, inks[0], mode, misregister(poster, 'main'))

  const guide = lineWidth(width, height)
  const drawn = lineAmount(poster)
  strokePortion(ctx, 0, sy, width, sy, drawn, poster.line, guide)
  triangles.forEach((triangle, index) => {
    if (index > 0 && motion.tension < 0.4 + (index - 1) * 0.32) return
    strokePortion(ctx, triangle.top.x, triangle.top.y, triangle.apex.x, triangle.apex.y, drawn, poster.line, guide)
  })
}

function drawDiagonal(ctx, poster) {
  const { width, height, inks, mode, seed } = poster
  const motion = live(poster)
  const rand = mulberry32((seed || 1) ^ 0xd1a9)
  const flip = rand() > 0.5
  const p1 = { x: -width * 0.08, y: flip ? height * 1.08 : -height * 0.08 }
  const p2 = { x: width * 1.08, y: flip ? -height * 0.08 : height * 1.08 }
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const length = Math.hypot(dx, dy) || 1
  const side = rand() > 0.5 ? 1 : -1
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
  const tighten = motion.tension * 0.08 + motion.mid * 0.05 + Math.sin(motion.beats * 0.15) * 0.02
  const p3 = turnPoint(
    mid.x + (-dy / length) * Math.max(width, height) * 1.2 * side,
    mid.y + (dx / length) * Math.max(width, height) * 1.2 * side,
    mid.x,
    mid.y,
    tighten * side,
  )
  const a = turnPoint(p1.x, p1.y, mid.x, mid.y, tighten * side * 0.35)
  const b = turnPoint(p2.x, p2.y, mid.x, mid.y, tighten * side * 0.35)

  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(p3.x, p3.y)
  ctx.closePath()
  fill(ctx, inkAt(inks, 0), mode, misregister(poster, 'second'))

  const scale = scaleOf(poster)
  const shift = shiftOf(poster)
  const count = countOf(poster, 2)
  const along = 0.38 + rand() * 0.24 + Math.sin(motion.beats * 0.18) * 0.025 + motion.bass * 0.055 - motion.tension * 0.04
  const cx = p1.x + dx * along + shift.x
  const cy = p1.y + dy * along + shift.y
  const radius = height * (0.2 + rand() * 0.1) * scale
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  fill(ctx, inks[0], mode, misregister(poster, 'main'))

  if (count >= 3) {
    ctx.beginPath()
    ctx.arc(cx - radius * 0.2, cy + radius * 0.15, radius * (0.28 + motion.high * 0.16), 0, Math.PI * 2)
    fill(ctx, inkAt(inks, 1), mode, misregister(poster, 'second'))
  }
  if (count >= 4) {
    ctx.beginPath()
    ctx.arc(cx + radius * 0.35, cy - radius * 0.2, radius * 0.22, 0, Math.PI * 2)
    fill(ctx, inkAt(inks, 2), mode, misregister(poster, 'second'))
  }

  const guide = lineWidth(width, height)
  const drawn = lineAmount(poster)
  strokePortion(ctx, a.x, a.y, b.x, b.y, drawn, poster.line, guide)
  const nx = -dy / length
  const ny = dx / length
  if (motion.tension > 0.35) {
    strokePortion(
      ctx,
      cx - nx * Math.max(width, height),
      cy - ny * Math.max(width, height),
      cx + nx * Math.max(width, height),
      cy + ny * Math.max(width, height),
      drawn,
      poster.line,
      guide,
    )
  }
  strokePortion(ctx, 0, cy, width, cy, motion.tension > 0.7 ? drawn : drawn * 0.2, poster.line, guide)
}

function band(ctx, x, y, inner, outer, start, end) {
  ctx.beginPath()
  ctx.arc(x, y, outer, start, end)
  ctx.arc(x, y, Math.max(1, inner), end, start, true)
  ctx.closePath()
}

function drawBurst(ctx, poster) {
  const { width, height, inks, mode, seed } = poster
  const motion = live(poster)
  const rand = mulberry32((seed || 1) ^ 0xb057)
  const anchor = Math.floor(rand() * 3)
  const scale = scaleOf(poster)
  const shift = shiftOf(poster)
  const focal = [
    { x: width * 0.5, y: height * 0.46 },
    { x: width * 0.02, y: height * 0.52 },
    { x: width * 0.5, y: height * 0.92 },
  ][anchor]
  focal.x += Math.sin(motion.beats * 0.18) * width * 0.008 + shift.x
  focal.y += Math.sin(motion.beats * 0.21 + 1) * height * 0.012 + motion.bass * height * 0.02 + shift.y
  const bars = countOf(poster, 6)
  const sweep = (Math.PI * 2) / bars
  const thick = sweep * (0.4 + motion.tension * 0.14)
  const reach = Math.hypot(width, height) * (0.82 - motion.tension * 0.08) * scale
  const hub = Math.min(width, height) * 0.03
  const fan = Math.sin(motion.beats * 0.14) * 0.1 + motion.mid * 0.2
  const turn = rand() * 0.4 + fan

  for (let index = 0; index < bars; index += 1) {
    const angle = turn + index * sweep
    band(ctx, focal.x, focal.y, hub, reach, angle - thick / 2, angle + thick / 2)
    fill(ctx, inkAt(inks, index), mode, misregister(poster, 'second'))
  }

  const arcReach = Math.min(width, height) * (0.34 + motion.bass * 0.045) * scale
  const weight = Math.min(width, height) * 0.045
  const arcSweep = Math.PI * (1.05 + lineAmount(poster) * 0.45)
  band(ctx, focal.x, focal.y, arcReach, arcReach + weight, turn + 0.2, turn + 0.2 + arcSweep)
  fill(ctx, inks[0], mode, misregister(poster, 'main'))
  if (motion.tension > 0.3) {
    band(ctx, focal.x, focal.y, arcReach * 1.55, arcReach * 1.55 + weight * 1.35, turn + 1.1, turn + 1.1 + arcSweep * 0.8)
    fill(ctx, inkAt(inks, 0), mode, misregister(poster, 'main'))
  }

  const guide = lineWidth(width, height)
  const drawn = lineAmount(poster)
  ctx.beginPath()
  ctx.arc(focal.x, focal.y, arcReach * 0.72, turn, turn + Math.PI * 1.5 * drawn)
  stroke(ctx, poster.line, guide)
  strokePortion(
    ctx,
    focal.x - Math.cos(turn) * reach,
    focal.y - Math.sin(turn) * reach,
    focal.x + Math.cos(turn) * reach,
    focal.y + Math.sin(turn) * reach,
    drawn,
    poster.line,
    guide,
  )
}

function drawGrid(ctx, poster) {
  const { width, height, inks, mode, seed } = poster
  const motion = live(poster)
  const rand = mulberry32((seed || 1) ^ 0x671d)
  const scale = scaleOf(poster)
  const shift = shiftOf(poster)
  const count = countOf(poster, 16)
  const cols = count <= 4 ? 2 : count <= 9 ? 3 : 4
  const rows = cols
  const cell = Math.min(width, height) / (cols * 0.825)
  const grid = cell * (cols - 1)
  const lift = Math.sin(motion.beats * 0.18) * cell * 0.035 - motion.bass * cell * 0.09
  const originX = (width - grid) / 2 + shift.x
  const originY = (height - grid) / 2 + lift + shift.y
  const radius = cell * 0.58 * scale
  const cells = []

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = originX + col * cell
      const y = originY + row * cell
      const pull = motion.tension * 0.08
      cells.push({
        x: x + (width / 2 - x) * pull,
        y: y + (height / 2 - y) * pull,
        angle: rand() * Math.PI * 2 + Math.sin(motion.beats * 0.12) * 0.2,
        color: (row + col) % 2,
      })
    }
  }

  for (const item of cells) {
    ctx.beginPath()
    ctx.arc(item.x, item.y, radius, 0, Math.PI * 2)
    fill(ctx, inkAt(inks, item.color), mode, misregister(poster, 'main'))
  }

  const offset = cell * (0.1 + motion.mid * 0.12 + motion.tension * 0.06)
  for (const item of cells) {
    ctx.beginPath()
    ctx.arc(
      item.x + Math.cos(item.angle) * offset,
      item.y + Math.sin(item.angle) * offset,
      radius * 0.72,
      0,
      Math.PI * 2,
    )
    fill(ctx, inkAt(inks, item.color + 1), mode, misregister(poster, 'second'))
  }

  const guide = lineWidth(width, height)
  const drawn = lineAmount(poster)
  strokePortion(ctx, width * 0.5, 0, width * 0.5, height, drawn, poster.line, guide)
  if (motion.tension > 0.4) strokePortion(ctx, 0, height * 0.5, width, height * 0.5, drawn, poster.line, guide)
}

const DRAW = {
  eclipse: drawEclipse,
  beam: drawBeam,
  diagonal: drawDiagonal,
  burst: drawBurst,
  grid: drawGrid,
}

export function drawPoster(ctx, poster) {
  const { width, height } = poster
  const frame = live(poster).frame
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = poster.ground
  ctx.fillRect(0, 0, width, height)
  ctx.translate(width / 2, height / 2)
  ctx.translate(frame.x * width, frame.y * height)
  ctx.scale(frame.mirror * frame.zoom, frame.zoom)
  ctx.translate(-width / 2, -height / 2)
  ;(DRAW[poster.recipe] || drawEclipse)(ctx, poster)
  ctx.restore()
}
