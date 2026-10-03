'use strict';
// Synthetic, normalized through the production projection. No user files read.
const { buildPanelUsage } = require('../backend/panel-stats');
const A = require('../shared/usage-analytics');
module.exports = function previewStats(now = Date.now()) {
  const today = A.dayKey(now), meters = [];
  for (const [index, id] of ['codex', 'claude', 'workbuddy'].entries()) {
    const daily = {}, byModelByDay = {}, lifetime = {};
    for (let offset = -81; offset <= 0; offset++) {
      if (offset === -23) continue;
      const key = A.offset(today, offset), weekend = [0, 6].includes(new Date(key + 'T12:00:00').getDay());
      const tokens = offset === -10 ? 0 : Math.round((320000 + index * 90000) * (1 + .2 * Math.sin(offset)) * (weekend ? .25 : 1));
      const output = Math.round(tokens * .08), inputTotal = tokens - output;
      const cache = Math.round(inputTotal * (.68 - index * .1)), write = id === 'claude' ? Math.round(inputTotal * .06) : 0;
      const row = { tokens, input: id === 'claude' ? inputTotal - cache - write : inputTotal, output, msgs: tokens ? Math.ceil(tokens / 9000) : 0, cost: id === 'workbuddy' ? 0 : tokens * .000002 };
      if (id === 'claude') Object.assign(row, { cacheRead: cache, cacheWrite5m: write });
      else Object.assign(row, { cachedInput: cache, reasoningOutput: id === 'codex' ? Math.round(output * .5) : 0 });
      daily[key] = row;
      const model = id === 'codex' ? offset < -7 ? 'gpt-5.4' : 'gpt-5.5' : id === 'claude' ? 'claude-sonnet-4' : 'unknown-model';
      byModelByDay[key] = { [model]: { ...row } };
      for (const [field, value] of Object.entries(row)) lifetime[field] = (lifetime[field] || 0) + value;
    }
    meters.push([id, { daily, byModelByDay, today: daily[today], byModel: byModelByDay[today], lifetime }]);
  }
  return {
    usage: buildPanelUsage(meters, now),
    active: { project: '实现预览 · 测试数据', model: 'gpt-5.5' },
    sessions: [
      { agent: 'codex', state: 'working', project: 'AgentPaw', op: '检查统计口径', contextPercent: 68 },
      { agent: 'claude', state: 'waiting', project: 'Panel', reason: 'default', contextPercent: 31 },
    ],
    lastOps: [{ agent: 'codex', icon: '🔧', detail: '检查缓存统计', project: 'AgentPaw', ts: now }],
  };
};
