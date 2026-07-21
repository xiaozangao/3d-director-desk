import tempfile
import unittest
from pathlib import Path

from services.kimodo.app.adapter import GenerationFailure
from services.kimodo.app.domain import GenerationRequest, JobStatus
from services.kimodo.app.repository import JobRepository
from services.kimodo.app.worker import JobWorker


class FakeAdapter:
    def __init__(self, failure: GenerationFailure | None = None, cancel=False):
        self.failure = failure
        self.cancel = cancel

    def generate(self, request, work_directory, progress, is_canceled):
        progress(JobStatus.GENERATING)
        if self.cancel:
            is_canceled()
            from services.kimodo.app.adapter import GenerationCanceled

            raise GenerationCanceled()
        if self.failure:
            raise self.failure
        progress(JobStatus.POSTPROCESSING)
        progress(JobStatus.EXPORTING)
        work_directory.mkdir(parents=True, exist_ok=True)
        result = work_directory / "motion.bvh"
        result.write_text("HIERARCHY\nMOTION\nFrames: 1\n", encoding="ascii")
        return result


class JobWorkerTest(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        root = Path(self.temp_directory.name)
        self.repository = JobRepository(root / "jobs.sqlite3")
        self.repository.initialize()
        self.output_dir = root / "results"
        self.work_dir = root / "work"

    def tearDown(self):
        self.temp_directory.cleanup()

    def create_job(self, max_attempts=2):
        return self.repository.create(
            GenerationRequest(prompt="A person waves.", duration_seconds=2),
            max_attempts=max_attempts,
        )

    def worker(self, adapter):
        return JobWorker(
            self.repository,
            adapter,
            self.output_dir,
            self.work_dir,
            worker_id="test-worker",
        )

    def test_success_atomically_publishes_bvh(self):
        job = self.create_job()
        self.assertTrue(self.worker(FakeAdapter()).run_once())
        completed = self.repository.get(job.id)
        self.assertEqual(completed.status, JobStatus.SUCCEEDED)
        self.assertEqual(Path(completed.result_path).read_text(encoding="ascii"), "HIERARCHY\nMOTION\nFrames: 1\n")
        self.assertFalse(list(self.output_dir.glob(".*.tmp-*.bvh")))

    def test_retryable_adapter_failure_requeues(self):
        job = self.create_job(max_attempts=2)
        adapter = FakeAdapter(GenerationFailure("gpu_out_of_memory", "out of memory", retryable=True))
        self.worker(adapter).run_once()
        failed = self.repository.get(job.id)
        self.assertEqual(failed.status, JobStatus.QUEUED)
        self.assertEqual(failed.error_code, "gpu_out_of_memory")

    def test_non_retryable_adapter_failure_is_terminal(self):
        job = self.create_job()
        adapter = FakeAdapter(GenerationFailure("model_unavailable", "token missing", retryable=False))
        self.worker(adapter).run_once()
        failed = self.repository.get(job.id)
        self.assertEqual(failed.status, JobStatus.FAILED)

    def test_queued_cancel_is_not_claimed(self):
        job = self.create_job()
        self.repository.request_cancel(job.id)
        self.assertFalse(self.worker(FakeAdapter()).run_once())
        self.assertEqual(self.repository.get(job.id).status, JobStatus.CANCELED)

    def test_cleanup_removes_abandoned_temporary_data(self):
        abandoned = self.work_dir / "job-abandoned"
        abandoned.mkdir(parents=True)
        temporary = self.output_dir / ".job.tmp-dead.bvh"
        temporary.parent.mkdir(parents=True)
        temporary.write_text("partial", encoding="ascii")
        self.worker(FakeAdapter()).cleanup_temporary_files()
        self.assertFalse(abandoned.exists())
        self.assertFalse(temporary.exists())


if __name__ == "__main__":
    unittest.main()
