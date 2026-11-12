#!/usr/bin/env python3
"""Build compact data/stocks.json for the Aktien-Scanner and Top/Flop views.

Uses yfinance for a bulk OHLCV download (Close/High/Low/Volume), fills missing
session closes like the S&P Top/Flop pipeline (Yahoo chart bar / regularMarketPrice /
fulldayPrice), and reads history.json and earnings_week files read-only.
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
REF = ROOT / "data" / "ref"
OUT = ROOT / "data" / "stocks.json"
CONSTITUENTS = REF / "sp500_constituents.csv"
HISTORY = REF / "history.json"
EARNINGS_DIR = REF / "earnings_week"
ET = ZoneInfo("America/New_York")
UA = "Mozilla/5.0 (compatible; MTS-Sektor-Scanner/1.0; research use)"

SECTOR_MAP = {
    "Information Technology": ("XLK", "Technologie"),
    "Consumer Discretionary": ("XLY", "Zyklischer Konsum"),
    "Communication Services": ("XLC", "Kommunikation"),
    "Financials": ("XLF", "Finanzen"),
    "Health Care": ("XLV", "Gesundheit"),
    "Industrials": ("XLI", "Industrie"),
    "Energy": ("XLE", "Energie"),
    "Materials": ("XLB", "Grundstoffe"),
    "Utilities": ("XLU", "Versorger"),
    "Real Estate": ("XLRE", "Immobilien"),
    "Consumer Staples": ("XLP", "Basiskonsum"),
}

# Börsenwert-Schwellen in USD (gängig, aber nicht offiziell S&P):
# groß >= 10 Mrd., mittel 2–10 Mrd., klein < 2 Mrd.
MC_LARGE = 10_000_000_000
MC_MID = 2_000_000_000
SPARK_N = 30


def to_yahoo(sym: str) -> str:
    return sym.replace(".", "-")


def ny_date(ts: float | int) -> str:
    return datetime.fromtimestamp(int(ts), timezone.utc).astimezone(ET).strftime("%Y-%m-%d")


def http_json(url: str, timeout: int = 25) -> dict:
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def chart_session_close(sym: str, session: str, retries: int = 4):
    """Same fill order as output/sp500_topflop/fetch_and_build.py: bar close, then regularMarketPrice, then fulldayPrice (only if regularMarketTime is on the session)."""
    delay = 1.5
    for attempt in range(retries):
        host = "query1" if attempt % 2 == 0 else "query2"
        url = f"https://{host}.finance.yahoo.com/v8/finance/chart/{quote(sym, safe='')}?interval=1d&range=15d"
        try:
            data = http_json(url)
            result = (data.get("chart") or {}).get("result") or []
            if not result:
                return None, None
            r0 = result[0]
            meta = r0.get("meta") or {}
            ts_list = r0.get("timestamp") or []
            closes = ((r0.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
            for t, c in zip(ts_list, closes):
                if c is None:
                    continue
                if ny_date(t) == session:
                    return float(c), "bar_close"
            rmt, rmp = meta.get("regularMarketTime"), meta.get("regularMarketPrice")
            time_ok = rmt is not None and ny_date(rmt) == session
            if time_ok and rmp is not None:
                return float(rmp), "regularMarketPrice"
            fp = meta.get("fulldayPrice")
            if time_ok and fp is not None:
                return float(fp), "fulldayPrice"
            return None, None
        except Exception:
            time.sleep(delay)
            delay = min(delay * 1.6, 20)
    return None, None


class _WikiTable(HTMLParser):
    def __init__(self, want_header: str):
        super().__init__()
        self.want = want_header.lower()
        self.in_table = False
        self.table_i = -1
        self.row = []
        self.cell = ""
        self.capture_cell = False
        self.tables: list[list[list[str]]] = []
        self._cur: list[list[str]] | None = None
        self.in_tr = False

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.table_i += 1
            self._cur = []
            self.in_table = True
        elif self.in_table and tag == "tr":
            self.row = []
            self.in_tr = True
        elif self.in_table and tag in ("td", "th"):
            self.cell = ""
            self.capture_cell = True

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.capture_cell:
            self.row.append(" ".join(self.cell.split()))
            self.capture_cell = False
        elif tag == "tr" and self.in_tr and self._cur is not None:
            if self.row:
                self._cur.append(self.row)
            self.in_tr = False
        elif tag == "table" and self.in_table:
            if self._cur:
                self.tables.append(self._cur)
            self.in_table = False
            self._cur = None

    def handle_data(self, data):
        if self.capture_cell:
            self.cell += data


def _fetch_wiki_html(title: str) -> str:
    url = f"https://en.wikipedia.org/api/rest_v1/page/html/{quote(title)}"
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "replace")


def _symbols_from_wiki(title: str, header_names: tuple[str, ...]) -> list[str]:
    html = _fetch_wiki_html(title)
    p = _WikiTable("")
    p.feed(html)
    header_l = tuple(h.lower() for h in header_names)
    best: list[str] = []
    for table in p.tables:
        if not table:
            continue
        headers = [c.lower() for c in table[0]]
        col = next((i for i, h in enumerate(headers) if any(x in h for x in header_l)), None)
        if col is None:
            continue
        syms = []
        for row in table[1:]:
            if col >= len(row):
                continue
            s = row[col].strip().upper().replace(" ", "")
            if s and 1 <= len(s) <= 6 and s.replace(".", "").replace("-", "").isalnum():
                syms.append(s)
        if len(syms) > len(best):
            best = syms
    return best


def load_index_members() -> tuple[set[str], set[str], str]:
    note_parts = []
    ndx: set[str] = set()
    dow: set[str] = set()
    try:
        ndx = set(_symbols_from_wiki("List_of_NASDAQ-100_companies", ("ticker", "symbol")))
        note_parts.append(f"Nasdaq-100: Wikipedia-Liste, {len(ndx)} Symbole")
    except Exception as e:  # noqa: BLE001
        note_parts.append(f"Nasdaq-100-Liste nicht geladen ({e!r})")
    try:
        dow = set(_symbols_from_wiki("List_of_Dow_Jones_Industrial_Average_companies", ("symbol", "ticker")))
        note_parts.append(f"Dow Jones 30: Wikipedia-Liste, {len(dow)} Symbole")
    except Exception as e:  # noqa: BLE001
        note_parts.append(f"Dow-Jones-Liste nicht geladen ({e!r})")
    return ndx, dow, "; ".join(note_parts)


def load_earnings_week() -> tuple[str | None, set[str], str]:
    """US tickers from the verified file for the current ISO week (Europe/Berlin)."""
    if not EARNINGS_DIR.is_dir():
        return None, set(), "Keine Earnings-Woche im MTS-Datenordner gefunden."
    today = datetime.now(ZoneInfo("Europe/Berlin")).date()
    iso = today.isocalendar()
    week_id = f"{iso.year}-W{iso.week:02d}"
    path = EARNINGS_DIR / f"{week_id}_verified.json"
    if not path.exists():
        # most recent verified file as fallback, still labelled honestly
        files = sorted(EARNINGS_DIR.glob("20*_W*_verified.json"))
        if not files:
            return None, set(), "Keine verified Earnings-Datei gefunden."
        path = files[-1]
        week_id = path.name.replace("_verified.json", "")
        note = f"Aktuelle ISO-Woche hat keine Datei; verwendet {week_id} ({path.name})."
    else:
        note = f"Manuell geprüfte MTS-Liste {week_id}."
    data = json.loads(path.read_text(encoding="utf-8"))
    tickers = set()
    for k in data:
        if k.startswith("_"):
            continue
        # skip non-US suffixes (e.g. HEN3.DE) — the scanner universe is S&P 500
        if "." in k and not k.endswith(".B"):  # BF.B style stays
            # BF.B has a dot but is US; .DE / .PA leave
            suffix = k.rsplit(".", 1)[-1]
            if suffix.isalpha() and len(suffix) >= 2 and suffix != "B":
                continue
        tickers.add(k.replace("-", "."))  # normalize
        tickers.add(k)
    return week_id, tickers, note + f" US-Ticker in der Liste: {sorted(t for t in tickers if '.' not in t or t.endswith('.B'))}."


def wiederholer_counts(hist: dict) -> tuple[int, str, dict[str, int], dict[str, int], dict[str, dict]]:
    days = hist.get("days") or []
    started = (hist.get("meta") or {}).get("started") or "2026-11-06"
    top_c: dict[str, int] = {}
    flop_c: dict[str, int] = {}
    meta: dict[str, dict] = {}
    for d in days:
        for e in d.get("entries") or []:
            t = e["ticker"]
            meta[t] = {"n": e.get("name"), "s": e.get("sector")}
            if e.get("side") == "top":
                top_c[t] = top_c.get(t, 0) + 1
            elif e.get("side") == "flop":
                flop_c[t] = flop_c.get(t, 0) + 1
    return len(days), started, top_c, flop_c, meta


def downsample(vals: list[float], n: int) -> list[float]:
    vals = [float(v) for v in vals if v is not None]
    if len(vals) <= n:
        return [round(v, 2) for v in vals]
    out = [vals[int(round(i * (len(vals) - 1) / (n - 1)))] for i in range(n)]
    out[-1] = vals[-1]
    return [round(v, 2) for v in out]



def format_stand(ts: int) -> dict:
    utc = datetime.fromtimestamp(ts, timezone.utc)
    et = utc.astimezone(ET)
    mez = utc.astimezone(ZoneInfo("Europe/Berlin"))
    mez_label = "MESZ" if mez.dst() else "MEZ"
    return {
        "unix": ts,
        "iso_utc": utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "et": et.strftime("%d.%m.%Y, %H:%M") + " ET",
        "mez": mez.strftime("%d.%m.%Y, %H:%M") + f" {mez_label}",
        "label": f"{et.strftime('%d.%m.%Y, %H:%M')} ET / {mez.strftime('%H:%M')} {mez_label}",
    }


def bucket_mc(mc: float | None) -> str | None:
    if mc is None:
        return None
    if mc >= MC_LARGE:
        return "gross"
    if mc >= MC_MID:
        return "mittel"
    return "klein"


def fetch_market_caps(yf_tickers: list[str], budget_s: float = 90.0) -> tuple[dict[str, float], str]:
    try:
        import yfinance as yf
    except ImportError:
        return {}, "Börsenwert nicht ermittelt (yfinance fehlt)."

    caps: dict[str, float] = {}
    t0 = time.time()

    def one(t: str):
        try:
            cap = yf.Ticker(t).fast_info.get("marketCap") or yf.Ticker(t).fast_info.get("market_cap")
            if cap is None:
                return t, None
            return t, float(cap)
        except Exception:
            return t, None

    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(one, t) for t in yf_tickers]
        for fut in as_completed(futs):
            if time.time() - t0 > budget_s:
                break
            t, cap = fut.result()
            done += 1
            if cap:
                caps[t] = cap
    note = (
        f"Yahoo fast_info marketCap für {len(caps)} von {len(yf_tickers)} Titeln "
        f"in {time.time()-t0:.0f}s. Schwellen: groß ≥ 10 Mrd. USD, mittel 2–10 Mrd., klein < 2 Mrd. "
        "(keine offizielle S&P-Größenklasse)."
    )
    if len(caps) < len(yf_tickers):
        note += " Fehlende Werte gelten im Filter als nicht verfügbar."
    return caps, note


def update_stocks() -> int:
    try:
        import numpy as np
        import pandas as pd
        import yfinance as yf
    except ImportError as e:
        print(f"stocks.json übersprungen: yfinance/pandas nicht verfügbar ({e}).", file=sys.stderr)
        print("Hinweis: pip install -r requirements.txt && python update.py", file=sys.stderr)
        return 1

    if not CONSTITUENTS.exists():
        print(f"Constituents fehlen: {CONSTITUENTS}", file=sys.stderr)
        return 1

    cons = pd.read_csv(CONSTITUENTS)
    cons["yf"] = cons["Symbol"].map(to_yahoo)
    stock_yf = cons["yf"].tolist()
    extras = ["SPY", "^GSPC"]
    all_tickers = extras + stock_yf

    today_utc = datetime.now(timezone.utc).date()
    start = (today_utc - timedelta(days=400)).isoformat()
    end = (today_utc + timedelta(days=1)).isoformat()
    print(f"yfinance: {len(all_tickers)} Titel {start}..{end}", flush=True)
    raw = yf.download(
        all_tickers,
        start=start,
        end=end,
        auto_adjust=False,
        group_by="ticker",
        threads=True,
        progress=False,
    )

    def field(ticker: str, col: str) -> pd.Series | None:
        try:
            if isinstance(raw.columns, pd.MultiIndex):
                if ticker not in raw.columns.get_level_values(0):
                    return None
                s = raw[ticker][col]
            else:
                s = raw[col]
            s = s.copy()
            s.index = pd.to_datetime(s.index).tz_localize(None).strftime("%Y-%m-%d")
            return s
        except Exception:
            return None

    close_df = pd.DataFrame({t: field(t, "Close") for t in all_tickers if field(t, "Close") is not None})
    high_df = pd.DataFrame({t: field(t, "High") for t in all_tickers if field(t, "High") is not None})
    low_df = pd.DataFrame({t: field(t, "Low") for t in all_tickers if field(t, "Low") is not None})
    vol_df = pd.DataFrame({t: field(t, "Volume") for t in all_tickers if field(t, "Volume") is not None})
    close_df = close_df.sort_index()
    print("Tage:", list(close_df.index[-6:]), "Spalten:", close_df.shape, flush=True)

    # last session with enough names (same idea as the pipeline)
    candidates = []
    for d in close_df.index:
        row = close_df.loc[d]
        n_ok = int(row.notna().sum())
        has_idx = pd.notna(row.get("SPY")) or pd.notna(row.get("^GSPC"))
        if has_idx or n_ok >= 50:
            candidates.append(d)
    if len(candidates) < 2:
        print(f"STOP: zu wenige Sitzungen {candidates}", file=sys.stderr)
        return 1
    session, prev = candidates[-1], candidates[-2]
    sess = close_df.loc[session].copy()
    prev_row = close_df.loc[prev].copy()
    need = [t for t in stock_yf if t not in sess.index or pd.isna(sess.get(t))]
    filled_sources: dict[str, str] = {}
    if need:
        print(f"Fülle {len(need)} fehlende Schlusskurse über Yahoo-Chart …", flush=True)

        def _one(t):
            val, src = chart_session_close(t, session)
            return t, val, src

        ok = 0
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = [pool.submit(_one, t) for t in need]
            done = 0
            for fut in as_completed(futs):
                t, val, src = fut.result()
                done += 1
                if val is not None:
                    sess[t] = val
                    filled_sources[t] = src or "chart"
                    ok += 1
                if done % 25 == 0 or done == len(need):
                    print(f"  {done}/{len(need)} gefüllt={ok}", flush=True)
        close_df.loc[session] = sess
        print(f"Gefüllt: {ok}; weiter fehlend: {[t for t in need if t not in filled_sources]}", flush=True)

    ndx, dow, index_note = load_index_members()
    print("Indexlisten:", index_note, "NDX", len(ndx), "DJIA", len(dow), flush=True)
    week_id, earn_set, earn_note = load_earnings_week()
    print("Earnings:", week_id, earn_note, flush=True)

    hist = {"meta": {"started": "2026-11-06"}, "days": []}
    if HISTORY.exists():
        hist = json.loads(HISTORY.read_text(encoding="utf-8"))
    n_days, started, top_c, flop_c, wmeta = wiederholer_counts(hist)

    caps, cap_note = fetch_market_caps(stock_yf)
    print(cap_note, flush=True)

    # stand from ^GSPC
    stand_ts = int(datetime.now(timezone.utc).timestamp())
    try:
        g = http_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{quote('^GSPC')}?interval=1d&range=5d")
        r0 = g["chart"]["result"][0]
        if r0.get("meta", {}).get("regularMarketTime"):
            stand_ts = int(r0["meta"]["regularMarketTime"])
    except Exception:
        pass
    stand = format_stand(stand_ts)

    rows = []
    missing = []
    dates = list(close_df.index)

    def series_upto(df: pd.DataFrame, t: str) -> pd.Series:
        if t not in df.columns:
            return pd.Series(dtype=float)
        return df[t]

    for _, crow in cons.iterrows():
        ticker, yf_t, name, gics = crow["Symbol"], crow["yf"], crow["Security"], crow["GICS Sector"]
        etf, sector = SECTOR_MAP[gics]
        c = sess.get(yf_t) if yf_t in sess.index else None
        p = prev_row.get(yf_t) if yf_t in prev_row.index else None
        if c is None or p is None or (isinstance(c, float) and pd.isna(c)) or (isinstance(p, float) and pd.isna(p)):
            missing.append(ticker)
            continue
        c, p = float(c), float(p)
        pct = (c / p - 1.0) * 100.0

        cl = series_upto(close_df, yf_t).dropna()
        # inject filled close for sparkline / 52w if needed
        if session not in cl.index or pd.isna(cl.get(session)):
            cl.loc[session] = c
            cl = cl.sort_index()
        spark = downsample(cl.tail(SPARK_N).tolist(), SPARK_N)

        hi = series_upto(high_df, yf_t).dropna().tail(252)
        lo = series_upto(low_df, yf_t).dropna().tail(252)
        # include today's close in the range
        h52 = float(max(hi.max(), c)) if len(hi) else c
        l52 = float(min(lo.min(), c)) if len(lo) else c
        d_high = (c / h52 - 1.0) * 100.0 if h52 else None
        d_low = (c / l52 - 1.0) * 100.0 if l52 else None

        rv = None
        vol = series_upto(vol_df, yf_t)
        if len(vol.dropna()) >= 11:
            # last session volume vs previous 20 days (exclude last)
            aligned = vol.reindex(dates).dropna()
            if session in aligned.index:
                today_v = float(aligned.loc[session])
                prev20 = aligned.loc[:session].iloc[:-1].tail(20)
                if today_v > 0 and len(prev20) >= 10 and float(prev20.mean()) > 0:
                    rv = today_v / float(prev20.mean())

        mc = caps.get(yf_t)
        ix = ["SPX"]
        # match wiki symbols to display ticker (BRK.B vs BRK-B)
        if ticker in ndx or yf_t in ndx or ticker.replace(".", "-") in ndx:
            ix.append("NDX")
        if ticker in dow or yf_t in dow or ticker.replace(".", "-") in dow:
            ix.append("DJI")

        ew = 1 if (ticker in earn_set or yf_t in earn_set) else 0

        rows.append({
            "t": ticker,
            "n": name,
            "s": sector,
            "p": round(c, 2),
            "c": round(pct, 2),
            "rv": None if rv is None else round(rv, 2),
            "dH": None if d_high is None else round(d_high, 2),
            "dL": None if d_low is None else round(d_low, 2),
            "mc": None if mc is None else round(mc / 1e9, 2),  # Mrd. USD
            "ix": ix,
            "wt": int(top_c.get(ticker, 0)),
            "wf": int(flop_c.get(ticker, 0)),
            "ew": ew,
            "sp": spark,
        })

    rows.sort(key=lambda r: r["c"], reverse=True)
    top10 = [{"t": r["t"], "n": r["n"], "s": r["s"], "c": r["c"]} for r in rows[:10]]
    flop10 = [{"t": r["t"], "n": r["n"], "s": r["s"], "c": r["c"]} for r in sorted(rows, key=lambda r: r["c"])[:10]]

    def wlist(counter: dict[str, int], side: str):
        items = []
        for t, k in counter.items():
            if k < 2:
                continue
            meta = wmeta.get(t) or {}
            # enrich from rows if possible
            hit = next((r for r in rows if r["t"] == t), None)
            items.append({
                "t": t,
                "n": (hit["n"] if hit else meta.get("n")) or t,
                "s": (hit["s"] if hit else meta.get("s")) or "",
                "k": k,
                "side": side,
            })
        items.sort(key=lambda x: (-x["k"], x["t"]))
        return items

    payload = {
        "updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stand": format_stand(stand_ts),
        "stand_note": "ca. 15 Min. verzögert",
        "session_date": session,
        "prev_date": prev,
        "source": "Yahoo Finance via yfinance (unadjusted OHLCV) + Chart-Fill für fehlende Schlusskurse",
        "n": len(rows),
        "missing": missing,
        "filled": sorted(filled_sources.keys()),
        "wiederholer_since": started,
        "wiederholer_days": n_days,
        "earnings_week": week_id,
        "mc_buckets": {
            "gross": "mindestens 10 Mrd. USD",
            "mittel": "2 bis unter 10 Mrd. USD",
            "klein": "unter 2 Mrd. USD",
        },
        "notes": {
            "volume": "Relatives Volumen = Schluss-Volumen der Sitzung geteilt durch den Mittelwert der 20 vorherigen Sitzungen.",
            "range52": "52-Wochen-Hoch/-Tief aus den täglichen High/Low der letzten 252 Handelstage inklusive aktueller Schlusskurs.",
            "chart": "Sparkline = letzte 30 tägliche Schlusskurse, nicht intraday (zu viele Einzelabfragen für 500 Titel).",
            "index": "Universum ist der S&P 500. Nasdaq-100- und Dow-Filter zeigen die Schnittmenge. " + index_note,
            "market_cap": cap_note,
            "earnings": earn_note,
            "wiederholer": f"Fortlaufender Zähler seit {started}, {n_days} Handelstage, aus history.json (nur gelesen).",
        },
        "rows": rows,
        "top10": top10,
        "flop10": flop10,
        "wiederholer": {"top": wlist(top_c, "top"), "flop": wlist(flop_c, "flop")},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"wrote {OUT}  n={len(rows)} missing={missing}  "
        f"Top {top10[0]['t']} {top10[0]['c']:+.2f}  Flop {flop10[0]['t']} {flop10[0]['c']:+.2f}  "
        f"{OUT.stat().st_size/1024:.0f} KB",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(update_stocks())
