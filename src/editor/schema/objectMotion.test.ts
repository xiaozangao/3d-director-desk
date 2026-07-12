import { describe, expect, it } from "vitest";
import type { DirectorObject } from "./directorProject";
import { getObjectMotionActionPresetId, getObjectMotionSnapshot, normalizeObjectMotionPath } from "./objectMotion";

function movingObject(): DirectorObject {
  return {
    id: "prop_1",
    name: "箱子",
    kind: "prop",
    visible: true,
    locked: false,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    motionPath: {
      interpolation: "smooth",
      keyframes: [
        { id: "move_1", time: 0, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        { id: "move_2", time: 1, transform: { position: [10, 2, -4], rotation: [0, Math.PI, 0], scale: [2, 2, 2] } },
      ],
    },
  };
}

describe("object motion path", () => {
  it("normalizes malformed persisted tracks", () => {
    expect(normalizeObjectMotionPath({ interpolation: "bad", keyframes: [null] })).toEqual({
      interpolation: "smooth",
      keyframes: [],
    });
  });

  it("interpolates position, rotation and scale on the shared normalized timeline", () => {
    const snapshot = getObjectMotionSnapshot(movingObject(), 0.5);

    expect(snapshot.position).toEqual([5, 1, -2]);
    expect(snapshot.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(snapshot.scale).toEqual([1.5, 1.5, 1.5]);
  });

  it("preserves exact first and last object transforms", () => {
    expect(getObjectMotionSnapshot(movingObject(), 0).position).toEqual([0, 0, 0]);
    expect(getObjectMotionSnapshot(movingObject(), 1).position).toEqual([10, 2, -4]);
  });

  it("faces a character toward the next route point and uses that point action", () => {
    const character = {
      ...movingObject(),
      kind: "character" as const,
      characterRig: { rigType: "ue4-mannequin" as const, posePresetId: "stand", controls: {} },
      motionPath: {
        interpolation: "linear" as const,
        keyframes: [
          { id: "route_1", time: 0, facingMode: "path" as const, actionPresetId: "walk-cycle", transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] } },
          { id: "route_2", time: 1, transform: { position: [4, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] } },
        ],
      },
    };

    expect(getObjectMotionSnapshot(character, .5).rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(getObjectMotionActionPresetId(character, .5)).toBe("walk-cycle");
  });
});
