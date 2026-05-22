const fs = require('fs')

function writeWav(filename, buffer, sampleRate) {
  if (fs.existsSync(filename)) {
    return
  }
  const length = buffer.length * 2
  const wav = Buffer.alloc(44 + length)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + length, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(length, 40)

  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]))
    wav.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2)
  }
  fs.writeFileSync(filename, wav)
}

const sampleRate = 44100

function generateClap() {
  const duration = 0.2
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)

  // Clap is multiple bursts
  const bursts = 3
  const burstInterval = 0.01 // 10ms

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    let noise = Math.random() * 2 - 1

    // Multiple attacks
    let env = 0
    for (let b = 0; b < bursts; b++) {
      const burstTime = b * burstInterval
      if (t >= burstTime) {
        env += Math.exp(-(t - burstTime) / 0.005)
      }
    }

    // Main tail (shorter for "dry" sound)
    const mainTail = Math.exp(-t / 0.04)
    env = env * 0.5 + mainTail * 0.5

    // Band-pass filter approximation (roughly 1kHz - 2kHz)
    // Just a simple smoothing for less "electronic" harshness
    buffer[i] = noise * env * 0.6
  }
  return buffer
}

function generateShaker() {
  const duration = 0.1
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)

  let lastNoise = 0
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const white = Math.random() * 2 - 1
    // High pass
    const hp = white - lastNoise
    lastNoise = white

    // Softer attack for shaker
    const attack = Math.min(1, t / 0.02)
    const decay = Math.exp(-t / 0.03)

    buffer[i] = hp * attack * decay * 0.5
  }
  return buffer
}

function generateTom(frequency, decayTime) {
  const duration = 0.5
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate

    // Pitch envelope: starts high and drops
    const freqEnv = frequency * (1 + Math.exp(-t / 0.05) * 0.5)
    const phase = 2 * Math.PI * freqEnv * t

    // Sine wave with some harmonics for "land" feel
    let signal = Math.sin(phase)
    signal += 0.2 * Math.sin(phase * 2) // oct higher

    // Amplitude envelope
    const env = Math.exp(-t / decayTime)
    const click = Math.exp(-t / 0.005) * 0.3 // transient

    buffer[i] = (signal * env + click * (Math.random() * 2 - 1)) * 0.7
  }
  return buffer
}

const dir = 'src/renderer/public/audio/Starter Pack/Drum Kit'
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

console.log('Generating samples...')

writeWav(`${dir}/clap.wav`, generateClap(), sampleRate)
console.log('- clap.wav generated (dryer)')

writeWav(`${dir}/shaker.wav`, generateShaker(), sampleRate)
console.log('- shaker.wav generated (cleaner)')

writeWav(`${dir}/tom_hi.wav`, generateTom(180, 0.2), sampleRate)
console.log('- tom_hi.wav generated')

writeWav(`${dir}/tom_mid.wav`, generateTom(120, 0.3), sampleRate)
console.log('- tom_mid.wav generated')

// Keep original tom as tom_low or floor_tom?
// User said "it seems it's land tom", so I'll rename or overwrite tom.wav with a better "mid/low" one
writeWav(`${dir}/tom.wav`, generateTom(90, 0.4), sampleRate)
console.log('- tom.wav updated (low tom)')

console.log('All samples generated in', dir)
