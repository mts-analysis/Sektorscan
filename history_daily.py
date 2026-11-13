#!/usr/bin/env python3
"""Once per day: compact 1-year closes and the next Yahoo earnings date.

The 15-minute quote job does not run this. Shards live in data/history/sXX.json.
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

from stock_data import load_universe

ROOT = Path(__file__).resolve().parent
HIST = ROOT / "data" / "history"
EARNINGS_OUT = ROOT / "data" / "earnings.json"
STOCKS = ROOT / "data" / "stocks.json"
SHARDS = 16
HORIZON_DAYS = 21


def shard_of(ticker: str) -> int:
    h = 0
    for ch in ticker:
        h = (h * 33 + ord(ch)) & 0xFFFFFFFF
    return h % SHARDS


def download_closes(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    frames = []
    failed: list[str] = []

    def one(chunk: list[str], depth: int = 0):
        try:
            raw = yf.download(
                chunk,
                start=start,
                end=end,
                auto_adjust=False,
                group_by="ticker",
                threads=True,
                progress=False,
            )
            if raw is None or getattr(raw, "empty", True):
                raise RuntimeError("empty")
            if not isinstance(raw.columns, pd.MultiIndex):
                raw = raw.copy()
                raw.columns = pd.MultiIndex.from_product([[chunk[0]], list(raw.columns)])
            elif raw.columns.names[0] != "Ticker" and "Ticker" in (raw.columns.names or []):
                raw = raw.swaplevel(0, 1, axis=1)
            return [raw], []
        except Exception as e:  # noqa: BLE001
            print(f"  chunk fail n={len(chunk)}: {e!r}", flush=True)
            if len(chunk) == 1 or depth >= 2:
                return [], list(chunk)
            mid = len(chunk) // 2
            left, lf = one(chunk[:mid], depth + 1)
            right, rf = one(chunk[mid:], depth + 1)
            return left + right, lf + rf

    for i in range(0, len(tickers), 200):
        part, bad = one(tickers[i : i + 200])
        frames.extend(part)
        failed.extend(bad)
        print(f"  Historie {min(i + 200, len(tickers))}/{len(tickers)}", flush=True)
    if not frames:
        raise RuntimeError("keine Historie")
    raw = pd.concat(frames, axis=1)
    raw = raw.loc[:, ~raw.columns.duplicated()]
    cols = {}
    for t in tickers:
        try:
            if t not in raw.columns.get_level_values(0):
                continue
            s = raw[t]["Close"].dropna()
            s.index = pd.to_datetime(s.index).tz_localize(None).strftime("%Y-%m-%d")
            s = s[~s.index.duplicated(keep="last")]
            if len(s):
                cols[t] = s
        except Exception:
            continue
    if failed:
        print(f"warn: ohne Historie: {failed[:12]}", flush=True)
    return pd.DataFrame(cols).sort_index()


def round_px(value: float) -> float:
    if value >= 1000:
        return round(value, 1) if value < 20000 else round(value)
    return round(value, 2)


def write_history(book: dict, closes: pd.DataFrame, display_px: dict[str, float]) -> dict[int, int]:
    HIST.mkdir(parents=True, exist_ok=True)
    buckets: dict[int, dict] = {i: {} for i in range(SHARDS)}
    for yf_t, rec in book.items():
        if yf_t not in closes.columns:
            continue
        series = closes[yf_t].dropna()
        if len(series) < 20:
            continue
        scale = 1.0
        shown = display_px.get(rec["t"])
        last = float(series.iloc[-1])
        if shown and last > shown * 20:
            scale = 0.01
        points = []
        for day, val in series.items():
            if val is None or pd.isna(val) or float(val) <= 0:
                continue
            points.append([int(str(day).replace("-", "")), round_px(float(val) * scale)])
        if len(points) >= 20:
            buckets[shard_of(rec["t"])][rec["t"]] = points
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sizes = {}
    for i, series in buckets.items():
        payload = {"updated_at_utc": stamp, "shard": i, "series": series}
        path = HIST / f"s{i:02d}.json"
        path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        sizes[i] = path.stat().st_size
        print(f"  {path.name} {len(series)} Titel {sizes[i]/1024:.0f} KB", flush=True)
    (HIST / "index.json").write_text(
        json.dumps({"updated_at_utc": stamp, "shards": SHARDS, "mod": 33}, separators=(",", ":")),
        encoding="utf-8",
    )
    return sizes


def next_earnings(ticker: str, today):
    try:
        frame = yf.Ticker(ticker).get_earnings_dates(limit=8)
    except Exception:
        return None
    if frame is None or getattr(frame, "empty", True):
        return None
    upcoming = []
    for ts, row in frame.iterrows():
        try:
            day = ts.date() if hasattr(ts, "date") else pd.Timestamp(ts).date()
        except Exception:
            continue
        if day < today:
            continue
        reported = row.get("Reported EPS") if hasattr(row, "get") else None
        if reported is not None and not pd.isna(reported):
            continue
        estimate = row.get("EPS Estimate") if hasattr(row, "get") else None
        kind = "estimate" if estimate is not None and not pd.isna(estimate) else "unconfirmed"
        upcoming.append((day, kind))
    if not upcoming:
        return None
    upcoming.sort()
    day, kind = upcoming[0]
    return {"t": ticker, "d": day.isoformat(), "est": kind == "estimate", "kind": kind}


def write_earnings(display_tickers: list[str]) -> dict:
    today = datetime.now(ZoneInfo("Europe/Berlin")).date()
    items = []
    t0 = time.time()
    budget = 12 * 60
    pool = ThreadPoolExecutor(max_workers=8)
    try:
        futs = {pool.submit(next_earnings, t, today): t for t in display_tickers}
        done = 0
        try:
            for fut in as_completed(futs, timeout=budget):
                done += 1
                if time.time() - t0 > budget:
                    break
                try:
                    item = fut.result(timeout=25)
                except Exception:
                    item = None
                if item:
                    items.append(item)
                if done % 100 == 0:
                    print(f"  Earnings {done}/{len(display_tickers)} gefunden {len(items)}", flush=True)
        except TimeoutError:
            print("warn: Earnings-Zeitbudget erreicht", flush=True)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    items.sort(key=lambda x: (x["d"], x["t"]))
    payload = {
        "updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "horizon_days": HORIZON_DAYS,
        "note": "Nächster Yahoo-Termin je Titel. Zukünftige Termine sind geschätzt oder unbestätigt.",
        "items": items,
    }
    EARNINGS_OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return payload


def _pct_back(values: list[float], n: int):
    if len(values) <= n:
        return None
    last = values[-1]
    prev = values[-1 - n]
    if prev is None or prev == 0 or last is None:
        return None
    return round((last / prev - 1.0) * 100.0, 2)


def _weighted(pairs: list[tuple[float, float]]):
    num = den = 0.0
    for weight, value in pairs:
        if value is None:
            continue
        w = weight if weight and weight > 0 else 1.0
        num += w * value
        den += w
    if den <= 0:
        return None
    return round(num / den, 2)


def write_returns_from_shards() -> Path:
    """5- and 20-session moves from the shard files. No extra Yahoo call."""
    from stock_data import MARKETS, SECTOR_ORDER

    prices: dict[str, list[float]] = {}
    for path in sorted(HIST.glob("s*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        for ticker, pts in (doc.get("series") or {}).items():
            prices[ticker] = [p[1] for p in pts if p and p[1] is not None]
    if not prices:
        raise RuntimeError("keine Shard-Reihen")
    px = {}
    for ticker, vals in prices.items():
        d5, d20 = _pct_back(vals, 5), _pct_back(vals, 20)
        if d5 is None and d20 is None:
            continue
        px[ticker] = [d5, d20]
    meta = {}
    if STOCKS.exists():
        doc = json.loads(STOCKS.read_text(encoding="utf-8"))
        meta = {r["t"]: r for r in doc.get("rows") or []}
    indices = {}
    sectors: dict[str, dict] = {}
    for market in MARKETS:
        ix = market["id"]
        members = [r for r in meta.values() if ix in (r.get("ix") or [])]
        indices[ix] = [
            _weighted([(r.get("mc"), (px.get(r["t"]) or [None, None])[0]) for r in members]),
            _weighted([(r.get("mc"), (px.get(r["t"]) or [None, None])[1]) for r in members]),
        ]
        sectors[ix] = {}
        for name in SECTOR_ORDER:
            group = [r for r in members if r.get("s") == name]
            if not group:
                continue
            sectors[ix][name] = [
                _weighted([(r.get("mc"), (px.get(r["t"]) or [None, None])[0]) for r in group]),
                _weighted([(r.get("mc"), (px.get(r["t"]) or [None, None])[1]) for r in group]),
            ]
    payload = {
        "updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "5 und 20 Handelstage, Schlusskurs gegen den Schluss davor, Sektoren und Indizes nach Börsenwert gewichtet.",
        "px": px,
        "ix": indices,
        "sec": sectors,
    }
    out = HIST / "returns.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"returns.json {len(px)} Titel {out.stat().st_size/1024:.0f} KB", flush=True)
    return out


ETF_TICKERS = ["XLK", "XLV", "XLF", "XLY", "XLP", "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC", "SPY"]
ETF_NAMES = {
    "XLK": "Technologie", "XLV": "Gesundheit", "XLF": "Finanzen", "XLY": "Zyklischer Konsum",
    "XLP": "Basiskonsum", "XLE": "Energie", "XLI": "Industrie", "XLB": "Grundstoffe",
    "XLU": "Versorger", "XLRE": "Immobilien", "XLC": "Kommunikation", "SPY": "S&P 500",
}
SEASON_PATH = ROOT / "data" / "seasonality.json"


def _yf_frame(tickers: list[str], start: str, end: str, field: str) -> pd.DataFrame:
    raw = yf.download(
        tickers, start=start, end=end, interval="1d", auto_adjust=False,
        group_by="ticker", threads=True, progress=False,
    )
    if raw is None or getattr(raw, "empty", True):
        raise RuntimeError("yfinance leer")
    if not isinstance(raw.columns, pd.MultiIndex):
        raw = raw.copy()
        raw.columns = pd.MultiIndex.from_product([[tickers[0]], list(raw.columns)])
    elif raw.columns.names[0] != "Ticker" and "Ticker" in (raw.columns.names or []):
        raw = raw.swaplevel(0, 1, axis=1)
    cols = {}
    for t in tickers:
        try:
            s = raw[t][field].dropna()
            s.index = pd.to_datetime(s.index).tz_localize(None)
            s = s[~s.index.duplicated(keep="last")]
            if len(s):
                cols[t] = s
        except Exception:
            continue
    if "SPY" not in cols:
        raise RuntimeError("SPY fehlt")
    return pd.DataFrame(cols).sort_index()


def write_etf_history() -> Path:
    """About one year of SPDR sector ETF and SPY closes for the Sektor-Rad."""
    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=420)).isoformat()
    end = (today + timedelta(days=1)).isoformat()
    frame = _yf_frame(ETF_TICKERS, start, end, "Close")
    dates = [d.strftime("%Y-%m-%d") for d in frame.index]
    close = {}
    for t in ETF_TICKERS:
        if t not in frame.columns:
            continue
        close[t] = [None if pd.isna(v) else round(float(v), 4) for v in frame[t].tolist()]
    payload = {
        "updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "names": {t: ETF_NAMES[t] for t in close if t != "SPY"},
        "dates": dates,
        "close": close,
    }
    out = HIST / "etf.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"etf.json {len(dates)} Tage, {len(close)} Reihen, bis {dates[-1] if dates else '-'}", flush=True)
    return out


def _month_table(adj: pd.DataFrame, year: int) -> dict:
    """Monthly and quarterly relative returns. Years before `year` only. No forecast."""
    month_end = adj.resample("ME").last()
    rets = month_end.pct_change() * 100.0
    out = {}
    for t in [x for x in ETF_TICKERS if x != "SPY" and x in adj.columns]:
        first = adj[t].first_valid_index()
        if first is None or "SPY" not in rets.columns:
            continue
        sector = rets[t][rets.index > pd.Timestamp(first) + pd.offsets.MonthEnd(1)]
        sector = sector[sector.index.year < year].dropna()
        spy = rets["SPY"].reindex(sector.index)
        both = pd.DataFrame({"s": sector, "spy": spy}).dropna()
        months = {}
        for m in range(1, 13):
            block = both[both.index.month == m]
            if block.empty:
                continue
            beat = int((block["s"] > block["spy"]).sum())
            months[str(m)] = {
                "n": int(len(block)),
                "beat": beat,
                "excess": round(float((block["s"] - block["spy"]).mean()), 2),
                "years": {str(ts.year): round(float(v["s"] - v["spy"]), 2) for ts, v in block.iterrows()},
            }
        quarters = {}
        q_years = {str(q): {} for q in range(1, 5)}
        for y in sorted(set(both.index.year)):
            for q in range(1, 5):
                part = both[(both.index.year == y) & (both.index.quarter == q)]
                if len(part) < 3:
                    continue
                sret = float((1 + part["s"] / 100.0).prod() - 1)
                pret = float((1 + part["spy"] / 100.0).prod() - 1)
                q_years[str(q)][str(y)] = round((sret - pret) * 100.0, 2)
        for q in range(1, 5):
            vals = list(q_years[str(q)].values())
            if not vals:
                continue
            quarters[str(q)] = {
                "n": len(vals),
                "beat": sum(1 for v in vals if v > 0),
                "excess": round(sum(vals) / len(vals), 2),
                "years": q_years[str(q)],
            }
        out[t] = {"name": ETF_NAMES[t], "months": months, "quarters": quarters}
    return out


def maybe_write_seasonality() -> Path | None:
    """Rewrite data/seasonality.json at most once per calendar month."""
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    if SEASON_PATH.exists():
        try:
            old = json.loads(SEASON_PATH.read_text(encoding="utf-8"))
            if old.get("schema") == 2 and old.get("computed_month") == month and old.get("sectors"):
                print(f"Saison {month} schon vorhanden", flush=True)
                return SEASON_PATH
        except Exception:
            pass
    today = datetime.now(timezone.utc).date()
    end = (today + timedelta(days=1)).isoformat()
    adj = _yf_frame(ETF_TICKERS, "1998-12-01", end, "Adj Close")
    year = today.year
    payload = {
        "updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "schema": 2,
        "computed_month": month,
        "through_year": year - 1,
        "method": "Adj Close, Monatsrendite zum Monatsende, nur volle Monate, Jahre vor dem laufenden Jahr. Relativ = Sektor minus S&P 500 (SPY). Quartal = drei Monate verkettet.",
        "note": "Historischer Durchschnitt – keine Prognose.",
        "sectors": _month_table(adj, year),
    }
    SEASON_PATH.parent.mkdir(parents=True, exist_ok=True)
    SEASON_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"seasonality.json {month} Sektoren {len(payload['sectors'])}", flush=True)
    return SEASON_PATH


def main() -> int:
    book = load_universe()
    display = {rec["t"]: rec for rec in book.values()}
    # Prefer the display ticker for earnings calls (SAP.DE, BRK.B -> Yahoo wants BRK-B).
    yf_by_display = {rec["t"]: rec["yf"] for rec in book.values()}
    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=380)).isoformat()
    end = (today + timedelta(days=1)).isoformat()
    print(f"Historie {len(book)} Titel {start}..{end}", flush=True)
    try:
        closes = download_closes(list(book), start, end)
    except Exception as e:  # noqa: BLE001
        print(f"STOP Historie: {e!r}", file=sys.stderr)
        return 1
    shown = {}
    if STOCKS.exists():
        try:
            doc = json.loads(STOCKS.read_text(encoding="utf-8"))
            shown = {r["t"]: r.get("p") for r in doc.get("rows") or [] if r.get("p")}
        except Exception as e:  # noqa: BLE001
            print(f"warn: stocks.json Preise nicht gelesen ({e!r})", file=sys.stderr)
    sizes = write_history(book, closes, shown)
    print(f"Historie gesamt {sum(sizes.values())/1024:.0f} KB", flush=True)

    earn_tickers = [yf_by_display[t] for t in display]
    # Store under the display symbol the page uses.
    yahoo_to_display = {rec["yf"]: rec["t"] for rec in book.values()}
    print(f"Earnings-Termine für {len(earn_tickers)} Titel", flush=True)
    raw = write_earnings(earn_tickers)
    fixed = []
    for item in raw["items"]:
        item["t"] = yahoo_to_display.get(item["t"], item["t"])
        fixed.append(item)
    raw["items"] = fixed
    EARNINGS_OUT.write_text(json.dumps(raw, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    by_ix = {m: 0 for m in ("SPX", "DAX", "KS200", "N225", "UKX")}
    horizon = today + timedelta(days=HORIZON_DAYS)
    near = {m: 0 for m in by_ix}
    for item in fixed:
        rec = display.get(item["t"])
        if not rec:
            continue
        for ix in rec["ix"]:
            by_ix[ix] = by_ix.get(ix, 0) + 1
            try:
                if today <= datetime.fromisoformat(item["d"]).date() <= horizon:
                    near[ix] = near.get(ix, 0) + 1
            except Exception:
                pass
    print("Nächster Termin je Index:", by_ix, flush=True)
    print(f"Davon in {HORIZON_DAYS} Tagen:", near, flush=True)
    print(f"Earnings-Datei {EARNINGS_OUT.stat().st_size/1024:.0f} KB, Titel {len(fixed)}", flush=True)
    try:
        write_returns_from_shards()
    except Exception as e:  # noqa: BLE001
        print(f"warn: returns.json nicht geschrieben ({e!r})", file=sys.stderr)
    try:
        write_etf_history()
    except Exception as e:  # noqa: BLE001
        print(f"warn: ETF-Historie nicht geschrieben ({e!r})", file=sys.stderr)
    try:
        maybe_write_seasonality()
    except Exception as e:  # noqa: BLE001
        print(f"warn: Saison-Statistik nicht geschrieben ({e!r})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    if "--returns-only" in sys.argv:
        try:
            write_returns_from_shards()
        except Exception as e:  # noqa: BLE001
            print(f"STOP returns: {e!r}", file=sys.stderr)
            raise SystemExit(1)
        raise SystemExit(0)
    raise SystemExit(main())
