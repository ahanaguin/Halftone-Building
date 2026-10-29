function alpha(sampleRate, cutoff) {
  const dt = 1 / sampleRate
  const rc = 1 / (2 * Math.PI * cutoff)
  return dt / (rc + dt)
}

export function windowFeatures(samples, sampleRate) {
  const count = samples.length
  let sum = 0
  let crosses = 0
  let previous = 0
  let low = 0
  let highState = 0
  let lowEnergy = 0
  let highEnergy = 0
  const lowAlpha = alpha(sampleRate, 140)
  const highAlpha = alpha(sampleRate, 4000)

  for (let index = 0; index < count; index += 1) {
    const sample = samples[index]
    sum += sample * sample
    if (index > 0 && (sample >= 0) !== (previous >= 0)) crosses += 1
    low += lowAlpha * (sample - low)
    highState += highAlpha * (sample - highState)
    const high = sample - highState
    lowEnergy += low * low
    highEnergy += high * high
    previous = sample
  }

  return {
    rms: Math.sqrt(sum / Math.max(1, count)),
    bass: lowEnergy / Math.max(sum, 1e-8),
    high: highEnergy / Math.max(sum, 1e-8),
    zcr: crosses / Math.max(1, count),
  }
}

function span(values) {
  if (!values.length) return { lo: 0, hi: 1 }
  const sorted = values.slice().sort((left, right) => left - right)
  const pick = (percent) => sorted[Math.min(sorted.length - 1, Math.round(percent * (sorted.length - 1)))]
  const lo = pick(0.1)
  const hi = pick(0.9)
  return { lo, hi: hi <= lo ? lo + 1e-4 : hi }
}

export function unit(value, range) {
  const width = range.hi - range.lo
  if (width <= 1e-8) return 0.5
  return Math.min(1, Math.max(0, (value - range.lo) / width))
}

export function profileFromChannel(channel, sampleRate) {
  const win = Math.max(256, Math.floor(sampleRate * 0.05))
  const rms = []
  const bass = []
  const high = []
  const zcr = []

  for (let start = 0; start + win <= channel.length; start += win) {
    const features = windowFeatures(channel.subarray(start, start + win), sampleRate)
    rms.push(features.rms)
    bass.push(features.bass)
    high.push(features.high)
    zcr.push(features.zcr)
  }

  return {
    rms: span(rms),
    bass: span(bass),
    high: span(high),
    zcr: span(zcr),
    timeline: {
      hop: win / sampleRate,
      rms: Float32Array.from(rms),
      bass: Float32Array.from(bass),
      high: Float32Array.from(high),
      zcr: Float32Array.from(zcr),
    },
  }
}

export function metricsAt(profile, time) {
  const timeline = profile?.timeline
  if (!timeline?.rms?.length) return null
  const index = Math.min(timeline.rms.length - 1, Math.max(0, Math.floor(time / timeline.hop)))
  return {
    loud: unit(timeline.rms[index], profile.rms),
    bass: unit(timeline.bass[index], profile.bass),
    high: unit(timeline.high[index], profile.high),
    harsh: unit(timeline.zcr[index], profile.zcr),
  }
}

export async function profileTrack(file) {
  const context = new AudioContext()
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer())
    const channel = new Float32Array(buffer.length)
    for (let index = 0; index < buffer.numberOfChannels; index += 1) {
      const data = buffer.getChannelData(index)
      for (let sample = 0; sample < buffer.length; sample += 1) {
        channel[sample] += data[sample] / buffer.numberOfChannels
      }
    }
    return profileFromChannel(channel, buffer.sampleRate)
  } finally {
    await context.close().catch(() => {})
  }
}
