import "./styles/index.css";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Boxes, Check, Clock3, House, Plus, Route, Sparkles, Trash2, X } from "lucide-react";
import { DirectorDeskShell } from "./app/layout/DirectorDeskShell";
import { DirectorCanvas } from "./editor/canvas/DirectorCanvas";
import { ViewportSensitivitySettings } from "./editor/canvas/ViewportSensitivitySettings";
import {
  DIRECTOR_DESK_SESSION_OPENED_EVENT,
  getDirectorDeskHostOrigin,
  initDirectorDeskHostBridge,
} from "./editor/io/hostBridge";
import { useDirectorStore } from "./editor/store/directorStore";
import {
  createDirectorDeskRecord,
  deleteDirectorDeskRecord,
  ensureDirectorDeskRecordForId,
  ensureDirectorDeskRecords,
  getInitialDirectorDeskId,
  touchDirectorDeskRecord,
  writeActiveDirectorDeskId,
  writeDirectorDeskRecords,
  type DirectorDeskRecord,
} from "./editor/workspaces/directorDeskRegistry";

type AppScreen = "home" | "editor";

const HOME_QUICK_START_STEPS = [
  ["选择导演台", "打开已有导演台，或点击“新建导演台”创建一个空场景。"],
  ["摆人物和道具", "从工具栏添加模型，选中后使用 XYZ 三轴移动、旋转和缩放。"],
  ["记录镜头", "点击“运镜 → 开始掌镜”，用 WASD 移动，每到一个镜头按 Enter。"],
  ["预演并导出", "先“看路线”检查轨迹，再“看成片”，满意后导出 WebM 参考视频。"],
] as const;

const HOME_RELEASE_NOTES = [
  "人物路线支持添加、插入、删除和拖动，行走时会沿平滑曲线自然转向",
  "人物路线与摄影机轨迹可常亮显示，并支持批量移动多个轨迹点",
  "新增路径碰撞开关，可让人物贴地，并阻止人物和镜头穿过场景物体",
  "看成片时可随时暂停和拖动底部时间轴，不会再退出第一视角预览",
  "主成片 FOV 与监看小窗 FOV 已分开设置，导出使用主成片 FOV",
  "新增可拖动实时监看小窗、WebM 参考视频导出和更可靠的撤销逻辑",
] as const;

function getUrlDirectorDeskInstanceId() {
  try {
    return new URLSearchParams(window.location.search).get("instanceId")?.trim() || null;
  } catch {
    return null;
  }
}

function updateUrlDirectorDeskInstanceId(id: string | null) {
  try {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("instanceId", id);
    } else {
      url.searchParams.delete("instanceId");
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Navigation state remains usable even if the embedding host blocks History API writes.
  }
}

function createInitialDirectorDeskViewState() {
  const records = ensureDirectorDeskRecords();
  const urlInstanceId = getUrlDirectorDeskInstanceId();
  return {
    records,
    activeDeskId: urlInstanceId ?? getInitialDirectorDeskId(records) ?? records[0]?.id ?? "",
    screen: urlInstanceId ? "editor" : ("home" as AppScreen),
  };
}

function formatDirectorDeskUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "刚刚更新";

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return "刚刚更新";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)} 小时前`;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function App() {
  const viewMode = useDirectorStore((state) => state.viewMode);
  const setViewMode = useDirectorStore((state) => state.setViewMode);
  const motionStudioOpen = useDirectorStore((state) => state.motionStudioOpen);
  const setMotionStudioOpen = useDirectorStore((state) => state.setMotionStudioOpen);
  const [directorDeskView, setDirectorDeskView] = useState(createInitialDirectorDeskViewState);
  const { records: directorDesks, activeDeskId, screen } = directorDeskView;

  function openDirectorDesk(
    id: string,
    records = directorDesks,
    options: { loadScene?: boolean } = {}
  ) {
    if (!id) return;

    const { loadScene = true } = options;
    const ensured = ensureDirectorDeskRecordForId(records, id);
    const nextRecords = touchDirectorDeskRecord(ensured.records, id);
    setDirectorDeskView({ records: nextRecords, activeDeskId: id, screen: "editor" });
    writeActiveDirectorDeskId(id);
    updateUrlDirectorDeskInstanceId(id);
    if (loadScene) {
      useDirectorStore.getState().openScopedScene(id);
    }
  }

  function backToHome() {
    const records = ensureDirectorDeskRecords();
    setDirectorDeskView({ records, activeDeskId, screen: "home" });
    updateUrlDirectorDeskInstanceId(null);
  }

  useEffect(() => {
    initDirectorDeskHostBridge();
    if (screen === "editor") {
      openDirectorDesk(activeDeskId, directorDesks);
    }

    window.parent?.postMessage({ type: "storyai:director-desk-ready" }, getDirectorDeskHostOrigin());
  }, []);

  useEffect(() => {
    function handleHostSessionOpened(event: Event) {
      const instanceId = (event as CustomEvent<{ instanceId?: string }>).detail?.instanceId;
      if (instanceId) {
        openDirectorDesk(instanceId, directorDesks, { loadScene: false });
      }
    }

    window.addEventListener(DIRECTOR_DESK_SESSION_OPENED_EVENT, handleHostSessionOpened);
    return () => window.removeEventListener(DIRECTOR_DESK_SESSION_OPENED_EVENT, handleHostSessionOpened);
  }, [directorDesks]);

  function handleCreateDesk() {
    const record = createDirectorDeskRecord(directorDesks);
    const nextRecords = [...directorDesks, record];
    writeDirectorDeskRecords(nextRecords);
    openDirectorDesk(record.id, nextRecords);
  }

  function handleDeleteDesk(desk: DirectorDeskRecord) {
    if (!window.confirm(`删除「${desk.name}」？这个导演台里的本地场景也会一起删除。`)) return;

    const result = deleteDirectorDeskRecord(directorDesks, desk.id);
    setDirectorDeskView({
      records: result.records,
      activeDeskId: result.activeId ?? result.records[0]?.id ?? "",
      screen: "home",
    });
  }

  function handleClose() {
    window.parent?.postMessage({ type: "storyai:director-desk-close" }, getDirectorDeskHostOrigin());
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditableShortcutTarget(event.target)) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.repeat) return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        useDirectorStore.getState().copySelectedObjects();
        return;
      }

      if (key === "v") {
        event.preventDefault();
        useDirectorStore.getState().pasteClipboardObjects();
        return;
      }

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        useDirectorStore.getState().undo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (screen === "home") {
    return (
      <main className="director-home-shell">
        <section className="director-home-hero">
          <div>
            <p className="director-home-kicker">Standalone 3D Director Desk</p>
            <h1>选择一个导演台开始摆场景</h1>
            <p>
              每个导演台独立保存，重启后先回到这里选择，不会再直接打开上一次的无名工程。
            </p>
          </div>
          <button className="director-home-primary-button" type="button" onClick={handleCreateDesk}>
            <Plus aria-hidden="true" size={18} />
            新建导演台
          </button>
        </section>

        {directorDesks.length ? (
          <section className="director-home-grid" aria-label="导演台列表">
            {directorDesks.map((desk, index) => (
              <article
                key={desk.id}
                className={`director-home-card ${desk.id === activeDeskId ? "is-active" : ""}`}
              >
                <button className="director-home-card-main" type="button" onClick={() => openDirectorDesk(desk.id)}>
                  <span className="director-home-card-icon">
                    <Boxes aria-hidden="true" size={22} strokeWidth={1.8} />
                  </span>
                  <span className="director-home-card-content">
                    <span className="director-home-card-title">{desk.name}</span>
                    <span className="director-home-card-meta">
                      <Clock3 aria-hidden="true" size={13} />
                      {formatDirectorDeskUpdatedAt(desk.updatedAt)}
                    </span>
                  </span>
                  <span className="director-home-card-index">{String(index + 1).padStart(2, "0")}</span>
                  <ArrowRight className="director-home-card-arrow" aria-hidden="true" size={18} />
                </button>
                <button
                  className="director-home-card-delete"
                  type="button"
                  aria-label={`删除${desk.name}`}
                  onClick={() => handleDeleteDesk(desk)}
                >
                  <Trash2 aria-hidden="true" size={15} strokeWidth={1.9} />
                </button>
              </article>
            ))}
          </section>
        ) : (
          <section className="director-home-empty" aria-label="空导演台列表">
            <Boxes aria-hidden="true" size={28} strokeWidth={1.6} />
            <h2>还没有导演台</h2>
            <p>点击“新建导演台”创建一个干净的 3D 场景。</p>
          </section>
        )}

        <section className="director-home-guide" aria-labelledby="director-home-guide-title">
          <header className="director-home-section-heading">
            <span><BookOpen aria-hidden="true" size={16} />第一次使用</span>
            <div>
              <h2 id="director-home-guide-title">四步完成第一条运镜</h2>
              <p>不用先学习复杂的 3D 软件，按照下面顺序操作即可。</p>
            </div>
          </header>
          <ol className="director-home-steps">
            {HOME_QUICK_START_STEPS.map(([title, description], index) => (
              <li key={title}>
                <span>{index + 1}</span>
                <div><strong>{title}</strong><p>{description}</p></div>
              </li>
            ))}
          </ol>
          <p className="director-home-shortcuts">
            <strong>掌镜快捷键</strong>
            <kbd>WASD</kbd>移动
            <kbd>Q / E</kbd>下降 / 上升
            <kbd>Enter</kbd>保存镜头
            <kbd>Space</kbd>播放 / 暂停
            <kbd>Esc</kbd>退出掌镜
          </p>
        </section>

        <section className="director-home-release" aria-labelledby="director-home-release-title">
          <header className="director-home-section-heading">
            <span><Sparkles aria-hidden="true" size={16} />本次更新</span>
            <div>
              <h2 id="director-home-release-title">路线编辑、监看与导出升级</h2>
              <p>这次重点补全人物运动、镜头预演和参考视频工作流。</p>
            </div>
          </header>
          <ul className="director-home-release-list">
            {HOME_RELEASE_NOTES.map((note) => (
              <li key={note}><Check aria-hidden="true" size={15} /><span>{note}</span></li>
            ))}
          </ul>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-left">
          <button className="top-bar-title top-bar-home-button" type="button" onClick={backToHome}>
            3D导演台
          </button>
          <button className="top-bar-home-nav-button" type="button" aria-label="返回首页" onClick={backToHome}>
            <House aria-hidden="true" size={14} strokeWidth={1.9} />
            首页
          </button>
          <div className="director-desk-switcher" aria-label="导演台选择器">
            <select
              className="director-desk-select"
              aria-label="选择导演台"
              value={activeDeskId}
              onChange={(event) => openDirectorDesk(event.currentTarget.value)}
            >
              {directorDesks.map((desk) => (
                <option key={desk.id} value={desk.id}>
                  {desk.name}
                </option>
              ))}
            </select>
            <button className="director-desk-create-button" type="button" onClick={handleCreateDesk}>
              <Plus aria-hidden="true" size={14} strokeWidth={1.9} />
              新建
            </button>
          </div>
        </div>
        <div className="top-bar-center">
          <div className="mode-toggle ui-segmented" role="group" aria-label="视角切换">
            <button
              className={`mode-toggle-button ui-segmented-item ${viewMode === "director" ? "ui-segmented-item-active" : ""}`}
              aria-pressed={viewMode === "director"}
              type="button"
              onClick={() => setViewMode("director")}
            >
              导演视角
            </button>
            <button
              className={`mode-toggle-button ui-segmented-item ${viewMode === "camera" ? "ui-segmented-item-active" : ""}`}
              aria-label="第一视角"
              aria-pressed={viewMode === "camera"}
              title="查看摄影机最终画面"
              type="button"
              onClick={() => setViewMode("camera")}
            >
              第一视角
            </button>
          </div>
          <button
            className={`top-bar-motion-button${motionStudioOpen ? " is-active" : ""}`}
            type="button"
            aria-label={motionStudioOpen ? "关闭运镜工作台" : "打开运镜工作台"}
            aria-pressed={motionStudioOpen}
            onClick={() => {
              setViewMode("director");
              setMotionStudioOpen(!motionStudioOpen);
            }}
          >
            <Route aria-hidden="true" size={15} />
            运镜
          </button>
          <ViewportSensitivitySettings />
        </div>
        <div className="top-bar-actions">
          <button
            className="top-bar-action-button"
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={handleClose}
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </div>
      </header>
      <DirectorDeskShell>
        <DirectorCanvas />
      </DirectorDeskShell>
    </div>
  );
}
