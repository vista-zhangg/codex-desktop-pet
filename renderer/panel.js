'use strict';
const $ = id => document.getElementById(id);
const t = (key, vars) => window.AgentPawI18n.t(key, vars);
const backgroundStatus = session => window.AgentPawI18n.backgroundStatus(session);
let lastOpKey = null;
let lastStats = null;
function fmt(n) { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n).toLocaleString('zh-CN'); }
function timeStr(ts) { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }); }
function contextLabel(value) { return value == null || !Number.isFinite(Number(value)) ? '' : `上下文 ${Math.max(0, Math.min(100, Number(value))).toFixed(0)}%`; }
function render(s) {
  if (!s) return;
  lastStats = s;
  $('active-sub').textContent = s.active?.project ? `${s.active.project}${s.active.model ? ' · ' + s.active.model : ''}` : t('panel.waitingSession');
  renderUsage(s);
  renderLive(s);
  if (!hasAutoFitted) fitOnce();
}
function renderLive(s) {
  const accepts = row => usageState.source === 'all' || row.agent === usageState.source;
  renderSessList((s.sessions || []).filter(accepts));
  renderOps((s.lastOps || []).filter(accepts));
}

function renderOps(ops) {
  const list = $('ops');
  if (ops.length === 0) {
    list.innerHTML = '<li class="empty">' + escapeHtml(t('panel.waitingOps')) + '</li>';
    return;
  }
  const topKey = ops[0].ts + ops[0].detail;
  const isNew = topKey !== lastOpKey;
  lastOpKey = topKey;
  list.innerHTML = ops
    .slice(0, 30)
    .map(
      (o, i) =>
        `<li class="${i === 0 && isNew ? 'new' : ''}"><span>${escapeHtml(o.icon || '🔧')}</span><span>${escapeHtml(o.detail)}</span><span class="op-proj">${escapeHtml(o.project || '')}</span><span class="op-time">${timeStr(o.ts)}</span></li>`
    )
    .join('');
}

let hasAutoFitted = false;
let fitRaf = 0;

// 只在首次加载时执行一次高度自适应，之后不再自动调整
// （自动调整会在 stats 周期性更新时反复触发 setBounds，导致窗口拉长/拖动失效）
function fitOnce() {
  if (hasAutoFitted) return;
  if (fitRaf) cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    fitRaf = 0;
    if (!window.pet || !window.pet.setPanelHeight) return;
    const card = $('card');
    if (!card) return;
    const h = Math.ceil(card.scrollHeight + 14);
    const maxH = Math.floor(window.screen.availHeight * 0.9);
    const finalH = Math.min(Math.max(h, 500), maxH);
    if (finalH > 100) {
      hasAutoFitted = true;
      window.pet.setPanelHeight(finalH);
    }
  });
}

const STATE_META = {
  working: { key: 'state.working', cls: 'st-working' },
  juggling: { key: 'state.juggling', cls: 'st-working' },
  sweeping: { key: 'state.sweeping', cls: 'st-working' },
  thinking: { key: 'state.thinking', cls: 'st-thinking' },
  loafing: { key: 'state.loafing', cls: 'st-idle' },
  waiting: { key: 'state.waiting', cls: 'st-waiting' },
  needsinput: { key: 'state.needsinput', cls: 'st-needsinput' },
  error: { key: 'state.error', cls: 'st-error' },
  done: { key: 'state.done', cls: 'st-done' },
  idle: { key: 'state.idle', cls: 'st-idle' },
  sleeping: { key: 'state.sleeping', cls: 'st-sleeping' },
  greet: { key: 'state.greet', cls: 'st-greet' },
  talking: { key: 'state.talking', cls: 'st-talking' },
};

const AGENT_ICON = {
  claude: '<svg viewBox="0 0 24 24" fill="#d97757"><path d="M12 1l2.2 6.3L20.5 5l-4 5.4 6.5 1.6-6.5 1.6 4 5.4-6.3-2.3L12 23l-2.2-6.3L3.5 19l4-5.4L1 12l6.5-1.6-4-5.4 6.3 2.3z"/></svg>',
  codex: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" fill="#3b82f6"/><path d="M7 8l4 4-4 4" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 16.5h4.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
  trae: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" fill="#16b8a6"/><path d="M7 17L17 7M17 7H9M17 7V15" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  workbuddy: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" fill="#6d5efc"/><path d="M12 6l1.35 3.65L17 11l-3.65 1.35L12 16l-1.35-3.65L7 11l3.65-1.35z" fill="#fff"/></svg>',
  opencode: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" fill="#17181c"/><path d="M8.5 6.5v11L17.5 12z" fill="#ff5f1f"/></svg>',
  zcode: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" fill="#e11d48"/><path d="M7.5 8h9M16.5 8l-9 8M7.5 16h9" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const AGENT_NAME = { claude: 'Claude', codex: 'Codex', trae: 'TRAE', workbuddy: 'WorkBuddy', opencode: 'opencode', zcode: 'ZCode' };

function renderSessList(sessions) {
  const el = $('sess-list');
  const activeStates = new Set(['waiting', 'needsinput', 'error', 'working', 'juggling', 'sweeping', 'thinking', 'loafing']);
  const priority = { waiting: 0, needsinput: 1, error: 2, sweeping: 3, juggling: 4, working: 5, thinking: 6, loafing: 7 };
  const filtered = (sessions || [])
    .filter((s) => s && !s.headless && (activeStates.has(s.state) || s.badge === 'done' || s.badge === 'interrupted'))
    .sort((a, b) => {
      const ae = a.badge === 'interrupted' ? 'error' : a.badge === 'done' ? 'done' : a.state;
      const be = b.badge === 'interrupted' ? 'error' : b.badge === 'done' ? 'done' : b.state;
      const ap = ae === 'done' ? 8 : (priority[ae] == null ? 9 : priority[ae]);
      const bp = be === 'done' ? 8 : (priority[be] == null ? 9 : priority[be]);
      return ap - bp || Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    });
  if (!filtered.length) {
    el.innerHTML = '<div class="empty">' + escapeHtml(t('panel.noActiveSession')) + '</div>';
    return;
  }
  el.innerHTML = filtered
    .slice(0, 8)
    .map((s) => {
      const effState = s.state === 'idle' && s.badge === 'done' ? 'done'
        : s.state === 'idle' && s.badge === 'interrupted' ? 'error'
        : s.state;
      const m = STATE_META[effState] || STATE_META.idle;
      const background = backgroundStatus(s);
      const showBackground = background
        && (effState === 'working' || effState === 'juggling' || effState === 'sweeping' || effState === 'thinking');
      const detail =
        effState === 'waiting' ? escapeHtml(s.reason ? t('wait.' + s.reason) : t('wait.default'))
        : effState === 'needsinput' ? escapeHtml((s.choice && s.choice.question) || t('state.needsinput'))
        : showBackground ? escapeHtml(background)
        : (effState === 'working' || effState === 'juggling' || effState === 'sweeping' || effState === 'thinking') && s.op ? escapeHtml(s.op)
        : escapeHtml(t(m.key));
      const context = contextLabel(s.contextPercent);
      const contextSuffix = context ? ` · ${context}` : '';
      const icon = AGENT_ICON[s.agent] || AGENT_ICON.claude;
      const who = AGENT_NAME[s.agent] || 'Claude';
      const proj = escapeHtml(s.alias || s.project || '');
      const detailTitle = `${detail}${contextSuffix}`;
      return `<div class="row sess"><span class="badge ${m.cls}">${escapeHtml(t(m.key))}</span><span class="sess-agent" title="${who}">${icon}</span><span class="sess-proj" title="${proj}">${proj}</span><span class="sess-op" title="${detailTitle}">${detail}${escapeHtml(contextSuffix)}</span></div>`;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

window.pet.onPanelStats(render);
window.pet.onPrice((m) => {
  const el = $('price-src');
  if (!el || !m) return;
  const sources = Array.isArray(m.sources) ? m.sources : [];
  const names = sources.map((source) => source.name).filter(Boolean).join('、');
  const scope = names ? `${names} · ${m.count || 0} 个模型` : `${m.count || 0} 个模型`;
  const sync = m.sync && typeof m.sync === 'object' ? m.sync : {};
  let syncText = '';
  if (sync.phase === 'scheduled') syncText = ' · 等待同步';
  if (sync.phase === 'syncing') syncText = ' · 正在同步…';
  if (sync.phase === 'error') {
    const retryMs = Math.max(0, Number(sync.nextAttemptTs) - Date.now());
    const retryMin = Math.max(1, Math.ceil(retryMs / 60000));
    syncText = ` · 同步失败，约 ${retryMin} 分钟后重试`;
  }
  if (m.live) {
    const when = m.ts ? new Date(m.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '缓存';
    el.textContent = `价目表: 在线（${scope}，${when} 更新）${m.stale ? ' · 缓存已过期' : ''}${syncText}`;
  } else if (m.mixed) {
    el.textContent = `价目表: 部分在线、部分内置（${scope}）${m.stale ? ' · 缓存已过期' : ''}${syncText}`;
  } else {
    el.textContent = `价目表: 内置价格（${scope}）${syncText}`;
  }
  const pricingHint = '此处为当前价目表状态，不代表历史用量的计价覆盖率。未匹配价格的用量不代表免费。';
  el.title = sync.phase === 'error' && sync.error
    ? `${pricingHint} 最近一次同步失败：${sync.error}`
    : pricingHint;
});

function applyStaticI18n() {
  document.documentElement.lang = 'zh-CN';
  document.title = 'AgentPaw · AI 桌伴 · 详情';
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}

$('close').addEventListener('click', () => window.pet.closePanel());

// 详情面板是独立窗口，ESC 直接收起它，不需要把鼠标移到右上角。
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  window.pet.closePanel();
});

// Initialize after both renderers load.
(async () => {
  applyStaticI18n();
  initUsageControls();
  const s = await window.pet.getStats();
  if (s) render(s);
  setTimeout(fitOnce, 300);
})();
