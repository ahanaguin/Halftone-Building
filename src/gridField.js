import { hexToRgb, hslToHex, rgbToHsl } from './palette.js'
import { metricsAt } from './profileTrack.js'
import { PAPER, labelKind, mulberry32 } from './shapeLayout.js'
import { paramsAt } from './metaballs.js'

const DT = 1 / 30
const MAX_SHAPES = 56
const SPRING = 0.58

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
uniform vec4 uRect[56];
uniform vec4 uInfo[56];
uniform vec4 uClip[56];
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
  for (int i = 0; i < 56; i++) {
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
  for (int i = 0; i < 56; i++) {
    if (i >= uCount) break;
    if (uInfo[i].z < 0.5) continue;
    float bar = sdRoundBox(p, uRect[i].xy, uRect[i].zw, uInfo[i].x);
    int group = int(uInfo[i].y + 0.5);
    if (group < 0 || group >= 8) continue;
    vec3 multiplied = color * uColors[group];
    color = mix(color, multiplied, coverOf(bar) * uStripe);
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
  const decay = Math.exp(-7.9 * t)
  return 1 - decay * Math.cos(t * Math.PI * 2.15)
}

function sizeWobble(amount) {
  const t = clamp(amount, 0, 1)
  if (t >= 1) return 1
  return 1 + 0.055 * Math.sin(t * Math.PI * 2.2) * Math.exp(-3.1 * t)
}

function motionOf(spec) {
  const slider = Number.isFinite(spec.speed) ? spec.speed : 50
  return Math.pow(8, clamp(slider, 0, 100) / 100 - 0.5)
}

function paperHex(spec) {
  return typeof spec.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(spec.background) ? spec.background : PAPER
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
  return { h: hue || 0, s: Number.isFinite(saturation) ? saturation : 0.4, l: Number.isFinite(lightness) ? lightness : 0.5 }
}

function hueDistance(from, to) {
  const delta = Math.abs(from - to) % 360
  return Math.min(delta, 360 - delta)
}

function awayFromPaper(hsl, paperL) {
  let lightness = hsl.l
  if (Math.abs(lightness - paperL) < 0.2) {
    lightness = paperL > 0.55 ? Math.min(lightness, paperL - 0.32) : Math.max(lightness, paperL + 0.32)
  }
  const [red, green, blue] = hexToRgb(hslToHex(hsl.h, clamp(hsl.s, 0, 1), clamp(lightness, 0.1, 0.9)))
  return [red / 255, green / 255, blue / 255]
}

function rolePalette(list, paper) {
  const parsed = (list?.length ? list : ['#3a96d6', '#e24a3b']).map(parseHsl)
  let leadIndex = 0
  parsed.forEach((item, index) => {
    if (item.s > parsed[leadIndex].s) leadIndex = index
  })
  const lead = { ...parsed[leadIndex] }
  let pill = null
  let best = -1
  parsed.forEach((item, index) => {
    if (index === leadIndex) return
    const score = hueDistance(item.h, lead.h) + Math.abs(item.l - lead.l) * 90
    if (score > best) {
      best = score
      pill = { ...item }
    }
  })
  if (!pill) pill = { h: (lead.h + 160) % 360, s: Math.max(0.45, lead.s), l: lead.l > 0.5 ? 0.3 : 0.74 }
  if (Math.abs(pill.l - lead.l) < 0.24) pill.l = lead.l > 0.5 ? clamp(lead.l - 0.36, 0.14, 0.62) : clamp(lead.l + 0.36, 0.4, 0.88)
  if (hueDistance(pill.h, lead.h) < 16) pill.h = (lead.h + 48) % 360
  const dark = { h: pill.h, s: Math.max(0.4, pill.s), l: 0.22 }
  const light = { h: lead.h, s: Math.max(0.28, lead.s * 0.75), l: 0.84 }
  const ground = parseHsl(paper)
  return [lead, pill, dark, light].map((item) => awayFromPaper(item, ground.l))
}

export function gridDims(width, height) {
  const aspect = width / Math.max(1, height)
  if (aspect > 1.15) return { cols: 12, rows: 8 }
  if (aspect < 0.87) return { cols: 8, rows: 12 }
  return { cols: 10, rows: 10 }
}

function cellsOf(shape, col = shape.col, row = shape.row, span = shape.span) {
  const list = []
  const length = Math.max(1, Math.round(span))
  const depth = shape.axis === 'c' ? 1 : Math.max(1, Math.round(shape.thick || 1))
  const originCol = Math.round(col)
  const originRow = Math.round(row)
  for (let along = 0; along < length; along += 1) {
    for (let across = 0; across < depth; across += 1) {
      if (shape.axis === 'v') list.push([originCol + across, originRow + along])
      else if (shape.axis === 'h') list.push([originCol + along, originRow + across])
      else list.push([originCol, originRow])
    }
  }
  return list
}

function inside(cols, rows, col, row) {
  return col >= 1 && row >= 1 && col < cols - 1 && row < rows - 1
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

function runFits(map, cols, rows, col, row, span, axis, thick = 1) {
  const probe = { axis, thick: axis === 'c' ? 1 : thick }
  for (const [c, r] of cellsOf(probe, col, row, span)) {
    if (!inside(cols, rows, c, r) || map[r][c]) return false
  }
  return true
}

function markShape(map, shape) {
  for (const [col, row] of cellsOf(shape)) {
    if (map[row] && map[row][col] != null) map[row][col] = true
  }
}

function settled(shape) {
  return {
    ...shape,
    thick: shape.thick || 1,
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

function clusterOrigin(rand, cols, rows, avoid) {
  const col = 2 + Math.floor(rand() * Math.max(1, cols - 6))
  const row = 2 + Math.floor(rand() * Math.max(1, rows - 6))
  if (!avoid) return { col, row }
  return {
    col: clamp(cols - 1 - avoid.col, 2, cols - 3),
    row: clamp(rows - 1 - avoid.row, 2, rows - 3),
  }
}

function nearestSpot(rand, origin, cols, rows, map, axis, span, thick) {
  const spots = []
  for (let row = 1; row < rows - 1; row += 1) {
    for (let col = 1; col < cols - 1; col += 1) {
      if (!runFits(map, cols, rows, col, row, span, axis, thick)) continue
      const midCol = col + (axis === 'v' ? thick : span) / 2
      const midRow = row + (axis === 'v' ? span : thick) / 2
      const dist = Math.hypot(midCol - origin.col, midRow - origin.row)
      spots.push({ col, row, dist })
    }
  }
  if (!spots.length) return null
  spots.sort((a, b) => a.dist - b.dist)
  const pool = spots.slice(0, Math.min(6, spots.length))
  return pool[Math.floor(rand() * pool.length)]
}

function addShape(shapes, map, spec) {
  const shape = settled(spec)
  shapes.push(shape)
  markShape(map, shape)
  return shape
}

function addMass(rand, shapes, map, cols, rows, origin, options = {}) {
  const compact = Boolean(options.compact)
  const vertical = rand() < (rows > cols ? 0.62 : 0.35)
  const axis = vertical ? 'v' : 'h'
  let thick = 3 + Math.floor(rand() * 2)
  let span = compact ? thick + Math.floor(rand() * 2) : thick + 1 + Math.floor(rand() * 3)
  let spot = nearestSpot(rand, origin, cols, rows, map, axis, span, thick)
  if (!spot) {
    thick = 3
    span = compact ? 3 : 4
    spot = nearestSpot(rand, origin, cols, rows, map, axis, span, thick)
  }
  if (!spot) return null
  const main = addShape(shapes, map, {
    ...spot,
    axis,
    span,
    thick,
    color: 0,
    role: 'mass',
    primary: true,
    phase: rand() * Math.PI * 2,
  })
  if (options.elbow === false) return main
  const elbowAxis = axis === 'h' ? 'v' : 'h'
  const elbowThick = 3
  const elbowSpan = 3 + Math.floor(rand() * 2)
  const anchors = axis === 'h'
    ? [
        { col: spot.col + span - elbowThick, row: spot.row + thick },
        { col: spot.col, row: spot.row - elbowSpan },
      ]
    : [
        { col: spot.col + thick, row: spot.row + span - elbowThick },
        { col: spot.col - elbowSpan, row: spot.row },
      ]
  for (const anchor of anchors) {
    if (!runFits(map, cols, rows, anchor.col, anchor.row, elbowSpan, elbowAxis, elbowThick)) continue
    addShape(shapes, map, {
      ...anchor,
      axis: elbowAxis,
      span: elbowSpan,
      thick: elbowThick,
      color: 0,
      role: 'mass',
      phase: rand() * Math.PI * 2,
    })
    break
  }
  return main
}

function addPill(rand, shapes, map, cols, rows, origin, compact = false) {
  const axis = rand() < (rows > cols ? 0.6 : 0.4) ? 'v' : 'h'
  const span = compact ? 2 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 4)
  const spot = nearestSpot(rand, origin, cols, rows, map, axis, span, 1)
  if (!spot) return false
  addShape(shapes, map, { ...spot, axis, span, thick: 1, color: 1, role: 'pill', phase: rand() * Math.PI * 2 })
  return true
}

function addDot(rand, shapes, map, cols, rows, origin, color) {
  const spot = nearestSpot(rand, origin, cols, rows, map, 'c', 1, 1)
  if (!spot) return false
  addShape(shapes, map, { ...spot, axis: 'c', span: 1, thick: 1, color, role: 'dot', phase: rand() * Math.PI * 2 })
  return true
}

function addStripes(rand, stripes, shape) {
  const extend = 2
  const along = shape.axis === 'v'
  const cross = 2 + Math.floor(rand() * 2)
  for (let bar = 0; bar < cross; bar += 1) {
    const across = ((bar + 1) / (cross + 1)) * (shape.thick || 1)
    stripes.push({
      col: (along ? shape.col + across : shape.col - 1),
      row: (along ? shape.row - 1 : shape.row + across),
      axis: shape.axis,
      span: shape.span + extend,
      thick: 0.22 + rand() * 0.1,
      color: bar % 2 === 0 ? 2 : 3,
      phase: rand() * Math.PI * 2,
      rate: 0.55 + rand() * 0.35,
    })
  }
  stripes.push({
    col: along ? shape.col - 1 : shape.col + shape.span * 0.45,
    row: along ? shape.row + shape.span * 0.45 : shape.row - 1,
    axis: along ? 'h' : 'v',
    span: (shape.thick || 3) + extend,
    thick: 0.26 + rand() * 0.08,
    color: 3,
    phase: rand() * Math.PI * 2,
    rate: 0.4 + rand() * 0.3,
  })
}

function buildLayout(params, dims) {
  const { cols, rows } = dims
  const target = clamp(Math.round(params.count || 14), 4, 40)
  const rand = mulberry32((params.seed || 1) ^ 0x51ed)
  const map = Array.from({ length: rows }, () => Array(cols).fill(false))
  const shapes = []
  const fillCap = 0.65
  const compact = target >= 28
  const first = clusterOrigin(rand, cols, rows)
  const origins = [first]
  if (target >= 18) origins.push(clusterOrigin(rand, cols, rows, first))
  addMass(rand, shapes, map, cols, rows, origins[0], { elbow: target >= 7 && !compact, compact })
  if (origins[1] && target >= 20 && target < 32 && filled(occupyMap(shapes, cols, rows)) < 0.36) {
    addMass(rand, shapes, map, cols, rows, origins[1], { elbow: false, compact: true })
  }
  const pillTarget = target <= 6 ? 2 : Math.min(4, 2 + Math.floor((target - 6) / 10))
  let pills = 0
  let guard = 0
  while (pills < pillTarget && guard < 16) {
    guard += 1
    if (filled(occupyMap(shapes, cols, rows)) >= fillCap) break
    if (!addPill(rand, shapes, map, cols, rows, origins[pills % origins.length], compact)) break
    pills += 1
  }
  let extra = 0
  while (shapes.length < target && extra < 80) {
    extra += 1
    if (filled(occupyMap(shapes, cols, rows)) >= fillCap) break
    const origin = origins[extra % origins.length]
    if (!addDot(rand, shapes, map, cols, rows, origin, extra % 2 === 0 ? 2 : 3)) break
  }
  while (shapes.length > Math.max(4, target) && filled(occupyMap(shapes, cols, rows)) > fillCap) {
    const index = shapes.findLastIndex((shape) => shape.role === 'dot')
    if (index < 0) break
    shapes.splice(index, 1)
  }
  const stripes = []
  shapes.forEach((shape) => {
    if (shape.primary) addStripes(rand, stripes, shape)
  })
  return {
    shapes,
    stripes,
    rand: mulberry32((params.seed || 1) ^ 0x9e3779b9),
    beat: 0,
    label: '',
    pendingDrop: false,
    cascade: null,
    goo: 0,
  }
}

function displayed(shape) {
  const t = springEase(shape.anim)
  return {
    col: shape.fromCol + (shape.toCol - shape.fromCol) * t,
    row: shape.fromRow + (shape.toRow - shape.fromRow) * t,
    span: shape.fromSpan + (shape.toSpan - shape.fromSpan) * t,
    scale: Math.max(0, shape.fromScale + (shape.toScale - shape.fromScale) * t),
    wobble: sizeWobble(shape.anim),
    axis: shape.axis,
    thick: shape.thick || 1,
    color: shape.color,
    role: shape.role,
    phase: shape.phase || 0,
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

function freeSpot(map, cols, rows, rand, near) {
  const spots = []
  for (let row = 1; row < rows - 1; row += 1) {
    for (let col = 1; col < cols - 1; col += 1) {
      if (!map[row][col]) spots.push({ col, row, dist: near ? Math.hypot(col - near.col, row - near.row) : 0 })
    }
  }
  if (!spots.length) return null
  if (near) spots.sort((a, b) => a.dist - b.dist)
  const pool = spots.slice(0, Math.min(near ? 8 : spots.length, spots.length))
  return pool[Math.floor(rand() * pool.length)]
}

function unlocked(state, beat, pred) {
  return state.shapes.filter(
    (shape) => shape.alive && shape.anim >= 1 && shape.toScale > 0 && (shape.hold || 0) <= beat && (!pred || pred(shape)),
  )
}

function lock(shape, beat) {
  shape.hold = beat + 2
}

function popCircle(state, dims, beat, near) {
  const map = occupyMap(state.shapes, dims.cols, dims.rows)
  if (filled(map) > 0.58) return false
  const spot = freeSpot(map, dims.cols, dims.rows, state.rand, near)
  if (!spot) return false
  const color = state.rand() < 0.5 ? 2 : 3
  const shape = {
    ...settled({ ...spot, axis: 'c', span: 1, thick: 1, color, role: 'dot', phase: state.rand() * Math.PI * 2 }),
    fromScale: 0,
    toScale: 1,
    anim: 0,
  }
  lock(shape, beat)
  state.shapes.push(shape)
  return true
}

function shrinkCircle(state, beat) {
  const pool = unlocked(state, beat, (shape) => shape.role === 'dot')
  if (!pool.length) return false
  const shape = pool[Math.floor(state.rand() * pool.length)]
  begin(shape)
  shape.toScale = 0
  lock(shape, beat)
  return true
}

function hopCircle(state, dims, beat, near) {
  let pool = unlocked(state, beat, (shape) => shape.role === 'dot')
  if (!pool.length) return false
  if (near) pool = [...pool].sort((a, b) => Math.hypot(a.toCol - near.col, a.toRow - near.row) - Math.hypot(b.toCol - near.col, b.toRow - near.row))
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (let index = 0; index < Math.min(4, pool.length); index += 1) {
    const shape = near ? pool[index] : pool[Math.floor(state.rand() * pool.length)]
    const map = occupyMap(state.shapes, dims.cols, dims.rows)
    map[Math.round(shape.toRow)][Math.round(shape.toCol)] = false
    const order = [...dirs].sort(() => state.rand() - 0.5)
    for (const [dc, dr] of order) {
      const col = Math.round(shape.toCol) + dc
      const row = Math.round(shape.toRow) + dr
      if (!runFits(map, dims.cols, dims.rows, col, row, 1, 'c', 1)) continue
      begin(shape)
      shape.toCol = col
      shape.toRow = row
      lock(shape, beat)
      return true
    }
  }
  return false
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
    const cap = shape.role === 'mass' ? 8 : 6
    const next = Math.round(shape.toSpan) + 1
    const col = Math.round(shape.toCol)
    const row = Math.round(shape.toRow)
    if (next <= cap && runFits(map, dims.cols, dims.rows, col, row, next, axis, shape.thick || 1)) {
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

function breakDroplet(state, dims, beat) {
  if (filled(occupyMap(state.shapes, dims.cols, dims.rows)) > 0.62) return false
  const masses = unlocked(state, beat, (shape) => shape.role === 'mass')
  if (!masses.length) return false
  const mass = masses[Math.floor(state.rand() * masses.length)]
  const map = occupyMap(state.shapes, dims.cols, dims.rows)
  const edges = []
  for (const [col, row] of cellsOf(mass, mass.toCol, mass.toRow, mass.toSpan)) {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextCol = col + dc
      const nextRow = row + dr
      if (!inside(dims.cols, dims.rows, nextCol, nextRow) || map[nextRow][nextCol]) continue
      let endCol = nextCol
      let endRow = nextRow
      let dist = 1
      for (let step = 2; step <= 4; step += 1) {
        const aheadCol = col + dc * step
        const aheadRow = row + dr * step
        if (!inside(dims.cols, dims.rows, aheadCol, aheadRow) || map[aheadRow][aheadCol]) break
        endCol = aheadCol
        endRow = aheadRow
        dist = step
      }
      edges.push({ fromCol: col + dc * 0.22, fromRow: row + dr * 0.22, col: endCol, row: endRow, dist })
    }
  }
  if (!edges.length) return false
  const longer = edges.filter((edge) => edge.dist >= 2)
  const pool = longer.length ? longer : edges
  const edge = pool[Math.floor(state.rand() * pool.length)]
  const shape = {
    ...settled({
      col: edge.col,
      row: edge.row,
      axis: 'c',
      span: 1,
      thick: 1,
      color: mass.color,
      role: 'dot',
      phase: state.rand() * Math.PI * 2,
    }),
    fromCol: edge.fromCol,
    fromRow: edge.fromRow,
    fromScale: 0.7,
    toScale: 1,
    anim: 0,
  }
  lock(shape, beat)
  lock(mass, beat)
  state.shapes.push(shape)
  return true
}

function mergeDroplet(state, dims, beat) {
  const masses = state.shapes.filter((shape) => shape.role === 'mass' && shape.alive && shape.toScale > 0)
  const dots = unlocked(state, beat, (shape) => shape.role === 'dot')
  const pairs = []
  for (const dot of dots) {
    for (const mass of masses) {
      if (dot.color !== mass.color) continue
      pairs.push({ dot, mass, dist: Math.hypot(dot.toCol - mass.toCol, dot.toRow - mass.toRow) })
    }
  }
  if (!pairs.length) return false
  pairs.sort((a, b) => a.dist - b.dist)
  const { dot, mass } = pairs[Math.floor(state.rand() * Math.min(3, pairs.length))]
  let best = null
  let bestDist = Infinity
  for (const [col, row] of cellsOf(mass, mass.toCol, mass.toRow, mass.toSpan)) {
    const dist = Math.hypot(col - dot.toCol, row - dot.toRow)
    if (dist < bestDist) {
      bestDist = dist
      best = [col, row]
    }
  }
  if (!best || bestDist < 0.8) return false
  begin(dot)
  dot.toCol = best[0]
  dot.toRow = best[1]
  dot.toScale = 0.35
  dot.absorb = true
  lock(dot, beat)
  lock(mass, beat)
  return true
}

function alignedPair(a, b) {
  if (a === b || a.color !== b.color || a.axis !== b.axis || a.role !== b.role || a.axis === 'c') return null
  if (Math.round(a.thick || 1) !== Math.round(b.thick || 1)) return null
  const aCol = Math.round(a.toCol)
  const aRow = Math.round(a.toRow)
  const bCol = Math.round(b.toCol)
  const bRow = Math.round(b.toRow)
  const aSpan = Math.round(a.toSpan)
  const bSpan = Math.round(b.toSpan)
  if (a.axis === 'v') {
    if (aCol !== bCol) return null
    const gap = bRow >= aRow ? bRow - (aRow + aSpan) : aRow - (bRow + bSpan)
    if (gap < 0 || gap > 1) return null
    const top = Math.min(aRow, bRow)
    return {
      host: aRow <= bRow ? a : b,
      guest: aRow <= bRow ? b : a,
      span: Math.max(aRow + aSpan, bRow + bSpan) - top,
      col: aCol,
      row: top,
    }
  }
  if (aRow !== bRow) return null
  const gap = bCol >= aCol ? bCol - (aCol + aSpan) : aCol - (bCol + bSpan)
  if (gap < 0 || gap > 1) return null
  const left = Math.min(aCol, bCol)
  return {
    host: aCol <= bCol ? a : b,
    guest: aCol <= bCol ? b : a,
    span: Math.max(aCol + aSpan, bCol + bSpan) - left,
    col: left,
    row: aRow,
  }
}

function fusePair(state, beat) {
  const pool = unlocked(state, beat, (shape) => shape.axis !== 'c' && shape.role !== 'dot')
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const match = alignedPair(pool[i], pool[j])
      if (!match) continue
      const { host, guest, span, col, row } = match
      if (span > (host.role === 'mass' ? 8 : 7)) continue
      begin(host)
      host.toCol = col
      host.toRow = row
      host.toSpan = span
      host.toScale = 1
      begin(guest)
      guest.toCol = col + (host.axis === 'h' ? span * 0.35 : 0)
      guest.toRow = row + (host.axis === 'v' ? span * 0.35 : 0)
      guest.toScale = 0
      guest.absorb = true
      lock(host, beat)
      lock(guest, beat)
      return true
    }
  }
  return false
}

function splitShape(state, dims, beat) {
  const pool = unlocked(state, beat, (shape) => shape.role === 'pill' && shape.toSpan >= 4 && shape.axis !== 'c')
  if (!pool.length) return false
  const shape = pool[Math.floor(state.rand() * pool.length)]
  const span = Math.round(shape.toSpan)
  const keep = span - 2
  if (keep < 2) return false
  const vertical = shape.axis === 'v'
  const originCol = Math.round(shape.toCol)
  const originRow = Math.round(shape.toRow)
  const cutCol = originCol + (vertical ? 0 : keep)
  const cutRow = originRow + (vertical ? keep : 0)
  const map = occupyMap(state.shapes, dims.cols, dims.rows)
  for (const [col, row] of cellsOf(shape, shape.toCol, shape.toRow, shape.toSpan)) {
    if (inside(dims.cols, dims.rows, col, row)) map[row][col] = false
  }
  const endCol = vertical ? cutCol : cutCol + 1
  const endRow = vertical ? cutRow + 1 : cutRow
  const fits = runFits(map, dims.cols, dims.rows, endCol, endRow, 2, shape.axis, 1)
  const destCol = fits ? endCol : cutCol
  const destRow = fits ? endRow : cutRow
  if (!runFits(map, dims.cols, dims.rows, destCol, destRow, 2, shape.axis, 1)) return false
  begin(shape)
  shape.toSpan = keep
  lock(shape, beat)
  const piece = {
    ...settled({
      col: destCol,
      row: destRow,
      axis: shape.axis,
      span: 2,
      thick: 1,
      color: shape.color,
      role: 'pill',
      phase: state.rand() * Math.PI * 2,
    }),
    fromCol: cutCol,
    fromRow: cutRow,
    fromSpan: 2,
    anim: 0,
  }
  lock(piece, beat)
  state.shapes.push(piece)
  return true
}

function liquidChange(state, dims, beat) {
  const roll = state.rand()
  if (roll < 0.34) return breakDroplet(state, dims, beat)
  if (roll < 0.5) return mergeDroplet(state, dims, beat)
  if (roll < 0.68) return fusePair(state, beat)
  if (roll < 0.84) return splitShape(state, dims, beat)
  return false
}

function swapColor(state, beat) {
  const pool = unlocked(state, beat)
  if (!pool.length) return false
  const shape = pool[Math.floor(state.rand() * pool.length)]
  const next = (shape.color + 1 + Math.floor(state.rand() * 3)) % 4
  shape.color = next
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

function beatAllows(label, beat, metrics, cascade) {
  if (cascade) return true
  const kind = labelKind(label)
  const phase = ((beat % 4) + 4) % 4
  if (kind === 'High') {
    const hot = (metrics?.bass || 0) > 0.5 || (metrics?.loud || 0) > 0.62
    return hot ? true : phase !== 3
  }
  if (kind === 'Main' || kind === 'Drop' || kind === 'Peak') {
    const hot = (metrics?.bass || 0) > 0.45 || (metrics?.loud || 0) > 0.55
    return hot ? phase !== 3 : phase % 2 === 0
  }
  if (kind === 'Build') return phase % 2 === 0
  return phase === 0
}

function oneChange(state, dims, beat, label, metrics, near) {
  if (!near && liquidChange(state, dims, beat)) return true
  const kind = labelKind(label)
  const bass = (metrics?.bass || 0) >= (metrics?.high || 0)
  if (kind === 'Build' || kind === 'Drop') return extendShape(state, dims, beat, false) || popCircle(state, dims, beat, near) || breakDroplet(state, dims, beat)
  if (bass) return extendShape(state, dims, beat, true) || hopCircle(state, dims, beat, near) || popCircle(state, dims, beat, near)
  return hopCircle(state, dims, beat, near) || popCircle(state, dims, beat, near) || extendShape(state, dims, beat, true)
}

function stepGrid(state, time, dt, spec, dims) {
  const duration = SPRING / motionOf(spec)
  let moving = false
  for (const shape of state.shapes) {
    if (shape.anim < 1) {
      shape.anim = Math.min(1, shape.anim + dt / duration)
      moving = true
    }
  }
  state.shapes = state.shapes.filter((shape) => {
    if (shape.absorb && shape.anim >= 1) return false
    if (shape.toScale <= 0 && shape.anim >= 1) return false
    return true
  })
  const goal = moving ? 1 : 0
  const tau = goal > (state.goo || 0) ? 0.08 : 0.42
  state.goo = (state.goo || 0) + (goal - (state.goo || 0)) * (1 - Math.exp(-Math.max(dt, 0.0001) / tau))
  const params = paramsAt(spec, time)
  const enteredDrop = labelKind(params.label) === 'Drop' && labelKind(state.label) !== 'Drop'
  state.label = params.label
  if (enteredDrop) state.pendingDrop = true
  const beatLen = 60 / Math.max(1, spec.tempo || 100)
  const beat = Math.floor(time / beatLen)
  if (beat === state.beat) return
  state.beat = beat
  const metrics = metricsAt(spec.profile, time)
  const phase = ((beat % 4) + 4) % 4
  const kind = labelKind(params.label)
  if ((kind === 'High' || kind === 'Main' || kind === 'Peak') && phase === 0 && !state.cascade && state.rand() < (kind === 'High' ? 0.7 : 0.5)) {
    const host = state.shapes.find((shape) => shape.alive && shape.toScale > 0)
    state.cascade = {
      left: (metrics?.bass || 0) > 0.5 ? 4 : 3,
      dir: state.rand() < 0.5 ? [1, 0] : [0, 1],
      col: host ? host.toCol : 2,
      row: host ? host.toRow : 2,
    }
  }
  if (state.pendingDrop && swapColor(state, beat)) {
    state.pendingDrop = false
    return
  }
  if (!beatAllows(params.label, beat, metrics, state.cascade)) return
  if (state.cascade) {
    state.cascade.col += state.cascade.dir[0]
    state.cascade.row += state.cascade.dir[1]
    state.cascade.left -= 1
    oneChange(state, dims, beat, params.label, metrics, state.cascade)
    if (state.cascade.left <= 0) state.cascade = null
    return
  }
  oneChange(state, dims, beat, params.label, metrics)
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
  const vertical = view.axis === 'v'
  const circle = view.axis === 'c' || view.role === 'dot'
  const span = Math.max(1, view.span)
  const depth = circle ? 1 : Math.max(1, view.thick || 1)
  const alongCells = circle ? 1 : span
  const acrossCells = circle ? 1 : depth
  const along = (vertical ? cellH : cellW) * alongCells
  const across = (vertical ? cellW : cellH) * acrossCells
  const boxW = (vertical ? across : along) - gutter * 2
  const boxH = (vertical ? along : across) - gutter * 2
  const wobble = view.wobble || 1
  let hw = Math.max(1, boxW / 2) * view.scale * wobble
  let hh = Math.max(1, boxH / 2) * view.scale * wobble
  const cx = (view.col + (vertical ? acrossCells : alongCells) / 2) * cellW + offsetX
  const cy = (view.row + (vertical ? alongCells : acrossCells) / 2) * cellH + offsetY
  if (circle) {
    const radius = Math.min(hw, hh)
    return { cx, cy, hw: radius, hh: radius, radius, color: view.color, axis: 'c', role: view.role, phase: view.phase }
  }
  const limit = Math.min(hw, hh)
  const cell = Math.min(cellW, cellH)
  const pill = depth <= 1.2
  const radius = pill ? limit * (0.72 + roundness * 0.28) : Math.min(cell * 0.9, limit * (0.28 + roundness * 0.22))
  return { cx, cy, hw, hh, radius: Math.min(radius, limit), color: view.color, axis: view.axis, role: view.role, phase: view.phase }
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
  const gain = params.scale || 1
  const cell = Math.min(width / dims.cols, height / dims.rows)
  const gutter = cell * 0.1
  const roundness = clamp(spec.roundness ?? 0.7, 0, 1)
  const offsetX = (params.offsetX || 0) * width
  const offsetY = (params.offsetY || 0) * height
  const restFillet = cell * 0.07
  const fillet = restFillet + cell * 0.9 * clamp(state.goo || 0, 0, 1)
  const motion = motionOf(spec)
  const time = spec.time || 0
  const views = state.shapes.map(displayed)
  const solids = views.map((view) => (view.alive && view.scale > 0.02 ? rectFor(view, dims, width, height, gutter, roundness, offsetX, offsetY) : null))
  joinTouching(solids, restFillet, cell)
  const cellW = width / dims.cols
  const cellH = height / dims.rows
  const bulbs = []
  solids.forEach((shape, index) => {
    const source = state.shapes[index]
    if (!shape || !source) return
    const growing = source.anim < 0.98 && source.toSpan > source.fromSpan + 0.05 && shape.axis !== 'c'
    if (growing) {
      const pulse = Math.sin(clamp(source.anim, 0, 1) * Math.PI)
      const extend = Math.min(cellW, cellH) * 0.2 * pulse
      if (shape.axis === 'h') {
        shape.hw += extend * 0.5
        shape.cx += extend * 0.5
      } else if (shape.axis === 'v') {
        shape.hh += extend * 0.5
        shape.cy += extend * 0.5
      }
      if (pulse > 0.08) {
        const radius = Math.min(shape.hw, shape.hh) * (0.9 + 0.34 * pulse)
        bulbs.push({
          cx: shape.axis === 'h' ? shape.cx + shape.hw * 0.72 : shape.cx,
          cy: shape.axis === 'v' ? shape.cy + shape.hh * 0.72 : shape.cy,
          hw: radius,
          hh: radius,
          radius,
          color: shape.color,
        })
      }
    }
    if (shape.role !== 'dot') return
    const settle = clamp((source.anim - 0.8) / 0.2, 0, 1)
    if (settle <= 0) return
    const drift = Math.min(cellW, cellH) * 0.16 * settle
    shape.cx += Math.sin(time * 0.8 * motion + shape.phase) * drift
    shape.cy += Math.cos(time * 0.62 * motion + shape.phase) * drift
  })
  const rects = new Float32Array(MAX_SHAPES * 4)
  const info = new Float32Array(MAX_SHAPES * 4)
  const clip = new Float32Array(MAX_SHAPES * 4)
  let count = 0
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
    count += 1
  }
  for (const bulb of bulbs) {
    if (count >= MAX_SHAPES) break
    rects[count * 4] = bulb.cx
    rects[count * 4 + 1] = bulb.cy
    rects[count * 4 + 2] = bulb.hw
    rects[count * 4 + 3] = bulb.hh
    info[count * 4] = bulb.radius
    info[count * 4 + 1] = bulb.color
    info[count * 4 + 2] = 0
    info[count * 4 + 3] = bulb.radius
    count += 1
  }
  for (const stripe of state.stripes || []) {
    if (count >= MAX_SHAPES) break
    const vertical = stripe.axis === 'v'
    const thin = Math.min(cellW, cellH) * stripe.thick
    const along = (vertical ? cellH : cellW) * stripe.span
    const slide = Math.sin(time * stripe.rate * motion + stripe.phase) * Math.min(cellW, cellH) * 0.9
    const cx = (stripe.col + (vertical ? 0.5 : stripe.span / 2)) * cellW + (vertical ? 0 : slide) + offsetX
    const cy = (stripe.row + (vertical ? stripe.span / 2 : 0.5)) * cellH + (vertical ? slide : 0) + offsetY
    rects[count * 4] = cx
    rects[count * 4 + 1] = cy
    rects[count * 4 + 2] = vertical ? thin / 2 : Math.max(1, along / 2)
    rects[count * 4 + 3] = vertical ? Math.max(1, along / 2) : thin / 2
    info[count * 4] = thin / 2
    info[count * 4 + 1] = stripe.color
    info[count * 4 + 2] = 1
    info[count * 4 + 3] = thin / 2
    count += 1
  }
  if (count > 0 && Math.abs(gain - 1) > 0.0001) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let index = 0; index < count; index += 1) {
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
      info[index * 4 + 3] *= gain
    }
  }
  const colors = new Float32Array(8 * 3)
  const palette = params.colors?.length ? params.colors : ['#3a96d6', '#e24a3b']
  const roles = rolePalette(palette, paperHex(spec))
  for (let group = 0; group < 4; group += 1) {
    colors[group * 3] = roles[group][0]
    colors[group * 3 + 1] = roles[group][1]
    colors[group * 3 + 2] = roles[group][2]
  }
  return {
    rects,
    info,
    clip,
    colors,
    count,
    groups: 4,
    fillet: fillet * gain,
    stripe: 0.66,
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
