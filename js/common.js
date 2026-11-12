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
      const label = data && data.stand && data.stand.label;
      el.textContent = label
        ? `Stand: ${label} (ca. 15 Min. verzögert)`
        : "Stand unbekannt";
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
  };
  window.MTS = C;
})();
