"""Production & capacity agent, public leg — Euro Chlor monthly statistics.

Scrapes eurochlor.org monthly production posts: chlorine production (tonnes),
capacity utilisation (%), caustic soda stocks (tonnes) for EU-27 + NO/CH/UK.
Each post carries a year-to-date table incl. prior-year comparators; December
posts back to 2016 provide history to 2015. Later posts win when months overlap
(restatements). The Phase-2 member file-drop stays the authoritative layer;
this is the public early view (assessment doc §2.1).
"""
import re
from datetime import datetime, timezone

import httpx

from observatory.ingestion.base import IngestionAgent
from observatory.ingestion.periods import period_start
from observatory.provenance import SeriesRow
from observatory.settings import HISTORY_START

GEO = "EU27_EFTA_UK"
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
MONTH_NUM = {m: i + 1 for i, m in enumerate(MONTHS)}
UA = {"User-Agent": "Mozilla/5.0 (compatible; EuroChlorObservatory/1.0)"}


def _strip(html: str) -> str:
    body = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", html)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body))


def parse_post(text: str) -> dict:
    """Extract {(series, 'YYYY-MM'): value} from one post's tables."""
    out = {}
    header = re.search(
        r"Production \(tonnes\).{0,80}?(20\d\d)\s+(20\d\d)", text)
    if header:
        y_prev, y_cur = header.group(1), header.group(2)
        # post-2020 posts write "88.2%"; 2016-2019 posts write "88.2" — % optional
        row_re = re.compile(
            r"(" + "|".join(MONTHS) + r")\s+([\d,]{4,})\s+([\d,]{4,})\s+"
            r"[+\-−]?[\d.]+%?\s+([\d.]+)%?\s+([\d.]+)%?")
        for m in row_re.finditer(text):
            month = f"{MONTH_NUM[m.group(1)]:02d}"
            out[("production.production", f"{y_prev}-{month}")] = float(m.group(2).replace(",", ""))
            out[("production.production", f"{y_cur}-{month}")] = float(m.group(3).replace(",", ""))
            out[("production.utilisation", f"{y_prev}-{month}")] = float(m.group(4))
            out[("production.utilisation", f"{y_cur}-{month}")] = float(m.group(5))
    stocks = re.search(r"stocks \(tonnes\)\s+(20\d\d)\s+(20\d\d)(.{0,900})", text, re.I)
    if stocks:
        y_prev, y_cur, seg = stocks.group(1), stocks.group(2), stocks.group(3)
        for m in re.finditer(r"(" + "|".join(MONTHS) + r")\s+([\d,]{4,})\s+([\d,]{4,})", seg):
            month = f"{MONTH_NUM[m.group(1)]:02d}"
            out[("production.caustic_stocks", f"{y_prev}-{month}")] = float(m.group(2).replace(",", ""))
            out[("production.caustic_stocks", f"{y_cur}-{month}")] = float(m.group(3).replace(",", ""))
    return out


class EuroChlorWebAgent(IngestionAgent):
    name = "eurochlor_web"
    source = "Euro Chlor public monthly statistics (eurochlor.org)"

    def fetch(self):
        this_year = datetime.now(timezone.utc).year
        urls = [f"https://eurochlor.org/news/december-{y}-chlorine-production/"
                for y in range(HISTORY_START + 1, this_year)]
        payloads = []
        with httpx.Client(timeout=60, headers=UA, follow_redirects=True) as client:
            for url in urls:
                resp = client.get(url)
                if resp.status_code == 200:
                    payloads.append((url, {"html": resp.text}))
            # current year: the production page links the recent monthly posts
            idx = client.get("https://www.eurochlor.org/production/")
            posts = sorted(set(re.findall(
                r'href="(https://eurochlor\.org/news/[a-z]+-20\d\d-chlorine-production/)"',
                idx.text)))
            for url in posts:
                resp = client.get(url)
                if resp.status_code == 200:
                    payloads.append((url, {"html": resp.text}))
        return payloads

    def parse(self, payloads):
        retrieved_at = datetime.now(timezone.utc)
        merged: dict = {}
        sources: dict = {}
        # chronological: December posts oldest-first, then current-year posts;
        # later posts overwrite overlapping months (restatements win)
        for url, payload in payloads:
            for key, value in parse_post(_strip(payload["html"])).items():
                merged[key] = value
                sources[key] = url
        units = {"production.production": "t Cl2",
                 "production.utilisation": "%",
                 "production.caustic_stocks": "t NaOH"}
        rows = []
        for (series_id, period), value in sorted(merged.items()):
            if int(period[:4]) < HISTORY_START:
                continue
            rows.append(SeriesRow(
                series_id=series_id,
                geo_id=GEO,
                period=period,
                period_start=period_start(period),
                value=value,
                unit=units[series_id],
                source="Euro Chlor",
                source_dataset=sources[(series_id, period)],
                reference_period=period,
                retrieved_at=retrieved_at,
            ))
        return rows
