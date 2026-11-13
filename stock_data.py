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


def chart_session_close(sym: str, session: str, retries: int = 2, tz: ZoneInfo | None = None):
    """Bar close, then regularMarketPrice, then fulldayPrice, matched on the market's own date."""
    zone = tz or ET
    delay = 1.0

    def on_day(ts: float | int) -> str:
        return datetime.fromtimestamp(int(ts), timezone.utc).astimezone(zone).strftime("%Y-%m-%d")

    for _attempt in range(retries):
        host = "query1" if _attempt % 2 == 0 else "query2"
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
                if on_day(t) == session:
                    return float(c), "bar_close"
            rmt, rmp = meta.get("regularMarketTime"), meta.get("regularMarketPrice")
            time_ok = rmt is not None and on_day(rmt) == session
            if time_ok and rmp is not None:
                return float(rmp), "regularMarketPrice"
            fp = meta.get("fulldayPrice")
            if time_ok and fp is not None:
                return float(fp), "fulldayPrice"
            return None, None
        except Exception:
            time.sleep(delay)
            delay = min(delay * 1.6, 8)
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


def earnings_this_week_from_calendar() -> tuple[set[str], str]:
    """Tickers in data/earnings.json whose next date falls in the current ISO week."""
    path = ROOT / "data" / "earnings.json"
    if not path.exists():
        return set(), ""
    today = datetime.now(ZoneInfo("Europe/Berlin")).date()
    year, week, _ = today.isocalendar()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return set(), f"earnings.json nicht lesbar ({e!r})."
    found = set()
    for item in data.get("items") or []:
        raw = str(item.get("d") or "")
        ticker = str(item.get("t") or "")
        if not ticker or len(raw) < 10:
            continue
        try:
            day = datetime.fromisoformat(raw[:10]).date()
        except ValueError:
            continue
        iy, iw, _ = day.isocalendar()
        if (iy, iw) == (year, week):
            found.add(ticker)
    note = f"Yahoo-Kalender diese ISO-Woche: {len(found)} Titel."
    return found, note


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


def fetch_quote_meta(yf_tickers: list[str], budget_s: float = 150.0) -> tuple[dict[str, float], dict[str, str], str]:
    """Market cap in quote currency and Yahoo currency code. Stops waiting after budget_s."""
    try:
        import yfinance as yf
    except ImportError:
        return {}, {}, "Börsenwert nicht ermittelt (yfinance fehlt)."

    caps: dict[str, float] = {}
    ccys: dict[str, str] = {}
    t0 = time.time()

    def one(t: str):
        try:
            fi = yf.Ticker(t).fast_info
            cap = fi.get("marketCap")
            ccy = fi.get("currency")
            return t, (float(cap) if cap else None), (str(ccy) if ccy else None)
        except Exception:
            return t, None, None

    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = [pool.submit(one, t) for t in yf_tickers]
        for fut in as_completed(futs):
            if time.time() - t0 > budget_s:
                break
            t, cap, ccy = fut.result()
            if ccy:
                ccys[t] = ccy
            if cap:
                caps[t] = cap
    note = (
        f"Yahoo fast_info marketCap für {len(caps)} von {len(yf_tickers)} Titeln "
        f"in {time.time()-t0:.0f}s. Börsenwert in USD (Yahoo-Devisenkurse). "
        "Schwellen: groß ≥ 10 Mrd. USD, mittel 2–10 Mrd., klein < 2 Mrd."
    )
    if len(caps) < len(yf_tickers):
        note += " Fehlende Werte gelten im Filter als nicht verfügbar."
    return caps, ccys, note


MARKETS = [
    {"id": "SPX", "name": "S&P 500", "tz": "America/New_York", "ccy": "USD", "kind": "sp500", "index": "^GSPC"},
    {"id": "DAX", "name": "DAX 40", "tz": "Europe/Berlin", "ccy": "EUR", "kind": "listed", "file": "dax40_constituents.csv", "index": "^GDAXI"},
    {"id": "KS200", "name": "KOSPI 200", "tz": "Asia/Seoul", "ccy": "KRW", "kind": "listed", "file": "kospi200_constituents.csv", "index": "^KS200"},
    {"id": "N225", "name": "Nikkei 225", "tz": "Asia/Tokyo", "ccy": "JPY", "kind": "listed", "file": "nikkei225_constituents.csv", "index": "^N225"},
    {"id": "UKX", "name": "FTSE 100", "tz": "Europe/London", "ccy": "GBP", "kind": "listed", "file": "ftse100_constituents.csv", "index": "^FTSE"},
    {"id": "NDX", "name": "Nasdaq-100", "tz": "America/New_York", "ccy": "USD", "kind": "listed", "file": "nasdaq100_constituents.csv", "index": "^NDX"},
    {"id": "DJI", "name": "Dow Jones 30", "tz": "America/New_York", "ccy": "USD", "kind": "listed", "file": "dow30_constituents.csv", "index": "^DJI"},
]
SECTOR_ORDER = [
    "Technologie", "Finanzen", "Gesundheit", "Zyklischer Konsum", "Basiskonsum",
    "Industrie", "Energie", "Grundstoffe", "Versorger", "Immobilien", "Kommunikation",
]
# Same groups as the S&P sector ETFs (XLK XLY XLF XLI XLC vs XLP XLU XLV).
CYC_SECTORS = ["Technologie", "Zyklischer Konsum", "Finanzen", "Industrie", "Kommunikation"]
DEF_SECTORS = ["Basiskonsum", "Versorger", "Gesundheit"]
FX_TICKERS = {"EUR": "EURUSD=X", "GBP": "GBPUSD=X", "JPY": "USDJPY=X", "KRW": "USDKRW=X"}


def _guess_ccy(yahoo: str) -> str:
    if yahoo.endswith(".DE"):
        return "EUR"
    if yahoo.endswith(".KS"):
        return "KRW"
    if yahoo.endswith(".T"):
        return "JPY"
    if yahoo.endswith(".L"):
        return "GBp"
    return "USD"


def load_universe() -> dict[str, dict]:
    """One row per Yahoo ticker. Index memberships accumulate."""
    import pandas as pd

    book: dict[str, dict] = {}

    def add(yahoo: str, display: str, name: str, sector: str, ix: str) -> None:
        rec = book.get(yahoo)
        clean = " ".join(str(name or "").replace("\xa0", " ").split())
        if not clean or clean.lower() == "nan":
            clean = display
        if rec is None:
            book[yahoo] = {"yf": yahoo, "t": display, "n": clean, "s": sector, "ix": [ix]}
            return
        if ix not in rec["ix"]:
            rec["ix"].append(ix)
        if not rec["s"] and sector:
            rec["s"] = sector

    sp = pd.read_csv(CONSTITUENTS)
    for _, row in sp.iterrows():
        gics = str(row["GICS Sector"])
        mapped = SECTOR_MAP.get(gics)
        if not mapped:
            print(f"warn: unbekanntes GICS {gics} für {row['Symbol']}", file=sys.stderr)
            sector = "Industrie"
        else:
            sector = mapped[1]
        yahoo = to_yahoo(str(row["Symbol"]))
        add(yahoo, str(row["Symbol"]), str(row["Security"]), sector, "SPX")

    for market in MARKETS:
        if market["kind"] != "listed":
            continue
        path = REF / market["file"]
        if not path.exists():
            print(f"warn: Liste fehlt {path}", file=sys.stderr)
            continue
        frame = pd.read_csv(path)
        for _, row in frame.iterrows():
            yahoo = str(row["Yahoo"]).strip()
            sector = str(row.get("SectorDE") or "").strip() or "Industrie"
            add(yahoo, yahoo, str(row["Security"]), sector, market["id"])
    return book


def _normalize_download(raw, tickers: list[str]):
    import pandas as pd

    if raw is None or getattr(raw, "empty", True):
        raise RuntimeError("empty")
    if not isinstance(raw.columns, pd.MultiIndex):
        if len(tickers) != 1:
            raise RuntimeError("unexpected columns")
        raw = raw.copy()
        raw.columns = pd.MultiIndex.from_product([[tickers[0]], list(raw.columns)])
    elif "Ticker" in (raw.columns.names or []) and raw.columns.names[0] != "Ticker":
        raw = raw.swaplevel(0, 1, axis=1)
    return raw


def _download_chunk(tickers: list[str], start: str, end: str, depth: int = 0):
    import yfinance as yf

    try:
        raw = yf.download(
            tickers,
            start=start,
            end=end,
            auto_adjust=False,
            group_by="ticker",
            threads=True,
            progress=False,
        )
        return [_normalize_download(raw, tickers)], []
    except Exception as e:  # noqa: BLE001
        print(f"  chunk fail n={len(tickers)} depth={depth}: {e!r}", flush=True)
        if len(tickers) == 1 or depth >= 2:
            return [], list(tickers)
        mid = len(tickers) // 2
        left, lf = _download_chunk(tickers[:mid], start, end, depth + 1)
        right, rf = _download_chunk(tickers[mid:], start, end, depth + 1)
        return left + right, lf + rf


def download_prices(tickers: list[str], start: str, end: str):
    import pandas as pd

    frames = []
    failed: list[str] = []
    for i in range(0, len(tickers), 200):
        part, bad = _download_chunk(tickers[i : i + 200], start, end)
        frames.extend(part)
        failed.extend(bad)
        print(f"  Kurse {min(i+200, len(tickers))}/{len(tickers)}", flush=True)
    if not frames:
        raise RuntimeError("keine Kursdaten")
    raw = pd.concat(frames, axis=1)
    raw = raw.loc[:, ~raw.columns.duplicated()]

    def field(ticker: str, col: str):
        try:
            if ticker not in raw.columns.get_level_values(0):
                return None
            s = raw[ticker][col].copy()
            s.index = pd.to_datetime(s.index).tz_localize(None).strftime("%Y-%m-%d")
            s = s[~s.index.duplicated(keep="last")]
            return s
        except Exception:
            return None

    def frame(col: str) -> pd.DataFrame:
        data = {}
        for t in tickers:
            s = field(t, col)
            if s is not None:
                data[t] = s
        out = pd.DataFrame(data).sort_index()
        return out[~out.index.duplicated(keep="last")]

    return frame("Close"), frame("High"), frame("Low"), frame("Volume"), failed


def load_fx() -> dict[str, float]:
    """USD per 1 unit of currency. JPY/KRW use the USD cross."""
    import yfinance as yf

    rates = {"USD": 1.0}
    symbols = list(FX_TICKERS.values())
    try:
        raw = yf.download(symbols, period="10d", auto_adjust=False, group_by="ticker", threads=True, progress=False)
        raw = _normalize_download(raw, symbols)
    except Exception as e:  # noqa: BLE001
        print(f"warn: Devisenkurse fehlen ({e!r})", file=sys.stderr)
        return rates

    def last(sym: str) -> float | None:
        try:
            s = raw[sym]["Close"].dropna()
            if len(s) == 0:
                return None
            v = float(s.iloc[-1])
            return v if v > 0 else None
        except Exception:
            return None

    eurusd, gbpusd = last("EURUSD=X"), last("GBPUSD=X")
    usdjpy, usdkrw = last("USDJPY=X"), last("USDKRW=X")
    if eurusd:
        rates["EUR"] = eurusd
    if gbpusd:
        rates["GBP"] = gbpusd
    if usdjpy:
        rates["JPY"] = 1.0 / usdjpy
    if usdkrw:
        rates["KRW"] = 1.0 / usdkrw
    print("FX USD je Einheit:", {k: round(v, 6) for k, v in rates.items()}, flush=True)
    return rates


def _pick_session(close_df, members: list[str]) -> tuple[str | None, str | None]:
    cols = [m for m in members if m in close_df.columns]
    if not cols:
        return None, None
    sub = close_df[cols]
    dates: list[str] = []
    need = max(5, int(0.55 * len(members)))
    for d in sub.index:
        if int(sub.loc[d].notna().sum()) >= need:
            dates.append(str(d))
    if len(dates) < 2:
        dates = []
        relax = max(3, int(0.3 * len(members)))
        for d in sub.index:
            if int(sub.loc[d].notna().sum()) >= relax:
                dates.append(str(d))
    if len(dates) < 2:
        return None, None
    return dates[-1], dates[-2]


def _basket_spark(close_df, tickers: list[str], days: list[str]) -> list[float]:
    import pandas as pd

    window = days[-SPARK_N:]
    if len(window) < 2:
        return []
    series = []
    for t in tickers:
        if t not in close_df.columns:
            continue
        s = close_df[t].reindex(window).astype(float)
        valid = s.dropna()
        if len(valid) < 2:
            continue
        base = float(valid.iloc[0])
        if base == 0:
            continue
        series.append(s / base * 100.0)
    if not series:
        return []
    avg = pd.concat(series, axis=1).mean(axis=1).dropna()
    return [round(float(v), 2) for v in avg.tolist()]


def _series_pairs(frame, ticker: str) -> list[tuple[str, float]]:
    if ticker not in frame.columns:
        return []
    s = frame[ticker].dropna()
    return [(str(d), float(v)) for d, v in s.items() if v and float(v) > 0]


def _basket_level(close_df, tickers: list[str], min_names: int = 3) -> list[tuple[str, float]]:
    """Equal-weight price index from daily member returns. Level starts at 100."""
    import pandas as pd

    cols = [t for t in tickers if t in close_df.columns]
    if len(cols) < min_names:
        return []
    sub = close_df[cols].apply(pd.to_numeric, errors="coerce").sort_index()
    # Return versus the previous available print, so a missing calendar day
    # does not drop the market's own latest session.
    prev = sub.ffill().shift(1)
    rets = (sub / prev - 1.0).where(sub.notna())
    level = 100.0
    out: list[tuple[str, float]] = []
    started = False
    for d in sub.index:
        if not started:
            if int(sub.loc[d].notna().sum()) >= min_names:
                started = True
                out.append((str(d), level))
            continue
        valid = rets.loc[d].dropna()
        if len(valid) < min_names:
            continue
        level *= 1.0 + float(valid.mean())
        if level > 0:
            out.append((str(d), level))
    return out


def _load_index_levels(symbols: list[str], start: str, end: str):
    """Official index closes. A short or failed series is omitted."""
    import yfinance as yf

    found: dict[str, list[tuple[str, float]]] = {}
    try:
        raw = yf.download(
            symbols,
            start=start,
            end=end,
            auto_adjust=False,
            group_by="ticker",
            threads=True,
            progress=False,
        )
        raw = _normalize_download(raw, symbols)
    except Exception as e:  # noqa: BLE001
        print(f"warn: Indexhistorie nicht geladen ({e!r})", file=sys.stderr)
        return found
    for sym in symbols:
        try:
            s = raw[sym]["Close"].dropna()
            pairs = [(str(d)[:10], float(v)) for d, v in s.items() if v and float(v) > 0]
            # yfinance may label the index with a datetime; keep one close per day
            merged: dict[str, float] = {}
            for d, v in pairs:
                merged[d] = v
            pairs = sorted(merged.items())
            if pairs:
                found[sym] = pairs
        except Exception:
            continue
    return found


def _barometer_for_market(market: dict, close_df, book: dict, session: str | None, index_levels: dict) -> dict | None:
    """Same four components as the S&P barometer, on this index's session."""
    from update import barometer_public, compute_barometer

    ix = market["id"]
    if ix == "SPX":
        return None
    members = [rec["yf"] for rec in book.values() if ix in rec["ix"]]
    source = "Yahoo Finance, gleiche Formel (Breite, Trend, Momentum, Risiko), Sektoren gleichgewichtet aus den Indexmitgliedern"
    index_pairs = list(index_levels.get(market["index"]) or [])
    if session:
        index_pairs = [(d, v) for d, v in index_pairs if d <= session]
    if len(index_pairs) < 210:
        index_pairs = _basket_level(close_df, members, min_names=max(8, len(members) // 10))
        if session:
            index_pairs = [(d, v) for d, v in index_pairs if d <= session]
        source += ". Indexstand gleichgewichtet aus den Mitgliedern, die Yahoo-Indexhistorie reicht nicht für SMA 200"
        print(f"warn: {ix} Indexhistorie kurz, Barometer nutzt Mitglieder-Index", flush=True)
    if len(index_pairs) < 210:
        raise RuntimeError(f"{ix}: nur {len(index_pairs)} Indexpunkte")

    daily: dict[str, list[tuple[str, float]]] = {market["index"]: index_pairs}
    used = []
    for name in SECTOR_ORDER:
        tickers = [rec["yf"] for rec in book.values() if ix in rec["ix"] and rec["s"] == name]
        basket = _basket_level(close_df, tickers, min_names=1)
        if session:
            basket = [(d, v) for d, v in basket if d <= session]
        if len(basket) < 60:
            continue
        daily[name] = basket
        used.append(name)
    cyc = [n for n in CYC_SECTORS if n in used]
    deff = [n for n in DEF_SECTORS if n in used]
    if len(used) < 6 or not cyc or not deff:
        raise RuntimeError(f"{ix}: zu wenige Sektoren ({len(used)})")
    result = compute_barometer(
        daily,
        index_ticker=market["index"],
        sector_tickers=used,
        cyclical=cyc,
        defensive=deff,
        source=source,
    )
    return barometer_public(result)


def _scale_gbpence(frame, tickers: list[str]) -> None:
    for t in tickers:
        if t in frame.columns:
            frame[t] = frame[t] / 100.0


def update_stocks() -> int:
    try:
        import pandas as pd
    except ImportError as e:
        print(f"stocks.json übersprungen: pandas nicht verfügbar ({e}).", file=sys.stderr)
        return 1

    book = load_universe()
    if not book:
        print("keine Titel", file=sys.stderr)
        return 1
    by_ix: dict[str, list[str]] = {m["id"]: [] for m in MARKETS}
    for rec in book.values():
        for ix in rec["ix"]:
            by_ix.setdefault(ix, []).append(rec["yf"])

    today_utc = datetime.now(timezone.utc).date()
    start = (today_utc - timedelta(days=400)).isoformat()
    end = (today_utc + timedelta(days=1)).isoformat()
    tickers = list(book)
    print(f"yfinance: {len(tickers)} Titel {start}..{end}", flush=True)
    try:
        close_df, high_df, low_df, vol_df, failed = download_prices(tickers, start, end)
    except Exception as e:  # noqa: BLE001
        print(f"STOP: Kursdownload {e!r}", file=sys.stderr)
        return 1
    if failed:
        print(f"warn: ohne Kursreihe: {failed[:12]}{'…' if len(failed) > 12 else ''}", flush=True)
    print("Tage:", list(close_df.index[-4:]), "Spalten:", close_df.shape, flush=True)

    sessions: dict[str, tuple[str | None, str | None]] = {}
    for market in MARKETS:
        sess, prev = _pick_session(close_df, by_ix.get(market["id"], []))
        sessions[market["id"]] = (sess, prev)
        print(f"  Sitzung {market['id']}: {sess} prev {prev} n={len(by_ix.get(market['id'], []))}", flush=True)

    caps_raw, ccys, cap_note = fetch_quote_meta(tickers)
    gbpence = []
    display_ccy: dict[str, str] = {}
    caps: dict[str, float] = {}
    for t in tickers:
        ccy = ccys.get(t) or _guess_ccy(t)
        cap = caps_raw.get(t)
        if ccy == "GBp":
            gbpence.append(t)
            ccy = "GBP"
            if cap is not None:
                cap = cap / 100.0
        display_ccy[t] = ccy
        if cap is not None:
            caps[t] = cap
    for frame in (close_df, high_df, low_df):
        _scale_gbpence(frame, gbpence)
    print(f"London in Pence, Anzeige in GBP: {len(gbpence)} Titel", flush=True)

    # Fill only a small gap so one illiquid name cannot stretch the run.
    for market in MARKETS:
        sess, _prev = sessions[market["id"]]
        if not sess:
            continue
        members = by_ix.get(market["id"], [])
        need = [t for t in members if t not in close_df.columns or pd.isna(close_df.at[sess, t] if t in close_df.columns else float("nan"))]
        if not need:
            continue
        if len(need) > 40:
            print(f"warn: {market['id']} {len(need)} ohne Sitzungskurs, kein Einzelabruf", flush=True)
            continue
        zone = ZoneInfo(market["tz"])
        print(f"Fülle {len(need)} Schlusskurse {market['id']} …", flush=True)
        filled = 0
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = [pool.submit(chart_session_close, t, sess, 2, zone) for t in need]
            for fut, t in zip(futs, need):
                try:
                    val, _src = fut.result(timeout=30)
                except Exception:
                    val = None
                if val is None:
                    continue
                if t in gbpence:
                    val = val / 100.0
                if t not in close_df.columns:
                    close_df[t] = float("nan")
                close_df.at[sess, t] = val
                filled += 1
        print(f"  gefüllt {filled}/{len(need)}", flush=True)

    fx = load_fx()
    stands: dict[str, dict] = {}
    sectors_path = ROOT / "data" / "sectors.json"
    if sectors_path.exists():
        try:
            for m in json.loads(sectors_path.read_text(encoding="utf-8")).get("markets") or []:
                if isinstance(m, dict) and m.get("id") and m.get("stand"):
                    stands[m["id"]] = m["stand"]
        except Exception as e:  # noqa: BLE001
            print(f"warn: Stand aus sectors.json nicht gelesen ({e!r})", file=sys.stderr)

    week_id, earn_set, earn_note = load_earnings_week()
    cal_set, cal_note = earnings_this_week_from_calendar()
    if cal_set:
        earn_set |= cal_set
        earn_note = f"{earn_note} {cal_note}"
    print("Earnings:", week_id, earn_note, flush=True)
    hist = {"meta": {"started": "2026-11-06"}, "days": []}
    if HISTORY.exists():
        hist = json.loads(HISTORY.read_text(encoding="utf-8"))
    n_days, started, top_c, flop_c, wmeta = wiederholer_counts(hist)

    rows = []
    missing_by: dict[str, list[str]] = {m["id"]: [] for m in MARKETS}

    def series_upto(df: pd.DataFrame, t: str) -> pd.Series:
        if t not in df.columns:
            return pd.Series(dtype=float)
        return df[t]

    for rec in book.values():
        yf_t = rec["yf"]
        chosen = None
        for ix in rec["ix"]:
            sess, prev = sessions.get(ix, (None, None))
            if not sess or not prev or yf_t not in close_df.columns:
                continue
            c = close_df.at[sess, yf_t] if sess in close_df.index else None
            p = close_df.at[prev, yf_t] if prev in close_df.index else None
            if c is None or p is None or pd.isna(c) or pd.isna(p) or float(p) == 0:
                continue
            if chosen is None or sess > chosen[0]:
                chosen = (sess, prev, float(c), float(p), ix)
        if chosen is None:
            for ix in rec["ix"]:
                missing_by.setdefault(ix, []).append(rec["t"])
            continue
        session, prev, c, p, _primary = chosen
        pct = (c / p - 1.0) * 100.0
        cl = series_upto(close_df, yf_t).dropna()
        if session not in cl.index:
            cl.loc[session] = c
            cl = cl.sort_index()
        spark = downsample(cl.loc[:session].tail(SPARK_N).tolist(), SPARK_N)
        hi = series_upto(high_df, yf_t).dropna().tail(252)
        lo = series_upto(low_df, yf_t).dropna().tail(252)
        h52 = float(max(hi.max(), c)) if len(hi) else c
        l52 = float(min(lo.min(), c)) if len(lo) else c
        d_high = (c / h52 - 1.0) * 100.0 if h52 else None
        d_low = (c / l52 - 1.0) * 100.0 if l52 else None
        rv = None
        vol = series_upto(vol_df, yf_t)
        if len(vol.dropna()) >= 11 and session in vol.index:
            today_v = float(vol.loc[session])
            prev20 = vol.loc[:session].iloc[:-1].tail(20)
            if today_v > 0 and len(prev20) >= 10 and float(prev20.mean()) > 0:
                rv = today_v / float(prev20.mean())
        ccy = display_ccy.get(yf_t) or "USD"
        cap = caps.get(yf_t)
        factor = fx.get(ccy)
        mc = (cap * factor / 1e9) if cap is not None and factor else None
        ticker = rec["t"]
        ew = 1 if (ticker in earn_set or yf_t in earn_set or ticker.replace("-", ".") in earn_set) else 0
        rows.append({
            "t": ticker,
            "n": rec["n"],
            "s": rec["s"],
            "p": round(c, 2 if ccy not in ("JPY", "KRW") else 0),
            "c": round(pct, 2),
            "ccy": ccy,
            "rv": None if rv is None else round(rv, 2),
            "dH": None if d_high is None else round(d_high, 2),
            "dL": None if d_low is None else round(d_low, 2),
            "mc": None if mc is None else round(mc, 2),
            "ix": list(rec["ix"]),
            "wt": int(top_c.get(ticker, 0)),
            "wf": int(flop_c.get(ticker, 0)),
            "ew": ew,
            "sp": spark,
            "_yf": yf_t,
            "_session": session,
        })

    rows.sort(key=lambda r: r["c"], reverse=True)

    def pack_side(items: list[dict]) -> list[dict]:
        return [{"t": r["t"], "n": r["n"], "s": r["s"], "c": r["c"], "p": r["p"], "ccy": r["ccy"]} for r in items]

    index_levels = _load_index_levels([m["index"] for m in MARKETS if m["id"] != "SPX"], start, end)
    barometers: dict[str, dict] = {}
    for market in MARKETS:
        if market["id"] == "SPX":
            continue
        try:
            sess_lim = sessions.get(market["id"], (None, None))[0]
            pub = _barometer_for_market(market, close_df, book, sess_lim, index_levels)
            if pub:
                barometers[market["id"]] = pub
                print(
                    f"Barometer {market['id']}: {pub['score']}/100 {pub['zone_name']} "
                    f"Sitzung {pub['session_date']}",
                    flush=True,
                )
        except Exception as e:  # noqa: BLE001
            print(f"warn: Barometer {market['id']} nicht berechnet ({e!r})", file=sys.stderr)

    by_index: dict[str, dict] = {}
    for market in MARKETS:
        ix = market["id"]
        sess, prev = sessions.get(ix, (None, None))
        members = [r for r in rows if ix in r["ix"]]
        ranked = sorted(members, key=lambda r: r["c"], reverse=True)
        flop = sorted(members, key=lambda r: r["c"])
        market_days = [str(d) for d in close_df.index if sess is None or str(d) <= sess]
        sectors = []
        for name in SECTOR_ORDER:
            group = [r for r in members if r["s"] == name]
            if not group:
                continue
            pct = sum(r["c"] for r in group) / len(group)
            sectors.append({
                "name": name,
                "n": len(group),
                "pct": round(pct, 2),
                "sparkline": _basket_spark(close_df, [r["_yf"] for r in group], market_days),
            })
        by_index[ix] = {
            "id": ix,
            "name": market["name"],
            "currency": market["ccy"],
            "stand": stands.get(ix),
            "session_date": sess,
            "prev_date": prev,
            "n": len(members),
            "missing": missing_by.get(ix, []),
            "up": sum(1 for r in members if r["c"] > 0),
            "down": sum(1 for r in members if r["c"] < 0),
            "top10": pack_side(ranked[:10]),
            "flop10": pack_side(flop[:10]),
            "sectors": sectors,
            "barometer": barometers.get(ix),
        }
        print(
            f"{ix}: n={len(members)} missing={len(missing_by.get(ix, []))} "
            f"session={sess} top={(ranked[0]['t'] + ' ' + format(ranked[0]['c'], '+.2f')) if ranked else '-'}",
            flush=True,
        )

    spx_rows = [r for r in rows if "SPX" in r["ix"]]
    top10 = pack_side(sorted(spx_rows, key=lambda r: r["c"], reverse=True)[:10])
    flop10 = pack_side(sorted(spx_rows, key=lambda r: r["c"])[:10])

    def wlist(counter: dict[str, int], side: str):
        items = []
        for t, k in counter.items():
            if k < 2:
                continue
            meta = wmeta.get(t) or {}
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

    public_rows = []
    for r in rows:
        item = dict(r)
        item.pop("_yf", None)
        item.pop("_session", None)
        public_rows.append(item)

    spx_info = by_index.get("SPX") or {}
    payload = {
        "updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stand": stands.get("SPX") or format_stand(int(datetime.now(timezone.utc).timestamp())),
        "stand_note": "ca. 15 Min. verzögert",
        "session_date": spx_info.get("session_date"),
        "prev_date": spx_info.get("prev_date"),
        "source": "Yahoo Finance via yfinance (unadjusted OHLCV). Tagesänderung je letzte Sitzung des Index.",
        "n": len(public_rows),
        "missing": spx_info.get("missing") or [],
        "wiederholer_since": started,
        "wiederholer_days": n_days,
        "earnings_week": week_id,
        "mc_buckets": {
            "gross": "mindestens 10 Mrd. USD",
            "mittel": "2 bis unter 10 Mrd. USD",
            "klein": "unter 2 Mrd. USD",
        },
        "notes": {
            "volume": "Relatives Volumen = Volumen der Sitzung geteilt durch den Mittelwert der 20 vorherigen Sitzungen.",
            "range52": "52-Wochen-Hoch/-Tief aus den täglichen High/Low der letzten 252 Handelstage inklusive aktuellem Schlusskurs.",
            "chart": "Sparkline = letzte 30 tägliche Schlusskurse.",
            "index": "Ein Titel kann in mehreren Indizes stehen und erscheint dann einmal, mit allen Zugehörigkeiten.",
            "market_cap": cap_note,
            "currency": "Kurse in Landeswährung (London von Pence nach GBP). Börsenwert-Filter in USD, umgerechnet mit Yahoo-Devisenkursen.",
            "session": "Die Tagesänderung bezieht sich auf die letzte Sitzung des jeweiligen Marktes.",
            "earnings": earn_note,
            "wiederholer": f"Fortlaufender Zähler seit {started}, {n_days} Handelstage, nur S&P 500, aus history.json (nur gelesen).",
        },
        "rows": public_rows,
        "top10": top10,
        "flop10": flop10,
        "wiederholer": {"top": wlist(top_c, "top"), "flop": wlist(flop_c, "flop")},
        "by_index": by_index,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT}  n={len(public_rows)}  {OUT.stat().st_size/1024:.0f} KB", flush=True)
    _patch_sectors(by_index)
    if not public_rows:
        return 1
    return 0


def _patch_sectors(by_index: dict[str, dict]) -> None:
    path = ROOT / "data" / "sectors.json"
    if not path.exists():
        return
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"warn: sectors.json nicht gelesen ({e!r})", file=sys.stderr)
        return
    existing = {m.get("id"): m for m in doc.get("markets") or [] if isinstance(m, dict)}
    ordered = []
    for market in MARKETS:
        base = dict(existing.get(market["id"]) or {"id": market["id"], "name": market["name"]})
        info = by_index.get(market["id"]) or {}
        base["id"] = market["id"]
        base["name"] = market["name"]
        base["price_currency"] = info.get("currency") or market["ccy"]
        base["stock_session"] = info.get("session_date")
        base["up_stocks"] = info.get("up")
        base["down_stocks"] = info.get("down")
        base["n_stocks"] = info.get("n")
        if info.get("barometer"):
            base["barometer"] = info["barometer"]
        if market["id"] != "SPX":
            sectors = info.get("sectors") or []
            base["sectors"] = sectors
            base["up"] = sum(1 for s in sectors if s.get("pct", 0) > 0)
            base["down"] = sum(1 for s in sectors if s.get("pct", 0) < 0)
            base["flat"] = len(sectors) - base["up"] - base["down"]
        ordered.append(base)
    doc["markets"] = ordered
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"patched {path}", flush=True)


