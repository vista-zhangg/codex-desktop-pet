'use strict';

const assert = require('assert');

// Run in the real renderer so flex sizing, animated bounds and hit testing
// are exercised together instead of approximating browser layout in Node.
function inspectDock() {
  const entry = document.getElementById('notepad');
  const capsule = document.getElementById('chip').getBoundingClientRect();
  const bounds = entry.getBoundingClientRect();
  const intersects = rect => rect.width > 0 && rect.height > 0
    && bounds.left < rect.right && bounds.right > rect.left
    && bounds.top < rect.bottom && bounds.bottom > rect.top;
  const selectors = '#cat, #sessions, #chip-context, #chip-quota, #chip-tokens, #chip-cost, #rest-pending, '
    + '#prop.on, #sleep.on .z, #sidekick.on, #think.on, #peek:not(.hidden), #ask:not(.hidden), '
    + '#action-pop:not(.hidden), #quota-popover:not(.hidden), #rest-reminder:not(.hidden), .radial-item';
  const collisions = [...document.querySelectorAll(selectors)].filter(el => {
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && Number(style.opacity) > 0.05
      && intersects(el.getBoundingClientRect());
  }).map(el => el.id || el.className);
  return {
    visible: bounds.width > 0 && bounds.height > 0,
    contained: bounds.left >= capsule.left && bounds.right <= capsule.right
      && bounds.top >= capsule.top && bounds.bottom <= capsule.bottom,
    onScreen: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
    collisions,
  };
}

module.exports = async function checkNotepadLayout(win, { stats, defaults, capture, log }) {
  const failures = [];
  await win.webContents.executeJavaScript(`window.notepadScreenDescriptors={
    screenX:Object.getOwnPropertyDescriptor(window,'screenX'),screenY:Object.getOwnPropertyDescriptor(window,'screenY')}; void 0;`);
  const setEdge = (vertical, horizontal) => win.webContents.executeJavaScript(`
    Object.defineProperty(window,'screenX',{configurable:true,get:()=>{
      const area=browserWorkArea();
      return area.x+('${horizontal}'==='left'?0:'${horizontal}'==='right'?area.width-innerWidth:(area.width-innerWidth)/2);
    }});
    Object.defineProperty(window,'screenY',{configurable:true,get:()=>{
      const area=browserWorkArea(); return area.y+('${vertical}'==='below'?0:area.height-innerHeight);
    }});
    setStageEdgeLayout({vertical:'${vertical}',horizontal:'${horizontal}'});
    if (radialOpen) { buildRadial(); if (!catVisible) positionCompactRadial(); } void 0;
  `);
  const inspect = async name => {
    const geometry = await win.webContents.executeJavaScript(`(${inspectDock.toString()})()`);
    if (!geometry.visible || !geometry.contained || !geometry.onScreen || geometry.collisions.length) {
      failures.push({ name, ...geometry });
    }
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 100));
  for (const [showCat, minimal] of [[true,false],[false,false],[true,true],[false,true]]) {
    const fixture = { ...stats, recent: [], actions: [], waitingCount: minimal?1:100, needsinputCount: 0,
      chipDisplay: { ...defaults, showCat, ...(minimal?{showQuota:false,showCost:false}:{}) } };
    await win.webContents.executeJavaScript(`applyStats(${JSON.stringify(fixture)}); void 0;`);
    await settle();
    const width = await win.webContents.executeJavaScript('desiredRestingWidth()');
    win.setSize(width,340);
    await settle();
    for (const vertical of ['above','below']) {
      for (const horizontal of ['center','left','right']) {
        const name = `${showCat?'pet':'capsule'}-${minimal?'minimal':'full'}-${vertical}-${horizontal}`;
        await setEdge(vertical,horizontal);
        for (const effect of ['working','thinking','sleeping','summon']) {
          await win.webContents.executeJavaScript(`
            setState('${effect==='summon'?'working':effect}');
            if ('${effect}'==='working') playAction('Grep','🔍');
            if ('${effect}'==='summon') playAction('Task','✨');
            if ('${effect}'==='sleeping') sleepEl.classList.add('on');
            clearTimeout(actTimer); void 0;
          `);
          for (const phase of [300,700,1600,2400]) {
            await win.webContents.executeJavaScript(`
              for (const element of [propEl,sleepEl,sidekickEl,thinkEl]) {
                for (const animation of element.getAnimations({subtree:true})) {
                  animation.pause(); animation.currentTime=${phase};
                }
              } void 0;
            `);
            await inspect(name+'-'+effect+'-'+phase);
          }
        }
        await win.webContents.executeJavaScript(`setState('waiting'); sidekickEl.classList.remove('on'); void 0;`);
        if (vertical==='above' && horizontal==='right') await capture(win,'notepad-'+(showCat?'pet':'capsule')+(minimal?'-minimal':'')+'-right');
      }
    }
    win.setSize(520,740);
    await settle();
    for (const vertical of ['above','below']) {
      for (const overlay of minimal?['Peek','ActionPop','Radial']:['Peek','QuotaPopover','ActionPop','Radial']) {
        await setEdge(vertical,'right');
        await win.webContents.executeJavaScript(`open${overlay}()`);
        await settle();
        await setEdge(vertical,'right');
        await inspect(`${showCat?'pet':'capsule'}-${minimal?'minimal':'full'}-${vertical}-${overlay}`);
        await win.webContents.executeJavaScript(`close${overlay}(); void 0;`);
      }
    }
  }
  await win.webContents.executeJavaScript(`
    document.getElementById('np-badge').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:90})); void 0;
  `);
  assert.equal(await win.webContents.executeJavaScript('g===null && !chip.classList.contains("dragging")'),true,
    'pressing the notebook badge cannot start a capsule drag or long press');
  await win.webContents.executeJavaScript(`document.getElementById('np-badge').click(); void 0;`);
  assert.equal(await win.webContents.executeJavaScript('actionPopOpen && !peekOpen'),true,'notebook opens only the action center');
  await win.webContents.executeJavaScript(`notepad.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); void 0;`);
  assert.equal(await win.webContents.executeJavaScript('actionPopOpen'),false,'Enter closes the action center');
  await win.webContents.executeJavaScript(`notepad.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})); void 0;`);
  assert.equal(await win.webContents.executeJavaScript('actionPopOpen'),true,'Space opens the action center once');
  await win.webContents.executeJavaScript(`closeActionPop(); applyStats(${JSON.stringify({ ...stats, chipDisplay: { ...defaults, showCat: false, showTokens: true } })}); void 0;`);
  await win.webContents.executeJavaScript(`
    for (const [key,descriptor] of Object.entries(window.notepadScreenDescriptors)) {
      if (descriptor) Object.defineProperty(window,key,descriptor); else delete window[key];
    }
    delete window.notepadScreenDescriptors; void 0;
  `);
  win.setSize(520,420);
  if (failures.length) log(JSON.stringify({ notepadLayoutFailures: failures }));
  assert.deepEqual(failures,[],'notebook must stay in the capsule and clear of content and animations');
  log('Notebook dock: both modes, all edge layouts, animation phases, overlays and input separation passed');
};
