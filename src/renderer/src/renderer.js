import { engine, parseNoteToMidi } from './AudioEngine.js'
import { sequencer } from './Sequencer.js'

function init() {
  window.addEventListener('DOMContentLoaded', () => {
    console.log('Bounce DAW initialized')
    
    let prZoomFactor = 1.0
    let currentProjectPath = null
    
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

    // Transport Controls
    const playBtn = document.querySelector('.transport-btn.play')
    const stopBtn = document.querySelector('.transport-btn.stop')
    const loopBtn = document.getElementById('loop-toggle-btn')
    const skipBackBtn = document.querySelector('.transport-btn.skip-back')

    const playSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256"><path d="M232.4,114.49,88.32,26.35a16,16,0,0,0-24.32,13.65v176a16,16,0,0,0,24.32,13.65l144.08-88.14A16,16,0,0,0,232.4,114.49ZM80,216V40l144,88Z"></path></svg>'
    const pauseSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256"><path d="M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32ZM200,208V48H160V208ZM80,208V48H56V208Z"></path></svg>'
    const fileSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z"></path></svg>'

    playBtn?.addEventListener('click', () => {
      if (sequencer.isPlaying) {
        sequencer.pause()
        playBtn.innerHTML = playSvg
      } else {
        sequencer.play()
        playBtn.innerHTML = pauseSvg
      }
    })

    stopBtn?.addEventListener('click', () => {
      sequencer.stop()
      playBtn.innerHTML = playSvg
    })

    loopBtn?.addEventListener('click', () => {
      sequencer.loopEnabled = !sequencer.loopEnabled
      loopBtn.classList.toggle('active', sequencer.loopEnabled)
    })

    skipBackBtn?.addEventListener('click', () => {
      sequencer.stop()
      playBtn.innerHTML = playSvg
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
                  <button class="browser-item-remove" title="Remove from list">${removeSvg}</button>
                `
                li.querySelector('.browser-item-remove').addEventListener('click', (e) => {
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

    // Auto-load default samples
    setTimeout(() => {
      try {
        const defaultPath = window.location.href.includes('index.html') 
          ? window.location.pathname.replace('index.html', 'audio')
          : '/home/lexxy/Documents/projects/bounce/src/renderer/public/audio'
        
        buildBrowserTree(browserContainer, 'Starter Pack', `${defaultPath}/Starter Pack`, false)
      } catch (e) { console.warn("Could not auto-load samples", e) }
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
      
      // Set complex grid background on grid-container
      const gridContainer = document.querySelector('.grid-container')
      if (gridContainer) {
        const beatPixels = (1 / beatsPerSecond) * sequencer.pxPerSecond
        const barPixels = beatsPerBar * beatPixels
        const sixteenthPixels = beatPixels / 4
        
        gridContainer.style.backgroundImage = `
          repeating-linear-gradient(90deg, transparent, transparent calc(${barPixels}px - 1px), rgba(255,255,255,0.15) calc(${barPixels}px - 1px), rgba(255,255,255,0.15) ${barPixels}px),
          repeating-linear-gradient(90deg, transparent, transparent calc(${beatPixels}px - 1px), rgba(255,255,255,0.08) calc(${beatPixels}px - 1px), rgba(255,255,255,0.08) ${beatPixels}px),
          repeating-linear-gradient(90deg, transparent, transparent calc(${sixteenthPixels}px - 1px), rgba(255,255,255,0.03) calc(${sixteenthPixels}px - 1px), rgba(255,255,255,0.03) ${sixteenthPixels}px)
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
          if (j !== 0) beatSpan.style.borderLeft = '1px solid rgba(255,255,255,0.1)'
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
    if (arrangementView) {
      // Zoom
      arrangementView.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
          const newPx = sequencer.pxPerSecond * zoomFactor;
          sequencer.setZoom(newPx);
          
          const clips = document.querySelectorAll('.clip')
          clips.forEach(clip => {
            if (clip.dataset.startTime && clip.dataset.duration) {
              const start = parseFloat(clip.dataset.startTime)
              const duration = parseFloat(clip.dataset.duration)
              clip.style.left = `${start * sequencer.pxPerSecond}px`
              clip.style.width = `${Math.max(20, duration * sequencer.pxPerSecond)}px`
            }
          })
          drawTimeline()
          // Keep PR aligned with arranger zoom
          if (typeof drawPianoRollTimeline === 'function') drawPianoRollTimeline()
          if (typeof rebuildPianoRollNotes === 'function') rebuildPianoRollNotes()
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
                duration: audioBuffer.duration,
                trackId: trackId,
                scheduled: false,
                uiElement: clip,
                _filePath: fileInfo.path,
                _fileName: fileInfo.name
              };
              sequencer.addClip(seqClip)
            }
          }
        } catch (err) {
          console.error('Error handling drop:', err)
        }
      })

      // Clip Dragging & Resizing
      let clipDragState = null;

      arrangementView.addEventListener('mousedown', (e) => {
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
          
          const isPattern = clip.classList.contains('pattern-clip')
          const seqArray = isPattern ? sequencer.patternClips : sequencer.clips
          const oldSeqClip = seqArray.find(c => c.uiElement === clip)
          
          if (e.ctrlKey || e.metaKey) {
            // Duplicate
            const clone = clip.cloneNode(true)
            clip.parentElement.appendChild(clone)
            
            if (oldSeqClip) {
              const newSeqClip = { ...oldSeqClip, uiElement: clone, scheduled: false }
              if (isPattern) {
                sequencer.addPatternClip(newSeqClip)
              } else {
                sequencer.addClip(newSeqClip)
              }
              clipDragState = { type: 'move', clip: clone, originalSeqClip: newSeqClip, startX: e.clientX, startLeft: parseFloat(clip.style.left) || 0 };
            } else {
              clipDragState = { type: 'move', clip: clone, startX: e.clientX, startLeft: parseFloat(clip.style.left) || 0 };
            }
            clone.classList.add('dragging');
          } else {
            // Move
            clipDragState = { 
              type: 'move', 
              clip: clip, 
              originalSeqClip: oldSeqClip,
              startX: e.clientX, 
              startLeft: parseFloat(clip.style.left) || 0 
            };
            clip.classList.add('dragging');
          }
        }
      });

      document.addEventListener('mousemove', (e) => {
        if (!clipDragState) return;
        
        if (clipDragState.type === 'resize' || clipDragState.type === 'paint') {
          const deltaX = e.clientX - clipDragState.startX;
          const newDur = Math.max(0.1, clipDragState.startDur + deltaX / sequencer.pxPerSecond);
          clipDragState.clip.style.width = `${Math.max(10, newDur * sequencer.pxPerSecond)}px`;
          clipDragState.clip.dataset.duration = newDur;
          
          const isPattern = clipDragState.clip.classList.contains('pattern-clip')
          const seqArray = isPattern ? sequencer.patternClips : sequencer.clips
          const seqClip = seqArray.find(c => c.uiElement === clipDragState.clip);
          if (seqClip) {
            seqClip.duration = newDur;
            seqClip.scheduled = false;
          }
        } else if (clipDragState.type === 'move') {
          const deltaX = e.clientX - clipDragState.startX;
          let newLeft = Math.max(0, clipDragState.startLeft + deltaX);
          
          const timeInSeconds = newLeft / sequencer.pxPerSecond;
          const snappedTime = sequencer.snapTimeToGrid(timeInSeconds);
          newLeft = snappedTime * sequencer.pxPerSecond;
          
          clipDragState.clip.style.left = `${newLeft}px`;
          
          // Hover over different lane
          const elementsUnder = document.elementsFromPoint(e.clientX, e.clientY);
          const lane = elementsUnder.find(el => el.classList.contains('track-lane'));
          if (lane && lane !== clipDragState.clip.parentElement) {
            lane.appendChild(clipDragState.clip);
            const map = trackUIMap[lane.dataset.trackId];
            if (map && map.headers[0]) {
               const color = map.headers[0].laneEl.style.getPropertyValue('--track-color')
               if (color) clipDragState.clip.style.background = color
            }
          }
        }
      });

      document.addEventListener('mouseup', (e) => {
        if (clipDragState) {
          clipDragState.clip.classList.remove('dragging');
          
          if (clipDragState.type === 'move') {
            const newLeft = parseFloat(clipDragState.clip.style.left) || 0;
            const newStartTime = newLeft / sequencer.pxPerSecond;
            clipDragState.clip.dataset.startTime = newStartTime;
            
            const isPattern = clipDragState.clip.classList.contains('pattern-clip')
            const seqArray = isPattern ? sequencer.patternClips : sequencer.clips
            const seqClip = seqArray.find(c => c.uiElement === clipDragState.clip);
            if (seqClip) {
              seqClip.startTime = newStartTime;
              const parentLane = clipDragState.clip.parentElement;
              if (parentLane) {
                seqClip.trackId = parentLane.dataset.trackId;
              }
              seqClip.scheduled = false;
            }
          }
          
          clipDragState = null;
        }
      });

      // Double-click to delete a clip
      arrangementView.addEventListener('dblclick', (e) => {
        const clip = e.target.closest('.clip')
        if (clip) {
          const isPattern = clip.classList.contains('pattern-clip')
          if (isPattern) {
            const seqClip = sequencer.patternClips.find(c => c.uiElement === clip)
            if (seqClip) sequencer.removePatternClip(seqClip)
          } else {
            const seqClip = sequencer.clips.find(c => c.uiElement === clip)
            if (seqClip) sequencer.removeClip(seqClip)
          }
          clip.remove()
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
    function createTrackUI(trackId, trackName, defaultColor) {
      // 1. Initialize track in engine
      tracks[trackName] = engine.createTrack(trackId, trackName)
      trackUIMap[trackId] = { headers: [], mixers: [], seqRows: [] }

      // 2. Track Header
      const headerContainer = document.getElementById('track-headers-container')
      const trackCount = headerContainer.children.length + 1
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
          <input type="range" class="track-vol-slider" min="0" max="100" value="80" title="Volume">
        </div>
      `
      headerContainer.appendChild(header)

      // 3. Track Lane
      const laneContainer = document.getElementById('track-lanes-container')
      const lane = document.createElement('div')
      lane.className = 'track-lane'
      lane.dataset.trackId = trackId
      laneContainer.appendChild(lane)

      // 4. Mixer Channel
      const mixerContainer = document.getElementById('mixer-channels-container')
      const channel = document.createElement('div')
      channel.className = 'mixer-channel'
      channel.dataset.trackId = trackId
      channel.innerHTML = `
        <div class="channel-name">${trackName}</div>
        <div class="channel-inserts">
          <div class="insert-slot"></div><div class="insert-slot"></div><div class="insert-slot"></div>
        </div>
        <div class="channel-controls">
          <div class="btn-group"><button class="c-btn m-btn">M</button><button class="c-btn s-btn">S</button></div>
          <div class="pan-knob"><div class="knob-indicator"></div></div>
        </div>
        <div class="fader-section">
          <div class="fader-track"><div class="fader-handle" style="bottom: 80%;"></div></div>
          <div class="peak-meter"><div class="meter-level" style="height: 0%;"></div></div>
        </div>
        <div class="channel-db">-1.9</div>
      `
      mixerContainer.appendChild(channel)

      // 5. Sequencer Row
      const seqContainer = document.getElementById('seq-rows-container')
      const seqRow = document.createElement('div')
      seqRow.className = 'seq-row'
      seqRow.dataset.trackId = trackId
      seqRow.innerHTML = `
        <div class="seq-label">${trackName}</div>
        <div class="seq-steps" data-instrument="${trackId}" data-note="C1"></div>
      `
      seqContainer.appendChild(seqRow)

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

      const nameElM = channel.querySelector('.channel-name')
      const mBtnM = channel.querySelector('.m-btn')
      const sBtnM = channel.querySelector('.s-btn')
      const faderEl = channel.querySelector('.fader-handle')
      const faderTrackEl = channel.querySelector('.fader-track')
      const dbLabel = channel.querySelector('.channel-db')
      const meterLevel = channel.querySelector('.meter-level')
      channel._meterLevel = meterLevel
      channel._trackName = trackName

      trackUIMap[trackId].headers.push({ mBtn: mBtnH, sBtn: sBtnH, rBtn: rBtnH, nameEl, colorPicker, laneEl: lane, headerEl: header, volSlider })
      trackUIMap[trackId].mixers.push({ mBtn: mBtnM, sBtn: sBtnM, nameEl: nameElM, channelEl: channel, faderEl, faderTrackEl, dbLabel })
      trackUIMap[trackId].seqRows.push(seqRow)

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
          channel.remove();
          seqRow.remove();
          const prSelect = document.getElementById('pr-track-select');
          if (prSelect) {
            const opt = Array.from(prSelect.options).find(o => o.value === trackId);
            if (opt) opt.remove();
          }
          delete trackUIMap[trackId];
        }
      });

      // Volume & Fader Logic
      if (volSlider) {
        volSlider.addEventListener('input', (e) => {
          engine.resume()
          const pct = parseFloat(e.target.value)
          const gainValue = (pct / 100) * 1.5
          tracks[trackName].setVolume(gainValue)
          engine.updateTrackVolumes()
          faderEl.style.bottom = `${pct}%`
          const db = gainValue <= 0 ? -Infinity : 20 * Math.log10(gainValue)
          dbLabel.textContent = db === -Infinity ? '-inf' : db.toFixed(1)
        })
      }

      if (faderEl) {
        faderEl.addEventListener('mousedown', (e) => {
          engine.resume()
          const onMouseMove = (moveEvent) => {
            const rect = faderTrackEl.getBoundingClientRect()
            let percentage = ((rect.bottom - moveEvent.clientY) / rect.height) * 100
            percentage = Math.max(0, Math.min(100, percentage))
            faderEl.style.bottom = `${percentage}%`
            const gainValue = (percentage / 100) * 1.5
            const db = percentage === 0 ? -Infinity : 20 * Math.log10(gainValue)
            dbLabel.textContent = db === -Infinity ? '-inf' : db.toFixed(1)
            tracks[trackName].setVolume(gainValue)
            engine.updateTrackVolumes()
            if (volSlider) volSlider.value = percentage
          }
          const onMouseUp = () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp) }
          document.addEventListener('mousemove', onMouseMove)
          document.addEventListener('mouseup', onMouseUp)
        })
      }

      // Sync Names & Colors
      nameEl.addEventListener('blur', () => {
        const newName = nameEl.textContent
        nameElM.textContent = newName
        seqRow.querySelector('.seq-label').textContent = newName
        const opt = document.querySelector(`#pr-track-select option[value="${trackId}"]`)
        if (opt) opt.textContent = newName
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
        channel.style.setProperty('--track-color', color)
        seqRow.style.setProperty('--track-color', color)
      })

      // Mute / Solo / Record
      const toggleMute = () => { const isMuted = engine.toggleMute(trackId); syncTrackUI(trackId, 'mute', isMuted) }
      const toggleSolo = () => { const isSoloed = engine.toggleSolo(trackId); syncTrackUI(trackId, 'solo', isSoloed) }
      mBtnH.addEventListener('click', toggleMute); mBtnM.addEventListener('click', toggleMute)
      sBtnH.addEventListener('click', toggleSolo); sBtnM.addEventListener('click', toggleSolo)
      rBtnH.addEventListener('click', () => { const isArmed = engine.toggleRecord(trackId); syncTrackUI(trackId, 'record', isArmed) })

      // Generate step sequencer grid for this row
      const stepCount = parseInt(document.getElementById('step-count-select').value)
      buildStepRows(stepCount)

      // Initial color trigger
      colorPicker.dispatchEvent(new Event('input'))
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

    // Auto-load default instruments
    setTimeout(async () => {
      try {
        const defaultPath = window.location.href.includes('index.html') 
          ? window.location.pathname.replace('index.html', 'audio')
          : '/home/lexxy/Documents/projects/bounce/src/renderer/public/audio'
        
        const defaultSamples = [
          { tid: 'kick', name: 'kick.wav', path: `${defaultPath}/Starter Pack/Drum Kit/kick.wav` },
          { tid: 'snare', name: 'snare.wav', path: `${defaultPath}/Starter Pack/Drum Kit/snare.wav` },
          { tid: 'hihat', name: 'hihat.wav', path: `${defaultPath}/Starter Pack/Drum Kit/hihat.wav` },
          { tid: 'piano', name: 'epiano_C4.wav', path: `${defaultPath}/Starter Pack/Keys/epiano_C4.wav` },
          { tid: 'bass', name: 'sub_bass_C2.wav', path: `${defaultPath}/Starter Pack/Bass/sub_bass_C2.wav` },
          { tid: 'clap', name: 'clap.wav', path: `${defaultPath}/Starter Pack/Drum Kit/clap.wav` },
          { tid: 'shaker', name: 'shaker.wav', path: `${defaultPath}/Starter Pack/Drum Kit/shaker.wav` },
          { tid: 'tom_hi', name: 'tom_hi.wav', path: `${defaultPath}/Starter Pack/Drum Kit/tom_hi.wav` }
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
    }

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

      mixerChannels.forEach((channel) => {
        if (!channel._meterLevel) return
        
        let peak = 0
        if (channel._trackName === 'Master') {
          peak = engine.getMasterPeakLevel()
        } else if (tracks[channel._trackName]) {
          peak = tracks[channel._trackName].getPeakLevel()
        }
        
        // Convert normalized peak (0.0-1.0) to height percentage
        channel._meterLevel.style.height = `${peak * 100}%`
      })
      
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
    
    // Bottom Panel Toggles
    const toggleBtns = document.querySelectorAll('.toggle-view')
    const footerPanels = document.querySelectorAll('.footer-panel')
    
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target
        
        // Update active button
        toggleBtns.forEach(b => b.classList.remove('btn-primary'))
        btn.classList.add('btn-primary')
        
        // Update active panel
        footerPanels.forEach(p => {
          if (p.id === targetId) {
            p.classList.add('active')
          } else {
            p.classList.remove('active')
          }
        })
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
        sequencer.bpm = newBPM
        bpmDisplay.textContent = newBPM.toFixed(1)
        drawTimeline()
        if (typeof drawPianoRollTimeline === 'function') drawPianoRollTimeline()
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

    function applyPrZoom(newFactor) {
      prZoomFactor = Math.max(0.25, Math.min(8, newFactor))
      const label = document.getElementById('pr-zoom-label')
      if (label) label.textContent = `${Math.round(prZoomFactor * 100)}%`
      drawPianoRollTimeline()
      rebuildPianoRollNotes()
      // update step-sequencer cell width
      document.querySelectorAll('.seq-step').forEach(s => {
        s.style.width = `${getPrStepPx()}px`
      })
    }

    function buildStepRows(count) {
      document.querySelectorAll('.seq-steps').forEach(container => {
        const note = container.dataset.note || null
        const trackId = container.dataset.instrument || 'drums'
        container.innerHTML = ''
        for (let i = 0; i < count; i++) {
          const step = document.createElement('div')
          step.className = 'seq-step'
          step.dataset.stepIndex = i
          step.style.width = `${getPrStepPx()}px`
          step.addEventListener('click', () => {
            step.classList.toggle('active')
            if (note) syncStepToPianoRoll(trackId, note, i, step.classList.contains('active'))
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
      
      if (pClips.length === 0) {
        // Create initial default clip
        createPatternClipUI(trackId, 0, finalDuration, lane);
      } else {
        // Update all existing clips for this track
        pClips.forEach(pClip => {
          pClip.style.width = `${Math.floor(finalDuration * sequencer.pxPerSecond)}px`;
          pClip.dataset.duration = finalDuration;
          const seqPc = sequencer.patternClips.find(pc => pc.uiElement === pClip);
          if (seqPc) seqPc.duration = finalDuration;
          
          // Redraw mini notes
          updatePatternClipMiniNotes(pClip, trackId, trackNotes, secondsPerStep);
        });
      }
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
      pianoGrid.addEventListener('mousedown', (e) => {
        const currentTrackId = prTrackSelect ? prTrackSelect.value : 'drums'
        
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
          
          if (e.ctrlKey || e.metaKey) {
            // Duplicate
            const clone = noteEl.cloneNode(true)
            row.appendChild(clone)
            prDragState = {
              type: 'move',
              noteElement: clone,
              startX: e.clientX,
              startY: e.clientY,
              startStep: parseInt(noteEl.dataset.step),
              startDur: parseFloat(noteEl.dataset.duration || 1),
              noteName: row.dataset.note,
              trackId: currentTrackId,
              isClone: true
            }
            clone.classList.add('dragging')
          } else {
            // Move
            prDragState = {
              type: 'move',
              noteElement: noteEl,
              startX: e.clientX,
              startY: e.clientY,
              startStep: parseInt(noteEl.dataset.step),
              startDur: parseFloat(noteEl.dataset.duration || 1),
              noteName: row.dataset.note,
              trackId: currentTrackId,
              isClone: false
            }
            noteEl.classList.add('dragging')
          }
          return;
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
          
          const note = createPrNote(currentTrackId, noteName, step, 1, color)
          row.appendChild(note)
          
          prDragState = {
            type: 'move',
            noteElement: note,
            startX: e.clientX,
            startY: e.clientY,
            startStep: step,
            startDur: 1,
            noteName: noteName,
            trackId: currentTrackId,
            isClone: false,
            isNew: true
          }
        }
      })
      
      document.addEventListener('mousemove', (e) => {
        if (!prDragState) return;
        const gridRect = pianoGrid.getBoundingClientRect();
        
        if (prDragState.type === 'resize' || prDragState.type === 'paint') {
          const deltaX = e.clientX - prDragState.startX;
          const newDur = Math.max(0.25, prDragState.startDur + deltaX / getPrStepPx());
          prDragState.noteElement.style.width = `${newDur * getPrStepPx() - 3}px`;
          prDragState.noteElement.dataset.duration = newDur;
          
          if (prDragState.type === 'paint') {
             // Future extension: spawn duplicates instead of resizing
          }
        } else if (prDragState.type === 'move') {
          const deltaX = e.clientX - prDragState.startX;
          const newStep = Math.max(0, Math.round(prDragState.startStep + deltaX / getPrStepPx()));
          prDragState.noteElement.style.left = `${newStep * getPrStepPx() + 1}px`;
          prDragState.noteElement.dataset.step = newStep;
          
          // Vertical dragging (Pitch change)
          const elementsUnder = document.elementsFromPoint(e.clientX, e.clientY);
          const newRow = elementsUnder.find(el => el.classList.contains('pr-row'));
          if (newRow && newRow !== prDragState.noteElement.parentElement) {
             newRow.appendChild(prDragState.noteElement);
          }
        }
      });
      
      document.addEventListener('mouseup', (e) => {
        if (prDragState) {
          prDragState.noteElement.classList.remove('dragging');
          
          const finalStep = parseFloat(prDragState.noteElement.dataset.step);
          const finalDur = parseFloat(prDragState.noteElement.dataset.duration);
          const row = prDragState.noteElement.closest('.pr-row');
          const finalNoteName = row ? row.dataset.note : prDragState.noteName;
          
          if (prDragState.type === 'move' && !prDragState.isClone) {
            // Remove old
            sequencer.removeNoteFromPattern(prDragState.trackId, prDragState.noteName, prDragState.startStep);
            const oldSeqRow = document.querySelector(`.seq-steps[data-instrument="${prDragState.trackId}"][data-note="${prDragState.noteName}"]`);
            if (oldSeqRow) {
              const s = oldSeqRow.querySelector(`[data-step-index="${prDragState.startStep}"]`);
              if (s) s.classList.remove('active');
            }
          }
          
          if (prDragState.type === 'move') {
             // Did they just click? (No movement)
             if (Math.abs(e.clientX - prDragState.startX) < 3 && Math.abs(e.clientY - prDragState.startY) < 3 && !prDragState.isClone && !prDragState.isNew) {
                // Click on existing note -> Delete
                prDragState.noteElement.remove();
                sequencer.removeNoteFromPattern(prDragState.trackId, prDragState.noteName, prDragState.startStep);
                // Sync Step Seq
                const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${prDragState.trackId}"][data-note="${prDragState.noteName}"]`);
                if (stepSeqRow) {
                  const s = stepSeqRow.querySelector(`[data-step-index="${prDragState.startStep}"]`);
                  if (s) s.classList.remove('active');
                }
             } else {
                // Drag move or new note placement
                sequencer.addNoteToPattern(prDragState.trackId, finalNoteName, finalStep, finalDur);
                engine.playNote(prDragState.trackId, finalNoteName, engine.ctx.currentTime, 0.2);
                // Sync Step Seq
                const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${prDragState.trackId}"][data-note="${finalNoteName}"]`);
                if (stepSeqRow) {
                  const s = stepSeqRow.querySelector(`[data-step-index="${finalStep}"]`);
                  if (s) s.classList.add('active');
                }
             }
          } else if (prDragState.type === 'resize' || prDragState.type === 'paint') {
             sequencer.removeNoteFromPattern(prDragState.trackId, prDragState.noteName, prDragState.startStep);
             sequencer.addNoteToPattern(prDragState.trackId, finalNoteName, finalStep, finalDur);
             // Sync Step Seq
             const stepSeqRow = document.querySelector(`.seq-steps[data-instrument="${prDragState.trackId}"][data-note="${finalNoteName}"]`);
             if (stepSeqRow) {
               const s = stepSeqRow.querySelector(`[data-step-index="${finalStep}"]`);
               if (s) s.classList.add('active');
             }
          }
          
          syncPatternClip(prDragState.trackId);
          prDragState = null;
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
      // snapInterval: 1=bar, 0.5=half, 0.25=quarter, 0.0625=1/16th
      const snapSteps = snapInterval * 16  // convert bar-fraction to steps
      const snapPixels = snapSteps * stepPx
      console.log('Snap pixels:', snapPixels); // use it

      grid.style.backgroundImage = `
        repeating-linear-gradient(90deg, transparent, transparent calc(${barPixels}px - 1px), rgba(255,255,255,0.15) calc(${barPixels}px - 1px), rgba(255,255,255,0.15) ${barPixels}px),
        repeating-linear-gradient(90deg, transparent, transparent calc(${beatPixels}px - 1px), rgba(255,255,255,0.08) calc(${beatPixels}px - 1px), rgba(255,255,255,0.08) ${beatPixels}px),
        repeating-linear-gradient(90deg, transparent, transparent calc(${stepPx}px - 1px), rgba(255,255,255,0.04) calc(${stepPx}px - 1px), rgba(255,255,255,0.04) ${stepPx}px)
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
          if (b !== 0) beatTick.style.borderLeft = '1px solid rgba(255,255,255,0.08)'
          beatsContainer.appendChild(beatTick)
        }
      }
    }
    
    // Call it initially
    drawPianoRollTimeline();

    // ── Piano Roll Zoom Controls ───────────────────────────────────
    document.getElementById('pr-zoom-in')?.addEventListener('click', () => applyPrZoom(prZoomFactor * 1.25))
    document.getElementById('pr-zoom-out')?.addEventListener('click', () => applyPrZoom(prZoomFactor / 1.25))
    document.getElementById('pr-zoom-reset')?.addEventListener('click', () => applyPrZoom(1.0))

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
        tracksData.push({
          id: trackId,
          name: h?.nameEl?.textContent || trackId,
          color: h?.colorPicker?.value || '#00e5ff',
          instrumentPath: engineTrack?._instrumentPath || null,
          instrumentRootMidi: engineTrack?.instrumentRootMidi ?? 60
        })
      })

      const clipsData = sequencer.clips.map(c => ({
        trackId: c.trackId,
        startTime: c.startTime,
        duration: c.duration,
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

      return JSON.stringify({
        version: 1,
        bpm: sequencer.bpm,
        timeSignature: sequencer.timeSignature,
        tracks: tracksData,
        clips: clipsData,
        patternClips: patternClipsData,
        patterns: patternsData
      }, null, 2)
    }

    async function doSave(path) {
      const data = serializeProject()
      const ok = await window.api.writeFile(path, data)
      if (ok) {
        currentProjectPath = path
        document.title = `Bounce — ${path.split(/[\\/]/).pop()}`
      } else {
        alert('Save failed.')
      }
    }

    document.getElementById('menu-save')?.addEventListener('click', async () => {
      if (currentProjectPath) {
        await doSave(currentProjectPath)
      } else {
        const path = await window.api.saveFile('Untitled.bounce')
        if (path) await doSave(path)
      }
    })

    document.getElementById('menu-saveas')?.addEventListener('click', async () => {
      const path = await window.api.saveFile(currentProjectPath || 'Untitled.bounce')
      if (path) await doSave(path)
    })

    document.getElementById('menu-open')?.addEventListener('click', async () => {
      const path = await window.api.openFile()
      if (!path) return
      try {
        const raw = await window.api.readFile(path)
        if (!raw) return
        const text = new TextDecoder().decode(raw)
        const data = JSON.parse(text)
        await loadProject(data)
        currentProjectPath = path
        document.title = `Bounce — ${path.split(/[\\/]/).pop()}`
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
            const buf = await window.api.readFile(c.filePath)
            if (!buf) continue
            const audioBuffer = await engine.decodeAudioData(buf.buffer)
            const lane = document.querySelector(`.track-lane[data-track-id="${c.trackId}"]`)
            if (!lane) continue
            const clipEl = document.createElement('div')
            clipEl.className = 'clip audio-clip'
            clipEl.style.left = `${c.startTime * sequencer.pxPerSecond}px`
            clipEl.style.width = `${Math.max(20, c.duration * sequencer.pxPerSecond)}px`
            clipEl.textContent = c.fileName
            clipEl.dataset.startTime = c.startTime
            clipEl.dataset.duration = c.duration
            const rh = document.createElement('div')
            rh.className = 'resize-handle'
            clipEl.appendChild(rh)
            lane.appendChild(clipEl)
            sequencer.addClip({ buffer: audioBuffer, startTime: c.startTime, duration: c.duration, trackId: c.trackId, scheduled: false, uiElement: clipEl, _filePath: c.filePath, _fileName: c.fileName })
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
  })
}

function buildPianoRoll() {
  const keysContainer = document.getElementById('piano-keys')
  const grid = document.getElementById('piano-grid')
  if (!keysContainer || !grid) return

  const KEY_HEIGHT = 22
  const NOTES_DESC = ['B','A#','A','G#','G','F#','F','E','D#','D','C#','C']
  const BLACK = new Set(['A#','C#','D#','F#','G#'])
  const OCTAVES = [6,5,4,3,2]

  keysContainer.innerHTML = ''
  grid.innerHTML = ''

  // Add a spacer to the keys container to align with the ruler
  const rulerHeight = document.getElementById('pr-ruler')?.offsetHeight || 32
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
      key.style.borderBottom = '1px solid rgba(255,255,255,0.1)'

      key.addEventListener('mousedown', () => {
        const currentTrackId = document.getElementById('pr-track-select')?.value || 'drums';
        engine.playNote(currentTrackId, fullName, engine.ctx.currentTime, 0.5);
      });

      const label = document.createElement('span')
      label.className = 'pr-key-label'
      label.textContent = note === 'C' ? fullName : note
      if (isBlack) label.style.color = '#888'
      key.appendChild(label)
      
      keysContainer.appendChild(key)

      // ── Grid row ─────────────────────────────────────────────────
      const row = document.createElement('div')
      row.className = `pr-row ${isBlack ? 'pr-row-black' : 'pr-row-white'}`
      row.style.height = `${KEY_HEIGHT}px`
      row.dataset.note = fullName
      row.style.borderBottom = '1px solid rgba(255,255,255,0.05)'
      grid.appendChild(row)
    })
  })

  grid.addEventListener('scroll', () => { keysContainer.scrollTop = grid.scrollTop })
  keysContainer.addEventListener('scroll', () => { grid.scrollTop = keysContainer.scrollTop })
}

init()
