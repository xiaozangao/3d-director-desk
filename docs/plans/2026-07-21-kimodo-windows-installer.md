# Kimodo Windows Installer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a guided Windows installer and lifecycle commands for the local Kimodo service.

**Architecture:** Keep Docker Compose as the only supported runtime boundary. Add a PowerShell command dispatcher for preflight checks, secret setup, Compose lifecycle operations, and API readiness checks, plus a CMD launcher for double-click installation.

**Tech Stack:** PowerShell 5.1+, Docker Desktop, Docker Compose v2, FastAPI health API.

---

### Task 1: Add the service manager

**Files:**
- Create: `scripts/kimodo-service.ps1`

**Steps:**
1. Add parameter validation for `doctor`, `install`, `start`, `stop`, `restart`, `status`, and `logs`.
2. Implement Docker, Compose, memory, token, and GPU checks.
3. Implement secure interactive Token persistence.
4. Implement Compose lifecycle operations and bounded health polling.
5. Parse the script with the PowerShell AST parser and run `doctor` against the current environment.

### Task 2: Add the double-click entry point

**Files:**
- Create: `install-kimodo.cmd`

**Steps:**
1. Invoke the PowerShell manager with a process-local execution-policy override.
2. Preserve the exit code and keep failures visible to the user.
3. Run the launcher through a non-interactive prerequisite-failure path.

### Task 3: Update installation documentation

**Files:**
- Modify: `docs/KIMODO.md`
- Modify: `README.md`
- Modify: `.env.kimodo.example`
- Modify: `docker-compose.kimodo.yml`

**Steps:**
1. Make the guided installer the primary Windows path.
2. Keep manual Compose commands as an advanced fallback.
3. Document lifecycle commands, data retention, prerequisites, and first-run size/time expectations.
4. Allow the local fallback development port in the default CORS list.

### Task 4: Verify the installer release surface

**Files:**
- Verify: `scripts/kimodo-service.ps1`
- Verify: `docker-compose.kimodo.yml`
- Verify: `services/kimodo/tests`

**Steps:**
1. Run PowerShell syntax parsing.
2. Run `doctor` and confirm graceful reporting when Docker Desktop is stopped.
3. Run `docker compose config --quiet`.
4. Run backend tests, the relevant frontend tests, production build, and `git diff --check`.
