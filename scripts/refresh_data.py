#!/usr/bin/env python3
"""Weekday refresh for the Global Yield Matrix and related panels.

Free sources only. No API key is required. A Banque de France Webstat key
(WEBSTAT_API_KEY) is optional and fills French tenors other than the 10-year TEC.

The script keeps the previous value for a market when a fetch fails or looks
implausible. It never interpolates a missing tenor.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
UA = "tzofeh-dashboard/1.0 (public market data; +https://tzofeh.vercel.app)"
TENORS = ["1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "30Y"]


def fetch(url: str, timeout: int = 45, user_agent: str | None = None) -> bytes:
    req = Request(url, headers={"User-Agent": user_agent or UA, "Accept": "*/*"})
    with urlopen(req, timeout=timeout) as res:
        return res.read()


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def num(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", ".")
    if text in {"", ".", "-", "NA", "N/A", "null"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def sane(value: float | None) -> float | None:
    if value is None:
        return None
    if value < -1 or value > 20:
        return None
    return round(value, 4)


def country(code, as_of, source, source_url, method, yields, gaps, note):
    clean = {}
    for tenor in TENORS:
        clean[tenor] = sane(yields.get(tenor))
    return {
        "code": code,
        "asOf": as_of,
        "source": source,
        "sourceUrl": source_url,
        "method": method,
        "note": note,
        "yields": clean,
        "gaps": gaps,
    }


def parse_iso(text: str) -> datetime | None:
    text = (text or "").strip()
    month_only = re.fullmatch(r"(\d{4})-(\d{2})", text)
    if month_only:
        year, month = int(month_only.group(1)), int(month_only.group(2))
        if 1 <= month <= 12:
            if month == 12:
                return datetime(year, 12, 31)
            return datetime(year, month + 1, 1) - timedelta(days=1)
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d-%b-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def asof_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return parse_iso(value[:10]) or parse_iso(value[:7])


def too_old(as_of: str, days: int) -> bool:
    parsed = parse_iso(as_of[:10])
    if not parsed:
        return True
    age = datetime.now(timezone.utc).date() - parsed.date()
    return age.days > days


def fetch_us():
    year = datetime.now(timezone.utc).year
    url = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        f"daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
        f"&field_tdr_date_value={year}&page&_format=csv"
    )
    text = fetch(url).decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    best = None
    for row in rows:
        when = parse_iso(row.get("Date", ""))
        if not when:
            continue
        if best is None or when > best[0]:
            best = (when, row)
    if not best:
        raise RuntimeError("US Treasury CSV had no dated rows")
    when, row = best
    mapping = {
        "1Y": "1 Yr",
        "2Y": "2 Yr",
        "3Y": "3 Yr",
        "5Y": "5 Yr",
        "7Y": "7 Yr",
        "10Y": "10 Yr",
        "30Y": "30 Yr",
    }
    yields = {k: num(row.get(v)) for k, v in mapping.items()}
    return country(
        "US",
        when.strftime("%Y-%m-%d"),
        "U.S. Treasury daily par yield curve",
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
        "Par yield, percent per annum",
        yields,
        {},
        "Constant-maturity par yields published by the U.S. Treasury.",
    )


def fetch_ca():
    series = ",".join(
        [
            "BD.CDN.2YR.DQ.YLD",
            "BD.CDN.3YR.DQ.YLD",
            "BD.CDN.5YR.DQ.YLD",
            "BD.CDN.7YR.DQ.YLD",
            "BD.CDN.10YR.DQ.YLD",
            "BD.CDN.LONG.DQ.YLD",
        ]
    )
    url = f"https://www.bankofcanada.ca/valet/observations/{series}/json?recent=8"
    data = json.loads(fetch(url).decode("utf-8"))
    obs = data.get("observations") or []
    if not obs:
        raise RuntimeError("Bank of Canada returned no observations")
    # Valet returns the newest observation first. Pick by date either way.
    latest = max(obs, key=lambda row: row.get("d") or "")
    keys = {
        "2Y": "BD.CDN.2YR.DQ.YLD",
        "3Y": "BD.CDN.3YR.DQ.YLD",
        "5Y": "BD.CDN.5YR.DQ.YLD",
        "7Y": "BD.CDN.7YR.DQ.YLD",
        "10Y": "BD.CDN.10YR.DQ.YLD",
        "30Y": "BD.CDN.LONG.DQ.YLD",
    }
    yields = {tenor: num((latest.get(key) or {}).get("v")) for tenor, key in keys.items()}
    yields["1Y"] = None
    return country(
        "CA",
        latest["d"],
        "Bank of Canada benchmark bond yields",
        "https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/",
        "Benchmark bond yield, percent",
        yields,
        {"1Y": "not_published"},
        "The Bank of Canada does not publish a 1-year benchmark bond. The long-term benchmark is the 30-year point.",
    )


def fetch_de():
    codes = {
        "1Y": "R01XX",
        "2Y": "R02XX",
        "3Y": "R03XX",
        "5Y": "R05XX",
        "7Y": "R07XX",
        "10Y": "R10XX",
        "30Y": "R30XX",
    }
    yields = {}
    as_of = None
    for tenor, code in codes.items():
        url = (
            "https://api.statistiken.bundesbank.de/rest/data/BBSIS/"
            f"D.I.ZAR.ZI.EUR.S1311.B.A604.{code}.R.A.A._Z._Z.A"
            "?lastNObservations=6&format=csv"
        )
        text = fetch(url).decode("utf-8-sig")
        found = None
        for line in text.splitlines():
            match = re.match(r"(\d{4}-\d{2}-\d{2});([^;]*)", line)
            if not match:
                continue
            value = num(match.group(2))
            if value is None:
                continue
            found = (match.group(1), value)
        if not found:
            raise RuntimeError(f"Bundesbank had no value for {tenor}")
        as_of = found[0]
        yields[tenor] = found[1]
    return country(
        "DE",
        as_of,
        "Deutsche Bundesbank, listed federal securities",
        "https://www.bundesbank.de/en/statistics/money-and-capital-markets/interest-rates-and-yields/daily-term-structure-on-listed-federal-securities-651570",
        "Par yield from the Svensson curve, annual coupon, percent",
        yields,
        {},
        "Yields derived from the Bundesbank term structure for listed federal securities with annual coupon payments.",
    )


def _boe_spot_row():
    url = "https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/latest-yield-curve-data.zip"
    blob = fetch(url)
    archive = zipfile.ZipFile(io.BytesIO(blob))
    name = next(n for n in archive.namelist() if "Nominal" in n and n.endswith(".xlsx"))
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(archive.read(name)), data_only=True)
    ws = wb["4. spot curve"]
    columns = {}
    for col in range(1, ws.max_column + 1):
        year = ws.cell(4, col).value
        if isinstance(year, (int, float)) and float(year) in {1, 2, 3, 5, 7, 10, 30}:
            columns[f"{int(year)}Y"] = col
    last = None
    for row in range(6, ws.max_row + 1):
        when = ws.cell(row, 1).value
        if isinstance(when, datetime):
            last = (when, row)
    if not last or len(columns) < 7:
        raise RuntimeError("Bank of England spot curve was incomplete")
    when, row = last
    yields = {tenor: num(ws.cell(row, col).value) for tenor, col in columns.items()}
    return when.strftime("%Y-%m-%d"), yields


def fetch_gb():
    as_of, yields = _boe_spot_row()
    return country(
        "GB",
        as_of,
        "Bank of England nominal gilt spot curve",
        "https://www.bankofengland.co.uk/statistics/yield-curves",
        "Fitted zero-coupon spot rate, percent",
        yields,
        {},
        "Anderson–Sleath fitted nominal government spot curve. This is a spot rate, not a coupon-bond par yield.",
    )


def _webstat_last(series: str, api_key: str):
    url = (
        "https://api.webstat.banque-france.fr/webstat-fr/v1/data/FM/"
        f"{series}?format=json&detail=dataonly&lastNObservations=5"
    )
    req = Request(url, headers={"User-Agent": UA, "Authorization": f"Apikey {api_key}", "Accept": "application/json"})
    with urlopen(req, timeout=45) as res:
        payload = json.loads(res.read().decode("utf-8"))
    # SDMX-JSON observations live under dataSets; fall back to a flat scan.
    text = json.dumps(payload)
    dates = re.findall(r"(20\d\d-\d\d-\d\d)", text)
    values = re.findall(r'"obsValue"\s*:\s*"?(-?\d+(?:\.\d+)?)"?', text)
    if not dates or not values:
        values = re.findall(r"(-?\d+\.\d+)", text)
    if not dates or not values:
        raise RuntimeError(f"Webstat parse failed for {series}")
    return dates[-1], float(values[-1])


def fetch_fr():
    api_key = os.environ.get("WEBSTAT_API_KEY", "").strip()
    yields = {tenor: None for tenor in TENORS}
    gaps = {}
    as_of = None
    source = "Banque de France TEC 10, via comptespublics.fr"
    source_url = "https://comptespublics.fr/series/tec-10"
    method = "Constant-maturity yield, percent"
    note = (
        "Only the 10-year TEC is in the keyless public republication of Banque de France data. "
        "Other tenors are left blank. A free Webstat API key fills them on the weekday job."
    )
    if api_key:
        keys = {
            "1Y": "FM.D.FR.EUR.FR2.BB.FRMOYTEC1.HSTA",
            "2Y": "FM.D.FR.EUR.FR2.BB.FRMOYTEC2.HSTA",
            "3Y": "FM.D.FR.EUR.FR2.BB.FRMOYTEC3.HSTA",
            "5Y": "FM.D.FR.EUR.FR2.BB.FRMOYTEC5.HSTA",
            "7Y": "FM.D.FR.EUR.FR2.BB.FRMOYTEC7.HSTA",
            "10Y": "FM.D.FR.EUR.FR2.BB.FRMOYTEC10.HSTA",
            "30Y": "FM.D.FR.EUR.FR2.BB.FRMOYTEC30.HSTA",
        }
        got = 0
        for tenor, series in keys.items():
            try:
                when, value = _webstat_last(series, api_key)
                yields[tenor] = value
                as_of = when
                got += 1
            except Exception as exc:
                print(f"  FR {tenor} webstat: {exc}", file=sys.stderr)
                gaps[tenor] = "not_in_feed"
        if got:
            source = "Banque de France Webstat, taux de l'échéance constante"
            source_url = "https://webstat.banque-france.fr/en/catalogue/fm/FM.D.FR.EUR.FR2.BB.FRMOYTEC10.HSTA"
            note = "Constant-maturity French government yields (TEC) from Banque de France Webstat."
            return country("FR", as_of, source, source_url, method, yields, gaps, note)

    text = fetch("https://comptespublics.fr/series/tec-10/donnees.csv").decode("utf-8")
    last = None
    for row in csv.DictReader(io.StringIO(text)):
        if row.get("periode") and row.get("valeur"):
            last = row
    if not last:
        raise RuntimeError("French TEC 10 feed was empty")
    yields["10Y"] = num(last["valeur"])
    for tenor in TENORS:
        if tenor != "10Y":
            gaps[tenor] = "not_in_feed"
    return country("FR", last["periode"], source, source_url, method, yields, gaps, note)


_IT_MONTHS = (
    ("january", 1),
    ("february", 2),
    ("march", 3),
    ("april", 4),
    ("may", 5),
    ("june", 6),
    ("july", 7),
    ("august", 8),
    ("september", 9),
    ("october", 10),
    ("november", 11),
    ("december", 12),
    ("jan", 1),
    ("feb", 2),
    ("mar", 3),
    ("apr", 4),
    ("jun", 6),
    ("jul", 7),
    ("aug", 8),
    ("sept", 9),
    ("sep", 9),
    ("oct", 10),
    ("nov", 11),
    ("dec", 12),
)


def _italy_from_pdf(blob: bytes):
    from pypdf import PdfReader

    text = "\n".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(blob)).pages)
    # BMK0100 columns: 3-year, 5-year, 10-year, 30-year BTP, then CCTs.
    best = None
    for line in text.splitlines():
        low = line.lower()
        month = next((num for name, num in _IT_MONTHS if re.search(rf"\b{name}\b", low)), None)
        if not month:
            continue
        nums = [float(x) for x in re.findall(r"\d+\.\d+", line)]
        if len(nums) < 4:
            continue
        if best is None or month >= best[0]:
            best = (month, nums)
    if not best:
        raise RuntimeError("Italian bulletin had no monthly yield row")
    month, nums = best
    now = datetime.now(timezone.utc)
    year = now.year if month <= now.month else now.year - 1
    yields = {"1Y": None, "2Y": None, "3Y": nums[0], "5Y": nums[1], "7Y": None, "10Y": nums[2], "30Y": nums[3]}
    return f"{year}-{month:02d}", yields


def _italy_fallback():
    # Verified from Banca d'Italia table BMK0100 in the 15 October 2026 bulletin.
    # The PDF download returns 404 from the weekday runner, so this seed is used
    # until a bulletin can be parsed. CCT yields are not a matrix tenor.
    return country(
        "IT",
        "2026-09",
        "Banca d'Italia benchmark government securities",
        "https://www.bancaditalia.it/pubblicazioni/mercato-finanziario/2026-mercato-finanziario/en_statistiche_MFN_20261015.pdf",
        "Monthly average gross yield to maturity, percent",
        {"1Y": None, "2Y": None, "3Y": 3.564, "5Y": 3.797, "7Y": None, "10Y": 4.362, "30Y": 5.010},
        {"1Y": "not_published", "2Y": "not_published", "7Y": "not_published"},
        "September 2026 monthly averages from Banca d'Italia table BMK0100, published 15 October 2026. "
        "The bulletin PDF could not be downloaded automatically, so this row is that verified table rather than a fresh parse. "
        "1Y, 2Y and 7Y are not in the table.",
    )


def fetch_it():
    today = datetime.now(timezone.utc).date()
    last_err = None
    browser = "Mozilla/5.0 (compatible; tzofeh-dashboard/1.0)"
    for offset in range(0, 21):
        day = today - timedelta(days=offset)
        url = (
            "https://www.bancaditalia.it/pubblicazioni/mercato-finanziario/"
            f"{day.year}-mercato-finanziario/en_statistiche_MFN_{day.strftime('%Y%m%d')}.pdf"
        )
        for agent in (browser, UA):
            try:
                blob = fetch(url, timeout=20, user_agent=agent)
            except Exception as exc:
                last_err = exc
                continue
            if blob[:4] != b"%PDF":
                continue
            as_of, yields = _italy_from_pdf(blob)
            month_name = datetime.strptime(as_of, "%Y-%m").strftime("%B %Y")
            return country(
                "IT",
                as_of,
                "Banca d'Italia benchmark government securities",
                url,
                "Monthly average gross yield to maturity, percent",
                yields,
                {"1Y": "not_published", "2Y": "not_published", "7Y": "not_published"},
                f"{month_name} monthly averages of 3-, 5-, 10- and 30-year benchmark BTP yields from table BMK0100. "
                "Not a daily curve. 1Y, 2Y and 7Y are not in that table.",
            )
    print(f"  IT bulletin download failed ({last_err}); using the verified September 2026 table", file=sys.stderr)
    return _italy_fallback()


def fetch_jp():
    url = "https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv"
    raw = fetch(url)
    text = None
    for encoding in ("cp932", "shift_jis", "utf-8"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = raw.decode("utf-8", "replace")
    best = None
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        match = re.match(r"R(\d+)\.(\d+)\.(\d+)", parts[0] if parts else "")
        if not match or len(parts) < 16:
            continue
        year = 2018 + int(match.group(1))
        when = datetime(year, int(match.group(2)), int(match.group(3)))
        # Columns: date, 1,2,3,4,5,6,7,8,9,10,15,20,25,30,40
        indexes = {"1Y": 1, "2Y": 2, "3Y": 3, "5Y": 5, "7Y": 7, "10Y": 10, "30Y": 14}
        yields = {tenor: num(parts[i]) for tenor, i in indexes.items()}
        if best is None or when > best[0]:
            best = (when, yields)
    if not best:
        raise RuntimeError("Japan MOF CSV had no Reiwa rows")
    when, yields = best
    return country(
        "JP",
        when.strftime("%Y-%m-%d"),
        "Japan Ministry of Finance JGB interest rates",
        "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm",
        "JGB yield, percent",
        yields,
        {},
        "Daily Japanese government bond yields published by the Ministry of Finance.",
    )


def fetch_au():
    url = "https://www.rba.gov.au/statistics/tables/csv/f2-data.csv"
    text = fetch(url).decode("utf-8-sig")
    best = None
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        when = parse_iso(parts[0]) if parts else None
        if not when or len(parts) < 5:
            continue
        yields = {
            "1Y": None,
            "2Y": num(parts[1]),
            "3Y": num(parts[2]),
            "5Y": num(parts[3]),
            "7Y": None,
            "10Y": num(parts[4]),
            "30Y": None,
        }
        if yields["10Y"] is None:
            continue
        if best is None or when > best[0]:
            best = (when, yields)
    if not best:
        raise RuntimeError("RBA F2 had no yield rows")
    when, yields = best
    return country(
        "AU",
        when.strftime("%Y-%m-%d"),
        "Reserve Bank of Australia statistical table F2",
        "https://www.rba.gov.au/statistics/tables/",
        "Interpolated Australian government bond yield, percent per annum",
        yields,
        {"1Y": "not_published", "7Y": "not_published", "30Y": "not_published"},
        "Table F2 publishes 2-, 3-, 5- and 10-year yields only.",
    )


def fetch_cn():
    url = "https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/more?locale=en_US"
    html = fetch(url).decode("utf-8", "replace")
    row = re.search(r"ChinaBond Government Bond Yield Curve</td>(.*?)</tr>", html, re.S)
    if not row:
        raise RuntimeError("ChinaBond government row was missing")
    row_html = re.sub(r"<!--.*?-->", "", row.group(1), flags=re.S)
    nums = [float(x) for x in re.findall(r"<td[^>]*>\s*([0-9]+\.[0-9]+)\s*</td>", row_html)]
    # Public curve columns: 3M, 6M, 1Y, 3Y, 5Y, 7Y, 10Y, 30Y. No 2Y.
    # A commented cell sits in front of 3M; it must not shift the tenors.
    if len(nums) != 8:
        raise RuntimeError(f"ChinaBond row had {len(nums)} numbers, expected 8")
    date_match = re.search(r'id="gzr"[^>]*value="(20\d\d-\d\d-\d\d)"', html) or re.search(
        r"(20\d\d-\d\d-\d\d)\(%\)", html
    )
    if not date_match:
        date_match = re.search(r"(20\d\d-\d\d-\d\d)", html)
    yields = {
        "1Y": nums[2],
        "2Y": None,
        "3Y": nums[3],
        "5Y": nums[4],
        "7Y": nums[5],
        "10Y": nums[6],
        "30Y": nums[7],
    }
    return country(
        "CN",
        date_match.group(1) if date_match else "",
        "ChinaBond government bond yield curve (CCDC)",
        url,
        "Yield to maturity, percent",
        yields,
        {"2Y": "not_published"},
        "The public ChinaBond government curve shows 3M, 6M, 1Y, 3Y, 5Y, 7Y, 10Y and 30Y. There is no 2Y point on that page.",
    )


def fetch_in():
    today = datetime.now(timezone.utc).date()
    last_err = None
    for offset in range(0, 12):
        day = today - timedelta(days=offset)
        url = f"https://www.fbil.org.in/wasdm/gsec/downloadPublished?date={day.isoformat()}"
        try:
            blob = fetch(url, timeout=30)
        except Exception as exc:
            last_err = exc
            continue
        if blob[:2] != b"PK":
            continue
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(blob), data_only=True)
        ws = wb["Par Yield"]
        as_of = None
        for row in range(1, 6):
            for col in range(1, 4):
                value = ws.cell(row, col).value
                if isinstance(value, str) and re.match(r"\d{2}-[A-Za-z]{3}-\d{4}", value):
                    as_of = datetime.strptime(value, "%d-%b-%Y").strftime("%Y-%m-%d")
        yields = {tenor: None for tenor in TENORS}
        for row in range(6, ws.max_row + 1):
            tenor = ws.cell(row, 1).value
            if tenor in (1, 2, 3, 5, 7, 10, 30):
                yields[f"{int(tenor)}Y"] = num(ws.cell(row, 2).value)
        if not as_of or yields["10Y"] is None:
            continue
        return country(
            "IN",
            as_of,
            "Financial Benchmarks India G-Sec par yield curve",
            "https://www.fbil.org.in/",
            "Par yield, semi-annual YTM, percent per annum",
            yields,
            {},
            "FBIL par-yield curve. The figure used is the published semi-annual YTM, not the annualized column.",
        )
    raise RuntimeError(f"FBIL par yield was unavailable ({last_err})")


FETCHERS = [fetch_us, fetch_ca, fetch_gb, fetch_de, fetch_fr, fetch_it, fetch_jp, fetch_au, fetch_cn, fetch_in]


def merge_country(fresh: dict | None, previous: dict | None, daily_max_age: int) -> dict | None:
    if fresh is None:
        return previous
    fresh_dt = asof_dt(fresh.get("asOf"))
    prev_dt = asof_dt(previous.get("asOf")) if previous else None
    if previous and fresh_dt and prev_dt and fresh_dt < prev_dt:
        print(f"  {fresh['code']} as-of {fresh.get('asOf')} is older than stored {previous.get('asOf')}; keeping previous")
        return previous
    limit = 45 if fresh["code"] == "IT" else daily_max_age
    if too_old(fresh.get("asOf") or "", limit):
        print(f"  {fresh['code']} as-of {fresh.get('asOf')} is stale; keeping previous", file=sys.stderr)
        return previous or fresh
    if any(fresh["yields"].get(t) is not None and sane(fresh["yields"][t]) is None for t in TENORS):
        return previous or fresh
    return fresh


def refresh_yields() -> bool:
    path = DATA / "yields.json"
    previous = load_json(path) or {}
    by_code = {row["code"]: row for row in previous.get("countries", [])}
    countries = []
    for fn in FETCHERS:
        code = fn.__name__.replace("fetch_", "").upper()
        try:
            fresh = fn()
            print(f"  {fresh['code']} {fresh['asOf']} ok")
        except Exception as exc:
            print(f"  {code} failed: {exc}", file=sys.stderr)
            fresh = None
        merged = merge_country(fresh, by_code.get(code if fresh is None else fresh["code"]), 14)
        if merged:
            countries.append(merged)
    order = ["US", "CA", "GB", "DE", "FR", "IT", "JP", "AU", "CN", "IN"]
    countries.sort(key=lambda row: order.index(row["code"]) if row["code"] in order else 99)
    payload = {
        "tenors": TENORS,
        "countries": countries,
        "compoundingNote": "Yields are shown as each source publishes them. Compounding conventions differ by market and are not converted.",
    }
    changed = json.dumps(previous.get("countries"), sort_keys=True) != json.dumps(countries, sort_keys=True)
    if changed or not path.exists():
        payload["fetchedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        dump_json(path, payload)
    return changed or not path.exists()


def _boc_target():
    data = json.loads(fetch("https://www.bankofcanada.ca/valet/observations/V39079/json?recent=5").decode("utf-8"))
    obs = max(data["observations"], key=lambda row: row.get("d") or "")
    return obs["d"], num(obs["V39079"]["v"])


def confirm_policy_rates() -> bool:
    path = DATA / "central-banks.json"
    payload = load_json(path)
    if not payload:
        return False
    changed = False
    checked = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        when, rate = _boc_target()
        for bank in payload["banks"]:
            if bank["id"] == "boc" and rate is not None:
                feed = {"source": "Bank of Canada Valet V39079", "asOf": when, "value": rate}
                mismatch = abs(rate - bank["rateValue"]) >= 0.01
                previous_feed = bank.get("rateFeed") or {}
                if previous_feed.get("asOf") == when and previous_feed.get("value") == rate and bool(bank.get("needsReview")) == mismatch:
                    continue
                bank["rateCheckedOn"] = checked
                bank["rateFeed"] = feed
                if mismatch:
                    bank["needsReview"] = True
                    bank["feedNote"] = (
                        f"Valet overnight target was {rate:.2f}% on {when}, different from the stored decision. "
                        "The decision text was left unchanged."
                    )
                else:
                    bank.pop("needsReview", None)
                    bank.pop("feedNote", None)
                changed = True
    except Exception as exc:
        print(f"  policy check BoC: {exc}", file=sys.stderr)
    if changed:
        dump_json(path, payload)
    return changed


def refresh_arena() -> bool:
    """Best-effort scrape. A blocked page keeps the committed snapshot."""
    path = DATA / "ai-race.json"
    if not path.exists():
        return False
    try:
        html = fetch("https://arena.ai/leaderboard/agent", timeout=30).decode("utf-8", "replace")
    except Exception as exc:
        print(f"  arena scrape skipped: {exc}", file=sys.stderr)
        return False
    if "Claude" not in html or "Net Improvement" not in html and "net improvement" not in html.lower():
        print("  arena page had no leaderboard table; keeping snapshot", file=sys.stderr)
        return False
    rows = []
    for match in re.finditer(
        r"<tr[\s\S]*?</tr>",
        html,
    ):
        cells = re.findall(r"<t[dh][^>]*>([\s\S]*?)</t[dh]>", match.group(0))
        cells = [re.sub(r"<[^>]+>", " ", cell) for cell in cells]
        cells = [re.sub(r"\s+", " ", cell).strip() for cell in cells]
        if len(cells) < 3 or not re.match(r"\d+", cells[0]):
            continue
        rank = int(re.match(r"\d+", cells[0]).group(0))
        score = re.search(r"-?\d+(?:\.\d+)?%", cells[2] if len(cells) > 2 else "")
        if not score:
            continue
        rows.append({"rank": rank, "raw": cells})
    if len(rows) < 10:
        print(f"  arena parse found {len(rows)} rows; keeping snapshot", file=sys.stderr)
        return False
    print(f"  arena parse found {len(rows)} rows but the snapshot is kept unless the table structure is stable")
    return False


def main() -> int:
    print("Refreshing yields")
    yields_changed = refresh_yields()
    print("Checking policy rates")
    policy_changed = confirm_policy_rates()
    print("Trying Arena leaderboard")
    arena_changed = refresh_arena()
    print("yields" if yields_changed else "yields unchanged", "policy" if policy_changed else "policy unchanged")
    return 0 if (yields_changed or policy_changed or arena_changed or True) else 0


if __name__ == "__main__":
    sys.exit(main())
