import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  MAX_SWATCHES,
  applySectionPreset,
  artworkColor,
  explainSection,
  hexToRgb,
  paletteColors,
  paletteForSection,
  rgbToHsl,
  shiftUnlocked,
  swatchHex,
} from './palette.js'
import { metricsAt, profileTrack, unit, windowFeatures } from './profileTrack.js'
import { sectionAt, sectionKey, sectionSeed } from './shapeLayout.js'
import { mountShapes } from './shapesSketch.js'
import { useTrack } from './track.jsx'

const FORMATS = ['9:16', '1:1', '16:9']
const STYLES = [
  { id: 'shapes', label: 'Shapes', ready: true },
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
  const { track, studio, editStudio, syncStudio, commitStudio } = useTrack()
  const [format, setFormat] = useState('16:9')
  const [section, setSection] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [audioUrl, setAudioUrl] = useState('')
  const [size, setSize] = useState({ w: 640, h: 360, frame: 420 })
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
    background: artworkColor(paletteColors(studio.palette)),
    groups: studio.calibration?.groups ?? null,
    references: studio.calibration?.references ?? [],
    sectionLabel: '',
  })

  studioRef.current = studio
  sizeRef.current = size
  if (track?.profile?.timeline) profileRef.current = track.profile

  const colors = paletteColors(studio.palette)
  const artwork = artworkColor(colors)
  const activeKey = section ? sectionKey(section) : ''
  liveRef.current = {
    ...liveRef.current,
    tempo: track?.bpm ?? liveRef.current.tempo ?? 100,
    colors,
    background: artwork,
    roundness: studio.roundness,
    seed: studio.seeds[activeKey] ?? liveRef.current.seed,
    groups: studio.calibration?.groups ?? null,
    references: studio.calibration?.references ?? [],
    sectionLabel: section?.label || '',
  }

  useEffect(() => {
    if (!track?.file) {
      setAudioUrl('')
      setSection(null)
      return undefined
    }
    const url = URL.createObjectURL(track.file)
    setAudioUrl(url)
    setSection(track.sections?.[0] ?? null)
    return () => URL.revokeObjectURL(url)
  }, [track])

  useEffect(() => {
    if (!track?.sections?.length) return
    syncStudio((current) => {
      let changed = false
      const seeds = { ...current.seeds }
      track.sections.forEach((item, index) => {
        const key = sectionKey(item)
        if (seeds[key] == null) {
          seeds[key] = sectionSeed(item, index)
          changed = true
        }
      })
      return changed ? { ...current, seeds } : current
    })
  }, [track, syncStudio])

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
    const label = section?.label
    if (!label) return
    syncStudio((current) => {
      if (current.palette.source === 'custom') return current
      const palette = applySectionPreset(current.palette, paletteForSection(label))
      return palette === current.palette ? current : { ...current, palette }
    })
  }, [section, syncStudio])

  useEffect(() => {
    const slot = slotRef.current
    const side = sideRef.current
    if (!slot || !side) return undefined
    const measure = () => {
      const boxWidth = slot.clientWidth
      const boxHeight = side.offsetHeight
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
        const next = sectionAt(currentTrack.sections, audio.currentTime)
        setSection((current) => (current?.start === next?.start ? current : next))
        const studioNow = studioRef.current
        const key = next ? sectionKey(next) : ''
        const paletteColorsNow = paletteColors(studioNow.palette)
        const live = liveRef.current
        live.tempo = currentTrack.bpm ?? 100
        live.time = audio.currentTime
        live.colors = paletteColorsNow
        live.background = artworkColor(paletteColorsNow)
        live.roundness = studioNow.roundness
        live.seed = studioNow.seeds[key] ?? 1
        live.groups = studioNow.calibration?.groups ?? null
        live.references = studioNow.calibration?.references ?? []
        live.sectionLabel = next?.label || ''
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

  function onWarmth(event) {
    const warmth = 1 - Number(event.target.value) / 100
    paintPalette((palette) => {
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
    paintPalette((palette) => {
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
    const apply = (current) => (current.roundness === roundness ? current : { ...current, roundness })
    if (slideOrigin.current) syncStudio(apply)
    else editStudio(apply)
  }

  function onPick(id, hex) {
    const [red, green, blue] = hexToRgb(hex)
    const [h, s, l] = rgbToHsl(red, green, blue)
    const apply = (current) => ({
      ...current,
      palette: {
        ...current.palette,
        source: 'custom',
        swatches: current.palette.swatches.map((swatch) => (swatch.id === id ? { ...swatch, h, s, l } : swatch)),
      },
    })
    if (slideOrigin.current) syncStudio(apply)
    else editStudio(apply)
  }

  function onAddColor() {
    editStudio((current) => {
      const swatches = current.palette.swatches
      if (swatches.length >= MAX_SWATCHES) return current
      const last = swatches[swatches.length - 1]
      return {
        ...current,
        palette: {
          ...current.palette,
          source: 'custom',
          swatches: [
            ...swatches,
            {
              id: `swatch-add-${Date.now().toString(36)}-${swatches.length}`,
              h: (last.h + 46) % 360,
              s: Math.min(0.9, Math.max(0.35, last.s)),
              l: last.l,
              locked: false,
            },
          ],
        },
      }
    })
  }

  function onStyle(event) {
    const style = event.target.value
    if (!STYLES.find((item) => item.id === style)?.ready) return
    editStudio((current) => (current.style === style ? current : { ...current, style }))
  }

  function redoSection() {
    if (!section) return
    const key = sectionKey(section)
    editStudio((current) => ({
      ...current,
      seeds: { ...current.seeds, [key]: (Math.random() * 0x100000000) >>> 0 },
    }))
  }

  const warmth = Math.round((1 - studio.palette.warmth) * 100)
  const lightness = Math.round(studio.palette.lightness * 100)
  const spiky = Math.round((1 - studio.roundness) * 100)
  const shapesOn = studio.style === 'shapes'

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
          <div className="canvas-frame" style={{ height: size.frame }}>
            <div
              ref={holderRef}
              className="canvas-stage"
              style={{ width: size.w, height: size.h, background: artwork }}
              role={track && shapesOn ? 'img' : undefined}
              aria-label={track && shapesOn ? 'Shapes reacting to the track' : undefined}
            />
            {track && shapesOn ? null : (
              <div className="canvas-empty">
                {track ? <p>Coming soon</p> : <p>Upload a track to see shapes.</p>}
                {track ? null : (
                  <Link className="text-link" to="/upload">
                    Go to upload
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="why">
          <strong>Why it looks like this</strong>
          <p>{explainSection(section?.label)}</p>
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
                <div className="wave studio-wave">
                  {track.bars.map((level, index) => (
                    <span key={index} style={{ height: `${Math.max(8, level * 100)}%` }} />
                  ))}
                </div>
                <div className="playhead" ref={playheadRef} />
              </div>
              <div className="section-row">
                {track.sections.map((item) => {
                  const selected = section?.start === item.start
                  return (
                    <button
                      key={sectionKey(item)}
                      type="button"
                      className={selected ? 'section-chip selected' : 'section-chip'}
                      style={{ flex: Math.max(0.08, item.end - item.start) }}
                      aria-pressed={selected}
                      onClick={() => {
                        setSection(item)
                        if (audioRef.current) audioRef.current.currentTime = item.start
                      }}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
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

        <p className="side-label">Palette</p>
        <div className="swatches">
          {studio.palette.swatches.map((swatch, index) => {
            const hex = swatchHex(swatch)
            return (
              <div className="swatch-item" key={swatch.id}>
                <label className="swatch" style={{ background: hex }}>
                  <input
                    type="color"
                    value={hex}
                    aria-label={`Color ${index + 1}`}
                    onFocus={startSlide}
                    onBlur={finishSlide}
                    onChange={(event) => onPick(swatch.id, event.target.value)}
                  />
                </label>
              </div>
            )
          })}
          <button
            type="button"
            className="add-swatch"
            aria-label="Add a color"
            disabled={studio.palette.swatches.length >= MAX_SWATCHES}
            onClick={onAddColor}
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

        <div className="redo">
          <p>{section ? `${section.label} selected` : 'Section'}</p>
          <button type="button" className="button-redo" disabled={!section} onClick={redoSection}>
            Redo this section
          </button>
        </div>
      </aside>
    </main>
  )
}
