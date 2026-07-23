import { Bone, Group } from "three";
import {
  findGenericHumanoidSourceNode,
  getGenericHumanoidBoneRole,
  getGenericHumanoidTargetBoneName,
  getGenericHumanoidTargetBoneRole,
} from "../genericHumanoidRetarget";

describe("generic humanoid bone mapping", () => {
  it.each([
    ["Hips", "hips", "Bip001_Pelvis_03"],
    ["Spine", "spine", "Bip001_Spine_04"],
    ["Spine1", "spine1", "Bip001_Spine1_05"],
    ["Spine2", "spine2", "Bip001_Spine1_05"],
    ["Neck", "neck", "Bip001_Neck_06"],
    ["Head", "head", "Bip001_Head_055"],
    ["LeftShoulder", "leftShoulder", "Bip001_L_Clavicle_07"],
    ["LeftArm", "leftUpperArm", "Bip001_L_UpperArm_08"],
    ["LeftForeArm", "leftForearm", "Bip001_L_Forearm_09"],
    ["LeftHand", "leftHand", "Bip001_L_Hand_010"],
    ["LeftUpLeg", "leftThigh", "Bip001_L_Thigh_057"],
    ["LeftLeg", "leftCalf", "Bip001_L_Calf_058"],
    ["LeftFoot", "leftFoot", "Bip001_L_Foot_059"],
    ["LeftToeBase", "leftToe", "Bip001_L_Toe0_00"],
    ["RightShoulder", "rightShoulder", "Bip001_R_Clavicle_031"],
    ["RightArm", "rightUpperArm", "Bip001_R_UpperArm_032"],
    ["RightForeArm", "rightForearm", "Bip001_R_Forearm_033"],
    ["RightHand", "rightHand", "Bip001_R_Hand_034"],
    ["RightUpLeg", "rightThigh", "Bip001_R_Thigh_061"],
    ["RightLeg", "rightCalf", "Bip001_R_Calf_062"],
    ["RightFoot", "rightFoot", "Bip001_R_Foot_063"],
    ["RightToeBase", "rightToe", "Bip001_R_Toe0_064"],
  ])("maps %s to the built-in BIP rig", (sourceName, role, targetName) => {
    expect(getGenericHumanoidBoneRole(sourceName)).toBe(role);
    expect(getGenericHumanoidTargetBoneName(sourceName)).toBe(targetName);
  });

  const fingers = [
    ["thumb", ["Bip001_L_Finger0_011", "Bones_L_Finger01_012", "Bones_L_Finger02_013"]],
    ["index", ["Bones_L_Finger1_015", "Bones_L_Finger11_016", "Bones_L_Finger12_017"]],
    ["middle", ["Bones_L_Finger2_019", "Bones_L_Finger21_020", "Bones_L_Finger22_021"]],
    ["ring", ["Bones_L_Finger3_023", "Bones_L_Finger31_024", "Bones_L_Finger32_025"]],
    ["pinky", ["Bones_L_Finger4_027", "Bones_L_Finger41_028", "Bones_L_Finger42_029"]],
  ] as const;

  it.each(["left", "right"] as const)("maps all %s finger joints", (side) => {
    const targetSide = side === "left" ? "L" : "R";
    const rightOffset = side === "right" ? 24 : 0;

    for (const [finger, leftTargets] of fingers) {
      for (let joint = 1; joint <= 3; joint += 1) {
        const sourceName = `${side}_${finger}${joint}`;
        const expected = leftTargets[joint - 1]
          .replace("_L_", `_${targetSide}_`)
          .replace(/_(\d+)$/, (_, value: string) => `_${String(Number(value) + rightOffset).padStart(value.length, "0")}`);
        expect(getGenericHumanoidBoneRole(sourceName)).toBe(`${side}${finger[0].toUpperCase()}${finger.slice(1)}${joint}`);
        expect(getGenericHumanoidTargetBoneName(sourceName)).toBe(expected);
      }
    }
  });

  it("accepts common Mixamo-style finger aliases", () => {
    expect(getGenericHumanoidTargetBoneName("LeftHandIndex2")).toBe("Bones_L_Finger11_016");
    expect(getGenericHumanoidTargetBoneName("mixamorig:RightHandThumb3")).toBe("Bones_R_Finger02_037");
  });

  it("resolves BIP target bones back to their generic source roles", () => {
    expect(getGenericHumanoidTargetBoneRole("Bip001_Pelvis_03")).toBe("hips");
    expect(getGenericHumanoidTargetBoneRole("Bip001_Spine1_05")).toBe("spine2");
    expect(getGenericHumanoidTargetBoneRole("Bones_R_Finger42_053")).toBe("rightPinky3");
    expect(getGenericHumanoidTargetBoneRole("unmapped")).toBeNull();
  });

  it("prefers the structurally complete Hips node when names are duplicated", () => {
    const scene = new Group();
    const completeHips = new Bone();
    const nestedHips = new Bone();
    const emptyHips = new Bone();
    completeHips.name = "Hips";
    nestedHips.name = "Hips";
    emptyHips.name = "Hips";
    scene.add(completeHips);
    completeHips.add(nestedHips);
    nestedHips.add(emptyHips);

    for (const name of ["Spine", "LeftUpLeg", "RightUpLeg"]) {
      const child = new Bone();
      child.name = name;
      completeHips.add(child);
    }

    expect(findGenericHumanoidSourceNode(scene, "Hips")).toBe(completeHips);
  });
});
