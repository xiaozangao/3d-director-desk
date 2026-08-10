import type {
  DirectorDeskTransportMessage,
  DirectorHostTransport,
  DirectorHostTransportCleanup,
} from "./directorHostTransport";

interface PostMessageDirectorHostTransport extends DirectorHostTransport {
  listen: (
    onMessage: (message: DirectorDeskTransportMessage) => void
  ) => DirectorHostTransportCleanup;
}

const HOST_ORIGIN_QUERY_KEY = "hostOrigin";
const VERIFICATION_ORIGIN_QUERY_KEY = "verificationOrigin";

function normalizeOrigin(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
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

export function getDirectorDeskVerificationOrigin() {
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeOrigin(params.get(VERIFICATION_ORIGIN_QUERY_KEY)) ?? getDirectorDeskHostOrigin();
  } catch {
    return getDirectorDeskHostOrigin();
  }
}

function isAllowedHostEvent(event: MessageEvent) {
  const fromExpectedOrigin = event.origin === getDirectorDeskHostOrigin();
  const fromParentWindow = window.parent === window || event.source === window.parent;
  return fromExpectedOrigin && fromParentWindow;
}

function parsePostMessage(value: unknown): DirectorDeskTransportMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (typeof message.type !== "string") return null;
  if (message.payload !== undefined && (!message.payload || typeof message.payload !== "object")) return null;
  return {
    type: message.type,
    ...(message.payload ? { payload: message.payload as Record<string, unknown> } : {}),
  };
}

export function createPostMessageDirectorHostTransport(): PostMessageDirectorHostTransport {
  return {
    name: "post-message",
    send(message) {
      window.parent?.postMessage(message, getDirectorDeskHostOrigin());
      return true;
    },
    listen(onMessage) {
      const handleMessage = (event: MessageEvent) => {
        if (!isAllowedHostEvent(event)) return;
        const message = parsePostMessage(event.data);
        if (message) onMessage(message);
      };
      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    },
  };
}
