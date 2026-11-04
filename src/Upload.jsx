import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SHORT_TRACK_MESSAGE, analyzeTrack } from './analyzeTrack.js'
import { RIGHTS_NOTE } from './screens.jsx'
import { useTrack } from './track.jsx'

function sectionStyle(section, duration) {
  const center = ((section.start + section.end) / 2 / duration) * 100
  let transform = 'translateX(-50%)'
  if (center < 8) transform = 'none'
  if (center > 92) transform = 'translateX(-100%)'
  return { left: `${center}%`, transform }
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 1.5v9l8-4.5-8-4.5z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 1.5h3v9H2zm5 0h3v9H7z" fill="currentColor" />
    </svg>
  )
}

export function Upload() {
  const { track, setTrack } = useTrack()
  const inputRef = useRef(null)
  const audioRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [audioUrl, setAudioUrl] = useState('')
  const [shown, setShown] = useState(track)
  const [closing, setClosing] = useState(false)
  const [debug, setDebug] = useState(false)
  const [beatNow, setBeatNow] = useState(0)
  const closeTimer = useRef(0)
  const trackRef = useRef(track)
  trackRef.current = track

  useEffect(() => {
    if (!track?.file) {
      setAudioUrl('')
      setPlaying(false)
      return undefined
    }
    const url = URL.createObjectURL(track.file)
    setAudioUrl(url)
    setPlaying(false)
    return () => URL.revokeObjectURL(url)
  }, [track?.file])

  useEffect(() => {
    if (!track) return undefined
    window.clearTimeout(closeTimer.current)
    setShown(track)
    setClosing(false)
    return undefined
  }, [track])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  useEffect(() => {
    function onKey(event) {
      if (event.key !== 'd' && event.key !== 'D') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return
      event.preventDefault()
      setDebug((open) => !open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!debug) return undefined
    let frame = 0
    const tick = () => {
      const time = audioRef.current?.currentTime || 0
      const bpm = shown?.bpm
      setBeatNow(bpm ? Math.floor((time * bpm) / 60) + 1 : 0)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [debug, shown?.bpm, playing])

  async function accept(file) {
    audioRef.current?.pause()
    setPlaying(false)
    window.clearTimeout(closeTimer.current)
    setTrack(null)
    setShown(null)
    setClosing(false)
    setError('')
    setStatus('loading')
    try {
      const analysis = await analyzeTrack(file)
      setTrack({ ...analysis, file })
      setStatus('ready')
    } catch (caught) {
      setTrack(null)
      setStatus('error')
      setError(caught instanceof Error ? caught.message : 'That file could not be read.')
    }
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play()
      setPlaying(true)
    } else {
      audio.pause()
      setPlaying(false)
    }
  }

  function removeTrack() {
    audioRef.current?.pause()
    setPlaying(false)
    setError('')
    setStatus('idle')
    setTrack(null)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setShown(null)
      setClosing(false)
      return
    }
    setClosing(true)
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      if (trackRef.current) return
      setShown(null)
      setClosing(false)
    }, 440)
  }

  function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) accept(file)
  }

  const busy = status === 'loading'

  return (
    <main className="upload">
      <div className="upload-inner">
        <h1>Add your track</h1>

        <section
          className={dragging ? 'drop dragging' : 'drop'}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false)
          }}
          onDrop={onDrop}
        >
          <h2>{track ? track.fileName : 'Drop an MP3 or WAV here'}</h2>
          {track ? null : (
            <p>{busy ? 'Analyzing your track…' : 'Up to 10 minutes · Analyzed on your device, never uploaded'}</p>
          )}
          {error && error !== SHORT_TRACK_MESSAGE ? (
            <p className="upload-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="drop-actions">
            {track ? (
              <button type="button" className="button-outline play-button" onClick={togglePlay} aria-pressed={playing}>
                {playing ? <PauseIcon /> : <PlayIcon />}
                {playing ? 'Pause' : 'Play'}
              </button>
            ) : null}
            {track ? (
              <button type="button" className="button-outline" onClick={removeTrack}>
                Remove
              </button>
            ) : (
              <button
                type="button"
                className="button-outline"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                Choose file
              </button>
            )}
          </div>
          {error === SHORT_TRACK_MESSAGE ? (
            <p className="upload-note" role="alert">
              {error}
            </p>
          ) : null}
          {audioUrl ? (
            <audio
              ref={audioRef}
              src={audioUrl}
              preload="auto"
              onEnded={() => setPlaying(false)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
          ) : null}
          <input
            ref={inputRef}
            className="file-input"
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav,audio/wave,audio/x-wav"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) accept(file)
              event.target.value = ''
            }}
          />
        </section>

        {shown ? (
          <div className={closing ? 'heard-slot closing' : 'heard-slot'}>
            <section className="heard" aria-live="polite" aria-hidden={closing}>
              <div className="heard-head">
                <strong>{shown.fileName}</strong>
                <span>Here's what we've heard</span>
              </div>
              <div className={playing ? 'wave playing' : 'wave'} aria-hidden="true">
                {shown.bars.map((level, index) => (
                  <span
                    key={index}
                    style={{
                      height: `${Math.max(6, level * 100)}%`,
                      '--i': index,
                    }}
                  />
                ))}
              </div>
              <div className="sections">
                {shown.sections.map((section) => (
                  <span key={`${section.start}-${section.label}`} style={sectionStyle(section, shown.duration)}>
                    {section.label}
                  </span>
                ))}
              </div>
              <div className="stats">
                <div className="stat">
                  <span>Tempo</span>
                  <strong>{shown.bpm == null ? '—' : shown.bpm}</strong>
                </div>
                <div className="stat">
                  <span>Energy</span>
                  <strong>{shown.energy}</strong>
                </div>
                <div className="stat">
                  <span>Mood</span>
                  <strong>{shown.mood}</strong>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {debug && shown ? (
          <aside className="debug-panel">
            <span>Beats</span>
            <strong>{shown.beats ?? '—'}</strong>
            <span>{playing ? `Now ${beatNow}` : 'Press play to count along'}</span>
          </aside>
        ) : null}

        <div className="upload-actions">
          <Link className="button-outline" to="/calibrate" state={{ revise: true }}>
            Back
          </Link>
          <Link className="button" to="/pick-a-style">
            Pick a style
          </Link>
        </div>
        <p className="rights-note">{RIGHTS_NOTE}</p>
      </div>
    </main>
  )
}
