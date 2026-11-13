(() => {
  "use strict";

  const REFRESH_MS = 5 * 60 * 1000;
  const DATA_URL = "data/sectors.json";
  const ZONE_COLORS = ["#ff3b5c", "#f08c50", "#e9c46a", "#2cff8a", "#80f000"];

  const $ = (sel, root = document) => root.querySelector(sel);

  function deNum(x, nd = 2) {
    return Number(x).toLocaleString("de-DE", {
      minimumFractionDigits: nd,
      maximumFractionDigits: nd,
    });
  }

  function dePct(x, nd = 2) {
    const n = Number(x);
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return `${sign}${deNum(Math.abs(n), nd)} %`;
  }

  function pctColor(p, maxAbs = 3.5) {
    if (window.MTS) return window.MTS.pctColor(p, maxAbs);
    const t = Math.max(-1, Math.min(1, p / maxAbs));
    const neu = [168, 174, 180];
    const up = [44, 255, 138];
    const down = [255, 59, 92];
    const target = t >= 0 ? up : down;
    const a = Math.pow(Math.abs(t), 0.7);
    const rgb = neu.map((v, i) => Math.round(v + (target[i] - v) * a));
    return `rgb(${rgb.join(",")})`;
  }

  function tint(color, amount, bg) {
    if (window.MTS) return window.MTS.tint(color, amount, bg);
    const base = bg || [38, 42, 48];
    const m = color.match(/\d+/g).map(Number);
    const rgb = base.map((v, i) => Math.round(v * (1 - amount) + m[i] * amount));
    return `rgb(${rgb.join(",")})`;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function sparkSVG(values, color) {
    if (!values || values.length < 2) return "";
    const w = 300, h = 36, pad = 1;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    const pts = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - lo) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const first = pts[0].split(",");
    const last = pts[pts.length - 1].split(",");
    const fill = `${pts.join(" ")} ${last[0]},${h} ${first[0]},${h}`;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="${fill}" fill="${color}" opacity="0.18"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  function gaugeSVG(score, zone) {
    const color = ZONE_COLORS[zone] || ZONE_COLORS[2];
    const cx = 140, cy = 128, r = 88, w = 16;
    const edges = [0, 20, 40, 60, 80, 100];
    const cols = ZONE_COLORS;
    const arc = (from, to, rad) => {
      // 0 at left, 100 at right, 50 at top. SVG y grows down.
      const a0 = Math.PI * (1 - from / 100);
      const a1 = Math.PI * (1 - to / 100);
      const x0 = cx + rad * Math.cos(a0);
      const y0 = cy - rad * Math.sin(a0);
      const x1 = cx + rad * Math.cos(a1);
      const y1 = cy - rad * Math.sin(a1);
      const large = to - from > 50 ? 1 : 0;
      return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rad} ${rad} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    const segments = [0, 1, 2, 3, 4].map((i) => {
      const active = i === zone;
      return `<path d="${arc(edges[i], edges[i + 1], r)}" fill="none" stroke="${cols[i]}" stroke-width="${w}" stroke-linecap="butt" opacity="${active ? 1 : 0.55}"/>`;
    }).join("");
    const tick = (v) => {
      const a = Math.PI * (1 - v / 100);
      const x1 = cx + (r - 10) * Math.cos(a);
      const y1 = cy - (r - 10) * Math.sin(a);
      const x2 = cx + (r - 20) * Math.cos(a);
      const y2 = cy - (r - 20) * Math.sin(a);
      const lx = cx + (r - 32) * Math.cos(a);
      const ly = cy - (r - 32) * Math.sin(a);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#9aa3ad" stroke-width="1.5"/>
        <text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="#6e7680" font-size="11" font-family="Be Vietnam Pro, sans-serif">${v}</text>`;
    };
    const a = Math.PI * (1 - score / 100);
    const tipR = r + 2;
    const hubR = 10;
    const tx = cx + tipR * Math.cos(a);
    const ty = cy - tipR * Math.sin(a);
    const bx = cx + hubR * Math.cos(a);
    const by = cy - hubR * Math.sin(a);
    // small triangle at the rim
    const leftA = a + 0.11, rightA = a - 0.11;
    const ir = r - 12;
    const lx = cx + ir * Math.cos(leftA);
    const ly = cy - ir * Math.sin(leftA);
    const rx = cx + ir * Math.cos(rightA);
    const ry = cy - ir * Math.sin(rightA);

    return `<svg class="gauge" viewBox="0 0 280 150" role="img" aria-label="Trend-Barometer ${score} von 100">
      <path d="${arc(0, 100, r)}" fill="none" stroke="#3a3e44" stroke-width="${w}"/>
      ${segments}
      ${tick(0)}${tick(50)}${tick(100)}
      <line x1="${bx}" y1="${by}" x2="${cx + (r - 14) * Math.cos(a)}" y2="${cy - (r - 14) * Math.sin(a)}" stroke="#eceff1" stroke-width="2" stroke-linecap="round"/>
      <polygon points="${tx.toFixed(1)},${ty.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)} ${rx.toFixed(1)},${ry.toFixed(1)}" fill="#eceff1"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="#eceff1"/>
      <circle cx="${cx}" cy="${cy}" r="2.5" fill="#262a30"/>
    </svg>`;
  }

  function setStand(data) {
    if (window.MTS) window.MTS.setStand(data);
  }

  function deSession(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
  }

  function barometerCard(baro) {
    if (!baro || baro.score == null) {
      return `<article class="card">
        <p class="kicker">MTS Trend-Barometer</p>
        <p class="hero-line">Für diese Sitzung gerade nicht verfügbar.</p>
      </article>`;
    }
    const zoneColor = ZONE_COLORS[baro.zone] || ZONE_COLORS[2];
    const sess = deSession(baro.session_date);
    return `<article class="card">
      <p class="kicker">MTS Trend-Barometer</p>
      <div class="gauge-wrap">
        ${gaugeSVG(baro.score, baro.zone)}
        <p class="baro-score">${baro.score}</p>
        <p class="baro-of">von 100</p>
        <span class="zone-pill" style="color:${zoneColor}">${escapeHtml(baro.zone_name)}</span>
        ${sess ? `<p class="baro-prev">Sitzung ${escapeHtml(sess)}</p>` : ""}
        <p class="baro-prev">Vortag ${baro.prev_score}/100  ·  ${escapeHtml(baro.prev_zone_name)}</p>
      </div>
    </article>`;
  }

  function periodPct(pair, tf) {
    if (!pair) return null;
    return tf === 5 ? pair[0] : pair[1];
  }

  function renderMarket(market, switcher, data, tools, tf, pack) {
    setStand(data);
    const usePeriod = tf && tf !== 1;
    const indexPct = usePeriod ? periodPct(pack && pack.ix && pack.ix[market.id], tf) : market.pct;
    const upCls = indexPct >= 0 ? "is-up" : "is-down";
    const sectors = (Array.isArray(market.sectors) ? market.sectors : []).map((s) => {
      if (!usePeriod) return s;
      const pct = periodPct(pack && pack.sec && pack.sec[market.id] && pack.sec[market.id][s.name], tf);
      return { ...s, pct };
    }).filter((s) => s.pct != null);
    const nSectors = sectors.length;
    const upSectors = sectors.filter((s) => s.pct > 0).length;
    const nStocks = market.n_stocks || 0;
    const upStocks = market.up_stocks || 0;
    const tiles = sectors.map((s, i) => {
      const col = pctColor(s.pct);
      const tail = nSectors === 11 && i >= 9 ? (i === 9 ? " tail-a" : " tail-b") : "";
      return `<a class="tile${tail}" href="sektor.html?ix=${encodeURIComponent(market.id)}&s=${encodeURIComponent(s.name)}" style="background:${tint(col, 0.1)}">
        <span class="tile-accent" style="background:${col}"></span>
        <div class="tile-top">
          <div>
            <h3 class="tile-name">${escapeHtml(s.name)}</h3>
            ${s.n ? `<p class="tile-ticker">${s.n} Titel</p>` : ""}
          </div>
        </div>
        <p class="tile-pct" style="color:${col}">${dePct(s.pct)}</p>
        ${usePeriod || !s.sparkline ? "" : sparkSVG(s.sparkline, col)}
      </a>`;
    }).join("");
    const priceBlock = market.price == null
      ? `<p class="hero-line">Indexstand gerade nicht verfügbar</p>`
      : `<p class="spx-price">${deNum(market.price)}</p>
         <p class="spx-pct ${upCls}">${indexPct == null ? "–" : dePct(indexPct)}</p>`;
    const periodNote = usePeriod ? `${window.MTS.periodName(tf)}, nach Börsenwert gewichtet` : "Ø Tagesänderung der Titel in der letzten Sitzung";
    $("#app").innerHTML = `
      ${switcher}
      ${tools || ""}
      <div class="main-layout">
        <section class="hero">
          <article class="card">
            <p class="kicker">${escapeHtml(market.name)} · Punkte</p>
            ${priceBlock}
            <p class="hero-line">${upSectors} von ${nSectors} Sektoren im Plus</p>
            <p class="hero-sub">${upStocks} von ${nStocks} Titeln im Plus · letzte Sitzung</p>
          </article>
          ${barometerCard(market.barometer)}
        </section>
        <section>
          <div class="section-head">
            <h2>Sektor-Übersicht</h2>
            <p>${periodNote}</p>
          </div>
          <div class="grid">${tiles}</div>
        </section>
      </div>`;
  }

  async function render(data) {
    const ix = window.MTS ? window.MTS.pageIndex() : "SPX";
    const switcher = window.MTS ? window.MTS.indexSwitch(ix) : "";
    const tf = window.MTS ? window.MTS.timeframe() : 1;
    const pack = tf === 1 || !window.MTS ? null : await window.MTS.returns();
    const tools = window.MTS ? `<div class="tool-row">${window.MTS.tfSwitcher()}${window.MTS.exportButton()}<a class="chip" href="woche.html?ix=${encodeURIComponent(ix)}">Wochen-Rückblick</a></div>` : "";
    if (window.MTS) window.MTS.syncTabs(ix);
    if (ix !== "SPX" || tf !== 1) {
      const market = (data.markets || []).find((m) => m.id === ix) || (ix === "SPX" ? {
        id: "SPX", name: data.index.name, price: data.index.price, pct: data.index.pct,
        sectors: (data.sectors || []).map((s) => ({ name: s.name, pct: s.pct, n: null })),
        up_stocks: null, n_stocks: null, barometer: data.barometer,
      } : null);
      if (!market) {
        $("#app").innerHTML = `${switcher}${tools}<p class="error">Für diesen Index liegen gerade keine Daten vor.</p>`;
        return;
      }
      if (ix === "SPX" && tf !== 1) {
        market.sectors = window.MTS.SECTORS.map((name) => ({
          name,
          pct: periodPct(pack && pack.sec && pack.sec.SPX && pack.sec.SPX[name], tf),
          n: null,
          sparkline: [],
        })).filter((s) => s.pct != null);
      }
      renderMarket(market, switcher, data, tools, tf, pack);
      rememberCard(ix, tf, market);
      return;
    }
    setStand(data);

    const idx = data.index;
    const up = data.up;
    const baro = data.barometer;
    const upCls = idx.pct >= 0 ? "is-up" : "is-down";

    const tiles = data.sectors.map((s, i) => {
      const col = pctColor(s.pct);
      const tail = i >= 9 ? (i === 9 ? " tail-a" : " tail-b") : "";
      return `<a class="tile${tail}" href="sektor.html?ix=SPX&s=${encodeURIComponent(s.name)}" style="background:${tint(col, 0.1)}">
        <span class="tile-accent" style="background:${col}"></span>
        <div class="tile-top">
          <div>
            <h3 class="tile-name">${escapeHtml(s.name)}</h3>
            <p class="tile-ticker">${escapeHtml(s.ticker)}</p>
          </div>
          <p class="tile-price">${deNum(s.price)} USD</p>
        </div>
        <p class="tile-pct" style="color:${col}">${dePct(s.pct)}</p>
        ${sparkSVG(s.sparkline, col)}
      </a>`;
    }).join("");

    $("#app").innerHTML = `
      ${switcher}
      ${tools}
      <div class="main-layout">
        <section class="hero">
          <article class="card">
            <p class="kicker">${escapeHtml(idx.name)}</p>
            <p class="spx-price">${deNum(idx.price)}</p>
            <p class="spx-pct ${upCls}">${dePct(idx.pct)}</p>
            <p class="hero-line">${up} von 11 Sektoren im Plus</p>
            <p class="hero-sub">US-Sitzung · ${escapeHtml(data.stand ? data.stand.et.replace(/,.*$/, "") : idx.session_date)}</p>
          </article>
          ${barometerCard(baro)}
        </section>
        <section>
          <div class="section-head">
            <h2>Sektor-Übersicht</h2>
            <p>ETF-Kurs, farblich nach Tagesänderung</p>
          </div>
          <div class="grid">${tiles}</div>
        </section>
      </div>`;
    rememberCard("SPX", 1, { name: idx.name, price: idx.price, pct: idx.pct, sectors: data.sectors }, data);
  }

  function rememberCard(ix, tf, market) {
    const tiles = (market.sectors || []).map((s) => ({
      name: s.name,
      pct: s.pct == null ? "–" : dePct(s.pct),
      color: s.pct == null ? "#9aa3ad" : window.MTS.cardColor(s.pct),
    }));
    window.__mtsSectors = {
      title: `Sektoren · ${market.name || ix}`,
      subtitle: `${window.MTS ? window.MTS.periodName(tf) : "Tag"} · ${new Date().toLocaleDateString("de-DE")}`,
      tiles,
    };
  }

  function showError(msg) {
    $("#app").innerHTML = `<p class="error">${escapeHtml(msg)}</p>`;
  }

  async function load() {
    const url = `${DATA_URL}?t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Daten nicht erreichbar (${res.status})`);
    const data = await res.json();
    if (!data || !data.index || !Array.isArray(data.sectors)) {
      throw new Error("Datenformat unerwartet");
    }
    latest = data;
    render(data);
  }

  let latest = null;

  async function tick() {
    try {
      await load();
    } catch (err) {
      showError("Die Kursdaten konnten nicht geladen werden. Bitte später erneut öffnen.");
      console.error(err);
    }
  }

  tick();
  setInterval(tick, REFRESH_MS);
  document.addEventListener("mts-tf", () => { if (latest) render(latest); });
  document.addEventListener("mts-theme", () => { if (latest) render(latest); });
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-export]") || !window.__mtsSectors) return;
    const btn = e.target.closest("[data-export]");
    btn.disabled = true;
    try {
      await window.MTS.saveCard({ kind: "sectors", ...window.__mtsSectors, filename: "mts-sektoren.png" });
    } catch (err) {
      console.error(err);
    }
    btn.disabled = false;
  });
})();
