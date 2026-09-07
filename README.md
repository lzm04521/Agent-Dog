# MCPDog 🐕 — MCP 服务器统一管理网关（团队维护版）

> **一次配置，统一管理所有 MCP 服务器**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

MCPDog 是一个 MCP（Model Context Protocol）服务器统一管理网关：把多个 MCP 子服务器聚合成一个统一入口，供 Claude Desktop、Cursor、Claude Code 等 MCP 客户端使用。由 SIE 运维团队基于上游开源项目维护，包含 Windows 平台兼容修复与 Web 界面汉化等本地化改进。

## 🏗️ 架构概览

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MCP 客户端:   │    │   MCP 客户端:   │    │   MCP 客户端:   │
│    (Claude)     │    │    (Cursor)     │    │  (Claude Code)  │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │         MCPDog             │
                    │    （统一入口 + 智能路由）  │
                    └────────────┬──────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
    ┌─────▼─────┐         ┌──────▼──────┐         ┌─────▼─────┐
│ db-tools    │         │  itsm-tools │         │ playwright │
└───────────┘         └─────────────┘         └───────────┘
```

### 核心价值

- **🔗 一次配置**：客户端只连 MCPDog 一个入口，不用逐个配置子服务器
- **🔄 统一界面**：所有子服务器的工具合并成一张清单暴露给客户端
- **⚡ 智能路由**：MCPDog 自动把工具调用路由到对应的子服务器
- **🌐 多传输协议**：子服务器支持 stdio / HTTP SSE / Streamable HTTP 三种接入方式
- **📊 集中管理**：Web 管理界面可视化增删改查服务器、启停、工具开关
- **🛡️ 故障隔离**：单个子服务器挂掉不影响其他子服务器和整体入口

## 🚀 快速开始

前置要求：Node.js ≥ 18。无需安装，npx 直接启动：

```bash
npx agentdog@latest daemon start
```

启动后浏览器打开 `http://localhost:61125` 即可看到 Web 管理界面，在界面里添加并管理子服务器。

> Web 管理界面默认端口 **61125**。`daemon start --web-port <端口>` 显式指定的端口会保存到配置文件（`~/.mcpdog/mcpdog.config.json` 的 `web.port`），之后启动无需再传参；端口被占时自动探测相邻可用端口。

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

> 客户端连的是 MCPDog 聚合入口，前提是 daemon 已启动并配好子服务器。

## 📖 常用命令

```bash
npx agentdog@latest status              # 查看整体状态
npx agentdog@latest daemon start        # 启动 daemon + Web 界面（默认 61125）
npx agentdog@latest daemon stop         # 停止 daemon
npx agentdog@latest daemon restart      # 重启 daemon（版本更新后直接重跑 start 也会自动升级重启）
npx agentdog@latest daemon autostart --enable   # 注册 daemon 开机自启（当前用户）
npx agentdog@latest daemon autostart    # 查看开机自启状态
npx agentdog@latest daemon autostart --disable  # 移除开机自启
npx agentdog@latest config list          # 列出已配置的服务器
npx agentdog@latest config add my-server "npx @some/mcp-server@latest" --auto-detect
                                                # 添加子服务器（自动识别传输协议）
npx agentdog@latest config remove old-server       # 移除子服务器
npx agentdog@latest diagnose --health-check        # 健康检查
npx agentdog@latest diagnose --fix                # 自动修复常见问题
```

### daemon 开机自启（可选）

- Windows：注册表 HKCU Run 键 + `~/.mcpdog` 下隐藏 VBS 启动器，登录时无窗口启动 daemon。
- macOS：LaunchAgent；Linux：systemd user unit（需 systemd --user 可用）。
- 注册时记录的是当前 CLI 入口（node 与 cli-main.js）的绝对路径；npx 缓存清理/升级后可能失效，长期使用建议全局安装（`npm i -g agentdog`）后注册。
- 开机自启后，MCP 客户端 npx 挂载照常工作：proxy 检测到 daemon 已运行会直接连接，无冷启动等待。

## 🖥️ Web 管理界面

- 服务器列表：连接状态、工具数一目了然，支持启用/禁用、编辑、删除
- 工具管理：按服务器查看全部工具，逐个开关（白名单/黑名单两种模式）
- 服务器日志：实时查看子服务器的 stdout/stderr
- 客户端配置：一键生成 Claude Desktop / Cursor 的接入配置

## 🧩 子服务器配置示例

配置文件位于 `~/.mcpdog/mcpdog.config.json`，也可全部在 Web 界面操作：

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

多个子服务器存在同名工具时，MCPDog 自动将工具重命名为 `服务器名-工具名`（如 `db-tools-db_query`），调用时自动剥前缀转发到原服务器，客户端无感知。

## 🐛 常见问题

**服务器连不上，提示 `initialize timeout`**
Windows 平台下全局命令（npx/npm 等）是 `.cmd` 批处理脚本，本版本已通过 cross-spawn 修复该兼容问题（上游版本在 Windows 上会出现 stdio 子服务器全部连接超时）。

**查看运行日志**
```bash
npx agentdog@latest daemon logs
```

**工具不可见 / 缺失**
```bash
npx agentdog@latest detect --all
npx agentdog@latest config show my-server
```

## 🏢 关于本仓库

- 本仓库由 **SIE 运维团队** 维护，在上游开源项目基础上做了本地化改进
- 上游原始项目：MIT 协议开源，版权归原作者所有（详见 [LICENSE](./LICENSE) 声明）

## 📄 许可证

MIT License — 详见 [LICENSE](./LICENSE)
