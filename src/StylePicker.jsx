import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTrack } from './track.jsx'

const STYLES = [
  {
    id: 'shapes',
    name: 'Liquid',
    tags: 'Free, Mirror, Quad, Radial',
    video: '/style-previews/liquid.mp4?v=3',
    poster: '/style-previews/liquid.jpg?v=3',
    fit: 'liquid',
  },
  {
    id: 'bloom',
    name: 'Bloom',
    tags: 'Full, Ring',
    video: '/style-previews/bloom.mp4?v=6',
    poster: '/style-previews/bloom.jpg?v=6',
    fit: 'wide',
  },
  {
    id: 'orb',
    name: 'Orb',
    tags: 'Sphere, Ring',
    video: '/style-previews/orb.mp4?v=6',
    poster: '/style-previews/orb.jpg?v=6',
    fit: 'wide',
  },
  {
    id: 'image',
    name: 'Image animation',
    tags: 'Halftone, Collage, Mosaic, Riso',
    video: '/style-previews/image.mp4?v=2',
    poster: '/style-previews/image.jpg?v=2',
    fit: 'image',
  },
]

function previewClass(fit) {
  if (fit === 'wide') return 'style-card-preview is-wide'
  if (fit === 'liquid') return 'style-card-preview is-wide is-liquid'
  if (fit === 'image') return 'style-card-preview is-wide is-image'
  return 'style-card-preview'
}

function StyleCard({ item, selected, live, onSelect, onHover, onLeave }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (live && !reduce) {
      video.currentTime = 0
      const play = video.play()
      if (play) play.catch(() => {})
      return () => {
        video.pause()
        video.currentTime = 0
      }
    }
    video.pause()
    video.currentTime = 0
    return undefined
  }, [live])

  return (
    <button
      type="button"
      className={selected ? 'style-card is-on' : 'style-card'}
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      onPointerEnter={() => onHover(item.id)}
      onPointerLeave={onLeave}
    >
      <span className={previewClass(item.fit)}>
        <video
          ref={videoRef}
          poster={item.poster}
          src={item.video}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
        />
      </span>
      <span className="style-card-copy">
        <strong>{item.name}</strong>
        <span className="style-tags">{item.tags}</span>
      </span>
    </button>
  )
}

export function PickStyle() {
  const navigate = useNavigate()
  const { editStudio } = useTrack()
  const [picked, setPicked] = useState(null)
  const [hover, setHover] = useState(null)

  function openStudio() {
    if (!picked) return
    editStudio((current) => (current.style === picked ? current : { ...current, style: picked }))
    navigate('/studio')
  }

  return (
    <main className="screen-styles">
      <div className="screen-styles-inner">
        <h1>Pick a style</h1>
        <p className="lede">
          Each style uses your palette and images from the calibration test. You can switch anytime in the studio.
        </p>
        <div className="style-grid">
          {STYLES.map((item) => (
            <StyleCard
              key={item.id}
              item={item}
              selected={picked === item.id}
              live={hover === item.id}
              onSelect={setPicked}
              onHover={setHover}
              onLeave={() => setHover((current) => (current === item.id ? null : current))}
            />
          ))}
        </div>
        <div className="actions style-actions">
          <Link className="button-outline" to="/upload">
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
