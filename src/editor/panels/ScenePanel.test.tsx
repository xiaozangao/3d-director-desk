import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { ScenePanel } from "./ScenePanel";

beforeEach(() => {
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
  });
});

it("uses the provided right inspector layout for scene properties", () => {
  const { container } = render(<ScenePanel />);

  expect(screen.getByLabelText("3D场景右侧属性面板")).toHaveClass("right-inspector", "scene-inspector");
  expect(container.querySelector(".right-inspector-header")).toBeInTheDocument();
  expect(container.querySelector(".right-inspector-content")).toBeInTheDocument();
  expect(screen.getByLabelText("场景平移 X").closest(".inspector-axis-input")).toBeInTheDocument();
});

it("lays scene switches out in one row and only toggles from the checkbox", async () => {
  const user = userEvent.setup();
  const { container } = render(<ScenePanel />);

  const switchRow = container.querySelector(".scene-switch-row");
  const labelText = screen.getByText("角色标签");
  const checkbox = screen.getByLabelText("角色标签");

  expect(switchRow).toBeInTheDocument();
  expect(switchRow?.querySelectorAll(".inspector-toggle-row")).toHaveLength(4);
  expect(checkbox).toBeChecked();

  await user.click(labelText);

  expect(checkbox).toBeChecked();

  await user.click(checkbox);

  expect(checkbox).not.toBeChecked();
});

it("updates scene transform, background, switches, and ground controls", async () => {
  const user = userEvent.setup();
  render(<ScenePanel />);

  await user.clear(screen.getByLabelText("场景缩放"));
  await user.type(screen.getByLabelText("场景缩放"), "1.3");
  await user.clear(screen.getByLabelText("场景平移 Y"));
  await user.type(screen.getByLabelText("场景平移 Y"), "2");
  await user.clear(screen.getByLabelText("场景旋转 Z"));
  await user.type(screen.getByLabelText("场景旋转 Z"), "45");
  await user.clear(screen.getByLabelText("天空颜色 HEX"));
  await user.type(screen.getByLabelText("天空颜色 HEX"), "#123456");
  await user.click(screen.getByLabelText("角色标签"));
  await user.click(screen.getByLabelText("网格吸附"));
  await user.click(screen.getByLabelText("路径碰撞"));
  await user.clear(screen.getByLabelText("地面透明度"));
  await user.type(screen.getByLabelText("地面透明度"), "0.65");
  await user.clear(screen.getByLabelText("地面高度"));
  await user.type(screen.getByLabelText("地面高度"), "1.2");

  const scene = useDirectorStore.getState().project.scene;
  expect(scene.scale).toBe(1.3);
  expect(scene.position).toEqual([0, 2, 0]);
  expect(scene.rotation).toEqual([0, 0, 45]);
  expect(scene.backgroundColor).toBe("#123456");
  expect(scene.showLabels).toBe(false);
  expect(scene.snapToGrid).toBe(true);
  expect(scene.pathCollisionEnabled).toBe(true);
  expect(scene.groundOpacity).toBe(0.65);
  expect(scene.groundHeight).toBe(1.2);
});

it("hides ground opacity and height controls when ground is disabled", async () => {
  const user = userEvent.setup();
  render(<ScenePanel />);

  expect(screen.getByLabelText("地面透明度")).toBeInTheDocument();
  expect(screen.getByLabelText("地面高度")).toBeInTheDocument();

  await user.click(screen.getByLabelText("地面"));

  expect(screen.queryByLabelText("地面透明度")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("地面高度")).not.toBeInTheDocument();
});

it("updates scene scale from both slider and numeric input", async () => {
  const user = userEvent.setup();
  render(<ScenePanel />);

  expect(screen.getByLabelText("场景缩放滑杆")).toHaveValue("1");

  await user.clear(screen.getByLabelText("场景缩放"));
  await user.type(screen.getByLabelText("场景缩放"), "1.35");

  expect(useDirectorStore.getState().project.scene.scale).toBe(1.35);
  expect(screen.getByLabelText("场景缩放滑杆")).toHaveValue("1.35");

  fireEvent.change(screen.getByLabelText("场景缩放滑杆"), { target: { value: "1.8" } });

  expect(useDirectorStore.getState().project.scene.scale).toBe(1.8);
  expect(screen.getByLabelText("场景缩放")).toHaveValue(1.8);
});

it("keeps the axis drag affordance visible while dragging values", () => {
  render(<ScenePanel />);

  const xDragHandle = screen.getByLabelText("场景平移 X 拖动调整");
  const axisInput = xDragHandle.closest(".inspector-axis-input");

  expect(xDragHandle).not.toHaveClass("is-dragging");
  expect(axisInput).not.toHaveClass("is-dragging");

  fireEvent.mouseDown(xDragHandle, { button: 0, clientX: 100 });

  expect(xDragHandle).not.toHaveClass("is-dragging");
  expect(axisInput).toHaveClass("is-dragging");

  fireEvent.mouseMove(window, { clientX: 120 });

  expect(useDirectorStore.getState().project.scene.position[0]).toBe(0.2);

  fireEvent.mouseUp(window);

  expect(xDragHandle).not.toHaveClass("is-dragging");
  expect(axisInput).not.toHaveClass("is-dragging");
});

it("keeps the XYZ drag handle width stable while dragging", () => {
  render(<ScenePanel />);

  const xDragHandle = screen.getByLabelText("场景平移 X 拖动调整");
  const widthBeforeDrag = getComputedStyle(xDragHandle).width;

  fireEvent.mouseDown(xDragHandle, { button: 0, clientX: 100 });
  const widthDuringDrag = getComputedStyle(xDragHandle).width;
  fireEvent.mouseMove(window, { clientX: 120 });
  fireEvent.mouseUp(window);

  expect(widthDuringDrag).toBe(widthBeforeDrag);
});

it("keeps the XYZ drag handle visuals stable while dragging", () => {
  render(<ScenePanel />);

  const xDragHandle = screen.getByLabelText("场景平移 X 拖动调整");
  const backgroundBeforeDrag = getComputedStyle(xDragHandle).backgroundColor;
  const colorBeforeDrag = getComputedStyle(xDragHandle).color;

  fireEvent.mouseDown(xDragHandle, { button: 0, clientX: 100 });

  const backgroundDuringDrag = getComputedStyle(xDragHandle).backgroundColor;
  const colorDuringDrag = getComputedStyle(xDragHandle).color;

  fireEvent.mouseUp(window);

  expect(backgroundDuringDrag).toBe(backgroundBeforeDrag);
  expect(colorDuringDrag).toBe(colorBeforeDrag);
});

it("keeps the XYZ drag handle focused instead of moving focus into the number input", () => {
  render(<ScenePanel />);

  const xDragHandle = screen.getByLabelText("场景平移 X 拖动调整");
  const xInput = screen.getByLabelText("场景平移 X");

  fireEvent.mouseDown(xDragHandle, { button: 0, clientX: 100 });

  expect(document.activeElement).toBe(xDragHandle);
  expect(document.activeElement).not.toBe(xInput);

  fireEvent.mouseUp(window);
});

it("renders the XYZ drag handle inside the 80px axis input shell", () => {
  render(<ScenePanel />);

  const xDragHandle = screen.getByLabelText("场景平移 X 拖动调整");
  const axisInput = xDragHandle.closest(".inspector-axis-input");
  const valueInput = screen.getByLabelText("场景平移 X");

  expect(axisInput).toBeInTheDocument();
  expect(axisInput).toHaveClass("inspector-axis-input");
  expect(valueInput.closest(".inspector-axis-input")).toBe(axisInput);
});
