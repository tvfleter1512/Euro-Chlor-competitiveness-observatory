"""Central settings: environment variables + YAML config registries."""
import os
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
DATA_DIR = PROJECT_ROOT / "data"

load_dotenv(PROJECT_ROOT / ".env")

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://tva@localhost:5433/observatory"
)
ENTSOE_TOKEN = os.environ.get("ENTSOE_TOKEN", "")
COMTRADE_KEY = os.environ.get("COMTRADE_KEY", "")
EIA_KEY = os.environ.get("EIA_KEY", "")
API_HOST = os.environ.get("API_HOST", "0.0.0.0")
API_PORT = int(os.environ.get("API_PORT", "8300"))
HISTORY_START = int(os.environ.get("HISTORY_START", "2015"))
# password gates the whole app AND unlocks licensed (member) series
DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")


@lru_cache(maxsize=None)
def load_config(name: str) -> dict:
    """Load a YAML registry from config/ (e.g. 'product_basket')."""
    with open(CONFIG_DIR / f"{name}.yaml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)
