import { vi } from "vitest";
import { createDefaultDirectorProject } from "../../store/directorStore";
import { inspectDirectorProjectHealth } from "../projectHealth";

it("reports missing IndexedDB records for local asset references", async () => {
  const project = createDefaultDirectorProject();
  project.assets.push({
    id: "present-model",
    kind: "character",
    sourceType: "model",
    fileName: "present.glb",
    url: "director-asset://local/present-key",
    storageKey: "present-key",
  }, {
    id: "missing-model",
    kind: "prop",
    sourceType: "model",
    fileName: "missing.glb",
    url: "director-asset://local/missing-key",
    storageKey: "missing-key",
  });
  const storage = {
    isAvailable: true,
    read: vi.fn(async (key: string) => key === "present-key" ? { key } : null),
  };

  await expect(inspectDirectorProjectHealth(project, storage)).resolves.toMatchObject({
    status: "missing-local-assets",
    localAssetIds: ["present-model", "missing-model"],
    missingLocalAssetIds: ["missing-model"],
  });
});

it("distinguishes unavailable browser storage from missing assets", async () => {
  const project = createDefaultDirectorProject();
  project.assets.push({
    id: "local-model",
    kind: "prop",
    sourceType: "model",
    fileName: "prop.glb",
    url: "director-asset://local/prop-key",
    storageKey: "prop-key",
  });

  await expect(inspectDirectorProjectHealth(project, { isAvailable: false, read: vi.fn() })).resolves.toMatchObject({
    status: "storage-unavailable",
    missingLocalAssetIds: [],
  });
});

it("treats an ephemeral blob URL without a storage key as missing after persistence", async () => {
  const project = createDefaultDirectorProject();
  project.assets.push({
    id: "ephemeral-model",
    kind: "prop",
    sourceType: "model",
    fileName: "prop.glb",
    url: "blob:http://localhost/prop",
  });

  await expect(inspectDirectorProjectHealth(project, { isAvailable: true, read: vi.fn() })).resolves.toMatchObject({
    status: "missing-local-assets",
    missingLocalAssetIds: ["ephemeral-model"],
  });
});
