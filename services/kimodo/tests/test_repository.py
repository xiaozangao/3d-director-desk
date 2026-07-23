import tempfile
import unittest
from pathlib import Path

from services.kimodo.app.domain import GenerationRequest, JobStatus
from services.kimodo.app.repository import InvalidJobStateError, JobNotFoundError, JobRepository


class JobRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.repository = JobRepository(Path(self.temp_directory.name) / "jobs.sqlite3")
        self.repository.initialize()

    def tearDown(self):
        self.temp_directory.cleanup()

    def create_job(self, max_attempts=2):
        return self.repository.create(
            GenerationRequest(prompt="A person waves hello.", duration_seconds=3, seed=17),
            max_attempts=max_attempts,
        )

    def test_creates_and_lists_normalized_jobs(self):
        job = self.repository.create(GenerationRequest(prompt="  A person   walks forward.  "))
        self.assertEqual(job.prompt, "A person walks forward.")
        self.assertEqual(job.status, JobStatus.QUEUED)
        self.assertEqual(self.repository.list(), [job])

    def test_claim_is_atomic_and_advances_attempt(self):
        created = self.create_job()
        claimed = self.repository.claim_next("worker-1")
        self.assertEqual(claimed.id, created.id)
        self.assertEqual(claimed.status, JobStatus.LOADING)
        self.assertEqual(claimed.attempts, 1)
        self.assertIsNone(self.repository.claim_next("worker-2"))

    def test_cancel_queued_job_is_terminal(self):
        job = self.create_job()
        canceled = self.repository.request_cancel(job.id)
        self.assertEqual(canceled.status, JobStatus.CANCELED)
        self.assertTrue(canceled.cancel_requested)

    def test_running_job_records_cancel_request_then_worker_finishes_it(self):
        job = self.create_job()
        self.repository.claim_next("worker-1")
        requested = self.repository.request_cancel(job.id)
        self.assertEqual(requested.status, JobStatus.LOADING)
        self.assertTrue(requested.cancel_requested)
        canceled = self.repository.mark_canceled(job.id, "worker-1")
        self.assertEqual(canceled.status, JobStatus.CANCELED)

    def test_retryable_failure_requeues_until_limit(self):
        job = self.create_job(max_attempts=2)
        self.repository.claim_next("worker-1")
        retrying = self.repository.fail(job.id, "worker-1", "temporary", "try again", retryable=True)
        self.assertEqual(retrying.status, JobStatus.QUEUED)
        self.repository.claim_next("worker-1")
        failed = self.repository.fail(job.id, "worker-1", "temporary", "try again", retryable=True)
        self.assertEqual(failed.status, JobStatus.FAILED)

    def test_manual_retry_reopens_terminal_job(self):
        job = self.create_job(max_attempts=1)
        self.repository.claim_next("worker-1")
        self.repository.fail(job.id, "worker-1", "bad", "failed", retryable=False)
        retried = self.repository.retry(job.id)
        self.assertEqual(retried.status, JobStatus.QUEUED)
        self.assertGreater(retried.max_attempts, retried.attempts)

    def test_recover_active_requeues_interrupted_job(self):
        job = self.create_job(max_attempts=2)
        self.repository.claim_next("old-worker")
        self.assertEqual(self.repository.recover_active(), (1, 0))
        recovered = self.repository.get(job.id)
        self.assertEqual(recovered.status, JobStatus.QUEUED)
        self.assertIsNone(recovered.lease_owner)

    def test_complete_publishes_result_metadata(self):
        job = self.create_job()
        self.repository.claim_next("worker-1")
        completed = self.repository.complete(
            job.id, "worker-1", "/tmp/result.bvh", "motion.bvh", 1234
        )
        self.assertEqual(completed.status, JobStatus.SUCCEEDED)
        self.assertEqual(completed.result_size, 1234)

    def test_delete_rejects_active_job(self):
        job = self.create_job()
        with self.assertRaises(InvalidJobStateError):
            self.repository.delete(job.id)

    def test_missing_job_raises(self):
        with self.assertRaises(JobNotFoundError):
            self.repository.get("missing")

    def test_request_validation(self):
        with self.assertRaises(ValueError):
            self.repository.create(GenerationRequest(prompt="x"))
        with self.assertRaises(ValueError):
            self.repository.create(GenerationRequest(prompt="A person walks.", duration_seconds=12))


if __name__ == "__main__":
    unittest.main()
