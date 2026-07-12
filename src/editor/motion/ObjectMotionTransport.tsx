import {
  MapPinPlus,
  Package,
  Pause,
  PersonStanding,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { DEFAULT_CAMERA_MOTION_PATH, getCameraMotionPath } from "../schema/cameraMotion";
import { normalizeObjectMotionPath } from "../schema/objectMotion";
import { useDirectorStore } from "../store/directorStore";
import "./objectMotionTransport.css";

const CURRENT_KEYFRAME_TOLERANCE = 0.005;

function formatSeconds(seconds: number) {
  return `${seconds.toFixed(1)} 秒`;
}

/**
 * A shared transport for all character and prop animation.
 *
 * Object motion and camera motion intentionally use the same normalized
 * progress value so a director can pause the cast, adjust the shot, and
 * continue without losing sync.
 */
export function ObjectMotionTransport() {
  const progress = useDirectorStore((state) => state.cameraMotionProgress);
  const playing = useDirectorStore((state) => state.cameraMotionPlaying);
  const pilotMode = useDirectorStore((state) => state.cameraPilotMode);
  const selectedObjectId = useDirectorStore((state) => state.selectedObjectId);
  const objects = useDirectorStore((state) => state.project.objects);
  const activeCamera = useDirectorStore((state) =>
    state.project.cameras.find((camera) => camera.id === state.project.activeCameraId)
      ?? state.project.cameras[0]
  );
  const addObjectMotionKeyframe = useDirectorStore((state) => state.addObjectMotionKeyframe);
  const deleteObjectMotionKeyframe = useDirectorStore((state) => state.deleteObjectMotionKeyframe);
  const selectObjectMotionKeyframe = useDirectorStore((state) => state.selectObjectMotionKeyframe);
  const setProgress = useDirectorStore((state) => state.setCameraMotionProgress);
  const setPlaying = useDirectorStore((state) => state.setCameraMotionPlaying);
  const updateCameraMotionPath = useDirectorStore((state) => state.updateCameraMotionPath);

  const duration = activeCamera
    ? getCameraMotionPath(activeCamera).duration
    : DEFAULT_CAMERA_MOTION_PATH.duration;
  const currentSeconds = progress * duration;
  const isPiloting = pilotMode !== "idle";
  const selectedObject = objects.find(
    (object) => object.id === selectedObjectId && (object.kind === "character" || object.kind === "prop")
  );
  const keyframes = selectedObject
    ? normalizeObjectMotionPath(selectedObject.motionPath, selectedObject.transform).keyframes
    : [];
  const hasPlayableObjectMotion =
    (activeCamera?.motionPath?.keyframes.length ?? 0) >= 2
    || objects.some(
      (object) => (object.motionPath?.keyframes?.length ?? 0) >= 2 || Boolean(object.characterRig?.actionPresetId)
    );
  const currentKeyframe = keyframes.find(
    (keyframe) => Math.abs(keyframe.time - progress) <= CURRENT_KEYFRAME_TOLERANCE
  );
  const isAtStart = progress <= CURRENT_KEYFRAME_TOLERANCE;
  const isCharacterRoute = selectedObject?.kind === "character";
  const pointLabel = isCharacterRoute ? "路线点" : "动作点";
  const recordLabel = isAtStart ? "记录起点" : "记录当前位置";

  function togglePlayback() {
    if (!hasPlayableObjectMotion) return;
    if (playing) {
      setPlaying(false);
      return;
    }

    if (progress >= 1 - CURRENT_KEYFRAME_TOLERANCE) {
      setProgress(0);
    }
    setPlaying(true);
  }

  function seek(nextProgress: number) {
    setPlaying(false);
    setProgress(nextProgress);
  }

  if (isPiloting) {
    return (
      <section
        className="object-motion-transport object-motion-transport--pilot"
        aria-label="掌镜人物和道具动作播放条"
      >
        <button
          className="object-motion-transport__play object-motion-transport__play--compact"
          type="button"
          disabled={!hasPlayableObjectMotion}
          aria-label={hasPlayableObjectMotion
            ? playing ? "暂停人物和物品动作" : "播放人物和物品动作"
            : "还没有可播放的人物和物品动作"}
          aria-pressed={playing}
          onClick={togglePlayback}
        >
          {playing ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
        </button>
        <output className="object-motion-transport__compact-time" aria-label="当前动作时间">
          {formatSeconds(currentSeconds)}
        </output>
        <span className="object-motion-transport__shortcut" aria-label="空格键播放或暂停">
          <kbd>空格</kbd>
          播放/暂停
        </span>
      </section>
    );
  }

  const objectKindLabel = selectedObject?.kind === "character" ? "人物" : "道具";

  return (
    <section
      className="object-motion-transport object-motion-transport--full"
      aria-label="人物和道具动作播放条"
    >
      <div className="object-motion-transport__subject" aria-label="当前动作对象">
        <span className="object-motion-transport__subject-icon" aria-hidden="true">
          {selectedObject?.kind === "character"
            ? <PersonStanding size={17} />
            : <Package size={17} />}
        </span>
        <span className="object-motion-transport__subject-copy">
          <small>{selectedObject ? isCharacterRoute ? "人物路线播放" : `${objectKindLabel}动作` : "人物 / 道具动作"}</small>
          <strong title={selectedObject?.name}>
            {selectedObject?.name ?? "请先选中人物或道具"}
          </strong>
        </span>
      </div>

      <div className="object-motion-transport__player" aria-label="动作播放控制">
        <button
          className="object-motion-transport__icon-button"
          type="button"
          aria-label="回到动作开头"
          onClick={() => seek(0)}
        >
          <RotateCcw aria-hidden="true" size={15} />
        </button>
        <button
          className="object-motion-transport__play"
          type="button"
          disabled={!hasPlayableObjectMotion}
          aria-label={hasPlayableObjectMotion
            ? playing ? "暂停人物和物品动作" : "播放人物和物品动作"
            : "还没有可播放的人物和物品动作"}
          aria-pressed={playing}
          onClick={togglePlayback}
        >
          {playing ? <Pause aria-hidden="true" size={17} /> : <Play aria-hidden="true" size={17} />}
        </button>
        <output className="object-motion-transport__time" aria-label="当前动作时间">
          {formatSeconds(currentSeconds)}
        </output>
        <input
          className="object-motion-transport__scrubber"
          aria-label="场景动作时间轴"
          aria-valuetext={`${formatSeconds(currentSeconds)}，共 ${formatSeconds(duration)}`}
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={progress}
          onChange={(event) => seek(Number(event.currentTarget.value))}
        />
        <label className="object-motion-transport__duration-control">
          <span>总时长</span>
          <input
            aria-label="动作总时长（秒）"
            type="number"
            min="0.5"
            max="30"
            step="0.5"
            value={duration}
            onChange={(event) => {
              if (!activeCamera) return;
              updateCameraMotionPath(activeCamera.id, { duration: Number(event.currentTarget.value) });
            }}
          />
          <span>秒</span>
        </label>
      </div>

      <div className="object-motion-transport__editor">
        {!isCharacterRoute ? <>
          <button
            className="object-motion-transport__record"
            type="button"
            disabled={!selectedObject}
            aria-label={selectedObject ? `${recordLabel}：${selectedObject.name}` : "记录人物或道具动作点"}
            onClick={() => {
              if (!selectedObject) return;
              setPlaying(false);
              const recorded = addObjectMotionKeyframe(selectedObject.id, progress);
              if (recorded) selectObjectMotionKeyframe(recorded);
            }}
          >
            <MapPinPlus aria-hidden="true" size={15} />
            {recordLabel}
          </button>
          <div
            className="object-motion-transport__keyframes"
            role="group"
            aria-label={selectedObject ? `${selectedObject.name}动作点` : "动作点"}
          >
            {keyframes.length > 0 ? keyframes.map((keyframe, index) => {
            const isCurrent = keyframe.id === currentKeyframe?.id;
            return (
              <button
                key={keyframe.id}
                className={isCurrent ? "is-current" : undefined}
                type="button"
                aria-label={`跳转到${selectedObject?.name ?? "对象"}${pointLabel} ${index + 1}`}
                aria-pressed={isCurrent}
                title={`${formatSeconds(keyframe.time * duration)} · ${pointLabel} ${index + 1}`}
                onClick={() => {
                  selectObjectMotionKeyframe(keyframe.id);
                  seek(keyframe.time);
                }}
              >
                {index + 1}
              </button>
            );
            }) : (
              <small>{selectedObject ? "还没有动作点" : "选择对象后记录动作"}</small>
            )}
          </div>
        </> : <span className="object-motion-transport__route-hint">路线点、每段动作和朝向请在右侧“路线”页编辑</span>}

        <button
          className="object-motion-transport__delete"
          type="button"
          disabled={isCharacterRoute || !selectedObject || !currentKeyframe}
          aria-label={selectedObject ? `删除${selectedObject.name}当前${pointLabel}` : "删除当前动作点"}
          onClick={() => {
            if (!selectedObject || !currentKeyframe) return;
            setPlaying(false);
            deleteObjectMotionKeyframe(selectedObject.id, currentKeyframe.id);
            selectObjectMotionKeyframe(null);
          }}
        >
          <Trash2 aria-hidden="true" size={14} />
          <span>删除当前点</span>
        </button>
      </div>
    </section>
  );
}
