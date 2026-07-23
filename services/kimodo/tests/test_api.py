import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from services.kimodo.app.api import create_app
from services.kimodo.app.config import AppConfig
from services.kimodo.app.domain import GenerationRequest
from services.kimodo.app.repository import JobRepository


class StaticSupervisor:
    def start(self):
        pass

    def stop(self):
        pass

    def status(self):
        return {"alive": False, "pid": None, "restarts": 0}


class KimodoApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        root = Path(self.temp_directory.name)
        self.config = AppConfig(
            data_dir=root,
            database_path=root / "jobs.sqlite3",
            output_dir=root / "results",
            work_dir=root / "work",
            cors_origins=("http://127.0.0.1:5173",),
            kimodo_executable="definitely-not-installed-kimodo",
            start_worker=False,
        )
        self.repository = JobRepository(self.config.database_path)
        self.app = create_app(self.config, self.repository, StaticSupervisor())
        self.client_context = TestClient(self.app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.temp_directory.cleanup()

    def test_health_reports_degraded_without_cli(self):
        response = self.client.get("/api/v1/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "degraded")
        self.assertFalse(response.json()["kimodoCliAvailable"])

    def test_create_list_and_detail(self):
        response = self.client.post(
            "/api/v1/jobs",
            json={"prompt": "A person waves hello.", "durationSeconds": 3, "seed": 7},
        )
        self.assertEqual(response.status_code, 201)
        created = response.json()
        self.assertEqual(created["status"], "queued")
        self.assertEqual(created["durationSeconds"], 3)
        self.assertEqual(self.client.get(f"/api/v1/jobs/{created['id']}").json(), created)
        self.assertEqual(self.client.get("/api/v1/jobs").json()["jobs"], [created])

    def test_invalid_request_has_stable_code(self):
        response = self.client.post("/api/v1/jobs", json={"prompt": "x", "durationSeconds": 20})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "invalid_request")

    def test_missing_job_returns_stable_code(self):
        response = self.client.get("/api/v1/jobs/missing")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["code"], "job_not_found")

    def test_cancel_and_retry(self):
        created = self.client.post("/api/v1/jobs", json={"prompt": "A person jumps."}).json()
        canceled = self.client.post(f"/api/v1/jobs/{created['id']}/cancel")
        self.assertEqual(canceled.json()["status"], "canceled")
        retried = self.client.post(f"/api/v1/jobs/{created['id']}/retry")
        self.assertEqual(retried.json()["status"], "queued")

    def test_retry_active_job_is_conflict(self):
        created = self.client.post("/api/v1/jobs", json={"prompt": "A person jumps."}).json()
        response = self.client.post(f"/api/v1/jobs/{created['id']}/retry")
        self.assertEqual(response.status_code, 409)

    def test_result_download_and_delete(self):
        job = self.repository.create(GenerationRequest(prompt="A person waves."))
        self.repository.claim_next("worker")
        result = self.config.output_dir / f"{job.id}.bvh"
        result.parent.mkdir(parents=True, exist_ok=True)
        result.write_text("HIERARCHY", encoding="ascii")
        self.repository.complete(job.id, "worker", str(result), "motion.bvh", result.stat().st_size)

        response = self.client.get(f"/api/v1/jobs/{job.id}/result")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"HIERARCHY")
        deleted = self.client.delete(f"/api/v1/jobs/{job.id}")
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(result.exists())

    def test_active_job_cannot_be_deleted(self):
        created = self.client.post("/api/v1/jobs", json={"prompt": "A person jumps."}).json()
        response = self.client.delete(f"/api/v1/jobs/{created['id']}")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["code"], "invalid_job_state")

    def test_failed_job_can_be_deleted(self):
        job = self.repository.create(GenerationRequest(prompt="A person jumps."))
        self.repository.claim_next("worker")
        self.repository.fail(job.id, "worker", "generation_failed", "Generation failed", retryable=False)
        response = self.client.delete(f"/api/v1/jobs/{job.id}")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.client.get(f"/api/v1/jobs/{job.id}").status_code, 404)

    def test_result_path_outside_output_directory_is_rejected(self):
        job = self.repository.create(GenerationRequest(prompt="A person waves."))
        self.repository.claim_next("worker")
        outside = self.config.data_dir / "outside.bvh"
        outside.write_text("HIERARCHY", encoding="ascii")
        self.repository.complete(job.id, "worker", str(outside), "motion.bvh", outside.stat().st_size)
        response = self.client.get(f"/api/v1/jobs/{job.id}/result")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
