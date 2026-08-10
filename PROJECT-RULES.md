# 项目规则

## 项目目的

- 以轻量浏览器 3D 预演把模糊镜头语言转成可重复的场景、人物路线、镜头轨迹、时间、FOV 与跟踪目标，并导出参考画面或视频。
- 面向普通创作者提供接近 FPS 的摆场景和掌镜体验，不以复制 Blender 等专业 DCC 软件为目标。

## 技术栈

- TypeScript、React 18、Vite 6、Three.js、React Three Fiber、Drei、Zustand、Vitest。
- Node.js `>=20`；依赖版本和锁定结果以 `package.json`、`package-lock.json` 为准。
- 当前应用版本为 `0.3.1`，开源协议为 MIT。

## 架构边界

- 作为独立 Vite 应用运行，通过 `iframe` / `postMessage` 与宿主集成。
- `instanceId` 隔离浏览器本地工程；跨端口或跨域嵌入使用 `hostOrigin` 限定父页面来源。
- 工程数据保存在 `localStorage`，大型本地模型、动作和全景图使用 IndexedDB；默认不上传服务器。
- 二创接口当前协议版本和工程 schema 版本均为 `1`，只能提供受控读取、导出和插件结果回传，不允许任意代码执行。

## 业务硬规则

- 小白优先：默认值先产生可用结果，专业参数再提供渐进式控制。
- 镜头、人物与道具共享同一时间源；主视口、监看、预览和导出必须保持运行时一致。
- 群友贡献、性能结果和第三方资产许可必须来自可验证事实，不得猜测或伪造。
- 不内置或绑定特定 LLM、ComfyUI 或其他单一 AI 工作流。

## 兼容性要求

- 支持 Windows 10/11、macOS 与现代桌面 Chrome/Edge 类浏览器；浏览器能力不足时必须明确失败，不能静默降级为错误结果。
- 已发布的嵌入消息、协议 v1 和工程迁移行为不得无迁移方案地破坏。
- 本地地址、GitHub Pages 地址和不同浏览器属于独立存储域，重要工程依赖 JSON 导入/导出备份。
- 发布和再分发必须保留 MIT `LICENSE`，并分别遵守模型、动作和其他第三方素材许可。

## 长期决策

- 2026-08-02：采用 `xiaozangao/3d-director-desk` 作为二开上游，当前 checkout 的远端名为 `upstream`。
- 二开项目保持独立，不并入 ICA 或现有无限画布代码库；需要集成时使用既有嵌入契约。
- 上述上游自身基于 `jiguang132/storyai-3d-director-desk`，来源链与初始同步提交见 `docs/UPSTREAM.md`。
- 2026-08-02：用户确认“独立核心优先 + iframe/Tauri 适配器”路线，首个候选版本按 `v0.4.0` 管理。
- 二开 CI 与发布工作流分离；当前阶段只新增质量门禁，不修改或启用 Pages/Release 发布动作。
- 首个产品功能闭环优先做工程健康与可移植性，再做镜头管理。
- 质量门禁必须阻止 high/critical 依赖漏洞，并运行全量测试、类型检查和生产构建。
- `directorStore` 的持久化 key、schema 和公开 Zustand 入口保持兼容；持久化与 hydration 逻辑优先放在独立模块。
- iframe 与 Tauri 传输必须实现统一 `DirectorHostTransport` 边界；协议 v1 继续兼容，破坏性变化不得混入 v1。
- 宿主协议 requestId 在单页生命周期内必须唯一；最近已完成请求不得再次执行，冲突复用必须失败关闭。长任务必须接受取消和有界超时；宿主断开或 ICA Capability 续期失败必须中止在途任务、退出当前内存作用域并锁定界面，但不得删除 localStorage/IndexedDB 场景数据。新会话验证成功后才可恢复。
- 主入口、高斯实验、Three.js 共享块、全部 JavaScript 和 dist 总体积使用可执行预算；高斯实验不得静态进入主入口。
- 候选发布必须通过 `release:check`；任何资产缺少明确再分发批准时保持失败关闭，不以本地构建成功替代发行许可。
- ICA 宿主作用域 `ica_canvas_*` 必须等待宿主提供 ICA Admin API 签发的短时 Capability，并经精确验证 Origin 服务端复核有效会话、当前项目写权限、实例和有效期后才能加载场景；未知权限、撤销、降权、过期、篡改、缺少授权或直接 URL 访问时失败关闭，不得设置开发绕过。普通独立离线工作区继续可用，不把 ICA 账号系统并入独立核心。
