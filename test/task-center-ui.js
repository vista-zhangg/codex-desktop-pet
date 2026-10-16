'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createStubWorld } = require('./dom-stub');
const { t } = require('../shared/i18n');

const world = createStubWorld();
const { sandbox, window, elements } = world;
const requests = [];
let command;
let fail = false;
let complete;
let closeRadialCalls = 0;
const snapshot = (recent, waitingCount = 0) => ({ recent, sessions: [], waitingCount });
const row = id => ({ id, at: Date.now(), kind: 'done', project: id, focusable: true, read: false });
Object.assign(sandbox, {
  actionPopOpen: false, actionPop: elements('action-pop'), lastStats: snapshot([row('a')]),
  actionableItems: () => [], fitPopup() {}, peekAgentLabel: () => 'Codex',
  PEEK_BUSY_STATES: new Set(), radialOpen: false, askActive: false,
  closeRadial() { closeRadialCalls++; sandbox.radialOpen = false; },
  openActionPop(initialTab) { sandbox.actionPopOpen = true; window.AgentPawTaskCenter.opened(initialTab); },
  closeActionPop() { sandbox.actionPopOpen = false; window.AgentPawTaskCenter.closed(); },
});
window.pet.onWorkflowCommand = handler => { command = handler; };
window.pet.markRecentRead = ids => {
  requests.push(Array.from(ids));
  return new Promise(resolve => {
    complete = () => {
      if (!fail) {
        sandbox.lastStats = { ...sandbox.lastStats, recent: sandbox.lastStats.recent.map(item => ids.includes(item.id) ? { ...item, read: true } : item) };
        window.AgentPawTaskCenter.render(sandbox.lastStats);
      }
      resolve({ ok: !fail });
    };
  });
};
let focused = 0, cleared = 0;
window.pet.focusRecent = async () => { focused++; return true; };
window.pet.clearRecent = async () => { cleared++; return { ok: true }; };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/task-center.js'), 'utf8'), sandbox);
const center = window.AgentPawTaskCenter;
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const click = name => elements('ac-tab-' + name).dispatch('click');

(async () => {
  center.render(sandbox.lastStats);
  await flush();
  assert.equal(requests.length, 0, 'hidden rendering never reads history');
  assert.equal(t('sess.more', { count: 3 }), '另有 3 个会话，打开会话列表');
  sandbox.openActionPop('sessions');
  await flush();
  assert.equal(elements('ac-tab-sessions').getAttribute('aria-selected'), 'true', 'opening sessions selects sessions without reading recent');
  assert.equal(requests.length, 0, 'opening sessions does not acknowledge recent history');
  click('recent'); click('recent');
  await flush();
  assert.deepEqual(requests, [['a']], 'opening recent acknowledges once even with a repeated click');
  sandbox.lastStats = snapshot([row('b'), row('a')]);
  center.render(sandbox.lastStats);
  await flush();
  assert.equal(requests.length, 1, 'new arrivals do not trigger automatic reads');
  complete(); await flush();
  assert.equal(sandbox.lastStats.recent[0].read, false, 'in-flight acknowledgement excludes later records');
  assert.equal(sandbox.lastStats.recent[1].read, true);
  click('sessions'); await flush();
  assert.equal(requests.length, 1, 'sessions tab does not read recent history');
  elements('ac-tab-sessions').dispatch('keydown', { key: 'ArrowLeft', preventDefault() {} });
  await flush();
  assert.deepEqual(requests[1], ['b'], 'keyboard navigation also acknowledges history');
  complete(); await flush();
  sandbox.closeActionPop();
  sandbox.lastStats = snapshot([row('c')], 1);
  sandbox.openActionPop(); await flush();
  assert.equal(elements('ac-tab-actions').getAttribute('aria-selected'), 'true');
  assert.equal(requests.length, 2, 'opening pending actions does not clear history');
  click('recent'); await flush(); complete(); await flush();
  assert.equal(sandbox.lastStats.waitingCount, 1, 'reading history never resolves pending work');
  assert.equal(elements('ac-tab-actions').textContent, '待处理 1');
  sandbox.closeActionPop();
  sandbox.lastStats = snapshot([row('d')]);
  command('actions'); await flush();
  assert.equal(requests.length, 3, 'actions shortcut does not acknowledge the intermediate default recent tab');
  click('recent'); sandbox.closeActionPop(); await flush();
  assert.equal(requests.length, 3, 'closing before acknowledgement cancels it');
  sandbox.openActionPop(); await flush();
  fail = true; complete(); await flush();
  assert.equal(sandbox.lastStats.recent[0].read, false, 'failed persistence preserves unread state');
  assert(elements('ac-status').textContent.includes('保存失败'));
  click('sessions'); click('recent'); await flush();
  fail = false; complete(); await flush();
  assert.equal(sandbox.lastStats.recent[0].read, true, 're-entering retries failed persistence');
  assert.equal(elements('ac-status').textContent, '', 'successful retry clears its error');
  // Existing commands remain usable even while an automatic read is in flight.
  sandbox.lastStats = snapshot([row('e')]); center.render(sandbox.lastStats);
  click('recent'); await flush();
  const card = elements('ac-recent-list').children[0];
  const controls = card.children[2];
  assert.equal(controls.children.length, 1, 'only the session action remains in a history card');
  controls.children[0].dispatch('click'); await flush();
  assert.equal(focused, 1); assert.equal(sandbox.actionPopOpen, false);
  complete(); await flush();
  elements('ac-clear-recent').dispatch('click'); await flush();
  assert.equal(cleared, 1, 'clear remains available');

  sandbox.lastStats = snapshot([row('overflow')], 2);
  sandbox.radialOpen = true;
  const requestCount = requests.length;
  center.openSessions();
  assert.equal(sandbox.actionPopOpen, true, 'overflow opens the action center synchronously');
  assert.equal(sandbox.radialOpen, false, 'overflow closes the radial menu');
  assert.equal(closeRadialCalls, 1);
  assert.equal(elements('ac-tab-sessions').getAttribute('aria-selected'), 'true');
  await flush();
  assert.equal(requests.length, requestCount, 'overflow does not read history or resolve pending work');
  assert.equal(sandbox.lastStats.waitingCount, 2);
  assert.equal(sandbox.lastStats.recent[0].read, false);
  click('recent');
  center.openSessions();
  await flush();
  assert.equal(elements('ac-tab-sessions').getAttribute('aria-selected'), 'true', 'overflow switches an already open center to sessions');
  assert.equal(requests.length, requestCount, 'sessions selection cancels a queued recent acknowledgement');
  sandbox.closeActionPop();
  sandbox.lastStats = snapshot([row('default')]);
  sandbox.radialOpen = true;
  const open = sandbox.openActionPop;
  sandbox.openActionPop = initialTab => {
    assert.equal(elements('ac-tab-sessions').getAttribute('aria-selected'), 'true', 'sessions is selected before opening the popup');
    assert.equal(sandbox.radialOpen, false, 'radial closes before the action center opens');
    assert.equal(initialTab, 'sessions', 'overflow passes sessions as the preferred opening tab');
    open(initialTab);
  };
  center.openSessions();
  sandbox.openActionPop = open;
  await flush();
  assert.equal(requests.length, requestCount, 'overflow overrides the default recent tab');
  sandbox.closeActionPop();
  sandbox.openActionPop('unexpected');
  await flush();
  assert.equal(elements('ac-tab-recent').getAttribute('aria-selected'), 'true', 'unsupported preferred tabs retain default selection');
  assert.equal(requests.length, requestCount + 1);
  complete(); await flush();
  console.log('Task center automatic read, sessions overflow, navigation, failure and action isolation checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
