'use strict';

// Shares the existing action-center surface and sizing rules with permission
// cards. Preferences and history are owned by the main process.
(function () {
  const get = id => document.getElementById(id);
  const tabs = ['actions', 'recent', 'sessions'];
  const panes = { actions: 'ac-act-sec', recent: 'ac-recent-sec', sessions: 'ac-sessions-sec' };
  let activeTab = 'actions';
  let stats = null;
  let editingId = '';
  let busy = false;
  let recentSignature = '';
  let recentCards = new Map();
  let sessionSignature = '';
  const status = get('ac-status');
  function element(tag, className, content) {
    const el = document.createElement(tag);
    el.className = className;
    if (content != null) el.textContent = content;
    return el;
  }
  function button(label, click, className = 'ac-small-button') {
    const el = element('button', className, label);
    el.type = 'button';
    el.addEventListener('click', event => { event.stopPropagation(); click(); });
    return el;
  }
  function title(row) { return row.alias || row.project || '未命名会话'; }
  function label(row) { return `${peekAgentLabel(row.agent)} · ${title(row)}`; }
  function ago(at) {
    const seconds = Math.max(0, (Date.now() - at) / 1000);
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    return `${Math.floor(seconds / 86400)} 天前`;
  }
  function selectTab(name, focus = false) {
    if (!tabs.includes(name)) return;
    activeTab = name;
    for (const key of tabs) {
      const selected = key === name;
      const tab = get('ac-tab-' + key);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      get(panes[key]).hidden = !selected;
    }
    get('ac-act-sec').classList.remove('hidden');
    if (focus) get('ac-tab-' + name).focus();
    if (actionPopOpen) fitPopup(actionPop);
  }
  async function run(action) {
    if (busy) return false;
    busy = true;
    status.textContent = '';
    try {
      const result = await action();
      if (result !== true && (!result || !result.ok)) throw new Error(result?.message || '操作未完成，请重试');
      return true;
    } catch (error) { status.textContent = error.message || '操作未完成，请重试'; return false; }
    finally { busy = false; }
  }
  function renderRecent() {
    const rows = stats.recent || [];
    const list = get('ac-recent-list');
    const signature = JSON.stringify(rows);
    if (signature === recentSignature) {
      list.querySelectorAll('time').forEach((el, index) => { el.textContent = ago(rows[index].at); });
      return;
    }
    recentSignature = signature;
    get('ac-read-all').disabled = !rows.some(row => !row.read);
    get('ac-clear-recent').disabled = !rows.length;
    if (!rows.length) {
      list.innerHTML = '';
      recentCards.clear();
      list.appendChild(element('p', 'ac-empty', '完成、失败与需要处理的事件会留在这里'));
      return;
    }
    if (!recentCards.size) list.innerHTML = '';
    const next = new Map();
    for (const row of rows) {
      const rowSignature = JSON.stringify(row);
      const previous = recentCards.get(row.id);
      if (previous?.signature === rowSignature) {
        previous.card.querySelector('time').textContent = ago(row.at);
        next.set(row.id, previous);
        continue;
      }
      const card = element('div', 'ac-history-row' + (row.read ? '' : ' unread'));
      const heading = element('div', 'ac-row-heading');
      const kind = { done: '已完成', failed: '执行失败', attention: '曾需处理' }[row.kind];
      heading.appendChild(element('span', 'ac-event-kind ' + row.kind, kind));
      const time = element('time', 'ac-row-time', ago(row.at));
      time.title = new Date(row.at).toLocaleString('zh-CN');
      heading.appendChild(time);
      card.appendChild(heading);
      card.appendChild(element('div', 'ac-row-title', label(row)));
      const controls = element('div', 'ac-row-controls');
      if (row.focusable) controls.appendChild(button('打开会话', async () => {
        const ok = await run(async () => {
          if (!await window.pet.focusRecent(row.id)) throw new Error('未能打开会话，请到对应 Agent 中查看');
          return true;
        });
        if (ok) closeActionPop();
      }));
      else controls.appendChild(element('span', 'ac-row-note', '会话窗口已不可定位'));
      if (!row.read) controls.appendChild(button('标为已读', () => run(() => window.pet.markRecentRead([row.id]))));
      card.appendChild(controls);
      next.set(row.id, { signature: rowSignature, card });
    }
    for (const [id, previous] of recentCards) if (next.get(id)?.card !== previous.card) previous.card.remove();
    [...next.values()].forEach(({ card }, index) => {
      if (list.children[index] !== card) list.insertBefore(card, list.children[index] || null);
    });
    recentCards = next;
  }
  function renderSessions(force = false) {
    if (editingId && !force) return;
    const rows = (stats.sessions || []).filter(row => !row.headless && (row.pinned || row.state !== 'sleeping'));
    rows.sort((a, b) => {
      const rank = row => ['waiting', 'needsinput', 'error'].includes(row.state) ? 0
        : PEEK_BUSY_STATES.has(row.state) ? (row.pinned ? 1 : 2) : row.pinned ? 3 : row.archived ? 5 : 4;
      return rank(a) - rank(b) || (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    const signature = JSON.stringify(rows.map(row => [row.sessionId, row.alias, row.project, row.state, row.pinned, row.projectMuted, row.notificationsMuted, row.archived, row.focusable])) + stats.privacyMode;
    if (!force && sessionSignature === signature) return;
    sessionSignature = signature;
    const list = get('ac-session-list');
    list.innerHTML = '';
    if (!rows.length) list.appendChild(element('p', 'ac-empty', '接入 Agent 后，会话会自动出现在这里'));
    for (const row of rows) {
      const card = element('div', 'ac-session-row');
      card.appendChild(element('div', 'ac-row-title', label(row)));
      card.appendChild(element('div', 'ac-row-note', `${row.archived ? '已结束' : sessMeta(row.state) || row.state} · #${row.sessionId.slice(-6)}${row.pinned ? ' · 已关注' : ''}${row.notificationsMuted ? ' · 已静音' : ''}`));
      const controls = element('div', 'ac-row-controls');
      if (row.focusable !== false) controls.appendChild(button('打开', async () => {
        if (await run(async () => {
          if (!await window.pet.focusSession(row.sessionId)) throw new Error('未能打开会话，请到对应 Agent 中查看');
          return true;
        })) closeActionPop();
      }));
      const follow = button(row.pinned ? '取消关注' : '关注', () => run(() => window.pet.updateSessionPreferences(row.sessionId, { pinned: !stats.sessions.find(item => item.sessionId === row.sessionId)?.pinned })));
      follow.setAttribute('aria-pressed', String(!!row.pinned));
      controls.appendChild(follow);
      controls.appendChild(button('编辑', () => {
        if (editingId || busy) return;
        editingId = row.sessionId;
        controls.hidden = true;
        const form = element('form', 'ac-session-editor');
        const nameLabel = element('label', '', '会话别名');
        const input = element('input', 'ac-alias-input');
        input.type = 'text'; input.maxLength = 40; input.value = row.alias || '';
        input.placeholder = stats.privacyMode ? '隐私模式下隐藏别名' : '例如：修登录（可留空）';
        input.disabled = stats.privacyMode === true;
        nameLabel.appendChild(input); form.appendChild(nameLabel);
        const muteLabel = element('label', 'ac-mute-label');
        const mute = element('input', ''); mute.type = 'checkbox'; mute.checked = row.projectMuted === true;
        muteLabel.appendChild(mute); muteLabel.appendChild(element('span', '', '此项目不自动弹出任务提醒'));
        form.appendChild(muteLabel);
        form.appendChild(element('p', 'ac-row-note', '静音后，状态与待处理事项仍保留。Agent 级静音可在设置中解除。'));
        const actions = element('div', 'ac-row-controls');
        const save = button('保存', async () => {
          if (await run(() => window.pet.updateSessionPreferences(row.sessionId, { alias: input.value, muted: mute.checked }))) {
            editingId = ''; sessionSignature = ''; renderSessions(true); fitPopup(actionPop);
          }
        });
        const cancel = button('取消', () => { editingId = ''; renderSessions(true); fitPopup(actionPop); });
        actions.appendChild(save); actions.appendChild(cancel); form.appendChild(actions);
        form.addEventListener('submit', event => { event.preventDefault(); save.click(); });
        form.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel.click(); } });
        card.appendChild(form); input.focus(); fitPopup(actionPop);
      }));
      card.appendChild(controls); list.appendChild(card);
    }
  }
  function render(value) {
    if (!value) return;
    if (value.privacyMode !== stats?.privacyMode) { editingId = ''; sessionSignature = ''; }
    stats = value;
    const pending = Math.max(actionableItems().length, (stats.waitingCount || 0) + (stats.needsinputCount || 0));
    const unread = (stats.recent || []).filter(row => !row.read).length;
    get('ac-tab-actions').textContent = `待处理${pending ? ' ' + pending : ''}`;
    get('ac-tab-recent').textContent = `最近${unread ? ' ' + unread : ''}`;
    get('ac-empty').hidden = actionableItems().length > 0;
    get('ac-empty').textContent = pending ? '明细已隐藏，请在“会话”中打开对应任务处理' : '暂时没有需要处理的事项';
    if (stats.taskCenterStorageError) status.textContent = '最近记录暂未保存到磁盘，请检查本地目录是否可写';
    renderRecent(); renderSessions(); selectTab(activeTab);
  }
  tabs.forEach((key, index) => {
    const tab = get('ac-tab-' + key);
    tab.addEventListener('click', () => selectTab(key));
    tab.addEventListener('keydown', event => {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!offset) return;
      event.preventDefault(); selectTab(tabs[(index + offset + tabs.length) % tabs.length], true);
    });
  });
  get('ac-read-all').addEventListener('click', () => run(() => window.pet.markRecentRead((stats?.recent || []).map(row => row.id))));
  get('ac-clear-recent').addEventListener('click', () => run(() => window.pet.clearRecent()));
  get('peek-center').addEventListener('click', event => { event.stopPropagation(); openActionPop(); });
  if (window.pet.onWorkflowCommand) window.pet.onWorkflowCommand(command => {
    if (command === 'peek') {
      if (radialOpen) closeRadial();
      if (actionPopOpen) return;
      if (askActive) { openActionPop(); return; }
      openPeek();
    } else if (command === 'actions') { if (!actionPopOpen) openActionPop(); selectTab('actions'); }
  });
  window.AgentPawTaskCenter = { render, opened() {
    editingId = ''; status.textContent = ''; render(lastStats);
    const pending = actionableItems().length || lastStats?.waitingCount || lastStats?.needsinputCount;
    selectTab(pending ? 'actions' : (lastStats?.recent || []).length ? 'recent' : 'sessions');
  }, closed() { editingId = ''; sessionSignature = ''; } };
})();
