(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgentPawUsage = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const fields = ['tokens', 'cost', 'messages', 'inputTotal', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h', 'cacheWriteUnspecified', 'reasoningOutput'];
  const num = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  function dayKey(value) {
    const d = value instanceof Date ? value : new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function offset(key, days) {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d + days, 12));
  }
  function sum(rows) {
    const out = Object.fromEntries(fields.map(key => [key, 0]));
    out.known = rows.length > 0;
    out.detailComplete = rows.length > 0 && rows.every(row => row.detailComplete === true);
    for (const row of rows) for (const key of fields) out[key] += num(row[key]);
    out.cacheRate = out.detailComplete && out.inputTotal > 0 ? out.cacheRead / out.inputTotal * 100 : null;
    out.normalInput = out.detailComplete ? out.inputTotal - out.cacheRead - out.cacheWrite : null;
    return out;
  }
  function sources(data, source = 'all') {
    return (data?.sources || []).filter(row => source === 'all' || row.id === source);
  }
  function daysBetween(start, end) {
    const out = [];
    for (let day = start; day <= end && out.length < 366; day = offset(day, 1)) out.push(day);
    return out;
  }
  function selection(data, state) {
    const today = dayKey(data.asOf);
    const range = state.range || 'today';
    const count = range === '30d' ? 30 : range === '7d' ? 7 : 1;
    const end = range === 'day' ? state.day : range === 'today' ? today : offset(today, -1);
    const start = offset(end, 1 - count);
    const keys = daysBetween(start, end);
    const previousKeys = daysBetween(offset(start, -count), offset(start, -1));
    const scoped = sources(data, state.source);
    const gather = dates => scoped.flatMap(source => dates.flatMap(key => source.daily[key] ? [source.daily[key]] : []));
    const current = sum(gather(keys)), previous = sum(gather(previousKeys));
    const participants = scoped.filter(source => [...keys, ...previousKeys].some(key => source.daily[key]));
    // No extrapolation for missing buckets, unavailable sources or a live day.
    const comparable = end < today && participants.length > 0
      && !scoped.some(source => source.unavailable)
      && participants.every(source => [...keys, ...previousKeys].every(key => source.daily[key]));
    return {
      start, end, keys, previousKeys, current, previous, comparable, today,
      recordedDays: keys.filter(key => scoped.some(source => source.daily[key])).length,
      bySource: scoped.map(source => ({ id: source.id, name: source.label, ...sum(keys.flatMap(key => source.daily[key] ? [source.daily[key]] : [])) })).filter(row => row.known),
      byModel: modelsFor(scoped, keys),
    };
  }
  function modelsFor(scoped, keys) {
    const groups = new Map();
    function add(id, name, tokens, cost) {
      const row = groups.get(id) || { id, name, tokens: 0, cost: 0, known: true };
      row.tokens += num(tokens); row.cost += num(cost); groups.set(id, row);
    }
    for (const source of scoped) for (const key of keys) {
      const day = source.daily[key];
      if (!day) continue;
      const entries = Object.entries(source.modelsByDay[key] || {});
      const tokens = entries.reduce((n, [, row]) => n + num(row.tokens), 0);
      const cost = entries.reduce((n, [, row]) => n + num(row.cost), 0);
      // Older views can lag their daily ledger. Do not invent negative
      // residuals or display shares whose sum exceeds the period total.
      if (tokens > day.tokens || cost > day.cost + 1e-8) {
        add('missing:', '模型明细缺失', day.tokens, day.cost);
        continue;
      }
      for (const [name, row] of entries) add('model:' + name, name, row.tokens, row.cost);
      if (day.tokens > tokens || day.cost - cost > 1e-8) add('missing:', '模型明细缺失', day.tokens - tokens, Math.max(0, day.cost - cost));
    }
    return [...groups.values()];
  }
  function activity(data, source = 'all') {
    const today = dayKey(data.asOf), scoped = sources(data, source);
    return daysBetween(offset(today, -89), today).map(key => ({
      key, ...sum(scoped.flatMap(row => row.daily[key] ? [row.daily[key]] : [])), live: key === today,
    }));
  }
  function chartPoints(days, view) {
    if (view === 'daily') return days;
    if (view === 'cumulative') {
      let total = 0;
      return days.map(day => ({ ...day, value: total += day.tokens }));
    }
    const groups = new Map();
    for (const day of days) {
      const weekday = new Date(day.key + 'T12:00:00').getDay();
      const key = offset(day.key, -((weekday + 6) % 7));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(day);
    }
    return [...groups.entries()].map(([key, week]) => ({
      key, end: offset(key, 6), value: week.reduce((n, day) => n + day.tokens, 0),
      known: week.some(day => day.known), partial: week.length !== 7 || week.some(day => day.live || !day.known),
    }));
  }
  function change(current, previous) {
    if (!previous) return current ? '新增用量' : '无变化';
    const pct = (current - previous) / previous * 100;
    return Math.abs(pct) < .05 ? '持平' : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}%`;
  }
  return { num, dayKey, offset, sum, sources, selection, activity, chartPoints, change };
});
