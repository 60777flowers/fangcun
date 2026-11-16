# 桌面 Minecraft × AI 陪玩：家族 Ⅰ / Ⅲ / Ⅳ 全量调查

> 子代理 A 交付物 · 报告版本 2026-11-16 18:30（北京时间）
> 覆盖范围：协议层 Bot（Ⅰ）、视觉-动作/模拟环境（Ⅲ）、数字人/陪伴层（Ⅳ）、以及支撑它们的 MCP / 渲染 / 假人基础设施。
> **不覆盖**：中文 MC mod（含"大肥鱼"本体，见 `report-b-dafeiyu.md`）、手机↔电脑互联细节（见 `report-c-mobile-link.md`）、`luckui/dsh-game` 深挖（另一子代理专责，本报告只做 200 字交叉引用）。

## 0. 数据口径与免责

1. **star 采样日 = 2026-11-16**（17:40–18:30 之间逐仓读取）。主用 `https://ungh.cc/repos/{owner}/{repo}`（GitHub 只读镜像，无 60 次/小时限制），关键仓库再用 `api.github.com/repos/...` 交叉验证；同一仓库在 10 分钟内复采会抖动 ±10（实时 star 与镜像缓存叠加），属正常，表内数字以首次采样为准。GitHub 核心 API 在 18:20 左右被同 IP 打到 403 限流，之后改用 ungh / commits.atom / releases.atom / 仓库 HTML 补数，**凡未取到的一律写"未取到"，不凭记忆补**。
2. **最近 commit** 取 `commits.atom` 第一条的 `<updated>`（比 `pushed_at` 更接近"最后一次提交"）；个别仓库只有 1 条 entry（浅克隆/新库），已注明。
3. **"部署步数"是按 README 最短路径的人肉估算**，不是实测。我没有真的启动过 Minecraft 服务器/客户端（见 §7 未验证清单）。
4. 许可证以 GitHub API / npm `license` 字段为准；`none` 表示仓库未声明 license（**不等于**可以商用）。
5. 结论中的"能/不能"指 2026-11-16 这个时点、按公开材料判断，不含未公开分支。

---

## 1. 执行摘要（≤500 字）

**判断一：唯一"这个周末就能跑"的是协议层 Bot。** `mineflayer` 7,768★、MIT、无 GPU、headless、npm 月下载 30.8 万，是唯一同时满足"轻、免费、能进任何服务器"的底座；`mindcraft` 6,017★ 是它最完整的 LLM 化参考，但 README 明说"We are currently not very responsive to github issues"，且只支持到 MC 1.21.11。真正能直接接 DSH 的现成件是 `dsh-mc-agent`（35★，41 个 `mc_*` 工具，DSH 插件）与 `yuniko-software/minecraft-mcp-server`（818★，stdio MCP）。

**判断二：要"像队友"而不是"旁边看"，客户端 mod 路线明显更强。** `Dwinovo/minecraft-numen`（言出法随，611★，LGPL-3.0，1.20.1–26.3，CurseForge 1.9 万下载）把智能体做成**游戏内真实玩家实体**，内建 **streamable-HTTP MCP server**（默认 `127.0.0.1:8765`，Bearer token），可被 DSH/Claude Code/Codex 直接当大脑。代价：beta、双端装 mod、单人维护、无视觉。

**判断三：视觉/GUI 与学术线现在都不能做陪玩。** Voyager 停更在 2023-07（MC 1.19），Project Sid 只有论文没有代码，ROCKET-1 连 license 都没有；GUI agent 单步"动作→观察"典型 2–3 秒（cua-speedrun），折合 MC 40–60 tick，战斗不可用，只够盖房/挖矿。

**判断四（补充）**：手机"看 AI"最优解是 `prismarine-viewer` 的网页（手机浏览器直开 `http://PC:3000`，无需装 App）；但它只到 1.21.4 的材质、帧率/CPU 我没实测——这是当前最值得花 30 分钟验证的假设。

---

## 2. 全景表

### 2.1 主表：家族 Ⅰ / Ⅲ / Ⅳ（按家族排序）

> 列说明：**Headless**=无客户端可视化；**GPU**=是否必须显卡；**步数**=最短部署步骤（估）；**同服协作**=能否与人类玩家在同一个服务器里作为独立角色互动；**外部驱动**=MCP/CLI/API；**手机看**=手机能否远程观察/操控该形态。

| 项目 | 家族 | ★(11-16) | 最近 commit | 语言/运行时 | License | Headless | GPU | 步数 | 与人同服协作 | 外部 agent 驱动 | 手机看/控 | 主要坑 |
|---|---|---:|---|---|---|---|---|---:|---|---|---|---|
| [PrismarineJS/mineflayer](https://github.com/PrismarineJS/mineflayer) | Ⅰ | 7,768 | 2026-10-25 | JS / Node≥22 | MIT | 是 | 否 | 2 | **是**（独立玩家实体，离线/微软账号） | 库级 API，无内建 MCP；可包 CLI/MCP | ✅ 配 viewer 后手机浏览器可看 | 26.x 协议未支持（issue 仍 open）；大服反作弊；长跑内存/封包问题 |
| [PrismarineJS/node-minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol) | Ⅰ | 1,422 | 2026-10-27 | JS | BSD-3-Clause | 是 | 否 | 3 | 是 | 库 | ❌ | 太底层，实体/物理要自己写 |
| [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data) | Ⅰ | 961 | 2026-11-03 | JS | none | n/a | 否 | 2 | n/a | 数据包 | ❌ | 只是版本数据表 |
| [PrismarineJS/mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) | Ⅰ | 318 | 2026-11-14 | JS | MIT | 是 | 否 | 2 | 是 | 插件 API | ❌ | A* 会卡住/挖搭代价高；复杂地形失败 |
| [PrismarineJS/mineflayer-collectblock](https://github.com/PrismarineJS/mineflayer-collectblock) | Ⅰ | 59 | 2026-04-13 | JS | MIT | 是 | 否 | 2 | 是 | 插件 | ❌ | 采集慢、易被怪打断 |
| [PrismarineJS/mineflayer-pvp](https://github.com/PrismarineJS/mineflayer-pvp) | Ⅰ | 72 | 2026-04-17 | JS | MIT | 是 | 否 | 2 | 是 | 插件 | ❌ | 战斗很弱，不会走位 |
| [linkle69/mineflayer-auto-eat](https://github.com/linkle69/mineflayer-auto-eat) | Ⅰ | 51 | 2026-02-16 | TS | MIT | 是 | 否 | 2 | 是 | 插件 | ❌ | 小工具，维护一般 |
| [PrismarineJS/mineflayer-armor-manager](https://github.com/PrismarineJS/mineflayer-armor-manager) | Ⅰ | 未取到 | npm 2.0.1 (2023-07) | TS | MIT | 是 | 否 | 2 | 是 | 插件 | ❌ | **停更 3 年**，AIRI 仍在用 |
| [PrismarineJS/prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) | Ⅰ/基础设施 | 408 | 2026-10-06 | JS | MIT | 是（node 起 HTTP） | 否 | 2 | 观察用 | HTTP 页面 | ✅ **最优**：手机浏览器直开 | 材质只到 1.21.4；帧率/CPU 未实测 |
| [PrismarineJS/prismarine-web-client](https://github.com/PrismarineJS/prismarine-web-client) | Ⅰ/基础设施 | 558 | 2026-10-06 | JS | MIT | 浏览器内 | 否 | 3 | 是（可当网页客户端） | WS | ✅ | 功能不全，算实验品 |
| [mindcraft-bots/mindcraft](https://github.com/mindcraft-bots/mindcraft) | Ⅰ | 6,017 | 2026-10-27 | JS | MIT | 是 | 否 | 5 | **是**（多人/多 agent/人在同服） | 无 MCP；改源码或命令行 | ⚠️ 自带 UI 端口，非 3D 画面 | issue 不响应；版本上限 1.21.11；代码执行有注入风险 |
| [MineDojo/Voyager](https://github.com/MineDojo/Voyager) | Ⅰ/Ⅲ | 7,330 | **2023-07-27** | Python 3.9 + Node 16 | MIT | 是 | 否 | 7+ | 技术上是 | 无 | ❌ | **停更 3 年**；MC Fabric 1.19；Azure 登录失效；装不上 |
| [cabaletta/baritone](https://github.com/cabaletta/baritone) | Ⅰ | 9,360 | 2026-11-10 | Java | LGPL-3.0 + anime exception | 否（客户端 mod/API） | 否 | 3 | 是（它操作你的角色） | Java API + `/b` 聊天命令 | ❌ | 只是"腿"，不是 AI；版本绑定加载器 |
| [miner-org/mineflayer-baritone](https://github.com/miner-org/mineflayer-baritone) | Ⅰ | 46 | 2026-08-29 | JS | none | 是 | 否 | 2 | 是 | 插件 | ❌ | **名字误导**：不是 Baritone 桥，是独立 A* 寻路器 |
| [azalea-rs/azalea](https://github.com/azalea-rs/azalea) | Ⅰ（Rust 替代） | 828 | 2026-10-16 | Rust | MIT | 是 | 否 | 4 | 是 | 库 | ❌ | 生态小，AI 侧轮子要自己造 |
| [soulfiremc-com/SoulFire](https://github.com/soulfiremc-com/SoulFire) | Ⅰ（Java bot） | 627 | 2026-11-16 | Java | AGPL-3.0 | 是 | 否 | 3 | 是 | 插件/CLI | ❌ | 偏客户端 bot/自动化，非 LLM |
| [yuniko-software/minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server) | Ⅰ + MCP | 818 | 2026-04-05 | TS / Node≥20 | Apache-2.0 | 是 | 否 | 2 | **是** | **stdio MCP** | ❌（手机需自己加壳） | 无寻路、工具少（约 20 个原子工具）、维护放缓 |
| [G0Osey99/awesome-mineflayer-mcp](https://github.com/G0Osey99/awesome-mineflayer-mcp) | Ⅰ + MCP | 10 | 2026-06-29 | TS | MIT | 是 | 否 | 2 | 是 | **stdio MCP** | ❌ | 123 工具/26 组，功能最全但 10★、零 issue 历史，质量未验 |
| [HarjjotSinghh/minecraft-mcp](https://github.com/HarjjotSinghh/minecraft-mcp) | Ⅰ + MCP | 0 | 2026-01-25 | TS | MIT | 是 | 否 | 2 | 是 | stdio MCP | ❌ | 个人 demo，npm 同名包月下载 77 |
| [kilgorjn/minecraft_mcp](https://github.com/kilgorjn/minecraft_mcp) | Ⅰ + MCP | 0 | 2025-09-06 | 未取到 | 未取到 | 是 | 否 | ? | ? | ? | ❌ | 已死 demo |
| [MakkCH/minecraft_mcp](https://github.com/MakkCH/minecraft_mcp) | Ⅱ/Ⅲ 混合 | 20 | 2026-11-13 | TS + Fabric mod | MIT | 否（真客户端） | 否 | 5 | **是（接管你的角色）** | stdio MCP + 截图 | ⚠️ 需远程桌面/串流 | 只支持 26.1–26.3 / Java 25 / Fabric；LLM 现写 JsMacros 脚本有风险 |
| [Dwinovo/minecraft-numen](https://github.com/Dwinovo/minecraft-numen)（言出法随） | Ⅱ/Ⅳ 混合 | 611 | 2026-11-12 | Java mod | LGPL-3.0 | 否（游戏内实体） | 否 | 3–4 | **是**（双端联机服可用） | **streamable-HTTP MCP server + Lua API** | ⚠️ 手机看屏幕/串流 | beta；mod 冲突；单人维护；**无视觉工具** |
| [blueziii/dsh-mc-agent](https://github.com/blueziii/dsh-mc-agent) | Ⅰ + DSH | 35 | 2026-11-05 | TS / Node≥22 | MIT | 是 | 否 | 4 | 是 | **DSH 原生 41 个 `mc_*` 工具** | ✅ DSH Web 可到手机（需绑 LAN） | 小社区；依赖 5 个 mineflayer 插件 |
| [yzi1b/whale-craft](https://github.com/yzi1b/whale-craft) | Ⅰ + DSH | 57 | 2026-10-18 | TS | 未取到 | 是 | 否 | 4 | 是 | DSH 插件 | ✅ 同上 | dsh-mc-agent 的上游，功能少些 |
| [yc-software/minecraft-agent-harness](https://github.com/yc-software/minecraft-agent-harness) | Ⅰ | 224 | 2026-10-29 | TS / Node 22.19+ | MIT | 是 | 否 | 4 | 是（宣称 50 agent 同服） | CLI + OpenAI 兼容端点 | ❌ | 预发布；自带 Paper 服务端；长期稳定性未知 |
| [Pal-AI-Lab/Cortico](https://github.com/Pal-AI-Lab/Cortico) | Ⅳ + harness | 357 | 2026-11-16 | TS | MIT | 是 | 否 | 4 | ? | 扩展系统（Cortico World） | ✅ WebUI | pre-release；未见 MC 扩展 |
| [MineDojo/MineDojo](https://github.com/MineDojo/MineDojo) | Ⅲ | 2,284 | **2023-08-29** | Python/Java | MIT | 否（弹游戏窗口） | 可选 | 6 | 否 | Python API | ❌ | 停更；需要编译 Java；1581 个任务但没人维护 |
| [minerllabs/minerl](https://github.com/minerllabs/minerl) | Ⅲ | 982 | 2025-01-23 | Python | NOASSERTION | 是 | 可选 | 5 | 否 | gym API | ❌ | 要 Java 8；版本老；241 个 open issue |
| [openai/Video-Pre-Training](https://github.com/openai/Video-Pre-Training) | Ⅲ | 1,761 | 2025-09-03 | Python | MIT | 是 | **是** | 6 | 否 | 模型权重/研究代码 | ❌ | 2022 研究代码；要 contractor 数据 + GPU |
| [CraftJarvis/MineStudio](https://github.com/CraftJarvis/MineStudio) | Ⅲ | 420 | 2025-10-10 | Python | MIT | 是 | **是**（VirtualGL/Xvfb） | 6 | 否 | Python | ❌ | JDK8 + 渲染 + HF 数据集，重 |
| [yhs0602/CraftGround](https://github.com/yhs0602/CraftGround) | Ⅲ | 71 | 2026-10-11 | Kotlin | GPL-3.0 | 是 | 可选 | 4 | 否 | Python/Kotlin API | ❌ | RL 环境，不是陪玩；~300TPS 但生态小 |
| [CraftJarvis/ROCKET-1](https://github.com/CraftJarvis/ROCKET-1) | Ⅲ | 48 | 2025-02-28 | Java | **none** | 是 | 是 | 6 | 否 | 无 | ❌ | 论文代码；无 license；跑不起来 |
| [CraftJarvis/JARVIS-1](https://github.com/CraftJarvis/JARVIS-1) | Ⅲ | 418 | 2024-04-08 | Python | **none** | 部分 | 是 | 6 | 否 | 无 | ❌ | 停更；权重/数据不全 |
| [zju-vipa/Odyssey](https://github.com/zju-vipa/Odyssey) | Ⅲ | 411 | 2025-10-22 | Python | MIT | 是 | 否（LLM API） | 6 | 否 | 无 | ❌ | 基于 Voyager 骨架，同样吃旧版本 |
| [BAAI-Agents/Cradle](https://github.com/BAAI-Agents/Cradle) | Ⅲ（GUI） | 2,602 | 2024-11-07 | Python | MIT | 否（看屏幕） | 否 | 5 | 否 | Python | ❌ | 不是 MC；停更；RDR2 等 GUI 任务 |
| [altera-al/project-sid](https://github.com/altera-al/project-sid) | Ⅲ | 1,397 | 2024-11-05 | **无代码** | none | n/a | n/a | n/a | n/a | n/a | ❌ | 只有技术报告，别当项目 |
| [mikelma/craftium](https://github.com/mikelma/craftium) | Ⅲ | 215 | 2026-02-17 | C++ | NOASSERTION | 是 | 是 | 4 | 否 | gym | ❌ | 类 MC 自研引擎，不是真 MC |
| [OpenGVLab/GITM](https://github.com/OpenGVLab/GITM) | Ⅲ | 644 | 2023-06-05 | Python | none | ? | 是 | 6 | 否 | 无 | ❌ | 停更 |
| [xlang-ai/OSWorld](https://github.com/xlang-ai/OSWorld) | Ⅲ（GUI） | 3,262 | 2026-11-14 | Python | Apache-2.0 | 否 | 否 | 4 | 否 | 基准 | ❌ | 慢；评测用，不是产品 |
| [bytedance/UI-TARS](https://github.com/bytedance/UI-TARS) | Ⅲ（GUI） | 11,696 | 2026-01-27 | Python | Apache-2.0 | 否 | 是（7B/72B） | 4 | 否 | 模型/CLI | ❌ | 通用 GUI，不适配实时 3D |
| [bytedance/UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) | Ⅲ（GUI） | 39,599 | 2026-10-09 | TS | Apache-2.0 | 否 | 否（调 API） | 2 | 否 | 桌面 app | ⚠️ 可远程看桌面 | 通用 GUI，慢 |
| [anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts) | Ⅲ（GUI） | 21,053 | 2026-11-06 | Python | MIT | 否 | 否 | 3 | 否 | API | ⚠️ 需截屏回传 | computer-use demo，单步秒级 |
| [OthersideAI/self-operating-computer](https://github.com/OthersideAI/self-operating-computer) | Ⅲ（GUI） | 10,311 | 2026-10-19 | Python | MIT | 否 | 否 | 3 | 否 | API | ⚠️ | 同上 |
| [moeru-ai/airi](https://github.com/moeru-ai/airi) | Ⅳ | **51,469** | 2026-11-16 | TS | MIT | 部分（MC 服务 headless） | 否 | 5 | **是**（mineflayer 进服） | WS 桥 + 内嵌 MCP SDK | ✅ 浏览器版/PWA | MC 集成**仅源码安装**、官方标注将迁移 Fabric；语音强、玩法浅 |
| [Open-LLM-VTuber/Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | Ⅳ | 14,729 | 2026-05-15 | Python | NOASSERTION | 是 | 可选（本地 ASR/TTS） | 4 | 否 | 无 | ✅ Web | 半年无 commit；无 MC |
| [kimjammer/Neuro](https://github.com/kimjammer/Neuro) | Ⅳ | 2,124 | 2025-01-17 | C# | MIT | 否 | 可选 | 5 | 否 | 无 | ❌ | 7 天复刻，停更 |
| [AkagawaTsurunaki/ZerolanLiveRobot](https://github.com/AkagawaTsurunaki/ZerolanLiveRobot) | Ⅳ | 833 | 2026-01-17 | Python | MIT | 是 | 可选 | 5 | 否 | 无 | ⚠️ | 中文直播机器人，2026-01 后停更（B 会深挖） |
| [Ikaros-521/AI-Vtuber](https://github.com/Ikaros-521/AI-Vtuber) | Ⅳ | 4,623 | 2026-11-08 | Python | GPL-3.0 | 是 | 可选 | 5 | 否 | 无 | ✅ | 直播向，非 MC |
| [semperai/amica](https://github.com/semperai/amica) | Ⅳ | 1,625 | 2026-11-12 | TS | MIT | 浏览器 | 可选 | 3 | 否 | 无 | ✅ | 3D 陪伴，无游戏接入 |
| [uezo/ChatdollKit](https://github.com/uezo/ChatdollKit) | Ⅳ | 1,283 | 2026-10-31 | C#/Unity | Apache-2.0 | 否 | 可选 | 4 | 否 | 无 | ⚠️ | Unity 客户端 |
| [Project-N-E-K-O/N.E.K.O](https://github.com/Project-N-E-K-O/N.E.K.O) | Ⅳ | 3,238 | 2026-11-15 | Python | Apache-2.0 | 未验证 | 未验证 | 5 | 未验证 | 插件市场 | ✅ | 自称"游戏陪伴"，**未验证 MC 接入** |
| [moeru-ai/airi-factorio](https://github.com/moeru-ai/airi-factorio) | Ⅳ | 106 | 2026-02-25 | TS | 未取到 | 是 | 否 | 5 | 否 | 无 | ✅ | 用 CV+LLM 玩 Factorio，不是 MC |

### 2.2 基础设施：假人 / 服务端控制 / 观察

| 项目 | ★ | 最近 commit | License | 作用 | 能否让 AI 驱动 | 坑 |
|---|---:|---|---|---|---|---|
| [gnembon/fabric-carpet](https://github.com/gnembon/fabric-carpet) | 2,086 | 2026-11-12 | MIT | `/player` 假人（Fabric 服务端 mod），服务端生成真玩家实体 | 可以：外部发 `/player` 命令 | 假人无 AI；只 Fabric；命令权限 |
| [MCDReforged/MCDReforged](https://github.com/MCDReforged/MCDReforged) | 1,103 | 2026-11-10 | LGPL-3.0 | Python 服务器控制框架（RCON/事件/插件） | 可以：Python 插件下发命令、读事件 | 只控制服务端，不做 AI |
| [tanyaofei/minecraft-fakeplayer](https://github.com/tanyaofei/minecraft-fakeplayer) | 236 | 2025-11-06 | Apache-2.0 | Paper/Purpur 假人插件，可 `/fp attack/mine/use/invsee` | 可以：命令驱动 | Paper + CommandAPI；2025-11 后无更新 |
| [EndlessPixel-Studio/FakePlayer-CE](https://github.com/EndlessPixel-Studio/FakePlayer-CE) | 47 | 2026-11-15 | Apache-2.0 | 上述插件的社区续作 | 可以 | 生态更小 |
| [xiplugin/FakePlayerPlus](https://github.com/xiplugin/FakePlayerPlus) | 39 | 2026-11-02 | GPL-3.0 | 假人保活/模拟真人 | 有限 | 偏保活，不是 agent |

**判定**：假人路线能给"真玩家实体 + 服务端权威"，但**只有身体没有大脑**；要 AI 必须自己接 LLM 并把 `/player`/`/fp` 命令包成工具。它适合"多人才是真陪玩"的极端要求（朋友在服务器里看到的是一个会动、有皮肤、能被打的玩家），但工程量比 mineflayer 大，且绑定 Paper/Fabric 服务端。

### 2.3 MCP 专项（本节回答父 agent 的 5 个问题）

| 项目 | ★ | 传输 | 工具面（实测/文档） | 维护 | DSH 可直连？ | 判定 |
|---|---:|---|---|---|---|---|
| [yuniko-software/minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server) | 818 | **stdio**（`npx -y github:...`） | ~20 个：`get-position`/`move-to-position`/`look-at`/`jump`/`move-in-direction`/`fly-to`/`list-inventory`/`find-item`/`equip-item`/`place-block`/`dig-block`/`get-block-info`/`find-blocks`/`smelt-item`/`find-entity`/`send-chat`/`read-chat`/`detect-gamemode` | 最后 commit 2026-04-05，release 2.0.4（2026-02-27），npm 月下载 290 | ✅（stdio） | **唯一"能直接用"的成熟件，但偏 demo**：无寻路、无长任务、无建造 |
| [G0Osey99/awesome-mineflayer-mcp](https://github.com/G0Osey99/awesome-mineflayer-mcp) | 10 | **stdio** | 宣称 **123 tools / 26 groups**：移动/采矿/合成/背包/战斗/容器/聊天/生命周期 + 视觉（第一人称截图+示意图）+ waypoint + 建造/挖掘宏 + 事件流（poll+push） | 2026-06-28 建库，最后 commit 2026-06-29，npm 1.3.2，月下载 572，0 open issue | ✅（stdio） | **功能最全、最值得试装**，但 10★、无 issue 历史、作者单人，属于"高潜力未验证" |
| [HarjjotSinghh/minecraft-mcp](https://github.com/HarjjotSinghh/minecraft-mcp) | 0 | stdio | ~25 个：寻路/跟随/挖掘/放置/合成/攻击/吃/睡/私聊/玩家列表 | 2026-01-25 后无更新；npm `minecraft-ai-mcp` v1.0.0，月下载 77 | ✅ | demo，不建议 |
| [kilgorjn/minecraft_mcp](https://github.com/kilgorjn/minecraft_mcp) | 0 | 未取到 | 未取到 | 2025-09-06 后无更新 | 未知 | 死 demo |
| `DennisTraub/minecraft-mcp-server` | — | — | — | **仓库 404，不存在** | — | 父 agent 线索有误，已核实 |
| npm `minecraft-ai-mcp` | — | stdio | 同 Harjjot | 2026-01-24 发布后无更新 | ✅ | 同 Harjjot |
| [gerred/mcpmc](https://github.com/gerred/mcpmc) | 40 | stdio | 早期 MCP 实验 | 2024-12-22 | ✅ | 历史价值 > 使用价值 |
| [amenti-labs/vibecraft](https://github.com/amenti-labs/vibecraft) | 108 | 未取到 | MCP 驱动的"描述→建造" | 2026-01-18 | 可能 | 只做建造，不做陪玩 |
| [MakkCH/minecraft_mcp](https://github.com/MakkCH/minecraft_mcp) | 20 | **stdio** + Fabric mod + JsMacros | 客户端内执行脚本、截图、聊天；可选 Baritone | 2026-11-13，活跃 | ✅（stdio） | **客户端接管流**：AI 直接操作你的角色，能截图；只 26.x |
| [Dwinovo/minecraft-numen](https://github.com/Dwinovo/minecraft-numen) | 611 | **streamable-HTTP**（`127.0.0.1:8765`，Bearer） | 见 §3.1.9：list/create/delete_companion、guide、get_events、say、lua、skill、todo、memory | 2026-11-12，极活跃 | ⚠️ 传输支持，但需 DSH 能带 `Authorization: Bearer` 头 | **最像"陪玩"的 MCP**，但 beta |

**MCP 结论**：
1. **传输**：除 Numen 是 streamable-HTTP 外，其余全部是 **stdio**，理论上都能被 DSH 的 MCP client 直接拉起；**没有一个提供 streamable-HTTP 的公网端点**（Numen 只绑回环，需自己改 `host` 才能局域网访问）。
2. **工具粒度**：yuniko 是"原子动作"，适合当最小骨架；awesome-mineflayer-mcp 是"全家桶"，功能最全但没经过社区检验；Numen 是"高层语义 + 脚本"，最接近"陪玩"但不可移植。
3. **安全坑**：yuniko 有一个 **open** issue（2026-03-27）"Game state data returned to LLM without sanitization — indirect prompt injection"，说明游戏内聊天/告示牌可以把指令注入给模型；任何"读聊天再让 LLM 决策"的方案都要做隔离。
4. **DSH 适配**：工具名均为 snake_case（`move_to_position` 等），符合常见 MCP 命名；但 DSH 是否支持自定义 header（Numen 的 Bearer）**未验证**，这是接 Numen 前必须确认的一件事。

### 2.4 一句话带过的相邻项目

- `blendi-remade/agentcraft` 1,013★：把 Claude coding agent 团队放进 MC 工作室可视化——**是"在 MC 里看写代码"，不是陪玩**，与需求无关。
- `zoyluoblue/mc_aiplayer` 149★：服务端 Fabric mod，自带 DeepSeek 大脑，无 MCP。
- `Zhou-Shilin/MineClawd` 69★：把 OpenClaw 塞进 MC 的 mod，自带 LLM，无 MCP。
- `chapmanjw/minecraft-java-fabric-mcp-server` 11★：mod 内跑 MCP server，偏开发/管理，无具身 agent。
- `lolifamily/Minecraft-MCP` 14★：mod 内 MCP + Kotlin REPL。
- `langyo/minecraft-mod-mcp` 43★：多版本 mod 的 MCP，偏开发。
- `Jahrome907/minecraft-agent-skills` 205★：13 个 MC **开发**技能（mod/插件/数据包），不是玩法 agent——但它是"把 MC 知识打包成 skill"的现成范本，对 DSH skill 设计有参考价值。
- `Ammaar-Alam/minebench` 342★：LLM 3D 建造竞技场/排行榜，不是运行时 agent。

---

## 3. 分家族详解

### 3.1 家族 Ⅰ：协议层 Bot

#### 3.1.1 mineflayer：事实标准，但注意版本墙

- **规模**：7,768★ / 1,559 fork / MIT / JS / npm 月下载 **308,472**；最新 release 4.39.0（2026-09-07）；最后 commit 2026-10-25。
- **形态**：Node 库，`npm i mineflayer` + 十几行代码即得到一个"真玩家"（离线或微软正版登录），无渲染、无 GPU、可跑在 1 核小机器上。`package.json` engines 要求 **Node ≥22**。
- **能力边界**：协议层给的是"位置/背包/方块/实体/聊天"，不是像素；所有"看"都要另配 `prismarine-viewer` 或自己算视线。插件生态是它真正的护城河（pathfinder/collectblock/pvp/tool/auto-eat/armor-manager）。
- **版本墙**：2026-11-14 仍有一个 **open** issue "Add mineflayer 26.3 version support"（[#](https://github.com/PrismarineJS/mineflayer/issues)），说明 2026 年的 26.x 服务端还没被协议层覆盖；mindcraft README 也把上限写成 1.21.11。**选型时要么把服务器钉在 1.21.x，要么接受"进不去最新版"。**
- **稳定性坑**：issue #3753（2025-10-03，closed，7 评论）记录了"partial packet freeze / memory leak explosion packet"——长时间挂机遇到异常爆炸包会卡死。做"陪玩"必须加进程守护/自动重连。
- **社区评价**：PrismarineJS 是 MC 协议圈的"官方民间标准"，Discord 活跃；npm 下载量说明它是生产级依赖，不是玩具。

#### 3.1.2 mindcraft：最像"AI 陪玩"的参考实现

- **规模**：6,017★ / MIT / JS；最后 commit 2026-10-27；release 节奏慢（v0.1.4 2026-03-21，上一版 2025-09-21）。
- **架构**（README 实测）：
  - `settings.js` + `profiles/*.json`：每个 bot 一个人设、一个模型、一套提示词；
  - 模型分槽：`model`（聊天）/`code_model`（写新动作）/`vision_model`（看图）/`embedding`（示例检索）/`speak_model`（TTS）；
  - 支持 **17 家 API**：openai、google、anthropic、xai、**deepseek**、**ollama**、qwen、mistral、replicate、groq、huggingface、novita、openrouter、hyperbolic、**vllm**、cerebras、mercury；
  - 多 agent：`--profiles a.json b.json`；任务模式：`--task_path/--task_id`；Docker 一键。
- **"一起玩"**：可以。`settings.js` 填 `host/port/auth:"microsoft"` 就能进正版服务器，和人类同服；多 agent 可同服协作（论文 arXiv:2504.17950 "MineCollab"）。
- **MCP**：**没有**。它是"自带 agent 循环"的封闭框架，要接 DSH 只能改源码或把 `node main.js` 包成 CLI 工具。
- **坑**：
  - README 原文："We are currently not very responsive to github issues."（issue 里确实有 2026-06 的 "welp"、2026-10 的 "15 bugs found running agents long-term" 没人回）；
  - `allow_insecure_coding` 会让 LLM 在你机器上写/跑代码，README 自己标了 Caution；
  - 版本上限 1.21.11；Node 24+ 原生依赖会出问题。
- **结论**：**最佳"抄架构"对象**，不是最佳"依赖"对象。

#### 3.1.3 Voyager：学术鼻祖，现在只剩考古价值

- **规模**：7,330★ / MIT / 最后 commit **2023-07-27**（pushed_at 2024-04 只是分支推送）。
- **依赖**：Python 3.9 + Node 16 + **Minecraft Fabric 1.19（`fabric-loader-0.14.18-1.19`）** + 一组 Fabric mod + **OpenAI GPT-4 API key** + Azure 登录。
- **为什么不能用了**：
  - issue 里 "AzureAppNotPermitted on new installs"、"Azure doesn't have the Minecraft API"、"node.js install error"、"AssertionError plugin needs to be a function" 全是装不上的经典症状；
  - MC 1.19 的 mod 生态在 2026 年已基本不可维护；
  - 7 个 open issue，无人处理。
- **它证明了什么**：技能库 + 迭代提示 + 自动课程这套范式是成立的（3.3× 独特物品、2.3× 移动距离、15.3× 科技树速度），**但它是论文 artifact，不是产品**。

#### 3.1.4 Baritone：最好的"腿"，但不是大脑

- **规模**：9,360★ / LGPL-3.0 with anime exception / Java；v1.20.0（2026-09-23）；最后 commit 2026-11-10；README 支持 1.12.2–1.21.4 的 Forge/Fabric/NeoForge。
- **形态**：客户端 mod + Java API；玩家用 `/b` 命令（`/b goto`、`/b mine`、`/b build`）驱动；也被 Impact/Lambda 等客户端集成。
- **能不能被外部 agent 驱动**：能，但只有两条路——(a) 游戏内聊天命令（需要有人/机器人发消息），(b) Java API（要写 mod）。**没有 HTTP/MCP**。
- **和 mineflayer 的关系**：`miner-org/mineflayer-baritone`（46★）**不是** Baritone 的桥，而是一个独立 A* 寻路插件，名字有误导性；真正的"mineflayer 用 Baritone"需要自己写 RCON/聊天桥。
- **结论**：如果走"客户端 mod + LLM"路线，Baritone 是最省事的腿（MakkCH 的 MCP 也推荐它）；如果走 mineflayer，直接用 pathfinder 即可。

#### 3.1.5 mineflayer 插件生态（选型表）

| 插件 | ★ | 最后更新 | 作用 | 建议 |
|---|---:|---|---|---|
| mineflayer-pathfinder | 318 | 2026-11-14 | A* 寻路/挖搭/游泳 | **必装** |
| mineflayer-collectblock | 59 | 2026-04-13 | 采集整片方块 | 推荐 |
| mineflayer-pvp | 72 | 2026-04-17 | 近战 | 可选，战斗弱 |
| mineflayer-tool | 29 | 2026-10-03 | 自动选工具 | 推荐 |
| mineflayer-auto-eat | 51 | 2026-02-16 | 自动吃 | 推荐 |
| mineflayer-armor-manager | 未取到 | npm 2023-07 | 自动穿甲 | 停更，慎用 |
| mineflayer-statemachine | 139 | 2026-07-08 | 行为树/状态机 | 可选 |
| mineflayer-web-inventory | 99 | 2026-11-15 | 网页看背包 | 调试用 |

#### 3.1.6 MCP 生态（见 §2.3，此处只给结论）

- **"把 MC 动作暴露成 MCP tool"已经有 5+ 个现成项目**，但除 yuniko（818★）外全部 ≤108★，且大多 2026 年上半年之后就没动过。
- **没有一个是"产品级"**：yuniko 无寻路、无建造、无长任务；awesome-mineflayer-mcp 功能最全但没人验证；Numen 是唯一"高层语义 + 真游戏实体"的 MCP，但它是 mod 不是库。
- **对 DSH 的意义**：接 yuniko 或 awesome-mineflayer-mcp 只需一个 stdio 配置；接 Numen 需要 streamable-HTTP + Bearer header，**要先确认 DSH 的 MCP client 是否支持自定义 header**。

#### 3.1.7 DSH 原生/近原生项目

**`blueziii/dsh-mc-agent`（35★，MIT，2026-11-05）**
- 41 个 `mc_*` 工具：进服、寻路、挖矿、合成、熔炼、箱子、村民、睡觉种地、按图盖房、第一人称观察（`mc_observe`）、地形图/层图/竖列图（`mc_map`）、战斗策略、自主层（`ai-led`）、≤11 秒分片返回。
- 安装：`pnpm add github:blueziii/dsh-mc-agent` + 5 个 mineflayer 插件 + 写进 `dsh.profile.bundles` + 重启 DSH（4 步）。
- 它是 `yzi1b/whale-craft`（57★）的魔改版；README 里那套"151 个真 bug 的踩坑档案"说明作者是真跑过。
- **意义**：它证明"DSH 插件 + mineflayer 子进程 + 结构化状态 + 高层工具"这条形态可行，而且已经有人踩完坑。

**`luckui/dsh-game`（13★，2026-10-26，交叉引用 ≤200 字）**
> 它把"DSH 插件 + mineflayer 子进程 + 真客户端旁观 + RCON"这条形态跑通了：插件开一个真 MC 客户端，旁观挂在 mineflayer bot 身上，OBS 抓窗口直播；还带豆包 TTS、字幕、随时插话。**它证明的是"包装形态"可行（DSH 里一键开局、有画面、有声音、能直播），不是"AI 会陪玩"**——它的 bot 仍是自己玩、你在旁边看；且 Windows-only、DSH 0.2.0-rc.2、未上 npm、只支持离线服。对本项目的价值：**照抄它的进程编排与画面管线，换掉它的"看客"定位**。

**`HITEML/dsh-minecraft-agent`（1★）**：自研 MCP server + mineflayer 驱动 DSH，思路与 dsh-mc-agent 相同但几乎没人用，可忽略。

**`Jahrome907/minecraft-agent-skills`（205★）**：13 个 MC **开发**技能（mod/插件/数据包/命令/测试/CI），不是玩法 agent；但它是"把 MC 领域知识打包成 skill"的现成模板，DSH 要给 AI 装"MC 常识"时可参考其组织方式。

#### 3.1.8 服务端假人方向（"多人才是真陪玩"的另一条腿）

- **Carpet `/player`**（fabric-carpet 2,086★，MIT，2026-11-12）：Fabric 服务端 mod，`/player Steve spawn` 生成一个**服务端认可的真玩家实体**，能被打、能捡东西、能加载区块。缺点：假人没有 AI，只能靠外部发命令。
- **MCDReforged**（1,103★，LGPL-3.0，2026-11-10）：Python 服务器控制框架，插件可读事件、发 RCON 命令——**它是"外部大脑"最自然的落点**：Python 插件收聊天/事件 → 调 LLM → 用 `/player` 或 `/fp` 执行。
- **Paper 假人插件**（tanyaofei 236★、FakePlayer-CE 47★、FakePlayerPlus 39★）：`/fp attack/mine/use/invsee` 等命令可精细控制假人，适合"NPC 化队友"。
- **判定**：这条路能做出"朋友在服务器里真的看到一个队友"的效果，但**AI 要完全自己接**，且绑定 Paper/Fabric 服务端、需要 OP/权限、假人行为受反作弊限制。工程量 ≥ mineflayer 方案，只在"必须服务端权威/必须真实体"时才值得。

#### 3.1.9 Numen（言出法随）专节：目前最像"陪玩"的成品形态

**基本盘（2026-11-16 实测）**

| 指标 | 数值 | 来源 |
|---|---|---|
| stars / forks / watchers | **611 / 70 / 2** | ungh + API |
| 创建时间 | 2026-05-14（**只有 6 个月**） | API |
| 最近 commit | 2026-11-12 | commits.atom |
| 近 3 天 commit | 20 条（11-08～11-10 的 atom 窗口；atom 只回最近 20 条，说明至少 20 条/3 天） | commits.atom |
| contributors | **9 人，Dwinovo 一人 3,218 commit**（其余 1–11 条） | ungh contributors |
| PR 数 | **未取到**（GitHub API 18:20 起 403 限流） | — |
| releases | **30 个，全部 pre-release（beta）** | ungh releases |
| open issues | 6 | API |
| CurseForge 下载 | **19,028** | cfwidget(1581109) |
| License | LGPL-3.0（代码）/ CC BY 4.0（截图架构图）/ 美术保留 | README |

**运行形态**：mod 装在 MC 里，操纵一个**真实玩家实体**（不是 NPC/假人），支持 1.20.1–26.3、Fabric/Forge/NeoForge、Java 17/21/25；双端模组，联机服可用，每人自己的 API key 驱动自己的同伴。

**MCP 到底怎么暴露（源码级核实，不是 README 转述）**

- **传输**：**Streamable HTTP**（`mcp/src/main/java/com/dwinovo/numen/mcp/server/StreamableHttp.java`），Bearer token 认证（`BearerAuth.java` / `McpTokens.java`），带 `OriginGuard`、审计、限流。
- **监听**：服务端配置文件 `mcp_server.json`（在服务器 home 下），字段：
  - `enabled`：**默认 false**（服主自己开）；
  - `host`：默认 `127.0.0.1`（只绑回环；改 `0.0.0.0` 才局域网可达）；
  - `port`：默认 **8765**；
  - `call_timeout_seconds`：默认 300；
  - `hidden_tools`：不给外脑看的工具；
  - `limits`：每 token 并发 8 / 每分钟 240；全局并发 64 / 每分钟 1200。
- **令牌**：游戏内 `/numen token create <brain|channel> [all|<同伴>] [<天数>]`，明文只显示一次；`/numen token list`、`/numen token revoke <id>`。**brain** 角色 = 驾驶席；**channel** 角色 = 只收发消息（`send`/`get_replies`/`answer_consent`）。
- **工具清单**（brain 角色，源码 `ExternalHost.java` + `McpInstructions.java` + `ToolRegistry`）：
  | 工具 | 作用 |
  |---|---|
  | `list_companions` | 列出可驾驶的同伴（名字/id） |
  | `create_companion` / `delete_companion` | 召唤/遣散（名字 3–16 位字母数字下划线） |
  | `guide` | **返回该同伴自己的系统提示原文**（人设、操作核心、API 索引、技能、规矩）——外脑必须先调一次 |
  | `get_events` | 长轮询收件箱，最长 50 秒；主人说的话以 `<query>` 到达；没事就挂着等 |
  | `say` | 让同伴在游戏里说话：聊天行 + 气泡 + 语音（TTS 在 Numen 侧） |
  | `lua` | 执行 Lua 程序调用原子 API（感知/移动/挖掘/建造/交互），一次可连做几十步 |
  | `skill` / `todo` / `memory` | 读技能、写计划、长期笔记（remember/recall/forget） |
- **行为语义**（`McpInstructions` 原文要点）：外脑连上后**内置大脑停牌**；主人的游戏内聊天不再进内置大脑，而是经 `get_events` 交给外脑；`say` 才会被游戏里的人听到；程序结果文本 + `<runtime_state>` + 期间事件一起返回；**权限审批问的是坐在电脑前的主人（elicitation），不是模型**；**游戏不替外脑保存对话历史**，事件会排队等取。

**"外接大脑"的真实限制（父 agent 问题 3）**

1. **人设**：README 说"外接模式下人设不生效、不会把人设交给它"；但源码里 `guide` 工具返回的正是"内置大脑每次请求开头的那份原文"，**包含人设**。准确说法是：**人设不会自动注入外脑的 system prompt，但外脑可以主动 `guide` 取回并自己放进上下文**。成本：一次工具调用 + 几 KB prompt token。
2. **记忆**：游戏不存外脑的对话历史（源码注释明确"Keep your own conversation history"），但 `memory` 工具（remember/recall/forget）仍可用，同伴的长期笔记在游戏侧持久化。**成本：DSH 侧要自己管会话历史 + 定期把重要事实写进 `memory`。**
3. **语音**：`say` 触发游戏内 TTS（chat/bubble/voice），**外脑不需要自己做 TTS**；语音输入（按住 V）也在 Numen 客户端侧转文字后作为 `<query>` 进来。**成本：几乎为零，但音色/语速由 Numen 配置决定，DSH 不能细控。**
4. **视觉**：**没有**。源码里没有任何截图/图像工具；`docs/adr/body/0004-vision-rendered-by-client.md` 明确"画面由客户端画"的方案**状态是"已接受，暂缓（2026-10-16）"**，当前只有服务端"看见什么"的实体清单（视线锥内、未被挡、带类型/名字/距离）。**这是 Numen 相对 dsh-mc-agent 的最大短板**。
5. **DSH 接入**：streamable-HTTP 是 DSH 支持的传输，但 **Bearer header 是否可配未验证**；若 DSH 的 MCP client 不能加 header，就需要一个本地反向代理（几十行）补上 Authorization。工具名是 snake_case（`list_companions`/`get_events`/`say`/`lua`），符合常见 MCP 命名，不需要额外改名。
6. **稳定性**：beta（30 个 release 全是 pre-release），issue 里有 Carpet 重生 Redirect 冲突（2026-11-16 仍 open）、尸体类 mod 锁死、Paper `NoSuchMethodError`、Waystones tick 崩溃等——**mod 冲突是主要失败模式**。**没有看到"装不上/API key 报错"这一类基础安装问题**（最近 16 条非 PR issue 基本都是游戏内兼容/行为 bug，且大多当天被作者回复关闭），说明"能装上、能跑"这条底线是过的。

**Numen vs dsh-game 一句话**：
> **要"游戏里真的多一个朋友"（正版/联机服、有皮肤、能被别人看见、有语音）选 Numen；要"Windows 本机零 mod、开箱即用看她自己玩、还能直播"选 dsh-game。** 前者是"队友"，后者是"看客"。

**同类扫描结论（父 agent 问题 5）**：截至 2026-11-16，**没有找到第二个"mod 内具身 agent + MCP 外接大脑"的项目**。最接近的是：
- `MakkCH/minecraft_mcp`（20★）：客户端 mod + MCP，但它接管的是**你的角色**，不是独立同伴；
- `chapmanjw/minecraft-java-fabric-mcp-server`（11★）/ `lolifamily/Minecraft-MCP`（14★）：mod 内跑 MCP server，但**没有具身 agent**，偏开发/管理；
- `zoyluoblue/mc_aiplayer`（149★）/ `Zhou-Shilin/MineClawd`（69★）：mod 内自带 LLM 大脑，**没有 MCP**，不可外接。
Numen 的"mod 内实体 + MCP 外脑 + 双端联机"组合目前是独一份。

### 3.2 家族 Ⅲ：视觉-动作 / 模拟环境

#### 3.2.1 学术谱系（按"能不能跑"排序）

| 项目 | 是什么 | 硬件/依赖 | 现在能跑吗 | 为什么不能陪玩 |
|---|---|---|---|---|
| **VPT**（openai/Video-Pre-Training，1,761★，MIT） | 用未标注视频预训练"看画面按键"的策略 | GPU + contractor 数据（TB 级）+ MineRL | 代码在，权重可下，但 2022 年的研究栈 | 需要"给定任务微调"，不是对话/陪玩；推理要 GPU |
| **MineRL**（982★，NOASSERTION） | Gym 环境 + 人类演示数据集 | Java 8 + Python | 2025-01 后停更，241 open issue | 是训练环境，不是 agent |
| **MineDojo**（2,284★，MIT） | 1,581 个程序化任务 + 创意任务 + 知识库 | 要编译 Java、弹游戏窗口 | 2023-08 后停更 | 评测框架，无对话、无陪伴 |
| **MineStudio**（420★，MIT） | VPT 数据 + 策略模型 + 批量评测 | JDK8 + VirtualGL/Xvfb + HF 数据集 | 2025-10 后停更，但文档完整 | 训练/评测，重 |
| **CraftGround**（71★，GPL-3.0） | ~300TPS 的 MC RL 环境（Kotlin） | JVM + 可选 GPU | 2026-10 仍更新 | 是环境，不是产品；生态小 |
| **ROCKET-1**（48★，无 license） | 视觉-文本提示的开放世界交互（论文） | Java + GPU | 2025-02 后停更 | 论文代码，无 license，不能商用 |
| **JARVIS-1**（418★，无 license） | 记忆增强多模态 agent（论文） | Python + GPU | 2024-04 后停更 | 同上 |
| **Odyssey**（411★，MIT） | Voyager 骨架 + 40 基础技能/183 组合技能 + 微调 LLaMA-3 | Python + MC 服务器 + LLM | 2025-10 仍小更新 | 依赖旧 MC 版本；学术评测向 |
| **Cradle**（2,602★，MIT） | 通用计算机控制（看屏幕） | Python 3.10 + OCR | 2024-11 后停更 | **不是 MC**，是 RDR2/Stardew 等 GUI 任务 |
| **Project Sid**（1,397★，无 license） | 10–1000 agent 社会模拟（论文） | 无代码 | **只有 PDF** | 不是项目，是报告 |

**共同结论**：这一族的产出是**论文/环境/权重**，不是"能装进用户电脑陪他玩"的软件。它们要求的硬件（GPU、TB 数据、Java 8、旧版 MC）和"轻量化"直接冲突。

#### 3.2.2 GUI agent 在实时 3D 游戏上的可行性（定性 + 证据）

- **硬证据 1（延迟）**：cua-speedrun（arXiv:2609.40284，2026-09）明确写："Standard computer-use runtimes typically take roughly **2–3 seconds from issuing an action to receiving an observation**"；他们优化的 FastCUA 才能做到 2–28ms。**MC 是 20 TPS，2–3 秒 = 40–60 个游戏 tick**；苦力怕爆炸前的引信约 1.5 秒、骷髅射箭约 1 秒——**这个采样率下无法战斗、无法躲避**。
- **硬证据 2（效率）**：OSWorld-Human（arXiv:2506.16042）发现 CUA 完成任务"tens of minutes"（人类几分钟），且"每多一步，后续每步可能慢 3 倍"，最高分 agent 仍比人类多 1.4–2.7 倍步数。**换算到 MC：一个"砍树→合成→挖矿"的循环会被拆成几十步，每步 2–8 秒，体验是"看她发呆"。**
- **硬证据 3（能力上限）**：HN 2026-10-21 热帖"Google DeepMind says four AI agents beat Minecraft in 27 hours"（4 个 Gemini agent、2,783 个自写程序、605 次死亡、约 $520 token）。**说明 LLM agent 长程能通关，但代价是 27 小时 + 520 美元**，与"陪玩"的实时性/成本完全相反。
- **硬证据 4（群体智能翻车）**：HN 2026-10-29 "We ran AI agent swarms in Minecraft and Mindustry"（425 分/176 评论）与 2026-11-01 "AI agent swarms in Minecraft fail to build civilization, drown in bureaucracy"（182 分/92 评论）——多 agent 社会模拟好看，但**不等于"陪你玩"**。
- **结论**：GUI/视觉端到端只适合**"让 AI 替你挂机做重复劳动"**（挖矿、建房、刷材料），不适合"实时陪玩"。如果非要用，必须做**动作宏/批处理**（一次决策执行多步），把"每步 2–3 秒"摊薄到"每个宏 10–30 秒"，并且接受它看不见细节。

#### 3.2.3 一个被低估的参照：`rmalde/minecraft-agent`（609★，无 license）

- 用 GPT-6 Astra 规划 + JEV 选动作，MC 1.16.5 + mineflayer，**8 分 43 秒通关**（131 次决策、35 次规划调用，约 **4 秒/决策**），带隐藏的原生客户端渲染做录像。
- 它证明：**"结构化状态 + 高层动作 + LLM 规划"可以在几分钟级完成复杂任务**；但这套是"速通专用"，不是"陪玩"——没有对话、没有人设、没有长期陪伴。

### 3.3 家族 Ⅳ：数字人 / 陪伴层

#### 3.3.1 AIRI（moeru-ai/airi）：语音陪伴最强，MC 只是插件

> **重要更正**：任务里写的 `elefant-ai/airi` 经核实是 **0★ 的空壳/旧镜像**（pushed 2025-08-25）；**活跃仓库是 `moeru-ai/airi`，51,469★**（2026-11-16 实测），MIT，TypeScript。

- **规模与节奏**：51,469★ / 303 open issues / v0.15.5（2026-11-15），v0.15.2→0.15.5 一周内连发 4 版，commit 每天有——**是本次调查里最活跃的陪伴层项目**。
- **形态**：浏览器 / Windows / macOS 桌面三端；Live2D/VRM 形象、实时语音（多 provider TTS：ElevenLabs、Azure、OpenAI 兼容、阿里、本地 Kokoro）、ASR、记忆、插件系统。
- **MC 接入方式（源码级）**：`integrations/minecraft/` 是一个独立 workspace `@proj-airi/minecraft-bot`：
  - **mineflayer** + `mineflayer-pathfinder/pvp/collectblock/auto-eat/armor-manager/tool` + `prismarine-viewer`；
  - 四层认知架构：Perception（事件注册 + YAML 规则）→ Reflex（FSM）→ Conscious（LLM planner + chat agent）→ Action（task executor）；
  - LLM 生成的 JS 计划在 `isolated-vm` 沙箱执行；
  - 通过 WebSocket 把状态/上下文/指令桥回 AIRI Stage；
  - 依赖里带 `@modelcontextprotocol/sdk`（MCP 客户端能力），但**不是**把 MC 动作暴露成 MCP server。
- **官方态度**：`integrations/minecraft/README.md` 顶部写着 **Deprecation Notice**——"current Mineflayer-based bot is expected to be replaced by a Fabric mod based runtime"；文档还写"仅支持从源码安装"、"不建议围绕它开发长期功能"。
- **部署**：`pnpm i` → 复制 `.env` → 填 AIRI token + OpenAI 兼容 API（文档用 DeepSeek 举例）→ `pnpm -F @proj-airi/minecraft-bot dev`（5 步，且是源码级）。
- **"一起玩"**：可以，mineflayer 进服，和人类同服；能聊天、能听指令、有语音。
- **坑**：MC 服务是"开发预览"，随时可能被 Fabric 重写；源码安装对普通用户不友好；303 个 open issue 说明维护压力大；语音强但**玩法深度有限**（砍树/挖矿/建造的可靠性远不如 mindcraft/dsh-mc-agent）。
- **结论**：**把它当"嘴和脸"（语音/形象/陪伴），不要当"手和脚"（MC 玩法）**。如果 DSH 需要一个"会说话的 AI 娘"，AIRI 是最成熟的壳；MC 部分另接。

#### 3.3.2 其他陪伴层

- **Open-LLM-VTuber**（14,729★，NOASSERTION，最后 commit 2026-05-15）：本地语音 + Live2D + 打断，Web/Electron；**半年没更新**，无 MC。
- **kimjammer/Neuro**（2,124★，MIT，2025-01-17 停更）：7 天复刻 Neuro-sama 的 C# 项目，历史意义 > 实用。
- **AkagawaTsurunaki/ZerolanLiveRobot**（833★，MIT，2026-01-17 停更）：中文直播机器人，B 会深挖，这里只记一句"2026 初已停更"。
- **Ikaros-521/AI-Vtuber**（4,623★，GPL-3.0，2026-11-08）：中文直播向，功能多但非 MC。
- **semperai/amica**（1,625★，MIT，2026-11-12）：浏览器 3D 陪伴，无游戏接入。
- **uezo/ChatdollKit**（1,283★，Apache-2.0，2026-10-31）：Unity 3D 聊天角色。
- **N.E.K.O**（3,238★，Apache-2.0，2026-11-15）：自称"realtime voice & vision、game companions、plugin market"，**但我没验证它的 MC 接入**（README 404，官网未读）——列为待查。
- **Cortico**（357★，MIT，2026-11-16）：**最值得关注的"另一个 harness"**——事件流驱动的 agent 框架，面向 persona bot/AI streamer，有扩展系统（Cortico World）和 WebUI；pre-release，**未发现 MC 扩展**，但架构上适合接 MC（和 DSH 是同类竞品/参考）。

#### 3.3.3 结论

- **语音/形象层**已高度商品化（AIRI、Open-LLM-VTuber、amica、N.E.K.O），**缺的是"在 MC 里可靠地玩"**。
- 所以最优组合不是"一个项目全包"，而是**AIRI/DSH 当嘴 + mineflayer/Numen 当手**。

### 3.4 prismarine-viewer 专节：手机"看到 AI"的最优解？

- **是什么**：PrismarineJS 的 Web 3D 渲染器，node 起一个 HTTP 服务（默认 3000 端口），浏览器里用 three.js 看 bot 周围的世界；支持第一/第三人称、画线、导出截图。
- **规模**：408★，MIT，npm 月下载 **57,023**，最后 commit 2026-10-06。
- **版本**：README 明确支持 1.8.8–**1.21.4**；其他 1.21.x 用"最接近版本的材质/模型"渲染（会出错但不崩）。
- **关键能力**：
  - `mineflayerViewer(bot, { port: 3000, firstPerson: true, viewDistance: 6 })` 一行接入；
  - `headless` 模式：把 bot 视角渲染成 **mp4 或 TCP 流**（默认 512×512，可调 width/height/frames）；
  - 玩家有皮肤/披风（在线模式服务器下发 skin 时）。
- **手机能不能看**：**能**。同一局域网，手机浏览器打开 `http://<PC-IP>:3000` 即可（WebGL），不需要装 App、不需要 root、不需要摄像头。这是"手机看到 AI 第一人称"成本最低的方案，**比"手机摄像头拍屏幕"稳定一个数量级**（后者有摩尔纹/对焦/帧率/OCR 四重退化，见 C 线报告）。
- **限制（必须诚实标注）**：
  1. 材质/模型只到 1.21.4，26.x 不支持；
  2. **帧率/CPU 占用我没有实测**（没起 MC 服务器）；按架构推断：渲染在浏览器端（three.js），node 端只负责把 chunk/实体数据推给前端，CPU 主要花在 chunk 解析与网络；`viewDistance` 默认 6，调大显著吃 CPU/带宽；
  3. 只保证渲染玩家，**生物/掉落物/方块实体是否完整未验证**；
  4. 没有音频；
  5. 手机浏览器长时间开 WebGL 会发热/掉电。
- **30 分钟验证配方**（建议父 agent 或 D 线执行）：
  ```bash
  npm i mineflayer prismarine-viewer
  # 20 行脚本：createBot -> once('spawn') -> mineflayerViewer(bot,{port:3000,firstPerson:true,viewDistance:6})
  # 手机浏览器开 http://<PC-IP>:3000，Chrome DevTools 看 FPS；任务管理器看 node CPU
  # 再试 viewDistance=3 / 10，记录 FPS 与 CPU
  ```

---

## 4. 三条能落地的组合路线

### 路线 A（首选，最轻）：mineflayer + DSH + prismarine-viewer

**组成**：MC Java 服务器（离线模式，1.21.x）→ mineflayer bot（Node 22）→ DSH（`dsh-mc-agent` 或自写 41 工具的简化版）→ prismarine-viewer（手机看）。

**依赖**：Node ≥22、pnpm、DSH、MC 服务端 1.21.x、5 个 mineflayer 插件、局域网。

**步骤（估 6 步，半天）**：
1. 起一个离线 MC 服务器（Paper/Fabric 均可，1.21.6 最稳）；
2. `pnpm add github:blueziii/dsh-mc-agent` + 5 个插件；
3. 写进 DSH profile 的 `dsh.profile.bundles`，重启；
4. DSH 里说"连 127.0.0.1:25565"；
5. 另起一个 node 进程挂 prismarine-viewer（或让 dsh-mc-agent 暴露 viewer 端口）；
6. 手机浏览器开 `http://<PC-IP>:3000`。

**延迟预算**：
| 环节 | 预算 |
|---|---|
| LLM 决策（DeepSeek/Claude） | 0.8–3 s |
| 工具执行（寻路/挖/放） | 0.1–2 s |
| 观察刷新（`mc_observe`/`mc_map`） | 1–10 Hz（按需） |
| 画面（viewer） | 目标 30–60 fps（未实测） |
| **端到端"看到→决定→动手"** | **2–5 s** |

**失败风险**：mineflayer 不支持 26.x（版本墙）；大服反作弊踢人；pathfinder 卡住/掉虚空；背包不同步；LLM 坐标幻觉；长跑内存泄漏（issue #3753）；viewer 材质错位。

**手机可观察/操控**：✅ 看（浏览器）；⚠️ 操控要另做 UI（DSH Web 若绑 LAN 可在手机开，但体验一般）。

**适合**：想"周末跑起来、先看到效果"；接受"AI 是另一个玩家，不是游戏内 NPC"。

### 路线 B（体验最好）：Numen + DSH 外接大脑

**组成**：MC 1.20.1/1.21.x 客户端 + 服务端都装 Numen → 游戏内开 MCP server（`mcp_server.json`，`enabled:true`，`host:127.0.0.1`，`port:8765`）→ `/numen token create brain` 拿 token → DSH 用 streamable-HTTP + Bearer 连上 → 外脑通过 `guide`/`get_events`/`lua`/`say` 驱动。

**依赖**：MC 客户端+服务端（双端 mod）、Java 17/21、CurseForge、DSH、能带 Authorization header 的 MCP client（或本地反代）。

**步骤（估 4 步，1–2 小时）**：装 mod（双端）→ 游戏内配 API key 或开 MCP → 发 token → DSH 配 MCP endpoint。

**延迟预算**：
| 环节 | 预算 |
|---|---|
| `get_events` 长轮询 | 事件到即返（≤50 s 挂起） |
| LLM 决策 | 1–5 s/plan |
| `lua` 程序执行 | 游戏 tick 级（几十 ms～几秒，取决于步数） |
| MCP 往返 | 0.1–1 s（本机） |
| **端到端** | **1–5 s**，但"一次计划可连做几十步"，体感比 A 更连续 |

**失败风险**：beta（30 个 release 全 pre-release）；mod 冲突（Carpet 重生 Redirect、尸体 mod、Waystones、Paper 方法缺失）；版本矩阵要严格对齐；外脑人设/记忆要 DSH 侧补；**无视觉**；Bearer header 兼容性未验证。

**手机可观察/操控**：⚠️ Numen 是游戏内实体，手机只能通过"远程桌面/串流看游戏画面"；但**朋友在服务器里能直接看到它**——这是"真陪玩"的关键差异。

**适合**：要"朋友也能看见的队友"、愿意装 mod、能接受 beta。

### 路线 C（最通用、最慢）：客户端接管 / 视觉 GUI

**组成**：Fabric 26.x + `MakkCH/minecraft_mcp`（JsMacros + 截图 + stdio MCP）+ 可选 Baritone；或通用 GUI agent（UI-TARS/Claude computer use）看屏幕点鼠标。

**依赖**：Java 25、Fabric 0.19.5+、JsMacros 2.2.1、Node 22、支持 stdio 的 MCP client。

**步骤（估 5 步）**：装 Fabric → 装 mod + JsMacros → 配 MCP client → 让 agent 写脚本/截图 → 随时 `/mcp stop` 接管。

**延迟预算**：
| 环节 | 预算 |
|---|---|
| 截图 | 0.1–0.5 s |
| LLM 决策 | 1–5 s |
| 动作执行 | 0.2–2 s |
| **端到端** | **3–8 s/动作**（GUI agent 的"动作→观察"本身 2–3 s） |

**失败风险**：只支持 26.1–26.3（版本锁死）；LLM 现写 JsMacros 脚本有破坏性；只能"接管你的角色"，不能做独立队友；反作弊；截图 prompt injection。

**手机可观察/操控**：⚠️ 需串流/远程桌面；但"AI 用你的角色"意味着手机看游戏画面即可。

**适合**：只想"让 AI 替我玩/替我建"，不要求"多一个队友"。

### 4.4 如果只选 3 个动手，选哪 3 个

1. **`PrismarineJS/mineflayer`** —— 身体。7,768★、MIT、headless、无 GPU、月下载 30.8 万，是唯一"一定能跑"的底座；所有上层方案（mindcraft/dsh-mc-agent/MCP）都建在它上面。
2. **`blueziii/dsh-mc-agent`**（备选 `yuniko-software/minecraft-mcp-server`）—— 大脑接口。前者是 DSH 原生 41 工具（4 步接入，最贴我们的栈）；后者是 818★ 的标准 MCP（更通用但工具少）。**先用 dsh-mc-agent 跑通，再用 yuniko 做"标准 MCP"备份。**
3. **`PrismarineJS/prismarine-viewer`** —— 眼睛。408★、MIT、57k 月下载，手机浏览器直开就是"AI 第一人称"；这是"手机看到"所有方案里最便宜、最稳的一条。

**为什么不是 Numen/AIRI**：它们体验更好，但一个要装双端 mod + beta，一个是源码级 + 官方标注要重写；**先用手上的 3 个把闭环跑通，再决定要不要为体验升级到 Numen**。

### 4.5 哪 3 个看起来很美但千万别碰

1. **`MineDojo/Voyager`（7,330★）** —— 学术鼻祖，但最后 commit 2023-07、MC 1.19、Azure 登录失效、装不上的 issue 一堆；**star 是论文热度，不是可用性**。
2. **`altera-al/project-sid`（1,397★）** —— 只有技术报告，**没有代码**；任何"复现 Project Sid"的想法都是自己从零写。
3. **`CraftJarvis/ROCKET-1`（48★）** —— 论文代码、**无 license**、2025-02 停更；商用/二次分发有法律风险。

**同类"看起来美"**：MineDojo、MineRL、VPT、JARVIS-1、Cradle（全部停更/研究栈/GPU 重）；`blendi-remade/agentcraft`（1,013★，但它是"在 MC 里看 coding agent"，与陪玩无关）。

---

## 5. star 成熟度红黑榜

### 5.1 红榜（活、能跑、文档可复现）

| 项目 | ★ | 为什么红 |
|---|---:|---|
| mineflayer | 7,768 | 月下载 30.8 万，协议圈事实标准，2026-10 仍在更 |
| prismarine-viewer | 408 | 月下载 5.7 万，手机看 AI 的最短路径 |
| baritone | 9,360 | 2026-11 仍更，v1.20.0（2026-09），MC 1.12–1.21.4 全覆盖 |
| fabric-carpet | 2,086 | `/player` 假人事实标准，2026-11 仍更 |
| MCDReforged | 1,103 | 服务端控制事实标准，2026-11 仍更 |
| Numen | 611 | 6 个月 30 个 release、1.9 万 CurseForge 下载、版本矩阵最全；但 beta |
| AIRI | 51,469 | 一周 4 个 release，语音/形象最成熟；MC 部分是预览 |
| dsh-mc-agent | 35 | 41 工具 + 踩坑档案，DSH 原生；小但真跑过 |
| yuniko MCP | 818 | 唯一"能直接用"的 stdio MCP；维护放缓但可用 |

### 5.2 黑榜（高 star 但别碰）

| 项目 | ★ | 最后 commit | 为什么黑 |
|---|---:|---|---|
| Voyager | 7,330 | 2023-07-27 | 停更 3 年、MC 1.19、Azure 失效、装不上 |
| MineDojo | 2,284 | 2023-08-29 | 停更、要编译 Java、82 open issue |
| MineRL | 982 | 2025-01-23 | 停更、Java 8、241 open issue |
| VPT | 1,761 | 2025-09-03 | 2022 研究代码，GPU + TB 数据 |
| JARVIS-1 | 418 | 2024-04-08 | 停更、无 license |
| Project Sid | 1,397 | 2024-11-05 | 只有论文，无代码 |
| ROCKET-1 | 48 | 2025-02-28 | 论文代码、无 license |
| Cradle | 2,602 | 2024-11-07 | 停更，且不是 MC |
| flayer | — | npm 0.1.1（2023-05） | PrismarineJS 早期高层 API，**仓库 404**，已死 |

### 5.3 灰名单（低 star 但活 / 高 star 但停）

| 项目 | ★ | 状态 | 判断 |
|---|---:|---|---|
| awesome-mineflayer-mcp | 10 | 2026-06-29，0 issue | 功能最全的 MCP，**值得 30 分钟试装**，但别当依赖 |
| MakkCH/minecraft_mcp | 20 | 2026-11-13，活跃 | 客户端接管流，版本锁 26.x |
| dsh-game | 13 | 2026-10-26 | 形态参考，Windows-only |
| yc minecraft-agent-harness | 224 | 2026-10-29 | 预发布，宣称 50 agent 同服 |
| minecraft-agent (rmalde) | 609 | 2026-09-20 | 速通专用，无 license |
| Open-LLM-VTuber | 14,729 | 2026-05-15 | 高 star 但半年没更 |
| ZerolanLiveRobot | 833 | 2026-01-17 | 中文直播向，已停更 |
| N.E.K.O | 3,238 | 2026-11-15 | 活跃，但 MC 能力未验证 |

---

## 6. 对我们需求的匹配度打分

**权重**：轻量 20% / 能陪玩 25% / 可扩展 15% / 成熟 15% / 可被 DSH 驱动 15% / **能与人类同服协作 10%**（父 agent 要求的硬指标，单独列分）。
**评分**：1–5，5 最好；总分 = 加权和。

| 方案 | 轻量 | 能陪玩 | 可扩展 | 成熟 | DSH 驱动 | **同服协作** | 总分 | 一句话 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| **mineflayer + 自写 agent** | 5 | 4 | 5 | 5 | 4 | 5 | **4.60** | 最强底座，但要自己写工具层 |
| **mineflayer + dsh-mc-agent** | 5 | 4 | 4 | 2 | 5 | 5 | **4.15** | 最贴 DSH，社区小 |
| **mineflayer + yuniko MCP** | 5 | 3 | 3 | 3 | 5 | 5 | **3.90** | 标准 MCP，工具少 |
| **mineflayer + awesome MCP** | 5 | 3 | 4 | 1 | 5 | 5 | **3.75** | 功能最全，未验证 |
| **Numen + DSH 外脑** | 2 | 5 | 4 | 3 | 4 | 5 | **3.80** | 最像队友，beta + 无视觉 |
| **Numen 自带大脑** | 2 | 5 | 3 | 3 | 3 | 5 | 3.55 | 不接 DSH 也能玩 |
| **AIRI** | 2 | 4 | 4 | 4 | 3 | 4 | 3.45 | 嘴和脸最强，手一般 |
| **mindcraft** | 3 | 4 | 3 | 4 | 2 | 4 | 3.35 | 最佳抄架构对象 |
| **dsh-game** | 2 | 5 | 2 | 1 | 5 | 5 | 3.35 | 形态参考，Windows-only |
| **MakkCH 客户端 MCP** | 3 | 4 | 3 | 2 | 5 | 5 | 3.60 | 接管你的角色，版本锁 |
| **yc harness** | 4 | 4 | 4 | 2 | 2 | 5 | 3.50 | 预发布，可观察 |
| **假人 + MCDR** | 4 | 2 | 4 | 3 | 2 | 5 | 3.15 | 真实体，但要自己接 AI |
| **GUI agent（UI-TARS 等）** | 3 | 2 | 3 | 3 | 3 | 5 | 2.95 | 单步 2–3 s，只够挂机 |
| **Voyager** | 2 | 2 | 2 | 1 | 1 | 3 | 1.80 | 论文 artifact |
| **MineStudio** | 1 | 1 | 3 | 2 | 1 | 2 | 1.55 | 训练环境，不是陪玩 |

**打分说明**：
- "能陪玩"= 有对话/人设/长期陪伴感 + 能一起做事，不只是"能进服"；
- "同服协作"= 是否能作为**独立玩家实体**和人类在同一个服务器里互动；MakkCH/Baritone/GUI 是"接管你的角色"，所以给 5 但注明"同屏非独立队友"；
- Numen 的"DSH 驱动"给 4 而不是 5，是因为 Bearer header 兼容性未验证；
- AIRI 的"同服协作"给 4，因为 MC 服务是 dev preview、随时可能迁移 Fabric。

---

## 7. 未验证清单（明确"没查到/拿不到"）

1. **prismarine-viewer 的实际帧率/CPU 占用**：没有起 MC 服务器实测；README 只给 `viewDistance` 默认 6、headless 默认 512×512。**这是最值得先验证的假设。**
2. **手机浏览器打开 viewer**：未实测（局域网/WebGL/发热均未测）。
3. **Numen 的 MCP 真实连通性**：只读了源码（`StreamableHttp.java`/`McpConfig.java`/`ExternalHost.java`/`McpInstructions.java`），没有真的起 MC + 发 `/numen token` + 连 DSH。**Bearer header 是否被 DSH MCP client 支持未验证。**
4. **Numen 的 `guide` 内容长度/人设是否完整**：源码说返回内置大脑系统提示，但没实际调用看输出。
5. **Numen 的 CurseForge 下载量**：来自第三方 `cfwidget`（19,028），非 CurseForge 官方 API。
6. **AIRI 的 MC 服务实跑**：只读 README + 源码 + 官方文档，没有 `pnpm dev`。
7. **mindcraft 的实际延迟/多人稳定性**：未实测；issue 里的"15 bugs long-term"未逐条复现。
8. **DSH 的 MCP client 是否只支持 stdio + streamable-http、是否支持自定义 header**：引用父 agent 说法，**没有在 DSH 源码里验证**（checkout 只有编译产物）。
9. **`DennisTraub/minecraft-mcp-server`**：仓库 404，无法核实父 agent 线索。
10. **`PrismarineJS/flayer`**：仓库 404，npm 0.1.1（2023-05），判断为已死，但未找到官方归档说明。
11. **GitHub issue 采样不完整**：core API 在 18:20 被限流，只对 9 个仓库各取了最近 20 条 issue（过滤 PR 后更少）；没有做全量 issue 统计/响应时间分析。**Numen 的 PR 总数、近 30 天精确 commit 数也没取到**（atom 只回最近 20 条，只能证明"至少 20 条/3 天"）。
12. **知乎/B站风评**：只看了搜索摘要（知乎"把 AI 放进 MC 服务器"、"我做了一个能看着你玩游戏的 AI 陪玩"、B站"开发自己的 AI 游戏搭子"），没有逐篇精读；Reddit 直接 403，未能抓取。
13. **部分 license**：`mineflayer-collectblock`/`tool`/`pvp` 等来自 npm `license` 字段（MIT 声明），未逐一核对仓库 LICENSE 文件。
14. **26.x 协议支持**：只看到 mineflayer 的 open issue，没有实测"用 26.x 服务端 + mineflayer 4.39"能否连上。
15. **N.E.K.O 的 MC 接入**：README 404，未验证。

---

## 附录 A：复现命令（star / commit / release）

```powershell
# 单仓 star + 最近 push（无 rate limit）
Invoke-RestMethod "https://ungh.cc/repos/PrismarineJS/mineflayer" | ConvertTo-Json -Depth 3

# 最近 commit（atom，无 rate limit）
[xml](Invoke-WebRequest "https://github.com/PrismarineJS/mineflayer/commits.atom").Content

# 最近 release（atom）
[xml](Invoke-WebRequest "https://github.com/cabaletta/baritone/releases.atom").Content

# GitHub 官方 API（60 次/小时，慎用）
Invoke-RestMethod "https://api.github.com/repos/Dwinovo/minecraft-numen" -Headers @{ "User-Agent"="dsh-research" }

# npm 下载量
Invoke-RestMethod "https://api.npmjs.org/downloads/point/last-month/mineflayer"

# CurseForge 下载量（第三方）
Invoke-RestMethod "https://api.cfwidget.com/1581109"
```

## 附录 B：本报告用到的关键外部证据

- cua-speedrun（GUI agent 速度基准，2–3 s/动作）：https://arxiv.org/html/2609.40284v1
- OSWorld-Human（CUA 效率，tens of minutes / 1.4–2.7× steps）：https://huggingface.co/papers/2506.16042
- HN "AI agent swarms in Minecraft"（425 分）：https://labs.ycombinator.com/projects/games/index.html
- HN "agent swarms fail to build civilization"（182 分）：https://www.tomshardware.com/tech-industry/artificial-intelligence/ai-agent-swarms-unleashed-in-minecraft-to-build-a-thriving-civilization-50-agent-teams-fail-after-falling-into-paralyzing-bureaucracy
- HN "Gemini agents beat Minecraft in 27 hours / $520"：https://www.tomshardware.com/tech-industry/artificial-intelligence/google-deepmind-claims-four-gemini-4-agents-beat-minecraft-in-27-hours-by-writing-2-783-programs-of-their-own-the-ai-team-died-605-times-on-easy-difficulty-and-ran-up-an-estimated-usd520-in-tokens
- AIRI MC 文档（中文）：https://airi.moeru.ai/docs/zh-Hans/docs/integrations/minecraft
- Numen CurseForge：https://www.curseforge.com/minecraft/mc-mods/numen
- mineflayer issue #3753（partial packet freeze）：https://github.com/PrismarineJS/mineflayer/issues/3753
- yuniko prompt injection issue：https://github.com/yuniko-software/minecraft-mcp-server/issues
