from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class AppConfig:
    data_dir: Path
    database_path: Path
    output_dir: Path
    work_dir: Path
    cors_origins: tuple[str, ...]
    kimodo_executable: str = "kimodo_gen"
    max_attempts: int = 2
    worker_poll_seconds: float = 0.5
    lease_seconds: int = 30
    start_worker: bool = True

    @classmethod
    def from_environment(cls) -> "AppConfig":
        data_dir = Path(os.getenv("KIMODO_DATA_DIR", "services/kimodo/.data")).resolve()
        origins = tuple(
            item.strip()
            for item in os.getenv(
                "KIMODO_CORS_ORIGINS",
                "http://127.0.0.1:5173,http://localhost:5173",
            ).split(",")
            if item.strip()
        )
        return cls(
            data_dir=data_dir,
            database_path=data_dir / "jobs.sqlite3",
            output_dir=data_dir / "results",
            work_dir=data_dir / "work",
            cors_origins=origins,
            kimodo_executable=os.getenv("KIMODO_EXECUTABLE", "kimodo_gen"),
            max_attempts=max(1, min(int(os.getenv("KIMODO_MAX_ATTEMPTS", "2")), 5)),
            worker_poll_seconds=max(0.1, float(os.getenv("KIMODO_WORKER_POLL_SECONDS", "0.5"))),
            lease_seconds=max(5, int(os.getenv("KIMODO_LEASE_SECONDS", "30"))),
            start_worker=env_bool("KIMODO_START_WORKER", True),
        )

    def ensure_directories(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.work_dir.mkdir(parents=True, exist_ok=True)
