import { engine } from './AudioEngine.js';

export class Sequencer {
  constructor() {
    this.bpm = 120;
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.clips = [];
    this.patterns = {}; // { trackId: [ { note: 'C4', step: 0, durationSteps: 1, scheduled: false, sourceNode: null } ] }
    this.timeSignature = { numerator: 4, denominator: 4 };

    // UI Elements
    this.playheadEl = document.querySelector('.playhead');
    this.lcdPosition = document.querySelector('.time-display .lcd-value');

    // px per second: 120 BPM * 50px/beat = 100px/s
    this.pxPerSecond = 100;
    this.gridSnapInBeats = 0.25; // 1/16 default
    this.loopEnabled = true;
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

  addNoteToPattern(trackId, note, step, durationSteps = 1) {
    if (!this.patterns[trackId]) this.patterns[trackId] = [];
    this.patterns[trackId].push({ note, step, durationSteps, scheduled: false, sourceNode: null });
  }

  removeNoteFromPattern(trackId, note, step) {
    if (!this.patterns[trackId]) return;
    this.patterns[trackId] = this.patterns[trackId].filter(n => !(n.note === note && n.step === step));
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
    
    // Stop all playing clips
    this.clips.forEach(clip => {
      if (clip.sourceNode) {
        try { clip.sourceNode.stop(); } catch (e) {}
        clip.sourceNode = null;
      }
      clip.scheduled = false;
    });

    for (const trackId in this.patterns) {
      this.patterns[trackId].forEach(n => {
        if (n.sourceNode) { try { n.sourceNode.stop(); } catch(e){} n.sourceNode = null; }
        n.scheduled = false;
      });
    }

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
      clip.scheduled = false;
    });

    for (const trackId in this.patterns) {
      this.patterns[trackId].forEach(n => {
        if (n.sourceNode) { try { n.sourceNode.stop(); } catch(e){} n.sourceNode = null; }
        n.scheduled = false;
      });
    }
  }

  seek(timeInSeconds) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.pause();
    }
    
    this.pauseTime = Math.max(0, timeInSeconds);
    this.updatePlayhead(this.pauseTime);
    this.updateLCD(this.pauseTime);
    
    if (wasPlaying) {
      this.play();
    }
  }

  scheduleLoop() {
    if (!this.isPlaying) return;

    const currentTime = engine.ctx.currentTime - this.startTime;

    // Update UI
    this.updatePlayhead(currentTime);
    this.updateLCD(currentTime);

    // Lookahead scheduling (schedule clips that should start in the next 100ms)
    const lookahead = 0.1; 
    
    // Calculate max time
    let maxTime = 0;
    this.clips.forEach(clip => {
      const endTime = clip.startTime + clip.duration;
      if (endTime > maxTime) maxTime = endTime;
    });
    
    const beatsPerBar = this.timeSignature?.numerator || 4;
    const secondsPerBar = (60 / this.bpm) * beatsPerBar;
    const beatsPerSecond = this.bpm / 60;
    const secondsPerStep = (1 / beatsPerSecond) / 4; // 1/16th note per step
    
    for (const trackId in this.patterns) {
      this.patterns[trackId].forEach(n => {
        const endTime = (n.step + n.durationSteps) * secondsPerStep;
        if (endTime > maxTime) maxTime = endTime;
      });
    }

    // Round up maxTime to complete the musical length (nearest bar)
    if (maxTime > 0) {
      maxTime = Math.ceil((maxTime - 0.01) / secondsPerBar) * secondsPerBar;
    }
    
    // Loop / Auto-stop logic
    if (maxTime > 0 && currentTime > maxTime) {
      if (this.loopEnabled) {
        this.startTime += maxTime;
        // Unschedule all to re-trigger
        this.clips.forEach(c => c.scheduled = false);
        for(const t in this.patterns) this.patterns[t].forEach(n => n.scheduled = false);
      } else if (currentTime > maxTime + 0.5) {
        this.stop();
        return;
      }
    }
    
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
            clip.sourceNode = null;
          };
        }
      }
    });

    // Schedule pattern notes
    for (const trackId in this.patterns) {
      this.patterns[trackId].forEach(noteObj => {
        const noteStartTime = noteObj.step * secondsPerStep;
        
        if (noteStartTime >= currentTime && noteStartTime < currentTime + lookahead && !noteObj.scheduled) {
          noteObj.scheduled = true;
          
          const exactAudioClockTime = this.startTime + noteStartTime;
          const duration = noteObj.durationSteps * secondsPerStep;
          
          const source = engine.playNote(trackId, noteObj.note, exactAudioClockTime, duration);
          if (source) {
            noteObj.sourceNode = source;
            source.onended = () => {
              noteObj.sourceNode = null;
            };
          } else {
            noteObj.scheduled = false;
          }
        }
      });
    }

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
