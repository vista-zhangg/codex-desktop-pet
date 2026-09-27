'use strict';

const { muted } = require('../shared/workflow-preferences');

// Presentation only: the core and permission queue never pass through here.
function createTaskNotifications({ getPreferences, deliver, record, now = Date.now,
  schedule = setTimeout, cancel = clearTimeout, errorDelay = 5000, completionDelay = 2000 }) {
  const errors = new Map();
  const completions = new Map();
  const lastAttention = new Map();
  let completionTimer = null;
  function allowed(event) { return !muted(getPreferences(), event); }
  function clearError(id) {
    if (errors.has(id)) cancel(errors.get(id).timer);
    errors.delete(id);
  }
  function push(event) {
    const id = event.sessionId;
    if (['operation', 'user-turn', 'greet'].includes(event.kind)) {
      for (const [key, pending] of completions) if (pending.sessionId === id) completions.delete(key);
    }
    if (['operation', 'user-turn', 'greet', 'turn-done', 'say'].includes(event.kind)) clearError(id);
    if (event.kind === 'turn-done') {
      if (record({ ...event, kind: 'done' }) === false) return;
      if (!allowed(event) || getPreferences().mode === 'attention') return;
      completions.set(event.eventKey || `${id}:${event.ts}`, event);
      if (!completionTimer) completionTimer = schedule(() => {
        completionTimer = null;
        const batch = [...completions.values()].filter(allowed);
        completions.clear();
        if (!batch.length || getPreferences().mode === 'attention') return;
        deliver({ ...batch[0], kind: 'completion-summary', count: batch.length,
          project: batch.length === 1 ? batch[0].project : '', ts: now() });
      }, completionDelay);
      return;
    }
    if (event.kind === 'error') {
      // Repeated failures do not keep postponing the first persistent error.
      if (errors.has(id)) return;
      const timer = schedule(() => {
        errors.delete(id);
        const key = `error:${id}`;
        if (!lastAttention.has(key) || now() - lastAttention.get(key) >= 30000) {
          lastAttention.set(key, now());
          record({ ...event, kind: 'failed' });
          if (allowed(event)) deliver(event);
        }
      }, errorDelay);
      errors.set(id, { timer });
      return;
    }
    if (event.kind === 'waiting' || event.kind === 'needsinput') {
      if (allowed(event)) deliver(event);
      return;
    }
    // Operations still drive work animations; routine speech stays in the
    // existing details panel. The quiet tier also omits greeting animations.
    if (event.kind === 'operation') { deliver({ ...event, silent: true }); return; }
    if (['say', 'user-turn', 'greet'].includes(event.kind)) {
      if (allowed(event) && getPreferences().mode === 'standard') deliver({ ...event, silent: true });
      return;
    }
    if (allowed(event)) deliver(event);
  }
  return {
    push,
    reconcile(sessions) {
      const live = new Map((sessions || []).map(row => [row.sessionId, row]));
      for (const id of errors.keys()) if (!live.has(id) || live.get(id).state !== 'error') clearError(id);
      for (const [key, at] of lastAttention) if (now() - at > 60000) lastAttention.delete(key);
    },
    dispose() {
      for (const id of errors.keys()) clearError(id);
      if (completionTimer) cancel(completionTimer);
      completions.clear();
    },
  };
}

module.exports = { createTaskNotifications };
