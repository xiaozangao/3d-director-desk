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

export function getObjectMotionSnapshot(object: DirectorObject, progress: number): DirectorTransform {
  const path = normalizeObjectMotionPath(object.motionPath, object.transform);
  if (path.keyframes.length === 0) return cloneTransform(object.transform);
  const p = clamp(progress);
  const first = path.keyframes[0];
  const last = path.keyframes[path.keyframes.length - 1];
  if (p <= first.time) {
    const transform = cloneTransform(first.transform);
    const next = path.keyframes[1];
    if (object.kind === "character" && first.facingMode === "path" && next) {
      const dx = next.transform.position[0] - first.transform.position[0];
      const dz = next.transform.position[2] - first.transform.position[2];
      if (Math.hypot(dx, dz) > 0.0001) transform.rotation[1] = Math.atan2(dx, dz);
    }
    return transform;
  }
  if (p >= last.time) return cloneTransform(last.transform);

  let segment = 0;
  while (segment < path.keyframes.length - 2 && p > path.keyframes[segment + 1].time) segment += 1;
  const from = path.keyframes[segment];
  const to = path.keyframes[segment + 1];
  const raw = (p - from.time) / Math.max(0.000001, to.time - from.time);
  const local = path.interpolation === "smooth" ? raw * raw * (3 - 2 * raw) : raw;
  const mapTuple = (
    left: [number, number, number],
    right: [number, number, number],
    angle = false
  ) => left.map((value, axis) =>
    angle ? interpolateAngle(value, right[axis], local) : interpolate(value, right[axis], local)
  ) as [number, number, number];

  const rotation = mapTuple(from.transform.rotation, to.transform.rotation, true);
  if (object.kind === "character" && from.facingMode === "path") {
    const dx = to.transform.position[0] - from.transform.position[0];
    const dz = to.transform.position[2] - from.transform.position[2];
    if (Math.hypot(dx, dz) > 0.0001) {
      rotation[1] = Math.atan2(dx, dz);
    }
  }

  return {
    position: mapTuple(from.transform.position, to.transform.position),
    rotation,
    scale: mapTuple(from.transform.scale, to.transform.scale),
  };
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
