# AgentDog 🐕 — MCP 服务器统一管理网关 & AI API 网关

> **一次配置，统一管理所有 MCP 服务器；一个端点，统一接入所有 AI 供应商**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

AgentDog（npm 包名 `agentdog`）是一个 MCP（Model Context Protocol）服务器统一管理网关，fork 自运维团队 [MCP-Dog](https://github.com/SIE-Operations-and-Maintenance-Team/mcpdog) 并持续增强：把多个 MCP 子服务器聚合成一个统一入口，供 Claude Desktop、Cursor、Claude Code 等 MCP 客户端使用；并内置 AI API 网关，让 Claude Code 统一接入任意 AI 供应商。增强内容包括 Windows 平台兼容修复、Web 界面汉化、daemon 常驻模式与开机自启等。

## 🏗️ 架构概览

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MCP 客户端:   │    │   MCP 客户端:   │    │  Claude Code    │
│    (Claude)     │    │    (Cursor)     │    │ (AI 网关接入)   │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │         AgentDog             │
                    │  （统一入口 + 智能路由      │
                    │    + AI API 网关）         │
                    └──┬──────────────┬─────────┘
                       │              │
          ┌────────────┼──────────────┐│
          │            │              ││
    ┌─────▼─────┐ ┌────▼──────┐ ┌────▼▼────────┐
    │ db-tools  │ │ itsm-tools│ │ AI 供应商     │
    └───────────┘ └───────────┘ │ (openai兼容/ │
                                │  anthropic/  │
                                │  gemini)     │
                                └──────────────┘
```

### 核心价值

- **🔗 一次配置**：客户端只连 AgentDog 一个入口，不用逐个配置子服务器
- **🔄 统一界面**：所有子服务器的工具合并成一张清单暴露给客户端
- **⚡ 智能路由**：AgentDog 自动把工具调用路由到对应的子服务器
- **🌐 多传输协议**：子服务器支持 stdio / HTTP SSE / Streamable HTTP 三种接入方式
- **📊 集中管理**：Web 管理界面可视化增删改查服务器、启停、工具开关
- **🤖 AI API 网关**：内置 Anthropic Messages 兼容端点，Claude Code 统一接入任意 AI 供应商
- **🛡️ 故障隔离**：单个子服务器挂掉不影响其他子服务器和整体入口
- **🪟 Windows 兼容**：cross-spawn 启动 `.cmd` 批处理、子进程无窗口静默启动

## 🚀 快速开始

前置要求：Node.js ≥ 18。

```bash
npx agentdog@latest daemon start
```

启动后浏览器打开 `http://localhost:61125` 即可看到 Web 管理界面，在界面里添加并管理子服务器。

### 客户端接入（以 Claude Code 为例）

在 MCP 客户端配置中加入：

```json
{
  "mcpServers": {
    "agentdog": {
      "command": "npx",
      "args": ["agentdog@latest"]
    }
  }
}
```

> 客户端连的是 AgentDog 聚合入口（stdio proxy），前提是 daemon 已启动并配好子服务器；daemon 未运行时 proxy 会自动拉起一次。

## 📦 部署方式

AgentDog 以 daemon 常驻进程形态部署，同一台机器支持以下安装方式，按使用时长选择：

### 方式一：npx 直接运行（临时体验）

不落盘安装，随时用最新版：

```bash
npx agentdog@latest daemon start
```

### 方式二：全局安装（推荐长期使用）

```bash
npm i -g agentdog
agentdog daemon start
```

全局安装后 CLI 入口路径稳定，注册开机自启不会因 npx 缓存清理而失效（见下文自启说明）。

### 方式三：Docker

仓库提供多阶段构建（`node:20-alpine`，非 root 用户运行），适合服务器部署：

```bash
docker build -t agentdog .
docker run -d -p 61125:61125 agentdog
```

> 配置固定存放在用户主目录 `~/.agentdog/agentdog.config.json`。镜像以非 root 用户（appuser）运行，容器部署时把该用户的 `~/.agentdog` 目录挂载为卷即可持久化配置（如 `-v <宿主目录>:/home/appuser/.agentdog`）。

### 端口与网络约定

- **单一端口**：daemon IPC 与 Web 管理界面合并为同一个 TCP 端口（默认 **61125**），CLI `status`/`reload` 与客户端 proxy 挂载全部走该端口的 HTTP 接口（`POST /api/mcp`）。旧参数 `--daemon-port` 已删除，传入会直接报错。
- **端口持久化**：`daemon start --web-port <端口>` 显式指定的端口保存到配置 `web.port`，之后启动免传参；未指定时依次取保存值、默认 61125，端口被占自动探测相邻可用端口（探测漂移值不回写配置）。
- **默认仅本机访问**：Web 界面默认监听 `localhost`。需要远程访问时必须同时满足两个条件，缺一拒绝启动：
  1. 配置显式设置 `web.host: "0.0.0.0"`；
  2. 设置环境变量 `MCPDOG_AUTH_TOKEN`（访问令牌）。

### 🔑 daemon 开机自启

```bash
agentdog daemon autostart --enable    # 注册开机自启（当前用户）
agentdog daemon autostart             # 查看自启状态
agentdog daemon autostart --disable   # 移除开机自启
```

各平台实现：

| 平台 | 机制 | 说明 |
|---|---|---|
| Windows | HKCU Run 注册表键 + `~/.agentdog` 下隐藏 VBS 启动器 | 登录时无窗口静默启动 daemon |
| macOS | LaunchAgent | 用户级 launchd 代理 |
| Linux | systemd user unit | 需 `systemd --user` 可用 |

注意事项：

- 注册时记录的是当前 CLI 入口（node 与 cli-main.js）**解析符号链接后的绝对路径**。若入口位于 npx 缓存内，缓存清理/升级后自启会失效——长期使用建议先 `npm i -g agentdog` 全局安装再注册（注册时会检测到 npx 缓存入口并给出警告）。
- 开机自启后，MCP 客户端 npx 挂载照常工作：proxy 检测到 daemon 已运行会直接连接，无冷启动等待。
- daemon 升级：直接重跑一次 `daemon start`，检测到已有实例版本不同会自动停止旧实例并以新版本接管；版本相同则拒绝重复启动。

## 📖 常用命令

```bash
agentdog status                  # 查看整体状态
agentdog daemon start            # 启动 daemon + Web 界面（默认 61125）
agentdog daemon stop             # 停止 daemon
agentdog daemon restart          # 重启 daemon
agentdog daemon logs             # 查看运行日志
agentdog config list             # 列出已配置的服务器
agentdog config add my-server "npx @some/mcp-server@latest" --auto-detect
                                 # 添加子服务器（自动识别传输协议）
agentdog config remove old-server  # 移除子服务器
agentdog diagnose --health-check   # 健康检查
agentdog diagnose --fix            # 自动修复常见问题
```

> 以下示例用 `npx agentdog@latest <命令>` 可达到同样效果，无需全局安装。

## 🖥️ Web 管理界面

- 服务器列表：连接状态、工具数一目了然，支持启用/禁用、编辑、删除、重试连接
- 工具管理：按服务器查看全部工具，逐个开关（白名单/黑名单两种模式）
- 服务器日志：实时查看子服务器的 stdout/stderr
- 客户端配置：一键生成 Claude Desktop / Cursor 的接入配置
- AI 供应商：管理 AI API 网关的供应商与接入配置（见下节）

## 🤖 AI API 网关

daemon 内置 AI API 网关：对外提供 Anthropic Messages 兼容端点，Claude Code 统一接入任意供应商（openai 兼容 / anthropic / gemini）；同时提供 OpenAI Chat Completions 兼容入口 `/openai/v1/chat/completions`（base URL 指向 `<host>:<port>/openai/v1`），OpenAI 协议客户端同样按 `slug:modelId` 寻址。

```bash
agentdog daemon start --web-port 61125   # 网关与 Web 管理界面同端口（方言前缀路由）
```

在 Web 界面"AI 供应商"视图配置供应商（slug、方言、Base URL、API Key），然后：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:61125/anthropic
export ANTHROPIC_API_KEY=<网关 apiKey，界面可复制>
export ANTHROPIC_MODEL=deepseek:deepseek-chat   # 格式：供应商slug:模型Id
export ANTHROPIC_SMALL_FAST_MODEL=deepseek:deepseek-chat
```

- **寻址**：模型名按第一个 `:` 分割，前段命中供应商 slug，后段为上游真实模型名原样透传；未命中返回 400 并列出可用 slug。
- **anthropic 上游直通**：请求字节级转发，`cache_control`、`thinking`、prompt cache 计费字段零损耗；`count_tokens` 直通真值（openai/gemini 上游本地估算）。
- **openai / gemini 转换**：工具调用、图片、system、tool_choice、采样参数经统一 IR 双向映射；流式 SSE 双向转换（延迟提交、ping 保活、断连 abort 链），上游错误状态码透传（message 保留原文，便于诊断中转站差异）。
- **模型列表端点**：`GET /anthropic/v1/models`（含裸 `/v1/models` 别名）与 `GET /openai/v1/models`，返回 `slug:modelId` 形式的可用模型，供客户端模型自动发现。
- **Provider 管理面**：`/api/ai-gateway/*` 与 `/api/ai-providers` REST 接口（CRUD / 连通测试 / 模型拉取），apiKey 脱敏返回；对外 key 以 `ad-sk-` 前缀在首次启用时自动生成。配置文件新增可选段 `aiGateway` / `providers`，老配置无此段 = 网关关闭。
- **已知限制**：gemini 同名函数多调用的 `tool_result` 配对存在歧义；openai 兼容端点（DeepSeek / OpenRouter / 中转站）各有出入，不做静默兼容；OpenAI 入口不支持 `n>1`（返回 400），openai 入口到 anthropic/gemini 上游时 IR 无法承载的参数（`response_format` / `logprobs` / `reasoning_effort` 等）直接丢弃（openai 上游走直通不受影响）；anthropic 上游 thinking 期间 OpenAI 出口静默（SSE 无 ping 约定）；`/v1/models` 不支持分页参数，`created` 为占位值。穿插对话中间的 `system` 消息统一并入开头系统提示；`count_tokens` 无 OpenAI 入口端点（协议本身没有）。

## 🧩 子服务器配置示例

配置文件位于 `~/.agentdog/agentdog.config.json`，也可全部在 Web 界面操作：

```json
{
  "servers": {
    "my-stdio-server": {
      "name": "my-stdio-server",
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "env": { "API_KEY": "xxx" }
    },
    "my-http-server": {
      "name": "my-http-server",
      "enabled": true,
      "transport": "streamable-http",
      "url": "http://127.0.0.1:61123/mcp"
    }
  }
}
```

### 工具冲突处理

多个子服务器存在同名工具时，AgentDog 自动将工具重命名为 `服务器名-工具名`（如 `db-tools-db_query`），调用时先校验完整服务器前缀再剥离转发到原服务器，客户端无感知。

## 🐛 常见问题

**服务器连不上，提示 `initialize timeout`**
Windows 平台下全局命令（npx/npm 等）是 `.cmd` 批处理脚本，本版本已通过 cross-spawn 修复该兼容问题（上游版本在 Windows 上会出现 stdio 子服务器全部连接超时）。

**传入 `--daemon-port` 报错**
IPC 与 Web 界面已合并为单一端口，该参数已删除。请改用 `--web-port`，或直接使用默认端口 61125。

**远程访问 Web 界面启动被拒绝**
默认仅监听 localhost。远程访问必须同时显式配置 `web.host: "0.0.0.0"` 并设置 `MCPDOG_AUTH_TOKEN` 环境变量。

**查看运行日志**
```bash
agentdog daemon logs
```

**工具不可见 / 缺失**
```bash
agentdog detect --all
agentdog config show my-server
```

## 🏢 关于本仓库

- 本仓库（[Agent-Dog](https://github.com/lzm04521/Agent-Dog)）从运维团队 [MCP-Dog](https://github.com/SIE-Operations-and-Maintenance-Team/mcpdog) 分支并持续增强
- npm 包名：`agentdog`（CLI 命令同名）
- 上游原始项目：MIT 协议开源，版权归原作者所有（详见 [LICENSE](./LICENSE) 声明）

## 📄 许可证

MIT License — 详见 [LICENSE](./LICENSE)
