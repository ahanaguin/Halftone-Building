import { ensureFocus } from './collageField.js'
import { biggestDropTimes } from './metaballs.js'
import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'
import { metricsAt } from './profileTrack.js'
import { PAPER, isHex, labelKind, mulberry32, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'

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
  const value = editOf(spec, section)?.shimmer ?? 50
  return clamp(Number(value) || 0, 0, 100) / 100
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

function pitchFor(control, width, height) {
  const shortSide = Math.min(width, height)
  const t = clamp(control / 100, 0, 1)
  return Math.max(8, shortSide * (0.016 + t * 0.04))
}

function groutFor(control, pitch) {
  const t = clamp(control / 100, 0, 1)
  return Math.max(1, pitch * (0.035 + t * 0.22))
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
      const detail = smoothstep(mag[index] / Math.max(0.001, magMax), 0.08, 0.4)
      subject[index] = clamp(focus * 0.82 + detail * (0.42 + focus * 0.7), 0, 1)
    }
  }
  return { width, height, rgb, dist, angle, subject }
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
  return [red / count, green / count, blue / count]
}

function fieldAt(field, nx, ny) {
  const x = clamp(Math.round(nx * (field.width - 1)), 0, field.width - 1)
  const y = clamp(Math.round(ny * (field.height - 1)), 0, field.height - 1)
  const index = y * field.width + x
  return { index, subject: field.subject[index], dist: field.dist[index], angle: field.angle[index] }
}

function varyColor(rgb, jitter) {
  const [hue, sat, light] = rgbToHsl(rgb[0], rgb[1], rgb[2])
  const hex = hslToHex(hue, sat, clamp(light * jitter, 0, 0.96))
  return hexToRgb(hex)
}

function buildTiles({ width, height, pitch, grout, seed, flow, field }) {
  const rand = mulberry32(seed || 1)
  const columns = Math.max(1, Math.round(width / pitch))
  const rows = Math.max(1, Math.round(height / pitch))
  const stepX = width / columns
  const stepY = height / rows
  const step = (stepX + stepY) / 2
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

  function nearestDist(x, y) {
    const cx = clamp(Math.floor(x / bucketSize), 0, bucketCols - 1)
    const cy = clamp(Math.floor(y / bucketSize), 0, bucketRows - 1)
    let best = Infinity
    for (let yy = cy - 2; yy <= cy + 2; yy += 1) {
      if (yy < 0 || yy >= bucketRows) continue
      for (let xx = cx - 2; xx <= cx + 2; xx += 1) {
        if (xx < 0 || xx >= bucketCols) continue
        for (const other of buckets[yy * bucketCols + xx]) {
          const dx = other.x - x
          const dy = other.y - y
          const dist = dx * dx + dy * dy
          if (dist < best) best = dist
        }
      }
    }
    return Math.sqrt(best)
  }

  function place(partial) {
    const jitter = 0.97 + rand() * 0.06
    const wobble = (rand() - 0.5) * ((8 * Math.PI) / 180)
    const rot = partial.rot + wobble
    const grow = Math.abs(Math.cos(rot)) + Math.abs(Math.sin(rot))
    const nominal = Math.max(3, step - grout)
    const vary = 0.9 + rand() * 0.2
    const fitted = Number.isFinite(partial.fit) ? partial.fit : nominal
    const size = Math.max(3, Math.min(nominal * vary, fitted, (step * 0.992) / grow))
    const tile = {
      x: partial.x,
      y: partial.y,
      rot,
      size,
      tilt: rand() * Math.PI * 2,
      jitter,
      row: partial.row,
      along: partial.along,
      bg: partial.bg,
      rgb: partial.bg ? null : varyColor(partial.rgb, jitter),
    }
    if (tile.x < -size || tile.y < -size || tile.x > width + size || tile.y > height + size) return
    if (blocked(tile)) return
    tiles.push(tile)
    const bx = clamp(Math.floor(tile.x / bucketSize), 0, bucketCols - 1)
    const by = clamp(Math.floor(tile.y / bucketSize), 0, bucketRows - 1)
    buckets[by * bucketCols + bx].push(tile)
  }

  if (flow && field) {
    const scaleX = field.width / width
    const scaleY = field.height / height
    const ringStep = Math.max(1.4, step * ((scaleX + scaleY) / 2))
    let maxDist = 0
    for (let index = 0; index < field.dist.length; index += 1) {
      if (field.dist[index] < 1e5 && field.dist[index] > maxDist) maxDist = field.dist[index]
    }
    const seen = new Uint8Array(field.width * field.height)
    const normalAt = (index) => {
      const x = index % field.width
      const y = (index - x) / field.width
      const left = distAt(x - 1, y)
      const right = distAt(x + 1, y)
      const up = distAt(x, y - 1)
      const down = distAt(x, y + 1)
      return Math.atan2(down - up, right - left)
    }
    function distAt(x, y) {
      const xx = clamp(x, 0, field.width - 1)
      const yy = clamp(y, 0, field.height - 1)
      return field.dist[yy * field.width + xx]
    }
    for (let ring = ringStep * 0.45, ringIndex = 0; ring < maxDist; ring += ringStep, ringIndex += 1) {
      for (let y = 1; y < field.height - 1; y += 2) {
        for (let x = 1; x < field.width - 1; x += 2) {
          const start = y * field.width + x
          if (seen[start]) continue
          if (Math.abs(field.dist[start] - ring) > ringStep * 0.42) continue
          if (field.subject[start] < 0.3) continue
          for (const sign of [1, -1]) {
            let px = x
            let py = y
            let travel = sign === 1 ? ringStep : 0
            let prevX = 0
            let prevY = 0
            let along = 0
            for (let guard = 0; guard < field.width * 3; guard += 1) {
              const ix = Math.round(px)
              const iy = Math.round(py)
              if (ix < 1 || iy < 1 || ix >= field.width - 1 || iy >= field.height - 1) break
              const index = iy * field.width + ix
              if (guard > 4 && seen[index]) break
              for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                  const xx = ix + dx
                  const yy = iy + dy
                  if (xx < 0 || yy < 0 || xx >= field.width || yy >= field.height) continue
                  seen[yy * field.width + xx] = 1
                }
              }
              const normal = normalAt(index)
              let tx = -Math.sin(normal) * sign
              let ty = Math.cos(normal) * sign
              if (guard > 0 && tx * prevX + ty * prevY < 0) {
                tx = -tx
                ty = -ty
              }
              prevX = tx
              prevY = ty
              if (travel >= ringStep * 0.96) {
                const nx = ix / Math.max(1, field.width - 1)
                const ny = iy / Math.max(1, field.height - 1)
                const subject = field.subject[index]
                const flowAmt = smoothstep(subject, 0.28, 0.7)
                const canvasX = nx * width
                const canvasY = ny * height
                const gridX = (Math.floor(canvasX / stepX) + 0.5) * stepX
                const gridY = (Math.floor(canvasY / stepY) + 0.5) * stepY
                const tangent = field.angle[index] + Math.PI / 2
                place({
                  x: gridX + (canvasX - gridX) * flowAmt,
                  y: gridY + (canvasY - gridY) * flowAmt,
                  rot: tangent * flowAmt,
                  row: ringIndex,
                  along,
                  bg: subject < 0.34,
                  rgb: sampleColor(field, nx, ny, step, width),
                })
                along += 1
                travel = 0
              }
              px += tx
              py += ty
              travel += 1
              const jx = Math.round(px)
              const jy = Math.round(py)
              if (jx < 1 || jy < 1 || jx >= field.width - 1 || jy >= field.height - 1) break
              const next = jy * field.width + jx
              if (field.subject[next] < 0.24) break
              const error = field.dist[next] - ring
              const pull = normalAt(next)
              px -= Math.cos(pull) * error * 0.65
              py -= Math.sin(pull) * error * 0.65
            }
          }
        }
      }
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) * stepX
      const y = (row + 0.5) * stepY
      const nx = x / width
      const ny = y / height
      const sample = field ? fieldAt(field, nx, ny) : null
      const subject = sample ? sample.subject : 0
      const flowAmt = flow && sample ? smoothstep(subject, 0.28, 0.7) : 0
      const tangent = sample ? sample.angle + Math.PI / 2 : 0
      const bg = !field || Boolean(flow && subject < 0.34)
      place({
        x,
        y,
        rot: tangent * flowAmt,
        row: flow && sample ? Math.round(sample.dist) : row,
        along: column,
        bg,
        rgb: field && !bg ? sampleColor(field, nx, ny, step, width) : [0, 0, 0],
      })
    }
  }

  if (flow && field) for (let row = 0; row < rows * 2; row += 1) {
    for (let column = 0; column < columns * 2; column += 1) {
      const x = (column + 0.5) * (stepX / 2)
      const y = (row + 0.5) * (stepY / 2)
      const gap = nearestDist(x, y)
      if (gap < step * 0.72) continue
      const nx = x / width
      const ny = y / height
      const sample = field ? fieldAt(field, nx, ny) : null
      const subject = sample ? sample.subject : 0
      const flowAmt = flow && sample ? smoothstep(subject, 0.28, 0.7) : 0
      const tangent = sample ? sample.angle + Math.PI / 2 : 0
      const bg = !field || Boolean(flow && subject < 0.34)
      const fit = Math.min(step - grout, gap * 0.86)
      if (fit < step * 0.28) continue
      place({
        x,
        y,
        rot: tangent * flowAmt,
        row: sample ? Math.round(sample.dist) : row,
        along: column,
        bg,
        fit,
        rgb: field && !bg ? sampleColor(field, nx, ny, step, width) : [0, 0, 0],
      })
    }
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
  const pitch = pitchFor(tileControl(spec, section), width, height)
  const grout = groutFor(groutControl(spec, section), pitch)
  const flow = flowOf(spec, section)
  const seed = sectionSeedOf(spec, section, spec.sections || [])
  const pending = Boolean(image?.url && !photos.has(image.url))
  const key = [image?.url || '', width, height, pitch.toFixed(2), grout.toFixed(2), seed, flow ? 1 : 0, JSON.stringify(points)].join('|')
  if (!pending && layouts.has(key)) return layouts.get(key)
  const field = !pending && image ? fieldFor(image, aspect, points) : null
  const tiles = buildTiles({ width, height, pitch, grout, seed, flow: Boolean(flow && field), field })
  if (pending) return { tiles, pitch }
  const layout = { tiles, pitch }
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
  return `${spec.tempo || 100}|${sections}|${seeds}|${audio}|${pictures}|${spec.imageSwitch || 'section'}|${spec.seed || 1}`
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
  const quiet = kind === 'Quiet' || state.loud < 0.28
  const pace = (0.35 + (speedOf(spec, section) / 100) * 1.25) * (quiet ? 0.24 : 0.48 + state.bass * 1.05) * dt
  for (const light of state.lights) {
    light.dir += Math.sin(time * 0.23 + light.wobble) * dt * 0.45
    light.x += Math.cos(light.dir) * pace * 0.62
    light.y += Math.sin(light.dir) * pace * 0.62
    if (light.x < 0.03 || light.x > 0.97) light.dir = Math.PI - light.dir
    if (light.y < 0.03 || light.y > 0.97) light.dir = -light.dir
    light.x = clamp(light.x, 0.03, 0.97)
    light.y = clamp(light.y, 0.03, 0.97)
  }
  const hits = biggestDropTimes(spec)
  const drop = hits.some((hit) => hit > time - dt - 0.02 && hit <= time + 0.001) || (kind === 'Drop' && time - dt < (section?.start || 0) && time >= (section?.start || 0))
  if (drop) {
    state.sweepStart = time
    state.sweepY = 0.28 + ((state.lights[0].y + state.lights[1].y) % 1) * 0.44
  }
  const sweepAge = time - state.sweepStart
  if (sweepAge >= 0 && sweepAge < 0.4) {
    state.lights[0].x = -0.08 + (sweepAge / 0.4) * 1.16
    state.lights[0].y = state.sweepY
  }
  if (!quiet && strongBeat(metrics, previous) && time - state.catchTime > 0.28) {
    state.catchTime = time
    state.catchX = state.lights[0].x
    state.catchY = state.lights[0].y
  }
}

function simulate(spec, time) {
  const key = specKey(spec)
  const target = Math.max(0, time || 0)
  if (!simCache || simCache.key !== key || target + 1e-4 < simCache.time) {
    const first = (spec.sections || [])[0]
    simCache = { key, time: 0, state: createState(sectionSeedOf(spec, first, spec.sections || [])) }
    heldLayout = null
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

function syncWave(state, spec, time) {
  const section = sectionAt(spec.sections || [], time) || (spec.sections || [])[0]
  const image = activeImage(spec, section)
  const url = image?.url || ''
  if (state.url && url && state.url !== url) {
    const duration = 0.85 + (1 - speedOf(spec, section) / 100) * 0.95
    state.wave = { from: state.url, to: url, start: time, duration }
  }
  if (url) state.url = url
  return image
}

function backgroundRgb(spec) {
  const hex = isHex(spec.background) ? spec.background : PAPER
  return hexToRgb(hex)
}

function groutRgb(spec) {
  const [red, green, blue] = backgroundRgb(spec)
  const [hue, sat, light] = rgbToHsl(red, green, blue)
  return hexToRgb(hslToHex(hue, Math.min(1, sat * 0.9), clamp(light * 0.7, 0, 0.92)))
}

function tileRgb(tile, bg) {
  if (tile.bg) return varyColor(bg, tile.jitter)
  return tile.rgb || bg
}

function faceAmount(tile, lights, width, height) {
  let best = -1
  const nx = tile.x / width
  const ny = tile.y / height
  for (const light of lights) {
    const angle = Math.atan2(light.y - ny, light.x - nx)
    best = Math.max(best, Math.cos(tile.tilt - angle))
  }
  return best
}

function hashUnit(index, bucket) {
  let state = (Math.imul(index + 1, 1664525) ^ Math.imul(bucket + 17, 2246822519)) >>> 0
  state = (Math.imul(state ^ (state >>> 15), state | 1) + 1013904223) >>> 0
  return (state >>> 0) / 4294967296
}

function shade(rgb, response, warm) {
  const scale = 1 + response
  return [
    clamp(rgb[0] * scale + warm * 18, 0, 246),
    clamp(rgb[1] * scale + warm * 6, 0, 244),
    clamp(rgb[2] * scale - warm * 10, 0, 240),
  ]
}

function mixRgb(from, to, amount) {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ]
}

function waveAmount(order, progress) {
  return smoothstep(progress * 1.08 - order, 0, 0.07)
}

export function paintMosaic(ctx, spec) {
  const width = Math.max(1, spec.width || 1)
  const height = Math.max(1, spec.height || 1)
  const time = spec.time || 0
  const state = simulate(spec, time)
  const section = sectionAt(spec.sections || [], time) || (spec.sections || [])[0]
  const image = syncWave(state, spec, time)
  const bg = backgroundRgb(spec)
  const grout = groutRgb(spec)
  ctx.fillStyle = `rgb(${grout[0]}, ${grout[1]}, ${grout[2]})`
  ctx.fillRect(0, 0, width, height)

  const dest = layoutFor(spec, section, image, width, height)
  const wave = state.wave
  const waving = Boolean(wave && image?.url === wave.to && time < wave.start + wave.duration + 0.04)
  const fromLayout = waving && heldLayout?.url === wave.from && heldLayout.width === width && heldLayout.height === height
    ? heldLayout.layout
    : waving
      ? layoutFor(spec, section, pairFor(spec, wave.from), width, height)
      : dest
  const progress = waving ? clamp((time - wave.start) / wave.duration, 0, 1) : 1
  const kind = labelKind(section?.label || '')
  const quiet = kind === 'Quiet' || state.loud < 0.28
  const shimmer = shimmerOf(spec, section)
  const sweeping = time - state.sweepStart >= 0 && time - state.sweepStart < 0.4
  const amp = Math.min(0.12, shimmer * (quiet ? 0.045 : 0.07 + state.bass * 0.05) + (sweeping ? 0.035 : 0))
  const catchAge = time - state.catchTime
  const catchOn = !quiet && catchAge >= 0 && catchAge < 0.3
  const catchEnv = catchOn ? Math.sin((catchAge / 0.3) * Math.PI) : 0
  const twinkleGate = quiet ? 0 : smoothstep(state.high, 0.42, 0.86) * shimmer
  const bucket = Math.floor(time * 4)
  const reach = Math.max(0.08, (dest.pitch || 16) / Math.min(width, height) * 2.4)

  const count = dest.tiles.length
  const fromCount = fromLayout.tiles.length
  for (let index = 0; index < count; index += 1) {
    const tile = dest.tiles[index]
    const from = fromCount ? fromLayout.tiles[Math.round((index / Math.max(1, count - 1)) * (fromCount - 1))] : tile
    const mix = waveAmount(tile.order, progress)
    const x = from.x + (tile.x - from.x) * mix
    const y = from.y + (tile.y - from.y) * mix
    const rot = from.rot + (tile.rot - from.rot) * mix
    const size = (from.size + (tile.size - from.size) * mix) * (1 - 0.06 * Math.sin(mix * Math.PI))
    const color = mixRgb(tileRgb(from, bg), tileRgb(tile, bg), mix)
    const face = faceAmount({ ...tile, x, y }, state.lights, width, height)
    let response = face * amp
    if (catchOn) {
      const dx = x / width - state.catchX
      const dy = y / height - state.catchY
      const near = Math.exp(-(dx * dx + dy * dy) / (reach * reach))
      response += near * catchEnv * shimmer * 0.08
    }
    if (twinkleGate > 0 && hashUnit(index, bucket) < twinkleGate * 0.012) {
      response += (0.5 + 0.5 * Math.sin(time * 16 + index)) * twinkleGate * 0.08
    }
    response = clamp(response, -0.12, 0.12)
    const warm = Math.max(0, face) * shimmer * (quiet ? 0.25 : 0.55)
    const rgb = shade(color, response, warm)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.fillStyle = `rgb(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0})`
    ctx.fillRect(-size / 2, -size / 2, size, size)
    ctx.restore()
  }
  if (!waving && image?.url) heldLayout = { url: image.url, width, height, layout: dest }
}
