import { useDirectorStore } from "../store/directorStore";
import {
  DIRECTOR_EXTENSION_PROTOCOL_VERSION,
  DIRECTOR_EXTENSION_REQUEST_TYPE,
  DIRECTOR_EXTENSION_RESPONSE_TYPE,
  createDirectorExtensionResponse,
  isDirectorExtensionAction,
  parseDirectorExtensionRequest,
  type DirectorExtensionResponsePayload,
} from "./extensionProtocol";
import { requestCleanFrameExport } from "./cleanFrameExport";
import { requestReferenceVideoExport } from "./referenceVideoExport";
import { getDirectorProjectFingerprint } from "./projectDocument";
import { listDirectorPluginResults, submitDirectorPluginResult } from "./pluginResultRegistry";
import {
  initTauriDirectorHostTransport,
  postTauriDirectorHostMessage,
  type DirectorDeskTransportMessage,
} from "./tauriHostTransport";

interface HostPanoramaPayload {
  edgeId?: unknown;
  sourceNodeId?: unknown;
  imageUrl?: unknown;
  fileName?: unknown;
}

interface HostSessionPayload {
  instanceId?: unknown;
  theme?: unknown;
}

export interface HostCaptureItemPayload {
  dataUrl?: unknown;
  fileName?: unknown;
}

export interface HostCaptureBatchPayload {
  captures?: HostCaptureItemPayload[];
}

let initialized = false;
let activeExtensionExportRequestId: string | null = null;
let clearTauriTransport: (() => void) | null = null;
export const DIRECTOR_DESK_SESSION_OPENED_EVENT = "storyai:director-desk-session-opened";

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const HOST_ORIGIN_QUERY_KEY = "hostOrigin";

function normalizeOrigin(value: unknown) {
  const text = normalizeString(value);
  if (!text) return null;

  try {
    return new URL(text).origin;
  } catch {
    return null;
  }
}

export function getDirectorDeskHostOrigin() {
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeOrigin(params.get(HOST_ORIGIN_QUERY_KEY)) ?? window.location.origin;
  } catch {
    return window.location.origin;
  }
}

function isAllowedHostEvent(event: MessageEvent) {
  const fromExpectedOrigin = event.origin === getDirectorDeskHostOrigin();
  const fromParentWindow = window.parent === window || event.source === window.parent;
  return fromExpectedOrigin && fromParentWindow;
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
    return normalizeTheme(new URLSearchParams(window.location.search).get("theme"));
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
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "blob:";
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

function openHostSession(payload: HostSessionPayload) {
  const instanceId = normalizeString(payload.instanceId);
  const theme = normalizeTheme(payload.theme);
  if (theme) {
    applyDirectorDeskTheme(theme);
  }
  if (instanceId) {
    useDirectorStore.getState().openScopedScene(instanceId);
    window.dispatchEvent(new CustomEvent(DIRECTOR_DESK_SESSION_OPENED_EVENT, { detail: { instanceId } }));
    postDirectorDeskMessageToHost({ type: "storyai:director-desk-ready" });
  }
}

export function postDirectorDeskMessageToHost(message: DirectorDeskTransportMessage) {
  if (postTauriDirectorHostMessage(message)) return;
  window.parent?.postMessage(message, getDirectorDeskHostOrigin());
}

function postDirectorExtensionResponse(payload: DirectorExtensionResponsePayload) {
  postDirectorDeskMessageToHost({ type: DIRECTOR_EXTENSION_RESPONSE_TYPE, payload });
}

async function handleDirectorExtensionRequest(payload: unknown) {
  const request = parseDirectorExtensionRequest(payload);
  if (request) {
    if (request.action === "plugin.results.list") {
      const projectFingerprint = getDirectorProjectFingerprint(useDirectorStore.getState().project);
      postDirectorExtensionResponse({
        protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
        requestId: request.requestId,
        action: request.action,
        ok: true,
        data: listDirectorPluginResults(projectFingerprint),
      });
      return;
    }
    if (request.action === "plugin.result.submit") {
      try {
        const project = useDirectorStore.getState().project;
        const result = submitDirectorPluginResult(
          request.options?.result,
          getDirectorProjectFingerprint(project)
        );
        postDirectorExtensionResponse({
          protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
          requestId: request.requestId,
          action: request.action,
          ok: true,
          data: result,
        });
      } catch (error) {
        postDirectorExtensionResponse({
          protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
          requestId: request.requestId,
          action: request.action,
          ok: false,
          error: {
            code: "invalid-plugin-result",
            message: error instanceof Error ? error.message : "插件结果无效",
          },
        });
      }
      return;
    }
    if (request.action === "export.frame" || request.action === "export.video") {
      if (activeExtensionExportRequestId) {
        postDirectorExtensionResponse({
          protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
          requestId: request.requestId,
          action: request.action,
          ok: false,
          error: { code: "export-busy", message: "已有导出任务正在进行，请稍后再试" },
        });
        return;
      }
      activeExtensionExportRequestId = request.requestId;
      try {
        const result = request.action === "export.frame"
          ? await requestCleanFrameExport({
              fileName: request.options?.fileName ?? "current-frame.png",
              position: request.options?.position ?? "current",
              quality: request.options?.quality ?? "720p",
            })
          : await requestReferenceVideoExport({
              fileName: request.options?.fileName ?? "director-reference.mp4",
              fps: request.options?.fps ?? 30,
              quality: request.options?.quality ?? "720p",
            });
        postDirectorExtensionResponse({
          protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
          requestId: request.requestId,
          action: request.action,
          ok: true,
          data: result,
        });
      } catch (error) {
        postDirectorExtensionResponse({
          protocolVersion: DIRECTOR_EXTENSION_PROTOCOL_VERSION,
          requestId: request.requestId,
          action: request.action,
          ok: false,
          error: {
            code: "export-failed",
            message: error instanceof Error ? error.message : "导出失败",
          },
        });
      } finally {
        activeExtensionExportRequestId = null;
      }
      return;
    }
    const state = useDirectorStore.getState();
    postDirectorExtensionResponse(createDirectorExtensionResponse(request, state));
    return;
  }

  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
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
  }>
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
    .filter((capture): capture is { dataUrl: string; fileName: string } => Boolean(capture));

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
    openHostSession((message.payload || {}) as HostSessionPayload);
    return;
  }

  if (message.type === "storyai:director-desk-panorama") {
    importHostPanorama((message.payload || {}) as HostPanoramaPayload);
    return;
  }

  if (message.type === DIRECTOR_EXTENSION_REQUEST_TYPE) {
    void handleDirectorExtensionRequest(message.payload);
  }
}

function handleHostMessage(event: MessageEvent) {
  if (!isAllowedHostEvent(event)) return;
  if (!event.data || typeof event.data !== "object" || typeof event.data.type !== "string") return;
  handleHostProtocolMessage(event.data as DirectorDeskTransportMessage);
}

export function initDirectorDeskHostBridge() {
  if (initialized) {
    return;
  }

  initialized = true;
  applyDirectorDeskTheme(getInitialHostTheme() ?? "dark");
  window.addEventListener("message", handleHostMessage);
  void initTauriDirectorHostTransport(handleHostProtocolMessage).then((cleanup) => {
    if (!cleanup) return;
    if (!initialized) {
      cleanup();
      return;
    }
    clearTauriTransport = cleanup;
  });
}

export function clearDirectorDeskHostBridge() {
  if (!initialized) {
    return;
  }

  initialized = false;
  activeExtensionExportRequestId = null;
  window.removeEventListener("message", handleHostMessage);
  clearTauriTransport?.();
  clearTauriTransport = null;
}
