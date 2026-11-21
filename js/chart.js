(() => {
  "use strict";
  const params = new URLSearchParams(location.search);
  const sym = (params.get("sym") || params.get("symbol") || "").trim();
  const ticker = (params.get("t") || "").trim();
  const fallback = "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(sym || ticker);
  const backTo = ticker ? "aktie.html?t=" + encodeURIComponent(ticker) : "scanner.html";

  const title = document.getElementById("chart-title");
  const sub = document.getElementById("chart-sym");
  const fb = document.getElementById("tv-fallback");
  const wrap = document.getElementById("tv-wrap");
  if (title) title.textContent = ticker || sym || "Chart";
  if (sub) sub.textContent = sym && sym !== ticker ? sym : "";
  if (fb) fb.href = fallback;
  document.title = `${ticker || sym || "Chart"} · MTS`;

  document.getElementById("chart-back").addEventListener("click", () => {
    if (history.length > 1) history.back();
    else location.href = backTo;
  });

  function fail() {
    if (!wrap) return;
    wrap.innerHTML = `<p class="error">Der Chart konnte hier nicht geladen werden.</p>
      <p><a class="chip" href="${fallback.replace(/"/g, "")}" target="_blank" rel="noopener noreferrer">In TradingView öffnen <span class="ext-mark" aria-label="externer Link">↗</span></a></p>`;
  }

  if (!sym) {
    fail();
    const err = wrap && wrap.querySelector(".error");
    if (err) err.textContent = "Kein Symbol angegeben.";
    return;
  }

  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/tv.js";
  script.async = true;
  script.onload = () => {
    if (!window.TradingView || !window.TradingView.widget) {
      fail();
      return;
    }
    // eslint-disable-next-line no-new
    new window.TradingView.widget({
      autosize: true,
      symbol: sym,
      interval: "D",
      timezone: "Europe/Berlin",
      theme: "dark",
      style: "1",
      locale: "de",
      hide_side_toolbar: true,
      allow_symbol_change: false,
      withdateranges: true,
      enable_publishing: false,
      hide_legend: false,
      save_image: false,
      container_id: "tv-chart",
    });
  };
  script.onerror = fail;
  document.body.appendChild(script);
})();
