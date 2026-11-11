import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { hasCalibration } from './calibrate.js'
import { beginIntroFlow } from './stepIntro.js'
import { useVisualSession } from './visualSession.jsx'

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
    </svg>
  )
}

function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 9.5h3.2L11 6.2v11.6L7.2 14.5H4zM14.2 8.4a4.2 4.2 0 0 1 0 7.2M16.8 6.2a7.2 7.2 0 0 1 0 11.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 9.5h3.2L11 6.2v11.6L7.2 14.5H4zM16 9l5 6M21 9l-5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LandingPlayer() {
  const videoRef = useRef(null)
  const dragging = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    video.muted = muted
    video.volume = volume
    return undefined
  }, [muted, volume])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    function tryPlay() {
      const play = video.play()
      if (!play) return
      play.catch(() => {
        video.muted = true
        setMuted(true)
        video.play().catch(() => {})
      })
    }

    if (video.readyState >= 2) tryPlay()
    else video.addEventListener('canplay', tryPlay, { once: true })
    return () => video.removeEventListener('canplay', tryPlay)
  }, [])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }

  function seek(next) {
    const video = videoRef.current
    if (!video || !video.duration) return
    video.currentTime = next * video.duration
    setProgress(next)
  }

  return (
    <div className="landing-player">
      <div className="landing-stage">
        <video
          ref={videoRef}
          src="/Halftone-ad.mp4?v=2"
          playsInline
          loop
          autoPlay
          preload="auto"
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={() => {
            const video = videoRef.current
            if (!video || dragging.current || !video.duration) return
            setProgress(video.currentTime / video.duration)
          }}
        />
      </div>
      <div className="landing-controls">
        <button
          type="button"
          className="landing-control-btn"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={togglePlay}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <input
          className="landing-slider landing-seek"
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={progress}
          aria-label="Video position"
          style={{ '--pct': `${progress * 100}%` }}
          onPointerDown={(event) => {
            dragging.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerUp={() => {
            dragging.current = false
          }}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <button
          type="button"
          className="landing-control-btn"
          aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
          onClick={() => {
            if (muted || volume === 0) {
              setMuted(false)
              if (volume === 0) setVolume(0.8)
            } else {
              setMuted(true)
            }
          }}
        >
          {muted || volume === 0 ? <MuteIcon /> : <VolumeIcon />}
        </button>
        <input
          className="landing-slider landing-volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={muted ? 0 : volume}
          aria-label="Volume"
          style={{ '--pct': `${(muted ? 0 : volume) * 100}%` }}
          onChange={(event) => {
            const next = Number(event.target.value)
            setVolume(next)
            setMuted(next === 0)
          }}
        />
      </div>
    </div>
  )
}

function Screen({ title, lede, action, to, back, backTo }) {
  return (
    <main className="screen">
      <div className="screen-inner">
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        <div className="actions">
          <Link className="button" to={to}>
            {action}
          </Link>
          {back ? (
            <Link className="text-link" to={backTo}>
              {back}
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  )
}

export const RIGHTS_NOTE =
  "Only upload music and images you own or have permission to use. You're responsible for what you create and share."

const LIQUID_MS = 620
const LIQUID_DROPS = [
  { dx: -40, dy: -16, size: 18 },
  { dx: 38, dy: -22, size: 16 },
  { dx: -24, dy: 20, size: 14 },
  { dx: 30, dy: 18, size: 15 },
  { dx: 6, dy: -30, size: 12 },
]

function LiquidStart({ to, onStart }) {
  const navigate = useNavigate()
  const wrapRef = useRef(null)
  const blobRef = useRef(null)
  const target = useRef({ x: 0.5, y: 0.5 })
  const pos = useRef({ x: 0.5, y: 0.5 })
  const hover = useRef(false)
  const [splashing, setSplashing] = useState(false)

  useEffect(() => {
    let raf = 0
    function tick() {
      pos.current.x += (target.current.x - pos.current.x) * 0.2
      pos.current.y += (target.current.y - pos.current.y) * 0.2
      const blob = blobRef.current
      if (blob) {
        const x = (pos.current.x - 0.5) * 52
        const y = (pos.current.y - 0.5) * 22
        const scale = hover.current || splashing ? 1.18 : 0.82
        blob.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [splashing])

  function pointFrom(event) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    target.current = {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  function go() {
    if (splashing) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    onStart?.()
    if (reduce) {
      navigate(to)
      return
    }
    setSplashing(true)
    window.setTimeout(() => navigate(to), LIQUID_MS)
  }

  return (
    <button
      ref={wrapRef}
      type="button"
      className={splashing ? 'liquid-start is-splash' : 'liquid-start'}
      onPointerEnter={(event) => {
        hover.current = true
        pointFrom(event)
      }}
      onPointerMove={pointFrom}
      onPointerLeave={() => {
        hover.current = false
        target.current = { x: 0.5, y: 0.5 }
      }}
      onClick={go}
    >
      <svg className="liquid-start-defs" width="0" height="0" aria-hidden="true">
        <defs>
          <filter id="liquid-start-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
          </filter>
        </defs>
      </svg>
      <span className="liquid-start-layer" aria-hidden="true">
        <span className="liquid-start-fill" />
        <span className="liquid-start-blob" ref={blobRef} />
        {splashing
          ? LIQUID_DROPS.map((drop, index) => (
              <span
                key={index}
                className="liquid-start-drop"
                style={{
                  width: drop.size,
                  height: drop.size,
                  '--dx': `${drop.dx}px`,
                  '--dy': `${drop.dy}px`,
                  animationDelay: `${index * 18}ms`,
                }}
              />
            ))
          : null}
      </span>
      <span className="liquid-start-label">Start now</span>
    </button>
  )
}

export function Landing() {
  const { beginNewVisual } = useVisualSession()
  return (
    <main className="screen-landing">
      <section className="landing-show">
        <LandingPlayer />
      </section>
      <section className="landing-copy">
        <LiquidStart
          to={hasCalibration() ? '/upload' : '/calibrate'}
          onStart={() => {
            beginNewVisual()
            beginIntroFlow(!hasCalibration())
          }}
        />
        <p className="landing-note">
          Halftone is a free tool for independent musicians. We help turn your songs into animated visualizers, Spotify
          Canvas loops, and cover art, with colors and styles you choose.
        </p>
        <p className="rights-note">{RIGHTS_NOTE}</p>
      </section>
    </main>
  )
}

export { PickStyle } from './StylePicker.jsx'

export { MyPalette } from './MyPalette.jsx'

export { HowItWorks } from './HowItWorks.jsx'

export function SendFeedback() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('idle')

  async function onSubmit(event) {
    event.preventDefault()
    const feedback = message.trim()
    if (!feedback || status === 'sending') return
    setStatus('sending')
    try {
      const response = await fetch('https://formsubmit.co/ajax/ahana.guin@gmail.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          _subject: 'Halftone feedback',
          _template: 'box',
          name: name.trim() || 'Anonymous',
          email: email.trim() || 'not provided',
          message: feedback,
        }),
      })
      if (!response.ok) throw new Error('send failed')
      setStatus('sent')
      setName('')
      setEmail('')
      setMessage('')
    } catch {
      setStatus('error')
    }
  }

  return (
    <main className="screen-feedback">
      <div className="screen-feedback-inner">
        <h1>Send feedback</h1>
        <p className="lede">Share what would make this better.</p>
        {status === 'sent' ? (
          <p className="feedback-thanks">Thanks — your note is in.</p>
        ) : (
          <form className="feedback-form" onSubmit={onSubmit}>
            <label>
              <span>Your feedback</span>
              <textarea
                name="message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                required
                rows={7}
              />
            </label>
            <label>
              <span>
                Name <em>optional</em>
              </span>
              <input
                type="text"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <span>
                Email <em>optional</em>
              </span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {status === 'error' ? (
              <p className="feedback-error">Couldn't send just now. Try again in a moment.</p>
            ) : null}
            <button className="button" type="submit" disabled={status === 'sending' || !message.trim()}>
              {status === 'sending' ? 'Sending' : 'Send'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
