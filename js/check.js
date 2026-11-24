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
      if (day) out.push(`Zahlen am ${day}`);
    }
    const newsN = (row.news || []).filter((n) => n && n.h && n.recent).length;
    if (newsN) out.push(`${newsN} News diese Woche`);
    const info = row.insider;
    if (info && info.source) {
      if (info.zukauf) out.push("Insider-Käufe");
      if (info.abgabe) out.push("Insider-Verkäufe");
    }
    if (!out.length) out.push("keine Angaben");
    return out;
  }

  function detailsHtml(stand, cards) {
    return `
      <div class="check-heading">
        <div class="check-heading-copy">
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
  }

  function bindInfo() {
    const btn = el.querySelector(".check-info-btn");
    const panel = el.querySelector(".check-info");
    if (!btn || !panel) return;
    btn.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function notifyLayout() {
    document.dispatchEvent(new CustomEvent("mts-top5"));
  }

  function render(doc) {
    const items = doc && Array.isArray(doc.items) ? doc.items : [];
    if (items.length !== 5) {
      el.hidden = true;
      el.innerHTML = "";
      el.classList.remove("is-open");
      notifyLayout();
      return;
    }
    el.hidden = false;
    const stand = standLine(doc.session_date);
    const cards = items.map((row) => {
      const name = escapeHtml(row.n || row.t);
      const ix = (row.ix || []).map((id) => indexName(id)).filter(Boolean).join(", ");
      const meta = [row.s, ix].filter(Boolean).join(" · ");
      const flagHtml = badges(row)
        .map((f) => `<span class="check-flag${f === "keine Angaben" ? " is-empty" : ""}">${escapeHtml(f)}</span>`)
        .join("");
      const px = row.p == null ? "" : money(row.p, row.ccy);
      return `<a class="check-card" href="aktie.html?t=${encodeURIComponent(row.t)}">
        <div class="check-top">
          <span class="check-ticker">${escapeHtml(row.t)}</span>
          <span class="check-pct ${row.c >= 0 ? "is-up" : "is-down"}">${dePct(row.c)}</span>
        </div>
        <strong class="check-name">${name}</strong>
        ${meta ? `<span class="check-meta">${escapeHtml(meta)}</span>` : ""}
        ${px ? `<p class="check-px">${escapeHtml(px)}</p>` : ""}
        <div class="check-flags">${flagHtml}</div>
      </a>`;
    }).join("");
    const details = detailsHtml(stand, cards);
    const onScanner = !!document.querySelector(".page.is-scanner");
    if (onScanner) {
      el.classList.remove("is-open");
      el.innerHTML = `
        <button type="button" class="check-toggle" aria-expanded="false" aria-controls="check-body">
          <span class="check-toggle-accent" aria-hidden="true"></span>
          <span class="check-toggle-copy">
            <span class="check-toggle-title">Top 5 des Tages</span>
            <span class="check-toggle-hint">Antippen zum Anzeigen</span>
          </span>
          <span class="check-chevron" aria-hidden="true"></span>
        </button>
        <div class="check-body" id="check-body" hidden>${details}</div>`;
      const dupHeading = el.querySelector(".check-body h2");
      if (dupHeading) dupHeading.classList.add("visually-hidden");
      const toggle = el.querySelector(".check-toggle");
      const body = el.querySelector(".check-body");
      const hint = el.querySelector(".check-toggle-hint");
      if (toggle && body) {
        toggle.addEventListener("click", () => {
          const open = body.hidden;
          body.hidden = !open;
          el.classList.toggle("is-open", open);
          toggle.setAttribute("aria-expanded", open ? "true" : "false");
          if (hint) hint.textContent = open ? "Antippen zum Einklappen" : "Antippen zum Anzeigen";
          notifyLayout();
        });
      }
    } else {
      el.classList.remove("is-open");
      el.innerHTML = details;
    }
    bindInfo();
    notifyLayout();
  }

  loadJSON("data/top5.json").then(render).catch(() => {
    el.hidden = true;
    el.innerHTML = "";
    el.classList.remove("is-open");
    notifyLayout();
  });
})();
