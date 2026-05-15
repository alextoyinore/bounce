import { engine } from './AudioEngine.js';

export class Sequencer {
  constructor() {
    this.bpm = 120;
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this.clips = [];
    this.patternClips = []; // { trackId, startTime, duration, uiElement }
    this.patterns = {}; // { trackId: [ { note, step, durationSteps, scheduled, sourceNode } ] }
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

  addPatternClip(patternClip) {
    this.patternClips.push(patternClip);
  }

  removePatternClip(patternClip) {
    const index = this.patternClips.indexOf(patternClip);
    if (index > -1) {
      this.patternClips.splice(index, 1);
    }
  }

  addNoteToPattern(trackId, note, step, durationSteps = 1) {
    if (!this.patterns[trackId]) this.patterns[trackId] = [];
    // Remove existing note at same position to avoid duplicates
    this.patterns[trackId] = this.patterns[trackId].filter(n => !(n.note === note && n.step === step));
    this.patterns[trackId].push({ note, step, durationSteps, scheduled: false, sourceNode: null });
  }

  removeNoteFromPattern(trackId, note, step) {
    if (!this.patterns[trackId]) return;
    this.patterns[trackId] = this.patterns[trackId].filter(n => !(n.note === note && n.step === step));
  }

  play() {
    if (this.isPlaying) return;
    
    engine.resume();
    
    this.isPlaying = true;
    
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

    if (this.playheadEl) this.playheadEl.style.left = '0px';
    if (this.lcdPosition) this.lcdPosition.textContent = '001 : 01 : 00';
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.pauseTime = engine.ctx.currentTime - this.startTime;
    
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

  // ── Core scheduling helpers ───────────────────────────────────────────
  _getMaxTime() {
    const beatsPerBar = this.timeSignature?.numerator || 4;
    const secondsPerBar = (60 / this.bpm) * beatsPerBar;
    const beatsPerSecond = this.bpm / 60;
    const secondsPerStep = (1 / beatsPerSecond) / 4;

    let maxTime = 0;

    this.clips.forEach(clip => {
      const end = clip.startTime + clip.duration;
      if (end > maxTime) maxTime = end;
    });

    // Pattern clips placed in the arranger
    this.patternClips.forEach(pc => {
      const end = pc.startTime + pc.duration;
      if (end > maxTime) maxTime = end;
    });

    // Bare patterns (not yet placed as clips) still contribute
    for (const trackId in this.patterns) {
      // Only count if no pattern clip for that track
      const hasPlacedClip = this.patternClips.some(pc => pc.trackId === trackId);
      if (!hasPlacedClip) {
        this.patterns[trackId].forEach(n => {
          const end = (n.step + n.durationSteps) * secondsPerStep;
          if (end > maxTime) maxTime = end;
        });
      }
    }

    if (maxTime > 0) {
      maxTime = Math.ceil((maxTime - 0.01) / secondsPerBar) * secondsPerBar;
    }

    return maxTime;
  }

  _scheduleClips(currentTime, lookahead) {
    this.clips.forEach(clip => {
      if (
        clip.startTime >= currentTime &&
        clip.startTime < currentTime + lookahead &&
        !clip.scheduled
      ) {
        clip.scheduled = true;
        const source = engine.ctx.createBufferSource();
        source.buffer = clip.buffer;
        const track = engine.getTrack(clip.trackId);
        if (track) {
          source.connect(track.gainNode);
          const exactTime = this.startTime + clip.startTime;
          source.start(exactTime);
          clip.sourceNode = source;
          source.onended = () => { clip.sourceNode = null; };
        }
      }
    });
  }

  _schedulePatterns(currentTime, lookahead) {
    const beatsPerSecond = this.bpm / 60;
    const secondsPerStep = (1 / beatsPerSecond) / 4;

    for (const trackId in this.patterns) {
      // Determine all start offsets for this track's pattern
      const offsets = [];

      // Find placed pattern clips for this track
      const placedClips = this.patternClips.filter(pc => pc.trackId === trackId);
      if (placedClips.length > 0) {
        placedClips.forEach(pc => offsets.push({ startTime: pc.startTime, duration: pc.duration }));
      } else {
        // No placement = play from 0 with duration = full pattern length
        offsets.push({ startTime: 0, duration: Infinity });
      }

      this.patterns[trackId].forEach(noteObj => {
        const noteRelTime = noteObj.step * secondsPerStep;

        offsets.forEach(offset => {
          // Each note plays at startTime + noteRelTime, but only if within the clip's duration
          if (noteRelTime >= offset.duration) return; // note trimmed off

          const noteAbsTime = offset.startTime + noteRelTime;

          if (
            noteAbsTime >= currentTime &&
            noteAbsTime < currentTime + lookahead &&
            !noteObj._scheduledAt?.has(offset.startTime)
          ) {
            if (!noteObj._scheduledAt) noteObj._scheduledAt = new Set();
            noteObj._scheduledAt.add(offset.startTime);

            const exactTime = this.startTime + noteAbsTime;
            const duration = noteObj.durationSteps * secondsPerStep;
            const source = engine.playNote(trackId, noteObj.note, exactTime, duration);
            if (source) {
              source.onended = () => {};
            }
          }
        });
      });
    }
  }

  _resetScheduled() {
    this.clips.forEach(c => c.scheduled = false);
    for (const t in this.patterns) {
      this.patterns[t].forEach(n => {
        n.scheduled = false;
        n._scheduledAt = new Set();
      });
    }
  }

  scheduleLoop() {
    if (!this.isPlaying) return;

    const currentTime = engine.ctx.currentTime - this.startTime;

    this.updatePlayhead(currentTime);
    this.updateLCD(currentTime);

    const lookahead = 0.1;
    const maxTime = this._getMaxTime();

    // ── Loop / Auto-stop ─────────────────────────────────────────────
    if (maxTime > 0 && currentTime >= maxTime) {
      if (this.loopEnabled) {
        // Advance the origin clock by exactly one loop length
        this.startTime += maxTime;

        // Reset ALL scheduled flags immediately so beat 0 is caught this tick
        this._resetScheduled();

        // Schedule from the beginning inline (don't wait for next rAF)
        const newCurrentTime = engine.ctx.currentTime - this.startTime; // ≈ 0
        this._scheduleClips(newCurrentTime, lookahead);
        this._schedulePatterns(newCurrentTime, lookahead);

        requestAnimationFrame(() => this.scheduleLoop());
        return;
      } else if (currentTime > maxTime + 0.5) {
        this.stop();
        return;
      }
    }

    this._scheduleClips(currentTime, lookahead);
    this._schedulePatterns(currentTime, lookahead);

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
