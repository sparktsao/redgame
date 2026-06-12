/**
 * audio.js — Cinematic procedural audio
 * Soft ambient pad + filtered effects. Web Audio API only, no external files.
 */

let audioCtx = null;
let masterGain = null;
let musicGain = null;
let musicPlaying = false;
let muted = false;
let reverbNode = null;

export function initAudio() {
  if (audioCtx) {
    // Already created — just resume (handles browser autoplay suspension)
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.5;
  masterGain.connect(audioCtx.destination);

  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.18;
  musicGain.connect(masterGain);

  // Simple reverb via delays
  reverbNode = createReverb();
  reverbNode.connect(masterGain);
}

/** Create a simple feedback-delay reverb */
function createReverb() {
  const dry = audioCtx.createGain();
  dry.gain.value = 1.0;

  const wet = audioCtx.createGain();
  wet.gain.value = 0.3;

  const delays = [0.05, 0.12, 0.22, 0.35];
  const gains  = [0.4,  0.3,  0.2,  0.12];

  const merger = audioCtx.createGain();
  merger.gain.value = 1;

  for (let i = 0; i < delays.length; i++) {
    const d = audioCtx.createDelay(1.0);
    d.delayTime.value = delays[i];
    const g = audioCtx.createGain();
    g.gain.value = gains[i];
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    dry.connect(d);
    d.connect(lp);
    lp.connect(g);
    g.connect(merger);
  }

  const output = audioCtx.createGain();
  output.gain.value = 1;
  dry.connect(output);       // dry pass-through
  merger.connect(wet);
  wet.connect(output);

  // Expose input as dry node
  output._input = dry;
  return output;
}

function connectToReverb(node) {
  if (reverbNode && reverbNode._input) {
    node.connect(reverbNode._input);
  } else {
    node.connect(masterGain);
  }
}

export function toggleMute() {
  muted = !muted;
  if (masterGain) masterGain.gain.value = muted ? 0 : 0.5;
  if (drumGain) drumGain.gain.value = muted ? 0 : 0.4;
  return muted;
}

/**
 * Ambient music — warm, non-harsh cinematic pad
 */
export function startMusic() {
  if (!audioCtx || musicPlaying) return;
  musicPlaying = true;

  // Warm sine pad — C2 (65Hz)
  const pad1 = audioCtx.createOscillator();
  pad1.type = 'sine';
  pad1.frequency.value = 65.4;
  const pad1Gain = audioCtx.createGain();
  pad1Gain.gain.value = 0.12;
  pad1.connect(pad1Gain);
  pad1Gain.connect(musicGain);
  pad1.start();

  // Gentle fifth — G2 (98Hz)
  const pad2 = audioCtx.createOscillator();
  pad2.type = 'sine';
  pad2.frequency.value = 98;
  const pad2Gain = audioCtx.createGain();
  pad2Gain.gain.value = 0.07;
  pad2.connect(pad2Gain);
  pad2Gain.connect(musicGain);
  pad2.start();

  // Very soft octave — C3 (130.8Hz)
  const pad3 = audioCtx.createOscillator();
  pad3.type = 'triangle';
  pad3.frequency.value = 130.8;
  const pad3Filter = audioCtx.createBiquadFilter();
  pad3Filter.type = 'lowpass';
  pad3Filter.frequency.value = 300;
  pad3Filter.Q.value = 1;
  const pad3Gain = audioCtx.createGain();
  pad3Gain.gain.value = 0.04;
  pad3.connect(pad3Filter);
  pad3Filter.connect(pad3Gain);
  pad3Gain.connect(musicGain);
  pad3.start();

  // Slow gentle LFO for warmth (modulates pad filter)
  const lfo = audioCtx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.06;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 15;
  lfo.connect(lfoGain);
  lfoGain.connect(pad3Filter.frequency);
  lfo.start();

  // Very subtle high shimmer — filtered triangle
  const shimmer = audioCtx.createOscillator();
  shimmer.type = 'triangle';
  shimmer.frequency.value = 330; // E4
  const shimmerFilter = audioCtx.createBiquadFilter();
  shimmerFilter.type = 'lowpass';
  shimmerFilter.frequency.value = 500;
  shimmerFilter.Q.value = 0.5;
  const shimmerGain = audioCtx.createGain();
  shimmerGain.gain.value = 0.012;
  shimmer.connect(shimmerFilter);
  shimmerFilter.connect(shimmerGain);
  shimmerGain.connect(musicGain);
  shimmer.start();

  // Gentle drift on shimmer
  const lfo2 = audioCtx.createOscillator();
  lfo2.type = 'sine';
  lfo2.frequency.value = 0.04;
  const lfo2Gain = audioCtx.createGain();
  lfo2Gain.gain.value = 20;
  lfo2.connect(lfo2Gain);
  lfo2Gain.connect(shimmer.frequency);
  lfo2.start();

  // Soft breath pulse — very subtle
  scheduleBreath();

  // War drums — taiko pattern
  scheduleDrumLoop();
}

/**
 * War drum loop — plays sound/single.mp3 on a taiko rhythm pattern
 */
let drumBuffer = null;
let drumGain = null;

async function loadDrumSample() {
  if (!audioCtx || drumBuffer) return;
  try {
    const resp = await fetch('sound/single.mp3');
    const arrayBuf = await resp.arrayBuffer();
    drumBuffer = await audioCtx.decodeAudioData(arrayBuf);
  } catch (e) {
    console.warn('Could not load drum sample:', e);
  }
}

function scheduleDrumLoop() {
  if (!audioCtx || !musicPlaying) return;

  if (!drumGain) {
    drumGain = audioCtx.createGain();
    drumGain.gain.value = 0.4;
    drumGain.connect(masterGain); // bypass musicGain for louder drums
  }

  loadDrumSample().then(() => {
    if (!drumBuffer) return;
    _drumCycle();
  });
}

function _drumCycle() {
  if (!audioCtx || !musicPlaying || !drumBuffer) return;

  // Taiko pattern within a 4-second cycle:
  // DON . . DON . . don-DON . DON . . . .
  const pattern = [
    { t: 0.0, vol: 1.0,  rate: 1.0  },  // DON (strong)
    { t: 0.8, vol: 0.7,  rate: 1.05 },  // DON (medium, slightly higher)
    { t: 1.6, vol: 0.9,  rate: 1.0  },  // DON (strong)
    { t: 2.2, vol: 0.5,  rate: 1.1  },  // don (lighter, higher)
    { t: 2.5, vol: 1.0,  rate: 0.9  },  // DON (heavy accent, lower)
    { t: 3.2, vol: 0.45, rate: 1.05 },  // don (soft fill)
  ];

  const now = audioCtx.currentTime;
  for (const hit of pattern) {
    const src = audioCtx.createBufferSource();
    src.buffer = drumBuffer;
    src.playbackRate.value = hit.rate;

    const g = audioCtx.createGain();
    g.gain.value = hit.vol;

    src.connect(g);
    g.connect(drumGain);
    src.start(now + hit.t);
  }

  setTimeout(_drumCycle, 4000);
}

function scheduleBreath() {
  if (!audioCtx || !musicPlaying) return;

  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 55;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 120;
  const env = audioCtx.createGain();
  env.gain.setValueAtTime(0, audioCtx.currentTime);
  env.gain.linearRampToValueAtTime(0.06, audioCtx.currentTime + 0.4);
  env.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 2.5);
  osc.connect(filter);
  filter.connect(env);
  env.connect(musicGain);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 2.5);

  setTimeout(scheduleBreath, 4000);
}

/**
 * Sound effects — all filtered and soft
 */

// Lateral movement — soft whoosh (filtered noise)
export function playWhoosh() {
  if (!audioCtx) return;
  const bufferSize = audioCtx.sampleRate * 0.6;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2;
  bp.frequency.setValueAtTime(300, audioCtx.currentTime);
  bp.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.2);
  bp.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.6);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.05);
  gain.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);

  noise.connect(bp);
  bp.connect(gain);
  connectToReverb(gain);
  noise.start();
  noise.stop(audioCtx.currentTime + 0.6);
}

// Breach — deep cinematic impact
export function playExplosion() {
  if (!audioCtx) return;

  // Sub impact
  const sub = audioCtx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(60, audioCtx.currentTime);
  sub.frequency.exponentialRampToValueAtTime(25, audioCtx.currentTime + 0.8);
  const subGain = audioCtx.createGain();
  subGain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  subGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
  sub.connect(subGain);
  connectToReverb(subGain);
  sub.start();
  sub.stop(audioCtx.currentTime + 0.8);

  // Filtered noise layer (soft crunch, not harsh)
  const bufLen = audioCtx.sampleRate * 0.4;
  const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.08));
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 200;
  const nGain = audioCtx.createGain();
  nGain.gain.value = 0.15;
  noise.connect(lp);
  lp.connect(nGain);
  connectToReverb(nGain);
  noise.start();
}

// Credential capture — soft ascending tones (triangle, not harsh sine)
export function playDataCapture() {
  if (!audioCtx) return;
  const times = [0, 0.12, 0.24, 0.36];
  const freqs = [440, 523, 659, 784]; // A4 C5 E5 G5 — major arpeggio
  times.forEach((t, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freqs[i];
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    const gain = audioCtx.createGain();
    const start = audioCtx.currentTime + t;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.06, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
    osc.connect(filter);
    filter.connect(gain);
    connectToReverb(gain);
    osc.start(start);
    osc.stop(start + 0.25);
  });
}

// DC breach alarm — deeper, less harsh warning tone
export function playAlarm() {
  if (!audioCtx) return;
  for (let i = 0; i < 3; i++) {
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 440; // A4 instead of harsh 880
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    const gain = audioCtx.createGain();
    const t = audioCtx.currentTime + i * 0.5;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.03);
    gain.gain.setValueAtTime(0.1, t + 0.2);
    gain.gain.linearRampToValueAtTime(0, t + 0.3);
    osc.connect(filter);
    filter.connect(gain);
    connectToReverb(gain);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}

// Deliberation reel — soft tick (short blip)
export function playReelTick() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1200;
  const gain = audioCtx.createGain();
  const t = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.04, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.04);
}

// Deliberation reel — lock confirmation (deeper tone + click)
export function playReelLock() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 600;
  const gain = audioCtx.createGain();
  const t = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc.connect(gain);
  connectToReverb(gain);
  osc.start(t);
  osc.stop(t + 0.25);
  // Click layer
  const click = audioCtx.createOscillator();
  click.type = 'square';
  click.frequency.value = 2400;
  const cGain = audioCtx.createGain();
  cGain.gain.setValueAtTime(0.06, t);
  cGain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  click.connect(cGain);
  cGain.connect(masterGain);
  click.start(t);
  click.stop(t + 0.02);
}

// Victory — warm major chord arpeggio with sustain
export function playVictory() {
  if (!audioCtx) return;
  const notes = [262, 330, 392, 523]; // C4 E4 G4 C5
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3000;
    const gain = audioCtx.createGain();
    const t = audioCtx.currentTime + i * 0.25;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.05);
    gain.gain.linearRampToValueAtTime(0.06, t + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    osc.connect(filter);
    filter.connect(gain);
    connectToReverb(gain);
    osc.start(t);
    osc.stop(t + 1.5);
  });
}
