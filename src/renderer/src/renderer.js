import { engine, parseNoteToMidi } from './AudioEngine.js'
import { sequencer } from './Sequencer.js'

function init() {
  window.addEventListener('DOMContentLoaded', () => {
    console.log('Bounce DAW initialized')
    
    let prZoomFactor = 1.0
    let currentProjectPath = null
    let currentTrackId = 'kick' // Initialize with a default
    
    // OS File Association listener
    if (window.api && window.api.onOpenFile) {
      window.api.onOpenFile(async (filePath) => {
        try {
          const buffer = await window.api.readFile(filePath)
          if (buffer) {
            const decoder = new TextDecoder('utf-8')
            const jsonStr = decoder.decode(buffer)
            const data = JSON.parse(jsonStr)
            await loadProject(data)
            currentProjectPath = filePath
            showToast(`Loaded: ${filePath.split(/[/\\]/).pop()}`)
          }
        } catch (err) {
          console.error("Failed to open file from OS:", err)
          showToast("Failed to load project from OS")
        }
      })
    }
    
    // ── Toast Notification System ──────────────────────────────────
    function showToast(message) {
      let toast = document.querySelector('.daw-toast')
      if (!toast) {
        toast = document.createElement('div')
        toast.className = 'daw-toast'
        document.body.appendChild(toast)
      }
      toast.textContent = message
      toast.classList.add('show')
      
      if (toast._timeout) clearTimeout(toast._timeout)
      toast._timeout = setTimeout(() => {
        toast.classList.remove('show')
      }, 2000)
    }

    // ── Central HUD Notification System ─────────────────────────────
    function showHudFeedback(icon, text) {
      let hud = document.querySelector('.daw-hud')
      if (!hud) {
        hud = document.createElement('div')
        hud.className = 'daw-hud'
        hud.innerHTML = `
          <div class="daw-hud-icon"></div>
          <div class="daw-hud-text"></div>
        `
        document.body.appendChild(hud)
      }
      hud.querySelector('.daw-hud-icon').textContent = icon
      hud.querySelector('.daw-hud-text').textContent = text
      hud.classList.add('show')
      
      if (hud._timeout) clearTimeout(hud._timeout)
      hud._timeout = setTimeout(() => {
        hud.classList.remove('show')
      }, 800)
    }

    // ── History Manager (Memento Pattern) ──────────────────────────
    let isRestoringHistory = false

    const dawHistory = {
      undoStack: [],
      redoStack: [],
      maxStates: 50,
      
      pushState(actionName) {
        if (isRestoringHistory) return
        const state = serializeProject()
        if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1].state === state) return
        
        this.undoStack.push({ actionName, state })
        if (this.undoStack.length > this.maxStates) this.undoStack.shift()
        this.redoStack = []
        console.log(`[History] Pushed state: "${actionName}"`)
      },
      
      async undo() {
        if (this.undoStack.length === 0) {
          showToast("Nothing to Undo")
          showHudFeedback("↩️", "Nothing to Undo")
          return
        }
        const current = serializeProject()
        const previous = this.undoStack.pop()
        this.redoStack.push({ actionName: previous.actionName, state: current })
        
        try {
          isRestoringHistory = true
          const data = JSON.parse(previous.state)
          await loadProject(data)
          isRestoringHistory = false
          showToast(`Undo: ${previous.actionName}`)
          showHudFeedback("↩️", `Undo: ${previous.actionName}`)
        } catch(e) {
          isRestoringHistory = false
          console.error("Undo failed:", e)
        }
      },
      
      async redo() {
        if (this.redoStack.length === 0) {
          showToast("Nothing to Redo")
          showHudFeedback("↪️", "Nothing to Redo")
          return
        }
        const next = this.redoStack.pop()
        const current = serializeProject()
        this.undoStack.push({ actionName: next.actionName, state: current })
        
        try {
          isRestoringHistory = true
          const data = JSON.parse(next.state)
          await loadProject(data)
          isRestoringHistory = false
          showToast(`Redo: ${next.actionName}`)
          showHudFeedback("↪️", `Redo: ${next.actionName}`)
        } catch(e) {
          isRestoringHistory = false
          console.error("Redo failed:", e)
        }
      }
    }

    window.dawHistory = dawHistory
    
    // Selection state
    let selectedClips = new Set();
    let selectedNotes = new Set();
    let marqueeSelection = null;
    let dawClipboard = { type: null, data: [] };
    
    // Window controls
    document.getElementById('min-btn')?.addEventListener('click', () => {
      window.electron.ipcRenderer.send('window-minimize')
    })
    document.getElementById('max-btn')?.addEventListener('click', () => {
      window.electron.ipcRenderer.send('window-maximize')
    })
    document.getElementById('close-btn')?.addEventListener('click', () => {
      window.electron.ipcRenderer.send('window-close')
    })

    // Sidebar resize
    const sidebarResizer = document.getElementById('sidebar-resizer')
    const appEl = document.getElementById('app')
    const MIN_SIDEBAR = 160
    const MAX_SIDEBAR = 480
    let isSidebarResizing = false
    let sidebarResizeStartX = 0
    let sidebarResizeStartWidth = 0

    sidebarResizer?.addEventListener('mousedown', (e) => {
      e.preventDefault()
      isSidebarResizing = true
      sidebarResizeStartX = e.clientX
      sidebarResizeStartWidth = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10
      ) || 240
      sidebarResizer.classList.add('dragging')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    })

    document.addEventListener('mousemove', (e) => {
      if (!isSidebarResizing) return
      const delta = e.clientX - sidebarResizeStartX
      const newWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, sidebarResizeStartWidth + delta))
      document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`)
    })

    document.addEventListener('mouseup', () => {
      if (!isSidebarResizing) return
      isSidebarResizing = false
      sidebarResizer.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    })

    // Custom Menus
    const menuContainers = document.querySelectorAll('.menu-item-container')
    
    // Toggle dropdowns on click
    menuContainers.forEach(container => {
      const label = container.querySelector('.menu-label')
      const menu = container.querySelector('.dropdown-menu')
      
      label.addEventListener('click', (e) => {
        e.stopPropagation() // Prevent immediate document click trigger
        
        // Close others
        menuContainers.forEach(other => {
          if (other !== container) {
            other.querySelector('.dropdown-menu')?.classList.remove('show')
          }
        })
        
        menu.classList.toggle('show')
      })
    })

    // Close menus when clicking outside
    document.addEventListener('click', () => {
      menuContainers.forEach(container => {
        container.querySelector('.dropdown-menu')?.classList.remove('show')
      })
    })

    // Menu Actions
    document.getElementById('menu-exit')?.addEventListener('click', () => {
      window.electron.ipcRenderer.send('window-close')
    })

    // Moved up for priority
    document.getElementById('menu-install-pack')?.addEventListener('click', async (e) => {
      console.log('[Renderer] Install Sound Pack clicked', e);
      try {
        const result = await window.api.installSoundPack();
        console.log('[Renderer] Install result:', result);
        if (result && result.success) {
          const audioBase = await window.api.getAudioPath();
          const newPackPath = audioBase.endsWith('/') || audioBase.endsWith('\\')
            ? `${audioBase}${result.name}`
            : `${audioBase}/${result.name}`;
          
          buildBrowserTree(browserContainer, result.name, newPackPath, true);
          alert(`Successfully installed sound pack: ${result.name}`);
        } else if (result && !result.success) {
          alert(`Failed to install sound pack: ${result.error}`);
        }
      } catch (err) {
        console.error('[Renderer] Install Sound Pack error:', err);
      }
    });

    // Transport Controls
    const playBtn = document.querySelector('.transport-btn.play')
    const stopBtn = document.querySelector('.transport-btn.stop')
    const loopBtn = document.getElementById('loop-toggle-btn')
    const skipBackBtn = document.querySelector('.transport-btn.skip-back')

    const playSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256"><path d="M232.4,114.49,88.32,26.35a16,16,0,0,0-24.32,13.65v176a16,16,0,0,0,24.32,13.65l144.08-88.14A16,16,0,0,0,232.4,114.49ZM80,216V40l144,88Z"></path></svg>'
    const pauseSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256"><path d="M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32ZM200,208V48H160V208ZM80,208V48H56V208Z"></path></svg>'
    const fileSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M128,40a8,8,0,0,1,8,8V208a8,8,0,0,1-16,0V48A8,8,0,0,1,128,40ZM80,80a8,8,0,0,0-8,8v80a8,8,0,0,0,16,0V88A8,8,0,0,0,80,80ZM176,80a8,8,0,0,0-8,8v80a8,8,0,0,0,16,0V88A8,8,0,0,0,176,80ZM32,104a8,8,0,0,0-8,8v32a8,8,0,0,0,16,0V112A8,8,0,0,0,32,104ZM224,104a8,8,0,0,0-8,8v32a8,8,0,0,0,16,0V112A8,8,0,0,0,224,104Z"></path></svg>'

    // ── Audio Recording helpers ─────────────────────────────────────
    const recordingStartsByTrack = {}; // trackId → timeline start time (seconds)

    function showRecordingIndicator(trackId, active) {
      const lane = document.querySelector(`.track-lane[data-track-id="${trackId}"]`);
      if (lane) lane.classList.toggle('recording', active);
    }

    function createRecordedClip(trackId, startTime, audioBuffer, blob) {
      const lane = document.querySelector(`.track-lane[data-track-id="${trackId}"]`);
      if (!lane) return;
      const duration = audioBuffer.duration;
      const clipEl = document.createElement('div');
      clipEl.className = 'clip audio-clip recorded-clip';
      clipEl.style.left = `${startTime * sequencer.pxPerSecond}px`;
      clipEl.style.width = `${Math.max(20, duration * sequencer.pxPerSecond)}px`;
      clipEl.textContent = '● REC';
      clipEl.dataset.startTime = startTime;
      clipEl.dataset.duration = duration;
      const rh = document.createElement('div');
      rh.className = 'resize-handle';
      clipEl.appendChild(rh);
      lane.appendChild(clipEl);
      sequencer.addClip({
        buffer: audioBuffer,
        blob: blob, // Store raw recording Blob
        startTime,
        duration,
        originalDuration: duration,
        trackId,
        scheduled: false,
        uiElement: clipEl,
        _fileName: 'Recording',
        _filePath: null
      });
      showHudFeedback('●', 'Recording captured');
    }

    async function startArmedRecordings() {
      for (const [trackId, track] of engine.tracks.entries()) {
        if (!track.isArmed) continue;
        recordingStartsByTrack[trackId] = sequencer.pauseTime || 0;
        const ok = await engine.startRecording(trackId);
        if (ok) {
          showRecordingIndicator(trackId, true);
        } else {
          showHudFeedback('⚠️', 'Mic access denied');
        }
      }
    }

    async function stopAllRecordings() {
      const ids = [...engine.activeRecorders.keys()];
      for (const trackId of ids) {
        const result = await engine.stopRecording(trackId);
        showRecordingIndicator(trackId, false);
        if (result && result.audioBuffer) {
          createRecordedClip(trackId, recordingStartsByTrack[trackId] || 0, result.audioBuffer, result.blob);
        }
      }
    }

    // ── Transport Controls ──────────────────────────────────────────
    playBtn?.addEventListener('click', async () => {
      if (sequencer.isPlaying) {
        await stopAllRecordings();
        sequencer.pause();
        playBtn.innerHTML = playSvg;
      } else {
        await engine.resume();
        await startArmedRecordings();
        sequencer.play();
        playBtn.innerHTML = pauseSvg;
      }
    })

    stopBtn?.addEventListener('click', async () => {
      await stopAllRecordings();
      sequencer.stop();
      playBtn.innerHTML = playSvg;
    })

    loopBtn?.addEventListener('click', () => {
      sequencer.loopEnabled = !sequencer.loopEnabled
      loopBtn.classList.toggle('active', sequencer.loopEnabled)
    })

    // Metronome Toggle inside LCD
    const metroBtn = document.getElementById('metronome-toggle-btn');
    const metroStatus = document.getElementById('metronome-status-display');
    if (metroBtn && metroStatus) {
      metroBtn.addEventListener('click', () => {
        sequencer.metronomeEnabled = !sequencer.metronomeEnabled;
        if (sequencer.metronomeEnabled) {
          metroStatus.style.color = 'var(--accent-color)';
          metroBtn.style.textShadow = '0 0 10px rgba(0, 229, 255, 0.4)';
        } else {
          metroStatus.style.color = 'var(--text-secondary)';
          metroBtn.style.textShadow = 'none';
        }
      });
    }

    skipBackBtn?.addEventListener('click', async () => {
      await stopAllRecordings();
      sequencer.stop();
      playBtn.innerHTML = playSvg;
    })

    // Browser Logic
    const openFolderBtn = document.getElementById('open-folder-btn')
    const browserContainer = document.getElementById('browser-container')
    
    const removeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"></path></svg>'
    
    async function buildBrowserTree(parentEl, folderName, dirPath, isRemovable = true) {
      const folderItem = document.createElement('div')
      folderItem.className = 'browser-accordion'
      
      const header = document.createElement('div')
      header.className = 'folder-header collapsed'
      header.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; flex-grow:1;">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256" style="transition: transform 0.2s;"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"></path></svg> 
          <span>${folderName}</span>
        </div>
        ${isRemovable ? `<button class="folder-remove-btn" title="Remove Folder">${removeSvg}</button>` : ''}
      `
      
      const content = document.createElement('ul')
      content.className = 'folder-content collapsed'
      content.style.paddingLeft = '12px'
      
      let loaded = false;
      
      if (isRemovable) {
        header.querySelector('.folder-remove-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          folderItem.remove();
        });
      }
      
      header.addEventListener('click', async (e) => {
        if (e.target.closest('.folder-remove-btn')) return;
        
        header.classList.toggle('collapsed')
        content.classList.toggle('collapsed')
        
        if (!loaded) {
          loaded = true;
          console.log('[Renderer] Loading directory:', dirPath);
          const entries = await window.api.readDirectory(dirPath);
          console.log('[Renderer] Entries received:', entries);
          
          if (!entries || entries.length === 0) {
            content.innerHTML = '<li class="browser-item empty-state" style="justify-content: center; opacity: 0.5;">Empty</li>'
          } else {
            // Sort: directories first, then files
            entries.sort((a, b) => {
              if (a.type === b.type) return a.name.localeCompare(b.name);
              return a.type === 'directory' ? -1 : 1;
            });
            
            for (const entry of entries) {
              if (entry.type === 'directory') {
                await buildBrowserTree(content, entry.name, entry.path, isRemovable)
              } else if (entry.type === 'file') {
                const li = document.createElement('li')
                li.className = 'browser-item'
                li.draggable = true
                li.innerHTML = `
                  ${fileSvg}
                  <span class="browser-item-name">${entry.name}</span>
                  ${isRemovable ? `<button class="browser-item-remove" title="Remove from list">${removeSvg}</button>` : ''}
                `
                li.querySelector('.browser-item-remove')?.addEventListener('click', (e) => {
                  e.stopPropagation()
                  li.remove()
                })
                li.addEventListener('dragstart', (e) => {
                  e.dataTransfer.setData('text/plain', JSON.stringify(entry))
                  e.dataTransfer.effectAllowed = 'copy'
                })
                li.addEventListener('click', async () => {
                  try {
                    const buffer = await window.api.readFile(entry.path)
                    if (buffer) {
                      const audioBuffer = await engine.decodeAudioData(buffer.buffer)
                      engine.playPreview(audioBuffer)
                    }
                  } catch(e) { console.error('Preview error', e) }
                })
                content.appendChild(li)
              }
            }
          }
        }
      })
      
      folderItem.appendChild(header)
      folderItem.appendChild(content)
      parentEl.appendChild(folderItem)
    }

    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', async () => {
        const folderPath = await window.api.openFolder()
        if (folderPath) {
          const folderName = folderPath.split(/[/\\]/).pop() || 'New Folder'
          buildBrowserTree(browserContainer, folderName, folderPath)
        }
      })
    }

    function updateArrangerGrid() {
      const beatsPerBar = sequencer.timeSignature?.numerator || 4;
      const secondsPerBeat = 60 / sequencer.bpm;
      const beatWidth = secondsPerBeat * sequencer.pxPerSecond;
      const barWidth = beatWidth * beatsPerBar;
      
      const arranger = document.querySelector('.arrangement-view');
      if (arranger) {
        arranger.style.setProperty('--beat-width', `${beatWidth}px`);
        arranger.style.setProperty('--bar-width', `${barWidth}px`);
      }
    }

    // Call it initially and on BPM changes
    updateArrangerGrid();
    
    // Add to BPM display observer or listener
    document.getElementById('bpm-display')?.addEventListener('blur', () => {
       setTimeout(updateArrangerGrid, 100);
    });

    // Global Keybindings
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input or contenteditable
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      // Save (Ctrl + S)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault()
        document.getElementById('menu-save')?.click()
        return
      }

      // New Project (Ctrl + N)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyN') {
        e.preventDefault()
        document.getElementById('menu-new')?.click()
        return
      }

      // Open Project (Ctrl + O)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') {
        e.preventDefault()
        document.getElementById('menu-open')?.click()
        return
      }

      // Exit (Ctrl + Shift + X)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyX') {
        e.preventDefault()
        document.getElementById('menu-exit')?.click()
        return
      }

      // Undo (Ctrl + Z)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault()
        dawHistory.undo()
        return
      }

      // Redo (Ctrl + Y)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault()
        dawHistory.redo()
        return
      }

      // Copy (Ctrl + C)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
        e.preventDefault()
        doCopy()
        return
      }

      // Cut (Ctrl + X)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyX') {
        e.preventDefault()
        doCut()
        return
      }

      // Paste (Ctrl + V)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
        e.preventDefault()
        doPaste()
        return
      }

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        let deletedSomething = false;
        if (selectedNotes.size > 0) {
          e.preventDefault();
          const currentTrackId = document.getElementById('pr-track-select')?.value || 'drums';
          selectedNotes.forEach(noteEl => {
            const row = noteEl.closest('.pr-row');
            if (row) {
              const noteName = row.dataset.note;
              const step = parseInt(noteEl.dataset.step);
              sequencer.removeNoteFromPattern(currentTrackId, noteName, step);
              const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${currentTrackId}"][data-note="${noteName}"]`);
              if (stepSeqRow) {
                const s = stepSeqRow.querySelector(`[data-step-index="${step}"]`);
                if (s) s.classList.remove('active');
              }
            }
            noteEl.remove();
          });
          selectedNotes.clear();
          syncPatternClip(currentTrackId);
          dawHistory.pushState('Delete Note');
          deletedSomething = true;
        }

        if (selectedClips.size > 0) {
          e.preventDefault();
          selectedClips.forEach(clip => {
            const isPattern = clip.classList.contains('pattern-clip');
            const trackId = clip.closest('.track-lane')?.dataset.trackId;
            if (isPattern) {
              const seqClip = sequencer.patternClips.find(c => c.uiElement === clip);
              if (seqClip) sequencer.removePatternClip(seqClip);
            } else {
              const seqClip = sequencer.clips.find(c => c.uiElement === clip);
              if (seqClip) sequencer.removeClip(seqClip);
            }
            clip.remove();
            if (isPattern && trackId) {
              syncPatternClip(trackId);
            }
          });
          selectedClips.clear();
          dawHistory.pushState('Delete Clip');
          deletedSomething = true;
        }
        if (deletedSomething) return;
      }

      // Keyboard selection movement (Piano Roll Notes)
      if (selectedNotes.size > 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        
        const currentTrackId = document.getElementById('pr-track-select')?.value || 'drums';
        
        const NOTES_DESC = ['B','A#','A','G#','G','F#','F','E','D#','D','C#','C'];
        const OCTAVES = [6,5,4,3,2];
        const ALL_NOTES_DESC = [];
        OCTAVES.forEach(oct => {
          NOTES_DESC.forEach(note => {
            ALL_NOTES_DESC.push(`${note}${oct}`);
          });
        });

        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const gridSnapSelect = document.getElementById('grid-snap-select');
          const snapInterval = gridSnapSelect ? parseFloat(gridSnapSelect.value) : 0.0625;
          const snapSteps = Math.max(1, Math.round(snapInterval * 16));
          const stepDelta = e.key === 'ArrowRight' ? snapSteps : -snapSteps;

          const notesArray = Array.from(selectedNotes);
          
          notesArray.forEach(noteEl => {
            const row = noteEl.closest('.pr-row');
            if (row) {
              const noteName = row.dataset.note;
              const oldStep = parseInt(noteEl.dataset.step);
              sequencer.removeNoteFromPattern(currentTrackId, noteName, oldStep);
              
              const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${currentTrackId}"][data-note="${noteName}"]`);
              if (stepSeqRow) {
                const s = stepSeqRow.querySelector(`[data-step-index="${oldStep}"]`);
                if (s) s.classList.remove('active');
              }
            }
          });

          notesArray.forEach(noteEl => {
            const row = noteEl.closest('.pr-row');
            if (row) {
              const noteName = row.dataset.note;
              const oldStep = parseInt(noteEl.dataset.step);
              const duration = parseFloat(noteEl.dataset.duration || 1);
              const newStep = Math.max(0, oldStep + stepDelta);

              noteEl.dataset.step = newStep;
              noteEl.style.left = `${newStep * getPrStepPx() + 1}px`;

              sequencer.addNoteToPattern(currentTrackId, noteName, newStep, duration);
              
              const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${currentTrackId}"][data-note="${noteName}"]`);
              if (stepSeqRow) {
                const s = stepSeqRow.querySelector(`[data-step-index="${newStep}"]`);
                if (s) s.classList.add('active');
              }
            }
          });

          syncPatternClip(currentTrackId);
          dawHistory.pushState("Shift Note");
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const notesArray = Array.from(selectedNotes);
          const grid = document.getElementById('piano-grid');
          let previewNote = null;

          notesArray.forEach(noteEl => {
            const row = noteEl.closest('.pr-row');
            if (row) {
              const noteName = row.dataset.note;
              const step = parseInt(noteEl.dataset.step);
              sequencer.removeNoteFromPattern(currentTrackId, noteName, step);
              
              const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${currentTrackId}"][data-note="${noteName}"]`);
              if (stepSeqRow) {
                const s = stepSeqRow.querySelector(`[data-step-index="${step}"]`);
                if (s) s.classList.remove('active');
              }
            }
          });

          notesArray.forEach(noteEl => {
            const row = noteEl.closest('.pr-row');
            if (row) {
              const noteName = row.dataset.note;
              const step = parseInt(noteEl.dataset.step);
              const duration = parseFloat(noteEl.dataset.duration || 1);

              const index = ALL_NOTES_DESC.indexOf(noteName);
              const newIndex = e.key === 'ArrowUp' ? index - 1 : index + 1;

              if (newIndex >= 0 && newIndex < ALL_NOTES_DESC.length) {
                const newNoteName = ALL_NOTES_DESC[newIndex];
                const newRow = grid.querySelector(`[data-note="${newNoteName}"]`);
                if (newRow) {
                  newRow.appendChild(noteEl);
                  sequencer.addNoteToPattern(currentTrackId, newNoteName, step, duration);
                  
                  const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${currentTrackId}"][data-note="${newNoteName}"]`);
                  if (stepSeqRow) {
                    const s = stepSeqRow.querySelector(`[data-step-index="${step}"]`);
                    if (s) s.classList.add('active');
                  }
                  
                  previewNote = newNoteName;
                }
              } else {
                sequencer.addNoteToPattern(currentTrackId, noteName, step, duration);
              }
            }
          });

          if (previewNote) {
            engine.playNote(currentTrackId, previewNote, engine.ctx.currentTime, 0.2);
          }

          syncPatternClip(currentTrackId);
          dawHistory.pushState("Transpose Note");
        }
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (sequencer.isPlaying) {
          sequencer.pause();
          if (playBtn) playBtn.innerHTML = playSvg;
        } else {
          sequencer.play();
          if (playBtn) playBtn.innerHTML = pauseSvg;
        }
      }

      // Duplicate Forward (Ctrl + D)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
        e.preventDefault();
        
        // --- Arranger Duplication ---
        if (selectedClips.size > 0) {
          const clipsToDup = Array.from(selectedClips);
          let minStart = Infinity;
          let maxEnd = -Infinity;
          
          clipsToDup.forEach(clip => {
            const start = parseFloat(clip.dataset.startTime);
            const dur = parseFloat(clip.dataset.duration);
            minStart = Math.min(minStart, start);
            maxEnd = Math.max(maxEnd, start + dur);
          });
          
          const selectionDuration = maxEnd - minStart;
          const newSelection = [];
          
          clipsToDup.forEach(clip => {
            const clone = clip.cloneNode(true);
            clip.parentElement.appendChild(clone);
            clone.classList.remove('selected');
            
            const start = parseFloat(clip.dataset.startTime);
            const newStart = start + selectionDuration;
            clone.style.left = `${newStart * sequencer.pxPerSecond}px`;
            clone.dataset.startTime = newStart;
            
            const isPattern = clone.classList.contains('pattern-clip');
            const trackId = isPattern ? clone.dataset.patternTrackId : (clip.parentElement.dataset.trackId || 'drums');
            
            const oldSeq = isPattern ? sequencer.patternClips.find(pc => pc.uiElement === clip) : sequencer.clips.find(c => c.uiElement === clip);
            if (oldSeq) {
              const newSeq = { ...oldSeq, uiElement: clone, startTime: newStart, scheduled: false };
              if (isPattern) sequencer.addPatternClip(newSeq);
              else sequencer.addClip(newSeq);
            }
            newSelection.push(clone);
          });
          
          selectedClips.forEach(c => c.classList.remove('selected'));
          selectedClips.clear();
          newSelection.forEach(c => {
            selectedClips.add(c);
            c.classList.add('selected');
          });
        }
        
        // --- Piano Roll Duplication ---
        else if (selectedNotes.size > 0) {
          const notesToDup = Array.from(selectedNotes);
          let minStep = Infinity;
          let maxEndStep = -Infinity;
          
          notesToDup.forEach(n => {
            const step = parseInt(n.dataset.step);
            const dur = parseFloat(n.dataset.duration || 1);
            minStep = Math.min(minStep, step);
            maxEndStep = Math.max(maxEndStep, step + dur);
          });
          
          const selectionDurSteps = maxEndStep - minStep;
          const newNotes = [];
          const currentTrackId = document.getElementById('pr-track-select')?.value || 'kick';
          
          notesToDup.forEach(n => {
            const step = parseInt(n.dataset.step);
            const newStep = step + selectionDurSteps;
            const dur = parseFloat(n.dataset.duration || 1);
            const row = n.parentElement;
            const noteName = row.dataset.note;
            
            const map = trackUIMap[currentTrackId];
            const color = map && map.headers[0] ? map.headers[0].laneEl.style.getPropertyValue('--track-color') : null;
            
            const clone = createPrNote(currentTrackId, noteName, newStep, dur, color);
            row.appendChild(clone);
            
            sequencer.addNoteToPattern(currentTrackId, noteName, newStep, dur);
            newNotes.push(clone);
          });
          
          selectedNotes.forEach(n => n.classList.remove('selected'));
          selectedNotes.clear();
          newNotes.forEach(n => {
            selectedNotes.add(n);
            n.classList.add('selected');
          });
          syncPatternClip(currentTrackId);
        }
      }
    });

    // Auto-load all folders from the audio directory
    setTimeout(async () => {
      try {
        const audioBase = await window.api.getAudioPath()
        const entries = await window.api.readDirectory(audioBase)

        if (!entries || entries.length === 0) {
          console.warn('[Browser] Audio directory is empty:', audioBase)
          return
        }

        // Load every subdirectory as a non-removable browser tree
        const folders = entries.filter(e => e.type === 'directory')
        if (folders.length === 0) {
          console.warn('[Browser] No folders found in audio directory:', audioBase)
          return
        }

        for (const folder of folders) {
          buildBrowserTree(browserContainer, folder.name, folder.path, false)
        }
      } catch (e) { console.warn('[Browser] Could not auto-load audio folders:', e) }
    }, 500)

    const gridSnapSelect = document.getElementById('grid-snap-select')
    if (gridSnapSelect) {
      gridSnapSelect.addEventListener('change', (e) => {
        sequencer.gridSnapInBeats = eval(e.target.value) * 4
        drawTimeline()
        if (typeof drawPianoRollTimeline === 'function') drawPianoRollTimeline()
      })
    }

    function drawTimeline() {
      const ruler = document.querySelector('.timeline-ruler')
      const view = document.querySelector('.arrangement-view')
      if (!ruler || !view) return
      
      updateArrangerGrid()

      const beatsPerSecond = sequencer.bpm / 60
      const beatsPerBar = sequencer.timeSignature?.numerator || 4
      
      const isLight = document.body.classList.contains('light-theme')
      const color1 = isLight ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)'
      const color2 = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)'
      const color3 = isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)'
      const borderLeftVal = isLight ? '1px solid rgba(0, 0, 0, 0.1)' : '1px solid rgba(255, 255, 255, 0.1)'

      // Set complex grid background on grid-container
      const gridContainer = document.querySelector('.grid-container')
      if (gridContainer) {
        const beatPixels = (1 / beatsPerSecond) * sequencer.pxPerSecond
        const barPixels = beatsPerBar * beatPixels
        const sixteenthPixels = beatPixels / 4
        
        gridContainer.style.backgroundImage = `
          repeating-linear-gradient(90deg, transparent, transparent calc(${barPixels}px - 1px), ${color1} calc(${barPixels}px - 1px), ${color1} ${barPixels}px),
          repeating-linear-gradient(90deg, transparent, transparent calc(${beatPixels}px - 1px), ${color2} calc(${beatPixels}px - 1px), ${color2} ${beatPixels}px),
          repeating-linear-gradient(90deg, transparent, transparent calc(${sixteenthPixels}px - 1px), ${color3} calc(${sixteenthPixels}px - 1px), ${color3} ${sixteenthPixels}px)
        `
      }

      const beatPixels = (1 / beatsPerSecond) * sequencer.pxPerSecond
      const barPixels = beatsPerBar * beatPixels
      
      ruler.innerHTML = `
        <div class="ruler-bars"></div>
        <div class="ruler-beats"></div>
      `
      
      const barsContainer = ruler.querySelector('.ruler-bars')
      const beatsContainer = ruler.querySelector('.ruler-beats')
      
      const numBars = Math.ceil(5000 / barPixels) // Arbitrary long timeline
      
      for(let i = 0; i < numBars; i++) {
        const span = document.createElement('span')
        span.textContent = i + 1
        span.style.width = `${barPixels}px`
        barsContainer.appendChild(span)
        
        for(let j = 0; j < beatsPerBar; j++) {
          const beatSpan = document.createElement('span')
          beatSpan.textContent = j === 0 ? '' : (j + 1)
          beatSpan.style.width = `${beatPixels}px`
          if (j !== 0) beatSpan.style.borderLeft = borderLeftVal
          beatsContainer.appendChild(beatSpan)
        }
      }
    }

    // Timeline Scrubbing Logic
    const timelineRuler = document.querySelector('.timeline-ruler')
    if (timelineRuler) {
      let isScrubbing = false
      
      const handleScrub = (e) => {
        const arrangementView = document.querySelector('.arrangement-view')
        const rect = timelineRuler.getBoundingClientRect()
        const x = Math.max(0, e.clientX - rect.left + arrangementView.scrollLeft)
        const timeInSeconds = x / sequencer.pxPerSecond
        sequencer.seek(timeInSeconds)
      }
      
      timelineRuler.addEventListener('mousedown', (e) => {
        isScrubbing = true
        handleScrub(e)
      })
      
      document.addEventListener('mousemove', (e) => {
        if (isScrubbing) handleScrub(e)
      })
      
      document.addEventListener('mouseup', () => {
        isScrubbing = false
      })
    }

    // Drop Zone & Arrangement Logic
    const arrangementView = document.querySelector('.arrangement-view')
    if (!arrangementView) {
      console.error('Arrangement view not found!')
    }

    function applyArrangerZoom(val, isFromSlider = false) {
      let px;
      if (isFromSlider) {
        if (val <= 50) {
          px = 10 + (val - 1) * (40 / 49);
        } else {
          px = 50 + (val - 50) * (450 / 50);
        }
      } else {
        px = val;
      }
      
      const clampedPx = Math.max(10, Math.min(500, px));
      sequencer.setZoom(clampedPx);
      
      const label = document.getElementById('arranger-zoom-label');
      if (label) label.textContent = `${Math.round((clampedPx / 50) * 100)}%`;
      
      const slider = document.getElementById('arranger-zoom-slider');
      if (slider) {
        let sliderVal;
        if (clampedPx <= 50) {
          sliderVal = 1 + (clampedPx - 10) * (49 / 40);
        } else {
          sliderVal = 50 + (clampedPx - 50) * (50 / 450);
        }
        if (Math.abs(parseFloat(slider.value) - sliderVal) > 0.5) {
          slider.value = sliderVal;
        }
      }

      const clips = document.querySelectorAll('.clip');
      clips.forEach(clip => {
        if (clip.dataset.startTime && clip.dataset.duration) {
          const start = parseFloat(clip.dataset.startTime);
          const duration = parseFloat(clip.dataset.duration);
          clip.style.left = `${start * sequencer.pxPerSecond}px`;
          clip.style.width = `${Math.max(20, duration * sequencer.pxPerSecond)}px`;
        }
      });
      drawTimeline();
      if (typeof drawPianoRollTimeline === 'function') drawPianoRollTimeline();
      if (typeof rebuildPianoRollNotes === 'function') rebuildPianoRollNotes();
    }

    document.getElementById('arranger-zoom-slider')?.addEventListener('input', (e) => {
      applyArrangerZoom(parseFloat(e.target.value), true);
    });

    if (arrangementView) {
      // Zoom
      arrangementView.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          const factor = e.deltaY > 0 ? 0.9 : 1.1;
          applyArrangerZoom(sequencer.pxPerSecond * factor);
        }
      }, { passive: false })

      arrangementView.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      })
      
      arrangementView.addEventListener('drop', async (e) => {
        e.preventDefault()
        const data = e.dataTransfer.getData('text/plain')
        if (!data) return
        
        try {
          const fileInfo = JSON.parse(data)
          const buffer = await window.api.readFile(fileInfo.path)
          if (buffer) {
            const audioBuffer = await engine.decodeAudioData(buffer.buffer)
            
            const trackLane = e.target.closest('.track-lane') || document.querySelector('.track-lane')
            if (trackLane) {
              const trackId = trackLane.dataset.trackId || 'drums'

              // Fix: compute drop X relative to the grid-container, accounting for scroll
              const gridContainer = document.querySelector('.grid-container')
              const gridRect = gridContainer.getBoundingClientRect()
              const rawDropX = e.clientX - gridRect.left + arrangementView.scrollLeft
              const dropX = Math.max(0, rawDropX)
              let timeInSeconds = dropX / sequencer.pxPerSecond;
              timeInSeconds = sequencer.snapTimeToGrid(timeInSeconds);
              const snappedX = timeInSeconds * sequencer.pxPerSecond;
              
              // Snap clip duration to nearest bar at current BPM
              const bps = sequencer.bpm / 60
              const tsNum = sequencer.timeSignature?.numerator || 4
              const rawBeats = audioBuffer.duration * bps
              const rawBars = rawBeats / tsNum
              const roundedBars = Math.max(0.25, Math.round(rawBars * 4) / 4) // snap to quarter-bar
              const musicalDuration = (roundedBars * tsNum) / bps

              const clip = document.createElement('div')
              clip.className = 'clip audio-clip'
              clip.style.left = `${snappedX}px`
              clip.style.width = `${Math.max(20, musicalDuration * sequencer.pxPerSecond)}px`
              
              const map = trackUIMap[trackId]
              if (map && map.headers[0]) {
                const color = map.headers[0].laneEl.style.getPropertyValue('--track-color')
                if (color) clip.style.background = color
              }
              
              clip.textContent = fileInfo.name
              clip.dataset.startTime = timeInSeconds
              clip.dataset.duration = musicalDuration
              
              const handle = document.createElement('div')
              handle.className = 'resize-handle'
              clip.appendChild(handle)
              
              trackLane.appendChild(clip)
              
              // Auto-rename track if the track name isn't customized yet
              const trackHeader = map ? map.headers[0].headerEl : null
              if (trackHeader) {
                const nameEl = trackHeader.querySelector('.track-name')
                if (nameEl) {
                  // Basic extraction of filename without extension
                  const cleanName = fileInfo.name.split('.').slice(0, -1).join('.') || fileInfo.name
                  nameEl.textContent = cleanName
                  // Trigger blur to sync with mixer
                  nameEl.dispatchEvent(new Event('blur'))
                }
              }
              
              const seqClip = {
                buffer: audioBuffer,
                startTime: timeInSeconds,
                duration: musicalDuration,
                originalDuration: musicalDuration,
                trackId: trackId,
                scheduled: false,
                uiElement: clip,
                _filePath: fileInfo.path,
                _fileName: fileInfo.name
              };
              sequencer.addClip(seqClip)
              dawHistory.pushState('Add Clip')
            }
          }
        } catch (err) {
          console.error('Error handling drop:', err)
        }
      })

      // Clip Dragging & Resizing
      let clipDragState = null;

      // Marquee Selection Logic
      let marqueeStart = null;
      
      arrangementView.addEventListener('mousedown', (e) => {
        if (e.button === 2) return; // Ignore right-click
        
        // Shift + Click or empty space drag = Marquee
        if (e.shiftKey || !e.target.closest('.clip')) {
          if (!e.ctrlKey) {
            selectedClips.forEach(c => c.classList.remove('selected'));
            selectedClips.clear();
          }
          marqueeStart = { x: e.clientX, y: e.clientY };
          marqueeSelection = document.createElement('div');
          marqueeSelection.className = 'selection-marquee';
          document.body.appendChild(marqueeSelection);
          return;
        }

        // Resize handle
        if (e.target.classList.contains('resize-handle')) {
          e.preventDefault()
          e.stopPropagation()
          const clip = e.target.closest('.clip')
          clipDragState = {
            type: e.shiftKey ? 'paint' : 'resize',
            clip: clip,
            startX: e.clientX,
            startDur: parseFloat(clip.dataset.duration)
          }
          return;
        }
        
        const clip = e.target.closest('.clip');
        if (clip) {
          e.preventDefault()
          
          if (e.ctrlKey || e.shiftKey) {
            // Toggle selection
            if (selectedClips.has(clip)) {
              selectedClips.delete(clip);
              clip.classList.remove('selected');
            } else {
              selectedClips.add(clip);
              clip.classList.add('selected');
            }
            return;
          }

          if (!selectedClips.has(clip)) {
            selectedClips.forEach(c => c.classList.remove('selected'));
            selectedClips.clear();
            selectedClips.add(clip);
            clip.classList.add('selected');
          }
          
          const isPattern = clip.classList.contains('pattern-clip')
          const seqArray = isPattern ? sequencer.patternClips : sequencer.clips
          
          const allLanes = Array.from(document.querySelectorAll('.track-lane'));
          const dragItems = Array.from(selectedClips).map(c => {
            const sc = seqArray.find(s => s.uiElement === c)
            return {
              el: c,
              seqClip: sc,
              startLeft: parseFloat(c.style.left) || 0,
              originalStartTime: sc ? sc.startTime : 0,
              startLaneIndex: allLanes.indexOf(c.closest('.track-lane'))
            }
          });

          let itemsToDrag = dragItems;
          if (e.ctrlKey || e.metaKey) {
            // Duplicate selection
            itemsToDrag = dragItems.map(item => {
              const clone = item.el.cloneNode(true);
              item.el.parentElement.appendChild(clone);
              clone.classList.remove('selected');
              
              const isPattern = clone.classList.contains('pattern-clip');
              const newSeqClip = { ...item.seqClip, uiElement: clone, scheduled: false };
              if (isPattern) {
                sequencer.addPatternClip(newSeqClip);
              } else {
                sequencer.addClip(newSeqClip);
              }
              return {
                el: clone,
                seqClip: newSeqClip,
                startLeft: item.startLeft,
                originalStartTime: item.originalStartTime
              };
            });
            // Clear old selection and select clones
            selectedClips.forEach(c => c.classList.remove('selected'));
            selectedClips.clear();
            itemsToDrag.forEach(item => {
              selectedClips.add(item.el);
              item.el.classList.add('selected');
            });
          }

          clipDragState = {
            type: 'move',
            startX: e.clientX,
            startY: e.clientY,
            items: itemsToDrag,
            anchorStartLaneIndex: allLanes.indexOf(clip.closest('.track-lane'))
          };
          
          itemsToDrag.forEach(item => item.el.classList.add('dragging'));
        }
      });

      document.addEventListener('mousemove', (e) => {
        if (marqueeStart) {
          const x1 = Math.min(marqueeStart.x, e.clientX);
          const y1 = Math.min(marqueeStart.y, e.clientY);
          const x2 = Math.max(marqueeStart.x, e.clientX);
          const y2 = Math.max(marqueeStart.y, e.clientY);
          
          marqueeSelection.style.left = `${x1}px`;
          marqueeSelection.style.top = `${y1}px`;
          marqueeSelection.style.width = `${x2 - x1}px`;
          marqueeSelection.style.height = `${y2 - y1}px`;
          
          // Selection logic
          const clips = arrangementView.querySelectorAll('.clip');
          clips.forEach(clip => {
            const rect = clip.getBoundingClientRect();
            const overlap = !(rect.right < x1 || rect.left > x2 || rect.bottom < y1 || rect.top > y2);
            if (overlap) {
              selectedClips.add(clip);
              clip.classList.add('selected');
            } else if (!e.ctrlKey) {
              selectedClips.delete(clip);
              clip.classList.remove('selected');
            }
          });
          return;
        }

        if (!clipDragState) return;
        
        if (clipDragState.type === 'resize' || clipDragState.type === 'paint') {
          const deltaX = e.clientX - clipDragState.startX;
          const newDur = Math.max(0.01, clipDragState.startDur + deltaX / sequencer.pxPerSecond);
          clipDragState.clip.style.width = `${newDur * sequencer.pxPerSecond}px`;
          clipDragState.clip.dataset.duration = newDur;
        } else if (clipDragState.type === 'move') {
          const deltaX = e.clientX - clipDragState.startX;
          
          const elementsUnder = document.elementsFromPoint(e.clientX, e.clientY);
          const newLaneUnderMouse = elementsUnder.find(el => el.classList.contains('track-lane'));
          
          let laneOffset = 0;
          const allLanes = Array.from(document.querySelectorAll('.track-lane'));
          if (newLaneUnderMouse && clipDragState.anchorStartLaneIndex !== undefined) {
             laneOffset = allLanes.indexOf(newLaneUnderMouse) - clipDragState.anchorStartLaneIndex;
          }

          clipDragState.items.forEach(item => {
            let newLeft = Math.max(0, item.startLeft + deltaX);
            const timeInSeconds = newLeft / sequencer.pxPerSecond;
            const snappedTime = sequencer.snapTimeToGrid(timeInSeconds);
            newLeft = snappedTime * sequencer.pxPerSecond;
            
            item.el.style.left = `${newLeft}px`;
            
            if (laneOffset !== 0 && item.startLaneIndex !== undefined) {
               const targetLaneIndex = item.startLaneIndex + laneOffset;
               if (targetLaneIndex >= 0 && targetLaneIndex < allLanes.length) {
                  const targetLane = allLanes[targetLaneIndex];
                  if (targetLane !== item.el.parentElement) {
                     targetLane.appendChild(item.el);
                  }
               }
            }
          });
        }
      });

      document.addEventListener('mouseup', (e) => {
        if (marqueeSelection) {
          marqueeSelection.remove();
          marqueeSelection = null;
          marqueeStart = null;
        }

        if (clipDragState) {
          if (clipDragState.type === 'move') {
            clipDragState.items?.forEach(item => {
              item.el.classList.remove('dragging');
              const newLeft = parseFloat(item.el.style.left) || 0;
              const newStartTime = newLeft / sequencer.pxPerSecond;
              item.el.dataset.startTime = newStartTime;
              if (item.seqClip) {
                item.seqClip.startTime = newStartTime;
                item.seqClip.scheduled = false;
              }
            });
            dawHistory.pushState('Move Clip');
          } else if (clipDragState.type === 'resize' || clipDragState.type === 'paint') {
            const newDur = parseFloat(clipDragState.clip.dataset.duration);
            const sc = sequencer.clips.find(c => c.uiElement === clipDragState.clip) || 
                       sequencer.patternClips.find(pc => pc.uiElement === clipDragState.clip);
            if (sc) {
              sc.duration = newDur;
              sc.scheduled = false;
            }
            dawHistory.pushState('Resize Clip');
          }
          clipDragState = null;
        }
      });

      // Right-click to delete a clip
      arrangementView.addEventListener('contextmenu', (e) => {
        const clip = e.target.closest('.clip')
        if (clip) {
          e.preventDefault();
          const isPattern = clip.classList.contains('pattern-clip')
          const trackId = clip.closest('.track-lane')?.dataset.trackId
          if (isPattern) {
            const seqClip = sequencer.patternClips.find(c => c.uiElement === clip)
            if (seqClip) sequencer.removePatternClip(seqClip)
          } else {
            const seqClip = sequencer.clips.find(c => c.uiElement === clip)
            if (seqClip) sequencer.removeClip(seqClip)
          }
          clip.remove()
          selectedClips.delete(clip);
          if (isPattern && trackId) {
            syncPatternClip(trackId);
          }
          dawHistory.pushState('Delete Clip');
        }
      })
    }

    // Dynamic Tracks Engine Integration
    const tracks = {}

    // Fader interaction and routing
    const mixerChannels = document.querySelectorAll('.mixer-channel')
    
    // UI mapping for Syncing Track Headers and Mixer
    const trackUIMap = {}
    
    // Dynamic Track UI Generation
    function createTrackUI(trackId, trackName, defaultColor, refTrackId = null, position = null) {
      // 1. Initialize track in engine
      tracks[trackName] = engine.createTrack(trackId, trackName)
      trackUIMap[trackId] = { headers: [], mixers: [], seqRows: [] }

      // Find reference elements for insertion
      let refHeader = null;
      let refAutoLabel = null;
      let refLane = null;
      let refAutoLane = null;
      let refChannel = null;
      let refSeqRow = null;

      if (refTrackId && position) {
        const refUI = trackUIMap[refTrackId];
        if (refUI) {
          if (refUI.headers && refUI.headers[0]) {
            refHeader = refUI.headers[0].headerEl;
            if (refHeader) {
              refAutoLabel = refHeader.nextElementSibling;
            }
            refLane = refUI.headers[0].laneEl;
            if (refLane) {
              refAutoLane = refLane.nextElementSibling;
            }
          }
          if (refUI.mixers && refUI.mixers[0]) {
            refChannel = refUI.mixers[0].channelEl;
          }
          if (refUI.seqRows && refUI.seqRows[0]) {
            refSeqRow = refUI.seqRows[0];
          }
        }
      }

      // 2. Track Header
      const headerContainer = document.getElementById('track-headers-container')
      const trackCount = headerContainer.querySelectorAll('.track-header').length + 1
      const header = document.createElement('div')
      header.className = 'track-header'
      header.innerHTML = `
        <div class="track-info">
          <span class="track-number">${trackCount}</span>
          <span class="track-name" contenteditable="true" spellcheck="false">${trackName}</span>
          <input type="color" class="track-color-picker" value="${defaultColor}">
          <button class="remove-track-btn" title="Remove Track">${removeSvg}</button>
        </div>
        <div class="track-controls">
          <button class="t-btn m-btn">M</button>
          <button class="t-btn s-btn">S</button>
          <button class="t-btn r-btn"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z"></path></svg></button>
          <button class="t-btn auto-btn" title="Show/Hide Automation Lane">A</button>
          <div class="track-pan-knob" title="Panning">
            <div class="knob-pointer"></div>
          </div>
          <div class="track-vol-knob" title="Volume">
            <div class="knob-pointer"></div>
          </div>
        </div>
      `
      if (refHeader && position === 'before') {
        headerContainer.insertBefore(header, refHeader);
      } else if (refHeader && position === 'after') {
        const nextEl = refAutoLabel ? refAutoLabel.nextSibling : refHeader.nextSibling;
        headerContainer.insertBefore(header, nextEl);
      } else {
        headerContainer.appendChild(header);
      }

      // 3. Track Lane
      const laneContainer = document.getElementById('track-lanes-container')
      const lane = document.createElement('div')
      lane.className = 'track-lane'
      lane.dataset.trackId = trackId
      if (refLane && position === 'before') {
        laneContainer.insertBefore(lane, refLane);
      } else if (refLane && position === 'after') {
        const nextEl = refAutoLane ? refAutoLane.nextSibling : refLane.nextSibling;
        laneContainer.insertBefore(lane, nextEl);
      } else {
        laneContainer.appendChild(lane);
      }

      // Automation label (header column)
      const autoLabel = document.createElement('div')
      autoLabel.className = 'auto-lane-label'
      autoLabel.dataset.trackId = trackId
      autoLabel.innerHTML = `
        <div class="auto-lane-title">⚡ AUTOMATION</div>
        <select class="auto-param-select">
          <option value="volume">Volume</option>
          <option value="pan">Pan</option>
          <option value="gen.cutoff">Filter Cutoff</option>
          <option value="gen.resonance">Resonance</option>
          <option value="gen.attack">Attack</option>
          <option value="gen.decay">Decay</option>
          <option value="gen.sustain">Sustain</option>
          <option value="gen.release">Release</option>
          <option value="gen.pitch">Pitch</option>
        </select>
      `
      if (refHeader && position === 'before') {
        headerContainer.insertBefore(autoLabel, refHeader);
      } else if (refHeader && position === 'after') {
        const nextEl = refAutoLabel ? refAutoLabel.nextSibling : refHeader.nextSibling;
        headerContainer.insertBefore(autoLabel, nextEl);
      } else {
        headerContainer.appendChild(autoLabel);
      }

      // Automation canvas lane (lane column)
      const autoLane = document.createElement('div')
      autoLane.className = 'auto-lane'
      autoLane.dataset.trackId = trackId
      const autoCanvas = document.createElement('canvas')
      autoCanvas.className = 'auto-canvas'
      autoCanvas.height = 60
      autoCanvas.width = 30000
      autoLane.appendChild(autoCanvas)
      if (refLane && position === 'before') {
        laneContainer.insertBefore(autoLane, refLane);
      } else if (refLane && position === 'after') {
        const nextEl = refAutoLane ? refAutoLane.nextSibling : refLane.nextSibling;
        laneContainer.insertBefore(autoLane, nextEl);
      } else {
        laneContainer.appendChild(autoLane);
      }

      // 4. Mixer Channel
      const mixerContainer = document.getElementById('mixer-channels-container')
      const channel = document.createElement('div')
      channel.className = 'mixer-channel'
      channel.dataset.trackId = trackId
      channel.innerHTML = `
        <div class="channel-name-vertical">${trackName}</div>
        <div class="channel-main-strip">
          <div class="channel-eq-section">
            <div class="eq-knob-container">
              <div class="eq-knob" data-band="high" title="High: 0.0 dB">
                <div class="knob-indicator"></div>
              </div>
            </div>
            <div class="eq-knob-container">
              <div class="eq-knob" data-band="mid" title="Mid: 0.0 dB">
                <div class="knob-indicator"></div>
              </div>
            </div>
            <div class="eq-knob-container">
              <div class="eq-knob" data-band="low" title="Low: 0.0 dB">
                <div class="knob-indicator"></div>
              </div>
            </div>
          </div>
          <div class="channel-controls">
            <div class="btn-group">
              <button class="c-btn m-btn">M</button>
              <button class="c-btn s-btn">S</button>
            </div>
            <div class="pan-knob"><div class="knob-indicator"></div></div>
          </div>
          <div class="fader-section">
            <div class="fader-track"><div class="fader-handle" style="bottom: 80%;"></div></div>
            <div class="peak-meter"><div class="meter-level" style="height: 0%;"></div></div>
          </div>
          <div class="channel-db">0.0dB</div>
        </div>
      `
      if (refChannel && position === 'before') {
        mixerContainer.insertBefore(channel, refChannel);
      } else if (refChannel && position === 'after') {
        mixerContainer.insertBefore(channel, refChannel.nextSibling);
      } else {
        mixerContainer.appendChild(channel);
      }

      // 5. Sequencer Row
      const seqContainer = document.getElementById('seq-rows-container')
      const seqRow = document.createElement('div')
      seqRow.className = 'seq-row'
      seqRow.dataset.trackId = trackId
      seqRow.innerHTML = `
        <div class="seq-label">${trackName}</div>
        <div class="seq-steps" data-instrument="${trackId}" data-note="C1"></div>
      `
      if (refSeqRow && position === 'before') {
        seqContainer.insertBefore(seqRow, refSeqRow);
      } else if (refSeqRow && position === 'after') {
        seqContainer.insertBefore(seqRow, refSeqRow.nextSibling);
      } else {
        seqContainer.appendChild(seqRow);
      }

      // 6. Piano Roll Dropdown Option
      const prSelect = document.getElementById('pr-track-select')
      if (prSelect) {
        const opt = document.createElement('option')
        opt.value = trackId
        opt.textContent = trackName
        prSelect.appendChild(opt)
      }

      // Bind Elements & Events
      const nameEl = header.querySelector('.track-name')
      const colorPicker = header.querySelector('.track-color-picker')
      const mBtnH = header.querySelector('.m-btn')
      const sBtnH = header.querySelector('.s-btn')
      const rBtnH = header.querySelector('.r-btn')
      const volSlider = header.querySelector('.track-vol-slider')

      const nameElM = channel.querySelector('.channel-name-vertical, .channel-name')
      const mBtnM = channel.querySelector('.m-btn')
      const sBtnM = channel.querySelector('.s-btn')
      const faderEl = channel.querySelector('.fader-handle')
      const faderTrackEl = channel.querySelector('.fader-track')
      const dbLabel = channel.querySelector('.channel-db')
      const meterLevel = channel.querySelector('.meter-level')
      channel._meterLevel = meterLevel
      channel._trackName = trackName

      const volKnob = header.querySelector('.track-vol-knob')
      const knobPointer = volKnob.querySelector('.knob-pointer')
      const panKnob = header.querySelector('.track-pan-knob')
      const panPointer = panKnob.querySelector('.knob-pointer')
      const mixerPanKnob = channel.querySelector('.pan-knob')

      trackUIMap[trackId].headers.push({ mBtn: mBtnH, sBtn: sBtnH, rBtn: rBtnH, nameEl, colorPicker, laneEl: lane, headerEl: header, volKnob, knobPointer, panKnob, panPointer })
      trackUIMap[trackId].mixers.push({ mBtn: mBtnM, sBtn: sBtnM, nameEl: nameElM, channelEl: channel, faderEl, faderTrackEl, dbLabel, panKnob: mixerPanKnob })
      trackUIMap[trackId].seqRows.push(seqRow)

      // ── Automation Lane Setup ──────────────────────────────────
      const AUTO_SPECS = {
        'volume':        { min:0,     max:1.5  },
        'pan':           { min:-1,    max:1    },
        'gen.cutoff':    { min:20,    max:20000 },
        'gen.resonance': { min:0.1,   max:20   },
        'gen.attack':    { min:0.001, max:2    },
        'gen.decay':     { min:0.01,  max:2    },
        'gen.sustain':   { min:0,     max:1    },
        'gen.release':   { min:0.01,  max:3    },
        'gen.pitch':     { min:-24,   max:24   },
      };
      let currentAutoParam = 'volume';
      let autoVisible = false;
      const paramSelect = autoLabel.querySelector('.auto-param-select');
      const ctx2d = autoCanvas.getContext('2d');

      const getAutoPoints = () => {
        const tk = engine.getTrack(trackId);
        if (!tk) return [];
        if (!tk.automations[currentAutoParam]) tk.automations[currentAutoParam] = [];
        return tk.automations[currentAutoParam];
      };

      const recordAutoBreakpoint = (param, value) => {
        if (!sequencer.isPlaying || !sequencer.isRecording) return;
        const tk = engine.getTrack(trackId);
        if (!tk || !tk.isArmed) return;
        const t = Math.max(0, engine.ctx.currentTime - sequencer.startTime);
        if (!tk.automations[param]) tk.automations[param] = [];
        tk.automations[param].push({ time: t, value });
        tk.automations[param].sort((a, b) => a.time - b.time);
        if (currentAutoParam === param && autoVisible) drawAutoCanvas();
      };

      function drawAutoCanvas() {
        if (!autoVisible) return;
        const W = autoCanvas.width, H = 60, pps = sequencer.pxPerSecond;
        const spec = AUTO_SPECS[currentAutoParam] || { min:0, max:1 };
        const { min, max } = spec;
        const pts = getAutoPoints();
        ctx2d.clearRect(0, 0, W, H);
        ctx2d.fillStyle = 'rgba(0,0,0,0.3)'; ctx2d.fillRect(0, 0, W, H);
        // bar grid
        const secPerBar = (sequencer.timeSignature.numerator / (sequencer.bpm / 60));
        const pxPerBar = secPerBar * pps;
        ctx2d.strokeStyle = 'rgba(255,255,255,0.06)'; ctx2d.lineWidth = 1;
        for (let x = 0; x < W; x += pxPerBar) { ctx2d.beginPath(); ctx2d.moveTo(x,0); ctx2d.lineTo(x,H); ctx2d.stroke(); }
        // center reference line
        const ctr = (0 - min) / (max - min);
        if (ctr > 0 && ctr < 1) {
          ctx2d.strokeStyle = 'rgba(255,255,255,0.1)'; ctx2d.setLineDash([3,3]);
          ctx2d.beginPath(); ctx2d.moveTo(0, H - ctr*H); ctx2d.lineTo(W, H - ctr*H); ctx2d.stroke();
          ctx2d.setLineDash([]);
        }
        if (pts.length === 0) return;
        const toY = v => H - Math.max(0, Math.min(1, (v-min)/(max-min))) * H;
        const sorted = [...pts].sort((a,b) => a.time - b.time);
        // fill + stroke curve
        ctx2d.beginPath();
        ctx2d.moveTo(0, toY(sorted[0].value));
        sorted.forEach(p => ctx2d.lineTo(p.time * pps, toY(p.value)));
        ctx2d.lineTo(W, toY(sorted[sorted.length-1].value));
        ctx2d.strokeStyle = 'rgba(0,229,255,0.85)'; ctx2d.lineWidth = 1.5; ctx2d.stroke();
        ctx2d.lineTo(W,H); ctx2d.lineTo(0,H); ctx2d.closePath();
        ctx2d.fillStyle = 'rgba(0,229,255,0.07)'; ctx2d.fill();
        // breakpoints
        sorted.forEach(p => {
          const x = p.time * pps, y = toY(p.value);
          ctx2d.beginPath(); ctx2d.arc(x, y, 4, 0, Math.PI*2);
          ctx2d.fillStyle = '#00e5ff'; ctx2d.fill();
          ctx2d.strokeStyle = '#fff'; ctx2d.lineWidth = 1; ctx2d.stroke();
        });
        // playhead
        if (sequencer.isPlaying) {
          const ph = (engine.ctx.currentTime - sequencer.startTime) * pps;
          ctx2d.strokeStyle = 'rgba(255,255,255,0.35)'; ctx2d.lineWidth = 1;
          ctx2d.beginPath(); ctx2d.moveTo(ph,0); ctx2d.lineTo(ph,H); ctx2d.stroke();
        }
      }

      trackUIMap[trackId].drawAutoCanvas = drawAutoCanvas;

      // Canvas mouse interaction
      const HIT = 8;
      let dragPt = null;
      autoCanvas.addEventListener('contextmenu', e => e.preventDefault());
      autoCanvas.addEventListener('mousedown', e => {
        const rect = autoCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const pps = sequencer.pxPerSecond;
        const spec = AUTO_SPECS[currentAutoParam] || { min:0, max:1 };
        const { min, max } = spec;
        const pts = getAutoPoints();
        const toY = v => 60 - Math.max(0,Math.min(1,(v-min)/(max-min)))*60;
        if (e.button === 2) {
          const idx = pts.findIndex(p => { const dx=p.time*pps-mx, dy=toY(p.value)-my; return Math.sqrt(dx*dx+dy*dy)<HIT; });
          if (idx !== -1) { pts.splice(idx, 1); drawAutoCanvas(); }
          return;
        }
        dragPt = pts.find(p => { const dx=p.time*pps-mx, dy=toY(p.value)-my; return Math.sqrt(dx*dx+dy*dy)<HIT; });
        if (!dragPt) {
          const newPt = { time: Math.max(0, mx/pps), value: Math.max(min,Math.min(max, min+(1-my/60)*(max-min))) };
          pts.push(newPt); pts.sort((a,b)=>a.time-b.time); dragPt = newPt; drawAutoCanvas();
        }
      });
      document.addEventListener('mousemove', e => {
        if (!dragPt) return;
        const rect = autoCanvas.getBoundingClientRect();
        const spec = AUTO_SPECS[currentAutoParam] || { min:0, max:1 };
        const { min, max } = spec;
        dragPt.time = Math.max(0, (e.clientX - rect.left) / sequencer.pxPerSecond);
        dragPt.value = Math.max(min, Math.min(max, min + (1 - (e.clientY - rect.top)/60)*(max-min)));
        getAutoPoints().sort((a,b)=>a.time-b.time); drawAutoCanvas();
      });
      document.addEventListener('mouseup', () => { dragPt = null; });

      paramSelect.addEventListener('change', () => { currentAutoParam = paramSelect.value; drawAutoCanvas(); });

      // AUTO button toggle
      const autoBtn = header.querySelector('.auto-btn');
      autoBtn.addEventListener('click', e => {
        e.stopPropagation();
        autoVisible = !autoVisible;
        autoLane.classList.toggle('visible', autoVisible);
        autoLabel.classList.toggle('visible', autoVisible);
        autoBtn.classList.toggle('active', autoVisible);
        if (autoVisible) drawAutoCanvas();
      });

      // Generate step sequencer grid for THIS track only
      const stepCountSelect = document.getElementById('step-count-select')
      const stepCount = stepCountSelect ? parseInt(stepCountSelect.value) : 16
      const seqStepsContainer = seqRow.querySelector('.seq-steps')
      buildStepRows(stepCount, seqStepsContainer)

      // Click to select track
      const selectTrack = () => {
        currentTrackId = trackId
        document.querySelectorAll('.track-header, .mixer-channel, .seq-row').forEach(el => el.classList.remove('selected'))
        header.classList.add('selected')
        channel.classList.add('selected')
        seqRow.classList.add('selected')
        
        // Sync Piano Roll
        const prSelect = document.getElementById('pr-track-select')
        if (prSelect) {
          prSelect.value = trackId
          prSelect.dispatchEvent(new Event('change'))
        }
        if (window.updatePluginsFooter) window.updatePluginsFooter()
      }
      header.addEventListener('mousedown', selectTrack)
      channel.addEventListener('mousedown', selectTrack)
      seqRow.addEventListener('mousedown', selectTrack)

      // Bind EQ Knobs dragging logic inside Mixer Channel
      const eqKnobs = channel.querySelectorAll('.eq-knob');
      eqKnobs.forEach(knob => {
        const band = knob.dataset.band;
        const bandName = band.charAt(0).toUpperCase() + band.slice(1);
        
        let startY = 0;
        let startVal = 0;
        
        const onMouseMove = (e) => {
          const dy = startY - e.clientY;
          // 1px drag = 0.2dB change
          let newVal = startVal + (dy * 0.2);
          newVal = Math.max(-12, Math.min(12, newVal));
          
          // Update engine
          const engineTrack = engine.getTrack(trackId);
          if (engineTrack) {
            engineTrack.setEQ(band, newVal);
          }
          
          // Update UI knob rotation: -12dB -> -135deg, 0dB -> 0deg, +12dB -> 135deg
          const deg = (newVal / 12) * 135;
          knob.style.transform = `rotate(${deg}deg)`;
          
          // Update tooltip (title) live as we drag
          const sign = newVal > 0 ? '+' : '';
          knob.title = `${bandName}: ${sign}${newVal.toFixed(1)} dB`;
        };
        
        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };
        
        knob.addEventListener('mousedown', (e) => {
          startY = e.clientY;
          const engineTrack = engine.getTrack(trackId);
          startVal = engineTrack ? (engineTrack.eqValues[band] || 0) : 0;
          
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
          e.stopPropagation(); // Avoid selecting/deselecting the track during drag
          e.preventDefault();
        });
        
        // Double click to reset to 0dB
        knob.addEventListener('dblclick', (e) => {
          const engineTrack = engine.getTrack(trackId);
          if (engineTrack) {
            engineTrack.setEQ(band, 0);
          }
          knob.style.transform = `rotate(0deg)`;
          knob.title = `${bandName}: 0.0 dB`;
          e.stopPropagation();
        });
      });

      // Scoped Context Menu on Track Header
      header.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectTrack();

        // Close any existing menus
        document.querySelectorAll('.track-context-menu').forEach(m => m.remove());

        const trackNotes = sequencer.patterns[trackId] || [];
        const lane = document.querySelector(`.track-lane[data-track-id="${trackId}"]`);
        const hasClips = lane ? lane.querySelectorAll('.pattern-clip').length > 0 : false;
        const canRestore = trackNotes.length > 0 && !hasClips;

        const menu = document.createElement('div');
        menu.className = 'track-context-menu';
        
        let restoreItemHtml = '';
        if (canRestore) {
          restoreItemHtml = `<div class="track-context-item" id="ctx-restore" style="color: var(--accent-color); font-weight: 700;">Restore Pattern Clip</div>`;
        }

        menu.innerHTML = `
          ${restoreItemHtml}
          <div class="track-context-item" id="ctx-color">Change Color</div>
          <div class="track-context-item" id="ctx-properties">Sound Properties</div>
          <div class="track-context-item" id="ctx-rename">Rename Track</div>
          <div class="track-context-item" id="ctx-insert-before">Insert Track Before</div>
          <div class="track-context-item" id="ctx-insert-after">Insert Track After</div>
          <div class="track-context-item" id="ctx-duplicate">Duplicate Track</div>
          <div class="track-context-item danger" id="ctx-delete">Delete Track</div>
        `;

        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        document.body.appendChild(menu);

        // Bind clicks:
        if (canRestore) {
          menu.querySelector('#ctx-restore').addEventListener('click', () => {
            menu.remove();
            restorePatternClip(trackId);
          });
        }

        menu.querySelector('#ctx-color').addEventListener('click', () => {
          menu.remove();
          colorPicker.click(); // Trigger native color picker
        });

        menu.querySelector('#ctx-properties').addEventListener('click', () => {
          menu.remove();
          // Ensure generator is active, then show generator window
          const tObj = engine.getTrack(trackId);
          if (tObj) {
            if (!tObj.generator) {
              tObj.generator = {
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
              window.updatePluginsFooter();
            }
            showGeneratorWindow(trackId);
          }
        });

        menu.querySelector('#ctx-rename').addEventListener('click', () => {
          menu.remove();
          setTimeout(() => {
            nameEl.focus();
            const range = document.createRange();
            range.selectNodeContents(nameEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }, 50);
        });

        menu.querySelector('#ctx-insert-before').addEventListener('click', () => {
          menu.remove();
          insertNewTrack(trackId, 'before');
        });

        menu.querySelector('#ctx-insert-after').addEventListener('click', () => {
          menu.remove();
          insertNewTrack(trackId, 'after');
        });

        menu.querySelector('#ctx-duplicate').addEventListener('click', () => {
          menu.remove();
          duplicateTrack(trackId);
        });

        menu.querySelector('#ctx-delete').addEventListener('click', () => {
          menu.remove();
          header.querySelector('.remove-track-btn').click();
        });

        // Close menu on click outside
        const closeMenu = (clickEvent) => {
          if (!menu.contains(clickEvent.target)) {
            menu.remove();
            document.removeEventListener('mousedown', closeMenu);
          }
        };
        setTimeout(() => {
          document.addEventListener('mousedown', closeMenu);
        }, 10);
      });

      // Remove Track Logic
      header.querySelector('.remove-track-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Remove track "${trackName}"?`)) {
          engine.removeTrack(trackId);
          delete sequencer.patterns[trackId];
          sequencer.clips = sequencer.clips.filter(c => c.trackId !== trackId);
          // Clean up pattern clips for this track
          sequencer.patternClips.filter(pc => pc.trackId === trackId).forEach(pc => {
            if (pc.uiElement) pc.uiElement.remove();
          });
          sequencer.patternClips = sequencer.patternClips.filter(pc => pc.trackId !== trackId);
          header.remove();
          lane.remove();
          autoLabel.remove();
          autoLane.remove();
          channel.remove();
          seqRow.remove();
          reindexTrackNumbers();
          const prSelect = document.getElementById('pr-track-select');
          if (prSelect) {
            const opt = Array.from(prSelect.options).find(o => o.value === trackId);
            if (opt) opt.remove();
          }
          delete trackUIMap[trackId];
          dawHistory.pushState('Remove Track');
        }
      });

      // Volume & Knob Logic
      if (volKnob) {
        let isDragging = false
        let startY = 0
        let currentVal = 80 // Start at 80%

        const updateKnob = (val) => {
          currentVal = Math.max(0, Math.min(100, val))
          const rotation = (currentVal / 100) * 270 - 135
          knobPointer.style.transform = `rotate(${rotation}deg)`
          
          const gainValue = (currentVal / 100) * 1.5
          tracks[trackName].setVolume(gainValue)
          engine.updateTrackVolumes()
          recordAutoBreakpoint('volume', gainValue)
          // Sync mixer fader
          if (faderEl) faderEl.style.bottom = `${currentVal}%`
          const db = gainValue <= 0 ? -Infinity : 20 * Math.log10(gainValue)
          if (dbLabel) dbLabel.textContent = db === -Infinity ? '-inf' : db.toFixed(1)
        }

        // Expose updateKnob on trackUIMap so we can trigger it externally
        trackUIMap[trackId].updateKnob = updateKnob

        // Initial setup
        updateKnob(80)

        volKnob.addEventListener('mousedown', (e) => {
          engine.resume()
          isDragging = true
          startY = e.clientY
          
          const onMouseMove = (moveEvent) => {
            if (!isDragging) return
            const deltaY = startY - moveEvent.clientY
            startY = moveEvent.clientY
            updateKnob(currentVal + deltaY)
          }

          const onMouseUp = () => {
            isDragging = false
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup', onMouseUp)
            dawHistory.pushState('Adjust Volume')
          }

          document.addEventListener('mousemove', onMouseMove)
          document.addEventListener('mouseup', onMouseUp)
        })

        volKnob.addEventListener('wheel', (e) => {
          e.preventDefault()
          const delta = -e.deltaY / 10
          updateKnob(currentVal + delta)
          dawHistory.pushState('Adjust Volume')
        }, { passive: false })
      }

      if (faderEl) {
        faderEl.addEventListener('mousedown', (e) => {
          engine.resume()
          const onMouseMove = (moveEvent) => {
            const rect = faderTrackEl.getBoundingClientRect()
            let percentage = ((rect.bottom - moveEvent.clientY) / rect.height) * 100
            percentage = Math.max(0, Math.min(100, percentage))
            if (trackUIMap[trackId].updateKnob) {
              trackUIMap[trackId].updateKnob(percentage)
            }
          }
          const onMouseUp = () => { 
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup', onMouseUp)
            dawHistory.pushState('Adjust Volume')
          }
          document.addEventListener('mousemove', onMouseMove)
          document.addEventListener('mouseup', onMouseUp)
        })
      }

      // Panning & Knob Logic
      if (panKnob) {
        let isDraggingPan = false
        let startYPan = 0
        let currentPanVal = 50 // Start at center (50%)

        const updatePan = (val) => {
          currentPanVal = Math.max(0, Math.min(100, val))
          const rotation = (currentPanVal / 100) * 270 - 135
          
          // Rotate arranger pan pointer
          if (panPointer) panPointer.style.transform = `rotate(${rotation}deg)`
          
          // Rotate mixer channel pan pointer
          if (mixerPanKnob) mixerPanKnob.style.transform = `rotate(${rotation}deg)`
          
          const audioPanValue = (currentPanVal - 50) / 50 // Translate 0-100 to -1.0..1.0
          const tNode = tracks[trackName]
          if (tNode && tNode.setPan) {
            tNode.setPan(audioPanValue)
          }
          recordAutoBreakpoint('pan', audioPanValue)
        }

        // Expose updatePan on trackUIMap so we can trigger it externally
        trackUIMap[trackId].updatePan = updatePan

        // Initial setup (Center)
        updatePan(50)

        // Mouse drag on Arranger pan knob
        panKnob.addEventListener('mousedown', (e) => {
          engine.resume()
          isDraggingPan = true
          startYPan = e.clientY
          
          const onMouseMove = (moveEvent) => {
            if (!isDraggingPan) return
            const deltaY = startYPan - moveEvent.clientY
            startYPan = moveEvent.clientY
            updatePan(currentPanVal + deltaY)
          }

          const onMouseUp = () => {
            isDraggingPan = false
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup', onMouseUp)
            dawHistory.pushState('Adjust Pan')
          }

          document.addEventListener('mousemove', onMouseMove)
          document.addEventListener('mouseup', onMouseUp)
        })

        // Mouse wheel scroll on Arranger pan knob
        panKnob.addEventListener('wheel', (e) => {
          e.preventDefault()
          const delta = -e.deltaY / 10
          updatePan(currentPanVal + delta)
          dawHistory.pushState('Adjust Pan')
        }, { passive: false })

        // Mouse drag on Mixer pan knob (mixerPanKnob)
        if (mixerPanKnob) {
          mixerPanKnob.addEventListener('mousedown', (e) => {
            engine.resume()
            isDraggingPan = true
            startYPan = e.clientY
            
            const onMouseMove = (moveEvent) => {
              if (!isDraggingPan) return
              const deltaY = startYPan - moveEvent.clientY
              startYPan = moveEvent.clientY
              updatePan(currentPanVal + deltaY)
            }

            const onMouseUp = () => {
              isDraggingPan = false
              document.removeEventListener('mousemove', onMouseMove)
              document.removeEventListener('mouseup', onMouseUp)
              dawHistory.pushState('Adjust Pan')
            }

            document.addEventListener('mousemove', onMouseMove)
            document.addEventListener('mouseup', onMouseUp)
          })

          // Mouse wheel scroll on Mixer pan knob
          mixerPanKnob.addEventListener('wheel', (e) => {
            e.preventDefault()
            const delta = -e.deltaY / 10
            updatePan(currentPanVal + delta)
            dawHistory.pushState('Adjust Pan')
          }, { passive: false })
        }
      }

      // Sync Names & Colors
      nameEl.addEventListener('blur', () => {
        const newName = nameEl.textContent
        nameElM.textContent = newName
        seqRow.querySelector('.seq-label').textContent = newName
        const opt = document.querySelector(`#pr-track-select option[value="${trackId}"]`)
        if (opt) opt.textContent = newName
        dawHistory.pushState('Rename Track')
      })
      nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur() } })

      async function loadInstrumentToTrack(tid, fileInfo) {
        try {
          const buffer = await window.api.readFile(fileInfo.path);
          if (buffer) {
            const audioBuffer = await engine.decodeAudioData(buffer.buffer);
            const trackObj = engine.getTrack(tid);
            if (trackObj) {
              trackObj.instrumentBuffer = audioBuffer;
              trackObj._instrumentPath = fileInfo.path; // for save/restore
              const match = fileInfo.name.match(/_([A-G]#?-?\d+)\./i);
              if (match) {
                trackObj.instrumentRootMidi = parseNoteToMidi(match[1]);
              } else {
                trackObj.instrumentRootMidi = 60; // Default C4 if no note in filename
              }
              const cleanName = fileInfo.name.split('.').slice(0, -1).join('.') || fileInfo.name;
              
              // Update UI names
              if (nameEl) nameEl.textContent = cleanName;
              if (nameElM) nameElM.textContent = cleanName;
              const labelEl = seqRow.querySelector('.seq-label');
              if (labelEl) labelEl.textContent = cleanName;
              
              const prSelect = document.getElementById('pr-track-select');
              if (prSelect) {
                const opt = Array.from(prSelect.options).find(o => o.value === tid);
                if (opt) opt.textContent = cleanName;
              }
            }
          }
        } catch (err) { console.error('Instrument load error:', err); }
      }

      // Instrument Drop Zone on Header
      header.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
      header.addEventListener('drop', async (e) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('text/plain');
        if (!data) return;
        try {
          const fileInfo = JSON.parse(data);
          await loadInstrumentToTrack(trackId, fileInfo);
        } catch (err) { console.error('Instrument drop error:', err); }
      });
      
      // Expose for initial loading
      trackUIMap[trackId].loadInstrument = loadInstrumentToTrack;

      colorPicker.addEventListener('input', (e) => {
        const color = e.target.value
        header.style.setProperty('--track-color', color)
        lane.style.setProperty('--track-color', color)
        autoLabel.style.setProperty('--track-color', color)
        autoLane.style.setProperty('--track-color', color)
        channel.style.setProperty('--track-color', color)
        seqRow.style.setProperty('--track-color', color)
      })
      colorPicker.addEventListener('change', () => {
        dawHistory.pushState('Change Track Color')
      })

      // Mute / Solo / Record
      const toggleMute = () => { 
        const isMuted = engine.toggleMute(trackId)
        syncTrackUI(trackId, 'mute', isMuted) 
        dawHistory.pushState(isMuted ? 'Mute Track' : 'Unmute Track')
      }
      const toggleSolo = () => { 
        const isSoloed = engine.toggleSolo(trackId)
        syncTrackUI(trackId, 'solo', isSoloed) 
        dawHistory.pushState(isSoloed ? 'Solo Track' : 'Unsolo Track')
      }
      mBtnH.addEventListener('click', toggleMute); mBtnM.addEventListener('click', toggleMute)
      sBtnH.addEventListener('click', toggleSolo); sBtnM.addEventListener('click', toggleSolo)
      rBtnH.addEventListener('click', () => { 
        const isArmed = engine.toggleRecord(trackId)
        syncTrackUI(trackId, 'record', isArmed)
        // Update global recording flag: true if any track is armed
        sequencer.isRecording = Array.from(engine.tracks.values()).some(t => t.isArmed)
        dawHistory.pushState(isArmed ? 'Arm Track' : 'Disarm Track')
      })

      // Generate step sequencer grid for this row

      // Initial color trigger
      colorPicker.dispatchEvent(new Event('input'))

      if (window.updateMixerInserts) window.updateMixerInserts()
      reindexTrackNumbers();
    }

    function reindexTrackNumbers() {
      const headers = document.querySelectorAll('#track-headers-container .track-header');
      headers.forEach((h, index) => {
        const numEl = h.querySelector('.track-number');
        if (numEl) {
          numEl.textContent = index + 1;
        }
      });
    }

    function insertNewTrack(refTrackId, position) {
      const trackId = `track_${customTrackCounter}`;
      const trackName = `Track ${customTrackCounter + 3}`;
      const defaultColor = '#'+Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
      createTrackUI(trackId, trackName, defaultColor, refTrackId, position);
      customTrackCounter++;
      dawHistory.pushState('Insert Track');
    }

    function duplicateTrack(trackId) {
      const oldTrackObj = engine.getTrack(trackId);
      if (!oldTrackObj) return;

      const oldTrackUI = trackUIMap[trackId];
      if (!oldTrackUI) return;

      // 1. Get original properties
      const originalTrackName = oldTrackObj.name || 'Track';
      const newTrackName = `${originalTrackName} (Copy)`;
      
      // Get track color from old header
      let originalTrackColor = '#00e5ff';
      if (oldTrackUI.headers && oldTrackUI.headers[0]) {
        const colorPicker = oldTrackUI.headers[0].colorPicker;
        if (colorPicker) {
          originalTrackColor = colorPicker.value;
        }
      }

      // 2. Generate new track ID
      const newTrackId = `track_${customTrackCounter}`;
      customTrackCounter++;

      // 3. Duplicate pattern data in sequencer
      if (sequencer.patterns[trackId]) {
        sequencer.patterns[newTrackId] = JSON.parse(JSON.stringify(sequencer.patterns[trackId]));
      }

      // 4. Create Track UI and Engine nodes
      createTrackUI(newTrackId, newTrackName, originalTrackColor, trackId, 'after');

      // Get newly created track object
      const newTrackObj = engine.getTrack(newTrackId);
      if (newTrackObj) {
        // Copy volume & pan
        newTrackObj.baseVolume = oldTrackObj.baseVolume;
        newTrackObj.pan = oldTrackObj.pan;
        
        // Copy sampler instrument properties
        newTrackObj.instrumentBuffer = oldTrackObj.instrumentBuffer;
        newTrackObj._instrumentPath = oldTrackObj._instrumentPath;
        newTrackObj.instrumentRootMidi = oldTrackObj.instrumentRootMidi;

        // Copy generator settings
        if (oldTrackObj.generator) {
          newTrackObj.generator = JSON.parse(JSON.stringify(oldTrackObj.generator));
        }

        // Copy EQ values and apply to filters
        if (oldTrackObj.eqValues) {
          newTrackObj.eqValues = JSON.parse(JSON.stringify(oldTrackObj.eqValues));
          Object.keys(newTrackObj.eqValues).forEach(band => {
            newTrackObj.setEQ(band, newTrackObj.eqValues[band]);
          });
        }

        // Copy automation points
        if (oldTrackObj.automations) {
          newTrackObj.automations = JSON.parse(JSON.stringify(oldTrackObj.automations));
        }

        // Copy effects and their parameter values
        if (oldTrackObj.effects && oldTrackObj.effects.length > 0) {
          oldTrackObj.effects.forEach(fx => {
            const newFx = newTrackObj.addEffect(fx.type);
            if (newFx && newFx.updateParams && fx.params) {
              newFx.updateParams({ ...fx.params });
            }
          });
        }
      }

      // 5. Update new track's UI Knobs / Faders / EQ Knobs to match original track values
      const newTrackUI = trackUIMap[newTrackId];
      if (newTrackUI) {
        // Sync volume fader / knob
        if (newTrackUI.updateKnob) {
          newTrackUI.updateKnob((oldTrackObj.baseVolume / 1.5) * 100);
        }
        
        // Sync pan knob
        if (newTrackUI.updatePan) {
          newTrackUI.updatePan((oldTrackObj.pan * 50) + 50);
        }

        // Sync EQ knobs rotations in the UI
        if (oldTrackObj.eqValues) {
          const newChannelEl = newTrackUI.mixers[0]?.channelEl;
          if (newChannelEl) {
            const eqKnobs = newChannelEl.querySelectorAll('.eq-knob');
            eqKnobs.forEach(knob => {
              const band = knob.dataset.band;
              const val = oldTrackObj.eqValues[band] || 0;
              const deg = (val / 12) * 135;
              knob.style.transform = `rotate(${deg}deg)`;
              const bandName = band.charAt(0).toUpperCase() + band.slice(1);
              const sign = val > 0 ? '+' : '';
              knob.title = `${bandName}: ${sign}${val.toFixed(1)} dB`;
            });
          }
        }
      }

      // 6. Duplicate Arranger clips (Audio and Pattern clips)
      const newLane = document.querySelector(`.track-lane[data-track-id="${newTrackId}"]`);
      if (newLane) {
        // A. Pattern clips
        const originalPatternClips = sequencer.patternClips.filter(pc => pc.trackId === trackId);
        originalPatternClips.forEach(pc => {
          createPatternClipUI(newTrackId, pc.startTime, pc.duration, newLane);
        });

        // B. Audio clips
        const originalAudioClips = sequencer.clips.filter(c => c.trackId === trackId);
        originalAudioClips.forEach(c => {
          const clipEl = document.createElement('div');
          clipEl.className = 'clip audio-clip';
          if (c.uiElement && c.uiElement.classList.contains('recorded-clip')) {
            clipEl.className = 'clip audio-clip recorded-clip';
            clipEl.textContent = '● REC';
          } else {
            clipEl.textContent = c._fileName || 'Audio Clip';
          }
          clipEl.style.left = `${c.startTime * sequencer.pxPerSecond}px`;
          clipEl.style.width = `${Math.max(20, c.duration * sequencer.pxPerSecond)}px`;
          clipEl.dataset.startTime = c.startTime;
          clipEl.dataset.duration = c.duration;
          
          const rh = document.createElement('div');
          rh.className = 'resize-handle';
          clipEl.appendChild(rh);
          newLane.appendChild(clipEl);

          sequencer.addClip({
            buffer: c.buffer,
            blob: c.blob,
            startTime: c.startTime,
            duration: c.duration,
            originalDuration: c.originalDuration,
            trackId: newTrackId,
            scheduled: false,
            uiElement: clipEl,
            _filePath: c._filePath,
            _fileName: c._fileName
          });
        });
      }

      // 7. Push DAW History state
      dawHistory.pushState('Duplicate Track');
    }

    // Initialize Default Tracks
    createTrackUI('kick', 'Kick', '#00e5ff')
    createTrackUI('snare', 'Snare', '#00e5ff')
    createTrackUI('hihat', 'Hihat', '#00e5ff')
    createTrackUI('piano', 'Piano', '#ff33aa')
    createTrackUI('bass', 'Bass', '#ffaa00')
    createTrackUI('clap', 'Clap', '#00ffaa')
    createTrackUI('shaker', 'Shaker', '#00ffaa')
    createTrackUI('tom_hi', 'Hi Tom', '#55aaff')
    createTrackUI('organ', 'Organ', '#00ff88')

    // Auto-load default instruments
    setTimeout(async () => {
      try {
        const defaultPath = window.location.href.includes('index.html') 
          ? window.location.pathname.replace('index.html', 'audio').replace(/^\/([a-zA-Z]:)/, '$1')
          : await window.api.getAudioPath()
        
        const defaultSamples = [
          { tid: 'kick', name: 'kick.wav', path: `${defaultPath}/Starter Pack/Drum Kit/kick.wav` },
          { tid: 'snare', name: 'snare.wav', path: `${defaultPath}/Starter Pack/Drum Kit/snare.wav` },
          { tid: 'hihat', name: 'hihat.wav', path: `${defaultPath}/Starter Pack/Drum Kit/hihat.wav` },
          { tid: 'piano', name: 'epiano_C4.wav', path: `${defaultPath}/Starter Pack/Keys/epiano_C4.wav` },
          { tid: 'bass', name: 'sub_bass_C2.wav', path: `${defaultPath}/Starter Pack/Bass/sub_bass_C2.wav` },
          { tid: 'clap', name: 'clap.wav', path: `${defaultPath}/Starter Pack/Drum Kit/clap.wav` },
          { tid: 'shaker', name: 'shaker.wav', path: `${defaultPath}/Starter Pack/Percussion/shaker.wav` },
          { tid: 'tom_hi', name: 'tom_hi.wav', path: `${defaultPath}/Starter Pack/Drum Kit/tom_hi.wav` },
          { tid: 'organ', name: 'organ_C4.wav', path: `${defaultPath}/Starter Pack/Organ/organ_C4.wav` }
        ]
        
        for (const s of defaultSamples) {
          if (trackUIMap[s.tid] && trackUIMap[s.tid].loadInstrument) {
            await trackUIMap[s.tid].loadInstrument(s.tid, s)
          }
        }
      } catch (e) { console.warn("Could not auto-load instruments", e) }
    }, 800)

    // Add Track Button
    const addTrackBtn = document.getElementById('add-track-btn')
    let customTrackCounter = 1
    if (addTrackBtn) {
      addTrackBtn.addEventListener('click', () => {
        const trackId = `track_${customTrackCounter}`
        const trackName = `Track ${customTrackCounter + 3}`
        const defaultColor = '#'+Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
        createTrackUI(trackId, trackName, defaultColor)
        customTrackCounter++
        dawHistory.pushState('Add Track')
      })
    }

    // Master Channel setup (hardcoded in HTML)
    const masterChannel = document.querySelector('.mixer-channel.master')
    if (masterChannel) {
      const fader = masterChannel.querySelector('.fader-handle')
      const trackElement = masterChannel.querySelector('.fader-track')
      masterChannel._meterLevel = masterChannel.querySelector('.meter-level')
      masterChannel._trackName = 'Master'
      if (fader) {
        fader.addEventListener('mousedown', (e) => {
          engine.resume()
          const onMouseMove = (moveEvent) => {
            const rect = trackElement.getBoundingClientRect()
            let percentage = ((rect.bottom - moveEvent.clientY) / rect.height) * 100
            percentage = Math.max(0, Math.min(100, percentage))
            fader.style.bottom = `${percentage}%`
            const gainValue = (percentage / 100) * 1.5
            const dbLabel = masterChannel.querySelector('.channel-db')
            if (dbLabel) {
              const db = percentage === 0 ? -Infinity : 20 * Math.log10(gainValue)
              dbLabel.textContent = db === -Infinity ? '-inf' : db.toFixed(1)
            }
            engine.setMasterVolume(gainValue)
          }
          const onMouseUp = () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp) }
          document.addEventListener('mousemove', onMouseMove)
          document.addEventListener('mouseup', onMouseUp)
        })
      }

      // Select Master Channel
      masterChannel.addEventListener('mousedown', () => {
        currentTrackId = 'master'
        document.querySelectorAll('.track-header, .mixer-channel, .seq-row').forEach(el => el.classList.remove('selected'))
        masterChannel.classList.add('selected')
        if (window.updatePluginsFooter) window.updatePluginsFooter()
      })
    }

    function updateMixerInserts() {
      document.querySelectorAll('.mixer-channel').forEach(channel => {
        const insertsContainer = channel.querySelector('.channel-inserts')
        if (!insertsContainer) return
        
        let trackFx = []
        if (channel.classList.contains('master')) {
          trackFx = engine.effects || []
        } else {
          const trackId = channel.dataset.trackId
          const track = engine.getTrack(trackId)
          trackFx = track ? (track.effects || []) : []
        }
        
        insertsContainer.innerHTML = ''
        for (let i = 0; i < 3; i++) {
          const slot = document.createElement('div')
          slot.className = 'insert-slot'
          if (i < trackFx.length) {
            const fx = trackFx[i]
            slot.className = 'insert-slot active'
            slot.textContent = fx.name
            slot.title = `Double click to open ${fx.name}`
            slot.addEventListener('dblclick', (e) => {
              e.stopPropagation()
              showPluginWindow(fx)
            })
          }
          insertsContainer.appendChild(slot)
        }
      })
    }
    window.updateMixerInserts = updateMixerInserts

    function syncTrackUI(trackId, type, state) {
      const map = trackUIMap[trackId]
      if (!map) return
      
      if (type === 'mute') {
        map.headers.forEach(h => h.mBtn?.classList.toggle('active', state))
        map.mixers.forEach(m => m.mBtn?.classList.toggle('active', state))
      } else if (type === 'solo') {
        map.headers.forEach(h => h.sBtn?.classList.toggle('active', state))
        map.mixers.forEach(m => m.sBtn?.classList.toggle('active', state))
      } else if (type === 'record') {
        map.headers.forEach(h => h.rBtn?.classList.toggle('active', state))
      }
    }

    // Trigger initial sync for names and colors now that both headers and mixers are mapped
    Object.keys(trackUIMap).forEach(trackId => {
      trackUIMap[trackId].headers.forEach(h => {
        if (h.colorPicker) h.colorPicker.dispatchEvent(new Event('input'))
        if (h.nameEl) {
          const newName = h.nameEl.textContent
          trackUIMap[trackId].mixers.forEach(m => {
            if (m.nameEl) m.nameEl.textContent = newName
          })
        }
      })
    })

    // Animation Loop for Peak Meters
    function renderLoop() {
      // Update dynamic position
      const posDisplay = document.getElementById('position-display')
      if (posDisplay) {
        const timeInSeconds = sequencer.isPlaying ? engine.ctx.currentTime - sequencer.startTime : sequencer.pauseTime
        const beatsPerSecond = sequencer.bpm / 60
        const totalBeats = timeInSeconds * beatsPerSecond
        const beatsPerBar = sequencer.timeSignature?.numerator || 4
        const bars = Math.floor(totalBeats / beatsPerBar) + 1
        const beats = Math.floor(totalBeats % beatsPerBar) + 1
        const ticks = Math.floor((totalBeats - Math.floor(totalBeats)) * 16) + 1 // Sixteenths
        const pad = (n, s) => n.toString().padStart(s, '0')
        posDisplay.textContent = `${pad(bars, 3)} : ${pad(beats, 2)} : ${pad(ticks, 2)}`
      }

      const allMixerChannels = document.querySelectorAll('.mixer-channel');
      allMixerChannels.forEach((channel) => {
        const meter = channel.querySelector('.meter-level');
        if (!meter) return;
        
        let peak = 0;
        if (channel.classList.contains('master') || channel.querySelector('.channel-name-vertical, .channel-name')?.textContent === 'Master') {
          peak = engine.getMasterPeakLevel();
        } else if (channel.dataset.trackId) {
          const trackObj = engine.getTrack(channel.dataset.trackId);
          if (trackObj) peak = trackObj.getPeakLevel();
        }
        
        meter.style.height = `${peak * 100}%`;
      });
      
      requestAnimationFrame(renderLoop)
    }
    
    renderLoop()
    
    // Footer Resizer Logic
    const footerResizer = document.getElementById('footer-resizer')
    if (footerResizer) {
      footerResizer.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const appContainer = document.getElementById('app')
        
        const onMouseMove = (moveEvent) => {
          const windowHeight = window.innerHeight
          let newHeight = windowHeight - moveEvent.clientY
          newHeight = Math.max(100, Math.min(newHeight, windowHeight - 200))
          appContainer.style.setProperty('--dynamic-footer-height', `${newHeight}px`)
        }
        
        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove)
          document.removeEventListener('mouseup', onMouseUp)
        }
        
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
      })
    }

    drawTimeline() // Initial draw
    
    function switchToView(targetId) {
      const toggleBtns = document.querySelectorAll('.toggle-view')
      const footerPanels = document.querySelectorAll('.footer-panel')
      
      toggleBtns.forEach(b => {
        if (b.dataset.target === targetId) {
          b.classList.add('btn-primary')
        } else {
          b.classList.remove('btn-primary')
        }
      })
      
      footerPanels.forEach(p => {
        if (p.id === targetId) {
          p.classList.add('active')
        } else {
          p.classList.remove('active')
        }
      })
      
      const app = document.getElementById('app')
      if (app && app.classList.contains('footer-collapsed')) {
        app.classList.remove('footer-collapsed')
      }
    }

    // Bottom Panel Toggles
    const toggleBtns = document.querySelectorAll('.toggle-view')
    const footerPanels = document.querySelectorAll('.footer-panel')
    
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchToView(btn.dataset.target)
      })
      btn.addEventListener('dblclick', () => {
        const app = document.getElementById('app')
        if (app.classList.contains('footer-collapsed')) {
          app.classList.remove('footer-collapsed')
        }
      })
    })        

    
    // ── Editable BPM ──────────────────────────────────────────────
    const bpmDisplay = document.getElementById('bpm-display')
    if (bpmDisplay) {
      let isDraggingBPM = false
      let startY = 0
      let startBPM = 0
      
      bpmDisplay.addEventListener('mousedown', (e) => {
        isDraggingBPM = true
        startY = e.clientY
        startBPM = sequencer.bpm
        document.body.style.cursor = 'ns-resize'
        e.preventDefault()
      })
      
      document.addEventListener('mousemove', (e) => {
        if (!isDraggingBPM) return
        const deltaY = startY - e.clientY
        let newBPM = startBPM + deltaY * 0.5
        newBPM = Math.max(20, Math.min(999, newBPM))
        
        const oldBPM = sequencer.bpm
        const ratio = oldBPM / newBPM
        
        sequencer.bpm = newBPM
        bpmDisplay.textContent = newBPM.toFixed(1)
        drawTimeline()
        if (typeof drawPianoRollTimeline === 'function') drawPianoRollTimeline()
        
        // Scale all clips to stay locked to their musical grid positions
        const scaleClip = (c) => {
          c.startTime *= ratio
          c.duration *= ratio
          if (c.originalDuration !== undefined) c.originalDuration *= ratio
          
          if (c.uiElement) {
            c.uiElement.dataset.startTime = c.startTime
            c.uiElement.dataset.duration = c.duration
            c.uiElement.style.left = `${c.startTime * sequencer.pxPerSecond}px`
            c.uiElement.style.width = `${Math.max(20, c.duration * sequencer.pxPerSecond)}px`
          }
        }
        
        sequencer.clips.forEach(scaleClip)
        sequencer.patternClips.forEach(scaleClip)

        // Reschedule if playing so tempo change takes effect immediately
        if (sequencer.isPlaying) {
          sequencer.rescheduleAtTempo(ratio)
        }
      })
      
      document.addEventListener('mouseup', () => {
        if (isDraggingBPM) {
          isDraggingBPM = false
          document.body.style.cursor = ''
        }
      })
    }

    // ── Editable Time Signature ───────────────────────────────────
    const timeSigDisplay = document.getElementById('time-sig-display')
    if (timeSigDisplay) {
      timeSigDisplay.addEventListener('change', (e) => {
        const parts = e.target.value.split('/')
        const num = parseInt(parts[0]), den = parseInt(parts[1])
        if (num > 0 && den > 0) {
          sequencer.timeSignature = { numerator: num, denominator: den }
          drawTimeline()
        }
      })
    }

    // ── Step Count + Step Sequencer Init ─────────────────────────


    function getPrStepPx() {
      // 1 step = 1/16th note; match arranger's pixels-per-second so grids align
      const secondsPer16th = (60 / sequencer.bpm) / 4
      return Math.max(4, secondsPer16th * sequencer.pxPerSecond * prZoomFactor)
    }

    function applyPrZoom(val, isFromSlider = false) {
      let factor;
      if (isFromSlider) {
        if (val <= 50) {
          factor = 0.25 + (val - 1) * (0.75 / 49);
        } else {
          factor = 1.0 + (val - 50) * (7.0 / 50);
        }
      } else {
        factor = val;
      }
      
      prZoomFactor = Math.max(0.25, Math.min(8, factor))
      const label = document.getElementById('pr-zoom-label')
      if (label) label.textContent = `${Math.round(prZoomFactor * 100)}%`
      
      const slider = document.getElementById('pr-zoom-slider')
      if (slider) {
        let sliderVal;
        if (prZoomFactor <= 1.0) {
          sliderVal = 1 + (prZoomFactor - 0.25) * (49 / 0.75);
        } else {
          sliderVal = 50 + (prZoomFactor - 1.0) * (50 / 7.0);
        }
        if (Math.abs(parseFloat(slider.value) - sliderVal) > 0.5) {
          slider.value = sliderVal;
        }
      }
      
      drawPianoRollTimeline()
      rebuildPianoRollNotes()
      // update step-sequencer cell width
      document.querySelectorAll('.seq-step').forEach(s => {
        s.style.width = `${getPrStepPx()}px`
      })
    }

    function buildStepRows(count, targetContainer = null) {
      const containers = targetContainer ? [targetContainer] : document.querySelectorAll('.seq-steps')
      containers.forEach(container => {
        const note = container.dataset.note || null
        const trackId = container.dataset.instrument || 'drums'
        container.innerHTML = ''
        const trackNotes = sequencer.patterns[trackId] || []
        for (let i = 0; i < count; i++) {
          const step = document.createElement('div')
          step.className = 'seq-step'
          step.dataset.stepIndex = i
          
          const isActive = trackNotes.some(n => n.note === note && n.step === i)
          if (isActive) step.classList.add('active')

          step.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left Click
              if (!step.classList.contains('active')) {
                step.classList.add('active')
                if (note) syncStepToPianoRoll(trackId, note, i, true)
                dawHistory.pushState('Toggle Step')
              }
            }
          })
          step.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (step.classList.contains('active')) {
              step.classList.remove('active');
              if (note) syncStepToPianoRoll(trackId, note, i, false);
              dawHistory.pushState('Toggle Step')
            }
          })
          container.appendChild(step)
        }
      })
    }

    function syncPatternClip(trackId) {
      if (!trackId) return;
      const lane = document.querySelector(`.track-lane[data-track-id="${trackId}"]`);
      if (!lane) return;
      
      const pClips = lane.querySelectorAll('.pattern-clip');
      const trackNotes = sequencer.patterns[trackId] || [];
      
      if (trackNotes.length === 0) {
        pClips.forEach(pClip => {
          const oldSeq = sequencer.patternClips.find(pc => pc.uiElement === pClip);
          if (oldSeq) sequencer.removePatternClip(oldSeq);
          pClip.remove();
        });
        lane.querySelectorAll('.empty-lane-placeholder').forEach(p => p.remove());
        return;
      }
      
      let maxStep = 0;
      trackNotes.forEach(n => {
        const endStep = n.step + n.durationSteps;
        if (endStep > maxStep) maxStep = endStep;
      });
      
      const beatsPerSecond = sequencer.bpm / 60;
      const secondsPerStep = (1 / beatsPerSecond) / 4;
      const maxTime = maxStep * secondsPerStep;
      
      const beatsPerBar = sequencer.timeSignature?.numerator || 4;
      const secondsPerBar = (60 / sequencer.bpm) * beatsPerBar;
      const musicalDuration = Math.ceil((maxTime - 0.01) / secondsPerBar) * secondsPerBar;
      const finalDuration = Math.max(secondsPerBar, musicalDuration);
      
      if (pClips.length > 0) {
        // Clips exist: update their sizing and redraw mini notes
        lane.querySelectorAll('.empty-lane-placeholder').forEach(p => p.remove());
        pClips.forEach(pClip => {
          pClip.style.width = `${Math.floor(finalDuration * sequencer.pxPerSecond)}px`;
          pClip.dataset.duration = finalDuration;
          const seqPc = sequencer.patternClips.find(pc => pc.uiElement === pClip);
          if (seqPc) seqPc.duration = finalDuration;
          
          updatePatternClipMiniNotes(pClip, trackId, trackNotes, secondsPerStep);
        });
      } else {
        // No clips on track lane: render the beautiful empty lane placeholder!
        showEmptyLanePlaceholder(trackId);
      }
    }

    function showEmptyLanePlaceholder(trackId) {
      const lane = document.querySelector(`.track-lane[data-track-id="${trackId}"]`);
      if (!lane) return;

      lane.querySelectorAll('.empty-lane-placeholder').forEach(p => p.remove());

      const placeholder = document.createElement('div');
      placeholder.className = 'empty-lane-placeholder';
      const count = (sequencer.patterns[trackId] || []).length;
      placeholder.innerHTML = `<span>🎵 Restore Pattern Clip (${count} notes exist)</span>`;
      
      placeholder.addEventListener('click', (e) => {
        e.stopPropagation();
        restorePatternClip(trackId);
      });
      
      lane.appendChild(placeholder);
    }

    function restorePatternClip(trackId) {
      const lane = document.querySelector(`.track-lane[data-track-id="${trackId}"]`);
      if (!lane) return;

      lane.querySelectorAll('.empty-lane-placeholder').forEach(p => p.remove());

      const trackNotes = sequencer.patterns[trackId] || [];
      if (trackNotes.length === 0) return;

      let maxStep = 0;
      trackNotes.forEach(n => {
        const endStep = n.step + n.durationSteps;
        if (endStep > maxStep) maxStep = endStep;
      });

      const beatsPerSecond = sequencer.bpm / 60;
      const secondsPerStep = (1 / beatsPerSecond) / 4;
      const maxTime = maxStep * secondsPerStep;

      const beatsPerBar = sequencer.timeSignature?.numerator || 4;
      const secondsPerBar = (60 / sequencer.bpm) * beatsPerBar;
      const musicalDuration = Math.ceil((maxTime - 0.01) / secondsPerBar) * secondsPerBar;
      const finalDuration = Math.max(secondsPerBar, musicalDuration);

      createPatternClipUI(trackId, 0, finalDuration, lane);
    }

    function createPatternClipUI(trackId, startTime, duration, lane) {
      const pClip = document.createElement('div');
      pClip.className = 'clip pattern-clip';
      pClip.style.left = `${startTime * sequencer.pxPerSecond}px`;
      pClip.style.width = `${Math.floor(duration * sequencer.pxPerSecond)}px`;
      pClip.style.opacity = '0.85';
      
      const map = trackUIMap[trackId];
      if (map && map.headers[0]) {
        const color = map.headers[0].laneEl.style.getPropertyValue('--track-color');
        if (color) pClip.style.background = color;
      }
      
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      pClip.appendChild(handle);
      
      lane.appendChild(pClip);
      
      const seqPc = { trackId, startTime, duration, uiElement: pClip };
      sequencer.addPatternClip(seqPc);
      pClip.dataset.startTime = startTime;
      pClip.dataset.duration = duration;
      pClip.dataset.patternTrackId = trackId;
      
      pClip.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const map = trackUIMap[trackId];
        if (map && map.headers[0] && map.headers[0].headerEl) {
          map.headers[0].headerEl.dispatchEvent(new MouseEvent('mousedown'));
        }
        switchToView('piano-roll-view');
      });

      const trackNotes = sequencer.patterns[trackId] || [];
      const beatsPerSecond = sequencer.bpm / 60;
      const secondsPerStep = (1 / beatsPerSecond) / 4;
      updatePatternClipMiniNotes(pClip, trackId, trackNotes, secondsPerStep);
      return pClip;
    }

    function updatePatternClipMiniNotes(pClip, trackId, trackNotes, secondsPerStep) {
      const handle = pClip.querySelector('.resize-handle');
      pClip.innerHTML = `<span style="font-size:9px; padding-left:4px; opacity:0.9; position:absolute; top:2px; color:rgba(0,0,0,0.9); pointer-events:none; font-weight:bold; z-index:1;">Pattern</span>`;
      if (handle) pClip.appendChild(handle);
      else {
        const h2 = document.createElement('div');
        h2.className = 'resize-handle';
        pClip.appendChild(h2);
      }
      
      trackNotes.forEach(n => {
        const mini = document.createElement('div');
        mini.className = 'pattern-mini-note';
        mini.style.background = 'rgba(0,0,0,0.5)';
        const startX = (n.step * secondsPerStep) * sequencer.pxPerSecond;
        const width = (n.durationSteps * secondsPerStep) * sequencer.pxPerSecond;
        
        // Vertical positioning: draw notes at the bottom, stacked slightly by pitch
        const midi = parseNoteToMidi(n.note);
        const pitchOffset = (midi % 12) * 1.5; // Small vertical spread
        mini.style.left = `${startX}px`;
        mini.style.width = `${Math.max(3, width - 1)}px`;
        mini.style.height = '4px';
        mini.style.bottom = `${2 + pitchOffset}px`; // Aligned at the bottom
        mini.style.top = 'auto';
        mini.style.pointerEvents = 'none';
        pClip.appendChild(mini);
      });
    }

    function syncStepToPianoRoll(trackId, noteName, stepIndex, active) {
      const grid = document.getElementById('piano-grid')
      const currentPrTrackId = document.getElementById('pr-track-select')?.value || 'drums';
      
      if (grid && trackId === currentPrTrackId) {
        const row = grid.querySelector(`[data-note="${noteName}"]`)
        if (row) {
          const existing = row.querySelector(`[data-step="${stepIndex}"]`)
          if (active && !existing) {
            const n = document.createElement('div')
            n.className = 'pr-note'
            n.dataset.step = stepIndex
            n.style.left = `${stepIndex * getPrStepPx() + 1}px`
            n.style.width = `${getPrStepPx() - 3}px`
            const map = trackUIMap[trackId]
            if (map && map.headers[0]) {
              const color = map.headers[0].laneEl.style.getPropertyValue('--track-color')
              if (color) n.style.background = color
            }
            n.addEventListener('click', (e) => { 
              e.stopPropagation(); 
              n.remove();
              sequencer.removeNoteFromPattern(trackId, noteName, stepIndex);
              const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${trackId}"][data-note="${noteName}"]`);
              if (stepSeqRow) {
                const s = stepSeqRow.querySelector(`[data-step-index="${stepIndex}"]`);
                if (s) s.classList.remove('active');
              }
            })
            row.appendChild(n)
          } else if (!active && existing) {
            existing.remove()
          }
        }
      }
      
      if (active) {
        sequencer.addNoteToPattern(trackId, noteName, stepIndex, 1);
        engine.playNote(trackId, noteName, engine.ctx.currentTime, 0.2);
      } else {
        sequencer.removeNoteFromPattern(trackId, noteName, stepIndex);
      }
      syncPatternClip(trackId);
    }

    buildStepRows(16)

    document.getElementById('step-count-select')?.addEventListener('change', (e) => {
      buildStepRows(parseInt(e.target.value))
    })

    // ── Piano Roll Advanced Interactions ─────────────────────────
    const pianoGrid = document.getElementById('piano-grid')
    const prTrackSelect = document.getElementById('pr-track-select')
    
    let lastPrNoteDuration = 1; 
    let prDragState = null; // { type: 'move'|'resize'|'paint', noteElement, startX, startY, startStep, startDur, originalNoteObj, trackId }
    
    function createPrNote(trackId, noteName, stepIndex, durationSteps, color) {
      const note = document.createElement('div')
      note.className = 'pr-note'
      note.dataset.step = stepIndex
      note.dataset.duration = durationSteps
      note.style.left = `${stepIndex * getPrStepPx() + 1}px`
      note.style.width = `${durationSteps * getPrStepPx() - 3}px`
      if (color) note.style.background = color
      
      const handle = document.createElement('div')
      handle.className = 'resize-handle'
      note.appendChild(handle)
      
      return note;
    }

    if (pianoGrid) {
      let prMarqueeStart = null;
      
      pianoGrid.addEventListener('contextmenu', (e) => {
        const note = e.target.closest('.pr-note');
        if (note) {
          e.preventDefault();
          const currentTrackId = prTrackSelect ? prTrackSelect.value : 'drums';
          const row = note.closest('.pr-row');
          if (row) {
            const noteName = row.dataset.note;
            const step = parseInt(note.dataset.step);
            sequencer.removeNoteFromPattern(currentTrackId, noteName, step);
            const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${currentTrackId}"][data-note="${noteName}"]`);
            if (stepSeqRow) {
              const s = stepSeqRow.querySelector(`[data-step-index="${step}"]`);
              if (s) s.classList.remove('active');
            }
          }
          selectedNotes.delete(note);
          note.remove();
          dawHistory.pushState('Delete Note');
        }
      });
      
      pianoGrid.addEventListener('mousedown', (e) => {
        const currentTrackId = prTrackSelect ? prTrackSelect.value : 'drums'
        if (e.button === 2) return; 

        // Shift + Drag = Marquee
        if (e.shiftKey) {
          if (!e.ctrlKey) {
            selectedNotes.forEach(n => n.classList.remove('selected'));
            selectedNotes.clear();
          }
          const rect = pianoGrid.getBoundingClientRect();
          prMarqueeStart = { x: e.clientX, y: e.clientY };
          marqueeSelection = document.createElement('div');
          marqueeSelection.className = 'selection-marquee';
          document.body.appendChild(marqueeSelection);
          return;
        }
        
        // Resize handle
        if (e.target.classList.contains('resize-handle')) {
          e.preventDefault()
          e.stopPropagation()
          const noteEl = e.target.closest('.pr-note')
          const row = noteEl.closest('.pr-row')
          prDragState = {
            type: e.shiftKey ? 'paint' : 'resize',
            noteElement: noteEl,
            startX: e.clientX,
            startStep: parseInt(noteEl.dataset.step),
            startDur: parseFloat(noteEl.dataset.duration || 1),
            noteName: row.dataset.note,
            trackId: currentTrackId
          }
          return;
        }
        
        // Existing note click/drag
        const noteEl = e.target.closest('.pr-note')
        if (noteEl) {
          e.preventDefault()
          e.stopPropagation()
          const row = noteEl.closest('.pr-row')
          
          if (e.ctrlKey || e.shiftKey) {
            if (selectedNotes.has(noteEl)) {
              selectedNotes.delete(noteEl);
              noteEl.classList.remove('selected');
            } else {
              selectedNotes.add(noteEl);
              noteEl.classList.add('selected');
            }
            return;
          }

          if (!selectedNotes.has(noteEl)) {
            selectedNotes.forEach(n => n.classList.remove('selected'));
            selectedNotes.clear();
            selectedNotes.add(noteEl);
            noteEl.classList.add('selected');
          }
          
          const anchorRow = noteEl.closest('.pr-row');
          const allRows = Array.from(pianoGrid.querySelectorAll('.pr-row'));
          const anchorStartRowIndex = allRows.indexOf(anchorRow);

          const dragItems = Array.from(selectedNotes).map(n => {
            const row = n.closest('.pr-row');
            return {
              el: n,
              startStep: parseInt(n.dataset.step),
              startDur: parseFloat(n.dataset.duration || 1),
              noteName: row.dataset.note,
              startRowIndex: allRows.indexOf(row)
            };
          });
          let itemsToDrag = dragItems;
          if (e.altKey || (e.ctrlKey && selectedNotes.has(noteEl))) {
            // Duplicate
            itemsToDrag = dragItems.map(item => {
              const clone = item.el.cloneNode(true);
              item.el.parentElement.appendChild(clone);
              clone.classList.remove('selected');
              return {
                el: clone,
                startStep: item.startStep,
                startDur: item.startDur,
                noteName: item.noteName,
                isNew: true
              }
            });
            selectedNotes.forEach(n => n.classList.remove('selected'));
            selectedNotes.clear();
            itemsToDrag.forEach(item => {
              selectedNotes.add(item.el);
              item.el.classList.add('selected');
            });
          }

          prDragState = {
            type: 'move',
            startX: e.clientX,
            startY: e.clientY,
            items: itemsToDrag,
            trackId: currentTrackId,
            anchorStartRowIndex: anchorStartRowIndex
          }
          itemsToDrag.forEach(n => n.el.classList.add('dragging'))
          return;
        }
        
        // Deselect if clicking empty space
        if (!e.ctrlKey && !e.shiftKey && selectedNotes.size > 0) {
          selectedNotes.forEach(n => n.classList.remove('selected'));
          selectedNotes.clear();
          return; // Stop here to avoid creating a note on the same click
        }
        
        // Create new note
        const row = e.target.closest('.pr-row')
        if (row) {
          const gridRect = pianoGrid.getBoundingClientRect()
          const x = e.clientX - gridRect.left + pianoGrid.scrollLeft
          const step = Math.floor(x / getPrStepPx())
          const noteName = row.dataset.note
          
          const map = trackUIMap[currentTrackId]
          const color = map && map.headers[0] ? map.headers[0].laneEl.style.getPropertyValue('--track-color') : null
          
          const note = createPrNote(currentTrackId, noteName, step, lastPrNoteDuration, color)
          row.appendChild(note)
          
          prDragState = {
            type: 'move',
            startX: e.clientX,
            startY: e.clientY,
            items: [{
              el: note,
              startStep: step,
              startDur: lastPrNoteDuration,
              noteName: noteName
            }],
            trackId: currentTrackId,
            isNew: true
          }
        }
      })
      
      document.addEventListener('mousemove', (e) => {
        if (prMarqueeStart) {
          const x1 = Math.min(prMarqueeStart.x, e.clientX);
          const y1 = Math.min(prMarqueeStart.y, e.clientY);
          const x2 = Math.max(prMarqueeStart.x, e.clientX);
          const y2 = Math.max(prMarqueeStart.y, e.clientY);
          
          marqueeSelection.style.left = `${x1}px`;
          marqueeSelection.style.top = `${y1}px`;
          marqueeSelection.style.width = `${x2 - x1}px`;
          marqueeSelection.style.height = `${y2 - y1}px`;
          
          const notes = pianoGrid.querySelectorAll('.pr-note');
          notes.forEach(note => {
            const rect = note.getBoundingClientRect();
            const overlap = !(rect.right < x1 || rect.left > x2 || rect.bottom < y1 || rect.top > y2);
            if (overlap) {
              selectedNotes.add(note);
              note.classList.add('selected');
            } else if (!e.ctrlKey && !e.shiftKey) {
              selectedNotes.delete(note);
              note.classList.remove('selected');
            }
          });
          return;
        }

        if (!prDragState) return;
        
        if (prDragState.type === 'resize' || prDragState.type === 'paint') {
          const deltaX = e.clientX - prDragState.startX;
          const newDur = Math.max(0.25, prDragState.startDur + deltaX / getPrStepPx());
          prDragState.noteElement.style.width = `${newDur * getPrStepPx() - 3}px`;
          prDragState.noteElement.dataset.duration = newDur;
        } else if (prDragState.type === 'move') {
          const deltaX = e.clientX - prDragState.startX;
          const deltaY = e.clientY - prDragState.startY;
          
          const elementsUnder = document.elementsFromPoint(e.clientX, e.clientY);
          const newRowUnderMouse = elementsUnder.find(el => el.classList.contains('pr-row'));
          
          let rowOffset = 0;
          const allRows = Array.from(pianoGrid.querySelectorAll('.pr-row'));
          if (newRowUnderMouse && prDragState.anchorStartRowIndex !== undefined) {
             const currentAnchorRowIndex = allRows.indexOf(newRowUnderMouse);
             rowOffset = currentAnchorRowIndex - prDragState.anchorStartRowIndex;
          }

          prDragState.items.forEach(item => {
            const newStep = Math.max(0, Math.round(item.startStep + deltaX / getPrStepPx()));
            item.el.style.left = `${newStep * getPrStepPx() + 1}px`;
            item.el.dataset.step = newStep;
            
            if (rowOffset !== 0 && item.startRowIndex !== undefined) {
               const targetRowIndex = item.startRowIndex + rowOffset;
               if (targetRowIndex >= 0 && targetRowIndex < allRows.length) {
                  const targetRow = allRows[targetRowIndex];
                  if (targetRow !== item.el.parentElement) {
                     targetRow.appendChild(item.el);
                  }
               }
            }
          });
        }
      });
      
      document.addEventListener('mouseup', (e) => {
        if (marqueeSelection) {
          marqueeSelection.remove();
          marqueeSelection = null;
          prMarqueeStart = null;
        }

        if (prDragState) {
          const isResize = prDragState.type === 'resize' || prDragState.type === 'paint';
          const actionName = isResize ? 'Resize Note' : (prDragState.isNew ? 'Create Note' : 'Move Note');

          if (isResize) {
            const finalDur = parseFloat(prDragState.noteElement.dataset.duration || prDragState.startDur);
            sequencer.removeNoteFromPattern(prDragState.trackId, prDragState.noteName, prDragState.startStep);
            sequencer.addNoteToPattern(prDragState.trackId, prDragState.noteName, prDragState.startStep, finalDur);
            
            const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${prDragState.trackId}"][data-note="${prDragState.noteName}"]`);
            if (stepSeqRow) {
              const s = stepSeqRow.querySelector(`[data-step-index="${prDragState.startStep}"]`);
              if (s) s.classList.add('active');
            }
            lastPrNoteDuration = finalDur;
          } else {
            prDragState.items?.forEach(item => {
              item.el.classList.remove('dragging');
              const row = item.el.closest('.pr-row');
              const finalNoteName = row ? row.dataset.note : item.noteName;
              const finalStep = parseInt(item.el.dataset.step);
              const finalDur = parseFloat(item.el.dataset.duration || item.startDur);

              if (!prDragState.isNew) {
                sequencer.removeNoteFromPattern(prDragState.trackId, item.noteName, item.startStep);
                const oldStepSeqRow = document.querySelector(`.seq-steps[data-instrument="${prDragState.trackId}"][data-note="${item.noteName}"]`);
                if (oldStepSeqRow) {
                  const s = oldStepSeqRow.querySelector(`[data-step-index="${item.startStep}"]`);
                  if (s) s.classList.remove('active');
                }
              }
              sequencer.addNoteToPattern(prDragState.trackId, finalNoteName, finalStep, finalDur);
              
              const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${prDragState.trackId}"][data-note="${finalNoteName}"]`);
              if (stepSeqRow) {
                const s = stepSeqRow.querySelector(`[data-step-index="${finalStep}"]`);
                if (s) s.classList.add('active');
              }
              lastPrNoteDuration = finalDur;
            });
          }
          syncPatternClip(prDragState.trackId);
          prDragState = null;
          dawHistory.pushState(actionName);
        }
      });
    }
    
    if (prTrackSelect) {
      prTrackSelect.addEventListener('change', () => {
        const trackId = prTrackSelect.value;
        const grid = document.getElementById('piano-grid');
        grid.querySelectorAll('.pr-note').forEach(n => n.remove());
        
        if (sequencer.patterns[trackId]) {
          const map = trackUIMap[trackId];
          const color = map && map.headers[0] ? map.headers[0].laneEl.style.getPropertyValue('--track-color') : null;
          
          sequencer.patterns[trackId].forEach(noteObj => {
            const row = grid.querySelector(`[data-note="${noteObj.note}"]`);
            if (row) {
              const note = createPrNote(trackId, noteObj.note, noteObj.step, noteObj.durationSteps, color)
              row.appendChild(note);
            }
          });
        }
      });
    }

    // ── Build Piano Roll ──────────────────────────────────────────
    buildPianoRoll()
    
    function rebuildPianoRollNotes() {
      const grid = document.getElementById('piano-grid')
      if (!grid) return
      const trackId = document.getElementById('pr-track-select')?.value
      if (!trackId) return
      // Re-position existing notes at new step width
      grid.querySelectorAll('.pr-note').forEach(n => {
        const step = parseInt(n.dataset.step) || 0
        const dur = parseFloat(n.dataset.duration) || 1
        n.style.left = `${step * getPrStepPx() + 1}px`
        n.style.width = `${dur * getPrStepPx() - 3}px`
      })
    }
    
    function drawPianoRollTimeline() {
      const ruler = document.getElementById('pr-ruler')
      const grid = document.getElementById('piano-grid')
      if (!ruler || !grid) return

      const beatsPerBar = sequencer.timeSignature?.numerator || 4
      const stepPx = getPrStepPx()           // 1/16th note width
      const beatPixels = stepPx * 4           // 4 steps = 1 beat
      const barPixels = beatsPerBar * beatPixels

      // Snap grid lines use the global arranger snap selection
      const gridSnapSelect = document.getElementById('grid-snap-select')
      const snapInterval = gridSnapSelect ? parseFloat(gridSnapSelect.value) : 0.0625
      const snapSteps = snapInterval * 16  // convert bar-fraction to steps
      const snapPixels = snapSteps * stepPx
      console.log('Snap pixels:', snapPixels); // use it

      const isLight = document.body.classList.contains('light-theme')
      const color1 = isLight ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)'
      const color2 = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)'
      const color3 = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)'
      const borderLeftVal = isLight ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.08)'

      grid.style.backgroundImage = `
        repeating-linear-gradient(90deg, transparent, transparent calc(${barPixels}px - 1px), ${color1} calc(${barPixels}px - 1px), ${color1} ${barPixels}px),
        repeating-linear-gradient(90deg, transparent, transparent calc(${beatPixels}px - 1px), ${color2} calc(${beatPixels}px - 1px), ${color2} ${beatPixels}px),
        repeating-linear-gradient(90deg, transparent, transparent calc(${stepPx}px - 1px), ${color3} calc(${stepPx}px - 1px), ${color3} ${stepPx}px)
      `

      ruler.innerHTML = `
        <div class="ruler-bars"></div>
        <div class="ruler-beats"></div>
      `
      const barsContainer = ruler.querySelector('.ruler-bars')
      const beatsContainer = ruler.querySelector('.ruler-beats')
      
      const numBars = Math.max(8, Math.ceil(6000 / barPixels))
      for (let i = 0; i < numBars; i++) {
        const barSpan = document.createElement('span')
        barSpan.textContent = i + 1
        barSpan.className = 'ruler-bar-num'
        barSpan.style.width = `${barPixels}px`
        barsContainer.appendChild(barSpan)

        // Beat ticks within bar: 2, 3, 4
        for (let b = 0; b < beatsPerBar; b++) {
          const beatTick = document.createElement('span')
          beatTick.textContent = b === 0 ? '' : (b + 1)
          beatTick.className = 'ruler-beat-num'
          beatTick.style.width = `${beatPixels}px`
          if (b !== 0) beatTick.style.borderLeft = borderLeftVal
          beatsContainer.appendChild(beatTick)
        }
      }
    }
    
    // Call it initially
    drawPianoRollTimeline();

    // ── Piano Roll Zoom Controls ───────────────────────────────────
    document.getElementById('pr-zoom-slider')?.addEventListener('input', (e) => {
      applyPrZoom(parseFloat(e.target.value), true);
    })

    const pianoRollView = document.getElementById('piano-roll-view')
    if (pianoRollView) {
      pianoRollView.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          applyPrZoom(prZoomFactor * (e.deltaY > 0 ? 0.9 : 1.1))
        }
      }, { passive: false })
    }

    // ── Save / Load ────────────────────────────────────────────────
    function serializeProject() {
      const tracksData = []
      Object.keys(trackUIMap).forEach(trackId => {
        const map = trackUIMap[trackId]
        const h = map.headers[0]
        const engineTrack = engine.getTrack(trackId)
        
        const effectsData = []
        if (engineTrack && engineTrack.effects) {
          engineTrack.effects.forEach(fx => {
            effectsData.push({
              id: fx.id,
              type: fx.type,
              name: fx.name,
              icon: fx.icon,
              params: fx.params
            })
          })
        }

        tracksData.push({
          id: trackId,
          name: h?.nameEl?.textContent || trackId,
          color: h?.colorPicker?.value || '#00e5ff',
          instrumentPath: engineTrack?._instrumentPath || null,
          instrumentRootMidi: engineTrack?.instrumentRootMidi ?? 60,
          volume: engineTrack?.baseVolume ?? 0.8,
          pan: engineTrack?.pan ?? 0.0,
          generator: engineTrack?.generator ?? null,
          isMuted: engineTrack?.isMuted ?? false,
          isSoloed: engineTrack?.isSoloed ?? false,
          effects: effectsData,
          automations: engineTrack?.automations ?? {}
        })
      })

      const clipsData = sequencer.clips.map(c => ({
        trackId: c.trackId,
        startTime: c.startTime,
        duration: c.duration,
        originalDuration: c.originalDuration || c.duration,
        filePath: c._filePath || null,
        fileName: c._fileName || ''
      }))

      const patternClipsData = sequencer.patternClips.map(pc => ({
        trackId: pc.trackId,
        startTime: pc.startTime,
        duration: pc.duration
      }))

      const patternsData = {}
      Object.keys(sequencer.patterns).forEach(trackId => {
        patternsData[trackId] = sequencer.patterns[trackId].map(n => ({
          note: n.note,
          step: n.step,
          durationSteps: n.durationSteps
        }))
      })

      const masterEffectsData = []
      if (engine.effects) {
        engine.effects.forEach(fx => {
          masterEffectsData.push({
            id: fx.id,
            type: fx.type,
            name: fx.name,
            icon: fx.icon,
            params: fx.params
          })
        })
      }

      return JSON.stringify({
        version: 1,
        bpm: sequencer.bpm,
        timeSignature: sequencer.timeSignature,
        tracks: tracksData,
        clips: clipsData,
        patternClips: patternClipsData,
        patterns: patternsData,
        masterEffects: masterEffectsData
      }, null, 2)
    }

    function resolveProjectFolderAndFile(selectedPath) {
      const normalized = selectedPath.replace(/\\/g, '/');
      if (normalized.endsWith('/project.bounce')) {
        return {
          projectFile: selectedPath,
          projectDir: selectedPath.slice(0, Math.max(selectedPath.lastIndexOf('/'), selectedPath.lastIndexOf('\\')))
        };
      }
      
      const lastSlash = Math.max(selectedPath.lastIndexOf('/'), selectedPath.lastIndexOf('\\'));
      const dir = selectedPath.slice(0, lastSlash);
      let name = selectedPath.slice(lastSlash + 1);
      if (name.endsWith('.bounce')) {
        name = name.slice(0, -7);
      }
      
      const folder = `${dir}/${name}`;
      const file = `${folder}/project.bounce`;
      return {
        projectFile: file,
        projectDir: folder
      };
    }

    async function doSave(path) {
      const { projectFile, projectDir } = resolveProjectFolderAndFile(path);
      
      try {
        // 1. Create the project directory set
        await window.api.mkdir(projectDir);
        
        // 2. Create the "Recorded" directory inside it
        const recordedDir = `${projectDir}/Recorded`;
        await window.api.mkdir(recordedDir);
        
        // 3. Render and save all recorded in-memory audio clips to disk
        for (const clip of sequencer.clips) {
          if (clip.blob && !clip._filePath) {
            const safeTrackId = clip.trackId.replace(/[^a-zA-Z0-9]/g, '_');
            const relativeFileName = `Recorded/rec_${safeTrackId}_${Date.now()}_${Math.floor(Math.random()*1000)}.webm`;
            const absoluteFilePath = `${projectDir}/${relativeFileName}`;
            
            // Transmit binary chunks across IPC safely
            const arrayBuffer = await clip.blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            const writeSuccess = await window.api.writeFile(absoluteFilePath, uint8Array);
            if (writeSuccess) {
              clip._fileName = relativeFileName.split('/').pop();
              clip._filePath = relativeFileName; // Relative path saved to project JSON
              
              // Dynamic UI feedback: update clip name and preserve resize handle
              if (clip.uiElement) {
                clip.uiElement.textContent = clip._fileName;
                const rh = document.createElement('div');
                rh.className = 'resize-handle';
                clip.uiElement.appendChild(rh);
              }
            } else {
              console.error('Failed to write binary recording to disk:', absoluteFilePath);
            }
          }
        }
        
        // 4. Save JSON descriptor
        const data = serializeProject()
        const ok = await window.api.writeFile(projectFile, data)
        if (ok) {
          currentProjectPath = projectFile
          const folderName = projectDir.split(/[\\/]/).pop()
          document.title = `Bounce — ${folderName}`
          const titleEl = document.getElementById('project-title')
          if (titleEl) titleEl.textContent = folderName
          showToast(`💾 Saved Project: ${folderName}`)
        } else {
          showToast('Save failed.')
        }
      } catch (err) {
        console.error('DoSave failed:', err);
        showToast('Could not save project: ' + err.message);
      }
    }

    document.getElementById('menu-save')?.addEventListener('click', async () => {
      if (currentProjectPath) {
        await doSave(currentProjectPath)
      } else {
        const defaultBase = await window.api.getDefaultProjectsPath();
        const path = await window.api.saveFile(`${defaultBase}/Untitled/project.bounce`)
        if (path) await doSave(path)
      }
    })

    document.getElementById('menu-saveas')?.addEventListener('click', async () => {
      const defaultBase = await window.api.getDefaultProjectsPath();
      const initialPath = currentProjectPath || `${defaultBase}/Untitled/project.bounce`;
      const path = await window.api.saveFile(initialPath)
      if (path) await doSave(path)
    })

    document.getElementById('menu-undo')?.addEventListener('click', () => {
      dawHistory.undo()
    })

    document.getElementById('menu-redo')?.addEventListener('click', () => {
      dawHistory.redo()
    })

    function doCopy() {
      dawClipboard.data = [];
      if (selectedNotes.size > 0) {
        let minStep = Infinity;
        selectedNotes.forEach(noteEl => {
          const step = parseInt(noteEl.dataset.step) || 0;
          minStep = Math.min(minStep, step);
        });
        dawClipboard.type = 'notes';
        selectedNotes.forEach(noteEl => {
          const row = noteEl.closest('.pr-row');
          if (row) {
            const noteName = row.dataset.note;
            const step = parseInt(noteEl.dataset.step) || 0;
            const duration = parseFloat(noteEl.dataset.duration || 1);
            dawClipboard.data.push({
              noteName,
              relStep: step - minStep,
              duration
            });
          }
        });
        showHudFeedback("📋", `Copied ${selectedNotes.size} Notes`);
      } else if (selectedClips.size > 0) {
        let minStart = Infinity;
        selectedClips.forEach(clipEl => {
          const start = parseFloat(clipEl.dataset.startTime) || 0;
          minStart = Math.min(minStart, start);
        });
        dawClipboard.type = 'clips';
        selectedClips.forEach(clipEl => {
          const isPattern = clipEl.classList.contains('pattern-clip');
          const trackId = isPattern ? clipEl.dataset.patternTrackId : (clipEl.parentElement.dataset.trackId || 'drums');
          const start = parseFloat(clipEl.dataset.startTime) || 0;
          const duration = parseFloat(clipEl.dataset.duration) || 1;

          if (isPattern) {
            const seqClip = sequencer.patternClips.find(c => c.uiElement === clipEl);
            dawClipboard.data.push({
              trackId,
              relStart: start - minStart,
              duration,
              originalDuration: seqClip ? (seqClip.originalDuration || duration) : duration,
              isPattern: true
            });
          } else {
            const seqClip = sequencer.clips.find(c => c.uiElement === clipEl);
            if (seqClip) {
              dawClipboard.data.push({
                trackId,
                relStart: start - minStart,
                duration,
                originalDuration: seqClip.originalDuration || duration,
                isPattern: false,
                filePath: seqClip._filePath,
                fileName: seqClip._fileName,
                buffer: seqClip.buffer
              });
            }
          }
        });
        showHudFeedback("📋", `Copied ${selectedClips.size} Clips`);
      } else {
        showHudFeedback("📋", "No selection to copy");
      }
    }

    function doCut() {
      if (selectedNotes.size === 0 && selectedClips.size === 0) {
        showHudFeedback("✂️", "No selection to cut");
        return;
      }
      
      doCopy();
      
      if (dawClipboard.type === 'notes') {
        const currentTrackId = document.getElementById('pr-track-select')?.value || 'drums';
        selectedNotes.forEach(noteEl => {
          const row = noteEl.closest('.pr-row');
          if (row) {
            const noteName = row.dataset.note;
            const step = parseInt(noteEl.dataset.step);
            sequencer.removeNoteFromPattern(currentTrackId, noteName, step);
            const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${currentTrackId}"][data-note="${noteName}"]`);
            if (stepSeqRow) {
              const s = stepSeqRow.querySelector(`[data-step-index="${step}"]`);
              if (s) s.classList.remove('active');
            }
          }
          noteEl.remove();
        });
        selectedNotes.clear();
        syncPatternClip(currentTrackId);
        dawHistory.pushState("Cut Note");
        showHudFeedback("✂️", "Cut Notes");
      } else if (dawClipboard.type === 'clips') {
        selectedClips.forEach(clipEl => {
          const isPattern = clipEl.classList.contains('pattern-clip');
          if (isPattern) {
            const seqClip = sequencer.patternClips.find(c => c.uiElement === clipEl);
            if (seqClip) sequencer.removePatternClip(seqClip);
          } else {
            const seqClip = sequencer.clips.find(c => c.uiElement === clipEl);
            if (seqClip) sequencer.removeClip(seqClip);
          }
          clipEl.remove();
        });
        selectedClips.clear();
        dawHistory.pushState("Cut Clip");
        showHudFeedback("✂️", "Cut Clips");
      }
    }

    function doPaste() {
      if (!dawClipboard.type || dawClipboard.data.length === 0) {
        showHudFeedback("📋", "Clipboard Empty");
        return;
      }

      const currentPlayheadTime = sequencer.isPlaying ? (engine.ctx.currentTime - sequencer.startTime) : sequencer.pauseTime;

      if (dawClipboard.type === 'notes') {
        const currentTrackId = document.getElementById('pr-track-select')?.value || 'drums';
        const beatsPerSecond = sequencer.bpm / 60;
        const secondsPerStep = (1 / beatsPerSecond) / 4;
        const pasteStep = Math.round(currentPlayheadTime / secondsPerStep);

        selectedNotes.forEach(n => n.classList.remove('selected'));
        selectedNotes.clear();

        const grid = document.getElementById('piano-grid');
        const map = trackUIMap[currentTrackId];
        const color = map && map.headers[0] ? map.headers[0].laneEl.style.getPropertyValue('--track-color') : null;

        dawClipboard.data.forEach(item => {
          const finalStep = pasteStep + item.relStep;
          const noteEl = createPrNote(currentTrackId, item.noteName, finalStep, item.duration, color);
          const row = grid.querySelector(`[data-note="${item.noteName}"]`);
          if (row) {
            row.appendChild(noteEl);
            sequencer.addNoteToPattern(currentTrackId, item.noteName, finalStep, item.duration);
            
            const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${currentTrackId}"][data-note="${item.noteName}"]`);
            if (stepSeqRow) {
              const s = stepSeqRow.querySelector(`[data-step-index="${finalStep}"]`);
              if (s) s.classList.add('active');
            }
            
            noteEl.classList.add('selected');
            selectedNotes.add(noteEl);
          }
        });
        syncPatternClip(currentTrackId);
        dawHistory.pushState("Paste Note");
        showHudFeedback("📋", "Pasted Notes");
      } else if (dawClipboard.type === 'clips') {
        const pasteTime = sequencer.snapTimeToGrid(currentPlayheadTime);
        selectedClips.forEach(c => c.classList.remove('selected'));
        selectedClips.clear();

        dawClipboard.data.forEach(item => {
          const finalStartTime = pasteTime + item.relStart;
          const lane = document.querySelector(`.track-lane[data-track-id="${item.trackId}"]`);
          if (lane) {
            if (item.isPattern) {
              const clipEl = createPatternClipUI(item.trackId, finalStartTime, item.duration, lane);
              clipEl.classList.add('selected');
              selectedClips.add(clipEl);
            } else {
              const clipEl = document.createElement('div');
              clipEl.className = 'clip audio-clip';
              clipEl.style.left = `${finalStartTime * sequencer.pxPerSecond}px`;
              clipEl.style.width = `${Math.max(20, item.duration * sequencer.pxPerSecond)}px`;
              clipEl.textContent = item.fileName;
              clipEl.dataset.startTime = finalStartTime;
              clipEl.dataset.duration = item.duration;
              
              const rh = document.createElement('div');
              rh.className = 'resize-handle';
              clipEl.appendChild(rh);
              lane.appendChild(clipEl);

              sequencer.addClip({
                buffer: item.buffer,
                startTime: finalStartTime,
                duration: item.duration,
                originalDuration: item.originalDuration,
                trackId: item.trackId,
                scheduled: false,
                uiElement: clipEl,
                _filePath: item.filePath,
                _fileName: item.fileName
              });
              
              clipEl.classList.add('selected');
              selectedClips.add(clipEl);
            }
          }
        });
        dawHistory.pushState("Paste Clip");
        showHudFeedback("📋", "Pasted Clips");
      }
    }

    document.getElementById('menu-copy')?.addEventListener('click', () => {
      doCopy();
    });

    document.getElementById('menu-cut')?.addEventListener('click', () => {
      doCut();
    });

    document.getElementById('menu-paste')?.addEventListener('click', () => {
      doPaste();
    });

    document.getElementById('menu-open')?.addEventListener('click', async () => {
      const path = await window.api.openFile()
      if (!path) return
      try {
        const raw = await window.api.readFile(path)
        if (!raw) return
        const text = new TextDecoder().decode(raw)
        const data = JSON.parse(text)
        currentProjectPath = path // Set first so relative audio file loaders can use it!
        await loadProject(data)
        
        const lastIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        const projectDir = path.slice(0, lastIndex);
        const folderName = projectDir.split(/[\\/]/).pop();
        document.title = `Bounce — ${folderName}`
        const titleEl = document.getElementById('project-title')
        if (titleEl) titleEl.textContent = folderName
      } catch (err) {
        console.error('Load failed:', err)
        alert('Could not open project: ' + err.message)
      }
    })

    document.getElementById('menu-new')?.addEventListener('click', () => {
      if (!confirm('Start a new project? Unsaved changes will be lost.')) return
      
      sequencer.stop()
      
      // Remove all clips
      document.querySelectorAll('.clip').forEach(c => c.remove())
      sequencer.clips = []
      sequencer.patternClips = []
      
      // Remove all tracks
      Object.keys(trackUIMap).forEach(tid => {
        engine.removeTrack(tid)
        delete sequencer.patterns[tid]
      })
      
      // Remove UI elements
      document.getElementById('track-headers-container').innerHTML = ''
      document.getElementById('track-lanes-container').innerHTML = ''
      document.getElementById('mixer-channels-container').innerHTML = ''
      document.getElementById('step-sequencer-view').querySelectorAll('.seq-row').forEach(r => r.remove())
      
      const prSelect = document.getElementById('pr-track-select')
      if (prSelect) prSelect.innerHTML = ''
      
      Object.keys(trackUIMap).forEach(k => delete trackUIMap[k])
      
      currentProjectPath = null
      document.title = 'Bounce DAW'
      const titleEl = document.getElementById('project-title')
      if (titleEl) titleEl.textContent = 'Untitled Project'

      // Apply default settings
      const defaultBpm = parseFloat(localStorage.getItem('bounce.defaultBPM') || '120');
      sequencer.bpm = defaultBpm;
      const bd = document.getElementById('bpm-display');
      if (bd) bd.textContent = defaultBpm.toFixed(1);

      const defaultSnap = localStorage.getItem('bounce.defaultSnap') || '0.0625';
      const snapSelect = document.getElementById('grid-snap-select');
      if (snapSelect) {
        snapSelect.value = defaultSnap;
        snapSelect.dispatchEvent(new Event('change'));
      }

      drawTimeline()
      drawPianoRollTimeline()
    })

    async function loadProject(data) {
      // Reset transport
      sequencer.stop()
      // BPM / time sig
      if (data.bpm) {
        sequencer.bpm = data.bpm
        const bd = document.getElementById('bpm-display')
        if (bd) bd.textContent = data.bpm.toFixed(1)
      }
      if (data.timeSignature) {
        sequencer.timeSignature = data.timeSignature
        const ts = document.getElementById('time-sig-display')
        if (ts) ts.value = `${data.timeSignature.numerator}/${data.timeSignature.denominator}`
      }
      drawTimeline()
      
      // Clear existing tracks and recreate them with mute/solo/volume/effects restored
      if (data.tracks && data.tracks.length > 0) {
        Object.keys(trackUIMap).forEach(tid => {
          engine.removeTrack(tid)
          delete sequencer.patterns[tid]
        })
        document.getElementById('track-headers-container').innerHTML = ''
        document.getElementById('track-lanes-container').innerHTML = ''
        document.getElementById('mixer-channels-container').innerHTML = ''
        document.getElementById('step-sequencer-view').querySelectorAll('.seq-row').forEach(r => r.remove())
        const prSelect = document.getElementById('pr-track-select')
        if (prSelect) prSelect.innerHTML = ''
        Object.keys(trackUIMap).forEach(k => delete trackUIMap[k])

        for (const track of data.tracks) {
          createTrackUI(track.id, track.name, track.color)
          
          const engineTrack = engine.getTrack(track.id)
          if (engineTrack) {
            // Restore volume
            if (track.volume !== undefined) {
              const knobVal = (track.volume / 1.5) * 100
              if (trackUIMap[track.id] && trackUIMap[track.id].updateKnob) {
                trackUIMap[track.id].updateKnob(knobVal)
              }
            }
            // Restore mute/solo
            if (track.isMuted !== undefined) {
              engineTrack.isMuted = track.isMuted
              syncTrackUI(track.id, 'mute', track.isMuted)
            }
            if (track.isSoloed !== undefined) {
              engineTrack.isSoloed = track.isSoloed
              if (track.isSoloed) {
                engine.soloedTracks.add(track.id)
              } else {
                engine.soloedTracks.delete(track.id)
              }
              syncTrackUI(track.id, 'solo', track.isSoloed)
            }
            // Restore panning
            if (track.pan !== undefined) {
              const panPercent = (track.pan + 1) * 50 // Map -1..1 to 0..100
              if (trackUIMap[track.id] && trackUIMap[track.id].updatePan) {
                trackUIMap[track.id].updatePan(panPercent)
              }
            }
            // Restore generator parameters
            if (track.generator && track.generator.params) {
              engineTrack.generator = {
                type: track.generator.type || 'sampler',
                params: { ...engineTrack.generator.params, ...track.generator.params }
              }
            }
          }

          // Restore instrument buffer
          if (track.instrumentPath) {
            try {
              const fileName = track.instrumentPath.split(/[\\/]/).pop()
              const sampleObj = { tid: track.id, name: fileName, path: track.instrumentPath }
              if (trackUIMap[track.id] && trackUIMap[track.id].loadInstrument) {
                await trackUIMap[track.id].loadInstrument(track.id, sampleObj)
              }
            } catch(e) { console.warn("Failed to load instrument during restore:", track.id, e) }
          }

          // Restore effects
          if (track.effects && track.effects.length > 0 && engineTrack) {
            for (const fxData of track.effects) {
              const fxObj = engineTrack.addEffect(fxData.type)
              if (fxObj) {
                fxObj.id = fxData.id
                if (fxData.params && fxObj.updateParams) {
                  fxObj.params = { ...fxObj.params, ...fxData.params }
                  fxObj.updateParams(fxData.params)
                }
              }
            }
          }
          // Restore automations
          if (track.automations && engineTrack) {
            engineTrack.automations = track.automations
          }
        }

        // Restore Master Effects
        engine.effects = []
        if (data.masterEffects && data.masterEffects.length > 0) {
          for (const fxData of data.masterEffects) {
            const fxObj = engine.addEffect(fxData.type)
            if (fxObj) {
              fxObj.id = fxData.id
              if (fxData.params && fxObj.updateParams) {
                fxObj.params = { ...fxObj.params, ...fxData.params }
                fxObj.updateParams(fxData.params)
              }
            }
          }
        }
        engine.rebuildMasterChain()

        if (window.updatePluginsFooter) window.updatePluginsFooter()
        if (window.updateMixerInserts) window.updateMixerInserts()
        engine.updateTrackVolumes()
      }

      // Clear existing clips
      document.querySelectorAll('.clip').forEach(c => c.remove())
      sequencer.clips = []
      sequencer.patternClips = []
      // Restore patterns
      if (data.patterns) {
        Object.keys(data.patterns).forEach(trackId => {
          sequencer.patterns[trackId] = data.patterns[trackId].map(n => ({
            ...n, scheduled: false, _scheduledAt: new Set(), sourceNode: null
          }))
        })
      }
      // Restore audio clips (re-read files)
      if (data.clips) {
        for (const c of data.clips) {
          if (!c.filePath) continue
          try {
            // Resolve relative paths relative to currentProjectPath's folder
            let absolutePath = c.filePath;
            const isRelative = !c.filePath.startsWith('/') && !c.filePath.startsWith('\\') && !c.filePath.includes(':');
            if (isRelative && currentProjectPath) {
              const lastIndex = Math.max(currentProjectPath.lastIndexOf('/'), currentProjectPath.lastIndexOf('\\'));
              const projectDir = currentProjectPath.slice(0, lastIndex);
              absolutePath = `${projectDir}/${c.filePath}`;
            }

            const buf = await window.api.readFile(absolutePath)
            if (!buf) {
              console.warn('Could not read clip file:', absolutePath);
              continue
            }
            
            // Safe TypedArray ArrayBuffer copy
            const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            const audioBuffer = await engine.decodeAudioData(arrayBuffer)
            
            const lane = document.querySelector(`.track-lane[data-track-id="${c.trackId}"]`)
            if (!lane) continue
            const clipEl = document.createElement('div')
            clipEl.className = 'clip audio-clip'
            if (c.filePath.startsWith('Recorded/')) {
              clipEl.classList.add('recorded-clip');
            }
            clipEl.style.left = `${c.startTime * sequencer.pxPerSecond}px`
            clipEl.style.width = `${Math.max(20, c.duration * sequencer.pxPerSecond)}px`
            clipEl.textContent = c.fileName
            clipEl.dataset.startTime = c.startTime
            clipEl.dataset.duration = c.duration
            const rh = document.createElement('div')
            rh.className = 'resize-handle'
            clipEl.appendChild(rh)
            lane.appendChild(clipEl)
            sequencer.addClip({
              buffer: audioBuffer,
              startTime: c.startTime,
              duration: c.duration,
              originalDuration: c.originalDuration || c.duration,
              trackId: c.trackId,
              scheduled: false,
              uiElement: clipEl,
              _filePath: c.filePath,
              _fileName: c.fileName
            })
          } catch (err) { console.warn('Could not restore clip:', err) }
        }
      }
      // Restore pattern clips
      if (data.patternClips && data.patternClips.length > 0) {
        data.patternClips.forEach(pcData => {
          const lane = document.querySelector(`.track-lane[data-track-id="${pcData.trackId}"]`);
          if (lane) {
            createPatternClipUI(pcData.trackId, pcData.startTime, pcData.duration, lane);
          }
        });
      } else if (data.patterns) {
        // Fallback: if no patternClips saved, create one default per track that has notes
        Object.keys(data.patterns).forEach(trackId => {
          if (data.patterns[trackId].length > 0) syncPatternClip(trackId)
        })
      }
      drawPianoRollTimeline()
      
      // Refresh current PR/Seq view
      const prSelect = document.getElementById('pr-track-select')
      if (prSelect) prSelect.dispatchEvent(new Event('change'))
      
      const stepCountSelect = document.getElementById('step-count-select')
      if (stepCountSelect) stepCountSelect.dispatchEvent(new Event('change'))
    }

    // ── Footer collapse ───────────────────────────────────────────
    document.getElementById('footer-collapse-btn')?.addEventListener('click', () => {
      document.getElementById('app').classList.toggle('footer-collapsed')
    })

    // ── Browser Tab Switching ────────────────────────────────────
    const browserTabs = document.querySelectorAll('.browser-tab')
    const browserTabContents = document.querySelectorAll('.browser-tab-content')

    browserTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab
        
        // Update active tab
        browserTabs.forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        
        // Update active content
        browserTabContents.forEach(content => {
          content.classList.remove('active')
          if (content.id === `browser-${target}-tab`) {
            content.classList.add('active')
          }
        })
      })
    })

    // ── Populate Effects & Generators ────────────────────────────
    const effects = [
      { id: 'reverb', name: 'Reverb', icon: '🌊' },
      { id: 'delay', name: 'Delay', icon: '⏳' },
      { id: 'distortion', name: 'Distortion', icon: '🔥' },
      { id: 'compressor', name: 'Compressor', icon: '🗜️' },
      { id: 'eq', name: 'Equalizer', icon: '🎚️' },
      { id: 'flanger', name: 'Flanger', icon: '🌀' },
      { id: 'phaser', name: 'Phaser', icon: '🔮' }
    ]

    const generators = [
      { id: 'sampler', name: 'Sampler', icon: '📼' },
      { id: 'monosynth', name: 'Mono Synth', icon: '🎹' },
      { id: 'polysynth', name: 'Poly Synth', icon: '🎼' },
      { id: 'fmsynth', name: 'FM Synth', icon: '📻' }
    ]

    const effectsContainer = document.getElementById('effects-container')
    const generatorsContainer = document.getElementById('generators-container')

    // ── Footer Plugins Integration ───────────────────────────────
    window.updatePluginsFooter = function() {
      const list = document.getElementById('active-plugins-list')
      if (!list) return
      list.innerHTML = ''

      if (currentTrackId === 'master') {
        // Master plugins
        if (engine.effects) {
          engine.effects.forEach(fx => {
            const fxItem = document.createElement('div')
            fxItem.className = 'active-plugin-item'
            fxItem.innerHTML = `
              <div class="plugin-item-icon">${fx.icon || '🔌'}</div>
              <div class="plugin-item-details">
                <div class="plugin-item-name">${fx.name}</div>
                <div class="plugin-item-track">Master</div>
              </div>
              <div class="plugin-item-controls">
                <div class="plugin-item-status"></div>
                <button class="plugin-item-remove-btn" title="Remove plugin">✕</button>
              </div>
            `
            fxItem.addEventListener('dblclick', () => { showPluginWindow(fx) })
            const removeBtn = fxItem.querySelector('.plugin-item-remove-btn')
            removeBtn.addEventListener('click', (e) => {
              e.stopPropagation()
              engine.removeEffect(fx.id)
              if (openPluginWindows.has(fx.id)) {
                openPluginWindows.get(fx.id).remove()
                openPluginWindows.delete(fx.id)
              }
              window.updatePluginsFooter()
              if (window.updateMixerInserts) window.updateMixerInserts()
              dawHistory.pushState(`Remove ${fx.name} Plugin`)
            })
            list.appendChild(fxItem)
          })
        }
      } else {
        const track = engine.getTrack(currentTrackId)
        if (track) {
          // Track generator
          if (track.generator) {
            const genNames = { sampler: 'Sampler', monosynth: 'Mono Synth', polysynth: 'Poly Synth', fmsynth: 'FM Synth' };
            const genIcons = { sampler: '📼', monosynth: '🎹', polysynth: '🎼', fmsynth: '📻' };
            const name = genNames[track.generator.type] || 'Generator';
            const icon = genIcons[track.generator.type] || '🎹';

            const genItem = document.createElement('div')
            genItem.className = 'active-plugin-item'
            genItem.style.borderLeft = '3px solid #00e5ff' // Custom generator color highlight!
            genItem.innerHTML = `
              <div class="plugin-item-icon">${icon}</div>
              <div class="plugin-item-details">
                <div class="plugin-item-name">${name}</div>
                <div class="plugin-item-track">${track.name || currentTrackId}</div>
              </div>
              <div class="plugin-item-controls">
                <div class="plugin-item-status" style="background-color:#00e5ff; box-shadow:0 0 8px #00e5ff;"></div>
                <button class="plugin-item-remove-btn" title="Unload instrument">✕</button>
              </div>
            `
            genItem.addEventListener('dblclick', () => { showGeneratorWindow(currentTrackId) })
            const removeBtn = genItem.querySelector('.plugin-item-remove-btn')
            removeBtn.addEventListener('click', (e) => {
              e.stopPropagation()
              track.generator = null
              if (openGeneratorWindows.has(currentTrackId)) {
                openGeneratorWindows.get(currentTrackId).remove()
                openGeneratorWindows.delete(currentTrackId)
              }
              window.updatePluginsFooter()
              dawHistory.pushState(`Unload Track Generator`)
            })
            list.appendChild(genItem)
          }

          // Track plugins
          if (track.effects) {
            track.effects.forEach(fx => {
              const fxItem = document.createElement('div')
              fxItem.className = 'active-plugin-item'
              fxItem.innerHTML = `
                <div class="plugin-item-icon">${fx.icon || '🔌'}</div>
                <div class="plugin-item-details">
                  <div class="plugin-item-name">${fx.name}</div>
                  <div class="plugin-item-track">${track.name || currentTrackId}</div>
                </div>
                <div class="plugin-item-controls">
                  <div class="plugin-item-status"></div>
                  <button class="plugin-item-remove-btn" title="Remove plugin">✕</button>
                </div>
              `
              fxItem.addEventListener('dblclick', () => { showPluginWindow(fx) })
              const removeBtn = fxItem.querySelector('.plugin-item-remove-btn')
              removeBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                track.removeEffect(fx.id)
                if (openPluginWindows.has(fx.id)) {
                  openPluginWindows.get(fx.id).remove()
                  openPluginWindows.delete(fx.id)
                }
                window.updatePluginsFooter()
                if (window.updateMixerInserts) window.updateMixerInserts()
                dawHistory.pushState(`Remove ${fx.name} Plugin`)
              })
              list.appendChild(fxItem)
            })
          }
        }
      }
    }

    // ── Plugin Window Logic ──────────────────────────────────────
    const openPluginWindows = new Map();

    function showPluginWindow(fxObj) {
      if (!fxObj) return
      const host = document.getElementById('plugin-host')
      if (!host) return

      // If already open, bring to front
      if (openPluginWindows.has(fxObj.id)) {
        const existingWin = openPluginWindows.get(fxObj.id);
        host.appendChild(existingWin); // Bring to front
        return;
      }

      const winId = `plugin-win-${fxObj.id}`
      const win = document.createElement('div')
      win.className = 'plugin-window'
      win.id = winId
      win.style.left = '50%'
      win.style.top = '50%'

      const header = document.createElement('div')
      header.className = 'plugin-header'
      header.innerHTML = `
        <div class="plugin-title">
          <span>${fxObj.icon || '🔌'}</span>
          <span>${fxObj.name.toUpperCase()}</span>
        </div>
        <button class="plugin-close">✕</button>
      `
      
      const content = document.createElement('div')
      content.className = 'plugin-content'
      content.style.display = 'flex';
      content.style.gap = '16px';
      
      // Render functional parameters
      if (fxObj.params) {
        Object.keys(fxObj.params).forEach(paramName => {
          const param = document.createElement('div')
          param.className = 'plugin-param'
          param.style.display = 'flex';
          param.style.flexDirection = 'column';
          param.style.alignItems = 'center';

          // Define min/max ranges for basic params
          let min = 0, max = 1;
          if (paramName === 'size') max = 5;
          if (paramName === 'decay') max = 10;
          if (paramName === 'threshold') { min = -60; max = 0; }
          if (paramName === 'ratio') { min = 1; max = 20; }
          if (paramName === 'attack') { min = 0.001; max = 0.5; }
          if (paramName === 'release') { min = 0.01; max = 1.0; }
          if (paramName === 'low') { min = -12; max = 12; }
          if (paramName === 'mid') { min = -12; max = 12; }
          if (paramName === 'high') { min = -12; max = 12; }
          if (paramName === 'feedback') { min = 0; max = 0.95; }
          // Flanger
          if (paramName === 'rate')  { min = 0.01; max = 10; }
          if (paramName === 'depth' && fxObj.type === 'flanger') { min = 0.0001; max = 0.015; }
          if (paramName === 'delay') { min = 0.001; max = 0.02; }
          // Phaser
          if (paramName === 'depth' && fxObj.type === 'phaser')  { min = 0; max = 4000; }
          if (paramName === 'baseFreq') { min = 100; max = 8000; }
          
          let currentVal = fxObj.params[paramName];
          
          const getAngle = (v) => {
            return -135 + ((v - min) / (max - min)) * 270;
          };

          param.innerHTML = `
            <div class="plugin-knob" data-param="${paramName}" style="transform: rotate(${getAngle(currentVal)}deg); margin-bottom: 8px;"></div>
            <div class="plugin-label">${paramName.toUpperCase()}</div>
            <div class="plugin-value" id="val-${fxObj.id}-${paramName}">${currentVal.toFixed(2)}</div>
          `
          
          const knob = param.querySelector('.plugin-knob');
          let isDraggingKnob = false;
          let startY = 0;
          
          knob.addEventListener('mousedown', (e) => {
            isDraggingKnob = true;
            startY = e.clientY;
            e.stopPropagation(); // Prevent window drag
          });
          
          document.addEventListener('mousemove', (e) => {
            if (!isDraggingKnob) return;
            const deltaY = startY - e.clientY; // Up is positive
            startY = e.clientY;
            
            const range = max - min;
            const step = range / 150; // 150px drag for full range
            currentVal = Math.max(min, Math.min(max, currentVal + deltaY * step));
            
            knob.style.transform = `rotate(${getAngle(currentVal)}deg)`;
            param.querySelector('.plugin-value').textContent = currentVal.toFixed(2);
            
            if (fxObj.updateParams) {
              fxObj.updateParams({ [paramName]: currentVal });
            }
          });
          
          document.addEventListener('mouseup', () => {
            if (isDraggingKnob) {
              isDraggingKnob = false;
              dawHistory.pushState(`Tweak ${fxObj.name} ${paramName}`);
            }
          });
          
          content.appendChild(param)
        })
      } else {
        content.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.8rem;">No parameters available.</div>';
      }

      win.appendChild(header)
      win.appendChild(content)
      host.appendChild(win)
      
      openPluginWindows.set(fxObj.id, win);

      // Close logic
      win.querySelector('.plugin-close').addEventListener('click', () => {
        win.remove();
        openPluginWindows.delete(fxObj.id);
      })

      // Drag logic
      let isDragging = false
      let startX, startY, startLeft, startTop

      header.addEventListener('mousedown', (e) => {
        isDragging = true
        startX = e.clientX
        startY = e.clientY
        const rect = win.getBoundingClientRect()
        startLeft = rect.left
        startTop = rect.top
        win.style.transform = 'none' // Disable centering transform once dragged
        win.style.left = `${startLeft}px`
        win.style.top = `${startTop}px`
      })

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        win.style.left = `${startLeft + dx}px`
        win.style.top = `${startTop + dy}px`
      })

      document.addEventListener('mouseup', () => {
        isDragging = false
      })
    }

    const openGeneratorWindows = new Map();

    function showGeneratorWindow(trackId) {
      const track = engine.getTrack(trackId)
      if (!track || !track.generator) return
      
      const host = document.getElementById('plugin-host')
      if (!host) return

      const winId = `generator-win-${trackId}`
      // If already open, bring to front
      if (openGeneratorWindows.has(trackId)) {
        const existingWin = openGeneratorWindows.get(trackId);
        host.appendChild(existingWin); // Bring to front
        return;
      }

      const win = document.createElement('div')
      win.className = 'plugin-window'
      win.id = winId
      win.style.left = '50%'
      win.style.top = '50%'
      win.style.border = '1px solid rgba(0, 229, 255, 0.3)' // Glowing border for generator!
      win.style.boxShadow = '0 24px 64px rgba(0, 0, 0, 0.8), 0 0 24px rgba(0, 229, 255, 0.15)'

      const genNames = { sampler: 'Sampler', monosynth: 'Mono Synth', polysynth: 'Poly Synth', fmsynth: 'FM Synth' };
      const genIcons = { sampler: '📼', monosynth: '🎹', polysynth: '🎼', fmsynth: '📻' };
      const name = genNames[track.generator.type] || 'Generator';
      const icon = genIcons[track.generator.type] || '🎹';

      const header = document.createElement('div')
      header.className = 'plugin-header'
      header.innerHTML = `
        <div class="plugin-title">
          <span>${icon}</span>
          <span>${name.toUpperCase()} — ${track.name.toUpperCase()}</span>
        </div>
        <button class="plugin-close">✕</button>
      `
      
      const content = document.createElement('div')
      content.className = 'plugin-content'
      content.style.display = 'flex';
      content.style.gap = '16px';
      content.style.flexWrap = 'wrap';
      content.style.justifyContent = 'center';

      let paramsSpec = []
      const type = track.generator.type;
      
      if (type === 'sampler') {
        paramsSpec = [
          { name: 'attack', label: 'ATTACK', min: 0.001, max: 2.0, suffix: 's' },
          { name: 'decay', label: 'DECAY', min: 0.01, max: 2.0, suffix: 's' },
          { name: 'sustain', label: 'SUSTAIN', min: 0.0, max: 1.0, suffix: '' },
          { name: 'release', label: 'RELEASE', min: 0.01, max: 3.0, suffix: 's' },
          { name: 'cutoff', label: 'CUTOFF', min: 20, max: 20000, suffix: 'Hz', isLog: true },
          { name: 'resonance', label: 'RESONANCE', min: 0.1, max: 20.0, suffix: '' },
          { name: 'pitch', label: 'PITCH', min: -24, max: 24, suffix: 'st', step: 1 }
        ]
      } else if (type === 'monosynth') {
        paramsSpec = [
          { name: 'oscType', label: 'OSC TYPE', min: 0, max: 3, suffix: '', step: 1, isOscSelect: true },
          { name: 'subOsc', label: 'SUB OSC', min: 0.0, max: 1.0, suffix: '' },
          { name: 'attack', label: 'ATTACK', min: 0.001, max: 2.0, suffix: 's' },
          { name: 'decay', label: 'DECAY', min: 0.01, max: 2.0, suffix: 's' },
          { name: 'sustain', label: 'SUSTAIN', min: 0.0, max: 1.0, suffix: '' },
          { name: 'release', label: 'RELEASE', min: 0.01, max: 3.0, suffix: 's' },
          { name: 'cutoff', label: 'CUTOFF', min: 20, max: 20000, suffix: 'Hz', isLog: true },
          { name: 'resonance', label: 'RESONANCE', min: 0.1, max: 20.0, suffix: '' }
        ]
      } else if (type === 'polysynth') {
        paramsSpec = [
          { name: 'oscType', label: 'OSC TYPE', min: 0, max: 3, suffix: '', step: 1, isOscSelect: true },
          { name: 'detune', label: 'DETUNE', min: 0, max: 100, suffix: 'c', step: 1 },
          { name: 'attack', label: 'ATTACK', min: 0.001, max: 2.0, suffix: 's' },
          { name: 'decay', label: 'DECAY', min: 0.01, max: 2.0, suffix: 's' },
          { name: 'sustain', label: 'SUSTAIN', min: 0.0, max: 1.0, suffix: '' },
          { name: 'release', label: 'RELEASE', min: 0.01, max: 3.0, suffix: 's' },
          { name: 'cutoff', label: 'CUTOFF', min: 20, max: 20000, suffix: 'Hz', isLog: true },
          { name: 'resonance', label: 'RESONANCE', min: 0.1, max: 20.0, suffix: '' }
        ]
      } else if (type === 'fmsynth') {
        paramsSpec = [
          { name: 'carrierType', label: 'CARRIER', min: 0, max: 3, suffix: '', step: 1, isOscSelect: true },
          { name: 'modType', label: 'MODULATOR', min: 0, max: 3, suffix: '', step: 1, isOscSelect: true },
          { name: 'modIndex', label: 'MOD INDEX', min: 0.0, max: 20.0, suffix: '' },
          { name: 'modFreqRatio', label: 'FREQ RATIO', min: 0.25, max: 8.0, suffix: 'x', step: 0.25 },
          { name: 'attack', label: 'ATTACK', min: 0.001, max: 2.0, suffix: 's' },
          { name: 'decay', label: 'DECAY', min: 0.01, max: 2.0, suffix: 's' },
          { name: 'sustain', label: 'SUSTAIN', min: 0.0, max: 1.0, suffix: '' },
          { name: 'release', label: 'RELEASE', min: 0.01, max: 3.0, suffix: 's' }
        ]
      }

      paramsSpec.forEach(pSpec => {
        const paramName = pSpec.name;
        const param = document.createElement('div')
        param.className = 'plugin-param'
        param.style.display = 'flex';
        param.style.flexDirection = 'column';
        param.style.alignItems = 'center';

        const OSC_TYPES = ['sawtooth', 'square', 'triangle', 'sine'];
        const min = pSpec.min;
        const max = pSpec.max;
        
        let currentVal;
        if (pSpec.isOscSelect) {
          const waveStr = track.generator.params[paramName] || 'sawtooth';
          const idx = OSC_TYPES.indexOf(waveStr);
          currentVal = idx !== -1 ? idx : 0;
        } else {
          currentVal = track.generator.params[paramName] !== undefined ? track.generator.params[paramName] : min;
        }

        // Logarithmic scale math for cutoff
        const toVal = (pct) => {
          if (pSpec.isLog) {
            return min * Math.pow(max / min, pct);
          }
          let v = min + pct * (max - min);
          if (pSpec.step) {
            v = Math.round(v / pSpec.step) * pSpec.step;
          }
          return v;
        }

        const toPct = (val) => {
          if (pSpec.isLog) {
            return Math.log(val / min) / Math.log(max / min);
          }
          return (val - min) / (max - min);
        }

        const getAngle = (v) => {
          const pct = toPct(v);
          return -135 + pct * 270;
        }

        const formatVal = (v) => {
          if (pSpec.isOscSelect) {
            const idx = Math.max(0, Math.min(3, Math.round(v)));
            return OSC_TYPES[idx].toUpperCase();
          }
          if (pSpec.step) {
            const decimalPlaces = pSpec.step < 1 ? (pSpec.step === 0.25 ? 2 : 1) : 0;
            return v.toFixed(decimalPlaces) + pSpec.suffix;
          }
          if (v >= 1000) return (v / 1000).toFixed(1) + 'k' + pSpec.suffix;
          return v.toFixed(2) + pSpec.suffix;
        }

        param.innerHTML = `
          <div class="plugin-knob" data-param="${paramName}" style="transform: rotate(${getAngle(currentVal)}deg); margin-bottom: 8px; border-color: rgba(0, 229, 255, 0.4);"></div>
          <div class="plugin-label">${pSpec.label}</div>
          <div class="plugin-value" id="val-${trackId}-${paramName}">${formatVal(currentVal)}</div>
        `
        
        const knob = param.querySelector('.plugin-knob');
        let isDraggingKnob = false;
        let startY = 0;
        
        knob.addEventListener('mousedown', (e) => {
          isDraggingKnob = true;
          startY = e.clientY;
          e.stopPropagation(); // Prevent window drag
        });
        
        document.addEventListener('mousemove', (e) => {
          if (!isDraggingKnob) return;
          const deltaY = startY - e.clientY; // Up is positive
          startY = e.clientY;
          
          let pct = toPct(currentVal);
          pct = Math.max(0, Math.min(1, pct + deltaY / 150)); // 150px drag for full range
          currentVal = toVal(pct);
          
          let storedVal = currentVal;
          if (pSpec.isOscSelect) {
            const idx = Math.max(0, Math.min(3, Math.round(currentVal)));
            storedVal = OSC_TYPES[idx];
          }
          
          track.generator.params[paramName] = storedVal;
          knob.style.transform = `rotate(${getAngle(currentVal)}deg)`;
          param.querySelector('.plugin-value').textContent = formatVal(currentVal);
        });
        
        document.addEventListener('mouseup', () => {
          if (isDraggingKnob) {
            isDraggingKnob = false;
            dawHistory.pushState(`Tweak Generator ${paramName}`);
          }
        });
        
        content.appendChild(param)
      })

      win.appendChild(header)
      win.appendChild(content)
      host.appendChild(win)
      
      openGeneratorWindows.set(trackId, win);

      // Close logic
      win.querySelector('.plugin-close').addEventListener('click', () => {
        win.remove();
        openGeneratorWindows.delete(trackId);
      })

      // Drag logic
      let isDragging = false
      let startX, startY, startLeft, startTop

      header.addEventListener('mousedown', (e) => {
        isDragging = true
        startX = e.clientX
        startY = e.clientY
        const rect = win.getBoundingClientRect()
        startLeft = rect.left
        startTop = rect.top
        win.style.transform = 'none' // Disable centering transform once dragged
        win.style.left = `${startLeft}px`
        win.style.top = `${startTop}px`
      })

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        win.style.left = `${startLeft + dx}px`
        win.style.top = `${startTop + dy}px`
      })

      document.addEventListener('mouseup', () => {
        isDragging = false
      })
    }

    function populateList(container, items, type) {
      if (!container) return;
      container.innerHTML = ''
      const list = document.createElement('ul')
      list.className = 'browser-accordion'
      
      items.forEach(item => {
        const li = document.createElement('li')
        li.className = 'browser-item'
        li.innerHTML = `
          <span style="font-size: 1rem; margin-right: 4px;">${item.icon}</span>
          <span class="browser-item-name">${item.name}</span>
        `
        li.addEventListener('click', () => {
          if (type === 'effects') {
            let fxObj
            if (currentTrackId === 'master') {
              fxObj = engine.addEffect(item.id)
            } else {
              const currentTrack = engine.getTrack(currentTrackId)
              if (currentTrack) {
                fxObj = currentTrack.addEffect(item.id)
              }
            }
            if (fxObj) {
              fxObj.icon = item.icon
              console.log(`Added ${item.name} to ${currentTrackId}`)
              showPluginWindow(fxObj)
              window.updatePluginsFooter()
              if (window.updateMixerInserts) window.updateMixerInserts()
              dawHistory.pushState(`Add ${item.name} Plugin`)
            }
          } else if (type === 'generators') {
            if (currentTrackId !== 'master') {
              const currentTrack = engine.getTrack(currentTrackId)
              if (currentTrack) {
                let defaultParams = {}
                if (item.id === 'sampler') {
                  defaultParams = { attack: 0.005, decay: 0.1, sustain: 1.0, release: 0.1, cutoff: 20000, resonance: 1.0, pitch: 0 }
                } else if (item.id === 'monosynth') {
                  defaultParams = { oscType: 'sawtooth', subOsc: 0.5, attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.3, cutoff: 2000, resonance: 2.0 }
                } else if (item.id === 'polysynth') {
                  defaultParams = { oscType: 'triangle', detune: 10, attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5, cutoff: 5000, resonance: 1.0 }
                } else if (item.id === 'fmsynth') {
                  defaultParams = { carrierType: 'sine', modType: 'sine', modIndex: 5, modFreqRatio: 2.0, attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.4 }
                }
                
                currentTrack.generator = {
                  type: item.id,
                  params: currentTrack.generator?.type === item.id ? (currentTrack.generator.params || defaultParams) : defaultParams
                }
                showGeneratorWindow(currentTrackId)
                window.updatePluginsFooter()
                dawHistory.pushState(`Switch Track Generator to ${item.name}`)
              }
            }
          }
        })
        list.appendChild(li)
      })
      container.appendChild(list)
    }

    populateList(effectsContainer, effects, 'effects')
    populateList(generatorsContainer, generators, 'generators')

    // ── Preferences / Settings Modal Logic ──────────────────────────────
    const prefModal = document.getElementById('settings-modal');
    const prefCloseBtn = document.getElementById('settings-close-btn');
    const prefApplyBtn = document.getElementById('settings-apply-btn');
    const prefResetBtn = document.getElementById('settings-reset-btn');
    const menuPref = document.getElementById('menu-preferences');

    // Tab switcher
    const prefTabs = document.querySelectorAll('.settings-tab');
    const prefPanes = document.querySelectorAll('.settings-pane');

    prefTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        prefTabs.forEach(t => t.classList.toggle('active', t === tab));
        prefPanes.forEach(p => p.classList.toggle('active', p.id === `stab-${target}`));
      });
    });

    // Toggle menu dropdown show/hide
    menuPref?.addEventListener('click', async (e) => {
      e.stopPropagation();
      document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
      await openPreferencesModal();
    });

    // Add Ctrl+, shortcut
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        openPreferencesModal();
      }
    });

    async function openPreferencesModal() {
      if (!prefModal) return;
      prefModal.style.display = 'flex';
      
      // Update Audio Stats
      const sampleRateEl = document.getElementById('pref-sample-rate');
      const ctxStateEl = document.getElementById('pref-ctx-state');
      if (sampleRateEl) sampleRateEl.textContent = `${engine.ctx.sampleRate} Hz`;
      if (ctxStateEl) ctxStateEl.textContent = engine.ctx.state.toUpperCase();

      // Populate output and input audio devices
      const outSelect = document.getElementById('pref-output-device');
      const inSelect = document.getElementById('pref-input-device');
      
      if (outSelect && inSelect) {
        const curOut = localStorage.getItem('bounce.outputDevice') || 'default';
        const curIn = localStorage.getItem('bounce.inputDevice') || 'default';
        
        outSelect.innerHTML = '<option value="default">Default System Output</option>';
        inSelect.innerHTML = '<option value="default">Default System Input</option>';
        
        try {
          const devs = await engine.getAudioDevices();
          devs.outputs.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || `Output Device (${d.deviceId.slice(0,5)})`;
            if (d.deviceId === curOut) opt.selected = true;
            outSelect.appendChild(opt);
          });
          devs.inputs.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || `Microphone (${d.deviceId.slice(0,5)})`;
            if (d.deviceId === curIn) opt.selected = true;
            inSelect.appendChild(opt);
          });
        } catch (err) {
          console.warn('Could not enumerate audio devices:', err);
        }
      }

      // Populate other form fields from localStorage
      const latencySelect = document.getElementById('pref-latency');
      if (latencySelect) latencySelect.value = localStorage.getItem('bounce.latencyHint') || 'interactive';

      const densitySelect = document.getElementById('pref-ui-density');
      if (densitySelect) densitySelect.value = localStorage.getItem('bounce.uiDensity') || 'normal';

      const autosaveCheck = document.getElementById('pref-autosave');
      const autosaveInterval = document.getElementById('pref-autosave-interval');
      const autosaveIntervalRow = document.getElementById('autosave-interval-row');
      
      if (autosaveCheck) {
        const isEnabled = localStorage.getItem('bounce.autoSave') === 'true';
        autosaveCheck.checked = isEnabled;
        if (autosaveIntervalRow) {
          autosaveIntervalRow.style.opacity = isEnabled ? '1' : '0.4';
          autosaveIntervalRow.style.pointerEvents = isEnabled ? 'auto' : 'none';
        }
      }
      if (autosaveInterval) autosaveInterval.value = localStorage.getItem('bounce.autoSaveInterval') || '5';

      const bpmInput = document.getElementById('pref-default-bpm');
      if (bpmInput) bpmInput.value = localStorage.getItem('bounce.defaultBPM') || '120';

      const snapSelect = document.getElementById('pref-default-snap');
      if (snapSelect) snapSelect.value = localStorage.getItem('bounce.defaultSnap') || '0.0625';

      const followCheck = document.getElementById('pref-follow-playhead');
      if (followCheck) followCheck.checked = localStorage.getItem('bounce.followPlayhead') !== 'false';

      const metroSoundSelect = document.getElementById('pref-metronome-sound');
      if (metroSoundSelect) {
        metroSoundSelect.value = localStorage.getItem('bounce.metronomeSound') || 'woodblock';
        sequencer.metronomeSound = metroSoundSelect.value;
      }

      const monitorCheck = document.getElementById('pref-input-monitor');
      if (monitorCheck) monitorCheck.checked = localStorage.getItem('bounce.inputMonitor') === 'true';
      
      const autoNameCheck = document.getElementById('pref-auto-name-clips');
      if (autoNameCheck) autoNameCheck.checked = localStorage.getItem('bounce.autoNameClips') !== 'false';

      // Setup theme buttons state
      const savedTheme = localStorage.getItem('bounce.theme') || 'dark';
      document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === savedTheme);
      });

      // Setup Swatch selection styles
      const activeColor = localStorage.getItem('bounce.accentColor') || '#00e5ff';
      document.querySelectorAll('.accent-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.color === activeColor);
      });
      const customColorInput = document.getElementById('pref-accent-custom');
      if (customColorInput) customColorInput.value = activeColor;
    }

    // Toggle Autosave row dependency
    document.getElementById('pref-autosave')?.addEventListener('change', (e) => {
      const isEnabled = e.target.checked;
      const autosaveIntervalRow = document.getElementById('autosave-interval-row');
      if (autosaveIntervalRow) {
        autosaveIntervalRow.style.opacity = isEnabled ? '1' : '0.4';
        autosaveIntervalRow.style.pointerEvents = isEnabled ? 'auto' : 'none';
      }
    });

    function closePreferencesModal() {
      if (prefModal) prefModal.style.display = 'none';
    }

    prefCloseBtn?.addEventListener('click', closePreferencesModal);
    
    prefModal?.addEventListener('mousedown', (e) => {
      if (e.target === prefModal) closePreferencesModal();
    });

    // ======= HELP MODAL HANDLERS =======
    const helpModal = document.getElementById('help-modal');
    const helpCloseBtn = document.getElementById('help-close-btn');
    const menuHelp = document.getElementById('menu-help');

    menuHelp?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
      if (helpModal) helpModal.style.display = 'flex';
    });

    helpCloseBtn?.addEventListener('click', () => {
      if (helpModal) helpModal.style.display = 'none';
    });

    helpModal?.addEventListener('mousedown', (e) => {
      if (e.target === helpModal) helpModal.style.display = 'none';
    });

    // ======= ABOUT MODAL HANDLERS =======
    const aboutModal = document.getElementById('about-modal');
    const aboutCloseBtn = document.getElementById('about-close-btn');
    const menuAbout = document.getElementById('menu-about');

    menuAbout?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
      if (aboutModal) aboutModal.style.display = 'flex';
    });

    aboutCloseBtn?.addEventListener('click', () => {
      if (aboutModal) aboutModal.style.display = 'none';
    });

    aboutModal?.addEventListener('mousedown', (e) => {
      if (e.target === aboutModal) aboutModal.style.display = 'none';
    });

    // Theme Switcher clicks
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const theme = btn.dataset.theme;
        applyTheme(theme);
      });
    });

    function applyTheme(theme) {
      if (theme === 'light') {
        document.body.classList.add('light-theme');
      } else {
        document.body.classList.remove('light-theme');
      }
      localStorage.setItem('bounce.theme', theme);
      
      const darkBtn = document.getElementById('theme-dark');
      const lightBtn = document.getElementById('theme-light');
      if (darkBtn && lightBtn) {
        darkBtn.classList.toggle('active', theme === 'dark');
        lightBtn.classList.toggle('active', theme === 'light');
      }

      // Re-apply current accent color so it correctly respects the light mode darkening
      const currentAccent = localStorage.getItem('bounce.accentColor') || '#00e5ff';
      applyAccentColor(currentAccent);
    }

    function darkenColor(hex, percent) {
      hex = hex.replace(/^\s*#|\s*$/g, '');
      if (hex.length === 3) {
        hex = hex.replace(/(.)/g, '$1$1');
      }
      let r = parseInt(hex.substr(0, 2), 16);
      let g = parseInt(hex.substr(2, 2), 16);
      let b = parseInt(hex.substr(4, 2), 16);

      r = Math.max(0, Math.floor(r * (1 - percent / 100)));
      g = Math.max(0, Math.floor(g * (1 - percent / 100)));
      b = Math.max(0, Math.floor(b * (1 - percent / 100)));

      const pad = val => val.toString(16).padStart(2, '0');
      return `#${pad(r)}${pad(g)}${pad(b)}`;
    }

    // Swatch Color clicks
    document.querySelectorAll('.accent-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        const color = sw.dataset.color;
        applyAccentColor(color);
        document.querySelectorAll('.accent-swatch').forEach(s => s.classList.toggle('active', s === sw));
        const customColorInput = document.getElementById('pref-accent-custom');
        if (customColorInput) customColorInput.value = color;
      });
    });

    // Custom Color picker input
    document.getElementById('pref-accent-custom')?.addEventListener('input', (e) => {
      const color = e.target.value;
      applyAccentColor(color);
      document.querySelectorAll('.accent-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.color === color);
      });
    });

    // Reset Accent Color button click
    document.getElementById('pref-reset-accent')?.addEventListener('click', () => {
      const defaultAccent = '#00e5ff';
      applyAccentColor(defaultAccent);
      document.querySelectorAll('.accent-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.color === defaultAccent);
      });
      const customColorInput = document.getElementById('pref-accent-custom');
      if (customColorInput) customColorInput.value = defaultAccent;
      showToast('Accent color reset to original Cyan');
    });

    function applyAccentColor(color) {
      let colorToApply = color;
      const isLightTheme = document.body.classList.contains('light-theme') || 
                            (localStorage.getItem('bounce.theme') === 'light');
      if (isLightTheme) {
        colorToApply = darkenColor(color, 25);
      }
      
      document.body.style.setProperty('--accent-color', colorToApply);
      document.body.style.setProperty('--accent-hover', `${colorToApply}dd`);
      localStorage.setItem('bounce.accentColor', color);
    }

    // Apply UI density
    function applyUiDensity(density) {
      document.body.classList.remove('density-compact', 'density-comfortable');
      if (density === 'compact') {
        document.body.classList.add('density-compact');
      } else if (density === 'comfortable') {
        document.body.classList.add('density-comfortable');
      }
      localStorage.setItem('bounce.uiDensity', density);
    }

    // Apply preferences
    prefApplyBtn?.addEventListener('click', async () => {
      const outSelect = document.getElementById('pref-output-device');
      const inSelect = document.getElementById('pref-input-device');
      const latencySelect = document.getElementById('pref-latency');
      const densitySelect = document.getElementById('pref-ui-density');
      const autosaveCheck = document.getElementById('pref-autosave');
      const autosaveInterval = document.getElementById('pref-autosave-interval');
      const bpmInput = document.getElementById('pref-default-bpm');
      const snapSelect = document.getElementById('pref-default-snap');
      const followCheck = document.getElementById('pref-follow-playhead');
      const monitorCheck = document.getElementById('pref-input-monitor');
      const autoNameCheck = document.getElementById('pref-auto-name-clips');

      // Save to localStorage
      if (outSelect) {
        localStorage.setItem('bounce.outputDevice', outSelect.value);
        await engine.setOutputDevice(outSelect.value);
      }
      if (inSelect) {
        localStorage.setItem('bounce.inputDevice', inSelect.value);
        engine.inputDeviceId = inSelect.value;
      }
      if (latencySelect) localStorage.setItem('bounce.latencyHint', latencySelect.value);
      if (densitySelect) applyUiDensity(densitySelect.value);
      
      if (autosaveCheck) {
        localStorage.setItem('bounce.autoSave', autosaveCheck.checked.toString());
        setupAutoSave();
      }
      if (autosaveInterval) {
        localStorage.setItem('bounce.autoSaveInterval', autosaveInterval.value);
        setupAutoSave();
      }
      if (bpmInput) localStorage.setItem('bounce.defaultBPM', bpmInput.value);
      if (snapSelect) localStorage.setItem('bounce.defaultSnap', snapSelect.value);
      if (followCheck) localStorage.setItem('bounce.followPlayhead', followCheck.checked.toString());

      const metroSoundSelect = document.getElementById('pref-metronome-sound');
      if (metroSoundSelect) {
        localStorage.setItem('bounce.metronomeSound', metroSoundSelect.value);
        sequencer.metronomeSound = metroSoundSelect.value;
      }
      
      if (monitorCheck) {
        localStorage.setItem('bounce.inputMonitor', monitorCheck.checked.toString());
        engine.inputMonitor = monitorCheck.checked;
      }
      if (autoNameCheck) localStorage.setItem('bounce.autoNameClips', autoNameCheck.checked.toString());

      showToast('Settings saved successfully');
      closePreferencesModal();
    });

    // Reset settings
    prefResetBtn?.addEventListener('click', () => {
      if (confirm('Reset all preferences to default?')) {
        localStorage.removeItem('bounce.theme');
        localStorage.removeItem('bounce.accentColor');
        localStorage.removeItem('bounce.uiDensity');
        localStorage.removeItem('bounce.outputDevice');
        localStorage.removeItem('bounce.inputDevice');
        localStorage.removeItem('bounce.latencyHint');
        localStorage.removeItem('bounce.autoSave');
        localStorage.removeItem('bounce.autoSaveInterval');
        localStorage.removeItem('bounce.defaultBPM');
        localStorage.removeItem('bounce.defaultSnap');
        localStorage.removeItem('bounce.followPlayhead');
        localStorage.removeItem('bounce.inputMonitor');
        localStorage.removeItem('bounce.autoNameClips');
        localStorage.removeItem('bounce.metronomeSound');

        // Apply defaults immediately
        applyTheme('dark');
        applyAccentColor('#00e5ff');
        applyUiDensity('normal');
        engine.inputDeviceId = 'default';
        engine.setOutputDevice('default');
        setupAutoSave();
        
        showToast('Preferences reset');
        openPreferencesModal(); // refresh fields
      }
    });

    // Auto-Save background timer
    let autoSaveTimer = null;
    function setupAutoSave() {
      if (autoSaveTimer) clearInterval(autoSaveTimer);
      const enabled = localStorage.getItem('bounce.autoSave') === 'true';
      const intervalMinutes = parseInt(localStorage.getItem('bounce.autoSaveInterval') || '5', 10);
      if (enabled && intervalMinutes > 0) {
        autoSaveTimer = setInterval(async () => {
          if (currentProjectPath) {
            await doSave(currentProjectPath);
            showToast('💾 Project auto-saved');
          }
        }, intervalMinutes * 60 * 1000);
      }
    }

    // Load saved preferences on startup
    function loadSavedPreferences() {
      const savedTheme = localStorage.getItem('bounce.theme') || 'dark';
      applyTheme(savedTheme);

      const savedAccent = localStorage.getItem('bounce.accentColor') || '#00e5ff';
      applyAccentColor(savedAccent);

      const savedDensity = localStorage.getItem('bounce.uiDensity') || 'normal';
      applyUiDensity(savedDensity);

      engine.inputDeviceId = localStorage.getItem('bounce.inputDevice') || 'default';
      const savedOutDevice = localStorage.getItem('bounce.outputDevice') || 'default';
      engine.setOutputDevice(savedOutDevice);

      engine.inputMonitor = localStorage.getItem('bounce.inputMonitor') === 'true';

      setupAutoSave();
    }

    loadSavedPreferences();

    // Initial update of mixer inserts
    updateMixerInserts()
  })
}

function buildPianoRoll() {
  const keysContainer = document.getElementById('piano-keys')
  const grid = document.getElementById('piano-grid')
  if (!keysContainer || !grid) return

  const KEY_HEIGHT = 24
  const NOTES_DESC = ['B','A#','A','G#','G','F#','F','E','D#','D','C#','C']
  const BLACK = new Set(['A#','C#','D#','F#','G#'])
  const OCTAVES = [6,5,4,3,2]

  keysContainer.innerHTML = ''
  grid.innerHTML = ''

  // Add a spacer to the keys container to align with the ruler
  const rulerHeight = 40 // Matched to CSS
  const spacer = document.createElement('div')
  spacer.style.height = `${rulerHeight}px`
  spacer.style.flexShrink = '0'
  keysContainer.appendChild(spacer)

  OCTAVES.forEach(oct => {
    NOTES_DESC.forEach(note => {
      const isBlack = BLACK.has(note)
      const fullName = `${note}${oct}`

      // ── Piano key ────────────────────────────────────────────────
      const key = document.createElement('div')
      key.className = `pr-key ${isBlack ? 'pr-black' : 'pr-white'}`
      key.style.height = `${KEY_HEIGHT}px`
      key.dataset.note = note

      key.addEventListener('mousedown', () => {
        const currentTrackId = document.getElementById('pr-track-select')?.value || 'drums';
        engine.playNote(currentTrackId, fullName, engine.ctx.currentTime, 0.5);
      });

      const label = document.createElement('span')
      label.className = 'pr-key-label'
      label.textContent = fullName
      key.appendChild(label)
      
      keysContainer.appendChild(key)

      // ── Grid row ─────────────────────────────────────────────────
      const row = document.createElement('div')
      row.className = `pr-row ${isBlack ? 'pr-row-black' : 'pr-row-white'}`
      row.style.height = `${KEY_HEIGHT}px`
      row.dataset.note = fullName
      grid.appendChild(row)
    })
  })

  grid.addEventListener('scroll', () => { keysContainer.scrollTop = grid.scrollTop })
  keysContainer.addEventListener('scroll', () => { grid.scrollTop = keysContainer.scrollTop })
}

init()
