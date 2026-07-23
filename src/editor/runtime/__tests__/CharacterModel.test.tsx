import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { CharacterModel } from "../CharacterModel";

vi.mock("../UE4MannequinModel", () => ({
  UE4MannequinModel: ({
    animationTimeSeconds,
    bodyType,
    externalAnimation,
  }: {
    animationTimeSeconds?: number;
    bodyType?: string;
    externalAnimation?: { url: string; clipName: string } | null;
  }) => externalAnimation?.clipName === "Broken" ? (() => {
    throw new Error("broken animation");
  })() : (
    <div
      data-animation-time={animationTimeSeconds}
      data-body-type={bodyType}
      data-external-animation-url={externalAnimation?.url}
      data-external-clip-name={externalAnimation?.clipName}
      data-testid="mock-ue4-mannequin"
    />
  ),
}));

vi.mock("../PrimitiveMannequin", () => ({
  PrimitiveMannequin: ({ bodyType }: { bodyType?: string }) => (
    <div data-body-type={bodyType} data-testid="mock-procedural-mannequin" />
  ),
}));

vi.mock("../MixamoCharacterModel", () => ({
  MixamoCharacterModel: ({
    actionPresetId,
    animationTimeSeconds,
    externalAnimation,
    url,
  }: {
    actionPresetId?: string | null;
    animationTimeSeconds?: number;
    externalAnimation?: { url: string; clipName: string } | null;
    url: string;
  }) => (
    <div
      data-action-preset-id={actionPresetId}
      data-animation-time={animationTimeSeconds}
      data-external-animation-url={externalAnimation?.url}
      data-external-clip-name={externalAnimation?.clipName}
      data-testid="mock-mixamo-character"
      data-url={url}
    />
  ),
}));

it("renders the built-in UE4 mannequin for generated director characters", () => {
  render(
    <CharacterModel
      bodyType="female"
      rigState={{
        rigType: "ue4-mannequin",
        posePresetId: "stand",
        controls: {},
      }}
    />
  );

  expect(screen.getByTestId("mock-ue4-mannequin")).toHaveAttribute("data-body-type", "female");
  expect(screen.queryByTestId("mock-procedural-mannequin")).not.toBeInTheDocument();
});

it("keeps the procedural mannequin fallback for non-UE4 rigs", () => {
  render(
    <CharacterModel
      bodyType="chibi"
      rigState={{
        rigType: "mannequin",
        posePresetId: "stand",
        controls: {},
      }}
    />
  );

  expect(screen.getByTestId("mock-procedural-mannequin")).toHaveAttribute("data-body-type", "chibi");
  expect(screen.queryByTestId("mock-ue4-mannequin")).not.toBeInTheDocument();
});

it("forwards the shared timeline time and action to Mixamo characters", () => {
  render(
    <CharacterModel
      actionPresetId="walk-cycle"
      animationTimeSeconds={2.75}
      assetUrl="/characters/remy.fbx"
      rigState={{
        rigType: "mixamo",
        posePresetId: "stand",
        controls: {},
      }}
    />
  );

  expect(screen.getByTestId("mock-mixamo-character")).toHaveAttribute("data-url", "/characters/remy.fbx");
  expect(screen.getByTestId("mock-mixamo-character")).toHaveAttribute("data-action-preset-id", "walk-cycle");
  expect(screen.getByTestId("mock-mixamo-character")).toHaveAttribute("data-animation-time", "2.75");
});

it("forwards an independently imported animation source to the character runtime", () => {
  render(
    <CharacterModel
      actionPresetId="imported-action:walk:clip_1"
      animationTimeSeconds={0.5}
      assetFormat="fbx"
      assetUrl="/characters/actor.fbx"
      externalAnimation={{ url: "/animations/walk.fbx", format: "fbx", clipName: "Walk" }}
      rigState={{ rigType: "mixamo", posePresetId: "stand", controls: {} }}
    />
  );

  expect(screen.getByTestId("mock-mixamo-character")).toHaveAttribute("data-external-animation-url", "/animations/walk.fbx");
  expect(screen.getByTestId("mock-mixamo-character")).toHaveAttribute("data-external-clip-name", "Walk");
});

it("forwards a Kimodo animation source to the built-in UE4 mannequin", () => {
  render(
    <CharacterModel
      actionPresetId="imported-action:kimodo:clip_1"
      animationTimeSeconds={0.75}
      externalAnimation={{ url: "/animations/kimodo.bvh", format: "bvh", clipName: "Kimodo wave", rigProfile: "soma" }}
      rigState={{ rigType: "ue4-mannequin", posePresetId: "stand", controls: {} }}
    />
  );

  expect(screen.getByTestId("mock-ue4-mannequin")).toHaveAttribute("data-animation-time", "0.75");
  expect(screen.getByTestId("mock-ue4-mannequin")).toHaveAttribute("data-external-animation-url", "/animations/kimodo.bvh");
  expect(screen.getByTestId("mock-ue4-mannequin")).toHaveAttribute("data-external-clip-name", "Kimodo wave");
});

it("recovers the character runtime when the user switches away from a broken animation", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { rerender } = render(
    <CharacterModel
      actionPresetId="imported-action:broken:clip_1"
      externalAnimation={{ url: "/animations/broken.fbx", format: "fbx", clipName: "Broken" }}
      rigState={{ rigType: "ue4-mannequin", posePresetId: "stand", controls: {} }}
    />
  );

  expect(screen.getByTestId("mock-procedural-mannequin")).toBeInTheDocument();
  rerender(
    <CharacterModel
      actionPresetId="imported-action:walk:clip_1"
      externalAnimation={{ url: "/animations/walk.fbx", format: "fbx", clipName: "Walk" }}
      rigState={{ rigType: "ue4-mannequin", posePresetId: "stand", controls: {} }}
    />
  );

  expect(screen.getByTestId("mock-ue4-mannequin")).toHaveAttribute("data-external-clip-name", "Walk");
  expect(screen.queryByTestId("mock-procedural-mannequin")).not.toBeInTheDocument();
  consoleError.mockRestore();
});
