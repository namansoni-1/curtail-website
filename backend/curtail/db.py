"""Database schema.

Designed with Phase 2 (live shadow mode) in mind: everything hangs off a
site, tenant policies are versioned by validity window rather than
overwritten, and each run's per-job decisions are stored as a decision log.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    create_engine,
    event,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from curtail.config import settings


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


TS = DateTime(timezone=True)


class Site(Base):
    __tablename__ = "sites"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    timezone: Mapped[str] = mapped_column(String(64), default="America/New_York")
    iso: Mapped[str] = mapped_column(String(16), default="PJM")
    price_node: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class Dataset(Base):
    __tablename__ = "datasets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    filename: Mapped[str] = mapped_column(String(300))
    stored_path: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(32), default="uploaded")
    mapping: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    validation: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    rows_loaded: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class FacilityPower(Base):
    __tablename__ = "facility_power"
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), primary_key=True)
    ts: Mapped[datetime] = mapped_column(TS, primary_key=True)
    total_kw: Mapped[float] = mapped_column(Float)
    it_kw: Mapped[float | None] = mapped_column(Float, nullable=True)
    cooling_kw: Mapped[float | None] = mapped_column(Float, nullable=True)


class GridSignal(Base):
    __tablename__ = "grid_signals"
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), primary_key=True)
    ts: Mapped[datetime] = mapped_column(TS, primary_key=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    dr_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    emergency_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(64), default="upload")


class TenantPolicyRow(Base):
    __tablename__ = "tenant_policies"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    tenant_id: Mapped[str] = mapped_column(String(128))
    valid_from: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    valid_to: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    opted_in: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    max_reduction_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_reduction_kw: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_guaranteed_kw: Mapped[float | None] = mapped_column(Float, nullable=True)
    blackouts: Mapped[list | None] = mapped_column(JSON, nullable=True)
    compensation_per_mwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class JobRow(Base):
    __tablename__ = "jobs"
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), primary_key=True)
    job_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    tenant_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    job_type: Mapped[str] = mapped_column(String(16), default="unknown")
    submit: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    start: Mapped[datetime] = mapped_column(TS)
    end: Mapped[datetime] = mapped_column(TS)
    deadline: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    timelimit_end: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    checkpointable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    gpus: Mapped[int | None] = mapped_column(Integer, nullable=True)
    nodes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="upload")


class JobPower(Base):
    __tablename__ = "job_power"
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), primary_key=True)
    job_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    ts: Mapped[datetime] = mapped_column(TS, primary_key=True)
    kw: Mapped[float] = mapped_column(Float)


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    params: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="running")
    error: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)


class RunDecision(Base):
    """Decision log: one row per job considered in each event of a run."""

    __tablename__ = "run_decisions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    event_id: Mapped[str] = mapped_column(String(64))
    job_id: Mapped[str] = mapped_column(String(128))
    tenant_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    action: Mapped[str] = mapped_column(String(16))
    cap_power_frac: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_reduction_kw: Mapped[float] = mapped_column(Float, default=0.0)
    delay_minutes: Mapped[float] = mapped_column(Float, default=0.0)
    reason: Mapped[str] = mapped_column(String(64))
    flags: Mapped[list | None] = mapped_column(JSON, nullable=True)


HYPERTABLES = {"facility_power": "ts", "grid_signals": "ts", "job_power": "ts"}

engine = create_engine(settings.database_url, future=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)

if engine.dialect.name == "sqlite":
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(conn, _):
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")


def init_db(bind=None) -> None:
    bind = bind or engine
    if bind.dialect.name == "postgresql":
        with bind.begin() as c:
            c.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb"))
    Base.metadata.create_all(bind)
    if bind.dialect.name == "postgresql":
        with bind.begin() as c:
            for table, col in HYPERTABLES.items():
                c.execute(text(
                    f"SELECT create_hypertable('{table}', '{col}', if_not_exists => TRUE, "
                    "migrate_data => TRUE)"))
