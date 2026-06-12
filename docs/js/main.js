/**
 * main.js — Entry point, boot sequence, animation loop
 *
 * Run: cd game/src && python3 -m http.server 8080
 * Open: http://localhost:8080
 *
 * URL params:
 *   ?data=path/to/file.jsonl   — load alternate attack data
 *   ?layout=path/to/layout.json — load alternate network layout
 */
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import { createScene, createSubnetZones } from './scene.js';
import { createMachines, createConnections, createAmbientProps, createBannerFlags, plantSkullFlag } from './network.js';
import { CameraController } from './camera.js';
import { Timeline } from './timeline.js';
import { HUD } from './hud.js';
import { RadarScan, WalkingAttacker, ArtilleryBarrage, BreachExplosion, DataStream, GoalGlow, createGarrison, createDustParticles } from './effects.js';
import { loadAttackData, loadNetworkLayout } from './loader.js';
import { initAudio as initAudioCtx, startMusic, playWhoosh, playExplosion, playDataCapture, playAlarm, playVictory, toggleMute } from './audio.js';
import { Deliberation } from './deliberation.js';

// --- State ---
let scene, renderer, camera, cssRenderer;
let machineMap = {};
let timeline, hud;
let activeEffects = [];
let dust;
let attackData;
let deliberation;
const clock = new THREE.Clock();

// --- Simulation clock ---
// Maps steps to simulated "night ops" time (02:00 → ~04:00)
const SIM_TIME_START = 2 * 60; // 02:00 in minutes
const SIM_TIME_PER_STEP = 18;  // ~18 minutes per step
let simTimeMinutes = SIM_TIME_START;
let simTimeTarget = SIM_TIME_START;

// --- Auto-cam state ---
let autoCamEnabled = true;

// --- Speed cycling ---
const SPEED_OPTIONS = [0.5, 1, 2, 4];
let speedIndex = 1; // start at 1x

// --- URL parameter helper ---
function getParam(name, fallback) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name) || fallback;
}

// --- Format simulation time ---
function formatSimTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = Math.floor(totalMinutes % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function updateClockDisplay() {
  const el = document.getElementById('clock-time');
  if (el) el.textContent = formatSimTime(simTimeMinutes);
}

// --- Boot ---
async function boot() {
  const container = document.getElementById('canvas-container');

  // Load data (support URL params for switching demo data)
  const dataPath = getParam('data', 'data/attack-data.json');
  const layoutPath = getParam('layout', 'data/network-layout.json');

  const [loadedAttack, networkLayout] = await Promise.all([
    loadAttackData(dataPath),
    loadNetworkLayout(layoutPath),
  ]);
  attackData = loadedAttack;

  // Scene
  const sceneResult = createScene(container);
  scene = sceneResult.scene;
  renderer = sceneResult.renderer;

  // CSS2D renderer for labels
  cssRenderer = new CSS2DRenderer();
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.domElement.style.position = 'absolute';
  cssRenderer.domElement.style.top = '0';
  cssRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(cssRenderer.domElement);

  window.addEventListener('resize', () => {
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Camera
  camera = new CameraController(renderer);

  // Build network
  createSubnetZones(scene, networkLayout.subnets);
  machineMap = createMachines(scene, networkLayout.machines);
  createConnections(scene, networkLayout.connections, machineMap);
  // ambient props removed for performance
  createBannerFlags(scene, networkLayout.subnets, networkLayout.banners || []);

  // Subnet labels (3D floating text via CSS2D)
  for (const sub of networkLayout.subnets) {
    const div = document.createElement('div');
    div.className = 'subnet-label';
    div.textContent = sub.name;
    const labelObj = new CSS2DObject(div);
    labelObj.position.set(sub.position.x, 0.5, sub.position.z);
    scene.add(labelObj);
  }

  // Garrison troops around each machine (blue = defenders)
  for (const name in machineMap) {
    const m = machineMap[name];
    const count = m.dims.w > 3 ? 10 : (m.group.userData.type === 'server' ? 6 : 4);
    const garrison = createGarrison(scene, m.group.position, 0x2244aa, count);
    m.garrison = garrison;
  }

  // (dust particles removed for performance)

  // HUD
  hud = new HUD(networkLayout);

  // Deliberation reel
  deliberation = new Deliberation();

  // Initial state
  hud.updatePosition(attackData.entry.machine, attackData.entry.account);
  hud.addCredential(attackData.entry.account, 'ntlm_hash', attackData.entry.machine);

  // Entry machine starts compromised — RED building + skull flag + red garrison
  const entryMachine = machineMap[attackData.entry.machine];
  if (entryMachine) {
    compromiseMachine(entryMachine, attackData.entry.machine, false);
    animateFlag(entryMachine);
    if (entryMachine.garrison) {
      entryMachine.garrison.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: 0xcc2222, emissive: 0x661111, emissiveIntensity: 0.4, roughness: 0.7,
          });
        }
      });
    }
  }

  // Timeline
  timeline = new Timeline(
    attackData.steps,
    (step, idx) => onStepStart(step, idx),
    (step, idx) => onStepComplete(step, idx),
    (idx) => replayCompromisesUpTo(idx)
  );

  // --- Wire up styled control buttons ---
  initControlButtons();

  // Sound system — only start on user interaction (browser autoplay policy)
  const startAudioOnce = () => {
    initAudioCtx();
    startMusic();
    document.removeEventListener('click', startAudioOnce);
    document.removeEventListener('keydown', startAudioOnce);
  };
  document.addEventListener('click', startAudioOnce);
  document.addEventListener('keydown', startAudioOnce);

  // M key = mute toggle
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      const isMuted = toggleMute();
      updateSoundButton(isMuted);
    }
  });

  // Init clock display
  updateClockDisplay();

  // Hide loading
  document.getElementById('loading').style.display = 'none';

  // Show entry page (loading is done, entry page is on top)
  // The entry page is already visible in HTML

  // Opening cinematic: wide orbit around the entire battlefield
  camera.cinematicMoveAndOrbit(
    { x: -50, y: 45, z: 50 },
    { x: 5, y: 0, z: -5 },
    2.5,
    0.12 // slow orbit speed
  );

  // Start loop
  animate();
}

// --- Entry page handler ---
document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('btn-start');
  const entryPage = document.getElementById('entry-page');
  if (startBtn && entryPage) {
    startBtn.addEventListener('click', () => {
      entryPage.style.transition = 'opacity 0.8s ease-out';
      entryPage.style.opacity = '0';
      setTimeout(() => {
        entryPage.style.display = 'none';
      }, 800);
      // Trigger audio on entry click
      initAudioCtx();
      startMusic();
    });
  }

  // Help overlay
  const helpBtn = document.getElementById('ctrl-help');
  const helpOverlay = document.getElementById('help-overlay');
  const helpClose = document.getElementById('help-close');
  if (helpBtn && helpOverlay) {
    helpBtn.addEventListener('click', () => {
      helpOverlay.classList.toggle('visible');
    });
  }
  if (helpClose && helpOverlay) {
    helpClose.addEventListener('click', () => {
      helpOverlay.classList.remove('visible');
    });
  }
});

// --- Control buttons ---
function initControlButtons() {
  // Play/Pause
  const playBtn = document.getElementById('ctrl-play');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      timeline.togglePlay();
      updatePlayButton();
    });
  }

  // Speed cycle
  const speedBtn = document.getElementById('ctrl-speed');
  if (speedBtn) {
    speedBtn.addEventListener('click', () => {
      speedIndex = (speedIndex + 1) % SPEED_OPTIONS.length;
      const speed = SPEED_OPTIONS[speedIndex];
      timeline.speed = speed;
      const icon = speedBtn.querySelector('.ctrl-icon');
      if (icon) icon.textContent = speed + '\u00d7';
    });
  }

  // Auto-cam toggle
  const camBtn = document.getElementById('ctrl-camera');
  if (camBtn) {
    camBtn.classList.add('active'); // starts enabled
    camBtn.addEventListener('click', () => {
      autoCamEnabled = !autoCamEnabled;
      camBtn.classList.toggle('active', autoCamEnabled);
      if (!autoCamEnabled) {
        camera.stopOrbit();
        camera.mode = 'free';
      } else {
        camera.mode = 'cinema';
        // Re-enter orbit on current scene
        camera.cinematicMoveAndOrbit(
          { x: camera.camera.position.x, y: camera.camera.position.y, z: camera.camera.position.z },
          { x: camera.controls.target.x, y: camera.controls.target.y, z: camera.controls.target.z },
          1.0,
          0.12
        );
      }
    });
  }

  // Sound toggle
  const soundBtn = document.getElementById('ctrl-sound');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      const isMuted = toggleMute();
      updateSoundButton(isMuted);
    });
  }
}

function updatePlayButton() {
  const btn = document.getElementById('ctrl-play');
  if (!btn) return;
  const icon = btn.querySelector('.ctrl-icon');
  const label = btn.querySelector('.ctrl-label');
  if (timeline.playing) {
    if (icon) icon.innerHTML = '&#10074;&#10074;';
    if (label) label.textContent = 'Pause';
  } else {
    if (icon) icon.innerHTML = '&#9654;';
    if (label) label.textContent = 'Play';
  }
}

function updateSoundButton(isMuted) {
  const btn = document.getElementById('ctrl-sound');
  if (!btn) return;
  const icon = btn.querySelector('.ctrl-icon');
  if (icon) icon.textContent = isMuted ? '\u{1F507}' : '\u266A';
  btn.classList.toggle('active', !isMuted);
}

// --- Track attacker's current position ---
let currentMachine = null;

/**
 * When user jumps to a step, instantly replay all compromises
 * from step 0..idx-1 so flags + red tint are correct.
 */
function replayCompromisesUpTo(idx) {
  // Entry machine is always compromised
  const entryM = machineMap[attackData.entry.machine];
  if (entryM) {
    compromiseMachine(entryM, attackData.entry.machine);
  }

  for (let i = 0; i < idx; i++) {
    const s = attackData.steps[i];
    if (s.tactic === 'Lateral Movement' && s.result === 'success') {
      const tgt = machineMap[s.target_machine];
      if (tgt) {
        compromiseMachine(tgt, s.target_machine);
        // Garrison → red
        if (tgt.garrison) {
          tgt.garrison.traverse((child) => {
            if (child.isMesh) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xcc2222, emissive: 0x661111, emissiveIntensity: 0.4, roughness: 0.7,
              });
            }
          });
        }
      }
    }
    if (s.credential_captured) {
      hud.addCredential(
        s.credential_captured.account,
        s.credential_captured.type,
        s.target_machine
      );
    }
  }

  // Update sim time for jumped-to step
  simTimeMinutes = SIM_TIME_START + idx * SIM_TIME_PER_STEP;
  simTimeTarget = simTimeMinutes;
  updateClockDisplay();
}

/** Mark a machine as compromised — turns building bright RED */
function compromiseMachine(machineObj, machineName, instant = true) {
  machineObj.mesh.material.color = new THREE.Color(0xdd2222);
  machineObj.mesh.material.emissive = new THREE.Color(0xff3333);
  machineObj.mesh.material.emissiveIntensity = 0.8;
  machineObj.label.classList.add('compromised');
  plantSkullFlag(machineObj, instant);
  hud.markCompromised(machineName);
}

// --- Step callbacks ---
function onStepStart(step, idx) {
  // Pause timeline while deliberation plays
  timeline.deliberationPaused = true;

  // Run deliberation reel, then execute the actual step
  deliberation.show(step).then(() => {
    timeline.deliberationPaused = false;
    executeStep(step, idx);
  });
}

function executeStep(step, idx) {
  // Update HUD (after deliberation reveals the TTP)
  hud.updateMitre(step.ttp_id, step.tactic);
  hud.updateDetection(step.detection);
  hud.showNarration(idx, step.tactic, step.narration);

  // Show detail panel with red-team prompt, conditions, blue-team response
  hud.showDetailPanel(step, idx);

  // Update play button state
  updatePlayButton();

  // Advance simulation clock
  simTimeTarget = SIM_TIME_START + (idx + 1) * SIM_TIME_PER_STEP;

  // Camera — cinematic move then orbit around the action (only if auto-cam is on)
  if (autoCamEnabled) {
    const kf = camera.getStepKeyframes(step, machineMap);
    if (kf) {
      if (kf.orbit) {
        camera.cinematicMoveAndOrbit(kf.position, kf.lookAt, kf.duration, kf.orbitSpeed);
      } else {
        camera.cinematicMoveTo(kf.position, kf.lookAt, kf.duration);
      }
    }
  }

  if (step.tactic === 'Lateral Movement') {
    const src = machineMap[step.source_machine];
    const tgt = machineMap[step.target_machine];
    if (src && tgt) {
      // Radar scan at source first, then ninja moves
      const radar = new RadarScan(scene, src.group.position, () => {
        playWhoosh();

        // Artillery barrage
        const barrage = new ArtilleryBarrage(scene, src.group.position, tgt.group.position);
        activeEffects.push(barrage);

        // Ninja infiltrator
        const walker = new WalkingAttacker(
          scene,
          src.group.position,
          tgt.group.position,
          step.account_used,
          () => {
            // Arrival effects
            playExplosion();
            const explosion = new BreachExplosion(scene, tgt.group.position.clone());
            activeEffects.push(explosion);

            // Turn building RED + plant skull flag (with animation)
            compromiseMachine(tgt, step.target_machine, false);
            animateFlag(tgt);

            // Turn garrison troops RED
            if (tgt.garrison) {
              tgt.garrison.traverse((child) => {
                if (child.isMesh) {
                  child.material = new THREE.MeshStandardMaterial({
                    color: 0xcc2222,
                    emissive: 0x661111,
                    emissiveIntensity: 0.4,
                    roughness: 0.7,
                  });
                }
              });
            }

            // Update position
            currentMachine = step.target_machine;
            hud.updatePosition(step.target_machine, step.account_used);

            // Screen shake + alarm for DC
            if (tgt.group.userData.type === 'dc') {
              camera.triggerShake(1.0, 0.8);
              playAlarm();
            }
          }
        );
        activeEffects.push(walker);
      });
      activeEffects.push(radar);
    }
  }

  if (step.tactic === 'Credential Access') {
    const tgt = machineMap[step.target_machine];
    if (tgt) {
      // Radar scan first (recon), then extract
      const radar = new RadarScan(scene, tgt.group.position, () => {
        playDataCapture();
        const stream = new DataStream(scene, tgt.group.position.clone());
        activeEffects.push(stream);

        // Turn building RED — credential stolen means machine is compromised
        compromiseMachine(tgt, step.target_machine, false);
        animateFlag(tgt);
        if (tgt.garrison) {
          tgt.garrison.traverse((child) => {
            if (child.isMesh) {
              child.material = new THREE.MeshStandardMaterial({
                color: 0xcc2222, emissive: 0x661111, emissiveIntensity: 0.4, roughness: 0.7,
              });
            }
          });
        }

        if (step.credential_captured) {
          setTimeout(() => {
            hud.addCredential(
              step.credential_captured.account,
              step.credential_captured.type,
              step.target_machine
            );
          }, 800);
        }
      });
      activeEffects.push(radar);
    }
  }

  // Goal achieved?
  if (step.goal_achieved) {
    setTimeout(() => {
      playVictory();
      const dcMachine = machineMap[attackData.goal.machine];
      if (dcMachine) {
        const glow = new GoalGlow(scene, dcMachine.group.position.clone());
        activeEffects.push(glow);
      }
      if (autoCamEnabled) {
        camera.pullBackOrbital();
      }
      hud.showVictory(attackData.goal.account);

      // Pulse all compromised machines with bright red glow
      for (const name of hud.compromisedMachines) {
        const m = machineMap[name];
        if (m) {
          m.mesh.material.emissiveIntensity = 1.0;
        }
      }
    }, 2500);
  }
}

function onStepComplete(_step, _idx) {
  // Narration stays visible until next step starts
}

// --- Flag rise animation (uses performance.now to avoid clock conflicts) ---
function animateFlag(machineObj) {
  const skullFlag = machineObj.group.userData.skullFlag;
  if (!skullFlag) return;

  const startTime = performance.now();
  const duration = 800; // ms

  function rise() {
    const t = Math.min((performance.now() - startTime) / duration, 1);
    skullFlag.scale.y = easeOutBack(t);
    if (t < 1) requestAnimationFrame(rise);
  }
  rise();
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// --- Wave flags (throttled) ---
function updateFlags(time) {
  for (const name in machineMap) {
    const g = machineMap[name].group;
    const flagGroups = [g.userData.defenderFlag, g.userData.skullFlag];
    for (const fg of flagGroups) {
      if (!fg || !fg.visible) continue;
      const cloth = fg.userData.cloth;
      if (!cloth || !cloth.geometry) continue;
      const pos = cloth.geometry.attributes.position;
      if (!pos || !cloth.geometry.userData.origPositions) {
        // Store original positions on first run
        cloth.geometry.userData.origPositions = new Float32Array(pos.array);
      }
      const orig = cloth.geometry.userData.origPositions;
      for (let i = 0; i < pos.count; i++) {
        const ox = orig[i * 3];
        // Wave based on x offset from center
        pos.array[i * 3 + 2] = Math.sin(time * 4 + ox * 3) * 0.08;
      }
      pos.needsUpdate = true;
    }
  }
}

// --- Animation loop ---
function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();
  const time = clock.getElapsedTime();

  // Update systems
  camera.update(dt);
  timeline.update(dt);

  // Smoothly interpolate simulation clock
  if (simTimeMinutes < simTimeTarget) {
    simTimeMinutes += dt * 2; // advance ~2 minutes per real second
    if (simTimeMinutes >= simTimeTarget) simTimeMinutes = simTimeTarget;
    updateClockDisplay();
  }

  // Update active effects
  activeEffects = activeEffects.filter(fx => {
    fx.update(dt);
    return !fx.done;
  });

  // Visuals (throttled — every 4th frame)
  if (Math.floor(time * 15) % 4 === 0) {
    updateFlags(time);
  }

  // Render
  renderer.render(scene, camera.camera);
  cssRenderer.render(scene, camera.camera);
}

// --- Go ---
boot().catch(err => {
  console.error('Boot failed:', err);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.innerHTML = `<div style="color:#ff4444">ERROR: ${err.message}</div>
      <div class="subtitle">Check console for details. Ensure you're running via HTTP server, not file://</div>`;
  }
});
