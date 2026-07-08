#!/usr/bin/env bash
# Start the observatory: local Postgres cluster + API (serves dashboard/dist).
set -euo pipefail
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH=/usr/lib/postgresql/16/bin:$PATH
cd "$PROJECT"

if ! pg_ctl -D pgdata status > /dev/null 2>&1; then
    pg_ctl -D pgdata -o "-p 5433 -k /tmp" -l pgdata/logfile start
fi

exec .venv/bin/uvicorn observatory.api.main:app \
    --host "${API_HOST:-0.0.0.0}" --port "${API_PORT:-8300}"
