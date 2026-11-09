from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = PIPELINE_DIR.parent
CACHE_DIR = PIPELINE_DIR / ".cache"
CONFIG_DIR = PIPELINE_DIR / "config"
REPORTS_DIR = PIPELINE_DIR / "reports"
DATA_DIR = REPO_ROOT / "data"
LOCK_FILE = PIPELINE_DIR / "sources.lock.json"
