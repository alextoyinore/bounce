import { engine } from './AudioEngine.js'
import { sequencer } from './Sequencer.js'

function init() {
  window.addEventListener('DOMContentLoaded', () => {
    console.log('Bounce DAW initialized')
    
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

    skipBackBtn?.addEventListener('click', () => {
      sequencer.stop()
      playBtn.innerHTML = playSvg
    })

    // Browser Logic
    const openFolderBtn = document.getElementById('open-folder-btn')
    const sampleList = document.getElementById('sample-list')
    
    const renderBrowserList = (files) => {
      sampleList.innerHTML = ''
      if (!files || files.length === 0) {
        sampleList.innerHTML = '<li class="browser-item empty-state" style="justify-content: center; opacity: 0.5; padding-top: 20px;">No audio files found</li>'
        return
      }
      const removeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"></path></svg>'
      files.forEach(file => {
        const li = document.createElement('li')
        li.className = 'browser-item'
        li.draggable = true
        li.innerHTML = `
          ${fileSvg}
          <span class="browser-item-name">${file.name}</span>
          <button class="browser-item-remove" title="Remove from list">${removeSvg}</button>
        `
        li.querySelector('.browser-item-remove').addEventListener('click', (e) => {
          e.stopPropagation()
          li.remove()
        })
        li.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify(file))
          e.dataTransfer.effectAllowed = 'copy'
        })
        sampleList.appendChild(li)
      })
    }

    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', async () => {
        const folderPath = await window.api.openFolder()
        if (folderPath) {
          const files = await window.api.readDirectory(folderPath)
          renderBrowserList(files)
        }
      })
    }

    // Auto-load default samples
    setTimeout(async () => {
      try {
        const defaultPath = window.location.href.includes('index.html') 
          ? window.location.pathname.replace('index.html', 'assets/audio')
          : '/home/lexxy/Documents/projects/bounce/src/renderer/assets/audio'
        const files = await window.api.readDirectory(defaultPath)
        if (files && files.length > 0) renderBrowserList(files)
      } catch (e) { console.warn("Could not auto-load samples", e) }
    }, 500)

    // Grid Snap
    const gridSnapSelect = document.getElementById('grid-snap-select')
    if (gridSnapSelect) {
      gridSnapSelect.addEventListener('change', (e) => {
        sequencer.setGridSnap(parseFloat(e.target.value))
        drawTimeline()
      })
    }

    function drawTimeline() {
      const ruler = document.querySelector('.timeline-ruler')
      const view = document.querySelector('.arrangement-view')
      if (!ruler || !view) return

      const beatsPerSecond = sequencer.bpm / 60
      const snapBeats = sequencer.gridSnapInBeats > 0 ? sequencer.gridSnapInBeats : 1
      const snapSeconds = snapBeats / beatsPerSecond
      const snapPixels = snapSeconds * sequencer.pxPerSecond

      // Set complex grid background on grid-container
      const gridContainer = document.querySelector('.grid-container')
      if (gridContainer) {
        const beatPixels = (1 / beatsPerSecond) * sequencer.pxPerSecond
        const barPixels = 4 * beatPixels
        const sixteenthPixels = beatPixels / 4
        
        gridContainer.style.backgroundImage = `
          repeating-linear-gradient(90deg, transparent, transparent calc(${barPixels}px - 1px), rgba(255,255,255,0.15) calc(${barPixels}px - 1px), rgba(255,255,255,0.15) ${barPixels}px),
          repeating-linear-gradient(90deg, transparent, transparent calc(${beatPixels}px - 1px), rgba(255,255,255,0.08) calc(${beatPixels}px - 1px), rgba(255,255,255,0.08) ${beatPixels}px),
          repeating-linear-gradient(90deg, transparent, transparent calc(${sixteenthPixels}px - 1px), rgba(255,255,255,0.03) calc(${sixteenthPixels}px - 1px), rgba(255,255,255,0.03) ${sixteenthPixels}px)
        `
      }

      const barSeconds = 4 / beatsPerSecond
      const barPixels = barSeconds * sequencer.pxPerSecond
      
      ruler.innerHTML = ''
      const numBars = Math.ceil(5000 / barPixels) // Arbitrary long timeline
      
      for(let i = 0; i < numBars; i++) {
        const span = document.createElement('span')
        span.textContent = i + 1
        span.style.width = `${barPixels}px`
        ruler.appendChild(span)
      }
    }

    // Drop Zone & Arrangement Logic
    const arrangementView = document.querySelector('.arrangement-view')
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
              const lanes = Array.from(document.querySelectorAll('.track-lane'))
              const laneIndex = lanes.indexOf(trackLane)
              const trackNames = ['drums', 'bass', 'synth']
              const trackId = trackNames[Math.min(laneIndex, trackNames.length - 1)]

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
              clip.textContent = fileInfo.name
              clip.dataset.startTime = timeInSeconds
              clip.dataset.duration = musicalDuration
              trackLane.appendChild(clip)
              
              // Auto-rename track if the track name isn't customized yet
              const trackHeader = document.querySelectorAll('.track-header')[laneIndex]
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
                uiElement: clip
              };
              sequencer.addClip(seqClip)
            }
          }
        } catch (err) {
          console.error('Error handling drop:', err)
        }
      })

      // Clip Dragging
      let draggingClip = null;
      let dragStartX = 0;
      let clipStartLeft = 0;

      arrangementView.addEventListener('mousedown', (e) => {
        const clip = e.target.closest('.clip');
        if (clip) {
          draggingClip = clip;
          dragStartX = e.clientX;
          clipStartLeft = parseFloat(clip.style.left) || 0;
          clip.classList.add('dragging');
        }
      });

      document.addEventListener('mousemove', (e) => {
        if (draggingClip) {
          const deltaX = e.clientX - dragStartX;
          let newLeft = Math.max(0, clipStartLeft + deltaX);
          
          const timeInSeconds = newLeft / sequencer.pxPerSecond;
          const snappedTime = sequencer.snapTimeToGrid(timeInSeconds);
          newLeft = snappedTime * sequencer.pxPerSecond;
          
          draggingClip.style.left = `${newLeft}px`;
        }
      });

      document.addEventListener('mouseup', (e) => {
        if (draggingClip) {
          draggingClip.classList.remove('dragging');
          
          const newLeft = parseFloat(draggingClip.style.left) || 0;
          const newStartTime = newLeft / sequencer.pxPerSecond;
          draggingClip.dataset.startTime = newStartTime;
          
          const seqClip = sequencer.clips.find(c => c.uiElement === draggingClip);
          if (seqClip) {
            seqClip.startTime = newStartTime;
            seqClip.scheduled = false; // reschedule
          }
          
          const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest('.track-lane');
          if (lane && lane !== draggingClip.parentElement) {
            lane.appendChild(draggingClip);
            const lanes = Array.from(document.querySelectorAll('.track-lane'));
            const laneIndex = lanes.indexOf(lane);
            const trackNames = ['drums', 'bass', 'synth'];
            const newTrackId = trackNames[Math.min(laneIndex, trackNames.length - 1)];
            
            if (seqClip) {
              seqClip.trackId = newTrackId;
            }
          }
          
          draggingClip = null;
        }
      });

      // Double-click to delete a clip
      arrangementView.addEventListener('dblclick', (e) => {
        const clip = e.target.closest('.clip')
        if (clip) {
          const seqClip = sequencer.clips.find(c => c.uiElement === clip)
          if (seqClip) sequencer.removeClip(seqClip)
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
      const seqStepsContainer = seqRow.querySelector('.seq-steps')
      for (let i = 0; i < stepCount; i++) {
        const step = document.createElement('div')
        step.className = 'seq-step'
        step.dataset.step = i
        seqStepsContainer.appendChild(step)
      }

      // Initial color trigger
      colorPicker.dispatchEvent(new Event('input'))
    }

    // Initialize Default Tracks
    createTrackUI('drums', 'Drums', '#00e5ff')
    createTrackUI('bass', 'Bass', '#ff33aa')
    createTrackUI('synth', 'Synth', '#ffaa00')

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
      bpmDisplay.contentEditable = 'true'
      bpmDisplay.spellcheck = false
      bpmDisplay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); bpmDisplay.blur() }
        if (!/[\d.]|Backspace|Delete|Arrow/.test(e.key) && e.key.length === 1) e.preventDefault()
      })
      bpmDisplay.addEventListener('focus', () => {
        const r = document.createRange(); r.selectNodeContents(bpmDisplay)
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
      })
      bpmDisplay.addEventListener('blur', () => {
        const v = parseFloat(bpmDisplay.textContent)
        if (v > 0 && v <= 999) { sequencer.bpm = v; bpmDisplay.textContent = v.toFixed(1); drawTimeline() }
        else bpmDisplay.textContent = sequencer.bpm.toFixed(1)
      })
    }

    // ── Editable Time Signature ───────────────────────────────────
    const timeSigDisplay = document.getElementById('time-sig-display')
    if (timeSigDisplay) {
      timeSigDisplay.contentEditable = 'true'
      timeSigDisplay.spellcheck = false
      timeSigDisplay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); timeSigDisplay.blur() }
      })
      timeSigDisplay.addEventListener('blur', () => {
        const parts = timeSigDisplay.textContent.trim().split('/')
        const num = parseInt(parts[0]), den = parseInt(parts[1])
        if (num > 0 && den > 0) {
          sequencer.timeSignature = { numerator: num, denominator: den }
          timeSigDisplay.textContent = `${num}/${den}`
          drawTimeline()
        } else timeSigDisplay.textContent = `${sequencer.timeSignature?.numerator || 4}/${sequencer.timeSignature?.denominator || 4}`
      })
    }

    // ── Step Count + Step Sequencer Init ─────────────────────────
    const PR_STEP_PX = 32

    function buildStepRows(count) {
      document.querySelectorAll('.seq-steps').forEach(container => {
        const note = container.dataset.note || null
        container.innerHTML = ''
        for (let i = 0; i < count; i++) {
          const step = document.createElement('div')
          step.className = 'seq-step'
          step.dataset.stepIndex = i
          step.addEventListener('click', () => {
            step.classList.toggle('active')
            // Sync to piano roll
            if (note) syncStepToPianoRoll(note, i, step.classList.contains('active'))
          })
          container.appendChild(step)
        }
      })
      // Update piano grid column lines
      document.getElementById('piano-grid')?.style.setProperty('--pr-step-px', `${PR_STEP_PX}px`)
    }

    function syncStepToPianoRoll(noteName, stepIndex, active) {
      const grid = document.getElementById('piano-grid')
      if (!grid) return
      const row = grid.querySelector(`[data-note="${noteName}"]`)
      if (!row) return
      const existing = row.querySelector(`[data-step="${stepIndex}"]`)
      if (active && !existing) {
        const n = document.createElement('div')
        n.className = 'pr-note'
        n.dataset.step = stepIndex
        n.style.left = `${stepIndex * PR_STEP_PX + 1}px`
        n.style.width = `${PR_STEP_PX - 3}px`
        n.addEventListener('click', (e) => { e.stopPropagation(); n.remove() })
        row.appendChild(n)
      } else if (!active && existing) {
        existing.remove()
      }
    }

    buildStepRows(16)

    document.getElementById('step-count-select')?.addEventListener('change', (e) => {
      buildStepRows(parseInt(e.target.value))
    })

    // ── Piano Roll click-to-create notes ─────────────────────────
    const pianoGrid = document.getElementById('piano-grid')
    const prTrackSelect = document.getElementById('pr-track-select')
    
    if (pianoGrid) {
      pianoGrid.addEventListener('click', (e) => {
        if (e.target.classList.contains('pr-note')) return
        const row = e.target.closest('.pr-row')
        if (!row) return
        const gridRect = pianoGrid.getBoundingClientRect()
        const x = e.clientX - gridRect.left + pianoGrid.scrollLeft
        const stepIndex = Math.floor(x / PR_STEP_PX)
        const existing = row.querySelector(`[data-step="${stepIndex}"]`)
        if (existing) { existing.remove(); return }
        
        const note = document.createElement('div')
        note.className = 'pr-note'
        note.dataset.step = stepIndex
        note.style.left = `${stepIndex * PR_STEP_PX + 1}px`
        note.style.width = `${PR_STEP_PX - 3}px`
        
        // Grab color from currently selected track
        const currentTrackId = prTrackSelect ? prTrackSelect.value : 'drums'
        const map = trackUIMap[currentTrackId]
        if (map && map.headers[0]) {
          const color = map.headers[0].laneEl.style.getPropertyValue('--track-color')
          if (color) note.style.background = color
        }
        
        note.addEventListener('click', (ev) => { ev.stopPropagation(); note.remove() })
        row.appendChild(note)
      })
    }

    // ── Build Piano Roll ──────────────────────────────────────────
    buildPianoRoll(PR_STEP_PX)

    // ── Footer collapse ───────────────────────────────────────────
    document.getElementById('footer-collapse-btn')?.addEventListener('click', () => {
      document.getElementById('app').classList.toggle('footer-collapsed')
    })
  })
}

function buildPianoRoll(PR_STEP_PX = 32) {
  const keysContainer = document.getElementById('piano-keys')
  const grid = document.getElementById('piano-grid')
  if (!keysContainer || !grid) return

  const KEY_HEIGHT = 14
  const NOTES_DESC = ['B','A#','A','G#','G','F#','F','E','D#','D','C#','C']
  const BLACK = new Set(['A#','C#','D#','F#','G#'])
  const OCTAVES = [6,5,4,3,2]

  keysContainer.innerHTML = ''
  grid.innerHTML = ''
  grid.style.setProperty('--pr-step-px', `${PR_STEP_PX}px`)

  OCTAVES.forEach(oct => {
    NOTES_DESC.forEach(note => {
      const isBlack = BLACK.has(note)
      const fullName = `${note}${oct}`

      const key = document.createElement('div')
      key.className = `pr-key ${isBlack ? 'pr-black' : 'pr-white'}`
      key.style.height = `${KEY_HEIGHT}px`
      if (!isBlack) {
        const label = document.createElement('span')
        label.className = 'pr-key-label'
        label.textContent = note === 'C' ? fullName : note
        key.appendChild(label)
      }
      keysContainer.appendChild(key)

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
