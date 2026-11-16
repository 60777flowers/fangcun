# 桌面 Minecraft × AI 陪玩：全量调查报告

> 调查日期：**2026-11-16**（北京时间）｜所有 star / 版本数字均为当日快照
> 组织方式：主代理 + **4 个并行子代理**（桌面 MC 开源全景 / 大肥鱼专题 / 手机互联决策 / DSH 插件生态）+ **11 项本机实测**
> 你的要求：「先做发散式调查，不急于归并到一个思路」——本报告先给全景与证据，**§5 才收敛，§9 只留三个需要你拍板的问题**。

---

## 0. 三分钟结论

### 0.1 一句话

> **你要做的东西，九成已经被人做出来了 —— 而且不是一个，是三个；但没有一个把「和你一起玩」做通。**

| 已有作品 | 做到了什么 | 缺什么 |
|---|---|---|
| **`luckui/dsh-game`**（14★，DSH 插件） | 大肥鱼用 mineflayer 进服自己砍树/盖房/下界/边玩边说（豆包 TTS），开**真 MC 客户端**旁观跟拍给你看 | 「和你一起玩」被**硬编码关掉**（`mode:'solo'`），但零件全在 |
| **`Numen` 言出法随**（611★，游戏内 mod） | AI 是**真玩家实体**，12 个 MC 版本，原生语音进出，联机服可用，**能整体当 MCP 服务器** | 外脑模式下人设/记忆要你补；**无视觉** |
| **`whale-craft` / `dsh-mc-agent`**（60★ / 35★，DSH 插件） | **41 个 `mc_*` 工具**、npm 一行装、watchdog、长期记忆，开箱即用 | 社区小，没做"同伴"语义 |

**所以你的项目定位应该从"做一个 AI 陪玩 MC"调整成"把已有的身体接上一个真正懂我的大脑，并让它跟我一起玩"。**

### 0.2 六个必须知道的判断（都有证据，见后文）

| # | 判断 | 强度 |
|---|---|---|
| 1 | 你说的「大肥鱼陪玩 MC」**是 `luckui/dsh-game`，不是** mcmod 那个 `[bff]大肥鱼AI聊天` 模组（那玩意**连编译都编不出来**） | 强 |
| 2 | **「手机摄像头拍屏幕」要淘汰**：对 AI 是纯信息损失，对人比串流更差 | 强 |
| 3 | **「手机端跑 DSH」不需要**：`dsh web --host <LAN-IP>` 一行命令，手机浏览器带 token 打开即可（**我已实测 401→200**） | 强（实测） |
| 4 | **「AI 一起玩」技术上通**：mineflayer 能逐事件看到人类玩家在挖哪一格、放什么、潜行、吃饭、说话 | 强 |
| 5 | **DSH ↔ Numen 的接口是通的**：Numen 的 MCP 是 streamable-HTTP + Bearer，而 DSH 的 `mcp-client` **支持自定义 headers** | 强（两边文档对齐） |
| 6 | **「AI 陪玩家玩」这个方向被认领了 6 次，产品 0 个**；两个真空（AI 看得到**玩家**的画面 / 陪伴发生在**游戏内**）恰好是别人绕开的 | 强（扫了 739 个仓库） |

### 0.3 推荐动作（按顺序，第一天就能有结果）

1. **30 分钟**：装 `whale-craft`（**npm 一行**，60★，带 watchdog 与长期记忆）或 `dsh-mc-agent`（41 工具最全，GitHub 装），让 AI 进你自己的 MC 服走两步 —— 先确认"AI 能在游戏里动"这件事对你成立。
2. **半天**：装 Numen（1.21.4 Fabric，你 PCL 记录里正好有 1.21.4），开它的 MCP server，在 DSH 里加一条 `streamable-http` 配置连上 —— 验证"真玩家实体 + DSH 大脑"。
3. **1 天**：手机打开 `dsh web --host` 的 token 链接，用现成的 UU远程/ToDesk 看 MC 画面 —— 验证"床上也能看/能说"。
4. 三条都过 → 你再决定是往"人格与记忆"投（路线 3，2–3 人周）还是往"多人社交"投。

---

## 1. 先纠正一件事：「大肥鱼陪玩 MC」到底是什么

同名/近名对象至少 **6 个**，代码毫无关系，只共用"大肥鱼"这个形象：

| 对象 | 是什么 | 关键事实 | 判定 |
|---|---|---|---|
| **`luckui/dsh-game`** | **DSH 插件**：大肥鱼玩狼人杀/DDLC/**MC** | 14★、MIT、mineflayer bot、34 动作、真客户端摄像机、豆包 TTS、52 commit 全挤在 3 天、**21 天未更新** | ✅ **你说的就是它** |
| **`LingLuoYv63/Big-Fat-Fish`**（mcmod `[bff]`） | Forge 1.20.1 **纯聊天 mod** | 8 个 `.java`、**没有 build.gradle / mods.toml → 不可构建**、无动作、无多人、记忆函数 `requestDiary()` **恒返回 null** | ❌ 无关且是死路 |
| **肥鱼连线 CooLink** | 闭源商业桌宠 | mod 只做状态桥（每 2 秒写状态文件），智能在桌面 agent | ⚠️ 只能学架构 |
| `Yoshino-JF/dafeiyu-mc` | mindcraft 改的桌面启动器 | 1★、3 个 release 共 **27 次下载**、457MB | ❌ 太弱 |
| `yzi1b/whale-craft` | DSH 插件 | **57★**，`dsh-mc-agent` 的上游 | ⚠️ 值得看 |
| `Pal-AI-Lab/Coopanion`（+`coopanion-fatfish`） | 桌宠框架，大肥鱼"功能复合包" | **3,155★、113 万下载**、本地 ASR、computer use，**但不支持 MC** | ⚠️ 陪伴层可借 |

**「大肥鱼」是谁**：不是人，是 **DeepSeek 鲸鱼娘**的社区二创（原型「溟月」→ 画师 ZipZipPipe）。`dsh-game` 的 `cordis.patch.yml` 人设写死："你是 DeepSeek，大家叫你「大肥鱼」——一条爱吃白饭的鲸鱼娘"。

> ⚠️ **商用风险**：形象动画是 **CC BY-NC-SA 4.0**（禁止商用）。你要做产品必须换形象或拿授权。

---

## 2. 需求拆解：你那句话里有六个独立决策

| 代号 | 问题 | 结论 | 见 |
|---|---|---|---|
| R1 | 「桌面玩 MC」= 玩家自己在 PC 上正常玩？ | 是。本机**目前没装任何 MC 版本**，需先装（PCL/HMCL 都在） | §8 |
| R2 | 「AI **一起**玩」 | **题眼**。现有成品全是"它自己玩你看" | §3–§5 |
| R3 | 轻量化 | mineflayer 路线最轻（零 mod）；mod 路线要装双端 | §4 |
| R4 | 「手机摄像头看到」 | **淘汰摄像头**；真需求是"不在电脑前也能看/能说" | §7 |
| R5 | 手机↔电脑互联 | 局域网一行命令；出门 Tailscale | §7 |
| R6 | 手机端 DSH | **不需要**，手机只做屏+麦克风 | §7 |

---

## 3. 全景：四条技术路线

> 完整对比见 `reports/report-a-desktop-mc.md`（394 行全景表）与 `reports/report-b-dafeiyu.md`（712 行专题）。这里只给结论。

### 路线 Ⅰ：协议层 Bot（无客户端，走 MC 协议）——「最轻、一定能跑」

| 项目 | ★ | 关键 |
|---|---:|---|
| **`PrismarineJS/mineflayer`** | **7,768** | MIT、headless、无 GPU、npm 月下载 **30.8 万**；`minecraft-data` 覆盖 **72 个 PC 版本到 1.21.11**，含 1.21.4 |
| `minecraft-protocol` | 1,422 | 协议层 |
| `prismarine-viewer` | 408 | bot 的 Web 3D 画面（**实测有问题，见 §3.5**） |
| **`blueziii/dsh-mc-agent`** | **35** | **DSH 原生插件，41 个 `mc_*` 工具，4 步接入** |
| `yzi1b/whale-craft` | 57 | 上面那个的上游 |
| `mindcraft-bots/mindcraft` | 6,017 | 最完整的 LLM bot 参考，但 README 自述「不响应 issue」，且无 MCP |
| `yuniko-software/minecraft-mcp-server` | 818 | **唯一可直接用的标准 MCP**（stdio，~20 工具，**无寻路**） |

**优点**：零 mod、零版本绑定（Server List Ping 协商）、部署最轻。
**缺点**：无画面（要另配 viewer）；动作是"高级动作"粒度；周边插件（pathfinder 2.4.5/2023、pvp 1.3.2/2022、armor-manager 2.0.1/2023）**已 2–4 年未更新**；**26.x 版本墙**（mineflayer 尚未支持 26.3）。

### 路线 Ⅱ：客户端 Mod（真在游戏里）——「体验最好、最像队友」

**`Dwinovo/minecraft-numen`（言出法随）611★ / 70 fork / LGPL-3.0** —— 这条路线的最强者：

- **12 个 MC 版本** × Fabric/Forge/NeoForge（1.20.1 → 26.2）；CurseForge project **1581109**；**6 个月 30 个 beta release**；下载量 A 线测到 **19,028**（B 线测到 5,545，口径/时点不同，均记下）
- AI **操纵一个真实玩家实体**；**Lua 原子动作 API**（感知/移动/挖掘/建造/交互），模型写沙箱 Lua **一次完成数十步**
- **原生语音输入（按住 V）+ 输出**、人设、皮肤、群聊可 `@`
- **联机服可用**（双端模组，每人自己的 key）
- **可整体作为 MCP 服务器**：`streamable-HTTP`，默认 `127.0.0.1:8765`，**默认关闭**（`mcp_server.json` 里 `enabled:true`），Bearer 由游戏内 `/numen token create brain` 签发
- MCP 工具：`list/create/delete_companion`、`guide`、`get_events`（最长挂起 50s）、`say`、`lua`、`skill`、`todo`、`memory`
- **无视觉**：vision ADR 状态是"已接受，暂缓（2026-10-16）"
- 作者 B 站「万圣Dwin」6,130 粉，教程 89,078 播放
- **坑**：全是 pre-release；**mod 冲突**（Carpet 重生 Redirect、尸体 mod、Waystones、Paper 方法缺失）；版本矩阵要严格对齐

其余中文 mod 类项目普遍很弱：`MineAgent` 2★、`Friendai` 1★、`aiciv` 0★、`mc_aiplayer` 149★（自带 DeepSeek，无 MCP）。

### 路线 Ⅲ：视觉-动作端到端 ——「不能陪玩」

- **Voyager** 停更于 2023-07（MC 1.19）；**Project Sid** 只有论文；**ROCKET-1** 无 license；**MineDojo** 2024-03 停更。
- **GUI agent**（看屏幕点鼠标）单步 **2–3 秒**（cua-speedrun 实测）= MC 的 40–60 tick → **战斗不可用**。
- 结论：这条线只能做"挂机建造"，不能当队友。

### 路线 Ⅳ：数字人 / 陪伴层 ——「嘴和脸」

- **`moeru-ai/airi` 51,469★**（MIT）：LLM+Live2D+实时语音，自称支持 MC。**注意：`elefant-ai/airi` 是 0★ 空壳，活跃仓库是 `moeru-ai/airi`。** MC 集成官方标注 deprecation、仅源码安装 → **当"嘴/脸"可以，别当"手"**。
- **`Pal-AI-Lab/Coopanion` 3,155★、113 万下载**（AGPL-3.0）：桌宠、本地 ASR（FunASR/Whisper）、computer use、记忆、`PARTNER.md`。**不玩 MC**，但它的 **ASR/TTS 接口约定最值得抄**。

### 3.5 一个必须诚实标注的矛盾：`prismarine-viewer` 到底能不能用

- **A 线**（查文档）：支持 1.8.8–1.21.4，`mineflayerViewer(bot,{port:3000,firstPerson:true})` 一行接入，手机浏览器 `http://<PC-IP>:3000` 就能看 → **理论最优**。
- **C 线**（真做了实验）：在本机起了 **真 MC 1.20.1 服务端**（`Done 3.389s`）+ mineflayer 4.39.0 + viewer 1.33.0 → **数据面通**（6 秒 109 个 `loadChunk`、61 个 `entity`、3,059 KiB），页面 262 ms 加载、0 个 JS 报错，但**画布只渲染出天空色**（headless SwiftShader 与 RTX 3060/ANGLE D3D11 **都一样**）。根因未定位。
- **旁证**：viewer 的 npm 版本停在 **2025-02-09**，`three` 死钉在 2021 年的 **0.128.0**。

> **判定：以实测为准 —— 目前不能当作产品主路径。** 但值得花 30 分钟用 1.21.4 + 新版 three 复核一次（C 的失败可能与 1.20.1 材质/老 three 有关）。证据留在 `reports/assets/poc-prismarine-viewer-blank.png`。

### 3.6 生态对照：DSH 的游戏插件已经成林，但有个真空

子代理 D 用 14 个关键词扫了 GitHub，去重得 **739 个 DSH 相关仓库**，其中真 MC 相关 **73 个**。**83.7% 的仓库 star < 10**，两极分化：

| 层级 | 代表 | 状态 |
|---|---|---|
| 游戏主干 | `ZSeven-W/dsh-game-studio` 566★、`universe-st/dsh-game-material-master` 175★ | 活，但与 MC 无关 |
| 直播家族 | `luckui/dsh-livestream` 77★（默认角色就是大肥鱼）、`y3519712124-ui/dsh-livestreamingcompanion` 13★ | 已成树，可裁剪复用 |
| **MC 身体（工程级只有 3 个）** | `yzi1b/whale-craft` **60★（npm 已发，一行装）**、`blueziii/dsh-mc-agent` 35★（3.7 万行/41 工具/**613KB 踩坑档案**）、`jcs130/dsh-minecraft-agent` 4★（1.7 万行/10 个 npm 版） | **可直接用** |
| 无人值守调度 | `gychen-NJU/dsh-game-daily` 56★ | 「计划任务→headless→report.json」范式可抄 |

**两个必须纠正的传闻**：
1. **`dsh-game-stack`（46★）与 Minecraft 零关系**。它的"游戏感知"是 `PrintWindow(PW_RENDERFULLCONTENT)` + WinRT OCR + `SendInput`，"视觉实体"是 `.cvpack.json` + numpy NCC 模板匹配（0 token/帧、50–85ms）；`mineflayer` 在它仓库里出现 **0 次**，33 处 MC 提及全在 launcher 文档里，**实测只做过《以撒》**。且仓库**只有 3 个 commit**、无 `docs/`、README 引用的报告不在仓库里 → 一次性工作区导出，不是可维护项目。
2. `y3519712124-ui` **不是 GitHub fork 但代码同源**（README 明写基于 luckui 的直播+游戏插件），硬伤是**舞台视频 MediaError 会让宿主进程退出**（未修）。

### 3.7 三个真空 —— 这才是你的机会（子代理 D 的核心发现）

| 能力 | 生态现状 |
|---|---|
| AI 进 MC 世界 | **12 个实现，别做** |
| AI 看见自己的处境 | 协议派 + 渲染派（`jcs130` 的 `mc-camera`：three + node-canvas-webgl **进程内渲染成 JPEG**，还把附近实体 3D 坐标投影到画面上叠框）**都已解决** |
| 直播/弹幕/双语音 | `luckui` 一系已成熟，**别做** |
| **AI 看见「玩家」的画面** | **真空** —— 10+ 个截屏插件**无一例外**用 `PrintWindow`/`BitBlt`/UIA/OCR，而 `PrintWindow` 对 MC Java（GLFW/OpenGL）**大概率黑帧**（`dsh-game-stack` 自己承认"独占全屏……帧会是黑的"）。**没有一个人用 WGC/DXGI** |
| **陪伴发生在游戏里** | **真空** —— 所有游戏 UI 都长在 DSH 侧边栏，没人做游戏内呈现（唯一例外是 1★ 的 `dshpet-mc` 桌宠 mod） |

> **「AI 陪玩家玩（第二玩家）」这个产品定义，被认领了 6 次，产品 0 个。**
> 最贴的是 `Azetus/dsh-minecraft-p2`（1★），README 一句话就把产品定义写对了：*"brings a second player into your Minecraft Java Edition world. Chat with it in-game and ask it to mine, gather materials, or place blocks."* ——**它只是没做出来。**
> 其他：`xizhilang2012/dsh-mc-companion`(0★)、`banbixieyang/dsh-mc-companion`(0★)、`Red0tsnow/dsh-companion`(3★) 全是意向性仓库。
> **这对你有利（没有强敌），也有警示（说明有硬骨头，别人啃不动）—— 硬骨头就是上面那两块。**

---

## 4. 需求匹配度打分

尺子先定（`reports/_rubric.md`）：**R2「一起玩」权重 3**，R3 轻量 2，R4 手机 2，R1/R5/R6 各 1。

| 候选 | R1 | **R2 一起玩** | R3 轻 | R4 手机 | R5 | R6 | 加权 | 工程 | 一句话判词 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| **`Numen` + DSH 当外脑** | 5 | **5** | 3 | 4 | 5 | 5 | **43** | 14/20 | 真身体+多人+语音，接口已对齐 |
| **fork `dsh-game` 接 `duo`** | 5 | **4** | 4 | 4 | 5 | 5 | **37** | 15/20 | 零件全在只差接线，但上游停更 |
| **`dsh-mc-agent` + DSH** | 5 | 3 | **5** | 3 | 5 | 5 | **33** | 16/20 | 最快能跑，但没有"同伴"语义 |
| `mindcraft` 自己改 | 5 | 3 | 3 | 3 | 4 | 4 | 27 | 12/20 | 骨架好，一切自己写 |
| `Coopanion`（桌宠） | 2 | 2 | 3 | 5 | 5 | 5 | 19 | 14/20 | 陪伴最强，**不玩 MC** |
| mcmod `[bff]` mod | 3 | 1 | 5 | 2 | 3 | 4 | 14 | 6/20 | 不可构建、纯聊天 |
| 摄像头拍屏幕 | 5 | 1 | 2 | 1 | 2 | 5 | 13 | 5/20 | 对 AI 无效 |

> 口径：5=完全满足。"它自己玩你看"在 R2 最高 2 分；`dsh-game` 给 4 分是因为**零件已在、接线即可**。

---

## 5. 四条落地路线（含工作量与验证方法）

### 路线 1：现成 DSH 插件（**30 分钟**，先看见效果）

三个候选（生态里只有这 3 个算工程级）：

| 插件 | ★ | 怎么装 | 特点 |
|---|---:|---|---|
| **`yzi1b/whale-craft`** | **60** | **npm 一行**，`dsh plugin add link:` | 已发 npm、双 preset、watchdog、**长期记忆**、权限模型最产品化 |
| `blueziii/dsh-mc-agent` | 35 | GitHub 装 | **41 个 `mc_*` 工具**，src 3.7 万行，带 **613KB 踩坑档案**（这领域最贵的知识） |
| `jcs130/dsh-minecraft-agent` | 4 | npm（10 个版本） | 1.7 万行；**它的 `mc-camera` 是"AI 的眼睛"的现成解** |

```bash
# 以 whale-craft 为例
dsh plugin --profile web add <whale-craft 的 npm 或 link 地址>
# 重启 dsh web，然后对 DSH 说"连 127.0.0.1:25565"
```
**产出**：AI 是个真玩家，能走、挖、放、合成、打怪、在游戏里说话。
**适合**：第一次看到"AI 在我服务器里动"的震撼画面。**不适合**：当作最终产品（没有"陪你"的语义）。

### 路线 2：`Numen` 当身体 + DSH 当大脑（**半天到 2 天**，体验最好）

**接口已经对齐，这是最重要的发现**：

| 侧 | 事实 | 来源 |
|---|---|---|
| Numen | MCP = **streamable-HTTP**，`127.0.0.1:8765`，默认关闭，Bearer token（游戏内 `/numen token create brain`） | 仓库 `mcp_server.json` + 文档 |
| DSH | `dsh-mcp-client` 支持 `transport: streamable-http` + **`url` / `headers`**（额外请求头）；工具名 `mcp__<server>__<tool>`；单次调用超时默认 60s 可调 | 本机 `dsh-mcp-client` README（逐字核对） |

→ 配置长这样：
```yaml
- id: mcp-numen
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: numen
    transport: streamable-http
    url: http://127.0.0.1:8765/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.NUMEN_BRAIN_TOKEN}`'
    toolCallTimeoutMs: 120000     # get_events 会长挂 50s，务必调大
```

**你会得到**：真玩家实体（别的玩家看得见）、联机服可用、原生语音、`lua` 一次做几十步。
**你要自己补**：人设（DSH 有 `persona` 插件）、对话历史（DSH 管）、记忆（DSH 侧或 Numen 的 `memory`/`todo`）。
**风险**：全是 pre-release、mod 冲突、无视觉、版本矩阵严格。

### 路线 3：fork `dsh-game` 把 `duo` 接上（**2–3 人周**，最像"陪玩"）

**为什么可行**：body 层"跟着主人走"的零件**全都写好了**，只是被关掉。

| 位置 | 现状 | 要改什么 |
|---|---|---|
| `src/games/minecraft/setup.ts:74` | `mode: 'solo'` 硬编码，注释写"duo 是下一阶段" | 读 `raw.mode`，放开 UI |
| `session.ts:288` | `companion: false` | `true` 并传 `owner` |
| `runtime.ts:417` | `ownerName` 是**死配置**（存了从不使用） | 传进 `MinecraftSession` |
| `body/` | `follow` 相位机（inactive/target-lost/approaching/nearby/blocked）、`resumeFollowing()`、`player-gaze`（注视 4s/8 格内触发）**全都已实现** | 接线 |

- **阶段 0（0.5–1 人日）**：放开 solo、传 owner、`companion:true`。**验收**：进服自动跟在你身后 ≤3 格。
- **阶段 1（3–5 人日）**：游戏内指令语义（`跟我来/别跟着/挖这个/放这里/打它/等我` → 直接映射动作，**别全交给模型**）；`player-gaze` 接成"你盯着它看它会问你怎么了"；指代解析（用你的 yaw/pitch 做 raycast，而不是让模型猜）；加批量动作工具。
- **阶段 2（1–2 人周）**：ASR（faster-whisper / 复用 Coopanion 的 FunASR）、本地 TTS、打断、分句流水线压到 <1.5s。
- **阶段 3（可选）**：**别上真视觉**——扩 `look` 成"16³ 体素切片 + 你视线方向的 raycast 文本"就够八成场景。
- **阶段 4**：多玩家关系（owner/friend/stranger）、`@` 语法、发布（npm 名 `dsh-game` 已被占，改 `@you/dsh-game-mc`）、**换掉 CC BY-NC-SA 素材**。

**风险**：上游 21 天未更新、1 位贡献者、0 release → **fork 之后就是你在维护**。

### 路线 4：自研 `mc-mcp`（**3–4 人周**，最干净）
自己写 mineflayer 身体 + 6 个工具 + `PlayerIntentTracker`，任何 agent 都能用。**好处**：完全可控；**坏处**：dsh-game 那套建造/农业/下界/摄像机要重来。

### 5.5 选哪条？

> **先跑 1 → 再验 2 → 再决定投不投 3。**
> 理由：路线 1 用 30 分钟给你"这事成了"的确定性；路线 2 用半天给你"体验上限"的判断；路线 3 是唯一能做出"跟在我身后、听我指挥、主动说话"的关系感，但它 2–3 人周的成本**只值得在 1 和 2 都验证过之后才投**。

### 5.6 产品定位：三个位置，只有一个是空的

| 定位 | 一句话 | 复用度 | 难度 | 竞争 |
|---|---|---|---|---|
| **A. 桌面 MC 陪玩**（推荐） | 你开 MC，AI 作为**第二个玩家**进来，能看见你的画面、在游戏里说话、跟你协作 | 身体层用 `whale-craft`/`blueziii` | 中高（WGC + 游戏内呈现） | **零** |
| B. MC 陪玩主播 | AI 自己玩并直播，弹幕互动 | 直播层+身体层全复用 | 低 | **红海**（已有 5+ 个同款，`y3519712124-ui` 已 90% 做完） |
| C. MC 模组开发陪跑 | AI 帮你写 mod 并自己进游戏验证 | `yan-mc` 全复用 | 低 | 已占位（35★） |

**推荐 A**：唯一没有实现者的位置，而且它需要的两块硬骨头恰好是**别人绕开的**，不是**别人做失败的**。

### 5.7 若选 A，两周验证路径（子代理 D 给的可执行计划）

| 天 | 做什么 | 验证什么 |
|---|---|---|
| 1–2 | `dsh plugin --profile web add link:` 装 **`whale-craft`**（npm 一行）→ 连本机 LAN 世界 | **身体层可用**：AI 能走能挖 |
| 3–4 | 写最小 DSH 插件，只做一件事：`mc_look` 返回「玩家实体位置/朝向/手持物/附近方块」 | **协议侧能看见玩家**（不需要像素） |
| **5–7** | 加 **WGC 抓帧**（`windows-capture`，或直接读 OBS game_capture 的帧） | **⚠️ 整个项目最大的技术风险，必须最先证伪** |
| 8–10 | 游戏内呈现最小版：`/tellraw` 说话 + 计分板侧栏显示 AI 状态（零 mod） | 陪伴能发生在游戏里 |
| 11–14 | 把「玩家意图 → AI 行动」接起来，跑一次真人 30 分钟陪玩 | 记录：玩家主动说话次数 / AI 主动说话次数 / AI 卡住次数 |

> **第 7 天是 go/no-go**：WGC 抓 MC 窗口成不成，决定产品形态。
> **退路（性价比可能更高）**：`jcs130` 的 `mc-camera` 路线——**不抓屏幕，从协议世界自己渲染**。此时"AI 知道你在我旁边、在挖什么、手里拿什么"全走协议（已确认 mineflayer 能做到），像素只在需要时补一帧。

---

## 6. 实现方案与接口（可直接照此开工）

### 6.1 数据流

```
              ┌──────────── 你的手机（浏览器，零安装）────────────┐
              │ ① DSH Web（?token=，看思考/打字/语音输入）        │
              │ ② Moonlight / UU远程 / ToDesk（看 MC 画面）        │
              └──────────────▲──────────────────▲───────────────┘
                             │ HTTP/HTTPS       │ 视频流
┌──────────────── PC ─────────┴──────────────────┴──────────────┐
│  DSH 0.2.1-rc.5                                               │
│   ├─ mcp-client ──streamable-http+Bearer──▶ Numen(游戏内 mod)  │
│   ├─ mcp-client ──stdio──▶ mc-mcp ──▶ mineflayer 子进程        │
│   ├─ persona（大肥鱼人设）                                     │
│   └─ web (--host 192.168.68.54 --port 3080)                   │
│                                                               │
│  MC 服务器（online-mode=false / Paper）                        │
│   ├─ ▲ 你的客户端（真人，1.21.4）                              │
│   └─ ▲ AI 的身体（Numen 真玩家实体 / mineflayer bot）          │
└───────────────────────────────────────────────────────────────┘
```

### 6.2 MCP 工具设计（若走自研路线，6 个就够）

| 工具 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `mc_observe` | `detail?: brief\|full` | 坐标/维度/昼夜/血量/饥饿/背包/24 格内实体/**主人状态**（距离、朝向、手持物、正在挖的方块与进度、最近聊天）/最近 10 条事件/**当前可用动作词表** | **动态下发动作词表**（学 dsh-game，省 token 且不会幻觉出不存在的动作） |
| `mc_act` | `action`, `params` | 结果 + 状态增量 | 单动作 |
| `mc_plan` | `steps[]` | 逐步结果 | **批量**，减少往返（学 Numen 一次几十步） |
| `mc_say` | `text` | ok | 游戏内聊天（中文，带人设） |
| `mc_look` | `kind: topdown\|slice\|gaze` | **PNG** | DSH 的 MCP **支持图片结果** → 模型真的"看得见" |
| `mc_remember` | `kind: goal\|mark\|build\|diary` | ok | 世界日志，跨会话记忆 |

> 设计判断：**给模型的"眼睛"是结构化文本 + 按需渲染的小图，不是视频流。** LLM 回路本来就 0.5–3s，视频没意义；每帧都是 token。

### 6.3 「一起玩」的语义层 —— 这才是本项目的创新点

`PlayerIntentTracker` 订阅 mineflayer 事件，把原始事件聚合成人类可读的意图：

| 原始事件 | 聚合后 | 喂给模型的样子 |
|---|---|---|
| `blockBreakProgressObserved` 同一方块 ×12s | mining | 「主人在挖石头，挖了 12 秒，可能在开矿道」 |
| `blockPlaced` ×20 在 5×5 内 | building | 「主人正在搭 5×5 的橡木墙」 |
| `entityMoved` 远离 + `health` 下降 | fleeing | 「主人血量 6/20，正往东跑，后面 2 只僵尸」 |
| `entityCrouch` + 边缘方块 | bridging | 「主人在潜行搭桥，别打扰」 |
| `entitySwingArm` + 附近有羊 | hunting | 「主人在打羊」 |

→ 有了这层，AI 才能说出"你挖矿我帮你放火把"。**这是 dsh-game 缺的、也是"陪玩"与"bot"的分界线。**

### 6.4 延迟预算

| 回路 | 目标 | 我们的方案 |
|---|---|---|
| 观察→决策→动作 | 0.5–3 s（LLM 主导） | ✅ 结构化观察 <20ms 不是瓶颈 |
| 跟随时位置同步 | <100 ms | ✅ 事件驱动 |
| 语音往返 | <1.5 s | VAD .2 + ASR .3 + 首 token .5 + TTS .3，本地 SenseVoice ✅ |
| 手机看画面 | <200 ms 够 | Sunshine LAN 25–55ms ✅ |

---

## 7. 手机与视觉：把「摄像头」彻底说清

### 7.1 你那句"用手机摄像头看到"混了三件事

| | 真实意图 | 正确实现 | 结论 |
|---|---|---|---|
| ① | **AI 要"看"游戏画面** | 不需要摄像头。结构化状态 + PC 本机截图（0ms 通路） | **淘汰** |
| ② | **人不在电脑前，想用手机看 AI 玩** | 串流客户端窗口（Sunshine+Moonlight），或直接开 DSH Web | ✅ 推荐 |
| ③ | **想确认 AI 到底在干什么** | 同 ② | ✅ |

**为什么摄像头对 AI 侧必然无效**（C 线量化推算）：AI 与游戏同机 → 帧缓冲无损；加摄像头就变成「摩尔纹 + 6–9px 的 HUD 小字 + 对焦抖动」，**HUD 数字 OCR 成功率 <30%**，撑不起 agent 决策循环。唯一成立前提是"你只有手机、没有 PC"——不是你的情况。

### 7.2 我做的实测（这一条我亲自跑通了）

```
node <dsh>/lib/bin.js web --host 192.168.68.54 --port 3099 --no-open
→ dsh web: http://192.168.68.54:3099/?token=OIz30k1TTX24P5hMopMKx2iEFGCpzFeLeFSZka5OaxI
→ dsh web: listening on 192.168.68.54 over plain HTTP
```

| 请求 | 结果 |
|---|---|
| `GET /`（不带 token） | **401 未授权** |
| `GET /?token=…` | **200**（38,343 字节 HTML） |
| `GET /api`、`/api/health` | **401** |

→ **DSH Web 天生支持手机浏览器，且有 token 鉴权**（不是裸奔；之后 30 天 cookie 记住）。直连 IP **不需要** `--trusted-host`，那个 flag 只给 trycloudflare/ts.net 这类代理域名用。

### 7.3 三条硬约束（都实测过）

1. **手机麦克风必须 HTTPS**（DSH 语音 = 浏览器 `getUserMedia` + 本地 SenseVoice；官方原文「Browser microphone access requires HTTPS or loopback」）：
   - 最省事：`tailscale serve --bg localhost:3080`（自动合法证书，免费）
   - 临时：`cloudflared tunnel --url http://127.0.0.1:3080`（需加 `--trusted-host xxx.trycloudflare.com`）
   - 偏方：`adb reverse tcp:3080 tcp:3080` → 手机开 `http://localhost:3080`（loopback 免证书）
   - 自签：证书 SAN 必须写 IP，手机要装 CA
2. **Sunshine 只能整屏采集**（配置只有 `output_name`/`capture`，无窗口选择）→ 想只看 MC 窗口得独占全屏或用虚拟显示器。OBS 能按窗口抓，Sunshine 不能。
3. **防火墙（实测，以本条为准）**：`node.exe` 有 **2 条 Public profile 入站放行**，而当前 WLAN 就是 **Public** → **手机能连**。（C 线按"家庭 WLAN 通常是 Private"推断会不通，与本机实际不符。）若改成 Private，需补：
```powershell
New-NetFirewallRule -DisplayName "DSH web (LAN)" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 3080 -Profile Private -RemoteAddress 192.168.68.0/22
```
> 排查口诀：在**另一台设备**上 `Test-NetConnection 192.168.68.54 -Port 3080`；本机测自己的 LAN IP 会走 loopback，绕过防火墙，永远"通"。

### 7.4 你其实已经有两套现成工具
本机已装 **ToDesk 4.8.4** 与 **UU远程 3.13.4（含 GameViewer 虚拟显示器）** → 「手机看电脑」现在就能做。**新工程应该花在"AI 一起玩"上，不要重造串流。**

### 7.5 手机端跑 DSH：不推荐（不是不能）
Termux 已有 Node 26.13.1 / 24.22.3，版本不是瓶颈；但 `node_modules` 实测 **857MB**（minecraft-data 495MB + viewer 257MB）、`canvas` 在 arm64 需现场编译 Cairo/Pango、Android 杀长驻、DSH 的 pwsh 工具在 Android 上为空。
→ **正确形态：电脑跑 Agent，手机只做「屏 + 麦克风 + 喇叭」。**

---

## 8. 本机环境核查：明天能跑起来吗？

| 项 | 状态 | 影响 |
|---|---|---|
| GPU / 内存 | RTX 3060 Laptop + 15.7 GB | ✅ 足够 |
| **Java 21** | ✅ `%APPDATA%\.minecraft\runtime\java-runtime-delta` = OpenJDK **21.0.3** | ✅ 满足 dsh-game 摄像机与 MC 1.21.x |
| Java 17 | ✅ `C:\Program Files\Java\jdk-17.0.5` | ✅ 满足 MC 1.20.x |
| **Minecraft 本体** | ❌ **`.minecraft\versions` 不存在，当前没有任何可启动版本** | ⚠️ **第一步是装 MC** |
| 启动器 | PCL（桌面）+ HMCL（配置在） | ✅ |
| 历史版本 | PCL 记录 **1.20.6**；`ToolUpdateReleaseLast=1.21.4` | 💡 **1.21.4 正是 dsh-game 唯一测过、也是 Numen 支持的版本** |
| 联机工具 | `D:\MC联机app\SakuraLauncher.exe`、UU加速器 | 💡 你对"联机"有明确诉求 |
| DSH | **0.2.1-rc.5** | ⚠️ dsh-game 要求 **0.2.0-rc.2**，需验证兼容 |
| 手机串流 | ToDesk + UU远程 已装 | ✅ 现成 |

---

## 9. 待你拍板的三个决策

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| **D1** | 「一起玩」要多"一起"？ | A) 它自己玩，我看/直播（现成）<br>B) 它跟在我身后、听我指挥、主动说话（要做）<br>C) 只是语音陪聊+偶尔搭把手（最轻） | 先做 **B 的最小版**（跟随+听指令），它同时覆盖 A 和 C 的期待 |
| **D2** | 「手机看到」看什么？ | A) 只看 AI 在想什么/说什么（DSH Web，零安装）<br>B) 看 AI 的游戏画面（串流窗口）<br>C) 我也要在手机上玩（Geyser + 基岩版，5969★） | **A 立刻有，B 用现成 UU远程/ToDesk**；C 是另一个项目 |
| **D3** | 「身体」选哪条？ | A) `dsh-mc-agent`（最快）<br>B) `Numen` mod + DSH 外脑（体验最好）<br>C) fork `dsh-game` 接 `duo`（最像陪玩，2–3 人周） | **按 §0.3 顺序各花 30 分钟/半天/1 天验证，再定** |

---

## 10. 证据与未验证清单

### 10.1 一手证据
| 证据 | 位置 |
|---|---|
| DSH 接口能力逐条核查（MCP/headless/语音/webserver）+ 局域网实测 + 版本矩阵 + 玩家感知事件表 | `reports/dsh-capability-notes.md` |
| 本机环境实测（Java/MC/联机/网络/防火墙） | `reports/_machine-env.md` |
| 评分尺子（先定尺子再看数据） | `reports/_rubric.md` |
| 子代理 A：桌面 MC 开源全景（394 行，含红黑榜） | `reports/report-a-desktop-mc.md` |
| 子代理 B：大肥鱼专题（712 行，含代码级缺陷清单、改造到行号） | `reports/report-b-dafeiyu.md` |
| 子代理 C：手机互联决策（684 行，含 3×6 决策矩阵、延迟预算、可复跑脚本） | `reports/report-c-mobile-link.md` |
| 子代理 D：DSH 游戏插件生态（898 行，739 仓库测绘、三个真空、DSH 插件开发最小路径） | `reports/report-d-dsh-ecosystem.md` |
| 子代理 C 的实验证据与脚本 | `reports/assets/` |
| 调查计划原文 | `PLAN.md` |

### 10.2 未验证（诚实边界）
1. **Numen 的 MCP 端点路径与工具 schema**（`/mcp`？工具参数结构？）→ 需装上去 `curl` 一次确认
2. **DSH 带自定义 header 的实际握手**（文档支持，但未实连 Numen 验证）
3. `get_events` 长挂 50s 与 DSH 默认 60s 超时的边界（建议直接调 120s）
4. dsh-game 与 DSH 0.2.1-rc.5 的兼容性
5. Numen 是 beta，**mod 冲突**清单未在真机验证
6. prismarine-viewer 白屏根因（换 1.21.4 + 新 three 是否恢复）
7. 手机端真实延迟（需两台设备实测）
8. CurseForge 下载量口径不一致（19,028 vs 5,545）
9. **`PrintWindow` 能否抓到 MC（GLFW/OpenGL）窗口的帧** → 决定"用现成截屏插件看 MC"是否成立；**WGC/DXGI 在 MC 窗口上的实际帧率未测**（这是定位 A 的核心假设）
10. `jcs130` 的 `mc-camera` 在 Windows 裸机上 `node-canvas-webgl` 是否需要现场编译
11. `blueziii` 能否连**本机 LAN 世界**（而非专用服务器）—— 陪玩场景多半是"对局域网开放"

### 10.3 一句话收尾

> 这个项目最大的风险不是技术，是**你以为要从零开始**。
> 技术栈已经齐了：`whale-craft`/`blueziii` 当身体、`Numen` 当真队友、DSH 当大脑人格、`dsh web --host` 当手机端、`jcs130/mc-camera` 当眼睛。
> **真正没人做过的，是"AI 能读懂你在干什么，并且主动搭把手"** —— 那才是你这个项目值得做的部分。
> 它被 6 个人想过、0 个人做出来。你有机会做第 1 个 —— 前提是**第 7 天的 WGC 抓屏先证伪**。
