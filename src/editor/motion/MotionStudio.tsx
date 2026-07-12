import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Download,
  Gauge,
  MousePointer2,
  Move3D,
  Pause,
  Play,
  Plus,
  Route,
  SlidersHorizontal,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { requestReferenceVideoExport, type ReferenceVideoExportQuality } from "../io/referenceVideoExport";
import { getCameraMotionPath } from "../schema/cameraMotion";
import {
  getAnimatedCameraFocusTarget,
  getDirectorObjectFocusTarget,
  isCameraFocusableObject,
} from "../schema/cameraTarget";
import { getObjectMotionSnapshot } from "../schema/objectMotion";
import type { CameraShotSnapshot } from "../store/directorStore";
import { useDirectorStore } from "../store/directorStore";
import {
  CAMERA_MOTION_PRESETS,
  findMatchingCameraMotionPreset,
  getCameraMotionPresetPatch,
} from "./cameraMotionPresets";

export function getActiveCameraWaypointIndex(progress: number, times: number[]) {
  if (times.length === 0) return -1;
  let active = 0;
  for (let index = 1; index < times.length; index += 1) {
    if (progress + 0.0001 < times[index]) break;
    active = index;
  }
  return active;
}

export function MotionStudio({
  getViewportCameraSnapshot,
  onLoadCameraSnapshot,
  onStartPilot,
}: {
  getViewportCameraSnapshot: () => CameraShotSnapshot;
  onLoadCameraSnapshot?: (snapshot: CameraShotSnapshot) => void;
  onStartPilot?: (editKeyframeId?: string | null) => void;
}) {
  const open = useDirectorStore((state) => state.motionStudioOpen);
  const viewMode = useDirectorStore((state) => state.viewMode);
  const cameraPilotMode = useDirectorStore((state) => state.cameraPilotMode);
  const activeCamera = useDirectorStore((state) =>
    state.project.cameras.find((item) => item.id === state.project.activeCameraId) ?? state.project.cameras[0]
  );
  const selectedCameraKeyframeId = useDirectorStore((state) => state.selectedCameraKeyframeId);
  const selectedCameraKeyframeIds = useDirectorStore((state) => state.selectedCameraKeyframeIds);
  const cameraMotionProgress = useDirectorStore((state) => state.cameraMotionProgress);
  const cameraMotionPlaying = useDirectorStore((state) => state.cameraMotionPlaying);
  const cameraPilotFollowTarget = useDirectorStore((state) => state.cameraPilotFollowTarget);
  const sceneObjects = useDirectorStore((state) => state.project.objects);
  const setMotionStudioOpen = useDirectorStore((state) => state.setMotionStudioOpen);
  const setViewMode = useDirectorStore((state) => state.setViewMode);
  const ensureMotionCamera = useDirectorStore((state) => state.ensureMotionCamera);
  const startCameraPilot = useDirectorStore((state) => state.startCameraPilot);
  const recordCameraMotionSnapshot = useDirectorStore((state) => state.recordCameraMotionSnapshot);
  const selectCameraMotionKeyframe = useDirectorStore((state) => state.selectCameraMotionKeyframe);
  const setCameraMotionKeyframeSelection = useDirectorStore((state) => state.setCameraMotionKeyframeSelection);
  const setCameraMotionProgress = useDirectorStore((state) => state.setCameraMotionProgress);
  const setCameraMotionPlaying = useDirectorStore((state) => state.setCameraMotionPlaying);
  const updateCameraMotionPath = useDirectorStore((state) => state.updateCameraMotionPath);
  const updateCameraMotionKeyframe = useDirectorStore((state) => state.updateCameraMotionKeyframe);
  const deleteCameraMotionKeyframe = useDirectorStore((state) => state.deleteCameraMotionKeyframe);
  const moveCameraMotionKeyframe = useDirectorStore((state) => state.moveCameraMotionKeyframe);
  const insertCameraMotionKeyframeAfter = useDirectorStore((state) => state.insertCameraMotionKeyframeAfter);
  const setCameraPilotFollowTarget = useDirectorStore((state) => state.setCameraPilotFollowTarget);
  const beginUndoBatch = useDirectorStore((state) => state.beginUndoBatch);
  const endUndoBatch = useDirectorStore((state) => state.endUndoBatch);
  const [batchSelectionEnabled, setBatchSelectionEnabled] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFps, setExportFps] = useState(30);
  const [exportQuality, setExportQuality] = useState<ReferenceVideoExportQuality>("720p");
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [arrivalTimeDraft, setArrivalTimeDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    ensureMotionCamera(getViewportCameraSnapshot());
  }, [ensureMotionCamera, open]);

  const activeMotionPath = activeCamera ? getCameraMotionPath(activeCamera) : null;
  const activeSelectedKeyframe = activeMotionPath?.keyframes.find((item) => item.id === selectedCameraKeyframeId) ?? null;

  useEffect(() => {
    setArrivalTimeDraft(
      activeSelectedKeyframe && activeMotionPath
        ? (activeSelectedKeyframe.time * activeMotionPath.duration).toFixed(1)
        : ""
    );
  }, [activeMotionPath?.duration, activeSelectedKeyframe?.id, activeSelectedKeyframe?.time]);

  if (!open || !activeCamera) return null;

  const motionPath = activeMotionPath!;
  const trackableObjects = sceneObjects.filter(isCameraFocusableObject);
  const canPlay = motionPath.keyframes.length >= 2 || sceneObjects.some((item) => (item.motionPath?.keyframes?.length ?? 0) >= 2);
  const selectedKeyframe = motionPath.keyframes.find((item) => item.id === selectedCameraKeyframeId) ?? null;
  const trackingObjectId = selectedKeyframe?.targetMode === "object"
    ? selectedKeyframe.targetObjectId ?? ""
    : "";
  const matchingPreset = findMatchingCameraMotionPreset(motionPath);
  const activeIndex = getActiveCameraWaypointIndex(
    cameraMotionProgress,
    motionPath.keyframes.map((item) => item.time)
  );
  const timelinePreviewActive = cameraMotionPlaying || cameraMotionProgress > 0.0001;

  function addCurrentView() {
    recordCameraMotionSnapshot(activeCamera.id, getViewportCameraSnapshot());
  }

  function selectWaypoint(id: string, time: number) {
    if (batchSelectionEnabled) {
      const nextSelection = selectedCameraKeyframeIds.includes(id)
        ? selectedCameraKeyframeIds.filter((item) => item !== id)
        : [...selectedCameraKeyframeIds, id];
      setCameraMotionKeyframeSelection(nextSelection);
      if (nextSelection.includes(id)) setCameraMotionProgress(time);
      return;
    }
    selectCameraMotionKeyframe(id);
    setCameraMotionProgress(time);
    setCameraMotionPlaying(false);
  }

  function toggleBatchSelection() {
    if (batchSelectionEnabled) {
      selectCameraMotionKeyframe(selectedCameraKeyframeId);
      setBatchSelectionEnabled(false);
      return;
    }
    setBatchSelectionEnabled(true);
  }

  function setTrackingObject(objectId: string) {
    if (!selectedKeyframe) return;
    if (!objectId) {
      const currentTrackingTarget = getAnimatedCameraFocusTarget(
        activeCamera,
        sceneObjects,
        selectedKeyframe.time
      );
      updateCameraMotionKeyframe(activeCamera.id, selectedKeyframe.id, {
        targetMode: "manual",
        targetObjectId: null,
        target: currentTrackingTarget ?? selectedKeyframe.target,
      });
      return;
    }

    const targetObject = trackableObjects.find((object) => object.id === objectId);
    if (!targetObject) return;
    const target = getDirectorObjectFocusTarget({
      ...targetObject,
      transform: getObjectMotionSnapshot(targetObject, selectedKeyframe.time),
    });
    updateCameraMotionKeyframe(activeCamera.id, selectedKeyframe.id, {
      targetMode: "object",
      targetObjectId: targetObject.id,
      target,
    });
  }

  function applyMotionPreset(presetId: string) {
    const patch = getCameraMotionPresetPatch(presetId);
    if (patch) updateCameraMotionPath(activeCamera.id, patch);
  }

  function editSelectedWaypoint() {
    if (!selectedKeyframe) return;
    onLoadCameraSnapshot?.({
      position: [...selectedKeyframe.position],
      target: [...selectedKeyframe.target],
      fov: selectedKeyframe.fov,
    });
    if (onStartPilot) {
      onStartPilot(selectedKeyframe.id);
    } else {
      startCameraPilot("pilot", selectedKeyframe.id);
    }
  }

  function previewInView(mode: "director" | "camera") {
    if (!canPlay) return;
    if (cameraMotionPlaying && viewMode === mode) {
      setCameraMotionPlaying(false);
      return;
    }

    setViewMode(mode);
    if (cameraMotionProgress >= 0.999) setCameraMotionProgress(0);
    setCameraMotionPlaying(true);
  }

  function updateSelectedArrivalTime(seconds: number) {
    if (!selectedKeyframe) return;
    const index = motionPath.keyframes.indexOf(selectedKeyframe);
    if (index <= 0 || index >= motionPath.keyframes.length - 1) return;
    const previous = motionPath.keyframes[index - 1];
    const next = motionPath.keyframes[index + 1];
    const minimum = previous.time * motionPath.duration + 0.1;
    const maximum = next.time * motionPath.duration - 0.1;
    const clamped = Math.min(maximum, Math.max(minimum, seconds));
    updateCameraMotionKeyframe(activeCamera.id, selectedKeyframe.id, {
      time: clamped / motionPath.duration,
    });
    setCameraMotionProgress(clamped / motionPath.duration);
    setArrivalTimeDraft(clamped.toFixed(1));
  }

  function commitArrivalTimeDraft() {
    const seconds = Number(arrivalTimeDraft);
    if (Number.isFinite(seconds)) updateSelectedArrivalTime(seconds);
    else if (selectedKeyframe) setArrivalTimeDraft((selectedKeyframe.time * motionPath.duration).toFixed(1));
  }

  async function exportReferenceVideo() {
    if (motionPath.keyframes.length < 2 || exporting) return;
    setExporting(true);
    setExportStatus("正在录制参考视频...");
    try {
      await requestReferenceVideoExport({
        fileName: `${activeCamera.name || "运镜"}-参考视频.webm`,
        fps: exportFps,
        quality: exportQuality,
      });
      setExportStatus("参考视频已下载");
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "参考视频导出失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className={`motion-studio${cameraPilotMode !== "idle" ? " is-piloting" : ""}`} aria-label="运镜工作台">
      <header className="motion-studio-header">
        <div className="motion-studio-heading">
          <span className="motion-studio-icon"><Route aria-hidden="true" size={17} /></span>
          <div>
            <h2>运镜工作台</h2>
            <p>侧边栏不挡画面 · 无需摆放机位</p>
          </div>
        </div>
        <div className="motion-studio-header-actions">
          <button type="button" className="motion-studio-export" aria-label="导出运镜" aria-expanded={exportOpen} onClick={() => setExportOpen((current) => !current)}>
            <Download aria-hidden="true" size={14} />导出
          </button>
          <button type="button" className="motion-studio-close" aria-label="关闭运镜工作台" onClick={() => setMotionStudioOpen(false)}>
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      </header>

      {exportOpen ? (
        <section className="motion-export-panel" aria-label="导出运镜设置">
          <div><strong>导出参考视频</strong><small>导出干净的第一视角运镜，不包含轨迹线和操作界面</small></div>
          <label><span>画质</span><select aria-label="参考视频画质" value={exportQuality} onChange={(event) => setExportQuality(event.currentTarget.value as ReferenceVideoExportQuality)}><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
          <label><span>帧率</span><select aria-label="参考视频帧率" value={exportFps} onChange={(event) => setExportFps(Number(event.currentTarget.value))}><option value="24">24 FPS</option><option value="30">30 FPS</option><option value="60">60 FPS</option></select></label>
          <button type="button" className="motion-export-confirm" disabled={motionPath.keyframes.length < 2 || exporting} onClick={() => void exportReferenceVideo()}><Download aria-hidden="true" size={14} />{exporting ? "正在录制" : "导出 WebM"}</button>
          {exportStatus ? <output className="motion-export-status" role="status">{exportStatus}</output> : null}
        </section>
      ) : null}

      <section className="motion-preview-panel" aria-label="运镜预览方式">
        <div className="motion-block-heading">
          <strong>你想怎么看？</strong>
          <small>路线检查和最终镜头分开预览</small>
        </div>
        <div className="motion-preview-options">
          <button
            type="button"
            className={`motion-preview-option is-director${viewMode === "director" ? " is-active" : ""}`}
            disabled={!canPlay}
            aria-label={cameraMotionPlaying && viewMode === "director" ? "暂停导演视角预演" : "播放导演视角预演"}
            aria-pressed={viewMode === "director"}
            onClick={() => previewInView("director")}
          >
            <Route aria-hidden="true" size={17} />
            <span><strong>{cameraMotionPlaying && viewMode === "director" ? "暂停" : "看路线"}</strong><small>导演视角看轨迹点</small></span>
            {cameraMotionPlaying && viewMode === "director" ? <Pause aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={14} />}
          </button>
          <button
            type="button"
            className={`motion-preview-option is-camera${viewMode === "camera" ? " is-active" : ""}`}
            disabled={!canPlay}
            aria-label={cameraMotionPlaying && viewMode === "camera" ? "暂停第一视角运镜预演" : "播放第一视角运镜预演"}
            aria-pressed={viewMode === "camera"}
            onClick={() => previewInView("camera")}
          >
            <Video aria-hidden="true" size={17} />
            <span><strong>{cameraMotionPlaying && viewMode === "camera" ? "暂停" : "看成片"}</strong><small>第一视角看最终镜头</small></span>
            {cameraMotionPlaying && viewMode === "camera" ? <Pause aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={14} />}
          </button>
        </div>
      </section>

      <div className="motion-studio-body">
        <div className="motion-studio-primary-actions">
          <div className="motion-block-heading">
            <strong>制作镜头</strong>
            <small>移动镜头，按 Enter 添加轨迹点</small>
          </div>
          <button
            type="button"
            className="motion-primary-button"
            aria-label="开始掌镜"
            onClick={() => onStartPilot ? onStartPilot(null) : startCameraPilot("pilot")}
          >
            <MousePointer2 aria-hidden="true" size={17} />
            <span><strong>开始掌镜</strong><small>WASD 自由走镜头</small></span>
          </button>
          <button type="button" className="motion-add-current" aria-label="添加当前视角为轨迹点" onClick={addCurrentView}>
            <Plus aria-hidden="true" size={16} />
            添加当前视角
          </button>
        </div>

        <div className="motion-key-help" aria-label="掌镜键位说明">
          <span><kbd>WASD</kbd><small>移动</small></span>
          <span><kbd>E</kbd><small>上升</small></span>
          <span><kbd>Q</kbd><small>下降</small></span>
          <span><kbd>空格</kbd><small>播放 / 暂停人物</small></span>
          <span><kbd>鼠标</kbd><small>看向</small></span>
          <span><kbd>F</kbd><small>锁定</small></span>
          <span><kbd>Enter</kbd><small>记录</small></span>
        </div>

        <div className="motion-route-column">
          <div className="motion-route-title">
            <div><Video aria-hidden="true" size={15} /><strong>镜头路线</strong><span>{motionPath.keyframes.length} 个点</span></div>
            {motionPath.keyframes.length > 0 ? (
              <button
                type="button"
                className={batchSelectionEnabled ? "is-active" : undefined}
                aria-label="批量选择并移动轨迹点"
                aria-pressed={batchSelectionEnabled}
                onClick={toggleBatchSelection}
              >
                <Move3D aria-hidden="true" size={13} />
                批量移动
              </button>
            ) : null}
          </div>

          {batchSelectionEnabled ? (
            <div className="motion-batch-selection" aria-label="批量轨迹点选择工具">
              <span>已选 {selectedCameraKeyframeIds.length} 个点</span>
              <small>点下面的数字，可选 1、3、6</small>
              <button
                type="button"
                aria-label="全选所有轨迹点"
                onClick={() => setCameraMotionKeyframeSelection(motionPath.keyframes.map((item) => item.id))}
              >全选</button>
              <button
                type="button"
                aria-label="清空轨迹点选择"
                onClick={() => setCameraMotionKeyframeSelection([])}
              >清空</button>
            </div>
          ) : null}

          {motionPath.keyframes.length === 0 ? (
            <div className="motion-route-empty" role="status">
              <Route aria-hidden="true" size={20} />
              <span>还没有轨迹点</span>
              <small>点“开始掌镜”，走到合适的位置按 Enter。</small>
            </div>
          ) : (
            <div className="motion-waypoint-strip" role="list" aria-label="可编辑轨迹点">
              {motionPath.keyframes.map((keyframe, index) => {
                const selected = selectedKeyframe?.id === keyframe.id;
                const reached = timelinePreviewActive && index <= activeIndex;
                const approaching = timelinePreviewActive && index === activeIndex + 1;
                const trackedObjectName = keyframe.targetMode === "object"
                  ? sceneObjects.find((object) => object.id === keyframe.targetObjectId)?.name ?? null
                  : null;
                return (
                  <div className="motion-waypoint-wrap" key={keyframe.id} role="listitem">
                    {index > 0 ? (
                      <span className="motion-waypoint-link-wrap">
                        <span className={`motion-waypoint-link${timelinePreviewActive && index <= activeIndex ? " is-lit" : ""}`} />
                        <button
                          type="button"
                          className="motion-waypoint-insert"
                          aria-label={`在轨迹点 ${index} 和 ${index + 1} 之间插入轨迹点`}
                          title={`在 ${index} 和 ${index + 1} 中间插入`}
                          onClick={() => {
                            setBatchSelectionEnabled(false);
                            insertCameraMotionKeyframeAfter(activeCamera.id, motionPath.keyframes[index - 1].id);
                          }}
                        >
                          <Plus aria-hidden="true" size={11} />
                        </button>
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={`motion-waypoint${(batchSelectionEnabled ? selectedCameraKeyframeIds.includes(keyframe.id) : selected) ? " is-selected" : ""}${reached ? " is-reached" : ""}${approaching ? " is-approaching" : ""}${trackedObjectName ? " has-tracking" : ""}`}
                      aria-label={batchSelectionEnabled ? `批量选择轨迹点 ${index + 1}` : `选择轨迹点 ${index + 1}`}
                      aria-pressed={batchSelectionEnabled ? selectedCameraKeyframeIds.includes(keyframe.id) : selected}
                      title={trackedObjectName ? `轨迹点 ${index + 1} · 跟踪 ${trackedObjectName}` : `轨迹点 ${index + 1} · 固定朝向`}
                      onClick={() => selectWaypoint(keyframe.id, keyframe.time)}
                    >
                      <span>{index + 1}</span>
                      <small>{(keyframe.time * motionPath.duration).toFixed(1)}s{trackedObjectName ? " · 跟" : ""}</small>
                    </button>
                  </div>
                );
              })}
              <button type="button" className="motion-waypoint-add" aria-label="添加当前视角为轨迹点" onClick={addCurrentView}>
                <Plus aria-hidden="true" size={16} />
              </button>
            </div>
          )}

          {selectedKeyframe && !batchSelectionEnabled ? (
            <div className="motion-selected-actions" aria-label="当前轨迹点操作">
              <span>轨迹点 {motionPath.keyframes.indexOf(selectedKeyframe) + 1}</span>
              {motionPath.keyframes.indexOf(selectedKeyframe) > 0 && motionPath.keyframes.indexOf(selectedKeyframe) < motionPath.keyframes.length - 1 ? (
                <label className="motion-waypoint-arrival">
                  到达
                  <input
                    aria-label="当前轨迹点到达时间"
                    type="number"
                    min={(motionPath.keyframes[motionPath.keyframes.indexOf(selectedKeyframe) - 1].time * motionPath.duration + 0.1).toFixed(1)}
                    max={(motionPath.keyframes[motionPath.keyframes.indexOf(selectedKeyframe) + 1].time * motionPath.duration - 0.1).toFixed(1)}
                    step="0.1"
                    value={arrivalTimeDraft}
                    onChange={(event) => setArrivalTimeDraft(event.currentTarget.value)}
                    onBlur={commitArrivalTimeDraft}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />秒
                </label>
              ) : null}
              <button type="button" onClick={editSelectedWaypoint}><MousePointer2 aria-hidden="true" size={13} />进入此点调整</button>
              <button
                type="button"
                aria-label="轨迹点前移"
                disabled={motionPath.keyframes.indexOf(selectedKeyframe) === 0}
                onClick={() => moveCameraMotionKeyframe(activeCamera.id, selectedKeyframe.id, -1)}
              ><ChevronUp aria-hidden="true" size={14} /></button>
              <button
                type="button"
                aria-label="轨迹点后移"
                disabled={motionPath.keyframes.indexOf(selectedKeyframe) === motionPath.keyframes.length - 1}
                onClick={() => moveCameraMotionKeyframe(activeCamera.id, selectedKeyframe.id, 1)}
              ><ChevronDown aria-hidden="true" size={14} /></button>
              <button type="button" className="is-danger" aria-label="删除当前轨迹点" onClick={() => deleteCameraMotionKeyframe(activeCamera.id, selectedKeyframe.id)}>
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </div>
          ) : batchSelectionEnabled ? (
            <div className="motion-batch-move-hint" role="status">
              <Move3D aria-hidden="true" size={14} />
              {selectedCameraKeyframeIds.length > 0
                ? "在画面里拖动 XYZ 箭头，所选轨迹点会一起移动"
                : "请先点选要一起移动的轨迹点"}
            </div>
          ) : null}
        </div>

        <div className="motion-settings-column">
          <div className="motion-block-heading">
            <strong>运镜细节</strong>
            <small>速度、平滑和主体锁定</small>
          </div>
          <label className="motion-setting-row motion-preset-row">
            <span><SlidersHorizontal aria-hidden="true" size={14} />参数预设</span>
            <select
              className="motion-tracking-select"
              aria-label="运镜参数预设"
              value={matchingPreset?.id ?? "custom"}
              onChange={(event) => applyMotionPreset(event.currentTarget.value)}
            >
              <option value="custom" disabled>自定义</option>
              {CAMERA_MOTION_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </select>
            <small className="motion-tracking-status">
              {matchingPreset?.description ?? "选择预设不会改变已经摆好的轨迹点"}
            </small>
          </label>
          <label className="motion-setting-row">
            <span><Gauge aria-hidden="true" size={14} />整段时长</span>
            <input
              aria-label="整段运镜时长"
              type="range"
              min="0.5"
              max="30"
              step="0.5"
              value={motionPath.duration}
              onPointerDown={beginUndoBatch}
              onPointerUp={endUndoBatch}
              onPointerCancel={endUndoBatch}
              onBlur={endUndoBatch}
              onChange={(event) => updateCameraMotionPath(activeCamera.id, { duration: Number(event.currentTarget.value) })}
            />
            <output>{motionPath.duration.toFixed(1)}s</output>
          </label>
          <div className="motion-setting-row">
            <span><SlidersHorizontal aria-hidden="true" size={14} />轨迹形状</span>
            <div className="motion-mini-segmented" role="group" aria-label="轨迹形状">
              <button type="button" aria-pressed={motionPath.interpolation === "smooth"} onClick={() => updateCameraMotionPath(activeCamera.id, { interpolation: "smooth" })}>平滑</button>
              <button type="button" aria-pressed={motionPath.interpolation === "linear"} onClick={() => updateCameraMotionPath(activeCamera.id, { interpolation: "linear" })}>折线</button>
            </div>
          </div>
          <div className="motion-setting-row">
            <span><ArrowUp aria-hidden="true" size={14} /><ArrowDown aria-hidden="true" size={14} />速度曲线</span>
            <div className="motion-mini-segmented" role="group" aria-label="速度曲线">
              <button type="button" aria-pressed={motionPath.easing === "ease-in-out"} onClick={() => updateCameraMotionPath(activeCamera.id, { easing: "ease-in-out" })}>柔和</button>
              <button type="button" aria-pressed={motionPath.easing === "linear"} onClick={() => updateCameraMotionPath(activeCamera.id, { easing: "linear" })}>匀速</button>
            </div>
          </div>
          <div className="motion-setting-row">
            <span><MousePointer2 aria-hidden="true" size={14} />此点跟踪</span>
            <select
              className="motion-tracking-select"
              aria-label="轨迹点跟踪主体"
              value={trackingObjectId}
              disabled={!selectedKeyframe}
              onChange={(event) => setTrackingObject(event.currentTarget.value)}
            >
              <option value="">不跟踪（固定朝向）</option>
              {trackableObjects.map((object) => (
                <option key={object.id} value={object.id}>{object.name}</option>
              ))}
            </select>
            <small className="motion-tracking-status">
              {!selectedKeyframe
                ? "先在上方选择一个轨迹点"
                : trackingObjectId
                  ? "这个点会实时看向所选主体"
                  : "这个点使用自己保存的固定朝向"}
            </small>
          </div>
          <div className="motion-setting-row">
            <span><MousePointer2 aria-hidden="true" size={14} />锁定方式</span>
            <div className="motion-mini-segmented" role="group" aria-label="主体锁定方式">
              <button
                type="button"
                aria-label="锁定后只保持看向主体"
                aria-pressed={!cameraPilotFollowTarget}
                onClick={() => setCameraPilotFollowTarget(false)}
              >只看向</button>
              <button
                type="button"
                aria-label="锁定后跟随主体移动"
                aria-pressed={cameraPilotFollowTarget}
                onClick={() => setCameraPilotFollowTarget(true)}
              >跟随移动</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
