(() => {
  "use strict";
  const { $, dePct, pctColor, escapeHtml, setStand, loadJSON, indexSwitch, pageIndex, syncTabs, indexName } = window.MTS;
  const H = window.MTS.history;
  let stocks = null;
  let series = null;

  function rowsHtml(list) {
    if (!list.length) return `<p class="empty">Keine Sektoren.</p>`;
    const best = list[0].pct;
    const worst = list[list.length - 1].pct;
    return list.map((s) => {
      const mark = list.length > 1 && s.pct === best ? " is-best" : list.length > 1 && s.pct === worst ? " is-worst" : "";
      return `<div class="week-row${mark}">
        <span class="name">${escapeHtml(s.name)}</span>
        <span style="color:${pctColor(s.pct, 8)};font-weight:800">${dePct(s.pct)}</span>
      </div>`;
    }).join("");
  }

  function block(title, info, ranked) {
    if (!info) return "";
    const col = ranked.indexPct == null ? "var(--muted)" : pctColor(ranked.indexPct, 8);
    return `<section class="card week-block">
      <p class="kicker">${escapeHtml(title)} · ${H.deYmd(info.start)} – ${H.deYmd(info.end)}</p>
      <p class="hero-pct" style="color:${col}">Index ${ranked.indexPct == null ? "–" : dePct(ranked.indexPct)}</p>
      <p class="note">${info.days} Handelstage, Schluss gegen ${H.deYmd(info.anchor)}, nach Börsenwert gewichtet.</p>
      ${rowsHtml(ranked.sectors)}
    </section>`;
  }

  function render() {
    const ix = pageIndex();
    syncTabs(ix);
    const rows = (stocks.rows || []).filter((r) => (r.ix || []).includes(ix));
    const sessions = H.indexSessions(series, rows.map((r) => r.t));
    const weeks = H.weekBlocks(sessions);
    const current = weeks.current ? H.weighted(series, rows, weeks.current.anchor, weeks.current.end) : null;
    const previous = weeks.previous ? H.weighted(series, rows, weeks.previous.anchor, weeks.previous.end) : null;
    $("#app").innerHTML = `
      ${indexSwitch(ix)}
      <p class="kicker">${escapeHtml(indexName(ix))}</p>
      ${current ? block("Diese Woche", weeks.current, current) : `<p class="empty">Für diese Woche liegt noch kein Vergleich vor.</p>`}
      ${previous ? block("Vorwoche", weeks.previous, previous) : ""}`;
  }

  async function start() {
    try {
      $("#app").innerHTML = `<p class="loading">Historie wird geladen …</p>`;
      const idx = await loadJSON("data/history/index.json");
      const n = idx.shards || 16;
      const [quote, shards] = await Promise.all([
        loadJSON("data/stocks.json"),
        Promise.all(Array.from({ length: n }, (_, i) => loadJSON(`data/history/s${String(i).padStart(2, "0")}.json`))),
      ]);
      stocks = quote;
      series = {};
      shards.forEach((sh) => Object.assign(series, sh.series || {}));
      setStand(quote);
      render();
      document.addEventListener("mts-theme", render);
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Die Historie konnte nicht geladen werden.</p>`;
    }
  }
  start();
})();
