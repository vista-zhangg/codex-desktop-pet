'use strict';

const { normalizeSourceRow } = require('./usage-stats');
const { SOURCE_REGISTRY } = require('./source-registry');
const { dayKey } = require('./metering-common');

// A presentation-only projection. Never rewrite/reprice the provider ledgers.
// Keep provenance we can establish; absent calendar buckets are NOT zero days.
function panelRow(source, raw) {
  const n = normalizeSourceRow(source, raw);
  const cacheWrite = n.cacheCreate;
  return {
    tokens: n.tokens, cost: n.cost, messages: n.messages,
    inputTotal: n.inputTotal, output: n.output, cacheRead: n.cacheRead,
    cacheWrite, reasoningOutput: n.reasoningOutput,
    // Only Claude's fields identify TTL. Other sources' generic cache writes
    // must not inherit the legacy UI alias "5m".
    cacheWrite5m: source === 'claude' ? n.cacheWrite5m : 0,
    cacheWrite1h: source === 'claude' ? n.cacheWrite1h : 0,
    cacheWriteUnspecified: source === 'claude' ? Math.max(0, cacheWrite - n.cacheWrite5m - n.cacheWrite1h) : cacheWrite,
    detailComplete: Math.abs(n.inputTotal + n.output - n.tokens) < 1
      && n.cacheRead + cacheWrite <= n.inputTotal,
  };
}

function buildPanelUsage(sourceRows, now = Date.now()) {
  const today = dayKey(now);
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - 94);
  const cutoff = dayKey(start);
  const meters = new Map(sourceRows);
  return {
    version: 1, asOf: now,
    sources: SOURCE_REGISTRY.map(({ id, label }) => {
      const meter = meters.get(id);
      const daily = Object.create(null), modelsByDay = Object.create(null);
      for (const [key, raw] of Object.entries(meter?.daily || {})) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < cutoff || key > today) continue;
        daily[key] = panelRow(id, raw);
      }
      // Live aggregate supersedes its persisted bucket, never adds to it.
      if (meter?.today && (daily[today] || Number(meter.today.tokens) > 0 || Number(meter.today.msgs || meter.today.messages) > 0)) {
        daily[today] = panelRow(id, meter.today);
      }
      for (const key of Object.keys(daily)) {
        const models = key === today ? meter.byModel : meter.byModelByDay?.[key];
        modelsByDay[key] = Object.fromEntries(Object.entries(models || {}).map(([model, raw]) => {
          const row = panelRow(id, raw);
          return [model, { tokens: row.tokens, cost: row.cost }];
        }));
      }
      return {
        id, label, available: !!meter,
        unavailable: !!meter?.diagnostics?.unavailable,
        daily, modelsByDay,
        lifetime: meter ? panelRow(id, meter.lifetime || {}) : null,
      };
    }),
  };
}

module.exports = { panelRow, buildPanelUsage };
