'use strict';

const preferences = require('../shared/workflow-preferences');

// Own only our three bindings. Failed edits restore the previous bindings and
// leave persisted preferences unchanged. The OS detects global registrations,
// not shortcuts handled locally inside another app.
function createWorkflowShortcuts(api, handlers) {
  let current = preferences.shortcuts();
  let errors = {};
  let suspended = false;
  const registered = new Set();
  function release() {
    for (const value of registered) api.unregister(value);
    registered.clear();
  }
  function register(values) {
    const failed = {};
    for (const key of preferences.SHORTCUT_ACTIONS) {
      if (!values[key]) continue;
      try {
        if (!api.register(values[key], handlers[key])) failed[key] = '已被其他程序占用';
        else registered.add(values[key]);
      }
      catch { failed[key] = '系统无法注册此快捷键'; }
    }
    return failed;
  }
  return {
    configure(raw, rollback = true) {
      const message = preferences.validateShortcuts(raw);
      if (message) return { ok: false, message, errors: { ...errors } };
      const next = preferences.shortcuts(raw);
      const previous = current;
      release();
      errors = register(next);
      current = next;
      if (rollback && Object.keys(errors).length) {
        const failed = { ...errors };
        release();
        current = previous;
        errors = register(previous);
        if (suspended) release();
        return { ok: false, message: '快捷键未保存，请更换被占用的组合', errors: failed };
      }
      if (suspended) release();
      return { ok: true, errors: { ...errors } };
    },
    setSuspended(value) {
      if (suspended === value) return;
      suspended = value;
      release();
      if (!suspended) errors = register(current);
    },
    errors: () => ({ ...errors }),
    dispose: release,
  };
}

function nextAttention(sessions, previousId) {
  const items = (sessions || []).filter(row => !row.headless && row.focusable !== false
    && ['waiting', 'needsinput', 'error'].includes(row.state));
  items.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0) || a.sessionId.localeCompare(b.sessionId));
  return items.length ? items[(items.findIndex(row => row.sessionId === previousId) + 1) % items.length] : null;
}

module.exports = { createWorkflowShortcuts, nextAttention };
