"""Orchestrator — dependency-ordered agent execution with per-agent isolation.

Usage:
    python -m observatory.orchestrator.run --all          # everything, in order
    python -m observatory.orchestrator.run --agent NAME   # one agent
    python -m observatory.orchestrator.run --benchmarks   # recompute indicators only
    python -m observatory.orchestrator.run --list

Dependency order: FX first (normalisation input), then independent ingestion
agents (a failure in one never blocks the others), benchmarks last.
"""
import argparse
import json
import logging

from observatory.bootstrap import bootstrap
from observatory.ingestion.ecb_fx import ECBFXAgent
from observatory.ingestion.eurostat_power import EurostatPowerAgent
from observatory.ingestion.eia_power import EIAPowerAgent
from observatory.ingestion.entsoe_power import EntsoePowerAgent
from observatory.ingestion.proxy_power import ProxyPowerAgent
from observatory.ingestion.comext_trade import ComextTradeAgent
from observatory.ingestion.comext_suppliers import ComextSupplierAgent
from observatory.ingestion.comtrade_trade import ComtradeTradeAgent
from observatory.ingestion.eurochlor_drop import EuroChlorDropAgent
from observatory.ingestion.eurochlor_web import EuroChlorWebAgent
from observatory.ingestion.gas_prices import GasPriceAgent
from observatory.ingestion.sunsirs_china import SunSirsChinaAgent
from observatory.processing import benchmarking

AGENTS = [  # execution order = dependency order
    ECBFXAgent(),
    EurostatPowerAgent(),
    EIAPowerAgent(),
    EntsoePowerAgent(),
    ProxyPowerAgent(),
    ComextTradeAgent(),
    ComextSupplierAgent(),
    ComtradeTradeAgent(),
    EuroChlorDropAgent(),
    EuroChlorWebAgent(),
    GasPriceAgent(),
    SunSirsChinaAgent(),
]


def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Observatory orchestrator")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true")
    group.add_argument("--agent")
    group.add_argument("--benchmarks", action="store_true")
    group.add_argument("--list", action="store_true")
    args = parser.parse_args()

    if args.list:
        for a in AGENTS:
            ok, reason = a.available() if hasattr(a, "available") else (True, "")
            print(f"{a.name:20s} {'ready' if ok else 'dormant: ' + reason}")
        print(f"{'benchmarking':20s} ready")
        return

    bootstrap()
    results = []
    if args.agent:
        agents = [a for a in AGENTS if a.name == args.agent]
        if not agents:
            raise SystemExit(f"unknown agent {args.agent!r} — try --list")
        results = [a.run() for a in agents]
        if args.agent != "ecb_fx":
            results.append(benchmarking.run())
    elif args.benchmarks:
        results = [benchmarking.run()]
    elif args.all:
        results = [a.run() for a in AGENTS]   # isolated: failures don't propagate
        results.append(benchmarking.run())

    print(json.dumps(results, indent=2, default=str))


if __name__ == "__main__":
    main()
