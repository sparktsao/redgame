/**
 * loader.js — Data loading & normalization
 * Supports: attack-data.json, raw JSONL, or log directory
 */

export async function loadAttackData(path = 'data/attack-data.json') {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);

  const text = await res.text();

  // Auto-detect format
  if (path.endsWith('.json')) {
    return JSON.parse(text);
  }

  if (path.endsWith('.jsonl')) {
    return parseJSONL(text);
  }

  return JSON.parse(text);
}

export async function loadNetworkLayout(path = 'data/network-layout.json') {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

/**
 * Parse VRT JSONL log into normalized attack-data format
 */
function parseJSONL(text) {
  const lines = text.trim().split('\n').map(l => JSON.parse(l));
  const runStart = lines.find(l => l.event === 'run_start');
  const worldUpdates = lines.filter(l => l.event === 'world_updater');
  const pathDesigns = lines.filter(l => l.event === 'path_designer');
  const validators = lines.filter(l => l.event === 'validator');

  const steps = [];
  for (let i = 0; i < pathDesigns.length; i++) {
    const pd = pathDesigns[i];
    const wu = worldUpdates[i];
    const val = validators[i];

    const step = {
      iteration: pd.iteration,
      tactic: pd.tactic,
      ttp_id: pd.ttp_name,
      ttp_name: pd.description?.split(':')[1]?.split('—')[0]?.trim() || pd.ttp_name,
      source_machine: wu?.new_machine || pd.target_machine,
      target_machine: pd.target_machine,
      account_used: pd.target_account,
      result: val?.result || 'success',
      detection: val?.detection || 'UNKNOWN',
      observation: wu?.observation || '',
      narration: wu?.observation || pd.why || '',
      command: ''
    };

    if (pd.tactic === 'Credential Access' && wu?.new_credentials?.length) {
      step.credential_captured = {
        account: wu.new_credentials[0],
        type: 'ntlm_hash'
      };
    }
    if (wu?.goal_achieved) {
      step.goal_achieved = true;
    }

    steps.push(step);
  }

  return {
    case_id: runStart?.case_id || 'unknown',
    entry: {
      machine: runStart?.entry_machine || steps[0]?.source_machine,
      account: runStart?.entry_account || steps[0]?.account_used
    },
    goal: {
      machine: runStart?.goal_machine || 'UNKNOWN',
      account: runStart?.goal_account || 'UNKNOWN'
    },
    steps
  };
}
