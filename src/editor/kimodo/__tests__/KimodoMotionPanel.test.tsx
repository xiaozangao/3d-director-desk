import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KimodoMotionPanel } from "../KimodoMotionPanel";
import { KIMODO_API_BASE_URL_STORAGE_KEY, type KimodoJob } from "../kimodoApi";

beforeEach(() => {
  localStorage.removeItem(KIMODO_API_BASE_URL_STORAGE_KEY);
});

function makeJob(status: KimodoJob["status"]): KimodoJob {
  return {
    id: "job-1",
    prompt: "A person waves.",
    durationSeconds: 3,
    model: "model",
    seed: null,
    status,
    stage: status,
    progress: status === "succeeded" ? 100 : 20,
    attempts: 1,
    maxAttempts: 2,
    cancelRequested: false,
    error: status === "failed" ? { code: "generation_failed", message: "生成失败" } : null,
    result: status === "succeeded" ? {
      fileName: "motion.bvh",
      mediaType: "application/octet-stream",
      byteLength: 10,
      downloadUrl: "/result",
    } : null,
    createdAt: "2026-07-21T00:00:00Z",
    updatedAt: "2026-07-21T00:00:01Z",
    startedAt: null,
    finishedAt: null,
  };
}

function makeApi(jobs: KimodoJob[]) {
  return {
    health: vi.fn(async () => ({
      status: "ok" as const,
      database: true,
      worker: { alive: true, pid: 7, restarts: 0 },
      kimodoCliAvailable: true,
    })),
    listJobs: vi.fn(async () => jobs),
    createJob: vi.fn(async () => makeJob("queued")),
    cancelJob: vi.fn(async () => makeJob("canceled")),
    retryJob: vi.fn(async () => makeJob("queued")),
    deleteJob: vi.fn(async () => undefined),
    downloadResult: vi.fn(async () => new Blob()),
  };
}

it("shows recovered jobs and imports a successful result", async () => {
  const api = makeApi([makeJob("succeeded")]);
  const importJob = vi.fn(async () => undefined);
  render(<KimodoMotionPanel api={api} characterId="character-1" importJob={importJob} />);

  expect(await screen.findByText("已完成 · 100%")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "导入动作 A person waves." }));
  await waitFor(() => expect(importJob).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1" }), "character-1"));
  expect(screen.getByText("动作已导入并应用到当前角色")).toBeInTheDocument();
});

it("deletes a terminal job and removes it from the list", async () => {
  const api = makeApi([makeJob("failed")]);
  render(<KimodoMotionPanel api={api} characterId="character-1" />);

  const deleteButton = await screen.findByRole("button", { name: "删除任务 A person waves." });
  await userEvent.click(deleteButton);

  await waitFor(() => expect(api.deleteJob).toHaveBeenCalledWith("job-1"));
  expect(screen.queryByText("A person waves.")).not.toBeInTheDocument();
});

it("lets the user persist a custom Kimodo service URL", async () => {
  const api = makeApi([]);
  render(<KimodoMotionPanel api={api} characterId="character-1" />);

  const settingsButton = screen.getByRole("button", { name: "设置 Kimodo 服务" });
  await userEvent.click(settingsButton);
  expect(settingsButton).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("dialog", { name: "Kimodo 服务设置" })).toBeInTheDocument();

  const addressInput = screen.getByRole("textbox", { name: "Kimodo 服务地址" });
  await userEvent.clear(addressInput);
  await userEvent.type(addressInput, "http://192.168.1.8:8787/");
  await userEvent.click(screen.getByRole("button", { name: "保存" }));

  expect(localStorage.getItem(KIMODO_API_BASE_URL_STORAGE_KEY)).toBe("http://192.168.1.8:8787");
  expect(settingsButton).toHaveAttribute("aria-expanded", "false");
});

it("disables generation when the local service is offline", async () => {
  const api = makeApi([]);
  api.health.mockRejectedValue(new Error("offline"));
  render(<KimodoMotionPanel api={api} characterId="character-1" />);
  expect(await screen.findByText("离线")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成" })).toBeDisabled();
});
