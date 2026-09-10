# 更新日志

本项目所有显著变更都会记录在此文件中。

## [1.3.1] - 2026-09-10

- **同步（上游合并）**：合并上游 `SIE-Operations-and-Maintenance-Team/mcpdog`（@keysqiu/mcpdog 1.0.6~1.0.8）以下变更，并适配 AgentDog 单 Web 端口架构：
  - **新增**：Web 管理界面一键导入 Claude MCP——读取 `~/.claude.json` 顶层用户级 `mcpServers` 批量导入（先预览将导入/将跳过清单再确认；同名冲突、名称不合规或缺 `command`/`url` 的条目跳过并注明原因；`disabled` 条目按禁用状态导入；导入成功的启用服务器自动连接）。读取与转换在 daemon 本机完成，导入逻辑抽离为纯函数模块 `claude-mcp-importer` 并补齐单测。
  - **修复（关键）**：直接编辑 `agentdog.config.json` 后 daemon 永不重载——配置 watch 曾发出 `configChanged` 事件而 daemon 监听 `config-updated`，事件名不匹配导致文件级配置变更被静默忽略；现统一为 `config-updated`，支持编辑器"临时文件 + rename"式保存，并加 300ms 防抖合并同一次保存的多次事件。
  - **修复**：核心服务 `stop()` 未重置 `isStarted` 防重入标记，stop→start 序列中 start 被跳过导致所有适配器断开后无人重连。
  - **优化**：`tools/list` 实时拉取由串行改为并行（`Promise.allSettled`，单 server 保留 8 秒超时上限），多下游异常时不再累计突破 MCP 客户端连接超时。
  - **新增**：daemon 启动即把 stdout/stderr 同步落盘到 `~/.agentdog/daemon-YYYYMMDD.log`（detached + stdio ignore 启动时运行日志此前全部丢弃）。
  - **新增**：proxy 长会话自愈——daemon 意外退出后自动重新拉起（30 秒冷却防频繁 spawn），适配本地 daemon HTTP 探活模型（连接失败与请求失败两条路径触发）；daemon 存活检测在 PID 存活外增加端口握手双重校验（防 Windows 重启后 PID 复用误判）；自动拉起后由固定等待 2 秒改为端口就绪轮询（至多 15 秒）。
  - **优化**：配置全量重载统一由核心服务 `reinitializeAdapters` 执行（增量重建 + 后台连接），移除 daemon 层重复的 stop/start 全量重建路径。
  - Web 管理界面 favicon 更换为 🐕。
- **未采纳（上游 1.0.6）**：`mcpdog service install/uninstall/status` 命令未合入——本地已有等价实现 `agentdog daemon autostart --enable/--disable`（AgentDog 更名后的自启体系），避免两套并存。

## [1.3.0] - 2026-09-08

- **新增（Web 界面）**：侧边栏改为双层菜单——控制台（单页直达）、MCP 服务器（服务器管理 / 日志）、AI 供应商（供应商管理 / 调用日志）三大主菜单，手风琴式交互（当前路由分组自动展开，点组头收起/展开并直达默认页，窄屏为底部图标导航 + 当前分组二级横排）。原一级 `/logs` 全局日志页迁入 MCP 服务器分组为 `/mcp/logs` 并更名"MCP 日志"（旧地址重定向保留）。
- **新增（AI API 网关）**：AI 供应商下新增"调用日志"页（`/providers/logs`）——网关转发请求流水（时间/入口方言/供应商与模型/HTTP 状态/耗时/token 用量），失败请求可展开查看错误摘要、请求结构摘要与上游响应正文前 500 字符；支持按供应商/状态/入口方言筛选。数据经 socket `ai-log` 实时推送，`GET /api/ai-logs` 恢复历史。埋点覆盖 anthropic/openai 两入口的 messages 与 count_tokens，流式响应从 SSE 尾帧解析 usage；不记录 apiKey、请求头与请求正文（防截图 base64 撑爆日志）。
- **新增（日志持久化）**：MCP 日志与 AI 调用日志落盘 `~/.agentdog/logs/`（`mcp.jsonl` / `ai-calls.jsonl`，共享 JSONL 存储模块：内存环形缓冲 500/200 条 + 5MB 轮转 + 启动读尾部，daemon 重启后 Web 页面可恢复历史）。MCP 侧记录子服务器输出/连接事件与 tool-called 工具调用（不记 args/result 正文）；MCP 日志页新增首屏历史恢复（`GET /api/mcp-logs`）。测试可用 `AGENTDOG_LOG_DIR` 环境变量隔离日志目录。
- **新增（AI API 网关）**：OpenAI 入口方言上线——`POST /openai/v1/chat/completions` 全量实现（原 501 占位移除），Cherry Studio / Cline / OpenAI SDK 等 OpenAI 兼容客户端 base URL 指向 `<Web端口>/openai/v1` 即可统一接入任意上游：openai 上游字节级直通（`reasoning_effort` / `response_format` 等原生字段零损耗），anthropic / gemini 上游经 IR 双向转换（工具调用、图片、system、采样参数全映射）。`/openai` 路径的错误（401/503/413 等）改为 OpenAI 格式错误体；`n>1` 请求显式 400。
- **新增（AI API 网关）**：双协议模型列表端点 `GET /anthropic/v1/models`（含裸 `/v1/models` 别名）与 `GET /openai/v1/models`——返回 `slug:modelId` 形式的可用模型（启用供应商的模型全集减去已停用模型），供客户端模型发现；分页参数不模拟、全量返回。
- **调整（Web 界面）**：网关配置信息弹窗中 OpenAI 网关地址去除"规划中"标注，开放复制并补充 OpenAI 兼容客户端接入提示。
- **调整（对外约定）**：AI API 网关端口并入 daemon Web 管理端口（默认 61125）——方言路由挂载在 Web 服务上，`http://localhost:61125/anthropic` 即网关地址，**原独立端口 62125 不再监听**，已接入客户端（Claude Code 等）需将 base URL 从 62125 换为 Web 端口。Web 服务未启动的回退形态下网关仍独立监听 `aiGateway.port`（`--gateway-port` 仅作用于该回退）。网关开关/apiKey 改为请求时实时读配置，修改即时生效；网关路径持 apiKey 认证、不受 Web 登录 token 与全局 body 限制影响（自带 32MB 解析）。
- **新增（AI API 网关）**：对外路由增加方言前缀层，同端口按路径区分协议——`POST /anthropic/v1/messages`、`POST /anthropic/v1/messages/count_tokens` 为正式端点；`/openai/v1/chat/completions`、`/openai/v1/models` 路由预留（返回 501 + OpenAI 风格错误体）。裸 `/v1/messages` 与 `/v1/messages/count_tokens` 保留为 Anthropic 向后兼容别名（同一 handler），已接入客户端零感知。
- **调整（Web 界面）**："AI API 网关"设置行重排——网关开关移至监听信息之前（紧跟标题徽章），行内不再展示监听地址与 apiKey；新增"配置信息"按钮（网关开启时显示），弹窗集中展示 apiKey（复制/重置）、Anthropic/OpenAI 网关地址（OpenAI 标注规划中）、监听地址、运行状态与模型寻址格式。
- **调整（Web 界面）**：内容区去除 1600px 最大宽度，撑满侧边栏右侧全部空间；导航与页标题"Dashboard"更名"控制台"（路由 `/dashboard` 不变）。
- **重构（Web 界面）**："添加 MCP 服务器"由弹窗改为独立页面 `/mcp/add`（表单与 JSON 双模式保留；表单模式传输协议改为三卡片选择、基本信息/连接配置/高级选项分区布局、底部粘性操作条）；新增编辑复用入口 `?name=` 预填保存（走 `PUT /api/servers/:name`）。原 `AddServerModal` 删除，`configStore` 的 add-server 弹窗状态同步清理。
- **重构（Web 界面）**："AI 供应商"页改为与 MCP 页一致的「上状态（统计 + 网关设置）+ 左供应商列表 + 右详情」布局，默认选中首个供应商；模型管理由弹窗（ModelsPanel）改为详情面板内嵌区块（ModelsSection），删除原弹窗及 providerStore 的 `modelsPanelProviderId` 状态。

## [1.2.0] - 2026-09-07

- **调整（Web 界面）**：侧边栏底部版本号/配置路径移除，配置文件路径改由顶栏展示（窄屏自动隐藏，悬停显示全路径，版本号保留在顶栏运行状态徽章内）；"AI 供应商"页布局重排——页头（标题 + 数量徽章 + 右侧新增按钮）→ 网关设置压缩为单行横条卡（开关/运行徽章/监听地址/apiKey 管理），移除 Claude Code 接入配置卡片（环境变量示例与一键复制）。
- **调整（Web 界面）**：管理界面参考 gemini2api 设计语言整体重设计。布局改为「sticky 玻璃拟态顶栏（品牌 + 运行状态徽章 + 主题切换 + GitHub）+ 240px 玻璃侧边栏 + 1600px 内容区」（≤900px 侧边栏隐藏、底部浮动图标导航）；路由扩为四页——`/dashboard`（新默认页：服务器/工具/AI 供应商/运行时长统计卡、系统信息面板、服务器状态网格、实时事件预览，数据复用既有接口与 socket 推送，无新增后端 API）、`/mcp`、`/providers`、`/logs`（新全局日志页：聚合实时事件流与服务器日志，按服务器筛选、暂停刷新、自动滚动）。
- **调整（Web 界面）**：明暗两套主题统一为同一设计语言（同一支 Emerald 主色 + Slate 灰 + 同一语义色，仅表面亮度不同），通过覆盖 daisyUI 主题变量（`web/src/index.css` design tokens）实现全站控件（按钮/输入/开关/徽章/表格/弹窗）统一换肤；亮色主色用深一档 `#047857` 保证白底小字对比度 ≥4.5:1，暗色用亮调 `#10b981`。圆角体系：卡片 1rem、控件 0.6rem。设计稿与实施文档见 `doc/`（不入库）。
- **修复（Web 界面）**：前端 `SystemStatus` 类型与 socket `status-update` 实际载荷不符（载荷为 `{ daemon: { uptime... }, mcpServer, servers, totalTools... }`，类型却声明 `uptime/timestamp/initialized`），已按真实载荷修正；Dashboard 运行时长取 `daemon.uptime`。
- **调整（Web 界面）**：管理界面整体重设计为左侧边栏布局，"MCP 服务器 / AI 供应商"由页内 tab 切换改为侧边栏菜单导航，并引入前端路由（`react-router-dom`，`/mcp` 默认、`/providers`，`/` 与未知路径重定向 `/mcp`，刷新/直达由既有 SPA fallback 支持）。原蓝色渐变 Header 移除，版本/配置路径/主题切换/GitHub 收纳至侧边栏，视觉整体改为跟随明暗主题的中性色风格；登录页改为居中卡片式。页面内部组件交互不变，仅视觉微调。

- **调整（对外约定）**：项目标识由 MCPDog 全面更名 AgentDog。运行时数据目录 `~/.mcpdog/` → `~/.agentdog/`（配置 `agentdog.config.json`、PID `agentdog.pid`、VBS/systemd/LaunchAgent 自启文件与 `com.agentdog.daemon` label 同步更名）；首次启动检测到旧配置时自动复制迁移到新路径（旧文件保留）。升级前请先停旧版 daemon（旧 PID 文件在新版本中不可见，`agentdog stop` 无法停止旧进程）。其余更名：协议展示名（initialize serverInfo.name、`mcpdog-proxy`/`mcpdog-detector`/`mcpdog-streamable-http`、User-Agent）、内部头 `X-MCPDog-Client` → `X-AgentDog-Client`、审计报告文件名前缀 `agentdog-audit-*`、Web localStorage 键（已存访问令牌失效，重新输入一次即可）、类名/类型名（MCPDogServer → AgentDogServer 等，含文件 `agentdog-server.ts`/`agentdog-daemon.ts`）。保留不变：环境变量 `MCPDOG_AUTH_TOKEN`（部署契约）、上游仓库链接（fork 来源）、CHANGELOG 历史条目。

## [1.1.0] - 2026-09-07

- **新增（AI API 网关一期）**：daemon 内新增 AI API 网关子系统，对外提供 Anthropic Messages 兼容端点（`POST /v1/messages`、`POST /v1/messages/count_tokens`，默认 `127.0.0.1:62125`，`daemon start --gateway-port` 持久化端口并启用），Claude Code 设 `ANTHROPIC_BASE_URL` 指向网关即可统一接入任意供应商。模型按 `slug:modelId` 前缀寻址（第一个 `:` 分割，如 `deepseek:deepseek-chat`），未命中 slug 返回 400 并列出可用列表。
- **新增**：三种上游方言通道——anthropic 直通（字节级转发，`cache_control`/`thinking`/计费字段零损耗，count_tokens 直通真值）、openai 兼容与 gemini（经统一中间表示 IR 双向转换：工具调用、图片、system、tool_choice、采样参数全映射；openai 历史 tool 消息缺失自动补空容错，gemini JSON Schema 净化、functionResponse 包装）。流式 SSE 双向转换（延迟提交、30s ping 保活、5 分钟无字节 watchdog、客户端断连 abort 链、上游错误状态码透传 + Anthropic 格式错误体 + message 原文保留）。
- **新增**：Provider 管理面——daemon Web 端口 `/api/ai-gateway/*` 与 `/api/ai-providers`（CRUD / 连通测试 / 模型拉取，apiKey 脱敏返回、对外 key `ad-sk-` 前缀首次启用自动生成）；Web 界面新增"AI 供应商"视图（供应商卡片管理、slug 实时校验表单、模型管理面板、网关设置 + Claude Code 接入环境变量一键复制）。配置新增可选段 `aiGateway` / `providers`（老配置无此段 = 网关关闭）。已知限制：gemini 同名函数多调用的 tool_result 配对存在歧义；openai 兼容端点差异不做静默兼容，错误原文透传便于诊断。
- **调整（对外约定）**：daemon IPC 与 Web 管理界面合并为单一 TCP 端口。原 `--daemon-port`（默认 9999）的独立 TCP IPC 通道删除，CLI `status`/`reload` 与 `proxy` 挂载全部改走 Web 端口 HTTP（`POST /api/mcp`）；传入 `--daemon-port` 将直接报错并提示移除该参数。
- **调整（安全）**：Web 界面默认监听收紧为 `localhost`（原为 `0.0.0.0`）。需要远程访问时须显式配置 `web.host: "0.0.0.0"` 且强制设置 `MCPDOG_AUTH_TOKEN`，缺一拒绝启动。
- **优化**：daemon 客户端由手写 TCP 行协议改为 HTTP（Node 内置 fetch），大响应（如聚合 `tools/list`）由 HTTP 分帧承载，消除跨 TCP 分片解析类缺陷的结构性温床；daemon 重启后 proxy 请求自愈改为"探活 + 单次重试"。

## [1.0.6] - 2026-09-06

- **调整（对外约定）**：npm 包名由 `@keysqiu/mcpdog` 调整为 `@lzm04521/mcpdog`，安装与 npx 命令请使用新包名。本版本为 `@lzm04521/mcpdog` 首个发布，包含 `@keysqiu/mcpdog` 1.0.4 / 1.0.5 的全部变更（见下）；新版本发布后旧包将标记弃用并指向新包。
- **修复**：Web 管理界面「客户端配置」推荐的 stdio 接入命令使用 npm 裸包名（registry 上为无关第三方项目，存在装错包风险），现改为 `@lzm04521/mcpdog@latest`。
- **调整（对外约定）**：npm 包名最终定名裸名 **`agentdog`**（registry 已确认未占用），CLI 命令名同步 `mcpdog` → `agentdog`（bin 入口、全部帮助文本与文档示例更新）；仓库同步更名 [Agent-Dog](https://github.com/lzm04521/Agent-Dog)。安装 `npm i -g agentdog`，npx 挂载 `npx agentdog@latest`。本地数据标识不变：配置仍在 `~/.mcpdog/mcpdog.config.json`，升级后原配置与已注册开机自启继续有效。
- **修复**：proxy 侧 PID 文件按纯数字解析，而 daemon 自 1.0.5 起写入 JSON 格式（含版本号），导致 daemon 存活检测恒失败——daemon 已运行时每次客户端冷启动仍重复拉起一次 `daemon start` 并固定多等待约 2 秒。PID 读取收敛为共享双格式解析模块（`src/daemon/daemon-info.ts`），proxy 与 daemon 命令统一复用。
- **新增**：`mcpdog daemon autostart --enable/--disable`（无参数显示状态），daemon 开机自启管理。Windows 使用 HKCU Run 注册表键 + `~/.mcpdog` 隐藏 VBS 启动器（登录无窗口），macOS 使用 LaunchAgent，Linux 使用 systemd user unit；注册记录 node 与 CLI 入口的稳定绝对路径（符号链接已解析），入口位于 npx 缓存时给出警告。
- **新增**：Web 管理界面默认端口 38881 → 61125。`daemon start --web-port` 显式指定的端口持久化到配置文件（`web.port`），后续启动免传参；未指定时依次取保存值、默认 61125，端口被占自动探测相邻可用端口（探测漂移值不回写配置）。

## [1.0.5] - 2026-09-04

- **新增**：daemon 版本更新自动接管。PID 文件现在记录 daemon 版本号，`daemon start` 检测到已有实例运行且版本不同（或为无版本信息的旧格式 PID 文件）时，自动停止旧实例并以新版本启动——版本更新后重跑一次启动命令即可完成升级，不再被 "Daemon is already running" 挡住导致老版本继续伺服。版本相同时仍拒绝重复启动。
- **新增**：`mcpdog daemon restart` 命令，等价于 stop + start。

## [1.0.4] - 2026-09-04

- **新增**：Web 管理界面顶部 Header 栏，展示版本号、当前配置文件路径（`/api/system/info` 新增接口）、主题切换与 GitHub 仓库入口。
- **新增**：服务详情操作区新增"重试连接"按钮（删除/启用开关左侧），首次连接失败后可一键重连，复用启用开关的重连机制（禁用移除旧适配器→启用重建连接）。
- **优化**：服务器列表选中态样式加强：整圈主题色描边 + 服务器名高亮加粗 + 主题色背景。
- **优化**：整页锁定视口高度不再整页滚动，左侧服务器列表与右侧内容区改为独立滚动容器，服务详情标题栏与 tab 栏固定。
- **优化**：运行日志显示区由固定高度改为自适应填满面板剩余高度。
- **优化**：顶部统计数字分色显示（总计/已启用/已连接/已启用工具），颜色与工具面板统计卡片错开；移除与 Header 重复的页面标题；顶部操作栏去除外侧主题切换按钮。
- **优化**：工具面板"关于工具控制"说明移至列表表头上方，便于操作前查看。
- **修复**："连接 MCPDOG"弹窗 STDIO 配置的 npm 包名修正为 `@keysqiu/mcpdog`（原 `mcpdog` 在 registry 上并非本项目）。

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

