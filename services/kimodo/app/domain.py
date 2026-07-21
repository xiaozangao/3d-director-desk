from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any


class JobStatus(str, Enum):
    QUEUED = "queued"
    LOADING = "loading"
    GENERATING = "generating"
    POSTPROCESSING = "postprocessing"
    EXPORTING = "exporting"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"


ACTIVE_STATUSES = {
    JobStatus.LOADING,
    JobStatus.GENERATING,
    JobStatus.POSTPROCESSING,
    JobStatus.EXPORTING,
}
TERMINAL_STATUSES = {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED}

STAGE_PROGRESS = {
    JobStatus.QUEUED: 0,
    JobStatus.LOADING: 10,
    JobStatus.GENERATING: 20,
    JobStatus.POSTPROCESSING: 80,
    JobStatus.EXPORTING: 95,
    JobStatus.SUCCEEDED: 100,
    JobStatus.FAILED: 100,
    JobStatus.CANCELED: 100,
}


@dataclass(frozen=True)
class GenerationRequest:
    prompt: str
    duration_seconds: float = 5.0
    model: str = "Kimodo-SOMA-RP-v1.1"
    seed: int | None = None

    def normalized(self) -> "GenerationRequest":
        prompt = " ".join(self.prompt.split())
        if not 3 <= len(prompt) <= 500:
            raise ValueError("prompt must contain between 3 and 500 characters")
        if not 2.0 <= self.duration_seconds <= 10.0:
            raise ValueError("durationSeconds must be between 2 and 10")
        model = self.model.strip()
        if not model or len(model) > 120:
            raise ValueError("model must contain between 1 and 120 characters")
        if self.seed is not None and not 0 <= self.seed <= 2_147_483_647:
            raise ValueError("seed must be between 0 and 2147483647")
        return GenerationRequest(
            prompt=prompt,
            duration_seconds=round(float(self.duration_seconds), 3),
            model=model,
            seed=self.seed,
        )


@dataclass(frozen=True)
class JobRecord:
    id: str
    prompt: str
    duration_seconds: float
    model: str
    seed: int | None
    status: JobStatus
    stage: str
    progress: int
    attempts: int
    max_attempts: int
    cancel_requested: bool
    error_code: str | None
    error_message: str | None
    result_path: str | None
    result_filename: str | None
    result_media_type: str | None
    result_size: int | None
    created_at: str
    updated_at: str
    started_at: str | None
    finished_at: str | None
    lease_owner: str | None
    lease_expires_at: str | None
    heartbeat_at: str | None

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["status"] = self.status.value
        return value
