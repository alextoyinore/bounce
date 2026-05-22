const fs = require('fs')
const path = require('path')

function writeWav(filename, buffer, sampleRate) {
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
  const dir = path.dirname(filename)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filename, wav)
}

const sampleRate = 44100

function generateKeys(freq, type = 'sine') {
  const duration = 1.0
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const env = Math.exp(-t * 4)
    let val = 0
    if (type === 'sine') val = Math.sin(2 * Math.PI * freq * t)
    if (type === 'epiano') {
      val = Math.sin(2 * Math.PI * freq * t) * 0.6
      val += Math.sin(2 * Math.PI * freq * 2 * t) * 0.2
      val += Math.sin(2 * Math.PI * freq * 3 * t) * 0.1
    }
    buffer[i] = val * env * 0.5
  }
  return buffer
}

function generateStrings(freq) {
  const duration = 2.0
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    // Ensemble effect: multiple detuned saws
    let val = 0
    const oscillators = 3
    for (let j = 0; j < oscillators; j++) {
      const detune = 1.0 + (j - 1) * 0.005
      const phase = (t * freq * detune) % 1.0
      val += phase * 2 - 1
    }
    // Envelope: slow attack and release
    const attack = Math.min(1, t / 0.5)
    const release = Math.max(0, 1 - (t - 1.5) / 0.5)
    const env = attack * (t < 1.5 ? 1 : release)
    buffer[i] = (val / oscillators) * env * 0.4
  }
  return buffer
}

function generateLead(freq) {
  const duration = 1.0
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    // Square wave
    const val = Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1
    const env = Math.exp(-t * 2)
    buffer[i] = val * env * 0.3
  }
  return buffer
}

function generatePad(freq) {
  const duration = 3.0
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    // Soft sine with noise
    const val = Math.sin(2 * Math.PI * freq * t) + (Math.random() * 2 - 1) * 0.05
    const attack = Math.min(1, t / 1.0)
    const release = Math.max(0, 1 - (t - 2.0) / 1.0)
    const env = attack * (t < 2.0 ? 1 : release)
    buffer[i] = val * env * 0.3
  }
  return buffer
}

function generatePercussion(type) {
  const duration = type === 'tambourine' ? 0.4 : 0.3
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    let val = 0
    if (type === 'rimshot') {
      val = (Math.random() * 2 - 1) * Math.exp(-t * 50)
      val += Math.sin(2 * Math.PI * 800 * t) * Math.exp(-t * 100)
    } else if (type === 'block') {
      val = Math.sin(2 * Math.PI * 1200 * t) * Math.exp(-t * 30)
    } else if (type.includes('conga') || type.includes('bongo')) {
      // Membrane modeling: Fundamental + non-harmonic overtones
      let freq = 200
      if (type === 'conga_hi') freq = 300
      if (type === 'conga_lo') freq = 180
      if (type === 'bongo_hi') freq = 500
      if (type === 'bongo_lo') freq = 350

      const modes = [1, 1.5, 2.1, 2.9] // Non-harmonic modes
      const weights = [1, 0.4, 0.2, 0.1]
      for (let m = 0; m < modes.length; m++) {
        val +=
          weights[m] * Math.sin(2 * Math.PI * freq * modes[m] * t) * Math.exp(-t * (15 + m * 10))
      }
      // Strike transient
      val += (Math.random() * 2 - 1) * Math.exp(-t * 150) * 0.3
    } else if (type === 'tambourine') {
      val = (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.4
      val += Math.sin(2 * Math.PI * 6000 * t) * Math.exp(-t * 60) * 0.2
      val += Math.sin(2 * Math.PI * 8000 * t) * Math.exp(-t * 80) * 0.2
    }
    buffer[i] = val * 0.5
  }
  return buffer
}

function generateBrass(freq, options = {}) {
  const {
    duration = 1.0,
    attack = 0.02,
    decay = 0.1,
    sustain = 0.3,
    release = 0.1,
    brightness = 1.0
  } = options

  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)

  const detune = 0.005

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate

    let val = 0
    // Multiple detuned saws for rich texture
    val += ((t * freq * (1 - detune)) % 1.0) * 2 - 1
    val += ((t * freq) % 1.0) * 2 - 1
    val += ((t * freq * (1 + detune)) % 1.0) * 2 - 1
    val /= 3

    // Dynamic filter envelope
    const filterEnv = Math.exp(-t * (8 / brightness)) * 0.7 + 0.3
    val *= filterEnv

    // ADSR Envelope
    let env = 0
    if (t < attack) {
      env = t / attack
    } else if (t < attack + decay) {
      env = 1 - (1 - sustain) * ((t - attack) / decay)
    } else if (t < duration - release) {
      env = sustain
    } else {
      const relStart = duration - release
      env = sustain * Math.max(0, 1 - (t - relStart) / release)
    }

    // Soft clipping for warmth
    val = Math.tanh(val * 1.2)

    buffer[i] = val * env * 0.4
  }
  return buffer
}

function generatePlucked(freq) {
  const duration = 1.0
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    // Sine with harmonics that decay at different rates
    let val = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 4)
    val += 0.5 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-t * 8)
    val += 0.25 * Math.sin(2 * Math.PI * freq * 3 * t) * Math.exp(-t * 12)

    // Pluck transient
    val += (Math.random() * 2 - 1) * Math.exp(-t * 200) * 0.2
    buffer[i] = val * 0.5
  }
  return buffer
}

function generateDrum(type, variant = 'classic') {
  let duration = 0.3
  if (type === 'hihat') duration = 0.15
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    let val = 0

    if (type === 'kick') {
      const freq = variant === 'heavy' ? 40 : variant === 'tight' ? 60 : 50
      const freqEnv = freq * (1 + Math.exp(-t * 30) * 2)
      val = Math.sin(2 * Math.PI * freqEnv * t) * Math.exp(-t * 10)
      if (variant === 'heavy') val = Math.tanh(val * 1.5)
      val += (Math.random() * 2 - 1) * Math.exp(-t * 100) * 0.1 // Click
    } else if (type === 'snare') {
      const popFreq = variant === 'cracker' ? 240 : 180
      const pop = Math.sin(2 * Math.PI * popFreq * t) * Math.exp(-t * 30)
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 15)
      val = pop * 0.5 + noise * 0.5
      if (variant === 'electronic') val = Math.tanh(val * 1.2)
    } else if (type === 'hihat') {
      const noise = Math.random() * 2 - 1
      // High pass
      const env = Math.exp(-t * (variant === 'open' ? 10 : 60))
      val = noise * env
    }

    buffer[i] = val * 0.5
  }
  return buffer
}

function generate808(type) {
  const duration = type === 'kick' ? 1.5 : 0.4
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    let val = 0

    if (type === 'kick') {
      const freqEnv = 55 * (1 + Math.exp(-t * 50) * 4)
      val = Math.sin(2 * Math.PI * freqEnv * t) * Math.exp(-t * 2)
      val = Math.tanh(val * 1.1)
    } else if (type === 'snare') {
      const pop = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 40)
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 20)
      val = pop * 0.4 + noise * 0.6
    } else if (type === 'clap') {
      for (let b = 0; b < 3; b++) {
        const bt = b * 0.01
        if (t >= bt) val += (Math.random() * 2 - 1) * Math.exp(-(t - bt) * 150)
      }
      val += (Math.random() * 2 - 1) * Math.exp(-t * 20) * 0.5
    } else if (type === 'cowbell') {
      const f1 = 540,
        f2 = 800
      val =
        (Math.sign(Math.sin(2 * Math.PI * f1 * t)) + Math.sign(Math.sin(2 * Math.PI * f2 * t))) *
        0.5
      val *= Math.exp(-t * 15)
    }

    buffer[i] = val * 0.5
  }
  return buffer
}

function generateBassHit(options = {}) {
  const {
    duration = 1.0,
    freq = 50,
    decay = 4,
    pitchDrop = 0.5,
    distortion = 0,
    noiseAmount = 0.1,
    harmonics = 0
  } = options

  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const currentFreq = freq * (1 + Math.exp(-t * 20) * pitchDrop)
    const phase = 2 * Math.PI * currentFreq * t
    let val = Math.sin(phase)
    if (harmonics > 0) {
      val += 0.3 * Math.sin(phase * 2)
      val += 0.1 * Math.sin(phase * 3)
    }
    if (distortion > 0) {
      val *= 1 + distortion
      val = Math.tanh(val)
    }
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 50) * noiseAmount
    const env = Math.exp(-t * decay)
    buffer[i] = (val + noise) * env * 0.6
  }
  return buffer
}

function generateCrash(type = 'normal') {
  const duration = 2.0
  const numSamples = Math.floor(sampleRate * duration)
  const buffer = new Float32Array(numSamples)

  // Envelope parameters
  const attack = type === 'soft' ? 0.025 : 0.003 // Softer attack for soft crash (25ms instead of 3ms)
  const attackSamples = Math.round(attack * sampleRate)
  const decaySamples = numSamples - attackSamples

  // Metallic partial frequencies (Hz)
  let partials
  if (type === 'soft') {
    partials = [
      { f: 1000, amp: 0.05 },
      { f: 2800, amp: 0.08 },
      { f: 4200, amp: 0.12 },
      { f: 5300, amp: 0.15 },
      { f: 6500, amp: 0.12 },
      { f: 8000, amp: 0.08 },
      { f: 10000, amp: 0.04 }
    ]
  } else {
    partials = [
      { f: 1200, amp: 0.08 },
      { f: 3100, amp: 0.12 },
      { f: 4700, amp: 0.18 },
      { f: 5800, amp: 0.22 },
      { f: 7300, amp: 0.2 },
      { f: 9100, amp: 0.16 },
      { f: 11400, amp: 0.12 },
      { f: 14000, amp: 0.08 }
    ]
  }

  const phases = partials.map(() => 0)

  for (let i = 0; i < numSamples; i++) {
    // Envelope: linear attack → exponential decay
    let env
    if (i < attackSamples) {
      env = i / attackSamples
    } else {
      const t = (i - attackSamples) / decaySamples
      // Faster decay for a soft/splashy crash
      const decayRate = type === 'soft' ? 7.5 : 5.5
      env = Math.exp(-decayRate * t)
    }

    // White noise component
    const noiseAmp = type === 'soft' ? 0.35 : 0.55
    let sample = (Math.random() * 2 - 1) * noiseAmp

    // Add metallic partials
    for (let p = 0; p < partials.length; p++) {
      phases[p] += (2 * Math.PI * partials[p].f) / sampleRate
      sample += Math.sin(phases[p]) * partials[p].amp
    }

    // Apply envelope
    buffer[i] = sample * env
  }

  // Normalization / scaling to prevent clipping
  let peak = 0
  for (let i = 0; i < numSamples; i++) {
    const absVal = Math.abs(buffer[i])
    if (absVal > peak) peak = absVal
  }

  const targetPeak = type === 'soft' ? 0.6 : 0.98 // Soft crash should be overall quieter
  const scale = peak > targetPeak ? targetPeak / peak : type === 'soft' ? targetPeak : 1

  for (let i = 0; i < numSamples; i++) {
    buffer[i] *= scale
  }

  return buffer
}

const baseDir = 'src/renderer/public/audio/Starter Pack'

console.log('Generating Library...')

// Keys
writeWav(`${baseDir}/Keys/epiano_dream.wav`, generateKeys(440, 'epiano'), sampleRate)
writeWav(`${baseDir}/Keys/soft_tines.wav`, generateKeys(330, 'epiano'), sampleRate)

// Strings
writeWav(`${baseDir}/Strings/cello_ens.wav`, generateStrings(110), sampleRate)
writeWav(`${baseDir}/Strings/violin_ens.wav`, generateStrings(440), sampleRate)

// Leads
writeWav(`${baseDir}/Leads/saw_lead.wav`, generateLead(440), sampleRate)
writeWav(`${baseDir}/Leads/square_buzz.wav`, generateLead(220), sampleRate)

// Pads
writeWav(`${baseDir}/Pads/ambient_swell.wav`, generatePad(220), sampleRate)
writeWav(`${baseDir}/Pads/cloud_textures.wav`, generatePad(330), sampleRate)

// Percussion
writeWav(`${baseDir}/Percussion/rimshot.wav`, generatePercussion('rimshot'), sampleRate)
writeWav(`${baseDir}/Percussion/wood_block.wav`, generatePercussion('block'), sampleRate)
writeWav(`${baseDir}/Percussion/conga_hi.wav`, generatePercussion('conga_hi'), sampleRate)
writeWav(`${baseDir}/Percussion/conga_lo.wav`, generatePercussion('conga_lo'), sampleRate)
writeWav(`${baseDir}/Percussion/bongo_hi.wav`, generatePercussion('bongo_hi'), sampleRate)
writeWav(`${baseDir}/Percussion/bongo_lo.wav`, generatePercussion('bongo_lo'), sampleRate)
writeWav(`${baseDir}/Percussion/tambourine.wav`, generatePercussion('tambourine'), sampleRate)

// Brass
writeWav(
  `${baseDir}/Brass/trumpet_hit.wav`,
  generateBrass(440, {
    duration: 0.4,
    attack: 0.01,
    decay: 0.1,
    sustain: 0.1,
    release: 0.05,
    brightness: 1.2
  }),
  sampleRate
)

writeWav(
  `${baseDir}/Brass/trombone_low.wav`,
  generateBrass(110, {
    duration: 1.2,
    attack: 0.05,
    decay: 0.3,
    sustain: 0.4,
    release: 0.2,
    brightness: 0.8
  }),
  sampleRate
)

writeWav(
  `${baseDir}/Brass/horn_stabs.wav`,
  generateBrass(220, {
    duration: 0.6,
    attack: 0.03,
    decay: 0.15,
    sustain: 0.2,
    release: 0.1,
    brightness: 1.0
  }),
  sampleRate
)

writeWav(
  `${baseDir}/Brass/tuba_low.wav`,
  generateBrass(55, {
    duration: 1.5,
    attack: 0.08,
    decay: 0.4,
    sustain: 0.5,
    release: 0.3,
    brightness: 0.6
  }),
  sampleRate
)

writeWav(
  `${baseDir}/Brass/brass_ensemble.wav`,
  generateBrass(220, {
    duration: 2.0,
    attack: 0.1,
    decay: 0.5,
    sustain: 0.6,
    release: 0.5,
    brightness: 0.9
  }),
  sampleRate
)

// Plucked
writeWav(`${baseDir}/Plucked/guitar_pluck.wav`, generatePlucked(196), sampleRate) // G3
writeWav(`${baseDir}/Plucked/harp_string.wav`, generatePlucked(440), sampleRate) // A4
writeWav(`${baseDir}/Plucked/pizzicato.wav`, generatePlucked(330), sampleRate) // E4

// Drum Kit
writeWav(`${baseDir}/Drum Kit/kick_classic.wav`, generateDrum('kick', 'classic'), sampleRate)
writeWav(`${baseDir}/Drum Kit/kick_heavy.wav`, generateDrum('kick', 'heavy'), sampleRate)
writeWav(`${baseDir}/Drum Kit/kick_tight.wav`, generateDrum('kick', 'tight'), sampleRate)
writeWav(`${baseDir}/Drum Kit/snare_acoustic.wav`, generateDrum('snare', 'acoustic'), sampleRate)
writeWav(
  `${baseDir}/Drum Kit/snare_electronic.wav`,
  generateDrum('snare', 'electronic'),
  sampleRate
)
writeWav(`${baseDir}/Drum Kit/snare_cracker.wav`, generateDrum('snare', 'cracker'), sampleRate)
writeWav(`${baseDir}/Drum Kit/hihat_closed.wav`, generateDrum('hihat', 'closed'), sampleRate)
writeWav(`${baseDir}/Drum Kit/hihat_open.wav`, generateDrum('hihat', 'open'), sampleRate)
writeWav(`${baseDir}/Drum Kit/crash.wav`, generateCrash('normal'), sampleRate)
writeWav(`${baseDir}/Drum Kit/crash_soft.wav`, generateCrash('soft'), sampleRate)

// 808
writeWav(`${baseDir}/808/808_kick.wav`, generate808('kick'), sampleRate)
writeWav(`${baseDir}/808/808_snare.wav`, generate808('snare'), sampleRate)
writeWav(`${baseDir}/808/808_clap.wav`, generate808('clap'), sampleRate)
writeWav(`${baseDir}/808/808_cowbell.wav`, generate808('cowbell'), sampleRate)

// Hits
writeWav(
  `${baseDir}/Hits/bass_hit_deep.wav`,
  generateBassHit({
    freq: 45,
    decay: 3,
    pitchDrop: 0.3,
    noiseAmount: 0.05
  }),
  sampleRate
)

writeWav(
  `${baseDir}/Hits/bass_hit_808.wav`,
  generateBassHit({
    freq: 55,
    decay: 1.5,
    pitchDrop: 1.0,
    noiseAmount: 0.1,
    harmonics: 1
  }),
  sampleRate
)

writeWav(
  `${baseDir}/Hits/bass_hit_heavy.wav`,
  generateBassHit({
    freq: 40,
    decay: 5,
    pitchDrop: 0.2,
    distortion: 0.8,
    noiseAmount: 0.2
  }),
  sampleRate
)

writeWav(
  `${baseDir}/Hits/bass_hit_cinematic.wav`,
  generateBassHit({
    freq: 35,
    decay: 6,
    pitchDrop: 0.1,
    noiseAmount: 0.3,
    harmonics: 1
  }),
  sampleRate
)

console.log('Library generation complete.')
