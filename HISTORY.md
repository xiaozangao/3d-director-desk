# Project History

This file is append-only. Read it only for debugging or traceability.

## Initial baseline

- Project history initialized. Append dated entries for important changes, failures, rollbacks, and durable investigation conclusions.

## 2026-08-02 - 建立二开基线

- 用户确认采用 `xiaozangao/3d-director-desk` 进行二次开发。
- 从上游 `main` 的 `a6c931cd36d8263d986706f74ab4efe9d5151959` 建立独立 checkout，远端命名为 `upstream`。
- 创建本地工作分支 `codex/bootstrap-3d-director-desk`；本轮不推送、不部署、不修改业务源码。
- 基线验证通过：87 个测试文件、686 项测试、生产构建和本地首页浏览器检查均成功。
- 安全审计发现间接依赖 `postcss@8.5.15` 的 1 个 high 漏洞；为避免未经评审升级依赖，本轮仅记录风险，未执行修复。

## 2026-08-02 - 二开主实施方案

- 完成代码、持久化、工程 schema、宿主传输、测试、CI、依赖和资产体量审计。
- 提出“独立核心优先 + iframe/Tauri 适配器”的推荐路线，并将安全、架构拆分、工程可靠性、宿主协议、创作工作流、性能资产和候选发布拆为七个实施阶段。
- 方案记录于 `docs/plans/2026-08-02-second-development-master-plan.md`；由于涉及 L3 依赖与架构变更，业务源码实施等待用户确认。

## 2026-08-02 - 阶段 1 安全与质量门禁

- 用户确认推荐方案：独立核心优先、候选版本 `v0.4.0`、只新增 CI 不动发布工作流、先做工程健康与可移植性。
- 将间接依赖 `postcss` 从 `8.5.15` 升至 `8.5.25`，`nanoid` 随依赖约束从 `3.3.12` 升至 `3.3.16`；安全审计从 1 个 high 降为 0。
- 新增安全审计、CI 测试、类型检查、统一验证脚本和独立 GitHub Actions CI。
- `npm run verify`、首页和编辑器真实浏览器回归通过；未提交、未推送、未部署。

## 2026-08-02 - 阶段 2 持久化架构拆分

- 将 storage scope、key、本地素材元数据和快照读写抽到 `directorStore.persistence.ts`。
- 将默认状态、旧工程迁移、规范化和 hydration 抽到 `directorStore.hydration.ts`。
- `directorStore.ts` 从约 3065 行降至 2760 行，storage key、schema 和公开 store API 保持不变。
- 新增持久化等价性测试，全量门禁和浏览器刷新恢复通过。

## 2026-08-02 - 工程健康、宿主适配与镜头工作流

- 建立统一工程可移植性判定与顶部健康状态，能区分跨设备 JSON、本地素材、素材缺失和存储不可用。
- iframe 与 Tauri 接入统一 `DirectorHostTransport` 路由，继续保持协议 v1。
- 新增镜头复制；复制件保留独立轨迹、不复制截图，并修复镜头改名未同步场景树的问题。
- 浏览器真实操作确认健康提示和复制镜头在刷新后恢复，控制台 0 error；记录既有 `THREE.Clock` 弃用 warning。

## 2026-08-02 - 性能预算与候选发布失败关闭

- 构建预算进入 `npm run verify`，限制主入口、Three.js、高斯实验、全部 JavaScript 和 dist 总体积，并禁止主入口静态加载高斯实验。
- 全量门禁通过：0 漏洞、95 个测试文件、711 项测试、类型检查、生产构建和体积预算成功。
- 建立候选资产清单及 `release:check`；GUO、Mixamo、UE Mannequin 和基准全景图因许可证据不足被失败关闭。
- 未修改 Pages/Release 工作流，未改版本、未打包、未提交、未推送、未部署。
- 2026-08-05：为 ICA `ica_canvas_*` 作用域增加宿主登录与写权限授权门禁；直接 URL 或缺少授权时不加载场景，普通独立工作区保持兼容。全量 95 个测试文件、714 项测试、类型检查、生产构建和体积预算通过；`undici` 新增 high 漏洞使完整安全门禁失败关闭，未擅自升级依赖。未提交、未推送、未部署。

## 2026-08-05 - ICA Capability 与宿主握手竞态修复

- 将阶段性的宿主布尔授权升级为 ICA Admin API 短时 Capability；导演台向精确验证 Origin 复核会话、项目写权限、实例和有效期后才打开 `ica_canvas_*` 场景。
- 宿主监听器完全就绪后再发送 `storyai:director-desk-ready`，避免 ICA 首次会话消息丢失；支持 Canvas 与 ICA API 分域，失败或到期会重新锁定场景。普通离线工作区与既有本地场景不迁移、不删除。
- 定向 40/40、全量 95 文件/716 项、TypeScript、生产构建和体积预算通过；真实浏览器自动控制受本地 URL 安全策略限制，待用户刷新确认。未提交、推送或部署。

## 2026-08-05 - ICA Capability 真实进入与失败关闭收口

- 用户在修正本地 ICA Canvas Origin 白名单后退出、重新登录并真实进入 `ica_canvas_*` 导演台，确认当前 Capability 链路可用。
- 删除 localhost 开发授权回退；所有 ICA 作用域统一要求服务端验证。未知写权限失败关闭，验证失败或到期会退出 ICA 内存作用域并显示锁定页，但不会删除该作用域的 localStorage/IndexedDB 场景数据。
- 未提交、推送或远程部署；本地运行验收不代表生产部署。

## 2026-08-05 - ICA 访问门禁最终验收

- 已登录可写用户从 Canvas 真实进入；直接 ICA URL、无效 Capability 和授权失效均由自动化测试证明失败关闭，授权失效只退出内存作用域，不删除 localStorage/IndexedDB 场景。
- 定向 3 文件/39 项、全量 95 文件/716 项、TypeScript、生产构建和体积预算通过；既有 `undici` high 审计项仍需独立依赖升级评审。未提交、推送或远程部署。

## 2026-08-05 - 宿主协议状态机与断开恢复

- 协议 v1 增加已完成 requestId 防重、冲突复用拒绝、显式取消、内部超时和宿主断开状态机；帧/视频导出消费同一 `AbortSignal`，取消后恢复播放与界面并清理录制资源。
- ICA Capability 续期失败或宿主断开会中止在途请求、退出当前内存作用域并显示明确锁定原因，不删除 localStorage/IndexedDB 场景；新会话验证成功后可恢复。普通离线 URL 断开回到导演台选择页。
- 独立 iframe smoke 真实覆盖取消、防重、三帧导出、时间线恢复、插件查询和断开回首页。定向 5 文件/55 项通过；最终全量、类型、构建、预算与 ICA 宿主回归记录见同日 CURRENT-STATE。未提交、推送或部署。
