import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'
import { metricsAt } from './profileTrack.js'
import { PAPER, mulberry32 } from './shapeLayout.js'
import { paramsAt } from './metaballs.js'

const DT = 1 / 30
const MAX_SHAPES = 28
const ANIM = 0.25

const VERT = `#version 300 es
void main() {
  vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec3 uPaper;
uniform vec3 uColors[8];
uniform int uGroups;
uniform int uCount;
uniform vec4 uRect[28];
uniform vec4 uInfo[28];
uniform vec4 uClip[28];
uniform float uFillet;
uniform float uOpacity;
uniform float uStripe;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 c, vec2 h, float r) {
  vec2 q = abs(p - c) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.0001), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float coverOf(float dist) {
  float width = max(fwidth(dist) * 0.75, 0.65);
  return 1.0 - smoothstep(-width, width, dist);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  p.y = uResolution.y - p.y;
  float dist[8];
  for (int group = 0; group < 8; group++) dist[group] = 100000.0;
  for (int i = 0; i < 28; i++) {
    if (i >= uCount) break;
    if (uInfo[i].z > 0.5) continue;
    float d = sdRoundBox(p, uRect[i].xy, uRect[i].zw, uInfo[i].x);
    int group = int(uInfo[i].y + 0.5);
    if (group >= 0 && group < 8) dist[group] = smin(dist[group], d, uFillet);
  }
  vec3 color = uPaper;
  for (int group = 0; group < 8; group++) {
    if (group >= uGroups) break;
    color = mix(color, uColors[group], coverOf(dist[group]) * uOpacity);
  }
  for (int i = 0; i < 28; i++) {
    if (i >= uCount) break;
    if (uInfo[i].z < 0.5) continue;
    float bar = sdRoundBox(p, uRect[i].xy, uRect[i].zw, uInfo[i].x);
    float parent = sdRoundBox(p, uClip[i].xy, uClip[i].zw, uInfo[i].w);
    float inside = 1.0 - smoothstep(-1.25, 0.4, parent);
    int group = int(uInfo[i].y + 0.5);
    if (group < 0 || group >= 8) continue;
    color = mix(color, uColors[group], coverOf(bar) * inside * uStripe);
  }
  outColor = vec4(color, 1.0);
}`

let glCanvas = null
let gl = null
let glProgram = null
let glVao = null
let glError = ''
let gridCache = null

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function easeOut(amount) {
  const t = clamp(amount, 0, 1)
  return 1 - (1 - t) ** 3
}

function motionOf(spec) {
  const slider = Number.isFinite(spec.speed) ? spec.speed : 50
  return Math.pow(8, clamp(slider, 0, 100) / 100 - 0.5)
}

function paperHex(spec) {
  return typeof spec.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(spec.background) ? spec.background : PAPER
}

function liftChannels(color) {
  let red
  let green
  let blue
  if (typeof color === 'string' && color.startsWith('rgb')) {
    const parts = color.match(/[\d.]+/g) || [0, 0, 0]
    red = Number(parts[0])
    green = Number(parts[1])
    blue = Number(parts[2])
  } else {
    ;[red, green, blue] = hexToRgb(color)
  }
  const [hue, saturation, lightness] = rgbToHsl(red, green, blue)
  if (!Number.isFinite(lightness) || lightness >= 0.48) {
    const safe = (channel) => (Number.isFinite(channel) ? channel / 255 : 0)
    return [safe(red), safe(green), safe(blue)]
  }
  const next = 0.48 + (0.48 - lightness) * 0.2
  const [r, g, b] = hexToRgb(hslToHex(hue, saturation, next))
  return [r / 255, g / 255, b / 255]
}

export function gridDims(width, height) {
  const aspect = width / Math.max(1, height)
  if (aspect > 1.15) return { cols: 6, rows: 4 }
  if (aspect < 0.87) return { cols: 4, rows: 6 }
  return { cols: 5, rows: 5 }
}

function shapeTarget(count, cells) {
  const t = clamp((count - 8) / 24, 0, 1)
  return clamp(Math.round(4 + t * 7), 4, Math.max(4, Math.floor(cells * 0.42)))
}

function cellsOf(shape, col = shape.col, row = shape.row, span = shape.span) {
  const list = []
  const length = Math.max(1, Math.round(span))
  for (let step = 0; step < length; step += 1) {
    list.push([
      shape.axis === 'h' ? Math.round(col) + step : Math.round(col),
      shape.axis === 'v' ? Math.round(row) + step : Math.round(row),
    ])
  }
  return list
}

function inside(cols, rows, col, row) {
  return col >= 0 && row >= 0 && col < cols && row < rows
}

function occupyMap(shapes, cols, rows) {
  const map = Array.from({ length: rows }, () => Array(cols).fill(false))
  for (const shape of shapes) {
    if (!shape.alive || shape.toScale <= 0) continue
    for (const [col, row] of cellsOf(shape, shape.toCol, shape.toRow, shape.toSpan)) {
      if (inside(cols, rows, col, row)) map[row][col] = true
    }
  }
  return map
}

function runFits(map, cols, rows, col, row, span, axis) {
  for (let step = 0; step < span; step += 1) {
    const c = axis === 'h' ? col + step : col
    const r = axis === 'v' ? row + step : row
    if (!inside(cols, rows, c, r) || map[r][c]) return false
  }
  return true
}

function paintShape(rand, cols, rows, map, color, axis, span) {
  const spots = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (runFits(map, cols, rows, col, row, span, axis)) spots.push({ col, row })
    }
  }
  if (!spots.length) return null
  const spot = spots[Math.floor(rand() * spots.length)]
  for (let step = 0; step < span; step += 1) {
    const col = axis === 'h' ? spot.col + step : spot.col
    const row = axis === 'v' ? rowOf(axis, spot.row, step) : spot.row
    map[row][col] = true
  }
  return { col: spot.col, row: spot.row, color, axis, span }
}

function rowOf(axis, row, step) {
  return axis === 'v' ? row + step : row
}

function settled(shape) {
  return {
    ...shape,
    fromCol: shape.col,
    fromRow: shape.row,
    fromSpan: shape.span,
    fromScale: 1,
    toCol: shape.col,
    toRow: shape.row,
    toSpan: shape.span,
    toScale: 1,
    anim: 1,
    alive: true,
  }
}

function attachCircle(shape, map, cols, rows) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (const [col, row] of cellsOf(shape)) {
    for (const [dc, dr] of dirs) {
      const nextCol = col + dc
      const nextRow = row + dr
      if (!runFits(map, cols, rows, nextCol, nextRow, 1, 'c')) continue
      map[nextRow][nextCol] = true
      return { col: nextCol, row: nextRow, color: shape.color, axis: 'c', span: 1 }
    }
  }
  return null
}

function buildLayout(params, dims) {
  const { cols, rows } = dims
  const colors = Math.max(2, params.colors?.length || 2)
  const rand = mulberry32((params.seed || 1) ^ 0x51ed)
  const map = Array.from({ length: rows }, () => Array(cols).fill(false))
  const target = shapeTarget(params.count, cols * rows)
  const shapes = []
  const big = Math.min(3, Math.max(2, Math.round(target / 3)))
  for (let index = 0; index < big; index += 1) {
    const vertical = rows > cols ? index % 2 === 0 : index % 2 === 1
    const span = index === 0 ? 3 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2)
    const placed = paintShape(rand, cols, rows, map, index % colors, vertical ? 'v' : 'h', span)
    if (!placed) continue
    shapes.push(settled(placed))
    if (index < 2) {
      const neighbor = attachCircle(placed, map, cols, rows)
      if (neighbor) shapes.push(settled(neighbor))
    }
  }
  let circles = 0
  while (circles < 2) {
    const placed = paintShape(rand, cols, rows, map, (big + circles) % colors, 'c', 1)
    if (!placed) break
    shapes.push(settled(placed))
    circles += 1
  }
  let guard = 0
  while (shapes.length < target && guard < 80) {
    guard += 1
    const roll = rand()
    const color = Math.floor(rand() * colors)
    const vertical = rand() < (rows > cols ? 0.6 : 0.4)
    const axis = roll < 0.46 ? 'c' : vertical ? 'v' : 'h'
    const span = axis === 'c' ? 1 : 2 + Math.floor(rand() * 2)
    const placed = paintShape(rand, cols, rows, map, color, axis, span)
    if (placed) shapes.push(settled(placed))
  }
  const stripes = []
  shapes.forEach((shape, index) => {
    if (shape.axis === 'c' || shape.span < 3) return
    const bars = 2 + Math.floor(rand() * 2)
    for (let bar = 0; bar < bars; bar += 1) {
      stripes.push({
        parent: index,
        along: (bar + 1) / (bars + 1),
        color: (shape.color + 1 + bar) % colors,
        thick: 0.22 + rand() * 0.08,
      })
    }
  })
  return {
    shapes,
    stripes,
    rand: mulberry32((params.seed || 1) ^ 0x9e3779b9),
    beat: 0,
    label: '',
    pendingDrop: false,
  }
}

function displayed(shape) {
  const t = easeOut(shape.anim)
  return {
    col: shape.fromCol + (shape.toCol - shape.fromCol) * t,
    row: shape.fromRow + (shape.toRow - shape.fromRow) * t,
    span: shape.fromSpan + (shape.toSpan - shape.fromSpan) * t,
    scale: shape.fromScale + (shape.toScale - shape.fromScale) * t,
    axis: shape.axis,
    color: shape.color,
    alive: shape.alive,
  }
}

function begin(shape) {
  const view = displayed(shape)
  shape.fromCol = view.col
  shape.fromRow = view.row
  shape.fromSpan = view.span
  shape.fromScale = view.scale
  shape.anim = 0
}

function freeSpot(map, cols, rows, rand) {
  const spots = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!map[row][col]) spots.push({ col, row })
    }
  }
  if (!spots.length) return null
  return spots[Math.floor(rand() * spots.length)]
}

function unlocked(state, beat, pred) {
  return state.shapes.filter(
    (shape) => shape.alive && shape.anim >= 1 && shape.toScale > 0 && (shape.hold || 0) <= beat && (!pred || pred(shape)),
  )
}

function lock(shape, beat) {
  shape.hold = beat + 2
}

function popCircle(state, dims, colors, beat) {
  const map = occupyMap(state.shapes, dims.cols, dims.rows)
  if (filled(map) > 0.62) return false
  const spot = freeSpot(map, dims.cols, dims.rows, state.rand)
  if (!spot) return false
  const shape = {
    ...settled({ ...spot, axis: 'c', span: 1, color: Math.floor(state.rand() * colors) }),
    fromScale: 0,
    toScale: 1,
    anim: 0,
  }
  lock(shape, beat)
  state.shapes.push(shape)
  return true
}

function shrinkCircle(state, beat) {
  const pool = unlocked(state, beat, (shape) => shape.axis === 'c')
  if (!pool.length) return false
  const shape = pool[Math.floor(state.rand() * pool.length)]
  begin(shape)
  shape.toScale = 0
  lock(shape, beat)
  return true
}

function extendShape(state, dims, beat, allowRetract) {
  const pills = unlocked(state, beat, (shape) => shape.axis !== 'c')
  const pool = pills.length ? pills : unlocked(state, beat)
  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const shape = pool[Math.floor(state.rand() * pool.length)]
    const map = occupyMap(state.shapes, dims.cols, dims.rows)
    for (const [col, row] of cellsOf(shape, shape.toCol, shape.toRow, shape.toSpan)) {
      if (inside(dims.cols, dims.rows, col, row)) map[row][col] = false
    }
    const axis = shape.axis === 'c' ? (dims.rows > dims.cols ? 'v' : 'h') : shape.axis
    const next = Math.round(shape.toSpan) + 1
    const col = Math.round(shape.toCol)
    const row = Math.round(shape.toRow)
    if (next <= 4 && runFits(map, dims.cols, dims.rows, col, row, next, axis)) {
      begin(shape)
      shape.axis = axis
      shape.toSpan = next
      shape.toScale = 1
      lock(shape, beat)
      return true
    }
  }
  if (!allowRetract) return false
  const shrinking = unlocked(state, beat, (shape) => shape.axis !== 'c' && shape.toSpan >= 2)
  if (!shrinking.length) return shrinkCircle(state, beat)
  const shape = shrinking[Math.floor(state.rand() * shrinking.length)]
  begin(shape)
  shape.toSpan = Math.max(1, Math.round(shape.toSpan) - 1)
  shape.toScale = 1
  lock(shape, beat)
  return true
}

function swapColor(state, colors, beat) {
  const pool = unlocked(state, beat)
  if (!pool.length || colors < 2) return false
  const shape = pool[Math.floor(state.rand() * pool.length)]
  const step = 1 + Math.floor(state.rand() * (colors - 1))
  shape.color = (shape.color + step) % colors
  lock(shape, beat)
  return true
}

function gridKey(spec, params, dims) {
  const bass = spec.profile?.timeline?.bass
  const audio = bass?.length ? `${bass.length}:${Math.round((bass[0] || 0) * 1000)}:${Math.round((bass[bass.length - 1] || 0) * 1000)}` : '0'
  const sections = (spec.sections || []).map((section) => `${Number(section.start).toFixed(3)}:${section.label}`).join('|')
  const palette = (spec.palette || []).map((entry) => entry.hex || entry.id || '').join(',')
  return `${params.seed}|${Math.round(params.count)}|${dims.cols}x${dims.rows}|${palette}|${audio}|${sections}|${spec.tempo || 100}`
}

function filled(map) {
  let used = 0
  let total = 0
  for (const row of map) {
    for (const cell of row) {
      total += 1
      if (cell) used += 1
    }
  }
  return total ? used / total : 1
}

function beatAllows(label, beat, metrics) {
  const phase = ((beat % 4) + 4) % 4
  if (label === 'Peak') {
    const hot = (metrics?.bass || 0) > 0.45 || (metrics?.loud || 0) > 0.55
    return hot ? phase < 3 : phase % 2 === 0
  }
  if (label === 'Build') return phase % 2 === 0
  return phase === 0
}

function stepGrid(state, time, dt, spec, dims) {
  const duration = ANIM / motionOf(spec)
  for (const shape of state.shapes) {
    if (shape.anim < 1) shape.anim = Math.min(1, shape.anim + dt / duration)
  }
  const params = paramsAt(spec, time)
  const enteredDrop = params.label === 'Drop' && state.label !== 'Drop'
  state.label = params.label
  if (enteredDrop) state.pendingDrop = true
  const beatLen = 60 / Math.max(1, spec.tempo || 100)
  const beat = Math.floor(time / beatLen)
  if (beat === state.beat) return
  state.beat = beat
  const metrics = metricsAt(spec.profile, time)
  const colors = Math.max(2, params.colors?.length || 2)
  if (state.pendingDrop && swapColor(state, colors, beat)) {
    state.pendingDrop = false
    return
  }
  if (!beatAllows(params.label, beat, metrics)) return
  if (params.label === 'Build') {
    extendShape(state, dims, beat, false) || popCircle(state, dims, colors, beat)
    return
  }
  if (params.label === 'Peak' && (metrics?.bass || 0) >= (metrics?.high || 0)) {
    extendShape(state, dims, beat, true) || popCircle(state, dims, colors, beat)
    return
  }
  if (params.label === 'Peak') {
    popCircle(state, dims, colors, beat) || extendShape(state, dims, beat, false)
    return
  }
  popCircle(state, dims, colors, beat) || extendShape(state, dims, beat, true)
}

function simulateGrid(spec, time) {
  const params = paramsAt(spec, time || 0)
  const dims = gridDims(spec.width, spec.height)
  const key = gridKey(spec, params, dims)
  const target = Math.max(0, time || 0)
  if (!gridCache || gridCache.key !== key || target + 1e-4 < gridCache.time) {
    gridCache = { key, time: 0, state: buildLayout(params, dims) }
  }
  let guard = 0
  while (gridCache.time < target - 1e-4 && guard < 20000) {
    const dt = Math.min(DT, target - gridCache.time)
    stepGrid(gridCache.state, gridCache.time, dt, spec, dims)
    gridCache.time += dt
    guard += 1
  }
  return gridCache.state
}

function rectFor(view, dims, width, height, gutter, roundness, offsetX, offsetY) {
  const cellW = width / dims.cols
  const cellH = height / dims.rows
  const unit = Math.min(cellW, cellH)
  const span = Math.max(1, view.span)
  const vertical = view.axis === 'v'
  const extra = view.axis === 'c' ? 0 : Math.max(0, span - 1)
  const thick = Math.max(1, (unit - gutter * 2) * view.scale)
  const along = thick + extra * (vertical ? cellH : cellW) * view.scale
  const hw = vertical ? thick / 2 : along / 2
  const hh = vertical ? along / 2 : thick / 2
  const cx = (view.col + (vertical ? 1 : 1 + extra) / 2) * cellW + offsetX
  const cy = (view.row + (vertical ? 1 + extra : 1) / 2) * cellH + offsetY
  const limit = Math.min(hw, hh)
  const blend = view.axis === 'c' ? 0 : clamp(extra / 0.35, 0, 1)
  const pill = limit * (0.45 + roundness * 0.55)
  return {
    cx,
    cy,
    hw,
    hh,
    radius: Math.min(limit, limit + (pill - limit) * blend),
    color: view.color,
    axis: extra > 0.02 ? view.axis : 'c',
  }
}

function joinTouching(rects, fillet, cell) {
  const overlap = fillet * 0.5
  const far = cell * 0.92
  const near = cell * 0.48
  const span = Math.max(1, far - near)
  const moves = rects.map(() => ({ x: 0, y: 0, hw: 0, hh: 0 }))
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]
      const b = rects[j]
      if (!a || !b || a.color !== b.color) continue
      const dx = b.cx - a.cx
      const dy = b.cy - a.cy
      const gapX = Math.abs(dx) - a.hw - b.hw
      const gapY = Math.abs(dy) - a.hh - b.hh
      if (gapX > -overlap && gapX < far && gapY < -Math.min(a.hh, b.hh) * 0.4) {
        const t = clamp((far - gapX) / span, 0, 1)
        const close = t * (gapX + overlap)
        const dir = dx >= 0 ? 1 : -1
        moves[i].x += dir * close * 0.5
        moves[j].x -= dir * close * 0.5
        moves[i].hw += close * 0.5
        moves[j].hw += close * 0.5
      } else if (gapY > -overlap && gapY < far && gapX < -Math.min(a.hw, b.hw) * 0.4) {
        const t = clamp((far - gapY) / span, 0, 1)
        const close = t * (gapY + overlap)
        const dir = dy >= 0 ? 1 : -1
        moves[i].y += dir * close * 0.5
        moves[j].y -= dir * close * 0.5
        moves[i].hh += close * 0.5
        moves[j].hh += close * 0.5
      }
    }
  }
  rects.forEach((rect, index) => {
    if (!rect) return
    rect.cx += moves[index].x
    rect.cy += moves[index].y
    rect.hw += moves[index].hw
    rect.hh += moves[index].hh
  })
}

function compile(context, type, source) {
  const shader = context.createShader(type)
  context.shaderSource(shader, source)
  context.compileShader(shader)
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    const message = context.getShaderInfoLog(shader) || 'shader failed'
    context.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function ensureGL() {
  if (gl) return true
  if (glError) return false
  try {
    glCanvas = document.createElement('canvas')
    gl = glCanvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('webgl2 unavailable')
    const vertex = compile(gl, gl.VERTEX_SHADER, VERT)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    glProgram = gl.createProgram()
    gl.attachShader(glProgram, vertex)
    gl.attachShader(glProgram, fragment)
    gl.linkProgram(glProgram)
    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProgram) || 'link failed')
    glVao = gl.createVertexArray()
    gl.bindVertexArray(glVao)
  } catch (error) {
    glError = error?.message || String(error)
    gl = null
    return false
  }
  return true
}

function bufferSize(ctx, width, height) {
  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
  const scaleX = Math.abs(transform?.a || 1) || 1
  const scaleY = Math.abs(transform?.d || 1) || 1
  let bufferWidth = Math.max(2, Math.round(width * scaleX))
  let bufferHeight = Math.max(2, Math.round(height * scaleY))
  const longest = Math.max(bufferWidth, bufferHeight)
  if (longest > 4096) {
    const fit = 4096 / longest
    bufferWidth = Math.max(2, Math.round(bufferWidth * fit))
    bufferHeight = Math.max(2, Math.round(bufferHeight * fit))
  }
  return { bufferWidth, bufferHeight, scaleX, scaleY }
}

function upload(state, spec, width, height) {
  const params = paramsAt(spec, spec.time || 0)
  const dims = gridDims(width, height)
  const scale = params.scale || 1
  const cell = Math.min(width / dims.cols, height / dims.rows)
  const gutter = cell * clamp(0.1 / scale, 0.05, 0.16)
  const roundness = clamp(spec.roundness ?? 0.7, 0, 1)
  const offsetX = (params.offsetX || 0) * width
  const offsetY = (params.offsetY || 0) * height
  const fillet = cell * 0.08
  const views = state.shapes.map(displayed)
  const solids = views.map((view) => (view.alive && view.scale > 0.02 ? rectFor(view, dims, width, height, gutter, roundness, offsetX, offsetY) : null))
  joinTouching(solids, fillet, cell)
  const breath = 1 + Math.sin((spec.time || 0) * 1.7) * 0.03
  const rects = new Float32Array(MAX_SHAPES * 4)
  const info = new Float32Array(MAX_SHAPES * 4)
  const clip = new Float32Array(MAX_SHAPES * 4)
  let count = 0
  const parents = []
  for (let index = 0; index < solids.length && count < MAX_SHAPES; index += 1) {
    const shape = solids[index]
    if (!shape) continue
    rects[count * 4] = shape.cx
    rects[count * 4 + 1] = shape.cy
    rects[count * 4 + 2] = shape.hw
    rects[count * 4 + 3] = shape.hh
    info[count * 4] = shape.radius
    info[count * 4 + 1] = shape.color
    info[count * 4 + 2] = 0
    info[count * 4 + 3] = shape.radius
    parents[index] = count
    count += 1
  }
  for (const stripe of state.stripes || []) {
    if (count >= MAX_SHAPES) break
    const parent = solids[stripe.parent]
    const slot = parents[stripe.parent]
    if (!parent || slot == null) continue
    const thick = Math.min(parent.hw, parent.hh) * stripe.thick * breath
    const horizontal = parent.axis === 'v'
    const cx = horizontal ? parent.cx : parent.cx - parent.hw + parent.hw * 2 * stripe.along
    const cy = horizontal ? parent.cy - parent.hh + parent.hh * 2 * stripe.along : parent.cy
    rects[count * 4] = cx
    rects[count * 4 + 1] = cy
    rects[count * 4 + 2] = horizontal ? parent.hw * 0.78 : thick
    rects[count * 4 + 3] = horizontal ? thick : parent.hh * 0.78
    info[count * 4] = thick
    info[count * 4 + 1] = stripe.color
    info[count * 4 + 2] = 1
    info[count * 4 + 3] = parent.radius
    clip[count * 4] = parent.cx
    clip[count * 4 + 1] = parent.cy
    clip[count * 4 + 2] = parent.hw
    clip[count * 4 + 3] = parent.hh
    count += 1
  }
  const colors = new Float32Array(8 * 3)
  const palette = params.colors?.length ? params.colors : ['#3a96d6', '#e24a3b']
  for (let group = 0; group < 8; group += 1) {
    const channels = liftChannels(palette[group % palette.length])
    colors[group * 3] = channels[0]
    colors[group * 3 + 1] = channels[1]
    colors[group * 3 + 2] = channels[2]
  }
  return {
    rects,
    info,
    clip,
    colors,
    count,
    groups: Math.max(2, Math.min(8, palette.length)),
    fillet,
    stripe: 0.6,
  }
}

export function paintGrid(ctx, spec) {
  const width = spec.width
  const height = spec.height
  if (!(width > 0) || !(height > 0)) return
  const state = simulateGrid(spec, spec.time || 0)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = paperHex(spec)
  ctx.fillRect(0, 0, width, height)
  if (ensureGL()) {
    const { bufferWidth, bufferHeight, scaleX, scaleY } = bufferSize(ctx, width, height)
    if (glCanvas.width !== bufferWidth || glCanvas.height !== bufferHeight) {
      glCanvas.width = bufferWidth
      glCanvas.height = bufferHeight
    }
    const field = upload(state, spec, bufferWidth, bufferHeight)
    const paper = hexToRgb(paperHex(spec)).map((channel) => channel / 255)
    gl.viewport(0, 0, bufferWidth, bufferHeight)
    gl.useProgram(glProgram)
    gl.bindVertexArray(glVao)
    gl.uniform2f(gl.getUniformLocation(glProgram, 'uResolution'), bufferWidth, bufferHeight)
    gl.uniform3f(gl.getUniformLocation(glProgram, 'uPaper'), paper[0], paper[1], paper[2])
    gl.uniform3fv(gl.getUniformLocation(glProgram, 'uColors'), field.colors)
    gl.uniform1i(gl.getUniformLocation(glProgram, 'uGroups'), field.groups)
    gl.uniform1i(gl.getUniformLocation(glProgram, 'uCount'), field.count)
    gl.uniform4fv(gl.getUniformLocation(glProgram, 'uRect'), field.rects)
    gl.uniform4fv(gl.getUniformLocation(glProgram, 'uInfo'), field.info)
    gl.uniform4fv(gl.getUniformLocation(glProgram, 'uClip'), field.clip)
    gl.uniform1f(gl.getUniformLocation(glProgram, 'uFillet'), field.fillet)
    gl.uniform1f(gl.getUniformLocation(glProgram, 'uOpacity'), 1)
    gl.uniform1f(gl.getUniformLocation(glProgram, 'uStripe'), field.stripe)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const exact = Math.abs(width * scaleX - bufferWidth) < 0.75 && Math.abs(height * scaleY - bufferHeight) < 0.75
    ctx.imageSmoothingEnabled = !exact
    ctx.drawImage(glCanvas, 0, 0, width, height)
  }
  ctx.restore()
}
