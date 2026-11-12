(() => {
  "use strict";
  const { $, dePct, pctColor, escapeHtml, setStand, loadJSON } = window.MTS;

  function deDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || "");
  }

  function bars(title, entries, upSide) {
    if (!entries || !entries.length) return `<article class="card"><p class="kicker">${escapeHtml(title)}</p><p class="empty">Keine Daten.</p></article>`;
    const maxAbs = Math.max(...entries.map((e) => Math.abs(e.c))) || 1;
    const rows = entries.map((e, i) => {
      const col = pctColor(e.c, Math.max(maxAbs, 1));
      const w = (Math.abs(e.c) / maxAbs) * 100;
      return `<div class="bar-row${i % 2 ? "" : " is-alt"}">
        <div class="bar-id">
          <span class="mono">${escapeHtml(e.t)}</span>
          <span class="muted">${escapeHtml(e.n)}</span>
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

  function wcol(title, colorClass, items, sideWord, nDays) {
    const rows = (items || []).map((e) => `
      <div class="wh-row">
        <span class="wh-chip ${colorClass}">${e.k}/${nDays}</span>
        <span class="mono">${escapeHtml(e.t)}</span>
        <span class="muted">${escapeHtml(e.n)}  ·  ${escapeHtml(e.s)}</span>
        
      </div>`).join("") || `<p class="empty">Keine Wiederholer mit mindestens 2 Tagen.</p>`;
    return `<div class="wh-col">
      <h3 class="${colorClass}">${escapeHtml(title)}</h3>
      ${rows}
    </div>`;
  }

  function render(data) {
    setStand(data);
    const n = data.wiederholer_days || 0;
    const since = data.wiederholer_since || "06.11.2026";
    const sess = data.stand && data.stand.et ? data.stand.et.replace(/,.*$/, "") : (data.session_date || "");
    $("#app").innerHTML = `
      <div class="tf-title-row">
        <p class="kicker">Tages-Top und -Flop  ·  S&P 500</p>
        <p class="muted">Schlusskurse ${escapeHtml(sess)}</p>
      </div>
      <div class="tf-grid">
        ${bars("Top 10", data.top10, true)}
        ${bars("Flop 10", data.flop10, false)}
      </div>
      <article class="card wh-card">
        <div class="tf-head">
          <h2>Wiederholer seit ${escapeHtml(deDate(since))}</h2>
          <p class="muted">Fortlaufender Zähler  ·  ${n} Handelstage</p>
        </div>
        <div class="wh-grid">
          ${wcol("Im Top", "is-up", (data.wiederholer || {}).top, "Top", n)}
          ${wcol("Im Flop", "is-down", (data.wiederholer || {}).flop, "Flop", n)}
        </div>
      </article>
    `;
  }

  async function start() {
    try {
      const data = await loadJSON("data/stocks.json");
      render(data);
    } catch (err) {
      $("#app").innerHTML = `<p class="error">Die Kursdaten konnten nicht geladen werden. Bitte später erneut öffnen.</p>`;
      console.error(err);
    }
  }
  start();
  setInterval(() => { loadJSON("data/stocks.json").then(render).catch(() => {}); }, window.MTS.REFRESH_MS);
})();
