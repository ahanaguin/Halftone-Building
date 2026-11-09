import { frameInput, paintScaled } from './drawFrame.js'
import { prepareCollage } from './collageField.js'
import { prepareHalftone } from './halftoneField.js'
import { prepareMosaic } from './mosaicField.js'
import { prepareRiso } from './risoField.js'
import { workingSections } from './sectionEdit.js'
import { metricsAt } from './profileTrack.js'
import { labelKind } from './shapeLayout.js'
import {
  PREVIEW_VERSION,
  getLibraryItem,
  getProject,
  hydrateImages,
  putVisual,
  releaseImages,
} from './visuals.js'

const THUMB = { width: 540, height: 960 }
const PREVIEW = { width: 540, height: 960, fps: 12, seconds: 3 }
const LOGICAL = { width: 540, height: 960 }
const CALM_KINDS = new Set(['Quiet', 'Intro', 'Break', 'Outro'])
const HARSH_KINDS = new Set(['Drop', 'Peak', 'High'])

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('A preview frame could not be rendered.'))
    }, type, quality)
  })
}

function recorderType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function prepare(studio) {
  const urls = (studio.images || []).map((image) => image.url).filter(Boolean)
  await Promise.all([
    prepareHalftone({ style: studio.style, images: urls, width: LOGICAL.width, height: LOGICAL.height }),
    prepareCollage({ style: studio.style, images: urls }),
    prepareMosaic({ style: studio.style, images: urls }),
    prepareRiso({ style: studio.style, images: urls, width: LOGICAL.width, height: LOGICAL.height }),
  ])
}

function windowHarshness(profile, start, length) {
  if (!profile?.timeline?.rms?.length) return 0.45
  const step = Math.max(0.05, profile.timeline.hop || 0.05)
  let sum = 0
  let count = 0
  for (let time = start; time < start + length; time += step) {
    const metrics = metricsAt(profile, time)
    if (!metrics) continue
    sum += metrics.loud * 0.5 + metrics.harsh * 1.2 + metrics.high * 0.4
    count += 1
  }
  return count ? sum / count : 0.45
}

function kindBias(label) {
  const kind = labelKind(label)
  if (HARSH_KINDS.has(kind)) return 2.2
  if (kind === 'Build') return 0.9
  if (kind === 'Main') return 0.45
  if (CALM_KINDS.has(kind)) return 0
  return 0.35
}

export function calmPreviewStart(track, studio, length = PREVIEW.seconds) {
  const duration = Number(track?.duration) || 0
  const need = Math.min(length, Math.max(0.5, duration || length))
  if (!duration) return 0
  const sections = workingSections(track, studio)
  const longEnough = (section) => section.end - section.start >= Math.min(need, 1.2)
  const usable = sections.filter(longEnough)
  const pool = usable.length ? usable : sections
  const calm = pool.filter((section) => CALM_KINDS.has(labelKind(section.label)))
  const gentle = pool.filter((section) => !HARSH_KINDS.has(labelKind(section.label)))
  const source = calm.length
    ? calm
    : gentle.length
      ? gentle
      : pool.length
        ? pool
        : [{ start: 0, end: duration, label: 'Quiet' }]

  let best = null
  for (const section of source) {
    const from = section.start
    const to = Math.max(from, section.end - need)
    const bias = kindBias(section.label)
    const steps = 6
    for (let index = 0; index <= steps; index += 1) {
      const start = from + ((to - from) * index) / steps
      const clamped = Math.max(0, Math.min(start, Math.max(0, duration - need)))
      const score = windowHarshness(track.profile, clamped, need) + bias
      if (!best || score < best.score) best = { start: clamped, score }
    }
  }
  return best ? best.start : 0
}

function paintAt(canvas, input, time) {
  paintScaled(canvas, LOGICAL, frameInput({ ...input, time, width: LOGICAL.width, height: LOGICAL.height }))
}

export async function captureStills({ track, studio, signal }) {
  if (!track?.file) return { thumbnail: null, preview: null }
  if (signal?.aborted) return { thumbnail: null, preview: null }
  await prepare(studio)
  const input = { track, studio, profile: track.profile }
  const time = calmPreviewStart(track, studio)
  const thumb = document.createElement('canvas')
  thumb.width = THUMB.width
  thumb.height = THUMB.height
  paintAt(thumb, input, time)
  const thumbnail = await canvasBlob(thumb, 'image/jpeg', 0.92)
  if (signal?.aborted) return { thumbnail, preview: null }

  const mime = recorderType()
  if (!mime) return { thumbnail, preview: null }

  const canvas = document.createElement('canvas')
  canvas.width = PREVIEW.width
  canvas.height = PREVIEW.height
  canvas.style.cssText = `position:fixed;left:-9999px;top:0;width:${PREVIEW.width}px;height:${PREVIEW.height}px;opacity:0;pointer-events:none`
  document.body.append(canvas)
  paintAt(canvas, input, time)
  const stream = canvas.captureStream(PREVIEW.fps)
  const videoTrack = stream.getVideoTracks()[0]
  let preview = null
  try {
    preview = await new Promise((resolve, reject) => {
      const chunks = []
      let recorder
      try {
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_400_000 })
      } catch (error) {
        reject(error)
        return
      }
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data)
      }
      recorder.onerror = () => reject(new Error('The preview could not be recorded.'))
      recorder.onstop = () => {
        resolve(chunks.length ? new Blob(chunks, { type: mime }) : null)
      }
      recorder.start()
      const count = PREVIEW.fps * PREVIEW.seconds
      const frameMs = 1000 / PREVIEW.fps
      const startedAt = performance.now()
      let index = 0
      const tick = async () => {
        try {
          while (index < count) {
            if (signal?.aborted) {
              recorder.stop()
              return
            }
            paintAt(canvas, input, time + index / PREVIEW.fps)
            if (typeof videoTrack.requestFrame === 'function') videoTrack.requestFrame()
            index += 1
            const due = startedAt + index * frameMs
            await wait(Math.max(0, due - performance.now()))
          }
          await wait(80)
          recorder.stop()
        } catch (error) {
          try {
            recorder.stop()
          } catch {
            reject(error)
          }
        }
      }
      tick()
    })
  } catch {
    preview = null
  } finally {
    videoTrack?.stop()
    stream.getTracks().forEach((item) => item.stop())
    canvas.remove()
  }
  return { thumbnail, preview }
}

export function previewIsStale(item) {
  return !item?.thumbnail || !item?.preview || item.previewVersion !== PREVIEW_VERSION
}

export async function refreshStalePreview(id) {
  const library = await getLibraryItem(id)
  const project = await getProject(id)
  if (!library || !project?.track?.file) return false
  const images = hydrateImages(project.images)
  try {
    const stills = await captureStills({
      track: { ...project.track, file: project.track.file },
      studio: { ...project.studio, images },
    })
    if (!stills.thumbnail && !stills.preview) return false
    await putVisual({
      library: {
        ...library,
        thumbnail: stills.thumbnail || library.thumbnail,
        preview: stills.preview || library.preview,
        previewVersion: PREVIEW_VERSION,
      },
      project,
    })
    return true
  } finally {
    releaseImages(images)
  }
}
