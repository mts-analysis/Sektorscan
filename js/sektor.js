(() => {
  "use strict";
  const { $, dePct, pctColor, escapeHtml, setStand, loadJSON, indexSwitch, pageIndex, syncTabs, indexName } = window.MTS;

  function stockLink(row) {
    const col = pctColor(row.c);
    const name = window.MTS.stockName(row);
    return `<a class="sector-stock" href="aktie.html?t=${encodeURIComponent(row.t)}">
      <span class="name">${escapeHtml(name)}${name === row.t ? "" : `<span class="id-ticker">${escapeHtml(row.t)}</span>`}</span>
      <span style="color:${col};font-weight:800">${dePct(row.c)}</span>
    </a>`;
  }

  function list(title, rows, empty) {
    const body = rows.length
      ? rows.map((row) => stockLink(row)).join("")
      : `<p class="empty">${escapeHtml(empty)}</p>`;
    return `<article class="card"><h2 class="kicker">${escapeHtml(title)}</h2>${body}</article>`;
  }

  const ETF = {
    "Technologie": "XLK", "Gesundheit": "XLV", "Finanzen": "XLF", "Zyklischer Konsum": "XLY",
    "Basiskonsum": "XLP", "Energie": "XLE", "Industrie": "XLI", "Grundstoffe": "XLB",
    "Versorger": "XLU", "Immobilien": "XLRE", "Kommunikation": "XLC",
  };

  function seasonHint(name) {
    const doc = window.__mtsSeason;
    const id = ETF[name];
    const cell = doc && id && doc.sectors && doc.sectors[id] && doc.sectors[id].months[String(new Date().getMonth() + 1)];
    if (!cell) return "";
    return `<p class="season-hint">${escapeHtml(window.MTS.seasonLine(cell, new Date().getMonth() + 1))}</p>
      <p class="note">Historischer Durchschnitt – keine Prognose. Keine Anlageberatung.</p>`;
  }

  function render(stocks, sectors) {
    const ix = pageIndex();
    syncTabs(ix);
    const params = new URLSearchParams(location.search);
    const name = params.get("s") || "";
    const h1 = document.querySelector("h1");
    if (h1 && name) h1.textContent = name;
    document.title = name ? `MTS ${name}` : "MTS Sektor";
    const block = (stocks.by_index || {})[ix] || null;
    const members = (stocks.rows || []).filter((r) => (r.ix || []).includes(ix) && r.s === name && r.c != null);
    const fromEtf = ix === "SPX" ? (sectors.sectors || []).find((s) => s.name === name) : null;
    const fromAvg = ((block && block.sectors) || []).find((s) => s.name === name);
    if (!name || (!fromEtf && !fromAvg && !members.length)) {
      $("#app").innerHTML = `${indexSwitch(ix, { s: name })}<p class="error">Dieser Sektor ist im ${escapeHtml(indexName(ix))} nicht besetzt.</p>`;
      return;
    }
    const dayPct = fromEtf ? fromEtf.pct : (fromAvg ? fromAvg.pct : null);
    const note = fromEtf ? `ETF ${fromEtf.ticker}` : "Ø der Titel";
    const session = (block && block.session_date) || (fromEtf && fromEtf.session_date) || stocks.session_date || "";
    const up = members.filter((r) => r.c > 0).length;
    const down = members.filter((r) => r.c < 0).length;
    const flat = members.length - up - down;
    const sorted = members.slice().sort((a, b) => b.c - a.c);
    const top = sorted.filter((r) => r.c > 0).slice(0, 5);
    const flop = sorted.filter((r) => r.c < 0).slice(-5).reverse();
    const col = dayPct == null ? "var(--muted)" : pctColor(dayPct);
    $("#app").innerHTML = `
      ${indexSwitch(ix, { s: name })}
      <article class="card">
        <p class="kicker">${escapeHtml(indexName(ix))} · ${escapeHtml(name)}</p>
        <p class="hero-pct" style="color:${col}">${dayPct == null ? "–" : dePct(dayPct)}</p>
        <p class="note">${escapeHtml(note)} · letzte Sitzung ${escapeHtml(session)}</p>
        <p class="hero-sub">${up} im Plus · ${down} im Minus${flat ? ` · ${flat} unverändert` : ""} · ${members.length} Titel</p>
        ${ix === "SPX" ? seasonHint(name) : ""}
      </article>
      ${list("Top 5 des Tages", top, "Keine Titel im Plus.")}
      ${list("Flop 5 des Tages", flop, "Keine Titel im Minus.")}
      <p class="note"><a href="index.html?ix=${encodeURIComponent(ix)}">Zur Sektor-Übersicht</a></p>`;
  }

  async function start() {
    try {
      const [stocks, sectors, season] = await Promise.all([
        loadJSON("data/stocks.json"),
        loadJSON("data/sectors.json"),
        loadJSON("data/seasonality.json").catch(() => null),
      ]);
      window.__mtsSeason = season;
      setStand(stocks);
      render(stocks, sectors);
      document.addEventListener("mts-theme", () => render(stocks, sectors));
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Die Kursdaten konnten nicht geladen werden.</p>`;
    }
  }
  start();
})();
