const NOTE_TO_MIDI = { 'C':0, 'C#':1, 'D':2, 'D#':3, 'E':4, 'F':5, 'F#':6, 'G':7, 'G#':8, 'A':9, 'A#':10, 'B':11 };

export function parseNoteToMidi(noteName) {
  const match = noteName.match(/^([A-G]#?)(-?\d+)$/i);
  if (!match) return 60; // Default C4
  const note = match[1].toUpperCase();
  const oct = parseInt(match[2]);
  return (oct + 1) * 12 + NOTE_TO_MIDI[note];
}

class Track {
  constructor(audioContext, masterNode, name) {
    this.ctx = audioContext;
    this.name = name;
    
    // Create track nodes
    this.gainNode = this.ctx.createGain();
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 256;
    
    // State
    this.baseVolume = 0.8;
    this.isMuted = false;
    this.isSoloed = false;
    this.isArmed = false;
    
    // Sampler Data
    this.instrumentBuffer = null;
    this.instrumentRootMidi = 60; // Default C4
    
    // Default values
    this.gainNode.gain.value = this.baseVolume; // default 80%
    
    // Routing: Track -> Analyser -> Master
    this.analyserNode.connect(this.gainNode);
    this.gainNode.connect(masterNode);
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
    
    // Master -> Analyser -> Hardware Destination
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);

    // Track registry
    this.tracks = new Map();
    this.soloedTracks = new Set();
    
    console.log('AudioEngine initialized');
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
    if (!track || !track.instrumentBuffer) return null;
    
    const midiNote = parseNoteToMidi(noteName);
    const semitones = midiNote - track.instrumentRootMidi;
    const rate = Math.pow(2, semitones / 12);
    
    const source = this.ctx.createBufferSource();
    source.buffer = track.instrumentBuffer;
    source.playbackRate.value = rate;
    
    source.connect(track.gainNode);
    source.start(time);
    if (duration > 0) {
      // simple hard stop (could click, but good enough for a basic sampler)
      source.stop(time + duration);
    }
    return source;
  }
}

export const engine = new AudioEngine();
