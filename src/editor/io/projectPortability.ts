import type { DirectorProject } from "../schema/directorProject";
import { getStoredAssetKey } from "../loaders/localAssetBinaryStorage";

export interface DirectorProjectPortability {
  portable: boolean;
  browserLocalAssetIds: string[];
  note: string | null;
}

const BROWSER_LOCAL_ASSET_NOTE = "这些素材只保存在当前浏览器，工程 JSON 仅包含引用；跨设备使用时需要重新导入原始素材。";

export interface DirectorBrowserLocalAssetReference {
  id: string;
  storageKey: string | null;
}

function toBrowserLocalAssetReference(asset: { id: string; storageKey?: string; url: string }) {
  const storageKey = asset.storageKey ?? getStoredAssetKey(asset.url);
  return storageKey || asset.url.startsWith("blob:")
    ? { id: asset.id, storageKey: storageKey ?? null }
    : null;
}

export function getDirectorBrowserLocalAssetReferences(project: DirectorProject) {
  return [...project.assets, ...(project.animationAssets ?? [])]
    .map(toBrowserLocalAssetReference)
    .filter((reference): reference is DirectorBrowserLocalAssetReference => reference !== null);
}

export function getDirectorProjectPortability(project: DirectorProject): DirectorProjectPortability {
  const browserLocalAssetIds = getDirectorBrowserLocalAssetReferences(project).map((reference) => reference.id);

  return {
    portable: browserLocalAssetIds.length === 0,
    browserLocalAssetIds,
    note: browserLocalAssetIds.length > 0 ? BROWSER_LOCAL_ASSET_NOTE : null,
  };
}
