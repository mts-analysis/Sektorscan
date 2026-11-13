(() => {
  "use strict";
  const { $, escapeHtml, setStand, loadJSON, indexName, INDICES } = window.MTS;
  const SECTORS = [
    "Technologie", "Finanzen", "Gesundheit", "Zyklischer Konsum", "Basiskonsum",
    "Industrie", "Energie", "Grundstoffe", "Versorger", "Immobilien", "Kommunikation",
  ];
  const state = { items: [], rows: new Map(), ix: new Set(), sectors: new Set(), note: "" };

  function dayKey(iso) {
    return iso.slice(0, 10);
  }

  function heading(iso) {
    const d = new Date(`${iso}T12:00:00`);
    return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit" }).format(d);
  }

  function tag(item) {
    if (item.kind === "unconfirmed") return `<span class="tag">unbestätigt</span>`;
    if (item.est || item.kind === "estimate") return `<span class="tag">geschätzt</span>`;
    return "";
  }

  function visible() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + 21);
    return state.items.filter((item) => {
      const row = state.rows.get(item.t);
      if (!row) return false;
      const when = new Date(`${item.d.slice(0, 10)}T12:00:00`);
      if (when < today || when > end) return false;
      if (state.ix.size && !(row.ix || []).some((id) => state.ix.has(id))) return false;
      if (state.sectors.size && !state.sectors.has(row.s)) return false;
      return true;
    });
  }

  function chip(label, on, attrs) {
    return `<button type="button" class="chip${on ? " is-on" : ""}" ${attrs}>${escapeHtml(label)}</button>`;
  }

  function render() {
    const list = visible();
    const groups = new Map();
    for (const item of list) {
      const key = dayKey(item.d);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const days = [...groups.keys()].sort();
    const body = days.map((day) => {
      const rows = groups.get(day).map((item) => {
        const row = state.rows.get(item.t);
        const ix = (row.ix || []).map((id) => indexName(id)).join(", ");
        const name = row ? window.MTS.stockName(row) : item.t;
        return `<a class="earn-row" href="aktie.html?t=${encodeURIComponent(item.t)}">
          <span class="name">${escapeHtml(name)}</span>
          <span>${name === item.t ? "" : `<span class="id-ticker">${escapeHtml(item.t)}</span> `}<span class="muted">${escapeHtml(row ? row.s : "")} · ${escapeHtml(ix)}</span></span>
          ${tag(item)}
        </a>`;
      }).join("");
      return `<h2 class="earn-day">${escapeHtml(heading(day))}</h2>${rows}`;
    }).join("");
    $("#app").innerHTML = `
      <p class="kicker">Diese und die nächsten zwei Wochen</p>
      <div class="chip-row" id="earn-ix">
        ${INDICES.map((ix) => chip(ix.name, state.ix.has(ix.id), `data-ix="${ix.id}"`)).join("")}
        ${chip("Alle", state.ix.size === 0, `data-all="1"`)}
      </div>
      <div class="chip-row" id="earn-sec">
        ${SECTORS.map((s) => chip(s, state.sectors.has(s), `data-sec="${escapeHtml(s)}"`)).join("")}
      </div>
      <p class="note">${list.length} Termine. ${escapeHtml(state.note || "Yahoo-Kalender. Geschätzte und unbestätigte Termine sind markiert.")}</p>
      ${body || `<p class="empty">Für diese Auswahl liegen keine Termine vor.</p>`}`;
  }

  document.getElementById("app").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.all) {
      state.ix.clear();
      render();
      return;
    }
    if (btn.dataset.ix) {
      if (state.ix.has(btn.dataset.ix)) state.ix.delete(btn.dataset.ix);
      else state.ix.add(btn.dataset.ix);
      render();
      return;
    }
    if (btn.dataset.sec) {
      if (state.sectors.has(btn.dataset.sec)) state.sectors.delete(btn.dataset.sec);
      else state.sectors.add(btn.dataset.sec);
      render();
    }
  });

  async function start() {
    const ix = new URLSearchParams(location.search).get("ix");
    if (ix && ix !== "all" && ix !== "SPX") state.ix.add(ix);
    window.MTS.syncTabs(ix && ix !== "all" ? ix : "SPX");
    try {
      const [stocks, earnings] = await Promise.all([
        loadJSON("data/stocks.json"),
        loadJSON("data/earnings.json").catch(() => null),
      ]);
      setStand(stocks);
      for (const row of stocks.rows || []) state.rows.set(row.t, row);
      if (!earnings) {
        state.note = "Der Termin-Kalender ist gerade nicht verfügbar.";
        state.items = [];
      } else {
        state.items = earnings.items || [];
        state.note = earnings.note || "";
      }
      render();
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Die Termine konnten nicht geladen werden.</p>`;
    }
  }
  start();
})();
