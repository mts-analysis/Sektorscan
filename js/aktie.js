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

  function ka(value) {
    return value == null || value === "" ? "k. A." : value;
  }

  function earnText(item) {
    if (!item) return "k. A.";
    const when = deDate(item.d);
    if (!when) return "k. A.";
    if (item.kind === "unconfirmed") return `${when} · unbestätigt`;
    if (item.est || item.kind === "estimate") return `${when} · geschätzt`;
    return when;
  }

  function fmtKgv(v) {
    if (v == null || Number.isNaN(Number(v)) || Number(v) <= 0) return "k. A.";
    return deNum(v, 1);
  }

  function fmtPctFrac(v) {
    if (v == null || Number.isNaN(Number(v))) return "k. A.";
    const n = Number(v);
    return dePct(Math.abs(n) <= 1.5 ? n * 100 : n);
  }

  function fmtNum(v, nd) {
    if (v == null || Number.isNaN(Number(v))) return "k. A.";
    return deNum(v, nd);
  }

  function tvSymbol(ticker, exch) {
    const t = String(ticker || "");
    if (t.endsWith(".DE")) return "XETR:" + t.slice(0, -3);
    if (t.endsWith(".T")) return "TSE:" + t.slice(0, -2);
    if (t.endsWith(".KS") || t.endsWith(".KQ")) return "KRX:" + t.slice(0, -3);
    if (t.endsWith(".L")) return "LSE:" + t.slice(0, -2).replace(/-/g, ".");
    const ex = String(exch || "").toUpperCase();
    const map = {
      NMS: "NASDAQ", NGSM: "NASDAQ", NASDAQ: "NASDAQ", NCM: "NASDAQ", NGM: "NASDAQ",
      NYQ: "NYSE", NYSE: "NYSE",
      PCX: "AMEX", ASE: "AMEX", AMEX: "AMEX", ARCA: "AMEX", NYSEARCA: "AMEX",
    };
    const prefix = map[ex];
    return prefix ? `${prefix}:${t}` : t;
  }

  function highLow(r, p) {
    let high = p && p.hi;
    let low = p && p.lo;
    if ((high == null || low == null) && r.p != null && r.dH != null && r.dL != null) {
      high = high == null ? r.p / (1 + r.dH / 100) : high;
      low = low == null ? r.p / (1 + r.dL / 100) : low;
    }
    if (high == null && low == null) return "k. A.";
    const a = high == null ? "k. A." : window.MTS.money(high, r.ccy);
    const b = low == null ? "k. A." : window.MTS.money(low, r.ccy);
    return `${a} / ${b}`;
  }

  function rangeBlock(r) {
    if (r.p == null || r.dH == null || r.dL == null) {
      return `<p class="note">k. A.</p>`;
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

  function newsList(items) {
    const rows = (items || []).filter((n) => n && n.h && /^https:\/\//i.test(n.u || "")).slice(0, 3);
    if (!rows.length) return `<p class="note">k. A.</p>`;
    return `<ul class="news-list">${rows.map((n) => {
      const meta = [n.src, n.d ? deDate(n.d) : ""].filter(Boolean).join(" · ");
      return `<li><a href="${escapeHtml(n.u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.h)}<span class="ext-mark" aria-label="externer Link">↗</span></a>${meta ? `<span class="muted">${escapeHtml(meta)}</span>` : ""}</li>`;
    }).join("")}</ul>`;
  }

  function websiteLine(url) {
    if (!url || !/^https:\/\//i.test(url)) return "k. A.";
    let label = url.replace(/^https:\/\//i, "").replace(/\/$/, "");
    if (label.length > 42) label = `${label.slice(0, 40)}…`;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}<span class="ext-mark" aria-label="externer Link">↗</span></a>`;
  }

  function segmentsLine(items) {
    if (!items || !items.length) return "k. A.";
    const bits = items.map((seg) => {
      const name = seg && seg.n;
      if (!name) return "";
      if (seg.a == null || Number.isNaN(Number(seg.a))) return escapeHtml(name);
      const n = Number(seg.a);
      const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
      return `${escapeHtml(name)} ${deNum(pct, Math.abs(pct - Math.round(pct)) < 0.05 ? 0 : 1)} %`;
    }).filter(Boolean);
    return bits.length ? bits.join(", ") : "k. A.";
  }

  const state = { row: null, earn: null, year: null, range: "30", prof: null };

  function chartValues() {
    if (state.range === "1y" && state.year && state.year.length) return state.year.map((p) => p[1]);
    return state.row.sp || [];
  }

  function render() {
    const r = state.row;
    if (!r) return;
    const p = state.prof || {};
    const col = pctColor(r.c);
    const ix = (r.ix || []).map((id) => indexName(id)).join(" · ");
    const name = window.MTS.stockName(r);
    const values = chartValues();
    const note = state.range === "1y"
      ? (state.year ? "Tägliche Schlusskurse, etwa ein Jahr." : "Verlauf wird geladen …")
      : "Letzte 30 Handelstage, täglicher Schlusskurs.";
    const tv = tvSymbol(r.t, p.ex);
    const mc = r.mc == null ? "k. A." : `${deNum(r.mc, 1)} Mrd. USD`;
    const mitarb = p.mitarb == null ? "k. A." : deNum(p.mitarb, 0);
    $("#app").innerHTML = `
      <a class="detail-back" href="./scanner.html">Zur Liste</a>
      <article class="card">
        <div class="tf-head">
          <div>
            <p class="id-title">${escapeHtml(name)}</p>
            ${name === r.t ? "" : `<p class="kicker">${escapeHtml(r.t)}</p>`}
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
          <a class="chip" href="chart.html?sym=${encodeURIComponent(tv)}&t=${encodeURIComponent(r.t)}">TradingView</a>
        </div>
        ${values.length > 1 ? sparkSVG(values, col, 640, 180) : `<p class="empty">Kein Verlauf verfügbar.</p>`}
        <p class="note">${note}</p>
        <p class="kicker">52-Wochen-Spanne</p>
        ${rangeBlock(r)}
      </article>
      <article class="card">
        <h2 class="block-title">Kennzahlen</h2>
        <ul class="stat-list fund-list">
          <li>KGV: ${fmtKgv(p.kgv)}</li>
          <li>Forward-KGV: ${fmtKgv(p.fkgv)}</li>
          <li>Marktkapitalisierung: ${mc}</li>
          <li>Umsatzwachstum: ${fmtPctFrac(p.umsatz_w)}</li>
          <li>Gewinnwachstum: ${fmtPctFrac(p.gewinn_w)}</li>
          <li>Marge: ${fmtPctFrac(p.marge)}</li>
          <li>Dividendenrendite: ${fmtPctFrac(p.div)}</li>
          <li>Verschuldung (FK/EK): ${fmtNum(p.debt, 1)}</li>
          <li>52-Wochen-Hoch / -Tief: ${highLow(r, p)}</li>
          <li>Beta: ${fmtNum(p.beta, 2)}</li>
          <li>Branche: ${escapeHtml(ka(p.branche))}</li>
          <li>Sektor: ${escapeHtml(ka(r.s))}</li>
          <li>Index: ${escapeHtml(ix || "k. A.")}</li>
          <li>Nächster Quartalstermin: ${escapeHtml(earnText(state.earn))}</li>
        </ul>
      </article>
      <article class="card">
        <h2 class="block-title">Die Firma dahinter</h2>
        <p class="firma-text">${escapeHtml(p.profil || "k. A.")}</p>
        <ul class="stat-list">
          <li>Sitz: ${escapeHtml(ka(p.sitz))}</li>
          <li>Land: ${escapeHtml(ka(p.land))}</li>
          <li>Gründungsjahr: ${p.jahr == null ? "k. A." : escapeHtml(String(p.jahr))}</li>
          <li>Mitarbeiter: ${mitarb}</li>
          <li>CEO: ${escapeHtml(ka(p.ceo))}</li>
          <li>Website: ${websiteLine(p.web)}</li>
          <li>Segmente: ${segmentsLine(p.segmente)}</li>
        </ul>
      </article>
      <article class="card">
        <h2 class="block-title">Letzte Meldungen</h2>
        ${newsList(p.news)}
      </article>`;
    document.title = `${name} · MTS`;
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
    const shard = String(shardOf(ticker)).padStart(2, "0");
    try {
      const [stocks, earnings, prof] = await Promise.all([
        loadJSON("data/stocks.json"),
        loadJSON("data/earnings.json").catch(() => ({ items: [] })),
        loadJSON(`data/profiles/s${shard}.json`).catch(() => ({ rows: {} })),
      ]);
      setStand(stocks);
      const row = (stocks.rows || []).find((r) => r.t === ticker);
      if (!row) {
        $("#app").innerHTML = `<p class="error">Titel ${escapeHtml(ticker)} ist nicht in der Liste.</p>`;
        return;
      }
      state.row = row;
      state.earn = (earnings.items || []).find((item) => item.t === ticker) || null;
      state.prof = (prof.rows && prof.rows[ticker]) || null;
      const ix = (row.ix || [])[0];
      if (ix) window.MTS.syncTabs(ix);
      render();
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Die Kursdaten konnten nicht geladen werden.</p>`;
    }
  }
  document.addEventListener("mts-theme", () => { if (state.row) render(); });
  start();
})();
