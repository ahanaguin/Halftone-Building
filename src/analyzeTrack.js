import { guess } from 'web-audio-beat-detector'

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

function sectionLabel(values) {
  const body = values.slice(0, Math.max(1, Math.ceil(values.length * 0.8)))
  const average = body.reduce((sum, value) => sum + value, 0) / body.length
  const rise = body[body.length - 1] - body[0]
  if (average < 0.4) return rise > 0.22 ? 'Build' : 'Quiet'
  if (rise > 0.16 && average < 0.7) return 'Build'
  if (average >= 0.62) return 'Peak'
  return rise > 0.1 ? 'Build' : 'Quiet'
}

export function sectionsFromEnergy(envelope, duration) {
  const smooth = normalize(envelope).map((value, index, all) => {
    const previous = all[index - 1] ?? value
    const next = all[index + 1] ?? value
    return (previous + value + next) / 3
  })

  if (smooth.length < 4) {
    return [{ start: 0, end: duration, label: sectionLabel(smooth.length ? smooth : [0]) }]
  }

  const diffs = smooth.map((value, index) => (index === 0 ? 0 : Math.abs(value - smooth[index - 1])))
  const meanDiff = diffs.reduce((sum, value) => sum + value, 0) / diffs.length
  const threshold = Math.max(0.07, meanDiff * 2.4)
  const minGap = Math.max(2, Math.round(smooth.length * 0.1))
  const cuts = [0]

  for (let index = 1; index < smooth.length - 1; index += 1) {
    if (index - cuts[cuts.length - 1] < minGap) continue
    const change = diffs[index]
    if (change >= threshold && change >= diffs[index - 1] && change >= diffs[index + 1]) {
      cuts.push(index)
    }
  }

  if (smooth.length - cuts[cuts.length - 1] < minGap && cuts.length > 1) cuts.pop()
  cuts.push(smooth.length)

  const hop = duration / smooth.length
  const sections = cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1]
    return {
      start: start * hop,
      end: end * hop,
      label: sectionLabel(smooth.slice(start, end)),
    }
  })

  return sections.reduce((merged, section) => {
    const previous = merged[merged.length - 1]
    if (previous && previous.label === section.label) previous.end = section.end
    else merged.push({ ...section })
    return merged
  }, [])
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
      guess(audioBuffer, { minTempo: 60, maxTempo: 180 }),
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

  if (audioBuffer.duration > MAX_TRACK_SECONDS + 0.25) {
    throw new Error('This track is longer than 10 minutes.')
  }

  const channel = monoMix(audioBuffer)
  const bars = normalize(rmsSlices(channel, BAR_COUNT))
  const envelope = rmsSlices(channel, Math.max(8, Math.round(audioBuffer.duration / 0.4)))
  const level = envelope.reduce((sum, value) => sum + value, 0) / envelope.length
  const energy = energyWord(level)
  const brightness = brightnessOf(channel, audioBuffer.sampleRate)
  const bpm = await tempoOf(audioBuffer)

  return {
    fileName: file.name,
    duration: audioBuffer.duration,
    bpm,
    energy,
    mood: moodWords({ energy, brightness, bpm }),
    brightness,
    bars,
    sections: sectionsFromEnergy(envelope, audioBuffer.duration),
  }
}
