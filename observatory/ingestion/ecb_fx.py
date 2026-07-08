"""ECB reference-rate agent — monthly average EUR exchange rates (normalisation input).

Writes to fx_rate (not fact_series): FX is infrastructure for the normalisation
agent, not an observatory metric. Keeps run bookkeeping + raw landing like any agent.
"""
import json
from datetime import datetime, timezone, date

import httpx

from observatory import db
from observatory.settings import HISTORY_START

CURRENCIES = ["USD", "CNY", "INR"]  # ECB reference rates; Gulf tariffs are USD-quoted
URL = ("https://data-api.ecb.europa.eu/service/data/EXR/"
       "M.{cur}.EUR.SP00.A?startPeriod={start}-01&format=jsondata")


class ECBFXAgent:
    name = "ecb_fx"
    source = "ECB reference rates"

    def run(self) -> dict:
        with db.get_conn() as conn:
            run_id = db.start_run(conn, self.name)
            try:
                inserted = 0
                retrieved_at = datetime.now(timezone.utc)
                for cur in CURRENCIES:
                    url = URL.format(cur=cur, start=HISTORY_START)
                    resp = httpx.get(url, timeout=60)
                    resp.raise_for_status()
                    payload = resp.json()
                    conn.execute(
                        """INSERT INTO raw_landing (run_id, source, request_url, payload, retrieved_at)
                           VALUES (%s,%s,%s,%s,%s)""",
                        (run_id, self.source, url, json.dumps(payload), retrieved_at),
                    )
                    series = payload["dataSets"][0]["series"]
                    time_values = None
                    for dim in payload["structure"]["dimensions"]["observation"]:
                        if dim["id"] == "TIME_PERIOD":
                            time_values = [v["id"] for v in dim["values"]]
                    for obs_map in series.values():
                        for pos, obs in obs_map["observations"].items():
                            period = time_values[int(pos)]        # '2015-01'
                            year, month = map(int, period.split("-"))
                            conn.execute(
                                """INSERT INTO fx_rate (quote_currency, rate_date, rate,
                                       source, retrieved_at, run_id)
                                   VALUES (%s,%s,%s,%s,%s,%s)
                                   ON CONFLICT DO NOTHING""",
                                (cur, date(year, month, 1), obs[0],
                                 "ECB EXR monthly average", retrieved_at, run_id),
                            )
                            inserted += 1
                conn.commit()
                db.finish_run(conn, run_id, "success", inserted)
                return {"agent": self.name, "status": "success", "inserted": inserted}
            except Exception as exc:
                conn.rollback()
                db.finish_run(conn, run_id, "failed", notes=str(exc))
                return {"agent": self.name, "status": "failed", "error": str(exc)}
