import { isKimodoJobTerminal, mergeKimodoJobs } from "../kimodoJobs";
import type { KimodoJob } from "../kimodoApi";

function makeJob(id: string, status: KimodoJob["status"], createdAt: string): KimodoJob {
  return {
    id,
    prompt: id,
    durationSeconds: 3,
    model: "model",
    seed: null,
    status,
    stage: status,
    progress: 0,
    attempts: 0,
    maxAttempts: 2,
    cancelRequested: false,
    error: null,
    result: null,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
  };
}

it("recognizes terminal job states", () => {
  expect(isKimodoJobTerminal(makeJob("a", "succeeded", "1"))).toBe(true);
  expect(isKimodoJobTerminal(makeJob("b", "failed", "1"))).toBe(true);
  expect(isKimodoJobTerminal(makeJob("c", "canceled", "1"))).toBe(true);
  expect(isKimodoJobTerminal(makeJob("d", "generating", "1"))).toBe(false);
});
it("merges refreshed jobs and keeps newest first", () => {
  const old = makeJob("same", "queued", "2026-07-20T00:00:00Z");
  const refreshed = { ...old, status: "generating" as const, progress: 20 };
  const newer = makeJob("new", "queued", "2026-07-21T00:00:00Z");
  expect(mergeKimodoJobs([old], [refreshed, newer])).toEqual([newer, refreshed]);
});
