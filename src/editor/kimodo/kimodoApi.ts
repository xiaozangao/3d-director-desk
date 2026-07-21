export type KimodoJobStatus =
  | "queued"
  | "loading"
  | "generating"
  | "postprocessing"
  | "exporting"
  | "succeeded"
  | "failed"
  | "canceled";

export interface KimodoJob {
  id: string;
  prompt: string;
  durationSeconds: number;
  model: string;
  seed: number | null;
  status: KimodoJobStatus;
  stage: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  cancelRequested: boolean;
  error: { code: string; message: string } | null;
  result: {
    fileName: string;
    mediaType: string;
    byteLength: number;
    downloadUrl: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface KimodoHealth {
  status: "ok" | "degraded";
  database: boolean;
  worker: { alive: boolean; pid: number | null; restarts: number };
  kimodoCliAvailable: boolean;
}

export interface CreateKimodoJobInput {
  prompt: string;
  durationSeconds: number;
  model?: string;
  seed?: number | null;
}

export class KimodoApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = "KimodoApiError";
  }
}

export function normalizeKimodoApiBaseUrl(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed || "http://127.0.0.1:8787";
}

function getDefaultBaseUrl() {
  return normalizeKimodoApiBaseUrl(import.meta.env.VITE_KIMODO_API_URL);
}

async function parseApiError(response: Response) {
  let code = "request_failed";
  let message = `Kimodo 服务请求失败（${response.status}）`;
  try {
    const body = await response.json() as {
      detail?: string | { code?: string; message?: string };
    };
    if (typeof body.detail === "string") message = body.detail;
    else if (body.detail) {
      code = body.detail.code || code;
      message = body.detail.message || message;
    }
  } catch {
    // The stable fallback above is safer than exposing an HTML proxy response.
  }
  return new KimodoApiError(message, code, response.status);
}

export function createKimodoApi(
  baseUrl = getDefaultBaseUrl(),
  request: typeof fetch = fetch
) {
  const normalizedBaseUrl = normalizeKimodoApiBaseUrl(baseUrl);

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await request(`${normalizedBaseUrl}${path}`, {
        ...init,
        headers: {
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new KimodoApiError("无法连接 Kimodo 本地服务", "service_unavailable", 0);
    }
    if (!response.ok) throw await parseApiError(response);
    return response.json() as Promise<T>;
  }

  return {
    baseUrl: normalizedBaseUrl,
    health(signal?: AbortSignal) {
      return json<KimodoHealth>("/api/v1/health", { signal });
    },
    createJob(input: CreateKimodoJobInput, signal?: AbortSignal) {
      return json<KimodoJob>("/api/v1/jobs", {
        method: "POST",
        body: JSON.stringify(input),
        signal,
      });
    },
    async listJobs(limit = 20, signal?: AbortSignal) {
      const response = await json<{ jobs: KimodoJob[] }>(`/api/v1/jobs?limit=${Math.max(1, Math.min(limit, 200))}`, { signal });
      return response.jobs;
    },
    getJob(jobId: string, signal?: AbortSignal) {
      return json<KimodoJob>(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { signal });
    },
    cancelJob(jobId: string, signal?: AbortSignal) {
      return json<KimodoJob>(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", signal });
    },
    retryJob(jobId: string, signal?: AbortSignal) {
      return json<KimodoJob>(`/api/v1/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST", signal });
    },
    async downloadResult(job: KimodoJob, signal?: AbortSignal) {
      if (!job.result) throw new KimodoApiError("动作结果尚不可用", "result_unavailable", 409);
      const resultUrl = new URL(job.result.downloadUrl, `${normalizedBaseUrl}/`).toString();
      let response: Response;
      try {
        response = await request(resultUrl, { signal });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new KimodoApiError("动作文件下载失败", "service_unavailable", 0);
      }
      if (!response.ok) throw await parseApiError(response);
      return response.blob();
    },
  };
}

export type KimodoApi = ReturnType<typeof createKimodoApi>;

export const kimodoApi = createKimodoApi();
