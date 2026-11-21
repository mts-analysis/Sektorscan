(() => {
  "use strict";
  const el = document.getElementById("top5-check");
  if (!el || !window.MTS) return;
  const { escapeHtml, dePct, loadJSON, indexName, money } = window.MTS;
  const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

  function deDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${m[3]}.${m[2]}.` : "";
  }

  function standLine(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    if (!m) return "";
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return `Stand: Schluss vom ${WEEKDAYS[d.getUTCDay()]} ${m[3]}.${m[2]}.`;
  }

  function badges(row) {
    const out = [];
    const earn = row.earnings;
    if (earn && earn.d) {
      const day = deDay(earn.d);
      if (day) out.push(`📅 Zahlen am ${day}`);
    }
    const newsN = (row.news || []).filter((n) => n && n.h && n.recent).length;
    if (newsN) out.push(`📰 ${newsN} News diese Woche`);
    const info = row.insider;
    if (info && info.source) {
      if (info.zukauf) out.push("👤 Insider-Käufe");
      if (info.abgabe) out.push("👤 Insider-Verkäufe");
    }
    if (!out.length) out.push("keine Angaben");
    return out;
  }

  function render(doc) {
    const items = doc && Array.isArray(doc.items) ? doc.items : [];
    if (items.length !== 5) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    const stand = standLine(doc.session_date);
    const cards = items.map((row) => {
      const name = escapeHtml(row.n || row.t);
      const ix = (row.ix || []).map((id) => indexName(id)).join(" · ");
      const flagHtml = badges(row)
        .map((f) => `<span class="check-flag${f === "keine Angaben" ? " is-empty" : ""}">${escapeHtml(f)}</span>`)
        .join("");
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
        <div class="check-flags">${flagHtml}</div>
      </a>`;
    }).join("");
    el.innerHTML = `
      <div class="check-heading">
        <div>
          <h2>Top 5 des Tages</h2>
          <p class="check-sub">Die stärksten Aktien aus allen Indizes</p>
          ${stand ? `<p class="check-stand">${escapeHtml(stand)}</p>` : ""}
        </div>
        <button type="button" class="check-info-btn" aria-expanded="false" aria-controls="check-info" aria-label="Erklärung zur Top 5">ⓘ</button>
      </div>
      <div class="check-info" id="check-info" hidden>
        <p>Aus allen Indizes im Scanner die fünf Aktien mit dem größten Tagesplus. Zu jeder prüfe ich: Quartalszahlen in den nächsten 14 Tagen, auffällige News der letzten 7 Tage und Insider-Geschäfte der letzten 90 Tage.</p>
      </div>
      <div class="check-list">${cards}</div>
      <p class="note check-legal">Keine Anlageberatung. Auffälligkeiten sind keine Prognose.</p>`;

    const btn = el.querySelector(".check-info-btn");
    const panel = el.querySelector(".check-info");
    if (btn && panel) {
      btn.addEventListener("click", () => {
        const open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
  }

  loadJSON("data/top5.json").then(render).catch(() => {
    el.hidden = true;
    el.innerHTML = "";
  });
})();
