// 打工伙伴 AgentPaw — opencode 状态/用量插件（自包含，无任何外部依赖）。
//
// 由 opencode-install.js 复制到 ~/.config/opencode/plugins/opencode-plugin.js
// 后，opencode 的插件运行时（Bun）会自动加载并调用导出对象上的钩子。
//
// 职责：
//   1. 把 opencode 事件流翻译成打工伙伴 /state 协议（POST 127.0.0.1:<port>/state，
//      身份头 x-agentpaw-token，端口/令牌读自 ~/.agentpaw/runtime.json）；
//   2. 每个完成的 assistant 消息把用量行追加写入
//      ~/.agentpaw/opencode-usage.jsonl，供打工伙伴 opencode-metering 增量读取。
//
// 铁律（与 agentpaw-hook.js 一致）：永远不抛错、永远不阻塞 agent —— 所有
// 失败（宠物没开、端口变化、磁盘异常）都静默吞掉。插件是给 agent 用的，
// 任何异常都只能由打工伙伴自己兜底，绝不能反过来拖慢/弄崩 opencode。
//
// marker: agentpaw-opencode-plugin

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';

const AGENT_ID = 'opencode';
const AGENTPAW_DIR = path.join(os.homedir(), '.agentpaw');
const RUNTIME_PATH = path.join(AGENTPAW_DIR, 'runtime.json');
const USAGE_PATH = path.join(AGENTPAW_DIR, 'opencode-usage.jsonl');
const STATE_PATH = '/state';
const TOKEN_HEADER = 'x-agentpaw-token';
const POST_TIMEOUT_MS = 500;
const LAST_OUTPUT_MAX = 2400;   // 与 server 的 ASSISTANT_LAST_OUTPUT_MAX 对齐
const MAX_BODY_BYTES = 16384;   // 与 server 的 MAX_STATE_BODY_BYTES 对齐

// opencode 工具类型 → 打工伙伴词汇（未知类型原样首字母大写兜底）。
const TOOL_NAMES = {
  command: 'Bash',
  shell: 'Bash',
  bash: 'Bash',
  read: 'Read',
  glob: 'Glob',
  grep: 'Grep',
  write: 'Write',
  edit: 'Edit',
  patch: 'Edit',
  web: 'Web',
  search: 'Search',
  todo: 'Todo',
  plan: 'Plan',
  agent: 'Agent',
  task: 'Agent',
  subagent: 'Agent',
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

function readRuntime() {
  try {
    const obj = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
    const port = Number(obj && obj.port);
    const token = typeof (obj && obj.token) === 'string' && /^[a-f0-9]{48,128}$/i.test(obj.token) ? obj.token : '';
    return obj && obj.app === 'agentpaw' && Number.isInteger(port) && token ? { port, token } : null;
  } catch {
    return null;
  }
}

// 尽力而为的 POST：异步、快速放弃，绝不阻塞。
function postState(body) {
  const runtime = readRuntime();
  if (!runtime) return;
  let payload = '';
  try {
    payload = JSON.stringify(body);
    // Never cut serialized JSON. Bound optional display fields until the exact
    // UTF-8 payload fits the server contract; identity fields stay intact.
    if (Buffer.byteLength(payload, 'utf8') > MAX_BODY_BYTES) {
      const bounded = { ...body };
      if (typeof bounded.assistant_last_output === 'string') bounded.assistant_last_output = bounded.assistant_last_output.slice(-1200);
      if (typeof bounded.session_title === 'string') bounded.session_title = bounded.session_title.slice(0, 240);
      if (typeof bounded.cwd === 'string') bounded.cwd = bounded.cwd.slice(0, 1024);
      if (typeof bounded.api_error_type === 'string') bounded.api_error_type = bounded.api_error_type.slice(0, 240);
      payload = JSON.stringify(bounded);
      if (Buffer.byteLength(payload, 'utf8') > MAX_BODY_BYTES) return;
    }
  } catch { return; }
  let req;
  try {
    req = http.request(
      {
        hostname: '127.0.0.1',
        port: runtime.port,
        path: STATE_PATH,
        method: 'POST',
        timeout: POST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          [TOKEN_HEADER]: runtime.token,
        },
      },
      (res) => { try { res.resume(); } catch {} }
    );
  } catch { return; }
  req.on('error', () => {});
  req.on('timeout', () => { try { req.destroy(); } catch {} });
  try { req.end(payload); } catch {}
}

function appendUsage(line) {
  try {
    fs.mkdirSync(AGENTPAW_DIR, { recursive: true });
    fs.appendFileSync(USAGE_PATH, JSON.stringify(line) + '\n');
  } catch {}
}

// 事件负载：opencode 各事件的 properties 形状不同，统一安全取对象。
function eventInfo(ev) {
  const p = (ev && ev.properties && typeof ev.properties === 'object') ? ev.properties : {};
  const info = (p.info && typeof p.info === 'object') ? p.info : p;
  return { p, info };
}

function toolName(tool) {
  const t = str(tool) || str(tool && tool.type);
  return TOOL_NAMES[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Tool');
}

function v2Payload(event) {
  if (!event || typeof event !== 'object') return {};
  const data = event.data && typeof event.data === 'object' ? event.data : null;
  const properties = event.properties && typeof event.properties === 'object' ? event.properties : null;
  return data || properties || {};
}

function v2SessionId(payload) {
  return str(payload.sessionID) || str(payload.form && payload.form.sessionID);
}

function v2ParentId(payload) {
  return str(payload.parentID);
}

function v2ToolInput(input) {
  if (!input || typeof input !== 'object') return input;
  return {
    ...input,
    sessionID: input.sessionID || input.sessionId,
    tool: input.tool || input.name,
  };
}

function v2TextPart(payload, sid, messageID, text, mode) {
  return {
    event: {
      type: 'message.part.updated',
      properties: {
        sessionID: sid,
        part: {
          id: messageID,
          messageID,
          sessionID: sid,
          role: 'assistant',
          text,
          mode,
        },
      },
    },
  };
}

function v2ToLegacyEvent(event, textState) {
  const type = str(event && event.type);
  const payload = v2Payload(event);
  const sid = v2SessionId(payload);
  if (!sid) return null;
  if (type === 'session.created' || type === 'session.updated') {
    const parentID = v2ParentId(payload);
    const info = {
      id: sid,
      sessionID: sid,
      ...(parentID ? { parentID } : {}),
      directory: str(payload.location && payload.location.directory),
      title: str(payload.title),
    };
    return {
      event: {
        type,
        properties: { info },
      },
    };
  }
  if (type === 'session.deleted') {
    return { event: { type, properties: { sessionID: sid, info: { id: sid } } } };
  }
  if (type === 'session.compaction.started' || type === 'session.compacting') {
    return { event: { type: 'session.compacted', properties: { sessionID: sid } } };
  }
  if (type === 'session.execution.started') {
    return { event: { type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } } };
  }
  if (type === 'session.execution.failed') {
    return { event: { type: 'session.error', properties: { sessionID: sid, error: payload.error || payload } } };
  }
  if (type === 'session.execution.succeeded') {
    return { event: { type: 'session.idle', properties: { sessionID: sid } } };
  }
  if (type === 'session.execution.interrupted') {
    return { event: { type: 'session.aborted', properties: { sessionID: sid } } };
  }
  if (type === 'permission.asked' || type === 'permission.updated' || type === 'permission.replied') {
    return { event: { type, properties: payload } };
  }
  if (type === 'form.created' || type === 'form.replied' || type === 'form.cancelled') {
    const formType = type === 'form.created' ? 'question.asked' : type === 'form.replied' ? 'question.replied' : 'question.rejected';
    return { event: { type: formType, properties: { ...payload, sessionID: sid, id: str(payload.id) || str(payload.form && payload.form.id) } } };
  }
  if (type === 'session.next.text.started' || type === 'session.next.text.delta' || type === 'session.next.text.ended') {
    let current = textState.get(sid);
    if (type === 'session.next.text.started' || !current) {
      const sequence = (current && current.sequence || 0) + 1;
      current = { sequence, id: str(payload.messageID) || `${sid}:text:${sequence}`, text: '' };
    }
    if (type === 'session.next.text.delta') current.text += str(payload.delta);
    if (type === 'session.next.text.ended' && typeof payload.text === 'string') current.text = payload.text;
    current.text = current.text.slice(-LAST_OUTPUT_MAX * 4);
    textState.delete(sid);
    textState.set(sid, current);
    while (textState.size > 512) textState.delete(textState.keys().next().value);
    return v2TextPart(payload, sid, current.id, current.text, 'snapshot');
  }
  return null;
}

export const AgentPawOpenCodePlugin = async ({ directory }) => {
  const sessions = new Map();        // sessionID -> { cwd, title, model }
  const lastTurnAt = new Map();      // sessionID -> 最近一次回合活动 ms
  const lastRoleBySession = new Map(); // sessionID -> 最近 message.updated 的 role
  const userText = new Map();        // sessionID -> 待用的最近用户文本（标题兜底）
  const outputTail = new Map();      // sessionID -> assistant 文本尾部
  const textParts = new Map();       // sessionID -> latest full text per part
  const turnStates = new Map();      // active / waiting / error / complete
  const pendingWaits = new Map();    // sessionID -> pending permission/form ids
  const loggedMessages = new Set();  // 已写 usage 的 message id
  const seenMessageIds = new Set();  // 见过的 message id（opencode 会话重载会重放
                                     // 既有消息的 message.updated，重放不算新回合）
  const stoppedMessageIds = new Set(); // 已发过 Stop 的 assistant message id
  let lastPostKey = '';
  let lastPostAt = 0;
  const MAX_TRACKED_IDS = 20000;
  const IDLE_SESSION_MS = 6 * 60 * 60 * 1000;

  function remember(set, id) {
    if (!id) return;
    set.add(id);
    while (set.size > MAX_TRACKED_IDS) set.delete(set.values().next().value);
  }

  function dropSession(sid) {
    sessions.delete(sid);
    lastTurnAt.delete(sid);
    lastRoleBySession.delete(sid);
    userText.delete(sid);
    outputTail.delete(sid);
    textParts.delete(sid);
    turnStates.delete(sid);
    pendingWaits.delete(sid);
  }

  function touchSession(sid) {
    if (!sid) return;
    const meta = sessions.get(sid) || { cwd: str(directory) };
    meta.touchedAt = Date.now();
    sessions.set(sid, meta);
    while (sessions.size > 512) dropSession(sessions.keys().next().value);
  }

  function pruneSessions(now = Date.now()) {
    for (const [sid, meta] of sessions) {
      const at = Math.max(num(meta && meta.touchedAt), num(lastTurnAt.get(sid)));
      if (now - at > IDLE_SESSION_MS) dropSession(sid);
    }
  }

  function post(state, event, extra) {
    try {
      const sessionID = str(extra.session_id);
      if (!sessionID) return;
      touchSession(sessionID);
      const meta = sessions.get(sessionID) || {};
      const body = { state, event, session_id: sessionID, agent_id: AGENT_ID, source_pid: process.pid };
      if (extra.cwd || meta.cwd) body.cwd = extra.cwd || meta.cwd;
      if (extra.model || meta.model) body.model = extra.model || meta.model;
      if (extra.session_title || meta.title) body.session_title = extra.session_title || meta.title;
      if (extra.tool_name) body.tool_name = extra.tool_name;
      if (extra.api_error_type) body.api_error_type = extra.api_error_type;
      const tail = outputTail.get(sessionID);
      if (tail) body.assistant_last_output = tail.length > LAST_OUTPUT_MAX ? tail.slice(-LAST_OUTPUT_MAX) : tail;
      // 相同 session+state+event 300ms 内去重（session.idle 等会连发）。
      const key = `${sessionID}|${state}|${event}`;
      const now = Date.now();
      if (key === lastPostKey && now - lastPostAt < 300) return;
      lastPostKey = key;
      lastPostAt = now;
      postState(body);
    } catch {}
  }

  function logUsage(sid, msg) {
    try {
      const id = str(msg.id);
      if (!id || loggedMessages.has(id)) return;
      const tokens = msg.tokens && typeof msg.tokens === 'object' ? msg.tokens : null;
      const cost = num(msg.cost);
      if (cost <= 0 && !tokens) return; // 无任何用量信息，无从记
      remember(loggedMessages, id);
      const cache = tokens && tokens.cache && typeof tokens.cache === 'object' ? tokens.cache : {};
      appendUsage({
        v: 1,
        ts: num(msg.time && (msg.time.completed || msg.time.created)) || Date.now(),
        session_id: sid,
        message_id: id,
        model: str(msg.modelID) || 'unknown',
        provider: str(msg.providerID) || '',
        cost: typeof msg.cost === 'number' && Number.isFinite(msg.cost) && msg.cost >= 0 ? cost : undefined,
        tokens: tokens ? {
          input: num(tokens.input),
          output: num(tokens.output),
          reasoning: num(tokens.reasoning),
          cacheRead: num(cache.read),
          cacheWrite: num(cache.write),
        } : undefined,
      });
    } catch {}
  }

  function onEvent(input) {
    try {
      const ev = (input && input.event) || {};
      const type = str(ev.type);
      const { p, info } = eventInfo(ev);
      pruneSessions();

      if (type === 'session.deleted') {
        const sid = str(info.id) || str(p.sessionID) || str(p.session_id);
        if (sid) dropSession(sid);
        return;
      }

      if (type === 'session.created' || type === 'session.updated') {
        const sid = str(info.id);
        if (!sid) return;
        const prev = sessions.get(sid) || {};
        const meta = {
          cwd: str(info.directory) || prev.cwd || str(directory),
          title: str(info.title) || prev.title || '',
          model: prev.model || '',
          parentID: str(info.parentID) || prev.parentID || '',
          touchedAt: Date.now(),
        };
        sessions.set(sid, meta);
        touchSession(sid);
        if (type === 'session.created' && !meta.parentID) {
          post('idle', 'SessionStart', { session_id: sid });
        }
        return;
      }

      if (type === 'session.status') {
        const sid = str(p.sessionID) || str(info.id) || '';
        if (sid && p.status && p.status.type === 'busy') {
          if (turnStates.get(sid) !== 'active' && turnStates.get(sid) !== 'waiting') {
            outputTail.delete(sid);
            textParts.delete(sid);
            post('thinking', 'UserPromptSubmit', { session_id: sid });
          }
          if (!pendingWaits.get(sid)?.size) turnStates.set(sid, 'active');
          lastRoleBySession.set(sid, 'assistant');
        }
        return;
      }

      if (type === 'message.updated') {
        const sid = str(info.sessionID) || str(info.session_id);
        if (!sid) return;
        touchSession(sid);
        const role = str(info.role);
        if (role) lastRoleBySession.set(sid, role);
        if (role === 'user') {
          // 重放守卫：opencode 在会话重新加载/同步时会重放既有消息的
          // message.updated，其中最后一条（用户消息）会把回合结束后的状态
          // 钉死在 thinking。只有从未见过的消息 id 才算新回合。
          const uid = str(info.id);
          if (uid && seenMessageIds.has(uid)) return;
          remember(seenMessageIds, uid);
          turnStates.set(sid, 'active');
          outputTail.delete(sid);
          textParts.delete(sid);
          const title = str(info.title) || (userText.get(sid) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
          userText.delete(sid);
          post('thinking', 'UserPromptSubmit', { session_id: sid, session_title: title });
          return;
        }
        if (role === 'assistant') {
          const model = str(info.modelID);
          if (model) {
            const meta = sessions.get(sid);
            if (meta) meta.model = model;
          }
          lastTurnAt.set(sid, Date.now());
          if (info.tokens && !info.finish) logUsage(sid, info);
          if (info.error && typeof info.error === 'object') {
            turnStates.set(sid, 'error');
            post('error', 'StopFailure', { session_id: sid, api_error_type: str(info.error.type || info.error.message) || 'error' });
          } else if (info.finish) {
            // 同一消息的 finish 可能重放（如流式补发/会话重载）：usage 与
            // Stop 都只发一次。
            const aid = str(info.id);
            if (aid && stoppedMessageIds.has(aid)) return;
            remember(stoppedMessageIds, aid);
            logUsage(sid, info);
            if (info.finish === 'tool-calls' || info.finish === 'unknown') {
              turnStates.set(sid, 'active');
              return; // A model step ended; the task continues with tools.
            }
            turnStates.set(sid, 'complete');
            post('attention', 'Stop', { session_id: sid });
          }
        }
        return;
      }

      if (type === 'message.part.updated') {
        // TextPart 全文流式到达：只缓存尾部，不 POST（避免刷屏）。
        const part = (p.part && typeof p.part === 'object') ? p.part : p;
        const text = typeof part.text === 'string' ? part.text : str(part.part && part.part.text);
        if (!text && part.mode !== 'snapshot') return;
        const sid = str(part.sessionID) || str(p.sessionID) || '';
        if (!sid) return;
        touchSession(sid);
        // 会话开头（尚无 message.updated）的文本默认属于用户 prompt。
        if (part.role === 'assistant') lastRoleBySession.set(sid, 'assistant');
        if (lastRoleBySession.get(sid) !== 'assistant') {
          userText.set(sid, ((userText.get(sid) || '') + text).slice(-LAST_OUTPUT_MAX * 4));
        } else {
          // message.part.updated contains a full snapshot, not a delta.
          const parts = textParts.get(sid) || new Map();
          const key = str(part.id) || str(part.messageID) || 'text';
          parts.set(key, text.slice(-LAST_OUTPUT_MAX * 4));
          while (parts.size > 32) parts.delete(parts.keys().next().value);
          textParts.set(sid, parts);
          outputTail.set(sid, [...parts.values()].join('\n'));
          // 只留 LAST_OUTPUT_MAX 的几倍，防内存无限增长。
          if (outputTail.get(sid).length > LAST_OUTPUT_MAX * 4) {
            outputTail.set(sid, outputTail.get(sid).slice(-LAST_OUTPUT_MAX * 4));
          }
        }
        return;
      }

      if (type === 'session.aborted') {
        const sid = str(p.sessionID);
        if (sid) {
          turnStates.set(sid, 'aborted');
          pendingWaits.delete(sid);
          post('idle', 'TurnAborted', { session_id: sid });
        }
        return;
      }

      if (type === 'session.idle') {
        const sid = str(p.sessionID) || str(info.id) || '';
        if (!sid) return;
        // Complete an active turn once; idle must not erase errors or waits,
        // or celebrate again after the final assistant message already did.
        if (turnStates.get(sid) === 'active') {
          turnStates.set(sid, 'complete');
          post('attention', 'Stop', { session_id: sid });
        }
        return;
      }

      if (type === 'session.compacted') {
        const sid = str(p.sessionID) || str(info.id) || '';
        if (sid) post('sweeping', 'PreCompact', { session_id: sid });
        return;
      }

      if (type === 'session.error') {
        const sid = str(p.sessionID) || str(info.id) || '';
        const err = str((info.error && info.error.message) || p.error) || 'session error';
        if (sid) {
          turnStates.set(sid, 'error');
          post('error', 'StopFailure', { session_id: sid, api_error_type: err });
        }
        return;
      }

      if (type === 'permission.asked' || type === 'permission.updated' || type === 'question.asked') {
        const sid = str(p.sessionID) || str(info.sessionID) || '';
        if (sid) {
          touchSession(sid);
          const waits = pendingWaits.get(sid) || new Set();
          const kind = type === 'question.asked' ? 'form' : 'permission';
          const id = str(p.id) || str(p.permission && p.permission.id) || kind;
          waits.add(`${kind}:${id}`);
          while (waits.size > 128) waits.delete(waits.values().next().value);
          pendingWaits.set(sid, waits);
          turnStates.set(sid, 'waiting');
          post('notification', 'Notification', { session_id: sid });
        }
        return;
      }

      if (type === 'permission.replied' || type === 'question.replied' || type === 'question.rejected') {
        const sid = str(p.sessionID) || str(info.sessionID) || '';
        if (sid) {
          const waits = pendingWaits.get(sid);
          const kind = type === 'permission.replied' ? 'permission' : 'form';
          const id = str(p.requestID) || str(p.id) || kind;
          if (waits) {
            waits.delete(`${kind}:${id}`);
            if (waits.size) return;
            pendingWaits.delete(sid);
          }
          turnStates.set(sid, 'active');
          post('thinking', 'ElicitationResult', { session_id: sid });
        }
      }
    } catch {}
  }

  function onToolExec(after) {
    return (input) => {
      try {
        const sid = str(input && (input.sessionID || input.session_id));
        if (!sid) return;
        const name = toolName(input && input.tool);
        if (after && input.status === 'error') {
          turnStates.set(sid, 'error');
          post('error', 'PostToolUseFailure', { session_id: sid, tool_name: name,
            api_error_type: str(input.error && input.error.message) || str(input.error) || 'tool error' });
          return;
        }
        if (!pendingWaits.get(sid)?.size) turnStates.set(sid, 'active');
        post(!after && name === 'Agent' ? 'juggling' : 'working', after ? 'PostToolUse' : 'PreToolUse', { session_id: sid, tool_name: name });
      } catch {}
    };
  }

  return {
    event: onEvent,
    'tool.execute.before': onToolExec(false),
    'tool.execute.after': onToolExec(true),
    usage: logUsage,
    dispose: () => {
      sessions.clear(); lastTurnAt.clear(); lastRoleBySession.clear();
      userText.clear(); outputTail.clear(); loggedMessages.clear();
      seenMessageIds.clear(); stoppedMessageIds.clear();
      turnStates.clear();
      pendingWaits.clear();
      textParts.clear();
    },
  };
};

export default {
  id: 'agentpaw-opencode',
  setup: async (ctx) => {
    const hooks = await AgentPawOpenCodePlugin({
      directory: str(ctx && ctx.location && ctx.location.directory) || process.cwd(),
    });
    const registrations = [];
    const textState = new Map();
    const sessionDirectories = new Map();
    const pendingUsage = new Set();
    const meteredIds = new Set();
    const deletedSessions = new Set();
    const ownDirectory = path.resolve(str(ctx && ctx.location && ctx.location.directory) || process.cwd());
    let stopped = false;
    let eventIterator;
    let metering = false;
    const cancellations = new Set();

    function bounded(call, timeout = 500, cancellable = true) {
      return new Promise((resolve) => {
        let timer;
        const finish = (value) => {
          clearTimeout(timer);
          cancellations.delete(abort);
          resolve(value);
        };
        const abort = () => finish();
        if (cancellable) cancellations.add(abort);
        if (timeout) timer = setTimeout(abort, timeout);
        Promise.resolve().then(call).then(finish, abort);
      });
    }

    const register = async (call) => {
      try {
        const registration = await call();
        if (registration && typeof registration.dispose === 'function') registrations.push(registration);
      } catch {}
    };

    function owns(sid, location) {
      if (!sid || sid === 'global') return false;
      const directory = str(location && location.directory);
      if (directory) {
        sessionDirectories.delete(sid);
        sessionDirectories.set(sid, path.resolve(directory));
        while (sessionDirectories.size > 512) sessionDirectories.delete(sessionDirectories.keys().next().value);
      }
      return sessionDirectories.get(sid) === ownDirectory;
    }

    function requestUsage(sid) {
      if (stopped || typeof ctx?.session?.messages !== 'function') return;
      pendingUsage.add(sid);
      while (pendingUsage.size > 64) pendingUsage.delete(pendingUsage.values().next().value);
      if (metering) return;
      metering = true;
      (async () => {
        try {
          while (!stopped && pendingUsage.size) {
            const sessionID = pendingUsage.values().next().value;
            pendingUsage.delete(sessionID);
            let cursor;
            const cursors = new Set();
            for (let pageNumber = 0; pageNumber < 8 && !stopped; pageNumber++) {
              const page = await bounded(() => ctx.session.messages({ sessionID, limit: 100,
                ...(cursor ? { cursor } : { order: 'desc' }) }));
              if (stopped || deletedSessions.has(sessionID) || !Array.isArray(page && page.data)) break;
              let known = false;
              for (const msg of page.data.slice(0, 100)) {
                if (msg?.type !== 'assistant' || !str(msg.id) || !num(msg.time?.completed)) continue;
                if (meteredIds.has(msg.id)) { known = true; continue; }
                const model = msg.model;
                const tokens = msg.tokens;
                if (!str(model?.id) || !str(model?.providerID) || !tokens ||
                    ![tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write]
                      .every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) continue;
                hooks.usage(sessionID, { ...msg, modelID: model.id, providerID: model.providerID });
                meteredIds.add(msg.id);
                while (meteredIds.size > 20000) meteredIds.delete(meteredIds.values().next().value);
              }
              const next = str(page.cursor && page.cursor.next);
              if (known || !next || cursors.has(next)) break;
              cursors.add(next);
              cursor = next;
            }
          }
        } catch {} finally { metering = false; }
      })();
    }

    if (ctx && ctx.tool && typeof ctx.tool.hook === 'function') {
      await register(() => ctx.tool.hook('execute.before', async (input) => {
        if (!stopped && owns(str(input && input.sessionID), ctx.location)) await hooks['tool.execute.before'](v2ToolInput(input));
      }));
      await register(() => ctx.tool.hook('execute.after', async (input) => {
        if (!stopped && owns(str(input && input.sessionID), ctx.location)) await hooks['tool.execute.after'](v2ToolInput(input));
      }));
    }

    if (ctx && ctx.session && typeof ctx.session.hook === 'function') {
      await register(() => ctx.session.hook('prompt', async (input) => {
        if (stopped) return;
        const sid = str(input && input.sessionID);
        if (!owns(sid, ctx.location)) return;
        textState.delete(sid);
        const text = str(input && input.prompt && input.prompt.text);
        await hooks.event({ event: { type: 'message.updated', properties: { info: {
          id: str(input.messageID), sessionID: sid, role: 'user', title: text,
        } } } });
      }));
    }

    if (ctx && ctx.event && typeof ctx.event.subscribe === 'function') {
      try {
        const iterable = ctx.event.subscribe();
        eventIterator = iterable[Symbol.asyncIterator]();
        (async () => {
          try {
            while (!stopped) {
              const next = await bounded(() => eventIterator.next(), 0);
              if (stopped || !next || next.done) break;
              const event = next.value;
              const payload = v2Payload(event);
              const sid = v2SessionId(payload);
              if (!owns(sid, event.location || payload.location)) continue;
              if (event.type === 'session.deleted') {
                textState.delete(sid);
                sessionDirectories.delete(sid);
                pendingUsage.delete(sid);
                deletedSessions.add(sid);
                while (deletedSessions.size > 512) deletedSessions.delete(deletedSessions.values().next().value);
              } else if (event.type === 'session.created' || event.type === 'session.execution.started') {
                deletedSessions.delete(sid);
                if (event.type === 'session.execution.started') textState.delete(sid);
              }
              if (event.type === 'session.step.ended' || event.type === 'session.execution.succeeded' ||
                  event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted') requestUsage(sid);
              const legacy = v2ToLegacyEvent(event, textState);
              if (legacy) await hooks.event(legacy);
            }
          } catch {}
        })();
      } catch {}
    }

    return async () => {
      if (stopped) return;
      stopped = true;
      for (const abort of [...cancellations]) abort();
      const closing = [];
      if (eventIterator && typeof eventIterator.return === 'function') {
        closing.push(bounded(() => eventIterator.return(), 500, false));
      }
      for (const registration of registrations.splice(0)) closing.push(bounded(() => registration.dispose(), 500, false));
      textState.clear(); sessionDirectories.clear(); pendingUsage.clear();
      meteredIds.clear(); deletedSessions.clear();
      hooks.dispose();
      await Promise.all(closing);
    };
  },
};
