import { expect, it, vi } from "vitest";
import {
  createDirectorHostTransportRouter,
  type DirectorHostTransport,
} from "../directorHostTransport";

function createTransport(name: string, acceptsSend: boolean): DirectorHostTransport {
  return {
    name,
    send: vi.fn(() => acceptsSend),
    listen: vi.fn(() => null),
  };
}

it("sends through the first available transport", () => {
  const tauri = createTransport("tauri", true);
  const postMessage = createTransport("post-message", true);
  const router = createDirectorHostTransportRouter([tauri, postMessage]);
  const message = { type: "storyai:director-desk-ready" };

  expect(router.send(message)).toBe(true);
  expect(tauri.send).toHaveBeenCalledWith(message);
  expect(postMessage.send).not.toHaveBeenCalled();
});

it("falls back when a preferred transport is unavailable", () => {
  const tauri = createTransport("tauri", false);
  const postMessage = createTransport("post-message", true);
  const router = createDirectorHostTransportRouter([tauri, postMessage]);

  expect(router.send({ type: "ready" })).toBe(true);
  expect(postMessage.send).toHaveBeenCalledTimes(1);
});

it("starts and cleans every inbound transport", async () => {
  const cleanupTauri = vi.fn();
  const cleanupPostMessage = vi.fn();
  const onMessage = vi.fn();
  const tauri = createTransport("tauri", false);
  const postMessage = createTransport("post-message", true);
  tauri.listen = vi.fn(async () => cleanupTauri);
  postMessage.listen = vi.fn(() => cleanupPostMessage);

  const cleanup = await createDirectorHostTransportRouter([tauri, postMessage]).listen(onMessage);
  cleanup?.();

  expect(tauri.listen).toHaveBeenCalledWith(onMessage);
  expect(postMessage.listen).toHaveBeenCalledWith(onMessage);
  expect(cleanupTauri).toHaveBeenCalledTimes(1);
  expect(cleanupPostMessage).toHaveBeenCalledTimes(1);
});
