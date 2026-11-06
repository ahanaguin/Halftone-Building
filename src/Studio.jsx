import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  sectionAfterEdit,
  snapBoundary,
  splitAt,
  withBoundary,
  workingSections,
} from './sectionEdit.js'
import { PANEL_COUNT, collageCount, collageImageIds, prepareCollage } from './collageField.js'
import { prepareMosaic } from './mosaicField.js'
import { FocusEditor } from './FocusEditor.jsx'
import { DOT_DENSITY, DOT_SIZE_DEFAULT } from './halftoneField.js'
import { BLOOM_COUNT, COLOR_MODES, DEFAULT_DOT_COLOR, MAX_DOT_COLORS, bloomDotColorsOf, colorModeOf, explainBloom } from './bloomField.js'
import { DEFAULT_ORB_COLORS, ORB_COUNT, explainOrb, orbDotColorsOf } from './orbField.js'
import { CHROME_COUNT, CHROME_GREY, CHROME_METALS, CHROME_SILVER, MAX_METALS, explainChrome } from './chromeField.js'
import {
  GRAIN_SIZE,
  MAX_INKS,
  MISREG_DEFAULT,
  RISO_INKS,
  RISO_PAPER,
  explainRiso,
  prepareRiso,
  risoInksOf,
} from './risoField.js'
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
  const room = Math.max(0, MAX_BACKGROUNDS - 3 - extras.length)
  const choices = [
    { hex: PAPER, label: 'Off-white' },
    { hex: INK_BLACK, label: 'Near-black' },
    { hex: CHROME_GREY, label: 'Soft grey' },
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

function inkChoicesOf(studio, paletteSource) {
  const extras = []
  for (const hex of studio.inks || []) {
    if (!isHex(hex)) continue
    if (extras.some((item) => item.toLowerCase() === hex.toLowerCase())) continue
    extras.push(hex)
  }
  const source = paletteSource?.swatches || studio.palette?.swatches || []
  const palette = source.map((swatch) => swatchHex(swatch))
  const room = Math.max(0, MAX_INKS - RISO_INKS.length - extras.length)
  const choices = RISO_INKS.map((item) => ({ ...item }))
  palette.slice(0, room).forEach((hex, index) => {
    if (choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())) return
    choices.push({ hex, label: `Color ${index + 1}` })
  })
  extras.forEach((hex) => {
    if (choices.length >= MAX_INKS) return
    if (choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())) return
    choices.push({ hex, label: 'Custom color', custom: true })
  })
  return choices
}

function metalChoicesOf(studio, paletteSource) {
  const extras = []
  for (const hex of studio.metals || []) {
    if (!isHex(hex)) continue
    if (extras.some((item) => item.toLowerCase() === hex.toLowerCase())) continue
    extras.push(hex)
  }
  const source = paletteSource?.swatches || studio.palette?.swatches || []
  const palette = source.map((swatch) => swatchHex(swatch))
  const room = Math.max(0, MAX_METALS - CHROME_METALS.length - extras.length)
  const choices = CHROME_METALS.map((item) => ({ ...item }))
  palette.slice(0, room).forEach((hex, index) => {
    if (choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())) return
    choices.push({ hex, label: `Color ${index + 1}` })
  })
  extras.forEach((hex) => {
    if (choices.length >= MAX_METALS) return
    if (choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())) return
    choices.push({ hex, label: 'Custom color', custom: true })
  })
  return choices
}

const STYLES = [
  { id: 'shapes', label: 'Liquid', ready: true },
  { id: 'bloom', label: 'Bloom', ready: true },
  { id: 'orb', label: 'Orb', ready: true },
  { id: 'chrome', label: 'Chrome', ready: false },
  { id: 'halftone', label: 'Halftone', ready: false },
  { id: 'bars', label: 'Bars', ready: false },
  { id: 'wave', label: 'Wave', ready: false },
  { id: 'poster', label: 'Poster', ready: false },
  { id: 'image', label: 'Image animation', ready: true },
]

function sectionInkColors(style, edit) {
  return style === 'orb' ? orbDotColorsOf(edit) : bloomDotColorsOf(edit)
}

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

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.75 6.25V2.75H6.25M9.75 2.75h3.5v3.5M13.25 9.75v3.5h-3.5M6.25 13.25H2.75v-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 3.5l9 9M12.5 3.5l-9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Studio() {
  const { track, studio, editStudio, syncStudio, commitStudio, undoStudio } = useTrack()
  const [format, setFormat] = useState('16:9')
  const [section, setSection] = useState(null)
  const [picked, setPicked] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [parked, setParked] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [poster, setPoster] = useState('eclipse')
  const posterRef = useRef('eclipse')
  const [audioUrl, setAudioUrl] = useState('')
  const [size, setSize] = useState({ w: 640, h: 360, frame: 420 })
  const [tuneOpen, setTuneOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [arrangementAck, setArrangementAck] = useState(null)
  const [compositionAck, setCompositionAck] = useState(null)
  const [filledAck, setFilledAck] = useState(null)
  const [dotColorAck, setDotColorAck] = useState(null)
  const [backgroundAck, setBackgroundAck] = useState(null)
  const [metalAck, setMetalAck] = useState(null)
  const [inksAck, setInksAck] = useState(null)
  const [dotsAck, setDotsAck] = useState(null)
  const [groutAck, setGroutAck] = useState(null)
  const [imageAck, setImageAck] = useState(null)
  const [focusOpen, setFocusOpen] = useState(false)
  const [picker, setPicker] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [resetAsk, setResetAsk] = useState(false)
  const [hotBoundary, setHotBoundary] = useState(null)
  const pickerRef = useRef(null)
  const toastTimer = useRef(null)
  const slotRef = useRef(null)
  const mainRef = useRef(null)
  const sideRef = useRef(null)
  const closeCanvasRef = useRef(null)
  const expandedRef = useRef(false)
  const holderRef = useRef(null)
  const audioRef = useRef(null)
  const waveRef = useRef(null)
  const rowRef = useRef(null)
  const imageInputRef = useRef(null)
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
  const lastInkSlot = useRef(1)
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
    style: studio.style,
    images: (studio.images || []).map((image) => image.url),
    imageIds: (studio.images || []).map((image) => image.id),
    imageSwitch: studio.imageSwitch || 'section',
    focus: studio.focus || {},
    playing: false,
  })

  studioRef.current = studio
  sizeRef.current = size
  expandedRef.current = expanded
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
    style: studio.style,
    images: (studio.images || []).map((image) => image.url),
    imageIds: (studio.images || []).map((image) => image.id),
    imageSwitch: studio.imageSwitch || 'section',
    focus: studio.focus || {},
    playing: !!liveRef.current.playing,
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
    setPicked(null)
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
    setSection((current) => sectionAfterEdit(current, list) || list[0])
    setPicked((current) => (current ? sectionAfterEdit(current, list) : current))
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
    const main = mainRef.current
    if (!slot || !side || !main) return undefined
    const measure = () => {
      if (expandedRef.current) {
        const next = fitCanvas(format, window.innerWidth - 64, window.innerHeight - 64)
        sizeRef.current = next
        setSize((current) =>
          current.w === next.w && current.h === next.h && current.frame === next.frame ? current : next,
        )
        return
      }
      let chrome = 0
      for (const child of main.children) {
        if (child === slot || child.tagName === 'AUDIO') continue
        const style = getComputedStyle(child)
        const margin = parseFloat(style.marginTop) + parseFloat(style.marginBottom)
        if (child.classList.contains('scrubber')) {
          const play = child.querySelector('.scrub-play')
          const playHeight = play ? play.offsetHeight + parseFloat(getComputedStyle(play).marginTop) : 0
          const wave = child.querySelector('.scrub-wave')?.offsetHeight || 0
          const row = child.querySelector('.section-row')?.offsetHeight || 0
          chrome += margin + Math.max(playHeight, wave + 8 + row)
          continue
        }
        chrome += child.offsetHeight + margin
      }
      const slotStyle = getComputedStyle(slot)
      chrome += parseFloat(slotStyle.marginTop) + parseFloat(slotStyle.marginBottom)
      const studioBox = main.parentElement
      const studioStyle = studioBox ? getComputedStyle(studioBox) : null
      const pad = studioStyle ? parseFloat(studioStyle.paddingTop) + parseFloat(studioStyle.paddingBottom) : 0
      const topbar = document.querySelector('.topbar')?.offsetHeight || 0
      const available = window.innerHeight - topbar - pad
      const target = Math.max(180, Math.round(available - chrome))
      if (slot.style.minHeight !== `${target}px`) slot.style.minHeight = `${target}px`
      const row = rowRef.current
      if (row) {
        const wraps = row.querySelectorAll(':scope > .section-chip-wrap')
        row.querySelectorAll(':scope > .section-boundary').forEach((handle) => {
          const wrap = wraps[Number(handle.dataset.index)]
          if (wrap) handle.style.left = `${wrap.offsetLeft}px`
        })
      }
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
    observer.observe(main)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [format, studio.style, studio.palette.swatches.length, expanded, track])

  useEffect(() => () => resizeDrag.current?.cleanup?.(), [])

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const wraps = row.querySelectorAll(':scope > .section-chip-wrap')
    row.querySelectorAll(':scope > .section-boundary').forEach((handle) => {
      const wrap = wraps[Number(handle.dataset.index)]
      if (wrap) handle.style.left = `${wrap.offsetLeft}px`
    })
  })

  useEffect(() => {
    if (!holderRef.current || !track || (studio.style !== 'shapes' && studio.style !== 'image' && studio.style !== 'bloom' && studio.style !== 'orb' && studio.style !== 'chrome')) return undefined
    return mountShapes(holderRef.current, liveRef, sizeRef)
  }, [track, studio.style, expanded])

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
        live.style = studioNow.style
        live.images = (studioNow.images || []).map((image) => image.url)
        live.imageIds = (studioNow.images || []).map((image) => image.id)
        live.imageSwitch = studioNow.imageSwitch || 'section'
        live.focus = studioNow.focus || {}
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
        live.playing = playingNow
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
      if (event.key === 'Escape' && !typing && expandedRef.current) {
        event.preventDefault()
        closeCanvasRef.current?.()
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

  function shiftBloomDots({ warmth, lightness }) {
    if (!section) return
    const key = sectionKey(section)
    const apply = (current) => {
      const previous = current.edits?.[key] || {}
      const fromW = previous.dotWarmth ?? 0.5
      const fromL = previous.dotLightness ?? 0.5
      const toW = warmth ?? fromW
      const toL = lightness ?? fromL
      if (toW === fromW && toL === fromL) return current
      const swatches = sectionInkColors(studio.style, previous).map((hex, index) => {
        const [red, green, blue] = hexToRgb(hex)
        const [h, s, l] = rgbToHsl(red, green, blue)
        return { id: `bloom-${index}`, h, s, l }
      })
      const warmed = shiftUnlocked(swatches, fromW, toW, fromL, fromL)
      const lightDelta = toL - fromL
      const next = lightDelta
        ? warmed.map((swatch) => ({
            ...swatch,
            l: Math.min(0.94, Math.max(0.08, swatch.l + lightDelta * 1.6)),
          }))
        : warmed
      return {
        ...current,
        edits: {
          ...(current.edits || {}),
          [key]: {
            ...previous,
            dotColors: next.map((swatch) => hslToHex(swatch.h, swatch.s, swatch.l)),
            dotWarmth: toW,
            dotLightness: toL,
          },
        },
      }
    }
    if (slideOrigin.current) syncStudio(apply)
    else editStudio(apply)
  }

  function onWarmth(event) {
    const warmth = 1 - Number(event.target.value) / 100
    if (studio.style === 'bloom' || studio.style === 'orb') {
      shiftBloomDots({ warmth })
      return
    }
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
    if (studio.style === 'bloom' || studio.style === 'orb') {
      shiftBloomDots({ lightness })
      return
    }
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

  function saveFocus(imageId, points) {
    const next = points.slice(0, 6).map((point) => {
      const saved = { x: point.x, y: point.y }
      const span = Number(point.span)
      if (Number.isFinite(span) && span > 0) saved.span = Math.min(0.95, Math.max(0.12, span))
      return saved
    })
    editStudio((current) => {
      const previous = current.focus?.[imageId]
      if (JSON.stringify(previous || []) === JSON.stringify(next)) return current
      return { ...current, focus: { ...(current.focus || {}), [imageId]: next } }
    })
  }

  function onSectionSize(event) {
    writeSection({ size: Number(event.target.value) })
  }

  function onSectionCount(event) {
    writeSection({ count: Number(event.target.value) })
  }

  function onTint(event) {
    writeSection({ tint: Number(event.target.value) })
  }

  function onSectionContrast(event) {
    writeSection({ contrast: Number(event.target.value) })
  }

  function onShimmer(event) {
    writeSection({ shimmer: Number(event.target.value) })
  }

  function onComposition(event) {
    setArrangementAck(null)
    setCompositionAck(null)
    writeSection({ composition: event.target.value })
  }

  function modeOf(edit) {
    if (studio.style === 'image') {
      if (edit?.composition === 'collage') return 'collage'
      if (edit?.composition === 'mosaic') return 'mosaic'
      if (edit?.composition === 'riso') return 'riso'
      return 'halftone'
    }
    if (studio.style === 'bloom') return edit?.composition === 'ring' ? 'ring' : 'full'
    if (studio.style === 'orb') return edit?.composition === 'ring' ? 'ring' : 'sphere'
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
    const name = { auto: 'Auto', free: 'Free', mirror: 'Mirror', quad: 'Quad', radial: 'Radial', halftone: 'Halftone', collage: 'Collage', mosaic: 'Mosaic', riso: 'Riso', full: 'Full', ring: 'Ring', sphere: 'Sphere' }[mode]
    setCompositionAck(mode)
    showToast(`${name} applied to all sections.`)
  }

  function applyFilled() {
    if (!sections.length) return
    const filled = studio.edits?.[activeKey]?.filled === true
    editStudio((current) => {
      const edits = { ...(current.edits || {}) }
      let changed = false
      for (const item of workingSections(track, current)) {
        const key = sectionKey(item)
        const previous = edits[key] || {}
        if (Boolean(previous.filled) === filled) continue
        edits[key] = { ...previous, filled }
        changed = true
      }
      return changed ? { ...current, edits } : current
    })
    setFilledAck(filled)
    showToast(filled ? 'Filled dots applied to all sections.' : 'Outline dots applied to all sections.')
  }

  function writeDotColors(list) {
    writeSection({ dotColors: list.slice(0, MAX_DOT_COLORS) })
  }

  function applyDotColors() {
    if (!sections.length) return
    const colors = sectionInkColors(studio.style, studio.edits?.[activeKey])
    const colorMode = colorModeOf(studio.edits?.[activeKey])
    const dotWarmth = studio.edits?.[activeKey]?.dotWarmth ?? 0.5
    const dotLightness = studio.edits?.[activeKey]?.dotLightness ?? 0.5
    editStudio((current) => {
      const edits = { ...(current.edits || {}) }
      let changed = false
      for (const item of workingSections(track, current)) {
        const key = sectionKey(item)
        const previous = edits[key] || {}
        const same =
          colorModeOf(previous) === colorMode &&
          (previous.dotWarmth ?? 0.5) === dotWarmth &&
          (previous.dotLightness ?? 0.5) === dotLightness &&
          sectionInkColors(studio.style, previous).length === colors.length &&
          sectionInkColors(studio.style, previous).every((hex, index) => hex.toLowerCase() === colors[index].toLowerCase())
        if (same) continue
        edits[key] = { ...previous, dotColors: colors, colorMode, dotWarmth, dotLightness }
        changed = true
      }
      return changed ? { ...current, edits } : current
    })
    setDotColorAck(`${colorMode}:${colors.join('|').toLowerCase()}`)
    showToast('Dot colors applied to all sections.')
  }

  function applyBackground() {
    if (!sections.length) return
    const hex = isHex(studio.edits?.[activeKey]?.background)
      ? studio.edits[activeKey].background
      : studio.style === 'orb'
        ? isHex(studio.background) && studio.background.toLowerCase() !== PAPER.toLowerCase()
          ? studio.background
          : INK_BLACK
        : studio.style === 'chrome'
          ? isHex(studio.background) && studio.background.toLowerCase() !== PAPER.toLowerCase()
            ? studio.background
            : CHROME_GREY
          : studio.style === 'image' && studio.edits?.[activeKey]?.composition === 'riso'
            ? isHex(studio.background) && studio.background.toLowerCase() !== PAPER.toLowerCase()
              ? studio.background
              : RISO_PAPER
          : studio.background || PAPER
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

  function applyMetal() {
    if (!sections.length) return
    const hex = isHex(studio.edits?.[activeKey]?.metal) ? studio.edits[activeKey].metal : CHROME_SILVER
    editStudio((current) => {
      const edits = { ...(current.edits || {}) }
      let changed = false
      for (const item of workingSections(track, current)) {
        const key = sectionKey(item)
        const previous = edits[key] || {}
        if ((previous.metal || '').toLowerCase() === hex.toLowerCase()) continue
        edits[key] = { ...previous, metal: hex }
        changed = true
      }
      return changed ? { ...current, edits } : current
    })
    setMetalAck(hex.toLowerCase())
    showToast('Metal color applied to all sections.')
  }

  function commitMetal(hex, previous, custom) {
    if (!isHex(hex)) return
    setMetalAck(null)
    editStudio((current) => {
      let metals = [...(current.metals || [])]
      const choices = metalChoicesOf(current, activePalette)
      const known = choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())
      if (custom && previous && previous.toLowerCase() !== hex.toLowerCase()) metals = metals.map((item) => (item.toLowerCase() === previous.toLowerCase() ? hex : item))
      else if (!known && choices.length < MAX_METALS) metals.push(hex)
      const edits = { ...(current.edits || {}) }
      if (activeKey) edits[activeKey] = { ...(edits[activeKey] || {}), metal: hex }
      return { ...current, metals, edits }
    })
  }

  function applyInks() {
    if (!sections.length) return
    const inks = risoInksOf(studio.edits?.[activeKey])
    editStudio((current) => {
      const edits = { ...(current.edits || {}) }
      let changed = false
      for (const item of workingSections(track, current)) {
        const key = sectionKey(item)
        const previous = edits[key] || {}
        const saved = risoInksOf(previous)
        if (saved.length === inks.length && saved.every((hex, index) => hex.toLowerCase() === inks[index].toLowerCase())) continue
        edits[key] = { ...previous, inks }
        changed = true
      }
      return changed ? { ...current, edits } : current
    })
    setInksAck(inks.map((hex) => hex.toLowerCase()).join('|'))
    showToast('Ink colors applied to all sections.')
  }

  function commitInks(hex, previous, custom, slot) {
    if (!isHex(hex)) return
    const index = slot === 0 || slot === 1 ? slot : lastInkSlot.current
    lastInkSlot.current = index
    const current = risoInksOf(studio.edits?.[activeKey])
    const next = current.slice()
    next[index] = hex
    setInksAck(null)
    editStudio((currentStudio) => {
      let extras = [...(currentStudio.inks || [])]
      const choices = inkChoicesOf(currentStudio, activePalette)
      const known = choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())
      if (custom && previous && previous.toLowerCase() !== hex.toLowerCase()) extras = extras.map((item) => (item.toLowerCase() === previous.toLowerCase() ? hex : item))
      else if (!known && choices.length < MAX_INKS) extras.push(hex)
      const edits = { ...(currentStudio.edits || {}) }
      if (activeKey) edits[activeKey] = { ...(edits[activeKey] || {}), inks: next }
      return { ...currentStudio, inks: extras, edits }
    })
  }

  function applyDots() {
    if (!sections.length) return
    const hex = isHex(studio.edits?.[activeKey]?.dots) ? studio.edits[activeKey].dots : INK_BLACK
    editStudio((current) => {
      const edits = { ...(current.edits || {}) }
      let changed = false
      for (const item of workingSections(track, current)) {
        const key = sectionKey(item)
        const previous = edits[key] || {}
        if ((previous.dots || '').toLowerCase() === hex.toLowerCase()) continue
        edits[key] = { ...previous, dots: hex }
        changed = true
      }
      return changed ? { ...current, edits } : current
    })
    setDotsAck(hex.toLowerCase())
    showToast('Dots applied to all sections.')
  }

  function onImages(event) {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    if (!files.length) return
    editStudio((current) => {
      const images = current.images || []
      const added = files.slice(0, Math.max(0, 5 - images.length)).map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        url: URL.createObjectURL(file),
      }))
      if (!added.length) return current
      return { ...current, images: [...images, ...added] }
    })
  }

  function removeImage(id) {
    editStudio((current) => {
      const images = (current.images || []).filter((image) => image.id !== id)
      const edits = { ...(current.edits || {}) }
      for (const key of Object.keys(edits)) {
        if (edits[key]?.image !== id) continue
        const next = { ...edits[key] }
        delete next.image
        if (Object.keys(next).length) edits[key] = next
        else delete edits[key]
      }
      return { ...current, images, edits }
    })
  }

  function imageIdFor(item, source = studio) {
    const list = source.images || []
    if (!item || !list.length) return ''
    const saved = source.edits?.[sectionKey(item)]?.image
    if (saved && list.some((image) => image.id === saved)) return saved
    if ((source.imageSwitch || 'section') === 'off') return list[0].id
    const order = workingSections(track, source)
    const index = order.findIndex((entry) => entry.start === item.start && entry.label === item.label)
    return list[Math.max(0, index) % list.length].id
  }

  function collageSpec(source = studio) {
    return {
      images: (source.images || []).map((image) => image.url),
      imageIds: (source.images || []).map((image) => image.id),
      edits: source.edits,
      sections: workingSections(track, source),
      imageSwitch: source.imageSwitch || 'section',
    }
  }

  function sectionImageIds(item = section, source = studio) {
    if (!item) return []
    return collageImageIds(collageSpec(source), item)
  }

  function assignImage(id) {
    if (!section) return
    setImageAck(null)
    writeSection({ image: id })
  }

  function toggleCollageImage(id) {
    if (!section) return
    const order = (studio.images || []).map((image) => image.id)
    const current = sectionImageIds()
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : order.filter((item) => current.includes(item) || item === id)
    if (!next.length) return
    setImageAck(null)
    writeSection({ images: next })
  }

  function applyImage() {
    if (!section) return
    const id = imageIdFor(section)
    if (!id) return
    editStudio((current) => {
      const edits = { ...(current.edits || {}) }
      let changed = false
      for (const item of workingSections(track, current)) {
        const key = sectionKey(item)
        const previous = edits[key] || {}
        if (previous.image === id) continue
        edits[key] = { ...previous, image: id }
        changed = true
      }
      return changed ? { ...current, edits } : current
    })
    setImageAck(id)
    showToast('Image applied to all sections.')
  }

  function applyCollageImages() {
    if (!section) return
    const picked = sectionImageIds()
    if (!picked.length) return
    editStudio((current) => {
      const edits = { ...(current.edits || {}) }
      let changed = false
      for (const item of workingSections(track, current)) {
        const key = sectionKey(item)
        const previous = edits[key] || {}
        const same = Array.isArray(previous.images) && previous.images.length === picked.length && previous.images.every((itemId, index) => itemId === picked[index])
        if (same) continue
        edits[key] = { ...previous, images: picked }
        changed = true
      }
      return changed ? { ...current, edits } : current
    })
    setImageAck(picked.join('|'))
    showToast('Images applied to all sections.')
  }

  function onImageSwitch(event) {
    const imageSwitch = event.target.value
    editStudio((current) => (current.imageSwitch === imageSwitch ? current : { ...current, imageSwitch }))
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

  function commitDots(hex, previous, custom) {
    if (!isHex(hex)) return
    setDotsAck(null)
    editStudio((current) => {
      let backgrounds = [...(current.backgrounds || [])]
      const choices = backgroundChoicesOf(current, activePalette)
      const known = choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())
      if (custom && previous && previous.toLowerCase() !== hex.toLowerCase()) backgrounds = backgrounds.map((item) => (item.toLowerCase() === previous.toLowerCase() ? hex : item))
      else if (!known && choices.length < MAX_BACKGROUNDS) backgrounds.push(hex)
      const edits = { ...(current.edits || {}) }
      if (activeKey) edits[activeKey] = { ...(edits[activeKey] || {}), dots: hex }
      return { ...current, backgrounds, edits }
    })
  }

  function commitGrout(hex, previous, custom) {
    if (!isHex(hex)) return
    setGroutAck(null)
    editStudio((current) => {
      let backgrounds = [...(current.backgrounds || [])]
      const choices = backgroundChoicesOf(current, activePalette)
      const known = choices.some((item) => item.hex.toLowerCase() === hex.toLowerCase())
      if (custom && previous && previous.toLowerCase() !== hex.toLowerCase()) backgrounds = backgrounds.map((item) => (item.toLowerCase() === previous.toLowerCase() ? hex : item))
      else if (!known && choices.length < MAX_BACKGROUNDS) backgrounds.push(hex)
      const edits = { ...(current.edits || {}) }
      if (activeKey) edits[activeKey] = { ...(edits[activeKey] || {}), grout: hex }
      return { ...current, backgrounds, edits }
    })
  }

  function applyGrout() {
    if (!sections.length) return
    const hex = isHex(studio.edits?.[activeKey]?.grout) ? studio.edits[activeKey].grout : INK_BLACK
    editStudio((current) => {
      const edits = { ...(current.edits || {}) }
      let changed = false
      for (const item of workingSections(track, current)) {
        const key = sectionKey(item)
        const previous = edits[key] || {}
        if ((previous.grout || '').toLowerCase() === hex.toLowerCase()) continue
        edits[key] = { ...previous, grout: hex }
        changed = true
      }
      return changed ? { ...current, edits } : current
    })
    setGroutAck(hex.toLowerCase())
    showToast('Grout applied to all sections.')
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
    }     else if (picker.target === 'palette') onPick(picker.id, picker.hex)
    else if (picker.target === 'dotColor') {
      const current = sectionInkColors(studio.style, studio.edits?.[activeKey])
      if (picker.mode === 'add') {
        if (current.length < MAX_DOT_COLORS) writeDotColors([...current, picker.hex])
      } else {
        const next = current.slice()
        next[picker.index] = picker.hex
        writeDotColors(next)
      }
      setDotColorAck(null)
    }
    else if (picker.target === 'dots') commitDots(picker.hex, picker.previous, picker.custom)
    else if (picker.target === 'grout') commitGrout(picker.hex, picker.previous, picker.custom)
    else if (picker.target === 'metal') commitMetal(picker.hex, picker.previous, picker.custom)
    else if (picker.target === 'ink') commitInks(picker.hex, picker.previous, picker.custom, picker.slot)
    else commitBackground(picker.hex, picker.previous, picker.custom)
    setPicker(null)
  }

  function onPerColor(event) {
    const per = Number(event.target.value)
    const groups = Math.max(1, enabledColors.length)
    const total = Math.min(shapeRange.max, Math.max(shapeRange.min, per * groups))
    writeSection({ count: total })
  }

  function onTuneFlag(key, value) {
    editStudio((current) => {
      const tune = { ...TUNE_DEFAULTS, ...current.tune }
      if (tune[key] === value) return current
      return { ...current, tune: { ...tune, [key]: value } }
    })
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
          isHex(edit.metal) ||
          edit.tint != null ||
          isHex(edit.dots) ||
          edit.inks?.length >= 2 ||
          edit.image ||
          edit.images?.length ||
          edit.contrast != null ||
          edit.palette?.swatches?.length ||
          edit.roundness != null ||
          edit.speed != null ||
          edit.print != null ||
          edit.mono ||
          edit.grain ||
          edit.flow === false ||
          edit.shimmer != null ||
          isHex(edit.grout) ||
          edit.ground === 'solid' ||
          edit.filled != null ||
          edit.dotColors?.length ||
          edit.colorMode ||
          edit.dotWarmth != null ||
          edit.dotLightness != null ||
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
      const field = picker.target === 'background' ? 'background' : picker.target === 'dots' ? 'dots' : picker.target === 'grout' ? 'grout' : picker.target === 'metal' ? 'metal' : ''
      if (picker.target === 'ink' && activeKey && Object.prototype.hasOwnProperty.call(picker, 'revert')) {
        const revert = picker.revert
        editStudio((current) => {
          const edits = { ...(current.edits || {}) }
          const previous = { ...(edits[activeKey] || {}) }
          if (Array.isArray(revert) && revert.length >= 2) previous.inks = revert
          else delete previous.inks
          if (Object.keys(previous).length) edits[activeKey] = previous
          else delete edits[activeKey]
          return { ...current, edits }
        })
      } else if (picker.target === 'dotColor' && activeKey && Object.prototype.hasOwnProperty.call(picker, 'revert')) {
        const revert = picker.revert
        editStudio((current) => {
          const edits = { ...(current.edits || {}) }
          const previous = { ...(edits[activeKey] || {}) }
          if (Array.isArray(revert) && revert.length) previous.dotColors = revert
          else delete previous.dotColors
          if (Object.keys(previous).length) edits[activeKey] = previous
          else delete edits[activeKey]
          return { ...current, edits }
        })
      } else if (field && activeKey && Object.prototype.hasOwnProperty.call(picker, 'revert')) {
        const revert = picker.revert
        editStudio((current) => {
          const edits = { ...(current.edits || {}) }
          const previous = { ...(edits[activeKey] || {}) }
          if (revert) previous[field] = revert
          else delete previous[field]
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

  const spiky = Math.round((1 - (activeEdit.roundness ?? studio.roundness ?? 0.7)) * 100)
  const shapesOn = studio.style === 'shapes'
  const imageOn = studio.style === 'image'
  const bloomOn = studio.style === 'bloom'
  const orbOn = studio.style === 'orb'
  const chromeOn = studio.style === 'chrome'
  const dotsOn = bloomOn || orbOn
  const visualOn = shapesOn || imageOn || bloomOn || orbOn || chromeOn
  const sectionEdit = studio.edits?.[activeKey] || {}
  const warmth = Math.round((1 - (dotsOn ? (sectionEdit.dotWarmth ?? 0.5) : (activePalette.warmth ?? 0.5))) * 100)
  const lightness = Math.round((dotsOn ? (sectionEdit.dotLightness ?? 0.5) : (activePalette.lightness ?? 0.5)) * 100)
  const composition = imageOn
    ? sectionEdit.composition === 'collage'
      ? 'collage'
      : sectionEdit.composition === 'mosaic'
        ? 'mosaic'
        : sectionEdit.composition === 'riso'
          ? 'riso'
          : 'halftone'
    : bloomOn
      ? sectionEdit.composition === 'ring'
        ? 'ring'
        : 'full'
      : orbOn
        ? sectionEdit.composition === 'ring'
          ? 'ring'
          : 'sphere'
        : ['free', 'mirror', 'quad', 'radial'].includes(sectionEdit.composition)
          ? sectionEdit.composition
          : 'auto'
  const collageOn = imageOn && composition === 'collage'
  const mosaicOn = imageOn && composition === 'mosaic'
  const risoOn = imageOn && composition === 'riso'
  const compositionOptions = imageOn
    ? [
        { id: 'halftone', label: 'Halftone' },
        { id: 'collage', label: 'Collage' },
        { id: 'mosaic', label: 'Mosaic' },
        { id: 'riso', label: 'Riso' },
      ]
    : bloomOn
      ? [
          { id: 'full', label: 'Full' },
          { id: 'ring', label: 'Ring' },
        ]
      : orbOn
        ? [
            { id: 'sphere', label: 'Sphere' },
            { id: 'ring', label: 'Ring' },
          ]
        : [
          { id: 'auto', label: 'Auto' },
          { id: 'free', label: 'Free' },
          { id: 'mirror', label: 'Mirror' },
          { id: 'quad', label: 'Quad' },
          { id: 'radial', label: 'Radial' },
        ]
  const shapeRange = SHAPE_RANGE[poster] || SHAPE_RANGE.eclipse
  const sizeValue = sectionEdit.size ?? (mosaicOn ? 32 : risoOn ? MISREG_DEFAULT : imageOn ? DOT_SIZE_DEFAULT : 50)
  const tintValue = Math.min(100, Math.max(0, Math.round(sectionEdit.tint ?? 40)))
  const shimmerValue = sectionEdit.shimmer ?? 80
  const countValue = collageOn
    ? collageCount({ edits: studio.edits, seeds: studio.seeds }, section)
    : bloomOn
      ? Math.min(BLOOM_COUNT.max, Math.max(BLOOM_COUNT.min, Math.round(sectionEdit.count ?? BLOOM_COUNT.count)))
      : orbOn
        ? Math.min(ORB_COUNT.max, Math.max(ORB_COUNT.min, Math.round(sectionEdit.count ?? ORB_COUNT.count)))
        : chromeOn
        ? Math.min(CHROME_COUNT.max, Math.max(CHROME_COUNT.min, Math.round(sectionEdit.count ?? CHROME_COUNT.count)))
        : risoOn
        ? Math.min(GRAIN_SIZE.max, Math.max(GRAIN_SIZE.min, Math.round(sectionEdit.count ?? GRAIN_SIZE.count)))
        : imageOn
        ? Math.min(DOT_DENSITY.max, Math.max(DOT_DENSITY.min, sectionEdit.count ?? DOT_DENSITY.count))
        : Math.min(shapeRange.max, Math.max(shapeRange.min, sectionEdit.count ?? shapeRange.count))
  const images = studio.images || []
  const enabledColors =
    sectionEdit.colors?.length >= 2
      ? activePalette.swatches.filter((swatch) => sectionEdit.colors.includes(swatch.id)).map((swatch) => swatch.id)
      : activePalette.swatches.map((swatch) => swatch.id)
  const colorGroups = Math.max(1, enabledColors.length)
  const perMax = Math.min(8, Math.max(4, Math.floor(32 / colorGroups)))
  const perColor = Math.min(perMax, Math.max(4, Math.round(countValue / colorGroups)))
  const tune = { ...TUNE_DEFAULTS, ...(studio.tune || {}) }
  const background = backgroundAt({ background: studio.background, edits: studio.edits || {}, sections }, audioRef.current?.currentTime || section?.start || 0)
  const sectionBackground = isHex(sectionEdit.background)
    ? sectionEdit.background
    : orbOn
      ? isHex(studio.background) && studio.background.toLowerCase() !== PAPER.toLowerCase()
        ? studio.background
        : INK_BLACK
      : chromeOn
        ? isHex(studio.background) && studio.background.toLowerCase() !== PAPER.toLowerCase()
          ? studio.background
          : CHROME_GREY
        : risoOn
          ? isHex(studio.background) && studio.background.toLowerCase() !== PAPER.toLowerCase()
            ? studio.background
            : RISO_PAPER
        : studio.background || PAPER
  const sectionDots = isHex(sectionEdit.dots) ? sectionEdit.dots : INK_BLACK
  const contrastValue = sectionEdit.contrast ?? 50
  const selectedImage = section ? imageIdFor(section) : ''
  const shineOn = studio.shine !== false
  const motion = activeEdit.speed ?? studio.speed ?? 50
  const compositionUniform = Boolean(
    sections.length && sections.every((item) => modeOf(studio.edits?.[sectionKey(item)]) === composition),
  )
  const backgroundUniform = Boolean(
    sections.length &&
      sections.every((item) => {
        const saved = studio.edits?.[sectionKey(item)]?.background
        const hex = isHex(saved) ? saved : sectionBackground
        return hex.toLowerCase() === sectionBackground.toLowerCase()
      }),
  )
  const sectionMetal = isHex(sectionEdit.metal) ? sectionEdit.metal : CHROME_SILVER
  const metalUniform = Boolean(
    sections.length &&
      sections.every((item) => {
        const saved = studio.edits?.[sectionKey(item)]?.metal
        const hex = isHex(saved) ? saved : CHROME_SILVER
        return hex.toLowerCase() === sectionMetal.toLowerCase()
      }),
  )
  const sectionGrout = isHex(sectionEdit.grout) ? sectionEdit.grout : INK_BLACK
  const groutUniform = Boolean(
    sections.length &&
      sections.every((item) => {
        const saved = studio.edits?.[sectionKey(item)]?.grout
        const hex = isHex(saved) ? saved : INK_BLACK
        return hex.toLowerCase() === sectionGrout.toLowerCase()
      }),
  )
  const dotsUniform = Boolean(
    sections.length &&
      sections.every((item) => {
        const saved = studio.edits?.[sectionKey(item)]?.dots
        const hex = isHex(saved) ? saved : INK_BLACK
        return hex.toLowerCase() === sectionDots.toLowerCase()
      }),
  )
  const collagePicks = collageOn && section ? sectionImageIds() : []
  const sameImageList = (left, right) => left.length === right.length && left.every((id, index) => id === right[index])
  const imageUniform = collageOn
    ? Boolean(sections.length && collagePicks.length && sections.every((item) => sameImageList(sectionImageIds(item), collagePicks)))
    : Boolean(sections.length && images.length && sections.every((item) => imageIdFor(item) === selectedImage))
  const filledOn = sectionEdit.filled === true
  const filledUniform = Boolean(
    sections.length && sections.every((item) => Boolean(studio.edits?.[sectionKey(item)]?.filled) === filledOn),
  )
  const bloomColors = orbOn ? orbDotColorsOf(sectionEdit) : bloomDotColorsOf(sectionEdit)
  const bloomColorMode = colorModeOf(sectionEdit)
  const bloomColorKey = `${bloomColorMode}:${bloomColors.join('|').toLowerCase()}`
  const bloomColorUniform = Boolean(
    sections.length &&
      sections.every((item) => {
        const saved = studio.edits?.[sectionKey(item)] || {}
        const savedColors = orbOn ? orbDotColorsOf(saved) : bloomDotColorsOf(saved)
        return (!orbOn ? colorModeOf(saved) === bloomColorMode : true) && savedColors.join('|').toLowerCase() === bloomColors.join('|').toLowerCase()
      }),
  )
  if (compositionAck != null && !compositionUniform) setCompositionAck(null)
  if (filledAck != null && !filledUniform) setFilledAck(null)
  if (dotColorAck != null && !bloomColorUniform) setDotColorAck(null)
  if (backgroundAck != null && !backgroundUniform) setBackgroundAck(null)
  if (metalAck != null && !metalUniform) setMetalAck(null)
  const sectionInks = risoInksOf(sectionEdit)
  const inksKey = sectionInks.map((hex) => hex.toLowerCase()).join('|')
  const inksUniform = Boolean(
    sections.length &&
      sections.every((item) => {
        const saved = risoInksOf(studio.edits?.[sectionKey(item)])
        return saved.length === sectionInks.length && saved.every((hex, index) => hex.toLowerCase() === sectionInks[index].toLowerCase())
      }),
  )
  if (inksAck != null && !inksUniform) setInksAck(null)
  if (dotsAck != null && !dotsUniform) setDotsAck(null)
  if (groutAck != null && !groutUniform) setGroutAck(null)
  if (imageAck != null && !imageUniform) setImageAck(null)
  const compositionApplied = compositionAck === composition && compositionUniform
  const filledApplied = filledAck === filledOn && filledUniform
  const bloomColorApplied = dotColorAck === bloomColorKey && bloomColorUniform
  const backgroundApplied = backgroundAck === sectionBackground.toLowerCase() && backgroundUniform
  const metalApplied = metalAck === sectionMetal.toLowerCase() && metalUniform
  const metalChoices = metalChoicesOf(studio, activePalette)
  const inksApplied = inksAck === inksKey && inksUniform
  const inkChoices = inkChoicesOf(studio, activePalette)
  const groutApplied = groutAck === sectionGrout.toLowerCase() && groutUniform
  const dotsApplied = dotsAck === sectionDots.toLowerCase() && dotsUniform
  const imageApplied = (collageOn ? imageAck === collagePicks.join('|') : imageAck === selectedImage) && imageUniform
  const arrangementOn = arrangementAck?.key === activeKey && arrangementAck.seed === studio.seeds[activeKey]
  const backgroundChoices = backgroundChoicesOf(studio, activePalette)
  if (risoOn && !backgroundChoices.some((choice) => choice.hex.toLowerCase() === RISO_PAPER.toLowerCase())) {
    backgroundChoices.splice(1, 0, { hex: RISO_PAPER, label: 'Warm paper' })
  }
  const sectionIndex = sections.findIndex((item) => sameSection(section, item))
  const pickedIndex = sections.findIndex((item) => sameSection(picked, item))
  const canMerge = sectionIndex >= 0 && pickedIndex >= 0 && sectionIndex !== pickedIndex

  function sameSection(left, right) {
    return Boolean(
      left &&
        right &&
        left.label === right.label &&
        Math.abs(left.start - right.start) < 0.0005 &&
        Math.abs(left.end - right.end) < 0.0005,
    )
  }

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
    setPicked(null)
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
    setPicked(null)
    setRenaming(null)
    setResetAsk(false)
  }

  function mergePicked() {
    const list = workingSections(track, studioRef.current)
    const first = list.findIndex((item) => sameSection(section, item))
    const second = list.findIndex((item) => sameSection(picked, item))
    if (first < 0 || second < 0 || first === second) {
      showToast('Hold Shift and select two sections.')
      return
    }
    const left = Math.min(first, second)
    if (Math.abs(first - second) !== 1) {
      showToast('Select two sections next to each other.')
      return
    }
    mergeSection(left)
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
    setPicked(null)
  }

  function openCanvas() {
    const next = fitCanvas(format, window.innerWidth - 64, window.innerHeight - 64)
    setParked({ w: size.w, h: size.h })
    sizeRef.current = next
    setSize(next)
    setExpanded(true)
  }

  function closeCanvas() {
    setExpanded(false)
    const slot = slotRef.current
    if (!slot) return
    const next = fitCanvas(format, slot.clientWidth, slot.clientHeight)
    sizeRef.current = next
    setSize(next)
  }

  closeCanvasRef.current = closeCanvas

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
    setPicked(null)
    editStudio((current) => ({ ...current, sections: original }))
    setSection(original[0] || null)
    showToast('Sections reset.')
  }

  function finishBoundary(event) {
    const drag = resizeDrag.current
    if (!drag || drag.done || event.pointerId !== drag.id) return
    drag.done = true
    drag.cleanup?.()
    resizeDrag.current = null
    setHotBoundary(null)
    if (drag.moved) {
      const swallow = (click) => {
        click.preventDefault()
        click.stopPropagation()
        window.removeEventListener('click', swallow, true)
      }
      window.addEventListener('click', swallow, true)
    }
    commitStudio(drag.origin)
  }

  function onBoundaryMove(event) {
    const drag = resizeDrag.current
    if (!drag || drag.done || event.pointerId !== drag.id || !track?.duration) return
    const rect = waveRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const snapped = snapBoundary(ratio * track.duration, track.bpm, drag.limits.min, drag.limits.max)
    if (snapped == null) return
    drag.moved = true
    const before = drag.sections[drag.index]
    if (Math.abs(snapped - before.start) < 0.0005) {
      syncStudio(() => drag.origin)
      if (drag.selectedIndex >= 0) setSection(drag.sections[drag.selectedIndex])
      if (drag.pickedIndex >= 0) setPicked(drag.sections[drag.pickedIndex])
      return
    }
    const next = withBoundary(drag.sections, drag.index, snapped)
    const rightKey = sectionKey(next[drag.index])
    syncStudio(() => ({
      ...drag.origin,
      sections: next,
      edits: moveKey(drag.origin.edits, sectionKey(before), rightKey),
      seeds: moveKey(drag.origin.seeds, sectionKey(before), rightKey),
    }))
    if (drag.selectedIndex >= 0) setSection(next[drag.selectedIndex])
    if (drag.pickedIndex >= 0) setPicked(next[drag.pickedIndex])
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
    resizeDrag.current?.cleanup?.()
    const drag = {
      id: event.pointerId,
      index,
      origin: studioRef.current,
      sections: list,
      selectedIndex: list.findIndex((item) => sameSection(item, section)),
      pickedIndex: list.findIndex((item) => sameSection(item, picked)),
      limits,
      done: false,
      moved: false,
      cleanup: null,
    }
    const move = (pointer) => onBoundaryMove(pointer)
    const up = (pointer) => {
      if (pointer.pointerId !== drag.id) return
      drag.cleanup?.()
      finishBoundary(pointer)
    }
    drag.cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    resizeDrag.current = drag
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    setHotBoundary(index)
  }

  splitRef.current = splitHere
  undoRef.current = undoStudio

  useEffect(() => {
    if (studio.style !== 'chrome') return undefined
    editStudio((current) => (current.style === 'chrome' ? { ...current, style: 'image' } : current))
    return undefined
  }, [studio.style, editStudio])

  useEffect(() => {
    if (studio.style !== 'image') return undefined
    prepareCollage({ style: 'image', images: (studio.images || []).map((image) => image.url) })
    prepareMosaic({ style: 'image', images: (studio.images || []).map((image) => image.url) })
    prepareRiso({ style: 'image', images: (studio.images || []).map((image) => image.url) })
    return undefined
  }, [studio.style, studio.images])

  return (
    <main className="studio">
      <section className="studio-main" ref={mainRef}>
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
            {expanded ? <div className="canvas-spacer" style={{ width: parked?.w || size.w, height: parked?.h || size.h }} /> : null}
            {expanded ? null : (
              <div
                ref={holderRef}
                className={track && shapesOn ? 'canvas-stage can-place' : 'canvas-stage'}
                style={{ width: size.w, height: size.h, background: visualOn ? background : artwork }}
                onPointerDown={track && shapesOn ? onPlaceDown : undefined}
                onPointerMove={onPlaceMove}
                onPointerUp={onPlaceUp}
                onPointerCancel={onPlaceUp}
                role={track && visualOn ? 'img' : undefined}
                aria-label={track && collageOn ? 'Collage of the image' : track && mosaicOn ? 'Mosaic of the image' : track && risoOn ? 'Riso print of the image' : track && imageOn ? 'Halftone of the image' : track && bloomOn ? 'Bloom reacting to the track' : track && orbOn ? 'Orb reacting to the track' : track && chromeOn ? 'Chrome reacting to the track' : track && shapesOn ? 'Liquid reacting to the track' : undefined}
              />
            )}
            {track && visualOn ? null : (
              <div className="canvas-empty">
                {track ? (
                  <p>Coming soon</p>
                ) : (
                  <>
                    <Link className="canvas-upload" to="/upload">
                      Go to Upload
                    </Link>
                    <p>{bloomOn ? 'Upload a track to see bloom.' : orbOn ? 'Upload a track to see orb.' : imageOn ? 'Upload a track to see the image.' : 'Upload a track to see liquid.'}</p>
                  </>
                )}
              </div>
            )}
            <button type="button" className="canvas-expand" aria-label="Expand" onClick={openCanvas}>
              <ExpandIcon />
            </button>
          </div>
        </div>

        <div className="why">
          <strong>Why it looks like this</strong>
          <p>
            {chromeOn
              ? explainChrome()
              : orbOn
              ? explainOrb()
              : bloomOn
              ? explainBloom()
              : collageOn
                ? 'The frames share the photos you picked, as evenly as they can. The largest frame follows point 1 on the first photo, and the speed slider changes how quickly a smaller frame cuts to another point.'
                : mosaicOn
                  ? 'The photo is rebuilt from small tiles that follow its shapes. A soft light moves across them: bass speeds it up, a beat catches a cluster, and a new photo arrives on a sweep of that light.'
                  : risoOn
                    ? explainRiso()
                  : imageOn
                    ? 'The grid is a halftone of the whole photo. Soft zones drift across and sharpen it where they pass. A strong bass hit fuses the darkest dots for a moment, and a beat sends a ripple through the grid.'
                    : explainPoster(poster)}
          </p>
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
              <div className="section-row" ref={rowRef}>
                {sections.map((item, index) => {
                  const key = sectionKey(item)
                  const selected = sameSection(section, item) || sameSection(picked, item)
                  const naming = renaming?.key === key
                  return (
                    <div key={`${index}:${item.label}`} className={selected ? 'section-chip-wrap is-selected' : 'section-chip-wrap'} style={{ flex: Math.max(0.08, item.end - item.start) }}>
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
                          onMouseEnter={(event) => {
                            const node = event.currentTarget
                            if (node.scrollWidth > node.clientWidth + 1) node.title = item.label
                            else node.removeAttribute('title')
                          }}
                          onClick={(event) => {
                            if (event.shiftKey) {
                              setPicked((current) => (sameSection(current, item) || sameSection(section, item) ? null : item))
                              return
                            }
                            setPicked(null)
                            setSection(item)
                            if (audioRef.current) audioRef.current.currentTime = item.start
                          }}
                          onDoubleClick={(event) => {
                            if (event.shiftKey) return
                            event.preventDefault()
                            setRenaming({ key, value: item.label.slice(0, 16) })
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            setSection(item)
                            setPicked(null)
                            mergeSection(index)
                          }}
                        >
                          {item.label}
                        </button>
                      )}
                    </div>
                  )
                })}
                {sections.map((item, index) => (
                  index > 0 ? (
                    <button
                      key={`edge-${index}`}
                      type="button"
                      data-index={index}
                      className={hotBoundary === index ? 'section-boundary is-hot' : 'section-boundary'}
                      aria-label={`Resize between ${sections[index - 1].label} and ${item.label}`}
                      onPointerDown={(event) => onBoundaryDown(event, index)}
                    />
                  ) : null
                ))}
              </div>
              <div className="section-actions">
                <button type="button" className="button-redo" onClick={splitHere}>Split here</button>
                <button type="button" className="button-redo" disabled={!canMerge} onClick={mergePicked}>Merge</button>
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

        {imageOn ? (
          <>
            <div className="image-head">
              <p className="side-label">Images</p>
              <span className="image-count">{images.length} of 5</span>
            </div>
            <div className="image-grid">
              {images.map((image) => {
                const chosen = collageOn ? collagePicks.includes(image.id) : image.id === selectedImage
                return (
                  <div className={chosen ? 'image-slot is-selected' : 'image-slot'} key={image.id}>
                    <button
                      type="button"
                      className="image-pick"
                      aria-pressed={chosen}
                      aria-label={collageOn ? `Use ${image.name || 'image'} in this section` : `Use ${image.name || 'image'} for this section`}
                      disabled={!section}
                      onClick={() => (collageOn ? toggleCollageImage(image.id) : assignImage(image.id))}
                    >
                      <img src={image.url} alt="" />
                    </button>
                    <button type="button" className="image-remove" aria-label={`Remove ${image.name || 'image'}`} onClick={() => removeImage(image.id)}>
                      ×
                    </button>
                  </div>
                )
              })}
              {images.length < 5 ? (
                <button type="button" className="image-slot is-add" aria-label="Add an image" onClick={() => imageInputRef.current?.click()}>
                  +
                </button>
              ) : null}
            </div>
            <input
              ref={imageInputRef}
              className="image-file"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={onImages}
            />
            {images.length ? (
              <button
                type="button"
                className={imageApplied ? 'button-redo apply-all is-on' : 'button-redo apply-all'}
                disabled={!section || !sections.length}
                onClick={collageOn ? applyCollageImages : applyImage}
              >
                {imageApplied ? 'Applied to all sections ✓' : collageOn ? 'Apply images to all sections' : 'Apply image to all sections'}
              </button>
            ) : (
              <p className="section-note">
                {collageOn ? 'Add photos, then choose which ones this section uses. Point 1 on the first chosen photo fills the largest frame.' : mosaicOn ? 'Add a photo. The mosaic follows its shapes.' : risoOn ? 'Add a photo. Dark areas print in ink 1, lighter areas in ink 2.' : 'Add a photo. Dark areas become larger dots.'}
              </p>
            )}
            {collageOn ? null : (
              <>
                <p className="side-label">Switch images on</p>
                <label className="style-field">
                  <select className="style-select" aria-label="Switch images on" value={studio.imageSwitch || 'section'} onChange={onImageSwitch}>
                    <option value="section">Section</option>
                    <option value="off">Off</option>
                  </select>
                </label>
              </>
            )}
          </>
        ) : null}

        {visualOn ? (
          <>
            {chromeOn ? null : (
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
                {compositionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
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
              </>
            )}
            {bloomOn ? (
              <>
                <div className="background-row">
                  <p className="side-label">Filled dots</p>
                  <button
                    type="button"
                    className="shine-switch"
                    role="switch"
                    aria-checked={filledOn}
                    aria-label="Filled dots"
                    disabled={!section}
                    onClick={() => {
                      setFilledAck(null)
                      writeSection({ filled: sectionEdit.filled !== true })
                    }}
                  >
                    <span />
                  </button>
                </div>
                <button
                  type="button"
                  className={filledApplied ? 'button-redo apply-all is-on' : 'button-redo apply-all'}
                  disabled={!section || !sections.length}
                  onClick={applyFilled}
                >
                  {filledApplied ? 'Applied to all sections ✓' : 'Apply to all sections'}
                </button>
              </>
            ) : null}
            {imageOn && !collageOn && !mosaicOn && !risoOn ? (
              <>
                <p className="side-label">Dots</p>
                <div className="swatches background-swatches" role="listbox" aria-label="Dots">
                  {backgroundChoices.map((choice) => {
                    const selected = choice.hex.toLowerCase() === sectionDots.toLowerCase()
                    return (
                      <button
                        key={`dots-${choice.label}-${choice.hex}`}
                        type="button"
                        className={selected ? 'swatch is-on' : 'swatch'}
                        style={{ background: choice.hex }}
                        aria-label={choice.label}
                        aria-selected={selected}
                        disabled={!section}
                        onClick={(event) => {
                          const changed = choice.hex.toLowerCase() !== sectionDots.toLowerCase()
                          if (changed) {
                            setDotsAck(null)
                            writeSection({ dots: choice.hex })
                          }
                          openPicker(event, {
                            mode: 'edit',
                            target: 'dots',
                            hex: choice.hex,
                            previous: choice.hex,
                            custom: Boolean(choice.custom),
                            ...(changed ? { revert: isHex(sectionEdit.dots) ? sectionEdit.dots : null } : {}),
                          })
                        }}
                      />
                    )
                  })}
                  <button
                    type="button"
                    className="add-swatch"
                    aria-label="Add a dots color"
                    disabled={!section || backgroundChoices.length >= MAX_BACKGROUNDS}
                    onClick={(event) => openPicker(event, { mode: 'add', target: 'dots', hex: '#d25a3a' })}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className={dotsApplied ? 'button-redo apply-all is-on' : 'button-redo apply-all'}
                  disabled={!section || !sections.length}
                  onClick={applyDots}
                >
                  {dotsApplied ? 'Applied to all sections ✓' : 'Apply to all sections'}
                </button>
              </>
            ) : null}
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
            {risoOn ? (
              <>
                <p className="side-label">Ink colors</p>
                <div className="swatches background-swatches" role="listbox" aria-label="Ink colors">
                  {inkChoices.map((choice) => {
                    const slot = sectionInks.findIndex((hex) => hex.toLowerCase() === choice.hex.toLowerCase())
                    const selected = slot >= 0
                    return (
                      <button
                        key={`ink-${choice.label}-${choice.hex}`}
                        type="button"
                        className={selected ? 'swatch is-on' : 'swatch'}
                        style={{ background: choice.hex }}
                        aria-label={choice.label}
                        aria-selected={selected}
                        disabled={!section}
                        onClick={(event) => {
                          if (selected) {
                            lastInkSlot.current = slot
                            openPicker(event, {
                              mode: 'edit',
                              target: 'ink',
                              slot,
                              hex: choice.hex,
                              previous: choice.hex,
                              custom: Boolean(choice.custom),
                            })
                            return
                          }
                          const index = lastInkSlot.current === 0 ? 0 : 1
                          const next = sectionInks.slice()
                          next[index] = choice.hex
                          setInksAck(null)
                          writeSection({ inks: next })
                          openPicker(event, {
                            mode: 'edit',
                            target: 'ink',
                            slot: index,
                            hex: choice.hex,
                            previous: choice.hex,
                            custom: Boolean(choice.custom),
                            revert: sectionInks.slice(),
                          })
                        }}
                      />
                    )
                  })}
                  <button
                    type="button"
                    className="add-swatch"
                    aria-label="Add an ink color"
                    disabled={!section || inkChoices.length >= MAX_INKS}
                    onClick={(event) =>
                      openPicker(event, {
                        mode: 'add',
                        target: 'ink',
                        slot: lastInkSlot.current === 0 ? 0 : 1,
                        hex: '#d25a3a',
                      })
                    }
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className={inksApplied ? 'button-redo apply-all is-on' : 'button-redo apply-all'}
                  disabled={!section || !sections.length}
                  onClick={applyInks}
                >
                  {inksApplied ? 'Applied to all sections ✓' : 'Apply to all sections'}
                </button>
              </>
            ) : null}
            {chromeOn ? (
              <>
                <p className="side-label">Metal color</p>
                <div className="swatches background-swatches" role="listbox" aria-label="Metal color">
                  {metalChoices.map((choice) => {
                    const selected = choice.hex.toLowerCase() === sectionMetal.toLowerCase()
                    return (
                      <button
                        key={`metal-${choice.label}-${choice.hex}`}
                        type="button"
                        className={selected ? 'swatch is-on' : 'swatch'}
                        style={{ background: choice.hex }}
                        aria-label={choice.label}
                        aria-selected={selected}
                        disabled={!section}
                        onClick={(event) => {
                          const changed = choice.hex.toLowerCase() !== sectionMetal.toLowerCase()
                          if (changed) {
                            setMetalAck(null)
                            writeSection({ metal: choice.hex })
                          }
                          openPicker(event, {
                            mode: 'edit',
                            target: 'metal',
                            hex: choice.hex,
                            previous: choice.hex,
                            custom: Boolean(choice.custom),
                            ...(changed ? { revert: isHex(sectionEdit.metal) ? sectionEdit.metal : null } : {}),
                          })
                        }}
                      />
                    )
                  })}
                  <button
                    type="button"
                    className="add-swatch"
                    aria-label="Add a metal color"
                    disabled={!section || metalChoices.length >= MAX_METALS}
                    onClick={(event) => openPicker(event, { mode: 'add', target: 'metal', hex: '#d25a3a' })}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className={metalApplied ? 'button-redo apply-all is-on' : 'button-redo apply-all'}
                  disabled={!section || !sections.length}
                  onClick={applyMetal}
                >
                  {metalApplied ? 'Applied to all sections ✓' : 'Apply to all sections'}
                </button>
              </>
            ) : null}
            {dotsOn ? (
              <>
                <p className="side-label">Dot colors</p>
                <div className="swatches background-swatches" role="listbox" aria-label="Dot colors">
                  {bloomColors.map((hex, index) => (
                    <button
                      key={`bloom-dot-${index}-${hex}`}
                      type="button"
                      className="swatch is-on"
                      style={{ background: hex }}
                      aria-label={`Dot color ${index + 1}`}
                      aria-selected="true"
                      disabled={!section}
                      onClick={(event) => {
                        setDotColorAck(null)
                        openPicker(event, {
                          mode: 'edit',
                          target: 'dotColor',
                          index,
                          hex,
                          previous: hex,
                          revert: bloomColors.slice(),
                        })
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    className="add-swatch"
                    aria-label="Add a dot color"
                    disabled={!section || bloomColors.length >= MAX_DOT_COLORS}
                    onClick={(event) =>
                      openPicker(event, {
                        mode: 'add',
                        target: 'dotColor',
                        hex: bloomColors[bloomColors.length - 1] || (orbOn ? DEFAULT_ORB_COLORS[0] : DEFAULT_DOT_COLOR),
                      })
                    }
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className={bloomColorApplied ? 'button-redo apply-all is-on' : 'button-redo apply-all'}
                  disabled={!section || !sections.length}
                  onClick={applyDotColors}
                >
                  {bloomColorApplied ? 'Applied to all sections ✓' : 'Apply to all sections'}
                </button>
                {bloomOn ? (
                  <>
                    <p className="side-label">Color mode</p>
                    <label className="style-field">
                      <select
                        className="style-select"
                        aria-label="Color mode"
                        value={bloomColorMode}
                        disabled={!section}
                        onChange={(event) => {
                          setDotColorAck(null)
                          writeSection({ colorMode: event.target.value })
                        }}
                      >
                        {COLOR_MODES.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
              </>
            ) : null}
            {mosaicOn ? (
              <>
                <p className="side-label">Grout color</p>
                <div className="swatches background-swatches" role="listbox" aria-label="Grout color">
                  {backgroundChoices.map((choice) => {
                    const selected = choice.hex.toLowerCase() === sectionGrout.toLowerCase()
                    return (
                      <button
                        key={`grout-${choice.label}-${choice.hex}`}
                        type="button"
                        className={selected ? 'swatch is-on' : 'swatch'}
                        style={{ background: choice.hex }}
                        aria-label={choice.label}
                        aria-selected={selected}
                        disabled={!section}
                        onClick={(event) => {
                          const changed = choice.hex.toLowerCase() !== sectionGrout.toLowerCase()
                          if (changed) {
                            setGroutAck(null)
                            writeSection({ grout: choice.hex })
                          }
                          openPicker(event, {
                            mode: 'edit',
                            target: 'grout',
                            hex: choice.hex,
                            previous: choice.hex,
                            custom: Boolean(choice.custom),
                            ...(changed ? { revert: isHex(sectionEdit.grout) ? sectionEdit.grout : null } : {}),
                          })
                        }}
                      />
                    )
                  })}
                  <button
                    type="button"
                    className="add-swatch"
                    aria-label="Add a grout color"
                    disabled={!section || backgroundChoices.length >= MAX_BACKGROUNDS}
                    onClick={(event) => openPicker(event, { mode: 'add', target: 'grout', hex: '#1a1a1a' })}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className={groutApplied ? 'button-redo apply-all is-on' : 'button-redo apply-all'}
                  disabled={!section || !sections.length}
                  onClick={applyGrout}
                >
                  {groutApplied ? 'Applied to all sections ✓' : 'Apply to all sections'}
                </button>
                <p className="side-label">Background tiles</p>
                <label className="style-field">
                  <select
                    className="style-select"
                    aria-label="Background tiles"
                    value={sectionEdit.ground === 'solid' ? 'solid' : 'photo'}
                    disabled={!section}
                    onChange={(event) => writeSection({ ground: event.target.value === 'solid' ? 'solid' : 'photo' })}
                  >
                    <option value="photo">Photo</option>
                    <option value="solid">Solid color</option>
                  </select>
                </label>
              </>
            ) : null}
            {mosaicOn ? (
              <>
                <div className="background-row">
                  <p className="side-label">Follow image flow</p>
                  <button
                    type="button"
                    className="shine-switch"
                    role="switch"
                    aria-checked={sectionEdit.flow !== false}
                    aria-label="Follow image flow"
                    disabled={!section}
                    onClick={() => writeSection({ flow: sectionEdit.flow === false })}
                  >
                    <span />
                  </button>
                </div>
              </>
            ) : null}
            {collageOn ? (
              <>
                <div className="background-row">
                  <p className="side-label">Black & white</p>
                  <button
                    type="button"
                    className="shine-switch"
                    role="switch"
                    aria-checked={sectionEdit.mono === true}
                    aria-label="Black & white"
                    disabled={!section}
                    onClick={() => writeSection({ mono: sectionEdit.mono !== true })}
                  >
                    <span />
                  </button>
                </div>
                <div className="background-row">
                  <p className="side-label">Grain</p>
                  <button
                    type="button"
                    className="shine-switch"
                    role="switch"
                    aria-checked={sectionEdit.grain === true}
                    aria-label="Grain"
                    disabled={!section}
                    onClick={() => writeSection({ grain: sectionEdit.grain !== true })}
                  >
                    <span />
                  </button>
                </div>
                <button type="button" className="button-redo apply-all" onClick={() => setFocusOpen(true)}>
                  Edit focus points
                </button>
              </>
            ) : null}
          </>
        ) : null}

        {imageOn || bloomOn || orbOn ? null : (
          <>
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
          </>
        )}

        {chromeOn ? (
          <>
            <div className="slider-labels">
              <span>Silver</span>
              <span>Tint</span>
            </div>
            <input
              className="range"
              type="range"
              min="0"
              max="100"
              value={tintValue}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={onTint}
              aria-label="Tint"
            />
          </>
        ) : null}

        {collageOn || mosaicOn || risoOn ? null : (
          <>
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

            {orbOn ? null : (
              <>
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
              </>
            )}
          </>
        )}

        {shapesOn ? (
          <>
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
          </>
        ) : null}

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

        {shapesOn ? (
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
        ) : null}

        {section && visualOn ? (
          <div className="section-tools">
            {mosaicOn ? (
              <>
                <p className="side-label">Tile size</p>
                <div className="slider-labels">
                  <span>Small</span>
                  <span>Large</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="100"
                  value={Math.min(100, Math.max(0, sectionEdit.count ?? 38))}
                  onPointerDown={startSlide}
                  onPointerUp={finishSlide}
                  onPointerCancel={finishSlide}
                  onChange={onSectionCount}
                  aria-label="Tile size"
                />
                <div className="slider-labels">
                  <span>Grout width</span>
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
                  aria-label="Grout width"
                />
                <p className="side-label">Shimmer</p>
                <div className="slider-labels">
                  <span>Subtle</span>
                  <span>Strong</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="100"
                  value={shimmerValue}
                  onPointerDown={startSlide}
                  onPointerUp={finishSlide}
                  onPointerCancel={finishSlide}
                  onChange={onShimmer}
                  aria-label="Shimmer"
                />
              </>
            ) : (
              <>
            {collageOn ? null : (
              <>
                {risoOn ? <p className="side-label">Misregistration</p> : null}
                <div className="slider-labels">
                  {risoOn ? (
                    <>
                      <span>Subtle</span>
                      <span>Wide</span>
                    </>
                  ) : (
                    <span>{imageOn ? 'Max dot size' : 'Shape size'}</span>
                  )}
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
                  aria-label={risoOn ? 'Misregistration' : imageOn ? 'Max dot size' : 'Shape size'}
                />
              </>
            )}
            {risoOn ? <p className="side-label">Grain size</p> : null}
            <div className="slider-labels">
              {risoOn ? (
                <>
                  <span>Fine</span>
                  <span>Coarse</span>
                </>
              ) : (
                <>
                  <span>{collageOn ? 'Number of panels' : imageOn ? 'Dot density' : 'Number of shapes'}</span>
                  <span>{countValue}</span>
                </>
              )}
            </div>
            <input
              className="range"
              type="range"
              min={orbOn ? ORB_COUNT.min : chromeOn ? CHROME_COUNT.min : bloomOn ? BLOOM_COUNT.min : collageOn ? PANEL_COUNT.min : risoOn ? GRAIN_SIZE.min : imageOn ? DOT_DENSITY.min : shapeRange.min}
              max={orbOn ? ORB_COUNT.max : chromeOn ? CHROME_COUNT.max : bloomOn ? BLOOM_COUNT.max : collageOn ? PANEL_COUNT.max : risoOn ? GRAIN_SIZE.max : imageOn ? DOT_DENSITY.max : shapeRange.max}
              step={orbOn ? 100 : 1}
              value={countValue}
              onPointerDown={startSlide}
              onPointerUp={finishSlide}
              onPointerCancel={finishSlide}
              onChange={onSectionCount}
              aria-label={risoOn ? 'Grain size' : collageOn ? 'Number of panels' : imageOn ? 'Dot density' : 'Number of shapes'}
            />
            {imageOn && !collageOn ? (
              <>
                <div className="slider-labels">
                  <span>Image contrast</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min="0"
                  max="100"
                  value={contrastValue}
                  onPointerDown={startSlide}
                  onPointerUp={finishSlide}
                  onPointerCancel={finishSlide}
                  onChange={onSectionContrast}
                  aria-label="Image contrast"
                />
              </>
            ) : imageOn || bloomOn || orbOn ? null : (
              <>
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
                {chromeOn ? null : <p className="section-note">Drag the picture to move the main shape.</p>}
              </>
            )}
              </>
            )}
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
          <div className="background-row">
            <p className="side-label">Mosaic lights</p>
            <button
              type="button"
              className="shine-switch"
              role="switch"
              aria-checked={tune.mosaicMarks === true}
              aria-label="Show mosaic lights"
              onClick={() => onTuneFlag('mosaicMarks', tune.mosaicMarks !== true)}
            >
              <span />
            </button>
          </div>
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
            onChange={(event) => {
              const hex = event.target.value
              setPicker((current) => (current ? { ...current, hex } : current))
              if (picker.target === 'dotColor' && picker.mode === 'edit' && isHex(hex)) {
                const next = sectionInkColors(studio.style, studio.edits?.[activeKey]).slice()
                next[picker.index] = hex
                writeDotColors(next)
              }
              if (picker.target === 'metal' && isHex(hex)) writeSection({ metal: hex })
              if (picker.target === 'ink' && picker.mode === 'edit' && isHex(hex)) {
                const next = risoInksOf(studio.edits?.[activeKey]).slice()
                next[picker.slot === 0 ? 0 : 1] = hex
                writeSection({ inks: next })
              }
            }}
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
              if (picker.target === 'dotColor' && picker.mode === 'edit' && isHex(hex)) {
                const next = sectionInkColors(studio.style, studio.edits?.[activeKey]).slice()
                next[picker.index] = hex
                writeDotColors(next)
              }
              if (picker.target === 'metal' && isHex(hex)) writeSection({ metal: hex })
              if (picker.target === 'ink' && picker.mode === 'edit' && isHex(hex)) {
                const next = risoInksOf(studio.edits?.[activeKey]).slice()
                next[picker.slot === 0 ? 0 : 1] = hex
                writeSection({ inks: next })
              }
            }}
          />
          <button type="submit" className="button" disabled={!isHex(picker.hex)}>
            {picker.mode === 'add' ? 'Add' : 'Save'}
          </button>
        </form>
      ) : null}
      {expanded
        ? createPortal(
            <div className="canvas-lightbox" onClick={closeCanvas}>
              <button
                type="button"
                className="canvas-lightbox-close"
                aria-label="Close"
                onClick={(event) => {
                  event.stopPropagation()
                  closeCanvas()
                }}
              >
                <CloseIcon />
              </button>
              <div
                ref={holderRef}
                className={track && shapesOn ? 'canvas-stage can-place is-expanded' : 'canvas-stage is-expanded'}
                style={{ width: size.w, height: size.h, background: visualOn ? background : artwork }}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={track && shapesOn ? onPlaceDown : undefined}
                onPointerMove={onPlaceMove}
                onPointerUp={onPlaceUp}
                onPointerCancel={onPlaceUp}
                role={track && visualOn ? 'img' : undefined}
                aria-label={track && collageOn ? 'Collage of the image' : track && mosaicOn ? 'Mosaic of the image' : track && risoOn ? 'Riso print of the image' : track && imageOn ? 'Halftone of the image' : track && bloomOn ? 'Bloom reacting to the track' : track && orbOn ? 'Orb reacting to the track' : track && chromeOn ? 'Chrome reacting to the track' : track && shapesOn ? 'Liquid reacting to the track' : undefined}
              />
            </div>,
            document.body,
          )
        : null}
      {focusOpen
        ? createPortal(
            <FocusEditor images={collageOn ? images.filter((image) => collagePicks.includes(image.id)) : images} focus={studio.focus || {}} onChange={saveFocus} onClose={() => setFocusOpen(false)} />,
            document.body,
          )
        : null}
    </main>
  )
}
