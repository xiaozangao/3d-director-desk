import { useFrame, useLoader } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Euler,
  Group,
  LoopOnce,
  LoopRepeat,
  Matrix4,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  SkinnedMesh,
  Vector3,
  type Object3D,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader.js";
import { clone as cloneSkeleton, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";
import { getCharacterActionPreset } from "../presets/characterActionPresets";
import { getObjectMotionActionSample } from "../schema/objectMotion";
import type { CharacterRigProfile, CharacterRigState, DirectorAnimationFormat, DirectorModelFormat, DirectorObject } from "../schema/directorProject";
import type { DirectorCharacterBoneMap } from "../schema/semanticBody";
import { findSemanticBodyPartNode, getSemanticBodyPartForBoneName } from "./semanticBodyTracking";
import { getRuntimePlaybackProgress } from "./playbackRuntime";
import { VIEWPORT_OBJECT_LABEL_VERTICAL_GAP } from "../schema/viewportLabels";
import { disposeIsolatedModelMaterials, isolateAndTintModelMaterials } from "./modelMaterialTint";
import {
  findGenericHumanoidSourceNode,
  getGenericHumanoidBoneRole,
  getGenericHumanoidTargetBoneName,
  getGenericHumanoidTargetBoneRole,
} from "./genericHumanoidRetarget";

interface MixamoCharacterModelProps {
  url: string;
  format?: DirectorModelFormat;
  externalAnimation?: ExternalCharacterAnimation | null;
  orientationCorrection?: [number, number, number];
  rigState?: CharacterRigState;
  actionPresetId?: string | null;
  animationTimeSeconds?: number;
  onLabelAnchorYChange?: (anchorY: number) => void;
  runtimeMotion?: { duration: number; object: DirectorObject };
  boneMap?: DirectorCharacterBoneMap;
  color?: string;
}

export interface ExternalCharacterAnimation {
  url: string;
  format: DirectorAnimationFormat;
  clipName: string;
  rigProfile?: CharacterRigProfile;
}

const DEFAULT_ORIENTATION_CORRECTION: [number, number, number] = [0, 0, 0];

type RestTransform = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
};

export type CharacterRestPose = ReadonlyMap<string, RestTransform>;
export type MixamoRetargetMode = "direct" | "local-rest" | "skeleton";

export type NativeActionClipNames = Partial<Record<string, string>>;

export function getCanonicalHumanoidBoneName(name: string) {
  return name.replace(/:/g, "").replace(/^mixamorig1/i, "mixamorig");
}

const SOMA_SEMANTIC_BONES: Record<string, keyof DirectorCharacterBoneMap> = {
  hips: "waist",
  chest: "chest",
  head: "head",
  leftarm: "leftUpperArm",
  leftforearm: "leftForearm",
  lefthand: "leftHand",
  rightarm: "rightUpperArm",
  rightforearm: "rightForearm",
  righthand: "rightHand",
  leftleg: "leftThigh",
  leftshin: "leftCalf",
  leftfoot: "leftFoot",
  rightleg: "rightThigh",
  rightshin: "rightCalf",
  rightfoot: "rightFoot",
};

export function getSomaSemanticBodyPartForBoneName(name: string) {
  return SOMA_SEMANTIC_BONES[name.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? null;
}

const XBOT_NATIVE_ACTION_CLIPS: NativeActionClipNames = {
  "crouch-cycle": "sneak_pose",
  "jump-cycle": "idle",
  "run-cycle": "run",
  "side-step-left": "walk",
  "walk-cycle": "walk",
  "wave-cycle": "agree",
};

export const SOLDIER_NATIVE_ACTION_CLIPS: NativeActionClipNames = {
  "crouch-cycle": "idle",
  "jump-cycle": "idle",
  "run-cycle": "run",
  "side-step-left": "walk",
  "walk-cycle": "walk",
  "wave-cycle": "idle",
};

export const ROBOT_EXPRESSIVE_ACTION_CLIPS: NativeActionClipNames = {
  "crouch-cycle": "sitting",
  "jump-cycle": "jump",
  "run-cycle": "running",
  "side-step-left": "walking",
  "walk-cycle": "walking",
  "wave-cycle": "wave",
};

export function getNativeMixamoActionClip(
  actionPresetId: string | null | undefined,
  clips: AnimationClip[],
  clipNames: NativeActionClipNames = XBOT_NATIVE_ACTION_CLIPS
) {
  const clipName = actionPresetId ? clipNames[actionPresetId] : undefined;
  return clipName ? clips.find((clip) => clip.name.toLowerCase() === clipName) ?? null : null;
}

export function getFallbackMixamoAnimationUrl(
  actionPresetId: string | null | undefined,
  nativeClip: AnimationClip | null,
  allowExternalAnimations = true
) {
  if (nativeClip || !allowExternalAnimations) return null;
  return getCharacterActionPreset(actionPresetId)?.mixamoAnimationUrl ?? null;
}

const BONE_MAP = {
  body: "mixamorig:Hips",
  torso: "mixamorig:Spine2",
  head: "mixamorig:Head",
  leftShoulder: "mixamorig:LeftArm",
  rightShoulder: "mixamorig:RightArm",
  leftElbow: "mixamorig:LeftForeArm",
  rightElbow: "mixamorig:RightForeArm",
  leftHand: "mixamorig:LeftHand",
  rightHand: "mixamorig:RightHand",
  leftHip: "mixamorig:LeftUpLeg",
  rightHip: "mixamorig:RightUpLeg",
  leftKnee: "mixamorig:LeftLeg",
  rightKnee: "mixamorig:RightLeg",
} as const;

function degrees(value: number) {
  return value * Math.PI / 180;
}

export function captureCharacterRestPose(scene: Object3D): CharacterRestPose {
  const restPose = new Map<string, RestTransform>();
  scene.traverse((object) => {
    restPose.set(object.uuid, {
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
    });
  });
  return restPose;
}

export function applyCharacterRestPose(scene: Object3D, restPose: CharacterRestPose) {
  scene.traverse((object) => {
    const rest = restPose.get(object.uuid);
    if (!rest) return;
    object.position.fromArray(rest.position);
    object.quaternion.fromArray(rest.quaternion);
    object.scale.fromArray(rest.scale);
  });
  scene.updateMatrixWorld(true);
}

function getRestTransform(object: Object3D, restPose?: CharacterRestPose) {
  return restPose?.get(object.uuid) ?? {
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray(),
  };
}

function getRestWorldMatrix(object: Object3D, restPose?: CharacterRestPose) {
  const hierarchy: Object3D[] = [];
  let current: Object3D | null = object;
  while (current) {
    hierarchy.unshift(current);
    current = current.parent;
  }

  return hierarchy.reduce((worldMatrix, node) => {
    const rest = getRestTransform(node, restPose);
    const localMatrix = new Matrix4().compose(
      new Vector3().fromArray(rest.position),
      new Quaternion().fromArray(rest.quaternion),
      new Vector3().fromArray(rest.scale)
    );
    return worldMatrix.multiply(localMatrix);
  }, new Matrix4());
}

function getRestWorldPosition(object: Object3D, restPose?: CharacterRestPose) {
  return new Vector3().setFromMatrixPosition(getRestWorldMatrix(object, restPose));
}

function findPrimarySkinnedMesh(scene: Object3D) {
  let primary: SkinnedMesh | null = null;
  scene.traverse((object) => {
    if (!("isSkinnedMesh" in object) || object.isSkinnedMesh !== true) return;
    const skinnedMesh = object as SkinnedMesh;
    if (!primary || skinnedMesh.skeleton.bones.length > primary.skeleton.bones.length) primary = skinnedMesh;
  });
  return primary as SkinnedMesh | null;
}

function getAnimationTrackNodeName(trackName: string) {
  try {
    return PropertyBinding.parseTrackName(trackName).nodeName;
  } catch {
    const propertySeparator = trackName.lastIndexOf(".");
    return propertySeparator >= 0 ? trackName.slice(0, propertySeparator) : trackName;
  }
}

function keepSkeletonBoundTracks(sourceClip: AnimationClip, sourceMesh: SkinnedMesh) {
  const sourceBoneNames = new Set(sourceMesh.skeleton.bones.map((bone) => bone.name));
  const tracks = sourceClip.tracks.filter((track) => sourceBoneNames.has(getAnimationTrackNodeName(track.name)));
  return tracks.length === sourceClip.tracks.length
    ? sourceClip
    : new AnimationClip(sourceClip.name, sourceClip.duration, tracks);
}

function prepareSkinnedMixamoAnimationClip(
  sourceClip: AnimationClip,
  scene: Object3D,
  sourceScene: Object3D,
  targetRestPose?: CharacterRestPose,
  sourceRestPose?: CharacterRestPose,
  sourceRigProfile?: CharacterRigProfile
) {
  const targetMesh = findPrimarySkinnedMesh(scene);
  const sourceMesh = findPrimarySkinnedMesh(sourceScene);
  if (!targetMesh || !sourceMesh) return null;

  const sourceBonesByNormalizedName = new Map(
    sourceMesh.skeleton.bones.map((bone) => [getCanonicalHumanoidBoneName(bone.name), bone])
  );
  const sourceBonesByGenericRole = new Map(
    sourceMesh.skeleton.bones.flatMap((bone) => {
      const role = getGenericHumanoidBoneRole(bone.name);
      return role ? [[role, bone] as const] : [];
    })
  );
  const isGenericHumanoid = sourceRigProfile === "generic-humanoid";
  const getSourceBone = (targetBone: Object3D) => {
    if (isGenericHumanoid) {
      const role = getGenericHumanoidTargetBoneRole(targetBone.name);
      return role ? sourceBonesByGenericRole.get(role) : undefined;
    }
    return sourceBonesByNormalizedName.get(getCanonicalHumanoidBoneName(targetBone.name));
  };
  const sourceHips = isGenericHumanoid
    ? sourceBonesByGenericRole.get("hips")
    : sourceMesh.skeleton.bones.find((bone) => getCanonicalHumanoidBoneName(bone.name).endsWith("mixamorigHips"));
  const targetHips = isGenericHumanoid
    ? targetMesh.skeleton.bones.find((bone) => getGenericHumanoidTargetBoneRole(bone.name) === "hips")
    : targetMesh.skeleton.bones.find((bone) => getCanonicalHumanoidBoneName(bone.name).endsWith("mixamorigHips"));
  if (!sourceHips || !targetHips) return null;
  const targetHipsRestPosition = new Vector3().fromArray(getRestTransform(targetHips, targetRestPose).position);

  try {
    sourceMesh.skeleton.pose();
    targetMesh.skeleton.pose();
    sourceScene.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    const sourceHipsHeight = Math.max(0.0001, Math.abs(sourceHips.getWorldPosition(new Vector3()).y));
    const hipsScale = Math.abs(targetHips.getWorldPosition(new Vector3()).y) / sourceHipsHeight;
    const retargetOptions = {
      fps: 30,
      getBoneName: (targetBone: Object3D) => getSourceBone(targetBone)?.name ?? `__unmapped__${targetBone.name}`,
      hip: sourceHips.name,
      hipInfluence: new Vector3(0, 1, 0),
      preserveBoneMatrix: true,
      scale: hipsScale,
      useFirstFramePosition: false,
    };
    const clip = retargetClip(targetMesh, sourceMesh, keepSkeletonBoundTracks(sourceClip, sourceMesh), retargetOptions);

    for (const track of clip.tracks) {
      const match = track.name.match(/^\.bones\[(.+)]\.(position|quaternion)$/);
      if (match) track.name = `${match[1]}.${match[2]}`;
      if (track.name === `${targetHips.name}.position` && track.getValueSize() === 3) {
        for (let index = 0; index < track.values.length; index += 3) {
          targetHipsRestPosition.toArray(track.values, index);
        }
      }
    }
    clip.resetDuration();
    return clip;
  } finally {
    if (sourceRestPose) applyCharacterRestPose(sourceScene, sourceRestPose);
    else sourceMesh.skeleton.pose();
    if (targetRestPose) applyCharacterRestPose(scene, targetRestPose);
    else targetMesh.skeleton.pose();
    sourceScene.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
  }
}

type SomaArmSwingChain = {
  sourceBoneName: string;
  sourceChildName: string;
  targetBone: Object3D;
  targetChild: Object3D;
};

type SomaHandAlignment = {
  sourceHand: Object3D;
  sourceIndex: Object3D;
  sourceMiddle: Object3D;
  sourcePinky: Object3D;
  targetHand: Object3D;
  targetIndex: Object3D;
  targetMiddle: Object3D;
  targetPinky: Object3D;
};

function getSomaArmSwingChains(scene: Object3D, sourceScene: Object3D, targetBoneMap?: DirectorCharacterBoneMap) {
  const definitions = [
    {
      sourceBoneName: "LeftShoulder",
      sourceChildName: "LeftArm",
      targetBone: scene.getObjectByName("Bip001_L_Clavicle_07"),
      targetChild: findSemanticBodyPartNode(scene, "leftUpperArm", targetBoneMap),
    },
    {
      sourceBoneName: "LeftArm",
      sourceChildName: "LeftForeArm",
      targetBone: findSemanticBodyPartNode(scene, "leftUpperArm", targetBoneMap),
      targetChild: findSemanticBodyPartNode(scene, "leftForearm", targetBoneMap),
    },
    {
      sourceBoneName: "LeftForeArm",
      sourceChildName: "LeftHand",
      targetBone: findSemanticBodyPartNode(scene, "leftForearm", targetBoneMap),
      targetChild: findSemanticBodyPartNode(scene, "leftHand", targetBoneMap),
    },
    {
      sourceBoneName: "RightShoulder",
      sourceChildName: "RightArm",
      targetBone: scene.getObjectByName("Bip001_R_Clavicle_031"),
      targetChild: findSemanticBodyPartNode(scene, "rightUpperArm", targetBoneMap),
    },
    {
      sourceBoneName: "RightArm",
      sourceChildName: "RightForeArm",
      targetBone: findSemanticBodyPartNode(scene, "rightUpperArm", targetBoneMap),
      targetChild: findSemanticBodyPartNode(scene, "rightForearm", targetBoneMap),
    },
    {
      sourceBoneName: "RightForeArm",
      sourceChildName: "RightHand",
      targetBone: findSemanticBodyPartNode(scene, "rightForearm", targetBoneMap),
      targetChild: findSemanticBodyPartNode(scene, "rightHand", targetBoneMap),
    },
  ];

  return definitions.flatMap(({ sourceBoneName, sourceChildName, targetBone, targetChild }) => {
    if (!targetBone || !targetChild) return [];
    if (!sourceScene.getObjectByName(sourceBoneName) || !sourceScene.getObjectByName(sourceChildName)) return [];
    return [{ sourceBoneName, sourceChildName, targetBone, targetChild } satisfies SomaArmSwingChain];
  });
}

function getSomaHandAlignments(scene: Object3D, sourceScene: Object3D, targetBoneMap?: DirectorCharacterBoneMap) {
  const definitions = [
    {
      sourceNames: ["LeftHand", "LeftHandIndex1", "LeftHandMiddle1", "LeftHandPinky1"],
      targetHand: findSemanticBodyPartNode(scene, "leftHand", targetBoneMap),
      targetNames: ["Bones_L_Finger1_015", "Bones_L_Finger2_019", "Bones_L_Finger4_027"],
    },
    {
      sourceNames: ["RightHand", "RightHandIndex1", "RightHandMiddle1", "RightHandPinky1"],
      targetHand: findSemanticBodyPartNode(scene, "rightHand", targetBoneMap),
      targetNames: ["Bones_R_Finger1_039", "Bones_R_Finger2_043", "Bones_R_Finger4_051"],
    },
  ];

  return definitions.flatMap(({ sourceNames, targetHand, targetNames }) => {
    const [sourceHand, sourceIndex, sourceMiddle, sourcePinky] = sourceNames.map((name) => sourceScene.getObjectByName(name));
    const [targetIndex, targetMiddle, targetPinky] = targetNames.map((name) => scene.getObjectByName(name));
    if (
      !sourceHand || !sourceIndex || !sourceMiddle || !sourcePinky
      || !targetHand || !targetIndex || !targetMiddle || !targetPinky
    ) return [];
    return [{
      sourceHand,
      sourceIndex,
      sourceMiddle,
      sourcePinky,
      targetHand,
      targetIndex,
      targetMiddle,
      targetPinky,
    } satisfies SomaHandAlignment];
  });
}

function getPalmWorldRotation(
  hand: Object3D,
  index: Object3D,
  middle: Object3D,
  pinky: Object3D,
  output: Quaternion
) {
  const origin = hand.getWorldPosition(new Vector3());
  const forward = middle.getWorldPosition(new Vector3()).sub(origin).normalize();
  const across = index.getWorldPosition(new Vector3()).sub(pinky.getWorldPosition(new Vector3())).normalize();
  const normal = forward.clone().cross(across).normalize();
  if (forward.lengthSq() < 0.5 || across.lengthSq() < 0.5 || normal.lengthSq() < 0.5) return null;
  across.copy(normal).cross(forward).normalize();
  return output.setFromRotationMatrix(new Matrix4().makeBasis(forward, across, normal)).normalize();
}

function writeContinuousQuaternion(values: Float32Array, frameIndex: number, quaternion: Quaternion) {
  if (frameIndex > 0) {
    const previous = new Quaternion().fromArray(values, (frameIndex - 1) * 4);
    if (previous.dot(quaternion) < 0) {
      quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w);
    }
  }
  quaternion.toArray(values, frameIndex * 4);
}

function stabilizeSomaArmAndHandMotion(
  clip: AnimationClip,
  sourceClip: AnimationClip,
  scene: Object3D,
  sourceScene: Object3D,
  targetRestPose: CharacterRestPose,
  sourceRestPose: CharacterRestPose,
  targetBoneMap?: DirectorCharacterBoneMap
) {
  const chains = getSomaArmSwingChains(scene, sourceScene, targetBoneMap);
  const handAlignments = getSomaHandAlignments(scene, sourceScene, targetBoneMap);
  const sampleTrack = sourceClip.tracks
    .filter((track) => track.name.endsWith(".quaternion"))
    .sort((left, right) => right.times.length - left.times.length)[0];
  if ((chains.length === 0 && handAlignments.length === 0) || !sampleTrack || sampleTrack.times.length === 0) return clip;

  const times = new Float32Array(sampleTrack.times);
  const valuesByTarget = new Map<Object3D, Float32Array>();
  chains.forEach(({ targetBone }) => {
    if (!valuesByTarget.has(targetBone)) valuesByTarget.set(targetBone, new Float32Array(times.length * 4));
  });
  handAlignments.forEach(({ targetHand }) => {
    if (!valuesByTarget.has(targetHand)) valuesByTarget.set(targetHand, new Float32Array(times.length * 4));
  });

  const sourceMixer = new AnimationMixer(sourceScene);
  const targetMixer = new AnimationMixer(scene);
  const sourceAction = sourceMixer.clipAction(sourceClip, sourceScene);
  const targetAction = targetMixer.clipAction(clip, scene);
  sourceAction.clampWhenFinished = true;
  targetAction.clampWhenFinished = true;
  sourceAction.setLoop(LoopOnce, 1).play();
  targetAction.setLoop(LoopOnce, 1).play();

  const sourcePosition = new Vector3();
  const sourceChildPosition = new Vector3();
  const targetPosition = new Vector3();
  const targetChildPosition = new Vector3();
  const sourceDirection = new Vector3();
  const targetDirection = new Vector3();
  const correction = new Quaternion();
  const worldRotation = new Quaternion();
  const parentWorldRotation = new Quaternion();
  const localRotation = new Quaternion();
  const sourcePalmRotation = new Quaternion();
  const targetPalmRotation = new Quaternion();

  times.forEach((time, frameIndex) => {
    applyCharacterRestPose(sourceScene, sourceRestPose);
    applyCharacterRestPose(scene, targetRestPose);
    sourceMixer.setTime(time);
    targetMixer.setTime(time);
    sourceScene.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    chains.forEach(({ sourceBoneName, sourceChildName, targetBone, targetChild }) => {
      const sourceBone = sourceScene.getObjectByName(sourceBoneName);
      const sourceChild = sourceScene.getObjectByName(sourceChildName);
      if (!sourceBone || !sourceChild) return;

      sourceBone.getWorldPosition(sourcePosition);
      sourceChild.getWorldPosition(sourceChildPosition);
      targetBone.getWorldPosition(targetPosition);
      targetChild.getWorldPosition(targetChildPosition);
      sourceDirection.copy(sourceChildPosition).sub(sourcePosition).normalize();
      targetDirection.copy(targetChildPosition).sub(targetPosition).normalize();
      if (sourceDirection.lengthSq() < 0.5 || targetDirection.lengthSq() < 0.5) return;

      correction.setFromUnitVectors(targetDirection, sourceDirection);
      targetBone.getWorldQuaternion(worldRotation);
      worldRotation.premultiply(correction).normalize();
      if (targetBone.parent) targetBone.parent.getWorldQuaternion(parentWorldRotation);
      else parentWorldRotation.identity();
      localRotation.copy(parentWorldRotation).invert().multiply(worldRotation).normalize();

      const values = valuesByTarget.get(targetBone);
      if (!values) return;
      writeContinuousQuaternion(values, frameIndex, localRotation);
      targetBone.quaternion.copy(localRotation);
      targetBone.updateMatrixWorld(true);
    });

    handAlignments.forEach((alignment) => {
      const sourcePalm = getPalmWorldRotation(
        alignment.sourceHand,
        alignment.sourceIndex,
        alignment.sourceMiddle,
        alignment.sourcePinky,
        sourcePalmRotation
      );
      const targetPalm = getPalmWorldRotation(
        alignment.targetHand,
        alignment.targetIndex,
        alignment.targetMiddle,
        alignment.targetPinky,
        targetPalmRotation
      );
      if (!sourcePalm || !targetPalm) return;

      correction.copy(sourcePalm).multiply(targetPalm.clone().invert()).normalize();
      alignment.targetHand.getWorldQuaternion(worldRotation);
      worldRotation.premultiply(correction).normalize();
      if (alignment.targetHand.parent) alignment.targetHand.parent.getWorldQuaternion(parentWorldRotation);
      else parentWorldRotation.identity();
      localRotation.copy(parentWorldRotation).invert().multiply(worldRotation).normalize();

      const values = valuesByTarget.get(alignment.targetHand);
      if (!values) return;
      writeContinuousQuaternion(values, frameIndex, localRotation);
      alignment.targetHand.quaternion.copy(localRotation);
      alignment.targetHand.updateMatrixWorld(true);
    });
  });

  sourceMixer.stopAllAction();
  targetMixer.stopAllAction();
  applyCharacterRestPose(sourceScene, sourceRestPose);
  applyCharacterRestPose(scene, targetRestPose);

  const stabilizedNames = new Set([...valuesByTarget.keys()].map((target) => `${target.name}.quaternion`));
  clip.tracks = clip.tracks.filter((track) => !stabilizedNames.has(track.name));
  valuesByTarget.forEach((values, target) => {
    clip.tracks.push(new QuaternionKeyframeTrack(`${target.name}.quaternion`, times, values));
  });
  clip.resetDuration();
  return clip;
}

type GenericSpineTrack = {
  role: "spine1" | "spine2";
  sourceNode: Object3D;
  targetNode: Object3D;
  track: QuaternionKeyframeTrack;
};

function sampleQuaternionTrack(track: QuaternionKeyframeTrack, time: number, output: Quaternion) {
  const times = track.times;
  if (times.length === 0) return output.identity();
  if (time <= times[0]) return output.fromArray(track.values, 0).normalize();
  const lastIndex = times.length - 1;
  if (time >= times[lastIndex]) return output.fromArray(track.values, lastIndex * 4).normalize();

  let low = 0;
  let high = lastIndex;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (times[middle] <= time) low = middle;
    else high = middle;
  }

  const interval = times[high] - times[low];
  const alpha = interval > 0 ? (time - times[low]) / interval : 0;
  const start = new Quaternion().fromArray(track.values, low * 4);
  const end = new Quaternion().fromArray(track.values, high * 4);
  return output.slerpQuaternions(start, end, alpha).normalize();
}

function combineGenericUpperSpineTracks(
  tracks: GenericSpineTrack[],
  targetRestPose?: CharacterRestPose,
  sourceRestPose?: CharacterRestPose
) {
  if (tracks.length === 0) return null;
  const orderedTracks = [...tracks].sort((left, right) => left.role.localeCompare(right.role));
  const targetNode = orderedTracks[0].targetNode;
  const times = Float32Array.from(
    [...new Set(orderedTracks.flatMap(({ track }) => Array.from(track.times)))].sort((left, right) => left - right)
  );
  if (times.length === 0) return null;

  const sourceRestInverses = orderedTracks.map(({ sourceNode }) => (
    new Quaternion().fromArray(getRestTransform(sourceNode, sourceRestPose).quaternion).invert()
  ));
  const targetRest = new Quaternion().fromArray(getRestTransform(targetNode, targetRestPose).quaternion);
  const values = new Float32Array(times.length * 4);
  const combined = new Quaternion();
  const sourceRotation = new Quaternion();

  times.forEach((time, frameIndex) => {
    combined.copy(targetRest);
    orderedTracks.forEach(({ track }, trackIndex) => {
      sampleQuaternionTrack(track, time, sourceRotation);
      combined.multiply(sourceRestInverses[trackIndex].clone().multiply(sourceRotation)).normalize();
    });
    writeContinuousQuaternion(values, frameIndex, combined);
  });

  return new QuaternionKeyframeTrack(`${targetNode.name}.quaternion`, times, values);
}

export function prepareMixamoAnimationClip(
  sourceClip: AnimationClip,
  scene: Object3D,
  sourceScene?: Object3D,
  retargetMode: MixamoRetargetMode = "direct",
  targetRestPose?: CharacterRestPose,
  sourceRestPose?: CharacterRestPose,
  targetBoneMap?: DirectorCharacterBoneMap,
  sourceRigProfile?: CharacterRigProfile
) {
  if (sourceScene && retargetMode === "skeleton") {
    const skinnedClip = prepareSkinnedMixamoAnimationClip(
      sourceClip,
      scene,
      sourceScene,
      targetRestPose,
      sourceRestPose,
      sourceRigProfile
    );
    if (skinnedClip) return skinnedClip;
  }

  const clip = sourceClip.clone();
  const objectsByNormalizedName = new Map<string, Object3D>();
  const sourceObjectsByNormalizedName = new Map<string, Object3D>();
  scene.traverse((object) => {
    const normalizedName = getCanonicalHumanoidBoneName(object.name);
    if (normalizedName && !objectsByNormalizedName.has(normalizedName)) {
      objectsByNormalizedName.set(normalizedName, object);
    }
  });
  sourceScene?.traverse((object) => {
    const normalizedName = getCanonicalHumanoidBoneName(object.name);
    if (normalizedName && !sourceObjectsByNormalizedName.has(normalizedName)) {
      sourceObjectsByNormalizedName.set(normalizedName, object);
    }
  });
  const mappedSomaTracks = new Set<(typeof clip.tracks)[number]>();
  const mappedGenericTracks = new Set<(typeof clip.tracks)[number]>();
  const genericSpineTracks: GenericSpineTrack[] = [];
  clip.tracks.forEach((track) => {
    const propertySeparator = track.name.lastIndexOf(".");
    if (propertySeparator < 0) return;
    const sourceNodeName = track.name.slice(0, propertySeparator);
    const normalizedSourceNodeName = getCanonicalHumanoidBoneName(sourceNodeName);
    const propertyName = track.name.slice(propertySeparator + 1);
    const genericRole = sourceRigProfile === "generic-humanoid"
      ? getGenericHumanoidBoneRole(sourceNodeName)
      : null;
    const genericTargetName = genericRole ? getGenericHumanoidTargetBoneName(sourceNodeName) : null;
    const genericTargetNode = genericTargetName ? scene.getObjectByName(genericTargetName) : null;
    const semanticBodyPart = sourceRigProfile === "soma"
      ? getSomaSemanticBodyPartForBoneName(sourceNodeName)
      : genericRole
        ? null
        : getSemanticBodyPartForBoneName(sourceNodeName);
    const mappedTargetNode = semanticBodyPart
      ? findSemanticBodyPartNode(scene, semanticBodyPart, targetBoneMap)
      : null;
    const targetNode = genericTargetNode
      ?? mappedTargetNode
      ?? scene.getObjectByName(sourceNodeName)
      ?? objectsByNormalizedName.get(normalizedSourceNodeName);
    if (!targetNode) return;
    if (sourceRigProfile === "soma") {
      if (propertyName === "quaternion" || (propertyName === "position" && semanticBodyPart === "waist")) {
        mappedSomaTracks.add(track);
      }
    }
    const sourceNode = sourceScene
      ? genericRole
        ? findGenericHumanoidSourceNode(sourceScene, sourceNodeName)
        : sourceScene.getObjectByName(sourceNodeName)
          ?? sourceObjectsByNormalizedName.get(normalizedSourceNodeName)
      : null;
    if (sourceRigProfile === "generic-humanoid" && genericRole) {
      if (
        (propertyName === "quaternion" && genericRole !== "hips")
        || (propertyName === "position" && genericRole === "hips")
      ) {
        mappedGenericTracks.add(track);
      }
      if (
        propertyName === "quaternion"
        && track.getValueSize() === 4
        && (genericRole === "spine1" || genericRole === "spine2")
        && sourceNode
      ) {
        genericSpineTracks.push({
          role: genericRole,
          sourceNode,
          targetNode,
          track: track as QuaternionKeyframeTrack,
        });
        return;
      }
    }

    if (
      track.name.endsWith(".quaternion")
      && track.getValueSize() === 4
      && sourceScene
      && (retargetMode === "local-rest" || retargetMode === "skeleton")
    ) {
      if (sourceNode) {
        const targetRestQuaternion = new Quaternion().fromArray(getRestTransform(targetNode, targetRestPose).quaternion);
        const sourceRestQuaternion = new Quaternion().fromArray(getRestTransform(sourceNode, sourceRestPose).quaternion);
        const restOffset = targetRestQuaternion.multiply(sourceRestQuaternion.invert());
        const sourceRotation = new Quaternion();
        for (let index = 0; index < track.values.length; index += 4) {
          sourceRotation.fromArray(track.values, index);
          restOffset.clone().multiply(sourceRotation).normalize().toArray(track.values, index);
        }
      }
    }

    if (targetNode.name !== sourceNodeName) {
      track.name = `${targetNode.name}${track.name.slice(propertySeparator)}`;
    }
  });
  if (sourceRigProfile === "soma") {
    clip.tracks = clip.tracks.filter((track) => mappedSomaTracks.has(track));
    if (sourceScene && targetRestPose && sourceRestPose) {
      stabilizeSomaArmAndHandMotion(
        clip,
        sourceClip,
        scene,
        sourceScene,
        targetRestPose,
        sourceRestPose,
        targetBoneMap
      );
    }
  }
  if (sourceRigProfile === "generic-humanoid") {
    const genericSpineTrackSet = new Set(genericSpineTracks.map(({ track }) => track));
    clip.tracks = clip.tracks.filter((track) => mappedGenericTracks.has(track) && !genericSpineTrackSet.has(track as QuaternionKeyframeTrack));
    const combinedSpineTrack = combineGenericUpperSpineTracks(genericSpineTracks, targetRestPose, sourceRestPose);
    if (combinedSpineTrack) clip.tracks.push(combinedSpineTrack);
    const uniqueTracks = new Map<string, (typeof clip.tracks)[number]>();
    clip.tracks.forEach((track) => {
      if (!uniqueTracks.has(track.name)) uniqueTracks.set(track.name, track);
    });
    clip.tracks = [...uniqueTracks.values()];
    clip.resetDuration();
  }
  const targetHipsNode = findSemanticBodyPartNode(scene, "waist", targetBoneMap);
  const hipsTrack = clip.tracks.find((track) => {
    const [nodeName, propertyName] = track.name.split(".");
    return propertyName === "position" && (
      nodeName === targetHipsNode?.name
      || getSemanticBodyPartForBoneName(nodeName) === "waist"
    );
  });
  if (!hipsTrack || hipsTrack.getValueSize() !== 3) return clip;

  const nodeName = hipsTrack.name.slice(0, hipsTrack.name.lastIndexOf("."));
  const targetHips = scene.getObjectByName(nodeName)
    ?? objectsByNormalizedName.get(getCanonicalHumanoidBoneName(nodeName));
  if (!targetHips || hipsTrack.values.length < 3) return clip;

  const sourceBaseY = hipsTrack.values[1];
  const sourceHips = sourceScene
    ? sourceRigProfile === "generic-humanoid"
      ? findGenericHumanoidSourceNode(sourceScene, "Hips")
      : findSemanticBodyPartNode(sourceScene, "waist")
      ?? sourceScene.getObjectByName(nodeName)
      ?? sourceObjectsByNormalizedName.get(getCanonicalHumanoidBoneName(nodeName))
    : null;
  const sourceHipsWorldHeight = sourceHips
    ? Math.max(0.0001, Math.abs(getRestWorldPosition(sourceHips, sourceRestPose).y))
    : Math.max(0.0001, Math.abs(sourceBaseY));
  const targetHipsWorldHeight = Math.max(0.0001, Math.abs(getRestWorldPosition(targetHips, targetRestPose).y));
  const worldHeightScale = sourceScene ? targetHipsWorldHeight / sourceHipsWorldHeight : 1;
  const targetBasePosition = new Vector3().fromArray(getRestTransform(targetHips, targetRestPose).position);
  const parentWorldInverse = targetHips.parent
    ? getRestWorldMatrix(targetHips.parent, targetRestPose).invert()
    : null;
  const localOrigin = parentWorldInverse
    ? new Vector3().applyMatrix4(parentWorldInverse)
    : new Vector3();
  for (let index = 0; index < hipsTrack.values.length; index += 3) {
    const worldVerticalDelta = new Vector3(
      0,
      retargetMode === "skeleton" && sourceRigProfile !== "soma"
        ? 0
        : (hipsTrack.values[index + 1] - sourceBaseY) * worldHeightScale,
      0
    );
    const localDelta = parentWorldInverse
      ? worldVerticalDelta.applyMatrix4(parentWorldInverse).sub(localOrigin)
      : worldVerticalDelta;
    hipsTrack.values[index] = targetBasePosition.x + localDelta.x;
    hipsTrack.values[index + 1] = targetBasePosition.y + localDelta.y;
    hipsTrack.values[index + 2] = targetBasePosition.z + localDelta.z;
  }
  return clip;
}

function rotationForBone(name: string, controls: Record<string, number>): [number, number, number] | null {
  const normalizedName = getCanonicalHumanoidBoneName(name);
  const joint = Object.entries(BONE_MAP).find(([, bone]) => getCanonicalHumanoidBoneName(bone) === normalizedName)?.[0];
  if (!joint) return null;
  const pitch = degrees(controls[`${joint}.pitch`] ?? controls[`${joint}.bend`] ?? 0);
  const yaw = degrees(controls[`${joint}.yaw`] ?? controls[`${joint}.twist`] ?? 0);
  const roll = degrees(controls[`${joint}.roll`] ?? controls[`${joint}.spread`] ?? 0);

  if (joint === "leftShoulder" || joint === "leftHip") return [yaw, pitch, roll];
  if (joint === "rightShoulder" || joint === "rightHip") return [yaw, pitch, -roll];
  if (joint === "leftElbow" || joint === "leftKnee") return [0, pitch, 0];
  if (joint === "rightElbow" || joint === "rightKnee") return [0, -pitch, 0];
  return [pitch, yaw, roll];
}

const ANIMATION_SAMPLE_EPSILON = 1e-7;

export function applyMixamoAnimationSample({
  animationTimeSeconds,
  clipDuration,
  lastClipTime,
  mixer,
  restPose,
  scene,
}: {
  animationTimeSeconds: number;
  clipDuration: number;
  lastClipTime: number | null;
  mixer: AnimationMixer;
  restPose: CharacterRestPose;
  scene: Object3D;
}) {
  if (clipDuration <= 0) return lastClipTime;
  const clipTime = ((animationTimeSeconds % clipDuration) + clipDuration) % clipDuration;
  if (lastClipTime != null && Math.abs(lastClipTime - clipTime) <= ANIMATION_SAMPLE_EPSILON) {
    return lastClipTime;
  }
  applyCharacterRestPose(scene, restPose);
  mixer.setTime(clipTime);
  scene.updateMatrixWorld(true);
  return clipTime;
}

export function MixamoAnimationPlayer({
  animationTimeSeconds,
  clip,
  restPose,
  runtimeMotion,
  scene,
}: {
  animationTimeSeconds: number;
  clip: AnimationClip;
  restPose: CharacterRestPose;
  runtimeMotion?: { duration: number; object: DirectorObject };
  scene: Object3D;
}) {
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const lastClipTimeRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!clip) return;
    lastClipTimeRef.current = null;
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);
    applyCharacterRestPose(scene, restPose);
    const action = mixer.clipAction(clip, scene);
    action.reset().setLoop(LoopRepeat, Infinity).play();
    return () => {
      lastClipTimeRef.current = null;
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      applyCharacterRestPose(scene, restPose);
    };
  }, [clip, mixer, restPose, scene]);

  useLayoutEffect(() => {
    if (!clip || clip.duration <= 0) return;
    lastClipTimeRef.current = applyMixamoAnimationSample({
      animationTimeSeconds,
      clipDuration: clip.duration,
      lastClipTime: lastClipTimeRef.current,
      mixer,
      restPose,
      scene,
    });
  }, [animationTimeSeconds, clip, mixer, restPose, scene]);

  useFrame(() => {
    if (!runtimeMotion || clip.duration <= 0) return;
    const animationTime = getObjectMotionActionSample(
      runtimeMotion.object,
      getRuntimePlaybackProgress(),
      runtimeMotion.duration,
    ).animationTimeSeconds;
    lastClipTimeRef.current = applyMixamoAnimationSample({
      animationTimeSeconds: animationTime,
      clipDuration: clip.duration,
      lastClipTime: lastClipTimeRef.current,
      mixer,
      restPose,
      scene,
    });
  });

  return null;
}

export function prepareExternalAnimationClip({
  animation,
  retargetMode,
  scene,
  sourceClip,
  sourceRestPose,
  sourceScene,
  targetBoneMap,
  targetRestPose,
}: {
  animation: ExternalCharacterAnimation;
  retargetMode: MixamoRetargetMode;
  scene: Object3D;
  sourceClip: AnimationClip;
  sourceRestPose: CharacterRestPose;
  sourceScene: Object3D;
  targetBoneMap?: DirectorCharacterBoneMap;
  targetRestPose: CharacterRestPose;
}) {
  const sourceRigProfile = animation.rigProfile ?? (animation.format === "bvh" ? "soma" : undefined);
  return prepareMixamoAnimationClip(
    sourceClip,
    scene,
    sourceScene,
    retargetMode,
    targetRestPose,
    sourceRestPose,
    targetBoneMap,
    sourceRigProfile
  );
}

function PreparedExternalAnimationClip({
  animation,
  animationTimeSeconds,
  retargetMode,
  restPose,
  scene,
  sourceClip,
  sourceScene,
  runtimeMotion,
  targetBoneMap,
}: {
  animation: ExternalCharacterAnimation;
  animationTimeSeconds: number;
  retargetMode: MixamoRetargetMode;
  restPose: CharacterRestPose;
  scene: Object3D;
  sourceClip: AnimationClip | null;
  sourceScene: Object3D;
  runtimeMotion?: { duration: number; object: DirectorObject };
  targetBoneMap?: DirectorCharacterBoneMap;
}) {
  const sourceRestPose = useMemo(() => captureCharacterRestPose(sourceScene), [sourceScene]);
  const animationKey = `${animation.url}\u0000${animation.format}\u0000${animation.clipName}\u0000${animation.rigProfile ?? ""}`;
  const clip = useMemo(
    () => sourceClip
      ? prepareExternalAnimationClip({
          animation,
          retargetMode,
          scene,
          sourceClip,
          sourceRestPose,
          sourceScene,
          targetBoneMap,
          targetRestPose: restPose,
        })
      : null,
    [animationKey, restPose, retargetMode, scene, sourceClip, sourceRestPose, sourceScene, targetBoneMap]
  );
  return clip
    ? <MixamoAnimationPlayer animationTimeSeconds={animationTimeSeconds} clip={clip} restPose={restPose} runtimeMotion={runtimeMotion} scene={scene} />
    : null;
}

function ExternalFbxAnimationClip({ animation, ...props }: {
  animation: ExternalCharacterAnimation;
  animationTimeSeconds: number;
  retargetMode: MixamoRetargetMode;
  restPose: CharacterRestPose;
  runtimeMotion?: { duration: number; object: DirectorObject };
  targetBoneMap?: DirectorCharacterBoneMap;
  scene: Object3D;
}) {
  const source = useLoader(FBXLoader, animation.url);
  const sourceAnimations = source.animations ?? [];
  const sourceClip = sourceAnimations.find((clip) => clip.name === animation.clipName) ?? sourceAnimations[0] ?? null;
  return <PreparedExternalAnimationClip {...props} animation={animation} sourceClip={sourceClip} sourceScene={source} />;
}

function ExternalGlbAnimationClip({ animation, ...props }: {
  animation: ExternalCharacterAnimation;
  animationTimeSeconds: number;
  retargetMode: MixamoRetargetMode;
  restPose: CharacterRestPose;
  runtimeMotion?: { duration: number; object: DirectorObject };
  targetBoneMap?: DirectorCharacterBoneMap;
  scene: Object3D;
}) {
  const source = useLoader(GLTFLoader, animation.url);
  const sourceAnimations = source.animations ?? [];
  const sourceClip = sourceAnimations.find((clip) => clip.name === animation.clipName) ?? sourceAnimations[0] ?? null;
  return <PreparedExternalAnimationClip {...props} animation={animation} sourceClip={sourceClip} sourceScene={source.scene} />;
}

function ExternalBvhAnimationClip({ animation, ...props }: {
  animation: ExternalCharacterAnimation;
  animationTimeSeconds: number;
  retargetMode: MixamoRetargetMode;
  restPose: CharacterRestPose;
  runtimeMotion?: { duration: number; object: DirectorObject };
  targetBoneMap?: DirectorCharacterBoneMap;
  scene: Object3D;
}) {
  const source = useLoader(BVHLoader, animation.url);
  const sourceScene = useMemo(() => {
    const root = new Group();
    const sourceRoot = source.skeleton.bones[0];
    if (sourceRoot) root.add(sourceRoot);
    root.updateMatrixWorld(true);
    return root;
  }, [source]);
  return (
    <PreparedExternalAnimationClip
      {...props}
      animation={animation}
      sourceClip={source.clip}
      sourceScene={sourceScene}
    />
  );
}

export function ExternalCharacterAnimationClip(props: {
  animation: ExternalCharacterAnimation;
  animationTimeSeconds: number;
  retargetMode: MixamoRetargetMode;
  restPose: CharacterRestPose;
  runtimeMotion?: { duration: number; object: DirectorObject };
  targetBoneMap?: DirectorCharacterBoneMap;
  scene: Object3D;
}) {
  if (props.animation.format === "glb") return <ExternalGlbAnimationClip {...props} />;
  if (props.animation.format === "bvh") return <ExternalBvhAnimationClip {...props} />;
  return <ExternalFbxAnimationClip {...props} />;
}

function LoadedMixamoCharacter({
  boneMap,
  color,
  actionPresetId,
  animationTimeSeconds = 0,
  allowExternalAnimations = true,
  externalAnimation,
  orientationCorrection = DEFAULT_ORIENTATION_CORRECTION,
  nativeActionClipNames = XBOT_NATIVE_ACTION_CLIPS,
  nativeAnimations = [],
  source,
  retargetMode,
  rigState,
  runtimeMotion,
  onLabelAnchorYChange,
}: Omit<MixamoCharacterModelProps, "url"> & {
  allowExternalAnimations?: boolean;
  nativeActionClipNames?: NativeActionClipNames;
  nativeAnimations?: AnimationClip[];
  source: Object3D;
  retargetMode: MixamoRetargetMode;
}) {
  const actionPreset = getCharacterActionPreset(actionPresetId);
  const nativeClip = getNativeMixamoActionClip(actionPresetId, nativeAnimations, nativeActionClipNames);
  const animationUrl = externalAnimation
    ? null
    : getFallbackMixamoAnimationUrl(actionPresetId, nativeClip, allowExternalAnimations);
  const hasExternalAnimation = Boolean(externalAnimation);
  const { scene, restPose, scale, offset } = useMemo(() => {
    const clone = cloneSkeleton(source) as Object3D;
    clone.rotation.set(...orientationCorrection);
    clone.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(clone);
    const size = bounds.getSize(new Vector3());
    const modelScale = size.y > 0 ? 1.8 / size.y : 0.01;
    return {
      scene: clone,
      restPose: captureCharacterRestPose(clone),
      scale: modelScale,
      offset: new Vector3(
        -(bounds.min.x + bounds.max.x) * .5 * modelScale,
        -bounds.min.y * modelScale,
        -(bounds.min.z + bounds.max.z) * .5 * modelScale
      ),
    };
  }, [orientationCorrection, source]);

  useLayoutEffect(() => {
    isolateAndTintModelMaterials(scene, color);
  }, [color, scene]);
  useLayoutEffect(() => () => disposeIsolatedModelMaterials(scene), [scene]);

  useLayoutEffect(() => {
    if (animationUrl || nativeClip || hasExternalAnimation) {
      onLabelAnchorYChange?.(1.8 + VIEWPORT_OBJECT_LABEL_VERTICAL_GAP);
      return;
    }
    const controls = rigState?.controls ?? {};
    applyCharacterRestPose(scene, restPose);
    scene.traverse((object) => {
      const rest = restPose.get(object.uuid);
      if (!rest) return;
      const rotation = rotationForBone(object.name, controls);
      if (rotation) object.quaternion.multiply(new Quaternion().setFromEuler(new Euler(...rotation)));
    });
    onLabelAnchorYChange?.(1.8 + VIEWPORT_OBJECT_LABEL_VERTICAL_GAP + (controls["body.offsetY"] ?? 0));
  }, [animationUrl, hasExternalAnimation, nativeClip, onLabelAnchorYChange, restPose, rigState?.controls, scene]);

  const preparedNativeClip = useMemo(
    () => nativeClip?.clone() ?? null,
    [nativeClip, scene]
  );

  const bodyOffsetY = rigState?.controls["body.offsetY"] ?? 0;
  return (
    <group name="mixamo-character" position={[offset.x, offset.y + bodyOffsetY, offset.z]} scale={scale}>
      <primitive object={scene} />
      {externalAnimation ? (
        <ExternalCharacterAnimationClip
          animation={externalAnimation}
          animationTimeSeconds={animationTimeSeconds}
          retargetMode={retargetMode}
          restPose={restPose}
          runtimeMotion={runtimeMotion}
          targetBoneMap={boneMap}
          scene={scene}
        />
      ) : preparedNativeClip ? (
        <MixamoAnimationPlayer
          animationTimeSeconds={animationTimeSeconds}
          clip={preparedNativeClip}
          restPose={restPose}
          runtimeMotion={runtimeMotion}
          scene={scene}
        />
      ) : animationUrl ? (
        <ExternalFbxAnimationClip
          animation={{ url: animationUrl, format: "fbx", clipName: "" }}
          animationTimeSeconds={animationTimeSeconds}
          retargetMode={retargetMode}
          restPose={restPose}
          runtimeMotion={runtimeMotion}
          targetBoneMap={boneMap}
          scene={scene}
        />
      ) : null}
    </group>
  );
}

function MixamoFbxCharacter(props: MixamoCharacterModelProps) {
  const loaded = useLoader(FBXLoader, props.url);
  return <LoadedMixamoCharacter {...props} retargetMode="local-rest" source={loaded} />;
}

function MixamoGlbCharacter(props: MixamoCharacterModelProps) {
  const loaded = useLoader(GLTFLoader, props.url);
  const isRobotExpressive = /robot-expressive\.glb(?:$|[?#])/i.test(props.url);
  const isSoldier = /soldier\.glb(?:$|[?#])/i.test(props.url);
  const retargetMode: MixamoRetargetMode = isRobotExpressive || isSoldier ? "direct" : "local-rest";
  const nativeActionClipNames = isRobotExpressive
    ? ROBOT_EXPRESSIVE_ACTION_CLIPS
    : isSoldier
      ? SOLDIER_NATIVE_ACTION_CLIPS
      : XBOT_NATIVE_ACTION_CLIPS;
  return (
    <LoadedMixamoCharacter
      {...props}
      nativeActionClipNames={nativeActionClipNames}
      nativeAnimations={loaded.animations}
      retargetMode={retargetMode}
      source={loaded.scene}
    />
  );
}

export function MixamoCharacterModel(props: MixamoCharacterModelProps) {
  return props.format === "glb" || (!props.format && /\.glb(?:$|[?#])/i.test(props.url))
    ? <MixamoGlbCharacter {...props} />
    : <MixamoFbxCharacter {...props} />;
}
