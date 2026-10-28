from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings, read from the environment (see README)."""

    model_config = SettingsConfigDict(env_prefix="CURTAIL_", env_file=".env", extra="ignore")

    # Postgres/TimescaleDB in docker-compose; SQLite works for local dev and tests.
    database_url: str = "sqlite:///./data/curtail.db"
    data_dir: Path = Path("./data")
    cors_origins: str = "http://localhost:3000"
    # Optional regex for extra origins, e.g. Vercel preview deployments.
    cors_origin_regex: str | None = None

    # Public read-only demo: preloads the synthetic sample site and rejects
    # site creation, uploads and grid fetches. Replay runs stay allowed.
    demo_mode: bool = False

    # Grid data. Keys are optional; without them fetchers fall back to cache.
    pjm_api_key: str | None = None
    ercot_api_key: str | None = None  # ERCOT public API subscription key
    ercot_username: str | None = None
    ercot_password: str | None = None

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"


settings = Settings()
