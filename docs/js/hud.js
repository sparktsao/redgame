/**
 * hud.js — DOM overlay: credential bag, position, MITRE badge, minimap, narration
 */

export class HUD {
  constructor(networkLayout) {
    this.networkLayout = networkLayout;
    this.credentials = [];
    this.compromisedMachines = new Set();
    this.initMinimap();
    this.initDetailPanel();
  }

  updatePosition(machine, account) {
    const el = document.getElementById('pos-text');
    if (el) el.textContent = `${machine}  as  ${account}`;
  }

  updateMitre(ttpId, tactic) {
    const el = document.getElementById('hud-mitre');
    const ttpEl = document.getElementById('mitre-ttp');
    const tacticEl = document.getElementById('mitre-tactic');
    if (el) el.style.display = 'block';
    if (ttpEl) ttpEl.textContent = ttpId;
    if (tacticEl) tacticEl.textContent = `[ ${tactic} ]`;
  }

  updateDetection(level) {
    const el = document.getElementById('hud-detection');
    const lvl = document.getElementById('detection-level');
    if (el) el.style.display = 'block';
    if (lvl) {
      lvl.textContent = level;
      lvl.className = 'level ' + level.toLowerCase();
    }
  }

  addCredential(account, type, sourceMachine) {
    // Avoid dupes
    if (this.credentials.find(c => c.account === account)) return;

    this.credentials.push({ account, type, sourceMachine });

    const list = document.getElementById('cred-list');
    if (!list) return;

    const card = document.createElement('div');
    card.className = 'cred-card';
    card.innerHTML = `
      <span class="account">\u2620 ${account}</span>
      <span class="source"> &mdash; ${type} from ${sourceMachine}</span>
    `;
    list.appendChild(card);
  }

  showNarration(stepIndex, tactic, text) {
    const el = document.getElementById('hud-narration');
    const label = document.getElementById('narration-label');
    const textEl = document.getElementById('narration-text');
    if (el) el.style.display = 'block';
    if (label) label.textContent = `STEP ${stepIndex + 1} \u2014 ${tactic}`;
    if (textEl) {
      textEl.textContent = '';
      this._typewriter(textEl, text, 20);
    }
  }

  hideNarration() {
    const el = document.getElementById('hud-narration');
    if (el) el.style.display = 'none';
  }

  showVictory(account) {
    const el = document.getElementById('victory-banner');
    const acct = document.getElementById('victory-account');
    if (el) el.style.display = 'block';
    if (acct) acct.textContent = account;
  }

  markCompromised(machineName) {
    this.compromisedMachines.add(machineName);
    this.drawMinimap();
  }

  // --- Minimap ---

  initMinimap() {
    this.minimapCanvas = document.getElementById('minimap-canvas');
    if (!this.minimapCanvas) return;
    this.minimapCanvas.width = 180;
    this.minimapCanvas.height = 140;
    this.drawMinimap();
  }

  drawMinimap() {
    const canvas = this.minimapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const machines = this.networkLayout?.machines;
    if (!machines?.length) return;

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const m of machines) {
      minX = Math.min(minX, m.x); maxX = Math.max(maxX, m.x);
      minZ = Math.min(minZ, m.z); maxZ = Math.max(maxZ, m.z);
    }
    const pad = 10;
    const scaleX = (w - pad * 2) / (maxX - minX || 1);
    const scaleZ = (h - pad * 2) / (maxZ - minZ || 1);
    const scale = Math.min(scaleX, scaleZ);

    const toScreen = (x, z) => ({
      sx: pad + (x - minX) * scale,
      sy: pad + (z - minZ) * scale,
    });

    // Draw connections
    const conns = this.networkLayout?.connections || [];
    ctx.strokeStyle = '#223344';
    ctx.lineWidth = 1;
    for (const c of conns) {
      const from = machines.find(m => m.name === c.from);
      const to = machines.find(m => m.name === c.to);
      if (!from || !to) continue;
      const a = toScreen(from.x, from.z);
      const b = toScreen(to.x, to.z);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }

    // Draw machines
    for (const m of machines) {
      const { sx, sy } = toScreen(m.x, m.z);
      const compromised = this.compromisedMachines.has(m.name);
      const radius = m.type === 'dc' ? 5 : 3;

      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fillStyle = compromised ? '#cc2222' : (m.type === 'dc' ? '#aa8844' : '#4466aa');
      ctx.fill();

      if (compromised) {
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  // --- Detail panel (red-team / blue-team / conditions) ---

  initDetailPanel() {
    const closeBtn = document.getElementById('detail-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hideDetailPanel());
    }
  }

  showDetailPanel(step, idx) {
    const panel = document.getElementById('detail-panel');
    if (!panel) return;

    // Header
    const label = document.getElementById('detail-step-label');
    if (label) label.textContent = `STEP ${idx + 1} — ${step.tactic}`;

    // Red team
    const ttpEl = document.getElementById('detail-ttp');
    if (ttpEl) ttpEl.textContent = `${step.ttp_id} ${step.ttp_name}`;

    const cmdEl = document.getElementById('detail-command');
    if (cmdEl) cmdEl.textContent = step.command || '—';

    const reasonEl = document.getElementById('detail-reasoning');
    if (reasonEl) reasonEl.textContent = step.red_team_reasoning || step.observation || '';

    // Conditions
    const condEl = document.getElementById('detail-conditions');
    if (condEl) {
      condEl.innerHTML = '';
      const conditions = step.conditions || [];
      for (const c of conditions) {
        const row = document.createElement('div');
        row.className = 'condition-row ' + (c.result ? 'pass' : 'fail');
        row.innerHTML = `
          <span class="cond-icon">${c.result ? '\u2714' : '\u2718'}</span>
          <span class="cond-name">${c.name}</span>
          <span class="cond-conf">${(c.confidence * 100).toFixed(0)}%</span>
        `;
        condEl.appendChild(row);
      }
      if (!conditions.length) {
        condEl.textContent = 'No conditions evaluated';
      }
    }

    // Blue team
    const blueEl = document.getElementById('detail-blue');
    if (blueEl) blueEl.textContent = step.blue_team || 'No response recorded';

    panel.style.display = 'block';
  }

  hideDetailPanel() {
    const panel = document.getElementById('detail-panel');
    if (panel) panel.style.display = 'none';
  }

  // --- Typewriter effect ---

  _typewriter(el, text, speed) {
    let i = 0;
    if (this._twInterval) clearInterval(this._twInterval);
    this._twInterval = setInterval(() => {
      if (i >= text.length) {
        clearInterval(this._twInterval);
        return;
      }
      el.textContent += text[i];
      i++;
    }, speed);
  }
}
