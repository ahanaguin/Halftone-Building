import { hasCalibration } from './calibrate.js'

const FLOW_KEY = 'halftone.introFlow'
const SEEN_KEY = 'halftone.introSeen'

export const FILL_MS = 1500
export const FADE_MS = 300

export const STEP_INTROS = {
  calibrate: {
    index: 1,
    title: 'Calibrate',
    wait: true,
    body: "Pick a color, shape, and texture for 15 short sounds. It takes about 3 minutes. We're getting to know how you see sound, so there are no wrong answers. Be imaginative.",
  },
  upload: {
    index: 2,
    title: 'Upload',
    wait: false,
    body: "Add the track you want to visualize. It's analyzed on your device and never uploaded.",
  },
  style: {
    index: 3,
    title: 'Pick a style',
    wait: false,
    body: 'Choose how your music looks. You can switch anytime.',
  },
  studio: {
    index: 4,
    title: 'Studio',
    wait: false,
    body: 'Shape your visual section by section. You get to make all the decisions.',
  },
}

function readSeen() {
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '{}')
  } catch {
    return {}
  }
}

export function beginIntroFlow(showIntros) {
  try {
    sessionStorage.setItem(FLOW_KEY, showIntros ? 'on' : 'off')
    sessionStorage.removeItem(SEEN_KEY)
  } catch {
    /* ignore */
  }
}

export function isIntroFlowOn() {
  try {
    const flag = sessionStorage.getItem(FLOW_KEY)
    if (flag === 'off') return false
    if (flag === 'on') return true
  } catch {
    /* ignore */
  }
  return !hasCalibration()
}

export function hasSeenIntro(id) {
  return Boolean(readSeen()[id])
}

export function markIntroSeen(id) {
  try {
    const seen = readSeen()
    seen[id] = true
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen))
  } catch {
    /* ignore */
  }
}

export function shouldShowStepIntro(id, location) {
  if (location?.state?.revise || location?.state?.skipIntro) return false
  if (hasSeenIntro(id)) return false
  return isIntroFlowOn()
}
