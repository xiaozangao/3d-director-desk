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

## 配置 Token

在仓库根目录创建本地 secret 文件，不要提交它：

```powershell
New-Item -ItemType Directory -Force .secrets
Set-Content -NoNewline .secrets\hf-token "hf_your_read_token"
```

`.secrets/` 已被 Git 忽略。服务入口只在启动时读取 `/run/secrets/hf_token`，不会把 token 写入镜像或任务数据库。

需要修改端口或 CORS 时，可以基于 `.env.kimodo.example` 创建被忽略的 `.env.kimodo`：

```powershell
Copy-Item .env.kimodo.example .env.kimodo
```

后续命令增加 `--env-file .env.kimodo`。

## 启动

首次构建会下载较大的 PyTorch、Kimodo 和模型依赖：

```powershell
docker compose -f docker-compose.kimodo.yml up --build -d
```

查看状态：

```powershell
docker compose -f docker-compose.kimodo.yml ps
curl.exe http://127.0.0.1:8787/api/v1/health
```

健康响应中的 `status: ok`、`worker.alive: true` 和 `kimodoCliAvailable: true` 表示可以提交任务。第一次生成还会下载模型权重，因此会明显更慢。

启动导演台：

```powershell
$env:VITE_KIMODO_API_URL="http://127.0.0.1:8787"
npm run dev -- --host 127.0.0.1 --port 5173
```

选中人物，打开“动作”页，在“Kimodo 动作”中提交提示词。任务完成后点击下载图标，将 BVH 保存并应用到角色。

## 任务恢复

任务状态保存在 SQLite。服务启动时会检查所有处于运行阶段的任务：

- 仍有自动重试次数：重新进入队列。
- 已达到最大次数：标记为失败。
- 已请求取消：标记为取消。

生成文件先写临时路径，完整输出后再原子发布。服务不会把半成品暴露为成功结果。

## 运维命令

查看日志：

```powershell
docker compose -f docker-compose.kimodo.yml logs -f --tail 200 kimodo
```

重启服务并保留任务：

```powershell
docker compose -f docker-compose.kimodo.yml restart kimodo
```

停止服务并保留数据卷：

```powershell
docker compose -f docker-compose.kimodo.yml down
```

不要使用 `down -v`，除非明确要删除任务数据库、结果和模型缓存。

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
