'use strict';

// One visual-asset vocabulary shared by the main process, pet renderer and
// settings gallery. A slot always resolves to an ordered list: one GIF behaves
// like a normal replacement, while multiple GIFs rotate without repetition.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AgentPawPetAssets = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  const SLOT_GROUPS = Object.freeze([
    { id: 'work', label: '工作状态' },
    { id: 'feedback', label: '反馈与互动' },
    { id: 'rest', label: '闲时与彩蛋' },
  ]);

  const SLOTS = Object.freeze([
    { id: 'idle', group: 'work', label: '待命', icon: '🌿', description: '本轮已收尾，等待你的下一条指令。', defaultFiles: ['cat-idle.gif'] },
    { id: 'working', group: 'work', label: '干活中', icon: '⌨️', description: '工具执行、编辑文件和持续处理任务时播放。', defaultFiles: ['cat-working.gif', 'cat-working-2.gif', 'cat-working-3.gif', 'cat-working-4.gif', 'cat-working-5.gif'] },
    { id: 'thinking', group: 'work', label: '思考中', icon: '💭', description: '模型正在推理、尚未开始工具操作。', defaultFiles: ['cat-thinking.gif', 'cat-thinking-2.gif'] },
    { id: 'talking', group: 'work', label: '回应中', icon: '💬', description: '任务完成后正在向你回复。', defaultFiles: ['cat-talking.gif'] },
    { id: 'juggling', group: 'work', label: '并行子任务', icon: '🧶', description: '多条任务或子代理同时进行。', defaultFiles: ['cat-juggling.gif', 'cat-juggling-2.gif', 'cat-juggling-3.gif'] },
    { id: 'sweeping', group: 'work', label: '清理上下文', icon: '🧹', description: '压缩上下文或整理会话时播放。', defaultFiles: ['cat-sweeping.gif'] },
    { id: 'loafing', group: 'work', label: '工具间隙', icon: '🐟', description: '上一步完成、下一步尚未到来时短暂摸鱼。', defaultFiles: ['cat-loafing.gif', 'cat-loafing-2.gif', 'cat-loafing-3.gif', 'cat-loafing-4.gif', 'cat-loafing-5.gif'] },
    { id: 'waiting', group: 'feedback', label: '等你授权', icon: '🔔', description: '操作需要你确认；“抱歉”反馈也共享此组表情。', aliases: ['sorry'], defaultFiles: ['cat-waiting.gif'] },
    { id: 'needsinput', group: 'feedback', label: '等你回复', icon: '❓', description: '任务需要补充信息；“疑惑”反馈也共享此组表情。', aliases: ['puzzled'], defaultFiles: ['cat-needsinput.gif'] },
    { id: 'happy', group: 'feedback', label: '完成庆祝', icon: '🎉', description: '任务完成或收到夸奖；“开心、兴奋”反馈共享此组表情。', aliases: ['loved', 'excited'], defaultFiles: ['cat-happy.gif'] },
    { id: 'greet', group: 'feedback', label: '新会话', icon: '👋', description: '新任务开始时的上线招呼。', defaultFiles: ['cat-greet.gif'] },
    { id: 'error', group: 'feedback', label: '出错了', icon: '⚠️', description: '网络、API 或任务执行遇到错误。', defaultFiles: ['cat-error.gif'] },
    { id: 'sad', group: 'feedback', label: '难过', icon: '💧', description: '识别到负面情绪时的短暂反馈。', defaultFiles: ['cat-sad.gif'] },
    { id: 'ambient-awake', group: 'rest', label: '闲时活动', icon: '☕', description: '没有任务时，醒着发呆、摸鱼或溜达的轮换片段。', defaultFiles: ['cat-loafing.gif', 'cat-loafing-2.gif', 'cat-loafing-3.gif', 'cat-loafing-4.gif', 'cat-loafing-5.gif', 'cat-idle.gif', 'cat-thinking-2.gif', 'cat-roam.gif'] },
    { id: 'ambient-sleep', group: 'rest', label: '睡觉休息', icon: '💤', description: '没有任务时进入睡眠阶段播放。', defaultFiles: ['cat-sleeping.gif', 'cat-sleeping-2.gif'] },
    { id: 'xiaban', group: 'rest', label: '下班彩蛋', icon: '🍚', description: '午间和傍晚设定时段内播放。', defaultFiles: ['cat-xiaban.gif'] },
  ].map((slot) => Object.freeze({ ...slot, aliases: Object.freeze(slot.aliases || []), defaultFiles: Object.freeze(slot.defaultFiles.slice()) })));

  const SLOT_IDS = Object.freeze(SLOTS.map((slot) => slot.id));
  const SLOT_BY_ID = Object.freeze(Object.fromEntries(SLOTS.map((slot) => [slot.id, slot])));
  const STATE_TO_SLOT = Object.freeze(SLOTS.reduce((out, slot) => {
    if (!slot.id.startsWith('ambient-') && slot.id !== 'xiaban') out[slot.id] = slot.id;
    for (const alias of slot.aliases) out[alias] = slot.id;
    return out;
  }, { sleeping: 'ambient-sleep' }));

  function slotForState(state) { return STATE_TO_SLOT[state] || 'idle'; }
  const BUILTIN_CHARACTERS = Object.freeze({
    'salary-cat': { id: 'salary-cat', name: '打工猫', removeBackground: true },
    'milktea-mouse': {
      id: 'milktea-mouse', name: '奶茶鼠', removeBackground: false,
      credit: '原作者：阿翅 Achi · 官方账号：奶茶鼠的想法（BOBARAT）',
      files: {
        'idle': ['06', 'plus7-02', 'plus3-08', 'plus3-14', 'plus6-13'],
        'working': ['13'],
        'thinking': ['plus7-04', 'plus5-05', 'plus5-12'],
        'talking': ['05', 'plus7-13', 'plus-11', 'plus-16', 'plus3-02', 'plus6-08'],
        'juggling': ['03'],
        'sweeping': ['11'],
        'loafing': ['10', '14', 'plus7-09', 'plus-15', 'plus3-06', 'plus4-01', 'plus6-11'],
        'waiting': ['08', 'plus7-06', 'plus-09', 'plus5-13'],
        'needsinput': ['07', 'plus-03', 'plus-07', 'plus4-14', 'plus6-15'],
        'happy': ['04', '01', 'plus7-05', 'plus7-09', 'plus7-11', 'plus3-03', 'plus3-04', 'plus3-13', 'plus4-02', 'plus4-04', 'plus5-01', 'plus5-02', 'plus5-10', 'plus6-01', 'plus6-05'],
        'greet': ['01', '06', 'plus7-02', 'plus7-10', 'plus-02', 'plus-10', 'plus3-01', 'plus4-07', 'plus5-07', 'plus6-12'],
        'error': ['12', '09', 'plus7-15', 'plus3-10', 'plus4-08', 'plus4-12'],
        'sad': ['02', 'plus7-06', 'plus7-08', 'plus-04', 'plus4-06', 'plus4-10', 'plus5-14', 'plus6-04', 'plus6-09'],
        'ambient-awake': ['10', '11', '14', 'plus7-09', 'plus7-13', 'plus-05', 'plus-14', 'plus3-05', 'plus4-05', 'plus5-03', 'plus6-02', 'plus6-03', 'plus6-14'],
        'ambient-sleep': ['plus3-16', 'plus4-11', 'plus5-11'],
        'xiaban': ['16', 'plus7-12', 'plus-08', 'plus3-12', 'plus6-10'],
      },
      names: {
        '10': '花花',
        '11': '玩泥巴',
        '12': '惹',
        '13': '打错字',
        '14': '坏笑',
        '16': '再见',
        '01': '比心',
        '02': '伤心',
        '03': '双炮',
        '04': '蹦跶',
        '05': '记下了',
        '06': '系我',
        '07': '傻眼',
        '08': '好的总裁',
        '09': '漏',
        'plus7-02': '在',
        'plus7-04': '认真',
        'plus7-05': '爱了爱了',
        'plus7-06': '可怜',
        'plus7-08': '抱头痛哭',
        'plus7-09': '快乐',
        'plus7-10': '来',
        'plus7-11': '打call',
        'plus7-12': '跑啊',
        'plus7-13': '没事的',
        'plus7-15': '砸电脑',
        'plus-02': 'oi',
        'plus-03': 'emm',
        'plus-04': '哭泣',
        'plus-05': '玩雪',
        'plus-07': '呃',
        'plus-08': '跑',
        'plus-09': '戳手',
        'plus-10': '嘿',
        'plus-11': '点头',
        'plus-14': '搓脸',
        'plus-15': '喝奶茶',
        'plus-16': '阿巴阿巴',
        'plus3-01': '来了',
        'plus3-02': '没问题',
        'plus3-03': '心',
        'plus3-04': '好耶',
        'plus3-05': '开心',
        'plus3-06': '嘿嘿',
        'plus3-08': '沉默',
        'plus3-10': '发火',
        'plus3-12': '就这样吧',
        'plus3-13': '啦啦队',
        'plus3-14': '呆',
        'plus3-16': '睡觉',
        'plus4-01': '嘬奶茶',
        'plus4-02': '开心',
        'plus4-04': '抱抱',
        'plus4-05': '大步走',
        'plus4-06': '呜哇',
        'plus4-07': '在呢',
        'plus4-08': '生气',
        'plus4-10': '泪',
        'plus4-11': '困鼠',
        'plus4-12': '恼火',
        'plus4-14': '看着我',
        'plus5-01': '爱心',
        'plus5-02': '哇哦',
        'plus5-03': '好朋友',
        'plus5-05': '小心思',
        'plus5-07': '冒头',
        'plus5-10': '放烟花啦',
        'plus5-11': '哈欠',
        'plus5-12': '踱步',
        'plus5-13': '紧张',
        'plus5-14': '呜呜',
        'plus6-01': '喜欢',
        'plus6-02': '吹风',
        'plus6-03': '跳舞',
        'plus6-04': '哭麻了',
        'plus6-05': '好耶',
        'plus6-08': '好的',
        'plus6-09': '痛心',
        'plus6-10': '饭啊',
        'plus6-11': '吐舌头',
        'plus6-12': '嘿',
        'plus6-13': '丧',
        'plus6-14': '摇尾巴',
        'plus6-15': '偷偷',
      },
      notes: {
        sweeping: '暂用「玩泥巴」表示整理，可替换为专用动作。',
        xiaban: '告别、带着奶茶离开和「饭啊」轮换，表示下班或吃饭。',
      },
    },
    'mimi-bee': {
      id: 'mimi-bee', name: '小蜜蜂蜜蜜', removeBackground: false,
      credit: '原作者：花栗鼠发发（曾用名：花栗鼠 Toby）',
      files: {
        idle: ['09'], working: ['13'], thinking: ['14'], talking: ['11'],
        juggling: ['03'], sweeping: ['13'], loafing: ['08', '02'], waiting: ['10'],
        needsinput: ['12'], happy: ['04', '05'], greet: ['01'], error: ['15'],
        sad: ['06'], 'ambient-awake': ['02', '05', '09', '11'], 'ambient-sleep': ['07'], xiaban: ['16'],
      },
      notes: {
        working: '这套没有专用工作动作，暂用「卷发」表示忙碌，可继续替换。',
        sweeping: '暂用「卷发」表示整理，可替换为专用动作。',
        xiaban: '暂用「想你」表示下班告别，可继续替换。',
      },
    },
  });
  function characterDefaults(id) {
    const character = BUILTIN_CHARACTERS[id];
    if (!character) return null;
    return Object.fromEntries(SLOTS.map((slot) => [slot.id, id === 'salary-cat'
      ? slot.defaultFiles.map(builtinAsset)
      : character.files[slot.id].map((file) => ({
        id: `builtin:characters/${id}/${file}.gif`, kind: 'builtin', name: character.names?.[file] ? `${character.name} · ${character.names[file]}` : `${character.name} ${file}.gif`,
        url: `../assets/characters/${id}/${file}.gif`,
      }))]));
  }
  function builtinAsset(file) {
    return Object.freeze({
      id: `builtin:${file}`,
      kind: 'builtin',
      name: file,
      url: `../assets/cat/${file}`,
    });
  }
  function defaultSlot(slot) {
    return {
      id: slot.id,
      mode: 'default',
      usingDefaults: true,
      active: slot.defaultFiles.map(builtinAsset),
      custom: [],
    };
  }
  function defaultCatalog() {
    return {
      version: 1,
      character: { id: 'salary-cat', name: '打工猫', removeBackground: true, canDelete: false },
      characters: Object.values(BUILTIN_CHARACTERS).map((c) => ({ id: c.id, name: c.name, builtin: true, thumbnail: characterDefaults(c.id).idle[0].url })),
      fallbackAsset: builtinAsset('cat-idle.gif'),
      slots: Object.fromEntries(SLOTS.map((slot) => [slot.id, defaultSlot(slot)])),
    };
  }
  function safeAsset(value) {
    if (!value || typeof value !== 'object') return null;
    const kind = ['custom', 'builtin', 'preset'].includes(value.kind) ? value.kind : null;
    if (!kind || typeof value.id !== 'string' || typeof value.url !== 'string') return null;
    if (kind !== 'builtin' && !/^agentpaw-asset:\/\/asset\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.gif\?v=[^#]+$/i.test(value.url)) return null;
    if (kind === 'builtin' && !/^\.\.\/assets\/(?:cat\/cat-[a-z0-9-]+|characters\/milktea-mouse\/(?:plus(?:[3-7])?-)?\d{2}|characters\/mimi-bee\/\d{2})\.gif$/.test(value.url)) return null;
    return {
      id: value.id,
      kind,
      name: typeof value.name === 'string' && value.name ? value.name : value.id,
      url: value.url,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
      meta: value.meta && typeof value.meta === 'object' ? value.meta : null,
    };
  }
  function normalizeCatalog(value) {
    const fallback = defaultCatalog();
    if (!value || typeof value !== 'object' || !value.slots || typeof value.slots !== 'object') return fallback;
    const base = safeAsset(value.fallbackAsset);
    if (value.character && typeof value.character.id === 'string' && typeof value.character.name === 'string') {
      fallback.character = {
        id: value.character.id, name: value.character.name.slice(0, 40),
        removeBackground: value.character.removeBackground === true,
        canDelete: value.character.canDelete === true,
        credit: typeof value.character.credit === 'string' ? value.character.credit.slice(0, 160) : '',
      };
      if (base) {
        fallback.fallbackAsset = base;
        for (const slot of SLOTS) fallback.slots[slot.id].active = [base];
      }
    }
    if (Array.isArray(value.characters)) {
      fallback.characters = value.characters.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
        .map((c) => ({ id: c.id, name: c.name.slice(0, 40), builtin: !!BUILTIN_CHARACTERS[c.id], thumbnail: safeAsset({ id: 'preview', kind: BUILTIN_CHARACTERS[c.id] ? 'builtin' : 'preset', url: c.thumbnail })?.url || '' }));
    }
    for (const slot of SLOTS) {
      const source = value.slots[slot.id];
      if (!source || typeof source !== 'object') continue;
      const active = Array.isArray(source.active) ? source.active.map(safeAsset).filter(Boolean) : [];
      const custom = Array.isArray(source.custom) ? source.custom.map(safeAsset).filter((asset) => asset && asset.kind === 'custom') : [];
      if (!active.length) continue;
      fallback.slots[slot.id] = {
        id: slot.id,
        mode: ['append', 'replace'].includes(source.mode) ? source.mode : 'default',
        usingDefaults: source.usingDefaults !== false,
        active,
        custom,
        note: typeof source.note === 'string' ? source.note.slice(0, 240) : '',
      };
    }
    return fallback;
  }

  return { SLOT_GROUPS, SLOTS, SLOT_IDS, SLOT_BY_ID, STATE_TO_SLOT, BUILTIN_CHARACTERS, characterDefaults, slotForState, defaultCatalog, normalizeCatalog };
});
