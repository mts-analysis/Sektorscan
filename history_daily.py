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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
