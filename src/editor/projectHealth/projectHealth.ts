import type { DirectorProject } from "../schema/directorProject";
import { getDirectorBrowserLocalAssetReferences } from "../io/projectPortability";

export interface DirectorProjectHealthStorage {
  isAvailable: boolean;
  read: (key: string) => Promise<unknown | null>;
}

export type DirectorProjectHealthStatus =
  | "portable"
  | "local-assets-present"
  | "missing-local-assets"
  | "storage-unavailable"
  | "storage-error";

export interface DirectorProjectHealth {
  status: DirectorProjectHealthStatus;
  localAssetIds: string[];
  missingLocalAssetIds: string[];
}

export async function inspectDirectorProjectHealth(
  project: DirectorProject,
  storage: DirectorProjectHealthStorage
): Promise<DirectorProjectHealth> {
  const localReferences = getDirectorBrowserLocalAssetReferences(project);
  const localAssetIds = localReferences.map((reference) => reference.id);

  if (localReferences.length === 0) {
    return { status: "portable", localAssetIds, missingLocalAssetIds: [] };
  }

  if (!storage.isAvailable) {
    return { status: "storage-unavailable", localAssetIds, missingLocalAssetIds: [] };
  }

  const missingLocalAssetIds = localReferences
    .filter((reference) => reference.storageKey === null)
    .map((reference) => reference.id);

  try {
    const storedReferences = localReferences.filter((reference) => reference.storageKey !== null);
    const records = await Promise.all(storedReferences.map((reference) => storage.read(reference.storageKey!)));
    records.forEach((record, index) => {
      if (!record) missingLocalAssetIds.push(storedReferences[index].id);
    });
  } catch {
    return { status: "storage-error", localAssetIds, missingLocalAssetIds: [] };
  }

  return {
    status: missingLocalAssetIds.length > 0 ? "missing-local-assets" : "local-assets-present",
    localAssetIds,
    missingLocalAssetIds,
  };
}
