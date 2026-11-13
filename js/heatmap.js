(() => {
  "use strict";
  const { $, dePct, pctColor, escapeHtml, setStand, loadJSON, indexSwitch, pageIndex, syncTabs, tfSwitcher, exportButton, timeframe, periodName, returns, SECTORS, INDEX_EXCHANGE } = window.MTS;
  let stocks = null;
  let pack = null;
  let lastTiles = [];

  function squarify(items, x, y, w, h) {
    if (!items.length || w <= 0 || h <= 0) return [];
    if (items.length === 1) return [{ item: items[0], x, y, w, h }];
    const total = items.reduce((sum, it) => sum + it.size, 0) || 1;
    let acc = 0;
    let split = 1;
    for (let i = 0; i < items.length; i++) {
      acc += items[i].size;
      split = i + 1;
      if (acc >= total / 2) break;
    }
    if (split >= items.length) split = items.length - 1;
    const left = items.slice(0, split);
    const right = items.slice(split);
    const leftSum = left.reduce((sum, it) => sum + it.size, 0);
    const frac = Math.min(0.86, Math.max(0.14, leftSum / total));
    if (w >= h) {
      const aw = w * frac;
      return squarify(left, x, y, aw, h).concat(squarify(right, x + aw, y, w - aw, h));
    }
    const ah = h * frac;
    return squarify(left, x, y, w, ah).concat(squarify(right, x, y + ah, w, h - ah));
  }

  function changeOf(row) {
    const tf = timeframe();
    if (tf === 1) return row.c;
    const pair = pack && pack.px && pack.px[row.t];
    if (!pair) return null;
    return tf === 5 ? pair[0] : pair[1];
  }

  function sectorPct(ix, name) {
    const tf = timeframe();
    if (tf === 1) return null;
    const pair = pack && pack.sec && pack.sec[ix] && pack.sec[ix][name];
    if (!pair) return null;
    return tf === 5 ? pair[0] : pair[1];
  }

  function render() {
    const ix = pageIndex();
    syncTabs(ix);
    const tf = timeframe();
    const rows = (stocks.rows || []).filter((r) => (r.ix || []).includes(ix) && changeOf(r) != null);
    const groups = SECTORS.map((name) => {
      const members = rows.filter((r) => r.s === name).map((r) => ({
        t: r.t,
        n: r.n,
        size: Math.max(Number(r.mc) || 0, 0.02),
        pct: changeOf(r),
      })).sort((a, b) => b.size - a.size);
      const mc = members.reduce((sum, m) => sum + (Number(m.size) || 0), 0);
      return { name, members, mc, pct: sectorPct(ix, name) };
    }).filter((g) => g.members.length);
    const total = groups.reduce((sum, g) => sum + g.mc, 0) || 1;
    lastTiles = [];
    let yCursor = 0;
    const html = groups.map((g) => {
      const height = Math.max(128, Math.round((g.mc / total) * 1100));
      const frac = g.mc / total;
      const rects = squarify(g.members, 0, 0, 100, 100);
      const tiles = rects.map((rect) => {
        const pad = 0.6;
        const label = window.MTS.shortName(rect.item.n, rect.item.t);
        lastTiles.push({
          t: rect.item.t,
          n: label,
          pct: dePct(rect.item.pct),
          pctNum: rect.item.pct,
          color: pctColor(rect.item.pct),
          x: (rect.x + pad) / 100,
          y: yCursor + ((rect.y + pad) / 100) * frac,
          w: Math.max(0, (rect.w - pad * 2) / 100),
          h: Math.max(0, ((rect.h - pad * 2) / 100) * frac),
        });
        const namePx = Math.max(11, Math.min(18, Math.round(Math.min(rect.w, rect.h * 1.3) * 0.22 + 9)));
        const showName = rect.w >= 9 && rect.h >= 11;
        const showTicker = showName && rect.item.t !== label && rect.w >= 18 && rect.h >= 22;
        const showPct = rect.w >= 14 && rect.h >= 22;
        return `<a class="heat-tile" href="aktie.html?t=${encodeURIComponent(rect.item.t)}" style="left:${rect.x}%;top:${rect.y}%;width:${rect.w}%;height:${rect.h}%;background:${pctColor(rect.item.pct)}">
          ${showName ? `<span class="heat-name" style="font-size:${namePx}px">${escapeHtml(label)}</span>` : ""}
          ${showTicker ? `<span class="heat-meta">${escapeHtml(rect.item.t)}</span>` : ""}
          ${showPct ? `<span class="heat-pct">${dePct(rect.item.pct)}</span>` : ""}
        </a>`;
      }).join("");
      yCursor += frac;
      const head = g.pct == null ? "" : ` <span style="color:${pctColor(g.pct)}">${dePct(g.pct)}</span>`;
      return `<section class="heat-sec"><h2><a href="sektor.html?ix=${encodeURIComponent(ix)}&s=${encodeURIComponent(g.name)}">${escapeHtml(g.name)}</a>${head}</h2><div class="heat-band" style="height:${height}px">${tiles}</div></section>`;
    }).join("");
    $("#app").innerHTML = `
      ${indexSwitch(ix)}
      <div class="tool-row">${tfSwitcher()}${exportButton()}</div>
      <p class="note">${periodName(tf)} · Fläche nach Börsenwert</p>
      ${html || `<p class="empty">Für diesen Index liegen keine Flächen vor.</p>`}`;
    window.__mtsHeat = { ix, tf, tiles: lastTiles, title: `Heatmap · ${window.MTS.indexName(ix)}` };
  }

  document.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-export]") || !window.__mtsHeat) return;
    const btn = e.target.closest("[data-export]");
    btn.disabled = true;
    try {
      await window.MTS.saveCard({
        kind: "heatmap",
        title: window.__mtsHeat.title,
        subtitle: `${periodName(window.__mtsHeat.tf)} · ${new Date().toLocaleDateString("de-DE")}`,
        tiles: (window.__mtsHeat.tiles || []).map((tile) => ({ ...tile, color: window.MTS.cardColor(tile.pctNum) })),
        filename: "mts-heatmap.png",
      });
    } catch (err) {
      console.error(err);
    }
    btn.disabled = false;
  });

  document.addEventListener("mts-theme", () => { if (stocks) render(); });

  async function start() {
    try {
      [stocks, pack] = await Promise.all([loadJSON("data/stocks.json"), returns()]);
      setStand(stocks);
      render();
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Die Heatmap konnte nicht geladen werden.</p>`;
    }
  }
  document.addEventListener("mts-tf", () => { if (stocks) render(); });
  start();
})();
