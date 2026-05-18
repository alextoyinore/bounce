const NOTE_TO_MIDI = { 'C':0, 'C#':1, 'D':2, 'D#':3, 'E':4, 'F':5, 'F#':6, 'G':7, 'G#':8, 'A':9, 'A#':10, 'B':11 };

export function parseNoteToMidi(noteName) {
  const match = noteName.match(/^([A-G]#?)(-?\d+)$/i);
  if (!match) return 60; // Default C4
  const note = match[1].toUpperCase();
  const oct = parseInt(match[2]);
  return (oct + 1) * 12 + NOTE_TO_MIDI[note];
}

export function parseNoteToFrequency(noteName) {
  const midi = parseNoteToMidi(noteName);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Synthetic Impulse Response generator for Reverb
function createImpulseResponse(ctx, duration=2, decay=2.0) {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.round(sampleRate * duration));
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const n = 1 - i / length;
    left[i] = (Math.random() * 2 - 1) * Math.pow(n, decay);
    right[i] = (Math.random() * 2 - 1) * Math.pow(n, decay);
  }
  return impulse;
}

function createEffectNodes(ctx, type) {
  const fxObj = { id: Math.random().toString(36).substr(2, 9), type, name: type };
  let inputNode, outputNode, params, updateParams;

  if (type === 'reverb') {
    fxObj.name = 'Reverb';
    let convolver = ctx.createConvolver();
    const dryNode = ctx.createGain();
    const wetNode = ctx.createGain();
    inputNode = ctx.createGain();
    outputNode = ctx.createGain();

    inputNode.connect(dryNode);
    inputNode.connect(convolver);
    convolver.connect(wetNode);
    dryNode.connect(outputNode);
    wetNode.connect(outputNode);

    params = { mix: 0.3, size: 2.0, decay: 2.0 };
    convolver.buffer = createImpulseResponse(ctx, params.size, params.decay);
    dryNode.gain.value = 1 - params.mix;
    wetNode.gain.value = params.mix;

    updateParams = (newParams) => {
      if (newParams.mix !== undefined) {
        params.mix = newParams.mix;
        dryNode.gain.value = 1 - params.mix;
        wetNode.gain.value = params.mix;
      }
      if (newParams.size !== undefined || newParams.decay !== undefined) {
        if (newParams.size !== undefined) params.size = newParams.size;
        if (newParams.decay !== undefined) params.decay = newParams.decay;
        
        try {
          inputNode.disconnect(convolver);
          convolver.disconnect(wetNode);
        } catch(e) {}
        
        convolver = ctx.createConvolver();
        convolver.buffer = createImpulseResponse(ctx, params.size, params.decay);
        
        inputNode.connect(convolver);
        convolver.connect(wetNode);
      }
    };
  } 
  else if (type === 'delay') { 
    fxObj.name = 'Delay';
    inputNode = ctx.createGain();
    const delayNode = ctx.createDelay(5.0);
    const feedbackNode = ctx.createGain();
    const dryNode = ctx.createGain();
    const wetNode = ctx.createGain();
    outputNode = ctx.createGain();

    inputNode.connect(dryNode);
    inputNode.connect(delayNode);
    delayNode.connect(wetNode);
    delayNode.connect(feedbackNode);
    feedbackNode.connect(delayNode);
    dryNode.connect(outputNode);
    wetNode.connect(outputNode);

    params = { mix: 0.3, time: 0.3, feedback: 0.5 };
    dryNode.gain.value = 1 - params.mix;
    wetNode.gain.value = params.mix;
    delayNode.delayTime.value = params.time;
    feedbackNode.gain.value = params.feedback;

    updateParams = (newParams) => {
      if (newParams.mix !== undefined) {
        params.mix = newParams.mix;
        dryNode.gain.value = 1 - params.mix;
        wetNode.gain.value = params.mix;
      }
      if (newParams.time !== undefined) {
        params.time = newParams.time;
        delayNode.delayTime.setValueAtTime(params.time, ctx.currentTime);
      }
      if (newParams.feedback !== undefined) {
        params.feedback = newParams.feedback;
        feedbackNode.gain.setValueAtTime(params.feedback, ctx.currentTime);
      }
    };
  }
  else if (type === 'distortion') {
    fxObj.name = 'Distortion';
    inputNode = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const dryNode = ctx.createGain();
    const wetNode = ctx.createGain();
    outputNode = ctx.createGain();

    inputNode.connect(dryNode);
    inputNode.connect(shaper);
    shaper.connect(wetNode);
    dryNode.connect(outputNode);
    wetNode.connect(outputNode);

    params = { mix: 0.5, amount: 0.5 };
    dryNode.gain.value = 1 - params.mix;
    wetNode.gain.value = params.mix;
    shaper.curve = makeDistortionCurve(params.amount);
    shaper.oversample = '4x';

    updateParams = (newParams) => {
      if (newParams.mix !== undefined) {
        params.mix = newParams.mix;
        dryNode.gain.value = 1 - params.mix;
        wetNode.gain.value = params.mix;
      }
      if (newParams.amount !== undefined) {
        params.amount = newParams.amount;
        shaper.curve = makeDistortionCurve(params.amount);
      }
    };

    function makeDistortionCurve(amount) {
      const k = typeof amount === 'number' ? amount * 100 : 50;
      const n_samples = 44100;
      const curve = new Float32Array(n_samples);
      const deg = Math.PI / 180;
      for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
      }
      return curve;
    }
  }
  else if (type === 'compressor') {
    fxObj.name = 'Compressor';
    inputNode = ctx.createDynamicsCompressor();
    outputNode = inputNode;

    params = { threshold: -24.0, ratio: 12.0, attack: 0.003, release: 0.25 };
    inputNode.threshold.value = params.threshold;
    inputNode.ratio.value = params.ratio;
    inputNode.attack.value = params.attack;
    inputNode.release.value = params.release;

    updateParams = (newParams) => {
      if (newParams.threshold !== undefined) {
        params.threshold = newParams.threshold;
        inputNode.threshold.setValueAtTime(params.threshold, ctx.currentTime);
      }
      if (newParams.ratio !== undefined) {
        params.ratio = newParams.ratio;
        inputNode.ratio.setValueAtTime(params.ratio, ctx.currentTime);
      }
      if (newParams.attack !== undefined) {
        params.attack = newParams.attack;
        inputNode.attack.setValueAtTime(params.attack, ctx.currentTime);
      }
      if (newParams.release !== undefined) {
        params.release = newParams.release;
        inputNode.release.setValueAtTime(params.release, ctx.currentTime);
      }
    };
  }
  else if (type === 'eq') { 
    fxObj.name = 'Equalizer';
    inputNode = ctx.createBiquadFilter(); 
    inputNode.type = 'lowshelf'; 
    inputNode.frequency.value = 200;

    const midFilter = ctx.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 1.0;

    const highFilter = ctx.createBiquadFilter();
    highFilter.type = 'highshelf';
    highFilter.frequency.value = 5000;

    inputNode.connect(midFilter);
    midFilter.connect(highFilter);
    outputNode = highFilter;

    params = { low: 0.0, mid: 0.0, high: 0.0 };
    inputNode.gain.value = params.low;
    midFilter.gain.value = params.mid;
    highFilter.gain.value = params.high;

    updateParams = (newParams) => {
      if (newParams.low !== undefined) {
        params.low = newParams.low;
        inputNode.gain.setValueAtTime(params.low, ctx.currentTime);
      }
      if (newParams.mid !== undefined) {
        params.mid = newParams.mid;
        midFilter.gain.setValueAtTime(params.mid, ctx.currentTime);
      }
      if (newParams.high !== undefined) {
        params.high = newParams.high;
        highFilter.gain.setValueAtTime(params.high, ctx.currentTime);
      }
    };
  }
  else if (type === 'flanger') {
    fxObj.name = 'Flanger';
    inputNode  = ctx.createGain();
    outputNode = ctx.createGain();
    const dryNode = ctx.createGain();
    const wetNode = ctx.createGain();

    // Comb-filter: short delay modulated by LFO
    const delayNode    = ctx.createDelay(0.03);
    const feedbackNode = ctx.createGain();
    const lfo         = ctx.createOscillator();
    const lfoDepth    = ctx.createGain();

    lfo.type = 'sine';

    // Routing
    inputNode.connect(dryNode);
    inputNode.connect(delayNode);
    delayNode.connect(feedbackNode);
    feedbackNode.connect(delayNode);   // feedback loop
    delayNode.connect(wetNode);
    dryNode.connect(outputNode);
    wetNode.connect(outputNode);

    // LFO → delay time
    lfo.connect(lfoDepth);
    lfoDepth.connect(delayNode.delayTime);

    params = { mix: 0.5, rate: 0.3, depth: 0.003, feedback: 0.6, delay: 0.005 };
    dryNode.gain.value     = 1 - params.mix;
    wetNode.gain.value     = params.mix;
    delayNode.delayTime.value = params.delay;
    feedbackNode.gain.value   = params.feedback;
    lfo.frequency.value    = params.rate;
    lfoDepth.gain.value    = params.depth;
    lfo.start();

    updateParams = (newParams) => {
      if (newParams.mix !== undefined) {
        params.mix = newParams.mix;
        dryNode.gain.value = 1 - params.mix;
        wetNode.gain.value = params.mix;
      }
      if (newParams.rate !== undefined) {
        params.rate = newParams.rate;
        lfo.frequency.setValueAtTime(params.rate, ctx.currentTime);
      }
      if (newParams.depth !== undefined) {
        params.depth = newParams.depth;
        lfoDepth.gain.setValueAtTime(params.depth, ctx.currentTime);
      }
      if (newParams.feedback !== undefined) {
        params.feedback = Math.max(0, Math.min(0.95, newParams.feedback));
        feedbackNode.gain.setValueAtTime(params.feedback, ctx.currentTime);
      }
      if (newParams.delay !== undefined) {
        params.delay = newParams.delay;
        delayNode.delayTime.setValueAtTime(params.delay, ctx.currentTime);
      }
    };
  }
  else if (type === 'phaser') {
    fxObj.name = 'Phaser';
    inputNode  = ctx.createGain();
    outputNode = ctx.createGain();
    const dryNode  = ctx.createGain();
    const wetNode  = ctx.createGain();
    const lfo      = ctx.createOscillator();
    const lfoGain  = ctx.createGain();

    // Chain of all-pass filters whose cutoff is swept by the LFO
    const STAGES = 6;
    const allpasses = [];
    for (let i = 0; i < STAGES; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = 1000;
      ap.Q.value = 0.5;
      allpasses.push(ap);
    }

    // Connect all-pass chain
    let prev = inputNode;
    allpasses.forEach(ap => { prev.connect(ap); prev = ap; });
    const chainOut = allpasses[STAGES - 1];

    // Feedback from chain output back to chain input
    const feedbackNode = ctx.createGain();
    chainOut.connect(feedbackNode);
    feedbackNode.connect(allpasses[0]);

    inputNode.connect(dryNode);
    chainOut.connect(wetNode);
    dryNode.connect(outputNode);
    wetNode.connect(outputNode);

    // LFO → all-pass frequencies
    lfo.type = 'sine';
    lfo.connect(lfoGain);
    allpasses.forEach(ap => lfoGain.connect(ap.frequency));

    params = { mix: 0.5, rate: 0.5, depth: 800, feedback: 0.3, baseFreq: 1000 };
    dryNode.gain.value  = 1 - params.mix;
    wetNode.gain.value  = params.mix;
    lfo.frequency.value = params.rate;
    lfoGain.gain.value  = params.depth;
    feedbackNode.gain.value = params.feedback;
    allpasses.forEach(ap => { ap.frequency.value = params.baseFreq; });
    lfo.start();

    updateParams = (newParams) => {
      if (newParams.mix !== undefined) {
        params.mix = newParams.mix;
        dryNode.gain.value = 1 - params.mix;
        wetNode.gain.value = params.mix;
      }
      if (newParams.rate !== undefined) {
        params.rate = newParams.rate;
        lfo.frequency.setValueAtTime(params.rate, ctx.currentTime);
      }
      if (newParams.depth !== undefined) {
        params.depth = newParams.depth;
        lfoGain.gain.setValueAtTime(params.depth, ctx.currentTime);
      }
      if (newParams.feedback !== undefined) {
        params.feedback = Math.max(0, Math.min(0.95, newParams.feedback));
        feedbackNode.gain.setValueAtTime(params.feedback, ctx.currentTime);
      }
      if (newParams.baseFreq !== undefined) {
        params.baseFreq = newParams.baseFreq;
        allpasses.forEach(ap => ap.frequency.setValueAtTime(params.baseFreq, ctx.currentTime));
      }
    };
  }
  else {
    fxObj.name = type;
    inputNode = ctx.createGain();
    outputNode = inputNode;
    params = {};
    updateParams = () => {};
  }

  fxObj.inputNode = inputNode;
  fxObj.outputNode = outputNode;
  fxObj.node = inputNode;
  fxObj.params = params;
  fxObj.updateParams = updateParams;

  return fxObj;
}

class Track {
  constructor(audioContext, masterNode, name) {
    this.ctx = audioContext;
    this.masterNode = masterNode; // Store reference to masterNode
    this.name = name;
    
    // Create track nodes
    this.gainNode = this.ctx.createGain();
    this.pannerNode = this.ctx.createStereoPanner();
    this.pannerNode.pan.value = 0.0;
    this.pan = 0.0;
    
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 256;
    
    // Effects chain
    this.effects = [];
    this.inputNode = this.ctx.createGain(); // Sources connect here

    // Automation data: { 'volume': [{time, value}], 'pan': [], 'fx.<id>.<param>': [], 'gen.<param>': [] }
    this.automations = {};
    
    // State
    this.baseVolume = 0.8;
    this.isMuted = false;
    this.isSoloed = false;
    this.isArmed = false;
    
    // Generator default parameters
    this.generator = {
      type: 'sampler',
      params: {
        attack: 0.005,
        decay: 0.1,
        sustain: 1.0,
        release: 0.1,
        cutoff: 20000,
        resonance: 1.0,
        pitch: 0
      }
    };
    
    // Sampler Data
    this.instrumentBuffer = null;
    this.instrumentRootMidi = 60; // Default C4
    
    // Default values
    this.gainNode.gain.value = this.baseVolume; // default 80%
    
    // Initial routing
    this.rebuildChain();
  }

  setPan(value) {
    this.pan = Math.max(-1, Math.min(1, value));
    if (this.pannerNode && this.pannerNode.pan) {
      this.pannerNode.pan.setValueAtTime(this.pan, this.ctx.currentTime);
    }
  }

  rebuildChain() {
    this.inputNode.disconnect();
    this.effects.forEach(fx => { 
      // Do NOT disconnect fx.inputNode because it severs internal connections of the plugin!
      // Only disconnect outputs to clean up the chain routing.
      if (fx.outputNode) fx.outputNode.disconnect(); 
      if (fx.node && fx.node !== fx.inputNode) fx.node.disconnect(); // Fallback for old simple effects
    });
    this.analyserNode.disconnect();
    
    let lastNode = this.inputNode;
    this.effects.forEach(fx => {
      const inNode = fx.inputNode || fx.node;
      const outNode = fx.outputNode || fx.node;
      if (inNode && outNode) {
        lastNode.connect(inNode);
        lastNode = outNode;
      }
    });
    
    lastNode.connect(this.analyserNode);
    this.analyserNode.connect(this.gainNode);
    
    // Always disconnect and reconnect to the stored masterNode to ensure clean output routing
    try { this.gainNode.disconnect(); } catch (e) {}
    try { this.pannerNode.disconnect(); } catch (e) {}
    if (this.masterNode) {
      this.gainNode.connect(this.pannerNode);
      this.pannerNode.connect(this.masterNode);
    }
  }

  addEffect(type) {
    const fxObj = createEffectNodes(this.ctx, type);
    this.effects.push(fxObj);
    this.rebuildChain();
    return fxObj;
  }

  removeEffect(id) {
    const idx = this.effects.findIndex(fx => fx.id === id);
    if (idx !== -1) {
      const fx = this.effects[idx];
      if (fx.inputNode) fx.inputNode.disconnect();
      if (fx.outputNode) fx.outputNode.disconnect();
      if (fx.node) fx.node.disconnect();
      this.effects.splice(idx, 1);
      this.rebuildChain();
    }
  }

  setVolume(value) {
    // Value between 0.0 and 1.0
    this.baseVolume = value;
    // The actual gain value is managed by the engine's updateTrackVolumes
  }

  getPeakLevel() {
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteTimeDomainData(dataArray);
    
    let max = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = Math.abs(dataArray[i] - 128); // 128 is zero-crossing for 8-bit
      if (val > max) max = val;
    }
    
    // Return a normalized value 0.0 to 1.0 based on the peak
    return Math.min(max / 128, 1.0);
  }
}

class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Master routing
    this.masterGain = this.ctx.createGain();
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 256;
    
    this.masterGain.gain.value = 0.8; // Default master volume
    
    // Master effects
    this.effects = [];
    
    this.rebuildMasterChain();

    // Track registry
    this.tracks = new Map();
    this.soloedTracks = new Set();
    this.activeRecorders = new Map(); // trackId → { mediaRecorder, chunks, stream }
    
    console.log('AudioEngine initialized');
  }

  rebuildMasterChain() {
    this.masterGain.disconnect();
    this.effects.forEach(fx => {
      if (fx.outputNode) fx.outputNode.disconnect();
      if (fx.node && fx.node !== fx.inputNode) fx.node.disconnect();
    });
    this.masterAnalyser.disconnect();
    
    let lastNode = this.masterGain;
    this.effects.forEach(fx => {
      const inNode = fx.inputNode || fx.node;
      const outNode = fx.outputNode || fx.node;
      if (inNode && outNode) {
        lastNode.connect(inNode);
        lastNode = outNode;
      }
    });
    
    lastNode.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);
  }

  addEffect(type) {
    const fxObj = createEffectNodes(this.ctx, type);
    this.effects.push(fxObj);
    this.rebuildMasterChain();
    return fxObj;
  }

  removeEffect(id) {
    const idx = this.effects.findIndex(fx => fx.id === id);
    if (idx !== -1) {
      const fx = this.effects[idx];
      if (fx.inputNode) fx.inputNode.disconnect();
      if (fx.outputNode) fx.outputNode.disconnect();
      if (fx.node) fx.node.disconnect();
      this.effects.splice(idx, 1);
      this.rebuildMasterChain();
    }
  }

  updateTrackVolumes() {
    const isAnySoloed = this.soloedTracks.size > 0;
    
    for (const [id, track] of this.tracks.entries()) {
      if (isAnySoloed) {
        // If there are soloed tracks, only soloed tracks play
        track.gainNode.gain.value = track.isSoloed ? track.baseVolume : 0;
      } else {
        // If nothing is soloed, play based on mute state
        track.gainNode.gain.value = track.isMuted ? 0 : track.baseVolume;
      }
    }
  }

  toggleMute(id) {
    const track = this.getTrack(id);
    if (track) {
      track.isMuted = !track.isMuted;
      this.updateTrackVolumes();
      return track.isMuted;
    }
    return false;
  }

  toggleSolo(id) {
    const track = this.getTrack(id);
    if (track) {
      track.isSoloed = !track.isSoloed;
      if (track.isSoloed) {
        this.soloedTracks.add(id);
      } else {
        this.soloedTracks.delete(id);
      }
      this.updateTrackVolumes();
      return track.isSoloed;
    }
    return false;
  }

  toggleRecord(id) {
    const track = this.getTrack(id);
    if (track) {
      track.isArmed = !track.isArmed;
      return track.isArmed;
    }
    return false;
  }

  async resume() {
    // Browsers require user interaction to start audio context
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  createTrack(id, name) {
    const track = new Track(this.ctx, this.masterGain, name);
    this.tracks.set(id, track);
    return track;
  }

  getTrack(id) {
    return this.tracks.get(id);
  }

  removeTrack(id) {
    const track = this.tracks.get(id);
    if (track) {
      try { track.gainNode.disconnect(); } catch(e) {}
      try { track.analyserNode.disconnect(); } catch(e) {}
      this.soloedTracks.delete(id);
      this.tracks.delete(id);
    }
  }

  setMasterVolume(value) {
    this.masterGain.gain.value = value;
  }

  getMasterPeakLevel() {
    const dataArray = new Uint8Array(this.masterAnalyser.frequencyBinCount);
    this.masterAnalyser.getByteTimeDomainData(dataArray);
    
    let max = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = Math.abs(dataArray[i] - 128);
      if (val > max) max = val;
    }
    return Math.min(max / 128, 1.0);
  }

  async decodeAudioData(arrayBuffer) {
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  playPreview(audioBuffer) {
    if (this.previewSource) {
      try { this.previewSource.stop(); } catch(e) {}
    }
    this.previewSource = this.ctx.createBufferSource();
    this.previewSource.buffer = audioBuffer;
    this.previewSource.connect(this.masterGain);
    this.previewSource.start();
  }

  playNote(trackId, noteName, time, duration = 0) {
    const track = this.getTrack(trackId);
    if (!track) return null;
    
    const gen = track.generator || { type: 'sampler', params: { attack: 0.005, decay: 0.1, sustain: 1.0, release: 0.1, cutoff: 20000, resonance: 1.0, pitch: 0 } };
    const frequency = parseNoteToFrequency(noteName);
    const midiNote = parseNoteToMidi(noteName);
    const now = Math.max(time, this.ctx.currentTime);
    const noteDuration = duration > 0 ? duration : 0.2;
    
    if (gen.type === 'sampler') {
      if (!track.instrumentBuffer) return null;
      const pitchOffset = gen.params.pitch || 0;
      const semitones = (midiNote + pitchOffset) - track.instrumentRootMidi;
      const rate = Math.pow(2, semitones / 12);
      
      const source = this.ctx.createBufferSource();
      source.buffer = track.instrumentBuffer;
      source.playbackRate.value = rate;
      
      const envelope = this.ctx.createGain();
      const attack = gen.params.attack !== undefined ? gen.params.attack : 0.005;
      const decay = gen.params.decay !== undefined ? gen.params.decay : 0.1;
      const sustain = gen.params.sustain !== undefined ? gen.params.sustain : 1.0;
      const release = gen.params.release !== undefined ? gen.params.release : 0.1;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = gen.params.cutoff !== undefined ? gen.params.cutoff : 20000;
      filter.Q.value = gen.params.resonance !== undefined ? gen.params.resonance : 1.0;
      
      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(track.inputNode);
      
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(1.0, now + attack);
      envelope.gain.linearRampToValueAtTime(sustain, now + attack + decay);
      
      source.start(now);
      
      const releaseTime = now + noteDuration;
      envelope.gain.setValueAtTime(sustain, releaseTime);
      envelope.gain.linearRampToValueAtTime(0, releaseTime + release);
      source.stop(releaseTime + release);
      return source;
    }
    
    else if (gen.type === 'monosynth' || gen.type === 'polysynth') {
      const oscType = gen.params.oscType || 'sawtooth';
      const attack = gen.params.attack !== undefined ? gen.params.attack : 0.05;
      const decay = gen.params.decay !== undefined ? gen.params.decay : 0.2;
      const sustain = gen.params.sustain !== undefined ? gen.params.sustain : 0.6;
      const release = gen.params.release !== undefined ? gen.params.release : 0.3;
      const cutoff = gen.params.cutoff !== undefined ? gen.params.cutoff : 2000;
      const resonance = gen.params.resonance !== undefined ? gen.params.resonance : 1.0;
      
      // Main Oscillator
      const osc = this.ctx.createOscillator();
      osc.type = oscType;
      osc.frequency.setValueAtTime(frequency, now);
      
      // Secondary Oscillator (sub or detuned second voice)
      let subOsc = null;
      let osc2 = null;
      const synthGain = this.ctx.createGain();
      
      if (gen.type === 'monosynth') {
        // Add Sub-Oscillator (1 octave down triangle wave for bass thickness)
        const subAmt = gen.params.subOsc !== undefined ? gen.params.subOsc : 0.5;
        if (subAmt > 0) {
          subOsc = this.ctx.createOscillator();
          subOsc.type = 'triangle';
          subOsc.frequency.setValueAtTime(frequency / 2, now); // 1 octave down
          
          const subGain = this.ctx.createGain();
          subGain.gain.setValueAtTime(subAmt * 0.4, now);
          
          subOsc.connect(subGain);
          subGain.connect(synthGain);
        }
      } else if (gen.type === 'polysynth') {
        // Add detuned second oscillator for fat supersaw/superpoly voices
        const detuneVal = gen.params.detune !== undefined ? gen.params.detune : 10;
        if (detuneVal > 0) {
          osc2 = this.ctx.createOscillator();
          osc2.type = oscType;
          osc2.frequency.setValueAtTime(frequency, now);
          osc2.detune.setValueAtTime(detuneVal, now);
          
          const osc2Gain = this.ctx.createGain();
          osc2Gain.gain.setValueAtTime(0.3, now);
          
          osc2.connect(osc2Gain);
          osc2Gain.connect(synthGain);
        }
      }
      
      const envelope = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, now);
      filter.Q.setValueAtTime(resonance, now);
      
      // Connections
      osc.connect(synthGain);
      synthGain.connect(filter);
      filter.connect(envelope);
      envelope.connect(track.inputNode);
      
      // Amplitude envelope
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(0.4, now + attack); // Keep levels safe
      envelope.gain.linearRampToValueAtTime(sustain * 0.4, now + attack + decay);
      
      osc.start(now);
      if (subOsc) subOsc.start(now);
      if (osc2) osc2.start(now);
      
      const releaseTime = now + noteDuration;
      envelope.gain.setValueAtTime(sustain * 0.4, releaseTime);
      envelope.gain.linearRampToValueAtTime(0, releaseTime + release);
      
      osc.stop(releaseTime + release);
      if (subOsc) subOsc.stop(releaseTime + release);
      if (osc2) osc2.stop(releaseTime + release);
      
      return osc;
    }
    
    else if (gen.type === 'fmsynth') {
      const carrierType = gen.params.carrierType || 'sine';
      const modType = gen.params.modType || 'sine';
      const modIndex = gen.params.modIndex !== undefined ? gen.params.modIndex : 5;
      const modRatio = gen.params.modFreqRatio !== undefined ? gen.params.modFreqRatio : 2.0;
      
      const attack = gen.params.attack !== undefined ? gen.params.attack : 0.01;
      const decay = gen.params.decay !== undefined ? gen.params.decay : 0.2;
      const sustain = gen.params.sustain !== undefined ? gen.params.sustain : 0.8;
      const release = gen.params.release !== undefined ? gen.params.release : 0.4;
      
      // Carrier
      const carrier = this.ctx.createOscillator();
      carrier.type = carrierType;
      carrier.frequency.setValueAtTime(frequency, now);
      
      // Modulator
      const modulator = this.ctx.createOscillator();
      modulator.type = modType;
      modulator.frequency.setValueAtTime(frequency * modRatio, now);
      
      // Modulation Index Gain Node
      const modGain = this.ctx.createGain();
      modGain.gain.setValueAtTime(frequency * modRatio * modIndex, now);
      
      // Amp Envelope
      const envelope = this.ctx.createGain();
      
      // Modulator -> ModGain -> Carrier Frequency
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      
      // Carrier -> Envelope -> inputNode
      carrier.connect(envelope);
      envelope.connect(track.inputNode);
      
      // Amplitude ADSR
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(0.3, now + attack);
      envelope.gain.linearRampToValueAtTime(sustain * 0.3, now + attack + decay);
      
      carrier.start(now);
      modulator.start(now);
      
      const releaseTime = now + noteDuration;
      envelope.gain.setValueAtTime(sustain * 0.3, releaseTime);
      envelope.gain.linearRampToValueAtTime(0, releaseTime + release);
      
      carrier.stop(releaseTime + release);
      modulator.stop(releaseTime + release);
      
      return carrier;
    }
    
    return null;
  }
  // ── Audio Input Recording ───────────────────────────────────────
  async startRecording(trackId) {
    if (this.activeRecorders.has(trackId)) return true; // already recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
        .find(t => MediaRecorder.isTypeSupported(t)) || '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      const chunks = [];
      mr.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      mr.start(100);
      this.activeRecorders.set(trackId, { mediaRecorder: mr, chunks, stream });
      return true;
    } catch (err) {
      console.error('Mic access denied or unavailable:', err);
      return false;
    }
  }

  async stopRecording(trackId) {
    const rec = this.activeRecorders.get(trackId);
    if (!rec) return null;
    return new Promise(resolve => {
      const { mediaRecorder, chunks, stream } = rec;
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        try {
          const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
          resolve({ audioBuffer, blob });
        } catch (err) {
          console.error('Could not decode recorded audio:', err);
          resolve(null);
        }
      };
      mediaRecorder.stop();
      this.activeRecorders.delete(trackId);
    });
  }

  isRecordingTrack(trackId) {
    return this.activeRecorders.has(trackId);
  }
}

export const engine = new AudioEngine();
