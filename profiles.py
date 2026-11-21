#!/usr/bin/env python3
"""Company profiles and fundamentals for aktie.html. Fetched in the daily job, not in the browser."""
from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yfinance as yf

from stock_data import load_universe

ROOT = Path(__file__).resolve().parent
PROFILE_DIR = ROOT / "data" / "profiles"
SHARDS = 16
MASTER_DAYS = 7
FUND_DAYS = 1

COUNTRY_DE = {
    "united states": "Vereinigte Staaten",
    "united states of america": "Vereinigte Staaten",
    "usa": "Vereinigte Staaten",
    "u.s.": "Vereinigte Staaten",
    "u.s.a.": "Vereinigte Staaten",
    "germany": "Deutschland",
    "deutschland": "Deutschland",
    "japan": "Japan",
    "united kingdom": "Vereinigtes Königreich",
    "great britain": "Vereinigtes Königreich",
    "britain": "Vereinigtes Königreich",
    "south korea": "Südkorea",
    "korea": "Südkorea",
    "korea, republic of": "Südkorea",
    "republic of korea": "Südkorea",
    "france": "Frankreich",
    "netherlands": "Niederlande",
    "switzerland": "Schweiz",
    "ireland": "Irland",
    "canada": "Kanada",
    "australia": "Australien",
    "china": "China",
    "taiwan": "Taiwan",
    "sweden": "Schweden",
    "spain": "Spanien",
    "italy": "Italien",
    "denmark": "Dänemark",
    "finland": "Finnland",
    "belgium": "Belgien",
    "austria": "Österreich",
    "luxembourg": "Luxemburg",
    "norway": "Norwegen",
    "brazil": "Brasilien",
    "india": "Indien",
    "singapore": "Singapur",
    "hong kong": "Hongkong",
    "israel": "Israel",
    "mexico": "Mexiko",
    "south africa": "Südafrika",
    "poland": "Polen",
    "portugal": "Portugal",
    "czech republic": "Tschechien",
    "czechia": "Tschechien",
    "bermuda": "Bermuda",
    "cayman islands": "Kaimaninseln",
    "jersey": "Jersey",
    "isle of man": "Isle of Man",
    "panama": "Panama",
    "chile": "Chile",
    "argentina": "Argentinien",
    "new zealand": "Neuseeland",
    "indonesia": "Indonesien",
    "malaysia": "Malaysia",
    "thailand": "Thailand",
    "philippines": "Philippinen",
    "turkey": "Türkei",
    "united arab emirates": "Vereinigte Arabische Emirate",
    "saudi arabia": "Saudi-Arabien",
    "greece": "Griechenland",
    "hungary": "Ungarn",
    "romania": "Rumänien",
    "slovenia": "Slowenien",
    "slovakia": "Slowakei",
    "estonia": "Estland",
    "lithuania": "Litauen",
    "latvia": "Lettland",
    "iceland": "Island",
    "malta": "Malta",
    "cyprus": "Zypern",
    "monaco": "Monaco",
    "liechtenstein": "Liechtenstein",
    "puerto rico": "Puerto Rico",
}

INDUSTRY_DE = {
    "semiconductors": "Halbleiter",
    "semiconductor equipment & materials": "Halbleiterausrüstung",
    "semiconductor equipment and materials": "Halbleiterausrüstung",
    "consumer electronics": "Unterhaltungselektronik",
    "electronic components": "Elektronikbauteile",
    "electronic equipment & parts": "Elektronikausrüstung",
    "scientific & technical instruments": "Mess- und Präzisionstechnik",
    "software—infrastructure": "Software (Infrastruktur)",
    "software - infrastructure": "Software (Infrastruktur)",
    "software—application": "Anwendungssoftware",
    "software - application": "Anwendungssoftware",
    "software—services": "Software-Dienste",
    "information technology services": "IT-Dienste",
    "information technology services": "IT-Dienste",
    "computer hardware": "Computerhardware",
    "communication equipment": "Kommunikationsausrüstung",
    "telecom services": "Telekommunikation",
    "telecommunications services": "Telekommunikation",
    "internet content & information": "Internetinhalte und Information",
    "internet content and information": "Internetinhalte und Information",
    "internet retail": "Internet-Einzelhandel",
    "entertainment": "Unterhaltung",
    "electronic gaming & multimedia": "Spiele und Multimedia",
    "advertising agencies": "Werbung",
    "publishing": "Verlagswesen",
    "broadcasting": "Rundfunk",
    "drug manufacturers—general": "Arzneimittelhersteller",
    "drug manufacturers—specialty & generic": "Arzneimittelhersteller (Spezial/Generika)",
    "drug manufacturers - general": "Arzneimittelhersteller",
    "drug manufacturers - specialty & generic": "Arzneimittelhersteller (Spezial/Generika)",
    "biotechnology": "Biotechnologie",
    "medical devices": "Medizintechnik",
    "medical instruments & supplies": "Medizinische Instrumente und Verbrauchsmaterial",
    "medical care facilities": "Medizinische Einrichtungen",
    "diagnostics & research": "Diagnostik und Forschung",
    "health information services": "Gesundheitsinformation",
    "healthcare plans": "Krankenversicherungen",
    "pharmaceutical retailers": "Apotheken und Gesundheitseinzelhandel",
    "banks—diversified": "Banken (diversifiziert)",
    "banks—regional": "Regionalbanken",
    "banks - diversified": "Banken (diversifiziert)",
    "banks - regional": "Regionalbanken",
    "banks": "Banken",
    "capital markets": "Kapitalmärkte",
    "asset management": "Vermögensverwaltung",
    "insurance—life": "Lebensversicherung",
    "insurance—property & casualty": "Schadensversicherung",
    "insurance—diversified": "Versicherungen (diversifiziert)",
    "insurance—specialty": "Spezialversicherung",
    "insurance—brokers": "Versicherungsmakler",
    "insurance - life": "Lebensversicherung",
    "insurance - property & casualty": "Schadensversicherung",
    "insurance - diversified": "Versicherungen (diversifiziert)",
    "credit services": "Kreditdienste",
    "financial data & stock exchanges": "Finanzdaten und Börsen",
    "financial conglomerates": "Finanzkonglomerate",
    "mortgage finance": "Hypothekenfinanzierung",
    "shell companies": "Mantelgesellschaften",
    "auto manufacturers": "Automobilhersteller",
    "auto parts": "Autoteile",
    "auto & truck dealerships": "Autohandel",
    "recreational vehicles": "Freizeitfahrzeuge",
    "airlines": "Fluggesellschaften",
    "airports & air services": "Flughäfen und Luftfahrt-Dienste",
    "railroads": "Eisenbahn",
    "trucking": "Straßengüterverkehr",
    "marine shipping": "Seeschifffahrt",
    "integrated freight & logistics": "integrierte Logistik",
    "packaging & containers": "Verpackungen",
    "building products & equipment": "Bauprodukte und Ausrüstung",
    "building materials": "Baustoffe",
    "specialty industrial machinery": "Spezialmaschinenbau",
    "farm & heavy construction machinery": "Land- und Baumaschinen",
    "industrial distribution": "Industrievertrieb",
    "specialty business services": "spezielle Unternehmensdienste",
    "staffing & employment services": "Personaldienstleistungen",
    "consulting services": "Beratung",
    "engineering & construction": "Ingenieurbau",
    "waste management": "Abfallwirtschaft",
    "aerospace & defense": "Luft- und Raumfahrt sowie Verteidigung",
    "electrical equipment & parts": "Elektroausrüstung",
    "electrical equipment & parts": "Elektroausrüstung",
    "tools & accessories": "Werkzeuge und Zubehör",
    "metal fabrication": "Metallverarbeitung",
    "pollution & treatment controls": "Umwelttechnik",
    "security & protection services": "Sicherheitsdienste",
    "rental & leasing services": "Vermietung und Leasing",
    "conglomerates": "Mischkonzerne",
    "oil & gas integrated": "integrierte Öl- und Gasunternehmen",
    "oil & gas e&p": "Öl- und Gasförderung",
    "oil & gas midstream": "Öl- und Gas-Midstream",
    "oil & gas refining & marketing": "Mineralölverarbeitung und Vertrieb",
    "oil & gas equipment & services": "Öl- und Gasausrüstung",
    "thermal coal": "Kraftwerkskohle",
    "uranium": "Uran",
    "utilities—regulated electric": "regulierte Stromversorger",
    "utilities—regulated gas": "regulierte Gasversorger",
    "utilities—regulated water": "regulierte Wasserversorger",
    "utilities—diversified": "diversifizierte Versorger",
    "utilities—renewable": "erneuerbare Versorger",
    "utilities - regulated electric": "regulierte Stromversorger",
    "utilities - regulated gas": "regulierte Gasversorger",
    "utilities - diversified": "diversifizierte Versorger",
    "utilities - renewable": "erneuerbare Versorger",
    "independent power producers": "unabhängige Stromerzeuger",
    "solar": "Solarenergie",
    "gold": "Gold",
    "silver": "Silber",
    "copper": "Kupfer",
    "other industrial metals & mining": "industrielle Metalle und Bergbau",
    "other precious metals & mining": "Edelmetalle und Bergbau",
    "steel": "Stahl",
    "aluminum": "Aluminium",
    "chemicals": "Chemikalien",
    "specialty chemicals": "Spezialchemikalien",
    "agricultural inputs": "Agrarvorprodukte",
    "lumber & wood production": "Holzproduktion",
    "paper & paper products": "Papier",
    "coking coal": "Kokskohle",
    "packaged foods": "verpackte Lebensmittel",
    "beverages—non-alcoholic": "alkoholfreie Getränke",
    "beverages—wineries & distilleries": "Wein und Spirituosen",
    "beverages—brewers": "Brauereien",
    "beverages - non-alcoholic": "alkoholfreie Getränke",
    "beverages - wineries & distilleries": "Wein und Spirituosen",
    "beverages - brewers": "Brauereien",
    "tobacco": "Tabak",
    "confectioners": "Süßwaren",
    "farm products": "Agrarprodukte",
    "grocery stores": "Lebensmittelhandel",
    "discount stores": "Discounter",
    "household & personal products": "Haushalts- und Körperpflegeprodukte",
    "furnishings, fixtures & appliances": "Einrichtung und Haushaltsgeräte",
    "apparel manufacturing": "Bekleidungsherstellung",
    "apparel retail": "Bekleidungseinzelhandel",
    "footwear & accessories": "Schuhe und Accessoires",
    "luxury goods": "Luxusgüter",
    "department stores": "Kaufhäuser",
    "specialty retail": "Fachhandel",
    "home improvement retail": "Baumärkte",
    "restaurants": "Restaurants",
    "resorts & casinos": "Resorts und Casinos",
    "leisure": "Freizeit",
    "travel services": "Reisedienste",
    "lodging": "Beherbergung",
    "gambling": "Glücksspiel",
    "personal services": "persönliche Dienste",
    "education & training services": "Bildung und Schulung",
    "real estate services": "Immobiliendienste",
    "real estate—development": "Projektentwicklung",
    "real estate - development": "Projektentwicklung",
    "real estate—diversified": "diversifizierte Immobilien",
    "reit—office": "Büro-REIT",
    "reit—retail": "Einzelhandels-REIT",
    "reit—residential": "Wohn-REIT",
    "reit—industrial": "Industrie-REIT",
    "reit—healthcare facilities": "Gesundheits-REIT",
    "reit—specialty": "Spezial-REIT",
    "reit—hotel & motel": "Hotel-REIT",
    "reit—diversified": "diversifizierte REIT",
    "reit - office": "Büro-REIT",
    "reit - retail": "Einzelhandels-REIT",
    "reit - residential": "Wohn-REIT",
    "reit - industrial": "Industrie-REIT",
    "reit - healthcare facilities": "Gesundheits-REIT",
    "reit - specialty": "Spezial-REIT",
    "reit - hotel & motel": "Hotel-REIT",
    "reit - diversified": "diversifizierte REIT",
}


def shard_of(ticker: str) -> int:
    h = 0
    for ch in ticker:
        h = (h * 33 + ord(ch)) & 0xFFFFFFFF
    return h % SHARDS


def _country_de(name: str | None) -> str | None:
    if not name:
        return None
    key = " ".join(str(name).replace("\xa0", " ").split()).lower().strip(" .,")
    return COUNTRY_DE.get(key) or (str(name).strip() if str(name).strip() else None)


def _industry_de(name: str | None) -> str | None:
    if not name:
        return None
    raw = " ".join(str(name).replace("\xa0", " ").split())
    key = raw.lower().replace("—", "-").replace("–", "-")
    key = re.sub(r"\s+", " ", key).strip()
    return INDUSTRY_DE.get(key) or INDUSTRY_DE.get(key.replace(" & ", " and ")) or raw


def _num(value):
    try:
        if value is None:
            return None
        if hasattr(value, "item"):
            value = value.item()
        n = float(value)
        if n != n:  # NaN
            return None
        return n
    except (TypeError, ValueError):
        return None


def _year(value) -> int | None:
    n = _num(value)
    if n is None:
        return None
    if n >= 10000:
        try:
            return datetime.fromtimestamp(int(n), timezone.utc).year
        except (OverflowError, OSError, ValueError):
            return None
    y = int(n)
    return y if 1800 <= y <= 2100 else None


def _clean_text(value: str | None, limit: int = 240) -> str | None:
    if not value:
        return None
    text = " ".join(str(value).replace("\xa0", " ").split())
    return text[:limit] if text else None


def _website(url: str | None) -> str | None:
    if not url:
        return None
    text = str(url).strip()
    if not text:
        return None
    if not re.match(r"^https?://", text, re.I):
        text = "https://" + text
    if not re.match(r"^https?://[^\s]+$", text, re.I):
        return None
    return text


def _ceo(officers) -> str | None:
    if not officers:
        return None
    ranked = []
    for item in officers:
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("name"), 80)
        title = str(item.get("title") or "").lower()
        if not name:
            continue
        if (
            "chief executive" in title
            or re.search(r"\bceo\b", title)
            or "vorstandsvorsitz" in title
            or "vorsitzende des vorstands" in title
            or "vorsitzender des vorstands" in title
        ):
            ranked.append(name)
    return ranked[0] if ranked else None


def _sitz(city, state, country_de) -> str | None:
    parts = []
    for item in (city, state, country_de):
        text = _clean_text(item, 80)
        if text and text not in parts:
            parts.append(text)
    return ", ".join(parts) if parts else None


def _profil(name: str, branche: str | None, sektor: str | None, segments: list | None) -> str | None:
    firm = _clean_text(name, 80) or "Das Unternehmen"
    if branche and sektor:
        text = f"{firm} ist in der Branche {branche} im Sektor {sektor} tätig."
    elif branche:
        text = f"{firm} ist in der Branche {branche} tätig."
    elif sektor:
        text = f"{firm} ist im Sektor {sektor} tätig."
    else:
        text = None
    if segments:
        bits = []
        for seg in segments[:8]:
            label = _clean_text(seg.get("n"), 80)
            if not label:
                continue
            share = _num(seg.get("a"))
            if share is not None:
                pct = share * 100 if abs(share) <= 1.5 else share
                bits.append(f"{label} ({pct:.0f} %)" if abs(pct - round(pct)) < 0.05 else f"{label} ({pct:.1f} %)".replace(".", ","))
            else:
                bits.append(label)
        if bits:
            extra = "Die Umsätze entfallen auf: " + ", ".join(bits) + "."
            text = f"{text} {extra}" if text else extra
    return text


def _news_items(raw) -> list[dict]:
    out = []
    if not raw:
        return out
    for item in raw:
        title = None
        url = None
        src = None
        day = None
        if not isinstance(item, dict):
            continue
        content = item.get("content") if isinstance(item.get("content"), dict) else None
        if content:
            title = content.get("title") or content.get("headline")
            for key in ("canonicalUrl", "clickThroughUrl", "previewUrl"):
                block = content.get(key)
                if isinstance(block, dict) and block.get("url"):
                    url = block.get("url")
                    break
                if isinstance(block, str) and block.startswith("http"):
                    url = block
                    break
            provider = content.get("provider")
            if isinstance(provider, dict):
                src = provider.get("displayName") or provider.get("name")
            day = content.get("pubDate") or content.get("displayTime") or content.get("publishedAt")
        title = title or item.get("title") or item.get("headline")
        url = url or item.get("link") or item.get("url")
        src = src or item.get("publisher") or item.get("source")
        ts = item.get("providerPublishTime") or item.get("provider_publish_time")
        if day is None and ts is not None:
            n = _num(ts)
            if n is not None:
                try:
                    day = datetime.fromtimestamp(int(n), timezone.utc).strftime("%Y-%m-%d")
                except (OverflowError, OSError, ValueError):
                    day = None
        if day and not re.match(r"^\d{4}-\d{2}-\d{2}", str(day)):
            try:
                day = datetime.fromisoformat(str(day).replace("Z", "+00:00")).date().isoformat()
            except ValueError:
                day = None
        elif day:
            day = str(day)[:10]
        title = _clean_text(title, 180)
        url = _website(url)
        src = _clean_text(src, 60)
        if not title or not url or not url.lower().startswith("https://"):
            continue
        out.append({"h": title, "u": url, "d": day, "src": src})
        if len(out) >= 3:
            break
    return out


def _exchange(info: dict) -> str | None:
    for key in ("exchange", "fullExchangeName"):
        val = info.get(key)
        if val:
            return str(val).strip()
    return None


def _from_info(info: dict, display: dict) -> dict:
    branche_src = _clean_text(info.get("industry") or info.get("industryDisp"), 80)
    branche = _industry_de(branche_src)
    sektor = display.get("s") or _industry_de(info.get("sector") or info.get("sectorDisp"))
    land = _country_de(info.get("country"))
    sitz = _sitz(info.get("city"), info.get("state"), land)
    employees = _num(info.get("fullTimeEmployees"))
    if employees is not None:
        employees = int(employees)
    rec = {
        "kgv": _num(info.get("trailingPE")),
        "fkgv": _num(info.get("forwardPE")),
        "umsatz_w": _num(info.get("revenueGrowth")),
        "gewinn_w": _num(info.get("earningsGrowth") or info.get("earningsQuarterlyGrowth")),
        "marge": _num(info.get("profitMargins")),
        "div": _num(info.get("dividendYield") or info.get("trailingAnnualDividendYield")),
        "debt": _num(info.get("debtToEquity")),
        "hi": _num(info.get("fiftyTwoWeekHigh")),
        "lo": _num(info.get("fiftyTwoWeekLow")),
        "beta": _num(info.get("beta") or info.get("beta3Year")),
        "branche": branche,
        "sitz": sitz,
        "land": land,
        "jahr": _year(info.get("startDate") or info.get("foundedYear") or info.get("yearFounded")),
        "mitarb": employees,
        "ceo": _ceo(info.get("companyOfficers")),
        "web": _website(info.get("website") or info.get("irWebsite")),
        "segmente": None,
        "ex": _exchange(info),
    }
    rec["profil"] = _profil(display.get("n") or display.get("t"), branche, sektor, rec.get("segmente"))
    return rec


def _load_shards() -> dict[str, dict]:
    rows = {}
    if not PROFILE_DIR.exists():
        return rows
    for path in PROFILE_DIR.glob("s*.json"):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for ticker, rec in (doc.get("rows") or {}).items():
            if isinstance(rec, dict):
                rows[ticker] = rec
    return rows


def _write_shards(rows: dict[str, dict], stamp: str) -> None:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    buckets: dict[int, dict] = {i: {} for i in range(SHARDS)}
    for ticker, rec in rows.items():
        buckets[shard_of(ticker)][ticker] = rec
    for i, part in buckets.items():
        payload = {"updated_at_utc": stamp, "shard": i, "rows": part}
        path = PROFILE_DIR / f"s{i:02d}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def _stale(rec: dict | None, key: str, days: int, today) -> bool:
    if not rec:
        return True
    raw = rec.get(key)
    if not raw:
        return True
    try:
        day = datetime.fromisoformat(str(raw)[:10]).date()
    except ValueError:
        return True
    return (today - day).days >= days


def _fetch_one(yahoo: str) -> tuple[dict | None, list]:
    ticker = yf.Ticker(yahoo)
    info = {}
    try:
        if hasattr(ticker, "get_info"):
            info = ticker.get_info() or {}
        else:
            info = ticker.info or {}
    except Exception:
        info = {}
    news = []
    try:
        if hasattr(ticker, "get_news"):
            news = ticker.get_news(count=5) or []
        else:
            news = ticker.news or []
    except Exception:
        news = []
    if not info and not news:
        return None, []
    return info, news


def write_profiles(budget_s: float = 360.0) -> Path:
    """Refresh fundamentals often, company master about weekly. Incremental, so a timeout keeps progress."""
    book = load_universe()
    display = {rec["t"]: rec for rec in book.values()}
    today = datetime.now(timezone.utc).date()
    rows = _load_shards()
    jobs = []
    for rec in book.values():
        t = rec["t"]
        old = rows.get(t)
        need_master = _stale(old, "master", MASTER_DAYS, today)
        need_fund = _stale(old, "fund", FUND_DAYS, today) or need_master
        if not need_fund and not need_master:
            continue
        # Prefer S&P 500 and DAX so the live checks have data first.
        rank = 0
        ix = rec.get("ix") or []
        if "SPX" in ix:
            rank = 0
        elif "DAX" in ix:
            rank = 1
        elif "NDX" in ix or "DJI" in ix:
            rank = 2
        else:
            rank = 3
        missing = 0 if old is None else 1
        jobs.append((missing, rank, t, rec["yf"], need_master))
    jobs.sort()
    print(f"Profile: {len(jobs)} von {len(book)} zu aktualisieren, Budget {budget_s:.0f}s", flush=True)
    t0 = time.time()
    done = 0
    ok = 0
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def one(job):
        _missing, _rank, display_t, yahoo, need_master = job
        info, news = _fetch_one(yahoo)
        return display_t, need_master, info, news

    pool = ThreadPoolExecutor(max_workers=6)
    try:
        futs = {pool.submit(one, job): job[2] for job in jobs}
        for fut in as_completed(futs, timeout=max(30, budget_s)):
            if time.time() - t0 > budget_s:
                break
            done += 1
            try:
                display_t, need_master, info, news = fut.result(timeout=20)
            except Exception as e:  # noqa: BLE001
                print(f"  warn Profil {futs[fut]}: {e!r}", flush=True)
                continue
            rec = dict(rows.get(display_t) or {})
            if info:
                fresh = _from_info(info, display[display_t])
                rec.update({k: v for k, v in fresh.items() if v is not None or k not in rec})
                rec["fund"] = today.isoformat()
                if need_master:
                    rec["master"] = today.isoformat()
            news_items = _news_items(news)
            if news_items:
                rec["news"] = news_items
            rec["t"] = display_t
            rows[display_t] = rec
            if info or news_items:
                ok += 1
            if done % 40 == 0:
                _write_shards(rows, stamp)
                print(f"  Profile {done}/{len(jobs)} ok {ok}", flush=True)
    except TimeoutError:
        print("  Profile: Zeitbudget erreicht", flush=True)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    _write_shards(rows, stamp)
    size = sum(p.stat().st_size for p in PROFILE_DIR.glob("s*.json"))
    print(f"Profile gespeichert: {len(rows)} Titel, {ok} aktualisiert, {size/1024:.0f} KB", flush=True)
    return PROFILE_DIR


if __name__ == "__main__":
    write_profiles()
