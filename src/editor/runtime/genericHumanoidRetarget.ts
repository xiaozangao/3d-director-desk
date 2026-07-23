import type { Object3D } from "three";

type HumanoidSide = "left" | "right";
type HumanoidFinger = "thumb" | "index" | "middle" | "ring" | "pinky";
type HumanoidFingerRole = `${HumanoidSide}${Capitalize<HumanoidFinger>}${1 | 2 | 3}`;

export type GenericHumanoidBoneRole =
  | "hips"
  | "spine"
  | "spine1"
  | "spine2"
  | "neck"
  | "head"
  | "leftShoulder"
  | "leftUpperArm"
  | "leftForearm"
  | "leftHand"
  | "leftThigh"
  | "leftCalf"
  | "leftFoot"
  | "leftToe"
  | "rightShoulder"
  | "rightUpperArm"
  | "rightForearm"
  | "rightHand"
  | "rightThigh"
  | "rightCalf"
  | "rightFoot"
  | "rightToe"
  | HumanoidFingerRole;

const BODY_ROLE_ALIASES: Record<string, GenericHumanoidBoneRole> = {
  hips: "hips",
  pelvis: "hips",
  spine: "spine",
  spine0: "spine",
  spine1: "spine1",
  chest: "spine1",
  spine2: "spine2",
  upperchest: "spine2",
  neck: "neck",
  neck1: "neck",
  head: "head",
  leftshoulder: "leftShoulder",
  leftclavicle: "leftShoulder",
  leftarm: "leftUpperArm",
  leftupperarm: "leftUpperArm",
  leftforearm: "leftForearm",
  leftlowerarm: "leftForearm",
  lefthand: "leftHand",
  leftupleg: "leftThigh",
  leftupperleg: "leftThigh",
  leftthigh: "leftThigh",
  leftleg: "leftCalf",
  leftlowerleg: "leftCalf",
  leftshin: "leftCalf",
  leftcalf: "leftCalf",
  leftfoot: "leftFoot",
  lefttoebase: "leftToe",
  lefttoe: "leftToe",
  lefttoe0: "leftToe",
  rightshoulder: "rightShoulder",
  rightclavicle: "rightShoulder",
  rightarm: "rightUpperArm",
  rightupperarm: "rightUpperArm",
  rightforearm: "rightForearm",
  rightlowerarm: "rightForearm",
  righthand: "rightHand",
  rightupleg: "rightThigh",
  rightupperleg: "rightThigh",
  rightthigh: "rightThigh",
  rightleg: "rightCalf",
  rightlowerleg: "rightCalf",
  rightshin: "rightCalf",
  rightcalf: "rightCalf",
  rightfoot: "rightFoot",
  righttoebase: "rightToe",
  righttoe: "rightToe",
  righttoe0: "rightToe",
};

const GENERIC_HUMANOID_TARGET_BONES: Partial<Record<GenericHumanoidBoneRole, string>> = {
  hips: "Bip001_Pelvis_03",
  spine: "Bip001_Spine_04",
  spine1: "Bip001_Spine1_05",
  spine2: "Bip001_Spine1_05",
  neck: "Bip001_Neck_06",
  head: "Bip001_Head_055",
  leftShoulder: "Bip001_L_Clavicle_07",
  leftUpperArm: "Bip001_L_UpperArm_08",
  leftForearm: "Bip001_L_Forearm_09",
  leftHand: "Bip001_L_Hand_010",
  leftThigh: "Bip001_L_Thigh_057",
  leftCalf: "Bip001_L_Calf_058",
  leftFoot: "Bip001_L_Foot_059",
  leftToe: "Bip001_L_Toe0_00",
  rightShoulder: "Bip001_R_Clavicle_031",
  rightUpperArm: "Bip001_R_UpperArm_032",
  rightForearm: "Bip001_R_Forearm_033",
  rightHand: "Bip001_R_Hand_034",
  rightThigh: "Bip001_R_Thigh_061",
  rightCalf: "Bip001_R_Calf_062",
  rightFoot: "Bip001_R_Foot_063",
  rightToe: "Bip001_R_Toe0_064",
};

const FINGER_TARGET_BONES: Record<HumanoidSide, Record<HumanoidFinger, readonly string[]>> = {
  left: {
    thumb: ["Bip001_L_Finger0_011", "Bones_L_Finger01_012", "Bones_L_Finger02_013"],
    index: ["Bones_L_Finger1_015", "Bones_L_Finger11_016", "Bones_L_Finger12_017"],
    middle: ["Bones_L_Finger2_019", "Bones_L_Finger21_020", "Bones_L_Finger22_021"],
    ring: ["Bones_L_Finger3_023", "Bones_L_Finger31_024", "Bones_L_Finger32_025"],
    pinky: ["Bones_L_Finger4_027", "Bones_L_Finger41_028", "Bones_L_Finger42_029"],
  },
  right: {
    thumb: ["Bip001_R_Finger0_035", "Bones_R_Finger01_036", "Bones_R_Finger02_037"],
    index: ["Bones_R_Finger1_039", "Bones_R_Finger11_040", "Bones_R_Finger12_041"],
    middle: ["Bones_R_Finger2_043", "Bones_R_Finger21_044", "Bones_R_Finger22_045"],
    ring: ["Bones_R_Finger3_047", "Bones_R_Finger31_048", "Bones_R_Finger32_049"],
    pinky: ["Bones_R_Finger4_051", "Bones_R_Finger41_052", "Bones_R_Finger42_053"],
  },
};

for (const side of ["left", "right"] as const) {
  for (const finger of ["thumb", "index", "middle", "ring", "pinky"] as const) {
    FINGER_TARGET_BONES[side][finger].forEach((targetName, index) => {
      const role = `${side}${finger[0].toUpperCase()}${finger.slice(1)}${index + 1}` as HumanoidFingerRole;
      GENERIC_HUMANOID_TARGET_BONES[role] = targetName;
    });
  }
}

const GENERIC_HUMANOID_TARGET_ROLES = new Map<string, GenericHumanoidBoneRole>();
Object.entries(GENERIC_HUMANOID_TARGET_BONES).forEach(([role, targetName]) => {
  if (targetName) GENERIC_HUMANOID_TARGET_ROLES.set(targetName, role as GenericHumanoidBoneRole);
});

function normalizeSourceBoneName(name: string) {
  const unqualifiedName = name.trim().split(/[|/]/).pop() ?? name;
  return unqualifiedName
    .replace(/^.*:/, "")
    .replace(/^(?:mixamorig\d*|armature)/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function capitalize<T extends string>(value: T): Capitalize<T> {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` as Capitalize<T>;
}

export function getGenericHumanoidBoneRole(name: string): GenericHumanoidBoneRole | null {
  const normalizedName = normalizeSourceBoneName(name);
  const bodyRole = BODY_ROLE_ALIASES[normalizedName];
  if (bodyRole) return bodyRole;

  const sideFirst = normalizedName.match(/^(left|right)(?:hand)?(thumb|index|middle|ring|pinky)([123])$/);
  if (sideFirst) {
    const [, side, finger, joint] = sideFirst as [string, HumanoidSide, HumanoidFinger, "1" | "2" | "3"];
    return `${side}${capitalize(finger)}${joint}` as HumanoidFingerRole;
  }

  const sideLast = normalizedName.match(/^(thumb|index|middle|ring|pinky)0?([123])([lr])$/);
  if (sideLast) {
    const [, finger, joint, sideAlias] = sideLast as [string, HumanoidFinger, "1" | "2" | "3", "l" | "r"];
    const side: HumanoidSide = sideAlias === "l" ? "left" : "right";
    return `${side}${capitalize(finger)}${joint}` as HumanoidFingerRole;
  }

  return null;
}

export function getGenericHumanoidTargetBoneName(sourceName: string) {
  const role = getGenericHumanoidBoneRole(sourceName);
  return role ? GENERIC_HUMANOID_TARGET_BONES[role] ?? null : null;
}

export function getGenericHumanoidTargetBoneRole(targetName: string) {
  return GENERIC_HUMANOID_TARGET_ROLES.get(targetName) ?? null;
}

function getNodeStructureScore(node: Object3D, role: GenericHumanoidBoneRole | null) {
  const descendantRoles = new Set<GenericHumanoidBoneRole>();
  node.traverse((descendant) => {
    if (descendant === node) return;
    const descendantRole = getGenericHumanoidBoneRole(descendant.name);
    if (descendantRole) descendantRoles.add(descendantRole);
  });

  let score = descendantRoles.size;
  if (role === "hips") {
    const directChildRoles = new Set(node.children.map((child) => getGenericHumanoidBoneRole(child.name)));
    for (const expectedRole of ["spine", "leftThigh", "rightThigh"] as const) {
      if (directChildRoles.has(expectedRole)) score += 100;
    }
  }
  return score;
}

export function findGenericHumanoidSourceNode(sourceScene: Object3D, sourceName: string) {
  const requestedRole = getGenericHumanoidBoneRole(sourceName);
  const requestedNormalizedName = normalizeSourceBoneName(sourceName);
  const candidates: Object3D[] = [];

  sourceScene.traverse((node) => {
    const matches = requestedRole
      ? getGenericHumanoidBoneRole(node.name) === requestedRole
      : normalizeSourceBoneName(node.name) === requestedNormalizedName;
    if (matches) candidates.push(node);
  });

  let best: Object3D | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = getNodeStructureScore(candidate, requestedRole);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
