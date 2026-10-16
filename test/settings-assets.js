'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('renderer/settings.html');
const js = read('renderer/settings.js');
const css = read('renderer/settings.css');
const main = read('main.js');
const preload = read('preload.js');
const { loadRenderer } = require('./dom-stub');
const { t } = require('../shared/i18n');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const companionState = (keepWorkPeekOpen) => ({
  keepWorkPeekOpen,
  rest: { preferences: {
    enabled: true, snoozeMinutes: 10, waterEnabled: true, waterMinutes: 45,
    stretchEnabled: true, stretchMinutes: 60, eyesEnabled: false, eyesMinutes: 20,
  } },
  visibility: { autoHideFullscreen: true },
});
const flush = () => new Promise(resolve => setImmediate(resolve));

function settingsFixture() {
  const initial = deferred();
  const saves = [];
  const world = loadRenderer(['shared/i18n.js', 'shared/pet-assets.js', 'renderer/settings.js'], (world) => {
    const addChildren = el => {
      el.append = (...children) => children.forEach(child => el.appendChild(child));
      el.replaceChildren = (...children) => { el.children = []; el.append(...children); };
      return el;
    };
    const createElement = world.document.createElement;
    world.document.createElement = tag => addChildren(createElement(tag));
    for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
      const el = addChildren(world.elements(tag[1]));
      el.disabled = /\sdisabled(?:\s|>)/.test(tag[0]);
      for (const attr of tag[0].matchAll(/([\w-]+)="([^"]*)"/g)) {
        el.setAttribute(attr[1], attr[2]);
        if (attr[1].startsWith('data-')) {
          el.dataset[attr[1].slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = attr[2];
        }
      }
      el.hasAttribute = name => el.getAttribute(name) !== null;
    }
    Object.assign(world.window.pet, {
      getCompanionState: () => initial.promise,
      setCompanionPreferences: patch => {
        const pending = deferred();
        saves.push({ patch: JSON.parse(JSON.stringify(patch)), ...pending });
        return pending.promise;
      },
      getChipDisplay: () => Promise.resolve({ showCat: true, showStatus: true, showQuota: true, showTokens: false, showCost: true }),
      getAutoLaunch: () => Promise.resolve({ enabled: false }),
      getUpdateState: () => Promise.resolve({ supported: false }),
      getIntegrationHealth: () => Promise.resolve({ integrations: [], summary: { detected: 0 } }),
      getXiabanSchedule: () => Promise.resolve({ lunch: '10:55', evening: '16:55' }),
    });
  });
  return { initial, saves, broadcast: world.handlers.companionState,
    toggle: world.elements('keep-work-peek-open-toggle'), status: world.elements('keep-work-peek-open-status') };
}

async function checkWorkPeekSetting() {
  const fixture = settingsFixture();
  assert.strictEqual(fixture.toggle.disabled, true, 'work peek toggle must be disabled until state is loaded');
  fixture.toggle.dispatch('click');
  assert.strictEqual(fixture.saves.length, 0, 'clicks before loading must not save');
  const legacyState = companionState(undefined);
  delete legacyState.keepWorkPeekOpen;
  fixture.initial.resolve(legacyState);
  await flush();
  assert.strictEqual(fixture.toggle.disabled, false);
  assert.strictEqual(fixture.toggle.getAttribute('aria-checked'), 'false', 'missing preference defaults to false');

  fixture.toggle.dispatch('click');
  fixture.toggle.dispatch('click');
  assert.strictEqual(fixture.toggle.disabled, true, 'pending saves must disable the toggle');
  assert.strictEqual(fixture.saves.length, 1, 'repeated clicks must not submit a duplicate save');
  assert.deepStrictEqual(fixture.saves[0].patch, { keepWorkPeekOpen: true });
  assert.strictEqual(fixture.toggle.getAttribute('aria-checked'), 'false', 'do not optimistically change the saved value');
  fixture.saves[0].resolve({ ok: false, ...companionState(true) });
  await flush();
  assert.strictEqual(fixture.toggle.getAttribute('aria-checked'), 'false', 'rejected saves retain the old value');
  assert.strictEqual(fixture.toggle.disabled, false);
  assert.strictEqual(fixture.status.textContent, t('settings.failed'));
  assert(fixture.status.classList.contains('error'));

  fixture.toggle.dispatch('click');
  fixture.saves[1].reject(new Error('IPC unavailable'));
  await flush();
  assert.strictEqual(fixture.toggle.getAttribute('aria-checked'), 'false', 'IPC exceptions retain the old value');
  assert.strictEqual(fixture.status.textContent, t('settings.failed'));
  assert.strictEqual(fixture.toggle.disabled, false);

  fixture.toggle.dispatch('click');
  fixture.broadcast(companionState(true));
  assert.strictEqual(fixture.toggle.getAttribute('aria-checked'), 'true', 'broadcasts update accessible checked state');
  assert.strictEqual(fixture.toggle.disabled, true, 'broadcasts must not re-enable a pending save');
  fixture.saves[2].resolve({ ok: true, ...companionState(true) });
  await flush();
  assert.strictEqual(fixture.toggle.getAttribute('aria-checked'), 'true');
  assert.strictEqual(fixture.toggle.disabled, false);
  assert.strictEqual(fixture.status.textContent, t('settings.saved'));
  assert(!fixture.status.classList.contains('error'));
  for (let repeat = 0; repeat < 3; repeat += 1) {
    fixture.broadcast(companionState(true));
    assert.strictEqual(fixture.status.textContent, t('settings.saved'), 'repeated matching broadcasts must retain save feedback');
    assert.strictEqual(fixture.toggle.getAttribute('aria-checked'), 'true');
  }
  for (const invalid of [undefined, null, 'true', 'false', 0, 1, {}, []]) {
    fixture.broadcast(companionState(invalid));
    assert.strictEqual(fixture.toggle.getAttribute('aria-checked'), 'true', 'explicitly invalid preferences must be ignored');
    assert.strictEqual(fixture.status.textContent, t('settings.saved'), 'invalid broadcasts must retain save feedback');
  }
  fixture.toggle.dispatch('click');
  assert.deepStrictEqual(fixture.saves[3].patch, { keepWorkPeekOpen: false });
  fixture.saves[3].resolve({ ok: true, ...companionState(false) });
  await flush();
  assert.strictEqual(fixture.toggle.getAttribute('aria-checked'), 'false');
  fixture.broadcast(companionState(true));
  assert.strictEqual(fixture.status.textContent, '', 'an actual preference change must clear stale save feedback');
  fixture.broadcast(legacyState);
  assert.strictEqual(fixture.toggle.getAttribute('aria-checked'), 'false', 'legacy state without the preference defaults to false');

  const invalidLoading = settingsFixture();
  invalidLoading.broadcast(companionState('true'));
  assert.strictEqual(invalidLoading.toggle.disabled, true, 'invalid state must not enable an unloaded toggle');
  invalidLoading.initial.resolve(legacyState);
  await flush();
  assert.strictEqual(invalidLoading.toggle.disabled, false, 'invalid broadcast must not block a later valid initial response');
  const invalidInitial = settingsFixture();
  invalidInitial.initial.resolve(companionState(null));
  await flush();
  assert.strictEqual(invalidInitial.toggle.disabled, true, 'invalid initial preference must leave the toggle disabled');
  invalidInitial.broadcast(companionState(true));
  assert.strictEqual(invalidInitial.toggle.disabled, false, 'valid state must recover from an invalid initial preference');

  const race = settingsFixture();
  race.broadcast(companionState(true));
  assert.strictEqual(race.toggle.disabled, false, 'a valid broadcast may finish loading');
  race.initial.resolve(companionState(false));
  await flush();
  assert.strictEqual(race.toggle.getAttribute('aria-checked'), 'true', 'initial async response must not overwrite a newer broadcast');

  const lateFailure = settingsFixture();
  lateFailure.broadcast(companionState(true));
  lateFailure.initial.reject(new Error('stale loading error'));
  await flush();
  assert.strictEqual(lateFailure.toggle.disabled, false);
  assert.strictEqual(lateFailure.toggle.getAttribute('aria-checked'), 'true');
  assert.strictEqual(lateFailure.status.textContent, '', 'late loading failure must not replace a valid broadcast');

  const staleSave = settingsFixture();
  staleSave.initial.resolve(companionState(false));
  await flush();
  staleSave.toggle.dispatch('click');
  staleSave.broadcast(companionState(true));
  staleSave.broadcast(companionState(false));
  staleSave.saves[0].resolve({ ok: true, ...companionState(true) });
  await flush();
  assert.strictEqual(staleSave.toggle.getAttribute('aria-checked'), 'false', 'late save response must not overwrite the latest broadcast');
  assert.strictEqual(staleSave.toggle.disabled, false);

  const recovery = settingsFixture();
  recovery.initial.reject(new Error('load unavailable'));
  await flush();
  assert.strictEqual(recovery.toggle.disabled, true, 'failed loading must leave the toggle disabled');
  assert.strictEqual(recovery.status.textContent, t('settings.keepWorkPeekOpenLoadFailed'));
  recovery.broadcast(companionState(true));
  assert.strictEqual(recovery.toggle.disabled, false, 'new state must recover after a load failure');
  assert.strictEqual(recovery.toggle.getAttribute('aria-checked'), 'true');
  assert.strictEqual(recovery.status.textContent, '', 'recovery clears the stale loading error');
  assert(!recovery.status.classList.contains('error'));

  assert(/id="panel-general"[\s\S]*id="keep-work-peek-open-toggle"[\s\S]*id="panel-workflow"/.test(html),
    'work peek preference belongs to the General panel');
  assert(/id="keep-work-peek-open-toggle"[^>]*role="switch"[^>]*aria-checked="false"[^>]*disabled/.test(html),
    'markup must expose an initially disabled accessible switch');
  for (const key of ['settings.keepWorkPeekOpenTitle', 'settings.keepWorkPeekOpenDescription']) {
    assert(html.includes(`data-i18n="${key}"`), 'work peek copy must use i18n bindings');
    assert.notStrictEqual(t(key), key, 'work peek copy must be translated');
  }
  for (const detail of ['点击空白', '移出鼠标', 'Esc', '再次点击头像', 'X', '切换面板', '处理任务']) {
    assert(t('settings.keepWorkPeekOpenDescription').includes(detail), `description must explain ${detail}`);
  }
  console.log('work peek settings dynamic VM checks passed');
}

for (const id of ['tab-expressions', 'asset-gallery', 'asset-inspector', 'asset-add', 'asset-replace', 'asset-remove',
  'asset-reset', 'asset-variants', 'remove-bg-toggle']) {
  assert(html.includes(`id="${id}"`), `settings must expose ${id}`);
}
assert(/img-src 'self' data: agentpaw-asset:/.test(html), 'settings CSP must allow only the controlled custom asset scheme');
assert(html.includes('../shared/pet-assets.js'), 'settings must use the shared visual slot registry');
assert(/importPetGif\(selectedSlotId, mode/.test(js), 'the selected slot must drive imports');
assert(/importExpression\('append'\)/.test(js), 'adding a GIF must preserve the current playlist');
assert(/importExpression\('replace-one'\)/.test(js) && /assetId: mode === 'replace-one'/.test(js),
  'replacement must target the selected playlist item');
assert(/assetRemove\.addEventListener/.test(js) && /removePetAsset/.test(js) && /resetPetSlot/.test(js),
  'selected built-in or custom entries must be removable and the state must be resettable');
assert(/window\.confirm/.test(js), 'destructive playlist operations must require confirmation');
assert(/checkerboard/.test(css) && /asset-grid/.test(css) && /asset-action\.danger/.test(css),
  'the gallery must make transparency, every state, and destructive actions visually clear');
assert(/e\.sender !== settingsWin\.webContents/.test(main), 'mutating asset IPC must reject non-settings renderers');
assert(/filters: \[\{ name: 'GIF 动画', extensions: \['gif'\]/.test(main), 'native picker must be restricted to GIF files');
assert(/PET_ASSETS: 'pet-assets:changed'/.test(preload), 'live asset changes must be exposed to renderers');

checkWorkPeekSetting().then(() => {
  console.log('settings asset interaction contract checks passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
