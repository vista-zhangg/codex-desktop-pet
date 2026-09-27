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
        'idle': ['06', 'plus7-02', 'plus3-08', 'plus3-14'],
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
        'idle': ['09', 'set2-02', 'set3-09', 'set6-02'],
        'working': ['set2-09'],
        'thinking': ['set3-13'],
        'talking': ['11', 'set2-01', 'set4-06', 'set4-15', 'set5-12'],
        'juggling': ['03'],
        'sweeping': ['13'],
        'loafing': ['08', '02', 'set2-08', 'set3-15'],
        'waiting': ['10', 'set2-10', 'set4-08'],
        'needsinput': ['12', '14', 'set3-07', 'set4-14'],
        'happy': ['04', '05', 'set2-05', 'set2-06', 'set2-11', 'set3-04', 'set4-02', 'set5-04', 'set6-01'],
        'greet': ['01', 'set2-04', 'set2-12', 'set3-02', 'set4-01', 'set4-03', 'set5-02', 'set5-13'],
        'error': ['15', 'set3-10', 'set4-10'],
        'sad': ['06', 'set3-08', 'set4-05', 'set5-07'],
        'ambient-awake': ['02', '05', '09', '11', 'set3-03', 'set3-14', 'set3-15', 'set5-01', 'set5-03', 'set6-02'],
        'ambient-sleep': ['07', 'set2-16'],
        'xiaban': ['16', 'set2-14', 'set3-05', 'set4-04'],
      },
      names: {
        '10': '安慰',
        '11': '送你',
        '12': '什么',
        '13': '卷发',
        '14': '看看',
        '15': '生气',
        '16': '想你',
        '01': '嗨',
        '02': '扭屁股',
        '03': '跳舞',
        '04': '哇',
        '05': '开心',
        '06': '哭',
        '07': '睡觉',
        '08': '不关我事',
        '09': '害羞',
        'set2-01': '嗯嗯',
        'set2-02': '嘿嘿',
        'set2-04': '来了',
        'set2-05': '耶',
        'set2-06': '加油',
        'set2-08': '略略略',
        'set2-09': '工作',
        'set2-10': '那个',
        'set2-11': '骄傲',
        'set2-12': '醒了',
        'set2-14': '好吃',
        'set2-16': '困',
        'set3-02': '嘻嘻',
        'set3-03': '跳舞',
        'set3-04': '发射爱心',
        'set3-05': '好吃',
        'set3-07': '不知道',
        'set3-08': '委屈',
        'set3-09': '无聊',
        'set3-10': '生气',
        'set3-13': '思考',
        'set3-14': '啦啦啦',
        'set3-15': '喝奶茶',
        'set4-01': '你好',
        'set4-02': '棒',
        'set4-03': '早安',
        'set4-04': 'GO',
        'set4-05': '安慰',
        'set4-06': '遵命',
        'set4-08': '偷看',
        'set4-10': '哼',
        'set4-14': '怎么啦',
        'set4-15': '安排',
        'set5-01': '后踢腿',
        'set5-02': '我去上班',
        'set5-03': '我自己玩',
        'set5-04': '超开心',
        'set5-07': '有点委屈',
        'set5-12': '谢谢',
        'set5-13': '哈喽',
        'set6-01': '贴贴',
        'set6-02': '无聊',
      },
      notes: {
        sweeping: '暂用「卷发」表示整理，可替换为专用动作。',
        xiaban: '吃饭、出发和「想你」告别动作轮换。',
      },
    },
    'line-dog': {
      id: 'line-dog', name: '线条小狗', removeBackground: false,
      credit: '原作者：Moonlab Studio（moonlab_studio）· 官方账号：线条小狗Maltese',
      files: {
        'idle': ['set3-10', 'set2-16'],
        'working': ['set2-18'],
        'thinking': ['set2-09', 'set3-18'],
        'talking': ['set1-15', 'set2-21', 'set3-04', 'set3-07', 'set3-08', 'set3-12', 'set3-13', 'set4-23'],
        'juggling': ['set2-18'],
        'sweeping': ['set2-10'],
        'loafing': ['set1-05', 'set1-20', 'set4-08'],
        'waiting': ['set1-22', 'set2-05', 'set2-23'],
        'needsinput': ['set1-11', 'set2-12', 'set2-13', 'set3-19', 'set4-12', 'set4-13'],
        'happy': ['set1-02', 'set1-04', 'set1-10', 'set1-19', 'set2-07', 'set3-05', 'set4-01', 'set4-04', 'set4-16'],
        'greet': ['set1-01', 'set1-09', 'set1-12', 'set3-09', 'set4-11'],
        'error': ['set1-06', 'set1-18', 'set2-22', 'set3-16'],
        'sad': ['set2-11', 'set3-14', 'set4-22'],
        'ambient-awake': ['set1-03', 'set1-05', 'set3-02', 'set4-02', 'set4-17', 'set4-18', 'set4-21'],
        'ambient-sleep': ['set1-24', 'set2-24', 'set4-24'],
        'xiaban': ['set2-14', 'set3-24'],
      },
      names: {
        'set1-01': '嗨',
        'set1-02': '爱你',
        'set1-03': '啦啦啦',
        'set1-04': '加油',
        'set1-05': '摆烂',
        'set1-06': '烦',
        'set1-09': '出现',
        'set1-10': '哇',
        'set1-11': '什么',
        'set1-12': '来了',
        'set1-15': 'OK',
        'set1-18': '凌乱',
        'set1-19': '庆祝',
        'set1-20': '划水',
        'set1-22': '期待',
        'set1-24': '晚安',
        'set2-05': '快点',
        'set2-07': '庆祝',
        'set2-09': '可疑',
        'set2-10': '甩',
        'set2-11': '哭',
        'set2-12': '惊讶',
        'set2-13': '在干嘛',
        'set2-14': '溜了',
        'set2-16': '无聊',
        'set2-18': '努力',
        'set2-21': '好',
        'set2-22': '打翻',
        'set2-23': '我在听',
        'set2-24': '晚安',
        'set3-02': '开心',
        'set3-04': '谢谢',
        'set3-05': '庆祝',
        'set3-07': '送你花花',
        'set3-08': '非常好',
        'set3-09': '喂喂',
        'set3-10': '呆',
        'set3-12': '完成',
        'set3-13': 'OK',
        'set3-14': '呜呜呜',
        'set3-16': '震惊',
        'set3-18': '画圈圈',
        'set3-19': '什么',
        'set3-24': '晚安',
        'set4-01': '小心心',
        'set4-02': '跳舞',
        'set4-04': '好耶',
        'set4-08': '略略略',
        'set4-11': '我来啦',
        'set4-12': '警觉',
        'set4-13': '找我吗',
        'set4-16': '好朋友',
        'set4-17': '挠痒痒',
        'set4-18': '啦啦啦',
        'set4-21': '翻跟头',
        'set4-22': '不高兴',
        'set4-23': '会好的',
        'set4-24': '躺好',
      },
      notes: {
        juggling: '暂无专用并行动作，暂与工作状态共用「努力」。',
        sweeping: '暂用「甩」的抖毛巾动作表示整理，可替换为专用清理动作。',
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
    if (kind === 'builtin' && !/^\.\.\/assets\/(?:cat\/cat-[a-z0-9-]+|characters\/milktea-mouse\/(?:plus(?:[3-7])?-)?\d{2}|characters\/mimi-bee\/(?:set[2-6]-)?\d{2}|characters\/line-dog\/set[1-4]-\d{2})\.gif$/.test(value.url)) return null;
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
