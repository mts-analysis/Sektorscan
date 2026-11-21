(() => {
  "use strict";
  const el = document.getElementById("top5-check");
  if (!el || !window.MTS) return;
  const { escapeHtml, dePct, loadJSON, indexName, money } = window.MTS;

  function deDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
  }

  function insiderLine(info) {
    if (!info || !info.source) return "Insider-Transaktionen: k. A.";
    if (!(info.zukauf || info.abgabe)) {
      return `Insider-Transaktionen: keine in ${info.window_days || 90} Tagen`;
    }
    const bits = [];
    if (info.zukauf) bits.push(`Zukauf ${info.zukauf}`);
    if (info.abgabe) bits.push(`Abgabe ${info.abgabe}`);
    const when = info.last ? ` · zuletzt ${deDate(info.last)}` : "";
    return `Insider-Transaktionen: ${bits.join(", ")}${when}`;
  }

  function newsLine(items) {
    const rows = (items || []).filter((n) => n && n.h && n.recent);
    if (!rows.length) return "Meldungen: k. A.";
    const first = rows[0];
    const day = first.d ? ` · ${deDate(first.d)}` : "";
    return `Meldung: ${first.h}${day}`;
  }

  function earnLine(earn) {
    if (!earn || !earn.d) return "Nächster Termin (14 Tage): k. A.";
    const extra = earn.kind === "estimate" || earn.kind === "unconfirmed"
      ? (earn.kind === "unconfirmed" ? " · unbestätigt" : " · geschätzt")
      : "";
    return `Nächster Termin: ${deDate(earn.d)}${extra}`;
  }

  function render(doc) {
    const items = doc && Array.isArray(doc.items) ? doc.items : [];
    if (items.length !== 5) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    const session = deDate(doc.session_date) || "";
    const cards = items.map((row) => {
      const name = escapeHtml(row.n || row.t);
      const ix = (row.ix || []).map((id) => indexName(id)).join(" · ");
      const flags = (row.flags || []).map((f) => `<span class="check-flag">${escapeHtml(f)}</span>`).join("");
      const px = row.p == null ? "" : money(row.p, row.ccy);
      return `<a class="check-card" href="aktie.html?t=${encodeURIComponent(row.t)}">
        <div class="check-head">
          <div>
            <strong>${name}</strong>
            <span class="kicker">${escapeHtml(row.t)}${row.s ? " · " + escapeHtml(row.s) : ""}${ix ? " · " + escapeHtml(ix) : ""}</span>
          </div>
          <span class="check-pct ${row.c >= 0 ? "is-up" : "is-down"}">${dePct(row.c)}</span>
        </div>
        ${px ? `<p class="check-px">${escapeHtml(px)}</p>` : ""}
        ${flags ? `<div class="check-flags">${flags}</div>` : ""}
        <p class="check-meta">${escapeHtml(newsLine(row.news))}</p>
        <p class="check-meta">${escapeHtml(earnLine(row.earnings))}</p>
        <p class="check-meta">${escapeHtml(insiderLine(row.insider))}</p>
      </a>`;
    }).join("");
    el.innerHTML = `
      <div class="section-head">
        <h2>Top 5 im Check</h2>
        <p>Stärkste Tagesänderung über alle Indizes${session ? " · " + session : ""}</p>
      </div>
      <div class="check-list">${cards}</div>
      <p class="note">Keine Anlageberatung. Keine Prognose. Hinweise sind keine Bewertung.</p>`;
  }

  loadJSON("data/top5.json").then(render).catch(() => {
    el.hidden = true;
    el.innerHTML = "";
  });
})();
