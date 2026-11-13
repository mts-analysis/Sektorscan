(() => {
  "use strict";
  const { $, dePct, escapeHtml, setStand, loadJSON, indexSwitch, pageIndex, syncTabs, indexName } = window.MTS;
  const H = window.MTS.history;
  let stocks = null;
  let series = null;

  function windowParam() {
    const w = new URLSearchParams(location.search).get("w");
    if (w === "5" || w === "20" || w === "all") return w;
    return "20";
  }

  function rowHtml(item, n) {
    return `<a class="wh-line" href="aktie.html?t=${encodeURIComponent(item.t)}">
      <span class="mono">${escapeHtml(item.t)}</span>
      <span class="wh-name">${escapeHtml(item.n)}</span>
      <span class="wh-sec">${escapeHtml(item.s)}</span>
      <span class="wh-count">${item.k} von ${n} Handelstagen</span>
    </a>`;
  }

  function render() {
    const ix = pageIndex();
    const w = windowParam();
    syncTabs(ix);
    const rows = (stocks.rows || []).filter((r) => (r.ix || []).includes(ix));
    const lead = H.leaders(series, rows, w === "all" ? "all" : Number(w));
    const label = w === "all" ? "alle" : `${w} Tage`;
    const span = lead.from ? `${H.deYmd(lead.from)} – ${H.deYmd(lead.to)}` : "keine Sitzungen";
    const chips = [["5", "5 Tage"], ["20", "20 Tage"], ["all", "alle"]].map(([id, text]) =>
      `<button type="button" class="chip${w === id ? " is-on" : ""}" data-win="${id}">${text}</button>`
    ).join("");
    const col = (title, items, cls) => `<article class="card">
      <h2 class="${cls}">${escapeHtml(title)}</h2>
      ${items.length ? items.map((item) => rowHtml(item, lead.n)).join("") : `<p class="empty">Keine Einträge.</p>`}
    </article>`;
    $("#app").innerHTML = `
      ${indexSwitch(ix, { w })}
      <div class="chip-row" role="group" aria-label="Zeitraum">${chips}</div>
      <p class="kicker">${escapeHtml(indexName(ix))} · ${escapeHtml(label)}</p>
      <p class="note">${lead.n} Handelstage · ${escapeHtml(span)}. Gezählt wird ein Platz in den zehn stärksten oder schwächsten Titeln des Tages.</p>
      <div class="tf-grid">
        ${col("Im Top", lead.top, "is-up")}
        ${col("Im Flop", lead.flop, "is-down")}
      </div>`;
  }

  document.getElementById("app").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-win]");
    if (!btn) return;
    const q = new URLSearchParams(location.search);
    q.set("ix", pageIndex());
    q.set("w", btn.dataset.win);
    history.replaceState(null, "", `?${q.toString()}`);
    render();
  });

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
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Die Historie konnte nicht geladen werden.</p>`;
    }
  }
  start();
})();
