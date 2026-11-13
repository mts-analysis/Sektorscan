(() => {
  "use strict";
  const C = {
    REFRESH_MS: 5 * 60 * 1000,
    ZONE_COLORS: ["#ff3b5c", "#f08c50", "#e9c46a", "#2cff8a", "#80f000"],
    $: (sel, root = document) => root.querySelector(sel),
    $$: (sel, root = document) => [...root.querySelectorAll(sel)],
    deNum(x, nd = 2) {
      if (x === null || x === undefined || Number.isNaN(Number(x))) return "–";
      return Number(x).toLocaleString("de-DE", {
        minimumFractionDigits: nd,
        maximumFractionDigits: nd,
      });
    },
    dePct(x, nd = 2) {
      if (x === null || x === undefined || Number.isNaN(Number(x))) return "–";
      const n = Number(x);
      const sign = n > 0 ? "+" : n < 0 ? "−" : "";
      return `${sign}${C.deNum(Math.abs(n), nd)} %`;
    },
    mixPct(p, maxAbs, light) {
      const t = Math.max(-1, Math.min(1, Number(p) / maxAbs));
      const neu = light ? [90, 98, 108] : [168, 174, 180];
      const up = light ? [12, 138, 75] : [44, 255, 138];
      const down = light ? [208, 18, 58] : [255, 59, 92];
      const target = t >= 0 ? up : down;
      const a = Math.pow(Math.abs(t), 0.7);
      const rgb = neu.map((v, i) => Math.round(v + (target[i] - v) * a));
      return `rgb(${rgb.join(",")})`;
    },
    pctColor(p, maxAbs = 3.5) {
      if (p === null || p === undefined || Number.isNaN(Number(p))) return "var(--muted)";
      return C.mixPct(p, maxAbs, document.documentElement.dataset.theme === "light");
    },
    cardColor(p, maxAbs = 3.5) {
      if (p === null || p === undefined || Number.isNaN(Number(p))) return "#9aa3ad";
      return C.mixPct(p, maxAbs, false);
    },
    tint(color, amount, bg) {
      const light = document.documentElement.dataset.theme === "light";
      const base = bg || (light ? [255, 255, 255] : [38, 42, 48]);
      const m = String(color).match(/\d+/g);
      if (!m) return color;
      const rgb = base.map((v, i) => Math.round(v * (1 - amount) + Number(m[i] || v) * amount));
      return `rgb(${rgb.join(",")})`;
    },
    escapeHtml(s) {
      return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    },
    sparkSVG(values, color, w = 300, h = 36) {
      if (!values || values.length < 2) return "";
      const pad = 1;
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
    },
    setStand(data) {
      const el = C.$("#stand");
      if (!el) return;
      const iso = data && (data.updated_at_utc || (data.stand && data.stand.iso_utc));
      const unix = data && data.stand && data.stand.unix;
      if (iso || unix) {
        el.textContent = C.localStamp(iso || unix * 1000);
      } else {
        const label = data && data.stand && data.stand.label;
        el.textContent = label ? `Stand: ${label}` : "Stand unbekannt";
      }
      if (data && (data.rows || data.markets || data.index) && C.applyFreshness) C.applyFreshness(data);
    },
    localStamp(value) {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "Stand unbekannt";
      const date = new Intl.DateTimeFormat("de-DE", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }).format(d);
      const zone = new Intl.DateTimeFormat("de-DE", { timeZoneName: "short" })
        .formatToParts(d)
        .find((p) => p.type === "timeZoneName");
      return `Update: ${date} ${zone ? zone.value : ""}`.trim();
    },
    fold(s) {
      return String(s || "")
        .replaceAll("ß", "ss")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    },
    buildSearchIndex(rows) {
      const list = rows.map((r) => {
        r._nt = C.fold(r.t);
        r._nn = C.fold(r.n);
        r._blob = `${r._nt} ${r._nn}`;
        return r;
      });
      const byTicker = list.slice().sort((a, b) => (a._nt < b._nt ? -1 : a._nt > b._nt ? 1 : 0));
      const byName = list.slice().sort((a, b) => (a._nn < b._nn ? -1 : a._nn > b._nn ? 1 : 0));
      return { list, byTicker, byName };
    },
    suggest(index, query, limit = 8) {
      if (!index) return [];
      const q = C.fold(query).trim();
      if (!q) return [];
      const out = [];
      const seen = new Set();
      const take = (row) => {
        if (seen.has(row.t) || out.length >= limit) return;
        seen.add(row.t);
        out.push(row);
      };
      const walk = (arr, key) => {
        let lo = 0;
        let hi = arr.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (arr[mid][key] < q) lo = mid + 1;
          else hi = mid;
        }
        for (let i = lo; i < arr.length && out.length < limit; i++) {
          if (!arr[i][key].startsWith(q)) break;
          take(arr[i]);
        }
      };
      walk(index.byTicker, "_nt");
      walk(index.byName, "_nn");
      if (out.length < limit) {
        for (let i = 0; i < index.list.length && out.length < limit; i++) {
          const row = index.list[i];
          if (row._blob.includes(q)) take(row);
        }
      }
      return out;
    },
    MERK_KEY: "mts-merkliste",
    readMerk() {
      try {
        const raw = JSON.parse(localStorage.getItem(C.MERK_KEY) || "[]");
        return new Set(Array.isArray(raw) ? raw : []);
      } catch {
        return new Set();
      }
    },
    writeMerk(set) {
      try {
        localStorage.setItem(C.MERK_KEY, JSON.stringify([...set]));
      } catch {
        /* private mode */
      }
    },
    hasMerk(ticker) {
      return C.readMerk().has(ticker);
    },
    toggleMerk(ticker) {
      const set = C.readMerk();
      const on = !set.has(ticker);
      if (on) set.add(ticker);
      else set.delete(ticker);
      C.writeMerk(set);
      return on;
    },
    starButton(ticker) {
      const on = C.hasMerk(ticker);
      const label = on ? "Von der Merkliste nehmen" : "Auf die Merkliste";
      return `<button type="button" class="star${on ? " is-on" : ""}" data-star="${C.escapeHtml(ticker)}" aria-pressed="${on ? "true" : "false"}" aria-label="${label}">★</button>`;
    },
    async loadJSON(url) {
      const path = String(url).split("?")[0];
      const abs = new URL(path, location.href).href;
      if (!C._jsonSeen) C._jsonSeen = new Set();
      const first = !C._jsonSeen.has(path);
      C._jsonSeen.add(path);
      const cache = "caches" in window ? await caches.open("mts-last-data").catch(() => null) : null;
      let cached = null;
      if (cache) {
        const hit = await cache.match(abs);
        if (hit) {
          try { cached = await hit.json(); } catch { cached = null; }
        }
      }
      const pull = async () => {
        const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`${path} (${res.status})`);
        const data = await res.json();
        if (cache) {
          cache.put(abs, new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json" },
          })).catch(() => {});
        }
        return data;
      };
      const quote = /(?:^|\/)(sectors|stocks|returns|earnings)\.json$/.test(path);
      if (first && cached) {
        pull().then((data) => {
          if (quote) document.dispatchEvent(new CustomEvent("mts-fresh", { detail: { path, data } }));
        }).catch(() => {});
        return cached;
      }
      return pull();
    },
    params() {
      return new URLSearchParams(location.search);
    },
    INDICES: [
      { id: "SPX", name: "S&P 500" },
      { id: "DAX", name: "DAX 40" },
      { id: "KS200", name: "KOSPI 200" },
      { id: "N225", name: "Nikkei 225" },
      { id: "UKX", name: "FTSE 100" },
      { id: "NDX", name: "Nasdaq-100" },
      { id: "DJI", name: "Dow Jones 30" },
    ],
    indexName(id) {
      const hit = C.INDICES.find((x) => x.id === id);
      return hit ? hit.name : id;
    },
    stockName(row) {
      const ticker = row && row.t ? String(row.t) : "";
      const name = row && row.n ? String(row.n).trim() : "";
      if (!name || name.toLowerCase() === "nan") return ticker;
      return name;
    },
    seasonLine(cell, month) {
      if (!cell || !cell.n) return "";
      const names = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];
      const label = names[(month || 1) - 1] || "";
      return `${label} historisch: Ø ${C.dePct(cell.excess)} vs S&P, ${cell.beat}/${cell.n} Jahre stärker`;
    },
    shortName(name, ticker) {
      const raw = C.stockName({ n: name, t: ticker || "" });
      const cut = raw
        .replace(/,?\s+(Incorporated|Limited)$/i, "")
        .replace(/\s+(Co\.,?\s*Ltd\.?|Corporation|Corp\.?|Inc\.?|Ltd\.?|PLC|plc)$/i, "")
        .replace(/,\s*$/, "")
        .trim();
      return cut || raw || ticker || "";
    },
    pageIndex() {
      const q = new URLSearchParams(location.search).get("ix");
      return C.INDICES.some((x) => x.id === q) ? q : "SPX";
    },
    indexSwitch(current, extra) {
      const keep = extra && typeof extra === "object" ? extra : null;
      return `<nav class="chip-row ix-scroll index-switch" aria-label="Index">${C.INDICES.map((ix) => {
        const q = new URLSearchParams();
        if (keep) {
          Object.entries(keep).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== "") q.set(k, v);
          });
        }
        q.set("ix", ix.id);
        return `<a class="chip${ix.id === current ? " is-on" : ""}" href="?${q.toString()}"${ix.id === current ? ' aria-current="true"' : ""}>${ix.name}</a>`;
      }).join("")}</nav>`;
    },
    syncTabs(ix) {
      document.querySelectorAll("nav.tabs a").forEach((a) => {
        const base = (a.getAttribute("href") || "").split("?")[0];
        a.setAttribute("href", `${base}?ix=${encodeURIComponent(ix)}`);
      });
    },
    priceDigits(ccy) {
      return ccy === "JPY" || ccy === "KRW" ? 0 : 2;
    },
    money(x, ccy) {
      if (x === null || x === undefined || Number.isNaN(Number(x))) return "–";
      const text = C.deNum(x, C.priceDigits(ccy));
      return ccy ? `${text} ${ccy}` : text;
    },
    zonedNow(date, tz) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          weekday: "short",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(date).map((p) => [p.type, p.value])
      );
      let hour = Number(parts.hour);
      if (hour === 24) hour = 0;
      return {
        ymd: `${parts.year}-${parts.month}-${parts.day}`,
        weekday: parts.weekday,
        minutes: hour * 60 + Number(parts.minute),
      };
    },
    INDEX_EXCHANGE: { SPX: "NYSE", DAX: "Xetra", KS200: "KRX", N225: "TSE", UKX: "LSE", NDX: "NYSE", DJI: "NYSE" },
    SECTORS: [
      "Technologie", "Finanzen", "Gesundheit", "Zyklischer Konsum", "Basiskonsum",
      "Industrie", "Energie", "Grundstoffe", "Versorger", "Immobilien", "Kommunikation",
    ],
    timeframe() {
      const q = new URLSearchParams(location.search).get("tf");
      if (q === "1" || q === "5" || q === "20") return Number(q);
      try {
        const saved = sessionStorage.getItem("mts-tf");
        if (saved === "5" || saved === "20") return Number(saved);
      } catch { /* private mode */ }
      return 1;
    },
    setTimeframe(n) {
      const value = n === 5 || n === 20 ? String(n) : "1";
      try { sessionStorage.setItem("mts-tf", value); } catch { /* private mode */ }
    },
    periodName(n = C.timeframe()) {
      return n === 5 ? "5 Tage" : n === 20 ? "20 Tage" : "Tag";
    },
    tfSwitcher() {
      const cur = C.timeframe();
      return `<div class="chip-row tf-row" role="group" aria-label="Zeitraum">${[1, 5, 20].map((n) =>
        `<button type="button" class="chip${cur === n ? " is-on" : ""}" data-tf="${n}">${C.periodName(n)}</button>`
      ).join("")}</div>`;
    },
    exportButton() {
      return `<button type="button" class="chip" data-export="1">TikTok-Bild speichern</button>`;
    },
    async returns() {
      if (!C._returnsPromise) {
        C._returnsPromise = C.loadJSON("data/history/returns.json").catch(() => null);
      }
      return C._returnsPromise;
    },
    exchanges(now = new Date()) {
      const lunch = (a, b) => ({ start: a[0] * 60 + a[1], end: b[0] * 60 + b[1] });
      const sessions = [
        { name: "NYSE", tz: "America/New_York", open: 9 * 60 + 30, close: 16 * 60, lunch: null, holidays: NYSE },
        { name: "Xetra", tz: "Europe/Berlin", open: 9 * 60, close: 17 * 60 + 30, lunch: null, holidays: XETRA },
        { name: "KRX", tz: "Asia/Seoul", open: 9 * 60, close: 15 * 60 + 30, lunch: null, holidays: KRX },
        { name: "TSE", tz: "Asia/Tokyo", open: 9 * 60, close: 15 * 60, lunch: lunch([11, 30], [12, 30]), holidays: TSE },
        { name: "LSE", tz: "Europe/London", open: 8 * 60, close: 16 * 60 + 30, lunch: null, holidays: LSE },
      ];
      return sessions.map((ex) => {
        const z = C.zonedNow(now, ex.tz);
        let state = "geschlossen";
        const weekend = z.weekday === "Sat" || z.weekday === "Sun";
        if (!weekend && !ex.holidays.has(z.ymd) && z.minutes >= ex.open && z.minutes < ex.close) {
          state = ex.lunch && z.minutes >= ex.lunch.start && z.minutes < ex.lunch.end
            ? "Mittagspause"
            : "offen";
        }
        return { name: ex.name, state };
      });
    },
    marketBadges(now = new Date()) {
      return C.exchanges(now).map((ex) => {
        const cls = ex.state === "offen" ? "is-open" : ex.state === "Mittagspause" ? "is-lunch" : "is-closed";
        return `<span class="mkt ${cls}">${ex.name} · ${ex.state}</span>`;
      }).join("");
    },
  };
  window.MTS = C;

  const NYSE = new Set("2026-01-01,2026-01-19,2026-02-16,2026-04-03,2026-05-25,2026-06-19,2026-07-03,2026-09-07,2026-11-26,2026-12-25,2027-01-01,2027-01-18,2027-02-15,2027-03-26,2027-05-31,2027-06-18,2027-07-05,2027-09-06,2027-11-25,2027-12-24".split(","));
  const XETRA = new Set("2026-01-01,2026-04-03,2026-04-06,2026-05-01,2026-12-24,2026-12-25,2026-12-26,2026-12-31,2027-01-01,2027-03-26,2027-03-29,2027-05-01,2027-12-24,2027-12-25,2027-12-26,2027-12-31".split(","));
  const KRX = new Set("2026-01-01,2026-02-16,2026-02-17,2026-02-18,2026-03-01,2026-05-05,2026-05-24,2026-06-06,2026-08-15,2026-09-24,2026-09-25,2026-09-26,2026-10-03,2026-10-09,2026-12-25,2027-01-01,2027-02-06,2027-02-07,2027-02-08,2027-03-01,2027-05-05,2027-06-06,2027-08-15,2027-09-14,2027-09-15,2027-09-16,2027-10-03,2027-10-09,2027-12-25".split(","));
  const TSE = new Set("2026-01-01,2026-01-02,2026-01-03,2026-01-12,2026-02-11,2026-02-23,2026-03-20,2026-04-29,2026-05-03,2026-05-04,2026-05-05,2026-07-20,2026-08-11,2026-09-21,2026-09-22,2026-09-23,2026-10-12,2026-11-03,2026-11-23,2026-12-31,2027-01-01,2027-01-02,2027-01-03,2027-01-11,2027-02-11,2027-02-23,2027-03-22,2027-04-29,2027-05-03,2027-05-04,2027-05-05,2027-07-19,2027-08-11,2027-09-20,2027-09-23,2027-10-11,2027-11-03,2027-11-23,2027-12-31".split(","));
  const LSE = new Set("2026-01-01,2026-04-03,2026-04-06,2026-05-04,2026-05-25,2026-08-31,2026-12-25,2026-12-28,2027-01-01,2027-03-26,2027-03-29,2027-05-03,2027-05-31,2027-08-30,2027-12-27,2027-12-28".split(","));

  const EXCHANGES = [
    { name: "NYSE", tz: "America/New_York", open: 9 * 60 + 30, close: 16 * 60, holidays: NYSE },
    { name: "Xetra", tz: "Europe/Berlin", open: 9 * 60, close: 17 * 60 + 30, holidays: XETRA },
    { name: "KRX", tz: "Asia/Seoul", open: 9 * 60, close: 15 * 60 + 30, holidays: KRX },
    { name: "TSE", tz: "Asia/Tokyo", open: 9 * 60, close: 15 * 60, holidays: TSE },
    { name: "LSE", tz: "Europe/London", open: 8 * 60, close: 16 * 60 + 30, holidays: LSE },
  ];

  function ymdShift(ymd, days) {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${dt.getUTCFullYear()}-${mm}-${dd}`;
  }

  function utcAt(tz, ymd, minutes) {
    const [y, m, d] = ymd.split("-").map(Number);
    let guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60000;
    for (let i = 0; i < 4; i++) {
      const z = C.zonedNow(new Date(guess), tz);
      const dayDelta = z.ymd === ymd ? 0 : (z.ymd < ymd ? 1 : -1);
      const diff = dayDelta * 1440 + (minutes - z.minutes);
      if (diff === 0) break;
      guess += diff * 60000;
    }
    return new Date(guess);
  }

  function tradingDay(ex, ymd) {
    const probe = C.zonedNow(utcAt(ex.tz, ymd, 12 * 60), ex.tz);
    if (probe.weekday === "Sat" || probe.weekday === "Sun") return false;
    return !ex.holidays.has(ymd);
  }

  function isOpen(ex, now) {
    const z = C.zonedNow(now, ex.tz);
    if (z.weekday === "Sat" || z.weekday === "Sun" || ex.holidays.has(z.ymd)) return false;
    return z.minutes >= ex.open && z.minutes < ex.close;
  }

  function completedCloses(ex, now) {
    const z = C.zonedNow(now, ex.tz);
    const closes = [];
    let ymd = z.ymd;
    for (let i = 0; i < 16 && closes.length < 2; i++) {
      if (tradingDay(ex, ymd)) {
        const today = ymd === z.ymd;
        if (!(today && z.minutes < ex.close)) closes.push(utcAt(ex.tz, ymd, ex.close));
      }
      ymd = ymdShift(ymd, -1);
    }
    return closes;
  }

  C.isStale = function (iso, indexId, now = new Date()) {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime()) || t.getTime() > now.getTime() + 5 * 60 * 1000) return false;
    const names = indexId && C.INDEX_EXCHANGE[indexId] ? [C.INDEX_EXCHANGE[indexId]] : EXCHANGES.map((ex) => ex.name);
    const list = names.map((name) => EXCHANGES.find((ex) => ex.name === name)).filter(Boolean);
    if (list.some((ex) => isOpen(ex, now))) return now.getTime() - t.getTime() > 45 * 60 * 1000;
    let latestLast = null;
    let prevOfLatest = null;
    list.forEach((ex) => {
      const closes = completedCloses(ex, now);
      if (!closes[0]) return;
      if (!latestLast || closes[0] > latestLast) {
        latestLast = closes[0];
        prevOfLatest = closes[1] || null;
      }
    });
    if (!prevOfLatest) return false;
    return t < prevOfLatest;
  };

  C.applyFreshness = function (data, now = new Date()) {
    const iso = data && (data.updated_at_utc || (data.stand && data.stand.iso_utc));
    if (!iso) return;
    const file = (location.pathname.split("/").pop() || "index.html");
    const ixParam = new URLSearchParams(location.search).get("ix");
    const multi = file === "vergleich.html" || file === "earnings.html";
    const ix = C.INDICES.some((x) => x.id === ixParam) ? ixParam : "SPX";
    const banner = document.getElementById("stale-banner");
    if (!banner) return;
    if (!C.isStale(iso, multi ? null : ix, now)) {
      banner.hidden = true;
      return;
    }
    const when = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
    banner.hidden = false;
    banner.textContent = `Daten vom ${when} – evtl. nicht aktuell`;
  };

  function paintMarkets() {
    const host = document.getElementById("market-status");
    if (!host || !window.MTS) return;
    host.hidden = false;
    host.innerHTML = window.MTS.marketBadges(new Date());
  }
  paintMarkets();
  setInterval(paintMarkets, 30000);

  document.addEventListener("click", (e) => {
    const tf = e.target.closest("[data-tf]");
    if (tf && window.MTS) {
      window.MTS.setTimeframe(Number(tf.dataset.tf));
      document.dispatchEvent(new CustomEvent("mts-tf"));
    }
    const star = e.target.closest("[data-star]");
    if (!star || !window.MTS) return;
    e.preventDefault();
    e.stopPropagation();
    const ticker = star.dataset.star;
    const on = window.MTS.toggleMerk(ticker);
    document.querySelectorAll("[data-star]").forEach((btn) => {
      if (btn.dataset.star !== ticker) return;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", on ? "Von der Merkliste nehmen" : "Auf die Merkliste");
    });
    document.dispatchEvent(new CustomEvent("mts-merk", { detail: { ticker, on } }));
  }, true);

  const PAGES = ["index.html", "rad.html", "saison.html", "heatmap.html", "vergleich.html", "scanner.html", "topflop.html", "earnings.html"];

  function pageFile() {
    const name = location.pathname.split("/").pop();
    return name || "index.html";
  }

  function paintThemeButton() {
    const btn = document.querySelector("[data-theme-toggle]");
    if (!btn) return;
    const light = document.documentElement.dataset.theme === "light";
    btn.textContent = light ? "Dunkel" : "Hell";
    btn.setAttribute("aria-pressed", light ? "true" : "false");
    btn.setAttribute("aria-label", light ? "Zur dunklen Darstellung" : "Zur hellen Darstellung");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", light ? "#f3f5f7" : "#15171A");
  }

  function setTheme(next) {
    if (next === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("mts-theme", next === "light" ? "light" : "dark"); } catch { /* private mode */ }
    paintThemeButton();
    document.dispatchEvent(new CustomEvent("mts-theme"));
  }

  const header = document.querySelector(".app-header");
  if (header && !header.querySelector(".back-btn")) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "back-btn";
    back.textContent = "‹ Zurück";
    const home = pageFile() === "index.html";
    if (home && history.length <= 1) back.hidden = true;
    back.addEventListener("click", () => {
      if (history.length > 1) history.back();
      else if (!home) location.href = "index.html";
    });
    header.insertBefore(back, header.firstChild);
  }
  if (header && !header.querySelector("[data-theme-toggle]")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    btn.setAttribute("data-theme-toggle", "");
    const market = header.querySelector(".market-row");
    header.insertBefore(btn, market || null);
    btn.addEventListener("click", () => {
      setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
    });
  }
  paintThemeButton();

  const main = document.getElementById("app");
  if (main && !document.getElementById("stale-banner")) {
    const banner = document.createElement("p");
    banner.id = "stale-banner";
    banner.className = "stale-banner";
    banner.hidden = true;
    main.parentElement.insertBefore(banner, main);
  }

  const here = pageFile();
  const pageIndex = PAGES.indexOf(here);
  if (pageIndex >= 0) {
    document.querySelector(".page")?.classList.add("has-dots");
    const dots = document.createElement("div");
    dots.className = "swipe-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.innerHTML = PAGES.map((_, i) => `<i class="${i === pageIndex ? "is-on" : ""}"></i>`).join("");
    document.body.appendChild(dots);
    try {
      const dir = sessionStorage.getItem("mts-swipe");
      if (dir) {
        sessionStorage.removeItem("mts-swipe");
        document.querySelector(".page")?.classList.add(dir === "prev" ? "swipe-prev" : "swipe-next");
      }
    } catch { /* private mode */ }
  }

  function blockedSwipeTarget(node) {
    if (!node || !node.closest) return true;
    if (node.closest(".ix-scroll, .market-row, .filter-sheet, .heat-band, .heat-sec, .tabs, .suggest, .range-fields, svg, canvas, input, textarea, select")) return true;
    const modal = document.getElementById("chart-modal");
    if (modal && !modal.hidden && modal.contains(node)) return true;
    let el = node;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const ox = style.overflowX;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 8) return true;
      el = el.parentElement;
    }
    return false;
  }

  let swipeStart = null;
  let swallowClick = false;
  document.addEventListener("touchstart", (e) => {
    if (pageIndex < 0 || e.touches.length !== 1) {
      swipeStart = null;
      return;
    }
    const t = e.touches[0];
    swipeStart = {
      x: t.clientX,
      y: t.clientY,
      blocked: blockedSwipeTarget(e.target),
    };
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!swipeStart || swipeStart.blocked) {
      swipeStart = null;
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.x;
    const dy = t.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    const dir = dx < 0 ? 1 : -1;
    const next = PAGES[pageIndex + dir];
    if (!next) return;
    const q = new URLSearchParams(location.search);
    const keep = new URLSearchParams();
    if (q.get("ix")) keep.set("ix", q.get("ix"));
    if (q.get("tf")) keep.set("tf", q.get("tf"));
    try { sessionStorage.setItem("mts-swipe", dir > 0 ? "next" : "prev"); } catch { /* private mode */ }
    swallowClick = true;
    location.href = keep.toString() ? `${next}?${keep}` : next;
  }, { passive: true });
  document.addEventListener("touchcancel", () => { swipeStart = null; }, { passive: true });
  document.addEventListener("click", (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  if (pageIndex >= 0) {
    const neighbors = [PAGES[pageIndex - 1], PAGES[pageIndex + 1]].filter(Boolean);
    neighbors.forEach((href) => {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = href;
      document.head.appendChild(link);
    });
    if (neighbors.length) {
      const spec = document.createElement("script");
      spec.type = "speculationrules";
      spec.textContent = JSON.stringify({
        prefetch: [{ source: "list", urls: neighbors, eagerness: "immediate" }],
      });
      document.head.appendChild(spec);
    }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
