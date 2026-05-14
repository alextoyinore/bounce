import { engine } from './AudioEngine.js';

export class Sequencer {
  constructor() {
    this.bpm = 120;
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.clips = [];
    this.timeSignature = { numerator: 4, denominator: 4 };

    // UI Elements
    this.playheadEl = document.querySelector('.playhead');
    this.lcdPosition = document.querySelector('.time-display .lcd-value');

    // px per second: 120 BPM * 50px/beat = 100px/s
    this.pxPerSecond = 100;
    this.gridSnapInBeats = 0.25; // 1/16 default
  }

  setZoom(newPxPerSecond) {
    this.pxPerSecond = Math.max(10, Math.min(1000, newPxPerSecond));
    return this.pxPerSecond;
  }

  setGridSnap(bars) {
    if (bars === 0) {
      this.gridSnapInBeats = 0;
    } else {
      this.gridSnapInBeats = bars * 4; // Assuming 4/4 time
    }
  }

  snapTimeToGrid(timeInSeconds) {
    if (this.gridSnapInBeats === 0) return timeInSeconds;
    
    const beatsPerSecond = this.bpm / 60;
    const timeInBeats = timeInSeconds * beatsPerSecond;
    
    const snappedBeats = Math.round(timeInBeats / this.gridSnapInBeats) * this.gridSnapInBeats;
    return Math.max(0, snappedBeats / beatsPerSecond);
  }

  addClip(clip) {
    this.clips.push(clip);
  }

  removeClip(clip) {
    const index = this.clips.indexOf(clip);
    if (index > -1) {
      this.clips.splice(index, 1);
      if (clip.sourceNode) {
        try { clip.sourceNode.stop(); } catch(e) {}
        clip.sourceNode = null;
      }
    }
  }

  play() {
    if (this.isPlaying) return;
    
    // Need user interaction to resume audio context
    engine.resume();
    
    this.isPlaying = true;
    
    // If resuming from pause, adjust startTime so we pick up where we left off
    if (this.pauseTime > 0) {
      this.startTime = engine.ctx.currentTime - this.pauseTime;
    } else {
      this.startTime = engine.ctx.currentTime;
    }
    
    this.scheduleLoop();
  }

  stop() {
    this.isPlaying = false;
    this.pauseTime = 0;
    
    // Stop all playing clips (mockup logic)
    this.clips.forEach(clip => {
      if (clip.sourceNode) {
        try { clip.sourceNode.stop(); } catch (e) {}
        clip.sourceNode = null;
      }
    });

    // Reset UI
    if (this.playheadEl) this.playheadEl.style.left = '0px';
    if (this.lcdPosition) this.lcdPosition.textContent = '001 : 01 : 00';
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.pauseTime = engine.ctx.currentTime - this.startTime;
    
    // Stop playing clips but don't reset time
    this.clips.forEach(clip => {
      if (clip.sourceNode) {
        try { clip.sourceNode.stop(); } catch (e) {}
        clip.sourceNode = null;
      }
    });
  }

  scheduleLoop() {
    if (!this.isPlaying) return;

    const currentTime = engine.ctx.currentTime - this.startTime;

    // Update UI
    this.updatePlayhead(currentTime);
    this.updateLCD(currentTime);

    // Lookahead scheduling (schedule clips that should start in the next 100ms)
    const lookahead = 0.1; 
    
    this.clips.forEach(clip => {
      // If clip is meant to play within our lookahead window and hasn't been scheduled yet
      if (clip.startTime >= currentTime && clip.startTime < currentTime + lookahead && !clip.scheduled) {
        clip.scheduled = true;
        
        // Create source and connect to track
        const source = engine.ctx.createBufferSource();
        source.buffer = clip.buffer;
        
        const track = engine.getTrack(clip.trackId);
        if (track) {
          source.connect(track.gainNode);
          // Schedule it accurately on the audio hardware clock
          const exactAudioClockTime = this.startTime + clip.startTime;
          source.start(exactAudioClockTime);
          
          // Store reference to stop it later
          clip.sourceNode = source;
          
          source.onended = () => {
            clip.scheduled = false;
            clip.sourceNode = null;
          };
        }
      }
    });

    requestAnimationFrame(() => this.scheduleLoop());
  }

  updatePlayhead(timeInSeconds) {
    if (!this.playheadEl) return;
    const pxPos = timeInSeconds * this.pxPerSecond;
    this.playheadEl.style.left = `${pxPos}px`;
  }

  updateLCD(timeInSeconds) {
    if (!this.lcdPosition) return;
    const beatsPerSecond = this.bpm / 60;
    const totalBeats = timeInSeconds * beatsPerSecond;
    const beatsPerBar = this.timeSignature.numerator;
    const bars = Math.floor(totalBeats / beatsPerBar) + 1;
    const beats = Math.floor(totalBeats % beatsPerBar) + 1;
    const ticks = Math.floor((totalBeats - Math.floor(totalBeats)) * 96);
    const pad = (n, s) => n.toString().padStart(s, '0');
    this.lcdPosition.textContent = `${pad(bars, 3)} : ${pad(beats, 2)} : ${pad(ticks, 2)}`;
  }
}

export const sequencer = new Sequencer();
