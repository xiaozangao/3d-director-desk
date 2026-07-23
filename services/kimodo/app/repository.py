from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

from .domain import ACTIVE_STATUSES, STAGE_PROGRESS, TERMINAL_STATUSES, GenerationRequest, JobRecord, JobStatus


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def as_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds")


class JobNotFoundError(LookupError):
    pass


class InvalidJobStateError(RuntimeError):
    pass


class JobRepository:
    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path)

    def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    prompt TEXT NOT NULL,
                    duration_seconds REAL NOT NULL,
                    model TEXT NOT NULL,
                    seed INTEGER,
                    status TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 2,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    error_code TEXT,
                    error_message TEXT,
                    result_path TEXT,
                    result_filename TEXT,
                    result_media_type TEXT,
                    result_size INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    lease_owner TEXT,
                    lease_expires_at TEXT,
                    heartbeat_at TEXT
                );
                CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status, created_at);
                CREATE INDEX IF NOT EXISTS jobs_lease_idx ON jobs(status, lease_expires_at);
                """
            )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
        finally:
            connection.close()

    @staticmethod
    def _record(row: sqlite3.Row) -> JobRecord:
        value = dict(row)
        value["status"] = JobStatus(value["status"])
        value["cancel_requested"] = bool(value["cancel_requested"])
        return JobRecord(**value)

    def create(self, request: GenerationRequest, max_attempts: int = 2, job_id: str | None = None) -> JobRecord:
        request = request.normalized()
        if not 1 <= max_attempts <= 5:
            raise ValueError("maxAttempts must be between 1 and 5")
        identifier = job_id or str(uuid.uuid4())
        now = as_timestamp(utc_now())
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO jobs (
                    id, prompt, duration_seconds, model, seed, status, stage, progress,
                    attempts, max_attempts, cancel_requested, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)
                """,
                (
                    identifier,
                    request.prompt,
                    request.duration_seconds,
                    request.model,
                    request.seed,
                    JobStatus.QUEUED.value,
                    JobStatus.QUEUED.value,
                    STAGE_PROGRESS[JobStatus.QUEUED],
                    max_attempts,
                    now,
                    now,
                ),
            )
        return self.get(identifier)

    def get(self, job_id: str) -> JobRecord:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise JobNotFoundError(job_id)
        return self._record(row)

    def list(self, limit: int = 50) -> list[JobRecord]:
        bounded_limit = max(1, min(int(limit), 200))
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (bounded_limit,)
            ).fetchall()
        return [self._record(row) for row in rows]

    def claim_next(self, worker_id: str, lease_seconds: int = 30) -> JobRecord | None:
        now = utc_now()
        now_text = as_timestamp(now)
        lease_text = as_timestamp(now + timedelta(seconds=max(5, lease_seconds)))
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT id FROM jobs
                WHERE status = ? AND cancel_requested = 0
                ORDER BY created_at ASC LIMIT 1
                """,
                (JobStatus.QUEUED.value,),
            ).fetchone()
            if row is None:
                connection.execute("COMMIT")
                return None
            job_id = row["id"]
            changed = connection.execute(
                """
                UPDATE jobs SET
                    status = ?, stage = ?, progress = ?, attempts = attempts + 1,
                    updated_at = ?, started_at = COALESCE(started_at, ?), finished_at = NULL,
                    lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?,
                    error_code = NULL, error_message = NULL
                WHERE id = ? AND status = ? AND cancel_requested = 0
                """,
                (
                    JobStatus.LOADING.value,
                    JobStatus.LOADING.value,
                    STAGE_PROGRESS[JobStatus.LOADING],
                    now_text,
                    now_text,
                    worker_id,
                    lease_text,
                    now_text,
                    job_id,
                    JobStatus.QUEUED.value,
                ),
            ).rowcount
            connection.execute("COMMIT")
        return self.get(job_id) if changed else None

    def update_stage(
        self,
        job_id: str,
        worker_id: str,
        status: JobStatus,
        lease_seconds: int = 30,
    ) -> JobRecord:
        if status not in ACTIVE_STATUSES:
            raise ValueError("worker stage must be active")
        now = utc_now()
        with self._connect() as connection:
            changed = connection.execute(
                """
                UPDATE jobs SET status = ?, stage = ?, progress = ?, updated_at = ?,
                    heartbeat_at = ?, lease_expires_at = ?
                WHERE id = ? AND lease_owner = ? AND status NOT IN (?, ?, ?)
                """,
                (
                    status.value,
                    status.value,
                    STAGE_PROGRESS[status],
                    as_timestamp(now),
                    as_timestamp(now),
                    as_timestamp(now + timedelta(seconds=max(5, lease_seconds))),
                    job_id,
                    worker_id,
                    *(item.value for item in TERMINAL_STATUSES),
                ),
            ).rowcount
        if not changed:
            raise InvalidJobStateError(job_id)
        return self.get(job_id)

    def heartbeat(self, job_id: str, worker_id: str, lease_seconds: int = 30) -> bool:
        now = utc_now()
        with self._connect() as connection:
            changed = connection.execute(
                """
                UPDATE jobs SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
                WHERE id = ? AND lease_owner = ? AND status IN (?, ?, ?, ?)
                """,
                (
                    as_timestamp(now),
                    as_timestamp(now + timedelta(seconds=max(5, lease_seconds))),
                    as_timestamp(now),
                    job_id,
                    worker_id,
                    *(item.value for item in ACTIVE_STATUSES),
                ),
            ).rowcount
        return bool(changed)

    def is_cancel_requested(self, job_id: str) -> bool:
        return self.get(job_id).cancel_requested

    def request_cancel(self, job_id: str) -> JobRecord:
        job = self.get(job_id)
        if job.status in TERMINAL_STATUSES:
            return job
        now = as_timestamp(utc_now())
        with self._connect() as connection:
            if job.status is JobStatus.QUEUED:
                connection.execute(
                    """
                    UPDATE jobs SET status = ?, stage = ?, progress = ?, cancel_requested = 1,
                        updated_at = ?, finished_at = ? WHERE id = ? AND status = ?
                    """,
                    (
                        JobStatus.CANCELED.value,
                        JobStatus.CANCELED.value,
                        STAGE_PROGRESS[JobStatus.CANCELED],
                        now,
                        now,
                        job_id,
                        JobStatus.QUEUED.value,
                    ),
                )
            else:
                connection.execute(
                    "UPDATE jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?",
                    (now, job_id),
                )
        return self.get(job_id)

    def mark_canceled(self, job_id: str, worker_id: str) -> JobRecord:
        return self._finish(job_id, worker_id, JobStatus.CANCELED)

    def complete(
        self,
        job_id: str,
        worker_id: str,
        result_path: str,
        result_filename: str,
        result_size: int,
        result_media_type: str = "application/octet-stream",
    ) -> JobRecord:
        now = as_timestamp(utc_now())
        with self._connect() as connection:
            changed = connection.execute(
                """
                UPDATE jobs SET status = ?, stage = ?, progress = ?, updated_at = ?, finished_at = ?,
                    lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
                    result_path = ?, result_filename = ?, result_media_type = ?, result_size = ?,
                    error_code = NULL, error_message = NULL
                WHERE id = ? AND lease_owner = ? AND status IN (?, ?, ?, ?)
                """,
                (
                    JobStatus.SUCCEEDED.value,
                    JobStatus.SUCCEEDED.value,
                    STAGE_PROGRESS[JobStatus.SUCCEEDED],
                    now,
                    now,
                    result_path,
                    result_filename,
                    result_media_type,
                    result_size,
                    job_id,
                    worker_id,
                    *(item.value for item in ACTIVE_STATUSES),
                ),
            ).rowcount
        if not changed:
            raise InvalidJobStateError(job_id)
        return self.get(job_id)

    def fail(self, job_id: str, worker_id: str, code: str, message: str, retryable: bool) -> JobRecord:
        job = self.get(job_id)
        now = as_timestamp(utc_now())
        should_retry = retryable and job.attempts < job.max_attempts and not job.cancel_requested
        next_status = JobStatus.QUEUED if should_retry else JobStatus.FAILED
        with self._connect() as connection:
            changed = connection.execute(
                """
                UPDATE jobs SET status = ?, stage = ?, progress = ?, updated_at = ?, finished_at = ?,
                    lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
                    error_code = ?, error_message = ?
                WHERE id = ? AND lease_owner = ?
                """,
                (
                    next_status.value,
                    "retrying" if should_retry else next_status.value,
                    0 if should_retry else STAGE_PROGRESS[JobStatus.FAILED],
                    now,
                    None if should_retry else now,
                    code[:80],
                    message.strip()[:1000],
                    job_id,
                    worker_id,
                ),
            ).rowcount
        if not changed:
            raise InvalidJobStateError(job_id)
        return self.get(job_id)

    def _finish(self, job_id: str, worker_id: str, status: JobStatus) -> JobRecord:
        now = as_timestamp(utc_now())
        with self._connect() as connection:
            changed = connection.execute(
                """
                UPDATE jobs SET status = ?, stage = ?, progress = ?, cancel_requested = 1,
                    updated_at = ?, finished_at = ?, lease_owner = NULL,
                    lease_expires_at = NULL, heartbeat_at = NULL
                WHERE id = ? AND lease_owner = ?
                """,
                (status.value, status.value, STAGE_PROGRESS[status], now, now, job_id, worker_id),
            ).rowcount
        if not changed:
            raise InvalidJobStateError(job_id)
        return self.get(job_id)

    def retry(self, job_id: str) -> JobRecord:
        job = self.get(job_id)
        if job.status not in {JobStatus.FAILED, JobStatus.CANCELED}:
            raise InvalidJobStateError(job_id)
        now = as_timestamp(utc_now())
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE jobs SET status = ?, stage = ?, progress = 0, cancel_requested = 0,
                    max_attempts = CASE WHEN max_attempts <= attempts THEN attempts + 1 ELSE max_attempts END,
                    error_code = NULL, error_message = NULL, updated_at = ?, finished_at = NULL,
                    lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL
                WHERE id = ?
                """,
                (JobStatus.QUEUED.value, JobStatus.QUEUED.value, now, job_id),
            )
        return self.get(job_id)

    def delete(self, job_id: str) -> JobRecord:
        job = self.get(job_id)
        if job.status not in TERMINAL_STATUSES:
            raise InvalidJobStateError(job_id)
        with self._connect() as connection:
            connection.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        return job

    def recover_active(self) -> tuple[int, int]:
        now = as_timestamp(utc_now())
        recovered = 0
        failed = 0
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(
                "SELECT id, attempts, max_attempts, cancel_requested FROM jobs WHERE status IN (?, ?, ?, ?)",
                tuple(item.value for item in ACTIVE_STATUSES),
            ).fetchall()
            for row in rows:
                if row["cancel_requested"]:
                    status = JobStatus.CANCELED
                elif row["attempts"] < row["max_attempts"]:
                    status = JobStatus.QUEUED
                    recovered += 1
                else:
                    status = JobStatus.FAILED
                    failed += 1
                connection.execute(
                    """
                    UPDATE jobs SET status = ?, stage = ?, progress = ?, updated_at = ?, finished_at = ?,
                        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
                        error_code = ?, error_message = ? WHERE id = ?
                    """,
                    (
                        status.value,
                        "recovered" if status is JobStatus.QUEUED else status.value,
                        0 if status is JobStatus.QUEUED else 100,
                        now,
                        None if status is JobStatus.QUEUED else now,
                        None if status in {JobStatus.QUEUED, JobStatus.CANCELED} else "worker_interrupted",
                        None if status in {JobStatus.QUEUED, JobStatus.CANCELED} else "worker stopped before completion",
                        row["id"],
                    ),
                )
            connection.execute("COMMIT")
        return recovered, failed
