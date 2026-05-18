import { engine } from './AudioEngine.js';

// ── Automation interpolation (linear between breakpoints) ──────────────────
function interpolateAutomation(points, time) {
  if (!points || points.length === 0) return null;
  if (time <= points[0].time) return points[0].value;
  if (time >= points[points.length - 1].time) return points[points.length - 1].value;
  for (let i = 0; i < points.length - 1; i++) {
    if (time >= points[i].time && time < points[i + 1].time) {
      const t = (time - points[i].time) / (points[i + 1].time - points[i].time);
      return points[i].value + t * (points[i + 1].value - points[i].value);
    }
  }
  return null;
}

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
    this.isRecording = false; // Global record-arm flag (set true when any track is armed)
    this.activePatternSources = [];
  }

  setZoom(newPxPerSecond) {
    this.pxPerSecond = Math.max(10, Math.min(1000, newPxPerSecond));
    return this.pxPerSecond;
  }

  /**
   * Call after BPM changes while playing.
   * Stops all currently running audio and re-schedules from the current
   * playhead position so the new tempo is heard immediately.
   */
  rescheduleAtTempo(ratio = 1) {
    if (!this.isPlaying) return;

    // Capture current playhead position and scale it
    const currentPlayTime = (engine.ctx.currentTime - this.startTime) * ratio;

    // Stop all scheduled audio clips
    this.clips.forEach(clip => {
      if (clip.sourceNode) {
        try { clip.sourceNode.stop(); } catch(e){}
        clip.sourceNode = null;
      }
      clip.scheduled = false;
    });

    // Stop all pattern notes
    for (const trackId in this.patterns) {
      this.patterns[trackId].forEach(n => {
        if (n.sourceNode) { try { n.sourceNode.stop(); } catch(e){} n.sourceNode = null; }
        n.scheduled = false;
        if (n._scheduledAt) n._scheduledAt.clear();
      });
    }

    // Re-anchor start time to keep playhead at same musical position
    this.startTime = engine.ctx.currentTime - currentPlayTime;
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

  stopActivePatternNotes(trackId) {
    if (this.activePatternSources) {
      this.activePatternSources = this.activePatternSources.filter(item => {
        if (!trackId || item.trackId === trackId) {
          try { item.sourceNode.stop(); } catch(e){}
          return false;
        }
        return true;
      });
    }
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
    // Stop all active playback sounds for this track immediately!
    this.stopActivePatternNotes(patternClip.trackId);
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

    // If all notes or steps are removed, clean up arranger and stop playback
    if (this.patterns[trackId].length === 0) {
      // Stop all active playback notes for this track immediately!
      this.stopActivePatternNotes(trackId);

      // Filter pattern clips and remove their DOM elements
      this.patternClips = this.patternClips.filter(pc => {
        if (pc.trackId === trackId) {
          if (pc.uiElement) pc.uiElement.remove();
          return false;
        }
        return true;
      });
    }
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

        // --- Tempo sync: if the clip has a bpmAtCapture, adjust playbackRate ---
        // The clip's musicalDuration (bar-snapped) tells us how long it should
        // take at the current BPM.  If it differs from the raw buffer length,
        // speed up / slow down proportionally.
        const rawDuration = clip.buffer.duration;
        const originalMusicalDuration = clip.originalDuration || clip.duration;
        if (originalMusicalDuration > 0 && Math.abs(rawDuration - originalMusicalDuration) > 0.01) {
          // Stretch: play the buffer faster/slower to fit the musical duration
          source.playbackRate.value = rawDuration / originalMusicalDuration;
        }

        const track = engine.getTrack(clip.trackId);
        if (track) {
          source.connect(track.gainNode);
          const exactTime = this.startTime + clip.startTime;
          // Only play the trimmed portion of the buffer
          const playDuration = clip.duration;
          source.start(exactTime, 0, rawDuration * (source.playbackRate.value || 1) > 0
            ? playDuration * (source.playbackRate.value || 1)
            : undefined);
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
              const srcItem = { trackId, sourceNode: source };
              if (!this.activePatternSources) this.activePatternSources = [];
              this.activePatternSources.push(srcItem);
              source.onended = () => {
                if (this.activePatternSources) {
                  const idx = this.activePatternSources.indexOf(srcItem);
                  if (idx > -1) this.activePatternSources.splice(idx, 1);
                }
              };
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

  // ── Automation Playback ────────────────────────────────────────────────
  _applyAutomation(currentTime) {
    engine.tracks.forEach((track) => {
      if (!track.automations) return;
      for (const [param, points] of Object.entries(track.automations)) {
        if (!points || points.length === 0) continue;
        const value = interpolateAutomation(points, currentTime);
        if (value === null) continue;

        if (param === 'volume') {
          track.baseVolume = Math.max(0, Math.min(1.5, value));
          engine.updateTrackVolumes();
        } else if (param === 'pan') {
          track.setPan(Math.max(-1, Math.min(1, value)));
        } else if (param.startsWith('fx.')) {
          const parts = param.split('.');
          if (parts.length >= 3) {
            const fxId = parts[1];
            const paramName = parts.slice(2).join('.');
            const fx = track.effects.find(f => f.id === fxId);
            if (fx && fx.updateParams) fx.updateParams({ [paramName]: value });
          }
        } else if (param.startsWith('gen.')) {
          const paramName = param.slice(4);
          if (track.generator && track.generator.params) {
            track.generator.params[paramName] = value;
          }
        }
      }
    });
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
        this.startTime += maxTime;
        this._resetScheduled();
        const newCurrentTime = engine.ctx.currentTime - this.startTime;
        this._scheduleClips(newCurrentTime, lookahead);
        this._schedulePatterns(newCurrentTime, lookahead);
        this._applyAutomation(newCurrentTime);
        requestAnimationFrame(() => this.scheduleLoop());
        return;
      } else if (currentTime > maxTime + 0.5) {
        this.stop();
        return;
      }
    }

    this._scheduleClips(currentTime, lookahead);
    this._schedulePatterns(currentTime, lookahead);
    this._applyAutomation(currentTime);

    requestAnimationFrame(() => this.scheduleLoop());
  }

  updatePlayhead(timeInSeconds) {
    if (!this.playheadEl) return;
    const pxPos = timeInSeconds * this.pxPerSecond;
    this.playheadEl.style.left = `${pxPos}px`;

    // Auto-scroll the arrangement view if follow is enabled
    if (localStorage.getItem('bounce.followPlayhead') !== 'false') { // Default to true if not set
      const view = document.querySelector('.arrangement-view');
      if (view) {
        const viewWidth = view.clientWidth;
        const scrollLeft = view.scrollLeft;
        // If playhead goes beyond the right 75% or left 10%, center it
        if (pxPos > scrollLeft + viewWidth * 0.75 || pxPos < scrollLeft + viewWidth * 0.1) {
          view.scrollLeft = pxPos - viewWidth / 2;
        }
      }
    }
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
