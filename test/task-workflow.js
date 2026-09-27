'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const prefs = require('../shared/workflow-preferences');
const { createTaskNotifications } = require('../backend/task-notifications');
const { createTaskCenter, projectKey, MAX_RECENT, RETENTION_MS } = require('../backend/task-center');
const { createWorkflowShortcuts, nextAttention } = require('../backend/workflow-shortcuts');
const { protectStats } = require('../backend/privacy');

let time = Date.now();
const timers = new Map();
let counter = 0;
function advance(ms) {
  time += ms;
  for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); }
}
let notifications = prefs.notifications();
const delivered = [], recorded = [];
const notifier = createTaskNotifications({
  getPreferences: () => notifications, now: () => time,
  deliver: event => delivered.push(event), record: event => recorded.push(event),
  schedule: (fn, ms) => { const id = ++counter; timers.set(id, { fn, at: time + ms }); return id; },
  cancel: id => timers.delete(id),
});
const event = (kind, sessionId = 'a', extra = {}) => ({ kind, sessionId, agent: 'codex', project: 'demo', ts: time,
  projectKey: projectKey({ cwd: 'D:/demo' }), ...extra });
notifier.push(event('operation'));
assert.equal(delivered.pop().silent, true, 'ordinary operations only update animation/state');
notifier.push(event('turn-done'));
notifier.push(event('turn-done', 'b'));
assert.equal(delivered.length, 0);
advance(2000);
assert.equal(delivered.pop().count, 2, 'parallel completions use one bubble');
assert.equal(recorded.length, 2, 'each completion remains individually reviewable');
notifier.push(event('turn-done', 'resumed'));
notifier.push(event('user-turn', 'resumed'));
delivered.length = 0;
advance(2000);
assert.equal(delivered.length, 0, 'starting a new round cancels the old completion bubble');
assert(recorded.some(row => row.kind === 'done' && row.sessionId === 'resumed'), 'resumed work keeps its previous history');
notifier.push(event('error'));
advance(2000); notifier.push(event('operation')); advance(4000);
assert(!recorded.some(row => row.kind === 'failed'), 'recovered tool errors do not leave a misleading failure');
delivered.length = 0;
notifier.push(event('error')); advance(5000);
assert.equal(delivered.pop().kind, 'error');
notifier.push(event('error')); advance(5000);
assert.equal(delivered.length, 0, 'persistent error bubbles are rate limited');
notifier.push(event('error', 'gone'));
notifier.reconcile([{ sessionId: 'a', state: 'error' }]); advance(5000);
assert.equal(delivered.length, 0, 'removed sessions cannot emit delayed error bubbles');
notifications = prefs.notifications({ mode: 'attention' });
notifier.push(event('turn-done')); notifier.push(event('say')); notifier.push(event('waiting')); advance(2000);
assert.deepEqual(delivered.map(row => row.kind), ['waiting']);
delivered.length = 0;
notifications = prefs.notifications({ mutedAgents: ['codex'] });
notifier.push(event('needsinput')); notifier.push(event('turn-done')); advance(2000);
assert.equal(delivered.length, 0);
notifications = prefs.notifications();
notifier.push(event('turn-done'));
notifications = prefs.notifications({ mutedProjects: [{ key: event('').projectKey, label: 'demo' }] });
advance(2000);
assert.equal(delivered.length, 0, 'mute applies to already queued completions');
notifier.dispose(); assert.equal(timers.size, 0);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentpaw-task-workflow-'));
const file = path.join(root, 'task-center.json');
let center = createTaskCenter({ file, now: () => time });
const session = { sessionId: 'thread-a', agent: 'codex', project: '敏感项目', projectKey: event('').projectKey,
  state: 'waiting', focusable: true, updatedAt: time };
const action = { actionId: 'request-a', sessionId: session.sessionId, state: 'waiting', choice: { sessionId: session.sessionId, project: session.project, question: '秘密内容' } };
const snapshot = { sessions: [session], actions: [action], waitingCount: 1 };
let decorated = center.sync(snapshot, notifications);
assert.equal(decorated.waitingCount, 1);
assert.equal(decorated.actions[0].notificationsMuted, true);
assert.equal(decorated.actions[0].choice.question, '秘密内容', 'muting never removes permission content');
assert.equal(decorated.recent.length, 1);
center.sync(snapshot, notifications);
assert.equal(center.sync(snapshot, notifications).recent.length, 1, 'polling does not duplicate history');
assert.equal(center.update(session.sessionId, { alias: '修登录', pinned: true }).ok, true);
assert.equal(center.update(session.sessionId, { pinned: false }).ok, true);
assert.equal(center.lookup(session.sessionId).alias, '修登录', 'following never overwrites an alias');
center.update(session.sessionId, { pinned: true });
center.update(session.sessionId, { alias: '修登录' });
assert.equal(center.lookup(session.sessionId).pinned, true, 'saving an alias never overwrites follow state');
decorated = center.sync(snapshot, notifications);
assert.equal(decorated.sessions[0].alias, '修登录');
assert.equal(decorated.actions[0].choice.project, '修登录');
assert.equal(decorated.recent[0].alias, '修登录');
const safe = protectStats(decorated, true);
assert(!JSON.stringify(safe).includes('敏感项目'));
assert(!JSON.stringify(safe).includes('修登录'));
assert(!JSON.stringify(safe).includes('秘密内容'));
assert.equal(center.markRead(decorated.recent.map(row => row.id)), true);
assert(center.sync(snapshot, notifications).recent.every(row => row.read));
assert(!fs.readFileSync(file, 'utf8').includes('秘密内容'), 'no questions, commands or chat text persisted');
center = createTaskCenter({ file, now: () => time });
decorated = center.sync({ sessions: [], actions: [] }, prefs.notifications());
assert.equal(decorated.sessions[0].alias, '修登录', 'followed session survives restart and live-session cleanup');
assert.equal(decorated.sessions[0].archived, true);
assert.equal(decorated.sessions[0].focusable, true);
assert.equal(center.update('unknown', { alias: '', pinned: true }).ok, false);
center.sync(snapshot, notifications); center.clear();
assert.equal(center.sync(snapshot, notifications).recent.length, 0, 'clear does not replay a still-pending request');
for (let i = 0; i < 105; i++) center.record({ ...session, kind: 'done', eventKey: String(i), ts: time });
assert.equal(center.sync(snapshot, notifications).recent.length, MAX_RECENT);
advance(RETENTION_MS + 1);
assert.equal(center.sync({ sessions: [], actions: [] }, notifications).recent.length, 0);
assert.notEqual(projectKey({ cwd: 'D:/one/app' }), projectKey({ cwd: 'D:/two/app' }));
assert.equal(projectKey({ cwd: 'D:\\one\\APP\\' }), projectKey({ cwd: 'd:/one/app' }));

const registered = new Map();
const occupied = new Set(['Ctrl+Alt+X']);
const api = {
  register(key, fn) { if (occupied.has(key)) return false; registered.set(key, fn); return true; },
  unregister(key) { registered.delete(key); },
};
const manager = createWorkflowShortcuts(api, { peek() {}, next() {}, toggle() {} });
const valid = { peek: 'Ctrl+Shift+Space', next: 'Ctrl+Shift+J', toggle: '' };
assert.equal(manager.configure(valid).ok, true);
assert.equal(manager.configure({ ...valid, next: 'Ctrl+Alt+X' }).ok, false);
assert.deepEqual([...registered.keys()], Object.values(valid).filter(Boolean), 'collision restores all old bindings');
assert(prefs.validateShortcuts({ ...valid, toggle: valid.peek }));
assert(prefs.validateShortcuts({ ...valid, toggle: 'A' }));
for (const shortcut of ['Ctrl+C', 'Ctrl+V', 'Ctrl+S', 'Ctrl+Space', 'Alt+F4', 'Alt+Space', 'Shift+A']) {
  assert(prefs.validateShortcuts({ ...valid, toggle: shortcut }), `reject common single-modifier shortcut: ${shortcut}`);
}
manager.setSuspended(true);
assert.equal(registered.size, 0, 'settings releases global keys so shortcut recording receives them');
assert.equal(manager.configure(valid).ok, true);
assert.equal(registered.size, 0, 'saving while editing keeps bindings suspended');
assert.equal(manager.configure({ ...valid, next: 'Ctrl+Alt+X' }).ok, false);
assert.equal(registered.size, 0, 'failed edits do not reactivate shortcuts while editing');
manager.setSuspended(false);
assert.deepEqual([...registered.keys()], Object.values(valid).filter(Boolean));
manager.setSuspended(true);
occupied.add(valid.peek);
manager.setSuspended(false);
assert(manager.errors().peek, 'a new conflict while settings is open is reported on resume');
assert(!registered.has(valid.peek));
occupied.delete(valid.peek);
assert.equal(manager.configure(prefs.shortcuts()).ok, true);
assert.equal(registered.size, 0);
manager.dispose();
const targets = [session, { ...session, sessionId: 'thread-b' }, { ...session, sessionId: 'dead', focusable: false }];
assert.equal(nextAttention(targets, '').sessionId, 'thread-a');
assert.equal(nextAttention(targets, 'thread-a').sessionId, 'thread-b');
assert.equal(nextAttention(targets, 'thread-b').sessionId, 'thread-a');
assert.equal(nextAttention([], ''), null);
assert.deepEqual(prefs.notifications({ mutedAgents: ['codex', 'bogus', 'codex'] }).mutedAgents, ['codex']);
fs.rmSync(root, { recursive: true, force: true });
console.log('Task notification, history, privacy, preference and shortcut checks passed');
