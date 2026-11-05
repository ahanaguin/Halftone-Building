import { ensureFocus } from './collageField.js'
import { biggestDropTimes } from './metaballs.js'
import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'
import { metricsAt } from './profileTrack.js'
import { INK_BLACK, PAPER, isHex, labelKind, mulberry32, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

const DT = 1 / 30
const TILE_DEFAULT = 38
const GROUT_DEFAULT = 32

const photos = new Map()
const loading = new Map()
const autoPoints = new Map()
const fields = new Map()
const layouts = new Map()
let simCache = null
let heldLayout = null

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(value, edge0, edge1) {
  const t = clamp((value - edge0) / Math.max(1e-4, edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function easeInOut(amount) {
  return smoothstep(amount, 0, 1)
}

function sectionSeedOf(spec, section, sections) {
  if (!section) return spec.seed || 1
  const key = sectionKey(section)
  if (spec.seeds && spec.seeds[key] != null) return spec.seeds[key]
  const index = Math.max(0, sections.findIndex((item) => item.start === section.start && item.label === section.label))
  return spec.seed || sectionSeed(section, index)
}

function editOf(spec, section) {
  return section ? spec.edits?.[sectionKey(section)] || null : null
}

function speedOf(spec, section) {
  const value = editOf(spec, section)?.speed ?? spec.speed ?? 50
  return clamp(Number(value) || 0, 0, 100)
}

function shimmerOf(spec, section) {
  const value = editOf(spec, section)?.shimmer ?? 80
  return clamp(Number(value) || 0, 0, 100) / 100
}

function solidGround(spec, section) {
  return editOf(spec, section)?.ground === 'solid'
}

function flowOf(spec, section) {
  return editOf(spec, section)?.flow !== false
}

function tileControl(spec, section) {
  return clamp(Number(editOf(spec, section)?.count ?? TILE_DEFAULT), 0, 100)
}

function groutControl(spec, section) {
  return clamp(Number(editOf(spec, section)?.size ?? GROUT_DEFAULT), 0, 100)
}

function tileMetrics(control, groutControl, width, height) {
  const shortSide = Math.min(width, height)
  const t = clamp(control / 100, 0, 1)
  const base = Math.max(7, shortSide * (0.02 + t * 0.036))
  const g = clamp(groutControl / 100, 0, 1)
  const grout = Math.max(1, base * (0.05 + g * 0.08))
  return { base, grout }
}

function coverRect(image, aspect) {
  const imageAspect = image.width / Math.max(1, image.height)
  if (imageAspect > aspect) {
    const width = image.height * aspect
    return { x: (image.width - width) / 2, y: 0, width, height: image.height }
  }
  const height = image.width / Math.max(0.01, aspect)
  return { x: 0, y: (image.height - height) / 2, width: image.width, height }
}

function loadImage(url) {
  if (!url) return Promise.resolve(null)
  if (photos.has(url)) return Promise.resolve(photos.get(url))
  if (loading.has(url)) return loading.get(url)
  const task = new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      photos.set(url, image)
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

export function prepareMosaic(spec) {
  if (spec?.style !== 'image') return Promise.resolve()
  const urls = (spec.images || []).filter(Boolean)
  return Promise.all(
    urls.map((url) =>
      loadImage(url).then(() =>
        ensureFocus(url).then((points) => {
          autoPoints.set(url, points)
        }),
      ),
    ),
  ).then(() => {})
}

function pairFor(spec, url) {
  const urls = spec.images || []
  const index = urls.indexOf(url)
  return { url, id: index >= 0 ? spec.imageIds?.[index] : null }
}

function activeImage(spec, section) {
  const urls = spec.images || []
  const ids = spec.imageIds || []
  const pairs = []
  for (let index = 0; index < urls.length; index += 1) {
    if (urls[index]) pairs.push({ url: urls[index], id: ids[index] })
  }
  if (!pairs.length) return null
  const edit = editOf(spec, section)
  if (edit?.image) {
    const found = pairs.find((item) => item.id === edit.image)
    if (found) return found
  }
  if ((spec.imageSwitch || 'section') === 'off') return pairs[0]
  const sections = spec.sections || []
  const index = section ? sections.findIndex((item) => item.start === section.start && item.label === section.label) : 0
  return pairs[Math.max(0, index) % pairs.length]
}

function focusPoints(spec, image) {
  if (!image) return []
  const saved = image.id != null ? spec.focus?.[image.id] : null
  const source = Array.isArray(saved) ? saved : autoPoints.get(image.url) || []
  const points = source.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)).slice(0, 6)
  if (points.length) return points
  return [{ x: 0.5, y: 0.45, span: 0.36 }]
}

function boxBlur(source, width, height) {
  const next = new Float32Array(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          sum += source[yy * width + xx]
          count += 1
        }
      }
      next[y * width + x] = sum / count
    }
  }
  return next
}

function buildField(image, aspect, points) {
  const longSide = 168
  const width = aspect >= 1 ? longSide : Math.max(24, Math.round(longSide * aspect))
  const height = aspect >= 1 ? Math.max(24, Math.round(longSide / aspect)) : longSide
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const crop = coverRect(image, aspect)
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
  const pixels = ctx.getImageData(0, 0, width, height).data
  const rgb = new Uint8ClampedArray(width * height * 3)
  let tone = new Float32Array(width * height)
  for (let index = 0; index < tone.length; index += 1) {
    const offset = index * 4
    rgb[index * 3] = pixels[offset]
    rgb[index * 3 + 1] = pixels[offset + 1]
    rgb[index * 3 + 2] = pixels[offset + 2]
    tone[index] = (0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]) / 255
  }
  tone = boxBlur(boxBlur(boxBlur(tone, width, height), width, height), width, height)
  const mag = new Float32Array(tone.length)
  const angle = new Float32Array(tone.length)
  let magMax = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const gx = tone[index + 1] - tone[index - 1]
      const gy = tone[index + width] - tone[index - width]
      const strength = Math.hypot(gx, gy)
      mag[index] = strength
      angle[index] = Math.atan2(gy, gx)
      if (strength > magMax) magMax = strength
    }
  }
  const ranked = Array.from(mag).sort((a, b) => a - b)
  const cut = ranked[Math.min(ranked.length - 1, Math.floor(ranked.length * 0.86))] || 0
  const dist = new Float32Array(tone.length)
  dist.fill(1e6)
  const queue = []
  for (let index = 0; index < mag.length; index += 1) {
    if (mag[index] < cut || mag[index] < 0.04) continue
    dist[index] = 0
    queue.push(index)
  }
  if (!queue.length) {
    const mid = Math.floor(height / 2) * width + Math.floor(width / 2)
    dist[mid] = 0
    queue.push(mid)
  }
  const neighbors = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ]
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head]
    const x = index % width
    const y = (index - x) / width
    for (const [dx, dy, cost] of neighbors) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = ny * width + nx
      const value = dist[index] + cost
      if (value >= dist[next]) continue
      dist[next] = value
      queue.push(next)
    }
  }
  const mapped = points.map((point) => {
    const px = point.x * image.width
    const py = point.y * image.height
    return {
      x: (px - crop.x) / crop.width,
      y: (py - crop.y) / crop.height,
      span: Number(point.span) > 0 ? point.span : 0.36,
    }
  })
  const subject = new Float32Array(tone.length)
  const detail = new Float32Array(tone.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const nx = x / Math.max(1, width - 1)
      const ny = y / Math.max(1, height - 1)
      let focus = 0
      for (const point of mapped) {
        const dx = nx - point.x
        const dy = (ny - point.y) * (height / width)
        const sigma = point.span * 0.72
        focus = Math.max(focus, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)))
      }
      const edge = smoothstep(mag[index] / Math.max(0.001, magMax), 0.05, 0.42)
      detail[index] = edge
      subject[index] = clamp(focus * 0.82 + edge * (0.42 + focus * 0.7), 0, 1)
    }
  }
  return { width, height, rgb, dist, angle, subject, detail }
}

function fieldFor(image, aspect, points) {
  if (!image?.url || !photos.get(image.url)) return null
  const key = `${image.url}|${aspect.toFixed(3)}|${JSON.stringify(points)}`
  if (fields.has(key)) return fields.get(key)
  const field = buildField(photos.get(image.url), aspect, points)
  if (fields.size > 12) fields.clear()
  fields.set(key, field)
  return field
}

function punch(value) {
  return clamp((value - 128) * 1.28 + 128, 8, 236)
}

function sampleColor(field, nx, ny, pitch, canvasWidth) {
  const width = field.width
  const height = field.height
  const cx = clamp(nx, 0, 1) * (width - 1)
  const cy = clamp(ny, 0, 1) * (height - 1)
  const radius = Math.max(0.75, (pitch / Math.max(1, canvasWidth)) * width * 0.34)
  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = Math.round(clamp(cx + dx * radius, 0, width - 1))
      const y = Math.round(clamp(cy + dy * radius, 0, height - 1))
      const index = (y * width + x) * 3
      red += field.rgb[index]
      green += field.rgb[index + 1]
      blue += field.rgb[index + 2]
      count += 1
    }
  }
  return [punch(red / count), punch(green / count), punch(blue / count)]
}

function fieldAt(field, nx, ny) {
  const x = clamp(Math.round(nx * (field.width - 1)), 0, field.width - 1)
  const y = clamp(Math.round(ny * (field.height - 1)), 0, field.height - 1)
  const index = y * field.width + x
  return {
    index,
    subject: field.subject[index],
    dist: field.dist[index],
    angle: field.angle[index],
    detail: field.detail[index],
  }
}

function mixAngle(from, to, amount) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return from + delta * amount
}

function varyColor(rgb, jitter) {
  const [hue, sat, light] = rgbToHsl(rgb[0], rgb[1], rgb[2])
  const hex = hslToHex(hue, sat, clamp(light * jitter, 0, 0.96))
  return hexToRgb(hex)
}

function buildTiles({ width, height, base, grout, seed, flow, field }) {
  const rand = mulberry32(seed || 1)
  const step = base + grout
  const tiles = []
  const bucketSize = Math.max(4, step)
  const bucketCols = Math.ceil(width / bucketSize) + 1
  const bucketRows = Math.ceil(height / bucketSize) + 1
  const buckets = Array.from({ length: bucketCols * bucketRows }, () => [])

  function blocked(tile) {
    const cx = clamp(Math.floor(tile.x / bucketSize), 0, bucketCols - 1)
    const cy = clamp(Math.floor(tile.y / bucketSize), 0, bucketRows - 1)
    const growA = Math.abs(Math.cos(tile.rot)) + Math.abs(Math.sin(tile.rot))
    for (let y = cy - 2; y <= cy + 2; y += 1) {
      if (y < 0 || y >= bucketRows) continue
      for (let x = cx - 2; x <= cx + 2; x += 1) {
        if (x < 0 || x >= bucketCols) continue
        for (const other of buckets[y * bucketCols + x]) {
          const growB = Math.abs(Math.cos(other.rot)) + Math.abs(Math.sin(other.rot))
          const need = (tile.size * growA + other.size * growB) * 0.49
          const dx = tile.x - other.x
          const dy = tile.y - other.y
          if (dx * dx + dy * dy < need * need) return true
        }
      }
    }
    return false
  }

  function clearance(x, y) {
    const cx = clamp(Math.floor(x / bucketSize), 0, bucketCols - 1)
    const cy = clamp(Math.floor(y / bucketSize), 0, bucketRows - 1)
    let best = Infinity
    for (let yy = cy - 2; yy <= cy + 2; yy += 1) {
      if (yy < 0 || yy >= bucketRows) continue
      for (let xx = cx - 2; xx <= cx + 2; xx += 1) {
        if (xx < 0 || xx >= bucketCols) continue
        for (const other of buckets[yy * bucketCols + xx]) {
          const dist = Math.hypot(other.x - x, other.y - y) - other.size * 0.5
          if (dist < best) best = dist
        }
      }
    }
    return best
  }

  function place(partial, allowOverlap) {
    const jitter = 0.97 + rand() * 0.06
    const wobble = (rand() - 0.5) * ((6 * Math.PI) / 180)
    const size = Math.max(2.5, partial.size)
    const tile = {
      x: partial.x,
      y: partial.y,
      rot: partial.rot + wobble,
      size,
      tilt: rand() * Math.PI * 2,
      jitter,
      row: partial.row,
      along: partial.along,
      bg: partial.bg,
      rgb: partial.rgb ? varyColor(partial.rgb, jitter) : null,
    }
    if (tile.x < -size || tile.y < -size || tile.x > width + size || tile.y > height + size) return false
    if (!allowOverlap && blocked(tile)) return false
    tiles.push(tile)
    const bx = clamp(Math.floor(tile.x / bucketSize), 0, bucketCols - 1)
    const by = clamp(Math.floor(tile.y / bucketSize), 0, bucketRows - 1)
    buckets[by * bucketCols + bx].push(tile)
    return true
  }

  function angleAt(x, y) {
    if (!flow || !field) return 0
    const nx = clamp(x / width, 0, 1)
    const ny = clamp(y / height, 0, 1)
    const sample = fieldAt(field, nx, ny)
    const ix = clamp(Math.round(nx * (field.width - 1)), 1, field.width - 2)
    const iy = clamp(Math.round(ny * (field.height - 1)), 1, field.height - 2)
    const at = (xx, yy) => field.dist[yy * field.width + xx]
    const normal = Math.atan2(at(ix, iy + 1) - at(ix, iy - 1), at(ix + 1, iy) - at(ix - 1, iy))
    return mixAngle(0, normal + Math.PI / 2, smoothstep(sample.subject, 0.16, 0.7))
  }

  function paintInfo(x, y, size) {
    const nx = clamp(x / width, 0, 1)
    const ny = clamp(y / height, 0, 1)
    const sample = field ? fieldAt(field, nx, ny) : null
    const bg = Boolean(sample && sample.subject < 0.34)
    return {
      bg,
      rgb: field && !bg ? sampleColor(field, nx, ny, size, width) : field ? sampleColor(field, nx, ny, size, width) : null,
      detail: sample?.detail || 0,
    }
  }

  function commit(x, y, size, rot, row, along) {
    const info = paintInfo(x, y, size)
    return place({ x, y, size, rot, row, along, bg: info.bg, rgb: info.rgb }, true)
  }

  const columns = Math.max(1, Math.round(width / step))
  const rows = Math.max(1, Math.round(height / step))
  const stepX = width / columns
  const stepY = height / rows
  const full = Math.min(stepX, stepY) - grout

  function flowShift(x, y) {
    if (!flow || !field) return { x: 0, y: 0 }
    const nx = clamp(x / width, 0, 1)
    const ny = clamp(y / height, 0, 1)
    const sample = fieldAt(field, nx, ny)
    const ix = clamp(Math.round(nx * (field.width - 1)), 1, field.width - 2)
    const iy = clamp(Math.round(ny * (field.height - 1)), 1, field.height - 2)
    const at = (xx, yy) => field.dist[yy * field.width + xx]
    const gx = at(ix + 1, iy) - at(ix - 1, iy)
    const gy = at(ix, iy + 1) - at(ix, iy - 1)
    const glen = Math.hypot(gx, gy) || 1
    const scale = ((field.width / width) + (field.height / height)) / 2
    const ring = Math.max(step * scale, 1)
    const delta = (sample.dist - Math.round(sample.dist / ring) * ring) / scale
    const weight = smoothstep(sample.subject, 0.1, 0.62)
    const push = clamp(delta, -step * 0.34, step * 0.34) * weight
    return { x: (gx / glen) * push, y: (gy / glen) * push }
  }

  let shifts = []
  for (let row = 0; row < rows; row += 1) {
    const line = []
    for (let column = 0; column < columns; column += 1) {
      line.push(flowShift((column + 0.5) * stepX, (row + 0.5) * stepY))
    }
    shifts.push(line)
  }
  for (let pass = 0; pass < 8; pass += 1) {
    const next = shifts.map((line) => line.map((shift) => ({ x: shift.x, y: shift.y })))
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        let sx = 0
        let sy = 0
        let weight = 0
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const rr = row + dy
            const cc = column + dx
            if (rr < 0 || cc < 0 || rr >= rows || cc >= columns) continue
            const sample = dx === 0 && dy === 0 ? 2 : 1
            sx += shifts[rr][cc].x * sample
            sy += shifts[rr][cc].y * sample
            weight += sample
          }
        }
        const limit = step * 0.28
        next[row][column] = { x: clamp(sx / weight, -limit, limit), y: clamp(sy / weight, -limit, limit) }
      }
    }
    shifts = next
  }

  const minGap = full + grout * 0.2
  function spaced(scale) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = (column + 0.5) * stepX + shifts[row][column].x * scale
        const y = (row + 0.5) * stepY + shifts[row][column].y * scale
        if (column > 0) {
          const px = (column - 0.5) * stepX + shifts[row][column - 1].x * scale
          const py = (row + 0.5) * stepY + shifts[row][column - 1].y * scale
          if (Math.hypot(x - px, y - py) < minGap) return false
        }
        if (row > 0) {
          const px = (column + 0.5) * stepX + shifts[row - 1][column].x * scale
          const py = (row - 0.5) * stepY + shifts[row - 1][column].y * scale
          if (Math.hypot(x - px, y - py) < minGap) return false
        }
      }
    }
    return true
  }
  let shiftScale = 0
  if (spaced(1)) shiftScale = 1
  else {
    let lo = 0
    let hi = 1
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const mid = (lo + hi) / 2
      if (spaced(mid)) lo = mid
      else hi = mid
    }
    shiftScale = lo
  }
  for (let row = 0; row < rows; row += 1) {
    const centers = []
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) * stepX
      const y = (row + 0.5) * stepY
      centers.push([x + shifts[row][column].x * shiftScale, y + shifts[row][column].y * shiftScale, x, y])
    }
    centers.forEach(([sx, sy, x, y], along) => {
      const prev = centers[along - 1]
      const nextPoint = centers[along + 1]
      let rot = 0
      if (prev && nextPoint) rot = Math.atan2(nextPoint[1] - prev[1], nextPoint[0] - prev[0])
      else if (nextPoint) rot = Math.atan2(nextPoint[1] - sy, nextPoint[0] - sx)
      else if (prev) rot = Math.atan2(sy - prev[1], sx - prev[0])
      const detail = field ? fieldAt(field, clamp(x / width, 0, 1), clamp(y / height, 0, 1)).detail : 0
      if (detail > 0.62 && full > 10) {
        const inner = Math.max(0.6, grout * 0.45)
        const small = (full - inner) / 2
        const tx = Math.cos(rot)
        const ty = Math.sin(rot)
        const nx = -ty
        const ny = tx
        const nudge = small / 2 + inner / 2
        for (const ox of [-1, 1]) {
          for (const oy of [-1, 1]) {
            commit(sx + tx * ox * nudge + nx * oy * nudge, sy + ty * ox * nudge + ny * oy * nudge, small, rot, row, along)
          }
        }
        return
      }
      commit(sx, sy, full, rot, row, along)
    })
  }

  const probe = Math.max(3, full * 0.45)
  for (let y = probe * 0.5; y < height; y += probe) {
    for (let x = probe * 0.5; x < width; x += probe) {
      const room = clearance(x, y)
      const cut = Math.min(full * 0.92, room * 2 - grout)
      if (cut < Math.max(2.5, full * 0.28)) continue
      const prev = centersAt(x, y)
      commit(x, y, cut, prev, Math.round(y / stepY), Math.round(x / stepX))
    }
  }

  function centersAt(x, y) {
    const cx = clamp(Math.floor(x / bucketSize), 0, bucketCols - 1)
    const cy = clamp(Math.floor(y / bucketSize), 0, bucketRows - 1)
    let nearest = null
    let best = Infinity
    for (let yy = cy - 1; yy <= cy + 1; yy += 1) {
      if (yy < 0 || yy >= bucketRows) continue
      for (let xx = cx - 1; xx <= cx + 1; xx += 1) {
        if (xx < 0 || xx >= bucketCols) continue
        for (const other of buckets[yy * bucketCols + xx]) {
          const dist = Math.hypot(other.x - x, other.y - y)
          if (dist < best) {
            best = dist
            nearest = other
          }
        }
      }
    }
    return nearest ? nearest.rot : angleAt(x, y)
  }

  tiles.sort((a, b) => a.row - b.row || a.along - b.along || a.y - b.y || a.x - b.x)
  const last = Math.max(1, tiles.length - 1)
  tiles.forEach((tile, index) => {
    tile.order = index / last
  })
  return tiles
}

function layoutFor(spec, section, image, width, height) {
  const aspect = width / Math.max(1, height)
  const points = focusPoints(spec, image)
  const metrics = tileMetrics(tileControl(spec, section), groutControl(spec, section), width, height)
  const flow = flowOf(spec, section)
  const seed = sectionSeedOf(spec, section, spec.sections || [])
  const pending = Boolean(image?.url && !photos.has(image.url))
  const key = [image?.url || '', width, height, metrics.base.toFixed(2), metrics.grout.toFixed(2), seed, flow ? 1 : 0, JSON.stringify(points)].join('|')
  if (!pending && layouts.has(key)) return layouts.get(key)
  const field = !pending && image ? fieldFor(image, aspect, points) : null
  const tiles = buildTiles({ width, height, base: metrics.base, grout: metrics.grout, seed, flow: Boolean(flow && field), field })
  if (pending) return { tiles, pitch: metrics.base + metrics.grout }
  const layout = { tiles, pitch: metrics.base + metrics.grout }
  if (layouts.size > 16) layouts.clear()
  layouts.set(key, layout)
  return layout
}

function specKey(spec) {
  const sections = (spec.sections || []).map((section) => `${Number(section.start).toFixed(3)}:${section.label}`).join('|')
  const seeds = spec.seeds ? JSON.stringify(spec.seeds) : String(spec.seed || 1)
  const bass = spec.profile?.timeline?.bass
  const audio = bass?.length ? `${bass.length}:${Math.round((bass[0] || 0) * 1000)}` : '0'
  const pictures = (spec.images || []).join(',')
  return `${spec.tempo || 100}|${sections}|${seeds}|${audio}|${pictures}|${spec.imageSwitch || 'section'}`
}

function createState(seed) {
  const rand = mulberry32(seed || 1)
  return {
    lights: [
      { x: 0.2 + rand() * 0.3, y: 0.2 + rand() * 0.4, dir: rand() * Math.PI * 2, wobble: rand() * 6 },
      { x: 0.55 + rand() * 0.3, y: 0.4 + rand() * 0.4, dir: rand() * Math.PI * 2, wobble: rand() * 6 },
    ],
    catchX: 0.5,
    catchY: 0.5,
    catchTime: -10,
    sweepStart: -10,
    sweepY: 0.5,
    bass: 0.2,
    loud: 0.35,
    high: 0.2,
    url: '',
    wave: null,
    revealHold: false,
  }
}

function strongBeat(metrics, previous) {
  if (!metrics || !previous) return false
  const bassJump = metrics.bass - previous.bass
  const highJump = metrics.high - previous.high
  const loudJump = metrics.loud - previous.loud
  return (bassJump > 0.16 && metrics.bass > 0.45 && bassJump >= highJump) || (loudJump > 0.22 && metrics.loud > 0.62 && metrics.bass > 0.35)
}

function step(state, time, dt, spec) {
  const sections = spec.sections || []
  const section = sectionAt(sections, time) || sections[0]
  const metrics = metricsAt(spec.profile, time)
  const previous = metricsAt(spec.profile, Math.max(0, time - dt))
  state.loud = state.loud + ((metrics?.loud ?? 0.35) - state.loud) * (1 - Math.exp(-dt / 0.3))
  state.bass = state.bass + ((metrics?.bass ?? 0.2) - state.bass) * (1 - Math.exp(-dt / 0.22))
  state.high = state.high + ((metrics?.high ?? 0.2) - state.high) * (1 - Math.exp(-dt / 0.2))
  const kind = labelKind(section?.label || '')
  const quiet = kind === 'Quiet'
  const pace = (0.85 + (speedOf(spec, section) / 100) * 2.4) * (quiet ? 0.55 : 1 + state.bass * 0.8) * dt * 0.65
  state.lights.forEach((light, index) => {
    if (index === 0 && state.revealHold) return
    light.dir += Math.sin(time * 0.23 + light.wobble) * dt * 0.29
    light.x += Math.cos(light.dir) * pace * 0.62
    light.y += Math.sin(light.dir) * pace * 0.62
    if (light.x < 0.03 || light.x > 0.97) light.dir = Math.PI - light.dir
    if (light.y < 0.03 || light.y > 0.97) light.dir = -light.dir
    light.x = clamp(light.x, 0.03, 0.97)
    light.y = clamp(light.y, 0.03, 0.97)
  })
  const hits = biggestDropTimes(spec)
  const drop = hits.some((hit) => hit > time - dt - 0.02 && hit <= time + 0.001) || (kind === 'Drop' && time - dt < (section?.start || 0) && time >= (section?.start || 0))
  if (drop && !state.revealHold) {
    state.sweepStart = time
    state.sweepY = 0.28 + ((state.lights[0].y + state.lights[1].y) % 1) * 0.44
  }
  const sweepAge = time - state.sweepStart
  if (!state.revealHold && sweepAge >= 0 && sweepAge < 0.62) {
    const along = easeInOut(sweepAge / 0.62)
    state.lights[0].x = -0.08 + along * 1.16
    state.lights[0].y = state.sweepY
  }
  if (!quiet && strongBeat(metrics, previous) && time - state.catchTime > 0.48) {
    state.catchTime = time
    state.catchX = state.lights[0].x
    state.catchY = state.lights[0].y
  }
}

function catchEnvelope(age) {
  const duration = 0.48
  const t = clamp(age / duration, 0, 1)
  if (t <= 0) return 0
  if (t >= 1) return 0
  if (t < 0.28) return easeInOut(t / 0.28)
  return 1 - easeInOut((t - 0.28) / 0.72)
}

function simulate(spec, time) {
  const key = specKey(spec)
  const target = Math.max(0, time || 0)
  if (!simCache || simCache.key !== key || target + 1e-4 < simCache.time) {
    const rewound = Boolean(simCache && target + 1e-4 < simCache.time)
    const first = (spec.sections || [])[0]
    simCache = { key, time: 0, state: createState(sectionSeedOf(spec, first, spec.sections || [])) }
    if (rewound) heldLayout = null
  }
  let guard = 0
  while (simCache.time < target - 1e-4 && guard < 20000) {
    const dt = Math.min(DT, target - simCache.time)
    step(simCache.state, simCache.time + dt, dt, spec)
    simCache.time += dt
    guard += 1
  }
  return simCache.state
}

function barLength(spec) {
  return (60 / Math.max(40, spec.tempo || 100)) * 4
}

function revealPlan(spec, time, previousUrl) {
  if (!previousUrl) return null
  const sections = [...(spec.sections || [])].sort((a, b) => a.start - b.start)
  const duration = barLength(spec) * 1.75
  const lead = duration * 0.62
  for (let index = 1; index < sections.length; index += 1) {
    const section = sections[index]
    const windowStart = section.start - lead
    if (time < windowStart || time > windowStart + duration) continue
    const nextUrl = activeImage(spec, section)?.url || ''
    const fromUrl = activeImage(spec, sections[index - 1])?.url || ''
    if (!nextUrl || nextUrl === fromUrl) continue
    if (fromUrl !== previousUrl && nextUrl !== previousUrl) continue
    const seed = sectionSeedOf(spec, section, sections)
    return {
      from: fromUrl,
      to: nextUrl,
      start: windowStart,
      duration,
      curve: (seed % 1000) / 1000 * Math.PI * 2,
      noise: (seed % 997) + 3,
    }
  }
  return null
}

function syncWave(state, spec, time) {
  const section = sectionAt(spec.sections || [], time) || (spec.sections || [])[0]
  const image = activeImage(spec, section)
  const url = image?.url || ''
  if (state.wave && time > state.wave.start + state.wave.duration) state.wave = null
  if (!state.wave) {
    const plan = revealPlan(spec, time, state.url)
    if (plan) state.wave = plan
  }
  if (url) state.url = url
  return image
}

function canvasFocus(spec, image, width, height) {
  const points = focusPoints(spec, image)
  const point = points[0] || { x: 0.5, y: 0.42 }
  const photo = image?.url ? photos.get(image.url) : null
  if (!photo) return { x: clamp(point.x, 0.08, 0.92), y: clamp(point.y, 0.08, 0.92) }
  const crop = coverRect(photo, width / Math.max(1, height))
  return {
    x: clamp((point.x * photo.width - crop.x) / Math.max(1, crop.width), 0.08, 0.92),
    y: clamp((point.y * photo.height - crop.y) / Math.max(1, crop.height), 0.08, 0.92),
  }
}

function warpedDistance(nx, ny, origin, curve) {
  const dx = nx - origin.x
  const dy = ny - origin.y
  const angle = Math.atan2(dy, dx)
  const curveScale = 1 + Math.sin(angle * 2 + curve) * 0.18 + Math.sin(angle * 5 - curve * 1.6) * 0.09
  return Math.hypot(dx, dy) * curveScale
}

function reachOf(origin, curve) {
  let max = 0.2
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]]) {
    max = Math.max(max, warpedDistance(x, y, origin, curve) + 0.07)
  }
  return max
}

function revealMix(tile, index, origin, wave, time, width, height) {
  const nx = tile.x / Math.max(1, width)
  const ny = tile.y / Math.max(1, height)
  const warped = warpedDistance(nx, ny, origin, wave.curve) + (hashUnit(index, wave.noise) - 0.5) * 0.1
  const sweepSeconds = Math.max(0.4, wave.duration * 0.82)
  const travel = easeInOut(clamp((time - wave.start) / sweepSeconds, 0, 1))
  const reach = reachOf(origin, wave.curve)
  const fade = (0.4 / sweepSeconds) * reach
  return smoothstep(travel * reach - warped, 0, fade)
}

function backgroundRgb(spec) {
  const hex = isHex(spec.background) ? spec.background : PAPER
  return hexToRgb(hex)
}

function groutRgb(spec, section) {
  const saved = editOf(spec, section)?.grout
  return hexToRgb(isHex(saved) ? saved : INK_BLACK)
}

function tileRgb(tile, bg, solid) {
  if (solid && tile.bg) return varyColor(bg, tile.jitter)
  return tile.rgb || varyColor(bg, tile.jitter)
}

function faceAmount(tile, lights, width, height) {
  const light = lights[0]
  if (!light) return 0
  const angle = Math.atan2(light.y - tile.y / height, light.x - tile.x / width)
  return Math.cos(tile.tilt - angle)
}

function hashUnit(index, bucket) {
  let state = (Math.imul(index + 1, 1664525) ^ Math.imul(bucket + 17, 2246822519)) >>> 0
  state = (Math.imul(state ^ (state >>> 15), state | 1) + 1013904223) >>> 0
  return (state >>> 0) / 4294967296
}

function shade(rgb, response, warm) {
  const scale = 1 + response
  return [
    clamp(rgb[0] * scale + warm * 8, 0, 250),
    clamp(rgb[1] * scale + warm * 3, 0, 248),
    clamp(rgb[2] * scale - warm * 5, 0, 246),
  ]
}

function mixRgb(from, to, amount) {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ]
}

function incomingColor(field, tile, width, height, solid, bg) {
  if (!field) return null
  const nx = clamp(tile.x / width, 0, 1)
  const ny = clamp(tile.y / height, 0, 1)
  const sample = fieldAt(field, nx, ny)
  if (solid && sample.subject < 0.34) return varyColor(bg, tile.jitter || 1)
  return varyColor(sampleColor(field, nx, ny, tile.size, width), tile.jitter || 1)
}

export function paintMosaic(ctx, spec) {
  const width = Math.max(1, spec.width || 1)
  const height = Math.max(1, spec.height || 1)
  const time = spec.time || 0
  const state = simulate(spec, time)
  const section = sectionAt(spec.sections || [], time) || (spec.sections || [])[0]
  const image = syncWave(state, spec, time)
  const bg = backgroundRgb(spec)
  const grout = groutRgb(spec, section)
  const solid = solidGround(spec, section)
  ctx.fillStyle = `rgb(${grout[0]}, ${grout[1]}, ${grout[2]})`
  ctx.fillRect(0, 0, width, height)

  const dest = layoutFor(spec, section, image, width, height)
  const wave = state.wave
  const waving = Boolean(wave && time >= wave.start && time <= wave.start + wave.duration)
  const fromLayout = waving && heldLayout?.url === wave.from && heldLayout.width === width && heldLayout.height === height
    ? heldLayout.layout
    : waving
      ? layoutFor(spec, section, pairFor(spec, wave.from), width, height)
      : dest
  const tiles = waving && fromLayout?.tiles?.length ? fromLayout.tiles : dest.tiles
  const toImage = waving ? pairFor(spec, wave.to) : null
  const toField = toImage?.url ? fieldFor(toImage, width / height, focusPoints(spec, toImage)) : null
  const origin = waving ? canvasFocus(spec, toImage, width, height) : null
  if (waving && origin) {
    const sweepSeconds = Math.max(0.4, wave.duration * 0.82)
    const travel = easeInOut(clamp((time - wave.start) / sweepSeconds, 0, 1))
    const ang = wave.curve + travel * 2.6 + Math.sin(travel * Math.PI) * 1.05
    const rad = 0.06 + travel * 0.78
    state.lights[0].x = clamp(origin.x + Math.cos(ang) * rad, 0.03, 0.97)
    state.lights[0].y = clamp(origin.y + Math.sin(ang) * rad, 0.03, 0.97)
  }
  state.revealHold = waving
  const kind = labelKind(section?.label || '')
  const quiet = kind === 'Quiet'
  const shimmer = shimmerOf(spec, section)
  const sweeping = time - state.sweepStart >= 0 && time - state.sweepStart < 0.62
  const amp = Math.min(0.46, (0.14 + shimmer * 0.32) * (quiet ? 0.82 : 1) + (sweeping ? 0.04 : 0))
  const catchAge = time - state.catchTime
  const catchOn = !quiet && catchAge >= 0 && catchAge < 0.48
  const catchEnv = catchOn ? catchEnvelope(catchAge) : 0
  const twinkleGate = quiet ? 0 : smoothstep(state.high, 0.42, 0.86) * shimmer
  const bucket = Math.floor(time * 4)
  const reach = Math.max(0.08, (dest.pitch || 16) / Math.min(width, height) * 2.4)

  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index]
    const x = tile.x
    const y = tile.y
    const mix = waving && toField ? revealMix(tile, index, origin, wave, time, width, height) : 1
    const oldColor = tileRgb(tile, bg, solid)
    const nextColor = mix > 0 && mix < 1 ? incomingColor(toField, tile, width, height, solid, bg) : null
    const color = nextColor ? mixRgb(oldColor, nextColor, mix) : mix >= 1 && toField ? incomingColor(toField, tile, width, height, solid, bg) || oldColor : oldColor
    const env = waving ? Math.sin(clamp(mix, 0, 1) * Math.PI) : 0
    const rot = tile.rot + (hashUnit(index, wave?.noise || 1) - 0.5) * 2 * ((15 * Math.PI) / 180) * env
    const face = faceAmount({ ...tile, x, y }, state.lights, width, height)
    let response = face * amp
    if (catchOn) {
      const dx = x / width - state.catchX
      const dy = y / height - state.catchY
      const near = Math.exp(-(dx * dx + dy * dy) / (reach * reach))
      response += near * catchEnv * shimmer * 0.055
    }
    if (twinkleGate > 0 && hashUnit(index, bucket) < twinkleGate * 0.012) {
      response += (0.5 + 0.5 * Math.sin(time * 16 + index)) * twinkleGate * 0.08
    }
    response = clamp(response, -0.46, 0.46)
    const warm = Math.max(0, face) * Math.min(0.45, shimmer * 0.4)
    const boosted = shade(color, response, warm).map((channel) => clamp(channel * (1 + 0.15 * env), 0, 250))
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.fillStyle = `rgb(${boosted[0] | 0}, ${boosted[1] | 0}, ${boosted[2] | 0})`
    ctx.fillRect(-tile.size / 2, -tile.size / 2, tile.size, tile.size)
    ctx.restore()
  }
  if (spec.tune?.mosaicMarks) {
    for (const light of state.lights) {
      ctx.beginPath()
      ctx.arc(light.x * width, light.y * height, Math.max(3, Math.min(width, height) * 0.012), 0, Math.PI * 2)
      ctx.fillStyle = '#ffe14a'
      ctx.fill()
    }
  }
  if (!waving && image?.url) heldLayout = { url: image.url, width, height, layout: dest }
}
