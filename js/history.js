/* Client-side reads of data/history. No network of its own. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.MTS) window.MTS.history = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function ymdToUtc(ymd) {
    const n = Number(ymd);
    const y = Math.floor(n / 10000);
    const m = Math.floor((n % 10000) / 100);
    const d = n % 100;
    return Date.UTC(y, m - 1, d);
  }

  function deYmd(ymd) {
    const s = String(ymd).padStart(8, "0");
    return `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}`;
  }

  function isoMonday(ymd) {
    const n = Number(ymd);
    const dt = new Date(ymdToUtc(n));
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() - (day - 1));
    return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
  }

  function dayReturn(points, ymd) {
    if (!points || !points.length) return null;
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] < ymd) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= points.length || points[lo][0] !== ymd || lo === 0) return null;
    const prev = points[lo - 1][1];
    const close = points[lo][1];
    if (!(prev > 0) || !(close > 0)) return null;
    return (close / prev - 1) * 100;
  }

  function closeOnOrBefore(points, ymd) {
    if (!points || !points.length) return null;
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] <= ymd) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? null : points[lo - 1];
  }

  function spanReturn(points, anchor, end) {
    const a = closeOnOrBefore(points, anchor);
    const b = closeOnOrBefore(points, end);
    if (!a || !b || !(b[0] > a[0]) || !(a[1] > 0) || !(b[1] > 0)) return null;
    if (ymdToUtc(anchor) - ymdToUtc(a[0]) > 10 * 86400000) return null;
    return (b[1] / a[1] - 1) * 100;
  }

  function indexSessions(series, tickers, minFrac) {
    const frac = minFrac == null ? 0.5 : minFrac;
    const counts = new Map();
    let known = 0;
    for (const t of tickers) {
      const pts = series[t];
      if (!pts) continue;
      known += 1;
      for (let i = 0; i < pts.length; i++) {
        const d = pts[i][0];
        counts.set(d, (counts.get(d) || 0) + 1);
      }
    }
    const need = Math.max(8, Math.floor(known * frac));
    return [...counts.entries()]
      .filter((pair) => pair[1] >= need)
      .map((pair) => pair[0])
      .sort((a, b) => a - b);
  }

  function leaders(series, rows, windowSize) {
    const tickers = rows.map((r) => r.t);
    const byT = new Map(rows.map((r) => [r.t, r]));
    const sessions = indexSessions(series, tickers);
    const usable = sessions.filter((d) => {
      let n = 0;
      for (let i = 0; i < tickers.length; i++) {
        if (dayReturn(series[tickers[i]], d) != null) n += 1;
        if (n >= 10) return true;
      }
      return false;
    });
    const picked = windowSize === "all" || windowSize === "alle" ? usable : usable.slice(-Number(windowSize) || 0);
    const top = new Map();
    const flop = new Map();
    for (const d of picked) {
      const scored = [];
      for (const row of rows) {
        const pct = dayReturn(series[row.t], d);
        if (pct == null) continue;
        scored.push(row.t);
        scored[scored.length - 1] = { t: row.t, pct };
      }
      scored.sort((a, b) => b.pct - a.pct);
      const n = scored.length;
      const take = Math.min(10, n);
      for (let i = 0; i < take; i++) top.set(scored[i].t, (top.get(scored[i].t) || 0) + 1);
      for (let i = 0; i < take; i++) {
        const row = scored[n - 1 - i];
        if (!row || topHas(scored, i, n)) continue;
        flop.set(row.t, (flop.get(row.t) || 0) + 1);
      }
    }
    const list = (map) => [...map.entries()]
      .map(([t, k]) => {
        const row = byT.get(t) || {};
        return { t, k, n: row.n || t, s: row.s || "" };
      })
      .sort((a, b) => b.k - a.k || (a.t < b.t ? -1 : 1));
    return {
      n: picked.length,
      from: picked[0] || null,
      to: picked[picked.length - 1] || null,
      top: list(top),
      flop: list(flop),
    };
  }

  function topHas(scored, flopIndex, n) {
    const take = Math.min(10, n);
    if (n > take * 2) return false;
    const row = scored[n - 1 - flopIndex];
    for (let i = 0; i < take; i++) if (scored[i].t === row.t) return true;
    return false;
  }

  function weekBlock(sessions, monday) {
    const days = sessions.filter((d) => isoMonday(d) === monday);
    if (!days.length) return null;
    let anchor = null;
    for (const d of sessions) {
      if (d < days[0]) anchor = d;
      else break;
    }
    if (anchor == null) return null;
    return { monday, start: days[0], end: days[days.length - 1], anchor, days: days.length };
  }

  function weekBlocks(sessions) {
    if (!sessions || !sessions.length) return { current: null, previous: null };
    const mons = [];
    const seen = new Set();
    for (const d of sessions) {
      const mon = isoMonday(d);
      if (!seen.has(mon)) {
        seen.add(mon);
        mons.push(mon);
      }
    }
    const cur = mons[mons.length - 1];
    const prev = mons.length >= 2 ? mons[mons.length - 2] : null;
    return { current: weekBlock(sessions, cur), previous: prev == null ? null : weekBlock(sessions, prev) };
  }

  function weighted(series, rows, anchor, end) {
    const usable = [];
    for (const row of rows) {
      const ret = spanReturn(series[row.t], anchor, end);
      if (ret == null) continue;
      usable.push({ row, ret, w: Number(row.mc) > 0 ? Number(row.mc) : 0 });
    }
    const anyW = usable.some((x) => x.w > 0);
    let iw = 0;
    let ir = 0;
    const bySec = new Map();
    for (const x of usable) {
      const w = anyW ? x.w : 1;
      if (!(w > 0)) continue;
      iw += w;
      ir += w * x.ret;
      const name = x.row.s || "–";
      const g = bySec.get(name) || { name, w: 0, r: 0 };
      g.w += w;
      g.r += w * x.ret;
      bySec.set(name, g);
    }
    const sectors = [...bySec.values()]
      .filter((g) => g.w > 0)
      .map((g) => ({ name: g.name, pct: g.r / g.w }))
      .sort((a, b) => b.pct - a.pct);
    return { indexPct: iw ? ir / iw : null, sectors, n: usable.length };
  }

  return { dayReturn, indexSessions, leaders, weekBlocks, weighted, deYmd, isoMonday, spanReturn };
});
