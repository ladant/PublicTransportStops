from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

_VAR = re.compile(r"\$\{([A-Z0-9_]+)\}")


class MissingVariable(Exception):
    pass


def expand(value: str, env: dict[str, str] | None = None) -> str:
    """Nahradí ${VAR} hodnotou z prostředí; chybějící/prázdná proměnná = MissingVariable."""
    env = os.environ if env is None else env

    def repl(m: re.Match) -> str:
        v = env.get(m.group(1))
        if not v:
            raise MissingVariable(m.group(1))
        return v

    return _VAR.sub(repl, value)


@dataclass
class Source:
    url: str
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class Feed:
    code: str
    name: str
    sources: list[Source]
    license: str = ""
    alerts_url: str = ""


@dataclass
class Config:
    feeds: list[Feed]
    timezone: str = "Europe/Brussels"
    build_hour: int = 17
    days: int = 28
    dlat: float = 0.1
    dlon: float = 0.15
    tile_max_gzip_bytes: int = 300_000
    tile_max_depth: int = 4
    default_view: dict = field(default_factory=lambda: {"center": [4.47, 50.64], "zoom": 7.3})


def load(path: str | Path) -> Config:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    feeds = []
    for f in raw["feeds"]:
        if not re.fullmatch(r"[a-z0-9]+", f["code"]):
            raise ValueError(f"kód feedu musí být [a-z0-9]+: {f['code']!r}")
        feeds.append(
            Feed(
                code=f["code"],
                name=f.get("name", f["code"]),
                license=f.get("license", ""),
                alerts_url=f.get("alerts_url", ""),
                sources=[Source(s["url"], dict(s.get("headers") or {})) for s in f.get("sources", [])],
            )
        )
    grid = raw.get("grid") or {}
    cfg = Config(feeds=feeds)
    cfg.timezone = raw.get("timezone", cfg.timezone)
    cfg.build_hour = int(raw.get("build_hour", cfg.build_hour))
    cfg.days = int(raw.get("days", cfg.days))
    cfg.dlat = float(grid.get("dlat", cfg.dlat))
    cfg.dlon = float(grid.get("dlon", cfg.dlon))
    cfg.tile_max_gzip_bytes = int(raw.get("tile_max_gzip_bytes", cfg.tile_max_gzip_bytes))
    cfg.tile_max_depth = int(raw.get("tile_max_depth", cfg.tile_max_depth))
    if raw.get("default_view"):
        cfg.default_view = raw["default_view"]
    return cfg
