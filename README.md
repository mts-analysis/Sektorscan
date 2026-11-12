# MTS Sektor-Scanner

Kostenlose, statische Web-App für den TikTok-Kanal **MTS** (@markt.trends.sektoren):
Sektor-Übersicht, Aktien-Scanner und Top/Flop mit Wiederholer
für S&P 500, DAX 40, KOSPI 200, Nikkei 225 und FTSE 100.

**Keine Anlageberatung.** Es gibt keine Signale und keine Prognosen.
Die Kurse kommen von Yahoo Finance und sind typischerweise **ca. 15 Minuten verzögert**.

Live (nach dem Einrichten von GitHub Pages):
[https://mts-analysis.github.io/Sektorscan/](https://mts-analysis.github.io/Sektorscan/)

## Pages einrichten (einmalig)

Dieses Repo ist eine fertige Website im Stammverzeichnis, ohne Build-Schritt.

1. Auf GitHub unter **Settings → Pages → Build and deployment**:
   **Source** = *Deploy from a branch*, **Branch** = `main`, **Folder** = `/ (root)`.
2. Speichern. Nach ein bis zwei Minuten ist die Seite unter
   `https://mts-analysis.github.io/Sektorscan/` erreichbar.
3. Unter **Settings → Actions → General** Workflows erlauben
   (die Action braucht Schreibrechte für den Daten-Commit;
   im Workflow ist `permissions: contents: write` gesetzt).

Eine GitHub Action aktualisiert `data/sectors.json` und `data/stocks.json`
etwa alle 15 Minuten von 00:00 bis 21:00 UTC (Mo–Fr), damit Tokio/Seoul,
London/Frankfurt und die US-Sitzung abgedeckt sind, und nur, wenn sich die
Dateien geändert haben. Zusätzlich lässt sie sich unter **Actions → Kurse
aktualisieren** manuell starten (*Run workflow*).

Ein zweiter Lauf, **Historie und Earnings**, startet einmal werktags um
07:15 UTC. Er schreibt die 1-Jahres-Schlüsse nach `data/history/`, die
5- und 20-Tage-Änderungen nach `data/history/returns.json` und die
nächsten Yahoo-Termine nach `data/earnings.json`. Der 15-Minuten-Lauf fasst
diese Dateien nicht an.

## Wiederholer und Earnings

Der **Wiederholer-Zähler** (seit 06.11.2026) kommt aus einer Momentaufnahme
von `data/ref/history.json` und gilt nur für den S&P 500. Die Action
aktualisiert diese Datei nicht. Damit der Zähler weiterläuft, muss die Datei
gelegentlich aus der MTS-Pipeline (`output/sp500_topflop/history.json`)
hierher kopiert werden.

**Earnings diese Woche** liest `data/ref/earnings_week/` (geprüfte ISO-Wochenliste,
nur US-Ticker). Neue Wochen müssen ebenfalls von Hand ergänzt werden.
Die Titellisten liegen unter `data/ref/` (`sp500_constituents.csv`,
`dax40_constituents.csv`, `kospi200_constituents.csv`,
`nikkei225_constituents.csv`, `ftse100_constituents.csv`). Kurse stehen in
der Landeswährung, der Börsenwert-Filter in USD.

## Lokal starten

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python update.py
python3 -m http.server 8765
```

Danach im Browser: [http://127.0.0.1:8765/](http://127.0.0.1:8765/).
Die Oberfläche liest nur die lokalen JSON-Dateien (kein API-Schlüssel).
