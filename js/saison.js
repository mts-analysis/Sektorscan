(() => {
  "use strict";
  const { $, dePct, escapeHtml, loadJSON, setStand } = window.MTS;
  const SEC = ["XLK", "XLV", "XLF", "XLY", "XLP", "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC"];
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const state = {
    month: new Date().getMonth() + 1,
    quarter: Math.floor(new Date().getMonth() / 3) + 1,
    sort: "aktuell",
  };

  function closeOnOrBefore(dates, arr, iso) {
    let idx = -1;
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] <= iso && arr[i] > 0) idx = i;
    }
    return idx;
  }

  function span(dates, arr, startIso, endIso) {
    const a = closeOnOrBefore(dates, arr, startIso);
    const b = closeOnOrBefore(dates, arr, endIso);
    if (a < 0 || b <= a || !(arr[a] > 0)) return null;
    return arr[b] / arr[a] - 1;
  }

  function applyLive(etf, sectors) {
    if (!etf || !sectors || !sectors.spy || !(sectors.spy.price > 0)) return etf;
    const session = sectors.sectors && sectors.sectors[0] && sectors.sectors[0].session_date;
    if (!session) return etf;
    const prices = { SPY: Number(sectors.spy.price) };
    (sectors.sectors || []).forEach((s) => { prices[s.ticker] = Number(s.price); });
    if (SEC.some((t) => !(prices[t] > 0))) return etf;
    const dates = etf.dates.slice();
    const close = {};
    Object.entries(etf.close).forEach(([t, arr]) => { close[t] = arr.slice(); });
    const last = dates[dates.length - 1];
    if (last === session) {
      Object.keys(close).forEach((t) => { if (prices[t] > 0) close[t][close[t].length - 1] = prices[t]; });
    } else if (session > last) {
      dates.push(session);
      Object.keys(close).forEach((t) => close[t].push(prices[t] > 0 ? prices[t] : null));
    }
    return { ...etf, dates, close };
  }

  function currentExcess(etf, month, quarter, mode) {
    if (!etf || !etf.dates || !etf.close.SPY) return {};
    const endAll = etf.dates[etf.dates.length - 1];
    const year = Number(endAll.slice(0, 4));
    const nowMonth = Number(endAll.slice(5, 7));
    const nowQuarter = Math.floor((nowMonth - 1) / 3) + 1;
    let start;
    let end = endAll;
    if (mode === "m") {
      if (month > nowMonth) return {};
      start = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
      if (month < nowMonth) end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    } else {
      if (quarter > nowQuarter) return {};
      start = new Date(Date.UTC(year, (quarter - 1) * 3, 0)).toISOString().slice(0, 10);
      if (quarter < nowQuarter) end = new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10);
    }
    const spy = span(etf.dates, etf.close.SPY, start, end);
    const out = {};
    SEC.forEach((t) => {
      const series = etf.close[t];
      if (!series || spy == null) return;
      const ret = span(etf.dates, series, start, end);
      if (ret == null) return;
      out[t] = (ret - spy) * 100;
    });
    return out;
  }

  function windowStats(years, through, n) {
    if (!years) return null;
    const vals = [];
    for (let y = through; y > through - n; y--) {
      const v = years[String(y)];
      if (v == null || Number.isNaN(Number(v))) continue;
      vals.push(Number(v));
    }
    if (!vals.length) return null;
    return {
      avg: vals.reduce((sum, v) => sum + v, 0) / vals.length,
      beat: vals.filter((v) => v > 0).length,
      n: vals.length,
      short: n >= 20 && vals.length < 20,
    };
  }

  function heatStyle(v) {
    if (v == null || Number.isNaN(v)) return "";
    const a = Math.min(0.62, Math.abs(v) / 3.2);
    const rgb = v >= 0 ? "44,255,138" : "255,59,92";
    return `background:rgba(${rgb},${a.toFixed(2)})`;
  }

  function cardColor(v) {
    if (v == null || Number.isNaN(v)) return "#9aa3ad";
    return v >= 0 ? "#2cff8a" : "#ff3b5c";
  }

  function cellHtml(v, sub) {
    if (v == null || Number.isNaN(v)) return `<td class="sais-cell muted">–</td>`;
    return `<td class="sais-cell" style="${heatStyle(v)}"><strong>${dePct(v)}</strong>${sub ? `<span>${sub}</span>` : ""}</td>`;
  }

  function avgSub(stat) {
    if (!stat) return "";
    return `${stat.beat}/${stat.n}${stat.short ? " · n&lt;20" : ""}`;
  }

  function rowsFor(doc, live, mode) {
    const through = doc.through_year;
    const key = mode === "m" ? "months" : "quarters";
    const id = mode === "m" ? String(state.month) : String(state.quarter);
    return SEC.map((t) => {
      const block = doc.sectors[t][key][id] || {};
      const years = block.years || {};
      const last = years[String(through)];
      const s5 = windowStats(years, through, 5);
      const s10 = windowStats(years, through, 10);
      const s20 = windowStats(years, through, 20);
      return {
        t,
        name: doc.sectors[t].name,
        aktuell: live[t],
        last: last == null ? null : Number(last),
        s5, s10, s20,
      };
    });
  }

  function sortRows(rows) {
    const val = (row) => (state.sort === "y20" ? (row.s20 ? row.s20.avg : -999) : (row.aktuell == null ? -999 : row.aktuell));
    return rows.slice().sort((a, b) => val(b) - val(a));
  }

  function metric(label, v, sub) {
    if (v == null || Number.isNaN(v)) return `<div class="sais-metric"><span>${label}</span><strong>–</strong></div>`;
    return `<div class="sais-metric" style="${heatStyle(v)}"><span>${label}</span><strong>${dePct(v)}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
  }

  function table(title, rows) {
    const body = rows.map((row) => `<tr data-sector="${escapeHtml(row.name)}">
      <th>${escapeHtml(row.name)}<span>${escapeHtml(row.t)}</span></th>
      ${cellHtml(row.aktuell)}
      ${cellHtml(row.last)}
      ${cellHtml(row.s5 && row.s5.avg, avgSub(row.s5))}
      ${cellHtml(row.s10 && row.s10.avg, avgSub(row.s10))}
      ${cellHtml(row.s20 && row.s20.avg, avgSub(row.s20))}
    </tr>`).join("");
    const cards = rows.map((row) => `<article class="sais-card" data-sector="${escapeHtml(row.name)}">
      <h3>${escapeHtml(row.name)} <span>${escapeHtml(row.t)}</span></h3>
      <div class="sais-metrics">
        ${metric("Aktuell", row.aktuell)}
        ${metric("Letztes Jahr", row.last)}
        ${metric("Ø 5 J.", row.s5 && row.s5.avg, avgSub(row.s5))}
        ${metric("Ø 10 J.", row.s10 && row.s10.avg, avgSub(row.s10))}
        ${metric("Ø 20 J.", row.s20 && row.s20.avg, avgSub(row.s20))}
      </div>
    </article>`).join("");
    return `<section class="sais-block">
      <h2>${escapeHtml(title)}</h2>
      <div class="sais-cards">${cards}</div>
      <div class="season-scroll sais-wide"><table class="sais">
        <thead><tr><th>Sektor</th><th>Aktuell</th><th>Letztes Jahr</th><th>Ø 5 J.</th><th>Ø 10 J.</th><th>Ø 20 J.</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </section>`;
  }

  function render(doc, etf) {
    const monthRows = sortRows(rowsFor(doc, currentExcess(etf, state.month, state.quarter, "m"), "m"));
    const quarterRows = sortRows(rowsFor(doc, currentExcess(etf, state.month, state.quarter, "q"), "q"));
    const months = MONTHS.map((name, i) => `<button type="button" class="chip${state.month === i + 1 ? " is-on" : ""}" data-month="${i + 1}">${name.slice(0, 3)}</button>`).join("");
    const quarters = [1, 2, 3, 4].map((q) => `<button type="button" class="chip${state.quarter === q ? " is-on" : ""}" data-quarter="${q}">Q${q}</button>`).join("");
    $("#app").innerHTML = `
      <p class="legal-banner">Historischer Durchschnitt – keine Prognose</p>
      <p class="note">S&amp;P 500 · Sektor-ETF minus SPY. Aktuell ist der laufende Monat bzw. das laufende Quartal bis zum letzten Kurs. Die Durchschnitte zählen nur abgeschlossene Jahre bis ${doc.through_year}. Darunter: Jahre, in denen der Sektor stärker war.</p>
      <div class="tool-row">
        <button type="button" class="chip${state.sort === "aktuell" ? " is-on" : ""}" data-sort="aktuell">Sortierung Aktuell</button>
        <button type="button" class="chip${state.sort === "y20" ? " is-on" : ""}" data-sort="y20">Sortierung Ø 20 J.</button>
        <button type="button" class="chip" data-export="1">TikTok-Bild speichern</button>
      </div>
      <h2>Monat</h2>
      <div class="chip-row ix-scroll">${months}</div>
      ${table(MONTHS[state.month - 1], monthRows)}
      <h2>Quartal</h2>
      <div class="chip-row">${quarters}</div>
      ${table(`Q${state.quarter}`, quarterRows)}`;
    window.__mtsSaison = {
      title: "Saison-Statistik",
      subtitle: `${MONTHS[state.month - 1]} · Q${state.quarter}`,
      monthTitle: MONTHS[state.month - 1],
      quarterTitle: `Q${state.quarter}`,
      monthRows: monthRows.map(cardRow),
      quarterRows: quarterRows.map(cardRow),
    };
  }

  function cardRow(row) {
    const cell = (v, sub) => ({ value: v == null ? "–" : dePct(v), sub: sub || "", color: cardColor(v) });
    return {
      name: row.name,
      cells: [
        cell(row.aktuell),
        cell(row.last),
        cell(row.s5 && row.s5.avg, row.s5 ? `${row.s5.beat}/${row.s5.n}` : ""),
        cell(row.s10 && row.s10.avg, row.s10 ? `${row.s10.beat}/${row.s10.n}` : ""),
        cell(row.s20 && row.s20.avg, row.s20 ? `${row.s20.beat}/${row.s20.n}${row.s20.short ? " n<20" : ""}` : ""),
      ],
    };
  }

  document.addEventListener("click", async (e) => {
    const month = e.target.closest("[data-month]");
    const quarter = e.target.closest("[data-quarter]");
    const sort = e.target.closest("[data-sort]");
    if (month || quarter || sort) {
      if (month) state.month = Number(month.dataset.month);
      if (quarter) state.quarter = Number(quarter.dataset.quarter);
      if (sort) state.sort = sort.dataset.sort;
      if (window.__mtsDoc) render(window.__mtsDoc, window.__mtsEtf);
      document.querySelector(".chip.is-on[data-month]")?.scrollIntoView({ inline: "center", block: "nearest" });
      return;
    }
    const row = e.target.closest("[data-sector]");
    if (row) {
      location.href = `sektor.html?ix=SPX&s=${encodeURIComponent(row.dataset.sector)}`;
      return;
    }
    if (!e.target.closest("[data-export]") || !window.__mtsSaison) return;
    const btn = e.target.closest("[data-export]");
    btn.disabled = true;
    try {
      await window.MTS.saveCard({ kind: "saison", ...window.__mtsSaison, filename: "mts-saison.png" });
    } catch (err) {
      console.error(err);
    }
    btn.disabled = false;
  });

  async function start() {
    try {
      const [doc, etf, sectors] = await Promise.all([
        loadJSON("data/seasonality.json"),
        loadJSON("data/history/etf.json"),
        loadJSON("data/sectors.json").catch(() => null),
      ]);
      if (sectors) setStand(sectors);
      window.__mtsDoc = doc;
      window.__mtsEtf = applyLive(etf, sectors);
      render(doc, window.__mtsEtf);
      document.querySelector(".chip.is-on[data-month]")?.scrollIntoView({ inline: "center", block: "nearest" });
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Die Saison-Statistik liegt gerade nicht vor.</p>`;
    }
  }
  start();
})();
