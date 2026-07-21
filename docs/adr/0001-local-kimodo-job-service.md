# ADR-0001: 使用 SQLite 持久队列和受监管的单 GPU Worker

## 状态

Accepted

## 背景

3D 导演台是可静态部署的 React 应用，而 Kimodo 是需要 Python、PyTorch、Hugging Face 模型和 NVIDIA GPU 的推理系统。动作生成时间长、可能发生 CUDA OOM，并且用户要求任务队列、进度、失败恢复和可部署运行。

首版仅面向一台本地机器、一个用户和一张 GPU。系统必须在浏览器刷新或服务重启后保留任务，但不需要多主机调度和多租户隔离。

## 决策

新增一个可选的 Python 服务：

- FastAPI 提供版本化 HTTP API。
- SQLite 保存任务、状态、重试次数、租约和结果元数据。
- 单个受监管的 GPU worker 子进程串行领取任务。
- 生成结果写入持久化目录并通过 API 下载。
- Docker Compose 提供服务、GPU、健康检查和数据卷配置。
- 导演台通过 HTTP 轮询任务状态，不把服务状态写入工程 JSON。

## 结果

### 正面

- 组件少，适合单机部署和排障。
- SQLite 提供比内存队列更可靠的重启恢复。
- worker 进程隔离 CUDA 故障，API 可保持可用。
- 未来可以保留 API 契约，将队列迁移到 PostgreSQL/Redis 或增加多个 GPU worker。
- 现有纯前端部署继续工作。

### 负面

- SQLite 不适合多主机并发 worker。
- 取消运行任务需要重启 worker并重新加载模型。
- 进度只能报告稳定阶段，不能保证逐扩散步百分比。
- 本机仍需较大的模型缓存、系统内存和 NVIDIA 容器运行时。

### 中性

- 任务数据属于运行数据，不进入导演台工程 JSON。
- 动作二进制仍由浏览器 IndexedDB 管理，工程仅保存引用。

## 备选方案

### Redis/RQ + 独立服务

适合多 worker 和多主机，但对单 GPU 本机版本增加 Redis、备份和网络故障面，暂不采用。

### 前端调用 CLI

实现快，但浏览器无法可靠拥有本地进程，刷新和失败恢复差，不采用。

### Kubernetes + 外部数据库和对象存储

能够横向扩展，但超出本地单用户需求和当前运维成本，不采用。

## 参考

- [Kimodo](https://github.com/nv-tlabs/kimodo)
- [本地服务设计](../plans/2026-07-21-kimodo-local-service-design.md)
