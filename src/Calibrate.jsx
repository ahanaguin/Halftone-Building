import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  CALIBRATION_COLORS,
  SEQUENCE,
  colorsFromImages,
  colorsSoFar,
  describePick,
  hasCalibration,
  paletteFromCalibration,
  resultFromAnswers,
  saveCalibration,
  soundSrc,
} from './calibrate.js'
import { useTrack } from './track.jsx'

const SHAPES = [
  { id: 'round', label: 'Round' },
  { id: 'between', label: 'In-between' },
  { id: 'spiky', label: 'Spiky' },
]

const TEXTURES = [
  { id: 'smooth', label: 'Smooth' },
  { id: 'grainy', label: 'Grainy' },
]

function PlayIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.2 1.4v9.2L10.4 6 3.2 1.4z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.2 1.4h2.6v9.2H2.2zm5 0h2.6v9.2H7.2z" fill="currentColor" />
    </svg>
  )
}

export function Calibrate() {
  const navigate = useNavigate()
  const { replaceStudio, setCalibrateChrome, registerCalibrateSkip } = useTrack()
  const [phase, setPhase] = useState('intro')
  const [ready, setReady] = useState(false)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [extraColors, setExtraColors] = useState([])
  const [images, setImages] = useState([])
  const [previews, setPreviews] = useState([])
  const [references, setReferences] = useState([])
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef(null)
  const imageRef = useRef(null)
  const colorRef = useRef(null)

  const sound = SEQUENCE[index]
  const pick = answers[sound.id] || {}
  const readyPick = Boolean(pick.color && pick.shape && pick.texture)

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 650)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const urls = images.map((file) => URL.createObjectURL(file))
    setPreviews(urls)
    let cancel = false
    if (images.length) {
      colorsFromImages(images)
        .then((colors) => {
          if (!cancel) setReferences(colors)
        })
        .catch(() => {
          if (!cancel) setReferences([])
        })
    } else {
      setReferences([])
    }
    return () => {
      cancel = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [images])

  function playAt(nextIndex) {
    const audio = audioRef.current
    if (!audio) return
    audio.src = soundSrc(SEQUENCE[nextIndex])
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  function skip() {
    audioRef.current?.pause()
    saveCalibration({ skipped: true })
    navigate('/upload')
  }

  useEffect(() => {
    registerCalibrateSkip(skip)
    return () => registerCalibrateSkip(null)
  })

  useEffect(() => {
    if (phase !== 'questions') {
      setCalibrateChrome(null)
      return undefined
    }
    setCalibrateChrome({
      label: `Sound ${index + 1} of ${SEQUENCE.length}`,
      progress: (index + 1) / SEQUENCE.length,
    })
    return () => setCalibrateChrome(null)
  }, [phase, index, setCalibrateChrome])

  if (hasCalibration()) return <Navigate to="/upload" replace />

  function begin() {
    if (!ready) return
    setPhase('questions')
    setIndex(0)
    playAt(0)
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.paused && !audio.ended) {
      audio.pause()
      setPlaying(false)
      return
    }
    if (!audio.src) playAt(index)
    else audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  function choose(field, value) {
    setAnswers((current) => ({
      ...current,
      [sound.id]: { ...current[sound.id], [field]: value },
    }))
  }

  function back() {
    if (index === 0) {
      audioRef.current?.pause()
      setPlaying(false)
      setPhase('intro')
      return
    }
    const nextIndex = index - 1
    setIndex(nextIndex)
    playAt(nextIndex)
  }

  function finish(nextAnswers) {
    audioRef.current?.pause()
    const result = resultFromAnswers(nextAnswers, references)
    saveCalibration(result)
    replaceStudio({
      style: 'shapes',
      roundness: result.roundness,
      seeds: {},
      palette: paletteFromCalibration(result),
      calibration: result,
    })
    navigate('/upload')
  }

  function next() {
    if (!readyPick) return
    if (index === SEQUENCE.length - 1) {
      finish(answers)
      return
    }
    const nextIndex = index + 1
    setIndex(nextIndex)
    playAt(nextIndex)
  }

  function onImages(event) {
    const picked = [...(event.target.files || [])]
    if (!picked.length) return
    setImages((current) => [...current, ...picked].slice(0, 5))
    event.target.value = ''
  }

  function addCustomColor(event) {
    const value = event.target.value
    setExtraColors((current) => (current.some((color) => color.toLowerCase() === value.toLowerCase()) ? current : [...current, value]))
    choose('color', value)
  }

  const palette = colorsSoFar(answers, references)
  const lowNote = describePick(answers['01-pitch-low'])
  const highNote = describePick(answers['03-pitch-high'])
  const choices = [...CALIBRATION_COLORS, ...extraColors]

  return (
    <main className={phase === 'intro' ? 'calibrate calibrate-intro' : 'calibrate'}>
      {phase === 'intro' ? (
        <div className="cal-intro">
          <p className="cal-kicker">Step 1 of 4</p>
          <h1>Calibrate</h1>
          <p>
            Pick a color, shape, and texture for 15 short sounds. Takes about 3 minutes, we're trying to get to know
            the way you see things. There are no wrong answers, be imaginative.
          </p>
          <div className="step-bars" aria-hidden="true">
            <span className="fill" />
            <span />
            <span />
            <span />
          </div>
          <button type="button" className="button" onClick={begin} disabled={!ready}>
            Begin
          </button>
        </div>
      ) : (
        <div className="cal-questions">
          <section className="cal-main">
            <div className="cal-head">
              <button type="button" className="cal-play" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <div>
                <h1>{sound.title}</h1>
                <p>What does this sound look like to you?</p>
              </div>
            </div>

            <p className="cal-label">Color</p>
            <div className="cal-colors">
              {choices.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={pick.color?.toLowerCase() === color.toLowerCase() ? 'cal-dot selected' : 'cal-dot'}
                  style={{ background: color }}
                  aria-label={color}
                  aria-pressed={pick.color?.toLowerCase() === color.toLowerCase()}
                  onClick={() => choose('color', color)}
                />
              ))}
              <button type="button" className="cal-dot cal-add" aria-label="Add a color" onClick={() => colorRef.current?.click()}>
                +
              </button>
              <input ref={colorRef} className="file-input" type="color" onChange={addCustomColor} />
            </div>

            <div className="cal-groups">
              <div>
                <p className="cal-label">Shape</p>
                <div className="cal-pills">
                  {SHAPES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={pick.shape === item.id ? 'cal-pill selected' : 'cal-pill'}
                      aria-pressed={pick.shape === item.id}
                      onClick={() => choose('shape', item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="cal-label">Texture</p>
                <div className="cal-pills">
                  {TEXTURES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={pick.texture === item.id ? 'cal-pill selected' : 'cal-pill'}
                      aria-pressed={pick.texture === item.id}
                      onClick={() => choose('texture', item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="cal-nav">
              <button type="button" className="button-outline" onClick={back}>
                Back
              </button>
              <button type="button" className="button" onClick={next} disabled={!readyPick}>
                Next sound
              </button>
            </div>
          </section>

          <aside className="cal-card">
            <h2>Your palette so far</h2>
            <div className="cal-swatches">
              {palette.map((color) => (
                <span key={color} className="cal-swatch" style={{ background: color }} />
              ))}
            </div>
            {lowNote ? <p className="cal-note">Low sounds: {lowNote}</p> : null}
            {highNote ? <p className="cal-note">High sounds: {highNote}</p> : null}

            <div className="cal-refs">
              {previews.length ? (
                <div className="cal-thumbs">
                  {previews.map((url) => (
                    <img key={url} src={url} alt="" />
                  ))}
                </div>
              ) : null}
              <p>Optional: add 3 to 5 covers or images you love. We'll pull the main colors from them.</p>
              <button
                type="button"
                className="button-dashed cal-image-button"
                onClick={() => imageRef.current?.click()}
                disabled={images.length >= 5}
              >
                Add reference images
              </button>
              <input
                ref={imageRef}
                className="file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                onChange={onImages}
              />
            </div>
          </aside>
        </div>
      )}
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </main>
  )
}
