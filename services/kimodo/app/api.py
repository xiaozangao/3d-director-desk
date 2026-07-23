from __future__ import annotations

import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

from .config import AppConfig
from .domain import GenerationRequest, JobRecord, JobStatus, TERMINAL_STATUSES
from .repository import InvalidJobStateError, JobNotFoundError, JobRepository
from .worker import WorkerConfig, WorkerSupervisor


class CreateJobBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str
    durationSeconds: float = 5.0
    model: str = "Kimodo-SOMA-RP-v1.1"
    seed: int | None = None


def job_payload(job: JobRecord) -> dict[str, Any]:
    return {
        "id": job.id,
        "prompt": job.prompt,
        "durationSeconds": job.duration_seconds,
        "model": job.model,
        "seed": job.seed,
        "status": job.status.value,
        "stage": job.stage,
        "progress": job.progress,
        "attempts": job.attempts,
        "maxAttempts": job.max_attempts,
        "cancelRequested": job.cancel_requested,
        "error": (
            {"code": job.error_code, "message": job.error_message}
            if job.error_code and job.error_message
            else None
        ),
        "result": (
            {
                "fileName": job.result_filename,
                "mediaType": job.result_media_type,
                "byteLength": job.result_size,
                "downloadUrl": f"/api/v1/jobs/{job.id}/result",
            }
            if job.status is JobStatus.SUCCEEDED
            else None
        ),
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
        "startedAt": job.started_at,
        "finishedAt": job.finished_at,
    }


def error_response(http_status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


def create_app(
    config: AppConfig | None = None,
    repository: JobRepository | None = None,
    supervisor: WorkerSupervisor | None = None,
) -> FastAPI:
    config = config or AppConfig.from_environment()
    config.ensure_directories()
    repository = repository or JobRepository(config.database_path)
    repository.initialize()
    supervisor = supervisor or WorkerSupervisor(
        WorkerConfig(
            database_path=config.database_path,
            output_dir=config.output_dir,
            work_dir=config.work_dir,
            kimodo_executable=config.kimodo_executable,
            poll_seconds=config.worker_poll_seconds,
            lease_seconds=config.lease_seconds,
        )
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        repository.recover_active()
        if config.start_worker:
            supervisor.start()
        try:
            yield
        finally:
            if config.start_worker:
                supervisor.stop()

    app = FastAPI(
        title="3D Director Desk Kimodo Service",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.config = config
    app.state.repository = repository
    app.state.supervisor = supervisor
    if config.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(config.cors_origins),
            allow_credentials=False,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Content-Type"],
        )

    def get_job(job_id: str) -> JobRecord:
        try:
            return repository.get(job_id)
        except JobNotFoundError:
            raise error_response(status.HTTP_404_NOT_FOUND, "job_not_found", "Kimodo job was not found")

    @app.get("/api/v1/health")
    def health() -> dict[str, Any]:
        worker = supervisor.status() if config.start_worker else {"alive": False, "pid": None, "restarts": 0}
        cli_available = bool(shutil.which(config.kimodo_executable))
        ready = bool(worker["alive"] and cli_available) if config.start_worker else cli_available
        return {
            "status": "ok" if ready else "degraded",
            "database": True,
            "worker": worker,
            "kimodoCliAvailable": cli_available,
        }

    @app.post("/api/v1/jobs", status_code=status.HTTP_201_CREATED)
    def create_job(body: CreateJobBody) -> dict[str, Any]:
        try:
            job = repository.create(
                GenerationRequest(
                    prompt=body.prompt,
                    duration_seconds=body.durationSeconds,
                    model=body.model,
                    seed=body.seed,
                ),
                max_attempts=config.max_attempts,
            )
        except ValueError as error:
            raise error_response(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_request", str(error))
        return job_payload(job)

    @app.get("/api/v1/jobs")
    def list_jobs(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
        jobs = repository.list(limit)
        return {"jobs": [job_payload(job) for job in jobs]}

    @app.get("/api/v1/jobs/{job_id}")
    def job_detail(job_id: str) -> dict[str, Any]:
        return job_payload(get_job(job_id))

    @app.post("/api/v1/jobs/{job_id}/cancel")
    def cancel_job(job_id: str) -> dict[str, Any]:
        get_job(job_id)
        return job_payload(repository.request_cancel(job_id))

    @app.post("/api/v1/jobs/{job_id}/retry")
    def retry_job(job_id: str) -> dict[str, Any]:
        get_job(job_id)
        try:
            return job_payload(repository.retry(job_id))
        except InvalidJobStateError:
            raise error_response(status.HTTP_409_CONFLICT, "invalid_job_state", "Only failed or canceled jobs can retry")

    @app.delete(
        "/api/v1/jobs/{job_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
    )
    def delete_job(job_id: str) -> Response:
        job = get_job(job_id)
        if job.status not in TERMINAL_STATUSES:
            raise error_response(status.HTTP_409_CONFLICT, "invalid_job_state", "Only terminal jobs can be deleted")
        if job.result_path:
            candidate = Path(job.result_path).resolve()
            output_root = config.output_dir.resolve()
            if candidate.parent == output_root:
                candidate.unlink(missing_ok=True)
        repository.delete(job_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/v1/jobs/{job_id}/result")
    def download_result(job_id: str):
        job = get_job(job_id)
        if job.status is not JobStatus.SUCCEEDED or not job.result_path:
            raise error_response(status.HTTP_409_CONFLICT, "result_unavailable", "Job result is not available")
        candidate = Path(job.result_path).resolve()
        output_root = config.output_dir.resolve()
        if candidate.parent != output_root or not candidate.is_file():
            raise error_response(status.HTTP_404_NOT_FOUND, "result_missing", "Job result file is missing")
        return FileResponse(
            candidate,
            media_type=job.result_media_type or "application/octet-stream",
            filename=job.result_filename or f"kimodo-{job.id}.bvh",
        )

    return app
