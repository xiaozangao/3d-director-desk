# Current State

## Current goal

- 收口 `v0.4.0` 候选前剩余批次；当前发行因第三方资产许可证据不足而失败关闭。

## Completed

- 已从公开上游克隆项目，保留 `upstream` 远端与 `main` 基线。
- 已创建二开工作分支 `codex/bootstrap-3d-director-desk`。
- 已初始化并按上游事实补齐项目治理文件。
- 已通过锁文件安装依赖；87 个测试文件、686 项测试全部通过，生产构建成功。
- 已在应用内桌面浏览器打开本地首页，核心首页内容正常渲染，控制台无 warning/error。
- 已审计源码模块、持久化、工程 schema、iframe/Tauri 传输、测试、CI、依赖和资产体量。
- 已形成 `docs/plans/2026-08-02-second-development-master-plan.md`，覆盖阶段范围、数据流、兼容、风险、回滚和验收门禁。
- 用户已确认“独立核心优先”路线、`v0.4.0` 候选版本、CI/发布边界和首个产品闭环优先级。
- 阶段 1 已完成：`postcss@8.5.25` 修复 high 漏洞，新增统一验证脚本和独立 CI。
- 阶段 1 本地门禁及首页/编辑器浏览器回归通过。
- 阶段 2 首批完成：store 持久化与 hydration 抽离；抽取完成时 2760 行，加入镜头能力后当前 2848 行，兼容 key/schema/API。
- 阶段 3 首批完成：统一可移植性判定、顶部工程健康提示、IndexedDB 缺失素材核验与异常状态。
- 阶段 4 状态机完成：iframe/Tauri 使用统一 `DirectorHostTransport` 路由；重复/冲突 requestId、取消、超时、宿主断开和 ICA Capability 续期失败均失败关闭，协议 v1 保持兼容。
- 阶段 5 首批完成：镜头复制、独立轨迹 ID、截图不重复、镜头名与场景树同步。
- 阶段 6 首批完成：构建体积预算纳入 `verify`，高斯实验保持独立入口，建立第三方资产盘点。
- 阶段 7 已建立 `release:check` / `verify:release`；当前 4 项资产范围阻断候选发布。

## Next actions

- 继续拆分 store history/assets/motion 与 `DirectorCanvas` / `SceneRoot`，每批保持独立验收。
- 在真实 Tauri 壳和 ICA 远程目标环境补齐双宿主 E2E；本地 iframe 契约 smoke 已通过。
- 完成镜头批量命名、模板或导出队列的下一产品闭环。
- 取得或排除 4 组阻断资产，完成 Windows/macOS 性能和 MP4/宿主端 E2E 后，才生成候选包。

## Risks

- 尚未配置我们自己的可推送 `origin`，当前只有只读来源语义的 `upstream`。
- Windows 真机性能、浏览器 MP4 导出和宿主端 E2E 不属于本轮初始化验证范围。
- `release:check` 明确阻断 GUO、Mixamo、UE Mannequin 和基准全景图；未补证或从发行包排除前不得对外发布。
- 构建保留上游大 chunk 警告：Three.js 产物约 734 KB，高斯实验产物约 4.97 MB。
- 测试通过但仍输出既存的 React `act(...)`、R3F DOM 标签和 Three.js 重复实例 warning；当前不影响生产浏览器控制台。
- 开发态浏览器还输出 1 类既存 Three.js `Clock` 弃用 warning；真实功能回归无 error。
- 新增 CI 尚未在 GitHub 远端运行；本地门禁通过不等于远端 Actions 已验证。

## Verification status

- Git、远端、分支、Node/npm 版本已确认。
- `npm test`：通过，95 个测试文件、724 项测试。
- `npm run build`：通过，存在已记录的大 chunk 警告。
- `git diff --check`：通过。
- 本地首页浏览器 DOM 与控制台检查：通过。
- TypeScript、生产构建和体积预算通过；`npm audit` 因既有 `undici` high 漏洞失败关闭，未擅自升级依赖。
- 阶段 1 首页与编辑器浏览器 DOM/控制台检查：通过。
- 浏览器工程健康提示、刷新恢复、镜头复制和复制件恢复：通过；0 error，存在已记录的 `THREE.Clock` 弃用 warning。
- `npm run release:check`：按预期失败（退出码 1），4 项资产范围许可证据不足。
- iframe 契约 smoke 真实验证取消、已完成 requestId 防重、三帧导出、时间线恢复、插件查询及断开回首页；功能全部通过。

## Last updated

- 2026-08-05（Asia/Shanghai）

## ICA access gate

- `ica_canvas_*` 工作区直接访问时先显示授权等待页，不再在收到宿主会话前读取场景。
- ICA Admin API 签发的短时 Capability 必须通过精确验证 Origin 的服务端复核，且响应实例与有效期匹配后才进入编辑器；会话撤销、权限降级、过期或篡改会锁定场景并通知宿主。普通独立离线工作区保持兼容。
- 宿主监听器现在完全初始化后才发送 `ready`，消除首次会话消息丢失导致已登录用户仍停在授权页的竞态；Canvas 与 ICA API 可使用不同的精确 Origin。
- localhost 开发授权回退已删除；所有 `ica_canvas_*` 作用域均要求真实 Capability，未知权限失败关闭，授权失败或到期时退出 ICA 持久化作用域但不删除场景数据。
- 用户已在退出后重新登录并从 Canvas 真实进入导演台。Capability 续期失败或宿主断开会中止在途请求、清除当前内存作用域并显示明确锁定原因，重试获得新会话后可恢复；localStorage/IndexedDB 场景数据不删除。独立导演台定向 55/55、全量 95 个测试文件/724 项、TypeScript、生产构建和体积预算通过。
