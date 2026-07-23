from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable, Protocol

from .domain import GenerationRequest, JobStatus


ProgressCallback = Callable[[JobStatus], None]
CancelCheck = Callable[[], bool]


class GenerationCanceled(RuntimeError):
    pass


class GenerationFailure(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class MotionGenerationAdapter(Protocol):
    def generate(
        self,
        request: GenerationRequest,
        work_directory: Path,
        progress: ProgressCallback,
        is_canceled: CancelCheck,
    ) -> Path: ...


def tail_text(path: Path, maximum: int = 4000) -> str:
    try:
        value = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return "Kimodo process failed without a readable log"
    return value[-maximum:].strip() or "Kimodo process failed without an error message"


class KimodoCliAdapter:
    def __init__(self, executable: str = "kimodo_gen", poll_seconds: float = 0.25):
        self.executable = executable
        self.poll_seconds = poll_seconds

    def available(self) -> bool:
        return bool(shutil.which(self.executable))

    def generate(
        self,
        request: GenerationRequest,
        work_directory: Path,
        progress: ProgressCallback,
        is_canceled: CancelCheck,
    ) -> Path:
        executable = shutil.which(self.executable)
        if not executable:
            raise GenerationFailure(
                "model_unavailable",
                f"Kimodo executable '{self.executable}' is not installed",
                retryable=False,
            )

        work_directory.mkdir(parents=True, exist_ok=True)
        output_stem = work_directory / "motion"
        log_path = work_directory / "kimodo.log"
        command = [
            executable,
            request.prompt,
            "--model",
            request.model,
            "--duration",
            str(request.duration_seconds),
            "--output",
            str(output_stem),
            "--bvh",
            "--bvh_standard_tpose",
        ]
        if request.seed is not None:
            command.extend(["--seed", str(request.seed)])

        progress(JobStatus.GENERATING)
        with log_path.open("w", encoding="utf-8") as log_file:
            process = subprocess.Popen(
                command,
                cwd=work_directory,
                env=os.environ.copy(),
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                shell=False,
                text=True,
            )
            while process.poll() is None:
                if is_canceled():
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                    raise GenerationCanceled("generation canceled")
                time.sleep(self.poll_seconds)

        if process.returncode != 0:
            detail = tail_text(log_path)
            lowered = detail.lower()
            if "out of memory" in lowered or "cuda oom" in lowered:
                raise GenerationFailure("gpu_out_of_memory", "Kimodo ran out of GPU memory", retryable=True)
            if "hugging face" in lowered or "gated repo" in lowered or "401" in lowered:
                raise GenerationFailure("model_unavailable", "Hugging Face model access is unavailable", retryable=False)
            raise GenerationFailure("generation_failed", detail, retryable=True)

        progress(JobStatus.POSTPROCESSING)
        result = output_stem.with_suffix(".bvh")
        if not result.is_file() or result.stat().st_size == 0:
            raise GenerationFailure("result_missing", "Kimodo completed without a BVH result", retryable=False)
        progress(JobStatus.EXPORTING)
        return result
