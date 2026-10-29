export const CALM_PALETTE = {
  colors: ['#2a6d78', '#314878', '#243d38'],
  warmth: 0.18,
  lightness: 0.28,
}

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
    return 'This part is quieter, so fewer shapes show and they stay smaller. The colors stay cool and muted.'
  }
  if (label === 'Build') {
    return 'The energy is rising, so more shapes come in and begin to drift. The palette warms as the section builds.'
  }
  if (label === 'Peak') {
    return 'This is the loudest part, so the shapes grow and fill more of the frame. Brighter, warmer colors follow that energy.'
  }
  return 'Shapes follow the loudness and tone of the section you are in. A louder moment brings more of them forward.'
}
