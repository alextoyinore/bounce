/**
 * generate-crash-samples.js
 * Synthesizes a realistic crash cymbal WAV (44100 Hz, 16-bit, mono, ~2s)
 * and writes it to every drum-kit folder in the Bounce library that is
 * missing a crash.wav file.
 *
 * Usage:
 *   node scripts/generate-crash-samples.js
 *
 * The library root is resolved via the same logic the Electron main process uses:
 *   <documents>/Bounce/library
 */

const fs   = require('fs')
const path = require('path')
const os   = require('os')

// ── WAV helpers ──────────────────────────────────────────────────────────────

function writeInt32LE(buf, offset, value) {
  buf[offset]     = (value)       & 0xff
  buf[offset + 1] = (value >> 8)  & 0xff
  buf[offset + 2] = (value >> 16) & 0xff
  buf[offset + 3] = (value >> 24) & 0xff
}

function writeInt16LE(buf, offset, value) {
  buf[offset]     = (value)      & 0xff
  buf[offset + 1] = (value >> 8) & 0xff
}

function buildWavHeader(numSamples, sampleRate, numChannels, bitsPerSample) {
  const byteRate   = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize   = numSamples * numChannels * (bitsPerSample / 8)
  const fileSize   = 36 + dataSize

  const header = Buffer.alloc(44)
  // RIFF chunk
  header.write('RIFF', 0)
  writeInt32LE(header, 4, fileSize)
  header.write('WAVE', 8)
  // fmt sub-chunk
  header.write('fmt ', 12)
  writeInt32LE(header, 16, 16)               // sub-chunk size
  writeInt16LE(header, 20, 1)                // PCM = 1
  writeInt16LE(header, 22, numChannels)
  writeInt32LE(header, 24, sampleRate)
  writeInt32LE(header, 28, byteRate)
  writeInt16LE(header, 32, blockAlign)
  writeInt16LE(header, 34, bitsPerSample)
  // data sub-chunk
  header.write('data', 36)
  writeInt32LE(header, 40, dataSize)
  return header
}

// ── Crash cymbal synthesis ───────────────────────────────────────────────────
//
// A crash cymbal is characterised by:
//   • Broadband (white) noise shaped through a fast-attack / slow-decay envelope
//   • A cluster of metallic partials centred around 5–12 kHz
//   • A short "ping" transient in the first 15 ms

function synthesizeCrash(sampleRate = 44100, durationSec = 2.0) {
  const numSamples = Math.round(sampleRate * durationSec)
  const samples    = new Float32Array(numSamples)

  // Envelope parameters
  const attackSamples  = Math.round(0.003 * sampleRate)   // 3 ms
  const decaySamples   = numSamples - attackSamples

  // Metallic partial frequencies (Hz) – simulates a real crash cymbal body
  const partials = [
    { f: 1200,  amp: 0.08 },
    { f: 3100,  amp: 0.12 },
    { f: 4700,  amp: 0.18 },
    { f: 5800,  amp: 0.22 },
    { f: 7300,  amp: 0.20 },
    { f: 9100,  amp: 0.16 },
    { f: 11400, amp: 0.12 },
    { f: 14000, amp: 0.08 },
  ]

  // Phase accumulators for each partial
  const phases = partials.map(() => 0)

  for (let i = 0; i < numSamples; i++) {
    // Envelope: linear attack → exponential decay
    let env
    if (i < attackSamples) {
      env = i / attackSamples
    } else {
      const t = (i - attackSamples) / decaySamples
      env = Math.exp(-5.5 * t)   // decay constant → ~zero at 2 s
    }

    // White noise component
    let sample = (Math.random() * 2 - 1) * 0.55

    // Add metallic partials
    for (let p = 0; p < partials.length; p++) {
      phases[p] += (2 * Math.PI * partials[p].f) / sampleRate
      sample    += Math.sin(phases[p]) * partials[p].amp
    }

    // Apply envelope
    samples[i] = sample * env
  }

  // Soft-clip / normalise to prevent clipping
  let peak = 0
  for (let i = 0; i < numSamples; i++) peak = Math.max(peak, Math.abs(samples[i]))
  const scale = peak > 0.98 ? 0.98 / peak : 1
  for (let i = 0; i < numSamples; i++) samples[i] *= scale

  return samples
}

function float32To16BitPCM(floatSamples) {
  const buf = Buffer.alloc(floatSamples.length * 2)
  for (let i = 0; i < floatSamples.length; i++) {
    const s   = Math.max(-1, Math.min(1, floatSamples[i]))
    const val = s < 0 ? s * 0x8000 : s * 0x7fff
    writeInt16LE(buf, i * 2, Math.round(val))
  }
  return buf
}

function buildCrashWav() {
  const SAMPLE_RATE = 44100
  const samples     = synthesizeCrash(SAMPLE_RATE, 2.0)
  const pcm         = float32To16BitPCM(samples)
  const header      = buildWavHeader(samples.length, SAMPLE_RATE, 1, 16)
  return Buffer.concat([header, pcm])
}

// ── Filesystem scanning ──────────────────────────────────────────────────────

function getLibraryPath() {
  const docs = path.join(os.homedir(), 'Documents')
  return path.join(docs, 'Bounce', 'library')
}

/**
 * Returns true if the given directory looks like a "drum kit" folder:
 * it contains at least one of the canonical kick / snare / hi-hat names.
 */
function isDrumKitDir(dirPath) {
  try {
    const files = fs.readdirSync(dirPath).map(f => f.toLowerCase())
    const signatures = ['kick', 'snare', 'hihat', 'hi-hat', 'hat', 'clap', 'tom']
    return signatures.some(sig => files.some(f => f.includes(sig)))
  } catch {
    return false
  }
}

function scanAndFix(libraryPath, wavBuffer) {
  if (!fs.existsSync(libraryPath)) {
    console.log(`Library not found at: ${libraryPath}`)
    console.log('Launch Bounce at least once so the library folder is created, then re-run this script.')
    return
  }

  let fixed = 0

  const packs = fs.readdirSync(libraryPath, { withFileTypes: true })
    .filter(d => d.isDirectory())

  for (const pack of packs) {
    const packPath = path.join(libraryPath, pack.name)

    // Check pack root itself
    if (isDrumKitDir(packPath)) {
      const crashPath = path.join(packPath, 'crash.wav')
      if (!fs.existsSync(crashPath) || fs.statSync(crashPath).size < 100) {
        fs.writeFileSync(crashPath, wavBuffer)
        console.log(`  ✓ Written: ${crashPath}`)
        fixed++
      }
    }

    // Check one level of sub-directories (e.g. "Starter Pack / Drum Kit 1 / …")
    try {
      const subDirs = fs.readdirSync(packPath, { withFileTypes: true })
        .filter(d => d.isDirectory())
      for (const sub of subDirs) {
        const subPath = path.join(packPath, sub.name)
        if (isDrumKitDir(subPath)) {
          const crashPath = path.join(subPath, 'crash.wav')
          if (!fs.existsSync(crashPath) || fs.statSync(crashPath).size < 100) {
            fs.writeFileSync(crashPath, wavBuffer)
            console.log(`  ✓ Written: ${crashPath}`)
            fixed++
          }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  if (fixed === 0) {
    console.log('No missing crash.wav files found – everything looks good.')
  } else {
    console.log(`\nDone. Fixed ${fixed} missing crash sample(s).`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

;(function main() {
  const libraryPath = getLibraryPath()
  console.log(`Scanning library: ${libraryPath}\n`)

  const wavBuffer = buildCrashWav()
  scanAndFix(libraryPath, wavBuffer)
})()
