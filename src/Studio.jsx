import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { explainSection, paletteForSection } from './palette.js'
import { metricsAt, profileTrack, unit, windowFeatures } from './profileTrack.js'
import { mountShapes } from './shapesSketch.js'
import { useTrack } from './track.jsx'

const FORMATS = ['9:16', '1:1', '16:9']

function fitCanvas(format, maxWidth) {
  const ratio = format === '9:16' ? 9 / 16 : format === '1:1' ? 1 : 16 / 9
  const width = Math.max(160, Math.floor(maxWidth))
  return { w: width, h: Math.max(160, Math.round(width / ratio)) }
}

function sectionAt(sections, time) {
  if (!sections?.length) return null
  return sections.find((section) => time >= section.start && time < section.end) ?? sections[sections.length - 1]
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

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="11" width="12" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function Studio() {
  const { track, palette, setPalette } = useTrack()
  const [format, setFormat] = useState('16:9')
  const [section, setSection] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [audioUrl, setAudioUrl] = useState('')
  const [size, setSize] = useState({ w: 640, h: 360 })
  const slotRef = useRef(null)
  const holderRef = useRef(null)
  const audioRef = useRef(null)
  const waveRef = useRef(null)
  const playheadRef = useRef(null)
  const graphRef = useRef(null)
  const profileRef = useRef(track?.profile ?? null)
  const paletteRef = useRef(palette)
  const sizeRef = useRef(size)
  const liveRef = useRef({
    loud: 0.35,
    bass: 0.4,
    high: 0.25,
    harsh: 0.2,
    tempo: track?.bpm ?? 100,
    sectionKey: '',
    colors: palette.colors,
  })

  paletteRef.current = palette
  sizeRef.current = size
  if (track?.profile?.timeline) profileRef.current = track.profile

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
    setPalette((current) => {
      if (current?.source === 'custom') return current
      const next = paletteForSection(label)
      if (current?.source === 'default' && current.colors.join() === next.colors.join()) return current
      return { source: 'default', ...next }
    })
  }, [section, setPalette])

  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return undefined
    const measure = () => {
      const next = fitCanvas(format, slot.clientWidth)
      sizeRef.current = next
      setSize((current) => (current.w === next.w && current.h === next.h ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    return () => observer.disconnect()
  }, [format])

  useEffect(() => {
    if (!holderRef.current || !track) return undefined
    return mountShapes(holderRef.current, liveRef, sizeRef)
  }, [track])

  useEffect(() => {
    let frame = 0
    let lastTime = 0
    const tick = () => {
      const audio = audioRef.current
      const profile = profileRef.current
      if (audio && track?.duration) {
        const ratio = Math.min(1, Math.max(0, audio.currentTime / track.duration))
        if (playheadRef.current) playheadRef.current.style.left = `${ratio * 100}%`
        if (waveRef.current) waveRef.current.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
        const next = sectionAt(track.sections, audio.currentTime)
        setSection((current) => (current?.start === next?.start ? current : next))
        const colors = paletteRef.current.colors
        const tempo = track.bpm ?? 100
        const sectionKey = next ? `${next.start}:${next.label}` : ''
        const live = liveRef.current
        live.tempo = tempo
        live.sectionKey = sectionKey
        live.colors = colors
        const jumped = Math.abs(audio.currentTime - lastTime) > 0.35
        lastTime = audio.currentTime
        const graph = graphRef.current
        const snapped = metricsAt(profile, audio.currentTime)
        const playing = graph && profile && !audio.paused && !audio.ended
        if (snapped && (!playing || jumped)) Object.assign(live, snapped)
        if (playing && !jumped) {
          const time = new Float32Array(graph.analyser.fftSize)
          graph.analyser.getFloatTimeDomainData(time)
          const features = windowFeatures(time, graph.analyser.context.sampleRate)
          const blend = (key, value) => live[key] * 0.62 + value * 0.38
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

  const warmth = Math.round((1 - palette.warmth) * 100)
  const lightness = Math.round(palette.lightness * 100)

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
          {track ? (
            <div
              ref={holderRef}
              className="canvas-frame"
              style={{ height: size.h }}
              role="img"
              aria-label="Shapes reacting to the track"
            />
          ) : (
            <div className="canvas-frame canvas-empty" style={{ height: size.h }}>
              <p>Upload a track to see shapes.</p>
              <Link className="text-link" to="/upload">
                Go to upload
              </Link>
            </div>
          )}
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
                      key={`${item.start}-${item.label}`}
                      type="button"
                      className={selected ? 'section-chip selected' : 'section-chip'}
                      style={{ flex: Math.max(0.08, item.end - item.start) }}
                      onClick={() => {
                        if (audioRef.current) audioRef.current.currentTime = item.start
                      }}
                    >
                      {selected ? `${item.label} selected` : item.label}
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

      <aside className="studio-side">
        <p className="side-label">Style</p>
        <div className="style-value">Shapes</div>

        <p className="side-label">Palette</p>
        <div className="swatches">
          {palette.colors.map((color) => (
            <span key={color} className="swatch" style={{ background: color }} />
          ))}
          <button type="button" className="lock-button" aria-label="Lock" disabled>
            <LockIcon />
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
          disabled
          onChange={() => {}}
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
          disabled
          onChange={() => {}}
          aria-label="Dark to light"
        />

        <div className="redo">
          <p>{section ? `${section.label} selected` : 'Section'}</p>
          <button type="button" className="button-dashed" disabled>
            Redo this section
          </button>
        </div>
      </aside>
    </main>
  )
}
