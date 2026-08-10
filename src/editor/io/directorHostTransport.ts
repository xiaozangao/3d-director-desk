export interface DirectorDeskTransportMessage {
  type: string;
  payload?: Record<string, unknown>;
}

export type DirectorHostTransportCleanup = () => void;

export interface DirectorHostTransport {
  name: string;
  send: (message: DirectorDeskTransportMessage) => boolean;
  listen: (
    onMessage: (message: DirectorDeskTransportMessage) => void
  ) => DirectorHostTransportCleanup | null | Promise<DirectorHostTransportCleanup | null>;
}

export interface DirectorHostTransportRouter extends DirectorHostTransport {
  listen: (
    onMessage: (message: DirectorDeskTransportMessage) => void
  ) => Promise<DirectorHostTransportCleanup>;
}

export function createDirectorHostTransportRouter(transports: DirectorHostTransport[]): DirectorHostTransportRouter {
  return {
    name: "director-host-router",
    send(message) {
      return transports.some((transport) => transport.send(message));
    },
    async listen(onMessage) {
      const pendingCleanups = transports.map((transport) => Promise.resolve(transport.listen(onMessage)));
      const cleanups = (await Promise.all(pendingCleanups))
        .filter((cleanup): cleanup is DirectorHostTransportCleanup => cleanup !== null);
      return () => cleanups.forEach((cleanup) => cleanup());
    },
  };
}
