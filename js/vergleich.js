(() => {
  "use strict";
  const { $, deNum, dePct, pctColor, escapeHtml, setStand, loadJSON, tfSwitcher, exportButton, timeframe, periodName, returns, exchanges, INDEX_EXCHANGE, SECTORS } = window.MTS;
  let sectors = null;
  let stocks = null;
  let pack = null;

  function deDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || "");
  }

  function indexPct(id, market) {
    const tf = timeframe();
    if (tf === 1) return market.pct;
    const pair = pack && pack.ix && pack.ix[id];
    if (!pair) return null;
    return tf === 5 ? pair[0] : pair[1];
  }

  function sectorMoves(id, market) {
    const tf = timeframe();
    if (tf === 1) {
      const list = id === "SPX"
        ? (sectors.sectors || []).map((s) => ({ name: s.name, pct: s.pct }))
        : (market.sectors || []).map((s) => ({ name: s.name, pct: s.pct }));
      return list.filter((s) => s.pct != null);
    }
    const block = (pack && pack.sec && pack.sec[id]) || {};
    const idx = tf === 5 ? 0 : 1;
    return SECTORS.map((name) => ({ name, pct: block[name] ? block[name][idx] : null })).filter((s) => s.pct != null);
  }

  function breadth(id, market) {
    const tf = timeframe();
    if (tf === 1) return { up: market.up_stocks || 0, down: market.down_stocks || 0, n: market.n_stocks || 0 };
    const idx = tf === 5 ? 0 : 1;
    let up = 0;
    let down = 0;
    let n = 0;
    for (const row of stocks.rows || []) {
      if (!(row.ix || []).includes(id)) continue;
      const pair = pack && pack.px && pack.px[row.t];
      const value = pair ? pair[idx] : null;
      if (value == null) continue;
      n += 1;
      if (value > 0) up += 1;
      else if (value < 0) down += 1;
    }
    return { up, down, n };
  }

  function render() {
    const tf = timeframe();
    const status = Object.fromEntries(exchanges().map((ex) => [ex.name, ex.state]));
    const cards = [];
    const html = (sectors.markets || []).map((market) => {
      const pct = indexPct(market.id, market);
      const moves = sectorMoves(market.id, market).slice().sort((a, b) => b.pct - a.pct);
      const strong = moves[0];
      const weak = moves[moves.length - 1];
      const wide = breadth(market.id, market);
      const baro = market.barometer || (market.id === "SPX" ? sectors.barometer : null);
      const ex = INDEX_EXCHANGE[market.id] || "";
      const state = status[ex] || "geschlossen";
      const cls = state === "offen" ? "is-open" : state === "Mittagspause" ? "is-lunch" : "is-closed";
      const session = deDate(market.stock_session || market.session_date || (baro && baro.session_date));
      cards.push({
        name: market.name,
        level: market.price == null ? "–" : deNum(market.price),
        pct: pct == null ? "–" : dePct(pct),
        color: pct == null ? "#9aa3ad" : window.MTS.cardColor(pct),
        baro: baro ? `Barometer ${baro.score}/100 · ${baro.zone_name}` : "Barometer nicht verfügbar",
        detail: `Stark ${strong ? strong.name : "–"} · Schwach ${weak ? weak.name : "–"} · ${wide.up} / ${wide.down} von ${wide.n}`,
        session: `Sitzung ${session || "–"}`,
        market: `${ex} · ${state}`,
      });
      return `<article class="card compare-card">
        <div class="tf-head">
          <p class="kicker">${escapeHtml(market.name)}</p>
          <span class="mkt ${cls}">${escapeHtml(ex)} · ${escapeHtml(state)}</span>
        </div>
        <p class="detail-px">${market.price == null ? "–" : deNum(market.price)}</p>
        <p class="detail-chg ${pct >= 0 ? "is-up" : "is-down"}">${pct == null ? "–" : dePct(pct)} · ${periodName(tf)}</p>
        <p class="note">${baro ? `Barometer ${baro.score}/100 · ${escapeHtml(baro.zone_name)}` : "Barometer nicht verfügbar"} · Sitzung ${escapeHtml(session || "–")}</p>
        <p class="note">Stärkster Sektor: ${escapeHtml(strong ? `${strong.name} ${dePct(strong.pct)}` : "–")}</p>
        <p class="note">Schwächster Sektor: ${escapeHtml(weak ? `${weak.name} ${dePct(weak.pct)}` : "–")}</p>
        <p class="note">${wide.up} im Plus · ${wide.down} im Minus · ${wide.n} Titel</p>
      </article>`;
    }).join("");
    $("#app").innerHTML = `
      <div class="tool-row">${tfSwitcher()}${exportButton()}</div>
      <p class="note">${tf === 1 ? "Änderung der letzten Sitzung." : "Änderung über die Handelstage der Tageshistorie, nach Börsenwert gewichtet."} Barometer: Tagesformel.</p>
      <div class="compare-wrap">${html}</div>`;
    window.__mtsCompare = { tf, cards };
  }

  document.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-export]") || !window.__mtsCompare) return;
    const btn = e.target.closest("[data-export]");
    btn.disabled = true;
    try {
      await window.MTS.saveCard({
        kind: "compare",
        title: "Index-Vergleich",
        subtitle: `${periodName(window.__mtsCompare.tf)} · ${new Date().toLocaleDateString("de-DE")}`,
        cards: window.__mtsCompare.cards,
        filename: "mts-vergleich.png",
      });
    } catch (err) {
      console.error(err);
    }
    btn.disabled = false;
  });

  async function start() {
    try {
      [sectors, stocks, pack] = await Promise.all([
        loadJSON("data/sectors.json"),
        loadJSON("data/stocks.json"),
        returns(),
      ]);
      setStand(sectors);
      render();
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Der Vergleich konnte nicht geladen werden.</p>`;
    }
  }
  document.addEventListener("mts-tf", () => { if (sectors) render(); });
  document.addEventListener("mts-theme", () => { if (sectors) render(); });
  start();
})();
