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
    pctColor(p, maxAbs = 3.5) {
      const t = Math.max(-1, Math.min(1, p / maxAbs));
      const neu = [168, 174, 180];
      const up = [44, 255, 138];
      const down = [255, 59, 92];
      const target = t >= 0 ? up : down;
      const a = Math.pow(Math.abs(t), 0.7);
      const rgb = neu.map((v, i) => Math.round(v + (target[i] - v) * a));
      return `rgb(${rgb.join(",")})`;
    },
    tint(color, amount, bg = [38, 42, 48]) {
      const m = color.match(/\d+/g).map(Number);
      const rgb = bg.map((v, i) => Math.round(v * (1 - amount) + m[i] * amount));
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
        return;
      }
      const label = data && data.stand && data.stand.label;
      el.textContent = label ? `Stand: ${label}` : "Stand unbekannt";
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
      const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${url} (${res.status})`);
      return res.json();
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
    ],
    indexName(id) {
      const hit = C.INDICES.find((x) => x.id === id);
      return hit ? hit.name : id;
    },
    pageIndex() {
      const q = new URLSearchParams(location.search).get("ix");
      return C.INDICES.some((x) => x.id === q) ? q : "SPX";
    },
    indexSwitch(current) {
      return `<nav class="chip-row index-switch" aria-label="Index">${C.INDICES.map((ix) =>
        `<a class="chip${ix.id === current ? " is-on" : ""}" href="?ix=${ix.id}"${ix.id === current ? ' aria-current="true"' : ""}>${ix.name}</a>`
      ).join("")}</nav>`;
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
    marketBadges(now = new Date()) {
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
        const cls = state === "offen" ? "is-open" : state === "Mittagspause" ? "is-lunch" : "is-closed";
        return `<span class="mkt ${cls}">${ex.name} · ${state}</span>`;
      }).join("");
    },
  };
  window.MTS = C;

  const NYSE = new Set("2026-01-01,2026-01-19,2026-02-16,2026-04-03,2026-05-25,2026-06-19,2026-07-03,2026-09-07,2026-11-26,2026-12-25,2027-01-01,2027-01-18,2027-02-15,2027-03-26,2027-05-31,2027-06-18,2027-07-05,2027-09-06,2027-11-25,2027-12-24".split(","));
  const XETRA = new Set("2026-01-01,2026-04-03,2026-04-06,2026-05-01,2026-12-24,2026-12-25,2026-12-26,2026-12-31,2027-01-01,2027-03-26,2027-03-29,2027-05-01,2027-12-24,2027-12-25,2027-12-26,2027-12-31".split(","));
  const KRX = new Set("2026-01-01,2026-02-16,2026-02-17,2026-02-18,2026-03-01,2026-05-05,2026-05-24,2026-06-06,2026-08-15,2026-09-24,2026-09-25,2026-09-26,2026-10-03,2026-10-09,2026-12-25,2027-01-01,2027-02-06,2027-02-07,2027-02-08,2027-03-01,2027-05-05,2027-06-06,2027-08-15,2027-09-14,2027-09-15,2027-09-16,2027-10-03,2027-10-09,2027-12-25".split(","));
  const TSE = new Set("2026-01-01,2026-01-02,2026-01-03,2026-01-12,2026-02-11,2026-02-23,2026-03-20,2026-04-29,2026-05-03,2026-05-04,2026-05-05,2026-07-20,2026-08-11,2026-09-21,2026-09-22,2026-09-23,2026-10-12,2026-11-03,2026-11-23,2026-12-31,2027-01-01,2027-01-02,2027-01-03,2027-01-11,2027-02-11,2027-02-23,2027-03-22,2027-04-29,2027-05-03,2027-05-04,2027-05-05,2027-07-19,2027-08-11,2027-09-20,2027-09-23,2027-10-11,2027-11-03,2027-11-23,2027-12-31".split(","));
  const LSE = new Set("2026-01-01,2026-04-03,2026-04-06,2026-05-04,2026-05-25,2026-08-31,2026-12-25,2026-12-28,2027-01-01,2027-03-26,2027-03-29,2027-05-03,2027-05-31,2027-08-30,2027-12-27,2027-12-28".split(","));

  function paintMarkets() {
    const host = document.getElementById("market-status");
    if (!host || !window.MTS) return;
    host.hidden = false;
    host.innerHTML = window.MTS.marketBadges(new Date());
  }
  paintMarkets();
  setInterval(paintMarkets, 30000);

  document.addEventListener("click", (e) => {
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
})();
