import { readFileSync } from "node:fs";
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BODY_TYPE_OPTIONS } from "../mannequin/bodyTypes";
import { alignUE4MannequinToGround, isolateAndTintUE4MannequinMaterials } from "../UE4MannequinModel";
import {
  applyMixamoAnimationSample,
  captureCharacterRestPose,
  prepareMixamoAnimationClip,
} from "../MixamoCharacterModel";
import { getUE4ModelScale } from "../ue4Mannequin/ue4MannequinRig";
import { applyUE4RestPoseAndRig, captureUE4RestPose } from "../ue4Mannequin/ue4MannequinPoseApplication";

interface LoadedGLTF {
  scene: Group;
}

declare const process: {
  cwd: () => string;
};

async function loadRetopologyMannequin() {
  const binaryModel = readFileSync(`${process.cwd()}/public/models/ue-mannequin-retopology.glb`, "binary");
  const model = Uint8Array.from(binaryModel, (character) => character.charCodeAt(0));
  const arrayBuffer = new ArrayBuffer(model.byteLength);
  new Uint8Array(arrayBuffer).set(model);
  const loader = new GLTFLoader();

  return new Promise<LoadedGLTF>((resolve, reject) => {
    loader.parse(arrayBuffer, "", (gltf) => resolve(gltf as LoadedGLTF), reject);
  });
}

it("isolates cloned mannequin materials before tinting each character instance", () => {
  const sharedMaterial = new MeshStandardMaterial({ color: "#ffffff", name: "Body" });
  const firstModel = new Group();
  const secondModel = new Group();
  const firstMesh = new SkinnedMesh(new BoxGeometry(), sharedMaterial);
  const secondMesh = new SkinnedMesh(new BoxGeometry(), sharedMaterial);

  firstModel.add(firstMesh);
  secondModel.add(secondMesh);

  isolateAndTintUE4MannequinMaterials(firstModel, "#4F8EF7");
  isolateAndTintUE4MannequinMaterials(secondModel, "#E0524D");

  const firstMaterial = firstMesh.material as MeshStandardMaterial;
  const secondMaterial = secondMesh.material as MeshStandardMaterial;

  expect(firstMaterial).not.toBe(sharedMaterial);
  expect(secondMaterial).not.toBe(sharedMaterial);
  expect(firstMaterial).not.toBe(secondMaterial);
  expect(firstMaterial.color.getHexString()).toBe("4f8ef7");
  expect(secondMaterial.color.getHexString()).toBe("e0524d");
});

it("aligns the retopology mannequin root so the lowest visible geometry rests on the ground", () => {
  const scene = new Group();
  const footProbe = new Mesh(new BoxGeometry(0.2, 0.4, 0.2), new MeshStandardMaterial());
  footProbe.position.y = 0.35;
  scene.position.set(1.5, 4, -2);
  scene.add(footProbe);

  alignUE4MannequinToGround(scene);
  scene.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(scene, true);

  expect(scene.position.x).toBeCloseTo(1.5);
  expect(scene.position.z).toBeCloseTo(-2);
  expect(bounds.min.y).toBeCloseTo(0);
});

it("aligns in parent-local space when a body type wrapper scales the mannequin", () => {
  const wrapper = new Group();
  const scene = new Group();
  const footProbe = new Mesh(new BoxGeometry(0.2, 0.4, 0.2), new MeshStandardMaterial());
  footProbe.position.y = 0.35;
  wrapper.scale.set(0.56, 0.56, 0.56);
  wrapper.add(scene);
  scene.add(footProbe);
  wrapper.updateMatrixWorld(true);

  alignUE4MannequinToGround(scene);
  wrapper.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(wrapper, true);

  expect(bounds.min.y).toBeCloseTo(0);
});

it("keeps every real retopology body type grounded after right-panel style switching", async () => {
  vi.stubGlobal("createImageBitmap", async () => ({ close: vi.fn() }));
  const gltf = await loadRetopologyMannequin();

  const wrapper = new Group();
  const scene = cloneSkeleton(gltf.scene) as Group;
  const restPose = captureUE4RestPose(scene);

  wrapper.add(scene);

  for (const option of BODY_TYPE_OPTIONS) {
    wrapper.scale.set(...getUE4ModelScale(option.bodyType));
    wrapper.updateMatrixWorld(true);

    applyUE4RestPoseAndRig(scene, {
      bodyType: option.bodyType,
      controls: {},
      restPose,
    });
    alignUE4MannequinToGround(scene);
    wrapper.updateMatrixWorld(true);

    const bounds = new Box3().setFromObject(wrapper, true);

    expect(bounds.min.y, option.label).toBeCloseTo(0, 4);
  }
});

it("retargets and samples a SOMA animation on the built-in UE4 mannequin bones", () => {
  const sourceScene = new Group();
  const sourceArm = new Bone();
  sourceArm.name = "LeftArm";
  sourceScene.add(sourceArm);

  const targetScene = new Group();
  const targetArm = new Bone();
  targetArm.name = "Bip001_L_UpperArm_08";
  targetScene.add(targetArm);
  const targetRestPose = captureCharacterRestPose(targetScene);
  const sourceRestPose = captureCharacterRestPose(sourceScene);
  const clip = new AnimationClip("kimodo", 1, [
    new QuaternionKeyframeTrack(
      "LeftArm.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2]
    ),
    new VectorKeyframeTrack(
      "LeftArm.position",
      [0, 1],
      [0, 0, 0, 4, 5, 6]
    ),
  ]);

  const prepared = prepareMixamoAnimationClip(
    clip,
    targetScene,
    sourceScene,
    "local-rest",
    targetRestPose,
    sourceRestPose,
    undefined,
    "soma"
  );
  const mixer = new AnimationMixer(targetScene);
  mixer.clipAction(prepared, targetScene).play();
  applyMixamoAnimationSample({
    animationTimeSeconds: 0.5,
    clipDuration: prepared.duration,
    lastClipTime: null,
    mixer,
    restPose: targetRestPose,
    scene: targetScene,
  });

  expect(prepared.tracks).toHaveLength(1);
  expect(prepared.tracks[0]?.name).toBe("Bip001_L_UpperArm_08.quaternion");
  expect(Math.abs(targetArm.quaternion.z)).toBeGreaterThan(0.1);
  expect(targetArm.position.toArray()).toEqual([0, 0, 0]);
});

it("keeps the SOMA shoulder, upper arm, and forearm swing directions coordinated", () => {
  const sourceScene = new Group();
  const sourceShoulder = new Bone();
  const sourceArm = new Bone();
  const sourceForearm = new Bone();
  const sourceHand = new Bone();
  const sourceIndex = new Bone();
  const sourceMiddle = new Bone();
  const sourcePinky = new Bone();
  sourceShoulder.name = "LeftShoulder";
  sourceArm.name = "LeftArm";
  sourceForearm.name = "LeftForeArm";
  sourceHand.name = "LeftHand";
  sourceIndex.name = "LeftHandIndex1";
  sourceMiddle.name = "LeftHandMiddle1";
  sourcePinky.name = "LeftHandPinky1";
  sourceArm.position.x = 1;
  sourceForearm.position.x = 1;
  sourceHand.position.x = 1;
  sourceScene.add(sourceShoulder);
  sourceShoulder.add(sourceArm);
  sourceArm.add(sourceForearm);
  sourceForearm.add(sourceHand);
  sourceHand.add(sourceIndex, sourceMiddle, sourcePinky);
  sourceIndex.position.set(1, 0.25, -0.3);
  sourceMiddle.position.set(1, 0, 0);
  sourcePinky.position.set(1, -0.25, 0.3);

  const targetScene = new Group();
  const targetClavicle = new Bone();
  const targetArm = new Bone();
  const targetForearm = new Bone();
  const targetHand = new Bone();
  const targetIndex = new Bone();
  const targetMiddle = new Bone();
  const targetPinky = new Bone();
  targetClavicle.name = "Bip001_L_Clavicle_07";
  targetArm.name = "Bip001_L_UpperArm_08";
  targetForearm.name = "Bip001_L_Forearm_09";
  targetHand.name = "Bip001_L_Hand_010";
  targetIndex.name = "Bones_L_Finger1_015";
  targetMiddle.name = "Bones_L_Finger2_019";
  targetPinky.name = "Bones_L_Finger4_027";
  targetArm.position.x = 1;
  targetForearm.position.x = 1;
  targetHand.position.x = 1;
  targetClavicle.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 5);
  targetArm.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
  targetForearm.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6);
  targetHand.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3);
  targetScene.add(targetClavicle);
  targetClavicle.add(targetArm);
  targetArm.add(targetForearm);
  targetForearm.add(targetHand);
  targetHand.add(targetIndex, targetMiddle, targetPinky);
  targetIndex.position.set(0.8, -0.4, 0.3);
  targetMiddle.position.set(1, 0, 0);
  targetPinky.position.set(0.8, 0.4, -0.3);

  const identityValues = [0, 0, 0, 1, 0, 0, 0, 1];
  const clip = new AnimationClip("kimodo-arm", 1, [
    new QuaternionKeyframeTrack(
      "LeftShoulder.quaternion",
      [0, 1],
      [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2]
    ),
    new QuaternionKeyframeTrack("LeftArm.quaternion", [0, 1], identityValues),
    new QuaternionKeyframeTrack("LeftForeArm.quaternion", [0, 1], identityValues),
    new QuaternionKeyframeTrack("LeftHand.quaternion", [0, 1], identityValues),
  ]);
  const targetRestPose = captureCharacterRestPose(targetScene);
  const sourceRestPose = captureCharacterRestPose(sourceScene);
  const prepared = prepareMixamoAnimationClip(
    clip,
    targetScene,
    sourceScene,
    "local-rest",
    targetRestPose,
    sourceRestPose,
    undefined,
    "soma"
  );

  const sourceMixer = new AnimationMixer(sourceScene);
  sourceMixer.clipAction(clip, sourceScene).play();
  sourceMixer.setTime(0.5);
  sourceScene.updateMatrixWorld(true);
  const targetMixer = new AnimationMixer(targetScene);
  targetMixer.clipAction(prepared, targetScene).play();
  applyMixamoAnimationSample({
    animationTimeSeconds: 0.5,
    clipDuration: prepared.duration,
    lastClipTime: null,
    mixer: targetMixer,
    restPose: targetRestPose,
    scene: targetScene,
  });

  function segmentDirection(start: Bone, end: Bone) {
    return end.getWorldPosition(new Vector3()).sub(start.getWorldPosition(new Vector3())).normalize();
  }

  function palmDirections(hand: Bone, index: Bone, middle: Bone, pinky: Bone) {
    return {
      across: index.getWorldPosition(new Vector3()).sub(pinky.getWorldPosition(new Vector3())).normalize(),
      forward: segmentDirection(hand, middle),
    };
  }

  expect(segmentDirection(targetClavicle, targetArm).dot(segmentDirection(sourceShoulder, sourceArm))).toBeGreaterThan(0.999);
  expect(segmentDirection(targetArm, targetForearm).dot(segmentDirection(sourceArm, sourceForearm))).toBeGreaterThan(0.999);
  expect(segmentDirection(targetForearm, targetHand).dot(segmentDirection(sourceForearm, sourceHand))).toBeGreaterThan(0.999);
  const sourcePalm = palmDirections(sourceHand, sourceIndex, sourceMiddle, sourcePinky);
  const targetPalm = palmDirections(targetHand, targetIndex, targetMiddle, targetPinky);
  expect(targetPalm.forward.dot(sourcePalm.forward)).toBeGreaterThan(0.999);
  expect(targetPalm.across.dot(sourcePalm.across)).toBeGreaterThan(0.999);
});

it("retargets generic humanoid clavicle, neck, toe, and finger rotations to BIP bones", () => {
  const sourceScene = new Group();
  const targetScene = new Group();
  const mappings = [
    ["LeftShoulder", "Bip001_L_Clavicle_07"],
    ["Neck", "Bip001_Neck_06"],
    ["LeftToeBase", "Bip001_L_Toe0_00"],
    ["left_thumb1", "Bip001_L_Finger0_011"],
    ["left_index2", "Bones_L_Finger11_016"],
    ["right_pinky3", "Bones_R_Finger42_053"],
  ] as const;

  for (const [sourceName, targetName] of mappings) {
    const sourceBone = new Bone();
    sourceBone.name = sourceName;
    sourceScene.add(sourceBone);
    const targetBone = new Bone();
    targetBone.name = targetName;
    targetScene.add(targetBone);
  }

  const identityValues = [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const clip = new AnimationClip("generic-special-bones", 1, [
    ...mappings.map(([sourceName]) => new QuaternionKeyframeTrack(
      `${sourceName}.quaternion`,
      [0, 1],
      identityValues
    )),
    new VectorKeyframeTrack("LeftShoulder.position", [0, 1], [0, 0, 0, 1, 2, 3]),
  ]);
  const prepared = prepareMixamoAnimationClip(
    clip,
    targetScene,
    sourceScene,
    "local-rest",
    captureCharacterRestPose(targetScene),
    captureCharacterRestPose(sourceScene),
    undefined,
    "generic-humanoid"
  );

  expect(prepared.tracks.map((track) => track.name).sort()).toEqual(
    mappings.map(([, targetName]) => `${targetName}.quaternion`).sort()
  );
});

it("uses pure track retargeting for a skinned generic humanoid without mutating either rig", () => {
  const sourceScene = new Group();
  const sourceMesh = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial());
  const sourceHips = new Bone();
  const sourceArm = new Bone();
  sourceHips.name = "Hips";
  sourceArm.name = "LeftArm";
  sourceHips.position.y = 10;
  sourceArm.position.x = 2;
  sourceMesh.add(sourceHips);
  sourceHips.add(sourceArm);
  sourceMesh.bind(new Skeleton([sourceHips, sourceArm]));
  sourceScene.add(sourceMesh);

  const targetScene = new Group();
  const targetMesh = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial());
  const targetHips = new Bone();
  const targetArm = new Bone();
  targetHips.name = "Bip001_Pelvis_03";
  targetArm.name = "Bip001_L_UpperArm_08";
  targetHips.position.y = 20;
  targetArm.position.x = 4;
  targetMesh.add(targetHips);
  targetHips.add(targetArm);
  targetMesh.bind(new Skeleton([targetHips, targetArm]));
  targetScene.add(targetMesh);
  sourceScene.updateMatrixWorld(true);
  targetScene.updateMatrixWorld(true);

  const sourceRestPose = captureCharacterRestPose(sourceScene);
  const targetRestPose = captureCharacterRestPose(targetScene);
  const armEnd = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  const clip = new AnimationClip("skinned-generic", 1, [
    new VectorKeyframeTrack("Hips.position", [0, 1], [0, 10, 0, 4, 12, 3]),
    new QuaternionKeyframeTrack("LeftArm.quaternion", [0, 1], [0, 0, 0, 1, ...armEnd.toArray()]),
    new QuaternionKeyframeTrack("Armature.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);

  const consoleWarning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const prepared = prepareMixamoAnimationClip(
    clip,
    targetScene,
    sourceScene,
    "local-rest",
    targetRestPose,
    sourceRestPose,
    undefined,
    "generic-humanoid"
  );

  expect(consoleWarning.mock.calls.flat().join(" ")).not.toContain("PropertyBinding");
  consoleWarning.mockRestore();
  expect(prepared.tracks.some((track) => track.name === "Bip001_L_UpperArm_08.quaternion")).toBe(true);
  expect(prepared.tracks.every((track) => !track.name.includes("LeftHand_end"))).toBe(true);
  expect(sourceHips.position.toArray()).toEqual([0, 10, 0]);
  expect(targetHips.position.toArray()).toEqual([0, 20, 0]);
  expect(targetArm.quaternion.toArray()).toEqual([0, 0, 0, 1]);
});

it("combines generic Spine1 and Spine2 deltas into one upper BIP spine track", () => {
  const sourceScene = new Group();
  const sourceSpine1 = new Bone();
  const sourceSpine2 = new Bone();
  sourceSpine1.name = "Spine1";
  sourceSpine2.name = "Spine2";
  sourceScene.add(sourceSpine1);
  sourceSpine1.add(sourceSpine2);

  const targetScene = new Group();
  const targetSpine = new Bone();
  targetSpine.name = "Bip001_Spine1_05";
  targetScene.add(targetSpine);

  const spine1Rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 3);
  const spine2Rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
  const clip = new AnimationClip("generic-spine", 1, [
    new QuaternionKeyframeTrack("Spine1.quaternion", [0, 1], [0, 0, 0, 1, ...spine1Rotation.toArray()]),
    new QuaternionKeyframeTrack("Spine2.quaternion", [0, 1], [0, 0, 0, 1, ...spine2Rotation.toArray()]),
  ]);
  const prepared = prepareMixamoAnimationClip(
    clip,
    targetScene,
    sourceScene,
    "local-rest",
    captureCharacterRestPose(targetScene),
    captureCharacterRestPose(sourceScene),
    undefined,
    "generic-humanoid"
  );

  expect(prepared.tracks.map((track) => track.name)).toEqual(["Bip001_Spine1_05.quaternion"]);
  const actualEnd = new Quaternion().fromArray(prepared.tracks[0].values, 4);
  const expectedEnd = spine1Rotation.clone().multiply(spine2Rotation);
  expect(Math.abs(actualEnd.dot(expectedEnd))).toBeCloseTo(1, 5);
  expect(new Set(prepared.tracks.map((track) => track.name)).size).toBe(prepared.tracks.length);
});

it("retargets generic humanoid rotation deltas in world space across different local bone axes", () => {
  const sourceScene = new Group();
  const sourceHips = new Bone();
  const sourceArm = new Bone();
  sourceHips.name = "Hips";
  sourceArm.name = "LeftArm";
  sourceHips.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3);
  sourceArm.position.set(1, 1, 0);
  sourceScene.add(sourceHips);
  sourceHips.add(sourceArm);

  const targetScene = new Group();
  const targetHips = new Bone();
  const targetArm = new Bone();
  targetHips.name = "Bip001_Pelvis_03";
  targetArm.name = "Bip001_L_UpperArm_08";
  targetHips.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  targetArm.position.set(0, 1, 1);
  targetScene.add(targetHips);
  targetHips.add(targetArm);
  sourceScene.updateMatrixWorld(true);
  targetScene.updateMatrixWorld(true);

  const sourceRestPose = captureCharacterRestPose(sourceScene);
  const targetRestPose = captureCharacterRestPose(targetScene);
  const sourceRestWorld = sourceArm.getWorldQuaternion(new Quaternion());
  const targetRestWorld = targetArm.getWorldQuaternion(new Quaternion());
  const animatedArm = sourceArm.quaternion.clone().multiply(
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  );
  const clip = new AnimationClip("generic-world-delta", 1, [
    new QuaternionKeyframeTrack(
      "LeftArm.quaternion",
      [0, 1],
      [...sourceArm.quaternion.toArray(), ...animatedArm.toArray()]
    ),
  ]);
  const prepared = prepareMixamoAnimationClip(
    clip,
    targetScene,
    sourceScene,
    "local-rest",
    targetRestPose,
    sourceRestPose,
    undefined,
    "generic-humanoid"
  );

  const sourceMixer = new AnimationMixer(sourceScene);
  sourceMixer.clipAction(clip, sourceScene).play();
  sourceMixer.setTime(1);
  sourceScene.updateMatrixWorld(true);
  const targetMixer = new AnimationMixer(targetScene);
  targetMixer.clipAction(prepared, targetScene).play();
  targetMixer.setTime(1);
  targetScene.updateMatrixWorld(true);

  const sourceDelta = sourceArm.getWorldQuaternion(new Quaternion()).multiply(sourceRestWorld.invert());
  const targetDelta = targetArm.getWorldQuaternion(new Quaternion()).multiply(targetRestWorld.invert());
  expect(Math.abs(sourceDelta.dot(targetDelta))).toBeCloseTo(1, 5);
});

it("anchors generic humanoid horizontal hips motion while preserving scaled vertical motion", () => {
  const sourceScene = new Group();
  const sourceHips = new Bone();
  sourceHips.name = "Hips";
  sourceHips.position.set(0, 10, 0);
  sourceScene.add(sourceHips);

  const targetScene = new Group();
  const targetHips = new Bone();
  targetHips.name = "Bip001_Pelvis_03";
  targetHips.position.set(7, 20, 9);
  targetScene.add(targetHips);

  const clip = new AnimationClip("generic-root-motion", 1, [
    new VectorKeyframeTrack("Hips.position", [0, 1], [1, 10, 2, 5, 13, 8]),
    new QuaternionKeyframeTrack(
      "Hips.quaternion",
      [0, 1],
      [0, 0, 0, 1, ...new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray()]
    ),
  ]);
  const prepared = prepareMixamoAnimationClip(
    clip,
    targetScene,
    sourceScene,
    "local-rest",
    captureCharacterRestPose(targetScene),
    captureCharacterRestPose(sourceScene),
    undefined,
    "generic-humanoid"
  );

  expect(prepared.tracks).toHaveLength(1);
  expect(prepared.tracks[0].name).toBe("Bip001_Pelvis_03.position");
  expect(Array.from(prepared.tracks[0].values)).toEqual([7, 20, 9, 7, 26, 9]);
});
