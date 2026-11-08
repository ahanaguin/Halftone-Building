import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  CALIBRATION_COLORS,
  SEQUENCE,
  colorsFromImages,
  colorsSoFar,
  describePick,
  loadCalibration,
  paletteFromCalibration,
  resultFromAnswers,
  saveCalibration,
  soundSrc,
} from './calibrate.js'
import { StepIntro } from './StepIntro.jsx'
import { hasSeenIntro, shouldShowStepIntro } from './stepIntro.js'
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

function sameColor(left, right) {
  return (left || '').toLowerCase() === (right || '').toLowerCase()
}

function customColors(answers) {
  const extras = []
  for (const answer of Object.values(answers || {})) {
    const color = answer?.color
    if (!color || CALIBRATION_COLORS.some((preset) => sameColor(preset, color))) continue
    if (extras.some((item) => sameColor(item, color))) continue
    extras.push(color)
  }
  return extras
}

export function Calibrate() {
  const navigate = useNavigate()
  const location = useLocation()
  const saved = useRef(loadCalibration())
  const { replaceStudio, setCalibrateChrome, registerCalibrateSkip } = useTrack()
  const [phase, setPhase] = useState(() => {
    if (location.state?.revise && saved.current?.answers) return 'questions'
    return shouldShowStepIntro('calibrate', location) ? 'intro' : 'questions'
  })
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState(() => saved.current?.answers || {})
  const [extraColors, setExtraColors] = useState(() => customColors(saved.current?.answers))
  const [images, setImages] = useState([])
  const [previews, setPreviews] = useState([])
  const [references, setReferences] = useState(() => saved.current?.references || [])
  const [dismissed, setDismissed] = useState([])
  const [playing, setPlaying] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draftColor, setDraftColor] = useState(CALIBRATION_COLORS[0])
  const audioRef = useRef(null)
  const imageRef = useRef(null)
  const hadImages = useRef(false)

  const sound = SEQUENCE[index]
  const pick = answers[sound.id] || {}
  const readyPick = Boolean(pick.color && pick.shape && pick.texture)

  useEffect(() => {
    const urls = images.map((file) => URL.createObjectURL(file))
    setPreviews(urls)
    if (!images.length) {
      if (hadImages.current) setReferences([])
      return () => urls.forEach((url) => URL.revokeObjectURL(url))
    }
    hadImages.current = true
    let cancel = false
    colorsFromImages(images)
      .then((colors) => {
        if (!cancel) setReferences(colors)
      })
      .catch(() => {
        if (!cancel) setReferences([])
      })
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

  function begin() {
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
    const keptReferences = references.filter((color) => !dismissed.some((item) => sameColor(item, color)))
    const result = resultFromAnswers(nextAnswers, keptReferences)
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

  function toggleColor(color) {
    if (pick.color && sameColor(pick.color, color)) {
      setAnswers((current) => ({
        ...current,
        [sound.id]: { ...current[sound.id], color: undefined },
      }))
      return
    }
    setDismissed((current) => current.filter((item) => !sameColor(item, color)))
    choose('color', color)
  }

  function confirmColor() {
    const value = draftColor
    setDismissed((current) => current.filter((item) => !sameColor(item, value)))
    if (!CALIBRATION_COLORS.some((color) => sameColor(color, value))) {
      setExtraColors((current) => (current.some((color) => sameColor(color, value)) ? current : [...current, value]))
    }
    choose('color', value)
    setPickerOpen(false)
  }

  function removeColor(color) {
    setDismissed((current) => (current.some((item) => sameColor(item, color)) ? current : [...current, color]))
    setAnswers((current) => {
      const next = {}
      for (const [id, answer] of Object.entries(current)) {
        next[id] = answer?.color && sameColor(answer.color, color) ? { ...answer, color: undefined } : answer
      }
      return next
    })
    setReferences((current) => current.filter((item) => !sameColor(item, color)))
    setExtraColors((current) => current.filter((item) => !sameColor(item, color)))
  }

  const palette = colorsSoFar(answers, references).filter((color) => !dismissed.some((item) => sameColor(item, color)))
  const lowNote = describePick(answers['01-pitch-low'])
  const highNote = describePick(answers['03-pitch-high'])
  const choices = [...CALIBRATION_COLORS, ...extraColors]

  return (
    <>
      {phase === 'intro' ? (
        <StepIntro id="calibrate" replay={hasSeenIntro('calibrate')} onFinished={begin} />
      ) : (
    <main className="calibrate">
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
              {choices.map((color) => {
                const selected = Boolean(pick.color && sameColor(pick.color, color))
                return (
                  <button
                    key={color}
                    type="button"
                    className={selected ? 'cal-dot selected' : 'cal-dot'}
                    style={{ background: color }}
                    aria-label={selected ? `Deselect ${color}` : color}
                    aria-pressed={selected}
                    onClick={() => toggleColor(color)}
                  />
                )
              })}
              <button
                type="button"
                className="cal-dot cal-add"
                aria-label="Add a color"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((open) => !open)}
              >
                +
              </button>
              {pickerOpen ? (
                <div className="cal-picker" role="dialog" aria-label="Choose a color">
                  <input
                    type="color"
                    value={draftColor}
                    aria-label="Color draft"
                    onChange={(event) => setDraftColor(event.target.value)}
                  />
                  <button type="button" className="button-outline" onClick={() => setPickerOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="button" onClick={confirmColor}>
                    OK
                  </button>
                </div>
              ) : null}
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
                <span key={color} className="cal-swatch-wrap">
                  <span className="cal-swatch" style={{ background: color }} />
                  <button type="button" className="cal-swatch-x" aria-label={`Remove ${color}`} onClick={() => removeColor(color)}>
                    ×
                  </button>
                </span>
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
    </main>
      )}
      <audio
        ref={audioRef}
        hidden
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </>
  )
}
