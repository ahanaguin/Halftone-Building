import { frameInput, paintScaled } from './drawFrame.js'
import { prepareCollage } from './collageField.js'
import { prepareHalftone } from './halftoneField.js'
import { prepareMosaic } from './mosaicField.js'
import { prepareRiso } from './risoField.js'
import { loudestSection } from './exportPlan.js'
import { workingSections } from './sectionEdit.js'

const THUMB = { width: 270, height: 480 }
const PREVIEW = { width: 180, height: 320, fps: 10, seconds: 3 }
const LOGICAL = { width: 540, height: 960 }

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

function startTime(track, studio) {
  const sections = workingSections(track, studio)
  const loudest = loudestSection(sections, track?.profile)
  if (loudest) return loudest.start
  return 0
}

function paintAt(canvas, input, time) {
  paintScaled(canvas, LOGICAL, frameInput({ ...input, time, width: LOGICAL.width, height: LOGICAL.height }))
}

export async function captureStills({ track, studio, signal }) {
  if (!track?.file) return { thumbnail: null, preview: null }
  if (signal?.aborted) return { thumbnail: null, preview: null }
  await prepare(studio)
  const input = { track, studio, profile: track.profile }
  const time = startTime(track, studio)
  const thumb = document.createElement('canvas')
  thumb.width = THUMB.width
  thumb.height = THUMB.height
  paintAt(thumb, input, time)
  const thumbnail = await canvasBlob(thumb, 'image/jpeg', 0.84)
  if (signal?.aborted) return { thumbnail, preview: null }

  const mime = recorderType()
  if (!mime) return { thumbnail, preview: null }

  const canvas = document.createElement('canvas')
  canvas.width = PREVIEW.width
  canvas.height = PREVIEW.height
  canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
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
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 280_000 })
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
            await wait(12)
          }
          await wait(40)
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
