import type {
  DirectorObject,
  DirectorObjectMotionKeyframe,
  DirectorObjectMotionPath,
  DirectorTransform,
} from "./directorProject";

export const DEFAULT_OBJECT_MOTION_PATH: DirectorObjectMotionPath = {
  interpolation: "smooth",
  keyframes: [],
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function tuple(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return [finite(value[0], fallback[0]), finite(value[1], fallback[1]), finite(value[2], fallback[2])];
}

function normalizeTransform(value: unknown, fallback: DirectorTransform): DirectorTransform {
  if (!value || typeof value !== "object") {
    return {
      position: [...fallback.position],
      rotation: [...fallback.rotation],
      scale: [...fallback.scale],
    };
  }
  const transform = value as Partial<DirectorTransform>;
  return {
    position: tuple(transform.position, fallback.position),
    rotation: tuple(transform.rotation, fallback.rotation),
    scale: tuple(transform.scale, fallback.scale),
  };
}

const FALLBACK_TRANSFORM: DirectorTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

export function normalizeObjectMotionPath(
  value: unknown,
  fallbackTransform: DirectorTransform = FALLBACK_TRANSFORM
): DirectorObjectMotionPath {
  if (!value || typeof value !== "object") return { ...DEFAULT_OBJECT_MOTION_PATH, keyframes: [] };
  const path = value as Partial<DirectorObjectMotionPath>;
  const keyframes = Array.isArray(path.keyframes)
    ? path.keyframes
        .map((entry, index): DirectorObjectMotionKeyframe | null => {
          if (!entry || typeof entry !== "object") return null;
          const keyframe = entry as Partial<DirectorObjectMotionKeyframe>;
          return {
            id: typeof keyframe.id === "string" && keyframe.id ? keyframe.id : `object_motion_${index + 1}`,
            time: clamp(finite(keyframe.time, index)),
            transform: normalizeTransform(keyframe.transform, fallbackTransform),
            actionPresetId: typeof keyframe.actionPresetId === "string" ? keyframe.actionPresetId : null,
            facingMode: keyframe.facingMode === "path" ? "path" : "manual",
          };
        })
        .filter((entry): entry is DirectorObjectMotionKeyframe => Boolean(entry))
        .sort((a, b) => a.time - b.time)
    : [];

  return {
    interpolation: path.interpolation === "linear" ? "linear" : "smooth",
    keyframes,
  };
}

function interpolate(a: number, b: number, progress: number) {
  return a + (b - a) * progress;
}

function catmullRom(a: number, b: number, c: number, d: number, progress: number) {
  const t2 = progress * progress;
  const t3 = t2 * progress;
  return 0.5 * (
    2 * b
    + (-a + c) * progress
    + (2 * a - 5 * b + 4 * c - d) * t2
    + (-a + 3 * b - 3 * c + d) * t3
  );
}

function interpolateAngle(a: number, b: number, progress: number) {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * progress;
}

function cloneTransform(transform: DirectorTransform): DirectorTransform {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

function findMotionSegment(path: DirectorObjectMotionPath, progress: number) {
  const p = clamp(progress);
  let segment = 0;
  while (segment < path.keyframes.length - 2 && p > path.keyframes[segment + 1].time) segment += 1;
  const from = path.keyframes[segment];
  const to = path.keyframes[Math.min(path.keyframes.length - 1, segment + 1)];
  const local = clamp((p - from.time) / Math.max(0.000001, to.time - from.time));
  return { from, local, segment, to };
}

function samplePosition(path: DirectorObjectMotionPath, progress: number): [number, number, number] {
  const first = path.keyframes[0];
  const last = path.keyframes[path.keyframes.length - 1];
  if (progress <= first.time) return [...first.transform.position];
  if (progress >= last.time) return [...last.transform.position];
  const { from, local, segment, to } = findMotionSegment(path, progress);
  if (path.interpolation === "linear" || path.keyframes.length < 3) {
    return from.transform.position.map((value, axis) =>
      interpolate(value, to.transform.position[axis], local)
    ) as [number, number, number];
  }
  const before = path.keyframes[Math.max(0, segment - 1)];
  const after = path.keyframes[Math.min(path.keyframes.length - 1, segment + 2)];
  return ([0, 1, 2] as const).map((axis) => catmullRom(
    before.transform.position[axis],
    from.transform.position[axis],
    to.transform.position[axis],
    after.transform.position[axis],
    local
  )) as [number, number, number];
}

function getPathFacingYaw(path: DirectorObjectMotionPath, progress: number) {
  const epsilon = 0.001;
  const before = samplePosition(path, Math.max(path.keyframes[0].time, progress - epsilon));
  const after = samplePosition(path, Math.min(path.keyframes[path.keyframes.length - 1].time, progress + epsilon));
  const dx = after[0] - before[0];
  const dz = after[2] - before[2];
  return Math.hypot(dx, dz) > 0.000001 ? Math.atan2(dx, dz) : null;
}

export function getObjectMotionSnapshot(object: DirectorObject, progress: number): DirectorTransform {
  const path = normalizeObjectMotionPath(object.motionPath, object.transform);
  if (path.keyframes.length === 0) return cloneTransform(object.transform);
  const p = clamp(progress);
  const first = path.keyframes[0];
  const last = path.keyframes[path.keyframes.length - 1];
  if (p <= first.time) {
    const transform = cloneTransform(first.transform);
    const yaw = object.kind === "character" && first.facingMode === "path" ? getPathFacingYaw(path, first.time) : null;
    if (yaw != null) transform.rotation[1] = yaw;
    return transform;
  }
  if (p >= last.time) {
    const transform = cloneTransform(last.transform);
    const previous = path.keyframes[path.keyframes.length - 2];
    const yaw = object.kind === "character" && previous?.facingMode === "path" ? getPathFacingYaw(path, last.time) : null;
    if (yaw != null) transform.rotation[1] = yaw;
    return transform;
  }

  const { from, local, to } = findMotionSegment(path, p);
  const mapTuple = (
    left: [number, number, number],
    right: [number, number, number],
    angle = false
  ) => left.map((value, axis) =>
    angle ? interpolateAngle(value, right[axis], local) : interpolate(value, right[axis], local)
  ) as [number, number, number];

  const rotation = mapTuple(from.transform.rotation, to.transform.rotation, true);
  if (object.kind === "character" && from.facingMode === "path") {
    const yaw = getPathFacingYaw(path, p);
    if (yaw != null) rotation[1] = yaw;
  }

  return {
    position: samplePosition(path, p),
    rotation,
    scale: mapTuple(from.transform.scale, to.transform.scale),
  };
}

export function sampleObjectMotionPath(object: DirectorObject, count = 80) {
  const path = normalizeObjectMotionPath(object.motionPath, object.transform);
  if (path.keyframes.length === 0) return [object.transform.position];
  if (path.keyframes.length === 1 || count < 2) return [path.keyframes[0].transform.position];
  const start = path.keyframes[0].time;
  const end = path.keyframes[path.keyframes.length - 1].time;
  return Array.from({ length: count }, (_, index) =>
    samplePosition(path, start + (end - start) * (index / (count - 1)))
  );
}

export function getObjectMotionActionPresetId(object: DirectorObject, progress: number) {
  const path = normalizeObjectMotionPath(object.motionPath, object.transform);
  if (path.keyframes.length === 0) return object.characterRig?.actionPresetId ?? null;
  const p = clamp(progress);
  let index = 0;
  while (index < path.keyframes.length - 2 && p >= path.keyframes[index + 1].time) index += 1;
  return path.keyframes[index]?.actionPresetId ?? null;
}

export function getObjectMotionSpeed(object: DirectorObject, progress: number) {
  const before = getObjectMotionSnapshot(object, Math.max(0, progress - 0.002));
  const after = getObjectMotionSnapshot(object, Math.min(1, progress + 0.002));
  return Math.hypot(
    after.position[0] - before.position[0],
    after.position[1] - before.position[1],
    after.position[2] - before.position[2]
  ) / 0.004;
}
