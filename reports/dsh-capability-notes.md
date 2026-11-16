# DSH 侧接口能力核查记录（主代理自测，2026-11-16）

> 环境：`@deepseek-ai/dsh` **0.2.1-rc.5**，Windows，Node **v24.19.0**，npm 11.17.0
> DSH_HOME=`C:\Users\Lenovo\.dsh`（含 profiles / skills / sessions / plugins-data）

## 1. MCP 客户端：可以直接挂一个 Minecraft MCP server（`dsh-mcp-client`）
- 支持两种传输：**stdio**（本地进程，`command`/`args`/`env`/`cwd`）与 **streamable-http**（`url`/`headers`）。
- 工具命名：`mcp__<serverName>__<rawName>`，如 `mcp__mc__dig_block`。名字稳定，跨会话/重启/权限规则可复用。
- **图片可以回传**：MCP 工具结果里的 PNG/JPEG/WebP/GIF，在「当前模型支持图片输入」且附件功能开启时，会像普通图片一样进入对话 —— **这意味着 bot 截图可以被模型"看见"**。
- 单次调用超时默认 **60,000 ms**（`toolCallTimeoutMs` 可调）；断线自动重连（500ms 起指数退避至 30s，10 次失败后摘除）。
- 启动失败默认不阻断：`failOnStartupError: false`。
- ⚠️ 约束：不支持 MCP **prompt templates**；不支持资源订阅；要求 task-based 执行扩展的工具会被拒绝。
- 配置示例（可直接抄）：
```yaml
- id: mcp-mc
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: mc
    transport: stdio
    command: node
    args: ['D:/AR_MC/mc-mcp/server.js']
    toolCallTimeoutMs: 15000
```

## 2. Web GUI 可以绑到局域网（手机浏览器直接开）
`@deepseek-ai/dsh-host-webserver` 的 config：
```yaml
- name: '@deepseek-ai/dsh-host-webserver'
  config:
    host: 192.168.x.x   # 只能是本机某个具体网卡地址的 IPv4/IPv6 字面量
    port: 3080
```
- **明确支持**：非 loopback 字面量 = 对该网段提供服务（明文 HTTP，除非配 `tls`）。
- **明确拒绝**：`0.0.0.0` 这类 unspecified 地址会在加载时报错（不会一键监听所有网卡）→ 必须填具体网卡 IP。
- ⚠️ **安全警告（官方 README 原文）**：carrier 层**没有**统一鉴权/Origin 策略，"Binding a non-loopback address still exposes unprotected routes and static assets to that network."
- 有 `tls: { certFile, keyFile }`，PEM 必须未加密，支持证书链；不负责签发/续期。
- `port: 0` 表示让 OS 分配。

## 3. 语音输入：浏览器麦克风 + 本地 SenseVoice（`dsh-experimental-voice-input-bundle`）
- 组成：speech Service Definition + **本地 SenseVoiceSmall ONNX + Silero VAD**（Host CPU 跑，无需 Python/编译/模型转换，int8 默认）。
- 形态：Web GUI 里模型选择器和 Send 之间的**麦克风按钮** → 录音 → 转写插入输入框。
- 下载源：默认 huggingface.co + hf-mirror.com（国内可用），带 SHA-256 校验、可离线指定路径。
- ⚠️ **硬约束（对手机方案致命）**：**"Browser microphone access requires HTTPS or loopback"** —— 手机用 `http://192.168.x.x:3080` 打开**拿不到麦克风权限**。要么配 TLS 证书，要么走 Tailscale/隧道给 https，要么手机端不用麦克风。
- 默认 profile **未启用**，需在 Plugins 里手动打开。

## 4. 其他相关能力
| 包 | 作用 | 对我们的价值 |
|---|---|---|
| `dsh-headless` | `dsh headless "task"` 一次性跑完打印结果 | 适合"让 AI 做一件事然后退出"，不适合实时陪玩循环 |
| `dsh-persona` | persona / 角色卡 | 直接对应"大肥鱼"式角色卡（性格、口癖、设定） |
| `dsh-goal` + `dsh-goal-round-driver` | 跨轮持续目标 | "长期陪玩/长期目标"可用 |
| `dsh-acp-app` + `@agentclientprotocol/sdk` | ACP 协议 | 可被外部客户端驱动 |
| `dsh-sdk-app` / `dsh-sdk-client` / `dsh-sdk-jsonrpc-server` | 编程式 SDK / JSON-RPC | 想写"游戏内嵌 DSH"时用 |
| `dsh-skill-filesystem` / `dsh-tool-skill` | skill 机制 | 可写一个 `mc-companion` skill 教会 AI 玩法 |
| `dsh-experimental-tool-agent-team` | 多 agent | 可做"多人陪玩"（多个 bot 各一个 agent） |
| `dsh-subagent` / `dsh-workflow` | 子代理/工作流 | 不适合实时游戏循环（开销大） |
| `dsh-web-search-deepseek` / `dsh-web-fetch-http` | 联网 | AI 可以查 MC wiki（有用！） |

## 4.5 【关键】`dsh-game`：DSH 生态里已经有人做完了 80%
仓库 `luckui/dsh-game`（MIT），README 抓取自 raw.githubusercontent.com（2026-11-16）。**这极可能才是用户说的"大肥鱼陪玩 mc"**——大肥鱼就是 DSH 的 Q 版鲸鱼娘吉祥物。

已确认的关键事实：
- 形态：**DSH 插件**（侧边栏"游戏"→游戏库→"▶ 让大肥鱼玩"），不是独立程序。自带 agent 预设「大肥鱼玩游戏」（**只有人设和游戏工具，没有文件读写和 shell**）→ 与我们"给 AI 一个受限的游戏身体"的思路完全一致。
- MC 身体：**mineflayer，跑在单独的 Node 子进程**里，离线账户连服务器。
- 观察通道：**结构化状态 + 事件推送**（挨打/天黑/怪物靠近/事情做完/有人说话/有人进出/死亡）+ 特殊视图工具（`look` 65×65 俯视图、三张投影、`view` 切片、方块贴图渲染图）。**不是靠看截图**。
- 动作粒度：高层工具（采集/合成/熔炼/走到坐标/找方块/打怪/放方块/装备/丢捡/躲避/逃跑/睡觉/游戏内打字/`dig` 单格/桶/点火/`build`/`site`/`show`/`mark`/`journal`）。复杂技能（盖房子、种地、养动物、下界门）是**硬编码流程 + 模型出图纸**的混合。
- 世界不停：长动作在后台跑，可排队；身体有自主反射（吃东西、还手、躲苦力怕、溺水自救）。
- 摄像机：**真的启动一个 MC 客户端**（离线账户 `DaFeiYuCam`），RCON 发 `gamemode spectator`/`spectate`/`data get entity` 挂到她身上；相机是个跟着走的展示实体；HUD 是 PowerShell 现场编译 C# 做的透明点击穿透窗口；**HUD 网页只监听 `127.0.0.1:7391`**。
- **⚠️ 最关键的缺口（正是用户要的）**：开局设置里只有「她自己玩」，**「和你一起玩」（你用自己的客户端进同一个服务器）明确写着"是下一阶段"**。→ 用户想要的"AI 一起玩"，在这个项目里**还没做**。
- 其他局限：**只在 1.21.4 上测过**；服务器必须 `online-mode=false`（离线模式）；两个 README 自相矛盾（根 README 说她能种地养动物，包 README 的"现在的局限"说"不会种地和养动物"）。
- 语音：豆包（火山引擎）TTS，需要 API Key；不配只有字幕。**没有 ASR/听玩家说话**（只有游戏内聊天打字）。
- 依赖：Windows + DSH `0.2.0-rc.2` 网页版 + 同版本 MC 客户端 + RCON + Java 21。
- 状态：**未发布 npm，需从源码 pnpm 构建**。
- 关联：提到直播插件 `dsh-livestream`；MC 素材 CC BY-NC-SA 4.0（"形象来自社区创作"）。

对我们"手机摄像头看到"的直接影响：
- HUD 只绑 loopback → 手机看不到；摄像机是**真客户端窗口** → 手机要看只能**串流整个屏幕**（Sunshine/Moonlight、RustDesk）或**把 HUD 页面暴露到局域网**（改一行 host）。
- 所以 R4 的正解很可能是：**手机看"摄像机窗口"的串流**（真画面，最像"陪玩"），而不是摄像头拍屏幕。

## 4.6 【实测】局域网手机访问：已在本机跑通（2026-11-16 17:41）
命令（等价 `dsh web --host <LAN-IP> --port <port> --no-open`）：
```
node <dsh>\lib\bin.js web --host 192.168.68.54 --port 3099 --no-open
```
启动输出：
```
dsh web: http://192.168.68.54:3099/?token=OIz30k1TTX24P5hMopMKx2iEFGCpzFeLeFSZka5OaxI
dsh web: listening on 192.168.68.54 over plain HTTP; restrict this port to a trusted proxy or network
```
实测结果（`Get-NetTCPConnection` 确认监听 `192.168.68.54:3099`）：
| 请求 | 结果 |
|---|---|
| `GET http://192.168.68.54:3099/` | **401 未授权** |
| `GET http://192.168.68.54:3099/?token=<token>` | **200，38,343 字节 HTML** |
| `GET /api` | **401** |
| `GET /api/health` | **401** |

→ **结论：DSH 的 web profile 在 LAN 上有 token 鉴权**（carrier README 说的"无鉴权"只是 carrier 层，app 层补了 token）。手机要做的只有：**扫码/输入那条带 token 的 URL**。
→ 因此 **R6（手机端跑 DSH）不需要**：手机浏览器即客户端。
→ 唯一遗留：**手机麦克风需 HTTPS**（浏览器安全上下文规则），`http://192.168.x.x` 下拿不到麦克风。解法：`--tls-cert/--tls-key` 自签（手机需信任 CA）、或 Tailscale serve / cloudflared 给出合法证书。

## 4.7 版本支持门槛已通过（实测 2026-11-16）
`minecraft-data` 的 `dataPaths.json` 共 **72 个 PC 版本**，最新到 **1.21.11** 与 **26.1**，**含 1.21.4**（dsh-game 的测试版本）。
npm 现状：
| 包 | 版本 | 最后更新 |
|---|---|---|
| mineflayer | 4.39.0 | 2026-09-06 |
| minecraft-protocol | 1.68.0 | 2026-08-27 |
| minecraft-data | 3.119.0 | — |
| prismarine-viewer | 1.33.0 | 2025-02-09 |
| mineflayer-pathfinder | 2.4.5 | 2023-09-04 |
| mineflayer-collectblock | 1.6.0 | 2025-01-24 |
| mineflayer-pvp | 1.3.2 | 2022-07-03 |
| mineflayer-armor-manager | 2.0.1 | 2023-07-01 |
| mineflayer-tool | 1.2.0 | 2022-05-11 |
→ **mineflayer 主线活跃（2026 年还在发版）**，但周边插件（pathfinder/pvp/armor/tool）已 2–4 年未更新，是"能跑但没人维护"的状态。

## 4.8 【关键技术证据】mineflayer 能"看见人类玩家"→「一起玩」在协议层成立
抓自 `PrismarineJS/mineflayer/docs/api.md`（2026-11-16，85KB）。对**任意实体（含其他玩家）**都有事件：

| 事件 | 对"感知玩家在干什么"的意义 |
|---|---|
| `entitySwingArm(entity)` | 玩家在挥手 → 挖矿/攻击/空挥 |
| `entityMoved(entity)` | 走位、跑、跳 |
| `blockBreakProgressObserved(block, destroyStage, entity)` | **能看到玩家正在挖哪一格、挖到第几阶段** |
| `blockPlaced(oldBlock, newBlock)` | 玩家放了什么方块 |
| `blockUpdate(oldBlock, newBlock)` | 世界变化（含玩家造成） |
| `entityCrouch` / `entityUncrouch` | 潜行（搭桥/防掉） |
| `entityEquip(entity)` | 玩家换了手持物 |
| `entityEat` / `entitySleep` / `entityHurt` / `entityDead` | 吃饭、睡觉、受伤、死亡 |
| `soundEffectHeard(soundName, position, volume, pitch)` | 听声辨位（脚步、挖掘、爆炸） |
| `chat` / `whisper` / `playerJoined` / `playerLeft` | 说话、进出 |
| `bot.players` | username → player 对象（含 entity） |

**结论**：做「AI 和我一起玩」，**不需要视觉**——用事件流就能重建"玩家意图"（挖矿/建造/逃跑/探索），精度远高于截图。
这直接支撑架构建议：写一个 `PlayerIntentTracker`，把事件流聚合成语义事件（"玩家在挖石头 12 秒了，可能在挖矿道"）再喂模型。

## 5. 初步结论（待与子代理结果合并）
1. **"手机端跑 DSH" 大概率是伪需求**：DSH 的 Web GUI 本来就是浏览器端，手机浏览器打开 `http://<PC-IP>:3080` 就能看到整个会话、能打字、能看 AI 在做什么。真正要在手机上跑的只有"浏览器"。
2. 但 **麦克风** 这一个能力受 HTTPS 限制，是唯一需要额外工程（TLS/隧道）的点。
3. **AI 大脑 = DSH + 一个 Minecraft MCP server** 是接口上最干净的路径：不用改 DSH，不用改游戏，只写一个 MCP server 包 mineflayer。
4. mcmod 的「大肥鱼」mod 走的是**反方向**（LLM 嵌进游戏客户端），轻但死路（纯聊天、无动作、无多人）。
