'use strict';

(function () {
  if (!window.pet.getWorkflowPreferences) return;
  const get = id => document.getElementById(id);
  const model = window.AgentPawWorkflow;
  let value = null;
  let busy = false;
  let shortcutDirty = false;
  const agentButtons = new Map();
  const status = get('workflow-status');
  function setBusy(next) {
    busy = next;
    document.querySelectorAll('.workflow-modes button, #workflow-agents button, #workflow-projects button, .workflow-shortcuts input, #shortcut-save, #shortcut-disable')
      .forEach(control => { control.disabled = next; });
  }
  function render(next) {
    if (!next || !next.notifications) return;
    value = next;
    for (const mode of ['standard', 'attention']) {
      get('notify-' + mode).setAttribute('aria-pressed', String(next.notifications.mode === mode));
    }
    for (const [key, button] of agentButtons) button.setAttribute('aria-checked', String(!next.notifications.mutedAgents.includes(key)));
    const projects = get('workflow-projects');
    projects.innerHTML = '';
    if (!next.notifications.mutedProjects.length) {
      const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '暂无静音项目'; projects.appendChild(empty);
    }
    for (const row of next.notifications.mutedProjects) {
      const card = document.createElement('div'); card.className = 'setting-card';
      const name = document.createElement('div'); name.className = 'setting-title'; name.textContent = row.label || '未命名项目';
      const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'subtle-button'; restore.textContent = '恢复提醒';
      restore.addEventListener('click', () => save({ unmuteProject: row.key }));
      card.appendChild(name); card.appendChild(restore); projects.appendChild(card);
    }
    for (const key of model.SHORTCUT_ACTIONS) {
      if (!shortcutDirty) get('shortcut-' + key).value = next.shortcuts[key];
      get('shortcut-' + key + '-error').textContent = next.shortcutErrors[key] || '';
    }
    setBusy(busy);
  }
  async function save(patch, shortcut = false) {
    if (busy || !value) return;
    setBusy(true);
    const feedback = shortcut ? get('shortcut-status') : status;
    feedback.textContent = '正在保存…';
    try {
      const result = await window.pet.setWorkflowPreferences(patch);
      if (!result || !result.ok) {
        for (const key of model.SHORTCUT_ACTIONS) get('shortcut-' + key + '-error').textContent = result?.errors?.[key] || '';
        throw new Error(result?.message || '保存失败，请重试');
      }
      if (shortcut) shortcutDirty = false;
      render(result); feedback.textContent = '已保存，立即生效';
    } catch (error) { feedback.textContent = error.message || '保存失败，请重试'; }
    finally { setBusy(false); }
  }
  for (const mode of ['standard', 'attention']) get('notify-' + mode).addEventListener('click', () => save({ notifications: { mode } }));
  for (const key of window.AgentPawAgents.SHORT_KEYS) {
    const card = document.createElement('div'); card.className = 'setting-card';
    const name = document.createElement('div'); name.className = 'setting-title'; name.textContent = window.AgentPawAgents.label(key);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'switch'; button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', name.textContent + ' 任务提醒'); button.setAttribute('aria-checked', 'true');
    const thumb = document.createElement('span'); thumb.className = 'switch-thumb'; thumb.setAttribute('aria-hidden', 'true'); button.appendChild(thumb);
    button.addEventListener('click', () => {
      if (!value) return;
      const muted = new Set(value.notifications.mutedAgents);
      if (muted.has(key)) muted.delete(key); else muted.add(key);
      save({ notifications: { mutedAgents: [...muted] } });
    });
    agentButtons.set(key, button); card.appendChild(name); card.appendChild(button); get('workflow-agents').appendChild(card);
  }
  for (const key of model.SHORTCUT_ACTIONS) {
    const input = get('shortcut-' + key);
    let initial = '';
    input.addEventListener('focus', () => { initial = input.value; });
    input.addEventListener('keydown', event => {
      if (event.key === 'Tab') return;
      event.preventDefault();
      if (event.key === 'Escape') { event.stopPropagation(); input.value = initial; input.blur(); return; }
      if (event.key === 'Backspace' || event.key === 'Delete') { input.value = ''; shortcutDirty = true; return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
      const keyName = event.code === 'Space' ? 'Space' : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
        : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : event.key.toUpperCase();
      const chord = [...(event.ctrlKey ? ['Ctrl'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), keyName].join('+');
      const accepted = !event.metaKey && model.accelerator(chord);
      get('shortcut-' + key + '-error').textContent = accepted ? '' : '请按 Ctrl+Shift 或 Ctrl+Alt 加字母、数字、F1–F12 或空格';
      if (accepted) { input.value = accepted; shortcutDirty = true; }
    });
  }
  function saveShortcuts() {
    const shortcuts = Object.fromEntries(model.SHORTCUT_ACTIONS.map(key => [key, get('shortcut-' + key).value]));
    const error = model.validateShortcuts(shortcuts);
    if (error) { get('shortcut-status').textContent = error; return; }
    save({ shortcuts }, true);
  }
  get('shortcut-save').addEventListener('click', saveShortcuts);
  get('shortcut-disable').addEventListener('click', () => {
    model.SHORTCUT_ACTIONS.forEach(key => { get('shortcut-' + key).value = ''; }); shortcutDirty = true; saveShortcuts();
  });
  window.pet.onWorkflowPreferences(render);
  window.pet.getWorkflowPreferences().then(render).catch(() => { status.textContent = '任务提醒设置加载失败，请重新打开设置'; });
})();
