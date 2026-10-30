import { guess } from 'web-audio-beat-detector'
import { profileFromChannel } from './profileTrack.js'

export const MIN_TRACK_SECONDS = 15
export const SHORT_TRACK_MESSAGE = 'Add at least 15 seconds of music so Halftone can read the energy and mood clearly.'
export const MAX_TRACK_SECONDS = 10 * 60

const BAR_COUNT = 64

export function audioFileError(file) {
  if (!file) return 'Choose an MP3 or WAV file.'
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  const allowedType = type === 'audio/mpeg' || type === 'audio/mp3' || type === 'audio/wav' || type === 'audio/wave' || type === 'audio/x-wav'
  const allowedName = name.endsWith('.mp3') || name.endsWith('.wav')
  if (!allowedType && !allowedName) return 'Use an MP3 or WAV file.'
  if (!file.size) return 'That file could not be read.'
  return null
}

export function energyWord(rms) {
  const db = 20 * Math.log10(Math.max(rms, 1e-8))
  if (db < -22) return 'Calm'
  if (db < -18) return 'Mellow'
  if (db < -14) return 'Steady'
  if (db < -11) return 'Driving'
  return 'Intense'
}

export function moodWords({ energy, brightness, bpm }) {
  const bright = brightness >= 0.42
  const fast = bpm != null && bpm >= 118
  const calm = energy === 'Calm' || energy === 'Mellow'
  const intense = energy === 'Driving' || energy === 'Intense' || (fast && energy !== 'Calm' && energy !== 'Mellow')

  if (intense && bright) return 'Bright, intense'
  if (intense) return 'Dark, intense'
  if (calm && bright) return 'Calm, bright'
  if (calm) return 'Calm, dark'
  if (bright) return 'Bright, steady'
  return 'Dark, steady'
}

function monoMix(audioBuffer) {
  const { length, numberOfChannels } = audioBuffer
  const mixed = new Float32Array(length)
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) mixed[i] += data[i] / numberOfChannels
  }
  return mixed
}

function rmsSlices(channel, slices) {
  const size = Math.max(1, Math.floor(channel.length / slices))
  const values = []
  for (let index = 0; index < slices; index += 1) {
    const start = index * size
    const end = index === slices - 1 ? channel.length : Math.min(channel.length, start + size)
    let sum = 0
    for (let i = start; i < end; i += 1) sum += channel[i] * channel[i]
    values.push(Math.sqrt(sum / Math.max(1, end - start)))
  }
  return values
}

function normalize(values) {
  const max = Math.max(...values, 1e-8)
  return values.map((value) => value / max)
}

const WINDOW = 0.5
const MIN_SECTION = 8

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function deviation(values) {
  if (values.length < 2) return 0
  const mid = average(values)
  return Math.sqrt(average(values.map((value) => (value - mid) ** 2)))
}

function smoothSeries(values, radius = 2) {
  return values.map((value, index) => {
    let total = 0
    let weight = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      const sample = values[Math.min(values.length - 1, Math.max(0, index + offset))]
      const coefficient = radius + 1 - Math.abs(offset)
      total += sample * coefficient
      weight += coefficient
    }
    return total / weight
  })
}

function onsetSeries(channel, sampleRate) {
  const frameSec = 0.02
  const frame = Math.max(1, Math.round(sampleRate * frameSec))
  const energies = []
  for (let start = 0; start + frame <= channel.length; start += frame) {
    let sum = 0
    for (let index = start; index < start + frame; index += 1) sum += channel[index] * channel[index]
    energies.push(sum / frame)
  }
  const flux = energies.map((energy, index) => Math.max(0, energy - (energies[index - 1] ?? energy)))
  const mid = average(flux)
  const spread = deviation(flux)
  const gate = Math.max(mid + spread * 0.9, 1e-8)
  const minFrames = Math.max(2, Math.round(0.07 / frameSec))
  const hits = []
  let previous = -minFrames
  for (let index = 1; index < flux.length - 1; index += 1) {
    if (index - previous < minFrames) continue
    if (flux[index] < gate || flux[index] < flux[index - 1] || flux[index] <= flux[index + 1]) continue
    hits.push(index)
    previous = index
  }
  const windows = Math.max(1, Math.floor(channel.length / Math.round(sampleRate * WINDOW)))
  const density = Array.from({ length: windows }, () => 0)
  const framesPerWindow = Math.max(1, Math.round(WINDOW / frameSec))
  for (const hit of hits) {
    const bucket = Math.min(windows - 1, Math.floor(hit / framesPerWindow))
    density[bucket] += 1 / WINDOW
  }
  return {
    density,
    flux,
    frameSec,
    perSecond: hits.length / Math.max(WINDOW, channel.length / sampleRate),
  }
}

function pulseAt(flux, frameSec, bpm) {
  if (!flux?.length || !(bpm > 0)) return 0
  const lag = Math.round(60 / bpm / frameSec)
  if (lag < 2 || lag >= flux.length / 2) return 0
  let match = 0
  let left = 0
  let right = 0
  const last = flux.length - lag
  for (let index = 0; index < last; index += 1) {
    match += flux[index] * flux[index + lag]
    left += flux[index] * flux[index]
    right += flux[index + lag] * flux[index + lag]
  }
  return match / Math.sqrt(left * right || 1)
}

function measureTrack(channel, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate * WINDOW))
  const windows = Math.max(1, Math.floor(channel.length / hop))
  const loud = new Array(windows)
  const bright = new Array(windows)
  const step = 1 / sampleRate
  const coefficient = step / (step + 1 / (2 * Math.PI * 1800))
  let lowpass = 0

  for (let window = 0; window < windows; window += 1) {
    const start = window * hop
    let sum = 0
    let lowEnergy = 0
    let highEnergy = 0
    for (let index = start; index < start + hop; index += 1) {
      const sample = channel[index]
      sum += sample * sample
      lowpass += coefficient * (sample - lowpass)
      const high = sample - lowpass
      lowEnergy += lowpass * lowpass
      highEnergy += high * high
    }
    loud[window] = 10 * Math.log10(sum / hop + 1e-10)
    bright[window] = highEnergy / (lowEnergy + highEnergy + 1e-12)
  }

  const onsets = onsetSeries(channel, sampleRate)
  return {
    hop: WINDOW,
    duration: channel.length / sampleRate,
    loud: smoothSeries(loud),
    bright: smoothSeries(bright),
    onset: smoothSeries(onsets.density),
    onsetsPerSecond: onsets.perSecond,
    flux: onsets.flux,
    frameSec: onsets.frameSec,
  }
}

function targetSectionCount(duration) {
  const room = Math.max(1, Math.floor(duration / MIN_SECTION))
  const scaled = Math.round((duration / 180) * 7)
  const aimed = duration >= 24 ? Math.max(3, scaled) : Math.max(1, scaled)
  return Math.max(1, Math.min(10, room, aimed))
}

function boundaryIndexes(features, floor = 0.9) {
  const { loud, bright, onset, duration } = features
  const count = loud.length
  const radius = 6
  const minGap = Math.round(MIN_SECTION / WINDOW)
  if (count < minGap * 2) return []

  const loudScale = Math.max(deviation(loud), 1.5)
  const brightScale = Math.max(deviation(bright), 0.03)
  const onsetScale = Math.max(deviation(onset), 0.35)
  const spanMean = (series, from, to) => average(series.slice(Math.max(0, from), Math.min(series.length, to)))
  const scores = new Array(count).fill(0)
  for (let index = radius; index < count - radius; index += 1) {
    const loudJump = Math.abs(spanMean(loud, index, index + radius) - spanMean(loud, index - radius, index))
    const brightJump = Math.abs(spanMean(bright, index, index + radius) - spanMean(bright, index - radius, index))
    const onsetJump = Math.abs(spanMean(onset, index, index + radius) - spanMean(onset, index - radius, index))
    scores[index] = loudJump / loudScale + (brightJump / brightScale) * 0.7 + (onsetJump / onsetScale) * 0.85
  }

  const peaks = []
  for (let index = radius + 1; index < count - radius - 1; index += 1) {
    if (scores[index] < floor) continue
    if (scores[index] < scores[index - 1] || scores[index] < scores[index + 1]) continue
    if (index < minGap || index > count - minGap) continue
    peaks.push({ index, score: scores[index] })
  }
  peaks.sort((left, right) => right.score - left.score)

  const chosen = []
  const limit = Math.max(0, Math.min(9, Math.floor(duration / MIN_SECTION) - 1))
  for (const peak of peaks) {
    if (chosen.length >= limit) break
    if (chosen.some((index) => Math.abs(index - peak.index) < minGap)) continue
    chosen.push(peak.index)
  }
  chosen.sort((left, right) => left - right)
  return chosen
}

function rangesFromIndexes(indexes, duration) {
  const cuts = [0, ...indexes.map((index) => index * WINDOW), duration]
  const ranges = []
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const start = cuts[index]
    const end = cuts[index + 1]
    if (end - start < 0.05) continue
    if (ranges.length && end - start < MIN_SECTION) {
      ranges[ranges.length - 1].end = end
      continue
    }
    ranges.push({ start, end })
  }
  if (!ranges.length) ranges.push({ start: 0, end: duration })
  ranges[0].start = 0
  ranges[ranges.length - 1].end = duration
  return ranges
}

function barRanges(duration, bpm) {
  const tempo = bpm > 0 ? bpm : 100
  const bar = (60 / tempo) * 4
  const eight = 8 * bar
  const sixteen = 16 * bar
  const fitting = (size) => (size >= MIN_SECTION ? Math.floor((duration + 0.001) / size) : 0)
  const want = targetSectionCount(duration)
  const choices = [
    { size: sixteen, count: fitting(sixteen) },
    { size: eight, count: fitting(eight) },
  ].filter((choice) => choice.count >= 3)
  const picked = choices.sort((left, right) => Math.abs(left.count - want) - Math.abs(right.count - want))[0]
  const size = picked?.size ?? Math.max(sixteen, MIN_SECTION)
  const cuts = []
  for (let time = size; time < duration - MIN_SECTION + 0.001; time += size) cuts.push(time)
  return rangesFromIndexes(cuts.map((time) => time / WINDOW), duration)
}

function songLevel(loud) {
  const sorted = loud.slice().sort((left, right) => left - right)
  const at = (percent) => sorted[Math.min(sorted.length - 1, Math.round(percent * (sorted.length - 1)))] ?? 0
  const low = at(0.08)
  const high = at(0.92)
  const span = Math.max(1.2, high - low)
  return loud.map((value) => Math.min(1, Math.max(0, (value - low) / span)))
}

function sliceStats(level, start, end, duration) {
  const from = Math.max(0, Math.min(level.length - 1, Math.floor((start / duration) * level.length)))
  const to = Math.max(from + 1, Math.min(level.length, Math.ceil((end / duration) * level.length)))
  const slice = level.slice(from, to)
  const head = slice.slice(0, Math.max(1, Math.floor(slice.length * 0.3)))
  const tail = slice.slice(Math.floor(slice.length * 0.7))
  return { mean: average(slice), rise: average(tail.length ? tail : slice) - average(head) }
}

function numberLabels(labels) {
  const totals = {}
  labels.forEach((label) => {
    totals[label] = (totals[label] || 0) + 1
  })
  const seen = {}
  return labels.map((label) => {
    if ((totals[label] || 0) < 2) return label
    seen[label] = (seen[label] || 0) + 1
    return `${label} ${seen[label]}`
  })
}

export function labelsFor(ranges, level, duration, energy) {
  const stats = ranges.map((range) => sliceStats(level, range.start, range.end, duration))
  if (!stats.length) return []
  const meanAll = average(stats.map((item) => item.mean))
  const last = stats.length - 1
  const labels = stats.map((item, index) => {
    const previous = stats[index - 1]
    const dip = previous && previous.mean - item.mean >= 0.16 && item.mean <= meanAll + 0.02
    if (index > 0 && index < last && dip) return 'Break'
    if (item.rise >= 0.12 && item.mean < 0.86) return 'Build'
    if (item.mean <= 0.38 || item.mean <= meanAll - 0.14) return 'Quiet'
    if (item.mean >= Math.max(0.5, meanAll - 0.04)) return 'Main'
    if (item.rise <= -0.1) return 'Quiet'
    return item.mean >= meanAll ? 'Main' : 'Quiet'
  })

  if (stats.length === 1) {
    const calm = energy === 'Calm' || energy === 'Mellow'
    if (calm || stats[0].mean < 0.42) labels[0] = 'Quiet'
    else if (stats[0].mean >= 0.6) labels[0] = 'High'
    else labels[0] = 'Main'
    return labels
  }

  if (stats[0].mean < meanAll - 0.02) labels[0] = 'Intro'
  const ending = stats[last]
  const fades = ending.rise < -0.05 || ending.mean < stats[last - 1].mean - 0.08 || ending.mean < meanAll - 0.06
  if (fades && ending.mean < 0.78) labels[last] = 'Outro'

  for (let index = 1; index < labels.length; index += 1) {
    if (labels[index] === 'Outro' || labels[index] === 'Break') continue
    if (labels[index - 1] !== 'Build') continue
    const jump = stats[index].mean - stats[index - 1].mean
    if (jump >= 0.14 && stats[index].mean >= 0.52) labels[index] = 'Drop'
  }

  const ranked = stats
    .map((item, index) => ({ index, mean: item.mean }))
    .filter((item) => !['Intro', 'Outro', 'Break', 'Quiet', 'Drop'].includes(labels[item.index]))
    .sort((left, right) => right.mean - left.mean)
  if (ranked[0] && ranked[0].mean >= 0.58) {
    labels[ranked[0].index] = 'High'
    const second = ranked[1]
    if (second && second.mean >= 0.68 && ranked[0].mean - second.mean <= 0.07) labels[second.index] = 'High'
  }

  const driving = energy === 'Driving' || energy === 'Intense'
  const settled = labels.every((label) => label === 'Quiet' || label === 'Intro' || label === 'Outro' || label === 'Break')
  if (driving && settled) {
    const loudest = stats.reduce((best, item, index) => (item.mean > stats[best].mean ? index : best), 0)
    if (labels[loudest] !== 'Outro' && labels[loudest] !== 'Intro') labels[loudest] = stats[loudest].mean >= 0.58 ? 'High' : 'Main'
  }

  return numberLabels(labels)
}

export function correctTempo(rawBpm, reading) {
  if (rawBpm == null || !Number.isFinite(rawBpm) || rawBpm <= 0) return null
  const onsetsPerSecond = typeof reading === 'number' ? reading : reading?.onsetsPerSecond || 0
  const perBeat = onsetsPerSecond / (rawBpm / 60)
  const flux = typeof reading === 'number' ? null : reading?.flux
  const frameSec = reading?.frameSec || 0.02
  let bpm = rawBpm
  if (rawBpm < 75) {
    const slow = pulseAt(flux, frameSec, rawBpm)
    const fast = pulseAt(flux, frameSec, rawBpm * 2)
    const clearlySlow = perBeat < 1.5 && fast < slow * 0.4
    if (!clearlySlow) bpm = rawBpm * 2
  } else if (rawBpm > 180) {
    const fast = pulseAt(flux, frameSec, rawBpm)
    const slow = pulseAt(flux, frameSec, rawBpm / 2)
    const clearlyFast = perBeat >= 0.6 && fast >= slow * 0.4
    if (!clearlyFast) bpm = rawBpm / 2
  }
  return Math.round(bpm)
}

export function beatCount(duration, bpm) {
  if (bpm == null || !(duration > 0)) return null
  return Math.max(1, Math.round((duration * bpm) / 60))
}

export function detectSections(channel, sampleRate, { bpm = null, energy = 'Steady' } = {}) {
  const features = measureTrack(channel, sampleRate)
  const duration = features.duration
  const tempo = correctTempo(bpm, features)
  let ranges = rangesFromIndexes(boundaryIndexes(features), duration)
  if (ranges.length < 3 && duration >= MIN_SECTION * 3) {
    ranges = rangesFromIndexes(boundaryIndexes(features, 0.62), duration)
  }
  if (ranges.length < 3 && duration >= MIN_SECTION * 3) ranges = barRanges(duration, tempo)
  const labels = labelsFor(ranges, songLevel(features.loud), duration, energy)
  return {
    bpm: tempo,
    onsetsPerSecond: features.onsetsPerSecond,
    sections: ranges.map((range, index) => ({
      start: range.start,
      end: range.end,
      label: labels[index],
    })),
  }
}

function brightnessOf(channel, sampleRate) {
  const step = Math.max(1, Math.floor(channel.length / 180000))
  const cutoff = 1800
  const dt = step / sampleRate
  const coefficient = dt / (dt + 1 / (2 * Math.PI * cutoff))
  let lowpass = 0
  let lowEnergy = 0
  let highEnergy = 0

  for (let index = 0; index < channel.length; index += step) {
    const sample = channel[index]
    lowpass += coefficient * (sample - lowpass)
    const highpass = sample - lowpass
    lowEnergy += lowpass * lowpass
    highEnergy += highpass * highpass
  }

  return highEnergy / (lowEnergy + highEnergy || 1)
}

async function tempoOf(audioBuffer) {
  try {
    const result = await Promise.race([
      guess(audioBuffer, { minTempo: 55, maxTempo: 210 }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('tempo timeout')), 20000)
      }),
    ])
    const bpm = Math.round(result.bpm)
    return Number.isFinite(bpm) ? bpm : null
  } catch {
    return null
  }
}

export async function analyzeTrack(file) {
  const typeError = audioFileError(file)
  if (typeError) throw new Error(typeError)

  const bytes = await file.arrayBuffer()
  const context = new AudioContext()
  let audioBuffer
  try {
    audioBuffer = await context.decodeAudioData(bytes.slice(0))
  } catch {
    throw new Error('That file could not be read.')
  } finally {
    await context.close()
  }

  if (audioBuffer.duration < MIN_TRACK_SECONDS) {
    throw new Error(SHORT_TRACK_MESSAGE)
  }

  if (audioBuffer.duration > MAX_TRACK_SECONDS + 0.25) {
    throw new Error('This track is longer than 10 minutes.')
  }

  const channel = monoMix(audioBuffer)
  const bars = normalize(rmsSlices(channel, BAR_COUNT))
  const envelope = rmsSlices(channel, Math.max(8, Math.round(audioBuffer.duration / 0.4)))
  const level = envelope.reduce((sum, value) => sum + value, 0) / envelope.length
  const energy = energyWord(level)
  const brightness = brightnessOf(channel, audioBuffer.sampleRate)
  const rawBpm = await tempoOf(audioBuffer)
  const read = detectSections(channel, audioBuffer.sampleRate, { bpm: rawBpm, energy })
  const bpm = read.bpm

  return {
    fileName: file.name,
    duration: audioBuffer.duration,
    bpm,
    beats: beatCount(audioBuffer.duration, bpm),
    energy,
    mood: moodWords({ energy, brightness, bpm }),
    brightness,
    bars,
    sections: read.sections,
    profile: profileFromChannel(channel, audioBuffer.sampleRate),
  }
}
