(() => {
  "use strict";
  const { $, dePct, escapeHtml, loadJSON } = window.MTS;
  const ORDER = ["XLK", "XLV", "XLF", "XLY", "XLP", "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC"];
  const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

  function cell(block) {
    if (!block) return "<td class='muted'>–</td>";
    const hot = block.excess > 0;
    return `<td class="heat-cell" style="background:${hot ? "rgba(44,255,138,0.28)" : "rgba(255,59,92,0.28)"}">
      <strong>${dePct(block.excess)}</strong>
      <span>${block.beat}/${block.n}</span>
    </td>`;
  }

  function render(doc) {
    const month = new Date().getMonth() + 1;
    const quarter = Math.floor((month - 1) / 3) + 1;
    const head = ORDER.map((t) => `<th>${escapeHtml(t)}<br>${escapeHtml(doc.sectors[t].name)}</th>`).join("");
    const rows = MONTHS.map((label, i) => {
      const m = String(i + 1);
      const on = i + 1 === month ? " is-now" : "";
      return `<tr class="${on.trim()}"><th>${label}</th>${ORDER.map((t) => cell(doc.sectors[t].months[m])).join("")}</tr>`;
    }).join("");
    const qrows = [1, 2, 3, 4].map((q) => {
      const on = q === quarter ? " is-now" : "";
      return `<tr class="${on.trim()}"><th>Q${q}</th>${ORDER.map((t) => cell(doc.sectors[t].quarters[String(q)])).join("")}</tr>`;
    }).join("");
    $("#app").innerHTML = `
      <p class="kicker">Saison-Statistik · Sektor vs. S&amp;P 500</p>
      <p class="note">Durchschnitt der Monats- und Quartalsrendite gegen SPY, Jahre bis ${doc.through_year}. Jede Zelle: Ø Differenz und wie oft der Sektor stärker war. ${escapeHtml(doc.note)} Keine Anlageberatung.</p>
      <h2>Monate</h2>
      <div class="season-scroll"><table class="season">
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <h2>Quartale</h2>
      <div class="season-scroll"><table class="season">
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>${qrows}</tbody>
      </table></div>
      <p class="note"><a href="rad.html">Zum Sektor-Rad</a></p>`;
  }

  async function start() {
    try {
      const doc = await loadJSON("data/seasonality.json");
      render(doc);
    } catch (err) {
      console.error(err);
      $("#app").innerHTML = `<p class="error">Die Saison-Statistik liegt gerade nicht vor.</p>`;
    }
  }
  start();
})();
