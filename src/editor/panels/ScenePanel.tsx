import { useEffect, useState } from "react";
import {
  InspectorAxisGroup,
  InspectorColorField,
  InspectorPanel,
  InspectorRangeNumberField,
  InspectorSection,
} from "./InspectorControls";
import { useDirectorStore } from "../store/directorStore";

const SCENE_SCALE_MIN = 0.1;
const SCENE_SCALE_MAX = 3;
const GROUND_HEIGHT_MIN = -5;
const GROUND_HEIGHT_MAX = 5;
const SCENE_BRIGHTNESS_MIN = 0;
const SCENE_BRIGHTNESS_MAX = 3;

function replaceAxis(tuple: [number, number, number], axis: 0 | 1 | 2, value: number): [number, number, number] {
  return tuple.map((item, index) => (index === axis ? value : item)) as [number, number, number];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ScenePanel() {
  const scene = useDirectorStore((state) => state.project.scene);
  const updateScene = useDirectorStore((state) => state.updateScene);
  const [sceneScaleDraft, setSceneScaleDraft] = useState(String(scene.scale));
  const [groundHeightDraft, setGroundHeightDraft] = useState(String(scene.groundHeight));

  useEffect(() => {
    setSceneScaleDraft(String(scene.scale));
  }, [scene.scale]);

  useEffect(() => {
    setGroundHeightDraft(String(scene.groundHeight));
  }, [scene.groundHeight]);

  function commitSceneScale(value: string) {
    const parsed = Number(value);
    const nextScale = Number.isFinite(parsed) ? clampNumber(parsed, SCENE_SCALE_MIN, SCENE_SCALE_MAX) : scene.scale;
    updateScene({ scale: nextScale });
    setSceneScaleDraft(String(nextScale));
  }

  function commitGroundHeight(value: string) {
    const parsed = Number(value);
    const nextHeight = Number.isFinite(parsed) ? clampNumber(parsed, GROUND_HEIGHT_MIN, GROUND_HEIGHT_MAX) : scene.groundHeight;
    updateScene({ groundHeight: nextHeight });
    setGroundHeightDraft(String(nextHeight));
  }

  return (
    <InspectorPanel title="3D场景" ariaLabel="3D场景右侧属性面板" className="scene-inspector">
      <InspectorRangeNumberField
        label="场景缩放"
        rangeAriaLabel="场景缩放滑杆"
        numberAriaLabel="场景缩放"
        max={SCENE_SCALE_MAX}
        min={SCENE_SCALE_MIN}
        step="0.01"
        value={sceneScaleDraft}
        onValueChange={commitSceneScale}
        onRangeChange={commitSceneScale}
        onNumberBlur={commitSceneScale}
        onNumberChange={(value) => {
          setSceneScaleDraft(value);
          if (value !== "") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
              updateScene({ scale: parsed });
            }
          }
        }}
      />
      <InspectorAxisGroup
        label="场景平移"
        axes={[
          {
            axis: "X",
            ariaLabel: "场景平移 X",
            step: "0.1",
            value: scene.position[0],
            onChange: (value) => updateScene({ position: replaceAxis(scene.position, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: "场景平移 Y",
            step: "0.1",
            value: scene.position[1],
            onChange: (value) => updateScene({ position: replaceAxis(scene.position, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: "场景平移 Z",
            step: "0.1",
            value: scene.position[2],
            onChange: (value) => updateScene({ position: replaceAxis(scene.position, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorAxisGroup
        label="场景旋转"
        axes={[
          {
            axis: "X",
            ariaLabel: "场景旋转 X",
            step: "1",
            value: scene.rotation[0],
            onChange: (value) => updateScene({ rotation: replaceAxis(scene.rotation, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: "场景旋转 Y",
            step: "1",
            value: scene.rotation[1],
            onChange: (value) => updateScene({ rotation: replaceAxis(scene.rotation, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: "场景旋转 Z",
            step: "1",
            value: scene.rotation[2],
            onChange: (value) => updateScene({ rotation: replaceAxis(scene.rotation, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorSection title="背景">
        <InspectorColorField
          label="天空颜色"
          colorAriaLabel="天空颜色"
          hexAriaLabel="天空颜色 HEX"
          value={scene.backgroundColor}
          onColorChange={(value) => updateScene({ backgroundColor: value })}
          onHexChange={(value) => updateScene({ backgroundColor: value })}
        />
        <InspectorRangeNumberField
          label="天空亮度"
          rangeAriaLabel="天空亮度滑杆"
          numberAriaLabel="天空亮度"
          max={SCENE_BRIGHTNESS_MAX}
          min={SCENE_BRIGHTNESS_MIN}
          step="0.05"
          value={scene.backgroundBrightness}
          onValueChange={(value) => updateScene({ backgroundBrightness: Number(value) })}
        />
      </InspectorSection>
      <InspectorSection title="开关项">
        <div className="scene-switch-row" role="group" aria-label="开关项设置">
          <div className="inspector-toggle-row">
            <input
              aria-label="角色标签"
              checked={scene.showLabels}
              type="checkbox"
              onChange={(event) => updateScene({ showLabels: event.target.checked })}
            />
            <span>角色标签</span>
          </div>
          <div className="inspector-toggle-row">
            <input
              aria-label="网格吸附"
              checked={scene.snapToGrid}
              type="checkbox"
              onChange={(event) => updateScene({ snapToGrid: event.target.checked })}
            />
            <span>网格吸附</span>
          </div>
          <div className="inspector-toggle-row">
            <input
              aria-label="地面"
              checked={scene.showGround}
              type="checkbox"
              onChange={(event) => updateScene({ showGround: event.target.checked })}
            />
            <span>地面</span>
          </div>
          <div className="inspector-toggle-row">
            <input
              aria-label="路径碰撞"
              checked={scene.pathCollisionEnabled}
              type="checkbox"
              onChange={(event) => updateScene({ pathCollisionEnabled: event.target.checked })}
            />
            <span>路径碰撞</span>
          </div>
        </div>
      </InspectorSection>
      {scene.showGround ? (
        <InspectorSection title="地面">
          <InspectorColorField
            label="地面颜色"
            colorAriaLabel="地面颜色"
            hexAriaLabel="地面颜色 HEX"
            value={scene.groundColor}
            onColorChange={(value) => updateScene({ groundColor: value })}
            onHexChange={(value) => updateScene({ groundColor: value })}
          />
          <InspectorRangeNumberField
            label="地面亮度"
            rangeAriaLabel="地面亮度滑杆"
            numberAriaLabel="地面亮度"
            max={SCENE_BRIGHTNESS_MAX}
            min={SCENE_BRIGHTNESS_MIN}
            step="0.05"
            value={scene.groundBrightness}
            onValueChange={(value) => updateScene({ groundBrightness: Number(value) })}
          />
          <InspectorRangeNumberField
            label="透明度"
            rangeAriaLabel="地面透明度滑杆"
            numberAriaLabel="地面透明度"
            max="1"
            min="0"
            step="0.01"
            value={scene.groundOpacity}
            onValueChange={(value) => updateScene({ groundOpacity: Number(value) })}
          />
          <InspectorRangeNumberField
            label="高度"
            rangeAriaLabel="地面高度滑杆"
            numberAriaLabel="地面高度"
            max={GROUND_HEIGHT_MAX}
            min={GROUND_HEIGHT_MIN}
            step="0.1"
            value={groundHeightDraft}
            onValueChange={commitGroundHeight}
            onRangeChange={commitGroundHeight}
            onNumberBlur={commitGroundHeight}
            onNumberChange={(value) => {
              setGroundHeightDraft(value);
              if (value !== "") {
                const parsed = Number(value);
                if (Number.isFinite(parsed)) {
                  updateScene({ groundHeight: parsed });
                }
              }
            }}
          />
        </InspectorSection>
      ) : null}
    </InspectorPanel>
  );
}
