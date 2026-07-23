import { Check, Download, RotateCcw, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useDirectorStore } from "../store/directorStore";
import { importKimodoResult } from "./importKimodoResult";
import {
  createKimodoApi,
  readKimodoApiBaseUrl,
  resetKimodoApiBaseUrl,
  writeKimodoApiBaseUrl,
  type KimodoApi,
  type KimodoHealth,
  type KimodoJob,
} from "./kimodoApi";
import { getKimodoJobErrorSummary, isKimodoJobTerminal, KIMODO_STAGE_LABELS, mergeKimodoJobs } from "./kimodoJobs";

type PanelApi = Pick<KimodoApi, "health" | "listJobs" | "createJob" | "cancelJob" | "retryJob" | "deleteJob" | "downloadResult">;

export function KimodoMotionPanel({
  characterId,
  disabled = false,
  api,
  importJob,
}: {
  characterId: string;
  disabled?: boolean;
  api?: PanelApi;
  importJob?: (job: KimodoJob, characterId: string) => Promise<unknown>;
}) {
  const [prompt, setPrompt] = useState("A person waves hello.");
  const [durationSeconds, setDurationSeconds] = useState(3);
  const [seed, setSeed] = useState("");
  const [health, setHealth] = useState<KimodoHealth | null>(null);
  const [offline, setOffline] = useState(false);
  const [jobs, setJobs] = useState<KimodoJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState(readKimodoApiBaseUrl);
  const [apiBaseUrlDraft, setApiBaseUrlDraft] = useState(apiBaseUrl);
  const [apiBaseUrlError, setApiBaseUrlError] = useState<string | null>(null);
  const [serviceSettingsOpen, setServiceSettingsOpen] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const deletedJobIds = useRef(new Set<string>());
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const addImportedAnimationAsset = useDirectorStore((state) => state.addImportedAnimationAsset);
  const applyCharacterActionPreset = useDirectorStore((state) => state.applyCharacterActionPreset);
  const restartCameraMotionPlayback = useDirectorStore((state) => state.restartCameraMotionPlayback);

  const activeApi = useMemo(() => api ?? createKimodoApi(apiBaseUrl), [api, apiBaseUrl, connectionRevision]);
  const serviceReady = health?.status === "ok" && health.worker.alive && health.kimodoCliAvailable;
  const currentJobs = useMemo(() => jobs.slice(0, 5), [jobs]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const nextHealth = await activeApi.health(signal);
      setHealth(nextHealth);
      setOffline(false);
      const nextJobs = await activeApi.listJobs(20, signal);
      setJobs((current) => mergeKimodoJobs(
        current,
        nextJobs.filter((job) => !deletedJobIds.current.has(job.id))
      ));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setOffline(true);
      setHealth(null);
    }
  }, [activeApi]);

  useEffect(() => {
    if (!serviceSettingsOpen) return;
    function closeOutside(event: PointerEvent) {
      if (!(event.target instanceof Node) || settingsRef.current?.contains(event.target)) return;
      setServiceSettingsOpen(false);
      setApiBaseUrlError(null);
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setServiceSettingsOpen(false);
      setApiBaseUrlError(null);
      settingsTriggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [serviceSettingsOpen]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => void refresh(controller.signal), 1500);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function submit() {
    if (!serviceReady || disabled || submitting) return;
    setSubmitting(true);
    setStatusMessage(null);
    try {
      const parsedSeed = seed.trim() ? Number(seed) : null;
      const job = await activeApi.createJob({
        prompt,
        durationSeconds,
        seed: Number.isInteger(parsedSeed) ? parsedSeed : null,
      });
      setJobs((current) => mergeKimodoJobs(current, [job]));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "动作任务提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(job: KimodoJob, action: "cancel" | "retry" | "delete" | "import") {
    setPendingActionId(job.id);
    setStatusMessage(null);
    try {
      if (action === "cancel") {
        const updated = await activeApi.cancelJob(job.id);
        setJobs((current) => mergeKimodoJobs(current, [updated]));
      } else if (action === "retry") {
        const updated = await activeApi.retryJob(job.id);
        setJobs((current) => mergeKimodoJobs(current, [updated]));
      } else if (action === "delete") {
        await activeApi.deleteJob(job.id);
        deletedJobIds.current.add(job.id);
        setJobs((current) => current.filter((currentJob) => currentJob.id !== job.id));
      } else if (importJob) {
        await importJob(job, characterId);
        setStatusMessage("动作已导入并应用到当前角色");
      } else {
        await importKimodoResult(job, characterId, {
          api: activeApi,
          addImportedAnimationAsset,
          applyCharacterActionPreset,
          restartPlayback: restartCameraMotionPlayback,
        });
        setStatusMessage("动作已导入并应用到当前角色");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Kimodo 任务操作失败");
    } finally {
      setPendingActionId(null);
    }
  }

  function applyServiceUrl(nextBaseUrl: string) {
    setApiBaseUrl(nextBaseUrl);
    setApiBaseUrlDraft(nextBaseUrl);
    setHealth(null);
    setOffline(false);
    setJobs([]);
    setStatusMessage(null);
    deletedJobIds.current.clear();
    setConnectionRevision((current) => current + 1);
    setServiceSettingsOpen(false);
    setApiBaseUrlError(null);
  }

  function saveServiceSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      applyServiceUrl(writeKimodoApiBaseUrl(apiBaseUrlDraft));
    } catch (error) {
      setApiBaseUrlError(error instanceof Error ? error.message : "Kimodo 服务地址无效");
    }
  }

  function restoreDefaultService() {
    applyServiceUrl(resetKimodoApiBaseUrl());
  }

  const serviceLabel = offline
    ? "离线"
    : serviceReady
      ? "就绪"
      : health
        ? "未就绪"
        : "检测中";

  return (
    <section className="kimodo-motion-section" aria-label="Kimodo 动作生成">
      <header className="kimodo-motion-header">
        <span>
          <Sparkles aria-hidden="true" size={14} />
          <strong>Kimodo 动作</strong>
        </span>
        <div className="kimodo-motion-header-actions">
          <div className="kimodo-service-settings" ref={settingsRef}>
            <button
              ref={settingsTriggerRef}
              aria-controls="kimodo-service-settings-popover"
              aria-expanded={serviceSettingsOpen}
              aria-haspopup="dialog"
              aria-label="设置 Kimodo 服务"
              className={serviceSettingsOpen ? "is-active" : undefined}
              title="服务设置"
              type="button"
              onClick={() => {
                setApiBaseUrlDraft(apiBaseUrl);
                setApiBaseUrlError(null);
                setServiceSettingsOpen((current) => !current);
              }}
            >
              <Settings2 aria-hidden="true" size={13} />
            </button>
            {serviceSettingsOpen ? (
              <form
                id="kimodo-service-settings-popover"
                aria-label="Kimodo 服务设置"
                className="kimodo-service-settings-popover"
                role="dialog"
                onSubmit={saveServiceSettings}
              >
                <header>
                  <strong>服务连接</strong>
                  <button
                    aria-label="关闭 Kimodo 服务设置"
                    title="关闭"
                    type="button"
                    onClick={() => setServiceSettingsOpen(false)}
                  >
                    <X aria-hidden="true" size={13} />
                  </button>
                </header>
                <label>
                  <span>服务地址</span>
                  <input
                    aria-label="Kimodo 服务地址"
                    autoComplete="url"
                    placeholder="http://127.0.0.1:8787"
                    spellCheck={false}
                    type="url"
                    value={apiBaseUrlDraft}
                    onChange={(event) => {
                      setApiBaseUrlDraft(event.currentTarget.value);
                      setApiBaseUrlError(null);
                    }}
                  />
                </label>
                {apiBaseUrlError ? <p role="alert">{apiBaseUrlError}</p> : null}
                <div>
                  <button type="button" onClick={restoreDefaultService}>
                    <RotateCcw aria-hidden="true" size={12} />
                    恢复默认
                  </button>
                  <button className="is-primary" type="submit">
                    <Check aria-hidden="true" size={13} />
                    保存
                  </button>
                </div>
              </form>
            ) : null}
          </div>
          <small className={serviceReady ? "is-ready" : undefined}>{serviceLabel}</small>
        </div>
      </header>

      <label className="kimodo-prompt-field">
        <span>提示词</span>
        <textarea
          aria-label="Kimodo 动作提示词"
          disabled={disabled || submitting}
          maxLength={500}
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
        />
      </label>
      <div className="kimodo-generation-options">
        <label>
          <span>时长</span>
          <input
            aria-label="Kimodo 动作时长"
            disabled={disabled || submitting}
            max={10}
            min={2}
            step={0.5}
            type="number"
            value={durationSeconds}
            onChange={(event) => setDurationSeconds(Number(event.currentTarget.value))}
          />
        </label>
        <label>
          <span>Seed</span>
          <input
            aria-label="Kimodo 随机种子"
            disabled={disabled || submitting}
            min={0}
            placeholder="随机"
            step={1}
            type="number"
            value={seed}
            onChange={(event) => setSeed(event.currentTarget.value)}
          />
        </label>
        <button
          className="kimodo-submit-button"
          disabled={disabled || !serviceReady || submitting || prompt.trim().length < 3}
          type="button"
          onClick={() => void submit()}
        >
          <Sparkles aria-hidden="true" size={14} />
          {submitting ? "提交中" : "生成"}
        </button>
      </div>

      {statusMessage ? <p className="kimodo-status-message" role="status">{statusMessage}</p> : null}

      {currentJobs.length ? (
        <div className="kimodo-job-list" aria-label="Kimodo 任务">
          {currentJobs.map((job) => {
            const pending = pendingActionId === job.id;
            return (
              <article className={`kimodo-job is-${job.status}`} key={job.id}>
                <div className="kimodo-job-summary">
                  <span title={job.prompt}>{job.prompt}</span>
                  <small>{KIMODO_STAGE_LABELS[job.status]} · {job.progress}%</small>
                </div>
                <progress aria-label={`${job.prompt} 进度`} max={100} value={job.progress} />
                {job.error ? <p role="status" title={job.error.message}>{getKimodoJobErrorSummary(job.error)}</p> : null}
                <div className="kimodo-job-actions">
                  {!isKimodoJobTerminal(job) ? (
                    <button
                      aria-label={`取消任务 ${job.prompt}`}
                      disabled={pending || job.cancelRequested}
                      title="取消"
                      type="button"
                      onClick={() => void runAction(job, "cancel")}
                    >
                      <X aria-hidden="true" size={13} />
                    </button>
                  ) : null}
                  {job.status === "failed" || job.status === "canceled" ? (
                    <button
                      aria-label={`重试任务 ${job.prompt}`}
                      disabled={pending || !serviceReady}
                      title="重试"
                      type="button"
                      onClick={() => void runAction(job, "retry")}
                    >
                      <RotateCcw aria-hidden="true" size={13} />
                    </button>
                  ) : null}
                  {job.status === "succeeded" ? (
                    <button
                      aria-label={`导入动作 ${job.prompt}`}
                      disabled={pending || disabled}
                      title="导入并应用"
                      type="button"
                      onClick={() => void runAction(job, "import")}
                    >
                      <Download aria-hidden="true" size={13} />
                    </button>
                  ) : null}
                  {isKimodoJobTerminal(job) ? (
                    <button
                      aria-label={`删除任务 ${job.prompt}`}
                      className="is-danger"
                      disabled={pending}
                      title="删除"
                      type="button"
                      onClick={() => void runAction(job, "delete")}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
