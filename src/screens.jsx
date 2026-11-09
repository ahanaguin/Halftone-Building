import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { hasCalibration } from './calibrate.js'
import { beginIntroFlow } from './stepIntro.js'
import { useVisualSession } from './visualSession.jsx'
import { Wordmark } from './Wordmark.jsx'

function LandingAura() {
  return (
    <div className="landing-aura" aria-hidden="true">
      <span className="landing-wash landing-wash-a" />
      <span className="landing-wash landing-wash-b" />
      <span className="landing-wash landing-wash-c" />
      <span className="landing-wash landing-wash-d" />
    </div>
  )
}

function LandingTrail() {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const hero = canvas?.parentElement
    if (!canvas || !hero) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = canvas.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let width = 0
    let height = 0
    let gap = 20
    let cols = 0
    let rows = 0
    let ox = 0
    let oy = 0
    let cursor = null
    let raf = 0

    function resize() {
      const rect = hero.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      gap = Math.round(Math.max(16, Math.min(20, width / 80)))
      ox = gap * 0.5
      oy = gap * 0.5
      cols = Math.floor((width - ox) / gap) + 1
      rows = Math.floor((height - oy) / gap) + 1
      paint()
    }

    function point(event) {
      const rect = hero.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    function paint() {
      raf = 0
      ctx.clearRect(0, 0, width, height)
      if (!cursor) return
      const reach = gap * 3.2
      const reach2 = reach * reach
      const c0 = Math.max(0, Math.floor((cursor.x - ox - reach) / gap))
      const c1 = Math.min(cols - 1, Math.ceil((cursor.x - ox + reach) / gap))
      const r0 = Math.max(0, Math.floor((cursor.y - oy - reach) / gap))
      const r1 = Math.min(rows - 1, Math.ceil((cursor.y - oy + reach) / gap))
      ctx.fillStyle = '#fff'
      const radius = gap * 0.15
      for (let row = r0; row <= r1; row += 1) {
        for (let col = c0; col <= c1; col += 1) {
          const dx = ox + col * gap - cursor.x
          const dy = oy + row * gap - cursor.y
          const dist2 = dx * dx + dy * dy
          if (dist2 > reach2) continue
          const fall = 1 - Math.sqrt(dist2) / reach
          const strength = fall * fall
          if (strength < 0.04) continue
          ctx.globalAlpha = 0.12 + strength * 0.88
          ctx.beginPath()
          ctx.arc(ox + col * gap, oy + row * gap, radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }

    function onMove(event) {
      cursor = point(event)
      if (!raf) raf = requestAnimationFrame(paint)
    }

    function onLeave() {
      cursor = null
      if (!raf) raf = requestAnimationFrame(paint)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(hero)
    resize()
    hero.addEventListener('pointermove', onMove)
    hero.addEventListener('pointerleave', onLeave)

    return () => {
      observer.disconnect()
      hero.removeEventListener('pointermove', onMove)
      hero.removeEventListener('pointerleave', onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={ref} className="landing-trail" aria-hidden="true" />
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
  "Only upload music and images you own or have permission to use. You're responsible for what you create and share with Halftone."

export function Landing() {
  const { beginNewVisual } = useVisualSession()
  return (
    <main className="screen-landing">
      <section className="landing-hero">
        <LandingAura />
        <LandingTrail />
        <h1 className="wordmark-title">
          <Wordmark />
        </h1>
        <Link
          className="button landing-start"
          to={hasCalibration() ? '/upload' : '/calibrate'}
          onClick={() => {
            beginNewVisual()
            beginIntroFlow(!hasCalibration())
          }}
        >
          Start now
        </Link>
      </section>
      <section className="landing-copy">
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
