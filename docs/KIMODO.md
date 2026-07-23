# Kimodo 本地动作生成服务

导演台可以连接本机 Kimodo 服务，为当前角色生成 BVH 动作。服务是可选组件；没有启动服务时，导演台的场景编辑、现有动作、截图和视频导出仍可正常使用。

## 运行边界

- 首版面向单机、单用户、单 NVIDIA GPU。
- API 默认只绑定 `127.0.0.1:8787`，不提供公网认证。
- 任务、重试状态和结果保存在 Docker 卷 `kimodo-data`。
- Hugging Face 模型缓存保存在 `kimodo-hf-cache`。
- 导入导演台后的 BVH 保存在浏览器 IndexedDB；工程 JSON 只保存素材引用。

## 前置条件

1. Windows 10/11、WSL2 和已启动的 Docker Desktop。
2. NVIDIA 驱动和 Docker GPU 支持。运行以下命令应能看到显卡：

   ```powershell
   docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
   ```

3. Hugging Face 账号已获得 `meta-llama/Meta-Llama-3-8B-Instruct` 访问权限。
4. 已接受所用 Kimodo 模型权重的 NVIDIA 许可。

本机 RTX 4070 Ti 只有 12GB 显存，默认配置将文本编码器放在 CPU：`TEXT_ENCODER_DEVICE=cpu`。这会增加首次加载时间，但能显著降低 GPU 显存需求。

首次构建需要下载约 10 GiB 的压缩 CUDA/PyTorch 基础镜像，展开后约 21 GB；第一次生成还会下载约 1.1 GB 的 Kimodo 权重和约 15 GB 的 Llama 3 8B 文本编码器权重。建议预留至少 60 GB 可用空间，80 GB 更稳妥。首次安装和模型下载可能需要 1-3 小时，具体取决于网络与磁盘速度。

## 推荐安装方式

1. 启动 Docker Desktop，确认使用 WSL2 Linux 容器。
2. 双击仓库根目录的 `install-kimodo.cmd`。
3. 环境检查通过后，按提示输入 Hugging Face Read Token。输入内容不会显示。
4. 等待镜像构建、容器启动和健康检查完成。

安装器不会自动修改 NVIDIA 驱动、WSL2 或 Docker Desktop，也不会删除已有任务和模型缓存。重复运行安装器可以修复不完整安装；需要完全重建镜像时执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\kimodo-service.ps1 install -Rebuild
```

只检查环境、不安装：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\kimodo-service.ps1 doctor
```

环境检查会验证 Docker CLI、Compose、Docker 引擎、系统内存、Token 和 Docker GPU 访问。首次 GPU 检查可能下载一个小型 CUDA 检测镜像。

## Token 与配置

安装器以隐藏输入方式读取 Token，并将它写入 `.secrets/hf-token`。Token 不会作为命令行参数出现，不会进入镜像或任务数据库；`.secrets/` 已被 Git 忽略。

如需手工配置，可在仓库根目录创建本地 secret 文件：

```powershell
New-Item -ItemType Directory -Force .secrets
Set-Content -NoNewline .secrets\hf-token "hf_your_read_token"
```

需要修改端口、CORS 或 Python 包下载源时，可以编辑安装器自动创建的 `.env.kimodo`；配置模板是 `.env.kimodo.example`。

在国内网络环境中，可以只为 Kimodo 镜像构建启用清华 PyPI 镜像：

```dotenv
KIMODO_PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
```

该设置仅影响 `pip`。NVIDIA 基础镜像仍从 `nvcr.io` 下载。Hugging Face 权重默认通过官方地址下载；需要使用镜像时可在 `.env.kimodo` 中设置 `HF_ENDPOINT`：

```dotenv
HF_ENDPOINT=https://hf-mirror.com
```

访问 Meta Llama 等 gated 模型时，Hugging Face Token 会发送到配置的 `HF_ENDPOINT`。只应使用你信任的镜像服务，且镜像仍需支持该 Token 对应的仓库授权。代理或镜像地址中不要包含账号、Token 等凭据。

如果 Hugging Face Xet 大文件传输在代理网络下反复出现 401 或 CAS 错误，可在 `.env.kimodo` 中设置 `HF_HUB_DISABLE_XET=1`，改用官方标准 HTTP 下载通道。已下载的缓存会继续复用。

使用镜像下载 gated 文本编码器时，可以先运行独立预下载命令。它只会把 Token 发送到配置的 `HF_ENDPOINT`，以及镜像明确跳转到的 `huggingface.co`；签名 CDN 不会收到 Token。中断后重复运行会继续使用持久缓存中的断点文件：

```powershell
docker exec 3d-director-desk-kimodo-kimodo-1 python -m services.kimodo.app.prefetch_models --max-workers 1
```

预下载完成后可设置 `HF_HUB_OFFLINE=1` 并重启服务，生成任务将只读取本地模型缓存。

## 手动安装

无法使用双击入口或需要排障时，可以直接调用 Compose：

```powershell
Copy-Item .env.kimodo.example .env.kimodo
docker compose --env-file .env.kimodo -f docker-compose.kimodo.yml up --build -d
docker compose --env-file .env.kimodo -f docker-compose.kimodo.yml ps
curl.exe http://127.0.0.1:8787/api/v1/health
```

健康响应中的 `status: ok`、`worker.alive: true` 和 `kimodoCliAvailable: true` 表示可以提交任务。导演台默认连接 `http://127.0.0.1:8787`；选中人物并打开“动作”页即可使用 Kimodo。

## 任务恢复

任务状态保存在 SQLite。服务启动时会检查所有处于运行阶段的任务：

- 仍有自动重试次数：重新进入队列。
- 已达到最大次数：标记为失败。
- 已请求取消：标记为取消。

生成文件先写临时路径，完整输出后再原子发布。服务不会把半成品暴露为成功结果。

## 运维命令

日常操作统一使用服务管理脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\kimodo-service.ps1 status
powershell -ExecutionPolicy Bypass -File scripts\kimodo-service.ps1 logs
powershell -ExecutionPolicy Bypass -File scripts\kimodo-service.ps1 start
powershell -ExecutionPolicy Bypass -File scripts\kimodo-service.ps1 restart
powershell -ExecutionPolicy Bypass -File scripts\kimodo-service.ps1 stop
```

`stop` 不会删除 `kimodo-data` 和 `kimodo-hf-cache`。不要使用 `down -v`，除非明确要删除任务数据库、结果和模型缓存。

## 常见故障

### `model_unavailable`

检查 Hugging Face token、Llama 仓库授权和模型许可。更新 `.secrets/hf-token` 后重启服务，再从导演台重试任务。

### `gpu_out_of_memory`

确认 `TEXT_ENCODER_DEVICE=cpu`，关闭其他 GPU 程序并重启服务。任务会在上限内自动重试；连续失败后保留错误记录供人工重试。

### 服务显示离线

检查 Docker Desktop 是否启动、8787 端口是否占用，以及 `KIMODO_CORS_ORIGINS` 是否包含当前导演台 origin。

### BVH 导入失败

任务结果仍保留在服务数据卷中。检查任务日志和 BVH 文件；当前运行时只针对标准 T-pose SOMA BVH 提供自动重定向。

## 验证

后端测试不下载模型：

```powershell
services\kimodo\.venv\Scripts\python.exe -m unittest discover -s services\kimodo\tests -v
```

其余检查：

```powershell
npm test
npm run build
docker compose -f docker-compose.kimodo.yml config
git diff --check
```

真实 GPU 验收应至少生成一段 2 秒动作，并验证应用、暂停、拖动、倒拖和重播后的姿态一致性。

## 许可

Kimodo 源码使用 Apache-2.0。模型权重使用各自的 NVIDIA 模型许可；文本编码器依赖受限访问的 Meta Llama 模型。发布、商用或向他人提供服务前，需要分别复核代码、模型和数据许可。
