'use strict';

(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./agents') : root.AgentPawAgents);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AgentPawWorkflow = api;
})(typeof window !== 'undefined' ? window : null, function (agents) {
  const SHORTCUT_ACTIONS = Object.freeze(['peek', 'next', 'toggle']);
  const DEFAULTS = Object.freeze({ mode: 'standard', mutedAgents: [], mutedProjects: [] });
  const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
  function notifications(raw = {}) {
    if (!raw || typeof raw !== 'object') raw = {};
    const projects = new Map();
    for (const row of Array.isArray(raw.mutedProjects) ? raw.mutedProjects : []) {
      if (row && /^[a-f0-9]{64}$/.test(row.key)) projects.set(row.key, { key: row.key, label: text(row.label, 100) });
      if (projects.size >= 100) break;
    }
    return {
      mode: raw.mode === 'attention' ? 'attention' : 'standard',
      mutedAgents: [...new Set((Array.isArray(raw.mutedAgents) ? raw.mutedAgents : [])
        .filter(key => agents.isKnownKey(key)))],
      mutedProjects: [...projects.values()],
    };
  }
  function muted(prefs, item) {
    return !!(item && prefs && ((prefs.mutedAgents || []).includes(item.agent)
      || (prefs.mutedProjects || []).some(row => row.key === item.projectKey)));
  }
  function accelerator(value) {
    if (value === '') return '';
    if (typeof value !== 'string' || value.length > 50) return null;
    const parts = value.split('+');
    const key = parts.pop();
    if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space)$/.test(key)
      || parts.length < 2 || new Set(parts).size !== parts.length
      || parts.some(part => !['Ctrl', 'Alt', 'Shift'].includes(part))
      || !parts.includes('Ctrl') || !parts.some(part => part === 'Alt' || part === 'Shift')) return null;
    return [...['Ctrl', 'Alt', 'Shift'].filter(part => parts.includes(part)), key].join('+');
  }
  function shortcuts(raw = {}) {
    return Object.fromEntries(SHORTCUT_ACTIONS.map(key => [key, accelerator(raw && raw[key]) || '']));
  }
  function validateShortcuts(raw) {
    if (!raw || typeof raw !== 'object') return '快捷键格式无效';
    const used = new Set();
    for (const key of SHORTCUT_ACTIONS) {
      const value = accelerator(raw[key]);
      if (value === null) return '请使用 Ctrl+Shift 或 Ctrl+Alt 搭配字母、数字、F1–F12 或空格';
      if (value && used.has(value)) return '每个操作请使用不同的快捷键';
      if (value) used.add(value);
    }
    return null;
  }
  return { DEFAULTS, SHORTCUT_ACTIONS, notifications, muted, accelerator, shortcuts, validateShortcuts, text };
});
