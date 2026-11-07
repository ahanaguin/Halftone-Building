import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { imageComposition, prepareCollage } from './collageField.js'
import { frameInput, paintFrame } from './drawFrame.js'
import { loudestSection } from './exportPlan.js'
import { prepareHalftone } from './halftoneField.js'
import { prepareMosaic } from './mosaicField.js'
import { paletteFromPreset } from './palette.js'
import { prepareRiso } from './risoField.js'
import { workingSections } from './sectionEdit.js'
import { PAPER, sectionKey, sectionSeed } from './shapeLayout.js'
import { useTrack } from './track.jsx'

const PREVIEW = { width: 640, height: 360 }
const FALLBACK = [{ start: 0, end: 8, label: 'High' }]

const STYLES = [
  {
    id: 'shapes',
    name: 'Liquid',
    blurb: 'Shapes merging and splitting like liquid.',
    tags: ['Free', 'Mirror', 'Quad', 'Radial'],
  },
  {
    id: 'image',
    name: 'Image animation',
    blurb: 'Your photos with a distinct style that matches your music.',
    tags: ['Halftone', 'Collage', 'Mosaic', 'Riso'],
  },
  {
    id: 'bloom',
    name: 'Bloom',
    blurb: 'Sunflower spiral that shifts with the song.',
    tags: ['Full', 'Ring'],
  },
  {
    id: 'orb',
    name: 'Orb',
    blurb: '3D sphere of dots that pulses with the beat.',
    tags: ['Sphere', 'Ring'],
  },
]

const PALETTES = {
  shapes: paletteFromPreset({
    colors: ['#ff2ec8', '#7b2cff', '#00d4ff', '#ffe14d', '#ff4d6d'],
    warmth: 0.72,
    lightness: 0.68,
  }),
  image: paletteFromPreset({
    colors: ['#111111', '#ff4d8d', '#5b35c7', '#ffb000'],
    warmth: 0.58,
    lightness: 0.48,
  }),
  bloom: paletteFromPreset({
    colors: ['#ff4d8d', '#ffd23a', '#5b35c7', '#2ee6c7'],
    warmth: 0.64,
    lightness: 0.7,
  }),
  orb: paletteFromPreset({
    colors: ['#ff7a18', '#5b35c7', '#2ee6c7', '#ff4d8d'],
    warmth: 0.6,
    lightness: 0.62,
  }),
}

function Checkmark() {
  return (
    <span className="style-card-check" aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path
          d="M3.2 8.2 6.4 11.4 12.8 4.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function demoPhoto(kind) {
  const canvas = document.createElement('canvas')
  canvas.width = 720
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  const shifts = {
    warm: [
      [0, '#ff2d6a'],
      [0.42, '#ffb000'],
      [0.78, '#7b2cff'],
      [1, '#1a0b28'],
    ],
    cool: [
      [0, '#00d4ff'],
      [0.4, '#5b35c7'],
      [0.72, '#ff4d8d'],
      [1, '#061018'],
    ],
    dusk: [
      [0, '#ffe14d'],
      [0.38, '#ff5a36'],
      [0.7, '#2ee6c7'],
      [1, '#101018'],
    ],
  }
  const stops = shifts[kind] || shifts.warm
  const fill = ctx.createLinearGradient(40, 0, 680, 720)
  for (const [stop, color] of stops) fill.addColorStop(stop, color)
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, 720, 720)
  const blobs = [
    [180, 210, 240, 'rgba(255,255,255,0.22)'],
    [520, 160, 190, 'rgba(255,80,180,0.28)'],
    [390, 480, 260, 'rgba(80,60,255,0.26)'],
    [140, 540, 160, 'rgba(0,230,200,0.2)'],
  ]
  for (const [x, y, radius, color] of blobs) {
    const glow = ctx.createRadialGradient(x, y, 8, x, y, radius)
    glow.addColorStop(0, color)
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, 720, 720)
  }
  return canvas.toDataURL('image/jpeg', 0.88)
}

let demoPhotos = null

function demoImages() {
  if (!demoPhotos) {
    demoPhotos = [
      { id: 'demo-warm', url: demoPhoto('warm'), name: 'Demo warm' },
      { id: 'demo-cool', url: demoPhoto('cool'), name: 'Demo cool' },
      { id: 'demo-dusk', url: demoPhoto('dusk'), name: 'Demo dusk' },
    ]
  }
  return demoPhotos
}

function sourceSections(track, studio) {
  const sections = workingSections(track, studio)
  return sections.length ? sections : FALLBACK
}

function rangeOf(values) {
  if (!values?.length) return { lo: 0, hi: 1 }
  let lo = values[0]
  let hi = values[0]
  for (const value of values) {
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  return { lo, hi: hi <= lo ? lo + 1e-4 : hi }
}

function demoProfile(length, bpm) {
  const hop = 1 / 30
  const n = Math.max(16, Math.ceil(length / hop))
  const rms = []
  const bass = []
  const high = []
  const zcr = []
  const period = 60 / Math.max(70, bpm || 110)
  for (let i = 0; i < n; i += 1) {
    const phase = ((i * hop) % period) / period
    const kick = phase < 0.2 ? (1 - phase / 0.2) ** 1.35 : 0
    const hat = phase > 0.48 && phase < 0.62 ? 0.85 : 0.12
    rms.push(0.08 + kick * 0.24)
    bass.push(0.18 + kick * 0.72)
    high.push(0.14 + hat * 0.62)
    zcr.push(0.05 + hat * 0.22)
  }
  return {
    rms: rangeOf(rms),
    bass: rangeOf(bass),
    high: rangeOf(high),
    zcr: rangeOf(zcr),
    timeline: { hop, rms, bass, high, zcr },
  }
}

function sliceProfile(profile, start, length, bpm) {
  const timeline = profile?.timeline
  if (!timeline?.rms?.length) return demoProfile(length, bpm)
  const hop = timeline.hop || 1 / 30
  const from = Math.max(0, Math.floor(start / hop))
  const count = Math.max(8, Math.ceil(length / hop))
  const slice = (arr) => Array.from(arr || []).slice(from, from + count)
  const rms = slice(timeline.rms)
  const bass = slice(timeline.bass)
  const high = slice(timeline.high)
  const zcr = slice(timeline.zcr)
  return {
    rms: profile.rms || rangeOf(rms),
    bass: profile.bass || rangeOf(bass),
    high: profile.high || rangeOf(high),
    zcr: profile.zcr || rangeOf(zcr),
    timeline: { hop, rms, bass, high, zcr },
  }
}

function previewWindow(track, studio) {
  const sections = sourceSections(track, studio)
  const loudest = loudestSection(sections, track?.profile) || sections[0]
  const start = loudest?.start || 0
  const end = loudest?.end || start + 8
  const length = Math.min(5, Math.max(2.8, end - start))
  return {
    start,
    length,
    rest: Math.min(0.7, length * 0.18),
    section: { start: 0, end: length, label: loudest?.label || 'High' },
    origin: loudest,
    profile: sliceProfile(track?.profile, start, length, track?.bpm),
  }
}

function styleEdits(style, photos) {
  if (style === 'shapes') return { composition: 'radial', background: '#0b0b12', count: 26, size: 58 }
  if (style === 'image') {
    return {
      composition: photos.length >= 3 ? 'collage' : 'halftone',
      background: PAPER,
      contrast: 58,
    }
  }
  if (style === 'bloom') {
    return {
      composition: 'full',
      background: '#0c0c14',
      colorMode: 'arms',
      filled: true,
      count: 260,
      size: 62,
      dotColors: ['#ff4d8d', '#ffd23a', '#5b35c7', '#2ee6c7'],
    }
  }
  return {
    composition: 'sphere',
    background: '#050508',
    count: 7200,
    size: 64,
    dotColors: ['#ff7a18', '#5b35c7', '#2ee6c7', '#ff4d8d'],
  }
}

function styleStudio(style, studio, photos, section) {
  const edit = styleEdits(style, photos)
  return {
    ...studio,
    style,
    palette: PALETTES[style] || studio.palette,
    background: edit.background,
    shine: true,
    speed: 58,
    images: photos,
    sections: [section],
    edits: { [sectionKey(section)]: edit },
  }
}

function paintPreview(canvas, spec) {
  if (!canvas) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const width = Math.round(PREVIEW.width * dpr)
  const height = Math.round(PREVIEW.height * dpr)
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  paintFrame(ctx, { ...spec, width: PREVIEW.width, height: PREVIEW.height })
}

async function prepareImage(spec) {
  const composition = imageComposition(spec)
  if (composition === 'collage') await prepareCollage(spec)
  else if (composition === 'mosaic') await prepareMosaic(spec)
  else if (composition === 'riso') await prepareRiso(spec)
  else await prepareHalftone(spec)
}

function StyleCard({ item, selected, live, track, studio, photos, onSelect, onHover, onLeave }) {
  const canvasRef = useRef(null)
  const readyRef = useRef(false)
  const specAtRef = useRef(() => null)
  const restTimeRef = useRef(0.7)

  const preview = useMemo(() => {
    const windowing = previewWindow(track, studio)
    const nextStudio = styleStudio(item.id, studio, photos, windowing.section)
    const nextTrack = {
      duration: windowing.length,
      bpm: track?.bpm || 110,
      sections: [windowing.section],
      profile: windowing.profile,
      fileName: track?.fileName || '',
    }
    const seed = windowing.origin ? sectionSeed(windowing.origin, 0) : 1
    return { studio: nextStudio, track: nextTrack, windowing, seed }
  }, [item.id, studio, photos, track])

  function specAt(localTime) {
    const spec = frameInput({
      track: preview.track,
      studio: preview.studio,
      profile: preview.windowing.profile,
      time: localTime,
      width: PREVIEW.width,
      height: PREVIEW.height,
    })
    spec.seed = preview.seed
    return spec
  }

  specAtRef.current = specAt
  restTimeRef.current = preview.windowing.rest

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    let cancel = false
    readyRef.current = false

    async function boot() {
      const spec = specAtRef.current(restTimeRef.current)
      if (item.id === 'image') await prepareImage(spec)
      if (cancel) return
      readyRef.current = true
      paintPreview(canvas, spec)
    }

    boot()
    return () => {
      cancel = true
    }
  }, [item.id, preview])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !live) return undefined
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const length = preview.windowing.length
    let raf = 0
    const born = performance.now()

    function tick(now) {
      if (!readyRef.current) {
        raf = requestAnimationFrame(tick)
        return
      }
      const local = ((now - born) / 1000) % length
      paintPreview(canvas, specAtRef.current(local))
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      if (readyRef.current) paintPreview(canvas, specAtRef.current(restTimeRef.current))
    }
  }, [live, preview])

  return (
    <button
      type="button"
      className={selected ? 'style-card is-on' : 'style-card'}
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      onPointerEnter={() => onHover(item.id)}
      onPointerLeave={onLeave}
    >
      <span className="style-card-preview">
        <canvas ref={canvasRef} aria-hidden="true" />
        {selected ? <Checkmark /> : null}
      </span>
      <span className="style-card-copy">
        <strong>{item.name}</strong>
        <span>{item.blurb}</span>
        <span className="style-tags">
          {item.tags.map((tag) => (
            <span className="style-tag" key={tag}>
              {tag}
            </span>
          ))}
        </span>
      </span>
    </button>
  )
}

export function PickStyle() {
  const navigate = useNavigate()
  const { track, studio, editStudio } = useTrack()
  const [picked, setPicked] = useState(null)
  const [hover, setHover] = useState(null)
  const photos = useMemo(() => {
    const uploaded = (studio.images || []).filter((image) => image.url)
    return uploaded.length ? uploaded : demoImages()
  }, [studio.images])

  function openStudio() {
    if (!picked) return
    editStudio((current) => (current.style === picked ? current : { ...current, style: picked }))
    navigate('/studio')
  }

  return (
    <main className="screen-styles">
      <div className="screen-styles-inner">
        <h1>Pick a style</h1>
        <p className="lede">Choose a look for this visual.</p>
        <div className="style-grid">
          {STYLES.map((item) => (
            <StyleCard
              key={item.id}
              item={item}
              selected={picked === item.id}
              live={hover === item.id}
              track={track}
              studio={studio}
              photos={photos}
              onSelect={setPicked}
              onHover={setHover}
              onLeave={() => setHover((current) => (current === item.id ? null : current))}
            />
          ))}
        </div>
        <div className="actions style-actions">
          <Link className="text-link" to="/upload">
            Back
          </Link>
          <button type="button" className="button" disabled={!picked} onClick={openStudio}>
            Open in studio
          </button>
        </div>
      </div>
    </main>
  )
}
