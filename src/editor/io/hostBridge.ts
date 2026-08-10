import { useDirectorStore } from "../store/directorStore";
import {
  DIRECTOR_EXTENSION_CANCEL_TYPE,
  DIRECTOR_EXTENSION_DISCONNECT_TYPE,
  DIRECTOR_EXTENSION_PROTOCOL_VERSION,
  DIRECTOR_EXTENSION_REQUEST_TIMEOUT_MS,
  DIRECTOR_EXTENSION_REQUEST_TYPE,
  DIRECTOR_EXTENSION_RESPONSE_TYPE,
  DIRECTOR_EXTENSION_VIDEO_REQUEST_TIMEOUT_MS,
  createDirectorExtensionResponse,
  isDirectorExtensionAction,
  parseDirectorExtensionRequest,
  type DirectorExtensionResponsePayload,
} from "./extensionProtocol";
import { requestCleanFrameExport } from "./cleanFrameExport";
import { requestReferenceVideoExport } from "./referenceVideoExport";
import { getDirectorProjectFingerprint } from "./projectDocument";
import { listDirectorPluginResults, submitDirectorPluginResult, } from "./pluginResultRegistry";
import {
  createDirectorHostTransportRouter,
  type DirectorDeskTransportMessage,
} from "./directorHostTransport";
import {
  createPostMessageDirectorHostTransport,
  getDirectorDeskHostOrigin,
  getDirectorDeskVerificationOrigin,
} from "./postMessageHostTransport";
import { tauriDirectorHostTransport } from "./tauriHostTransport";

export { getDirectorDeskHostOrigin };

interface HostPanoramaPayload {
  edgeId?: unknown;
  sourceNodeId?: unknown;
  imageUrl?: unknown;
  fileName?: unknown;
}

interface HostSessionPayload {
  instanceId?: unknown;
  theme?: unknown;
  capability?: unknown;
  verificationUrl?: unknown;
}

interface HostDisconnectPayload {
  instanceId?: unknown;
  reason?: unknown;
}

type HostSessionDeniedReason =
  | "authorization-invalid"
  | "authorization-expired"
  | "authorization-refresh-failed"
  | "host-disconnected";

type ExtensionAbortCode =
  | "request-cancelled"
  | "request-timeout"
  | "request-id-conflict"
  | "host-disconnected";

interface ActiveExtensionRequest {
  abortCode: ExtensionAbortCode | null;
  abortMessage: string;
  controller: AbortController;
  request: NonNullable<ReturnType<typeof parseDirectorExtensionRequest>>;
  signature: string;
  suppressResponse: boolean;
  timeout: number;
}

export interface HostCaptureItemPayload {
  dataUrl?: unknown;
  fileName?: unknown;
}

export interface HostCaptureBatchPayload {
  captures?: HostCaptureItemPayload[];
}

let initialized = false;
let initializationPromise: Promise<void> | null = null;
let initializationGeneration = 0;
let authorizationGeneration = 0;
let authorizationExpiryTimer: number | null = null;
let authorizedInstanceId: string | null = null;
let activeHostInstanceId: string | null = null;
let activeExtensionExportRequestId: string | null = null;
const activeExtensionRequests = new Map<string, ActiveExtensionRequest>();
const completedExtensionRequestIds = new Set<string>();
const MAX_COMPLETED_EXTENSION_REQUEST_IDS = 256;
let clearHostTransports: (() => void) | null = null;
export const DIRECTOR_DESK_SESSION_OPENED_EVENT = "storyai:director-desk-session-opened";
export const DIRECTOR_DESK_SESSION_DENIED_EVENT =
  "storyai:director-desk-session-denied";
export const DIRECTOR_DESK_HOST_DISCONNECTED_EVENT =
  "storyai:director-desk-host-disconnected";
const directorHostTransport = createDirectorHostTransportRouter([
  tauriDirectorHostTransport,
  createPostMessageDirectorHostTransport(),
]);

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTheme(value: unknown): "dark" | "light" | null {
  return value === "light" || value === "dark" ? value : null;
}

function applyDirectorDeskTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function getInitialHostTheme() {
  try {
    return normalizeTheme(new URLSearchParams(window.location.search).get("theme"),);
  } catch {
    return null;
  }
}

function isSupportedHostImageUrl(value: string) {
  if (value.startsWith("data:image/")) {
    return true;
  }

  try {
    const url = new URL(value, window.location.href);
    return ( url.protocol === "http:" || url.protocol === "https:" || url.protocol === "blob:"
    );
  } catch {
    return false;
  }
}

function importHostPanorama(payload: HostPanoramaPayload) {
  const edgeId = normalizeString(payload.edgeId);
  const sourceNodeId = normalizeString(payload.sourceNodeId);
  const imageUrl = normalizeString(payload.imageUrl);
  const fileName = normalizeString(payload.fileName);

  if (!edgeId || !sourceNodeId || !fileName || !imageUrl || !isSupportedHostImageUrl(imageUrl)) {
    return;
  }

  useDirectorStore.getState().setPanoramaAsset({
    name: fileName,
    fileName,
    url: imageUrl,
    projectionMode: "equirectangular",
  });
}

function denyHostSession(
  reason: HostSessionDeniedReason = "authorization-invalid",
  notifyHost = true,
) {
  abortAllExtensionRequests("host-disconnected", "ICA 授权已失效", true);
  authorizedInstanceId = null;
  activeHostInstanceId = null;
  if (authorizationExpiryTimer !== null)
    window.clearTimeout(authorizationExpiryTimer);
  authorizationExpiryTimer = null;
  useDirectorStore.getState().openScopedScene(null);
  window.dispatchEvent(new CustomEvent(DIRECTOR_DESK_SESSION_DENIED_EVENT, {
    detail: { reason },
  }));
  if (notifyHost) {
    postDirectorDeskMessageToHost({
      type: "storyai:director-desk-access-denied",
    });
  }
}

function directorVerificationUrl(value: unknown) {
  const text = normalizeString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (
      url.origin !== getDirectorDeskVerificationOrigin() ||
      url.pathname !== "/api/canvas/director-capabilities/verify" ||
      (url.protocol !== "https:" &&
        !(import.meta.env.DEV && url.protocol === "http:"))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

async function openHostSession(payload: HostSessionPayload) {
  const instanceId = normalizeString(payload.instanceId);
  if (activeHostInstanceId && instanceId && activeHostInstanceId !== instanceId) {
    abortAllExtensionRequests("host-disconnected", "宿主已切换导演台实例", true);
  }
  const theme = normalizeTheme(payload.theme);
  if (theme) {
    applyDirectorDeskTheme(theme);
  }
  if (instanceId.startsWith("ica_canvas_")) {
    const capability = normalizeString(payload.capability);
    const verificationUrl = directorVerificationUrl(payload.verificationUrl);
    const generation = ++authorizationGeneration;
    if (!capability || capability.length > 4096 || !verificationUrl) {
      denyHostSession("authorization-invalid");
      return;
    }
    try {
      const response = await fetch(verificationUrl, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability }),
      });
      const envelope = (await response.json()) as {
        ok?: unknown;
        data?: {
          authorized?: unknown;
          instance_id?: unknown;
          expires_at?: unknown;
        };
      };
      const expiresAt =
        typeof envelope.data?.expires_at === "string"
          ? Date.parse(envelope.data.expires_at)
          : NaN;
      if (
        generation !== authorizationGeneration ||
        !response.ok ||
        envelope.ok !== true ||
        envelope.data?.authorized !== true ||
        envelope.data?.instance_id !== instanceId ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now()
      ) {
        if (generation === authorizationGeneration) denyHostSession("authorization-invalid");
        return;
      }
      if (authorizedInstanceId !== instanceId)
        useDirectorStore.getState().openScopedScene(instanceId);
      authorizedInstanceId = instanceId;
      activeHostInstanceId = instanceId;
      if (authorizationExpiryTimer !== null)
        window.clearTimeout(authorizationExpiryTimer);
      authorizationExpiryTimer = window.setTimeout(
        () => {
          if (generation === authorizationGeneration) denyHostSession("authorization-expired");
        },
        Math.min(2_147_483_647, expiresAt - Date.now()),
      );
      window.dispatchEvent(
        new CustomEvent(DIRECTOR_DESK_SESSION_OPENED_EVENT, {
          detail: { instanceId },
        }),
      );
      postDirectorDeskMessageToHost({
        type: "storyai:director-desk-authorized",
      });
    } catch {
      if (generation === authorizationGeneration) denyHostSession("authorization-invalid");
    }
    return;
  }
  if (instanceId) {
    activeHostInstanceId = instanceId;
    useDirectorStore.getState().openScopedScene(instanceId);
    window.dispatchEvent(new CustomEvent(DIRECTOR_DESK_SESSION_OPENED_EVENT, { detail: { instanceId }, }),);
    postDirectorDeskMessageToHost({ type: "storyai:director-desk-ready" });
  }
}

export function postDirectorDeskMessageToHost(message: DirectorDeskTransportMessage,) {
  directorHostTransport.send(message);
}

function postDirectorExtensionResponse(payload: DirectorExtensionResponsePayload,) {
  postDirectorDeskMessageToHost({ type: DIRECTOR_EXTENSION_RESPONSE_TYPE, payload, });
}

function createExtensionFailure(
  request: NonNullable<ReturnType<typeof parseDirectorExtensionRequest>>,
  code: Extract<DirectorExtensionResponsePayload, { ok: false }>["error"]["code"],
  message: string,
): DirectorExtensionResponsePayload {
  return {
    protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
    requestId: request.requestId,
    action: request.action,
    ok: false,
    error: { code, message },
  };
}

function extensionRequestSignature(
  request: NonNullable<ReturnType<typeof parseDirectorExtensionRequest>>,
) {
  try {
    return JSON.stringify([request.action, request.options ?? null]);
  } catch {
    return `${request.action}:unserializable`;
  }
}

function rememberCompletedExtensionRequestId(requestId: string) {
  completedExtensionRequestIds.delete(requestId);
  completedExtensionRequestIds.add(requestId);
  while (completedExtensionRequestIds.size > MAX_COMPLETED_EXTENSION_REQUEST_IDS) {
    const oldest = completedExtensionRequestIds.values().next().value;
    if (typeof oldest !== "string") break;
    completedExtensionRequestIds.delete(oldest);
  }
}

function abortExtensionRequest(
  requestId: string,
  code: ExtensionAbortCode,
  message: string,
  suppressResponse = false,
) {
  const active = activeExtensionRequests.get(requestId);
  if (!active || active.controller.signal.aborted) return false;
  active.abortCode = code;
  active.abortMessage = message;
  active.suppressResponse = suppressResponse;
  active.controller.abort(new DOMException(message, "AbortError"));
  return true;
}

function abortAllExtensionRequests(
  code: ExtensionAbortCode,
  message: string,
  suppressResponse = false,
) {
  [...activeExtensionRequests.keys()].forEach((requestId) => {
    abortExtensionRequest(requestId, code, message, suppressResponse);
  });
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  const abort = () => undefined;
  let rejectAbort: (reason?: unknown) => void = abort;
  const handleAbort = () => rejectAbort(signal.reason);
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
    signal.addEventListener("abort", handleAbort, { once: true });
  });
  return Promise.race([
    promise,
    abortPromise,
  ]).finally(() => signal.removeEventListener("abort", handleAbort));
}

function getRequestedInstanceId() {
  try {
    return normalizeString(new URLSearchParams(window.location.search).get("instanceId"));
  } catch {
    return "";
  }
}

function executeDirectorExtensionRequest(
  request: NonNullable<ReturnType<typeof parseDirectorExtensionRequest>>,
  signal: AbortSignal,
): DirectorExtensionResponsePayload | Promise<DirectorExtensionResponsePayload> {
  if (request.action === "plugin.results.list") {
    const projectFingerprint = getDirectorProjectFingerprint(useDirectorStore.getState().project,);
    return {
      protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
      requestId: request.requestId,
      action: request.action,
      ok: true,
      data: listDirectorPluginResults(projectFingerprint),
    };
  }
  if (request.action === "plugin.result.submit") {
    try {
      const project = useDirectorStore.getState().project;
      const result = submitDirectorPluginResult(
        request.options?.result,
        getDirectorProjectFingerprint(project),
      );
      return {
        protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
        requestId: request.requestId,
        action: request.action,
        ok: true,
        data: result,
      };
    } catch (error) {
      return createExtensionFailure(
        request,
        "invalid-plugin-result",
        error instanceof Error ? error.message : "插件结果无效",
      );
    }
  }
  if (request.action === "export.frame" || request.action === "export.video") {
    if (activeExtensionExportRequestId) {
      return createExtensionFailure(request, "export-busy", "已有导出任务正在进行，请稍后再试");
    }
    activeExtensionExportRequestId = request.requestId;
    return (async () => {
      try {
        const result = request.action === "export.frame"
          ? await awaitWithAbort(requestCleanFrameExport({
            fileName: request.options?.fileName ?? "current-frame.png",
            position: request.options?.position ?? "current",
            quality: request.options?.quality ?? "720p",
            signal,
          }), signal)
          : await awaitWithAbort(requestReferenceVideoExport({
            fileName: request.options?.fileName ?? "director-reference.mp4",
            fps: request.options?.fps ?? 30,
            quality: request.options?.quality ?? "720p",
            signal,
          }), signal);
        return {
          protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
          requestId: request.requestId,
          action: request.action,
          ok: true,
          data: result,
        };
      } catch (error) {
        if (signal.aborted) throw error;
        return createExtensionFailure(
          request,
          "export-failed",
          error instanceof Error ? error.message : "导出失败",
        );
      } finally {
        if (activeExtensionExportRequestId === request.requestId) {
          activeExtensionExportRequestId = null;
        }
      }
    })();
  }
  return createDirectorExtensionResponse(request, useDirectorStore.getState());
}

async function handleDirectorExtensionRequest(payload: unknown) {
  const request = parseDirectorExtensionRequest(payload);
  if (request) {
    const requestedInstanceId = getRequestedInstanceId();
    if (requestedInstanceId.startsWith("ica_canvas_") && authorizedInstanceId !== requestedInstanceId) {
      postDirectorExtensionResponse(createExtensionFailure(
        request,
        "session-unauthorized",
        "ICA 导演台会话尚未授权",
      ));
      return;
    }
    const signature = extensionRequestSignature(request);
    const active = activeExtensionRequests.get(request.requestId);
    if (active) {
      if (active.signature !== signature) {
        abortExtensionRequest(
          request.requestId,
          "request-id-conflict",
          "requestId 已被另一个在途请求使用",
        );
      }
      return;
    }
    if (completedExtensionRequestIds.has(request.requestId)) {
      postDirectorExtensionResponse(createExtensionFailure(
        request,
        "duplicate-request",
        "requestId 已完成，不能重复执行",
      ));
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => abortExtensionRequest(request.requestId, "request-timeout", "3D 导演台请求处理超时"),
      request.action === "export.video"
        ? DIRECTOR_EXTENSION_VIDEO_REQUEST_TIMEOUT_MS
        : DIRECTOR_EXTENSION_REQUEST_TIMEOUT_MS,
    );
    const lifecycle: ActiveExtensionRequest = {
      abortCode: null,
      abortMessage: "",
      controller,
      request,
      signature,
      suppressResponse: false,
      timeout,
    };
    activeExtensionRequests.set(request.requestId, lifecycle);
    const execution = executeDirectorExtensionRequest(request, controller.signal);
    if (!(execution instanceof Promise)) {
      if (!lifecycle.suppressResponse) postDirectorExtensionResponse(execution);
      window.clearTimeout(timeout);
      activeExtensionRequests.delete(request.requestId);
      rememberCompletedExtensionRequestId(request.requestId);
      return;
    }
    try {
      const response = await execution;
      if (activeExtensionRequests.get(request.requestId) === lifecycle && !lifecycle.suppressResponse) {
        postDirectorExtensionResponse(response);
      }
    } catch (error) {
      if (activeExtensionRequests.get(request.requestId) === lifecycle && !lifecycle.suppressResponse) {
        postDirectorExtensionResponse(createExtensionFailure(
          request,
          lifecycle.abortCode ?? "export-failed",
          lifecycle.abortMessage || (error instanceof Error ? error.message : "请求失败"),
        ));
      }
    } finally {
      window.clearTimeout(timeout);
      if (activeExtensionRequests.get(request.requestId) === lifecycle) {
        activeExtensionRequests.delete(request.requestId);
        rememberCompletedExtensionRequestId(request.requestId);
      }
    }
    return;
  }

  const value = payload && typeof payload === "object" ? ( payload as Record<string, unknown>) : {};
  const requestId = normalizeString(value.requestId).slice(0, 128) || "unknown";
  const action = normalizeString(value.action);
  const unsupportedAction = Boolean(action) && !isDirectorExtensionAction(action);
  postDirectorExtensionResponse({
    protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
    requestId,
    action: "unknown",
    ok: false,
    error: {
      code: unsupportedAction ? "unsupported-action" : "invalid-request",
      message: unsupportedAction ? `不支持的二创接口操作：${action}` : "二创接口请求缺少有效的 requestId 或 action",
    },
  });
}

export function postDirectorDeskCapturesToHost(
  captures: Array<{
    dataUrl: string;
    fileName?: string;
  }>,
) {
  const normalizedCaptures = captures
    .map((capture, index) => {
      const dataUrl = normalizeString(capture.dataUrl);
      if (!dataUrl) {
        return null;
      }

      return {
        dataUrl,
        fileName: normalizeString(capture.fileName) || `director-desk-capture-${index + 1}.png`,
      };
    })
    .filter((capture): capture is { dataUrl: string; fileName: string } => Boolean(capture),);

  if (normalizedCaptures.length === 0) {
    return;
  }

  postDirectorDeskMessageToHost({
    type: "storyai:director-desk-captures-sent",
    payload: { captures: normalizedCaptures },
  });
}

function handleHostProtocolMessage(message: DirectorDeskTransportMessage) {
  if (message.type === "storyai:director-desk-session") {
    void
    openHostSession((message.payload || {}) as HostSessionPayload);
    return;
  }

  if (message.type === "storyai:director-desk-panorama") {
    importHostPanorama((message.payload || {}) as HostPanoramaPayload);
    return;
  }

  if (message.type === DIRECTOR_EXTENSION_REQUEST_TYPE) {
    void handleDirectorExtensionRequest(message.payload);
    return;
  }

  if (message.type === DIRECTOR_EXTENSION_CANCEL_TYPE) {
    const requestId = normalizeString(message.payload?.requestId).slice(0, 128);
    if (requestId) {
      abortExtensionRequest(requestId, "request-cancelled", "宿主已取消 3D 导演台请求");
    }
    return;
  }

  if (message.type === DIRECTOR_EXTENSION_DISCONNECT_TYPE) {
    const payload = (message.payload || {}) as HostDisconnectPayload;
    const instanceId = normalizeString(payload.instanceId);
    if (!instanceId || instanceId !== activeHostInstanceId) return;
    const reason = payload.reason === "authorization-refresh-failed"
      ? "authorization-refresh-failed"
      : "host-disconnected";
    abortAllExtensionRequests("host-disconnected", "宿主连接已断开", true);
    if (instanceId.startsWith("ica_canvas_")) {
      denyHostSession(reason, false);
    } else {
      activeHostInstanceId = null;
      useDirectorStore.getState().openScopedScene(null);
      window.dispatchEvent(new CustomEvent(DIRECTOR_DESK_HOST_DISCONNECTED_EVENT, {
        detail: { instanceId, reason },
      }));
    }
  }
}

export function initDirectorDeskHostBridge() {
  if (initializationPromise)
    return initializationPromise;

  initialized = true;
  const requestedInstanceId = getRequestedInstanceId();
  activeHostInstanceId = requestedInstanceId && !requestedInstanceId.startsWith("ica_canvas_")
    ? requestedInstanceId
    : null;
  const generation = ++initializationGeneration;
  applyDirectorDeskTheme(getInitialHostTheme() ?? "dark"); initializationPromise = directorHostTransport
    .listen(handleHostProtocolMessage).then((cleanup) => {
    if (!initialized || generation !== initializationGeneration) {
      cleanup();
      return;
    }
    clearHostTransports = cleanup;
  });
  return initializationPromise;
}

export function clearDirectorDeskHostBridge() {
  if (!initialized) {
    return;
  }

  initialized = false;
  initializationGeneration += 1;
  initializationPromise = null;
  authorizationGeneration += 1;
  authorizedInstanceId = null;
  activeHostInstanceId = null;
  if (authorizationExpiryTimer !== null)
    window.clearTimeout(authorizationExpiryTimer);
  authorizationExpiryTimer = null;
  abortAllExtensionRequests("host-disconnected", "宿主桥已关闭", true);
  activeExtensionRequests.forEach((request) => window.clearTimeout(request.timeout));
  activeExtensionRequests.clear();
  completedExtensionRequestIds.clear();
  activeExtensionExportRequestId = null;
  clearHostTransports?.();
  clearHostTransports = null;
}
