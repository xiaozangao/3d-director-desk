import type { DirectorAssetRef } from "../schema/directorProject";
import type { DirectorState } from "./directorStore.types";

const LOCAL_MODEL_LIBRARY_STORAGE_KEY = "storyai-3d-director-local-model-library";
const DIRECTOR_SCENE_STORAGE_KEY = "storyai-3d-director-desk-demo";
const DIRECTOR_SCENE_STORAGE_KEY_PREFIX = `${DIRECTOR_SCENE_STORAGE_KEY}:`;

function normalizeDirectorScenePersistenceScopeId(scopeId: string | null | undefined) {
  return typeof scopeId === "string" ? scopeId.trim() : "";
}

function getInitialDirectorScenePersistenceScopeId() {
  if (typeof window === "undefined") return null;

  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeDirectorScenePersistenceScopeId(params.get("instanceId")) || null;
  } catch {
    return null;
  }
}

let directorScenePersistenceScopeId: string | null = getInitialDirectorScenePersistenceScopeId();

export function getDirectorScenePersistenceScopeId() {
  return directorScenePersistenceScopeId;
}

export function getDirectorSceneStorageKey(
  scopeId: string | null | undefined = directorScenePersistenceScopeId
) {
  const normalizedScopeId = normalizeDirectorScenePersistenceScopeId(scopeId);
  return normalizedScopeId ? `${DIRECTOR_SCENE_STORAGE_KEY_PREFIX}${normalizedScopeId}` : DIRECTOR_SCENE_STORAGE_KEY;
}

export function setDirectorScenePersistenceScopeId(scopeId: string | null | undefined) {
  const normalizedScopeId = normalizeDirectorScenePersistenceScopeId(scopeId);
  directorScenePersistenceScopeId = normalizedScopeId || null;
}

function getLocalStorageSafe() {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function isLocalModelLibraryAsset(value: unknown): value is DirectorAssetRef {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<DirectorAssetRef>;

  return asset.sourceType === "model"
    && asset.kind !== "panorama"
    && asset.assetSource === "local"
    && typeof asset.id === "string"
    && typeof asset.fileName === "string"
    && typeof asset.url === "string";
}

export function readPersistedLocalModelAssets() {
  const storage = getLocalStorageSafe();
  if (!storage) return [];

  try {
    const snapshot = storage.getItem(LOCAL_MODEL_LIBRARY_STORAGE_KEY);
    if (!snapshot) return [];

    const parsed = JSON.parse(snapshot) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalModelLibraryAsset);
  } catch {
    return [];
  }
}

function writePersistedLocalModelAssets(assets: DirectorAssetRef[]) {
  const storage = getLocalStorageSafe();
  if (!storage) return;

  try {
    storage.setItem(LOCAL_MODEL_LIBRARY_STORAGE_KEY, JSON.stringify(assets.filter(isLocalModelLibraryAsset)));
  } catch {
    // Local model files can exceed browser storage limits; keep the current scene usable if persistence fails.
  }
}

export function persistLocalModelAsset(asset: DirectorAssetRef) {
  if (!isLocalModelLibraryAsset(asset)) return;

  const persistedAssets = readPersistedLocalModelAssets().filter((item) => item.id !== asset.id);
  writePersistedLocalModelAssets([...persistedAssets, asset]);
}

export function removePersistedLocalModelAsset(assetId: string) {
  writePersistedLocalModelAssets(readPersistedLocalModelAssets().filter((asset) => asset.id !== assetId));
}

export function writePersistedDirectorState(state: DirectorState) {
  const storage = getLocalStorageSafe();
  if (!storage) return;

  try {
    storage.setItem(getDirectorSceneStorageKey(), JSON.stringify(state));
  } catch {
    // Keep the editor usable if the browser storage quota is exceeded.
  }
}

export function readPersistedDirectorStateSnapshot(scopeId?: string | null): unknown | null {
  const storage = getLocalStorageSafe();
  if (!storage) return null;

  try {
    const snapshot = storage.getItem(getDirectorSceneStorageKey(scopeId));
    return snapshot ? JSON.parse(snapshot) as unknown : null;
  } catch {
    return null;
  }
}
