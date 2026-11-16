# 桌面 MC × AI 陪玩：全量调查计划

> 目标（用户原话复述）：做一个「在桌面玩 Minecraft，并且能让 AI 一起玩」的东西。
> 需要全量调查：(1) 桌面 MC 的开源项目；(2)「大肥鱼陪玩 MC」所用的 MC / mod。
> 关注：符合需求程度（轻量化、最好能用手机摄像头看到 / 手机↔电脑互联 / 或手机端跑 DeepSeek Harness —— 需决策）；仓库成熟度、stars、社区评价。
> 方法：先发散，不急于归并到单一思路。本次 token 预算不设限。

---

## 0. 先把"需求"拆成可判定的验收项

用户一句话需求里其实埋了 6 个独立的技术决策，调查必须分别回答，不能混为一谈：

| 编号 | 需求要素 | 可判定问题 | 归属调查线 |
|---|---|---|---|
| R1 | 桌面玩 MC | 是否要**原版客户端可视化**（人看得见、能自己上手玩）？还是**无头服务端 + Bot**即可？ | A |
| R2 | AI 一起玩 | "一起玩"= 同屏聊天 + 协作采集/建造？还是独立行动？需要语音吗？ | A/B |
| R3 | 轻量化 | 部署是否要 1 条命令？是否需要 GPU？是否需要改客户端（装 mod / 换启动器）？ | A/B |
| R4 | 手机摄像头看到 | "看到"= ①手机摄像头拍电脑屏幕（视觉回传，OCR/多模态）②手机作为第二屏/远程桌面 ③手机看 AI 的"第一人称"画面？三者代价差 10 倍，必须澄清 | C |
| R5 | 手机电脑互联 | 局域网/公网？延迟预算？是否要零配置？ | C |
| R6 | 手机端 DSH | 在 Android 上跑 Node/DSH（Termux）现实吗？还是"手机只做传感器 + 电脑跑 Agent"？ | C |

**结论性判断（初判，待子代理验证）**：R4 的三种解读里，"手机摄像头拍屏幕"是**最脆弱**的方案（二次成像、摩尔纹、对焦、帧率、OCR 全部退化），但**最符合"轻量化、零侵入"**的直觉；行业里的成熟做法是**屏幕采集（scrcpy/WebRTC/桌面捕获）+ 手机当显示器**。这条必须在 C 线用实测数据说话。

---

## 1. 候选方案空间（发散用，不是结论）

按"AI 以什么身份进入 MC"分四大家族，每族都有成熟度差异巨大的代表：

### 家族 Ⅰ：协议层 Bot（无客户端，走 MC 协议）
- **Mineflayer**（Node，PrismarineJS）：事实标准，协议级 bot，无渲染、无 GPU。
- **Mindcraft**（kolbytn）：Mineflayer + LLM 的"agent 框架"，是当前"AI 陪玩"最常被抄的骨架。
- **Voyager**（MineDojo）：LLM 自主 agent 的学术鼻祖（技能库 + 迭代提示）。
- **Baritone**：路径规划/自动挖矿的事实标准（Java，常被 mod 方案当"腿"）。
- 优点：极轻、可 headless、易接 LLM；缺点：**"看"不到画面**（除非另配渲染/视觉），动作粒度是"高级动作"而非像素级。

### 家族 Ⅱ：客户端 Mod / 服务端插件（真在游戏里，有皮肤有实体）
- Fabric/Forge mod 里塞 LLM 调用（如 **bff 大肥鱼AI聊天** 一类中文 mod）；服务端插件（Paper/Spigot）生成假玩家/NPC。
- 优点：**玩家视角就是"有个队友"**，零额外进程，最像"陪玩"；缺点：Java 侧接 LLM/ASR/TTS 工程量大、版本绑定强、常闭源。
- 变体：**假人插件**（Citizens/NPC + LLM 控制台）——重，但生态最成熟。

### 家族 Ⅲ：视觉-动作端到端（看画面、按键鼠）
- **VPT / MineRL / MineDojo / CraftGround / ROCKET-1**：学术线，需要 GPU、训练数据、且"陪玩"体验差。
- **通用 GUI Agent**（看屏幕 → 点鼠标）：对 MC 这类实时 3D 游戏几乎不可用（延迟 + 采样率），但**在"手机摄像头看屏幕"场景下是唯一能闭环的形态**——这条是 R4 方案③的技术底座。
- 优点：零侵入、不改游戏；缺点：慢、贵、脆。

### 家族 Ⅳ：数字人/陪伴层（MC 只是其中一个场景）
- **AIRI**（elefant-ai，原 moeru-ai）：LLM + Live2D + 实时语音，**已支持 Minecraft 游玩**，浏览器/桌面双端。
- 优点：语音陪伴体验最完整，社区热度高；缺点：MC 只是插件之一，深度玩法有限。

### 跨家族关键接口（调查必须点名的"接口清单"）
1. **MC 协议**：mineflayer / minecraft-protocol / gRPC over Fabric（`fabric-api` + 自定义 channel）。
2. **MCP**：`minecraft-mcp-server` 一类把 MC 动作暴露成 MCP tool 的项目 —— 直接决定能否**用 DSH 当大脑**。
3. **LLM 接口**：OpenAI-compatible / Anthropic / 本地 Ollama；多模态（截图 → 模型）与 function calling 的时延预算。
4. **语音**：ASR（Whisper/faster-whisper/云） + TTS（Edge-TTS/GPT-SoVITS）+ VAD，全链路 < 1.5s 才有"陪玩感"。
5. **视觉回传**：scrcpy / WebRTC / RTSP / DroidCam / IP Webcam / ADB screencap / DXGI Desktop Duplication。
6. **DSH 侧**：skill / plugin / MCP client / headless `dsh` CLI；手机端可行性（Termux、node 版本、内存）。
7. **MC 版本/加载器矩阵**：1.20.1 vs 1.21.x、Fabric vs NeoForge、Java 版本 —— 决定 mod 方案能否落地。

---

## 2. 调查分工（子代理）

### 子代理 A：桌面 MC 开源 AI 项目全量调查（家族 Ⅰ/Ⅲ/Ⅳ + 生态）
- 全量枚举：mineflayer 生态、Mindcraft、Voyager、Baritone、MineDojo/MineRL/VPT、CraftGround、ROCKET-1、Project Sid/Altera、AIRI、以及 GitHub topic `minecraft-ai` / `mineflayer` / `minecraft-bot` 下 star>100 的全部仓库。
- 每个项目必须给出：repo、stars、最近提交、license、语言、**是否 headless**、**是否需要 GPU**、**部署步数**、**是否能"和人一起玩"**、**社区评价（issue 活跃度、HN/Reddit/知乎/B站风评）**、**坑**。
- 产出：横向对比表 + "如果只选 3 个动手，选哪 3 个"。

### 子代理 B：「大肥鱼陪玩 MC」专题（用户点名的对象）
- 定位"大肥鱼"是谁/是什么产品（B 站/抖音/mcmod/爱发电/Discord），其 MC 陪玩用的是**哪个 mod、哪个 MC 版本、哪个加载器**。
- 找到 `bff 大肥鱼AI聊天`（mcmod class 32872）的**源码仓库是否存在**、闭源与否、其 LLM/TTS/ASR 后端、是否可复用。
- 横向找同类中文项目：ZerolanLiveRobot、以及"AI 假人陪玩"类服务端插件、豆包/智谱/ DeepSeek 接入 MC 的现成方案。
- 产出：**可复用性判定**（能不能直接拿来当底座 / 只能当参考 / 完全不能用）+ 版本与依赖清单。

### 子代理 C：手机↔电脑互联 + 视觉输入 + 手机端 DSH 可行性（R4/R5/R6 决策）
- 实测/查证三类"手机看到"方案的成本：摄像头拍屏幕（含 OCR/多模态可行性）、scrcpy/远程桌面、WebRTC 低延迟推流。
- 量化：延迟、分辨率、是否需要 root、局域网 vs 公网、Android/iOS 差异。
- 手机端跑 DSH：Termux + Node 版本、内存、能否常驻、与电脑端 DSH 的 MCP 连接方式。
- 产出：**决策矩阵**（3 方案 × 6 维度），明确推荐 + 反例。

### 子代理 D（第二轮，等 A/B/C 回来再派）：接口深挖 + 最小可行架构
- 把 A/B/C 的候选收敛成 2–3 个"周末能跑起来"的架构（含数据流图、接口定义、延迟预算、依赖清单）。

---

## 3. 发散纪律（给子代理的硬约束）

1. **禁止提前收敛**：先列全，再排序；每个判断必须有 URL 或可复现命令支撑。
2. **star 数要写采样日期**，仓库"成熟度"必须看 commit 频率 + issue 响应 + release 节奏，不能只看 star。
3. **明确区分"论文/演示视频"与"能跑的产品"**，很多高 star 项目 README 好看但装不上。
4. **中文生态单独看**：B 站/mcmod/知乎 的风评与 GitHub 常常不一致，两边都要。
5. 拿不准的写"未验证"，**不许编造 star 数或版本号**。

---

## 4. 交付物

- `report-a-desktop-mc.md`：桌面 MC 开源全景 + 对比表
- `report-b-dafeiyu.md`：大肥鱼专题 + 可复用性判定
- `report-c-mobile-link.md`：手机互联/视觉/手机 DSH 决策矩阵
- `report-d-architecture.md`：2–3 个落地方案 + 接口清单
- 最终汇总：`REPORT.md`（含"我们的建议"与待你拍板的决策点）
