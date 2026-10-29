import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { frameInput, paintFrame } from './drawFrame.js'
import {
  FILM_FPS,
  LOGICAL,
  fileBase,
  filmFrames,
  formatClock,
  lengthBounds,
  loudestSection,
  loopFrames,
  sectionOptionLabel,
} from './exportPlan.js'
import { ExportCancelled, prepareEncoder, renderCover, renderFilm, renderLoop, resetFfmpeg, saveBlob, zipFiles } from './exportRender.js'
import { profileTrack } from './profileTrack.js'
import { useTrack } from './track.jsx'
import { saveVisual } from './visuals.js'

const STYLE_LABELS = {
  shapes: 'Liquid',
  halftone: 'Halftone',
  bars: 'Bars',
  wave: 'Wave',
  poster: 'Poster',
  image: 'Animate your image',
}

function Check({ checked, onChange, label, disabled }) {
  return (
    <label className="export-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="export-mark" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="M3.2 8.2 6.4 11.4 12.8 4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>{label}</span>
    </label>
  )
}

function Artwork({ aspect, spec }) {
  const ref = useRef(null)
  const logical = LOGICAL[aspect]
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !spec) return
    canvas.width = logical.width
    canvas.height = logical.height
    paintFrame(canvas.getContext('2d'), spec)
  }, [spec, logical])
  return <canvas ref={ref} className={`export-canvas export-canvas-${aspect.replace(':', '')}`} />
}

export function Export() {
  const { track, studio } = useTrack()
  const [profile, setProfile] = useState(track?.profile || null)
  const [loopOn, setLoopOn] = useState(true)
  const [coverOn, setCoverOn] = useState(true)
  const [filmOn, setFilmOn] = useState(false)
  const [sectionIndex, setSectionIndex] = useState(0)
  const [length, setLength] = useState(8)
  const [coverTime, setCoverTime] = useState(0)
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const sectionTouched = useRef(false)
  const coverTouched = useRef(false)
  const abortRef = useRef(null)

  const sections = useMemo(() => {
    if (!track) return []
    if (track.sections?.length) return track.sections
    return [{ start: 0, end: track.duration, label: 'Whole song' }]
  }, [track])

  useEffect(() => {
    sectionTouched.current = false
    coverTouched.current = false
    setProfile(track?.profile || null)
    if (!track?.file || track.profile?.timeline) return undefined
    let cancel = false
    profileTrack(track.file)
      .then((next) => {
        if (!cancel) setProfile(next)
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [track])

  useEffect(() => {
    if (!sections.length || sectionTouched.current) return
    const loudest = loudestSection(sections, profile)
    const index = Math.max(0, sections.findIndex((section) => section === loudest))
    setSectionIndex(index)
    if (!coverTouched.current && loudest) setCoverTime((loudest.start + Math.min(loudest.end, track.duration)) / 2)
  }, [sections, profile, track])

  const section = sections[sectionIndex] || sections[0]
  const bounds = section && track ? lengthBounds(section.start, track.duration) : { min: 3, max: 8 }
  const loopLength = Math.min(bounds.max, Math.max(bounds.min, length))
  const selectedCount = Number(loopOn) + Number(coverOn) + Number(filmOn)
  const styleLabel = STYLE_LABELS[studio.style] || 'Liquid'

  const loopSpec = useMemo(() => {
    if (!track || !section) return null
    const size = LOGICAL['9:16']
    return frameInput({ track, studio, profile, time: section.start, ...size })
  }, [track, studio, profile, section])

  const coverSpec = useMemo(() => {
    if (!track) return null
    const size = LOGICAL['1:1']
    return frameInput({ track, studio, profile, time: coverTime, ...size })
  }, [track, studio, profile, coverTime])

  const filmSpec = useMemo(() => {
    if (!track || !section) return null
    const size = LOGICAL['16:9']
    const time = Math.min(track.duration, (section.start + section.end) / 2)
    return frameInput({ track, studio, profile, time, ...size })
  }, [track, studio, profile, section])

  async function download() {
    if (!track || !selectedCount || job) return
    const controller = new AbortController()
    abortRef.current = controller
    setError('')
    const base = fileBase(track.fileName)
    const stages = []
    if (loopOn) stages.push({ id: 'loop', label: 'Rendering canvas loop', weight: loopFrames(section.start, loopLength).length })
    if (coverOn) stages.push({ id: 'cover', label: 'Rendering cover art', weight: 1 })
    if (filmOn) stages.push({ id: 'film', label: 'Rendering full visualizer', weight: filmFrames(track.duration, FILM_FPS).length })
    const total = stages.reduce((sum, stage) => sum + stage.weight, 0) || 1
    let done = 0
    const files = []
    const needsVideo = stages.some((stage) => stage.id !== 'cover')

    const report = (label, finished) => {
      setJob({ label, percent: Math.min(100, Math.round((finished / total) * 100)) })
    }

    try {
      if (needsVideo) {
        report('Starting the video encoder', 0)
        await prepareEncoder(controller.signal)
      }
      for (const stage of stages) {
        report(stage.label, done)
        if (stage.id === 'cover') {
          const blob = await renderCover({ track, studio, profile, time: coverTime, signal: controller.signal })
          files.push({ name: `${base}-cover.png`, blob })
          done += 1
        } else if (stage.id === 'loop') {
          const blob = await renderLoop({
            track,
            studio,
            profile,
            start: section.start,
            length: loopLength,
            signal: controller.signal,
            onFrame: (index) => report(stage.label, done + index),
          })
          files.push({ name: `${base}-canvas-loop.mp4`, blob })
          done += stage.weight
        } else {
          const blob = await renderFilm({
            track,
            studio,
            profile,
            signal: controller.signal,
            onFrame: (index) => report(stage.label, done + index),
          })
          files.push({ name: `${base}-visualizer.mp4`, blob })
          done += stage.weight
        }
      }
      report('Preparing the download', total)
      if (files.length === 1) saveBlob(files[0].blob, files[0].name)
      else {
        const packed = []
        for (const file of files) packed.push({ name: file.name, bytes: new Uint8Array(await file.blob.arrayBuffer()) })
        saveBlob(zipFiles(packed), `${base}-halftone.zip`)
      }
      saveVisual({ fileName: track.fileName, style: styleLabel })
      setJob(null)
    } catch (caught) {
      if (controller.signal.aborted || caught instanceof ExportCancelled) {
        setJob(null)
        return
      }
      setJob(null)
      setError(caught?.message || 'The export could not be finished.')
    }
  }

  function cancel() {
    abortRef.current?.abort()
    resetFfmpeg()
    setJob(null)
  }

  if (!track) {
    return (
      <main className="export">
        <div className="export-empty">
          <h1>Export</h1>
          <p>Upload a track before exporting.</p>
          <Link className="button" to="/upload">
            Add your track
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="export">
      <div className="export-inner">
        <h1>Export</h1>
        <p className="export-lede">Files are made on your device.</p>
        <div className="export-grid">
          <article className={loopOn ? 'export-card included' : 'export-card'}>
            <div className="export-stage">
              <div className="export-frame export-frame-tall">
                <Artwork aspect="9:16" spec={loopSpec} />
                <span className="export-badge">9:16 loop</span>
              </div>
            </div>
            <h2>Canvas loop</h2>
            <p>Vertical MP4 for Spotify Canvas, Reels, TikTok.</p>
            <div className="export-field">
              <span>Length</span>
              <strong>{formatLength(loopLength)}</strong>
            </div>
            <input
              className="range"
              type="range"
              min={bounds.min}
              max={bounds.max}
              step={bounds.max - bounds.min >= 1 ? 1 : 0.5}
              value={loopLength}
              aria-label="Loop length"
              disabled={Boolean(job) || bounds.max <= bounds.min}
              onChange={(event) => setLength(Number(event.target.value))}
            />
            <label className="export-field" htmlFor="loop-section">
              Section
            </label>
            <select
              id="loop-section"
              className="export-select"
              value={sectionIndex}
              disabled={Boolean(job)}
              onChange={(event) => {
                sectionTouched.current = true
                setSectionIndex(Number(event.target.value))
              }}
            >
              {sections.map((item, index) => (
                <option key={`${item.start}-${item.label}`} value={index}>
                  {sectionOptionLabel(item, sections)}
                </option>
              ))}
            </select>
            <Check checked={loopOn} onChange={setLoopOn} disabled={Boolean(job)} label="Include" />
          </article>

          <article className={coverOn ? 'export-card included' : 'export-card'}>
            <div className="export-stage">
              <div className="export-frame export-frame-square">
                <Artwork aspect="1:1" spec={coverSpec} />
                <span className="export-badge">1:1 still</span>
              </div>
            </div>
            <h2>Cover art</h2>
            <p>Pick a frame from the song</p>
            <input
              className="range"
              type="range"
              min="0"
              max={track.duration}
              step="0.1"
              value={Math.min(coverTime, track.duration)}
              aria-label="Cover frame"
              aria-valuetext={formatClock(coverTime)}
              disabled={Boolean(job)}
              onChange={(event) => {
                coverTouched.current = true
                setCoverTime(Number(event.target.value))
              }}
            />
            <p className="export-time">{formatClock(coverTime)}</p>
            <Check checked={coverOn} onChange={setCoverOn} disabled={Boolean(job)} label="Include: PNG, 3000 x 3000" />
          </article>

          <article className={filmOn ? 'export-card included' : 'export-card'}>
            <div className="export-stage">
              <div className="export-frame export-frame-wide">
                <Artwork aspect="16:9" spec={filmSpec} />
                <span className="export-badge">16:9</span>
              </div>
            </div>
            <h2>Full visualizer</h2>
            <p>Full-length MP4 with your audio. For YouTube and other promo platforms.</p>
            <p className="export-warn">This can take a few minutes.</p>
            <Check checked={filmOn} onChange={setFilmOn} disabled={Boolean(job)} label="Include" />
          </article>
        </div>

        <div className="export-footer">
          {job ? (
            <div className="export-job">
              <div className="export-job-row">
                <p>{job.label}</p>
                <button type="button" className="button-outline" onClick={cancel}>
                  Cancel
                </button>
              </div>
              <div
                className="export-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job.percent}
                aria-label={job.label}
              >
                <span style={{ width: `${job.percent}%` }} />
              </div>
            </div>
          ) : (
            <>
              {error ? <p className="export-error">{error}</p> : null}
              <p>
                {!profile
                  ? 'Reading the track…'
                  : selectedCount === 1
                    ? '1 file selected'
                    : `${selectedCount} files selected`}
              </p>
              <button type="button" className="button" disabled={!selectedCount || !profile} onClick={download}>
                Download
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function formatLength(seconds) {
  const rounded = Math.round(seconds * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text} ${rounded === 1 ? 'second' : 'seconds'}`
}
