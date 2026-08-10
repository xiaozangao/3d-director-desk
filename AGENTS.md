# 3D 导演台项目执行说明

## 架构与范围边界

- 本项目是独立运行的 Vite 前端应用，不把 Three.js/R3F 依赖直接并入 ICA、无限画布或其他宿主仓库。
- 宿主集成优先使用 `iframe` 与版本化 `postMessage` 协议；接口语义以 `docs/embed-contract.md` 为准。
- 工程和本地素材默认保存在浏览器 `localStorage` / IndexedDB，不得擅自增加账号、后端上传或绑定特定 LLM/ComfyUI 工作流。
- 主视口、监看、成片预览和导出涉及相同镜头/动作状态时，应复用统一运行时结果，避免各视图重复实现。

## 必需命令

- 安装锁定依赖：`npm ci`
- 自动化测试：`npm test`
- CI 测试：`npm run test:ci`
- 类型检查：`npm run typecheck`
- high/critical 安全审计：`npm run audit:high`
- 生产构建：`npm run build`
- 构建体积预算：`npm run build:budget`
- 完整本地门禁：`npm run verify`
- 候选发布资产门禁：`npm run release:check`（许可证据不完整时必须失败）
- 完整候选发布门禁：`npm run verify:release`
- 提交前静态检查：`git diff --check`
- UI、导出或嵌入协议变更还需要在受支持的桌面浏览器中完成对应行为验证。

## 变更限制

- 保留所有既有用户改动；禁止使用 `git reset --hard`、覆盖式 checkout/restore 或未经确认清理未跟踪文件。
- 未经用户明确确认，不提交、不推送、不部署，也不更新 GitHub Pages 在线体验。
- 不伪造贡献者、性能数据、第三方素材来源或许可；发行和再分发必须保留 `LICENSE` 及适用的素材许可文件。
- 协议、工程 schema、资产持久化或跨仓库集成属于兼容性边界；变更前必须给出迁移、回退与验收方案并等待确认。
