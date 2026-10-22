"""Alert notifier — e-mails a digest of not-yet-notified alerts, or writes it to
logs/alerts-YYYYMM.md when SMTP is not configured (the dashboard shows them either way).

Alerts derive from public Comext data only; no licensed series enter the digest.
"""
import logging
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

from observatory import db
from observatory.settings import load_config
from observatory.settings import (ALERT_FROM, ALERT_TO, DASHBOARD_URL, PROJECT_ROOT,
                                  SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USER)

log = logging.getLogger(__name__)

TEST_LABEL = {"month": "latest month", "quarter": "3-month average"}
FLOW_LABEL = {"import": "imports from", "export": "exports to"}


def _fetch_pending(conn):
    return conn.execute(
        """SELECT a.*, p.name AS product_name, g.name AS partner_name
           FROM alert a
           JOIN dim_product p ON p.product_code = a.product_code
           LEFT JOIN dim_geo g ON g.geo_id = a.partner_geo_id
           WHERE a.notified_at IS NULL
           ORDER BY a.severity, a.product_code, a.flow, a.period DESC, a.partner_geo_id"""
    ).fetchall()


def _kt(v):
    return f"{float(v) / 1000:,.1f} kt"


def format_digest(alerts, now):
    # one line per product/flow/partner: the strongest hit, plus the other periods/tests
    groups = {}
    for a in alerts:
        key = (a["kind"], a["product_code"], a["flow"], a["partner_geo_id"])
        g = groups.setdefault(key, {"lead": a, "others": []})
        lead = g["lead"]
        stronger = (a["severity"] == "high" and lead["severity"] != "high") or \
            (a["severity"] == lead["severity"] and a["period"] > lead["period"])
        if stronger:
            g["others"].append(lead); g["lead"] = a
        elif a is not lead:
            g["others"].append(a)
    lines = [f"# Euro Chlor Observatory — trade alerts, {now:%d %b %Y}", "",
             f"{len(groups)} new signal(s) from Eurostat Comext (EU27, extra-EU, tonnes). "
             f"Dashboard: {DASHBOARD_URL}", ""]
    order = {"high": 0, "medium": 1}
    for g in sorted(groups.values(), key=lambda g: (order[g["lead"]["severity"]],
                                                    g["lead"]["product_code"], g["lead"]["flow"])):
        a, inp = g["lead"], g["lead"]["inputs"] or {}
        name = (a["partner_name"] or a["partner_geo_id"]).split(" (")[0]   # Comext's long names
        partner = "all extra-EU partners" if a["partner_geo_id"] == "EXTRA_EU" \
            else f"{name} ({a['partner_geo_id']})"
        share = inp.get("share")
        share_txt = f", {share * 100:.0f} % of extra-EU {a['flow']}s" if share else ""
        also = "; also " + ", ".join(sorted({f"{o['period']} ({TEST_LABEL[o['test']]})"
                                             for o in g["others"]})) if g["others"] else ""
        if a["kind"] == "trade_price_drop":
            what = (f"PRICE DROP: {float(a['value']):,.0f} EUR/t, -{inp['drop'] * 100:.0f} % vs the "
                    f"previous 12-month unit value of {inp['baseline_uv']:,.0f} EUR/t, on "
                    f"{_kt(inp['quantity_t'])}{share_txt}")
        else:
            base = inp.get("baseline_t") or 0
            ratio = inp.get("ratio")
            vs = "new origin/destination (nothing in the previous 12 months)" \
                if inp.get("new_origin") else f"x{ratio:.1f} the previous 12-month mean of {_kt(base)}"
            what = f"VOLUME: {_kt(a['value'])}, {vs}{share_txt}"
        lines.append(f"- **{a['severity'].upper()}** {a['product_name']} ({a['product_code']}) — "
                     f"{FLOW_LABEL[a['flow']]} {partner}, {a['period']} "
                     f"({TEST_LABEL[a['test']]}): {what}{also}.")
    lines += ["", "Method: config/surges.yaml (thresholds not yet owner-confirmed). "
              "Comext revises the latest months; re-check before informing members."]
    return "\n".join(lines)


def _fetch_td_signals(conn):
    """Trade-defence watch hits not yet notified and not already cited in the measures list."""
    cited = {u for m in load_config("trade_defence")["measures"]
             for u in (m.get("source_url"), m.get("official_url")) if u}
    rows = conn.execute("SELECT * FROM td_signal WHERE notified_at IS NULL "
                        "ORDER BY published DESC NULLS LAST").fetchall()
    return [r for r in rows if r["url"] not in cited]


def format_td_signals(signals):
    if not signals:
        return ""
    lines = ["## Trade-defence watch — new headlines to review", "",
             "Possible new cases on basket products (official journals, TRA, Federal Register, news). "
             "Check, then add real ones to config/trade_defence.yaml.", ""]
    for s in signals:
        lines.append(f"- {s['published'] or 'undated'} · {s['source']} · {', '.join(s['products'])}: "
                     f"{s['title']} <{s['url']}>")
    return "\n".join(lines)


def _send_mail(subject, body):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = ALERT_FROM or SMTP_USER
    msg["To"] = ALERT_TO
    msg.set_content(body)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
        s.starttls()
        if SMTP_USER:
            s.login(SMTP_USER, SMTP_PASSWORD)
        s.send_message(msg)


def _fetch_current_window(conn):
    """All alerts of the latest 3 periods, notified or not (delivery test)."""
    return conn.execute(
        """SELECT a.*, p.name AS product_name, g.name AS partner_name
           FROM alert a
           JOIN dim_product p ON p.product_code = a.product_code
           LEFT JOIN dim_geo g ON g.geo_id = a.partner_geo_id
           WHERE a.period >= (SELECT to_char((max(period) || '-01')::date - interval '2 months',
                                             'YYYY-MM') FROM alert)
           ORDER BY a.severity, a.product_code, a.flow, a.period DESC, a.partner_geo_id"""
    ).fetchall()


def run(test: bool = False) -> dict:
    """Send the digest of pending alerts. test=True re-sends the current window by
    e-mail without marking anything notified — a delivery check, requires SMTP."""
    now = datetime.now(timezone.utc)
    with db.get_conn() as conn:
        if test:
            if not (SMTP_HOST and ALERT_TO):
                return {"agent": "notify", "status": "failed",
                        "error": "SMTP_HOST / ALERT_TO not set in .env — nothing to test"}
            alerts = _fetch_current_window(conn)
            _send_mail(f"[TEST] [Euro Chlor Observatory] {len(alerts)} trade alert(s)",
                       "Delivery test — these alerts were already notified.\n\n"
                       + format_digest(alerts, now))
            return {"agent": "notify", "status": "success", "alerts": len(alerts),
                    "channel": "email (test)", "to": ALERT_TO}
        alerts = _fetch_pending(conn)
        signals = _fetch_td_signals(conn)
        if not alerts and not signals:
            return {"agent": "notify", "status": "success", "alerts": 0}
        body = "\n\n".join(part for part in (format_digest(alerts, now) if alerts else "",
                                              format_td_signals(signals)) if part)
        channel = "log"
        if SMTP_HOST and ALERT_TO:
            _send_mail(f"[Euro Chlor Observatory] {len(alerts)} trade alert(s), "
                       f"{len(signals)} trade-defence signal(s)", body)
            channel = "email"
        else:
            logdir = PROJECT_ROOT / "logs"
            logdir.mkdir(exist_ok=True)
            with open(logdir / f"alerts-{now:%Y%m}.md", "a", encoding="utf-8") as fh:
                fh.write(body + "\n\n")
        conn.execute("UPDATE alert SET notified_at = now() WHERE alert_id = ANY(%s)",
                     ([a["alert_id"] for a in alerts],))
        conn.execute("UPDATE td_signal SET notified_at = now() WHERE signal_id = ANY(%s)",
                     ([s["signal_id"] for s in signals],))
        conn.commit()
    log.info("notify: %d alerts, %d trade-defence signals via %s", len(alerts), len(signals), channel)
    return {"agent": "notify", "status": "success", "alerts": len(alerts),
            "td_signals": len(signals), "channel": channel}
