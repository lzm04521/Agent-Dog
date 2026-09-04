# 更新日志

本项目所有显著变更都会记录在此文件中。

## [1.0.3] - 2026-09-04

- **修复（关键）**：MCP 客户端（Claude Code 等）连接 mcpdog 后 `tools/list` 超时（`connected · tools fetch failed`）的问题。proxy 与 daemon 间自定义 TCP 行协议的解析不做跨 chunk 缓冲，聚合工具数较多时 `tools/list` 响应（约 112KB）超过单个 TCP 分片（约 64KB），被拆分后各片段 `JSON.parse` 必然失败，且 stdio proxy 为 silent 模式错误被静默吞掉，请求方一直等到超时。现改为跨 chunk 拼接后再按行切分。该缺陷继承自原版（npm `mcpdog@2.2.6` 同样存在），工具数量少、响应未超过单个分片时不触发。
- **修复**：daemon 侧解析客户端请求存在同款隐患（如 `tools/call` 携带大参数时），同步增加每连接独立的分片缓冲。

## [1.0.2] - 2026-09-03

- **修复**：Windows 上 stdio 子服务器经 `cmd.exe` 启动时会弹出大量可见 CMD 窗口的问题。子进程 spawn 增加 `windowsHide: true`，后台静默启动，stdio 管道通信不受影响。

## [1.0.1] - 2026-09-03

与 1.0.0 内容一致（1.0.0 因 registry 版本记录清理未对外保留，此版本为团队维护版实际首发版本）。

### 团队维护版首个发布

- **修复（关键）**：Windows 平台下 stdio 子服务器全部连接超时的问题。原版本用 Node 原生 `child_process.spawn`（`shell: false`）启动子进程，Windows 上 `npx`、`npm` 等全局命令实为 `.cmd` 批处理脚本，无法被直接启动，导致进程未运行即 `initialize` 握手 30 秒超时。现改用 `cross-spawn`（与官方 `@modelcontextprotocol/sdk` 同方案），Windows 自动经 `cmd.exe` 解析启动。
- **新增**：Web 管理界面全面汉化。
- **新增**：服务器配置支持 `adminUrl` 字段，可在主界面直接跳转子 MCP 服务器自带的管理页面。
- **修复**：传输类型切换时残留字段未清理的问题。
- **修复**：工具名前缀剥离逻辑——此前对带连字符的工具名（如 `browserman-local-x_post`）会错误剥离前缀，现改为先校验完整服务器前缀再剥离。
- **调整**：工具名冲突分隔符由冒号改为连字符，提升客户端兼容性。
- **调整**：Web 界面默认端口由 3000 改为 38881。
- **仓库迁移**：代码迁移至 SIE 运维团队组织仓库维护，npm 包名调整为 `@keysqiu/mcpdog`。

## 上游历史

上游开源项目（2.2.6 及更早）的变更记录请参考其官方仓库。

