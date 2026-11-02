import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  MAX_SWATCHES,
  artworkColor,
  hexToRgb,
  hslToHex,
  paletteColors,
  rgbToHsl,
  shiftUnlocked,
  swatchHex,
} from './palette.js'
import { metricsAt, profileTrack, unit, windowFeatures } from './profileTrack.js'
import {
  boundaryLimits,
  cleanLabel,
  copyKey,
  dropKey,
  freshSeed,
  mergeAt,
  moveKey,
  sameSections,
  snapBoundary,
  splitAt,
  withBoundary,
  workingSections,
} from './sectionEdit.js'
import { INK_BLACK, PAPER, SHAPE_RANGE, backgroundAt, explainPoster, isHex, pickRecipe, sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'
import { mountShapes } from './shapesSketch.js'
import { TUNE_DEFAULTS } from './metaballs.js'
import { useTrack } from './track.jsx'

const FORMATS = ['9:16', '1:1', '16:9']
const MAX_BACKGROUNDS = 8

function backgroundChoicesOf(studio, paletteSource) {
  const extras = []
  for (const hex of studio.backgrounds || []) {
    if (!isHex(hex)) continue
    if (extras.some((item) => item.toLowerCase() === hex.toLowerCase())) continue
    extras.push(hex)
  }
  const source = paletteSource?.swatches || studio.palette?.swatches || []
  const palette = source.map((swatch) => swatchHex(swatch))
  const room = Math.max(0, MAX_BACKGROUNDS - 2 - extras.length)
  const choices = [
    { hex: PAPER, label: 'Off-white' },
    { hex: INK_BLACK, label: 'Near-black' },
  ]
  palette.slice(0, room).forEach((hex, index) => {
    if (choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())) return
    choices.push({ hex, label: `Color ${index + 1}` })
  })
    extras.forEach((hex) => {
    if (choices.length >= MAX_BACKGROUNDS) return
    if (choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())) return
    choices.push({ hex, label: 'Custom color', custom: true })
  })
  return choices
}
const STYLES = [
  { id: 'shapes', label: 'Liquid', ready: true },
  { id: 'halftone', label: 'Halftone', ready: false },
  { id: 'bars', label: 'Bars', ready: false },
  { id: 'wave', label: 'Wave', ready: false },
  { id: 'poster', label: 'Poster', ready: false },
  { id: 'image', label: 'Animate your image', ready: false },
]

function fitCanvas(format, boxWidth, boxHeight) {
  const ratio = format === '9:16' ? 9 / 16 : format === '1:1' ? 1 : 16 / 9
  const pad = 18
  const maxW = Math.max(80, boxWidth - pad * 2)
  const maxH = Math.max(80, boxHeight - pad * 2)
  let width = maxW
  let height = width / ratio
  if (height > maxH) {
    height = maxH
    width = height * ratio
  }
  return { w: Math.round(width), h: Math.round(height), frame: Math.round(boxHeight) }
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.2 1.6v8.8L10.2 6 3.2 1.6z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.2 1.6h2.6v8.8H2.2zm5 0h2.6v8.8H7.2z" fill="currentColor" />
    </svg>
  )
}

export function Studio() {
  const { track, studio, editStudio, syncStudio, commitStudio, undoStudio } = useTrack()
  const [format, setFormat] = useState('16:9')
  const [section, setSection] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [poster, setPoster] = useState('eclipse')
  const posterRef = useRef('eclipse')
  const [audioUrl, setAudioUrl] = useState('')
  const [size, setSize] = useState({ w: 640, h: 360, frame: 420 })
  const [tuneOpen, setTuneOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [arrangementAck, setArrangementAck] = useState(null)
  const [compositionAck, setCompositionAck] = useState(null)
  const [backgroundAck, setBackgroundAck] = useState(null)
  const [picker, setPicker] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [resetAsk, setResetAsk] = useState(false)
  const [hotBoundary, setHotBoundary] = useState(null)
  const pickerRef = useRef(null)
  const toastTimer = useRef(null)
  const slotRef = useRef(null)
  const sideRef = useRef(null)
  const holderRef = useRef(null)
  const audioRef = useRef(null)
  const waveRef = useRef(null)
  const playheadRef = useRef(null)
  const graphRef = useRef(null)
  const profileRef = useRef(track?.profile ?? null)
  const studioRef = useRef(studio)
  const slideOrigin = useRef(null)
  const placeDrag = useRef(null)
  const playToggle = useRef(null)
  const undoRef = useRef(null)
  const splitRef = useRef(null)
  const resizeDrag = useRef(null)
  const renameCommit = useRef(false)
  const sizeRef = useRef(size)
  const liveRef = useRef({
    loud: 0.35,
    bass: 0.4,
    high: 0.25,
    harsh: 0.2,
    tempo: track?.bpm ?? 100,
    time: 0,
    seed: 1,
    roundness: studio.roundness,
    colors: paletteColors(studio.palette),
    sections: track?.sections || [],
    seeds: studio.seeds,
    edits: studio.edits || {},
    palette: (studio.palette?.swatches || []).map((swatch) => ({ id: swatch.id, hex: swatchHex(swatch) })),
    profile: profileRef.current,
    sectionLabel: '',
    tune: { ...TUNE_DEFAULTS, ...(studio.tune || {}) },
    background: backgroundAt({ background: studio.background, edits: studio.edits || {}, sections: track?.sections || [] }, audioRef.current?.currentTime || section?.start || 0),
    shine: studio.shine !== false,
    speed: studio.speed ?? 50,
  })

  studioRef.current = studio
  sizeRef.current = size
  if (track?.profile?.timeline) profileRef.current = track.profile
  const sections = workingSections(track, studio)

  const activeKey = section ? sectionKey(section) : ''
  const activeEdit = activeKey ? studio.edits?.[activeKey] || {} : {}
  const activePalette = activeEdit.palette?.swatches?.length ? activeEdit.palette : studio.palette
  const colors = paletteColors(activePalette)
  const artwork = artworkColor(colors)
  liveRef.current = {
    ...liveRef.current,
    tempo: track?.bpm ?? liveRef.current.tempo ?? 100,
    colors,
    roundness: activeEdit.roundness ?? studio.roundness,
    seed: studio.seeds[activeKey] ?? liveRef.current.seed,
    sections,
    seeds: studio.seeds,
    edits: studio.edits || {},
    palette: (studio.palette?.swatches || []).map((swatch) => ({ id: swatch.id, hex: swatchHex(swatch) })),
    profile: profileRef.current,
    sectionLabel: section?.label || '',
    tune: { ...TUNE_DEFAULTS, ...(studio.tune || {}) },
    background: backgroundAt({ background: studio.background, edits: studio.edits || {}, sections }, audioRef.current?.currentTime || section?.start || 0),
    shine: studio.shine !== false,
    speed: activeEdit.speed ?? studio.speed ?? 50,
    print: activeEdit.print !== false,
  }

  useEffect(() => {
    if (!track?.file) {
      setAudioUrl('')
      setSection(null)
      return undefined
    }
    const url = URL.createObjectURL(track.file)
    setAudioUrl(url)
    const override = studioRef.current.sections
    let list = track.sections || []
    if (override?.length) {
      const duration = track.duration || 0
      const fits = Math.abs(override[0].start) < 0.05 && Math.abs(override[override.length - 1].end - duration) < 0.5
      const contiguous = override.every((item, index) => index === 0 || Math.abs(item.start - override[index - 1].end) < 0.05)
      if (fits && contiguous) list = override
      else {
        syncStudio((current) => {
          if (!current.sections) return current
          const next = { ...current }
          delete next.sections
          return next
        })
      }
    }
    setSection(list[0] ?? null)
    setRenaming(null)
    setResetAsk(false)
    return () => URL.revokeObjectURL(url)
  }, [track])

  useEffect(() => {
    const list = workingSections(track, studio)
    if (!list.length) return
    syncStudio((current) => {
      let changed = false
      const seeds = { ...(current.seeds || {}) }
      workingSections(track, current).forEach((item, index) => {
        const key = sectionKey(item)
        if (seeds[key] == null) {
          seeds[key] = sectionSeed(item, index)
          changed = true
        }
      })
      return changed ? { ...current, seeds } : current
    })
  }, [track, studio.sections])

  useEffect(() => {
    const list = workingSections(track, studio)
    if (!list.length) return
    setSection((current) => {
      if (!current) return list[0]
      const exact = list.find((item) => item.label === current.label && Math.abs(item.start - current.start) < 0.0005 && Math.abs(item.end - current.end) < 0.0005)
      if (exact) return exact
      const midpoint = Math.min(Math.max((current.start + current.end) / 2, list[0].start), list[list.length - 1].end - 0.001)
      return sectionAt(list, midpoint) || list[0]
    })
  }, [studio.sections, track])

  useEffect(() => {
    if (!track?.file || track.profile?.timeline) return undefined
    let cancel = false
    profileTrack(track.file)
      .then((profile) => {
        if (!cancel) profileRef.current = profile
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [track])

  useEffect(() => {
    const slot = slotRef.current
    const side = sideRef.current
    if (!slot || !side) return undefined
    const measure = () => {
      const boxWidth = slot.clientWidth
      const boxHeight = slot.clientHeight
      if (boxWidth < 40 || boxHeight < 40) return
      const next = fitCanvas(format, boxWidth, boxHeight)
      sizeRef.current = next
      setSize((current) =>
        current.w === next.w && current.h === next.h && current.frame === next.frame ? current : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    observer.observe(side)
    return () => observer.disconnect()
  }, [format, studio.style, studio.palette.swatches.length])

  useEffect(() => {
    if (!holderRef.current || !track || studio.style !== 'shapes') return undefined
    return mountShapes(holderRef.current, liveRef, sizeRef)
  }, [track, studio.style])

  useEffect(() => {
    let frame = 0
    let lastTime = 0
    const tick = () => {
      const audio = audioRef.current
      const profile = profileRef.current
      const currentTrack = track
      if (audio && currentTrack?.duration) {
        const ratio = Math.min(1, Math.max(0, audio.currentTime / currentTrack.duration))
        if (playheadRef.current) playheadRef.current.style.left = `${ratio * 100}%`
        if (waveRef.current) waveRef.current.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
        const studioNow = studioRef.current
        const list = workingSections(currentTrack, studioNow)
        const next = sectionAt(list, audio.currentTime)
        setSection((current) => (
          current && next && current.start === next.start && current.end === next.end && current.label === next.label ? current : next
        ))
        const key = next ? sectionKey(next) : ''
        const playingEdit = key ? studioNow.edits?.[key] || {} : {}
        const playingPalette = playingEdit.palette?.swatches?.length ? playingEdit.palette : studioNow.palette
        const live = liveRef.current
        live.tempo = currentTrack.bpm ?? 100
        live.time = audio.currentTime
        live.colors = paletteColors(playingPalette)
        live.roundness = playingEdit.roundness ?? studioNow.roundness
        live.seed = studioNow.seeds[key] ?? 1
        live.sections = list
        live.seeds = studioNow.seeds
        live.edits = studioNow.edits || {}
        live.palette = (studioNow.palette?.swatches || []).map((swatch) => ({ id: swatch.id, hex: swatchHex(swatch) }))
        live.profile = profile
        live.sectionLabel = next?.label || ''
        live.tune = { ...TUNE_DEFAULTS, ...(studioNow.tune || {}) }
        live.background = backgroundAt({ background: studioNow.background, edits: studioNow.edits || {}, sections: list }, audio.currentTime)
        if (holderRef.current) holderRef.current.style.background = live.background
        live.shine = studioNow.shine !== false
        live.speed = playingEdit.speed ?? studioNow.speed ?? 50
        live.print = playingEdit.print !== false
        const shown = pickRecipe(live.seed, live.sectionLabel || 'Quiet', live.roundness ?? 0.7)
        if (shown !== posterRef.current) {
          posterRef.current = shown
          setPoster(shown)
        }
        const jumped = Math.abs(audio.currentTime - lastTime) > 0.35
        lastTime = audio.currentTime
        const graph = graphRef.current
        const snapped = metricsAt(profile, audio.currentTime)
        const playingNow = graph && profile && !audio.paused && !audio.ended
        if (snapped && (!playingNow || jumped)) Object.assign(live, snapped)
        if (playingNow && !jumped) {
          const time = new Float32Array(graph.analyser.fftSize)
          graph.analyser.getFloatTimeDomainData(time)
          const features = windowFeatures(time, graph.analyser.context.sampleRate)
          const blend = (metric, value) => live[metric] * 0.62 + value * 0.38
          live.loud = blend('loud', unit(features.rms, profile.rms))
          live.bass = blend('bass', unit(features.bass, profile.bass))
          live.high = blend('high', unit(features.high, profile.high))
          live.harsh = blend('harsh', unit(features.zcr, profile.zcr))
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [track])

  useEffect(() => () => audioRef.current?.pause(), [])

  function connect(audio) {
    if (graphRef.current?.audio === audio) return graphRef.current
    const context = new AudioContext()
    const source = context.createMediaElementSource(audio)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)
    analyser.connect(context.destination)
    const graph = { audio, context, analyser }
    graphRef.current = graph
    return graph
  }

  async function togglePlay() {
    const audio = audioRef.current
    if (!audio || !track) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    const graph = connect(audio)
    await graph.context.resume()
    try {
      await audio.play()
    } catch {
      setPlaying(false)
    }
  }

  playToggle.current = togglePlay

  useEffect(() => {
    function typingOf(target) {
      const tag = target?.tagName
      return (
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable ||
        (tag === 'INPUT' && ['text', 'search', 'email', 'url', 'password', 'number', 'color'].includes((target.type || 'text').toLowerCase()))
      )
    }
    function onKey(event) {
      const typing = typingOf(event.target)
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyZ' && !event.shiftKey && !event.altKey) {
        if (typing) return
        event.preventDefault()
        undoRef.current?.()
        return
      }
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.code === 'KeyS') {
        if (typing) return
        event.preventDefault()
        splitRef.current?.()
        return
      }
      if (event.code === 'KeyT') {
        if (typing) return
        event.preventDefault()
        setTuneOpen((open) => !open)
        return
      }
      if (event.code !== 'Space' || typing) return
      event.preventDefault()
      playToggle.current?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  function seek(event) {
    const audio = audioRef.current
    const wave = waveRef.current
    if (!audio || !wave || !track?.duration) return
    const rect = wave.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * track.duration
  }

  function onScrubKey(event) {
    const audio = audioRef.current
    if (!audio || !track?.duration) return
    if (event.key === 'ArrowRight') audio.currentTime = Math.min(track.duration, audio.currentTime + 2)
    if (event.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 2)
  }

  function startSlide() {
    slideOrigin.current = studioRef.current
  }

  function finishSlide() {
    commitStudio(slideOrigin.current)
    slideOrigin.current = null
  }

  function paintPalette(recipe) {
    const apply = (current) => {
      const palette = recipe(current.palette)
      return palette === current.palette ? current : { ...current, palette }
    }
    if (slideOrigin.current) syncStudio(apply)
    else editStudio(apply)
  }

  function writePalette(recipe) {
    if (!section) {
      paintPalette(recipe)
      return
    }
    const key = sectionKey(section)
    const apply = (current) => {
      const previous = current.edits?.[key] || {}
      const base = previous.palette?.swatches?.length ? previous.palette : current.palette
      const nextPalette = recipe(base)
      if (nextPalette === base) return current
      return { ...current, edits: { ...(current.edits || {}), [key]: { ...previous, palette: nextPalette } } }
    }
    if (slideOrigin.current) syncStudio(apply)
    else editStudio(apply)
  }

  function onWarmth(event) {
    const warmth = 1 - Number(event.target.value) / 100
    writePalette((palette) => {
      if (warmth === palette.warmth) return palette
      return {
        ...palette,
        source: 'custom',
        warmth,
        swatches: shiftUnlocked(palette.swatches, palette.warmth, warmth, palette.lightness, palette.lightness),
      }
    })
  }

  function onLightness(event) {
    const lightness = Number(event.target.value) / 100
    writePalette((palette) => {
      if (lightness === palette.lightness) return palette
      return {
        ...palette,
        source: 'custom',
        lightness,
        swatches: shiftUnlocked(palette.swatches, palette.warmth, palette.warmth, palette.lightness, lightness),
      }
    })
  }

  function onRoundness(event) {
    const roundness = 1 - Number(event.target.value) / 100
    if (!section) {
      const apply = (current) => (current.roundness === roundness ? current : { ...current, roundness })
      if (slideOrigin.current) syncStudio(apply)
      else editStudio(apply)
      return
    }
    writeSection({ roundness })
  }

  function onPick(id, hex) {
    const [red, green, blue] = hexToRgb(hex)
    const [h, s, l] = rgbToHsl(red, green, blue)
    writePalette((palette) => ({
      ...palette,
      source: 'custom',
      swatches: palette.swatches.map((swatch) => (swatch.id === id ? { ...swatch, h, s, l } : swatch)),
    }))
  }

  function suggestHex(palette) {
    const last = palette.swatches[palette.swatches.length - 1]
    return hslToHex((last.h + 46) % 360, Math.min(0.9, Math.max(0.35, last.s)), last.l)
  }

  function openPicker(event, draft) {
    const side = sideRef.current?.getBoundingClientRect()
    const anchor = event.currentTarget.getBoundingClientRect()
    const width = 232
    const left = Math.max(12, (side?.left || anchor.left) - width - 16)
    const top = Math.min(window.innerHeight - 300, Math.max(12, anchor.top - 12))
    setPicker({ ...draft, left, top })
  }

  function onStyle(event) {
    const style = event.target.value
    if (!STYLES.find((item) => item.id === style)?.ready) return
    editStudio((current) => (current.style === style ? current : { ...current, style }))
  }

  function showToast(message) {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2200)
  }

  function redoSection() {
    if (!section) return
    const key = sectionKey(section)
    const next = (Math.random() * 0x100000000) >>> 0
    editStudio((current) => ({
      ...current,
      seeds: { ...current.seeds, [key]: next },
    }))
    setArrangementAck({ key, seed: next })
    showToast('New arrangement made.')
  }

  function writeSection(patch) {
    if (!section) return
    const key = sectionKey(section)
    const apply = (current) => {
      const previous = current.edits?.[key] || {}
      if (Object.keys(patch).every((name) => previous[name] === patch[name])) return current
      return { ...current, edits: { ...(current.edits || {}), [key]: { ...previous, ...patch } } }
    }
    if (slideOrigin.current) syncStudio(apply)
    else editStudio(apply)
  }

  function onSectionSize(event) {
    writeSection({ size: Number(event.target.value) })
  }

  function onSectionCount(event) {
    writeSection({ count: Number(event.target.value) })
  }

  function onComposition(event) {
    setArrangementAck(null)
    setCompositionAck(null)
    writeSection({ composition: event.target.value })
  }

  function modeOf(edit) {
    return ['free', 'mirror', 'quad', 'radial'].includes(edit?.composition) ? edit.composition : 'auto'
  }

  function applyComposition() {
    if (!sections.length) return
    const mode = modeOf(studio.edits?.[activeKey])
    editStudio((current) => {
      const edits = { ...(current.edits || {}) }
      let changed = false
      for (const item of workingSections(track, current)) {
        const key = sectionKey(item)
        const previous = edits[key] || {}
        if ((previous.composition || 'auto') === mode) continue
        edits[key] = { ...previous, composition: mode }
        changed = true
      }
      return changed ? { ...current, edits } : current
    })
    const name = { auto: 'Auto', free: 'Free', mirror: 'Mirror', quad: 'Quad', radial: 'Radial' }[mode]
    setCompositionAck(mode)
    showToast(`${name} applied to all sections.`)
  }

  function applyBackground() {
    if (!sections.length) return
    const hex = isHex(studio.edits?.[activeKey]?.background) ? studio.edits[activeKey].background : studio.background || PAPER
    editStudio((current) => {
      const edits = { ...(current.edits || {}) }
      let changed = false
      for (const item of workingSections(track, current)) {
        const key = sectionKey(item)
        const previous = edits[key] || {}
        if ((previous.background || '').toLowerCase() === hex.toLowerCase()) continue
        edits[key] = { ...previous, background: hex }
        changed = true
      }
      return changed ? { ...current, edits } : current
    })
    setBackgroundAck(hex.toLowerCase())
    showToast('Background applied to all sections.')
  }

  function onShine() {
    editStudio((current) => ({ ...current, shine: current.shine === false }))
  }

  function onSpeed(event) {
    const value = Number(event.target.value)
    if (!section) {
      const apply = (current) => (current.speed === value ? current : { ...current, speed: value })
      if (slideOrigin.current) syncStudio(apply)
      else editStudio(apply)
      return
    }
    writeSection({ speed: value })
  }

  function commitBackground(hex, previous, custom) {
    if (!isHex(hex)) return
    setBackgroundAck(null)
    editStudio((current) => {
      let backgrounds = [...(current.backgrounds || [])]
      const choices = backgroundChoicesOf(current, activePalette)
      const known = choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())
      if (custom && previous && previous.toLowerCase() !== hex.toLowerCase()) backgrounds = backgrounds.map((item) => (item.toLowerCase() === previous.toLowerCase() ? hex : item))
      else if (!known && choices.length < MAX_BACKGROUNDS) backgrounds.push(hex)
      const edits = { ...(current.edits || {}) }
      if (activeKey) edits[activeKey] = { ...(edits[activeKey] || {}), background: hex }
      return { ...current, backgrounds, edits }
    })
  }

  function commitPicker(event) {
    event.preventDefault()
    if (!picker || !isHex(picker.hex)) return
    if (picker.target === 'palette' && picker.mode === 'add') {
      const [red, green, blue] = hexToRgb(picker.hex)
      const [h, s, l] = rgbToHsl(red, green, blue)
      writePalette((palette) => {
        if (palette.swatches.length >= MAX_SWATCHES) return palette
        return {
          ...palette,
          source: 'custom',
          swatches: [...palette.swatches, { id: `swatch-add-${Date.now().toString(36)}`, h, s, l, locked: false }],
        }
      })
    } else if (picker.target === 'palette') onPick(picker.id, picker.hex)
    else commitBackground(picker.hex, picker.previous, picker.custom)
    setPicker(null)
  }

  function onPerColor(event) {
    const per = Number(event.target.value)
    const groups = Math.max(1, enabledColors.length)
    const total = Math.min(shapeRange.max, Math.max(shapeRange.min, per * groups))
    writeSection({ count: total })
  }

  function onTune(key, event) {
    const value = Number(event.target.value)
    const apply = (current) => {
      const tune = { ...TUNE_DEFAULTS, ...current.tune }
      if (tune[key] === value) return current
      return { ...current, tune: { ...tune, [key]: value } }
    }
    if (slideOrigin.current) syncStudio(apply)
    else editStudio(apply)
  }

  function onSectionColor(id) {
    const ids = studio.palette.swatches.map((swatch) => swatch.id)
    const saved = studio.edits?.[activeKey]?.colors
    const current = saved?.length >= 2 ? ids.filter((item) => saved.includes(item)) : ids
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : ids.filter((item) => current.includes(item) || item === id)
    if (next.length < 2) return
    writeSection({ colors: next.length === ids.length ? null : next })
  }

  function resetSection() {
    if (!section) {
      showToast('No edits to clear yet.')
      return
    }
    const key = sectionKey(section)
    const edit = studio.edits?.[key]
    const edited = Boolean(
      edit &&
        (edit.size != null ||
          edit.count != null ||
          edit.colors?.length >= 2 ||
          edit.x ||
          edit.y ||
          isHex(edit.background) ||
          edit.palette?.swatches?.length ||
          edit.roundness != null ||
          edit.speed != null ||
          edit.print != null ||
          (edit.composition && edit.composition !== 'auto')),
    )
    if (!edited) {
      showToast('No edits to clear yet.')
      return
    }
    editStudio((current) => {
      if (!current.edits?.[key]) return current
      const edits = { ...current.edits }
      delete edits[key]
      return { ...current, edits }
    })
    setArrangementAck(null)
    showToast('Edits cleared.')
  }

  function onPlaceDown(event) {
    if (!section || event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const edit = studioRef.current.edits?.[sectionKey(section)] || {}
    slideOrigin.current = studioRef.current
    placeDrag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      originX: edit.x || 0,
      originY: edit.y || 0,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPlaceMove(event) {
    const drag = placeDrag.current
    if (!drag || event.pointerId !== drag.id) return
    writeSection({
      x: Math.min(0.42, Math.max(-0.42, drag.originX + (event.clientX - drag.x) / drag.width)),
      y: Math.min(0.42, Math.max(-0.42, drag.originY + (event.clientY - drag.y) / drag.height)),
    })
  }

  function onPlaceUp(event) {
    if (!placeDrag.current || event.pointerId !== placeDrag.current.id) return
    placeDrag.current = null
    finishSlide()
  }

  useEffect(() => {
    const index = section
      ? sections.findIndex((item) => item.start === section.start && item.label === section.label)
      : 0
    const seed = studio.seeds[activeKey] ?? (section ? sectionSeed(section, Math.max(0, index)) : 1)
    const shown = pickRecipe(seed, section?.label || 'Quiet', studio.roundness)
    posterRef.current = shown
    setPoster(shown)
  }, [activeKey, section, studio.seeds, studio.roundness, activeEdit.roundness, sections])

  useEffect(() => {
    if (!picker) return undefined
    function finish() {
      if (picker.target === 'background' && activeKey && Object.prototype.hasOwnProperty.call(picker, 'revert')) {
        const revert = picker.revert
        editStudio((current) => {
          const edits = { ...(current.edits || {}) }
          const previous = { ...(edits[activeKey] || {}) }
          if (revert) previous.background = revert
          else delete previous.background
          if (Object.keys(previous).length) edits[activeKey] = previous
          else delete edits[activeKey]
          return { ...current, edits }
        })
      }
      setPicker(null)
    }
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      finish()
    }
    function onPointer(event) {
      if (pickerRef.current?.contains(event.target)) return
      finish()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [picker, activeKey])

  const warmth = Math.round((1 - (activePalette.warmth ?? 0.5)) * 100)
  const lightness = Math.round((activePalette.lightness ?? 0.5) * 100)
  const spiky = Math.round((1 - (activeEdit.roundness ?? studio.roundness ?? 0.7)) * 100)
  const shapesOn = studio.style === 'shapes'
  const sectionEdit = studio.edits?.[activeKey] || {}
  const composition = ['free', 'mirror', 'quad', 'radial'].includes(sectionEdit.composition) ? sectionEdit.composition : 'auto'
  const shapeRange = SHAPE_RANGE[poster] || SHAPE_RANGE.eclipse
  const sizeValue = sectionEdit.size ?? 50
  const countValue = Math.min(shapeRange.max, Math.max(shapeRange.min, sectionEdit.count ?? shapeRange.count))
  const enabledColors =
    sectionEdit.colors?.length >= 2
      ? activePalette.swatches.filter((swatch) => sectionEdit.colors.includes(swatch.id)).map((swatch) => swatch.id)
      : activePalette.swatches.map((swatch) => swatch.id)
  const colorGroups = Math.max(1, enabledColors.length)
  const perMax = Math.min(8, Math.max(4, Math.floor(32 / colorGroups)))
  const perColor = Math.min(perMax, Math.max(4, Math.round(countValue / colorGroups)))
  const tune = { ...TUNE_DEFAULTS, ...(studio.tune || {}) }
  const background = backgroundAt({ background: studio.background, edits: studio.edits || {}, sections }, audioRef.current?.currentTime || section?.start || 0)
  const sectionBackground = isHex(sectionEdit.background) ? sectionEdit.background : studio.background || PAPER
  const shineOn = studio.shine !== false
  const motion = activeEdit.speed ?? studio.speed ?? 50
  const compositionUniform = Boolean(
    sections.length && sections.every((item) => modeOf(studio.edits?.[sectionKey(item)]) === composition),
  )
  const backgroundUniform = Boolean(
    sections.length &&
      sections.every((item) => {
        const saved = studio.edits?.[sectionKey(item)]?.background
        const hex = isHex(saved) ? saved : studio.background || PAPER
        return hex.toLowerCase() === sectionBackground.toLowerCase()
      }),
  )
  if (compositionAck != null && !compositionUniform) setCompositionAck(null)
  if (backgroundAck != null && !backgroundUniform) setBackgroundAck(null)
  const compositionApplied = compositionAck === composition && compositionUniform
  const backgroundApplied = backgroundAck === sectionBackground.toLowerCase() && backgroundUniform
  const arrangementOn = arrangementAck?.key === activeKey && arrangementAck.seed === studio.seeds[activeKey]
  const backgroundChoices = backgroundChoicesOf(studio, activePalette)
  const sectionIndex = sections.findIndex((item) => section && item.label === section.label && Math.abs(item.start - section.start) < 0.0005)
  const canMerge = sectionIndex >= 0 && sectionIndex < sections.length - 1

  function cloneList(list) {
    return list.map((item) => ({ start: item.start, end: item.end, label: item.label }))
  }

  function splitHere() {
    const list = workingSections(track, studioRef.current)
    const time = audioRef.current?.currentTime
    if (!list.length || !Number.isFinite(time)) {
      showToast('Need at least 4 seconds on each side.')
      return
    }
    const result = splitAt(list, time)
    if (!result) {
      showToast('Need at least 4 seconds on each side.')
      return
    }
    const from = sectionKey(list[result.index])
    const cloned = cloneList(result.sections)
    const created = cloned[result.index + 1]
    const rightKey = sectionKey(created)
    editStudio((current) => ({
      ...current,
      sections: cloned,
      edits: copyKey(current.edits, from, rightKey),
      seeds: { ...(current.seeds || {}), [rightKey]: freshSeed(created, result.index + 1) },
    }))
    setSection(created)
    setRenaming(null)
    setResetAsk(false)
  }

  function mergeSection(index) {
    const list = workingSections(track, studioRef.current)
    const result = mergeAt(list, index)
    if (!result) {
      showToast('No section after this one.')
      return
    }
    const cloned = cloneList(result.sections)
    const rightKey = sectionKey(result.right)
    editStudio((current) => ({
      ...current,
      sections: cloned,
      edits: dropKey(current.edits, rightKey),
      seeds: dropKey(current.seeds, rightKey),
    }))
    setSection(cloned[index])
    setRenaming(null)
    setResetAsk(false)
  }

  function saveRename() {
    const current = renaming
    renameCommit.current = true
    setRenaming(null)
    if (!current) return
    const label = cleanLabel(current.value)
    const list = workingSections(track, studioRef.current)
    const index = list.findIndex((item) => sectionKey(item) === current.key)
    if (index < 0 || !label || label === list[index].label) return
    const after = { ...list[index], label }
    const next = list.map((item, itemIndex) => (itemIndex === index ? after : { ...item }))
    const from = sectionKey(list[index])
    const to = sectionKey(after)
    editStudio((studioNow) => ({
      ...studioNow,
      sections: next,
      edits: moveKey(studioNow.edits, from, to),
      seeds: moveKey(studioNow.seeds, from, to),
    }))
    setSection(after)
  }

  function askReset() {
    const list = workingSections(track, studioRef.current)
    if (sameSections(list, track?.sections || [])) {
      showToast('Already the detected sections.')
      setResetAsk(false)
      return
    }
    setResetAsk(true)
  }

  function confirmReset() {
    const original = cloneList(track?.sections || [])
    setResetAsk(false)
    setRenaming(null)
    editStudio((current) => ({ ...current, sections: original }))
    setSection(original[0] || null)
    showToast('Sections reset.')
  }

  function finishBoundary(event) {
    const drag = resizeDrag.current
    if (!drag || drag.done || event.pointerId !== drag.id) return
    drag.done = true
    resizeDrag.current = null
    setHotBoundary(null)
    commitStudio(drag.origin)
  }

  function onBoundaryDown(event, index) {
    event.preventDefault()
    event.stopPropagation()
    const list = cloneList(workingSections(track, studioRef.current))
    const limits = boundaryLimits(list, index)
    if (!limits) {
      showToast("Sections can't be shorter than 4 seconds.")
      return
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // The drag still follows pointermove and pointerup when capture is unavailable.
    }
    resizeDrag.current = {
      id: event.pointerId,
      index,
      origin: studioRef.current,
      sections: list,
      limits,
      done: false,
    }
    setHotBoundary(index)
  }

  function onBoundaryMove(event) {
    const drag = resizeDrag.current
    if (!drag || drag.done || event.pointerId !== drag.id || !track?.duration) return
    const rect = waveRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const snapped = snapBoundary(ratio * track.duration, track.bpm, drag.limits.min, drag.limits.max)
    if (snapped == null) return
    const before = drag.sections[drag.index]
    if (Math.abs(snapped - before.start) < 0.0005) {
      syncStudio(() => drag.origin)
      return
    }
    const next = withBoundary(drag.sections, drag.index, snapped)
    syncStudio(() => ({
      ...drag.origin,
      sections: next,
      edits: moveKey(drag.origin.edits, sectionKey(before), sectionKey(next[drag.index])),
      seeds: moveKey(drag.origin.seeds, sectionKey(before), sectionKey(next[drag.index])),
    }))
  }

  splitRef.current = splitHere
  undoRef.current = undoStudio

  return (
    <main className="studio">
      <section className="studio-main">
        <div className="formats" role="group" aria-label="Format">
          {FORMATS.map((item) => (
            <button
              key={item}
              type="button"
              className={item === format ? 'format active' : 'format'}
              aria-pressed={item === format}
              onClick={() => setFormat(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="canvas-slot" ref={slotRef}>
          <div className="canvas-frame">
            <div
              ref={holderRef}
              className={track && shapesOn ? 'canvas-stage can-place' : 'canvas-stage'}
              style={{ width: size.w, height: size.h, background: shapesOn ? background : artwork }}
              onPointerDown={track && shapesOn ? onPlaceDown : undefined}
              onPointerMove={onPlaceMove}
              onPointerUp={onPlaceUp}
              onPointerCancel={onPlaceUp}
              role={track && shapesOn ? 'img' : undefined}
              aria-label={track && shapesOn ? 'Liquid reacting to the track' : undefined}
            />
            {track && shapesOn ? null : (
              <div className="canvas-empty">
                {track ? (
                  <p>Coming soon</p>
                ) : (
                  <>
                    <Link className="canvas-upload" to="/upload">
                      Go to Upload
                    </Link>
                    <p>Upload a track to see liquid.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="why">
          <strong>Why it looks like this</strong>
          <p>{explainPoster(poster)}</p>
        </div>

        {track ? (
          <div className="scrubber">
            <button
              type="button"
              className="scrub-play"
              aria-label={playing ? 'Pause' : 'Play'}
              aria-pressed={playing}
              onClick={togglePlay}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="scrub-main">
              <div
                ref={waveRef}
                className="scrub-wave"
                role="slider"
                tabIndex={0}
                aria-label="Playhead"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={0}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  seek(event)
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event)
                }}
                onKeyDown={onScrubKey}
              >
                <div className={playing ? 'wave studio-wave playing' : 'wave studio-wave'}>
                  {track.bars.map((level, index) => (
                    <span key={index} style={{ height: `${Math.max(8, level * 100)}%`, '--i': index }} />
                  ))}
                </div>
                <div className="playhead" ref={playheadRef} />
              </div>
              <div className="section-row">
                {sections.map((item, index) => {
                  const key = sectionKey(item)
                  const selected = section?.label === item.label && Math.abs((section?.start ?? -1) - item.start) < 0.0005
                  const naming = renaming?.key === key
                  return (
                    <div key={key} className="section-chip-wrap" style={{ flex: Math.max(0.08, item.end - item.start) }}>
                      {index > 0 ? (
                        <button
                          type="button"
                          className={hotBoundary === index ? 'section-boundary is-hot' : 'section-boundary'}
                          aria-label={`Resize between ${sections[index - 1].label} and ${item.label}`}
                          onPointerDown={(event) => onBoundaryDown(event, index)}
                          onPointerMove={onBoundaryMove}
                          onPointerUp={finishBoundary}
                          onLostPointerCapture={finishBoundary}
                        />
                      ) : null}
                      {naming ? (
                        <input
                          className="section-chip section-name"
                          value={renaming.value}
                          maxLength={16}
                          aria-label="Section name"
                          autoFocus
                          onFocus={(event) => event.target.select()}
                          onChange={(event) => setRenaming((current) => (current ? { ...current, value: event.target.value.slice(0, 16) } : current))}
                          onKeyDown={(event) => {
                            event.stopPropagation()
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              saveRename()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              renameCommit.current = true
                              setRenaming(null)
                            }
                          }}
                          onBlur={() => {
                            if (renameCommit.current) {
                              renameCommit.current = false
                              return
                            }
                            setRenaming(null)
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                        />
                      ) : (
                        <button
                          type="button"
                          className={selected ? 'section-chip selected' : 'section-chip'}
                          aria-pressed={selected}
                          onClick={() => {
                            setSection(item)
                            if (audioRef.current) audioRef.current.currentTime = item.start
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault()
                            setRenaming({ key, value: item.label.slice(0, 16) })
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            setSection(item)
                            mergeSection(index)
                          }}
                        >
                          {item.label}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="section-actions">
                <button type="button" className="button-redo" onClick={splitHere}>Split here</button>
                <button type="button" className="button-redo" disabled={!canMerge} onClick={() => mergeSection(sectionIndex)}>Merge with next</button>
                <button type="button" className="button-redo" onClick={askReset}>Reset sections</button>
              </div>
              {resetAsk ? (
                <div className="section-confirm" role="group" aria-label="Reset sections">
                  <p>Reset to the detected sections?</p>
                  <button type="button" className="button" onClick={confirmReset}>Reset</button>
                  <button type="button" className="button-redo" onClick={() => setResetAsk(false)}>Cancel</button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <audio
          ref={audioRef}
          src={audioUrl || undefined}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      </section>

      <aside className="studio-side" ref={sideRef}>
        <p className="side-label">Style</p>
        <label className="style-field">
          <select className="style-select" aria-label="Style" value={studio.style} onChange={onStyle}>
            {STYLES.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.ready}>
                {item.ready ? item.label : `${item.label} — Coming soon`}
              </option>
            ))}
          </select>
        </label>

        {shapesOn ? (
          <>
            <p className="side-label">Composition</p>
            <label className="style-field">
              <select
                className="style-select"
                aria-label="Composition"
                value={composition}
                disabled={!section}
                onChange={onComposition}
              >
                <option value="auto">Auto</option>
                <option value="free">Free</option>
                <option value="mirror">Mirror</option>
                <option value="quad">Quad</option>
                <option value="radial">Radial</option>
              </select>
            </label>
            <button
              type="button"
              className={compositionApplied ? 'button-redo apply-all is-on' : 'button-redo apply-all'}
              disabled={!section || !sections.length}
              onClick={applyComposition}
            >
              {compositionApplied ? 'Applied to all sections ✓' : 'Apply to all sections'}
            </button>
            <p className="side-label">Background</p>
            <div className="swatches background-swatches" role="listbox" aria-label="Background">
              {backgroundChoices.map((choice) => {
                const selected = choice.hex.toLowerCase() === sectionBackground.toLowerCase()
                return (
                  <button
                    key={`${choice.label}-${choice.hex}`}
                    type="button"
                    className={selected ? 'swatch is-on' : 'swatch'}
                    style={{ background: choice.hex }}
                    aria-label={choice.label}
                    aria-selected={selected}
                    disabled={!section}
                    onClick={(event) => {
                      const changed = choice.hex.toLowerCase() !== sectionBackground.toLowerCase()
                      if (changed) {
                        setBackgroundAck(null)
                        writeSection({ background: choice.hex })
                      }
                      openPicker(event, {
                        mode: 'edit',
                        target: 'background',
                        hex: choice.hex,
                        previous: choice.hex,
                        custom: Boolean(choice.custom),
                        ...(changed ? { revert: isHex(sectionEdit.background) ? sectionEdit.background : null } : {}),
                      })
                    }}
                  />
                )
              })}
              <button
                type="button"
                className="add-swatch"
                aria-label="Add a background color"
                disabled={!section || backgroundChoices.length >= MAX_BACKGROUNDS}
                onClick={(event) => openPicker(event, { mode: 'add', target: 'background', hex: '#d25a3a' })}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className={backgroundApplied ? 'button-redo apply-all is-on' : 'button-redo apply-all'}
              disabled={!section || !sections.length}
              onClick={applyBackground}
            >
              {backgroundApplied ? 'Applied to all sections ✓' : 'Apply to all sections'}
            </button>
          </>
        ) : null}

        <p className="side-label">Palette</p>
        <div className="swatches">
          {activePalette.swatches.map((swatch, index) => {
            const hex = swatchHex(swatch)
            return (
              <div className="swatch-item" key={swatch.id}>
                <button
                  type="button"
                  className="swatch"
                  style={{ background: hex }}
                  aria-label={`Color ${index + 1}`}
                  onClick={(event) => openPicker(event, { mode: 'edit', target: 'palette', id: swatch.id, hex })}
                />
              </div>
            )
          })}
          <button
            type="button"
            className="add-swatch"
            aria-label="Add a color"
            disabled={activePalette.swatches.length >= MAX_SWATCHES}
            onClick={(event) => openPicker(event, { mode: 'add', target: 'palette', hex: suggestHex(activePalette) })}
          >
            +
          </button>
        </div>

        <div className="slider-labels">
          <span>Warm</span>
          <span>Cool</span>
        </div>
        <input
          className="range"
          type="range"
          min="0"
          max="100"
          value={warmth}
          onPointerDown={startSlide}
          onPointerUp={finishSlide}
          onPointerCancel={finishSlide}
          onChange={onWarmth}
          aria-label="Warm to cool"
        />

        <div className="slider-labels">
          <span>Dark</span>
          <span>Light</span>
        </div>
        <input
          className="range"
          type="range"
          min="0"
          max="100"
          value={lightness}
          onPointerDown={startSlide}
          onPointerUp={finishSlide}
          onPointerCancel={finishSlide}
          onChange={onLightness}
          aria-label="Dark to light"
        />

        <div className="slider-labels">
          <span>Round</span>
          <span>Spiky</span>
        </div>
        <input
          className="range"
          type="range"
          min="0"
          max="100"
          value={spiky}
          onPointerDown={startSlide}
          onPointerUp={finishSlide}
          onPointerCancel={finishSlide}
          onChange={onRoundness}
          aria-label="Round to spiky"
        />

        <div className="slider-labels">
          <span>Slow</span>
          <span>Fast</span>
        </div>
        <input
          className="range"
          type="range"
          min="0"
          max="100"
          value={motion}
          onPointerDown={startSlide}
          onPointerUp={finishSlide}
          onPointerCancel={finishSlide}
          onChange={onSpeed}
          aria-label="Animation speed"
        />

        <div className="background-row">
          <p className="side-label">Drop shine</p>
          <button
            type="button"
            className="shine-switch"
            role="switch"
            aria-checked={shineOn}
            aria-label="Drop shine"
            onClick={onShine}
          >
            <span />
          </button>
        </div>

        {section && shapesOn ? (
          <div className="section-tools">
            <div className="slider-labels">
              <span>Shape size</span>
            </div>
            <input
              className="range"
              type="range"
              min="0"
              max="100"
              value={sizeValue}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={onSectionSize}
              aria-label="Shape size"
            />
            <div className="slider-labels">
              <span>Number of shapes</span>
              <span>{countValue}</span>
            </div>
            <input
              className="range"
              type="range"
              min={shapeRange.min}
              max={shapeRange.max}
              step="1"
              value={countValue}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={onSectionCount}
              aria-label="Number of shapes"
            />
            <p className="side-label">Colors for this section</p>
            <div className="section-colors">
              {studio.palette.swatches.map((swatch, index) => {
                const checked = enabledColors.includes(swatch.id)
                return (
                  <label className="section-color" key={swatch.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={checked && enabledColors.length <= 2}
                      aria-label={`Use color ${index + 1} in this section`}
                      onChange={() => onSectionColor(swatch.id)}
                    />
                    <span style={{ background: swatchHex(swatch) }} />
                  </label>
                )
              })}
            </div>
            <p className="section-note">Drag the picture to move the main shape.</p>
          </div>
        ) : null}

        <div className="redo">
          <p>{section ? `${section.label} selected` : 'Section'}</p>
          <button type="button" className="button-redo" onClick={resetSection}>
            Clear edits
          </button>
          <button type="button" className={arrangementOn ? 'button-redo is-on' : 'button-redo'} disabled={!section} onClick={redoSection}>
            {arrangementOn ? 'Arrangement updated' : 'New arrangement'}
          </button>
        </div>
      </aside>
      {toast ? <p className="side-toast" role="status">{toast}</p> : null}
      {tuneOpen ? (
        <aside className="debug-panel tune-panel" aria-label="Tuning">
          <p className="tune-title">Tuning</p>
          <label>
            <span>
              Blobs per color <strong>{perColor}</strong>
            </span>
            <input
              className="range"
              type="range"
              min="4"
              max={perMax}
              step="1"
              value={perColor}
              disabled={!section || !shapesOn}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={onPerColor}
              aria-label="Blobs per color"
            />
          </label>
          <label>
            <span>
              Field falloff <strong>{tune.falloff.toFixed(2)}</strong>
            </span>
            <input
              className="range"
              type="range"
              min="1"
              max="4"
              step="0.05"
              value={tune.falloff}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={(event) => onTune('falloff', event)}
              aria-label="Field falloff"
            />
          </label>
          <label>
            <span>
              Threshold <strong>{tune.threshold.toFixed(2)}</strong>
            </span>
            <input
              className="range"
              type="range"
              min="0.4"
              max="1.6"
              step="0.01"
              value={tune.threshold}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={(event) => onTune('threshold', event)}
              aria-label="Threshold"
            />
          </label>
          <label>
            <span>
              Opacity <strong>{Math.round(tune.opacity * 100)}%</strong>
            </span>
            <input
              className="range"
              type="range"
              min="0.4"
              max="1"
              step="0.01"
              value={tune.opacity}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={(event) => onTune('opacity', event)}
              aria-label="Opacity"
            />
          </label>
          <label>
            <span>
              Attraction <strong>{tune.attract.toFixed(2)}</strong>
            </span>
            <input
              className="range"
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={tune.attract}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={(event) => onTune('attract', event)}
              aria-label="Attraction strength"
            />
          </label>
          <label>
            <span>
              Drift speed <strong>{tune.drift.toFixed(2)}</strong>
            </span>
            <input
              className="range"
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={tune.drift}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={(event) => onTune('drift', event)}
              aria-label="Drift speed"
            />
          </label>
          <label>
            <span>
              Fold blend <strong>{tune.fold.toFixed(2)}</strong>
            </span>
            <input
              className="range"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={tune.fold}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={(event) => onTune('fold', event)}
              aria-label="Fold blend"
            />
          </label>
          <label>
            <span>
              Rotation speed <strong>{tune.spin.toFixed(2)}</strong>
            </span>
            <input
              className="range"
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={tune.spin}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={(event) => onTune('spin', event)}
              aria-label="Rotation speed"
            />
          </label>
        </aside>
      ) : null}
      {picker ? (
        <form
          className="color-picker"
          ref={pickerRef}
          style={{ left: picker.left, top: picker.top }}
          onSubmit={commitPicker}
        >
          <input
            type="color"
            value={isHex(picker.hex) ? picker.hex : '#000000'}
            aria-label="Pick a color"
            onChange={(event) => setPicker((current) => (current ? { ...current, hex: event.target.value } : current))}
          />
          <input
            className="color-hex"
            value={picker.hex}
            spellCheck={false}
            aria-label="Hex color"
            onChange={(event) => {
              const raw = event.target.value.trim()
              const hex = raw.startsWith('#') ? raw : `#${raw}`
              setPicker((current) => (current ? { ...current, hex } : current))
            }}
          />
          <button type="submit" className="button" disabled={!isHex(picker.hex)}>
            {picker.mode === 'add' ? 'Add' : 'Save'}
          </button>
        </form>
      ) : null}
    </main>
  )
}
