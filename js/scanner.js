(() => {
  "use strict";
  const { $, $$, deNum, dePct, pctColor, escapeHtml, sparkSVG, setStand, loadJSON, params } = window.MTS;

  const SECTORS = [
    "Technologie", "Finanzen", "Gesundheit", "Zyklischer Konsum", "Basiskonsum",
    "Industrie", "Energie", "Grundstoffe", "Versorger", "Immobilien", "Kommunikation",
  ];

  const state = {
    data: null,
    q: "",
    sectors: new Set(),
    pctMin: null,
    pctMax: null,
    rvMin: null,
    nearHigh: null, // percent window under 52w high
    nearLow: null,
    wtMin: null,
    wfMin: null,
    indexes: new Set(),
    sawIndexParam: false,
    mc: new Set(), // gross mittel klein
    earnings: false,
    sortKey: "c",
    sortDir: -1,
    openPanel: null,
    merkOn: false,
    searchIndex: null,
    viewRows: [],
    winStart: -1,
    winEnd: -1,
    qTimer: 0,
    rets: null,
    filtersOpen: window.matchMedia("(min-width: 768px) and (min-height: 700px)").matches,
  };
  const ROW_H = 44;

  function applyParams() {
    const p = params();
    const sektor = p.get("sektor") || p.get("sector");
    if (sektor) sektor.split(",").forEach((s) => state.sectors.add(s));
    if (p.has("pctMin")) state.pctMin = Number(p.get("pctMin"));
    if (p.has("pctMax")) state.pctMax = Number(p.get("pctMax"));
    if (p.has("rvMin")) state.rvMin = Number(p.get("rvMin"));
    if (p.has("nearHigh")) state.nearHigh = Number(p.get("nearHigh"));
    if (p.has("nearLow")) state.nearLow = Number(p.get("nearLow"));
    if (p.has("wtMin")) state.wtMin = Number(p.get("wtMin"));
    if (p.has("wfMin")) state.wfMin = Number(p.get("wfMin"));
    if (p.has("index") || p.has("ix")) {
      state.sawIndexParam = true;
      const ix = p.get("index") || p.get("ix");
      if (ix && ix !== "all") ix.split(",").forEach((s) => state.indexes.add(s));
    }
    const mc = p.get("mc");
    if (mc) mc.split(",").forEach((s) => state.mc.add(s));
    if (p.get("ew") === "1" || p.get("earnings") === "1") state.earnings = true;
    if (p.get("q")) state.q = p.get("q");
    if (p.get("merk") === "1") state.merkOn = true;
    if (p.get("sort")) state.sortKey = p.get("sort");
    if (p.get("dir")) state.sortDir = Number(p.get("dir")) || -1;
  }

  function filtered() {
    const rows = state.data.rows || [];
    const q = window.MTS.fold(state.q).trim();
    const searching = q.length > 0;
    const merk = state.merkOn ? window.MTS.readMerk() : null;
    return rows.filter((r) => {
      if (searching && !(r._blob || "").includes(q)) return false;
      if (merk && !merk.has(r.t)) return false;
      if (state.sectors.size && !state.sectors.has(r.s)) return false;
      const shown = shownChange(r);
      if (window.MTS.timeframe() !== 1 && shown == null) return false;
      if (state.pctMin !== null && !(shown >= state.pctMin)) return false;
      if (state.pctMax !== null && !(shown <= state.pctMax)) return false;
      if (state.rvMin !== null) {
        if (r.rv === null || r.rv === undefined || !(r.rv >= state.rvMin)) return false;
      }
      if (state.nearHigh !== null) {
        if (r.dH === null || r.dH === undefined || r.dH < -state.nearHigh || r.dH > 0.05) return false;
      }
      if (state.nearLow !== null) {
        if (r.dL === null || r.dL === undefined || r.dL > state.nearLow || r.dL < -0.05) return false;
      }
      if (state.wtMin !== null && !(r.wt >= state.wtMin)) return false;
      if (state.wfMin !== null && !(r.wf >= state.wfMin)) return false;
      if (!searching && state.indexes.size && !(r.ix || []).some((x) => state.indexes.has(x))) return false;
      if (state.mc.size) {
        const b = mcBucket(r.mc);
        if (!b || !state.mc.has(b)) return false;
      }
      if (state.earnings && !r.ew) return false;
      return true;
    });
  }

  function mcBucket(mc) {
    if (mc === null || mc === undefined) return null;
    if (mc >= 10) return "gross";
    if (mc >= 2) return "mittel";
    return "klein";
  }

  function sortRows(rows) {
    const k = state.sortKey;
    const d = state.sortDir;
    const val = (r) => {
      if (k === "c" && window.MTS.timeframe() !== 1) {
        const shown = shownChange(r);
        return shown == null ? (d > 0 ? Infinity : -Infinity) : shown;
      }
      const v = r[k];
      if (v === null || v === undefined) return d > 0 ? Infinity : -Infinity;
      if (k === "t" || k === "n" || k === "s") return String(v).toLowerCase();
      return Number(v);
    };
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * d;
      if (va > vb) return 1 * d;
      return a.t.localeCompare(b.t);
    });
  }

  function chip(label, on, attrs = "") {
    return `<button type="button" class="chip${on ? " is-on" : ""}" ${attrs}>${escapeHtml(label)}</button>`;
  }

  function panel(id, title, body) {
    const open = state.openPanel === id;
    return `<div class="filter-panel" data-panel="${id}" ${open ? "" : "hidden"}>
      <p class="filter-panel-title">${escapeHtml(title)}</p>
      ${body}
    </div>`;
  }

  function activeSummary() {
    const bits = [];
    if (state.sectors.size) bits.push([...state.sectors].join(", "));
    if (state.pctMin !== null && state.pctMax === null) bits.push(`≥ ${dePct(state.pctMin, 1)}`);
    else if (state.pctMax !== null && state.pctMin === null) bits.push(`≤ ${dePct(state.pctMax, 1)}`);
    else if (state.pctMin !== null && state.pctMax !== null) bits.push(`${dePct(state.pctMin, 1)} bis ${dePct(state.pctMax, 1)}`);
    if (state.rvMin !== null) bits.push(`Vol. ≥ ${String(state.rvMin).replace(".", ",")}×`);
    if (state.nearHigh !== null) bits.push(`≤ ${deNum(state.nearHigh, 0)} % unter 52W-Hoch`);
    if (state.nearLow !== null) bits.push(`≤ ${deNum(state.nearLow, 0)} % über 52W-Tief`);
    if (state.wtMin !== null) bits.push(`≥ ${state.wtMin}× Top`);
    if (state.wfMin !== null) bits.push(`≥ ${state.wfMin}× Flop`);
    if (state.indexes.size) bits.push([...state.indexes].map((x) => window.MTS.indexName(x)).join(", "));
    else bits.push("alle Indizes");
    if (state.mc.size) bits.push([...state.mc].map((x) => ({ gross: "groß", mittel: "mittel", klein: "klein" }[x])).join(", "));
    if (state.earnings) bits.push("Earnings diese Woche");
    if (state.merkOn) bits.push("Merkliste");
    if (window.MTS.fold(state.q).trim()) bits.push("Suche in allen Indizes");
    return bits;
  }

  function filterCount() {
    let n = 0;
    if (state.sectors.size) n += 1;
    if (state.pctMin !== null || state.pctMax !== null) n += 1;
    if (state.rvMin !== null) n += 1;
    if (state.nearHigh !== null || state.nearLow !== null) n += 1;
    if (state.wtMin !== null || state.wfMin !== null) n += 1;
    if (state.mc.size) n += 1;
    if (state.earnings) n += 1;
    if (state.merkOn) n += 1;
    if (window.MTS.timeframe() !== 1) n += 1;
    return n;
  }

  function renderShell(rows, total) {
    const pctOn3 = state.pctMin === 3 && state.pctMax === null;
    const pctOnM3 = state.pctMax === -3 && state.pctMin === null;
    const app = $("#app");
    const nDays = state.data.wiederholer_days || "";
    app.innerHTML = `
      <section class="scanner-head">
        <div class="scanner-title-row">
          <p class="kicker">Aktien-Scanner  ·  ${escapeHtml(state.indexes.size ? [...state.indexes].map((id) => window.MTS.indexName(id)).join(", ") : "alle Indizes")}</p>
          <p class="hit-count" id="hit-count">${rows.length} von ${total} Treffern</p>
        </div>
        <div class="search-wrap">
          <label>
            <span class="visually-hidden">Suche</span>
            <input type="search" id="q" class="search" placeholder="Ticker oder Name, alle Indizes" value="${escapeHtml(state.q)}" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false">
          </label>
          <div class="suggest" id="suggest" hidden role="listbox"></div>
        </div>
        <div class="chip-row ix-scroll" id="chip-row">
          ${window.MTS.INDICES.map((ix) => chip(ix.name, state.indexes.has(ix.id), `data-ix="${ix.id}"`)).join("")}
          ${chip("Alle", state.indexes.size === 0, 'data-ix-all="1"')}
        </div>
        <div class="filter-bar">
          <button type="button" class="chip${state.filtersOpen ? " is-on" : ""}" data-filter-toggle aria-expanded="${state.filtersOpen ? "true" : "false"}">Filter${filterCount() ? ` ${filterCount()}` : ""}</button>
          <button type="button" class="linkish" data-filter-reset>Zurücksetzen</button>
        </div>
        <div class="filter-sheet" id="filter-sheet"${state.filtersOpen ? "" : " hidden"}>
        <div class="tool-row">${window.MTS.tfSwitcher()}</div>
        <div class="chip-row" id="filter-chips">
          ${chip("Sektor", state.sectors.size > 0, 'data-open="sektor"')}
          ${chip("> +3 %", pctOn3, 'data-preset="pct3"')}
          ${chip("< −3 %", pctOnM3, 'data-preset="pctm3"')}
          ${chip("Tagesänderung …", (state.pctMin !== null || state.pctMax !== null) && !pctOn3 && !pctOnM3, 'data-open="pct"')}
          ${chip("Volumen vs. Schnitt", state.rvMin !== null, 'data-open="vol"')}
          ${chip("Nähe 52W-Hoch/Tief", state.nearHigh !== null || state.nearLow !== null, 'data-open="range52"')}
          ${chip("Wiederholer", state.wtMin !== null || state.wfMin !== null, 'data-open="wh"')}
          ${chip("Börsenwert", state.mc.size > 0, 'data-open="mc"')}
          ${chip("Earnings diese Woche", state.earnings, 'data-preset="ew"')}
          ${chip(`Merkliste${window.MTS.readMerk().size ? " " + window.MTS.readMerk().size : ""}`, state.merkOn, 'data-preset="merk"')}
        </div>
        ${panel("sektor", "Sektor (Mehrfachauswahl)",
          `<div class="chip-row">${SECTORS.map((s) => chip(s, state.sectors.has(s), `data-sector="${escapeHtml(s)}"`)).join("")}
           <button type="button" class="linkish" data-clear="sektor">Auswahl leeren</button></div>`)}
        ${panel("pct", "Tagesänderung, eigener Bereich (in %)",
          `<div class="range-fields">
             <label>von <input type="number" step="0.1" id="pctMinIn" value="${state.pctMin ?? ""}"></label>
             <label>bis <input type="number" step="0.1" id="pctMaxIn" value="${state.pctMax ?? ""}"></label>
             <button type="button" class="chip is-on" data-apply="pct">Übernehmen</button>
             <button type="button" class="linkish" data-clear="pct">Zurücksetzen</button>
           </div>`)}
        ${panel("vol", "Relatives Volumen (heute vs. 20-Tage-Schnitt)",
          `<div class="chip-row">
             ${chip("≥ 1,5×", state.rvMin === 1.5, 'data-rv="1.5"')}
             ${chip("≥ 2×", state.rvMin === 2, 'data-rv="2"')}
             ${chip("≥ 3×", state.rvMin === 3, 'data-rv="3"')}
             <button type="button" class="linkish" data-clear="vol">Zurücksetzen</button>
           </div>`)}
        ${panel("range52", "Abstand zum 52-Wochen-Hoch oder -Tief",
          `<div class="chip-row">
             ${chip("≤ 2 % unter Hoch", state.nearHigh === 2, 'data-nh="2"')}
             ${chip("≤ 5 % unter Hoch", state.nearHigh === 5, 'data-nh="5"')}
             ${chip("≤ 2 % über Tief", state.nearLow === 2, 'data-nl="2"')}
             ${chip("≤ 5 % über Tief", state.nearLow === 5, 'data-nl="5"')}
             <button type="button" class="linkish" data-clear="range52">Zurücksetzen</button>
           </div>`)}
        ${panel("wh", `Wiederholer nur S&P 500, seit ${state.data.wiederholer_since || "06.11.2026"} (${nDays} Handelstage)`,
          `<div class="chip-row">
             ${chip("≥ 2 Tage Top", state.wtMin === 2, 'data-wt="2"')}
             ${chip("≥ 3 Tage Top", state.wtMin === 3, 'data-wt="3"')}
             ${chip("≥ 2 Tage Flop", state.wfMin === 2, 'data-wf="2"')}
             ${chip("≥ 3 Tage Flop", state.wfMin === 3, 'data-wf="3"')}
             <button type="button" class="linkish" data-clear="wh">Zurücksetzen</button>
           </div>`)}
        ${panel("mc", "Börsenwert in USD (Yahoo-Devisenkurse; Schwellen in den Hinweisen)",
          `<div class="chip-row">
             ${chip("Groß (≥ 10 Mrd. $)", state.mc.has("gross"), 'data-mc="gross"')}
             ${chip("Mittel (2–10 Mrd. $)", state.mc.has("mittel"), 'data-mc="mittel"')}
             ${chip("Klein (< 2 Mrd. $)", state.mc.has("klein"), 'data-mc="klein"')}
             <button type="button" class="linkish" data-clear="mc">Zurücksetzen</button>
           </div>`)}
        <p class="note">Landeswährung, ca. 15 Min. verzögert. Börsenwert in USD.</p>
        </div>
      </section>
      <div class="table-shell">
        <div class="table-card" id="table-card"></div>
      </div>
    `;
    renderList(rows, total);
  }

  function caret(key) {
    if (state.sortKey !== key) return "";
    return state.sortDir < 0
      ? '<span class="caret" aria-hidden="true"></span>'
      : '<span class="caret is-up" aria-hidden="true"></span>';
  }

  function headCell(key, label, num) {
    return `<button type="button" class="${num ? "num" : ""} ${key === state.sortKey ? "is-sort" : ""}" data-sort="${key}">${label} ${caret(key)}</button>`;
  }

  function shownChange(r) {
    const tf = window.MTS.timeframe();
    if (tf === 1) return r.c;
    const pair = state.rets && state.rets.px && state.rets.px[r.t];
    if (!pair) return null;
    return tf === 5 ? pair[0] : pair[1];
  }

  function rowHtml(r) {
    const ch = shownChange(r);
    const col = pctColor(ch);
    return `<div class="vrow vgrid" data-t="${escapeHtml(r.t)}" tabindex="0">
      ${window.MTS.starButton(r.t)}
      <span class="mono">${escapeHtml(r.t)}</span>
      <span class="name">${escapeHtml(r.n)}</span>
      <span class="num">${window.MTS.money(r.p, r.ccy)}</span>
      <span class="num" style="color:${col}">${ch == null ? "–" : dePct(ch)}</span>
      <span class="num muted">${r.rv == null ? "–" : deNum(r.rv)}</span>
    </div>`;
  }

  function renderList(rows, total) {
    state.viewRows = rows;
    state.winStart = -1;
    state.winEnd = -1;
    const card = $("#table-card");
    if (!card) return;
    const empty = rows.length === 0;
    const emptyText = state.merkOn && !window.MTS.fold(state.q).trim()
      ? "Noch keine Titel auf der Merkliste. Stern tippen, um einen Titel zu merken."
      : "Keine Titel passen zu diesen Filtern.";
    card.innerHTML = `
      <div class="vhead vgrid">
        <span></span>
        ${headCell("t", "Ticker", false)}
        ${headCell("n", "Name", false)}
        ${headCell("p", "Kurs", true)}
        ${headCell("c", "%", true)}
        ${headCell("rv", "Rel. Volumen", true)}
      </div>
      <div class="vspacer" id="vspacer" style="height:${rows.length * ROW_H}px">
        <div class="vwin" id="vwin"></div>
      </div>
      <p class="empty" id="vempty"${empty ? "" : " hidden"}>${escapeHtml(emptyText)}</p>`;
    const hc = $("#hit-count");
    if (hc) {
      const scope = window.MTS.fold(state.q).trim() ? " · alle Indizes" : "";
      hc.textContent = `${rows.length} von ${total} Treffern${scope}`;
    }
    card.scrollTop = 0;
    paintWindow();
    requestAnimationFrame(() => {
      state.winStart = -1;
      paintWindow();
    });
  }

  function paintWindow() {
    const card = $("#table-card");
    const win = $("#vwin");
    const spacer = $("#vspacer");
    if (!card || !win || !spacer) return;
    const total = state.viewRows.length;
    const top = card.scrollTop;
    const view = card.clientHeight || 640;
    const start = Math.max(0, Math.floor(top / ROW_H) - 6);
    const end = Math.min(total, Math.ceil((top + view) / ROW_H) + 8);
    if (start === state.winStart && end === state.winEnd) return;
    state.winStart = start;
    state.winEnd = end;
    spacer.style.height = `${total * ROW_H}px`;
    win.style.transform = `translateY(${start * ROW_H}px)`;
    win.innerHTML = state.viewRows.slice(start, end).map(rowHtml).join("");
  }

  function showSuggest(query) {
    const box = $("#suggest");
    if (!box) return;
    const hits = window.MTS.suggest(state.searchIndex, query, 8);
    if (!query.trim() || !hits.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = hits.map((r) => {
      const ix = (r.ix || []).map((id) => window.MTS.indexName(id)).join(", ");
      return `<button type="button" class="suggest-item" data-pick="${escapeHtml(r.t)}">
        <span class="mono">${escapeHtml(r.t)}</span>
        <span>${escapeHtml(r.n)}</span>
        <span class="muted">${escapeHtml(ix)}</span>
      </button>`;
    }).join("");
  }

  function refresh() {
    if (!state.data) return;
    showSuggest("");
    const rows = sortRows(filtered());
    renderShell(rows, state.data.n || state.data.rows.length);
    setStand(state.data);
    if (state.indexes.size === 1) {
      window.MTS.syncTabs([...state.indexes][0]);
    } else {
      window.MTS.syncTabs("SPX");
    }
    const chart = params().get("chart");
    if (chart) openChart(chart);
  }

  function toggleSet(set, v) {
    if (set.has(v)) set.delete(v);
    else set.add(v);
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    $("#app").addEventListener("input", (e) => {
      if (e.target.id !== "q") return;
      state.q = e.target.value;
      showSuggest(state.q);
      clearTimeout(state.qTimer);
      state.qTimer = setTimeout(() => {
        const rows = sortRows(filtered());
        renderList(rows, state.data.n || state.data.rows.length);
      }, 120);
    });
    $("#app").addEventListener("scroll", (e) => {
      if (e.target && e.target.id === "table-card") {
        document.querySelector(".page")?.classList.toggle("is-scrolled", e.target.scrollTop > 24);
        paintWindow();
      }
    }, true);
    $("#app").addEventListener("click", (e) => {
      if (!e.target.closest(".search-wrap")) showSuggest("");
      const chipBtn = e.target.closest("#chip-row button, #filter-sheet button, [data-filter-toggle], [data-filter-reset]");
      if (chipBtn && !chipBtn.dataset.star) {
        if (chipBtn.dataset.filterToggle !== undefined || chipBtn.hasAttribute("data-filter-toggle")) {
          state.filtersOpen = !state.filtersOpen;
          refresh();
          return;
        }
        if (chipBtn.hasAttribute("data-filter-reset")) {
          state.sectors.clear();
          state.pctMin = state.pctMax = null;
          state.rvMin = null;
          state.nearHigh = state.nearLow = null;
          state.wtMin = state.wfMin = null;
          state.mc.clear();
          state.earnings = false;
          state.merkOn = false;
          state.openPanel = null;
          window.MTS.setTimeframe(1);
          refresh();
          return;
        }
        if (chipBtn.dataset.open) {
          state.openPanel = state.openPanel === chipBtn.dataset.open ? null : chipBtn.dataset.open;
          refresh();
          return;
        }
        if (chipBtn.dataset.preset === "pct3") {
          const on = state.pctMin === 3 && state.pctMax === null;
          state.pctMin = on ? null : 3;
          state.pctMax = null;
          refresh();
          return;
        }
        if (chipBtn.dataset.preset === "pctm3") {
          const on = state.pctMax === -3 && state.pctMin === null;
          state.pctMax = on ? null : -3;
          state.pctMin = null;
          refresh();
          return;
        }
        if (chipBtn.dataset.preset === "ew") {
          state.earnings = !state.earnings;
          refresh();
          return;
        }
        if (chipBtn.dataset.preset === "merk") {
          state.merkOn = !state.merkOn;
          refresh();
          return;
        }
        if (chipBtn.dataset.ix && chipBtn.closest("#chip-row")) {
          toggleSet(state.indexes, chipBtn.dataset.ix);
          refresh();
          return;
        }
        if (chipBtn.dataset.ixAll) {
          state.indexes.clear();
          refresh();
          return;
        }
        if (chipBtn.dataset.sector) { toggleSet(state.sectors, chipBtn.dataset.sector); refresh(); return; }
        if (chipBtn.dataset.rv) { state.rvMin = state.rvMin === Number(chipBtn.dataset.rv) ? null : Number(chipBtn.dataset.rv); refresh(); return; }
        if (chipBtn.dataset.nh) { state.nearHigh = state.nearHigh === Number(chipBtn.dataset.nh) ? null : Number(chipBtn.dataset.nh); state.nearLow = null; refresh(); return; }
        if (chipBtn.dataset.nl) { state.nearLow = state.nearLow === Number(chipBtn.dataset.nl) ? null : Number(chipBtn.dataset.nl); state.nearHigh = null; refresh(); return; }
        if (chipBtn.dataset.wt) { state.wtMin = state.wtMin === Number(chipBtn.dataset.wt) ? null : Number(chipBtn.dataset.wt); refresh(); return; }
        if (chipBtn.dataset.wf) { state.wfMin = state.wfMin === Number(chipBtn.dataset.wf) ? null : Number(chipBtn.dataset.wf); refresh(); return; }
        if (chipBtn.dataset.mc) { toggleSet(state.mc, chipBtn.dataset.mc); refresh(); return; }
        if (chipBtn.dataset.apply === "pct") {
          const a = $("#pctMinIn")?.value;
          const b = $("#pctMaxIn")?.value;
          state.pctMin = a === "" ? null : Number(a);
          state.pctMax = b === "" ? null : Number(b);
          refresh();
          return;
        }
        if (chipBtn.dataset.clear === "sektor") { state.sectors.clear(); refresh(); return; }
        if (chipBtn.dataset.clear === "pct") { state.pctMin = state.pctMax = null; refresh(); return; }
        if (chipBtn.dataset.clear === "vol") { state.rvMin = null; refresh(); return; }
        if (chipBtn.dataset.clear === "range52") { state.nearHigh = state.nearLow = null; refresh(); return; }
        if (chipBtn.dataset.clear === "wh") { state.wtMin = state.wfMin = null; refresh(); return; }
        if (chipBtn.dataset.clear === "mc") { state.mc.clear(); refresh(); return; }
      }
      const pick = e.target.closest("[data-pick]");
      if (pick) {
        location.href = `aktie.html?t=${encodeURIComponent(pick.dataset.pick)}`;
        return;
      }
      const th = e.target.closest("[data-sort]");
      if (th && e.target.closest("#table-card")) {
        const k = th.dataset.sort;
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = k === "t" || k === "n" || k === "s" ? 1 : -1; }
        const rows = sortRows(filtered());
        renderList(rows, state.data.n || state.data.rows.length);
        return;
      }
      const row = e.target.closest(".vrow[data-t]");
      if (row) location.href = `aktie.html?t=${encodeURIComponent(row.dataset.t)}`;
    });
    document.addEventListener("mts-merk", () => {
      const merkBtn = document.querySelector('[data-preset="merk"]');
      if (merkBtn) {
        const n = window.MTS.readMerk().size;
        merkBtn.textContent = n ? `Merkliste ${n}` : "Merkliste";
      }
      if (state.merkOn && state.data) {
        renderList(sortRows(filtered()), state.data.n || state.data.rows.length);
      }
    });
    $("#app").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.id === "q") {
        const first = $("#suggest .suggest-item");
        if (first && !$("#suggest").hidden) {
          e.preventDefault();
          first.click();
        }
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        const row = e.target.closest(".vrow[data-t]");
        if (row) { e.preventDefault(); location.href = `aktie.html?t=${encodeURIComponent(row.dataset.t)}`; }
      }
    });
  }

  function openChart(ticker) {
    location.href = `aktie.html?t=${encodeURIComponent(ticker)}`;
  }

  async function start() {
    applyParams();
    try {
      const data = await loadJSON("data/stocks.json");
      state.data = data;
      state.searchIndex = window.MTS.buildSearchIndex(data.rows || []);
      state.rets = await window.MTS.returns();
      setStand(data);
      if (!state.sawIndexParam) state.indexes.add("SPX");
      bind();
      refresh();
    } catch (err) {
      $("#app").innerHTML = `<p class="error">Die Kursdaten konnten nicht geladen werden. Bitte später erneut öffnen.</p>`;
      console.error(err);
    }
  }

  start();
  setInterval(() => {
    if (!state.data) return;
    loadJSON("data/stocks.json").then((d) => {
      state.data = d;
      state.searchIndex = window.MTS.buildSearchIndex(d.rows || []);
      refresh();
    }).catch(() => {});
  }, window.MTS.REFRESH_MS);
  document.addEventListener("mts-tf", () => { if (state.data) refresh(); });
})();
