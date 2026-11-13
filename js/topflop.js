(() => {
  "use strict";
  const { $, dePct, pctColor, escapeHtml, setStand, loadJSON } = window.MTS;

  function deDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || "");
  }

  function bars(title, entries, upSide, ix) {
    if (!entries || !entries.length) return `<article class="card"><p class="kicker">${escapeHtml(title)}</p><p class="empty">Keine Daten.</p></article>`;
    const maxAbs = Math.max(...entries.map((e) => Math.abs(e.c))) || 1;
    const rows = entries.map((e, i) => {
      const col = pctColor(e.c, Math.max(maxAbs, 1));
      const w = (Math.abs(e.c) / maxAbs) * 100;
      return `<div class="bar-row${i % 2 ? "" : " is-alt"}" data-t="${escapeHtml(e.t)}">
        ${window.MTS.starButton(e.t)}
        <div class="bar-id">
          <span class="name">${escapeHtml(window.MTS.stockName(e))}</span>
          <span class="muted">${escapeHtml(e.t)}${e.s ? ` · <a class="sector-link" href="sektor.html?ix=${encodeURIComponent(ix)}&s=${encodeURIComponent(e.s)}">${escapeHtml(e.s)}</a>` : ""}${e.p == null ? "" : " · " + window.MTS.money(e.p, e.ccy)}</span>
        </div>
        <span class="bar-val" style="color:${col}">${dePct(e.c)}</span>
        <div class="bar-track"><span class="bar-fill" style="width:${w}%;background:${col}"></span></div>
      </div>`;
    }).join("");
    return `<article class="card tf-panel">
      <div class="tf-head">
        <h2 class="${upSide ? "is-up" : "is-down"}">${escapeHtml(title)}</h2>
        <p class="muted">Tagesänderung</p>
      </div>
      ${rows}
    </article>`;
  }

  function wcol(title, colorClass, items, sideWord, nDays, ix) {
    const rows = (items || []).map((e) => `
      <div class="wh-row" data-t="${escapeHtml(e.t)}">
        ${window.MTS.starButton(e.t)}
        <span class="wh-chip ${colorClass}">${e.k}/${nDays}</span>
        <span class="name">${escapeHtml(window.MTS.stockName(e))}</span>
        <span class="muted">${escapeHtml(e.t)}  ·  <a class="sector-link" href="sektor.html?ix=${encodeURIComponent(ix)}&s=${encodeURIComponent(e.s || "")}">${escapeHtml(e.s || "")}</a></span>
        
      </div>`).join("") || `<p class="empty">Keine Wiederholer mit mindestens 2 Tagen.</p>`;
    return `<div class="wh-col">
      <h3 class="${colorClass}">${escapeHtml(title)}</h3>
      ${rows}
    </div>`;
  }

  let pack = null;

  function periodChange(row, tf) {
    if (tf === 1) return row.c;
    const pair = pack && pack.px && pack.px[row.t];
    if (!pair) return null;
    return tf === 5 ? pair[0] : pair[1];
  }

  function render(data) {
    const ix = window.MTS.pageIndex();
    const tf = window.MTS.timeframe();
    window.MTS.syncTabs(ix);
    const block = (data.by_index || {})[ix] || (ix === "SPX" ? {
      name: "S&P 500", top10: data.top10, flop10: data.flop10, session_date: data.session_date, currency: "USD",
    } : null);
    if (!block) {
      $("#app").innerHTML = `${window.MTS.indexSwitch(ix)}<p class="error">Für diesen Index liegen gerade keine Daten vor.</p>`;
      return;
    }
    setStand(data);
    const n = data.wiederholer_days || 0;
    const since = data.wiederholer_since || "06.11.2026";
    const sess = block.session_date || "";
    const ccy = block.currency ? ` · Kurse in ${block.currency}` : "";
    let top = block.top10;
    let flop = block.flop10;
    if (tf !== 1) {
      const ranked = (data.rows || []).filter((r) => (r.ix || []).includes(ix)).map((r) => ({
        t: r.t, n: r.n, s: r.s, p: r.p, ccy: r.ccy, c: periodChange(r, tf),
      })).filter((r) => r.c != null);
      top = ranked.slice().sort((a, b) => b.c - a.c).slice(0, 10);
      flop = ranked.slice().sort((a, b) => a.c - b.c).slice(0, 10);
    }
    const wiederholer = ix === "SPX" && tf === 1 ? `
      <article class="card wh-card">
        <div class="tf-head">
          <h2>Wiederholer seit ${escapeHtml(deDate(since))}</h2>
          <p class="muted">Fortlaufender Zähler  ·  ${n} Handelstage</p>
        </div>
        <div class="wh-grid">
          ${wcol("Im Top", "is-up", (data.wiederholer || {}).top, "Top", n, ix)}
          ${wcol("Im Flop", "is-down", (data.wiederholer || {}).flop, "Flop", n, ix)}
        </div>
      </article>` : `
      <p class="note">Der Wiederholer-Zähler läuft nur für den S&P 500.</p>`;
    $("#app").innerHTML = `
      ${window.MTS.indexSwitch(ix)}
      <div class="tool-row">${window.MTS.tfSwitcher()}${window.MTS.exportButton()}<a class="chip" href="wiederholer.html?ix=${encodeURIComponent(ix)}">Wiederholer-Zählung</a></div>
      <div class="tf-title-row">
        <p class="kicker">${tf === 1 ? "Tages-Top und -Flop" : window.MTS.periodName(tf)}  ·  ${escapeHtml(block.name || window.MTS.indexName(ix))}</p>
        <p class="muted">${tf === 1 ? "Letzte Sitzung" : "Handelstage"} ${escapeHtml(sess)}${escapeHtml(ccy)}</p>
      </div>
      <div class="tf-grid">
        ${bars("Top 10", top, true, ix)}
        ${bars("Flop 10", flop, false, ix)}
      </div>
      ${wiederholer}
    `;
    window.__mtsTop = {
      title: `Top / Flop · ${block.name || window.MTS.indexName(ix)}`,
      subtitle: `${window.MTS.periodName(tf)} · ${sess}`,
      top: (top || []).map((r) => ({ t: r.t, n: r.n, pct: window.MTS.dePct(r.c), color: window.MTS.cardColor(r.c) })),
      flop: (flop || []).map((r) => ({ t: r.t, n: r.n, pct: window.MTS.dePct(r.c), color: window.MTS.cardColor(r.c) })),
    };
  }

  let latest = null;
  async function start() {
    try {
      const [data, loaded] = await Promise.all([loadJSON("data/stocks.json"), window.MTS.returns()]);
      pack = loaded;
      latest = data;
      render(data);
    } catch (err) {
      $("#app").innerHTML = `<p class="error">Die Kursdaten konnten nicht geladen werden. Bitte später erneut öffnen.</p>`;
      console.error(err);
    }
  }
  document.getElementById("app").addEventListener("click", (e) => {
    if (e.target.closest("[data-star]") || e.target.closest("a")) return;
    const row = e.target.closest("[data-t]");
    if (row) location.href = `aktie.html?t=${encodeURIComponent(row.dataset.t)}`;
  });
  start();
  setInterval(() => { loadJSON("data/stocks.json").then((d) => { latest = d; render(d); }).catch(() => {}); }, window.MTS.REFRESH_MS);
  document.addEventListener("mts-tf", () => { if (latest) render(latest); });
  document.addEventListener("mts-theme", () => { if (latest) render(latest); });
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-export]") || !window.__mtsTop) return;
    const btn = e.target.closest("[data-export]");
    btn.disabled = true;
    try {
      await window.MTS.saveCard({ kind: "topflop", ...window.__mtsTop, filename: "mts-topflop.png" });
    } catch (err) {
      console.error(err);
    }
    btn.disabled = false;
  });
})();
