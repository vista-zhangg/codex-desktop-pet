'use strict';

// opencode plugin test. The plugin is ESM (Bun parses it at runtime under
// opencode), so Node tests import a .mjs copy via dynamic import. Home is
// redirected through USERPROFILE so the plugin writes/reads a temp ~/.agentpaw
// and the real machine is never touched. A local HTTP server captures the
// /state POSTs exactly like the pet's server would.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('node:url');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function until(fn, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await sleep(10);
  }
  return false;
}

const PLUGIN_SRC = path.join(__dirname, '..', 'hook', 'opencode-plugin.js');

async function testV2(plugin, home, token) {
  const runtime = path.join(home, '.agentpaw', 'runtime.json');
  const originalRuntime = fs.readFileSync(runtime);
  const usageFile = path.join(home, '.agentpaw', 'opencode-usage.jsonl');
  const got = [];
  const failures = [];
  const cleanups = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      got.push(JSON.parse(body));
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const writeRuntime = (port = server.address().port) => fs.writeFileSync(runtime,
    JSON.stringify({ app: 'agentpaw', port, token }));
  writeRuntime();
  const check = async (name, run) => {
    try { await run(); } catch (error) { failures.push(`${name}: ${error.message}`); }
  };
  const rows = (sid, event) => got.filter((body) => body.session_id === sid && (!event || body.event === event));
  const usage = () => fs.existsSync(usageFile) ? fs.readFileSync(usageFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  async function host(options = {}) {
    const callbacks = new Map();
    const registrations = [];
    const queue = [];
    const reads = [];
    let wake;
    let closed = false;
    let returns = 0;
    const iterator = {
      next() {
        if (closed) return Promise.resolve({ done: true });
        if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
        return new Promise((resolve) => { wake = resolve; });
      },
      return() {
        returns++;
        closed = true;
        if (wake) { wake({ done: true }); wake = undefined; }
        return options.hangingReturn ? new Promise(() => {}) : Promise.resolve({ done: true });
      },
    };
    const hook = (domain) => async (name, callback) => {
      if (options.reject === `${domain}.${name}`) throw new Error('unsupported hook');
      callbacks.set(`${domain}.${name}`, callback);
      const registration = { disposed: 0, dispose() { this.disposed++; } };
      registrations.push(registration);
      return registration;
    };
    const cleanup = await plugin.setup({
      location: { directory: home },
      tool: { hook: hook('tool') },
      session: {
        hook: hook('session'),
        async messages(input) {
          reads.push(input);
          if (options.readFailure) throw new Error('unavailable');
          if (options.read) return options.read(input);
          if (options.hangingRead) return new Promise(() => {});
          return { data: options.messages || [], cursor: { previous: null, next: null } };
        },
      },
      event: { subscribe: () => ({ [Symbol.asyncIterator]: () => iterator }) },
    });
    const dispose = () => typeof cleanup === 'function' ? cleanup() : cleanup.dispose();
    cleanups.push(dispose);
    return {
      cleanup, dispose, callbacks, registrations, reads,
      get returns() { return returns; },
      async emit(type, data, extra = {}) {
        const event = { id: `envelope-${Math.random()}`, type, data, location: { directory: home }, ...extra };
        if (wake) { const resolve = wake; wake = undefined; resolve({ done: false, value: event }); }
        else queue.push(event);
        await sleep(35);
      },
      async prompt(sessionID, messageID, text = 'mock prompt') {
        const callback = callbacks.get('session.prompt');
        if (callback) await callback({ sessionID, messageID, prompt: { text } });
        await sleep(35);
      },
      async tool(name, input) {
        const callback = callbacks.get(`tool.${name}`);
        if (callback) await callback(input);
        await sleep(35);
      },
    };
  }
  const tokens = { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 0 } };
  const message = (id, extra = {}) => ({
    id, type: 'assistant', time: { created: 1700000000000, completed: 1700000000010 },
    agent: 'mock', model: { id: 'mock-model', providerID: 'mock-provider' },
    content: [], finish: 'tool-calls', cost: 0, tokens, ...extra,
  });
  try {
    const h = await host({ messages: [message('real-a'), message('real-b'),
      message('incomplete', { time: { created: 1 }, finish: undefined }),
      message('missing-model', { model: undefined }), message('', {}),
      message('missing-tokens', { tokens: undefined, cost: undefined })] });
    await check('cleanup contract', () => assert.strictEqual(typeof h.cleanup, 'function'));
    await h.emit('session.created', { sessionID: 'v2-root', title: 'root' });
    await h.emit('session.created', { sessionID: 'v2-child', parentID: 'v2-root' });
    await h.emit('session.updated', { sessionID: 'v2-child', title: 'child update' });
    await h.emit('session.created', { sessionID: 'v2-child' });
    await check('root creation', () => {
      assert.strictEqual(rows('v2-root', 'SessionStart').length, 1);
      assert.strictEqual(rows('v2-child', 'SessionStart').length, 0);
    });
    await h.emit('session.created', { sessionID: 'v2-foreign' }, { location: { directory: home + '-other' } });
    await h.emit('session.execution.started', { sessionID: 'v2-foreign' }, { location: undefined });
    await check('directory ownership', () => assert.strictEqual(rows('v2-foreign').length, 0));
    await h.prompt('v2-root', 'user-real');
    await h.emit('session.execution.started', { sessionID: 'v2-root' });
    await h.emit('session.next.text.started', { sessionID: 'v2-root', messageID: 'text-real' });
    await h.emit('session.next.text.delta', { sessionID: 'v2-root', delta: 'hello ' });
    await h.emit('session.next.text.delta', { sessionID: 'v2-root', delta: 'world' });
    await h.emit('session.next.text.ended', { sessionID: 'v2-root', text: 'replacement' });
    await h.emit('session.next.text.started', { sessionID: 'v2-root', messageID: 'text-second' });
    await h.emit('session.next.text.delta', { sessionID: 'v2-root', delta: 'retained' });
    await h.emit('session.next.text.ended', { sessionID: 'v2-root' });
    await h.emit('session.usage.updated', { sessionID: 'v2-root', tokens, timestamp: 123 });
    await h.emit('session.usage.updated', { sessionID: 'v2-root', tokens: { ...tokens, input: 100 }, timestamp: 124 });
    await h.emit('session.step.ended', { sessionID: 'v2-root', tokens });
    await check('step is not completion', () => assert.strictEqual(rows('v2-root', 'Stop').length, 0));
    await h.emit('session.execution.succeeded', { sessionID: 'v2-root' });
    await h.emit('session.execution.succeeded', { sessionID: 'v2-root' });
    await check('prompt and terminal output', () => {
      assert.strictEqual(rows('v2-root', 'UserPromptSubmit').length, 1);
      assert.strictEqual(rows('v2-root', 'UserPromptSubmit')[0].session_title, 'mock prompt');
      assert.strictEqual(rows('v2-root', 'Stop').length, 1);
      assert.strictEqual(rows('v2-root', 'Stop')[0].assistant_last_output, 'replacement\nretained');
    });
    await check('durable usage IDs, zero cost and replay', () => {
      assert.deepStrictEqual(usage().map((row) => row.message_id).sort(), ['real-a', 'real-b']);
      assert(usage().every((row) => row.cost === 0 && row.model === 'mock-model' && row.provider === 'mock-provider' && row.ts === 1700000000010));
      assert(h.reads.length > 0);
      assert(h.reads.every((input) => input.sessionID === 'v2-root' && input.order === 'desc' && input.limit > 0 && input.limit <= 100));
    });
    await h.emit('session.execution.started', { sessionID: 'v2-abort' });
    await h.emit('session.execution.interrupted', { sessionID: 'v2-abort' });
    await h.emit('session.execution.succeeded', { sessionID: 'v2-abort' });
    await check('interrupt does not celebrate', () => {
      assert.strictEqual(rows('v2-abort', 'Stop').length, 0);
      assert.strictEqual(rows('v2-abort', 'TurnAborted')[0].state, 'idle');
    });
    await h.emit('session.execution.started', { sessionID: 'v2-fail' });
    await h.emit('session.execution.failed', { sessionID: 'v2-fail', error: { message: 'mock failure' } });
    await check('execution failure', () => assert.strictEqual(rows('v2-fail', 'StopFailure')[0].api_error_type, 'mock failure'));
    await h.tool('execute.before', { sessionID: 'v2-tools', tool: 'subagent', id: 'call', messageID: 'msg', input: {} });
    await h.tool('execute.after', { sessionID: 'v2-tools', tool: 'subagent', id: 'call', messageID: 'msg', status: 'error', error: 'mock tool error' });
    await check('subagent and after error', () => {
      assert.strictEqual(rows('v2-tools', 'PreToolUse')[0].state, 'juggling');
      assert.strictEqual(rows('v2-tools', 'PostToolUseFailure')[0].state, 'error');
    });
    await h.emit('form.created', { form: { sessionID: 'v2-wait', id: 'f1', fields: [] } });
    await h.emit('permission.asked', { sessionID: 'v2-wait', id: 'p1', action: 'read', resources: [] });
    await h.emit('permission.asked', { sessionID: 'v2-wait', id: 'p2', action: 'read', resources: [] });
    await h.emit('form.replied', { sessionID: 'v2-wait', id: 'f1', answer: {} });
    await h.emit('permission.replied', { sessionID: 'v2-wait', requestID: 'p1', reply: 'once' });
    await h.emit('session.execution.succeeded', { sessionID: 'v2-wait' });
    await check('multiple waits', () => {
      assert(rows('v2-wait', 'Notification').length > 0);
      assert.strictEqual(rows('v2-wait', 'ElicitationResult').length, 0);
      assert.strictEqual(rows('v2-wait', 'Stop').length, 0);
    });
    await h.emit('permission.replied', { sessionID: 'v2-wait', requestID: 'p2', reply: 'once' });
    await check('last wait resumes', () => assert.strictEqual(rows('v2-wait', 'ElicitationResult').length, 1));
    await h.emit('session.deleted', { sessionID: 'v2-wait' });
    await h.emit('session.execution.started', { sessionID: 'v2-wait' });
    await check('deletion clears waits', () => assert.strictEqual(rows('v2-wait', 'UserPromptSubmit').length, 1));
    await h.dispose();
    await h.dispose();
    await h.prompt('v2-disposed', 'disposed');
    await check('cleanup idempotent and unregisters', () => {
      assert.strictEqual(h.returns, 1);
      assert(h.registrations.every((r) => r.disposed === 1));
      assert.strictEqual(rows('v2-disposed').length, 0);
    });
    const fallback = await host({ reject: 'session.prompt', hangingReturn: true, readFailure: true }).catch((error) => {
      failures.push(`registration rejection: ${error.message}`);
    });
    if (fallback) {
      await fallback.emit('session.execution.started', { sessionID: 'v2-fallback' });
      await fallback.emit('session.execution.succeeded', { sessionID: 'v2-fallback' });
      await check('rejected prompt recovers from execution', () => assert.strictEqual(rows('v2-fallback', 'UserPromptSubmit').length, 1));
      await check('nonblocking iterator cleanup', async () => assert(await Promise.race([fallback.dispose().then(() => true), sleep(1200).then(() => false)])));
      assert(fallback.registrations.every((r) => r.disposed === 1));
    }
    const partial = await host({ reject: 'tool.execute.before' }).catch((error) => {
      failures.push(`partial registration rejection: ${error.message}`);
    });
    if (partial) {
      await check('remaining registrations retained', () => assert(partial.callbacks.has('tool.execute.after') && partial.callbacks.has('session.prompt')));
      await partial.dispose();
    }
    const missing = await host({ hangingRead: true });
    fs.rmSync(runtime);
    await missing.emit('session.execution.started', { sessionID: 'v2-no-runtime' });
    await check('runtime missing', () => assert.strictEqual(rows('v2-no-runtime').length, 0));
    writeRuntime(1);
    await missing.emit('session.execution.started', { sessionID: 'v2-offline' });
    await missing.emit('session.step.ended', { sessionID: 'v2-offline' });
    await check('hanging read cleanup', async () => assert(await Promise.race([missing.dispose().then(() => true), sleep(1200).then(() => false)])));
    writeRuntime();
    const paged = await host({ read: async (input) => ({
      data: input.cursor ? [message('page-older')] : [message('page-newer')],
      cursor: { previous: null, next: input.cursor ? null : 'older-page' },
    }) });
    await paged.emit('session.step.ended', { sessionID: 'v2-page' });
    await paged.emit('session.step.ended', { sessionID: 'v2-page' });
    await check('pagination and repeated step', () => {
      assert.strictEqual(usage().filter((row) => row.session_id === 'v2-page').length, 2);
      assert(paged.reads.some((input) => input.cursor === 'older-page' && !('order' in input)));
    });
    await paged.dispose();
    let resolveRead;
    const late = await host({ read: () => new Promise((resolve) => { resolveRead = resolve; }) });
    await late.emit('session.step.ended', { sessionID: 'v2-late' });
    await late.dispose();
    resolveRead({ data: [message('late-record')], cursor: { next: null } });
    await sleep(40);
    await check('no writes after cleanup', () => assert(!usage().some((row) => row.message_id === 'late-record')));
    const empty = await host();
    await empty.prompt('v2-empty', 'empty-user');
    await empty.emit('session.next.text.started', { sessionID: 'v2-empty', messageID: 'empty-text' });
    await empty.emit('session.next.text.delta', { sessionID: 'v2-empty', delta: 'stale' });
    await empty.emit('session.next.text.ended', { sessionID: 'v2-empty', text: '' });
    await empty.emit('session.execution.succeeded', { sessionID: 'v2-empty' });
    await check('empty ended snapshot replaces text', () => assert(!rows('v2-empty', 'Stop')[0].assistant_last_output));
    await empty.dispose();
    await check('absent context and subscription failure', async () => {
      const absent = await plugin.setup();
      await absent();
      const broken = await plugin.setup({ location: { directory: home }, event: { subscribe() { throw new Error('unavailable'); } } });
      await broken();
    });
  } finally {
    for (const dispose of cleanups) await Promise.race([dispose(), sleep(1200)]);
    await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(runtime, originalRuntime);
    if (fs.existsSync(usageFile)) fs.rmSync(usageFile);
  }
  assert.deepStrictEqual(failures, [], 'v2 driven behavior failures');
  console.log('v2 driven event/hook capture checks passed');
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentpaw-opencode-plugin-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.agentpaw'), { recursive: true });

  // ── capture server ──────────────────────────────────────────────────────
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      got.push({ path: req.url, token: req.headers['x-agentpaw-token'], body: (() => { try { return JSON.parse(body); } catch { return null; } })() });
      res.writeHead(200, { 'x-agentpaw-server': 'agentpaw' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const token = 'a'.repeat(64);

  // ── plugin under test (imported after USERPROFILE redirect) ─────────────
  const oldProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = home;
  fs.writeFileSync(path.join(home, '.agentpaw', 'runtime.json'),
    JSON.stringify({ app: 'agentpaw', port, token }));
  const tmpPlugin = path.join(root, 'opencode-plugin.mjs');
  fs.copyFileSync(PLUGIN_SRC, tmpPlugin);
  const mod = await import(pathToFileURL(tmpPlugin).href);
  assert(mod.default, 'v2 default plugin definition is required');
  assert.strictEqual(mod.default.id, 'agentpaw-opencode');
  assert.strictEqual(typeof mod.default.setup, 'function');

  await testV2(mod.default, home, token);

  const hooks = await mod.AgentPawOpenCodePlugin({ directory: home });
  assert.strictEqual(typeof hooks.event, 'function');
  assert.strictEqual(typeof hooks['tool.execute.before'], 'function');
  assert.strictEqual(typeof hooks['tool.execute.after'], 'function');
  assert.strictEqual(typeof hooks.dispose, 'function');

  const ev = (type, properties) => hooks.event({ event: { type, properties } });

  // ── drive a realistic session ───────────────────────────────────────────
  await ev('session.created', { info: { id: 'sess-1', directory: 'C:\\proj', title: '' } });
  await until(() => got.some((r) => r.body && r.body.event === 'SessionStart'));
  const start = got.find((r) => r.body && r.body.event === 'SessionStart').body;
  assert.strictEqual(start.state, 'idle');
  assert.strictEqual(start.session_id, 'sess-1');
  assert.strictEqual(start.agent_id, 'opencode');
  assert.strictEqual(start.source_pid, process.pid, 'plugin reports its running service PID for desktop focus');
  assert.strictEqual(start.cwd, 'C:\\proj');
  assert.strictEqual(got[0].token, token, 'x-agentpaw-token header sent');

  // user prompt: part streams in first, then message.updated
  await ev('message.part.updated', { part: { sessionID: 'sess-1', messageID: 'msg-u1', part: { type: 'text', text: '帮我看看这个 bug' } } });
  await ev('message.updated', { info: { id: 'msg-u1', sessionID: 'sess-1', role: 'user', time: { created: 1 } } });
  await until(() => got.some((r) => r.body && r.body.event === 'UserPromptSubmit'));
  const prompt = got.find((r) => r.body && r.body.event === 'UserPromptSubmit').body;
  assert.strictEqual(prompt.state, 'thinking');
  assert.strictEqual(prompt.session_title, '帮我看看这个 bug', 'user text becomes the session title');

  // tool round
  await hooks['tool.execute.before']({ tool: { type: 'command', raw: { command: 'ls' } }, sessionID: 'sess-1', callID: 'c1' });
  await hooks['tool.execute.after']({ tool: { type: 'command', raw: { command: 'ls' } }, sessionID: 'sess-1', callID: 'c1' });
  await until(() => got.some((r) => r.body && r.body.event === 'PreToolUse'));
  const pre = got.find((r) => r.body && r.body.event === 'PreToolUse').body;
  assert.strictEqual(pre.state, 'working');
  assert.strictEqual(pre.tool_name, 'Bash', 'command tool maps to Bash');
  assert(got.some((r) => r.body && r.body.event === 'PostToolUse' && r.body.tool_name === 'Bash'));

  // assistant answer: message created → text streams → finished with cost/tokens
  await ev('message.updated', {
    info: { id: 'msg-a1', sessionID: 'sess-1', role: 'assistant', modelID: 'gpt-5.6-codex', providerID: 'openai' },
  });
  await ev('message.part.updated', { part: { sessionID: 'sess-1', messageID: 'msg-a1', part: { type: 'text', text: 'done!' } } });
  await ev('message.updated', {
    info: {
      id: 'msg-a1', sessionID: 'sess-1', role: 'assistant', modelID: 'gpt-5.6-codex', providerID: 'openai',
      cost: 0.123, tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 30, write: 20 } },
      finish: 'done', path: { cwd: 'C:\\proj' },
    },
  });
  await until(() => got.some((r) => r.body && r.body.event === 'Stop'));
  const stop = got.find((r) => r.body && r.body.event === 'Stop').body;
  assert.strictEqual(stop.state, 'attention');
  assert.strictEqual(stop.model, 'gpt-5.6-codex');
  assert.strictEqual(stop.assistant_last_output, 'done!', 'streamed text tail attached to Stop');

  // usage line landed exactly once
  const usageFile = path.join(home, '.agentpaw', 'opencode-usage.jsonl');
  assert(await until(() => fs.existsSync(usageFile)), 'usage file created');
  let lines = fs.readFileSync(usageFile, 'utf8').trim().split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, 'one usage line per finished message');
  const usage = JSON.parse(lines[0]);
  assert.strictEqual(usage.v, 1);
  assert.strictEqual(usage.session_id, 'sess-1');
  assert.strictEqual(usage.message_id, 'msg-a1');
  assert.strictEqual(usage.model, 'gpt-5.6-codex');
  assert.strictEqual(usage.cost, 0.123);
  assert.deepStrictEqual(usage.tokens, { input: 100, output: 50, reasoning: 10, cacheRead: 30, cacheWrite: 20 });

  // same message again (streaming re-fire) must not double-log
  await ev('message.updated', {
    info: { id: 'msg-a1', sessionID: 'sess-1', role: 'assistant', modelID: 'gpt-5.6-codex', cost: 0.123, tokens: { input: 100, output: 50 }, finish: 'done' },
  });
  await sleep(150);
  lines = fs.readFileSync(usageFile, 'utf8').trim().split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, 're-fired message must not double-log');

  // ── replay guard: opencode re-emits existing messages when a session is
  // reloaded/synced (assistant finish first, then the user message last). Those
  // replays must never re-post thinking/Stop — otherwise the cat is left stuck
  // in "thinking" right after every finished answer.
  await sleep(400); // past the 300ms post-dedupe window
  await ev('message.updated', { info: { id: 'msg-u1', sessionID: 'sess-1', role: 'user', time: { created: 1 } } });
  await ev('message.updated', {
    info: { id: 'msg-a1', sessionID: 'sess-1', role: 'assistant', modelID: 'gpt-5.6-codex', cost: 0.123, tokens: { input: 100, output: 50 }, finish: 'done' },
  });
  await sleep(150);
  assert.strictEqual(got.filter((r) => r.body && r.body.event === 'UserPromptSubmit').length, 1, 'replayed user message must not re-post thinking');
  assert.strictEqual(got.filter((r) => r.body && r.body.event === 'Stop').length, 1, 'replayed finished message must not re-post Stop');

  // Completion is semantic, not just a 300ms debounce.
  await sleep(400); // let the finish-Stop dedupe window expire
  await ev('session.idle', { sessionID: 'sess-1' });
  await sleep(100);
  assert.strictEqual(got.filter((r) => r.body && r.body.event === 'Stop').length, 1, 'idle does not repeat completion');

  // permission wait → notification
  await ev('permission.updated', { sessionID: 'sess-1', permission: { id: 'p1' } });
  await until(() => got.some((r) => r.body && r.body.event === 'Notification'));
  assert.strictEqual(got.find((r) => r.body && r.body.event === 'Notification').body.state, 'notification');

  // session error → error
  await ev('session.error', { sessionID: 'sess-1', error: { message: 'boom' } });
  await until(() => got.some((r) => r.body && r.body.event === 'StopFailure'));
  const err = got.find((r) => r.body && r.body.event === 'StopFailure').body;
  assert.strictEqual(err.state, 'error');
  assert.strictEqual(err.api_error_type, 'boom');

  const stopsBefore = got.filter((r) => r.body.event === 'Stop').length;
  await ev('session.idle', { sessionID: 'sess-1' });
  await ev('permission.asked', { sessionID: 'sess-3', id: 'permission-1' });
  await ev('session.idle', { sessionID: 'sess-3' });
  await until(() => got.some((r) => r.body.session_id === 'sess-3'));
  assert.strictEqual(got.find((r) => r.body.session_id === 'sess-3').body.state, 'notification');
  await ev('permission.replied', { sessionID: 'sess-3', reply: 'once' });
  await hooks['tool.execute.before']({ tool: 'bash', sessionID: 'sess-3', callID: 'real-bash' });
  await until(() => got.some((r) => r.body.session_id === 'sess-3' && r.body.tool_name === 'Bash'));
  await ev('message.updated', { info: {
    id: 'tool-message', sessionID: 'sess-3', role: 'assistant', finish: 'tool-calls',
    modelID: 'free-model', cost: 0, tokens: { input: 10, output: 5 }, time: { completed: 1700000000000 },
  } });
  await sleep(100);
  assert.strictEqual(got.filter((r) => r.body.event === 'Stop').length, stopsBefore,
    'tool steps, permission waits and error idle do not emit completion');
  const toolUsage = fs.readFileSync(usageFile, 'utf8').trim().split('\n').map(JSON.parse)
    .find((r) => r.message_id === 'tool-message');
  assert.strictEqual(toolUsage.ts, 1700000000000, 'usage uses completion time, not replay time');
  assert.strictEqual(toolUsage.cost, 0, 'explicit zero cost is preserved');
  await hooks['tool.execute.before']({ tool: 'task', sessionID: 'sess-3', callID: 'child' });
  await until(() => got.some((r) => r.body.session_id === 'sess-3' && r.body.state === 'juggling'));
  assert(got.some((r) => r.body.tool_name === 'Agent' && r.body.state === 'juggling'));
  await ev('message.part.updated', { part: { id: 'text-3', messageID: 'tool-message', sessionID: 'sess-3', text: 'hello' } });
  await ev('message.part.updated', { part: { id: 'text-3', messageID: 'tool-message', sessionID: 'sess-3', text: 'hello world' } });
  await ev('session.idle', { sessionID: 'sess-3' });
  await until(() => got.some((r) => r.body.session_id === 'sess-3' && r.body.event === 'Stop'));
  assert.strictEqual(got.find((r) => r.body.session_id === 'sess-3' && r.body.event === 'Stop').body.assistant_last_output,
    'hello world', 'full text updates replace the same part instead of concatenating duplicates');

  // no pet running (runtime.json gone) → everything stays silent, no throw
  fs.rmSync(path.join(home, '.agentpaw', 'runtime.json'));
  await ev('session.created', { info: { id: 'sess-2', directory: 'C:\\x', title: '' } });
  await hooks['tool.execute.before']({ tool: { type: 'command', raw: {} }, sessionID: 'sess-2', callID: 'c2' });
  await sleep(100);
  assert(!got.some((r) => r.body && r.body.session_id === 'sess-2'), 'no POST without runtime');

  await new Promise((resolve) => server.close(resolve));

  // ── installer (fresh require with another redirected home) ───────────────
  const home2 = path.join(root, 'home2');
  process.env.USERPROFILE = home2;
  const installer = require('../backend/opencode-install');
  let res = installer.registerHooks();
  assert.strictEqual(res.added, 1);
  const installed = path.join(home2, '.config', 'opencode', 'plugins', 'opencode-plugin.js');
  assert(fs.existsSync(installed), 'plugin copied into plugins dir');
  assert(fs.readFileSync(installed, 'utf8').includes('agentpaw-opencode-plugin'));
  assert.strictEqual(installer.hooksCurrent(), true);
  res = installer.registerHooks();
  assert.strictEqual(res.skipped, 1, 'idempotent install');
  res = installer.unregisterHooks({ backup: true });
  assert.strictEqual(res.removed, 1);
  assert(!fs.existsSync(installed), 'plugin removed');
  assert(res.backupPath && fs.existsSync(res.backupPath), 'backup kept');
  assert.strictEqual(installer.hooksCurrent(), false);
  assert.strictEqual(installer.unregisterHooks({ backup: true }).removed, 0, 'second uninstall is a no-op');

  if (oldProfile !== undefined) process.env.USERPROFILE = oldProfile;
  fs.rmSync(root, { recursive: true, force: true });
  console.log('opencode plugin checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
