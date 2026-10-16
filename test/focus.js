'use strict';

const assert = require('assert');
const { codexThreadUrl, focusSession, selectDesktopPid } = require('../backend/focus');
const adapter = require('../backend/adapter');

async function run() {
  assert.strictEqual(
    codexThreadUrl({ id: '019fe5c2-6cb3-7713-8feb-846d1882fcb6', agentId: 'codex' }),
    'codex://threads/019fe5c2-6cb3-7713-8feb-846d1882fcb6',
    'Codex sessions should map to their exact Desktop thread deep link',
  );
  assert.strictEqual(codexThreadUrl({ id: 'bad/path', agentId: 'codex' }), null);
  assert.strictEqual(codexThreadUrl({ id: 'abc', agentId: 'claude-code' }), null);

  const opened = [];
  const codexResult = await focusSession(
    { id: 'thread-123', agentId: 'codex', sourcePid: null },
    {
      openExternal: async (url) => opened.push(url),
      activatePids: async () => { throw new Error('PID fallback should not run'); },
    },
  );
  assert.strictEqual(codexResult, true);
  assert.deepStrictEqual(opened, ['codex://threads/thread-123']);

  let fallbackPids = null;
  const fallbackResult = await focusSession(
    { id: 'thread-456', agentId: 'codex', sourcePid: 42, pidChain: [42, 84] },
    {
      openExternal: async () => { throw new Error('protocol unavailable'); },
      activatePids: async (pids) => { fallbackPids = pids; return 84; },
    },
  );
  assert.strictEqual(fallbackResult, true);
  assert.deepStrictEqual(fallbackPids, [42, 84], 'protocol failure should preserve deduplicated PID fallback');

  let terminalPids = null;
  const terminalResult = await focusSession(
    { id: 'claude-1', agentId: 'claude-code', sourcePid: 10, pidChain: [20, 10] },
    { activatePids: async (pids) => { terminalPids = pids; return false; } },
  );
  assert.strictEqual(terminalResult, false);
  assert.deepStrictEqual(terminalPids, [10, 20], 'non-Codex sessions should keep the existing PID focus path');

  const processes = [
    { pid: 10, parentPid: 20, name: 'opencode', window: false },
    { pid: 20, parentPid: 1, name: 'OpenChamber', window: true },
    { pid: 30, parentPid: 1, name: 'OpenChamber', window: true },
    { pid: 40, parentPid: 50, name: 'ZCode', window: false },
    { pid: 50, parentPid: 1, name: 'ZCode', window: true },
  ];
  assert.strictEqual(selectDesktopPid('opencode', [10], processes), 20, 'use the OpenChamber ancestor of the opencode service');
  assert.strictEqual(selectDesktopPid('opencode', [], processes), null, 'ambiguous desktop windows must not be chosen arbitrarily');
  assert.strictEqual(selectDesktopPid('zcode', [40], processes), 50, 'ZCode worker resolves to its UI ancestor');
  assert.strictEqual(selectDesktopPid('zcode', [], processes), 50, 'history-only session can use a unique existing ZCode window');
  assert.strictEqual(selectDesktopPid('opencode', [], processes.filter(p => p.pid !== 20 && p.pid !== 30)), null);
  assert.strictEqual(selectDesktopPid('opencode', [50], processes), null, 'unrelated window is never an OpenChamber target');
  assert.strictEqual(selectDesktopPid('opencode', [99999], processes), null, 'stale PID cannot disambiguate multiple windows');
  assert.strictEqual(selectDesktopPid('opencode', [], [{ pid: 30, name: 'OpenChamber', window: false }]), null,
    'window discovery excludes another user or desktop session');
  assert.strictEqual(selectDesktopPid('opencode', [10], [
    { pid: 10, parentPid: 11, name: 'opencode', window: false },
    { pid: 11, parentPid: 10, name: 'node', window: false },
  ]), null, 'cyclic parent chain terminates without a target');
  let desktopAgent;
  assert.strictEqual(await focusSession({ agentId: 'zcode' }, {
    activateDesktop: async (agent, pids) => { desktopAgent = agent; assert.deepStrictEqual(pids, []); return 50; },
    activatePids: async () => { throw new Error('desktop success must skip generic PID fallback'); },
  }), true);
  assert.strictEqual(desktopAgent, 'zcode');
  assert.strictEqual(await focusSession({ agentId: 'opencode', sourcePid: 10 }, {
    activateDesktop: async () => { throw new Error('query failed'); },
    activatePids: async () => false,
  }), false, 'desktop query failure must degrade gracefully');
  let cliPids;
  assert.strictEqual(await focusSession({ agentId: 'opencode', sourcePid: 10, pidChain: [20] }, {
    activateDesktop: async () => false,
    activatePids: async pids => { cliPids = pids; return 20; },
  }), true, 'standalone OpenCode keeps terminal PID focus when no desktop is found');
  assert.deepStrictEqual(cliPids, [10, 20]);
  assert.strictEqual(await focusSession(null, { activatePids: async () => true }), false);

  const stats = adapter.buildPetStats({
    active: null,
    sessions: [
      { id: 'codex-1', agentId: 'codex', state: 'working', updatedAt: Date.now() },
      { id: 'claude-1', agentId: 'claude-code', state: 'working', sourcePid: 100, updatedAt: Date.now() },
      { id: 'trae-1', agentId: 'trae', state: 'working', pidChain: [200], updatedAt: Date.now() },
      { id: 'workbuddy-1', agentId: 'workbuddy', state: 'working', sourcePid: 300, updatedAt: Date.now() },
      { id: 'opencode-1', agentId: 'opencode', state: 'working', updatedAt: Date.now() },
      { id: 'zcode-1', agentId: 'zcode', state: 'working', updatedAt: Date.now() },
    ],
  }, [], null, {});
  const focusable = Object.fromEntries(stats.sessions.map((s) => [s.agent, s.focusable]));
  assert.deepStrictEqual(focusable, {
    codex: true,
    claude: true,
    trae: true,
    workbuddy: true,
    opencode: true,
    zcode: true,
  }, 'desktop-backed sessions can attempt existing-window discovery');

  console.log('Session focus checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
