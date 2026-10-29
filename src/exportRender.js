import { FFmpeg } from '@ffmpeg/ffmpeg'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import { zipSync } from 'fflate'
import { frameInput, paintScaled } from './drawFrame.js'
import { FILM_FPS, LOGICAL, LOOP_FPS, OUTPUT, filmFrames, loopFrames } from './exportPlan.js'

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelled'
  }
}

let ffmpegPromise = null

function throwIfCancelled(signal) {
  if (signal?.aborted) throw new ExportCancelled()
}

async function getFfmpeg(signal) {
  throwIfCancelled(signal)
  if (!ffmpegPromise) {
    const ffmpeg = new FFmpeg()
    ffmpegPromise = ffmpeg
      .load({ coreURL, wasmURL })
      .then(() => ffmpeg)
      .catch((error) => {
        ffmpegPromise = null
        throw error
      })
  }
  const ffmpeg = await ffmpegPromise
  throwIfCancelled(signal)
  return ffmpeg
}

export function prepareEncoder(signal) {
  return getFfmpeg(signal)
}

export function resetFfmpeg() {
  const pending = ffmpegPromise
  ffmpegPromise = null
  pending?.then((ffmpeg) => ffmpeg.terminate()).catch(() => {})
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('A frame could not be rendered.'))
    }, type, quality)
  })
}

function mixCanvases(base, overlay, alpha) {
  const width = base.width
  const height = base.height
  const ctx = base.getContext('2d', { willReadFrequently: true })
  const over = overlay.getContext('2d', { willReadFrequently: true })
  const bottom = ctx.getImageData(0, 0, width, height)
  const top = over.getImageData(0, 0, width, height)
  const keep = 1 - alpha
  const left = bottom.data
  const right = top.data
  for (let index = 0; index < left.length; index += 4) {
    left[index] = left[index] * keep + right[index] * alpha
    left[index + 1] = left[index + 1] * keep + right[index + 1] * alpha
    left[index + 2] = left[index + 2] * keep + right[index + 2] * alpha
  }
  ctx.putImageData(bottom, 0, 0)
}

function paintAt(canvas, logical, input, time) {
  paintScaled(canvas, logical, frameInput({ ...input, time, width: logical.width, height: logical.height }))
}

async function jpegFrame(canvas) {
  const blob = await canvasBlob(canvas, 'image/jpeg', 0.86)
  return new Uint8Array(await blob.arrayBuffer())
}

async function encodeFrames({ frames, width, height, logical, fps, input, audioFile, signal, onFrame }) {
  const ffmpeg = await getFfmpeg(signal)
  const base = document.createElement('canvas')
  base.width = width
  base.height = height
  const overlay = document.createElement('canvas')
  overlay.width = width
  overlay.height = height
  const chunkSize = 45
  const parts = []
  let frameIndex = 0

  try {
    while (frameIndex < frames.length) {
      throwIfCancelled(signal)
      const chunk = frames.slice(frameIndex, frameIndex + chunkSize)
      for (let index = 0; index < chunk.length; index += 1) {
        throwIfCancelled(signal)
        const frame = chunk[index]
        const time = typeof frame === 'number' ? frame : frame.time
        paintAt(base, logical, input, time)
        if (frame.alpha) {
          paintAt(overlay, logical, input, frame.mixTime)
          mixCanvases(base, overlay, frame.alpha)
        }
        const name = `f${String(index).padStart(4, '0')}.jpg`
        await ffmpeg.writeFile(name, await jpegFrame(base), { signal })
        frameIndex += 1
        onFrame?.(frameIndex, frames.length)
      }
      const code = await ffmpeg.exec(
        ['-framerate', String(fps), '-i', 'f%04d.jpg', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', 'seg.mp4'],
        undefined,
        { signal },
      )
      if (code !== 0) throw new Error('The video encoder stopped before it finished.')
      const segment = await ffmpeg.readFile('seg.mp4')
      const partName = `part${parts.length}.mp4`
      await ffmpeg.writeFile(partName, segment, { signal })
      parts.push(partName)
      for (let index = 0; index < chunk.length; index += 1) {
        await ffmpeg.deleteFile(`f${String(index).padStart(4, '0')}.jpg`).catch(() => {})
      }
      await ffmpeg.deleteFile('seg.mp4').catch(() => {})
    }

    let videoName = parts[0]
    if (parts.length > 1) {
      const list = parts.map((name) => `file '${name}'`).join('\n')
      await ffmpeg.writeFile('list.txt', new TextEncoder().encode(list), { signal })
      const code = await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'video.mp4'], undefined, { signal })
      if (code !== 0) throw new Error('The video encoder stopped before it finished.')
      videoName = 'video.mp4'
    }

    let finalName = videoName
    if (audioFile) {
      await ffmpeg.writeFile('song', new Uint8Array(await audioFile.arrayBuffer()), { signal })
      const code = await ffmpeg.exec(
        ['-i', videoName, '-i', 'song', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', 'final.mp4'],
        undefined,
        { signal },
      )
      if (code !== 0) throw new Error('The song audio could not be added to the visualizer.')
      finalName = 'final.mp4'
    }

    const data = await ffmpeg.readFile(finalName)
    return new Blob([data], { type: 'video/mp4' })
  } finally {
    const names = [...parts, 'video.mp4', 'final.mp4', 'list.txt', 'song', 'seg.mp4']
    await Promise.all(names.map((name) => ffmpeg.deleteFile(name).catch(() => {})))
  }
}

export async function renderCover({ track, studio, profile, time, signal }) {
  throwIfCancelled(signal)
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT.cover.width
  canvas.height = OUTPUT.cover.height
  paintAt(canvas, LOGICAL['1:1'], { track, studio, profile }, time)
  return canvasBlob(canvas, 'image/png')
}

export async function renderLoop({ track, studio, profile, start, length, signal, onFrame }) {
  const frames = loopFrames(start, length, LOOP_FPS)
  return encodeFrames({
    frames,
    width: OUTPUT.loop.width,
    height: OUTPUT.loop.height,
    logical: LOGICAL['9:16'],
    fps: LOOP_FPS,
    input: { track, studio, profile },
    signal,
    onFrame,
  })
}

export async function renderFilm({ track, studio, profile, signal, onFrame }) {
  return encodeFrames({
    frames: filmFrames(track.duration, FILM_FPS),
    width: OUTPUT.film.width,
    height: OUTPUT.film.height,
    logical: LOGICAL['16:9'],
    fps: FILM_FPS,
    input: { track, studio, profile },
    audioFile: track.file,
    signal,
    onFrame,
  })
}

export function zipFiles(files) {
  const archived = {}
  for (const file of files) archived[file.name] = new Uint8Array(file.bytes)
  return new Blob([zipSync(archived)], { type: 'application/zip' })
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
