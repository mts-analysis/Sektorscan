(() => {
  "use strict";
  const { $, dePct, escapeHtml, loadJSON, seasonLine } = window.MTS;
  const SEC = ["XLK", "XLV", "XLF", "XLY", "XLP", "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC"];
  const QCOLOR = {
    "Führend": "#3ddc6a",
    "Schwächelt": "#f0c14a",
    "Hinkt hinterher": "#ff4b5c",
    "Erholt sich": "#2ec8c4",
  };
  const state = { frame: 0, playing: false, timer: 0, hits: [] };

  function quad(x, y) {
    if (x >= 100 && y >= 100) return "Führend";
    if (x >= 100) return "Schwächelt";
    if (y < 100) return "Hinkt hinterher";
    return "Erholt sich";
  }

  function ema(values, span) {
    const k = 2 / (span + 1);
    let prev = null;
    return values.map((v) => {
      if (v == null || Number.isNaN(v)) return null;
      prev = prev == null ? v : v * k + prev * (1 - k);
      return prev;
    });
  }

  function applyLive(etf, sectors) {
    if (!sectors || !sectors.spy || !sectors.spy.price || !Array.isArray(sectors.sectors)) return etf;
    const session = sectors.sectors[0] && sectors.sectors[0].session_date;
    if (!session) return etf;
    const prices = { SPY: Number(sectors.spy.price) };
    sectors.sectors.forEach((s) => { prices[s.ticker] = Number(s.price); });
    if (SEC.some((t) => !(prices[t] > 0)) || !(prices.SPY > 0)) return etf;
    const dates = etf.dates.slice();
    const close = {};
    Object.entries(etf.close).forEach(([t, arr]) => { close[t] = arr.slice(); });
    const last = dates[dates.length - 1];
    if (last === session) {
      Object.keys(close).forEach((t) => { if (prices[t] > 0) close[t][close[t].length - 1] = prices[t]; });
    } else if (session > last) {
      dates.push(session);
      Object.keys(close).forEach((t) => close[t].push(prices[t] > 0 ? prices[t] : null));
    } else {
      return etf;
    }
    return { ...etf, dates, close, live: true };
  }

  function build(etf) {
    const dates = etf.dates;
    const spy = etf.close.SPY;
    const series = {};
    SEC.forEach((t) => {
      const px = etf.close[t] || [];
      const rs = px.map((v, i) => (v > 0 && spy[i] > 0 ? 100 * v / spy[i] : null));
      const e10 = ema(rs, 10);
      const e30 = ema(rs, 30);
      const ratio = e10.map((v, i) => (v != null && e30[i] ? 100 * v / e30[i] : null));
      const mom = ratio.map((v, i) => (v != null && ratio[i - 5] ? 100 * v / ratio[i - 5] : null));
      series[t] = { ratio, mom };
    });
    const frames = [];
    for (let i = 0; i < dates.length; i++) {
      if (SEC.every((t) => series[t].ratio[i] != null && series[t].mom[i] != null)) frames.push(i);
    }
    const windowFrames = frames.slice(-20);
    let max = 0.4;
    windowFrames.forEach((end) => {
      for (let k = Math.max(0, end - 9); k <= end; k++) {
        SEC.forEach((t) => {
          max = Math.max(max, Math.abs(series[t].ratio[k] - 100), Math.abs(series[t].mom[k] - 100));
        });
      }
    });
    return { dates, series, frames: windowFrames, max, names: etf.names || {} };
  }

  function tag(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${m[3]}.${m[2]}.` : iso;
  }

  function pointsAt(model, end) {
    return SEC.map((t) => {
      const tail = [];
      for (let k = Math.max(0, end - 9); k <= end; k++) {
        const x = model.series[t].ratio[k];
        const y = model.series[t].mom[k];
        if (x == null || y == null) continue;
        tail.push([(x - 100) / model.max, (y - 100) / model.max, x, y]);
      }
      const last = tail[tail.length - 1] || [0, 0, 100, 100];
      return {
        t,
        name: model.names[t] || t,
        x: last[0],
        y: last[1],
        raw: [last[2], last[3]],
        quad: quad(last[2], last[3]),
        color: QCOLOR[quad(last[2], last[3])],
        tail: tail.map((p) => [p[0], p[1]]),
      };
    });
  }

  function drawLive(canvas, model) {
    const css = canvas.clientWidth || 360;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, css, css);
    const cx = css / 2;
    const cy = css / 2;
    const R = css * 0.38;
    const rings = [
      ["#2ec8c4", Math.PI, Math.PI * 1.5],
      ["#3ddc6a", Math.PI * 1.5, Math.PI * 2],
      ["#f0c14a", 0, Math.PI * 0.5],
      ["#ff4b5c", Math.PI * 0.5, Math.PI],
    ];
    ctx.lineWidth = Math.max(10, css * 0.045);
    rings.forEach(([color, a0, a1]) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.arc(cx, cy, R, a0, a1);
      ctx.stroke();
    });
    ctx.strokeStyle = "rgba(236,239,241,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    const end = model.frames[state.frame];
    const pts = pointsAt(model, end);
    state.hits = [];
    pts.forEach((pt) => {
      if (pt.tail.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = pt.color;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 2;
        pt.tail.forEach((p, i) => {
          const x = cx + p[0] * R;
          const y = cy - p[1] * R;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const x = cx + pt.x * R;
      const y = cy - pt.y * R;
      ctx.beginPath();
      ctx.fillStyle = "#f4f7f8";
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = pt.color;
      ctx.stroke();
      ctx.fillStyle = document.documentElement.dataset.theme === "light" ? "#1a1c1f" : "#eceff1";
      ctx.font = "800 12px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(pt.t, x + 10, y - 8);
      state.hits.push({ x, y, name: pt.name, t: pt.t });
    });
    return pts;
  }

  function render(model, season) {
    const end = model.frames[state.frame];
    const iso = model.dates[end];
    const pts = pointsAt(model, end);
    const month = new Date().getMonth() + 1;
    const rows = pts.map((pt) => {
      const cell = season && season.sectors && season.sectors[pt.t] && season.sectors[pt.t].months[String(month)];
      return `<a class="rad-row" href="sektor.html?ix=SPX&s=${encodeURIComponent(pt.name)}">
        <span class="rad-dot" style="background:${pt.color}"></span>
        <span><strong>${escapeHtml(pt.t)}</strong> ${escapeHtml(pt.name)}<br><span class="season-hint">${cell ? escapeHtml(seasonLine(cell, month)) : ""}</span></span>
        <span class="muted">${escapeHtml(pt.quad)}</span>
      </a>`;
    }).join("");
    $("#app").innerHTML = `
      <div class="tool-row">
        <button type="button" class="chip" id="play">${state.playing ? "Pause" : "Abspielen"}</button>
        <span class="kicker" id="tag">TAG ${escapeHtml(tag(iso))}</span>
        <a class="chip" href="saison.html">Saison-Statistik</a>
        <button type="button" class="chip" data-export="1">TikTok-Bild speichern</button>
      </div>
      <label class="note">Sitzung
        <input id="day" type="range" min="0" max="${model.frames.length - 1}" value="${state.frame}">
      </label>
      <canvas id="wheel" class="wheel" width="640" height="640" aria-label="Sektor-Rad"></canvas>
      <p class="note">Daten: Yahoo Finance, SPDR-Sektor-ETFs · Stand ${escapeHtml(tag(model.dates[model.dates.length - 1]))} · RRG-Näherung. Nur S&amp;P 500. Historischer Durchschnitt – keine Prognose.</p>
      <div class="rad-legend">
        <span style="color:#3ddc6a">Führend</span>
        <span style="color:#f0c14a">Schwächelt</span>
        <span style="color:#ff4b5c">Hinkt hinterher</span>
        <span style="color:#2ec8c4">Erholt sich</span>
      </div>
      <div class="rad-list">${rows}</div>`;
    const canvas = $("#wheel");
    drawLive(canvas, model);
    window.__mtsRad = {
      title: "Das Sektor-Rad",
      subtitle: `Tag ${tag(iso)}`,
      foot: `Daten: Yahoo Finance, SPDR-Sektor-ETFs · Stand ${tag(model.dates[model.dates.length - 1])} · RRG-Näherung`,
      points: pts,
    };
    $("#play").addEventListener("click", () => {
      state.playing = !state.playing;
      if (state.playing) {
        if (state.frame >= model.frames.length - 1) state.frame = 0;
        state.timer = setInterval(() => {
          state.frame = Math.min(model.frames.length - 1, state.frame + 1);
          if (state.frame >= model.frames.length - 1) state.playing = false;
          render(model, season);
          if (!state.playing) clearInterval(state.timer);
        }, 450);
      } else {
        clearInterval(state.timer);
        render(model, season);
      }
    });
    $("#day").addEventListener("input", (e) => {
      state.playing = false;
      clearInterval(state.timer);
      state.frame = Number(e.target.value);
      render(model, season);
    });
    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let best = null;
      state.hits.forEach((hit) => {
        const d = Math.hypot(hit.x - x, hit.y - y);
        if (d < 28 && (!best || d < best.d)) best = { d, hit };
      });
      if (best) location.href = `sektor.html?ix=SPX&s=${encodeURIComponent(best.hit.name)}`;
    });
  }

  document.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-export]") || !window.__mtsRad) return;
    const btn = e.target.closest("[data-export]");
    btn.disabled = true;
    try {
      await window.MTS.saveCard({ kind: "rad", ...window.__mtsRad, filename: "mts-rad.png" });
    } catch (err) {
      console.error(err);
    }
    btn.disabled = false;
  });

  async function start() {
    try {
      const [etf, sectors, season] = await Promise.all([
        loadJSON("data/history/etf.json"),
        loadJSON("data/sectors.json").catch(() => null),
        loadJSON("data/seasonality.json").catch(() => null),
      ]);
      if (sectors) window.MTS.setStand(sectors);
      const model = build(applyLive(etf, sectors));
      if (!model.frames.length) throw new Error("keine Punkte");
      const want = model.frames.findIndex((i) => model.dates[i] === "2026-11-04");
      state.frame = want >= 0 ? want : Math.floor((model.frames.length - 1) / 2);
      render(model, season);
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Das Sektor-Rad konnte nicht berechnet werden.</p>`;
    }
  }
  start();
})();
