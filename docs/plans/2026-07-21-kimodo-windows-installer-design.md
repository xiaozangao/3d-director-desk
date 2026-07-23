# Kimodo Windows 本地安装器设计

## 目标

为不熟悉 Python、CUDA 和 Docker Compose 的 Windows 用户提供一个稳定的本地安装入口。用户只需要预先安装 NVIDIA 驱动与 Docker Desktop，随后双击安装器、输入 Hugging Face Token，即可完成环境检查、镜像构建、服务启动和健康验证。

## 方案选择

采用 Docker Desktop + PowerShell 引导脚本。Docker 继续负责固定 Ubuntu、CUDA、PyTorch、Kimodo 和 Python 依赖；PowerShell 只负责检查宿主环境、保存本地 secret、调用 Compose 和解释错误。当前阶段不发布预构建镜像，因为镜像体积较大，且模型与基础镜像许可需要在公开分发前单独复核。也不支持原生 Windows 或手工 WSL Python 安装，这两条路径会显著扩大 CUDA 和编译工具链的兼容性范围。

## 用户流程

1. 用户安装并启动 Docker Desktop，确认使用 WSL2 Linux 容器。
2. 用户双击 `install-kimodo.cmd`。
3. 安装器检查 Docker CLI、Compose、Docker 引擎、系统内存和 Docker GPU 访问。
4. 如果本地 secret 不存在，安装器以隐藏输入方式读取 Hugging Face Token，并写入 Git 忽略的 `.secrets/hf-token`。
5. 安装器创建 `.env.kimodo`，构建固定版本镜像，启动服务，并等待 `/api/v1/health` 就绪。
6. 安装后通过 `scripts/kimodo-service.ps1` 执行 `status`、`logs`、`start`、`stop` 和 `restart`。

## 安全与恢复

Token 不接受命令行参数，避免进入 shell 历史和进程列表；只保存在被 Git 忽略的本地文件中，并通过 Docker secret 注入。停止与重启操作不删除 `kimodo-data` 和 `kimodo-hf-cache` 卷。安装失败时保留构建缓存和已有任务数据，用户修复前置条件后可直接重跑安装器。

## 验证

在没有 Docker 引擎的机器上，`doctor` 必须给出可理解的失败项而不是堆栈。PowerShell 解析器必须无语法错误，Compose 配置必须有效，现有后端测试与前端构建必须继续通过。真实 GPU 验收仍需要有效 Token、已授权模型和运行中的 Docker Desktop。
