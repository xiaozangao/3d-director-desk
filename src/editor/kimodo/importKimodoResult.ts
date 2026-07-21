import { inspectCharacterAnimationFile } from "../loaders/characterAnimationInspection";
import {
  createStoredAssetUrl,
  localAssetBinaryStorage,
  type LocalAssetBinaryRecord,
} from "../loaders/localAssetBinaryStorage";
import { createImportedCharacterActionId } from "../schema/importedCharacterAction";
import type { ImportedAnimationAssetInput } from "../store/directorStore.types";
import type { KimodoApi, KimodoJob } from "./kimodoApi";

interface ImportKimodoResultDependencies {
  api: Pick<KimodoApi, "downloadResult">;
  storage?: {
    isAvailable: boolean;
    save: (file: File, key?: string) => Promise<LocalAssetBinaryRecord>;
  };
  inspect?: typeof inspectCharacterAnimationFile;
  addImportedAnimationAsset: (input: ImportedAnimationAssetInput) => string;
  applyCharacterActionPreset: (characterId: string, actionPresetId: string | null) => void;
  restartPlayback: () => void;
}
export async function importKimodoResult(
  job: KimodoJob,
  characterId: string,
  dependencies: ImportKimodoResultDependencies
) {
  if (job.status !== "succeeded" || !job.result) throw new Error("Kimodo 动作结果尚不可用");
  const storage = dependencies.storage ?? localAssetBinaryStorage;
  if (!storage.isAvailable) throw new Error("当前浏览器不支持动作文件持久化");

  const blob = await dependencies.api.downloadResult(job);
  const fileName = job.result.fileName.toLowerCase().endsWith(".bvh")
    ? job.result.fileName
    : `${job.result.fileName}.bvh`;
  const file = new File([blob], fileName, { type: job.result.mediaType || "application/octet-stream" });
  const report = await (dependencies.inspect ?? inspectCharacterAnimationFile)(file);
  const clips = report.clips.filter((clip) => clip.duration > 0.05 && clip.trackCount > 0);
  if (!clips.length) throw new Error(report.warnings[0] ?? "Kimodo BVH 不包含可播放动作");

  const stored = await storage.save(file);
  const animationAssetId = dependencies.addImportedAnimationAsset({
    name: `Kimodo · ${job.prompt.slice(0, 48)}`,
    fileName,
    url: createStoredAssetUrl(stored.key),
    modelFormat: "bvh",
    storageKey: stored.key,
    byteLength: stored.byteLength,
    rigProfile: "soma",
    clips: clips.map((clip, index) => ({
      id: `clip_${index + 1}`,
      name: clip.name,
      duration: clip.duration,
      trackCount: clip.trackCount,
    })),
  });
  const actionPresetId = createImportedCharacterActionId(animationAssetId, "clip_1");
  dependencies.applyCharacterActionPreset(characterId, actionPresetId);
  dependencies.restartPlayback();
  return { animationAssetId, actionPresetId, clipCount: clips.length };
}
