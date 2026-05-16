const fs = require('fs');
const path = require('path');

function writeWav(filename, buffer, sampleRate) {
    const length = buffer.length * 2;
    const wav = Buffer.alloc(44 + length);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + length, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(length, 40);

    for (let i = 0; i < buffer.length; i++) {
        const s = Math.max(-1, Math.min(1, buffer[i]));
        wav.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, 44 + i * 2);
    }
    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filename, wav);
}

const sampleRate = 44100;

function generateKeys(freq, type = 'sine') {
    const duration = 1.0;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 4);
        let val = 0;
        if (type === 'sine') val = Math.sin(2 * Math.PI * freq * t);
        if (type === 'epiano') {
            val = Math.sin(2 * Math.PI * freq * t) * 0.6;
            val += Math.sin(2 * Math.PI * freq * 2 * t) * 0.2;
            val += Math.sin(2 * Math.PI * freq * 3 * t) * 0.1;
        }
        buffer[i] = val * env * 0.5;
    }
    return buffer;
}

function generateStrings(freq) {
    const duration = 2.0;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        // Ensemble effect: multiple detuned saws
        let val = 0;
        const oscillators = 3;
        for (let j = 0; j < oscillators; j++) {
            const detune = 1.0 + (j - 1) * 0.005;
            const phase = (t * freq * detune) % 1.0;
            val += (phase * 2 - 1);
        }
        // Envelope: slow attack and release
        const attack = Math.min(1, t / 0.5);
        const release = Math.max(0, 1 - (t - 1.5) / 0.5);
        const env = attack * (t < 1.5 ? 1 : release);
        buffer[i] = (val / oscillators) * env * 0.4;
    }
    return buffer;
}

function generateLead(freq) {
    const duration = 1.0;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        // Square wave
        const val = Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1;
        const env = Math.exp(-t * 2);
        buffer[i] = val * env * 0.3;
    }
    return buffer;
}

function generatePad(freq) {
    const duration = 3.0;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        // Soft sine with noise
        const val = Math.sin(2 * Math.PI * freq * t) + (Math.random() * 2 - 1) * 0.05;
        const attack = Math.min(1, t / 1.0);
        const release = Math.max(0, 1 - (t - 2.0) / 1.0);
        const env = attack * (t < 2.0 ? 1 : release);
        buffer[i] = val * env * 0.3;
    }
    return buffer;
}

function generatePercussion(type) {
    const duration = 0.3;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        let val = 0;
        if (type === 'rimshot') {
            val = (Math.random() * 2 - 1) * Math.exp(-t * 50);
            val += Math.sin(2 * Math.PI * 800 * t) * Math.exp(-t * 100);
        } else if (type === 'block') {
            val = Math.sin(2 * Math.PI * 1200 * t) * Math.exp(-t * 30);
        }
        buffer[i] = val * 0.5;
    }
    return buffer;
}

const baseDir = 'src/renderer/public/audio/Starter Pack';

console.log('Generating Library...');

// Keys
writeWav(`${baseDir}/Keys/epiano_dream.wav`, generateKeys(440, 'epiano'), sampleRate);
writeWav(`${baseDir}/Keys/soft_tines.wav`, generateKeys(330, 'epiano'), sampleRate);

// Strings
writeWav(`${baseDir}/Strings/cello_ens.wav`, generateStrings(110), sampleRate);
writeWav(`${baseDir}/Strings/violin_ens.wav`, generateStrings(440), sampleRate);

// Leads
writeWav(`${baseDir}/Leads/saw_lead.wav`, generateLead(440), sampleRate);
writeWav(`${baseDir}/Leads/square_buzz.wav`, generateLead(220), sampleRate);

// Pads
writeWav(`${baseDir}/Pads/ambient_swell.wav`, generatePad(220), sampleRate);
writeWav(`${baseDir}/Pads/cloud_textures.wav`, generatePad(330), sampleRate);

// Percussion
writeWav(`${baseDir}/Percussion/rimshot.wav`, generatePercussion('rimshot'), sampleRate);
writeWav(`${baseDir}/Percussion/wood_block.wav`, generatePercussion('block'), sampleRate);

console.log('Library generation complete.');
