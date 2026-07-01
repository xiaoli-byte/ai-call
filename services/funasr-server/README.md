# FunASR Server

FunASR WebSocket + HTTP + SSE 三合一服务端 —— 项目内 Python 子服务（替代 Docker 部署）。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                  FastAPI 单进程单端口 (:10095)            │
│                                                         │
│  ┌─────────┐  ┌───────────┐  ┌───────────┐  ┌────────┐ │
│  │ WebSocket│  │   HTTP    │  │    SSE    │  │ Health │ │
│  │  / /ws  │  │ /recognize│  │ /recognize│  │ /health│ │
│  │         │  │/recognition│  │  /stream  │  │        │ │
│  └────┬────┘  └─────┬─────┘  └─────┬─────┘  └────────┘ │
│       │             │              │                    │
│       └─────────────┴──────────────┘                    │
│                     │                                   │
│              ┌──────▼──────┐                            │
│              │ ModelManager │                            │
│              │  (5 models)  │                            │
│              └──────┬──────┘                            │
│                     │                                   │
│         ┌───────────┼───────────┐                       │
│         │           │           │                       │
│    ┌────▼───┐ ┌────▼───┐ ┌────▼────┐                   │
│    │  ASR   │ │  VAD   │ │ Punc/SV │                   │
│    │offline │ │        │ │         │                   │
│    │+online │ │        │ │         │                   │
│    └────────┘ └────────┘ └─────────┘                   │
└─────────────────────────────────────────────────────────┘
```

### 三种接口

| 接口 | 路径 | 用途 | 调用方 |
|------|------|------|--------|
| WebSocket | `ws://host:10095/` 或 `/ws` | 实时流式识别（2pass：partial + final） | voice-agent 主链路 |
| HTTP | `POST /recognize` | 同步整句识别（上传文件 → 完整结果） | 外部 curl / 文件转写 |
| HTTP | `POST /recognition` | 同上（兼容原 FunASR 路径） | 向后兼容 |
| SSE | `POST /recognize/stream` | 流式识别（VAD 切分 + 逐句推送） | 外部长音频 / 调试 |
| Health | `GET /health` | 服务健康状态 | 监控 / k8s 探针 |

### 5 个模型

| 模型 | ModelScope ID | 用途 |
|------|---------------|------|
| ASR 离线 | `iic/speech_paraformer-large-contextual_asr_nat-zh-cn-16k-common-vocab8404` | 整句识别（含上下文/热词） |
| ASR 在线 | `iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online` | 流式 partial |
| VAD | `iic/speech_fsmn_vad_zh-cn-16k-common-pytorch` | 语音端点检测 |
| Punc | `iic/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727` | 标点恢复（可选） |
| SV | `iic/speech_campplus_sv_zh-cn_16k-common` | 声纹识别 |

## 快速开始

### 1. 创建虚拟环境并安装依赖

```bash
cd services/funasr-server
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/macOS

# 步骤 1：安装 PyTorch GPU 版（cu124，国内镜像）
pip install torch torchaudio --index-url https://mirror.sjtu.edu.cn/pytorch-wheels/cu124/

# 步骤 2：安装 editdistance 纯 Python 替代（避免 MSVC 编译）
pip install ./vendor/editdistance-pure/

# 步骤 3：安装项目依赖
pip install -e ".[dev]"
```

或通过项目根目录一键安装（已包含上述步骤）：
```bash
pnpm dev:funasr:setup:gpu   # PyTorch cu124
pnpm dev:funasr:setup       # 依赖 + editdistance shim
```

> **editdistance 说明**：FunASR 依赖 `editdistance`（C 扩展，需要 MSVC 编译）。
> 本项目提供纯 Python 替代（`vendor/editdistance-pure/`），API 完全兼容，性能略低但不影响 ASR 推理。
> 如已安装 MSVC Build Tools，可跳过步骤 2，pip 会自动从 PyPI 编译安装原版。

### 2. 配置环境

```bash
cp .env.example .env
# 编辑 .env，按需修改
```

关键配置：
- `FUNASR_SERVER_DEVICE=cuda` — 默认 GPU（无 GPU 自动降级到 cpu）
- `FUNASR_SERVER_PORT=10095` — 服务端口
- `FUNASR_SERVER_HOTWORD_PATH=` — 热词文件路径（可选）

### 3. 启动服务

```bash
# 方式 1：直接运行
.venv\Scripts\python.exe -m funasr_server

# 方式 2：通过项目根 turbo 脚本
pnpm dev:funasr
```

首次启动会从 ModelScope 下载模型（约 2-3 GB，10-30 分钟），后续启动直接加载。

### 4. 验证

```bash
# 健康检查
curl http://localhost:10095/health

# HTTP 识别
curl -X POST http://localhost:10095/recognize \
     -F "audio=@test.wav"

# SSE 流式识别
curl -X POST http://localhost:10095/recognize/stream \
     -F "audio=@test.wav" --no-buffer
```

## WebSocket 协议（与 voice-agent stt.py 对齐）

### 连接

```
ws://localhost:10095/    （兼容无路径连接）
ws://localhost:10095/ws  （规范路径）
```

强制 `subprotocols=["binary"]`。

### 消息流

```
Client → Server:
  1. JSON 配置帧：{mode:"2pass", chunk_size:[5,10,5], chunk_interval:10, wav_name, is_speaking:true, hotwords, itn}
  2. 二进制 PCM 帧：16-bit 16kHz mono，持续推送
  3. JSON 控制帧：{is_speaking:false}  ← 触发整句识别

Server → Client:
  4. partial：{mode:"2pass-online", text:"...", wav_name, is_final:false}
  5. final：  {mode:"2pass-offline", text:"...", is_final:true, spk_name, spk_score, timestamp, sentence_info}
```

### 2pass 去重

online `is_final=True` 时不发送 partial，由 offline 兜底（原 `funasr_wss_server.py` L699-700）。

## GPU 支持

- 默认 `device=cuda, ngpu=1`
- 启动时检测 `torch.cuda.is_available()`，无 GPU 自动降级到 `cpu` 并记 WARN
- 手动指定：`FUNASR_SERVER_DEVICE=cpu` 或 `--device cpu`

## 测试

```bash
cd services/funasr-server
.venv\Scripts\activate
pytest tests/ -v
```

测试覆盖：
- `test_config.py` — 环境变量解析、CLI 参数覆盖、GPU 降级逻辑
- `test_api_http.py` — /health、/recognize、/recognize/stream 错误处理（mock 模型）

## 目录结构

```
services/funasr-server/
├── pyproject.toml          # 包元数据 + 依赖
├── .env.example            # 环境变量模板
├── .gitignore
├── src/funasr_server/
│   ├── __init__.py
│   ├── config.py           # Config 数据类 + GPU 降级
│   ├── models.py           # ModelManager（5 模型 + run_blocking）
│   ├── app.py              # FastAPI app 工厂 + lifespan
│   ├── main.py             # 入口（uvicorn 启动）
│   └── api/
│       ├── __init__.py
│       ├── ws.py           # WebSocket 实时流式（2pass）
│       ├── http.py         # HTTP 同步识别
│       ├── sse.py          # SSE 流式识别（VAD 切分）
│       └── health.py       # 健康检查
├── vendor/
│   └── editdistance-pure/  # 纯 Python editdistance 替代（避免 MSVC 编译）
└── tests/
    ├── __init__.py
    ├── test_config.py      # Config 单元测试
    └── test_api_http.py    # API 端点测试
```

## 与 voice-agent 的集成

voice-agent 的 `stt.py` 通过 WebSocket 连接本服务：

```
FreeSWITCH → mod_audio_fork → voice-agent (stt.py) → ws://localhost:10095/ → funasr-server
```

配置（voice-agent `.env`）：
```
FUNASR_WS_URL=ws://localhost:10095
FUNASR_MODE=2pass
```

## 性能调优

并发限流参数（`.env`）：
- `FUNASR_SERVER_WORKER_THREADS=4` — ThreadPoolExecutor 大小
- `FUNASR_SERVER_CONCURRENT_VAD=4` — 同时 VAD 推理数
- `FUNASR_SERVER_CONCURRENT_ASR_ONLINE=4` — 同时流式 ASR 数
- `FUNASR_SERVER_CONCURRENT_ASR_OFFLINE=2` — 同时整句 ASR 数

GPU 显存不足时，降低 `CONCURRENT_ASR_OFFLINE` 和 `CONCURRENT_ASR_ONLINE`。

## 调试

- `FUNASR_SERVER_SAVE_OFFLINE_SEGMENTS=true` — 保存离线片段为 WAV（验证 VAD 切分）
- `LOG_LEVEL=DEBUG` — 详细日志
- 离线片段保存在 `offline_segments/` 目录
