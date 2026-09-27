'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { text, muted } = require('../shared/workflow-preferences');
const Agents = require('../shared/agents');

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECENT = 100;
const hash = value => createHash('sha256').update(value).digest('hex');
function projectKey(session) {
  const cwd = text(session && session.cwd, 4096).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  return hash(cwd || `session:${session && (session.id || session.sessionId) || ''}`);
}
function metadata(row) {
  if (!row || typeof row.sessionId !== 'string' || !row.sessionId || row.sessionId.length > 256
    || !Agents.isKnownKey(row.agent)) return null;
  return { sessionId: row.sessionId, agent: row.agent, project: text(row.project, 100),
    projectKey: /^[a-f0-9]{64}$/.test(row.projectKey) ? row.projectKey : projectKey(row) };
}

function createTaskCenter({ file, now = Date.now } = {}) {
  let recent = [];
  const preferences = new Map();
  let sessions = new Map();
  let activeActions = new Set();
  let storageError = false;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.version === 1) {
      for (const row of (Array.isArray(value.preferences) ? value.preferences : []).slice(0, 200)) {
        const meta = metadata(row);
        if (meta) preferences.set(meta.sessionId, { ...meta, alias: text(row.alias, 40), pinned: row.pinned === true });
      }
      recent = (Array.isArray(value.recent) ? value.recent : []).flatMap(row => {
        const meta = metadata(row);
        return meta && /^[a-f0-9]{64}$/.test(row.id) && ['done', 'failed', 'attention'].includes(row.kind)
          && Number.isFinite(row.at) && row.at <= now() && now() - row.at < RETENTION_MS
          ? [{ ...meta, id: row.id, kind: row.kind, at: row.at, read: row.read === true }] : [];
      }).slice(0, MAX_RECENT);
    }
  } catch (error) { storageError = !!file && error.code !== 'ENOENT'; }
  function persist() {
    if (!file) return true;
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify({ version: 1, preferences: [...preferences.values()], recent }), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temp, file);
      storageError = false;
      return true;
    } catch { storageError = true; return false; }
  }
  function record(event) {
    const meta = metadata(event);
    if (!meta || !['done', 'failed', 'attention'].includes(event.kind)) return false;
    const id = hash(`${event.kind}:${event.eventKey || `${event.sessionId}:${event.ts}`}`);
    if (recent.some(row => row.id === id)) return false;
    recent.unshift({ ...meta, id, kind: event.kind, at: now(), read: false });
    recent = recent.filter(row => now() - row.at < RETENTION_MS).slice(0, MAX_RECENT);
    persist();
    return true;
  }
  function decorate(row, prefs) {
    const saved = preferences.get(row.sessionId);
    return { ...row, alias: saved && saved.alias || '', pinned: !!(saved && saved.pinned),
      projectMuted: (prefs.mutedProjects || []).some(item => item.key === row.projectKey),
      notificationsMuted: muted(prefs, row) };
  }
  function sync(stats, prefs) {
    sessions = new Map((stats.sessions || []).filter(row => !row.headless).map(row => [row.sessionId, row]));
    const rows = (stats.sessions || []).map(row => decorate(row, prefs));
    for (const saved of preferences.values()) {
      if (!sessions.has(saved.sessionId)) rows.push(decorate({ ...saved,
        state: 'idle', archived: true, focusable: saved.agent === 'codex', updatedAt: 0 }, prefs));
    }
    const actions = (stats.actions || []).map(action => {
      const session = sessions.get(action.sessionId);
      const source = session || (action.choice && { sessionId: action.sessionId, agent: action.agent || 'claude',
        project: action.choice.project, projectKey: projectKey({ id: action.sessionId }) });
      if (source && !activeActions.has(action.actionId)) record({ ...source, kind: 'attention', eventKey: action.actionId, ts: source.updatedAt });
      return { ...action, notificationsMuted: muted(prefs, source),
        choice: action.choice ? { ...action.choice, project: preferences.get(action.sessionId)?.alias || action.choice.project } : null };
    });
    activeActions = new Set(actions.map(action => action.actionId));
    const kept = recent.filter(row => now() - row.at < RETENTION_MS);
    if (kept.length !== recent.length) { recent = kept; persist(); }
    return { ...stats, sessions: rows, actions, recent: recent.map(row => ({ ...row,
      alias: preferences.get(row.sessionId)?.alias || '',
      focusable: row.agent === 'codex' || sessions.get(row.sessionId)?.focusable === true,
    })), taskCenterStorageError: storageError };
  }
  return {
    record, sync,
    lookup(id) {
      const row = sessions.get(id) || preferences.get(id) || recent.find(row => row.sessionId === id);
      return row ? { ...row, alias: preferences.get(id)?.alias || '', pinned: preferences.get(id)?.pinned === true } : null;
    },
    recentEntry(id) { return recent.find(row => row.id === id) || null; },
    update(id, value) {
      const current = this.lookup(id);
      const source = metadata(current);
      if (!source || !value || typeof value !== 'object') return { ok: false, message: '会话已不可用，请刷新后重试' };
      const alias = value.alias === undefined ? current.alias : value.alias;
      const pinned = value.pinned === undefined ? current.pinned : value.pinned;
      if (typeof alias !== 'string' || alias.trim().length > 40 || typeof pinned !== 'boolean') {
        return { ok: false, message: '别名最多 40 个字符' };
      }
      const old = preferences.get(id);
      if (!old && (text(alias, 40) || pinned) && preferences.size >= 200) return { ok: false, message: '已保存 200 个会话，请先清除不再使用的别名或关注' };
      if (pinned && !old?.pinned && [...preferences.values()].filter(row => row.pinned).length >= 20) {
        return { ok: false, message: '最多关注 20 个会话' };
      }
      const next = { ...source, alias: text(alias, 40), pinned };
      if (!next.alias && !next.pinned) preferences.delete(id); else preferences.set(id, next);
      if (persist()) return { ok: true };
      if (old) preferences.set(id, old); else preferences.delete(id);
      return { ok: false, message: '保存失败，请检查本地目录是否可写' };
    },
    markRead(ids) {
      if (!Array.isArray(ids)) return false;
      const selected = new Set(ids.slice(0, MAX_RECENT));
      const previous = recent;
      recent = recent.map(row => selected.has(row.id) ? { ...row, read: true } : row);
      if (persist()) return true;
      recent = previous;
      return false;
    },
    clear() {
      const previous = recent;
      recent = [];
      if (persist()) return true;
      recent = previous;
      return false;
    },
  };
}

module.exports = { createTaskCenter, projectKey, RETENTION_MS, MAX_RECENT };
