#!/usr/bin/env bash
# Cron entrypoint: run one agent (or --all) with the project venv and log output.
set -euo pipefail
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$PROJECT/logs"
cd "$PROJECT"
exec .venv/bin/python -m observatory.orchestrator.run "$@" \
    >> "logs/orchestrator-$(date +%Y%m%d).log" 2>&1
