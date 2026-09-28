const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const characterPack = process.env.AGENTPAW_PREVIEW_CHARACTER;
const builtinCharacter = require('../shared/pet-assets').BUILTIN_CHARACTERS[characterPack];
let characterStore;
protocol.registerSchemesAsPrivileged([{ scheme: 'agentpaw-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const out = path.join(root, '.inspect', 'ui-preview');
fs.mkdirSync(out, { recursive: true });
const logFile = path.join(out, 'preview.log');
fs.writeFileSync(logFile, '');
const log = (...values) => fs.appendFileSync(logFile, require('util').format(...values) + '\n');
const fail = (error) => {
  try { log(error && error.stack || error); } finally { app.exit(1); }
};
// Diagnostic tools must never leave modal Electron errors on the user's desktop.
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
const deadline = setTimeout(() => fail(new Error('UI preview timed out after 180 seconds')), 180000);
app.on('will-quit', () => clearTimeout(deadline));
const version = require('../package.json').version;
app.setPath('userData', path.join(out, 'electron-profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const defaults = { showCat: true, showStatus: true, showQuota: true, showTokens: false, showCost: true };
let chipDisplay = { ...defaults };
const today = { cost: 8.426, tokens: 1286400, input: 362400, output: 86400, inputTotal: 1200000, cacheRead: 837600, messages: 42 };
const sessions = [
  { id: 'demo1', agent: 'codex', state: 'working', project: 'AgentPaw', op: '调整详情面板与设置页面', model: 'gpt-5.5', createdAt: Date.now(), turnStartedAt: Date.now()-124000, contextPercent: 32 },
  { id: 'demo2', agent: 'claude', state: 'thinking', project: 'Design system', op: '检查组件与交互细节', model: 'claude-sonnet-4', createdAt: Date.now(), contextPercent: 18 },
];
const { createTaskCenter, projectKey } = require('../backend/task-center');
const workflowModel = require('../shared/workflow-preferences');
const taskCenter = createTaskCenter();
let workflow = { notifications: workflowModel.notifications(), shortcuts: workflowModel.shortcuts(), shortcutErrors: {} };
let petPreview = null;
sessions.forEach(row => { row.sessionId = row.id; row.focusable = true; row.projectKey = projectKey({ cwd: 'D:/preview/' + row.project }); });
const daily = {};
for (let i = 1; i < 30; i++) { const date = new Date(); date.setDate(date.getDate()-i); const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; daily[key] = { ...today, tokens: 400000 + ((i*137231)%1500000), cost: 2+(i*1.23)%9 }; }
const stats = { today, sessions, active: sessions[0], lifetime: { cost: 136.72, tokens: 22460000, messages: 628 },
  byModel: { 'gpt-5.5': { tokens: 824000, cost: 5.642 }, 'claude-sonnet-4': { tokens: 462400, cost: 2.784 } },
  hourlyTok: Array.from({length:24}, (_,i) => i<7 || i>21 ? 0 : 12000+(i*91317)%200000), hourly: Array.from({length:24}, (_,i) => i<7 || i>21 ? 0 : .12+(i*.371)%1.4), daily,
  lastOps: [{ icon:'◈', detail:'更新界面样式', project:'AgentPaw', ts:Date.now() },{ icon:'↗', detail:'检查交互行为', project:'AgentPaw', ts:Date.now()-13000 }],
  idleMs: 0, bg: {}, chipDisplay,
  codexQuota: { status:'ready', updatedAt:Date.now(), windows:{ fiveHour:{ remainingPercent:76, usedPercent:24, resetsAt:Math.floor(Date.now()/1000)+6200 }, weekly:{ remainingPercent:92,usedPercent:8,resetsAt:Math.floor(Date.now()/1000)+320000 } } }
};
const noop = () => {};
function refreshWorkflow() {
  Object.assign(stats, taskCenter.sync({ ...stats, sessions }, workflow.notifications));
  if (petPreview && !petPreview.isDestroyed()) petPreview.webContents.send('pet:stats', stats);
  return stats;
}
refreshWorkflow();
for (const [index, kind] of ['done', 'failed', 'attention'].entries()) {
  taskCenter.record({ ...sessions[index % 2], kind, eventKey: 'preview-' + index, ts: Date.now() });
}
refreshWorkflow();
let companion = { quietMinutes: 30, rest: { preferences: { ...require('../shared/rest-preferences').DEFAULTS }, pending: null },
  visibility: { visible: true, autoHideFullscreen: true, quietUntil: 0 } };
const report = { hooksEnabled:true, summary:{detected:4,ready:4,needsRepair:0,repairable:0}, integrations: ['Claude Code','Codex','TRAE','WorkBuddy','opencode','ZCode'].map((label,i)=>({label,detected:i<4,mode:i===1?'watcher':i===4?'plugin':'hook',state:i<4?'ready':'not-detected',lastEventAt:i<4?Date.now()-120000:null})) };
const handlers = {
  'workflow:get-preferences': () => workflow,
  'workflow:set-preferences': (_, patch) => {
    workflow = { ...workflow, notifications: workflowModel.notifications({ ...workflow.notifications, ...patch.notifications }),
      shortcuts: patch.shortcuts ? workflowModel.shortcuts(patch.shortcuts) : workflow.shortcuts };
    refreshWorkflow();
    return { ok: true, ...workflow };
  },
  'workflow:update-session': (_, id, patch) => { const result = taskCenter.update(id, patch); refreshWorkflow(); return result; },
  'workflow:mark-read': (_, ids) => { const ok = taskCenter.markRead(ids); refreshWorkflow(); return { ok }; },
  'workflow:clear-recent': () => { const ok = taskCenter.clear(); refreshWorkflow(); return { ok }; },
  'workflow:focus-recent': () => true,
  'focus-session': () => true,
  'companion:get-state': () => companion,
  'companion:set-preferences': (_, value) => {
    if (value.restReminders) companion.rest.preferences = { ...companion.rest.preferences, ...value.restReminders };
    if (typeof value.autoHideFullscreen === 'boolean') companion.visibility.autoHideFullscreen = value.autoHideFullscreen;
    if (value.quietMinutes) companion.quietMinutes = value.quietMinutes;
    return { ok: true, ...companion };
  },
  'rest:action': () => { companion.rest.pending = null; return { ok: true, ...companion }; },
  'get-stats': () => ({...stats,chipDisplay}),
  'get-auto-launch': () => ({ supported:true,enabled:true }),
  'set-auto-launch': (_,enabled) => ({ supported:true,enabled }),
  'privacy:get': () => ({ok:true,enabled:false}),
  'privacy:set': (_,enabled) => ({ok:true,enabled}),
  'chip:get-display': () => chipDisplay,
  'chip:set-display': (_,value) => ({ok:true,...(chipDisplay={...chipDisplay,...value})}),
  'integrations:get-health': () => report,
  'get-xiaban-schedule': () => ({lunch:'12:00',evening:'18:00'}),
  'set-xiaban-schedule': (_,schedule) => ({ok:true,schedule}),
  'get-pet-assets': () => characterStore ? characterStore.catalog() : require('../shared/pet-assets').defaultCatalog(),
  'pet-character:select': (_, id) => characterStore.select(id),
  'import-pet-gif': (_, slot, mode, options) => characterStore.importGif(path.join(root, 'assets/cat/cat-idle.gif'), slot, mode, options),
  'remove-pet-asset': (_, slot, id) => characterStore.removeAsset(slot, id),
  'reset-pet-slot': (_, slot) => characterStore.resetSlot(slot),
  'update:get-state': () => ({supported:true,autoCheck:true,currentVersion:version,latestVersion:version,phase:'not-available',mode:'installer'}),
  'get-win-pos': () => [0,0],
  'get-window-metrics': () => ({bounds:{x:0,y:0,width:520,height:520},workArea:{x:0,y:0,width:1920,height:1080},scaleFactor:1}),
};
Object.entries(handlers).forEach(([name,fn]) => ipcMain.handle(name,fn));
['set-panel-height','set-pet-size','set-ignore-mouse','quota-alert:shown','pet-blur','pet:hide-menu'].forEach(name=>ipcMain.on(name,noop));
const errors=[];
async function create(page,width,height) {
  const win = new BrowserWindow({width,height,show:false,frame:false,webPreferences:{offscreen:true,preload:path.join(root,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.webContents.on('paint', (_event, _dirty, bitmap) => { if (!bitmap.isEmpty()) { win.previewBitmap = bitmap; win.previewRevision = (win.previewRevision || 0) + 1; } });
  win.webContents.on('console-message',(_e,...args) => { const detail=args.length===1?args[0]:null; const level=detail?detail.level:args[0]; const message=detail?detail.message:args[1]; if(level===3 || level==='error') errors.push({page,message}); });
  win.webContents.on('render-process-gone',(_e,details)=>errors.push({page,details}));
  await win.loadFile(path.join(root,'renderer',page+'.html'));
  await new Promise(resolve=>setTimeout(resolve,700));
  return win;
}
async function capture(win, name) {
  log('capture', name);
  const before = win.previewRevision || 0;
  win.webContents.startPainting();
  await win.webContents.executeJavaScript(`document.body.style.opacity='.999';requestAnimationFrame(()=>{document.body.style.opacity='1'})`);
  for (let elapsed = 0; elapsed < 5000; elapsed += 100) {
    win.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 100));
    if (elapsed >= 800 && win.previewRevision > before) break;
  }
  if (!win.previewBitmap || !(win.previewRevision > before)) throw new Error('No fresh offscreen frame: ' + name);
  fs.writeFileSync(path.join(out, name + '.png'), win.previewBitmap.toPNG());
}
async function dimensions(win) { return win.webContents.executeJavaScript(`({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,panels:[...document.querySelectorAll('.settings-panel')].filter(x=>!x.hidden).map(x=>x.id),outside:[...document.querySelectorAll('button,input,.chip,.stat,.block,.asset-card,.asset-inspector')].filter(x=>x.getClientRects().length).filter(x=>{const r=x.getBoundingClientRect();return r.left<0 || r.right>innerWidth+1}).map(x=>x.id||x.className)})`); }
async function checkReadable(win) {
  const small = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('*')).filter(el => el.getClientRects().length && Array.from(el.childNodes).some(node => node.nodeType === 3 && node.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12).map(el => ({element:el.id || el.className, size:getComputedStyle(el).fontSize}))`);
  assert.equal(small.length, 0, 'text stays at least 12px: ' + JSON.stringify(small));
}
app.whenReady().then(async()=>{
  try {
    const result=[];
    if (characterPack) {
      const { PetCharacterStore } = require('../backend/pet-characters');
      characterStore = new PetCharacterStore({ rootDir: fs.mkdtempSync(path.join(out, 'character-test-')) });
      if (builtinCharacter) characterStore.select(characterPack);
      else await characterStore.importPack(path.resolve(characterPack));
      protocol.handle('agentpaw-asset', (request) => {
        const id = new URL(request.url).pathname.slice(1, -4);
        const file = characterStore.assetPath(id);
        return file ? net.fetch(pathToFileURL(file).href) : new Response('', { status: 404 });
      });
    }
    const settings=await create('settings',840,760);
    log('settings loaded');
    if (characterStore) {
      const mouseId = characterStore.activeId();
      await settings.webContents.executeJavaScript(`document.getElementById('tab-expressions').click(); window.confirm=()=>true; void 0;`);
      const addCard = await settings.webContents.executeJavaScript(`(() => {
        const cards = [...document.querySelectorAll('#character-list > button')];
        const add = document.getElementById('character-add'); add.click();
        return { index: cards.indexOf(add), images: add.querySelectorAll('img').length,
          focused: document.activeElement.id, active: assetCatalog.character.id };
      })()`);
      assert.equal(addCard.index, Object.keys(require('../shared/pet-assets').BUILTIN_CHARACTERS).length,
        'custom character entry follows all built-in roles');
      assert.equal(addCard.images, 0, 'custom entry never reuses a character thumbnail');
      assert.equal(addCard.focused, 'character-name', 'entry focuses the creation form');
      assert.equal(addCard.active, mouseId, 'opening the creation form keeps the current pet');
      const clickRole = async (id) => {
        await settings.webContents.executeJavaScript(`document.querySelector('[data-character-id="${id}"]').click()`);
        for (let i=0; i<100; i++) {
          if (await settings.webContents.executeJavaScript(`!assetBusy && assetCatalog.character.id === '${id}'`)) return;
          await new Promise(r=>setTimeout(r,50));
        }
        throw Error('Role did not switch');
      };
      await clickRole('salary-cat');
      assert.equal(characterStore.activeId(), 'salary-cat');
      await clickRole(mouseId);
      assert.equal(await settings.webContents.executeJavaScript(`document.getElementById('remove-bg-toggle').checked`), false);
      await settings.webContents.executeJavaScript(`selectedSlotId='working';renderAssets();`);
      await settings.webContents.executeJavaScript(`importExpression('append')`);
      assert.equal(characterStore.catalog().slots.working.active.length, 2);
      await settings.webContents.executeJavaScript(`resetSlot()`);
      assert.equal(characterStore.catalog().slots.working.active.length, 1);
      assert.equal(characterStore.catalog().slots.working.active[0].kind, builtinCharacter ? 'builtin' : 'preset');
      const bad = await settings.webContents.executeJavaScript(`[...document.querySelectorAll('.character-card img,.asset-card img')].filter(img=>!img.complete||!img.naturalWidth).map(img=>img.src)`);
      assert.deepEqual(bad, [], 'role and state GIFs decoded');
      log('Character switching, GIF append and reset passed');
    }
    for(const tab of ['general','workflow','companion','appearance','integrations','updates','expressions']) {
      await settings.webContents.executeJavaScript(`document.getElementById('tab-${tab}').click()`);
      result.push({page:tab,...await dimensions(settings)});
      await checkReadable(settings);
      await capture(settings,'settings-'+tab);
    }
    await settings.webContents.executeJavaScript(`document.getElementById('tab-workflow').click(); document.getElementById('notify-attention').click();`);
    await new Promise(resolve => setTimeout(resolve,100));
    assert.equal(workflow.notifications.mode, 'attention');
    assert.equal(await settings.webContents.executeJavaScript(`(() => {
      const input=document.getElementById('shortcut-peek'); input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'c',code:'KeyC',ctrlKey:true,bubbles:true}));
      return input.value==='' && document.getElementById('shortcut-peek-error').textContent.includes('Ctrl+Shift');
    })()`),true,'common copy shortcut cannot be registered');
    await settings.webContents.executeJavaScript(`document.getElementById('shortcut-peek').focus();document.getElementById('shortcut-peek').dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',ctrlKey:true,shiftKey:true,bubbles:true}));document.getElementById('shortcut-save').click();`);
    await new Promise(resolve => setTimeout(resolve,100));
    assert.equal(workflow.shortcuts.peek, 'Ctrl+Shift+Space');
    await settings.webContents.executeJavaScript(`document.getElementById('shortcut-save').scrollIntoView({block:'end'});void 0;`);
    await capture(settings,'settings-workflow-shortcuts');
    await settings.webContents.executeJavaScript(`document.getElementById('tab-companion').click(); document.getElementById('rest-water-minutes').value=35; document.getElementById('rest-snooze-minutes').value=7; document.getElementById('rest-save').click();`);
    await new Promise(r=>setTimeout(r,100));
    assert.equal(companion.rest.preferences.waterMinutes,35,'custom water interval saved');
    assert.equal(companion.rest.preferences.snoozeMinutes,7,'custom reminder snooze saved');
    await settings.webContents.executeJavaScript(`document.getElementById('quiet-minutes').value=47; document.getElementById('quiet-minutes').dispatchEvent(new Event('change')); document.getElementById('fullscreen-toggle').click(); document.getElementById('settings-content').scrollTop=900;`);
    await new Promise(r=>setTimeout(r,100));
    assert.equal(companion.quietMinutes,47,'custom quiet duration saved');
    assert.equal(companion.visibility.autoHideFullscreen,false,'fullscreen can be disabled');
    await capture(settings,'settings-companion-lower');
    await settings.webContents.executeJavaScript(`document.getElementById('tab-appearance').click()`);
    for(const key of ['showCat','showStatus','showQuota','showTokens','showCost']) {
      const before=chipDisplay[key];
      await settings.webContents.executeJavaScript(`document.getElementById('${key}-toggle').click()`);
      await new Promise(r=>setTimeout(r,50));
      assert.equal(chipDisplay[key],!before,'toggle persists '+key);
      const field={showCat:'cat',showStatus:'status',showQuota:'quota',showTokens:'tokens',showCost:'cost'}[key];
      assert.equal(await settings.webContents.executeJavaScript(`document.getElementById('preview-${field}').hidden`),before,'preview follows '+key);
    }
    await settings.webContents.executeJavaScript(`document.getElementById('tab-appearance').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
    assert.equal(await settings.webContents.executeJavaScript('document.activeElement.id'),'tab-integrations');
    await settings.webContents.executeJavaScript(`document.getElementById('tab-appearance').click()`);
    // Every supported combination must keep the preview within its card.
    for (let mask=0;mask<32;mask++) {
      const value=Object.fromEntries(Object.keys(defaults).map((key,index)=>[key,!!(mask & (1<<index))]));
      await settings.webContents.executeJavaScript(`renderChipPreview(${JSON.stringify(value)})`);
      assert(await settings.webContents.executeJavaScript(`(() => {const r=document.querySelector('.preview-compact').getBoundingClientRect();const p=document.querySelector('.capsule-preview').getBoundingClientRect();return r.width<=p.width-30})()`),'preview fits '+mask);
    }
    for (const tab of ['general','workflow','companion','appearance','integrations','updates','expressions']) {
      settings.setSize(720,620);
      await settings.webContents.executeJavaScript(`document.getElementById('tab-${tab}').click()`);
      result.push({page:tab+'-small',...await dimensions(settings)});
      await checkReadable(settings);
    }
    await capture(settings,'settings-small');
    await settings.webContents.executeJavaScript(`document.getElementById('asset-inspector').scrollIntoView({block:'start'});`);
    await capture(settings,'settings-small-inspector');
    result.push({page:'expressions-small-inspector',...await dimensions(settings)});
    settings.destroy();
    chipDisplay={...defaults};
    const panel=await create('panel',620,900);
    await capture(panel,'panel');
    result.push({page:'panel',...await dimensions(panel)});
    await checkReadable(panel);
    await panel.webContents.executeJavaScript(`document.getElementById('lifetime-block').scrollIntoView({block:'center'})`);
    await capture(panel,'panel-lifetime');
    const lifetimeText = await panel.webContents.executeJavaScript(`document.getElementById('lt-cost').textContent`);
    for(const range of ['7d','30d','today']) {
      await panel.webContents.executeJavaScript(`document.querySelector('[data-range="${range}"]').click()`);
      assert.equal(await panel.webContents.executeJavaScript(`document.querySelectorAll('#chart .bar').length`),range==='7d'?7:range==='30d'?30:24);
      assert.equal(await panel.webContents.executeJavaScript(`document.getElementById('lt-cost').textContent`),lifetimeText,'range filter never changes lifetime');
    }
    panel.setSize(420,700);
    await panel.webContents.executeJavaScript(`window.scrollTo(0,0)`);
    result.push({page:'panel-small',...await dimensions(panel)});
    await capture(panel,'panel-small');
    await checkReadable(panel);
    await panel.webContents.executeJavaScript(`document.getElementById('lifetime-block').scrollIntoView({block:'center'})`);
    await capture(panel,'panel-small-lifetime');
    panel.destroy();
    const pet=await create('pet',520,420);
    petPreview = pet;
    if (characterStore) {
      for (const state of ['working','thinking','talking','juggling','sweeping','loafing','waiting','needsinput','happy','greet','error','sad','sleeping']) {
        await pet.webContents.executeJavaScript(`setState('${state}')`);
        await new Promise(r=>setTimeout(r,100));
        const decoded = await pet.webContents.executeJavaScript(`({url:catImg.src,width:catImg.naturalWidth,hidden:catImg.hidden})`);
        assert((builtinCharacter ? decoded.url.includes('/characters/'+characterPack+'/') : decoded.url.startsWith('agentpaw-asset:')) && decoded.width === 120 && !decoded.hidden, 'own animated GIF decodes: '+state);
      }
      await pet.webContents.executeJavaScript(`setState('working')`);
      await capture(pet,'pet-'+(builtinCharacter ? characterPack : 'custom')+'-working');
      log('All character states decoded at 120px in Electron');
    }
    pet.webContents.send('pet:stats',stats);
    await capture(pet,'pet');
    pet.setSize(520,740);
    await pet.webContents.executeJavaScript(`openActionPop(); document.getElementById('ac-tab-recent').click();void 0;`);
    await capture(pet,'pet-recent');
    assert.equal(await pet.webContents.executeJavaScript(`document.querySelectorAll('.ac-history-row').length`),3);
    assert.equal(await pet.webContents.executeJavaScript(`(() => {
      const button=document.querySelector('.ac-history-row button'); button.focus();
      const original=lastStats;
      applyStats({...original,recent:[{...original.recent[0],id:'review-new-record'},...original.recent]});
      const preserved=button.isConnected && document.activeElement===button;
      applyStats(original); return preserved;
    })()`),true,'incoming history preserves the current button and keyboard focus');
    await pet.webContents.executeJavaScript(`document.getElementById('ac-read-all').click();void 0;`);
    await new Promise(resolve => setTimeout(resolve,100));
    assert(stats.recent.every(row => row.read));
    assert.equal(await pet.webContents.executeJavaScript(`(() => {
      const original=lastStats;
      const choice={kind:'perm',permId:'review-permission',sessionId:'demo1',project:'Preview',question:'Run tests?',options:[{key:'allow',label:'允许'},{key:'deny',label:'拒绝'}]};
      const action={actionId:'review-permission',state:'waiting',notificationsMuted:true,choice};
      const pending={...original,waitingCount:1,actions:[action]};
      applyStats(pending); document.getElementById('ac-tab-actions').click();
      const button=document.querySelector('.ac-act button'); button.focus();
      applyStats({...pending,actions:[action,{...action,actionId:'review-other',choice:{...choice,permId:'review-other'}}]});
      const preserved=button.isConnected && document.activeElement===button;
      showBubble('Do not cover this task');
      const uncovered=document.getElementById('bubble').classList.contains('hidden');
      applyStats(original);
      const removed=!button.isConnected;
      updateMouseHit(0,0);
      return preserved && uncovered && removed && mouseIgnoring;
    })()`),true,'permission refresh preserves focus, removes resolved cards and leaves blank pixels click-through');
    await pet.webContents.executeJavaScript(`document.getElementById('ac-tab-sessions').click();[...document.querySelectorAll('.ac-session-row button')].find(el=>el.textContent==='编辑').click();document.querySelector('.ac-alias-input').value='修登录';void 0;`);
    // Live statistics cannot erase a partially entered alias.
    pet.webContents.send('pet:stats', stats);
    await new Promise(resolve => setTimeout(resolve,100));
    assert.equal(await pet.webContents.executeJavaScript(`document.querySelector('.ac-alias-input').value`),'修登录');
    pet.webContents.send('workflow:command','peek');
    await new Promise(resolve => setTimeout(resolve,100));
    assert.equal(await pet.webContents.executeJavaScript(`document.querySelector('.ac-alias-input').value`),'修登录','peek shortcut cannot reset an in-progress alias');
    await capture(pet,'pet-session-editor');
    await pet.webContents.executeJavaScript(`[...document.querySelectorAll('.ac-session-editor button')].find(el=>el.textContent==='保存').click();void 0;`);
    await new Promise(resolve => setTimeout(resolve,100));
    assert(stats.sessions.some(row=>row.alias==='修登录'));
    await pet.webContents.executeJavaScript(`[...document.querySelectorAll('.ac-session-row button')].find(el=>el.textContent==='关注').click();void 0;`);
    await new Promise(resolve => setTimeout(resolve,100));
    assert(stats.sessions.some(row=>row.pinned));
    await capture(pet,'pet-sessions');
    assert.equal(await pet.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.getElementById('action-pop').classList.contains('hidden');`),true,'Escape closes the action center');
    log('Workflow review: shortcut guard, stable permission/history focus, draft preservation, quiet bubbles and click-through passed');
    await pet.webContents.executeJavaScript(`closeActionPop(); openPeek();void 0;`);
    await capture(pet,'pet-followed-peek');
    await pet.webContents.executeJavaScript(`closePeek();void 0;`);
    pet.setSize(520,420);
    await pet.webContents.executeJavaScript(`Object.defineProperty(document,'hidden',{configurable:true,value:false}); void 0;`);
    companion.rest.pending={id:'preview-rest-cat',kinds:['water','stretch'],createdAt:Date.now()};
    pet.webContents.send('companion:state',companion);
    await capture(pet,'pet-rest');
    assert.equal(await pet.webContents.executeJavaScript(`document.getElementById('rest-reminder').classList.contains('hidden')`),false,'rest reminder visible during agent work');
    await pet.webContents.executeJavaScript(`document.getElementById('rest-done').click()`);
    await new Promise(r=>setTimeout(r,100));

    await pet.webContents.executeJavaScript(`document.getElementById('chip-quota').click()`);
    await capture(pet,'pet-quota');
    result.push({page:'pet',...await dimensions(pet)});
    await pet.webContents.executeJavaScript(`document.getElementById('chip-quota').click()`);
    pet.webContents.send('pet:stats',{...stats,chipDisplay:{...defaults,showCat:false,showTokens:true}});
    await capture(pet,'pet-compact');
    // Exercise the actual CSS at the minimum frame size: shrinking the window
    // alone cannot remove the gap left by the old absolute top position.
    pet.setSize(520,340);
    await pet.webContents.executeJavaScript(`window.previewScreenYDescriptor=Object.getOwnPropertyDescriptor(window,'screenY'); void 0;`);
    const checkCompactActionCenter = async (name, vertical, overflowing) => {
      await capture(pet,name);
      const layout = await pet.webContents.executeJavaScript(`(() => {
        const panel=actionPop.getBoundingClientRect(), row=compactRow.getBoundingClientRect();
        const below=stage.classList.contains('edge-below');
        const gap=below ? panel.top-row.bottom : row.top-panel.bottom;
        const scroll=actionPop.querySelector('.ac-scroll');
        const footer=actionPop.querySelector('.ac-ops').getBoundingClientRect();
        updateMouseHit(row.left+row.width/2,below ? row.bottom+gap/2 : row.top-gap/2);
        const gapPassesThrough=mouseIgnoring;
        updateMouseHit(panel.left+20,panel.top+20);
        return {below,gap,gapPassesThrough,panelInteractive:!mouseIgnoring,
          inBounds:panel.top>=0 && panel.bottom<=innerHeight && panel.left>=0 && panel.right<=innerWidth,
          footerVisible:footer.top>=panel.top && footer.bottom<=panel.bottom,
          overflowing:scroll.scrollHeight>scroll.clientHeight};
      })()`);
      assert.equal(layout.below,vertical==='below',name+': opens on the available side');
      assert(Math.abs(layout.gap-10)<=1,name+': panel stays close to the capsule: '+JSON.stringify(layout));
      assert(layout.inBounds && layout.footerVisible,name+': panel and footer remain inside the window');
      assert(layout.gapPassesThrough && layout.panelInteractive,name+': gap passes clicks through and panel accepts clicks');
      assert.equal(layout.overflowing,overflowing,name+': long content scrolls inside the panel');
    };
    for (const vertical of ['above','below']) {
      await pet.webContents.executeJavaScript(`
        Object.defineProperty(window,'screenY',{configurable:true,value:${vertical==='above'?1000:0}});
        setStageEdgeLayout({vertical:'${vertical}',horizontal:'center'});
        applyStats({...lastStats,recent:[]});
        openActionPop(); document.getElementById('ac-tab-recent').click(); void 0;
      `);
      await checkCompactActionCenter('pet-compact-actions-empty-'+vertical,vertical,false);
      await pet.webContents.executeJavaScript(`applyStats({...lastStats,recent:${JSON.stringify(stats.recent)}}); void 0;`);
      await checkCompactActionCenter('pet-compact-actions-history-'+vertical,vertical,true);
    }
    await pet.webContents.executeJavaScript(`applyStats({...lastStats,chipDisplay:{...lastStats.chipDisplay,showCat:true}}); void 0;`);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await pet.webContents.executeJavaScript(`Math.round(actionPop.getBoundingClientRect().top-compactRow.getBoundingClientRect().bottom)`),10,
      'visible pet action center also clears the complete status stack');
    await pet.webContents.executeJavaScript(`applyStats({...lastStats,chipDisplay:{...lastStats.chipDisplay,showCat:false}}); void 0;`);
    await checkCompactActionCenter('pet-compact-actions-toggle','below',true);
    await pet.webContents.executeJavaScript(`closeActionPop(); Object.defineProperty(window,'screenY',window.previewScreenYDescriptor); delete window.previewScreenYDescriptor; void 0;`);
    pet.setSize(520,420);
    log('Compact action center: both directions, empty and scrolling content, live visibility changes and click-through passed');
    await require('./check-notepad-layout.cjs')(pet,{stats,defaults,capture,log});
    companion.rest.pending={id:'preview-rest-capsule',kinds:['water'],createdAt:Date.now()};
    pet.webContents.send('companion:state',companion);
    await capture(pet,'pet-compact-rest');
    assert.equal(await pet.webContents.executeJavaScript(`document.getElementById('rest-reminder').classList.contains('hidden')`),false,'capsule shows rest reminder');
    assert.equal(await pet.webContents.executeJavaScript(`document.getElementById('rest-snooze').textContent`),'7 分钟后','configured snooze text');
    pet.webContents.send('pet:event',{kind:'waiting',choice:{kind:'perm',permId:'demo-perm',sessionId:'demo1',project:'AgentPaw',tool:'Bash',command:'npm test',options:[{label:'允许',key:'allow'}]}});
    await new Promise(r=>setTimeout(r,100));
    await capture(pet,'pet-compact-rest-pending');
    assert.equal(await pet.webContents.executeJavaScript(`document.getElementById('rest-pending').hidden`),false,'rest reminder stays visible beside waiting permission');
    assert.equal(await pet.webContents.executeJavaScript(`document.getElementById('rest-reminder').classList.contains('hidden')`),true,'permission form keeps priority');
    await pet.webContents.executeJavaScript(`document.getElementById('rest-pending').click()`);
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await pet.webContents.executeJavaScript(`document.getElementById('ask').classList.contains('hidden')`),false,'snoozing rest never closes permission');

    await pet.webContents.executeJavaScript(`document.getElementById('rest-snooze').click()`);
    await new Promise(r=>setTimeout(r,100));

    const compact=await pet.webContents.executeJavaScript(`({hidden:document.getElementById('cat').getAttribute('aria-hidden'),width:document.getElementById('chip').getBoundingClientRect().width})`);
    assert.equal(compact.hidden,'true');
    await pet.webContents.debugger.attach('1.3');
    await pet.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await pet.webContents.executeJavaScript(`updateCapsuleState('error','异常');`);
    assert.equal(await pet.webContents.executeJavaScript(`document.getElementById('chip-context').getAnimations().length`),0,'reduced motion disables status animation');
    pet.destroy();
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({errors,result,completedAt:new Date().toISOString()},null,2));
    assert.equal(errors.length,0,JSON.stringify(errors));
    assert(result.every(x=>!x.overflow && x.outside.length===0),JSON.stringify(result));
    log(JSON.stringify({status:'passed',screenshots:out,checks:result.length,errors}));
  } catch(error) { log(error); process.exitCode=1; }
  clearTimeout(deadline);
  app.exit(process.exitCode || 0);
});
