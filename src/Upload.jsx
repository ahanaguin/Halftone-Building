import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { analyzeTrack } from './analyzeTrack.js'
import { useTrack } from './track.jsx'

function sectionStyle(section, duration) {
  const center = ((section.start + section.end) / 2 / duration) * 100
  let transform = 'translateX(-50%)'
  if (center < 8) transform = 'none'
  if (center > 92) transform = 'translateX(-100%)'
  return { left: `${center}%`, transform }
}

export function Upload() {
  const { track, setTrack } = useTrack()
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  async function accept(file) {
    setTrack(null)
    setError('')
    setStatus('loading')
    try {
      const analysis = await analyzeTrack(file)
      setTrack(analysis)
      setStatus('ready')
    } catch (caught) {
      setTrack(null)
      setStatus('error')
      setError(caught instanceof Error ? caught.message : 'That file could not be read.')
    }
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
          <h2>Drop an MP3 or WAV here</h2>
          <p>
            {busy
              ? 'Analyzing your track…'
              : 'Up to 10 minutes · Analyzed on your device, never uploaded'}
          </p>
          {error ? (
            <p className="upload-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="button-outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </button>
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

        {track ? (
          <section className="heard" aria-live="polite">
            <div className="heard-head">
              <strong>{track.fileName}</strong>
              <span>Here's what we've heard</span>
            </div>
            <div className="wave" aria-hidden="true">
              {track.bars.map((level, index) => (
                <span key={index} style={{ height: `${Math.max(6, level * 100)}%` }} />
              ))}
            </div>
            <div className="sections">
              {track.sections.map((section) => (
                <span key={`${section.start}-${section.label}`} style={sectionStyle(section, track.duration)}>
                  {section.label}
                </span>
              ))}
            </div>
            <div className="stats">
              <div className="stat">
                <span>Tempo</span>
                <strong>{track.bpm == null ? '—' : track.bpm}</strong>
              </div>
              <div className="stat">
                <span>Energy</span>
                <strong>{track.energy}</strong>
              </div>
              <div className="stat">
                <span>Mood</span>
                <strong>{track.mood}</strong>
              </div>
            </div>
          </section>
        ) : null}

        <div className="upload-actions">
          <Link className="button-outline" to="/calibrate">
            Back
          </Link>
          <Link className="button" to="/pick-a-style">
            Pick a style
          </Link>
        </div>
      </div>
    </main>
  )
}
