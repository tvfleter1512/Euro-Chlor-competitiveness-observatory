"""Trade-defence watch — weekly scan for new cases on the basket products.

Four public sources, newest items only (LOOKBACK_DAYS):
- EU Official Journal titles via the Publications Office SPARQL endpoint
  (EUR-Lex itself refuses automated requests);
- US Federal Register API (Commerce/ITA and USITC notices);
- UK Trade Remedies Authority news via the GOV.UK search API;
- Google News RSS, which catches other jurisdictions (India DGTR, Brazil,
  Mexico, China MOFCOM, Korea KTC, GCC...) through trade-press reports.

A headline becomes a signal when it names a trade-defence instrument AND a
basket product. Signals land in td_signal (one row per URL) for a human to
read and, where real, add to config/trade_defence.yaml; the dashboard hides
signals whose URL is already cited there. The notifier appends unseen signals
to the alert digest. Nothing here edits the measures list.
"""
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import httpx

from observatory import db

log = logging.getLogger(__name__)

LOOKBACK_DAYS = 120
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0 Safari/537.36"}

# product key (config/trade_defence.yaml) -> headline patterns
PRODUCTS = {
    "caustic_soda": r"caustic soda|sodium hydroxide|\blye\b",
    "pvc": r"polyvinyl chloride|poly\(vinyl chloride\)|\bs-?pvc\b|\bpvc\b|pvc (?:suspension|paste) resin",
    "edc": r"ethylene dichloride|1,2-dichloroethane|\bedc\b",
    "vcm": r"vinyl chloride monomer|\bvcm\b",
    "chlorine": r"\bchlorine\b",
    "hydrochloric_acid": r"hydrochloric acid",
    "hypochlorite": r"sodium hypochlorite",
    "sodium_chlorate": r"sodium chlorate",
    "isocyanates": r"isocyanate|\bmdi\b|\btdi\b",
    "polyurethanes": r"polyurethane",
    "polycarbonate": r"polycarbonate",
    "epichlorohydrin": r"epichlorohydrin",
    "epoxy_resins": r"epoxy resin|epoxide resin",
}
INSTRUMENT = r"anti-?dumping|antidumping|dumping|countervailing|anti-?subsidy|safeguard|trade remed"
NEWS_QUERIES = ['"anti-dumping" "caustic soda"', '"anti-dumping" PVC', '"anti-dumping" "polyvinyl chloride"',
                '"anti-dumping" "ethylene dichloride"', '"anti-dumping" "vinyl chloride"',
                '"countervailing" PVC', '"safeguard" PVC', '"anti-dumping" "sodium chlorate"',
                '"anti-dumping" chlorine', '"anti-dumping" MDI', '"anti-dumping" "toluene diisocyanate"',
                '"anti-dumping" polycarbonate', '"anti-dumping" "epoxy resins"', '"anti-dumping" epichlorohydrin']
FR_TERMS = ["polyvinyl chloride", "sodium hydroxide", "caustic soda", "ethylene dichloride",
            "vinyl chloride", "sodium chlorate", "chlorinated isocyanurates",
            "diisocyanate", "polycarbonate", "epoxy resins", "epichlorohydrin"]


def match_products(title: str) -> list[str]:
    t = title.lower()
    return [k for k, pat in PRODUCTS.items() if re.search(pat, t)]


def is_signal(title: str) -> list[str]:
    """Products named in a headline that also names a trade-defence instrument, else []."""
    return match_products(title) if re.search(INSTRUMENT, title.lower()) else []


def _eu(client, since):
    query = f"""PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT ?celex ?date ?title WHERE {{
 ?w cdm:resource_legal_id_celex ?celex ; cdm:work_date_document ?date .
 ?e cdm:expression_belongs_to_work ?w ; cdm:expression_title ?title .
 FILTER(?date >= "{since}"^^<http://www.w3.org/2001/XMLSchema#date>)
 FILTER(LANG(?title) = "en")
 FILTER(CONTAINS(LCASE(STR(?title)), "dumping") || CONTAINS(LCASE(STR(?title)), "subsid")
        || CONTAINS(LCASE(STR(?title)), "safeguard"))
}} LIMIT 2000"""   # the endpoint returns nothing for REGEX filters; CONTAINS works
    r = client.get("https://publications.europa.eu/webapi/rdf/sparql",
                   params={"query": query, "format": "application/sparql-results+json"}, timeout=120)
    r.raise_for_status()
    for b in r.json()["results"]["bindings"]:
        celex = b["celex"]["value"]
        yield ("EU Official Journal", b["title"]["value"],
               f"https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:{celex}", b["date"]["value"])


def _us(client, since):
    for term in FR_TERMS:
        r = client.get("https://www.federalregister.gov/api/v1/documents.json", params={
            "conditions[term]": f'"{term}"', "conditions[publication_date][gte]": since,
            "conditions[agencies][]": ["international-trade-administration", "international-trade-commission"],
            "fields[]": ["title", "html_url", "publication_date", "abstract"], "per_page": 100}, timeout=60)
        r.raise_for_status()
        for d in r.json().get("results", []):
            # FR titles often omit the instrument ('... From Egypt: Final Determination'), so
            # match the product in the title + abstract and accept any Commerce/ITC notice
            text = f"{d['title']} {d.get('abstract') or ''}"
            if match_products(text):
                yield ("US Federal Register", d["title"], d["html_url"], d["publication_date"])


def _uk(client, since):
    r = client.get("https://www.gov.uk/api/search.json", params={
        "filter_organisations": "trade-remedies-authority", "count": 100, "order": "-public_timestamp",
        "fields": ["title", "link", "public_timestamp"]}, timeout=60)
    r.raise_for_status()
    for d in r.json().get("results", []):
        published = (d.get("public_timestamp") or "")[:10]
        if published >= since and match_products(d["title"]):
            yield ("UK Trade Remedies Authority", d["title"], "https://www.gov.uk" + d["link"], published)


def _news(client, since):
    days = (date.today() - date.fromisoformat(since)).days
    for q in NEWS_QUERIES:
        url = f"https://news.google.com/rss/search?q={quote_plus(q + f' when:{days}d')}&hl=en-US&gl=US&ceid=US:en"
        r = client.get(url, timeout=60)
        r.raise_for_status()
        for item in ET.fromstring(r.text).iter("item"):
            title = item.findtext("title") or ""
            try:
                published = parsedate_to_datetime(item.findtext("pubDate")).date().isoformat()
            except (TypeError, ValueError):
                published = None
            yield ("Google News", title, item.findtext("link"), published)
        time.sleep(1)


SOURCES = [_eu, _us, _uk, _news]


def run() -> dict:
    since = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    found, errors = [], []
    with httpx.Client(headers=UA, follow_redirects=True) as client:
        for source in SOURCES:
            try:
                for src, title, url, published in source(client, since):
                    products = is_signal(title) if src in ("Google News", "EU Official Journal") \
                        else match_products(title) or ["unspecified"]
                    if products and url:
                        found.append((src, title.strip(), url, published, products))
            except Exception as exc:   # one source failing must not stop the others
                log.exception("td watch: %s failed", source.__name__)
                errors.append(f"{source.__name__}: {exc}")
    with db.get_conn() as conn:
        run_id = db.start_run(conn, "td_watch")
        new = 0
        for src, title, url, published, products in found:
            cur = conn.execute(
                """INSERT INTO td_signal (source, title, url, published, products)
                   VALUES (%s,%s,%s,%s,%s) ON CONFLICT (url) DO NOTHING""",
                (src, title, url, published, products))
            new += cur.rowcount
        db.finish_run(conn, run_id, "partial" if errors else "success", new, 0,
                      notes="; ".join(errors)[:1500] or None)
        conn.commit()
    log.info("td_watch: %d matches, %d new", len(found), new)
    return {"agent": "td_watch", "status": "partial" if errors else "success",
            "matches": len(found), "new": new, "errors": errors}
