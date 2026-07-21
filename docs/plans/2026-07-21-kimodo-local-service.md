# Kimodo Local Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local, persistent Kimodo motion-generation service with queue progress, recovery, Docker deployment, and one-click BVH import into the selected director-desk character.

**Architecture:** A FastAPI modular monolith owns a SQLite job database and supervises one GPU worker process. The React app polls the versioned API, downloads successful BVH results, stores them in IndexedDB, and reuses the existing animation-asset and playback pipeline.

**Tech Stack:** Python 3.10, FastAPI, SQLite, multiprocessing, Kimodo/PyTorch, Docker Compose, React 18, TypeScript, Three.js BVHLoader, Vitest.

---

### Task 1: Service domain and persistent repository

**Files:**
- Create: `services/kimodo/app/domain.py`
- Create: `services/kimodo/app/repository.py`
- Create: `services/kimodo/tests/test_repository.py`

**Steps:**
1. Write tests for create/list/get, legal state transitions, atomic claim, cancellation, retry metadata and stale-lease recovery.
2. Run `python -m unittest services.kimodo.tests.test_repository -v`; expect failures because modules do not exist.
3. Implement immutable request validation, job records and a SQLite repository using transactions and parameterized SQL.
4. Re-run the focused test; expect PASS.

### Task 2: Adapter boundary and worker supervision

**Files:**
- Create: `services/kimodo/app/adapter.py`
- Create: `services/kimodo/app/worker.py`
- Create: `services/kimodo/tests/test_worker.py`

**Steps:**
1. Write a fake adapter that emits stages and can fail deterministically.
2. Test successful atomic result publication, safe error summaries, retries, cancellation and stale temporary-file cleanup.
3. Implement a lazy `KimodoAdapter` around `load_model`, generation and standard-T-pose BVH export.
4. Implement one worker loop and supervisor lifecycle without importing Kimodo in API-only tests.
5. Run the focused worker tests; expect PASS.

### Task 3: Versioned FastAPI

**Files:**
- Create: `services/kimodo/app/api.py`
- Create: `services/kimodo/app/config.py`
- Create: `services/kimodo/app/main.py`
- Create: `services/kimodo/tests/test_api.py`
- Create: `services/kimodo/requirements-dev.txt`

**Steps:**
1. Test health, create/list/detail, cancel, retry, delete and result download endpoints.
2. Test prompt bounds, duration bounds, UUID parsing, CORS configuration and missing result behavior.
3. Implement Pydantic response models and stable error codes.
4. Run `python -m unittest discover -s services/kimodo/tests -v`; expect PASS.

### Task 4: BVH animation support

**Files:**
- Modify: `src/editor/schema/directorProject.ts`
- Modify: `src/editor/store/directorStore.types.ts`
- Modify: `src/editor/loaders/characterAnimationInspection.ts`
- Modify: `src/editor/runtime/MixamoCharacterModel.tsx`
- Modify: `src/editor/panels/characterAnimationCompatibility.ts`
- Test: `src/editor/loaders/__tests__/characterAnimationInspection.test.ts`
- Test: `src/editor/runtime/__tests__/MixamoCharacterModel.test.ts`

**Steps:**
1. Add failing tests for `.bvh` recognition, SOMA rig profile detection, BVH clip loading and semantic bone mapping.
2. Extend animation format types without adding BVH as a scene model format.
3. Load BVH through `BVHLoader`, construct the source hierarchy, and reuse the existing rest-pose retarget pipeline.
4. Ensure horizontal root translation is removed while vertical root motion is retained.
5. Run focused Vitest suites; expect PASS.

### Task 5: Frontend API client and recoverable job state

**Files:**
- Create: `src/editor/kimodo/kimodoApi.ts`
- Create: `src/editor/kimodo/kimodoJobs.ts`
- Test: `src/editor/kimodo/__tests__/kimodoApi.test.ts`
- Test: `src/editor/kimodo/__tests__/kimodoJobs.test.ts`

**Steps:**
1. Test URL normalization, request errors, abort behavior and server response parsing.
2. Test polling transitions and recovery from the server job list.
3. Implement a client configured by `VITE_KIMODO_API_URL`, defaulting to `http://127.0.0.1:8787`.
4. Implement one-second polling with cleanup and terminal-state detection.
5. Run focused tests; expect PASS.

### Task 6: Kimodo generation panel and result import

**Files:**
- Create: `src/editor/kimodo/KimodoMotionPanel.tsx`
- Create: `src/editor/kimodo/importKimodoResult.ts`
- Modify: `src/editor/panels/CharacterPanel.tsx`
- Modify: `src/styles/inspector.css`
- Test: `src/editor/kimodo/__tests__/KimodoMotionPanel.test.tsx`
- Test: `src/editor/kimodo/__tests__/importKimodoResult.test.ts`

**Steps:**
1. Test offline, queued, running, failed/retry, canceled and success/import UI states.
2. Implement prompt, duration, seed and submit controls in the character action tab.
3. Download a successful BVH as `File`, inspect it, persist it with existing IndexedDB storage, add an animation asset and apply its first clip.
4. Keep controls disabled when no character is selected or service is offline.
5. Run component tests and inspect text wrapping at desktop/mobile widths.

### Task 7: Container deployment and operations

**Files:**
- Create: `services/kimodo/Dockerfile`
- Create: `services/kimodo/requirements.txt`
- Create: `docker-compose.kimodo.yml`
- Create: `.env.kimodo.example`
- Create: `docs/KIMODO.md`
- Modify: `.gitignore`
- Modify: `README.md`

**Steps:**
1. Define a persistent `/data` volume, Hugging Face cache mount, GPU reservation and health check.
2. Keep secrets out of Compose and document `hf auth login` or token mounting.
3. Validate with `docker compose -f docker-compose.kimodo.yml config`.
4. Document startup, health checks, logs, backup, retry, cleanup and offline behavior.

### Task 8: Full verification

**Steps:**
1. Run `python -m unittest discover -s services/kimodo/tests -v`; expect all PASS.
2. Run `npm test`; expect all PASS.
3. Run `npm run build`; expect success with only documented existing chunk warnings.
4. Run `git diff --check`; expect no output.
5. Start the local frontend and fake service for browser verification.
6. With Hugging Face access available, run one 2-second real Kimodo job and verify non-empty BVH playback across main view, monitor, scrub and replay.
