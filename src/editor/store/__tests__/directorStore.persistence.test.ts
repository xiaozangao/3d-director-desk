import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectorAssetRef } from "../../schema/directorProject";
import type { DirectorState } from "../directorStore.types";
import {
  getDirectorScenePersistenceScopeId,
  getDirectorSceneStorageKey,
  persistLocalModelAsset,
  readPersistedDirectorStateSnapshot,
  readPersistedLocalModelAssets,
  removePersistedLocalModelAsset,
  setDirectorScenePersistenceScopeId,
  writePersistedDirectorState,
} from "../directorStore.persistence";

function createMemoryStorage(): Storage {
  const storage = new Map<string, string>();

  return {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key) => {
      storage.delete(key);
    },
    setItem: (key, value) => {
      storage.set(key, String(value));
    },
  };
}

function createLocalModelAsset(id: string): DirectorAssetRef {
  return {
    id,
    name: `${id}.glb`,
    kind: "character",
    sourceType: "model",
    assetSource: "local",
    modelFormat: "glb",
    fileName: `${id}.glb`,
    url: `director-asset://local/${id}`,
    storageKey: id,
  };
}

describe("directorStore persistence boundary", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    setDirectorScenePersistenceScopeId(null);
  });

  afterEach(() => {
    setDirectorScenePersistenceScopeId(null);
    vi.unstubAllGlobals();
  });

  it("keeps the legacy root key and trims instance-scoped keys", () => {
    expect(getDirectorSceneStorageKey()).toBe("storyai-3d-director-desk-demo");

    setDirectorScenePersistenceScopeId("  node_director_a  ");

    expect(getDirectorScenePersistenceScopeId()).toBe("node_director_a");
    expect(getDirectorSceneStorageKey()).toBe("storyai-3d-director-desk-demo:node_director_a");
    expect(getDirectorSceneStorageKey(" node_director_b ")).toBe(
      "storyai-3d-director-desk-demo:node_director_b"
    );
  });

  it("round-trips the current scoped snapshot and fails closed on invalid JSON", () => {
    setDirectorScenePersistenceScopeId("node_director_a");
    const state = { project: { version: 1 } } as unknown as DirectorState;

    writePersistedDirectorState(state);

    expect(readPersistedDirectorStateSnapshot("node_director_a")).toEqual(state);
    localStorage.setItem("storyai-3d-director-desk-demo:broken", "{");
    expect(readPersistedDirectorStateSnapshot("broken")).toBeNull();
  });

  it("persists only local model-library assets and replaces duplicate ids", () => {
    const first = createLocalModelAsset("actor-a");
    const replacement = { ...first, name: "actor-a-updated.glb" };
    const panorama = {
      ...createLocalModelAsset("panorama-a"),
      kind: "panorama",
    } as DirectorAssetRef;

    persistLocalModelAsset(first);
    persistLocalModelAsset(replacement);
    persistLocalModelAsset(panorama);

    expect(readPersistedLocalModelAssets()).toEqual([replacement]);
  });

  it("removes persisted local model metadata by id", () => {
    persistLocalModelAsset(createLocalModelAsset("actor-a"));
    persistLocalModelAsset(createLocalModelAsset("actor-b"));

    removePersistedLocalModelAsset("actor-a");

    expect(readPersistedLocalModelAssets().map((asset) => asset.id)).toEqual(["actor-b"]);
  });
});
