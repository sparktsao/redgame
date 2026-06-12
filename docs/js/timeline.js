/**
 * timeline.js — Playback engine, scrubber UI, step sequencer
 * Waits for SPACE key between steps.
 */

export class Timeline {
  constructor(steps, onStepStart, onStepComplete, onJump) {
    this.steps = steps;
    this.currentStep = -1;
    this.playing = false;
    this.speed = 1;
    this.stepDuration = 5; // seconds for effects to play out
    this.elapsed = 0;
    this.waitingForSpace = false; // true = step done, waiting for user
    this.deliberationPaused = false; // true = deliberation overlay is showing
    this.onStepStart = onStepStart;
    this.onStepComplete = onStepComplete;
    this.onJump = onJump;

    this._buildUI();
    this._bindEvents();
    this._createSpacePrompt();
  }

  _buildUI() {
    const track = document.getElementById('timeline-track');
    if (!track) return;

    for (let i = 0; i < this.steps.length; i++) {
      const marker = document.createElement('div');
      marker.className = 'step-marker';
      marker.dataset.step = i;
      marker.style.left = `${((i + 0.5) / this.steps.length) * 100}%`;
      // Wrap number in span so it can be counter-rotated (diamond shape)
      const num = document.createElement('span');
      num.textContent = i + 1;
      marker.appendChild(num);
      marker.addEventListener('click', () => this.jumpToStep(i));
      track.appendChild(marker);
    }
  }

  _createSpacePrompt() {
    const prompt = document.createElement('div');
    prompt.id = 'space-prompt';
    prompt.innerHTML = '&#9654; PRESS SPACE TO CONTINUE';
    prompt.style.cssText = `
      position: fixed;
      bottom: 180px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(10,10,15,0.85);
      border: 1px solid #ff4444;
      border-radius: 6px;
      padding: 10px 24px;
      color: #ff6644;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 2px;
      z-index: 120;
      display: none;
      pointer-events: none;
      animation: spacePulse 1.5s ease-in-out infinite;
    `;
    document.body.appendChild(prompt);
    this.spacePrompt = prompt;

    // Add pulse animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spacePulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  _bindEvents() {
    // Play button is now wired from main.js via ctrl-play

    // SPACE key to continue
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.waitingForSpace) {
          this.waitingForSpace = false;
          this.spacePrompt.style.display = 'none';
          this.advanceStep();
        } else if (!this.playing && this.currentStep < 0) {
          // First press starts playback
          this.playing = true;
          this.advanceStep();
        }
      }
    });
  }

  togglePlay() {
    this.playing = !this.playing;

    if (this.playing && this.currentStep < 0) {
      this.advanceStep();
    }
  }

  jumpToStep(index) {
    if (index < 0 || index >= this.steps.length) return;

    document.querySelectorAll('.step-marker').forEach((m, i) => {
      m.className = 'step-marker' + (i < index ? ' completed' : '');
    });

    if (this.onJump) this.onJump(index);

    this.currentStep = index - 1;
    this.elapsed = 0;
    this.waitingForSpace = false;
    this.spacePrompt.style.display = 'none';
    this.advanceStep();
  }

  advanceStep() {
    // Complete current
    if (this.currentStep >= 0 && this.onStepComplete) {
      this.onStepComplete(this.steps[this.currentStep], this.currentStep);
    }

    // Mark completed
    const prevMarker = document.querySelector(`.step-marker[data-step="${this.currentStep}"]`);
    if (prevMarker) prevMarker.className = 'step-marker completed';

    this.currentStep++;
    if (this.currentStep >= this.steps.length) {
      this.playing = false;
      this.waitingForSpace = false;
      this.spacePrompt.style.display = 'none';
      return;
    }

    this.elapsed = 0;

    // Mark active
    const marker = document.querySelector(`.step-marker[data-step="${this.currentStep}"]`);
    if (marker) marker.className = 'step-marker active';

    // Update fill
    const fill = document.getElementById('timeline-fill');
    if (fill) {
      fill.style.width = `${((this.currentStep + 0.5) / this.steps.length) * 100}%`;
    }

    if (this.onStepStart) {
      this.onStepStart(this.steps[this.currentStep], this.currentStep);
    }
  }

  update(dt) {
    if (!this.playing || this.currentStep < 0 || this.waitingForSpace || this.deliberationPaused) return;

    this.elapsed += dt * this.speed;

    // After step effects play out, wait for space
    if (this.elapsed >= this.stepDuration) {
      this.waitingForSpace = true;
      this.spacePrompt.style.display = 'block';
    }
  }

  getCurrentStep() {
    if (this.currentStep < 0 || this.currentStep >= this.steps.length) return null;
    return this.steps[this.currentStep];
  }
}
