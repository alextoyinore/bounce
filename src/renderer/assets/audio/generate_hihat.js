const fs = require('fs');

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
    fs.writeFileSync(filename, wav);
}

const sampleRate = 44100;

// High-pass White Noise Hi-Hat
const duration = 0.15;
const numSamples = Math.floor(sampleRate * duration);
const hihat = new Float32Array(numSamples);
let lastNoise = 0;
for (let i = 0; i < numSamples; i++) {
    const white = Math.random() * 2 - 1;
    // Simple High Pass (difference)
    const hp = white - lastNoise;
    lastNoise = white;
    
    // Very fast decay envelope
    const env = Math.exp(-i / (sampleRate * 0.015));
    hihat[i] = hp * env * 0.5;
}

const dir = 'src/renderer/assets/audio/Starter Pack/Drum Kit';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
writeWav(`${dir}/hihat.wav`, hihat, sampleRate);
console.log('Regenerated hihat.wav');
