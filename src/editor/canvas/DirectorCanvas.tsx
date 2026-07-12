import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Move } from "lucide-react";
import { flushSync } from "react-dom";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { Euler, Matrix4, PerspectiveCamera as ThreePerspectiveCamera, Quaternion, Spherical, Vector3 } from "three";
import type { Object3D } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { clearViewportCaptureHandler, setViewportCaptureHandler } from "../io/captureBridge";
import {
  clearReferenceVideoExportHandler,
  getSupportedReferenceVideoMimeType,
  setReferenceVideoExportHandler,
} from "../io/referenceVideoExport";
import { buildScreenshotMeta, type ScreenshotResult } from "../io/screenshotExport";
import { useDirectorStore, type CameraShotSnapshot } from "../store/directorStore";
import { DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT } from "../schema/cameraGeometry";
import { DEFAULT_CAMERA_MOTION_PATH, getCameraMotionPath } from "../schema/cameraMotion";
import type { DirectorObject, DirectorTransform, SceneSettings } from "../schema/directorProject";
import { getCameraPlaybackSnapshot } from "../schema/cameraPlayback";
import { CameraPilotController } from "../motion/CameraPilotController";
import { MotionStudio } from "../motion/MotionStudio";
import { ObjectMotionTransport } from "../motion/ObjectMotionTransport";
import { PilotHud } from "../motion/PilotHud";
import { exitPointerLockSafely, requestPointerLockSafely } from "../motion/pointerLock";
import { getGroundedLabelY } from "../runtime/mannequin/bodyTypes";
import { getUE4GroundedLabelY } from "../runtime/ue4Mannequin/ue4MannequinRig";
import { DirectorKeyboardController } from "./DirectorKeyboardController";
import { SceneRoot } from "./SceneRoot";
import { ViewportAspectOverlay } from "./ViewportAspectOverlay";
import { ViewportBackground } from "./ViewportBackground";
import { ViewportToolbar } from "./ViewportToolbar";
import { getViewportAspectFrameRect, type ViewportSafeAreaInsets } from "./viewportAspectFrame";
import { getViewportAspectRatioValue } from "../schema/viewportAspectRatio";

export const DEFAULT_DIRECTOR_VIEW_SNAPSHOT: CameraShotSnapshot = DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT;
const VIEWPORT_FRAME_PADDING = 40;
const VIEWPORT_TOOLBAR_BOTTOM_OFFSET = 40;
const DEFAULT_VIEWPORT_TOOLBAR_HEIGHT = 44;
const GIZMO_AXIS_COLORS: [string, string, string] = ["#E56C5B", "#6CDB7A", "#7AA7FF"];
const GIZMO_VIEWPORT_SCALE = 25;
const GIZMO_HIT_LAYER_SIZE = 80;
const GIZMO_HIT_LAYER_CENTER = GIZMO_HIT_LAYER_SIZE / 2;
const GIZMO_AXIS_SCREEN_RADIUS = 25;
const GIZMO_AXIS_HIT_SIZE = 15;
const LEFT_PANEL_WIDTH = 196;
const RIGHT_PANEL_WIDTH = 276;
const MOTION_STUDIO_DOCK_WIDTH = 380;
const GIZMO_EDGE_PADDING = 20;
const HIDE_FROM_VIEWPORT_CAPTURE_KEY = "hideFromViewportCapture";
const CAPTURE_LABEL_FONT_SIZE = 12;
const CAPTURE_LABEL_HORIZONTAL_PADDING = 10;
const CAPTURE_LABEL_VERTICAL_PADDING = 6;
const CAPTURE_LABEL_BORDER_RADIUS = 999;
const CAPTURE_LABEL_PANEL_RGB_FALLBACK = "26 26 26";
const CAPTURE_LABEL_TEXT_RGB_FALLBACK = "255 255 255";
const VIEWPORT_GRID_ELEVATION = 0.002;
const GIZMO_AXIS_HIT_TARGETS: Array<{
  label: string;
  className: string;
  direction: [number, number, number];
}> = [
  { label: "切换到 X 正向视图", className: "is-x-positive", direction: [1, 0, 0] },
  { label: "切换到 Y 正向视图", className: "is-y-positive", direction: [0, 1, 0] },
  { label: "切换到 Z 正向视图", className: "is-z-positive", direction: [0, 0, 1] },
  { label: "切换到 X 反向视图", className: "is-x-negative", direction: [-1, 0, 0] },
  { label: "切换到 Y 反向视图", className: "is-y-negative", direction: [0, -1, 0] },
  { label: "切换到 Z 反向视图", className: "is-z-negative", direction: [0, 0, -1] },
];
type ViewportCaptureLabel = {
  text: string;
  worldPosition: Vector3;
};
type ViewportCaptureFrameRect = NonNullable<ReturnType<typeof getViewportAspectFrameRect>>;

export function shouldRenderViewportGrid(hasPanorama: boolean, snapToGrid: boolean) {
  return true;
}

export function getViewportSnapshotFromGizmoDirection(
  snapshot: CameraShotSnapshot,
  direction: Vector3
): CameraShotSnapshot {
  const target = new Vector3(...snapshot.target);
  const currentPosition = new Vector3(...snapshot.position);
  const radius = Math.max(currentPosition.distanceTo(target), 0.000001);
  const nextDirection = direction.lengthSq() === 0 ? new Vector3(0, 0, 1) : direction.clone().normalize();
  const nextPosition = target.clone().add(nextDirection.multiplyScalar(radius));

  return {
    fov: snapshot.fov,
    position: toSnapshotTuple(nextPosition),
    target: snapshot.target,
  };
}

export function getViewportGizmoHitButtonStyle(
  snapshot: CameraShotSnapshot,
  direction: [number, number, number]
): CSSProperties {
  const relativeCamera = new Vector3(...snapshot.position).sub(new Vector3(...snapshot.target));
  const camera = new ThreePerspectiveCamera(snapshot.fov, 1);
  const safeCameraPosition = relativeCamera.lengthSq() === 0 ? new Vector3(0, 0, 1) : relativeCamera;
  camera.position.copy(safeCameraPosition);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const gizmoQuaternion = new Quaternion().setFromRotationMatrix(new Matrix4().copy(camera.matrix).invert());
  const projectedDirection = new Vector3(...direction).applyQuaternion(gizmoQuaternion);
  const left = GIZMO_HIT_LAYER_CENTER + projectedDirection.x * GIZMO_AXIS_SCREEN_RADIUS - GIZMO_AXIS_HIT_SIZE / 2;
  const top = GIZMO_HIT_LAYER_CENTER - projectedDirection.y * GIZMO_AXIS_SCREEN_RADIUS - GIZMO_AXIS_HIT_SIZE / 2;

  return {
    left: `${Number(left.toFixed(3))}px`,
    top: `${Number(top.toFixed(3))}px`,
    zIndex: Math.round((projectedDirection.z + 1) * 100),
  };
}

function toSnapshotTuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z].map((value) => Number(value.toFixed(6))) as [number, number, number];
}

function areCameraSnapshotsClose(a: CameraShotSnapshot, b: CameraShotSnapshot) {
  const tupleClose = (left: [number, number, number], right: [number, number, number]) =>
    left.every((value, index) => Math.abs(value - right[index]) < 0.00001);

  return Math.abs(a.fov - b.fov) < 0.00001 && tupleClose(a.position, b.position) && tupleClose(a.target, b.target);
}

function applySnapshotToCamera(camera: ThreePerspectiveCamera, snapshot: CameraShotSnapshot) {
  camera.fov = snapshot.fov;
  camera.position.set(...snapshot.position);
  camera.lookAt(...snapshot.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function applySnapshotToRelativeGizmoCamera(camera: ThreePerspectiveCamera, snapshot: CameraShotSnapshot) {
  const position = new Vector3(...snapshot.position);
  const target = new Vector3(...snapshot.target);
  const offset = position.sub(target);

  if (offset.lengthSq() === 0) {
    offset.set(0, 0, 1);
  }

  camera.fov = snapshot.fov;
  camera.position.copy(offset);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function createTransformMatrix(transform: DirectorTransform) {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion().setFromEuler(new Euler(...transform.rotation)),
    new Vector3(...transform.scale)
  );
}

function createSceneMatrix(scene: SceneSettings) {
  return new Matrix4().compose(
    new Vector3(...scene.position),
    new Quaternion().setFromEuler(new Euler(...scene.rotation)),
    new Vector3(scene.scale, scene.scale, scene.scale)
  );
}

function getCharacterCaptureLabelY(item: DirectorObject) {
  return item.characterRig?.rigType === "ue4-mannequin"
    ? getUE4GroundedLabelY(item.bodyType)
    : getGroundedLabelY(item.bodyType);
}

function getViewportCaptureLabels() {
  const {
    project: { objects, scene },
  } = useDirectorStore.getState();

  if (!scene.showLabels) return [];

  const sceneMatrix = createSceneMatrix(scene);

  return objects
    .filter((item) => item.kind === "character" && item.visible)
    .map((item): ViewportCaptureLabel => {
      const objectMatrix = createTransformMatrix(item.transform);
      const worldPosition = new Vector3(0, getCharacterCaptureLabelY(item), 0)
        .applyMatrix4(objectMatrix)
        .applyMatrix4(sceneMatrix);

      return {
        text: item.name,
        worldPosition,
      };
    });
}

function getCssRgbVariable(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function rgbTripletToRgba(rgbTriplet: string, alpha: number) {
  const [red = "0", green = "0", blue = "0"] = rgbTriplet.split(/\s+/);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawViewportCaptureLabels({
  camera,
  context,
  frameRect,
  heightScale,
  labels,
  viewportHeight,
  viewportWidth,
  widthScale,
}: {
  camera: ThreePerspectiveCamera;
  context: CanvasRenderingContext2D;
  frameRect: ViewportCaptureFrameRect;
  heightScale: number;
  labels: ViewportCaptureLabel[];
  viewportHeight: number;
  viewportWidth: number;
  widthScale: number;
}) {
  const drawingContext = context as CanvasRenderingContext2D & {
    fillText?: CanvasRenderingContext2D["fillText"];
    measureText?: CanvasRenderingContext2D["measureText"];
  };

  if (labels.length === 0 || !drawingContext.fillText || !drawingContext.measureText) return;

  const pixelScale = Math.max((widthScale + heightScale) / 2, 0.0001);
  const fontSize = CAPTURE_LABEL_FONT_SIZE * pixelScale;
  const horizontalPadding = CAPTURE_LABEL_HORIZONTAL_PADDING * pixelScale;
  const verticalPadding = CAPTURE_LABEL_VERTICAL_PADDING * pixelScale;
  const labelHeight = fontSize + verticalPadding * 2;
  const panelRgb = getCssRgbVariable("--panel-rgb", CAPTURE_LABEL_PANEL_RGB_FALLBACK);
  const textRgb = getCssRgbVariable("--text-rgb", CAPTURE_LABEL_TEXT_RGB_FALLBACK);

  context.font = `${fontSize}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  labels.forEach((label) => {
    const projected = label.worldPosition.clone().project(camera);
    if (projected.z < -1 || projected.z > 1) return;

    const viewportX = (projected.x * 0.5 + 0.5) * viewportWidth;
    const viewportY = (-projected.y * 0.5 + 0.5) * viewportHeight;
    const x = (viewportX - frameRect.left) * widthScale;
    const y = (viewportY - frameRect.top) * heightScale;
    const textWidth = context.measureText(label.text).width;
    const labelWidth = textWidth + horizontalPadding * 2;
    const labelX = x - labelWidth / 2;
    const labelY = y - labelHeight / 2;

    if (labelX > frameRect.width * widthScale || labelY > frameRect.height * heightScale) return;
    if (labelX + labelWidth < 0 || labelY + labelHeight < 0) return;

    context.fillStyle = rgbTripletToRgba(panelRgb, 0.92);
    drawRoundedRect(context, labelX, labelY, labelWidth, labelHeight, CAPTURE_LABEL_BORDER_RADIUS * pixelScale);
    context.fill();
    context.fillStyle = rgbTripletToRgba(textRgb, 1);
    context.fillText(label.text, x, y);
  });
}

function captureViewportCanvas(
  canvas: HTMLCanvasElement,
  aspectRatio: ReturnType<typeof useDirectorStore.getState>["viewportAspectRatio"],
  bottomPadding: number,
  safeAreaInsets?: ViewportSafeAreaInsets,
  captureLabels?: {
    camera: ThreePerspectiveCamera;
    labels: ViewportCaptureLabel[];
  }
) {
  const viewportWidth = canvas.clientWidth || canvas.width;
  const viewportHeight = canvas.clientHeight || canvas.height;
  const frameRect = getViewportAspectFrameRect(
    aspectRatio,
    viewportWidth,
    viewportHeight,
    bottomPadding,
    safeAreaInsets
  );
  const labels = captureLabels?.labels ?? [];

  if (!frameRect && labels.length === 0) {
    return canvas.toDataURL("image/png");
  }

  const exportFrameRect = frameRect ?? {
    left: 0,
    top: 0,
    width: viewportWidth,
    height: viewportHeight,
  };
  const widthScale = canvas.width / Math.max(viewportWidth, 1);
  const heightScale = canvas.height / Math.max(viewportHeight, 1);
  const sourceX = Math.round(exportFrameRect.left * widthScale);
  const sourceY = Math.round(exportFrameRect.top * heightScale);
  const sourceWidth = Math.max(Math.round(exportFrameRect.width * widthScale), 1);
  const sourceHeight = Math.max(Math.round(exportFrameRect.height * heightScale), 1);
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = sourceWidth;
  cropCanvas.height = sourceHeight;
  let context: CanvasRenderingContext2D | null = null;

  try {
    context = cropCanvas.getContext("2d");
  } catch {
    return canvas.toDataURL("image/png");
  }

  if (!context) {
    return canvas.toDataURL("image/png");
  }

  context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  if (captureLabels) {
    drawViewportCaptureLabels({
      camera: captureLabels.camera,
      context,
      frameRect: exportFrameRect,
      heightScale,
      labels,
      viewportHeight,
      viewportWidth,
      widthScale,
    });
  }
  return cropCanvas.toDataURL("image/png");
}

function withViewportCaptureHelpersHidden(scene: Object3D, render: () => void) {
  const hiddenObjects: Array<{ object: Object3D; visible: boolean }> = [];

  scene.traverse((object) => {
    if (object.userData?.[HIDE_FROM_VIEWPORT_CAPTURE_KEY]) {
      hiddenObjects.push({ object, visible: object.visible });
      object.visible = false;
    }
  });

  try {
    render();
  } finally {
    hiddenObjects.forEach(({ object, visible }) => {
      object.visible = visible;
    });
  }
}

function CanvasCaptureBridge({
  activeCamera,
  bottomPadding,
  controlsRef,
  safeAreaInsets,
  viewportAspectRatio,
  viewMode,
}: {
  activeCamera:
    | {
        id: string;
        fov: number;
        target: [number, number, number];
      }
    | undefined;
  bottomPadding: number;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  safeAreaInsets: ViewportSafeAreaInsets;
  viewportAspectRatio: ReturnType<typeof useDirectorStore.getState>["viewportAspectRatio"];
  viewMode: "director" | "camera";
}) {
  const { camera, gl, scene } = useThree();

  useEffect(() => {
    const workingCamera = camera as ThreePerspectiveCamera;

    const capture = async ({
      cameraId,
      preset,
      source,
    }: {
      cameraId?: string | null;
      preset: "current" | "four" | "twelve";
      source: "capture-panel" | "camera-panel";
    }): Promise<ScreenshotResult[]> => {
      const target = new Vector3(0, 1.2, 0);
      if (viewMode === "camera" && activeCamera) {
        target.fromArray(activeCamera.target);
      } else if (controlsRef.current?.target) {
        target.copy(controlsRef.current.target);
      }

      const originalPosition = workingCamera.position.clone();
      const originalQuaternion = workingCamera.quaternion.clone();
      const originalFov = workingCamera.fov;

      const snapshot = (label: string) => {
        withViewportCaptureHelpersHidden(scene, () => {
          gl.render(scene, workingCamera);
        });
        return {
          label,
          dataUrl: captureViewportCanvas(gl.domElement, viewportAspectRatio, bottomPadding, safeAreaInsets, {
            camera: workingCamera,
            labels: getViewportCaptureLabels(),
          }),
          meta: buildScreenshotMeta({
            mode: viewMode,
            cameraId: cameraId ?? (viewMode === "camera" ? activeCamera?.id ?? null : null),
            fov: workingCamera.fov,
            position: [workingCamera.position.x, workingCamera.position.y, workingCamera.position.z],
            target: [target.x, target.y, target.z],
          }),
        };
      };

      if (preset === "current") {
        return [snapshot(source === "camera-panel" ? "当前机位" : "当前视角")];
      }

      const count = preset === "four" ? 4 : 12;
      const labelPrefix = preset === "four" ? "四方位" : "十二方位";
      const offset = originalPosition.clone().sub(target);
      const spherical = new Spherical().setFromVector3(offset.lengthSq() === 0 ? new Vector3(0, 0, 6) : offset);
      const phi = Math.min(Math.max(spherical.phi, 0.35), Math.PI - 0.35);
      const radius = spherical.radius || 6;

      try {
        const results: ScreenshotResult[] = [];
        for (let index = 0; index < count; index += 1) {
          const orbit = new Spherical(radius, phi, spherical.theta + (Math.PI * 2 * index) / count);
          const nextPosition = target.clone().add(new Vector3().setFromSpherical(orbit));
          workingCamera.position.copy(nextPosition);
          workingCamera.lookAt(target);
          workingCamera.updateProjectionMatrix();
          results.push(snapshot(`${labelPrefix} ${index + 1}`));
        }
        return results;
      } finally {
        workingCamera.position.copy(originalPosition);
        workingCamera.quaternion.copy(originalQuaternion);
        workingCamera.fov = originalFov;
        workingCamera.updateProjectionMatrix();
        gl.render(scene, workingCamera);
      }
    };

    setViewportCaptureHandler(capture);
    return () => clearViewportCaptureHandler();
  }, [activeCamera, bottomPadding, camera, controlsRef, gl, safeAreaInsets, scene, viewMode, viewportAspectRatio]);

  return null;
}

function DirectorViewCameraSync({
  controlsRef,
  disabled,
  snapshot,
  viewMode,
}: {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  disabled?: boolean;
  snapshot: CameraShotSnapshot;
  viewMode: "director" | "camera";
}) {
  const { camera } = useThree();

  useLayoutEffect(() => {
    if (viewMode !== "director" || disabled) return;

    const perspectiveCamera = camera as ThreePerspectiveCamera;
    applySnapshotToCamera(perspectiveCamera, snapshot);

    if (controlsRef.current) {
      controlsRef.current.target.set(...snapshot.target);
      controlsRef.current.update();
    }
  }, [camera, controlsRef, disabled, snapshot, viewMode]);

  return null;
}

function CameraViewCameraSync({
  snapshot,
  viewMode,
}: {
  snapshot: CameraShotSnapshot | undefined;
  viewMode: "director" | "camera";
}) {
  const { camera } = useThree();

  useLayoutEffect(() => {
    if (viewMode !== "camera" || !snapshot) return;
    applySnapshotToCamera(camera as ThreePerspectiveCamera, snapshot);
  }, [camera, snapshot, viewMode]);

  useFrame(() => {
    const state = useDirectorStore.getState();
    if (state.viewMode !== "camera") return;
    const activeCamera = state.project.cameras.find((item) => item.id === state.project.activeCameraId)
      ?? state.project.cameras[0];
    if (!activeCamera) return;

    const playbackSnapshot = getCameraPlaybackSnapshot(activeCamera, state.project.objects, state.cameraMotionProgress, state.project.scene);
    applySnapshotToCamera(camera as ThreePerspectiveCamera, {
      ...playbackSnapshot,
      fov: state.finishedShotFov ?? playbackSnapshot.fov,
    });
  });

  return null;
}

function PlaybackCameraSync({
  snapshot,
  fovOverride,
}: {
  snapshot: CameraShotSnapshot | undefined;
  fovOverride: number | null;
}) {
  const { camera } = useThree();

  useLayoutEffect(() => {
    if (snapshot) applySnapshotToCamera(camera as ThreePerspectiveCamera, {
      ...snapshot,
      fov: fovOverride ?? snapshot.fov,
    });
  }, [camera, fovOverride, snapshot]);

  useFrame(() => {
    const state = useDirectorStore.getState();
    const activeCamera = state.project.cameras.find((item) => item.id === state.project.activeCameraId)
      ?? state.project.cameras[0];
    if (!activeCamera) return;
    const playbackSnapshot = getCameraPlaybackSnapshot(activeCamera, state.project.objects, state.cameraMotionProgress, state.project.scene);
    applySnapshotToCamera(camera as ThreePerspectiveCamera, {
      ...playbackSnapshot,
      fov: fovOverride ?? playbackSnapshot.fov,
    });
  });

  return null;
}

function FixedCameraSync({ snapshot, fovOverride }: { snapshot: CameraShotSnapshot; fovOverride: number | null }) {
  const { camera } = useThree();
  useLayoutEffect(() => applySnapshotToCamera(camera as ThreePerspectiveCamera, {
    ...snapshot,
    fov: fovOverride ?? snapshot.fov,
  }), [camera, fovOverride, snapshot]);
  return null;
}

function ViewportGizmoContent({
  onSnapshotChange,
  snapshot,
}: {
  onSnapshotChange: (snapshot: CameraShotSnapshot) => void;
  snapshot: CameraShotSnapshot;
}) {
  const { camera } = useThree();
  const targetRef = useRef(new Vector3(...snapshot.target));

  useLayoutEffect(() => {
    targetRef.current.set(...snapshot.target);
    applySnapshotToRelativeGizmoCamera(camera as ThreePerspectiveCamera, snapshot);
  }, [camera, snapshot]);

  const handleGizmoUpdate = useCallback(() => {
    const relativeCamera = camera as ThreePerspectiveCamera;
    const target = targetRef.current;
    const position = target.clone().add(relativeCamera.position);

    onSnapshotChange({
      fov: snapshot.fov,
      position: toSnapshotTuple(position),
      target: toSnapshotTuple(target),
    });
  }, [camera, onSnapshotChange, snapshot.fov]);

  const getGizmoTarget = useCallback(() => new Vector3(0, 0, 0), []);

  return (
    <GizmoHelper alignment="center-center" margin={[0, 0]} onTarget={getGizmoTarget} onUpdate={handleGizmoUpdate}>
      <GizmoViewport
        axisColors={GIZMO_AXIS_COLORS}
        disabled
        scale={GIZMO_VIEWPORT_SCALE}
      />
    </GizmoHelper>
  );
}

function ViewportGizmoOverlay({
  onSnapshotChange,
  rightOffset = GIZMO_EDGE_PADDING,
  snapshot,
}: {
  onSnapshotChange: (snapshot: CameraShotSnapshot) => void;
  rightOffset?: number;
  snapshot: CameraShotSnapshot;
}) {
  function selectAxisDirection(direction: [number, number, number]) {
    onSnapshotChange(getViewportSnapshotFromGizmoDirection(snapshot, new Vector3(...direction)));
  }

  return (
    <div className="viewport-gizmo-overlay" aria-label="3D视口原生坐标控件" style={{ right: `${rightOffset}px` }}>
      <Canvas
        className="viewport-gizmo-canvas"
        camera={{ fov: snapshot.fov, position: [0, 0, 1] }}
        gl={{ alpha: true, antialias: true }}
      >
        <ViewportGizmoContent onSnapshotChange={onSnapshotChange} snapshot={snapshot} />
      </Canvas>
      <div className="viewport-gizmo-hit-layer" aria-label="3D视口坐标切换按钮">
        {GIZMO_AXIS_HIT_TARGETS.map((target) => (
          <button
            key={target.label}
            aria-label={target.label}
            className={`viewport-gizmo-hit-button ${target.className}`}
            style={getViewportGizmoHitButtonStyle(snapshot, target.direction)}
            type="button"
            onClick={() => selectAxisDirection(target.direction)}
          />
        ))}
      </div>
    </div>
  );
}

function MotionMonitor({
  cameraSnapshot,
  directorSnapshot,
  mainViewMode,
  aspectRatio,
  finishedShotFov,
  monitorFov,
  onFinishedShotFovChange,
  onMonitorFovChange,
}: {
  cameraSnapshot: CameraShotSnapshot | undefined;
  directorSnapshot: CameraShotSnapshot;
  mainViewMode: "director" | "camera";
  aspectRatio: number;
  finishedShotFov: number | null;
  monitorFov: number | null;
  onFinishedShotFovChange: (fov: number | null) => void;
  onMonitorFovChange: (fov: number | null) => void;
}) {
  const monitorCameraBase = mainViewMode === "director" ? cameraSnapshot : directorSnapshot;
  const monitorCamera = monitorCameraBase
    ? { ...monitorCameraBase, fov: monitorFov ?? monitorCameraBase.fov }
    : undefined;
  const [position, setPosition] = useState({ x: 214, y: 18 });
  const dragRef = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const width = Math.min(320, Math.max(220, window.innerWidth - 640));
      setPosition({
        x: Math.min(Math.max(8, drag.startX + event.clientX - drag.pointerX), Math.max(8, window.innerWidth - width - 8)),
        y: Math.min(Math.max(8, drag.startY + event.clientY - drag.pointerY), Math.max(8, window.innerHeight - 230)),
      });
    }

    function stopDragging() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  if (!monitorCamera) return null;

  return (
    <aside
      className="motion-monitor"
      aria-label={mainViewMode === "director" ? "成片实时监看" : "路线实时监看"}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      <header
        aria-label="拖动监看窗口"
        onPointerDown={(event) => {
          event.preventDefault();
          dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, startX: position.x, startY: position.y };
        }}
      >
        <span>{mainViewMode === "director" ? "成片监看" : "路线监看"}</span>
        <small><Move aria-hidden="true" size={11} />拖动</small>
      </header>
      <div className="motion-monitor-canvas-wrap" style={{ aspectRatio }}>
        <Canvas camera={{ fov: monitorCamera.fov, position: monitorCamera.position }} dpr={[1, 1.5]} gl={{ antialias: true }}>
          <ViewportBackground
            backgroundColor={useDirectorStore.getState().project.scene.backgroundColor}
            backgroundBrightness={useDirectorStore.getState().project.scene.backgroundBrightness}
            panoramaAsset={null}
            panoramaRadius={useDirectorStore.getState().project.scene.panoramaRadius}
            panoramaYaw={useDirectorStore.getState().project.scene.panoramaYaw}
          />
          <ambientLight intensity={1.15} />
          <directionalLight intensity={1.2} position={[8, 10, 6]} />
          {mainViewMode === "director"
            ? <PlaybackCameraSync fovOverride={monitorFov} snapshot={cameraSnapshot} />
            : <FixedCameraSync fovOverride={monitorFov} snapshot={directorSnapshot} />}
          {mainViewMode === "camera" ? (
            <OrbitControls
              enableDamping
              makeDefault
              target={directorSnapshot.target}
              rotateSpeed={0.55}
              zoomSpeed={0.65}
            />
          ) : null}
          <Suspense fallback={null}>
            <SceneRoot renderMode={mainViewMode === "director" ? "clean-camera" : "director-monitor"} />
          </Suspense>
        </Canvas>
      </div>
      <div className="motion-monitor-fov" aria-label="看成片 FOV 设置">
        <label>
          <span>看成片</span>
          <input
            aria-label="看成片 FOV"
            type="range"
            min="10"
            max="120"
            step="1"
            value={finishedShotFov ?? cameraSnapshot?.fov ?? 50}
            onChange={(event) => onFinishedShotFovChange(Number(event.currentTarget.value))}
          />
          <output>{Math.round(finishedShotFov ?? cameraSnapshot?.fov ?? 50)}°</output>
        </label>
        <button type="button" disabled={finishedShotFov === null} onClick={() => onFinishedShotFovChange(null)}>
          跟随轨迹
        </button>
      </div>
      <div className="motion-monitor-fov motion-monitor-fov--secondary" aria-label="小窗 FOV 设置">
        <label>
          <span>小窗</span>
          <input
            aria-label="小窗 FOV"
            type="range"
            min="10"
            max="120"
            step="1"
            value={monitorFov ?? monitorCameraBase?.fov ?? 50}
            onChange={(event) => onMonitorFovChange(Number(event.currentTarget.value))}
          />
          <output>{Math.round(monitorFov ?? monitorCameraBase?.fov ?? 50)}°</output>
        </label>
        <button type="button" disabled={monitorFov === null} onClick={() => onMonitorFovChange(null)}>
          跟随原视角
        </button>
      </div>
    </aside>
  );
}

function getReferenceVideoDimensions(quality: "720p" | "1080p", ratio: number | null) {
  const landscapeWidth = quality === "1080p" ? 1920 : 1280;
  const landscapeHeight = quality === "1080p" ? 1080 : 720;
  const aspect = ratio ?? 16 / 9;
  if (aspect >= 1) return { width: landscapeWidth, height: Math.round(landscapeWidth / aspect) };
  return { width: Math.round(landscapeHeight * aspect), height: landscapeHeight };
}

export function DirectorCanvas() {
  const viewMode = useDirectorStore((state) => state.viewMode);
  const openSceneInspector = useDirectorStore((state) => state.openSceneInspector);
  const sceneSettings = useDirectorStore((state) => state.project.scene);
  const activeCamera = useDirectorStore((state) =>
    state.project.cameras.find((item) => item.id === state.project.activeCameraId) ?? state.project.cameras[0]
  );
  const cameraMotionProgress = useDirectorStore((state) => state.cameraMotionProgress);
  const cameraMotionPlaying = useDirectorStore((state) => state.cameraMotionPlaying);
  const motionStudioOpen = useDirectorStore((state) => state.motionStudioOpen);
  const setCameraMotionProgress = useDirectorStore((state) => state.setCameraMotionProgress);
  const setCameraMotionPlaying = useDirectorStore((state) => state.setCameraMotionPlaying);
  const cameraPilotMode = useDirectorStore((state) => state.cameraPilotMode);
  const cameraPilotEditKeyframeId = useDirectorStore((state) => state.cameraPilotEditKeyframeId);
  const cameraPilotHoveredTargetId = useDirectorStore((state) => state.cameraPilotHoveredTargetId);
  const cameraPilotLockedTargetId = useDirectorStore((state) => state.cameraPilotLockedTargetId);
  const sceneObjects = useDirectorStore((state) => state.project.objects);
  const recordCameraMotionSnapshot = useDirectorStore((state) => state.recordCameraMotionSnapshot);
  const startCameraPilot = useDirectorStore((state) => state.startCameraPilot);
  const stopCameraPilot = useDirectorStore((state) => state.stopCameraPilot);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const viewportContainerRef = useRef<HTMLDivElement | null>(null);
  const viewportCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const referenceVideoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportCameraSnapshotRef = useRef<CameraShotSnapshot>(DEFAULT_DIRECTOR_VIEW_SNAPSHOT);
  const [directorViewSnapshot, setDirectorViewSnapshot] = useState(DEFAULT_DIRECTOR_VIEW_SNAPSHOT);
  const [toolbarHeight, setToolbarHeight] = useState(DEFAULT_VIEWPORT_TOOLBAR_HEIGHT);
  const [referenceVideoQuality, setReferenceVideoQuality] = useState<"720p" | "1080p">("720p");
  const [referenceVideoRendering, setReferenceVideoRendering] = useState(false);
  const [automaticViewportAspect, setAutomaticViewportAspect] = useState(16 / 9);
  const isCameraPiloting = cameraPilotMode !== "idle";
  const activeCameraMotionPath = useMemo(
    () => (activeCamera ? getCameraMotionPath(activeCamera) : undefined),
    [activeCamera]
  );
  const isCameraPreviewing =
    motionStudioOpen
    && viewMode === "camera"
    && (activeCameraMotionPath?.keyframes.length ?? 0) >= 2
    && !isCameraPiloting;
  const showViewportGrid = shouldRenderViewportGrid(false, sceneSettings.snapToGrid);
  const hasObjectMotion = useMemo(
    () => sceneObjects.some((item) =>
      (item.motionPath?.keyframes?.length ?? 0) >= 2 || Boolean(item.characterRig?.actionPresetId)
    ),
    [sceneObjects]
  );
  const hasPlayableMotion = (activeCameraMotionPath?.keyframes.length ?? 0) >= 2 || hasObjectMotion;
  const activeMotionDuration = activeCameraMotionPath?.duration ?? DEFAULT_CAMERA_MOTION_PATH.duration;
  const viewportAspectRatio = useDirectorStore((state) => state.viewportAspectRatio);
  const finishedShotFov = useDirectorStore((state) => state.finishedShotFov);
  const motionMonitorFov = useDirectorStore((state) => state.motionMonitorFov);
  const setFinishedShotFov = useDirectorStore((state) => state.setFinishedShotFov);
  const setMotionMonitorFov = useDirectorStore((state) => state.setMotionMonitorFov);
  const activeCameraView = activeCamera
    ? (() => {
        const snapshot = getCameraPlaybackSnapshot(activeCamera, sceneObjects, cameraMotionProgress, sceneSettings);
        return { ...snapshot, fov: finishedShotFov ?? snapshot.fov };
      })()
    : undefined;
  const finishedShotAspectRatio = getViewportAspectRatioValue(viewportAspectRatio) ?? automaticViewportAspect;
  const viewportRuleOfThirdsEnabled = useDirectorStore((state) => state.viewportRuleOfThirdsEnabled);
  const viewportRotateSensitivity = useDirectorStore((state) => state.viewportRotateSensitivity);
  const viewportZoomSensitivity = useDirectorStore((state) => state.viewportZoomSensitivity);
  const viewportPanelsCollapsed = useDirectorStore((state) => state.viewportPanelsCollapsed);
  const setViewMode = useDirectorStore((state) => state.setViewMode);
  const setViewportRuleOfThirdsEnabled = useDirectorStore((state) => state.setViewportRuleOfThirdsEnabled);
  const visibleViewportSnapshot =
    viewMode === "camera" && activeCameraView ? activeCameraView : directorViewSnapshot;
  const viewportSafeAreaInsets: ViewportSafeAreaInsets = {
    left: viewportPanelsCollapsed || isCameraPiloting || isCameraPreviewing ? 0 : LEFT_PANEL_WIDTH,
    right:
      isCameraPiloting || isCameraPreviewing
        ? 0
        : motionStudioOpen
          ? MOTION_STUDIO_DOCK_WIDTH
          : viewportPanelsCollapsed
            ? 0
            : RIGHT_PANEL_WIDTH,
    top: 0,
    bottom: 0,
  };
  const gizmoRightOffset =
    (motionStudioOpen ? MOTION_STUDIO_DOCK_WIDTH : viewportPanelsCollapsed ? 0 : RIGHT_PANEL_WIDTH) +
    GIZMO_EDGE_PADDING;
  const hoveredPilotTargetName = cameraPilotHoveredTargetId
    ? sceneObjects.find((item) => item.id === cameraPilotHoveredTargetId)?.name ?? null
    : null;
  const lockedPilotTargetName = cameraPilotLockedTargetId
    ? sceneObjects.find((item) => item.id === cameraPilotLockedTargetId)?.name ?? null
    : null;

  useEffect(() => {
    if (!cameraMotionPlaying) return;
    if (!hasPlayableMotion) {
      setCameraMotionPlaying(false);
      return;
    }

    let animationFrame = 0;
    let cycleStartedAt = performance.now() - cameraMotionProgress * activeMotionDuration * 1000;
    const tick = (now: number) => {
      const elapsed = (now - cycleStartedAt) / (activeMotionDuration * 1000);
      if (elapsed >= 1) {
        if (activeCameraMotionPath?.loop) {
          cycleStartedAt = now;
          setCameraMotionProgress(0);
          animationFrame = requestAnimationFrame(tick);
          return;
        }
        setCameraMotionProgress(1);
        setCameraMotionPlaying(false);
        return;
      }
      setCameraMotionProgress(elapsed);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrame);
  }, [
    activeCameraMotionPath,
    activeMotionDuration,
    cameraMotionPlaying,
    hasPlayableMotion,
    setCameraMotionPlaying,
    setCameraMotionProgress,
  ]);

  useLayoutEffect(() => {
    const element = toolbarRef.current;
    if (!element) return;

    const updateHeight = () => {
      const nextHeight = Math.max(element.offsetHeight, DEFAULT_VIEWPORT_TOOLBAR_HEIGHT);
      setToolbarHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => {
        window.removeEventListener("resize", updateHeight);
      };
    }

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(element);
    window.addEventListener("resize", updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useLayoutEffect(() => {
    const element = viewportContainerRef.current;
    if (!element) return;
    const updateAspect = () => {
      if (element.clientWidth > 0 && element.clientHeight > 0) {
        setAutomaticViewportAspect(element.clientWidth / element.clientHeight);
      }
    };
    updateAspect();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateAspect);
    observer?.observe(element);
    window.addEventListener("resize", updateAspect);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateAspect);
    };
  }, []);

  useEffect(() => {
    setReferenceVideoExportHandler(async ({ fileName, fps, quality }) => {
      flushSync(() => {
        setReferenceVideoQuality(quality);
        setReferenceVideoRendering(true);
      });
      try {
        const startedWaitingAt = performance.now();
        while (!referenceVideoCanvasRef.current && performance.now() - startedWaitingAt < 2000) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        const canvas = referenceVideoCanvasRef.current;
        const mimeType = getSupportedReferenceVideoMimeType();
        if (!canvas || !mimeType || !activeCamera || !activeCameraMotionPath || activeCameraMotionPath.keyframes.length < 2) {
          throw new Error("当前浏览器无法导出参考视频");
        }

        const stream = canvas.captureStream(fps);
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: quality === "1080p" ? 12_000_000 : 6_000_000,
        });
        const chunks: Blob[] = [];
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        });
        const stopped = new Promise<void>((resolve, reject) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
          recorder.addEventListener("error", () => reject(new Error("参考视频录制失败")), { once: true });
        });

        setCameraMotionPlaying(false);
        setCameraMotionProgress(0);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        recorder.start(250);
        setCameraMotionPlaying(true);
        await new Promise<void>((resolve) => window.setTimeout(resolve, activeMotionDuration * 1000 + 120));
        setCameraMotionPlaying(false);
        setCameraMotionProgress(1);
        recorder.stop();
        await stopped;
        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } finally {
        setCameraMotionPlaying(false);
        referenceVideoCanvasRef.current = null;
        setReferenceVideoRendering(false);
      }
    });
    return () => clearReferenceVideoExportHandler();
  }, [activeCamera, activeCameraMotionPath, activeMotionDuration, setCameraMotionPlaying, setCameraMotionProgress]);

  function getViewportCameraSnapshot(): CameraShotSnapshot {
    return viewportCameraSnapshotRef.current;
  }

  function updateDirectorViewSnapshot(snapshot: CameraShotSnapshot) {
    viewportCameraSnapshotRef.current = snapshot;
    setDirectorViewSnapshot((currentSnapshot) =>
      areCameraSnapshotsClose(currentSnapshot, snapshot) ? currentSnapshot : snapshot
    );
  }

  function updateViewportGizmoSnapshot(snapshot: CameraShotSnapshot) {
    if (viewMode !== "director") {
      setViewMode("director");
    }
    updateDirectorViewSnapshot(snapshot);
  }

  function recordPilotSnapshot(snapshot = viewportCameraSnapshotRef.current) {
    if (!activeCamera) return;
    recordCameraMotionSnapshot(
      activeCamera.id,
      snapshot,
      cameraPilotEditKeyframeId,
      hasObjectMotion && cameraMotionPlaying ? cameraMotionProgress : null
    );
    if (cameraPilotEditKeyframeId) {
      stopPilotSession();
    }
  }

  function toggleSceneActionPlayback() {
    if (cameraMotionPlaying) {
      setCameraMotionPlaying(false);
      return;
    }
    if (!hasObjectMotion) return;
    if (cameraMotionProgress >= 0.999) setCameraMotionProgress(0);
    setCameraMotionPlaying(true);
  }

  function startPilotSession(editKeyframeId: string | null = null) {
    startCameraPilot("pilot", editKeyframeId);
    const canvas = viewportCanvasRef.current;
    if (canvas) void requestPointerLockSafely(canvas);
  }

  function stopPilotSession() {
    updateDirectorViewSnapshot(viewportCameraSnapshotRef.current);
    stopCameraPilot();
    void exitPointerLockSafely();
  }

  const aspectOverlayBottomPadding =
    VIEWPORT_FRAME_PADDING + VIEWPORT_TOOLBAR_BOTTOM_OFFSET + toolbarHeight;

  return (
    <div className="canvas-frame">
      <div className="director-canvas" data-testid="director-canvas" ref={viewportContainerRef}>
        <Canvas
          camera={{ position: DEFAULT_DIRECTOR_VIEW_SNAPSHOT.position, fov: DEFAULT_DIRECTOR_VIEW_SNAPSHOT.fov }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          onPointerMissed={() => {
            if (!isCameraPiloting) openSceneInspector();
          }}
          onCreated={({ camera, gl }) => {
            const perspectiveCamera = camera as ThreePerspectiveCamera;
            viewportCanvasRef.current = gl.domElement;
            perspectiveCamera.lookAt(...DEFAULT_DIRECTOR_VIEW_SNAPSHOT.target);
            viewportCameraSnapshotRef.current = {
              fov: perspectiveCamera.fov,
              position: [perspectiveCamera.position.x, perspectiveCamera.position.y, perspectiveCamera.position.z],
              target: DEFAULT_DIRECTOR_VIEW_SNAPSHOT.target,
            };
            setDirectorViewSnapshot(viewportCameraSnapshotRef.current);
          }}
        >
          <ViewportBackground
            backgroundColor={sceneSettings.backgroundColor}
            backgroundBrightness={sceneSettings.backgroundBrightness}
            panoramaAsset={null}
            panoramaRadius={sceneSettings.panoramaRadius}
            panoramaYaw={sceneSettings.panoramaYaw}
          />
          <ambientLight intensity={1.15} />
          <directionalLight intensity={1.2} position={[8, 10, 6]} />
          {showViewportGrid ? (
            <Grid
              cellThickness={0}
              fadeDistance={80}
              infiniteGrid
              position={[0, sceneSettings.groundHeight + VIEWPORT_GRID_ELEVATION, 0]}
              sectionColor="#2A4065"
              userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
            />
          ) : null}
          {viewMode === "director" ? (
            <OrbitControls
              ref={controlsRef}
              enableDamping
              enabled={!isCameraPiloting}
              makeDefault
              rotateSpeed={viewportRotateSensitivity}
              target={DEFAULT_DIRECTOR_VIEW_SNAPSHOT.target}
              zoomSpeed={viewportZoomSensitivity}
              onChange={(event) => {
                const perspectiveCamera = event?.target?.object as ThreePerspectiveCamera | undefined;
                const target = event?.target?.target as Vector3 | undefined;
                if (!perspectiveCamera || !target) return;
                updateDirectorViewSnapshot({
                  fov: perspectiveCamera.fov,
                  position: [perspectiveCamera.position.x, perspectiveCamera.position.y, perspectiveCamera.position.z],
                  target: [target.x, target.y, target.z],
                });
              }}
            />
          ) : null}
          <DirectorKeyboardController
            active={viewMode === "director" && !isCameraPiloting && !isCameraPreviewing}
            controlsRef={controlsRef}
          />
          <DirectorViewCameraSync
            controlsRef={controlsRef}
            disabled={isCameraPiloting}
            snapshot={directorViewSnapshot}
            viewMode={viewMode}
          />
          <CameraViewCameraSync snapshot={activeCameraView} viewMode={viewMode} />
          <CanvasCaptureBridge
            activeCamera={activeCamera}
            bottomPadding={aspectOverlayBottomPadding}
            controlsRef={controlsRef}
            safeAreaInsets={viewportSafeAreaInsets}
            viewportAspectRatio={viewportAspectRatio}
            viewMode={viewMode}
          />
          <CameraPilotController
            active={isCameraPiloting}
            snapshotRef={viewportCameraSnapshotRef}
            onExit={stopPilotSession}
            onRecord={recordPilotSnapshot}
            onSnapshotCommit={updateDirectorViewSnapshot}
            onToggleActionPlayback={toggleSceneActionPlayback}
          />
          <Suspense fallback={null}>
            <SceneRoot />
          </Suspense>
        </Canvas>
      </div>
      <ViewportAspectOverlay
        bottomPadding={aspectOverlayBottomPadding}
        onToggleRuleOfThirds={setViewportRuleOfThirdsEnabled}
        ratio={viewportAspectRatio}
        safeAreaInsets={viewportSafeAreaInsets}
        showRuleOfThirds={viewportRuleOfThirdsEnabled}
      />
      {!isCameraPiloting && !isCameraPreviewing ? (
        <ViewportGizmoOverlay
          onSnapshotChange={updateViewportGizmoSnapshot}
          rightOffset={gizmoRightOffset}
          snapshot={visibleViewportSnapshot}
        />
      ) : null}
      {!isCameraPiloting && !isCameraPreviewing ? (
        <ViewportToolbar getViewportCameraSnapshot={getViewportCameraSnapshot} toolbarContainerRef={toolbarRef} />
      ) : null}
      <MotionStudio
        getViewportCameraSnapshot={getViewportCameraSnapshot}
        onLoadCameraSnapshot={updateDirectorViewSnapshot}
        onStartPilot={startPilotSession}
      />
      {motionStudioOpen && (activeCameraMotionPath?.keyframes.length ?? 0) >= 2 && !isCameraPiloting && !referenceVideoRendering ? (
        <MotionMonitor
          aspectRatio={finishedShotAspectRatio}
          cameraSnapshot={activeCameraView}
          directorSnapshot={directorViewSnapshot}
          finishedShotFov={finishedShotFov}
          mainViewMode={viewMode}
          monitorFov={motionMonitorFov}
          onFinishedShotFovChange={setFinishedShotFov}
          onMonitorFovChange={setMotionMonitorFov}
        />
      ) : null}
      {activeCameraView && referenceVideoRendering ? (() => {
        const dimensions = getReferenceVideoDimensions(
          referenceVideoQuality,
          finishedShotAspectRatio
        );
        return (
          <div
            className="reference-video-renderer"
            style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px` }}
            aria-hidden="true"
          >
            <Canvas
              camera={{ fov: activeCameraView.fov, position: activeCameraView.position }}
              dpr={1}
              gl={{ antialias: true, preserveDrawingBuffer: true }}
              onCreated={({ gl }) => { referenceVideoCanvasRef.current = gl.domElement; }}
            >
              <ViewportBackground
                backgroundColor={sceneSettings.backgroundColor}
                backgroundBrightness={sceneSettings.backgroundBrightness}
                panoramaAsset={null}
                panoramaRadius={sceneSettings.panoramaRadius}
                panoramaYaw={sceneSettings.panoramaYaw}
              />
              <ambientLight intensity={1.15} />
              <directionalLight intensity={1.2} position={[8, 10, 6]} />
              <PlaybackCameraSync fovOverride={finishedShotFov} snapshot={activeCameraView} />
              <Suspense fallback={null}><SceneRoot renderMode="clean-camera" /></Suspense>
            </Canvas>
          </div>
        );
      })() : null}
      <ObjectMotionTransport />
      {isCameraPiloting ? (
        <PilotHud
          lockedTargetName={lockedPilotTargetName}
          mode={cameraPilotMode}
          onExit={stopPilotSession}
          onRecord={() => recordPilotSnapshot()}
          pointedTargetName={hoveredPilotTargetName}
        />
      ) : null}
    </div>
  );
}
