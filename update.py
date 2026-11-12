#!/usr/bin/env python3
"""Fetch free Yahoo Finance data and write data/sectors.json for the static MTS Sektor-Scanner.

No API key. Stdlib only. Intended for a local run or a later scheduled GitHub Action.

The MTS Trend-Barometer formula is reimplemented here (no mts_lib import, so the app stays portable):

  Score = mean of four sub-signals (each clipped to 0..100):
    Breite     = 100 * (0.5 * share of the 11 sector ETFs up on the day
                         + 0.5 * share above their own SMA 50)
    Trend      = mean( 50 + 50 * (S&P / SMA50 - 1) / 4 %,
                       50 + 50 * (S&P / SMA200 - 1) / 8 %,
                       100 if SMA50 > SMA200 else 0 )
    Momentum   = (RSI14(S&P, Wilder) - 30) / 40 * 100
    Risiko     = 50 + 5 * spread, spread = 5-day return of cyclicals
                 (XLK XLY XLF XLI XLC) minus defensives (XLP XLU XLV), in pp

Zones: 0-19 Bärenmodus, 20-39 Vorsicht, 40-59 Neutral, 60-79 Rückenwind, 80-100 Bullenmodus.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "sectors.json"

UA = "Mozilla/5.0 (compatible; MTS-Sektor-Scanner/1.0; +https://example.invalid)"
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"

SECTORS = [
    ("XLK", "Technologie"),
    ("XLF", "Finanzen"),
    ("XLV", "Gesundheit"),
    ("XLY", "Zyklischer Konsum"),
    ("XLP", "Basiskonsum"),
    ("XLI", "Industrie"),
    ("XLE", "Energie"),
    ("XLB", "Grundstoffe"),
    ("XLU", "Versorger"),
    ("XLRE", "Immobilien"),
    ("XLC", "Kommunikation"),
]
INDEX_TICKER = "^GSPC"
INDEX_NAME = "S&P 500"
CYC = ["XLK", "XLY", "XLF", "XLI", "XLC"]
DEF = ["XLP", "XLU", "XLV"]
ZONES = ["Bärenmodus", "Vorsicht", "Neutral", "Rückenwind", "Bullenmodus"]
ZONE_EDGES = [(0, 20), (20, 40), (40, 60), (60, 80), (80, 101)]
ET = ZoneInfo("America/New_York")
MEZ = ZoneInfo("Europe/Berlin")


def zone_idx(score: int) -> int:
    return next(i for i, (a, b) in enumerate(ZONE_EDGES) if a <= score < b)


def clip(x, lo=0.0, hi=100.0) -> float:
    return float(max(lo, min(hi, x)))


def http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_chart(ticker: str, interval: str, range_: str) -> dict:
    from urllib.parse import quote
    url = (
        CHART.format(ticker=quote(ticker, safe=""))
        + f"?interval={interval}&range={range_}&includePrePost=false"
    )
    data = http_get_json(url)
    err = (data.get("chart") or {}).get("error")
    result = (data.get("chart") or {}).get("result") or []
    if err or not result:
        raise RuntimeError(f"Yahoo chart error for {ticker} {interval}/{range_}: {err or 'empty'}")
    return result[0]


def series_from_chart(result: dict) -> tuple[list[int], list[float | None]]:
    ts = list(result.get("timestamp") or [])
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    closes = list(quote.get("close") or [])
    if len(closes) < len(ts):
        closes.extend([None] * (len(ts) - len(closes)))
    return ts, closes[: len(ts)]


def daily_pairs(result: dict) -> list[tuple[str, float]]:
    """Return [(YYYY-MM-DD in US Eastern, close), ...] skipping gaps."""
    ts, closes = series_from_chart(result)
    out = []
    for t, c in zip(ts, closes):
        if c is None:
            continue
        day = datetime.fromtimestamp(t, ET).date().isoformat()
        out.append((day, float(c)))
    # last close of a calendar day wins
    merged: dict[str, float] = {}
    for d, c in out:
        merged[d] = c
    return sorted(merged.items())


def sparkline(result: dict, max_points: int = 60) -> list[float]:
    ts, closes = series_from_chart(result)
    vals = [float(c) for c in closes if c is not None]
    if len(vals) <= max_points:
        return [round(v, 4) for v in vals]
    # even downsample, always keep first and last
    n = max_points - 1
    out = [vals[int(round(i * (len(vals) - 1) / n))] for i in range(n)]
    out.append(vals[-1])
    return [round(v, 4) for v in out]


def rsi_wilder(closes: list[float], n: int = 14) -> list[float | None]:
    """Match pandas ewm(alpha=1/n, adjust=False) on Wilder RSI, as in mts_lib.barometer._rsi."""
    if len(closes) < 2:
        return [None] * len(closes)
    alpha = 1.0 / n
    gains = [max(closes[i] - closes[i - 1], 0.0) for i in range(1, len(closes))]
    losses = [max(closes[i - 1] - closes[i], 0.0) for i in range(1, len(closes))]
    up, dn = gains[0], losses[0]
    out: list[float | None] = [None]
    out.append(100.0 if dn == 0 else 100.0 - 100.0 / (1.0 + up / dn))
    for g, l in zip(gains[1:], losses[1:]):
        up = (1.0 - alpha) * up + alpha * g
        dn = (1.0 - alpha) * dn + alpha * l
        out.append(100.0 if dn == 0 else 100.0 - 100.0 / (1.0 + up / dn))
    return out


def sma_at(values: list[float], i: int, n: int) -> float | None:
    if i + 1 < n:
        return None
    window = values[i + 1 - n : i + 1]
    return sum(window) / n


def compute_barometer(daily: dict[str, list[tuple[str, float]]]) -> dict:
    """Compute today's and previous session's barometer from aligned daily closes."""
    spx = daily[INDEX_TICKER]
    # align on the intersection of dates, keep chronological
    date_sets = [set(d for d, _ in series) for series in daily.values()]
    common = sorted(set.intersection(*date_sets))
    if len(common) < 210:
        raise RuntimeError(f"not enough overlapping history for SMA 200 ({len(common)} days)")

    def col(ticker: str) -> list[float]:
        m = dict(daily[ticker])
        return [m[d] for d in common]

    sect = [t for t, _ in SECTORS]
    closes = {t: col(t) for t in sect + [INDEX_TICKER]}
    sp = closes[INDEX_TICKER]
    rsi = rsi_wilder(sp)
    # last two complete sessions
    days_out = []
    for i in (len(common) - 2, len(common) - 1):
        if i < 5:
            raise RuntimeError("not enough days for 5-day spread")
        day_ret = {t: closes[t][i] / closes[t][i - 1] - 1.0 for t in sect}
        up_share = sum(1 for v in day_ret.values() if v > 0) / len(sect)
        s50_ok = []
        for t in sect:
            s50 = sma_at(closes[t], i, 50)
            if s50 is None:
                raise RuntimeError("missing SMA 50")
            s50_ok.append(closes[t][i] > s50)
        above = sum(1 for x in s50_ok if x) / len(sect)
        breadth = 100.0 * (0.5 * up_share + 0.5 * above)
        sma50 = sma_at(sp, i, 50)
        sma200 = sma_at(sp, i, 200)
        if sma50 is None or sma200 is None:
            raise RuntimeError("missing S&P SMA")
        d50 = sp[i] / sma50 - 1.0
        d200 = sp[i] / sma200 - 1.0
        golden = sma50 > sma200
        trend = (
            clip(50 + 50 * d50 / 0.04)
            + clip(50 + 50 * d200 / 0.08)
            + (100.0 if golden else 0.0)
        ) / 3.0
        rsi_v = rsi[i]
        if rsi_v is None:
            raise RuntimeError("missing RSI")
        momentum = clip((rsi_v - 30.0) / 40.0 * 100.0)
        r5 = {t: closes[t][i] / closes[t][i - 5] - 1.0 for t in sect}
        spread = (sum(r5[t] for t in CYC) / len(CYC) - sum(r5[t] for t in DEF) / len(DEF)) * 100.0
        risk = clip(50 + 5.0 * spread)
        score = int(round((breadth + trend + momentum + risk) / 4.0))
        days_out.append(
            dict(
                date=common[i],
                score=score,
                zone=zone_idx(score),
                zone_name=ZONES[zone_idx(score)],
                breadth=round(breadth, 1),
                trend=round(trend, 1),
                momentum=round(momentum, 1),
                risk=round(risk, 1),
                up=int(sum(1 for v in day_ret.values() if v > 0)),
                down=int(sum(1 for v in day_ret.values() if v < 0)),
                above50=int(round(above * len(sect))),
                spx=round(sp[i], 2),
                spx_pct=round((sp[i] / sp[i - 1] - 1.0) * 100.0, 2),
                d50=round(d50 * 100.0, 2),
                d200=round(d200 * 100.0, 2),
                golden=golden,
                rsi=round(float(rsi_v), 1),
                spread5=round(spread, 2),
            )
        )
    today, prev = days_out[1], days_out[0]
    return {"today": today, "prev": prev, "source": "Yahoo Finance daily Close, Formel wie MTS Trend-Barometer"}


def last_price_and_pct(pairs: list[tuple[str, float]], live: float | None) -> tuple[float, float, float, str]:
    """Return price, prev_close, pct, session_date. Prefer live quote vs previous official close."""
    if len(pairs) < 2:
        raise RuntimeError("need at least two daily closes")
    last_day, last_close = pairs[-1]
    prev_day, prev_close = pairs[-2]
    if live is not None and last_day == datetime.now(ET).date().isoformat():
        # today's bar already in the daily series: prev is previous session
        price = live
        return price, prev_close, (price / prev_close - 1.0) * 100.0, last_day
    if live is not None and last_day < datetime.now(ET).date().isoformat():
        # market may be open and today's daily bar not finalized; compare live to last close
        # If live is essentially last close (market shut), use official close-to-close.
        if abs(live - last_close) / last_close < 1e-6:
            return last_close, prev_close, (last_close / prev_close - 1.0) * 100.0, last_day
        return live, last_close, (live / last_close - 1.0) * 100.0, datetime.now(ET).date().isoformat()
    return last_close, prev_close, (last_close / prev_close - 1.0) * 100.0, last_day


def format_stand(ts: int) -> dict:
    utc = datetime.fromtimestamp(ts, timezone.utc)
    et = utc.astimezone(ET)
    mez = utc.astimezone(MEZ)
    # Winter: MEZ (UTC+1). Summer: MESZ (UTC+2). Label from the Berlin tz name.
    mez_label = "MESZ" if mez.dst() else "MEZ"
    et_label = "ET"
    return {
        "unix": ts,
        "iso_utc": utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "et": et.strftime("%d.%m.%Y, %H:%M") + f" {et_label}",
        "mez": mez.strftime("%d.%m.%Y, %H:%M") + f" {mez_label}",
        "label": f"{et.strftime('%d.%m.%Y, %H:%M')} {et_label} / {mez.strftime('%H:%M')} {mez_label}",
    }


def fetch_all() -> dict:
    tickers = [t for t, _ in SECTORS] + [INDEX_TICKER]
    daily: dict[str, list[tuple[str, float]]] = {}
    meta_ts = 0
    live_price: dict[str, float] = {}
    sparks: dict[str, list[float]] = {}

    for i, t in enumerate(tickers):
        if i:
            time.sleep(0.15)
        dres = fetch_chart(t, "1d", "2y")
        daily[t] = daily_pairs(dres)
        meta = dres.get("meta") or {}
        if meta.get("regularMarketTime"):
            ts = int(meta["regularMarketTime"])
            if t == INDEX_TICKER or not meta_ts:
                meta_ts = ts
        if meta.get("regularMarketPrice") is not None:
            live_price[t] = float(meta["regularMarketPrice"])
        try:
            ires = fetch_chart(t, "5m", "1d")
            sparks[t] = sparkline(ires)
        except Exception as e:  # noqa: BLE001
            print(f"warn: intraday {t}: {e!r} — falling back to daily closes", file=sys.stderr)
            sparks[t] = [round(c, 4) for _, c in daily[t][-15:]]

    if not meta_ts and daily[INDEX_TICKER]:
        # should not happen, but keep a stamp
        meta_ts = int(datetime.now(timezone.utc).timestamp())

    stand = format_stand(meta_ts)
    baro = compute_barometer(daily)

    def pack(ticker: str, name: str) -> dict:
        price, prev, pct, session = last_price_and_pct(daily[ticker], live_price.get(ticker))
        return {
            "ticker": ticker,
            "name": name,
            "price": round(price, 2),
            "prev_close": round(prev, 2),
            "pct": round(pct, 2),
            "session_date": session,
            "sparkline": sparks.get(ticker) or [],
        }

    sectors = [pack(t, n) for t, n in SECTORS]
    up = sum(1 for s in sectors if s["pct"] > 0)
    down = sum(1 for s in sectors if s["pct"] < 0)
    flat = len(sectors) - up - down
    index = pack(INDEX_TICKER, INDEX_NAME)

    return {
        "updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stand": stand,
        "stand_note": "ca. 15 Min. verzögert",
        "source": "Yahoo Finance (unofficial chart API, Schlusskurs bzw. zeitverzögerter Kurs, unverzögert nicht verfügbar)",
        "index": index,
        "sectors": sectors,
        "up": up,
        "down": down,
        "flat": flat,
        "barometer": {
            "score": baro["today"]["score"],
            "zone": baro["today"]["zone"],
            "zone_name": baro["today"]["zone_name"],
            "prev_score": baro["prev"]["score"],
            "prev_zone_name": baro["prev"]["zone_name"],
            "components": {
                "breadth": baro["today"]["breadth"],
                "trend": baro["today"]["trend"],
                "momentum": baro["today"]["momentum"],
                "risk": baro["today"]["risk"],
            },
            "session_date": baro["today"]["date"],
            "source": baro["source"],
        },
    }


def main() -> int:
    try:
        payload = fetch_all()
    except Exception as e:  # noqa: BLE001
        print(f"update failed: {e!r}", file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    idx = payload["index"]
    b = payload["barometer"]
    print(
        f"wrote {OUT}  S&P {idx['price']} ({idx['pct']:+.2f} %)  "
        f"{payload['up']} von 11 im Plus  Barometer {b['score']}/100 {b['zone_name']}  "
        f"Stand {payload['stand']['label']}"
    )
    try:
        from stock_data import update_stocks
        src = update_stocks()
        if src:
            return src
    except Exception as e:  # noqa: BLE001
        print(f"Aktien-Update fehlgeschlagen: {e!r}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
