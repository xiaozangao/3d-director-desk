from __future__ import annotations

import multiprocessing
import os
import shutil
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .adapter import GenerationCanceled, GenerationFailure, KimodoCliAdapter, MotionGenerationAdapter
from .domain import GenerationRequest, JobStatus
from .repository import InvalidJobStateError, JobRepository


@dataclass(frozen=True)
class WorkerConfig:
    database_path: Path
    output_dir: Path
    work_dir: Path
    kimodo_executable: str = "kimodo_gen"
    poll_seconds: float = 0.5
    lease_seconds: int = 30


class JobWorker:
    def __init__(
        self,
        repository: JobRepository,
        adapter: MotionGenerationAdapter,
        output_dir: Path,
        work_dir: Path,
        worker_id: str | None = None,
        lease_seconds: int = 30,
    ):
        self.repository = repository
        self.adapter = adapter
        self.output_dir = output_dir
        self.work_dir = work_dir
        self.worker_id = worker_id or f"worker-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        self.lease_seconds = lease_seconds

    def cleanup_temporary_files(self) -> None:
        self.work_dir.mkdir(parents=True, exist_ok=True)
        for candidate in self.work_dir.glob("job-*"):
            if candidate.is_dir():
                shutil.rmtree(candidate, ignore_errors=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        for candidate in self.output_dir.glob(".*.tmp-*.bvh"):
            candidate.unlink(missing_ok=True)

    def run_once(self) -> bool:
        job = self.repository.claim_next(self.worker_id, self.lease_seconds)
        if job is None:
            return False

        job_work_dir = self.work_dir / f"job-{job.id}-{uuid.uuid4().hex[:8]}"
        temporary_result = self.output_dir / f".{job.id}.tmp-{uuid.uuid4().hex}.bvh"
        final_result = self.output_dir / f"{job.id}.bvh"
        request = GenerationRequest(
            prompt=job.prompt,
            duration_seconds=job.duration_seconds,
            model=job.model,
            seed=job.seed,
        )

        def progress(status: JobStatus) -> None:
            self.repository.update_stage(job.id, self.worker_id, status, self.lease_seconds)

        def is_canceled() -> bool:
            canceled = self.repository.is_cancel_requested(job.id)
            if not canceled:
                self.repository.heartbeat(job.id, self.worker_id, self.lease_seconds)
            return canceled

        try:
            generated = self.adapter.generate(request, job_work_dir, progress, is_canceled)
            if is_canceled():
                raise GenerationCanceled("generation canceled")
            self.output_dir.mkdir(parents=True, exist_ok=True)
            os.replace(generated, temporary_result)
            os.replace(temporary_result, final_result)
            self.repository.complete(
                job.id,
                self.worker_id,
                str(final_result),
                f"kimodo-{job.id}.bvh",
                final_result.stat().st_size,
            )
        except GenerationCanceled:
            temporary_result.unlink(missing_ok=True)
            final_result.unlink(missing_ok=True)
            self.repository.mark_canceled(job.id, self.worker_id)
        except GenerationFailure as error:
            temporary_result.unlink(missing_ok=True)
            final_result.unlink(missing_ok=True)
            self.repository.fail(job.id, self.worker_id, error.code, str(error), error.retryable)
        except (OSError, RuntimeError) as error:
            temporary_result.unlink(missing_ok=True)
            final_result.unlink(missing_ok=True)
            try:
                self.repository.fail(job.id, self.worker_id, "worker_failed", str(error), retryable=True)
            except InvalidJobStateError:
                pass
        finally:
            shutil.rmtree(job_work_dir, ignore_errors=True)
        return True


def worker_process_main(config: WorkerConfig, stop_event) -> None:
    repository = JobRepository(config.database_path)
    repository.initialize()
    worker = JobWorker(
        repository=repository,
        adapter=KimodoCliAdapter(config.kimodo_executable),
        output_dir=config.output_dir,
        work_dir=config.work_dir,
        lease_seconds=config.lease_seconds,
    )
    worker.cleanup_temporary_files()
    while not stop_event.is_set():
        if not worker.run_once():
            stop_event.wait(config.poll_seconds)


class WorkerSupervisor:
    def __init__(self, config: WorkerConfig, check_seconds: float = 2.0):
        self.config = config
        self.check_seconds = check_seconds
        self._context = multiprocessing.get_context("spawn")
        self._stop_event = self._context.Event()
        self._process: multiprocessing.Process | None = None
        self._monitor: threading.Thread | None = None
        self._closed = threading.Event()
        self._restarts = 0

    def _spawn(self) -> None:
        process = self._context.Process(
            target=worker_process_main,
            args=(self.config, self._stop_event),
            name="kimodo-gpu-worker",
            daemon=True,
        )
        process.start()
        self._process = process

    def start(self) -> None:
        if self._monitor and self._monitor.is_alive():
            return
        self._closed.clear()
        self._stop_event.clear()
        self._spawn()
        self._monitor = threading.Thread(target=self._monitor_loop, name="kimodo-worker-supervisor", daemon=True)
        self._monitor.start()

    def _monitor_loop(self) -> None:
        while not self._closed.wait(self.check_seconds):
            if self._process and self._process.is_alive():
                continue
            if self._stop_event.is_set():
                return
            self._restarts += 1
            self._spawn()

    def stop(self) -> None:
        self._closed.set()
        self._stop_event.set()
        if self._process:
            self._process.join(timeout=10)
            if self._process.is_alive():
                self._process.terminate()
                self._process.join(timeout=5)
        if self._monitor:
            self._monitor.join(timeout=5)

    def status(self) -> dict[str, int | bool | None]:
        return {
            "alive": bool(self._process and self._process.is_alive()),
            "pid": self._process.pid if self._process else None,
            "restarts": self._restarts,
        }
