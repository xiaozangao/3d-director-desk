import { normalizePerformanceProfileId } from "../performance/performanceProfiles";
import { normalizeCameraMotionPath } from "../schema/cameraMotion";
import type {
  DirectorProject,
  GroundMaterialPresetId,
  SceneSettings,
} from "../schema/directorProject";
import { normalizeObjectMotionPath } from "../schema/objectMotion";
import {
  DEFAULT_VIEWPORT_ROTATE_SENSITIVITY,
  DEFAULT_VIEWPORT_ZOOM_SENSITIVITY,
  normalizeViewportSensitivity,
} from "../schema/viewportSensitivity";
import {
  readPersistedDirectorStateSnapshot,
  readPersistedLocalModelAssets,
} from "./directorStore.persistence";
import type {
  DirectorRuntimeState,
  DirectorState,
  DirectorStateOptions,
  DirectorUiState,
} from "./directorStore.types";

export const DEFAULT_SCENE: SceneSettings = {
  scale: 1,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  backgroundColor: "#000000",
  backgroundBrightness: 1,
  panoramaYaw: 0,
  panoramaRadius: 60,
  showLabels: true,
  snapToGrid: false,
  showGrid: true,
  showGround: true,
  groundMaterialPreset: "studio" as GroundMaterialPresetId,
  groundTextureScale: 1,
  groundColor: "#303640",
  groundBrightness: 1,
  groundOpacity: 0.4,
  groundHeight: 0,
  pathCollisionEnabled: false,
};

export const DEFAULT_UI_STATE: DirectorUiState = {
  viewMode: "director",
  selectedObjectId: null,
  selectedObjectIds: [],
  selectedCrowdId: null,
  directorInspectorMode: "auto",
  transformMode: "translate",
  viewportAspectRatio: "auto",
  viewportRuleOfThirdsEnabled: false,
  viewportRotateSensitivity: DEFAULT_VIEWPORT_ROTATE_SENSITIVITY,
  viewportZoomSensitivity: DEFAULT_VIEWPORT_ZOOM_SENSITIVITY,
  viewportPanelsCollapsed: false,
  showCharacterRoutes: true,
  finishedShotFov: null,
  motionMonitorFov: null,
  motionStudioOpen: false,
  performanceProfile: "auto",
};

export function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDirectorProjectShape(value: unknown): value is DirectorProject {
  if (!value || typeof value !== "object") return false;

  const project = value as Partial<DirectorProject>;
  return (
    project.version === 1
    && Array.isArray(project.assets)
    && Array.isArray(project.objects)
    && Array.isArray(project.cameras)
    && Boolean(project.scene)
    && typeof project.scene?.backgroundColor === "string"
  );
}

function withPersistedLocalAssets(
  project: DirectorProject,
  includePersistedLocalAssets = false
): DirectorProject {
  if (!includePersistedLocalAssets) return project;

  const persistedAssets = readPersistedLocalModelAssets();
  if (!persistedAssets.length) return project;

  const existingAssetIds = new Set(project.assets.map((asset) => asset.id));
  return {
    ...project,
    assets: [...project.assets, ...persistedAssets.filter((asset) => !existingAssetIds.has(asset.id))],
  };
}

function normalizeSceneSettings(scene: SceneSettings): SceneSettings {
  return {
    ...DEFAULT_SCENE,
    ...scene,
    position: Array.isArray(scene.position) ? scene.position : DEFAULT_SCENE.position,
    rotation: Array.isArray(scene.rotation) ? scene.rotation : DEFAULT_SCENE.rotation,
    backgroundColor: typeof scene.backgroundColor === "string" ? scene.backgroundColor : DEFAULT_SCENE.backgroundColor,
    backgroundBrightness:
      typeof scene.backgroundBrightness === "number" ? scene.backgroundBrightness : DEFAULT_SCENE.backgroundBrightness,
    showGrid: typeof scene.showGrid === "boolean" ? scene.showGrid : DEFAULT_SCENE.showGrid,
    groundMaterialPreset:
      scene.groundMaterialPreset === "concrete"
      || scene.groundMaterialPreset === "asphalt"
      || scene.groundMaterialPreset === "wood"
      || scene.groundMaterialPreset === "grass"
        ? scene.groundMaterialPreset
        : DEFAULT_SCENE.groundMaterialPreset,
    groundTextureScale:
      typeof scene.groundTextureScale === "number" && Number.isFinite(scene.groundTextureScale)
        ? Math.min(8, Math.max(0.25, scene.groundTextureScale))
        : DEFAULT_SCENE.groundTextureScale,
    groundColor: typeof scene.groundColor === "string" ? scene.groundColor : DEFAULT_SCENE.groundColor,
    groundBrightness: typeof scene.groundBrightness === "number" ? scene.groundBrightness : DEFAULT_SCENE.groundBrightness,
  };
}

export function migrateDirectorProject(project: DirectorProject): DirectorProject {
  return {
    ...project,
    scene: normalizeSceneSettings(project.scene),
    animationAssets: Array.isArray(project.animationAssets) ? project.animationAssets : [],
    cameras: project.cameras.map((camera) => ({
      ...camera,
      motionPath: normalizeCameraMotionPath(camera.motionPath, camera.target, camera),
    })),
    objects: project.objects.map((object) => {
      const withMotionPath = object.motionPath
        ? { ...object, motionPath: normalizeObjectMotionPath(object.motionPath, object.transform) }
        : object;
      if (withMotionPath.kind !== "character") return withMotionPath;

      const rig = withMotionPath.characterRig;
      if (rig?.rigType === "ue4-mannequin" || rig?.rigType === "mixamo") return withMotionPath;

      return {
        ...withMotionPath,
        characterRig: {
          rigType: "ue4-mannequin",
          posePresetId: rig?.posePresetId ?? "stand",
          controls: rig?.controls ?? {},
        },
      };
    }),
  };
}

export function extractPersistedDirectorState(state: DirectorRuntimeState): DirectorState {
  return cloneJsonValue({
    viewMode: state.viewMode,
    selectedObjectId: state.selectedObjectId,
    selectedObjectIds: state.selectedObjectIds,
    selectedCrowdId: state.selectedCrowdId,
    directorInspectorMode: state.directorInspectorMode,
    transformMode: state.transformMode,
    viewportAspectRatio: state.viewportAspectRatio,
    viewportRuleOfThirdsEnabled: state.viewportRuleOfThirdsEnabled,
    viewportRotateSensitivity: state.viewportRotateSensitivity,
    viewportZoomSensitivity: state.viewportZoomSensitivity,
    viewportPanelsCollapsed: state.viewportPanelsCollapsed,
    showCharacterRoutes: state.showCharacterRoutes,
    finishedShotFov: state.finishedShotFov,
    motionMonitorFov: state.motionMonitorFov,
    motionStudioOpen: state.motionStudioOpen,
    performanceProfile: state.performanceProfile,
    project: state.project,
  });
}

function createStateFromPersistedProject(
  project: DirectorProject,
  options: DirectorStateOptions = {}
): DirectorState {
  return {
    ...DEFAULT_UI_STATE,
    project: withPersistedLocalAssets(
      migrateDirectorProject(cloneJsonValue(project)),
      options.includePersistedLocalAssets
    ),
  };
}

export function readPersistedDirectorState(options: DirectorStateOptions = {}): DirectorState | null {
  try {
    const parsed = readPersistedDirectorStateSnapshot(options.persistenceScopeId);
    if (parsed === null) return null;

    if (isDirectorProjectShape(parsed)) {
      return createStateFromPersistedProject(parsed, options);
    }

    if (!parsed || typeof parsed !== "object") return null;
    const state = parsed as Partial<DirectorState>;
    if (!isDirectorProjectShape(state.project)) return null;

    return {
      viewMode: state.viewMode === "camera" ? "camera" : "director",
      selectedObjectId: typeof state.selectedObjectId === "string" ? state.selectedObjectId : null,
      selectedObjectIds: Array.isArray(state.selectedObjectIds)
        ? state.selectedObjectIds.filter((item): item is string => typeof item === "string")
        : [],
      selectedCrowdId: typeof state.selectedCrowdId === "string" ? state.selectedCrowdId : null,
      directorInspectorMode: state.directorInspectorMode === "scene" ? "scene" : "auto",
      transformMode:
        state.transformMode === "rotate" || state.transformMode === "scale" ? state.transformMode : "translate",
      viewportAspectRatio: state.viewportAspectRatio ?? "auto",
      viewportRuleOfThirdsEnabled: Boolean(state.viewportRuleOfThirdsEnabled),
      viewportRotateSensitivity: normalizeViewportSensitivity(
        state.viewportRotateSensitivity,
        DEFAULT_VIEWPORT_ROTATE_SENSITIVITY
      ),
      viewportZoomSensitivity: normalizeViewportSensitivity(
        state.viewportZoomSensitivity,
        DEFAULT_VIEWPORT_ZOOM_SENSITIVITY
      ),
      viewportPanelsCollapsed: Boolean(state.viewportPanelsCollapsed),
      showCharacterRoutes: state.showCharacterRoutes !== false,
      finishedShotFov:
        typeof state.finishedShotFov === "number" && Number.isFinite(state.finishedShotFov)
          ? Math.min(120, Math.max(10, state.finishedShotFov))
          : null,
      motionMonitorFov:
        typeof state.motionMonitorFov === "number" && Number.isFinite(state.motionMonitorFov)
          ? Math.min(120, Math.max(10, state.motionMonitorFov))
          : null,
      motionStudioOpen: false,
      performanceProfile: normalizePerformanceProfileId(state.performanceProfile),
      project: withPersistedLocalAssets(
        migrateDirectorProject(cloneJsonValue(state.project)),
        options.includePersistedLocalAssets
      ),
    };
  } catch {
    return null;
  }
}
