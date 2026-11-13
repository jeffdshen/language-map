"""Pinned, checksum-verified source downloads.

Every external input is listed in ``sources.lock.json`` with an immutable URL
(commit SHA / package version / release asset) and a sha256. Downloads are
cached in ``.cache/`` and verified on every use, so a build either uses exactly
the pinned bytes or fails loudly.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

from .paths import CACHE_DIR, LOCK_FILE


class ChecksumError(RuntimeError):
    pass


def load_lock(lock_file: Path = LOCK_FILE) -> dict[str, dict]:
    return json.loads(lock_file.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cache_path(name: str, lock_file: Path = LOCK_FILE) -> Path:
    url = load_lock(lock_file)[name]["url"]
    return CACHE_DIR / f"{name}--{url.rsplit('/', 1)[-1]}"


def fetch(name: str, lock_file: Path = LOCK_FILE) -> Path:
    """Return a local path to the pinned source ``name``, downloading if needed."""
    entry = load_lock(lock_file)[name]
    path = cache_path(name, lock_file)
    if not path.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        print(f"[fetch] {name}: {entry['url']}")
        with urllib.request.urlopen(entry["url"]) as resp, tmp.open("wb") as out:
            shutil.copyfileobj(resp, out, length=1 << 20)
        tmp.rename(path)
    actual = sha256_file(path)
    if actual != entry["sha256"]:
        raise ChecksumError(
            f"{name}: sha256 mismatch (expected {entry['sha256']}, got {actual}). "
            f"Delete {path} to re-download, or update {lock_file.name} deliberately."
        )
    return path


def fetch_all() -> dict[str, Path]:
    return {name: fetch(name) for name in load_lock()}
