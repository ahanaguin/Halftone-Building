import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CALIBRATION_COLORS,
  CALIBRATION_SOUNDS,
  ROLE_SWATCHES,
  colorsFromImages,
  fillCalibration,
  filledGroups,
  loadCalibration,
  paletteFromCalibration,
  resultFromAnswers,
  saveCalibration,
  soundSrc,
} from './calibrate.js'
import { listPaletteImages, recordsToFiles, replacePaletteImages } from './paletteImages.js'
import { paletteColors } from './palette.js'
import { INK_BLACK, isHex } from './shapeLayout.js'
import { mountShapes } from './shapesSketch.js'
import { useVisualSession } from './visualSession.jsx'

const SHAPES = [
  { id: 'round', label: 'Round' },
  { id: 'between', label: 'In between' },
  { id: 'spiky', label: 'Spiky' },
]

const TEXTURES = [
  { id: 'smooth', label: 'Smooth' },
  { id: 'grainy', label: 'Grainy' },
]

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

function ShapeMark({ shape }) {
  if (shape === 'spiky') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 1.4 9.6 5.7 14.2 6 10.7 9.1 11.8 13.6 8 11.3 4.2 13.6 5.3 9.1 1.8 6 6.4 5.7Z"
          fill="currentColor"
        />
      </svg>
    )
  }
  if (shape === 'between') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="3.2" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.1" fill="currentColor" />
    </svg>
  )
}

function TextureMark({ texture }) {
  if (texture === 'grainy') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="6.1" cy="6.4" r="0.85" fill="currentColor" />
        <circle cx="9.6" cy="6.8" r="0.7" fill="currentColor" />
        <circle cx="7.4" cy="9.4" r="0.75" fill="currentColor" />
        <circle cx="10.2" cy="10" r="0.65" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.1" fill="currentColor" />
    </svg>
  )
}

function placePicker(anchor) {
  const rect = anchor.getBoundingClientRect()
  const width = 232
  const height = 280
  let left = rect.right + 12
  if (left + width > window.innerWidth - 12) left = Math.max(12, rect.left - width - 12)
  let top = Math.min(window.innerHeight - height - 12, Math.max(12, rect.top))
  return { left, top }
}

function PaletteLivePreview({ colors, roundness }) {
  const hostRef = useRef(null)
  const liveRef = useRef({
    time: 8,
    seed: 7,
    loud: 0.34,
    bass: 0.38,
    high: 0.22,
    tempo: 100,
    roundness,
    colors,
    sectionLabel: 'Quiet',
    background: INK_BLACK,
    shine: true,
    style: 'shapes',
    playing: true,
  })
  const sizeRef = useRef({ w: 220, h: 390 })

  liveRef.current.colors = colors
  liveRef.current.roundness = roundness

  useEffect(() => {
    const node = hostRef.current
    if (!node) return undefined
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const origin = performance.now() / 1000
    Object.defineProperty(liveRef.current, 'time', {
      configurable: true,
      get() {
        return reduced ? 8 : 8 + (performance.now() / 1000 - origin)
      },
    })
    function resize() {
      const rect = node.getBoundingClientRect()
      sizeRef.current = { w: Math.max(10, Math.round(rect.width)), h: Math.max(10, Math.round(rect.height)) }
    }
    resize()
    const unmount = mountShapes(node, liveRef, sizeRef)
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    return () => {
      observer.disconnect()
      unmount()
    }
  }, [])

  return <div ref={hostRef} className="palette-preview" aria-hidden="true" />
}

function Confirm({ title, body, confirm, onConfirm, onClose }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="library-modal" role="presentation" onClick={onClose}>
      <div
        className="library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="palette-dialog-title">{title}</h2>
        <p>{body}</p>
        <div className="library-dialog-actions">
          <button type="button" className="button-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MyPalette() {
  const navigate = useNavigate()
  const { beginNewVisual } = useVisualSession()
  const [saved, setSaved] = useState(() => loadCalibration())
  const [images, setImages] = useState([])
  const [thumbs, setThumbs] = useState([])
  const [playingId, setPlayingId] = useState('')
  const [editor, setEditor] = useState(null)
  const [picker, setPicker] = useState(null)
  const [ask, setAsk] = useState(null)
  const [extraColors, setExtraColors] = useState(() => customColors(loadCalibration()?.answers))
  const audioRef = useRef(null)
  const imageRef = useRef(null)
  const pickerRef = useRef(null)
  const editorRef = useRef(null)

  const answers = saved?.answers || {}
  const references = saved?.references || []
  const groups = filledGroups(saved)
  const draft = picker?.draft

  const palette = useMemo(() => {
    const nextGroups = { ...groups }
    const nextRefs = references.slice()
    if (draft?.kind === 'role' && isHex(draft.hex)) nextGroups[draft.key] = draft.hex
    if (draft?.kind === 'reference' && isHex(draft.hex) && nextRefs[draft.index] != null) nextRefs[draft.index] = draft.hex
    if (draft?.kind === 'answer' && isHex(draft.hex) && editor) {
      const result = fillCalibration(
        resultFromAnswers({ ...answers, [editor]: { ...answers[editor], color: draft.hex } }, nextRefs),
        saved,
      )
      return paletteFromCalibration(result)
    }
    return paletteFromCalibration({ groups: nextGroups, references: nextRefs })
  }, [answers, draft, editor, groups, references, saved])

  const colors = paletteColors(palette)
  const roundness = saved?.roundness ?? 0.7
  const pick = editor ? answers[editor] || {} : {}
  const choices = [...CALIBRATION_COLORS, ...extraColors]

  useEffect(() => {
    let cancel = false
    listPaletteImages()
      .then((records) => {
        if (!cancel) setImages(records)
      })
      .catch(() => {
        if (!cancel) setImages([])
      })
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    const urls = images.map((item) => URL.createObjectURL(item.blob || item))
    setThumbs(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [images])

  useEffect(() => {
    if (!picker && !editor) return undefined
    function onPointerDown(event) {
      if (pickerRef.current?.contains(event.target)) return
      if (picker) {
        setPicker(null)
        return
      }
      if (editorRef.current?.contains(event.target)) return
      setEditor(null)
    }
    function onKey(event) {
      if (event.key !== 'Escape') return
      if (picker) setPicker(null)
      else setEditor(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [picker, editor])

  function persist(next) {
    saveCalibration(next)
    setSaved(next)
  }

  function commitAnswers(nextAnswers, nextReferences = references) {
    persist(fillCalibration(resultFromAnswers(nextAnswers, nextReferences), saved))
  }

  function openPicker(event, next) {
    event.stopPropagation()
    setPicker({ ...next, ...placePicker(event.currentTarget), draft: next })
  }

  function closePicker() {
    setPicker(null)
  }

  function onPickerHex(hex) {
    setPicker((current) => (current ? { ...current, hex, draft: { ...current.draft, hex } } : current))
  }

  function savePicker(event) {
    event.preventDefault()
    if (!picker || !isHex(picker.hex)) return
    const hex = picker.hex
    if (picker.kind === 'role') {
      const role = ROLE_SWATCHES.find((item) => item.key === picker.key)
      const nextAnswers = {
        ...answers,
        [role.soundId]: { ...answers[role.soundId], color: hex },
      }
      commitAnswers(nextAnswers)
    } else if (picker.kind === 'reference') {
      const nextRefs = references.slice()
      nextRefs[picker.index] = hex
      commitAnswers(answers, nextRefs)
    } else if (picker.kind === 'answer' && editor) {
      if (!CALIBRATION_COLORS.some((color) => sameColor(color, hex))) {
        setExtraColors((current) => (current.some((color) => sameColor(color, hex)) ? current : [...current, hex]))
      }
      commitAnswers({ ...answers, [editor]: { ...answers[editor], color: hex } })
    }
    closePicker()
  }

  function chooseAnswer(field, value) {
    if (!editor) return
    commitAnswers({ ...answers, [editor]: { ...answers[editor], [field]: value } })
  }

  function togglePlay(event, sound) {
    event.stopPropagation()
    const audio = audioRef.current
    if (!audio) return
    if (playingId === sound.id && !audio.paused) {
      audio.pause()
      setPlayingId('')
      return
    }
    audio.src = soundSrc(sound)
    audio.play().then(() => setPlayingId(sound.id)).catch(() => setPlayingId(''))
  }

  async function onImages(event) {
    const picked = [...(event.target.files || [])]
    event.target.value = ''
    if (!picked.length) return
    const nextFiles = [...recordsToFiles(images), ...picked].slice(0, 5)
    try {
      await replacePaletteImages(nextFiles)
      const records = await listPaletteImages()
      setImages(records)
      const colorsFromFiles = await colorsFromImages(nextFiles)
      commitAnswers(answers, colorsFromFiles)
    } catch {
      /* keep the current images if storage fails */
    }
  }

  async function removeImage(id) {
    const nextFiles = recordsToFiles(images.filter((item) => item.id !== id))
    try {
      await replacePaletteImages(nextFiles)
      const records = await listPaletteImages()
      setImages(records)
      const colorsFromFiles = nextFiles.length ? await colorsFromImages(nextFiles) : []
      commitAnswers(answers, colorsFromFiles)
    } catch {
      /* keep the current images if storage fails */
    }
  }

  function recalibrate() {
    beginNewVisual()
    navigate('/calibrate', { state: { skipIntro: true, revise: true } })
  }

  async function resetPalette() {
    persist({ skipped: true })
    setExtraColors([])
    setEditor(null)
    setPicker(null)
    try {
      await replacePaletteImages([])
      setImages([])
    } catch {
      setImages([])
    }
    setAsk(null)
  }

  const sound = editor ? CALIBRATION_SOUNDS.find((item) => item.id === editor) : null

  return (
    <main className="screen-library screen-palette">
      <div className="screen-library-inner">
        <h1>My palette</h1>
        <p className="lede">
          Built from your calibration. Halftone uses these as the starting colors and shapes for every new visual.
        </p>

        <section className="palette-panel">
          <h2>Your colors</h2>
          <div className="palette-colors">
            <div className="palette-swatches">
              {ROLE_SWATCHES.map((role) => {
                const hex = draft?.kind === 'role' && draft.key === role.key && isHex(draft.hex) ? draft.hex : groups[role.key]
                const selected = picker?.kind === 'role' && picker.key === role.key
                return (
                  <button
                    key={role.key}
                    type="button"
                    className={selected ? 'palette-swatch is-open' : 'palette-swatch'}
                    onClick={(event) => openPicker(event, { kind: 'role', key: role.key, hex, mode: 'edit' })}
                  >
                    <span className="palette-chip" style={{ background: hex }} />
                    <span className="palette-swatch-label">{role.label}</span>
                    <span className="palette-swatch-hint">{role.hint}</span>
                  </button>
                )
              })}
              {references.map((color, index) => {
                const hex =
                  draft?.kind === 'reference' && draft.index === index && isHex(draft.hex) ? draft.hex : color
                const selected = picker?.kind === 'reference' && picker.index === index
                return (
                  <button
                    key={`ref-${index}-${color}`}
                    type="button"
                    className={selected ? 'palette-swatch is-open' : 'palette-swatch'}
                    onClick={(event) => openPicker(event, { kind: 'reference', index, hex, mode: 'edit' })}
                  >
                    <span className="palette-chip" style={{ background: hex }} />
                    <span className="palette-swatch-label">From your images</span>
                    <span className="palette-swatch-hint">Pulled from reference photos</span>
                  </button>
                )
              })}
            </div>
            <PaletteLivePreview colors={colors} roundness={roundness} />
          </div>
        </section>

        <section className="palette-panel">
          <h2>Your sound map</h2>
          <div className="palette-map">
            {CALIBRATION_SOUNDS.map((item) => {
              const answer = answers[item.id] || {}
              const open = editor === item.id
              return (
                <div key={item.id} className={open ? 'palette-sound is-open' : 'palette-sound'}>
                  <button
                    type="button"
                    className="palette-sound-play"
                    aria-label={playingId === item.id ? `Pause ${item.title}` : `Play ${item.title}`}
                    onClick={(event) => togglePlay(event, item)}
                  >
                    {playingId === item.id ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button type="button" className="palette-sound-hit" onClick={() => setEditor(item.id)}>
                    <span className="palette-sound-title">{item.title}</span>
                    <span className="palette-sound-picks">
                      <span
                        className={answer.color ? 'palette-sound-dot' : 'palette-sound-dot is-empty'}
                        style={answer.color ? { background: answer.color } : undefined}
                      />
                      <span className={answer.shape ? 'palette-sound-mark' : 'palette-sound-mark is-empty'}>
                        <ShapeMark shape={answer.shape || 'round'} />
                      </span>
                      <span className={answer.texture ? 'palette-sound-mark' : 'palette-sound-mark is-empty'}>
                        <TextureMark texture={answer.texture || 'smooth'} />
                      </span>
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        <section className="palette-panel">
          <h2>Reference images</h2>
          <div className="palette-refs">
            {thumbs.map((url, index) => (
              <span key={images[index]?.id || url} className="palette-thumb">
                <img src={url} alt="" />
                <button
                  type="button"
                  className="palette-thumb-x"
                  aria-label="Remove image"
                  onClick={() => removeImage(images[index].id)}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="button-dashed palette-add"
              onClick={() => imageRef.current?.click()}
              disabled={images.length >= 5}
            >
              Add
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
        </section>

        <div className="palette-actions">
          <button type="button" className="button" onClick={() => setAsk('recalibrate')}>
            Recalibrate
          </button>
          <button type="button" className="button-outline" onClick={() => setAsk('reset')}>
            Reset to default palette
          </button>
        </div>
      </div>

      {editor && sound ? (
        <div className="library-modal" role="presentation">
          <div
            ref={editorRef}
            className="library-dialog palette-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="palette-sound-title"
          >
            <div className="palette-editor-head">
              <button
                type="button"
                className="palette-sound-play"
                aria-label={playingId === sound.id ? 'Pause' : 'Play'}
                onClick={(event) => togglePlay(event, sound)}
              >
                {playingId === sound.id ? <PauseIcon /> : <PlayIcon />}
              </button>
              <div>
                <h2 id="palette-sound-title">{sound.title}</h2>
                <p>Change the color, shape, and texture for this sound.</p>
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
                    onClick={() => chooseAnswer('color', color)}
                  />
                )
              })}
              <button
                type="button"
                className="cal-dot cal-add"
                aria-label="Add a color"
                onClick={(event) =>
                  openPicker(event, {
                    kind: 'answer',
                    hex: pick.color || CALIBRATION_COLORS[0],
                    mode: 'add',
                  })
                }
              >
                +
              </button>
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
                      onClick={() => chooseAnswer('shape', item.id)}
                    >
                      <ShapeMark shape={item.id} />
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
                      onClick={() => chooseAnswer('texture', item.id)}
                    >
                      <TextureMark texture={item.id} />
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="library-dialog-actions">
              <button type="button" className="button" onClick={() => setEditor(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {picker ? (
        <form
          className="color-picker"
          ref={pickerRef}
          style={{ left: picker.left, top: picker.top }}
          onSubmit={savePicker}
        >
          <input
            type="color"
            value={isHex(picker.hex) ? picker.hex : '#000000'}
            aria-label="Pick a color"
            onChange={(event) => onPickerHex(event.target.value)}
          />
          <input
            className="color-hex"
            value={picker.hex}
            spellCheck={false}
            aria-label="Hex color"
            onChange={(event) => {
              const raw = event.target.value.trim()
              onPickerHex(raw.startsWith('#') ? raw : `#${raw}`)
            }}
          />
          <button type="submit" className="button" disabled={!isHex(picker.hex)}>
            {picker.mode === 'add' ? 'Add' : 'Save'}
          </button>
          <button type="button" className="button-outline" onClick={closePicker}>
            Cancel
          </button>
        </form>
      ) : null}

      {ask === 'recalibrate' ? (
        <Confirm
          title="Recalibrate"
          body="This replaces your current palette. Visuals you've already made keep their colors."
          confirm="Recalibrate"
          onConfirm={recalibrate}
          onClose={() => setAsk(null)}
        />
      ) : null}

      {ask === 'reset' ? (
        <Confirm
          title="Reset to default palette"
          body="This restores the default colors. Visuals you've already made keep their colors."
          confirm="Reset"
          onConfirm={resetPalette}
          onClose={() => setAsk(null)}
        />
      ) : null}

      <audio
        ref={audioRef}
        hidden
        preload="auto"
        onPlay={() => {
          const src = audioRef.current?.src || ''
          const match = CALIBRATION_SOUNDS.find((item) => src.endsWith(item.file))
          if (match) setPlayingId(match.id)
        }}
        onPause={() => setPlayingId('')}
        onEnded={() => setPlayingId('')}
      />
    </main>
  )
}
