import { useEffect, useState } from "react";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import type { DirectorProject } from "../schema/directorProject";
import {
  getDirectorBrowserLocalAssetReferences,
  getDirectorProjectPortability,
} from "../io/projectPortability";
import { localAssetBinaryStorage } from "../loaders/localAssetBinaryStorage";
import {
  inspectDirectorProjectHealth,
  type DirectorProjectHealth,
  type DirectorProjectHealthStorage,
} from "./projectHealth";

export function ProjectHealthIndicator({
  project,
  storage = localAssetBinaryStorage,
}: {
  project: DirectorProject;
  storage?: DirectorProjectHealthStorage;
}) {
  const portability = getDirectorProjectPortability(project);
  const localReferences = getDirectorBrowserLocalAssetReferences(project);
  const [inspection, setInspection] = useState<{
    project: DirectorProject;
    health: DirectorProjectHealth;
  } | null>(null);
  const inspectedHealth = inspection?.project === project ? inspection.health : null;
  const synchronousHealth: DirectorProjectHealth | null = portability.portable
    ? { status: "portable", localAssetIds: [], missingLocalAssetIds: [] }
    : !storage.isAvailable
      ? {
        status: "storage-unavailable",
        localAssetIds: portability.browserLocalAssetIds,
        missingLocalAssetIds: [],
      }
      : localReferences.every((reference) => reference.storageKey === null)
        ? {
          status: "missing-local-assets",
          localAssetIds: portability.browserLocalAssetIds,
          missingLocalAssetIds: portability.browserLocalAssetIds,
        }
        : null;
  const health = synchronousHealth ?? inspectedHealth;

  useEffect(() => {
    let cancelled = false;
    if (synchronousHealth) return () => { cancelled = true; };

    void inspectDirectorProjectHealth(project, storage).then((result) => {
      if (!cancelled) setInspection({ project, health: result });
    });

    return () => { cancelled = true; };
  }, [project, storage, synchronousHealth?.status]);

  if (portability.portable) {
    return (
      <div
        className="project-health-indicator is-portable"
        role="status"
        data-health-state="portable"
        aria-label="工程健康：JSON 可跨设备"
        title="工程 JSON 不依赖当前浏览器的本地素材。"
      >
        <CircleCheck aria-hidden="true" size={14} strokeWidth={1.9} />
        <span>JSON 可跨设备</span>
      </div>
    );
  }

  const assetCount = portability.browserLocalAssetIds.length;
  const missingAssetCount = health?.missingLocalAssetIds.length ?? 0;
  if (health?.status === "missing-local-assets") {
    return (
      <div
        className="project-health-indicator has-missing-assets"
        role="status"
        data-health-state="missing-local-assets"
        aria-label={`工程健康：缺失 ${missingAssetCount} 个本地素材`}
        title="工程引用的本地素材已不在当前浏览器中；请重新导入原始素材后再继续编辑或导出。"
      >
        <CircleX aria-hidden="true" size={14} strokeWidth={1.9} />
        <span>缺失 {missingAssetCount} 个素材</span>
      </div>
    );
  }

  if (health?.status === "storage-unavailable" || health?.status === "storage-error") {
    return (
      <div
        className="project-health-indicator health-check-unavailable"
        role="status"
        data-health-state={health.status}
        aria-label="工程健康：无法检查本地素材"
        title="当前浏览器的本地素材存储不可用，暂时无法确认工程引用是否完整。"
      >
        <TriangleAlert aria-hidden="true" size={14} strokeWidth={1.9} />
        <span>无法检查本地素材</span>
      </div>
    );
  }

  return (
    <div
      className="project-health-indicator has-local-assets"
      role="status"
      data-health-state={health?.status ?? "checking"}
      aria-label={`工程健康：含 ${assetCount} 个仅当前浏览器可用的本地素材`}
      title={portability.note ?? undefined}
    >
      <TriangleAlert aria-hidden="true" size={14} strokeWidth={1.9} />
      <span>{assetCount} 个本地素材</span>
    </div>
  );
}
