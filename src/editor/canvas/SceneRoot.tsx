import { Html, Line, TransformControls, type TransformControlsProps } from "@react-three/drei";
import { useLoader, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box3, Color, Matrix4, Quaternion, Vector3, type Group, type Object3D } from "three";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type {
  DirectorAssetRef,
  DirectorCameraShot,
  DirectorCameraMotionKeyframe,
  DirectorObject,
  DirectorObjectMotionKeyframe,
  GeometryPrimitiveType,
  SceneSettings,
} from "../schema/directorProject";
import { getCameraMotionPath, getCameraMotionSnapshot, sampleCameraMotionPath } from "../schema/cameraMotion";
import {
  getObjectMotionActionPresetId,
  getObjectMotionSnapshot,
  getObjectMotionSpeed,
  normalizeObjectMotionPath,
  sampleObjectMotionPath,
} from "../schema/objectMotion";
import { getAnimatedCameraFocusTarget } from "../schema/cameraTarget";
import { BuiltInLifeModel } from "../modelLibrary/BuiltInLifeModel";
import {
  VIEWPORT_CAMERA_ASPECT,
  VIEWPORT_CAMERA_FRUSTUM_DEPTH,
  VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH,
  VIEWPORT_CAMERA_VISUAL_SCALE,
} from "../schema/cameraGeometry";
import { VIEWPORT_OBJECT_LABEL_VERTICAL_GAP } from "../schema/viewportLabels";
import type { TransformMode } from "../store/directorStore";
import { useDirectorStore } from "../store/directorStore";
import { CharacterModel } from "../runtime/CharacterModel";
import { sampleCharacterActionControls } from "../presets/characterActionPresets";
import { getGroundedLabelY } from "../runtime/mannequin/bodyTypes";
import { constrainCameraPosition, constrainObjectMotionTransform } from "../schema/pathCollision";
import { getUE4GroundedLabelY } from "../runtime/ue4Mannequin/ue4MannequinRig";
import { getEffectiveGroundOpacity } from "./panoramaMath";
import { getCrowdAnchorTransform } from "../store/directorStore";

export { getEffectiveGroundOpacity, getPanoramaRotationRadians } from "./panoramaMath";

const VIEWPORT_CAMERA_LINE = "#A9D8FF";
const VIEWPORT_CAMERA_LINE_OPACITY = 0.92;
const VIEWPORT_CAMERA_HIT_PADDING = 0.06;
const VIEWPORT_CAMERA_FORWARD = new Vector3(0, 0, 1);
const VIEWPORT_CAMERA_WORLD_UP = new Vector3(0, 1, 0);
const HIDE_FROM_VIEWPORT_CAPTURE_KEY = "hideFromViewportCapture";
const AXIS_ONLY_GIZMO_MARKER = "axisOnlyGizmo";
const TRANSLATE_PLANE_NAMES = new Set(["XY", "YZ", "XZ"]);
type TransformControlsGizmoInternals = {
  gizmo: Record<string, Object3D>;
  picker: Record<string, Object3D>;
  updateMatrixWorld: () => void;
  userData: Record<string, unknown>;
};
type AxisOnlyTransformControls = {
  gizmo?: TransformControlsGizmoInternals;
};
const VIEWPORT_CAMERA_BODY_CENTER: CameraWirePoint = [0, 0, -0.52 * VIEWPORT_CAMERA_VISUAL_SCALE];
const VIEWPORT_CAMERA_BODY_SIZE: CameraWirePoint = [
  0.4 * VIEWPORT_CAMERA_VISUAL_SCALE,
  0.4 * VIEWPORT_CAMERA_VISUAL_SCALE,
  1 * VIEWPORT_CAMERA_VISUAL_SCALE,
];
const VIEWPORT_CAMERA_BODY_FRONT_Z = VIEWPORT_CAMERA_BODY_CENTER[2] + VIEWPORT_CAMERA_BODY_SIZE[2] / 2;
const VIEWPORT_CAMERA_LENS_TIP: CameraWirePoint = [0, 0, 0.2 * VIEWPORT_CAMERA_VISUAL_SCALE];
const ROLE_LABEL_DISTANCE_FACTOR = 3;
const IMPORTED_MODEL_TARGET_MAX_SIZE = 2;
type CameraWirePoint = [number, number, number];
type CameraWirePointLine = CameraWirePoint[];
type CameraWirePart = "body" | "lens" | "reel";
type CameraWireLine = {
  part: CameraWirePart;
  points: CameraWirePointLine;
};
type CameraHitArea = {
  args: CameraWirePoint;
  position: CameraWirePoint;
};

function ViewportObjectLabel({
  children,
  position,
}: {
  children: ReactNode;
  position: [number, number, number];
}) {
  return (
    <Html
      center
      distanceFactor={ROLE_LABEL_DISTANCE_FACTOR}
      pointerEvents="none"
      position={position}
      sprite
      transform
      zIndexRange={[0, 1]}
    >
      <div className="role-label">{children}</div>
    </Html>
  );
}

function ViewportTransformControls({
  mode,
  object,
  onObjectChange,
  translationSnap,
}: {
  mode: TransformMode;
  object: TransformControlsProps["object"];
  onObjectChange: TransformControlsProps["onObjectChange"];
  translationSnap?: number | null;
}) {
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const setControlsRef = useCallback((controls: TransformControlsImpl | null) => {
    controlsRef.current = controls;
    if (controls) {
      controls.userData[HIDE_FROM_VIEWPORT_CAPTURE_KEY] = true;
      const axisOnlyControls = controls as unknown as AxisOnlyTransformControls;
      const gizmo = axisOnlyControls.gizmo;
      if (!gizmo || gizmo.userData[AXIS_ONLY_GIZMO_MARKER]) return;

      const hideTranslatePlanes = () => {
        [gizmo.gizmo.translate, gizmo.picker.translate].forEach((group) => {
          group?.traverse((child: Object3D) => {
            if (TRANSLATE_PLANE_NAMES.has(child.name)) child.visible = false;
          });
        });
      };
      const updateGizmo = gizmo.updateMatrixWorld;
      gizmo.updateMatrixWorld = () => {
        updateGizmo();
        hideTranslatePlanes();
      };
      gizmo.userData[AXIS_ONLY_GIZMO_MARKER] = true;
      hideTranslatePlanes();
    }
  }, []);
  const beginUndoBatch = useDirectorStore((state) => state.beginUndoBatch);
  const endUndoBatch = useDirectorStore((state) => state.endUndoBatch);

  return (
    <TransformControls
      ref={setControlsRef}
      mode={mode}
      object={object}
      onMouseDown={beginUndoBatch}
      onMouseUp={endUndoBatch}
      onObjectChange={onObjectChange}
      translationSnap={translationSnap ?? undefined}
      userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
    />
  );
}

export function getViewportCameraQuaternion(
  position: [number, number, number],
  target: [number, number, number]
) {
  const origin = new Vector3(...position);
  const direction = new Vector3(...target).sub(origin);
  if (direction.lengthSq() === 0) return new Quaternion();

  const forward = direction.normalize();
  const up =
    Math.abs(forward.dot(VIEWPORT_CAMERA_WORLD_UP)) > 0.999
      ? new Vector3(0, 0, 1)
      : VIEWPORT_CAMERA_WORLD_UP;
  const matrix = new Matrix4().lookAt(origin, origin.clone().sub(forward), up);

  return new Quaternion().setFromRotationMatrix(matrix);
}

export function getViewportCameraOpaqueDepthRange() {
  const zValues = getViewportCameraBodyWireframeLines()
    .filter((line) => line.part !== "lens")
    .flatMap((line) => line.points)
    .map((point) => point[2]);

  return {
    minZ: Math.min(...zValues),
    maxZ: Math.max(...zValues),
  };
}

export function getViewportCameraLabelY() {
  const points = getViewportCameraBodyWireframeLines().flatMap((line) => line.points);
  const modelTopY = Math.max(...points.map((point) => point[1]));

  return modelTopY + VIEWPORT_OBJECT_LABEL_VERTICAL_GAP;
}

export function getImportedModelNormalization(bounds: Box3, targetMaxSize = IMPORTED_MODEL_TARGET_MAX_SIZE) {
  if (bounds.isEmpty()) {
    return {
      position: [0, 0, 0] as [number, number, number],
      scale: 1,
    };
  }

  const size = new Vector3();
  const center = new Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);

  const maxSize = Math.max(size.x, size.y, size.z);
  const scale = Number.isFinite(maxSize) && maxSize > 0 ? targetMaxSize / maxSize : 1;

  return {
    position: [-center.x * scale, -bounds.min.y * scale, -center.z * scale] as [number, number, number],
    scale,
  };
}

function createBoxWireframeLines({
  center,
  size,
}: {
  center: CameraWirePoint;
  size: CameraWirePoint;
}): CameraWirePointLine[] {
  const [cx, cy, cz] = center;
  const [width, height, depth] = size;
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  const z0 = cz - depth / 2;
  const z1 = cz + depth / 2;
  const corners: Record<string, CameraWirePoint> = {
    bbl: [x0, y0, z0],
    bbr: [x1, y0, z0],
    btl: [x0, y1, z0],
    btr: [x1, y1, z0],
    fbl: [x0, y0, z1],
    fbr: [x1, y0, z1],
    ftl: [x0, y1, z1],
    ftr: [x1, y1, z1],
  };

  return [
    [corners.bbl, corners.bbr],
    [corners.bbr, corners.btr],
    [corners.btr, corners.btl],
    [corners.btl, corners.bbl],
    [corners.fbl, corners.fbr],
    [corners.fbr, corners.ftr],
    [corners.ftr, corners.ftl],
    [corners.ftl, corners.fbl],
    [corners.bbl, corners.fbl],
    [corners.bbr, corners.fbr],
    [corners.btr, corners.ftr],
    [corners.btl, corners.ftl],
  ];
}

function createCircleWireframeLine({
  center,
  radius,
  segments = 32,
  plane = "xy",
}: {
  center: CameraWirePoint;
  radius: number;
  segments?: number;
  plane?: "xy" | "xz" | "yz";
}): CameraWirePointLine {
  const [cx, cy, cz] = center;
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / segments;
    const a = Math.cos(angle) * radius;
    const b = Math.sin(angle) * radius;

    if (plane === "xz") return [cx + a, cy, cz + b];
    if (plane === "yz") return [cx, cy + a, cz + b];

    return [cx + a, cy + b, cz];
  });
}

function createInvertedTetrahedronLensWireframeLines(): CameraWirePointLine[] {
  const backTopLeft: CameraWirePoint = [
    -0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_BODY_FRONT_Z,
  ];
  const backTopRight: CameraWirePoint = [
    0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_BODY_FRONT_Z,
  ];
  const backBottomRight: CameraWirePoint = [
    0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    -0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_BODY_FRONT_Z,
  ];
  const backBottomLeft: CameraWirePoint = [
    -0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    -0.10 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_BODY_FRONT_Z,
  ];

  const frontTopLeft: CameraWirePoint = [
    -0.25 * VIEWPORT_CAMERA_VISUAL_SCALE,
    0.2 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_LENS_TIP[2],
  ];
  const frontTopRight: CameraWirePoint = [
    0.25 * VIEWPORT_CAMERA_VISUAL_SCALE,
    0.2 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_LENS_TIP[2],
  ];
  const frontBottomRight: CameraWirePoint = [
    0.25 * VIEWPORT_CAMERA_VISUAL_SCALE,
    -0.2 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_LENS_TIP[2],
  ];
  const frontBottomLeft: CameraWirePoint = [
    -0.25 * VIEWPORT_CAMERA_VISUAL_SCALE,
    -0.2 * VIEWPORT_CAMERA_VISUAL_SCALE,
    VIEWPORT_CAMERA_LENS_TIP[2],
  ];

  return [
    [backTopLeft, backTopRight, backBottomRight, backBottomLeft, backTopLeft],
    [frontTopLeft, frontTopRight, frontBottomRight, frontBottomLeft, frontTopLeft],

    [backTopLeft, frontTopLeft],
    [backTopRight, frontTopRight],
    [backBottomRight, frontBottomRight],
    [backBottomLeft, frontBottomLeft],

  ];
}
function withCameraPart(part: CameraWirePart, lines: CameraWirePointLine[]): CameraWireLine[] {
  return lines.map((points) => ({ part, points }));
}

export function getViewportCameraBodyWireframeLines(): CameraWireLine[] {
  return [
    ...withCameraPart("body", [
      ...createBoxWireframeLines({ center: VIEWPORT_CAMERA_BODY_CENTER, size: VIEWPORT_CAMERA_BODY_SIZE }),
    ]),
    ...withCameraPart("lens", createInvertedTetrahedronLensWireframeLines()),
    ...withCameraPart("reel", [
      createCircleWireframeLine({
        center: [0, 0.44 * VIEWPORT_CAMERA_VISUAL_SCALE, -0.78 * VIEWPORT_CAMERA_VISUAL_SCALE],
        radius: 0.21 * VIEWPORT_CAMERA_VISUAL_SCALE,
        plane: "yz",
      }),
      createCircleWireframeLine({
        center: [0, 0.44 * VIEWPORT_CAMERA_VISUAL_SCALE, -0.34 * VIEWPORT_CAMERA_VISUAL_SCALE],
        radius: 0.21 * VIEWPORT_CAMERA_VISUAL_SCALE,
        plane: "yz",
      }),
    ]),
  ];
}

export function getViewportCameraHitArea(): CameraHitArea {
  const points = getViewportCameraBodyWireframeLines().flatMap((line) => line.points);
  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));
  const minY = Math.min(...points.map((point) => point[1]));
  const maxY = Math.max(...points.map((point) => point[1]));
  const minZ = Math.min(...points.map((point) => point[2]));
  const maxZ = Math.max(...points.map((point) => point[2]));

  return {
    args: [
      maxX - minX + VIEWPORT_CAMERA_HIT_PADDING * 2,
      maxY - minY + VIEWPORT_CAMERA_HIT_PADDING * 2,
      maxZ - minZ + VIEWPORT_CAMERA_HIT_PADDING * 2,
    ],
    position: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

function NormalizedImportedObject({ object }: { object: Object3D }) {
  const { clone, normalization } = useMemo(() => {
    const clonedObject = object.clone(true);
    clonedObject.updateMatrixWorld(true);

    return {
      clone: clonedObject,
      normalization: getImportedModelNormalization(new Box3().setFromObject(clonedObject)),
    };
  }, [object]);

  return (
    <group
      position={normalization.position}
      scale={[normalization.scale, normalization.scale, normalization.scale]}
    >
      <primitive object={clone} />
    </group>
  );
}

function FbxModel({ url }: { url: string }) {
  const object = useLoader(FBXLoader, url);

  return <NormalizedImportedObject object={object} />;
}

function ObjModel({ url }: { url: string }) {
  const object = useLoader(OBJLoader, url);

  return <NormalizedImportedObject object={object} />;
}

function ImportedModel({
  fileName,
  url,
}: {
  fileName: string;
  url: string;
}) {
  if (url.startsWith("builtin://life/")) return <BuiltInLifeModel modelId={fileName} />;
  if (/\.fbx$/i.test(fileName)) return <FbxModel url={url} />;
  if (/\.obj$/i.test(fileName)) return <ObjModel url={url} />;
  return null;
}

function GeometryPrimitiveModel({
  color = "#d7e7ff",
  geometryType,
}: {
  color?: string;
  geometryType: GeometryPrimitiveType;
}) {
  const material = <meshStandardMaterial color={color} metalness={0.02} roughness={0.68} />;

  if (geometryType === "sphere") {
    return (
      <mesh name="geometry-sphere" position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.55, 32, 16]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "cylinder") {
    return (
      <mesh name="geometry-cylinder" position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 1.2, 32]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "torus") {
    return (
      <mesh name="geometry-torus" position={[0, 0.14, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.45, 0.14, 16, 48]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "cone") {
    return (
      <mesh name="geometry-cone" position={[0, 0.55, 0]}>
        <coneGeometry args={[0.5, 1.1, 32]} />
        {material}
      </mesh>
    );
  }

  if (geometryType === "pyramid") {
    return (
      <mesh name="geometry-pyramid" position={[0, 0.55, 0]}>
        <coneGeometry args={[0.55, 1.1, 4]} />
        {material}
      </mesh>
    );
  }

  return (
    <mesh name="geometry-box" position={[0, 0.5, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      {material}
    </mesh>
  );
}

function ObjectSceneNode({
  asset,
  item,
  selected,
  showLabels,
  transformMode,
  transformable,
  translationSnap,
  onSelect,
  motionPhase = 0,
  motionWalking = false,
  motionTimeSeconds = 0,
  motionProgress = 0,
}: {
  asset?: DirectorAssetRef;
  item: DirectorObject;
  selected: boolean;
  showLabels: boolean;
  transformMode: TransformMode;
  transformable: boolean;
  translationSnap: number | null;
  onSelect?: (item: DirectorObject) => void;
  motionPhase?: number;
  motionWalking?: boolean;
  motionTimeSeconds?: number;
  motionProgress?: number;
}) {
  const groupRef = useRef<Group>(null!);
  const [measuredCharacterLabel, setMeasuredCharacterLabel] = useState<{
    key: string;
    y: number;
  } | null>(null);
  const updateObjectTransform = useDirectorStore((state) => state.updateObjectTransform);
  const pilotHoveredTargetId = useDirectorStore((state) => state.cameraPilotHoveredTargetId);
  const pilotLockedTargetId = useDirectorStore((state) => state.cameraPilotLockedTargetId);
  const isImportedModel = asset?.sourceType === "model";
  const characterLabelKey = `${item.id}:${item.bodyType ?? ""}:${item.characterRig?.rigType ?? ""}`;
  const fallbackCharacterLabelY =
    item.kind === "character"
      ? item.characterRig?.rigType === "ue4-mannequin"
        ? getUE4GroundedLabelY(item.bodyType)
        : getGroundedLabelY(item.bodyType)
      : 1.25;
  const characterLabelY =
    measuredCharacterLabel?.key === characterLabelKey ? measuredCharacterLabel.y : fallbackCharacterLabelY;
  const focusOffsetY = item.kind === "character" ? Math.max(0.8, characterLabelY * 0.58) : 0.75;
  const pilotTargetState = pilotLockedTargetId === item.id ? "locked" : pilotHoveredTargetId === item.id ? "hovered" : null;
  const animatedCharacterRig = useMemo(() => {
    if (!item.characterRig) return item.characterRig;
    const actionPresetId = getObjectMotionActionPresetId(item, motionProgress);
    if (actionPresetId) {
      return {
        ...item.characterRig,
        controls: sampleCharacterActionControls(
          actionPresetId,
          motionTimeSeconds,
          item.characterRig.controls
        ),
      };
    }
    if (!motionWalking) return item.characterRig;
    const stride = Math.sin(motionPhase) * 28;
    const leftKnee = Math.max(0, Math.sin(motionPhase + Math.PI / 2)) * 24;
    const rightKnee = Math.max(0, Math.sin(motionPhase - Math.PI / 2)) * 24;
    return {
      ...item.characterRig,
      controls: {
        ...item.characterRig.controls,
        "body.offsetY": (item.characterRig.controls["body.offsetY"] ?? 0) + Math.abs(Math.cos(motionPhase)) * 0.025,
        "body.pitch": (item.characterRig.controls["body.pitch"] ?? 0) - 3,
        "leftShoulder.pitch": -stride * 0.72,
        "rightShoulder.pitch": stride * 0.72,
        "leftHip.pitch": stride,
        "rightHip.pitch": -stride,
        "leftKnee.bend": leftKnee,
        "rightKnee.bend": rightKnee,
      },
    };
  }, [item, motionPhase, motionProgress, motionTimeSeconds, motionWalking]);
  const handleCharacterLabelAnchorYChange = useCallback(
    (anchorY: number) => {
      setMeasuredCharacterLabel((current) => {
        const nextY = Number(anchorY.toFixed(4));

        if (current?.key === characterLabelKey && Math.abs(current.y - nextY) < 0.0001) {
          return current;
        }

        return {
          key: characterLabelKey,
          y: nextY,
        };
      });
    },
    [characterLabelKey]
  );

  function commitTransformFromViewport() {
    const group = groupRef.current;
    if (!group) return;

    updateObjectTransform(item.id, {
      position: [group.position.x, group.position.y, group.position.z],
      rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
      scale: [group.scale.x, group.scale.y, group.scale.z],
    });
  }

  const node = (
    <group
      ref={groupRef}
      name={`director-object-${item.id}`}
      position={item.transform.position}
      rotation={item.transform.rotation}
      scale={item.transform.scale}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(item);
      }}
      userData={{
        directorObjectId: item.id,
        directorObjectName: item.name,
        directorFocusOffset: [0, focusOffsetY, 0],
      }}
    >
      {pilotTargetState ? (
        <group position={[0, focusOffsetY, 0]} userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.62, 0.68, 40]} />
            <meshBasicMaterial color={pilotTargetState === "locked" ? "#4ADE80" : "#F7B955"} depthTest={false} transparent opacity={0.95} />
          </mesh>
          <ViewportObjectLabel position={[0, 0.42, 0]}>
            {pilotTargetState === "locked" ? `已锁定 · ${item.name}` : `${item.name} · F 锁定`}
          </ViewportObjectLabel>
        </group>
      ) : null}
      {item.kind === "character" ? (
        <>
          <Suspense fallback={null}>
            <CharacterModel
              assetUrl={isImportedModel ? asset?.url : undefined}
              bodyType={item.bodyType}
              color={item.color}
              motionWalking={motionWalking}
              onLabelAnchorYChange={handleCharacterLabelAnchorYChange}
              rigState={animatedCharacterRig}
            />
          </Suspense>
          {showLabels ? (
            <ViewportObjectLabel position={[0, characterLabelY, 0]}>{item.name}</ViewportObjectLabel>
          ) : null}
        </>
      ) : isImportedModel && asset ? (
        <Suspense fallback={null}>
          <ImportedModel fileName={asset.fileName} url={asset.url} />
        </Suspense>
      ) : item.kind === "prop" && item.geometryType ? (
        <GeometryPrimitiveModel color={item.color} geometryType={item.geometryType} />
      ) : null}
    </group>
  );

  if (!selected || !transformable) return node;

  return (
    <>
      {node}
      <ViewportTransformControls
        mode={transformMode}
        object={groupRef}
        onObjectChange={commitTransformFromViewport}
        translationSnap={transformMode === "translate" ? translationSnap : null}
      />
    </>
  );
}

function CrowdTransformRig({
  crowdId,
  objects,
  selected,
  transformMode,
  transformable,
  translationSnap,
}: {
  crowdId: string;
  objects: DirectorObject[];
  selected: boolean;
  transformMode: TransformMode;
  transformable: boolean;
  translationSnap: number | null;
}) {
  const groupRef = useRef<Group>(null!);
  const updateCrowdTransform = useDirectorStore((state) => state.updateCrowdTransform);
  const crowdAnchor = useMemo(() => getCrowdAnchorTransform(objects, crowdId), [objects, crowdId]);

  function commitCrowdTransformFromViewport() {
    const group = groupRef.current;
    if (!group) return;

    updateCrowdTransform(crowdId, {
      position: [group.position.x, group.position.y, group.position.z],
      rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
      scale: [group.scale.x, group.scale.y, group.scale.z],
    });
  }

  if (!selected || !transformable || !crowdAnchor) return null;

  return (
    <>
      <group
        ref={groupRef}
        position={crowdAnchor.position}
        rotation={crowdAnchor.rotation}
        scale={crowdAnchor.scale}
      />
      <ViewportTransformControls
        mode={transformMode}
        object={groupRef}
        onObjectChange={commitCrowdTransformFromViewport}
        translationSnap={transformMode === "translate" ? translationSnap : null}
      />
    </>
  );
}

export function getViewportCameraFrustumLines(
  _camera: DirectorCameraShot
): Array<[[number, number, number], [number, number, number]]> {
  const frameDepth = VIEWPORT_CAMERA_FRUSTUM_DEPTH;
  const halfWidth = VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH / 2;
  const halfHeight = VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH / VIEWPORT_CAMERA_ASPECT / 2;
  const topLeft: [number, number, number] = [-halfWidth, halfHeight, frameDepth];
  const topRight: [number, number, number] = [halfWidth, halfHeight, frameDepth];
  const bottomRight: [number, number, number] = [halfWidth, -halfHeight, frameDepth];
  const bottomLeft: [number, number, number] = [-halfWidth, -halfHeight, frameDepth];

  return [
    [VIEWPORT_CAMERA_LENS_TIP, topLeft],
    [VIEWPORT_CAMERA_LENS_TIP, topRight],
    [VIEWPORT_CAMERA_LENS_TIP, bottomRight],
    [VIEWPORT_CAMERA_LENS_TIP, bottomLeft],
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ];
}

function ViewportCameraRig({
  camera,
  object,
  selected,
  showLabel,
  transformMode,
  transformable,
  translationSnap,
}: {
  camera: DirectorCameraShot;
  object?: DirectorObject;
  selected: boolean;
  showLabel: boolean;
  transformMode: TransformMode;
  transformable: boolean;
  translationSnap: number | null;
}) {
  const groupRef = useRef<Group>(null!);
  const selectObject = useDirectorStore((state) => state.selectObject);
  const updateCamera = useDirectorStore((state) => state.updateCamera);
  const bodyWireframeLines = useMemo(() => getViewportCameraBodyWireframeLines(), []);
  const cameraHitArea = useMemo(() => getViewportCameraHitArea(), []);
  const cameraLabelY = useMemo(() => getViewportCameraLabelY(), []);
  const frustumLines = useMemo(() => getViewportCameraFrustumLines(camera), [camera]);
  const cameraQuaternion = useMemo(
    () => getViewportCameraQuaternion(camera.transform.position, camera.target),
    [camera.target, camera.transform.position]
  );

  useLayoutEffect(() => {
    groupRef.current?.quaternion?.copy?.(cameraQuaternion);
  }, [cameraQuaternion]);

  function commitCameraTransformFromViewport() {
    const group = groupRef.current;
    if (!group) return;

    const position: [number, number, number] = [group.position.x, group.position.y, group.position.z];
    const forward = VIEWPORT_CAMERA_FORWARD.clone().applyQuaternion(group.quaternion).normalize();
    const currentDistance = new Vector3(...camera.target).distanceTo(group.position);
    const nextTarget = group.position.clone().add(forward.multiplyScalar(Math.max(currentDistance, 0.1)));

    updateCamera(camera.id, {
      transform: {
        position,
        rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
        scale: [group.scale.x, group.scale.y, group.scale.z],
      },
      target: [nextTarget.x, nextTarget.y, nextTarget.z],
    });
  }

  function selectCameraFromViewport(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    selectObject(object?.id ?? null);
  }

  const node = (
    <group
      ref={groupRef}
      position={camera.transform.position}
      quaternion={cameraQuaternion}
      scale={object?.transform.scale ?? [1, 1, 1]}
      userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
      onClick={selectCameraFromViewport}
    >
      {showLabel ? (
        <ViewportObjectLabel position={[0, cameraLabelY, 0]}>{camera.name}</ViewportObjectLabel>
      ) : null}

      <mesh name={`${camera.id}-hit-area`} onClick={selectCameraFromViewport} position={cameraHitArea.position}>
        <boxGeometry args={cameraHitArea.args} />
        <meshBasicMaterial depthWrite={false} opacity={0} transparent />
      </mesh>

      {bodyWireframeLines.map((line, index) => (
        <Line
          key={`${camera.id}-${line.part}-${index}`}
          color={VIEWPORT_CAMERA_LINE}
          lineWidth={1}
          name={`${camera.id}-${line.part}-${index}`}
          onClick={selectCameraFromViewport}
          opacity={VIEWPORT_CAMERA_LINE_OPACITY}
          points={line.points}
          transparent
        />
      ))}

      {frustumLines.map((points, index) => (
        <Line
          key={`${camera.id}-frustum-${index}`}
          color={VIEWPORT_CAMERA_LINE}
          lineWidth={1}
          name={`${camera.id}-viewfinder-${index}`}
          onClick={selectCameraFromViewport}
          opacity={VIEWPORT_CAMERA_LINE_OPACITY}
          points={points}
          transparent
        />
      ))}
    </group>
  );

  if (!selected || !transformable) return node;

  return (
    <>
      {node}
      <ViewportTransformControls
        mode={transformMode}
        object={groupRef}
        onObjectChange={commitCameraTransformFromViewport}
        translationSnap={transformMode === "translate" ? translationSnap : null}
      />
    </>
  );
}

function CameraMotionKeyframeHandle({
  cameraId,
  keyframe,
  index,
  selected,
  showTransformControls,
  simpleLabel,
  playbackState,
  translationSnap,
}: {
  cameraId: string;
  keyframe: DirectorCameraMotionKeyframe;
  index: number;
  selected: boolean;
  showTransformControls: boolean;
  simpleLabel: boolean;
  playbackState: "idle" | "reached" | "approaching";
  translationSnap: number | null;
}) {
  const groupRef = useRef<Group>(null!);
  const selectCameraMotionKeyframe = useDirectorStore((state) => state.selectCameraMotionKeyframe);
  const updateCameraMotionKeyframe = useDirectorStore((state) => state.updateCameraMotionKeyframe);
  const setCameraMotionProgress = useDirectorStore((state) => state.setCameraMotionProgress);

  function selectKeyframe(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    selectCameraMotionKeyframe(keyframe.id);
    setCameraMotionProgress(keyframe.time);
  }

  function commitKeyframePosition() {
    const group = groupRef.current;
    if (!group) return;
    updateCameraMotionKeyframe(cameraId, keyframe.id, {
      position: [group.position.x, group.position.y, group.position.z],
    });
  }

  const node = (
    <group
      ref={groupRef}
      position={keyframe.position}
      onClick={selectKeyframe}
      userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
    >
      <mesh name={`${keyframe.id}-motion-handle`} onClick={selectKeyframe}>
        <sphereGeometry args={[selected || playbackState !== "idle" ? 0.17 : 0.13, 20, 14]} />
        <meshBasicMaterial
          color={playbackState === "reached" ? "#FFD08A" : playbackState === "approaching" ? "#FFF1C7" : selected ? "#FFD09A" : "#F5A65B"}
          depthTest={false}
        />
      </mesh>
      {playbackState === "approaching" ? (
        <mesh name={`${keyframe.id}-approaching-pulse`}>
          <sphereGeometry args={[0.26, 20, 14]} />
          <meshBasicMaterial color="#FFD08A" depthTest={false} opacity={0.22} transparent />
        </mesh>
      ) : null}
      <ViewportObjectLabel position={[0, 0.34, 0]}>
        <span className={`camera-motion-point-label is-${playbackState}`}>{simpleLabel ? index + 1 : `K${index + 1}`}</span>
      </ViewportObjectLabel>
    </group>
  );

  if (!showTransformControls) return node;

  return (
    <>
      {node}
      <ViewportTransformControls
        mode="translate"
        object={groupRef}
        onObjectChange={commitKeyframePosition}
        translationSnap={translationSnap}
      />
    </>
  );
}

function CameraMotionSelectionTransform({
  cameraId,
  keyframes,
  translationSnap,
}: {
  cameraId: string;
  keyframes: DirectorCameraMotionKeyframe[];
  translationSnap: number | null;
}) {
  const groupRef = useRef<Group>(null!);
  const translateSelectedCameraMotionKeyframes = useDirectorStore(
    (state) => state.translateSelectedCameraMotionKeyframes
  );
  const center = useMemo<[number, number, number]>(() => {
    if (keyframes.length === 0) return [0, 0, 0];
    const sum = keyframes.reduce(
      (result, keyframe) => [
        result[0] + keyframe.position[0],
        result[1] + keyframe.position[1],
        result[2] + keyframe.position[2],
      ] as [number, number, number],
      [0, 0, 0] as [number, number, number]
    );
    return [sum[0] / keyframes.length, sum[1] / keyframes.length, sum[2] / keyframes.length];
  }, [keyframes]);
  const lastCommittedPositionRef = useRef(new Vector3(...center));

  useLayoutEffect(() => {
    const nextCenter = new Vector3(...center);
    groupRef.current?.position?.copy?.(nextCenter);
    lastCommittedPositionRef.current.copy(nextCenter);
  }, [center]);

  function commitSelectionPosition() {
    const group = groupRef.current;
    if (!group) return;
    const lastPosition = lastCommittedPositionRef.current;
    const offset: [number, number, number] = [
      group.position.x - lastPosition.x,
      group.position.y - lastPosition.y,
      group.position.z - lastPosition.z,
    ];
    if (offset.every((value) => Math.abs(value) <= 0.000001)) return;
    lastPosition.copy(group.position);
    translateSelectedCameraMotionKeyframes(cameraId, offset);
  }

  if (keyframes.length < 2) return null;

  return (
    <>
      <group
        ref={groupRef}
        name="camera-motion-multi-selection"
        position={center}
        userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
      >
        <ViewportObjectLabel position={[0, 0.48, 0]}>已选 {keyframes.length} 个轨迹点</ViewportObjectLabel>
      </group>
      <ViewportTransformControls
        mode="translate"
        object={groupRef}
        onObjectChange={commitSelectionPosition}
        translationSnap={translationSnap}
      />
    </>
  );
}

function CameraMotionPathRig({ camera, scene, translationSnap }: { camera: DirectorCameraShot; scene: SceneSettings; translationSnap: number | null }) {
  const selectedCameraKeyframeId = useDirectorStore((state) => state.selectedCameraKeyframeId);
  const selectedCameraKeyframeIds = useDirectorStore((state) => state.selectedCameraKeyframeIds);
  const cameraMotionProgress = useDirectorStore((state) => state.cameraMotionProgress);
  const cameraMotionPlaying = useDirectorStore((state) => state.cameraMotionPlaying);
  const motionStudioOpen = useDirectorStore((state) => state.motionStudioOpen);
  const objects = useDirectorStore((state) => state.project.objects);
  const motionPath = useMemo(() => getCameraMotionPath(camera), [camera]);
  const effectiveSelectedIds = selectedCameraKeyframeIds.length > 0
    ? selectedCameraKeyframeIds
    : selectedCameraKeyframeId
      ? [selectedCameraKeyframeId]
      : [];
  const selectedIdSet = useMemo(() => new Set(effectiveSelectedIds), [effectiveSelectedIds]);
  const selectedKeyframes = useMemo(
    () => motionPath.keyframes.filter((keyframe) => selectedIdSet.has(keyframe.id)),
    [motionPath.keyframes, selectedIdSet]
  );
  const points = useMemo(
    () => sampleCameraMotionPath(camera, 80).map((position) => constrainCameraPosition(position, scene, objects)),
    [camera, objects, scene]
  );
  const timelinePreviewActive = cameraMotionPlaying || cameraMotionProgress > 0.0001;
  const activeIndex = useMemo(() => {
    if (motionPath.keyframes.length === 0) return -1;
    let index = 0;
    for (let cursor = 1; cursor < motionPath.keyframes.length; cursor += 1) {
      if (cameraMotionProgress + 0.0001 < motionPath.keyframes[cursor].time) break;
      index = cursor;
    }
    return index;
  }, [cameraMotionProgress, motionPath.keyframes]);
  const activeSegmentPoints = useMemo(() => {
    const pathStart = motionPath.keyframes[0]?.time ?? 0;
    const pathEnd = Math.max(pathStart, cameraMotionProgress);
    if (!timelinePreviewActive || activeIndex < 0 || pathEnd - pathStart <= 0.0001) return [];
    const sampleCount = Math.max(2, Math.ceil((pathEnd - pathStart) * 80));
    return Array.from({ length: sampleCount }, (_, index) => {
      const progress = pathStart + (pathEnd - pathStart) * (index / (sampleCount - 1));
      return constrainCameraPosition(getCameraMotionSnapshot(camera, progress).position, scene, objects);
    });
  }, [activeIndex, camera, cameraMotionProgress, motionPath.keyframes, objects, scene, timelinePreviewActive]);
  const playhead = useMemo(() => {
    if (!timelinePreviewActive) return null;
    const rawSnapshot = getCameraMotionSnapshot(camera, cameraMotionProgress);
    const snapshot = { ...rawSnapshot, position: constrainCameraPosition(rawSnapshot.position, scene, objects) };
    const trackingTarget = getAnimatedCameraFocusTarget(camera, objects, cameraMotionProgress);
    return trackingTarget ? { ...snapshot, target: trackingTarget } : snapshot;
  }, [camera, cameraMotionProgress, objects, scene, timelinePreviewActive]);
  if (motionPath.keyframes.length === 0) return null;

  return (
    <group userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}>
      {points.length >= 2 ? (
        <Line
          color="#F5A65B"
          lineWidth={2}
          opacity={0.92}
          points={points}
          transparent
          userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
        />
      ) : null}
      {activeSegmentPoints.length >= 2 ? (
        <Line
          color="#FFD08A"
          lineWidth={5}
          name="camera-motion-active-segment"
          opacity={0.96}
          points={activeSegmentPoints}
          transparent
          userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
        />
      ) : null}
      {motionPath.keyframes.map((keyframe, index) => (
        <CameraMotionKeyframeHandle
          key={keyframe.id}
          cameraId={camera.id}
          index={index}
          keyframe={keyframe}
          playbackState={
            timelinePreviewActive
              ? index <= activeIndex
                ? "reached"
                : index === activeIndex + 1
                  ? "approaching"
                  : "idle"
              : "idle"
          }
          selected={selectedIdSet.has(keyframe.id)}
          showTransformControls={selectedKeyframes.length === 1 && selectedCameraKeyframeId === keyframe.id}
          simpleLabel={motionStudioOpen}
          translationSnap={translationSnap}
        />
      ))}
      <CameraMotionSelectionTransform
        cameraId={camera.id}
        keyframes={selectedKeyframes}
        translationSnap={translationSnap}
      />
      {playhead ? (
        <group
          name="camera-motion-playhead"
          position={playhead.position}
          userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
        >
          <mesh>
            <sphereGeometry args={[0.12, 20, 14]} />
            <meshBasicMaterial color="#FFFFFF" depthTest={false} />
          </mesh>
          <Line
            color="#FFFFFF"
            lineWidth={2}
            name="camera-motion-playhead-direction"
            opacity={0.72}
            points={[
              [0, 0, 0],
              [
                playhead.target[0] - playhead.position[0],
                playhead.target[1] - playhead.position[1],
                playhead.target[2] - playhead.position[2],
              ],
            ]}
            transparent
          />
        </group>
      ) : null}
    </group>
  );
}

function CharacterRoutePointHandle({
  characterId,
  keyframe,
  index,
  selected,
  translationSnap,
  transformMode,
}: {
  characterId: string;
  keyframe: DirectorObjectMotionKeyframe;
  index: number;
  selected: boolean;
  translationSnap: number | null;
  transformMode: TransformMode;
}) {
  const groupRef = useRef<Group>(null!);
  const selectObject = useDirectorStore((state) => state.selectObject);
  const selectObjectMotionKeyframe = useDirectorStore((state) => state.selectObjectMotionKeyframe);
  const updateObjectMotionKeyframe = useDirectorStore((state) => state.updateObjectMotionKeyframe);

  function selectPoint(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    selectObject(characterId);
    selectObjectMotionKeyframe(keyframe.id);
  }

  function commitTransform() {
    const group = groupRef.current;
    if (!group) return;
    updateObjectMotionKeyframe(characterId, keyframe.id, {
      transform: {
        position: [group.position.x, group.position.y, group.position.z],
        rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
        scale: keyframe.transform.scale,
      },
    });
  }

  const node = (
    <group
      ref={groupRef}
      position={keyframe.transform.position}
      rotation={keyframe.transform.rotation}
      onClick={selectPoint}
      userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}
    >
      <mesh name={`${keyframe.id}-character-route-handle`} onClick={selectPoint}>
        <sphereGeometry args={[selected ? 0.2 : 0.15, 20, 14]} />
        <meshBasicMaterial color={selected ? "#B9F7D0" : "#4ADE80"} depthTest={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <ringGeometry args={[selected ? 0.25 : 0.2, selected ? 0.29 : 0.24, 24]} />
        <meshBasicMaterial color="#4ADE80" depthTest={false} transparent opacity={0.8} />
      </mesh>
      <ViewportObjectLabel position={[0, 0.38, 0]}>
        <span className="camera-motion-point-label">{index + 1}</span>
      </ViewportObjectLabel>
    </group>
  );

  if (!selected) return node;
  return (
    <>
      {node}
      <ViewportTransformControls
        mode={transformMode}
        object={groupRef}
        onObjectChange={commitTransform}
        translationSnap={translationSnap}
      />
    </>
  );
}

function CharacterRouteRig({
  character,
  progress,
  playing,
  showHandles = true,
  scene,
  objects,
  transformMode,
  translationSnap,
}: {
  character: DirectorObject;
  progress: number;
  playing: boolean;
  showHandles?: boolean;
  scene: SceneSettings;
  objects: DirectorObject[];
  transformMode: TransformMode;
  translationSnap: number | null;
}) {
  const selectedObjectMotionKeyframeId = useDirectorStore((state) => state.selectedObjectMotionKeyframeId);
  const path = useMemo(
    () => normalizeObjectMotionPath(character.motionPath, character.transform),
    [character.motionPath, character.transform]
  );
  const activeIndex = useMemo(() => {
    let index = 0;
    while (index < path.keyframes.length - 2 && progress >= path.keyframes[index + 1].time) index += 1;
    return index;
  }, [path.keyframes, progress]);
  const activePoints = useMemo(() => {
    if (!playing || path.keyframes.length < 2) return [];
    const end = Math.max(path.keyframes[0].time, progress);
    const count = Math.max(2, Math.ceil(end * 60));
    return Array.from({ length: count }, (_, index) =>
      constrainObjectMotionTransform(
        character,
        getObjectMotionSnapshot(character, (end * index) / (count - 1)),
        scene,
        objects
      ).position
    );
  }, [character, objects, path.keyframes, playing, progress, scene]);
  const routePoints = useMemo(
    () => sampleObjectMotionPath(character, 96).map((position) =>
      constrainObjectMotionTransform(character, { ...character.transform, position }, scene, objects).position
    ),
    [character, objects, scene]
  );

  if (path.keyframes.length === 0) return null;
  return (
    <group userData={{ [HIDE_FROM_VIEWPORT_CAPTURE_KEY]: true }}>
      {routePoints.length >= 2 ? (
        <Line color="#4ADE80" lineWidth={2} opacity={0.9} points={routePoints} transparent />
      ) : null}
      {activePoints.length >= 2 ? (
        <Line color="#D4FFE0" lineWidth={5} opacity={0.96} points={activePoints} transparent />
      ) : null}
      {showHandles ? path.keyframes.map((keyframe, index) => (
        <CharacterRoutePointHandle
          key={keyframe.id}
          characterId={character.id}
          index={index}
          keyframe={keyframe}
          selected={selectedObjectMotionKeyframeId === keyframe.id}
          transformMode={transformMode}
          translationSnap={translationSnap}
        />
      )) : null}
      {playing && path.keyframes.length >= 2 ? (
        <group position={getObjectMotionSnapshot(character, progress).position}>
          <mesh>
            <sphereGeometry args={[0.11, 18, 12]} />
            <meshBasicMaterial color="#FFFFFF" depthTest={false} />
          </mesh>
          <ViewportObjectLabel position={[0, 0.31, 0]}>进行中：{activeIndex + 1}</ViewportObjectLabel>
        </group>
      ) : null}
    </group>
  );
}

export type SceneRootRenderMode = "interactive" | "director-monitor" | "clean-camera";

export function SceneRoot({ renderMode = "interactive" }: { renderMode?: SceneRootRenderMode }) {
  const scene = useDirectorStore((state) => state.project.scene);
  const assets = useDirectorStore((state) => state.project.assets);
  const objects = useDirectorStore((state) => state.project.objects);
  const cameras = useDirectorStore((state) => state.project.cameras);
  const viewMode = useDirectorStore((state) => state.viewMode);
  const selectedObjectId = useDirectorStore((state) => state.selectedObjectId);
  const selectedCameraKeyframeId = useDirectorStore((state) => state.selectedCameraKeyframeId);
  const selectedObjectMotionKeyframeId = useDirectorStore((state) => state.selectedObjectMotionKeyframeId);
  const motionStudioOpen = useDirectorStore((state) => state.motionStudioOpen);
  const cameraPilotMode = useDirectorStore((state) => state.cameraPilotMode);
  const activeCameraId = useDirectorStore((state) => state.project.activeCameraId);
  const cameraMotionProgress = useDirectorStore((state) => state.cameraMotionProgress);
  const cameraMotionPlaying = useDirectorStore((state) => state.cameraMotionPlaying);
  const selectedCrowdId = useDirectorStore((state) => state.selectedCrowdId);
  const transformMode = useDirectorStore((state) => state.transformMode);
  const showCharacterRoutes = useDirectorStore((state) => state.showCharacterRoutes);
  const selectObject = useDirectorStore((state) => state.selectObject);
  const selectCrowd = useDirectorStore((state) => state.selectCrowd);
  const interactive = renderMode === "interactive";
  const effectiveViewMode = renderMode === "clean-camera" ? "camera" : renderMode === "director-monitor" ? "director" : viewMode;
  const translationSnap = scene.snapToGrid ? 1 : null;
  const groundColor = useMemo(
    () => `#${new Color(scene.groundColor).multiplyScalar(Math.max(0, scene.groundBrightness)).getHexString()}`,
    [scene.groundBrightness, scene.groundColor]
  );
  const assetsById = useMemo(() => new Map(assets.map((item) => [item.id, item])), [assets]);
  const cameraObjectsByCameraId = useMemo(() => {
    return new Map(
      objects
        .filter((item) => item.kind === "camera" && item.linkedCameraId)
        .map((item) => [item.linkedCameraId as string, item])
    );
  }, [objects]);
  const activeMotionDuration = useMemo(() => {
    const camera = cameras.find((item) => item.id === activeCameraId) ?? cameras[0];
    return camera ? getCameraMotionPath(camera).duration : 6;
  }, [activeCameraId, cameras]);
  const crowdLocksById = useMemo(() => {
    const result = new Map<string, boolean>();
    const crowdMembers = objects.filter((item) => item.kind === "character" && item.crowdId);

    crowdMembers.forEach((item) => {
      const crowdId = item.crowdId as string;
      result.set(crowdId, (result.get(crowdId) ?? false) || item.locked);
    });

    return result;
  }, [objects]);

  function handleObjectSelect(item: DirectorObject) {
    if (item.kind === "character" && item.crowdId) {
      selectCrowd(item.crowdId);
      return;
    }

    selectObject(item.id);
  }

  return (
    <group
      position={scene.position}
      rotation={scene.rotation}
      scale={[scene.scale, scene.scale, scene.scale]}
    >
      {scene.showGround ? (
        <mesh position={[0, scene.groundHeight, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial
            color={groundColor}
            opacity={getEffectiveGroundOpacity(scene.groundOpacity, false)}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            transparent
          />
        </mesh>
      ) : null}
      {objects
        .filter((item) => item.visible && item.kind !== "camera")
        .map((item) => {
          const asset = item.assetRefId ? assetsById.get(item.assetRefId) : undefined;
          const hasMotion = Boolean(item.motionPath?.keyframes?.length);
          const motionWalking = cameraMotionPlaying && item.kind === "character" && hasMotion && getObjectMotionSpeed(item, cameraMotionProgress) > 0.05;
          const motionTransform = hasMotion
            ? getObjectMotionSnapshot(item, cameraMotionProgress)
            : item.transform;
          const renderedItem = {
            ...item,
            transform: constrainObjectMotionTransform(item, motionTransform, scene, objects),
          };

          return (
            <ObjectSceneNode
              key={item.id}
              asset={asset}
              item={renderedItem}
              motionPhase={cameraMotionProgress * activeMotionDuration * 7.2}
              motionTimeSeconds={cameraMotionProgress * activeMotionDuration}
              motionProgress={cameraMotionProgress}
              motionWalking={motionWalking}
              selected={interactive && !item.crowdId && item.id === selectedObjectId}
              showLabels={interactive && scene.showLabels && cameraPilotMode === "idle"}
              transformMode={transformMode}
              transformable={interactive && !item.locked && cameraPilotMode === "idle" && !selectedObjectMotionKeyframeId}
              translationSnap={translationSnap}
              onSelect={handleObjectSelect}
            />
          );
        })}
      {interactive ? Array.from(new Set(objects.map((item) => item.crowdId).filter((item): item is string => typeof item === "string"))).map(
        (crowdId) => (
          <CrowdTransformRig
            key={crowdId}
            crowdId={crowdId}
            objects={objects}
            selected={selectedCrowdId === crowdId}
            transformMode={transformMode}
            transformable={cameraPilotMode === "idle" && !(crowdLocksById.get(crowdId) ?? false)}
            translationSnap={translationSnap}
          />
        )
      ) : null}
      {(interactive || renderMode === "director-monitor") && showCharacterRoutes && cameraPilotMode === "idle" ? objects
        .filter((item) => item.visible && item.kind === "character" && (item.motionPath?.keyframes.length ?? 0) > 0)
        .map((character) => (
          <CharacterRouteRig
            key={`${character.id}-route`}
            character={character}
            progress={cameraMotionProgress}
            playing={cameraMotionPlaying}
            showHandles={interactive}
            scene={scene}
            objects={objects}
            transformMode={transformMode}
            translationSnap={translationSnap}
          />
        )) : null}
      {effectiveViewMode === "director"
        ? cameras
            .map((camera) => ({ camera, object: cameraObjectsByCameraId.get(camera.id) }))
            .filter(({ object }) => object?.visible ?? true)
            .map(({ camera, object }) => (
              <group key={camera.id}>
                {interactive && !motionStudioOpen && !camera.isVirtual ? (
                  <ViewportCameraRig
                    camera={camera}
                    object={object}
                    selected={object?.id === selectedObjectId}
                    showLabel={scene.showLabels}
                    transformMode={transformMode}
                    transformable={Boolean(object && !object.locked && !selectedCameraKeyframeId)}
                    translationSnap={translationSnap}
                  />
                ) : null}
                {interactive && cameraPilotMode === "idle" && (object?.id === selectedObjectId || (motionStudioOpen && camera.id === activeCameraId)) ? (
                  <CameraMotionPathRig camera={camera} scene={scene} translationSnap={translationSnap} />
                ) : null}
              </group>
            ))
        : null}
      {renderMode === "director-monitor" && activeCameraId ? cameras
        .filter((camera) => camera.id === activeCameraId)
        .map((camera) => {
          const points = sampleCameraMotionPath(camera, 80).map((position) => constrainCameraPosition(position, scene, objects));
          const rawPlayhead = getCameraMotionSnapshot(camera, cameraMotionProgress);
          const playhead = { ...rawPlayhead, position: constrainCameraPosition(rawPlayhead.position, scene, objects) };
          return (
            <group key={`${camera.id}-monitor-route`}>
              {points.length >= 2 ? <Line color="#F5A65B" lineWidth={2} points={points} /> : null}
              <mesh position={playhead.position}>
                <sphereGeometry args={[0.14, 16, 12]} />
                <meshBasicMaterial color="#FFFFFF" depthTest={false} />
              </mesh>
            </group>
          );
        }) : null}
    </group>
  );
}
