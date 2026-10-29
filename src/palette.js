export const CALM_PALETTE = {
  colors: ['#2a6d78', '#314878', '#243d38'],
  warmth: 0.18,
  lightness: 0.28,
}

export const MAX_SWATCHES = 6

export function paletteForSection(label) {
  if (label === 'Peak') {
    return {
      colors: ['#ff5a36', '#ffb000', '#ff4d8d'],
      warmth: 0.88,
      lightness: 0.8,
    }
  }
  if (label === 'Build') {
    return {
      colors: ['#e08a45', '#e0b15a', '#d46a78'],
      warmth: 0.6,
      lightness: 0.55,
    }
  }
  return {
    colors: [...CALM_PALETTE.colors],
    warmth: CALM_PALETTE.warmth,
    lightness: CALM_PALETTE.lightness,
  }
}

export function explainSection(label) {
  if (label === 'Quiet') {
    return 'This quieter part holds one calm poster. Loudness only shifts the size of those large shapes a little.'
  }
  if (label === 'Build') {
    return 'The energy is rising, so the poster cuts across the frame with a few large shapes and thin guides.'
  }
  if (label === 'Peak') {
    return 'This is the loud part, so the poster opens into a burst or a beating grid. A drop cuts straight into another composition.'
  }
  return 'Each section holds one poster built from a few large shapes. Loudness shifts their size, and a drop cuts to a new one.'
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
}

export function rgbToHsl(red, green, blue) {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = 0
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0)
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  return [hue * 60, saturation, lightness]
}

export function hslToHex(hue, saturation, lightness) {
  const h = ((hue % 360) + 360) % 360
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const match = lightness - c / 2
  const channel = (value) =>
    Math.round(clamp(value + match, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function swatchHex(swatch) {
  return hslToHex(swatch.h, swatch.s, swatch.l)
}

let swatchSerial = 0

export function swatchFromHex(hex, locked = false) {
  const [red, green, blue] = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(red, green, blue)
  swatchSerial += 1
  return { id: `swatch-${swatchSerial}`, h, s, l, locked }
}

export function paletteFromPreset(preset) {
  return {
    source: 'default',
    warmth: preset.warmth,
    lightness: preset.lightness,
    swatches: preset.colors.map((color) => swatchFromHex(color)),
  }
}

export function paletteColors(palette) {
  return palette.swatches.map(swatchHex)
}

function moveTowardHue(hue, target, amount) {
  const from = ((hue % 360) + 360) % 360
  const delta = ((target - from + 540) % 360) - 180
  const step = Math.sign(delta) * Math.min(Math.abs(delta), amount)
  return (from + step + 360) % 360
}

export function shiftUnlocked(swatches, warmthFrom, warmthTo, lightFrom, lightTo) {
  const warmDelta = warmthTo - warmthFrom
  const lightDelta = lightTo - lightFrom
  if (!warmDelta && !lightDelta) return swatches
  return swatches.map((swatch) => {
    let h = swatch.h
    let s = swatch.s
    let l = swatch.l
    if (warmDelta) {
      h = moveTowardHue(h, warmDelta > 0 ? 28 : 208, Math.abs(warmDelta) * 140)
      s = clamp(s + warmDelta * 0.25, 0.18, 0.92)
    }
    if (lightDelta) l = clamp(l + lightDelta * 0.55, 0.12, 0.9)
    return { ...swatch, h, s, l }
  })
}

export function applySectionPreset(palette, preset) {
  const swatches = palette.swatches.map((swatch, index) => {
    if (index >= preset.colors.length) return swatch
    const [red, green, blue] = hexToRgb(preset.colors[index])
    const [h, s, l] = rgbToHsl(red, green, blue)
    if (swatch.h === h && swatch.s === s && swatch.l === l) return swatch
    return { ...swatch, h, s, l, locked: false }
  })
  const unchanged =
    palette.warmth === preset.warmth &&
    palette.lightness === preset.lightness &&
    swatches.every((swatch, index) => swatch === palette.swatches[index])
  if (unchanged) return palette
  return {
    source: palette.source,
    warmth: preset.warmth,
    lightness: preset.lightness,
    swatches,
  }
}

export function artworkColor(colors) {
  if (!colors?.length) return '#1c3a44'
  let red = 0
  let green = 0
  let blue = 0
  for (const color of colors) {
    const [r, g, b] = hexToRgb(color)
    red += r
    green += g
    blue += b
  }
  const [h, s] = rgbToHsl(red / colors.length, green / colors.length, blue / colors.length)
  return hslToHex(h, clamp(Math.max(s, 0.42), 0.42, 0.72), 0.28)
}
