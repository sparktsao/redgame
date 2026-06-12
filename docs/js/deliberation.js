/**
 * deliberation.js — "Red Team Deliberation" slot-machine reel
 *
 * Before each step executes, an overlay shows candidate TTPs the AI
 * red team considered for that tactic. A highlight bar spins down the
 * list like a slot machine, decelerates, and locks on the chosen TTP,
 * then reveals condition checks + reasoning before resolving.
 *
 * Usage:
 *   const d = new Deliberation();
 *   await d.show(step);   // resolves when animation done or skipped
 */

import { playReelTick, playReelLock } from './audio.js';

// ── Candidate TTPs per tactic ──────────────────────────────────────
const TTP_CATALOG = {
  'Lateral Movement': [
    { id: 'T1021.002', name: 'SMB / PsExec',       blocker: 'admin share write blocked' },
    { id: 'T1021.006', name: 'WinRM Remote Exec',   blocker: 'WinRM service not running' },
    { id: 'T1047',     name: 'WMI Execution',       blocker: 'DCOM hardened on target' },
    { id: 'T1021.001', name: 'RDP Session',          blocker: 'NLA requires interactive creds' },
    { id: 'T1053.005', name: 'Scheduled Task (PtH)', blocker: null },
    { id: 'T1021.003', name: 'DCOM Lateral',         blocker: 'firewall blocks DCOM ports' },
  ],
  'Credential Access': [
    { id: 'T1003.001', name: 'LSASS Memory Dump',    blocker: null },
    { id: 'T1003.002', name: 'SAM Registry Extract',  blocker: 'SAM locked by AV' },
    { id: 'T1003.006', name: 'DCSync Replication',    blocker: 'no replication rights' },
    { id: 'T1558.003', name: 'Kerberoasting',         blocker: 'no SPNs in session scope' },
    { id: 'T1555',     name: 'Cached Browser Creds',  blocker: 'DPAPI master key missing' },
  ],
  'Execution': [
    { id: 'T1059.001', name: 'PowerShell',            blocker: 'constrained language mode' },
    { id: 'T1059.003', name: 'Windows CMD',            blocker: null },
    { id: 'T1106',     name: 'Native API',             blocker: 'userland hooking detected' },
    { id: 'T1053.005', name: 'Scheduled Task',         blocker: 'task scheduler disabled' },
  ],
  'Discovery': [
    { id: 'T1087.002', name: 'Domain Account Enum',    blocker: null },
    { id: 'T1069.002', name: 'Domain Group Enum',      blocker: 'LDAP query filtered' },
    { id: 'T1018',     name: 'Remote System Discovery', blocker: 'NetBIOS disabled' },
  ],
};

// Fallback if tactic not in catalog
const FALLBACK_CANDIDATES = [
  { id: 'T1059.001', name: 'PowerShell Exec',     blocker: 'constrained language mode' },
  { id: 'T1106',     name: 'Native Win32 API',    blocker: 'API hooking active' },
  { id: 'T1218.011', name: 'Rundll32 Proxy Exec', blocker: 'AppLocker blocks DLL' },
];

// ── Build candidate list for a step ────────────────────────────────
function buildCandidates(step) {
  const pool = TTP_CATALOG[step.tactic] || FALLBACK_CANDIDATES;

  // Winner from the actual step data
  const winnerScore = meanConfidence(step.conditions);
  const winner = {
    id: step.ttp_id,
    name: step.ttp_name,
    score: winnerScore,
    isWinner: true,
    blocker: null,
  };

  // Build losers from catalog (skip if same id as winner)
  const losers = pool
    .filter(c => c.id !== step.ttp_id)
    .slice(0, 4)
    .map(c => ({
      ...c,
      score: Math.floor(Math.random() * 30 + 20), // 20–50%
      isWinner: false,
    }));

  // Combine and shuffle (winner will be at random position)
  const all = [...losers, winner];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }

  return { candidates: all, winnerIndex: all.indexOf(winner), winner };
}

function meanConfidence(conditions) {
  if (!conditions || conditions.length === 0) return 90;
  const sum = conditions.reduce((s, c) => s + (c.confidence || 0.9), 0);
  return Math.round((sum / conditions.length) * 100);
}

// ── Deliberation class ─────────────────────────────────────────────
export class Deliberation {
  constructor() {
    this.overlay = document.getElementById('deliberation-overlay');
    this.titleEl = this.overlay.querySelector('.delib-title');
    this.reelEl = this.overlay.querySelector('.delib-reel');
    this.footerEl = this.overlay.querySelector('.delib-footer');
    this.active = false;
    this._resolve = null;
    this._skipBound = this._skip.bind(this);
  }

  /**
   * Show the deliberation reel for this step.
   * Returns a promise that resolves when the animation finishes or is skipped.
   */
  show(step) {
    return new Promise(resolve => {
      this._resolve = resolve;
      this.active = true;

      const { candidates, winnerIndex, winner } = buildCandidates(step);

      // Populate header
      this.titleEl.textContent = `${step.tactic.toUpperCase()} — TTP SELECTION`;

      // Build reel rows
      this.reelEl.innerHTML = '';
      candidates.forEach((c, i) => {
        const row = document.createElement('div');
        row.className = 'delib-row';
        row.dataset.index = i;
        row.innerHTML = `
          <span class="delib-ttp-id">${c.id}</span>
          <span class="delib-ttp-name">${c.name}</span>
          <span class="delib-score-bar"><span class="delib-score-fill" style="width:0%"></span></span>
          <span class="delib-score-pct">—</span>
        `;
        this.reelEl.appendChild(row);
      });

      // Footer hidden initially
      this.footerEl.innerHTML = '';
      this.footerEl.classList.remove('visible');

      // Show overlay
      this.overlay.classList.add('visible');

      // Bind skip
      window.addEventListener('keydown', this._skipBound);
      this.overlay.addEventListener('click', this._skipBound);

      // Start reel animation
      this._animateReel(candidates, winnerIndex, winner, step);
    });
  }

  _animateReel(candidates, winnerIndex, winner, step) {
    const rows = this.reelEl.querySelectorAll('.delib-row');
    const totalTicks = 18 + winnerIndex; // enough spins to feel random
    let tick = 0;
    let highlightIdx = 0;
    let baseDelay = 50; // ms, speeds up perception of slot machine

    const doTick = () => {
      if (!this.active) return;

      // Clear previous highlight
      rows.forEach(r => r.classList.remove('highlight'));

      // Current highlight
      highlightIdx = tick % candidates.length;
      rows[highlightIdx].classList.add('highlight');
      playReelTick();

      tick++;

      if (tick >= totalTicks) {
        // Final lock
        this._lockWinner(rows, candidates, winnerIndex, winner, step);
        return;
      }

      // Decelerate: delay increases as we approach end
      const progress = tick / totalTicks;
      const delay = baseDelay + Math.pow(progress, 3) * 350;
      this._timer = setTimeout(doTick, delay);
    };

    this._timer = setTimeout(doTick, 300); // brief pause before spinning starts
  }

  _lockWinner(rows, candidates, winnerIndex, winner, step) {
    if (!this.active) return;

    // Clear all, lock winner
    rows.forEach(r => r.classList.remove('highlight'));
    rows[winnerIndex].classList.add('locked');
    playReelLock();

    // Reveal all scores with animation
    candidates.forEach((c, i) => {
      const row = rows[i];
      const fill = row.querySelector('.delib-score-fill');
      const pct = row.querySelector('.delib-score-pct');
      setTimeout(() => {
        fill.style.width = c.score + '%';
        fill.classList.add(c.isWinner ? 'winner' : 'loser');
        pct.textContent = c.score + '%';
        // Show blocker on losers
        if (c.blocker && !c.isWinner) {
          const bl = document.createElement('span');
          bl.className = 'delib-blocker';
          bl.textContent = '✗ ' + c.blocker;
          row.appendChild(bl);
        }
      }, i * 80);
    });

    // Show footer with conditions + reasoning after scores reveal
    setTimeout(() => {
      if (!this.active) return;
      this._showFooter(step, winner);
    }, candidates.length * 80 + 300);
  }

  _showFooter(step, winner) {
    // Condition check marks
    let condHtml = '';
    if (step.conditions && step.conditions.length) {
      condHtml = step.conditions.map(c => {
        const icon = c.result ? '✓' : '✗';
        const cls = c.result ? 'pass' : 'fail';
        return `<span class="delib-cond ${cls}">${icon} ${c.name}</span>`;
      }).join('');
    }

    // Short reasoning excerpt
    const reasoning = step.red_team_reasoning || '';
    const short = reasoning.length > 140 ? reasoning.slice(0, 137) + '…' : reasoning;

    this.footerEl.innerHTML = `
      <div class="delib-conditions">${condHtml}</div>
      <div class="delib-reasoning">${short}</div>
    `;
    this.footerEl.classList.add('visible');

    // Auto-dismiss after 2s
    this._dismissTimer = setTimeout(() => this._finish(), 2000);
  }

  _skip(e) {
    if (e.type === 'keydown' && e.code !== 'Space') return;
    if (e.type === 'keydown') e.preventDefault();
    this._finish();
  }

  _finish() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this._timer);
    clearTimeout(this._dismissTimer);

    // Fade out
    this.overlay.classList.remove('visible');
    window.removeEventListener('keydown', this._skipBound);
    this.overlay.removeEventListener('click', this._skipBound);

    if (this._resolve) {
      this._resolve();
      this._resolve = null;
    }
  }
}
