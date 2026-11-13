(() => {
  "use strict";
  const W = 1080;
  const H = 1920;
  let fontsReady = null;

  function loadFonts() {
    if (fontsReady) return fontsReady;
    const faces = [
      ["Be Vietnam Pro", "assets/fonts/BeVietnamPro-Light.ttf", "300"],
      ["Be Vietnam Pro", "assets/fonts/BeVietnamPro-SemiBold.ttf", "600"],
      ["Be Vietnam Pro", "assets/fonts/BeVietnamPro-ExtraBold.ttf", "800"],
      ["Barlow Condensed", "assets/fonts/BarlowCondensed-Black.ttf", "900"],
    ];
    fontsReady = Promise.all(faces.map(([family, url, weight]) => {
      const face = new FontFace(family, `url(${url})`, { weight });
      return face.load().then((loaded) => document.fonts.add(loaded));
    }));
    return fontsReady;
  }
  loadFonts().catch(() => {});

  function fit(ctx, text, max) {
    let value = String(text || "");
    if (ctx.measureText(value).width <= max) return value;
    while (value.length > 1 && ctx.measureText(`${value}…`).width > max) value = value.slice(0, -1);
    return `${value}…`;
  }

  function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  async function draw(spec) {
    await loadFonts();
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#15171a");
    bg.addColorStop(1, "#1d2025");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(128,240,0,0.06)";
    ctx.beginPath();
    ctx.arc(180, 80, 280, 0, Math.PI * 2);
    ctx.fill();

    const logo = new Image();
    logo.src = "assets/logo_T_white.png";
    await logo.decode().catch(() => {});
    if (logo.width) ctx.drawImage(logo, 72, 72, 280, 90);

    ctx.fillStyle = "#eceff1";
    ctx.font = "800 54px 'Be Vietnam Pro', sans-serif";
    ctx.fillText(fit(ctx, spec.title || "MTS", 620), 380, 118);
    ctx.fillStyle = "#9aa3ad";
    ctx.font = "300 32px 'Be Vietnam Pro', sans-serif";
    ctx.fillText(fit(ctx, spec.subtitle || "", 620), 380, 164);

    if (spec.kind === "sectors") drawSectors(ctx, spec);
    else if (spec.kind === "topflop") drawTopFlop(ctx, spec);
    else if (spec.kind === "heatmap") drawHeat(ctx, spec);
    else if (spec.kind === "compare") drawCompare(ctx, spec);
    else if (spec.kind === "week") drawWeek(ctx, spec);
    else if (spec.kind === "rad") drawRad(ctx, spec);

    ctx.fillStyle = "#6e7680";
    ctx.font = "600 28px 'Be Vietnam Pro', sans-serif";
    ctx.fillText("Keine Anlageberatung.", 72, 1848);
    return canvas;
  }

  function drawSectors(ctx, spec) {
    const tiles = spec.tiles || [];
    const cols = 2;
    const gap = 18;
    const x0 = 72;
    const y0 = 240;
    const width = (W - 144 - gap) / cols;
    const height = 210;
    tiles.slice(0, 12).forEach((tile, i) => {
      const x = x0 + (i % cols) * (width + gap);
      const y = y0 + Math.floor(i / cols) * (height + gap);
      rounded(ctx, x, y, width, height, 22);
      ctx.fillStyle = "#262a30";
      ctx.fill();
      ctx.fillStyle = tile.color || "#9aa3ad";
      ctx.fillRect(x, y, 10, height);
      ctx.fillStyle = "#eceff1";
      ctx.font = "800 36px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(fit(ctx, tile.name, width - 48), x + 32, y + 70);
      ctx.font = "900 72px 'Barlow Condensed', sans-serif";
      ctx.fillStyle = tile.color || "#eceff1";
      ctx.fillText(tile.pct || "–", x + 32, y + 155);
    });
  }

  function drawTopFlop(ctx, spec) {
    const colW = (W - 144 - 24) / 2;
    ["Top", "Flop"].forEach((title, col) => {
      const x = 72 + col * (colW + 24);
      ctx.fillStyle = col === 0 ? "#2cff8a" : "#ff3b5c";
      ctx.font = "800 40px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(title, x, 280);
      const rows = (col === 0 ? spec.top : spec.flop) || [];
      rows.slice(0, 10).forEach((row, i) => {
        const y = 320 + i * 140;
        rounded(ctx, x, y, colW, 124, 18);
        ctx.fillStyle = "#262a30";
        ctx.fill();
        const name = row.n && row.n !== row.t ? row.n : row.t;
        ctx.fillStyle = "#eceff1";
        ctx.font = "800 34px 'Be Vietnam Pro', sans-serif";
        ctx.fillText(fit(ctx, name, colW - 40), x + 20, y + 48);
        ctx.fillStyle = "#9aa3ad";
        ctx.font = "600 24px 'Be Vietnam Pro', sans-serif";
        ctx.fillText(fit(ctx, name === row.t ? "" : row.t, colW - 40), x + 20, y + 82);
        ctx.fillStyle = row.color || "#eceff1";
        ctx.font = "900 36px 'Barlow Condensed', sans-serif";
        ctx.fillText(row.pct || "–", x + 20, y + 114);
      });
    });
  }

  function drawHeat(ctx, spec) {
    const area = { x: 64, y: 230, w: W - 128, h: 1540 };
    (spec.tiles || []).forEach((tile) => {
      const x = area.x + tile.x * area.w;
      const y = area.y + tile.y * area.h;
      const w = Math.max(0, tile.w * area.w - 6);
      const h = Math.max(0, tile.h * area.h - 6);
      if (w < 4 || h < 4) return;
      rounded(ctx, x, y, w, h, 10);
      ctx.fillStyle = tile.color || "#262a30";
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (w < 64 || h < 36) return;
      const name = tile.n && tile.n !== tile.t ? tile.n : tile.t;
      ctx.fillStyle = "#15171a";
      ctx.font = "800 28px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(fit(ctx, name, w - 16), x + 8, y + 30);
      let next = 54;
      if (h > 68 && name !== tile.t) {
        ctx.font = "600 20px 'Be Vietnam Pro', sans-serif";
        ctx.fillText(fit(ctx, tile.t, w - 16), x + 8, next);
        next += 26;
      }
      if (h > next) {
        ctx.font = "900 26px 'Barlow Condensed', sans-serif";
        ctx.fillText(fit(ctx, tile.pct, w - 16), x + 8, next);
      }
    });
  }

  function drawCompare(ctx, spec) {
    const cards = (spec.cards || []).slice(0, 7);
    const n = Math.max(cards.length, 1);
    const top = 210;
    const bottom = 1810;
    const gap = 10;
    const height = Math.floor((bottom - top - gap * (n - 1)) / n);
    cards.forEach((card, i) => {
      const y = top + i * (height + gap);
      rounded(ctx, 72, y, W - 144, height, 18);
      ctx.fillStyle = "#262a30";
      ctx.fill();
      ctx.fillStyle = "#9aa3ad";
      ctx.font = "600 22px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(fit(ctx, `${card.name} · ${card.market || ""}`, 900), 96, y + 32);
      ctx.fillStyle = "#eceff1";
      ctx.font = "900 42px 'Barlow Condensed', sans-serif";
      ctx.fillText(fit(ctx, card.level || "–", 520), 96, y + 78);
      ctx.fillStyle = card.color || "#eceff1";
      ctx.font = "900 34px 'Barlow Condensed', sans-serif";
      ctx.fillText(card.pct || "–", 700, y + 78);
      ctx.fillStyle = "#eceff1";
      ctx.font = "600 22px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(fit(ctx, card.baro || "", 900), 96, y + 112);
      ctx.fillStyle = "#9aa3ad";
      ctx.font = "300 20px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(fit(ctx, card.detail || "", 900), 96, y + 142);
      if (height > 160) ctx.fillText(fit(ctx, card.session || "", 900), 96, y + 168);
    });
  }

  function drawWeek(ctx, spec) {
    ctx.fillStyle = "#9aa3ad";
    ctx.font = "600 30px 'Be Vietnam Pro', sans-serif";
    ctx.fillText(fit(ctx, spec.range || "", 930), 72, 250);
    ctx.fillStyle = "#eceff1";
    ctx.font = "800 40px 'Be Vietnam Pro', sans-serif";
    ctx.fillText("Index", 72, 320);
    ctx.fillStyle = spec.indexColor || "#eceff1";
    ctx.font = "900 72px 'Barlow Condensed', sans-serif";
    ctx.fillText(spec.indexPct || "–", 280, 330);
    (spec.rows || []).slice(0, 11).forEach((row, i) => {
      const y = 380 + i * 122;
      rounded(ctx, 72, y, W - 144, 108, 18);
      ctx.fillStyle = "#262a30";
      ctx.fill();
      ctx.fillStyle = row.mark === "best" ? "#2cff8a" : row.mark === "worst" ? "#ff3b5c" : "#9aa3ad";
      ctx.fillRect(72, y, 10, 108);
      ctx.fillStyle = "#eceff1";
      ctx.font = "800 34px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(fit(ctx, row.name, 620), 104, y + 64);
      ctx.fillStyle = row.color || "#eceff1";
      ctx.font = "900 40px 'Barlow Condensed', sans-serif";
      ctx.fillText(row.pct || "–", 760, y + 66);
    });
  }

  function drawRad(ctx, spec) {
    const cx = W / 2;
    const cy = 980;
    const R = 620;
    const rings = [
      ["#2ec8c4", Math.PI, Math.PI * 1.5],
      ["#3ddc6a", Math.PI * 1.5, Math.PI * 2],
      ["#f0c14a", 0, Math.PI * 0.5],
      ["#ff4b5c", Math.PI * 0.5, Math.PI],
    ];
    ctx.lineWidth = 46;
    rings.forEach(([color, a0, a1]) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.arc(cx, cy, R, a0, a1);
      ctx.stroke();
    });
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.font = "700 28px 'Be Vietnam Pro', sans-serif";
    ctx.fillStyle = "#d7dde3";
    ctx.fillText("Erholt sich", 120, cy - R + 20);
    ctx.fillText("Führend", W - 360, cy - R + 20);
    ctx.fillText("Schwächelt", W - 360, cy + R + 10);
    ctx.fillText("Hinkt hinterher", 120, cy + R + 10);
    (spec.points || []).forEach((pt) => {
      const tail = pt.tail || [];
      if (tail.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = pt.color || "#eceff1";
        ctx.lineWidth = 4;
        tail.forEach((p, i) => {
          const x = cx + p[0] * R;
          const y = cy - p[1] * R;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      const x = cx + pt.x * R;
      const y = cy - pt.y * R;
      ctx.beginPath();
      ctx.fillStyle = "#f4f7f8";
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = pt.color || "#eceff1";
      ctx.stroke();
      ctx.fillStyle = "#f4f7f8";
      ctx.font = "800 28px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(pt.t || "", x + 22, y - 18);
    });
    ctx.fillStyle = "#9aa3ad";
    ctx.font = "300 26px 'Be Vietnam Pro', sans-serif";
    ctx.fillText(fit(ctx, spec.foot || "", 940), 72, 1760);
  }

  async function saveCard(spec) {
    const canvas = await draw(spec);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("png");
    const name = spec.filename || "mts.png";
    const file = new File([blob], name, { type: "image/png" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: spec.title || "MTS" });
        return "share";
      } catch (err) {
        if (err && err.name === "AbortError") return "cancel";
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "download";
  }

  window.MTS.saveCard = saveCard;
  window.MTS.drawCard = draw;
})();
