import { createDefaultDirectorProject } from "../../store/directorStore";
import { getDirectorProjectPortability } from "../projectPortability";

it("marks projects without browser-local assets as JSON portable", () => {
  const project = createDefaultDirectorProject();

  expect(getDirectorProjectPortability(project)).toEqual({
    portable: true,
    browserLocalAssetIds: [],
    note: null,
  });
});

it("reports both local model and animation references", () => {
  const project = createDefaultDirectorProject();
  project.assets.push({
    id: "local-model",
    kind: "character",
    sourceType: "model",
    fileName: "actor.glb",
    url: "blob:http://localhost/actor",
    storageKey: "asset-actor",
  });
  project.animationAssets = [{
    id: "local-animation",
    name: "本地动作",
    fileName: "walk.fbx",
    url: "director-asset://local/action-walk",
    modelFormat: "fbx",
    storageKey: "action-walk",
    rigProfile: "mixamo",
    clips: [],
  }];

  expect(getDirectorProjectPortability(project)).toEqual({
    portable: false,
    browserLocalAssetIds: ["local-model", "local-animation"],
    note: "这些素材只保存在当前浏览器，工程 JSON 仅包含引用；跨设备使用时需要重新导入原始素材。",
  });
});
