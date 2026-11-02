import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'
import { PAPER, labelKind, mulberry32, sectionAt, sectionKey } from './shapeLayout.js'
import { paramsAt } from './metaballs.js'

const DT = 1 / 30
const SETTLE = 0.4
const MAX_SHAPES = 72
const MAX_COLORS = 36

const VERT = `#version 300 es
void main() {
  vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec3 uPaper;
uniform vec3 uColors[36];
uniform int uGroups;
uniform int uCount;
uniform vec4 uRect[72];
uniform vec4 uInfo[72];
uniform float uFillet;
uniform float uPrint;
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
  float width = max(fwidth(dist) * 1.15, 0.7);
  return 1.0 - smoothstep(-width, width, dist);
}

float grainOf(vec2 p) {
  float speck = fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  float grit = fract(sin(dot(floor(p * 0.65), vec2(127.1, 311.7))) * 43758.5453);
  return 0.78 + 0.34 * grit + 0.08 * (speck - 0.5);
}

vec3 inkOf(vec3 color) {
  if (uPrint < 0.5) return color;
  float y = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(color, vec3(y), 0.2);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  p.y = uResolution.y - p.y;
  float dist[36];
  for (int group = 0; group < 36; group++) dist[group] = 100000.0;
  for (int i = 0; i < 72; i++) {
    if (i >= uCount) break;
    if (uInfo[i].z > 0.5) continue;
    float d = sdRoundBox(p, uRect[i].xy, uRect[i].zw, uInfo[i].x);
    int group = int(uInfo[i].y + 0.5);
    if (group >= 0 && group < 36) dist[group] = smin(dist[group], d, uFillet);
  }
  vec3 color = uPaper;
  for (int group = 0; group < 36; group++) {
    if (group >= uGroups) break;
    float cover = coverOf(dist[group]) * 0.85;
    if (cover <= 0.001) continue;
    vec3 ink = inkOf(uColors[group]);
    if (uPrint > 0.5) ink *= grainOf(p + float(group) * 13.0);
    color = mix(color, ink, cover);
  }
  for (int i = 0; i < 72; i++) {
    if (i >= uCount) break;
    if (uInfo[i].z < 0.5) continue;
    float bar = sdRoundBox(p, uRect[i].xy, uRect[i].zw, uInfo[i].x);
    int group = int(uInfo[i].y + 0.5);
    int parent = int(uInfo[i].w + 0.5);
    if (group < 0 || group >= 36 || parent < 0 || parent >= 36) continue;
    float cover = coverOf(bar) * coverOf(dist[parent]) * 0.7;
    if (cover <= 0.001) continue;
    vec3 ink = inkOf(uColors[group]);
    if (uPrint > 0.5) ink *= grainOf(p + 40.0);
    color = mix(color, ink, cover);
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

function springEase(amount) {
  const t = clamp(amount, 0, 1)
  if (t >= 1) return 1
  return 1 - Math.exp(-6.2 * t) * Math.cos(t * Math.PI * 2.35)
}

function motionOf(spec, time) {
  let slider = Number.isFinite(spec.speed) ? spec.speed : 50
  if (spec.sections?.length) {
    const section = sectionAt(spec.sections, time || 0)
    const edit = section ? spec.edits?.[sectionKey(section)] : null
    if (edit?.speed != null) slider = edit.speed
  }
  const t = clamp(slider, 0, 100) / 100
  if (t <= 0.5) return Math.pow(8, t - 0.5)
  return Math.pow(20, (t - 0.5) * 2)
}

function paperHex(spec) {
  return typeof spec.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(spec.background) ? spec.background : PAPER
}

function printOn(spec) {
  const section = sectionAt(spec.sections || [], spec.time || 0)
  const edit = section ? spec.edits?.[sectionKey(section)] : null
  if (edit && edit.print != null) return edit.print !== false
  return spec.print !== false
}

function parseHsl(color) {
  let red = 136
  let green = 136
  let blue = 136
  if (typeof color === 'string' && color.startsWith('rgb')) {
    const parts = color.match(/[\d.]+/g) || [0, 0, 0]
    red = Number(parts[0])
    green = Number(parts[1])
    blue = Number(parts[2])
  } else if (typeof color === 'string') {
    ;[red, green, blue] = hexToRgb(color)
  }
  const [hue, saturation, lightness] = rgbToHsl(red || 0, green || 0, blue || 0)
  return { h: hue || 0, s: Number.isFinite(saturation) ? saturation : 0.45, l: Number.isFinite(lightness) ? lightness : 0.55 }
}

function hueDistance(from, to) {
  const delta = Math.abs(from - to) % 360
  return Math.min(delta, 360 - delta)
}

function toneHex(hsl, lightness, saturation) {
  return hslToHex(hsl.h, clamp(saturation, 0.28, 0.92), clamp(lightness, 0.28, 0.84))
}

function slotArrangement(count, aspect) {
  const clusters = clusterPlan(count).clusters
  const portrait = aspect < 0.87
  const wide = aspect > 1.15
  let slotCols = 1
  let slotRows = 1
  if (clusters === 2) {
    slotCols = portrait ? 1 : 2
    slotRows = portrait ? 2 : 1
  } else if (clusters === 3) {
    slotCols = portrait ? 1 : wide ? 3 : 2
    slotRows = portrait ? 3 : wide ? 1 : 2
  } else if (clusters === 4) {
    slotCols = portrait ? 2 : wide ? 4 : 2
    slotRows = portrait ? 2 : wide ? 1 : 2
  } else if (clusters >= 5) {
    slotCols = portrait ? 2 : 3
    slotRows = portrait ? 3 : 2
  }
  return { cols: slotCols * 5 + 1, rows: slotRows * 5 + 1 }
}

export function gridDims(width, height, count = 14) {
  return slotArrangement(count, width / Math.max(1, height))
}

function clusterPlan(count) {
  const n = clamp(Math.round(count || 14), 4, 40)
  let clusters = 1
  if (n >= 10) clusters = 2
  if (n >= 16) clusters = 3
  if (n >= 22) clusters = 4
  if (n >= 30) clusters = 5
  if (n >= 36) clusters = 6
  const per = clamp(Math.round(n / clusters), 4, 8)
  const satellites = n >= 30 ? 2 : n >= 14 ? 1 : 0
  return { clusters, per, satellites }
}

function slotsFor(cols, rows) {
  const slots = []
  for (let row = 1; row + 4 <= rows - 1; row += 5) {
    for (let col = 1; col + 4 <= cols - 1; col += 5) slots.push({ col, row })
  }
  return slots
}

function chooseSlots(rand, slots, count, cols, rows) {
  if (!slots.length) return []
  if (count <= 1) {
    const centerCol = cols / 2
    const centerRow = rows / 2
    return [slots.slice().sort((a, b) => Math.hypot(a.col + 2 - centerCol, a.row + 2 - centerRow) - Math.hypot(b.col + 2 - centerCol, b.row + 2 - centerRow))[0]]
  }
  const pool = slots.slice()
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rand() * (index + 1))
    const hold = pool[index]
    pool[index] = pool[swap]
    pool[swap] = hold
  }
  const chosen = [pool.shift()]
  while (chosen.length < count && pool.length) {
    let best = 0
    let bestDist = -1
    pool.forEach((slot, index) => {
      const dist = Math.min(...chosen.map((item) => Math.hypot(item.col - slot.col, item.row - slot.row)))
      if (dist > bestDist) {
        bestDist = dist
        best = index
      }
    })
    chosen.push(pool.splice(best, 1)[0])
  }
  return chosen
}

function settled(shape) {
  return {
    ...shape,
    fromCol: shape.col,
    fromRow: shape.row,
    fromSpan: shape.span,
    toCol: shape.col,
    toRow: shape.row,
    toSpan: shape.span,
    anim: 1,
    alive: true,
  }
}

function insideWindow(shape, col, row, span) {
  const endCol = col + (shape.axis === 'v' ? 1 : span)
  const endRow = row + (shape.axis === 'v' ? span : 1)
  return col >= shape.winCol && row >= shape.winRow && endCol <= shape.winCol + 4 && endRow <= shape.winRow + 4
}

function cellsOf(shape, col = shape.col, row = shape.row, span = shape.span) {
  const list = []
  const length = Math.max(1, Math.round(span))
  const depth = shape.axis === 'c' ? 1 : Math.max(1, Math.round(shape.thick || 1))
  for (let along = 0; along < length; along += 1) {
    for (let across = 0; across < depth; across += 1) {
      if (shape.axis === 'v') list.push([Math.round(col) + across, Math.round(row) + along])
      else if (shape.axis === 'h') list.push([Math.round(col) + along, Math.round(row) + across])
      else list.push([Math.round(col), Math.round(row)])
    }
  }
  return list
}

function keyOf(col, row) {
  return `${col},${row}`
}

function makeCluster(rand, origin, index, per, dot) {
  const ox = origin.col
  const oy = origin.row
  const flipX = rand() < 0.5
  const flipY = rand() < 0.5
  const mapX = (x, span = 1) => (flipX ? ox + 4 - span - x : ox + x)
  const mapY = (y, span = 1) => (flipY ? oy + 4 - span - y : oy + y)
  const shapes = []
  const place = (spec) => {
    const shape = settled({
      ...spec,
      cluster: index,
      winCol: ox,
      winRow: oy,
      phase: rand() * Math.PI * 2,
    })
    shapes.push(shape)
    return shape
  }
  const verticalStrips = rand() < 0.65
  const strips = verticalStrips
    ? [0, 1, 2].map((step) => ({
      axis: 'v',
      u: 0.28 + step * 0.9,
      v: 0.28,
      span: 1.45,
      thick: 0.42,
      tone: ['accent', 'strip', 'accent2'][step],
    }))
    : [0, 1].map((step) => ({
      axis: 'h',
      u: 0.3,
      v: 0.32 + step * 0.85,
      span: 2.35,
      thick: 0.4,
      tone: ['accent', 'accent2'][step],
    }))
  place({
    col: mapX(0, 3),
    row: mapY(0, 2),
    axis: 'h',
    span: 3,
    thick: 2,
    tone: 'tone0',
    role: 'block',
    inners: strips,
  })
  const chimneyX = rand() < 0.5 ? 0 : 2
  place({
    col: mapX(chimneyX, 1),
    row: mapY(2, 2),
    axis: 'v',
    span: 2,
    thick: 1,
    tone: 'tone0',
    role: 'bar',
  })
  place({ col: mapX(0, 1), row: mapY(0, 1), axis: 'c', span: 1, thick: 1, tone: 'tone1', role: 'circle' })
  if (per >= 5) place({ col: mapX(2, 1), row: mapY(1, 1), axis: 'c', span: 1, thick: 1, tone: 'tone2', role: 'circle' })
  if (per >= 6) place({ col: mapX(1, 1), row: mapY(1, 1), axis: 'c', span: 1, thick: 1, tone: 'accent', role: 'circle' })
  if (dot) place({ col: mapX(chimneyX === 0 ? 3 : 0, 1), row: mapY(3, 1), axis: 'c', span: 1, thick: 1, tone: 'accent2', role: 'circle' })
  if (per >= 7) {
    place({
      col: mapX(chimneyX === 0 ? 1 : 0, 2),
      row: mapY(2, 1),
      axis: 'h',
      span: 2,
      thick: 1,
      tone: 'accent2',
      role: 'bar',
    })
  }
  if (per >= 8) place({ col: mapX(1, 1), row: mapY(0, 1), axis: 'c', span: 1, thick: 1, tone: 'tone1', role: 'circle' })
  return shapes
}

function buildLayout(params, dims) {
  const { cols, rows } = dims
  const plan = clusterPlan(params.count)
  const rand = mulberry32((params.seed || 1) ^ 0x51ed)
  const chosen = chooseSlots(rand, slotsFor(cols, rows), plan.clusters, cols, rows)
  const shapes = []
  chosen.forEach((origin, index) => {
    shapes.push(...makeCluster(rand, origin, index, plan.per, index < plan.satellites))
  })
  return {
    shapes,
    rand: mulberry32((params.seed || 1) ^ 0x9e3779b9),
    beat: 0,
    label: '',
    goo: 0,
  }
}

function displayed(shape) {
  const t = springEase(shape.anim)
  return {
    ...shape,
    col: shape.fromCol + (shape.toCol - shape.fromCol) * t,
    row: shape.fromRow + (shape.toRow - shape.fromRow) * t,
    span: shape.fromSpan + (shape.toSpan - shape.fromSpan) * t,
  }
}

function begin(shape) {
  const view = displayed(shape)
  shape.fromCol = view.col
  shape.fromRow = view.row
  shape.fromSpan = view.span
  shape.anim = 0
}

function shapeFits(shape, col, row, span) {
  if (shape.satellite) return col >= 1 && row >= 1
  return insideWindow(shape, col, row, span)
}

function beatAllows(label, beat) {
  const kind = labelKind(label)
  const phase = ((beat % 4) + 4) % 4
  if (kind === 'High' || kind === 'Main' || kind === 'Drop' || kind === 'Peak') return phase !== 3
  if (kind === 'Build') return phase % 2 === 0
  return phase === 0
}

function nudge(state, dims, beat) {
  const pool = state.shapes.filter((shape) => shape.alive && shape.anim >= 1 && (shape.hold || 0) <= beat && (shape.role === 'bar' || shape.role === 'circle'))
  if (!pool.length) return
  const shape = pool[Math.floor(state.rand() * pool.length)]
  if (shape.role === 'bar' && !shape.satellite) {
    const next = clamp(Math.round(shape.toSpan) + (state.rand() < 0.5 ? -1 : 1), 2, 4)
    if (next !== Math.round(shape.toSpan) && shapeFits(shape, shape.toCol, shape.toRow, next)) {
      begin(shape)
      shape.toSpan = next
      shape.hold = beat + 2
    }
    return
  }
  const step = state.rand() < 0.5 ? [state.rand() < 0.5 ? -1 : 1, 0] : [0, state.rand() < 0.5 ? -1 : 1]
  const col = Math.round(shape.toCol) + step[0]
  const row = Math.round(shape.toRow) + step[1]
  if (shape.satellite) {
    if (col < 1 || row < 1 || col >= dims.cols - 1 || row >= dims.rows - 1) return
  } else if (!shapeFits(shape, col, row, shape.toSpan)) return
  begin(shape)
  shape.toCol = col
  shape.toRow = row
  shape.hold = beat + 2
}

function stepGrid(state, time, dt, spec, dims) {
  let moving = false
  for (const shape of state.shapes) {
    if (shape.anim < 1) {
      shape.anim = Math.min(1, shape.anim + dt / (SETTLE / motionOf(spec, time)))
      moving = true
    }
  }
  state.goo = 0
  if (moving) {
    for (const shape of state.shapes) {
      if (shape.anim < 1) state.goo = Math.max(state.goo, Math.sin(clamp(shape.anim, 0, 1) * Math.PI))
    }
  }
  const params = paramsAt(spec, time)
  state.label = params.label
  const beatLen = 60 / Math.max(1, spec.tempo || 100)
  const beat = Math.floor(time / beatLen)
  if (beat === state.beat) return
  state.beat = beat
  if (!beatAllows(params.label, beat)) return
  nudge(state, dims, beat)
}

function gridKey(spec, params, dims) {
  const bass = spec.profile?.timeline?.bass
  const audio = bass?.length ? `${bass.length}:${Math.round((bass[0] || 0) * 1000)}:${Math.round((bass[bass.length - 1] || 0) * 1000)}` : '0'
  const sections = (spec.sections || []).map((section) => `${Number(section.start).toFixed(3)}:${section.label}`).join('|')
  return `${params.seed}|${Math.round(params.count)}|${dims.cols}x${dims.rows}|${audio}|${sections}|${spec.tempo || 100}`
}

function simulateGrid(spec, time) {
  const params = paramsAt(spec, time || 0)
  const dims = gridDims(spec.width, spec.height, params.count)
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

function familyFor(palette, index) {
  const list = palette?.length ? palette : ['#3a96d6', '#e24a3b', '#3cba62']
  const base = parseHsl(list[index % list.length])
  let accent = null
  let accentScore = -1
  list.forEach((hex) => {
    const item = parseHsl(hex)
    const score = hueDistance(item.h, base.h)
    if (score > accentScore) {
      accentScore = score
      accent = item
    }
  })
  if (!accent || hueDistance(accent.h, base.h) < 28) accent = { h: (base.h + 150) % 360, s: Math.max(0.5, base.s), l: base.l > 0.6 ? 0.42 : 0.72 }
  const second = { h: (accent.h + 36) % 360, s: Math.max(0.45, accent.s * 0.9), l: clamp(accent.l + 0.08, 0.35, 0.78) }
  return {
    tone0: toneHex(base, base.l, base.s),
    tone1: toneHex(base, base.l + 0.16, base.s * 0.82),
    tone2: toneHex(base, base.l - 0.14, Math.min(0.9, base.s + 0.05)),
    accent: toneHex(accent, accent.l, accent.s),
    accent2: toneHex(second, second.l, second.s),
    strip: hslToHex(accent.h, clamp(accent.s * 0.28, 0.08, 0.4), 0.86),
  }
}

function bindColors(palette, shapes) {
  const clusters = new Map()
  shapes.forEach((shape) => {
    if (!clusters.has(shape.cluster)) clusters.set(shape.cluster, familyFor(palette, clusters.size))
  })
  const colors = []
  const indexOf = new Map()
  const add = (hex) => {
    const key = hex.toLowerCase()
    if (indexOf.has(key)) return indexOf.get(key)
    const index = colors.length
    if (index >= MAX_COLORS) return indexOf.get(colors[0]) || 0
    indexOf.set(key, index)
    colors.push(hex)
    return index
  }
  const lookup = new Map()
  clusters.forEach((family, cluster) => {
    lookup.set(cluster, {
      tone0: add(family.tone0),
      tone1: add(family.tone1),
      tone2: add(family.tone2),
      accent: add(family.accent),
      accent2: add(family.accent2),
      strip: add(family.strip),
    })
  })
  return { colors, lookup }
}

function rectOf(view, cell, originX, originY) {
  if (view.axis === 'c') {
    const radius = cell * 0.5
    return {
      cx: originX + (view.col + 0.5) * cell,
      cy: originY + (view.row + 0.5) * cell,
      hw: radius,
      hh: radius,
      radius,
    }
  }
  const vertical = view.axis === 'v'
  const span = Math.max(1, view.span)
  const thick = Math.max(0.2, view.thick || 1)
  const along = span * cell
  const across = thick * cell
  const width = vertical ? across : along
  const height = vertical ? along : across
  const hw = width / 2
  const hh = height / 2
  const radius = view.role === 'inner' ? Math.min(hw, hh, cell * 0.08) : Math.min(cell * 0.5, hw, hh)
  return {
    cx: originX + view.col * cell + width / 2,
    cy: originY + view.row * cell + height / 2,
    hw,
    hh,
    radius,
  }
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
  const dims = gridDims(width, height, params.count)
  const gain = params.scale || 1
  const cell = Math.min(width / dims.cols, height / dims.rows)
  const originX = (width - cell * dims.cols) / 2 + (params.offsetX || 0) * width
  const originY = (height - cell * dims.rows) / 2 + (params.offsetY || 0) * height
  const bound = bindColors(params.colors, state.shapes)
  const rects = new Float32Array(MAX_SHAPES * 4)
  const info = new Float32Array(MAX_SHAPES * 4)
  let count = 0
  const write = (box, color, kind, parent) => {
    if (count >= MAX_SHAPES) return
    rects[count * 4] = box.cx
    rects[count * 4 + 1] = box.cy
    rects[count * 4 + 2] = box.hw
    rects[count * 4 + 3] = box.hh
    info[count * 4] = box.radius
    info[count * 4 + 1] = color
    info[count * 4 + 2] = kind
    info[count * 4 + 3] = parent
    count += 1
  }
  const views = state.shapes.map(displayed)
  views.forEach((view) => {
    const tones = bound.lookup.get(view.cluster)
    if (!tones) return
    const color = tones[view.tone] ?? tones.tone0
    const box = rectOf(view, cell, originX, originY)
    const growing = view.role === 'bar' && view.anim < 0.98 && Math.abs(view.toSpan - view.fromSpan) > 0.2
    if (growing) {
      const pulse = Math.sin(clamp(view.anim, 0, 1) * Math.PI)
      const extend = cell * 0.18 * pulse
      if (view.axis === 'h') {
        box.hw += extend * 0.5
        box.cx += extend * 0.5
      } else if (view.axis === 'v') {
        box.hh += extend * 0.5
        box.cy += extend * 0.5
      }
    }
    write(box, color, 0, 0)
    if (view.role !== 'block' || !view.inners) return
    view.inners.forEach((bar) => {
      const inner = rectOf({
        axis: bar.axis,
        col: view.col + bar.u,
        row: view.row + bar.v,
        span: bar.span,
        thick: bar.thick,
        role: 'inner',
      }, cell, originX, originY)
      write(inner, tones[bar.tone] ?? tones.accent, 1, tones.tone0)
    })
  })
  if (count > 0 && Math.abs(gain - 1) > 0.0001) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let index = 0; index < count; index += 1) {
      if (info[index * 4 + 2] > 0.5) continue
      const cx = rects[index * 4]
      const cy = rects[index * 4 + 1]
      const hw = rects[index * 4 + 2]
      const hh = rects[index * 4 + 3]
      minX = Math.min(minX, cx - hw)
      maxX = Math.max(maxX, cx + hw)
      minY = Math.min(minY, cy - hh)
      maxY = Math.max(maxY, cy + hh)
    }
    const anchorX = (minX + maxX) / 2
    const anchorY = (minY + maxY) / 2
    for (let index = 0; index < count; index += 1) {
      rects[index * 4] = anchorX + (rects[index * 4] - anchorX) * gain
      rects[index * 4 + 1] = anchorY + (rects[index * 4 + 1] - anchorY) * gain
      rects[index * 4 + 2] *= gain
      rects[index * 4 + 3] *= gain
      info[index * 4] *= gain
    }
  }
  const colors = new Float32Array(MAX_COLORS * 3)
  bound.colors.forEach((hex, index) => {
    const [red, green, blue] = hexToRgb(hex)
    colors[index * 3] = red / 255
    colors[index * 3 + 1] = green / 255
    colors[index * 3 + 2] = blue / 255
  })
  return {
    rects,
    info,
    colors,
    count,
    groups: Math.max(1, bound.colors.length),
    fillet: cell * 0.5 * (1 + (state.goo || 0) * 0.65) * gain,
    print: printOn(spec),
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
    const { bufferWidth, bufferHeight } = bufferSize(ctx, width, height)
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
    gl.uniform1f(gl.getUniformLocation(glProgram, 'uFillet'), field.fillet)
    gl.uniform1f(gl.getUniformLocation(glProgram, 'uPrint'), field.print ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(glCanvas, 0, 0, width, height)
  }
  ctx.restore()
}
