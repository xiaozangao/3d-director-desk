import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach } from "vitest";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";
import { ObjectMotionTransport } from "./ObjectMotionTransport";

beforeEach(() => {
  const initialState = createInitialDirectorState();
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...initialState,
    cameraMotionProgress: 0,
    cameraMotionPlaying: false,
    cameraPilotMode: "idle",
  });
});

it("shows a complete, accessible transport in the regular editor", () => {
  const state = useDirectorStore.getState();
  useDirectorStore.setState({
    ...state,
    selectedObjectId: "char_default_a",
    selectedObjectIds: ["char_default_a"],
    cameraMotionProgress: 0.25,
    project: {
      ...state.project,
      cameras: state.project.cameras.map((camera) => ({
        ...camera,
        motionPath: { ...camera.motionPath!, duration: 8 },
      })),
    },
  });

  render(<ObjectMotionTransport />);

  expect(screen.getByRole("region", { name: "人物和道具动作播放条" })).toBeInTheDocument();
  expect(screen.getByLabelText("当前动作对象")).toHaveTextContent("角色01");
  expect(screen.getByRole("button", { name: "回到动作开头" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "还没有可播放的人物和物品动作" })).toBeDisabled();
  expect(screen.getByRole("slider", { name: "场景动作时间轴" })).toHaveValue("0.25");
  expect(screen.getByLabelText("当前动作时间")).toHaveTextContent("2.0 秒");
  expect(screen.getByRole("spinbutton", { name: "动作总时长（秒）" })).toHaveValue(8);
  expect(screen.getByText("路线点、每段动作和朝向请在右侧“路线”页编辑")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除角色01当前路线点" })).toBeDisabled();
});

it("lets users change the shared action duration up to 30 seconds from the bottom transport", () => {
  render(<ObjectMotionTransport />);

  const durationInput = screen.getByRole("spinbutton", { name: "动作总时长（秒）" });
  expect(durationInput).toHaveValue(6);

  fireEvent.change(durationInput, { target: { value: "30" } });

  expect(useDirectorStore.getState().project.cameras[0].motionPath?.duration).toBe(30);
  expect(durationInput).toHaveValue(30);
});

it("plays and scrubs a camera-only shot, pausing as soon as the timeline is dragged", async () => {
  const user = userEvent.setup();
  const state = useDirectorStore.getState();
  useDirectorStore.setState({
    ...state,
    cameraMotionPlaying: true,
    project: {
      ...state.project,
      cameras: state.project.cameras.map((camera) => ({
        ...camera,
        motionPath: {
          ...camera.motionPath!,
          keyframes: [
            { id: "shot_1", time: 0, position: [0, 2, 8], target: [0, 1, 0], fov: 50 },
            { id: "shot_2", time: 1, position: [4, 2, 4], target: [0, 1, 0], fov: 50 },
          ],
        },
      })),
    },
  });

  render(<ObjectMotionTransport />);

  const timeline = screen.getByRole("slider", { name: "场景动作时间轴" });
  fireEvent.change(timeline, { target: { value: "0.42" } });
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(false);
  expect(useDirectorStore.getState().cameraMotionProgress).toBe(0.42);

  await user.click(screen.getByRole("button", { name: "播放人物和物品动作" }));
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(true);
});

it("keeps character route editing out of the playback transport", () => {
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    selectedObjectId: "char_default_a",
    selectedObjectIds: ["char_default_a"],
  });

  render(<ObjectMotionTransport />);

  expect(screen.queryByRole("button", { name: /记录起点|记录当前位置/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除角色01当前路线点" })).toBeDisabled();
  expect(screen.getByText("路线点、每段动作和朝向请在右侧“路线”页编辑")).toBeInTheDocument();
});

it("controls global action playback and rewinds before replaying from the end", async () => {
  const user = userEvent.setup();
  useDirectorStore.getState().addObjectMotionKeyframe("char_default_a", 0);
  useDirectorStore.getState().updateObjectTransform("char_default_a", { position: [3, 0, 0] });
  useDirectorStore.getState().addObjectMotionKeyframe("char_default_a", 1);
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    cameraMotionProgress: 1,
  });

  render(<ObjectMotionTransport />);

  await user.click(screen.getByRole("button", { name: "播放人物和物品动作" }));
  expect(useDirectorStore.getState().cameraMotionProgress).toBe(0);
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(true);

  await user.click(screen.getByRole("button", { name: "暂停人物和物品动作" }));
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(false);

  useDirectorStore.getState().setCameraMotionProgress(0.6);
  await user.click(screen.getByRole("button", { name: "回到动作开头" }));
  expect(useDirectorStore.getState().cameraMotionProgress).toBe(0);
  expect(useDirectorStore.getState().cameraMotionPlaying).toBe(false);
});

it("shows only the compact playback controls while piloting", () => {
  useDirectorStore.getState().addObjectMotionKeyframe("char_default_a", 0);
  useDirectorStore.getState().updateObjectTransform("char_default_a", { position: [3, 0, 0] });
  useDirectorStore.getState().addObjectMotionKeyframe("char_default_a", 1);
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    cameraPilotMode: "pilot",
    cameraMotionProgress: 0.5,
  });

  render(<ObjectMotionTransport />);

  expect(screen.getByRole("region", { name: "掌镜人物和道具动作播放条" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "播放人物和物品动作" })).toBeInTheDocument();
  expect(screen.getByLabelText("当前动作时间")).toHaveTextContent("3.0 秒");
  expect(screen.getByLabelText("空格键播放或暂停")).toHaveTextContent("空格播放/暂停");
  expect(screen.queryByRole("slider", { name: "场景动作时间轴" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /记录起点|记录当前位置/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "回到动作开头" })).not.toBeInTheDocument();
});

it("keeps recording actions disabled until a character or prop is selected", () => {
  render(<ObjectMotionTransport />);

  expect(screen.getByLabelText("当前动作对象")).toHaveTextContent("请先选中人物或道具");
  expect(screen.getByRole("button", { name: "记录人物或道具动作点" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "删除当前动作点" })).toBeDisabled();
  expect(screen.getByRole("group", { name: "动作点" })).toHaveTextContent("选择对象后记录动作");
});
