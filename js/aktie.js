(() => {
  "use strict";
  const { $, deNum, dePct, pctColor, escapeHtml, sparkSVG, setStand, loadJSON, starButton, indexName } = window.MTS;
  const SHARDS = 16;

  function shardOf(ticker) {
    let h = 0;
    for (let i = 0; i < ticker.length; i++) h = (Math.imul(h, 33) + ticker.charCodeAt(i)) >>> 0;
    return h % SHARDS;
  }

  function deDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || "");
  }

  function earnText(item) {
    if (!item) return "Kein Termin in den Yahoo-Daten.";
    const when = deDate(item.d);
    if (item.kind === "unconfirmed") return `${when} · unbestätigt`;
    if (item.est || item.kind === "estimate") return `${when} · geschätzt`;
    return when;
  }

  function rangeBlock(r) {
    if (r.p == null || r.dH == null || r.dL == null) {
      return `<p class="note">52-Wochen-Spanne nicht verfügbar.</p>`;
    }
    const high = r.p / (1 + r.dH / 100);
    const low = r.p / (1 + r.dL / 100);
    const span = high - low;
    const pos = span > 0 ? Math.max(0, Math.min(100, ((r.p - low) / span) * 100)) : 50;
    const nd = r.ccy === "JPY" || r.ccy === "KRW" ? 0 : 2;
    return `<div class="range-row">
      <span class="muted">${deNum(low, nd)}</span>
      <div class="range-track"><span class="range-mark" style="left:${pos.toFixed(1)}%"></span></div>
      <span class="muted">${deNum(high, nd)}</span>
    </div>`;
  }

  const state = { row: null, earn: null, year: null, range: "30" };

  function chartValues() {
    if (state.range === "1y" && state.year && state.year.length) return state.year.map((p) => p[1]);
    return state.row.sp || [];
  }

  function render() {
    const r = state.row;
    if (!r) return;
    const col = pctColor(r.c);
    const ix = (r.ix || []).map((id) => indexName(id)).join(" · ");
    const values = chartValues();
    const note = state.range === "1y"
      ? (state.year ? "Tägliche Schlusskurse, etwa ein Jahr." : "Verlauf wird geladen …")
      : "Letzte 30 Handelstage, täglicher Schlusskurs.";
    $("#app").innerHTML = `
      <a class="detail-back" href="./scanner.html">Zur Liste</a>
      <article class="card">
        <div class="tf-head">
          <div>
            <p class="kicker">${escapeHtml(r.t)}</p>
            <p class="modal-name">${escapeHtml(r.n)}</p>
          </div>
          ${starButton(r.t)}
        </div>
        <p class="detail-px">${window.MTS.money(r.p, r.ccy)}</p>
        <p class="detail-chg ${r.c >= 0 ? "is-up" : "is-down"}">${dePct(r.c)} zur letzten Sitzung</p>
      </article>
      <article class="card chart-card">
        <div class="chart-toggle">
          <button type="button" class="chip${state.range === "30" ? " is-on" : ""}" data-range="30">30 Tage</button>
          <button type="button" class="chip${state.range === "1y" ? " is-on" : ""}" data-range="1y">1 Jahr</button>
        </div>
        ${values.length > 1 ? sparkSVG(values, col, 640, 180) : `<p class="empty">Kein Verlauf verfügbar.</p>`}
        <p class="note">${note}</p>
        <p class="kicker">52-Wochen-Spanne</p>
        ${rangeBlock(r)}
      </article>
      <article class="card">
        <ul class="stat-list">
          <li>Sektor: ${escapeHtml(r.s || "–")}</li>
          <li>Index: ${escapeHtml(ix || "–")}</li>
          <li>Börsenwert: ${r.mc == null ? "nicht verfügbar" : deNum(r.mc, 1) + " Mrd. USD"}</li>
          <li>Relatives Volumen: ${r.rv == null ? "nicht verfügbar" : deNum(r.rv) + "×"}</li>
          <li>Nächster Termin: ${escapeHtml(earnText(state.earn))}</li>
        </ul>
      </article>`;
    document.title = `${r.t} · MTS`;
  }

  async function loadYear() {
    if (state.year) return;
    const id = String(shardOf(state.row.t)).padStart(2, "0");
    try {
      const doc = await loadJSON(`data/history/s${id}.json`);
      state.year = (doc.series && doc.series[state.row.t]) || [];
    } catch (err) {
      console.error(err);
      state.year = [];
    }
  }

  document.getElementById("app").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-range]");
    if (!btn || !state.row) return;
    state.range = btn.dataset.range;
    if (state.range === "1y") await loadYear();
    render();
  });

  async function start() {
    const ticker = new URLSearchParams(location.search).get("t") || "";
    window.MTS.syncTabs("SPX");
    if (!ticker) {
      $("#app").innerHTML = `<p class="error">Kein Titel angegeben.</p>`;
      return;
    }
    try {
      const [stocks, earnings] = await Promise.all([
        loadJSON("data/stocks.json"),
        loadJSON("data/earnings.json").catch(() => ({ items: [] })),
      ]);
      setStand(stocks);
      const row = (stocks.rows || []).find((r) => r.t === ticker);
      if (!row) {
        $("#app").innerHTML = `<p class="error">Titel ${escapeHtml(ticker)} ist nicht in der Liste.</p>`;
        return;
      }
      state.row = row;
      state.earn = (earnings.items || []).find((item) => item.t === ticker) || null;
      const ix = (row.ix || [])[0];
      if (ix) window.MTS.syncTabs(ix);
      render();
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Die Kursdaten konnten nicht geladen werden.</p>`;
    }
  }
  start();
})();
