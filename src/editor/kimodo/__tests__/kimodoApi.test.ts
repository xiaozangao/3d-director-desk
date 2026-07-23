import {
  KIMODO_API_BASE_URL_STORAGE_KEY,
  createKimodoApi,
  KimodoApiError,
  normalizeKimodoApiBaseUrl,
  readKimodoApiBaseUrl,
  resetKimodoApiBaseUrl,
  validateKimodoApiBaseUrl,
  writeKimodoApiBaseUrl,
  type KimodoJob,
} from "../kimodoApi";

const job: KimodoJob = {
  id: "job-1",
  prompt: "A person waves.",
  durationSeconds: 3,
  model: "Kimodo-SOMA-RP-v1.1",
  seed: null,
  status: "queued",
  stage: "queued",
  progress: 0,
  attempts: 0,
  maxAttempts: 2,
  cancelRequested: false,
  error: null,
  result: null,
  createdAt: "2026-07-21T00:00:00Z",
  updatedAt: "2026-07-21T00:00:00Z",
  startedAt: null,
  finishedAt: null,
};

it("normalizes the configured API base URL", () => {
  expect(normalizeKimodoApiBaseUrl(" http://localhost:8787/// ")).toBe("http://localhost:8787");
  expect(normalizeKimodoApiBaseUrl(undefined)).toBe("http://127.0.0.1:8787");
});

it("validates and persists a custom API base URL", () => {
  localStorage.removeItem(KIMODO_API_BASE_URL_STORAGE_KEY);
  expect(validateKimodoApiBaseUrl(" http://192.168.1.8:8787/// ")).toBe("http://192.168.1.8:8787");
  expect(writeKimodoApiBaseUrl("https://kimodo.local/api/")).toBe("https://kimodo.local/api");
  expect(readKimodoApiBaseUrl()).toBe("https://kimodo.local/api");
  expect(resetKimodoApiBaseUrl()).toBe("http://127.0.0.1:8787");
  expect(localStorage.getItem(KIMODO_API_BASE_URL_STORAGE_KEY)).toBeNull();
});

it("rejects unsafe or incomplete API base URLs", () => {
  expect(() => validateKimodoApiBaseUrl("192.168.1.8:8787")).toThrow("完整");
  expect(() => validateKimodoApiBaseUrl("file:///tmp/kimodo")).toThrow("http://");
  expect(() => validateKimodoApiBaseUrl("https://kimodo.local/?token=secret")).toThrow("http://");
});

it("creates a job with the versioned endpoint", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(job), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  }));
  const api = createKimodoApi("http://localhost:8787/", request);
  await expect(api.createJob({ prompt: job.prompt, durationSeconds: 3 })).resolves.toEqual(job);
  expect(request).toHaveBeenCalledWith("http://localhost:8787/api/v1/jobs", expect.objectContaining({ method: "POST" }));
});

it("maps structured server errors", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    detail: { code: "invalid_request", message: "Prompt is invalid" },
  }), { status: 422, headers: { "Content-Type": "application/json" } }));
  const api = createKimodoApi("http://localhost:8787", request);
  const error = await api.createJob({ prompt: "x", durationSeconds: 3 }).catch((value) => value);
  expect(error).toBeInstanceOf(KimodoApiError);
  expect(error).toMatchObject({ code: "invalid_request", status: 422, message: "Prompt is invalid" });
});

it("deletes a terminal job with the versioned endpoint", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  const api = createKimodoApi("http://localhost:8787/", request);
  await expect(api.deleteJob("job/1")).resolves.toBeUndefined();
  expect(request).toHaveBeenCalledWith(
    "http://localhost:8787/api/v1/jobs/job%2F1",
    expect.objectContaining({ method: "DELETE" })
  );
});

it("maps network failures without leaking fetch details", async () => {
  const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("connection refused"));
  const api = createKimodoApi("http://localhost:8787", request);
  await expect(api.health()).rejects.toMatchObject({ code: "service_unavailable", status: 0 });
});
