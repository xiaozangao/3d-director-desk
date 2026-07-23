import { importKimodoResult } from "../importKimodoResult";
import type { KimodoJob } from "../kimodoApi";

const job: KimodoJob = {
  id: "job-1",
  prompt: "A person waves hello.",
  durationSeconds: 3,
  model: "Kimodo-SOMA-RP-v1.1",
  seed: 5,
  status: "succeeded",
  stage: "succeeded",
  progress: 100,
  attempts: 1,
  maxAttempts: 2,
  cancelRequested: false,
  error: null,
  result: {
    fileName: "motion.bvh",
    mediaType: "application/octet-stream",
    byteLength: 32,
    downloadUrl: "/api/v1/jobs/job-1/result",
  },
  createdAt: "2026-07-21T00:00:00Z",
  updatedAt: "2026-07-21T00:00:01Z",
  startedAt: "2026-07-21T00:00:00Z",
  finishedAt: "2026-07-21T00:00:01Z",
};

it("persists a successful BVH and applies its first clip", async () => {
  const addImportedAnimationAsset = vi.fn(() => "animation-1");
  const applyCharacterActionPreset = vi.fn();
  const restartPlayback = vi.fn();
  const result = await importKimodoResult(job, "character-1", {
    api: { downloadResult: vi.fn(async () => new Blob(["HIERARCHY"])) },
    storage: {
      isAvailable: true,
      save: vi.fn(async (file) => ({
        key: "stored-1",
        blob: file,
        fileName: file.name,
        mimeType: file.type,
        byteLength: file.size,
        updatedAt: 1,
      })),
    },
    inspect: vi.fn(async () => ({
      format: "bvh" as const,
      clips: [{ name: "animation", duration: 3, trackCount: 20 }],
      clipCount: 1,
      rigProfile: "soma" as const,
      hasValidMotion: true,
      warnings: [],
    })),
    addImportedAnimationAsset,
    applyCharacterActionPreset,
    restartPlayback,
  });

  expect(addImportedAnimationAsset).toHaveBeenCalledWith(expect.objectContaining({
    name: "Kimodo · A person waves hello",
    modelFormat: "bvh",
    rigProfile: "soma",
    storageKey: "stored-1",
    clips: [expect.objectContaining({ name: "A person waves hello" })],
  }));
  expect(applyCharacterActionPreset).toHaveBeenCalledWith("character-1", expect.stringContaining("imported-action:"));
  expect(restartPlayback).toHaveBeenCalled();
  expect(result.clipCount).toBe(1);
});
