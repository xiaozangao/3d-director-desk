import { expect, it, vi } from "vitest";
import {
  createPostMessageDirectorHostTransport,
  getDirectorDeskVerificationOrigin,
} from "../postMessageHostTransport";

it("accepts only typed messages from the expected parent and origin", () => {
  const onMessage = vi.fn();
  const transport = createPostMessageDirectorHostTransport();
  const cleanup = transport.listen(onMessage);

  window.dispatchEvent(new MessageEvent("message", {
    data: { type: "storyai:director-desk-session", payload: { instanceId: "desk-1" } },
    origin: window.location.origin,
    source: window,
  }));
  window.dispatchEvent(new MessageEvent("message", {
    data: { type: "storyai:director-desk-session" },
    origin: "https://unexpected.example",
    source: window,
  }));
  window.dispatchEvent(new MessageEvent("message", {
    data: { payload: {} },
    origin: window.location.origin,
    source: window,
  }));

  expect(onMessage).toHaveBeenCalledTimes(1);
  expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "storyai:director-desk-session" }));
  cleanup?.();
});

it("posts outbound messages to the configured host origin", () => {
  window.history.replaceState({}, "", "/?hostOrigin=https%3A%2F%2Fhost.example");
  const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
  const transport = createPostMessageDirectorHostTransport();

  expect(transport.send({ type: "storyai:director-desk-ready" })).toBe(true);
  expect(postMessage).toHaveBeenCalledWith(
    { type: "storyai:director-desk-ready" },
    "https://host.example"
  );
});

it("allows the trusted host to declare a separate ICA API verification origin", () => {
  window.history.replaceState(
    {},
    "",
    "/?hostOrigin=https%3A%2F%2Fcanvas.example&verificationOrigin=https%3A%2F%2Fapi.example",
  );

  expect(getDirectorDeskVerificationOrigin()).toBe("https://api.example");
});
