#!/usr/bin/env python3
"""Daily Top 5 across all indexes, with earnings, headlines and insider activity."""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
STOCKS = ROOT / "data" / "stocks.json"
EARNINGS = ROOT / "data" / "earnings.json"
PROFILE_DIR = ROOT / "data" / "profiles"
OUT = ROOT / "data" / "top5.json"
SHARDS = 16
EARN_DAYS = 14
NEWS_DAYS = 7
INSIDER_DAYS = 90
HORIZON = ZoneInfo("Europe/Berlin")


def shard_of(ticker: str) -> int:
    h = 0
    for ch in ticker:
        h = (h * 33 + ord(ch)) & 0xFFFFFFFF
    return h % SHARDS


def _de_date(iso: str | None) -> str | None:
    if not iso:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", iso)
    return f"{m.group(3)}.{m.group(2)}.{m.group(1)}" if m else iso


def _load_profile(ticker: str) -> dict:
    path = PROFILE_DIR / f"s{shard_of(ticker):02d}.json"
    if not path.exists():
        return {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    rec = (doc.get("rows") or {}).get(ticker)
    return rec if isinstance(rec, dict) else {}


def _recent_news(items, today) -> list[dict]:
    out = []
    cutoff = today - timedelta(days=NEWS_DAYS)
    for item in items or []:
        if not isinstance(item, dict) or not item.get("h") or not item.get("u"):
            continue
        day = None
        raw = item.get("d")
        if raw:
            try:
                day = datetime.fromisoformat(str(raw)[:10]).date()
            except ValueError:
                day = None
        recent = bool(day and cutoff <= day <= today)
        out.append({
            "h": item["h"],
            "u": item["u"],
            "d": (day.isoformat() if day else None),
            "src": item.get("src"),
            "recent": recent,
        })
        if len(out) >= 3:
            break
    return out


def _insider_kind(transaction, text) -> str | None:
    raw = f"{transaction or ''} {text or ''}".lower()
    if "purchase" in raw or re.search(r"\bbuy\b", raw):
        return "zukauf"
    if "sale" in raw or re.search(r"\bsell\b", raw):
        return "abgabe"
    return None


def _insider(yahoo: str, today) -> dict | None:
    try:
        import yfinance as yf
        frame = yf.Ticker(yahoo).insider_transactions
    except Exception:
        return None
    if frame is None or getattr(frame, "empty", True):
        return None
    cutoff = today - timedelta(days=INSIDER_DAYS)
    zukauf = 0
    abgabe = 0
    last = None
    for _, row in frame.iterrows():
        ts = row.get("Start Date")
        try:
            day = ts.date() if hasattr(ts, "date") else datetime.fromisoformat(str(ts)[:10]).date()
        except Exception:
            continue
        if day < cutoff or day > today:
            continue
        kind = _insider_kind(row.get("Transaction"), row.get("Text"))
        if kind == "zukauf":
            zukauf += 1
        elif kind == "abgabe":
            abgabe += 1
        else:
            continue
        if last is None or day > last:
            last = day
    return {
        "zukauf": zukauf,
        "abgabe": abgabe,
        "last": last.isoformat() if last else None,
        "window_days": INSIDER_DAYS,
        "source": True,
    }


def write_top5() -> Path:
    today = datetime.now(HORIZON).date()
    stocks = json.loads(STOCKS.read_text(encoding="utf-8"))
    rows = [r for r in (stocks.get("rows") or []) if r.get("c") is not None]
    rows.sort(key=lambda r: r["c"], reverse=True)
    top = rows[:5]
    earnings = {}
    if EARNINGS.exists():
        try:
            earnings = {i["t"]: i for i in (json.loads(EARNINGS.read_text(encoding="utf-8")).get("items") or [])}
        except Exception:
            earnings = {}

    from stock_data import load_universe
    yf_by_display = {rec["t"]: rec["yf"] for rec in load_universe().values()}

    items = []
    for row in top:
        ticker = row["t"]
        prof = _load_profile(ticker)
        news = _recent_news(prof.get("news"), today)
        earn_item = earnings.get(ticker)
        earn = None
        if earn_item and earn_item.get("d"):
            try:
                day = datetime.fromisoformat(str(earn_item["d"])[:10]).date()
                delta = (day - today).days
                if 0 <= delta <= EARN_DAYS:
                    earn = {
                        "d": day.isoformat(),
                        "days": delta,
                        "kind": earn_item.get("kind") or ("estimate" if earn_item.get("est") else None),
                    }
            except ValueError:
                earn = None
        yahoo = yf_by_display.get(ticker, ticker)
        insider = _insider(yahoo, today)
        flags = []
        if earn is not None:
            if earn["days"] == 0:
                flags.append("Zahlen heute")
            elif earn["days"] == 1:
                flags.append("Zahlen morgen")
            else:
                flags.append(f"Zahlen in {earn['days']} Tagen")
        if any(n.get("recent") for n in news):
            flags.append("Auffällige News")
        if insider and (insider["zukauf"] or insider["abgabe"]):
            flags.append("Insider-Aktivität")
        items.append({
            "t": ticker,
            "n": row.get("n") or ticker,
            "s": row.get("s"),
            "c": row.get("c"),
            "p": row.get("p"),
            "ccy": row.get("ccy"),
            "ix": list(row.get("ix") or []),
            "earnings": earn,
            "news": news,
            "insider": insider,
            "flags": flags,
        })

    payload = {
        "updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "session_date": stocks.get("session_date"),
        "horizon_days": EARN_DAYS,
        "note": "Die fünf Titel mit der stärksten Tagesänderung über alle Indizes der letzten Sitzung. Keine Anlageberatung. Keine Prognose.",
        "items": items,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"top5.json {len(items)} Titel, Sitzung {payload['session_date']}", flush=True)
    for item in items:
        print(f"  {item['t']} {item['c']:+.2f} flags={item['flags']}", flush=True)
    return OUT


if __name__ == "__main__":
    write_top5()
