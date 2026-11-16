# DSH 游戏类插件生态全景测绘（子报告 D）

**调查对象**：DeepSeek Harness（DSH）v0.2.1-rc.5 周围的「游戏 / Minecraft / 直播 / 视觉」插件生态
**采样时间**：2026-11-16 17:41–17:52（北京时间，UTC+8）
**采样手段**：GitHub REST API v3（`/search/repositories`、`/repos`、`/issues`、`/releases`）+ `codeload.github.com` 直下仓库 zip 做源码级核查 + `registry.npmjs.org` 查发布状态 + 本机已装 DSH 的官方文档
**限流说明**：未认证 GitHub API 为 60 次/小时，过程中触发一次 403（core remaining=0），已改用 codeload 直下源码补课；star / 日期均为上述时间窗内的快照，凡未取到者明确标注「未取到」。

---

## 1. 执行摘要

### 1.1 直接回答：我们是不是在重复造轮子？

**是，但只重复了大约 60%。剩下 40% 是真空的，而且真空的位置恰好是「陪玩」这个词的核心。**

拆开说：

| 我们设想的能力 | 生态现状 | 判定 |
|---|---|---|
| 让 AI 有一具 MC 里的身体（能走、挖、合成、打怪、建造） | 至少 **12 个**独立实现；3 个工程化很深（`blueziii/dsh-mc-agent` src 3.7 万行 / 41 个工具；`jcs130/dsh-minecraft-agent` src 1.7 万行 / 10 个 npm 版本 / 38 个 MCP 工具；`yzi1b/whale-craft` 已上 npm、有 MC/MC+ 双 preset、watchdog、长期记忆） | ✅ **重复造轮子**，直接用 |
| 让 AI「看见」自己的处境 | 协议派（mineflayer 结构化状态）已解决；渲染派（`mc-camera` 无头第一人称 → JPEG）也已解决 | ✅ 重复 |
| 让 AI 看见**玩家屏幕上**的画面 | 生态里 10+ 个截屏插件，**全部**是 `PrintWindow` / `BitBlt` / UIA / OCR 路线；**没有任何一个**用 Windows Graphics Capture / DXGI Desktop Duplication。而 `PrintWindow` 对 OpenGL/LWJGL 的 MC 客户端窗口是出了名的不可靠（黑帧） | ❌ **真空**（且是被生态自己的技术选型留下的真空） |
| 直播 + 弹幕 + 双语音 + OBS 自动化 | `luckui/dsh-livestream`(77★) 一系已长成一棵树：`y3519712124-ui`(13★) 做了抖音+双 TTS、`newbeejmc/Dsh_douyin`(54★)、`air158`、`lawrencezy` 的本地 TTS 补丁、`XiaoZheBrother/dsh-live-studio`、`liuzhengming/dsh-pet-douyin-live` 等 | ✅ 重复，但可裁剪复用 |
| **AI 作为第二个玩家，进入「玩家自己那个桌面客户端」的世界一起玩** | `Azetus/dsh-minecraft-p2`(1★) 描述「brings a second player into your Minecraft Java Edition world」；`xizhilang2012/dsh-mc-companion`(0★)、`banbixieyang/dsh-mc-companion`(0★)、`Red0tsnow/dsh-companion`(3★)、`qimidandapigu/dsh-xiaotangyuan-game`(11★) 同方向 —— **全是 0–3★ 的周末项目，没有一个工程化到能用** | ❌ **半真空：方向被认领了，产品没做出来** |
| **陪伴发生在游戏里（overlay / HUD / 语音在场），而不是在 DSH 侧边栏里** | 生态里所有游戏插件的 UI 都长在 DSH 侧边栏／设置页。唯一的例外是 `xiaozhaoz1/dshpet-mc`(1★) 的纯客户端桌宠 mod 和 `yan-mc/minecraft-mod-dev` 的 Forge 探针（mod-dev 用途） | ❌ **真空** |

### 1.2 一句话结论

> **「AI 能玩 MC」这件事已经被社区解决了三遍，且解决得很好；「AI 陪你在你自己电脑上玩 MC、并且看得见你的屏幕、还能在游戏里出声」这件事，全生态只有 0–3★ 的意向性仓库。我们应该复用身体层、复用直播层、自己只做「玩家侧感知 + 游戏内陪伴呈现」这两块。**

### 1.3 三个决策问题的短答

- **Q1（能直接复用）**：见 §5，7 组可复用件，其中 3 组是「拿来即用」，2 组是「拿来改」，2 组是「拿来抄范式」。
- **Q2（有人做了吗）**：有 6 个同方向仓库，但**没有一个**同时满足「桌面客户端 / 看玩家画面 / 游戏内呈现」三点；最接近的是 `Azetus/dsh-minecraft-p2`（1★，方案未验证）与 `jcs130/dsh-minecraft-agent`（身体最成熟，但它是「AI 自己玩」不是「陪玩家玩」）。
- **Q3（成熟度）**：**两极分化极严重**。739 个 DSH 相关仓库里，**618 个（83.7%）star < 10**；游戏/MC 垂直里 **只有 3 个**算工程级（blueziii、jcs130、whale-craft），**只有 1 个**上了 npm 且有 10+ 版本（jcs130）。绝大多数是「一个周末 + README 吹得比代码多」。

---

## 2. 生态全景表

### 2.1 总量与分布（采样：2026-11-16 17:41–17:52）

用 20 个关键词查 GitHub，按「仓库名含 dsh/deepseek/harness」筛后去重：

| 指标 | 数值 |
|---|---|
| 去重后 DSH 相关仓库（14 个查询覆盖） | **739** |
| 其中游戏 / MC / 直播 / 视觉 / 桌面控制相关 | 约 **598** |
| 其中真·Minecraft 相关（剔除 dsh-mcp* 噪声） | **73** |
| 其中直播 / 弹幕 相关 | **59** |

**star 分布（反映成熟度的最关键一张表）**：

| star 区间 | 仓库数 | 占比 |
|---|---|---|
| 500+ | 11 | 1.5% |
| 100–499 | 9 | 1.2% |
| 50–99 | 14 | 1.9% |
| 10–49 | 87 | 11.8% |
| 1–9 | 446 | 60.3% |
| 0 | 172 | 23.3% |

> **83.7% 的仓库 star < 10。** 这不是一个「产业」，这是一个**刚过爆发点的 hobby 生态**：数量极多、迭代极快、质量方差极大。

查询总量参考（GitHub 返回的 `total_count`，含大量同名噪声如 `2DShooter`）：
`dsh game`=678、`dsh-game`=426、`dsh minecraft`=121、`dsh 我的世界`=8、`deepseek harness 游戏`=100、`dsh 插件 游戏`=85、`dsh 直播`=39、`dsh livestream`=8、`dsh godot`=67、`dsh unity`=209、`dsh ocr`=329、`dsh game engine`=17、`dsh vision`=696、`dsh computer use`=219、`dsh desktop control`=152。
注：`dsh 游戏感知` 一次查询被限流（403），未取到；该主题改由 §3 源码级调查覆盖。

### 2.2 表 A：游戏主干插件（按 star 排序，只列有实质内容的）

| 仓库 | ★ | 创建 | 最近推送 | 语言 | 许可 | 一句话定位 | 活跃度 | README vs 代码 |
|---|---|---|---|---|---|---|---|---|
| `flizzywine/dsh-tavern` | 1627 | 08-16 | 11-16 | JS | AGPL-3.0 | 类 SillyTavern 的文字游戏 Agent，兼容人物卡 | 极活跃（npm 61 版） | 名实相符，npm 已发布 |
| `ZSeven-W/dsh-game-studio` | 566 | 11-05 | 11-09 | TS | MIT | 一句话→侧边栏可玩小游戏→AI 美术→一键发布 Pages/CF | 中（4 天） | 未见 npm；11 天无推送 |
| `universe-st/dsh-game-material-master` | 175 | 09-19 | 10-29 | JS | MIT | 游戏素材大师：seedream 生图 + minimax 视频 | 中 | npm 已发布（18 版） |
| `NorthGateChat/dsh-think-game` | 100 | 11-08 | 11-08 | JS | MIT | 流式思考区下方嵌 7 款小游戏 | 单日爆发 | 未见 npm |
| `luckui/dsh-livestream` | 77 | 10-21 | 10-28 | TS | NOASSERTION | agent 在 B 站当主播（默认角色大肥鱼） | 已停更（19 天） | 不在 npm；源码真做了（5.4 万 KB） |
| `akira399/dsh-godot-skill` | 69 | 08-13 | 08-28 | JS | MIT | Godot 4 全栈开发 skill 插件 | 已停更 | 单 skill 注册 |
| `yzi1b/whale-craft` | 60 | 09-16 | **11-16** | JS | MIT | 无头 mineflayer 机器人在 DSH 进程内玩 MC | **极活跃**（今天还在推） | **npm `whale_craft` 已发**，功能与代码相符 |
| `Smalldy/godot-bridge` | 58 | 08-14 | 11-11 | GDScript | MIT | DSH 原生工具驱动运行中的 Godot 游戏（TCP 交互服） | 活跃 | 真做了，含回归基线实测数据 |
| `gychen-NJU/dsh-game-daily` | 56 | 10-23 | 11-15 | JS | MIT | 原神/崩3/星铁/绝区零日常代理，排班+计划任务 | **活跃**（npm 12 版） | 名实相符，架构完整 |
| `newbeejmc/Dsh_douyin` | 54 | 10-30 | 11-06 | JS | 未声明 | 大肥鱼抖音直播 | 中 | 未见 npm |
| `yuanstarstar/dsh-game-stack` | 46 | 10-29 | 11-01 | JS | MIT | 5 个 bundle：感知/视觉实体/游戏学习/直播桥/启动器 | **低**（3 个 commit、全部是 release 提交） | **代码量大但仓库是「一次性导出」**，详见 §3 |
| `yan-mc/minecraft-mod-dev` | 35 | 10-17 | 10-18 | Java | MIT | DSH + MC 1.20.1 Forge 探针：写模组→起真实端→点 UI→截图→跑 GameTest | 中（有 Release） | 名实相符，硬核 |
| `blueziii/dsh-mc-agent` | 35 | 10-08 | 11-05 | JS | MIT | 41 个 `mc_*` 工具，AI 有身体真玩 MC | **高**（v0.6.78，踩坑档案 151 条） | **README 严重低估代码**（src 3.7 万行） |
| `HYClub/deepseek-harness-game-studios` | 26 | 10-11 | 11-10 | JS | MIT | CCGS 的 DSH 移植：83 skills / 49 agents | 活跃 | 配置型，非运行时代码 |
| `Darianliu23/dsh-stardew-blind-whale-farmer` | 23 | — | — | JS | — | 星露谷自动化 | 未细查 | 未深挖 |
| `gosomea/dsh-godot-ai` | 22 | 08-25 | 10-07 | TS | MIT | AI 辅助 Godot 做游戏 | 已停更 | — |
| `TFboy1/dsh-minecraft-ui` | 21 | 08-18 | 08-21 | JS | MIT | MC 风格 UI | 已停更 | 纯皮肤 |
| `thyeff/dsh-unity-mcp` | 21 | 08-28 | 11-11 | JS | MIT | 一键接 mcp-unity，34 个工具操控 Unity 编辑器 | 活跃 | — |
| `luckui/dsh-game` | 14 | 10-18 | 10-26 | TS | NOASSERTION | AI 自己玩：狼人杀 / 心跳文学部 / **Minecraft** | 已停更 | 真做了，MC 线身体 mineflayer 子进程 + 真客户端摄像机 |
| `y3519712124-ui/dsh-livestreamingcompanion` | 13 | 10-30 | 10-30 | TS | NOASSERTION | 直播 + **MC 游戏线** + 双语音 + OBS | **单日提交后停更** | 见 §4 |
| `TindalosKorone/dsh-cheatengine` | 15 | 08-16 | 08-25 | TS | MIT | DSH ↔ Cheat Engine 内存扫描/指针/断点 | 已停更 | — |
| `qimidandapigu/dsh-xiaotangyuan-game` | 11 | 08-14 | 08-26 | TS | MIT | **单机游戏内 AI 同伴「小汤圆」** | 已停更 | 与「陪玩」最同题，但无后续 |
| `mlkgrnt/dsh-junimo` | 9 | 10-24 | 11-04 | JS | MIT | 星露谷：把 Junimo-MCP 的 37 个工具桥进来 | 中 | — |
| `jcs130/dsh-minecraft-agent` | 4 | 08-15 | **11-15** | JS | MIT | MC Agent：实时观战 + 原生推理 + 人格 + 自主 | **极高**（100 commits、10 Releases、npm rc.26） | **README 远低于实际体量**（src 1.7 万行 / 61 文件） |
| `air158/dsh-livestream` | 1 | 11-08 | 11-08 | TS | NOASSERTION | 第三方再上传的 dsh-livestream（非 GitHub fork） | 单日 | 同源代码 |
| `lawrencezy/dsh-livestream-local-tts` | 0 | 11-15 | 11-15 | — | NOASSERTION | dsh-livestream 的本机 Qwen3-TTS 补丁+验证记录 | 单日 | 补丁/教程 |

### 2.3 表 B：Minecraft 垂直的 73 个仓库，按「做了什么」分层

**B1 · 真·身体（协议机器人，mineflayer / MCP）** —— 12 个，可直接用

| 仓库 | ★ | 机制 | 备注 |
|---|---|---|---|
| `blueziii/dsh-mc-agent` | 35 | mineflayer + 6 个扩展插件 | 41 工具，src 3.7 万行，v0.6.78，**npm 未发布**（`pnpm add github:` 装） |
| `yzi1b/whale-craft` | 60 | mineflayer 跑在 DSH 进程内 | npm `whale_craft` 0.2.0-beta.3，MC/MC+ 双 preset + watchdog |
| `jcs130/dsh-minecraft-agent` | 4 | 依赖独立 SDK `agent-mc-world`（含 mineflayer） | npm `@jcs130/dsh-minecraft-agent` 0.3.0-rc.26，10 版 |
| `luckui/dsh-game` | 14 | mineflayer 打成独立子进程 | 配真 MC 客户端摄像机 + RCON |
| `HITEML/dsh-minecraft-agent` | 1 | 自研 MCP Server + mineflayer，23 工具 | 含「哥特大教堂建造工程」 |
| `Ruqii/dsh-minecraft` | 1 | Mineflayer bot 暴露为 agent 工具 | 最小实现 |
| `banbixieyang/dsh-mc-companion` | 0 | 无头 mineflayer，follow/chat/任务/记忆/主动性 | **「companion」定位** |
| `xizhilang2012/dsh-mc-companion` | 0 | AI 伙伴有自己的背包与合成台，会自己砍树下矿 | **「companion」定位** |
| `Azetus/dsh-minecraft-p2` | 1 | 第二个玩家进入你的 Java 世界，游戏内聊天下指令 | **最贴「陪玩」** |
| `FPS1024/dsh-minemate` | 0 | 「a real Minecraft player body」 | 意向性 |
| `TyrantQAQ/dsh-mc-player` | 0 | 让 DSH 玩 MC 1.26.2 Java | 版本跟进型 |
| `hellosky982` / `sgnihttcejbo` `dsh-mc-agent` | 0 | 含内置启动器（微软登录/版本下载/启动） | 同名两份，疑复制 |

**B2 · 桥 / 客户端控制（不自己造身体，去驱动真客户端）** —— 6 个

| 仓库 | ★ | 机制 |
|---|---|---|
| `yan-mc/minecraft-mod-dev` | 35 | Forge 1.20.1 探针 mod：服务端状态/命令/NBT、客户端 UI 控件树/点击/截图、GameTest |
| `xiaozhaoz1/dsh-mc-bridge` | 2 | 把 MC 状态/事件/工具接进 DSH，「纯后端、零渲染、默认只读」 |
| `i-am-cie/dsh-netease-mc` | 1 | 网易版 MC：MCP 观察+控制（1.21.8 / NeoForge） |
| `DRheEheAMGary/dsh-mc-client` | 1 | **可见 PCL2 客户端控制** + 无窗口协议机器人 + F3 信息与方块探针 |
| `joey-up/deepseek-harness-x-Minecraft` | 0 | 模拟人的鼠标移动 + 按键映射，「搭配 dsh-minecraft 模组实现 AI 控制」 |
| `lernicks0/dsh-tacz-duel` | 0 | Forge 客户端桥（TACZ 枪械） |

**B3 · 世界呈现 / 皮肤 / 主题（不玩，只像 MC）** —— 约 20 个，与陪玩无关
`TFboy1/dsh-minecraft-ui`(21)、`OBdangshang07/dsh-craft-ui`(10)、`SuperLS-X/dsh-minecraft-theme`(5)、`10086ggqq/dsh_theme_Minecraft`(3)、`EDMOK`、`JYT-copy`、`zebbkira`、`lyingice`、`DongDong1997/dsh-mcskin`(1)、`lovejavacore/dsh-minecraft-pet`(1)、`blackstar-baba/dsh-bird-bike` 等。

**B4 · 模组/资源开发工具链** —— 约 15 个
`Leawind/dsh-minecraft-dev`(5)、`ZJTM-Studio/dshgo-CNminecraft-add-on-Development`(3)、`TianYa-DAO/dsh-blockbench-atelier`(3)、`cyy13045/dsh-tool-modpack`(1)、`Javelle1025/dsh-mcmod-configurator`(1)、`QXingYShu/dsh-mcskin-*`、`GMH13552/dsh-mc-art`、`MSSZSD3925/dsh-tool-mcsrc`、`APTADTllent/dsh-Minecraft-Mod-Generator`、`Junnaturefox/dsh-mc-translate` 等。

**B5 · 运营/周边（RCON、服务器托管、红石音乐、启动器）** —— 约 12 个
`CaveNightingale/dsh-rcon`、`mogutofu/dsh-mc-server-ops`、`Tyon-nos-Ty90/dsh-mcsm-panel`、`end876/dsh-mcl`、`hikariming/dsh-launcher`、`yuanstarstar/dsh-launcher-minecraft`(1)、`19north/dsh-redstone-music`、`Stone-Sprite/dshmusic`、`xiaozhaoz1/dshpet-mc`(1，纯客户端桌宠 mod)、`Fictional-Historians/dsh-villager-widget` 等。

### 2.4 表 C：「眼睛和手」—— 视觉 / computer-use 层（已商品化）

这一层 star 最高、竞争最激烈，对我们是**基础设施而非竞品**：

| 仓库 | ★ | 能力 |
|---|---|---|
| `helloHub1212/dsh-windows-mcp` | 1403 | Windows 桌面自动化，MCP 桥接 CursorTouch/Windows-MCP，含 Computer Use 开关 |
| `ysr666/dsh-vision-router` | 1280 | 纯文本模型的「眼睛」：内置免费视觉链 + 像素级工具（QA/grounding/crop/diff/OCR/SVG trace），npm 63 版 |
| `Anionex/dsh-vision-toolkit` | 946 | 视觉工具箱：图问答、长截图 OCR、UI 还原、grounding、pixel diff |
| `Yu-tao-Li/dsh-computer-use-win` | 752 | Windows computer-use |
| `SAOS-3624/dsh-see-now` | 665 | 看屏幕 |
| `Anionex/dsh-computer-use` | 104 | computer-use |
| `Mrkennyhungry/dsh-cua` | 21 | UIA + 本地 OCR + 窗口绑定 + 浏览器自动化 + 视觉 ground |
| `TindalosKorone/dsh-cheatengine` | 15 | 游戏内存级读写（Cheat Engine） |
| `OrderG-X/dsh-mac-computer-use` | 11 | 视觉优先的 macOS 桌面操作 |
| `EXarchive/dsh-screen-attention` | 5 | 实时画面识别 + AI 可读数据流 + 鼠标键盘（Node + .NET 9） |
| `gezi-wen/dsh-guikit` | 2 | 屏幕布局/带标注截图/点击/输入/窗口管理/UIA 结构化查询，零依赖 |

**技术选型扫描结论**：我把 598 条游戏/视觉/桌面控制描述与数十个 README 过了一遍，**没有一条**提到 DXGI、Desktop Duplication、Windows Graphics Capture 或 WGC；清一色是 `PrintWindow` / `BitBlt` / CDP 截图 / UIA / OCR / SendInput。
→ 这是生态的**结构性技术债**，也是我们的机会点（见 §7）。

### 2.5 表 D：游戏引擎桥

| 仓库 | ★ | 机制 | 可借鉴点 |
|---|---|---|---|
| `Smalldy/godot-bridge` | 58 | 游戏内 `McpInteractionServer` autoload 监听 `127.0.0.1:9090`，新行分隔 JSON；DSH 侧原生说同一协议，**不走 MCP、不要 Python、不要编辑器插件** | **「游戏内 server + 宿主内原生 client」范式**，直接可搬到 MC mod |
| `gosomea/dsh-godot-ai` | 22 | Godot 场景/脚本/运行/验证 | — |
| `thyeff/dsh-unity-mcp` | 21 | 一键接 mcp-unity（34 工具） | — |
| `Kide-Lee/dsh-locus-bridge` | 45 | Unity 原生 broker 的命名管道/Unix socket 客户端 | IPC 范式 |
| `PeterTXPan/dsh-unreal-mcp` | 18 | UE 5.8 via Unreal MCP | — |
| `142gg-GZX/unity-dsh-bridge` | 2 | 本地 HTTP 桥控 Unity/团结编辑器 | — |
| `glitchless-gg/glitchless-dsh` | 0 | 游戏可观测性 over MCP（Unity/Godot/Unreal/Three.js） | — |
| `elfgzp/dsh-godot-live` | 0 | 原生渲染以 MJPEG 流进 DSH 面板 + 输入注入 | **画面进面板的范式** |
| `davidmercer0620-ai/dsh-game-preview` | 1 | 在 DSH 侧边栏玩 Cocos/Godot/Unity，画面捕获 + 输入转发 + 截图给 agent | 同上 |

### 2.6 表 E：直播家族（`dsh-livestream` 衍生树）

```
luckui/dsh-livestream (77★, 10-21)  ──┬─→ y3519712124-ui/dsh-livestreamingcompanion (13★, 抖音+双TTS+MC线)
luckui/dsh-game      (14★, 10-18)  ──┘        └─→ [同源，非 GitHub fork，README 明示基于上游]
                                     ├─→ air158/dsh-livestream (1★, 再上传，非 fork)
                                     ├─→ lawrencezy/dsh-livestream-local-tts (0★, Qwen3-TTS 补丁)
                                     ├─→ newbeejmc/Dsh_douyin (54★, 抖音)
                                     ├─→ chortle9/dsh-live (0★)、1997liuyh-boop/dsh-studio-live (0★)
                                     └─→ 风格衍生：XiaoZheBrother/dsh-live-studio (3★, Live2D舞台)、
                                         szhadmin/dsh-live-pet (4★)、liuzhengming/dsh-pet-douyin-live (3★)
```
另有非衍生但同域：`kirako1/dsh-bili-live`(6★，**看**直播而非当主播)、`rentaoyan0628-collab/dsh-bili-danmaku-lite`(5★)、`1a125/dsh-bili-chat-whale`(2★，agent 自己找冷清直播间陪聊)、`fore-vip/dsh-live`(3★，多平台 RTMP 推流)。

---

## 3. `yuanstarstar/dsh-game-stack` 深挖

### 3.1 仓库真实形态（先看这个，再看功能）

| 项 | 值 | 说明 |
|---|---|---|
| stars / forks | 46 / 4 | 采样 2026-11-16 |
| 创建 / 最近推送 | 2026-10-29 / 2026-11-01 | 存活 3 天 |
| **commits** | **3 个** | `init empty repo` + 两次 `chore: 发布…` 提交 |
| Releases | 2（v2026.10.29、v2026.11.01） | 每次提交 = 一次整包发布 |
| npm | **未发布**（404） | 只能按目录 `install_bundle` |
| 体积 / 文件数 | 1.01 MB zip / 145 个文件 | README 自称「约 2.0 MB / 145 个文件」 |
| Open issues | 1 | #1「移除指向仓库内不存在路径的 dsh-game-coach-v6 链接」 |

**判断**：这不是一个「开发中的仓库」，而是**某台机器上工作区的整包导出**。3 个 commit 里没有一行是增量开发。`README.md` 引用的《`docs/DSH通用打游戏-插件经验报告.md`》**在仓库里不存在**（没有 `docs/` 目录），`dsh-game-coach-v6` 也不公开（issue #1 已确认仓库树中无此路径）。

**但代码是真的**：js/py 合计约 2 万行，最大的 `coachd.py` 2932 行、`rules.js` 1594 行、`client.js` 2881 行、`guard.js` 993 行。所以准确说法是：**代码是真的，工程过程是假的**（无历史、无 issue 响应、无 CI、无 npm）。

### 3.2 五个 bundle 的实际分工

| 目录 | 包名 / 版本 | 负责什么 | 运行时依赖 | 真实文件量 |
|---|---|---|---|---|
| `01-coach-perceive` | `@local/dsh-coach-perceive-v3` 0.2.0 | **眼睛和手**：抓帧、OCR、点击、按键、驱动推剧情、OBS 锚定 | **Python 3.10+ / numpy / Pillow**（侧车进程） | 17 文件，`coachd.py` 144 KB |
| `02-game-learn` | `@local/dsh-game-learn-v2` 0.2.1 | 规则引擎 + 流程状态机 + 四道闸门 + 知识库（三合一） | 纯 JS 零依赖 | 9 文件，`rules.js` 78 KB |
| `03-cv-recall` | `@local/dsh-cv-recall` 0.1.0 | **感知编译器**：把画面编译成实体包，之后零视觉 token 读盘面 | **Python / numpy / Pillow** | 26 文件（含 380 KB `ocr_digits.npz`） |
| `04-live-bridge` | `@local/dsh-live-bridge` 0.1.0 | 读 B 站弹幕 + 语音说话 | 需扫码登录 / TTS key | 49 文件（含 vendor 的 qrcode） |
| `05-launcher` | `@local/dsh-launcher` 3.3.2 | 装游戏、管实例、查版本（本体不含任何具体游戏） | 纯 JS | 45 文件，`client.js` 2881 行 |

### 3.3 「游戏感知」到底怎么实现的 —— 源码级答案

**不是 DXGI，不是多模态模型，不是游戏内 API。是 `PrintWindow` + WinRT OCR + SendInput。**

`01-coach-perceive/bundle/sidecar/win_capture.py`（240 行，完整读毕）的核心：

```python
PW_CLIENTONLY        = 0x00000001
PW_RENDERFULLCONTENT = 0x00000002
...
user32.PrintWindow(hwnd, hdc_mem, flags)     # 让窗口自己把画面画到我们的位图上
```

文件头注释把动机写得很清楚：

> 背景：gdigrab 抓的是屏幕，DSH 一挡在游戏前面，抓到的就是 DSH。
> `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` 让窗口自己把画面画到我们的位图上，
> **即使被别的窗口盖住也能拿到内容**；顺带只抓客户区，没有标题栏。

配套细节（都是踩过坑的痕迹）：
- `SetProcessDpiAwareness(2)`（per-monitor v2）—— 否则 1302 的客户区会变成 868，抓出来是糊的；
- 先试 `PW_CLIENTONLY|PW_RENDERFULLCONTENT`，失败退回整窗 + 裁客户区（「有些游戏 PrintWindow 只对整窗有效」）；
- `_is_blank()` 用 `img.std() < 1.5` 判黑帧；
- `who_covers()` 用 `WindowFromPoint` + `GetAncestor(GA_ROOT)` 判**遮挡**（键盘/鼠标动作前的前置守卫）。

**OCR** = `Windows.Media.Ocr`，通过**常驻 PowerShell 进程**桥接（`coachd.py:52,63,72`；`pcv/text.py:26,37,45`）：

> 常驻 PowerShell OCR 进程：每调一次都要付 ~800ms 的 PS 启动 + WinRT 初始化

已知它自己的短板（README 变更记录坦承）：WinRT 对孤立单字几乎不出结果（「是/否/敌/1」全空），要 `ocr_rescue()` 补边距放大 + 横向拼三份投票，结果带 `weak=true`。

**输入** = `win_input.py`（13 KB）纯 ctypes `SendInput`；`cv_act` 的键位有白名单（space/esc/enter/方向/字母数字/F1–F12/组合键），不是「想按什么就按什么」。

**OBS** = `obsclient.py`（8.5 KB）+ WebSocket，**只用于锚定窗口**（`coach_anchor{action:"obs"}`），不用于抓帧。

### 3.4 「视觉实体」是什么概念

这是整个 stack 里唯一有原创性的设计，`03-cv-recall/bundle/README.md`（448 行，完整读毕）把它叫**感知编译器**。核心命题一句话：

> 模型识图 1.5~3k token、1~10 秒；而游戏界面里的血条、小地图、技能图标，**位置固定、外观固定**，真正在变的只有数字和内容 —— 那就别反复问模型，**让它看一次、把「认什么、在哪」编译成资产，之后每帧用纯 numpy 认**。

| | 现在 | 编译后 |
|---|---|---|
| 每次看盘面 | 1.5~3k token / 1~10s | **0 token** / 50~80ms（11 实体，1280×720） |
| 输出 | 自由文本（要解析） | 结构化 JSON（`scene`/`entities`/`changed`/`stale`） |
| 画面变了 | 看不出来 | 自报 `stale: true` |

**编译流程**（`cv_learn`）：
1. `scan`：截一帧，本地**免费**提议候选框（颜色连通域 + 边缘连通域 + NMS），只给编号；
2. `build`：**模型只给坐标和名字**，颜色直方图 / 梯度方向 / 结构哈希 / 分块相关全部由本地代码从框内像素自己算（「模型描述外观既费 token 又不准，本地算一遍只要几百微秒」）；
3. `add_scene`：再加一个场景，顺手校准「谁在谁不在」的阈值，**不用重新标框**；
4. 产物 = `.cvpack.json`（PNG 模板以 base64 内嵌）。

**识别流程**（`cv_recall`，纯 numpy，`pcv/feats.py` 548 行）：
1. **两路归一化互相关**：灰度路（整体明暗）+ 边缘路（边框/刻度线），分开投票不取平均（血条掉血会毁灰度路但边缘路只掉 0.10）；
2. **3×3 分块多数票**（`ncc_t`）：只看最好的 1/3 块，抵消「面板换掉一半内容整块 NCC 掉到 0.38」；
3. **场景 = 实体存在向量 + 全局直方图**，离太远报 `unknown` 不硬猜；
4. **字形**：`digits:{box, value}` 一次学字形 → **包级字形图集**（`pcv/digits.py`）+ 内置 **380 KB 纯 numpy MLP**（`ocrlib.py`，768-128-36，系统 84 种字体 + 七段块字训练）兜底；实测留出 30 种没见过的字体：数字 86.5%、七段块字 99.3%、全 36 类 76.1%；
5. **派生量**：`derived:[{id:"hp", from:["heart_1","heart_2","heart_3"], agg:"count"}]` —— 血量 = 在场红心数，缺一颗自动变 2。

**实测数据**（README 自报，我核对了对应 `tools/` 测试脚本确实存在）：
- 《以撒的结合》2559×1599 真实截图，7 实体 × 4 张 = 28 次判定命中 26（92.9%），去掉容器类 `minimap` 是 24/24；场景判定 4/4；
- 遮挡 20 种盖法认出 17 个，其中 16 个框位置与真值完全一致；「盖到七成以上就不猜了」；
- 延迟 11 实体 1280×720 ≈ 50–85ms，2.5K 7 实体 150–194ms。

作者自己写的「诚实的限制」值得抄进我们的风险表：

> - **只做判别 + 读字形，不做理解**
> - **换主题 / 改分辨率 / 改 UI 缩放 ≈ 资产报废**
> - **独占全屏 / 反作弊顾问可能报错**：拓展超出了 PrintWindow 能拿到的东西，这类窗口的帧会是黑的
> - **提权窗口点不了**（UIPI）
> - 字体不能混；容器类控件内部整块替换会漏

### 3.5 它支持哪些游戏？有没有 Minecraft？

**没有 Minecraft。**

我在整仓 145 个文件里 grep 了 20 个游戏名：

| 关键词 | 命中数 |
|---|---|
| `Minecraft` | 33 |
| `我的世界` | 11 |
| `以撒` | 16 |
| `mineflayer` | **0** |
| 原神 / 崩坏 / 星穹 / 王者 / 永劫 / 泰拉瑞亚 / 幻兽帕鲁 | **0** |

而那 33 + 11 次 MC 命中，**全部**出现在 `05-launcher` 的文档里（`cordis.patch.yml` 的 `catalogUrl` 指向 `dsh-launcher-minecraft`、`ARCHITECTURE.md` / `GITHUB-UPLOAD.md` 讲「附属启动器」怎么发 Release）。也就是说：

> **`dsh-game-stack` 对 Minecraft 的全部支持 = 一个「能装 MC、能启动 MC」的启动器附属包。它的感知/视觉实体/游戏学习三条腿，与 Minecraft 零关系。**

它实际验证过的游戏是 **《以撒的结合》**（像素 2D、固定 HUD、单窗口、无 3D 世界）+ 一个 WoW 的举例（`cv_learn{packId:"wow"...}`）。`02-game-learn` 的知识库把游戏分四类 `turn / paused / rt2d / rt3d`，但 `rt3d` 只是分类标签，没有任何 3D 实际验证。

### 3.6 能不能直接拿来当我们的「眼睛」？

**分三块回答：**

| 用途 | 能不能用 | 原因 |
|---|---|---|
| 读 MC 的**固定 HUD**（血量、饥饿、快捷栏、经验、坐标） | ⚠️ **理论可以，需实测** | HUD 是固定位置固定外观，正是模板匹配的目标形态；但分辨率写死、换 UI 缩放即报废 |
| 读 MC 的**3D 世界**（面前是什么、地形、怪在哪） | ❌ **不行** | 模板匹配的前提是「位置固定、外观固定」。3D 世界每帧每像素都在变，整块 NCC 会掉到 0.05（它自己在 minimap 内部换图时就是这个数），`novel:true` 只能报「这儿多了块黄东西 80×72」 |
| 抓**桌面 MC 客户端**的帧 | ❌ **高风险，很可能直接黑帧** | MC Java 是 GLFW/OpenGL 窗口。`PrintWindow` + `PW_RENDERFULLCONTENT` 对硬件加速的 OpenGL 表面经常返回黑帧（仓库自己承认「独占全屏……帧会是黑的」）。窗口化模式是否可抓，**必须实测**，不能假设 |

**结论**：`cv-recall` 的**思路**（编译成资产、0 token/帧、结构化输出）非常值得我们抄；它的**代码**只能当「HUD 读数模块」的候选，且必须先过 MC 窗口抓帧这一关。当「眼睛看世界」用它，方向就是错的。

### 3.7 维护活跃度与 README-vs-代码总评

| 维度 | 评分 | 依据 |
|---|---|---|
| 代码体量 | ★★★★ | 约 2 万行，含 30 个 Python 文件、69 个 JS、12 个 .mjs、5 个测试脚本 |
| 工程质量 | ★★★☆ | 有 selftest/smoke/real_test/occl_test/text_test/act_test 等 10+ 个验收脚本，有 SHA256SUMS，有 DryRun 安装脚本，有「某条腿装配失败只丢它自己」的兜底 |
| 仓库工程过程 | ★ | 3 个 commit、0 历史、无 CI、无 npm、1 个 open issue 是文档死链、README 引用的报告不在仓库里 |
| 文档诚实度 | ★★★★ | 「诚实的限制」「已知边界」写得比大多数项目都好，主动承认「模型识图贵」「换分辨率即报废」「独占全屏会黑」 |
| **可维护性** | ★★ | 无 Git 历史 = 你无法知道任何一行为什么这么写；升级要靠作者再导一次包 |

---

## 4. `y3519712124-ui/dsh-livestreamingcompanion` 深挖

### 4.1 血缘：谁抄谁

**不是 GitHub fork，但代码同源，且作者主动署名。**

我查了 API 的 `fork` 字段：

| 仓库 | `fork` | `parent` | 结论 |
|---|---|---|---|
| `y3519712124-ui/dsh-livestreamingcompanion` | **false** | — | 非 fork |
| `air158/dsh-livestream` | **false** | — | 非 fork（第三方**再上传**，34.8 MB，描述与 luckui 一字不差） |
| `luckui/dsh-livestream` | false | — | 原创（77★ / 23 fork） |
| `luckui/dsh-game` | false | — | 原创（14★） |

而 `dsh-livestreamingcompanion/README.md` 的「相对上游的改动」章节**明写**：

> 本仓库基于 [luckui/dsh-livestream](https://github.com/luckui/dsh-livestream) 与 [luckui/dsh-game](https://github.com/luckui/dsh-game)，在此之上做了：
> - 新增**语音后端开关**：豆包云 / 本地 GPT-SoVITS
> - 新增**豆包 2.0 音色选择**（7 个实测可用音色）
> - 本地合成结果自动 **wav → mp3**（96 kbps）
> - **抖音平台接入**与设置项
> - 构建与部署脚本整理，库依赖锁定

**判定：`luckui` 是原创，`y3519712124-ui` 是诚实的下游增强（非抄袭）**；代码许可 MIT + 大肥鱼素材 CC BY-NC-SA 4.0（仅非商用），署名链完整。`air158` 是纯再上传（无改动说明），`lawrencezy` 是补丁/教程而非完整插件。

### 4.2 Minecraft 线怎么做的

**双轨：mineflayer 当身体，真 MC 客户端当摄像机。**

`luckui/dsh-game` 的 README（上游原文，`y3519712124-ui` 沿用）写得很具体：

> - `packages/dsh-game/`：插件本体。宿主端 `src/index.ts`、agent 工具 `src/agent.ts`、网页端 `src/client.tsx`；狼人杀在 `src/games/werewolf/`；**Minecraft 在 `src/games/minecraft/`（身体是 mineflayer，在 `body/` 里，单独打包成子进程）**
> - **摄像机客户端**：插件开一个**真的 Minecraft 客户端**，**旁观挂在她身上**，默认跟在她身后拍（窄地方自动换角度，不会钻进脑袋里），也能切成她的视角、原版的背后和正面；窗口上叠着她的血量、饱食度和快捷栏。
> - **开局设置**：服务器、她的名字、摄像机都在游戏库里填，开局前逐项检查（服务器连没连上、客户端装没装、**RCON 密码对不对**……）
> - **直播**：OBS 抓摄像机窗口，再叠一个浏览器源当 HUD
> - **画面就在 DSH 里**：游戏画面、她的思考过程（终端）、她的表情动画

架构翻译成人话：

```
mineflayer 子进程（AI 的身体：走/挖/合成/建造）
        │ 同一个 MC 服务器
        ▼
真 MC 客户端（旁观者模式，spectator 挂在她的实体上）  ← 这是「摄像机」
        │ 窗口
        ▼
OBS 窗口捕获 + 浏览器源 HUD  →  B 站直播间
        │
        └─ 同一路画面 also 进 DSH 侧边栏面板
```

**为什么这么做**（这是对我们的关键启示）：mineflayer 无法渲染画面；要让**观众/玩家看到** AI 在做什么，它选择了「开一个真客户端当摄影机」而不是「用 prismarine-viewer 渲染」。代价是：要装同版本 MC 客户端、要开 RCON、一人一客户端，重；收益是：画面是**真正的 Minecraft 画面**，有原版手感、皮肤、光影，观众认。

**对比 `jcs130` 的选择**（见 §5.2）：进程内 three + node-canvas-webgl + prismarine-viewer 渲染，`mc_camera.capture()` 直接吐 JPEG Buffer。轻、可无头部署、能当「AI 的眼睛」；但不是真 MC 画面。

### 4.3 舞台 / 弹幕 / 双语音 / OBS —— 这套是不是「陪玩」的现成基础设施

**基本是。它已经实现了「外部输入 → agent 注意力 → 语音输出 → 屏幕动作」的完整闭环**，这正是陪玩需要的骨架。

| 能力 | 实现 | 陪玩能不能用 |
|---|---|---|
| 舞台即网页 | 海边小屋/深海/晚霞三套主题，舞台地址可直接当 OBS 浏览器源，也可给抖音直播伴侣当窗口源 | ✅ 可当「陪伴界面」 |
| B 站弹幕 | **官方 WebSocket，自带 WBI 签名**（不是第三方库） | ✅ 稳 |
| 抖音弹幕 | **真实浏览器桥**（页面内截取） | ✅ 唯一可行路线 |
| 礼物/SC/上舰/进场 | 都进「她的注意力队列」 | ✅ **这个抽象正好是陪玩的注意力模型** |
| 语音 | 豆包云 2.0（带**逐字字幕**）或**本地 GPT-SoVITS**（自训音色） | ✅ 双后端可选 = 成本/音色可权衡 |
| 点播 | 观众说个大概，她自己上 B 站搜、挑、放上舞台 | ✅ 可迁移成「陪玩时放个视频一起看」 |
| 记忆 | 这一场和以前的观众都记着，常来的人会被认出来 | ✅ **老玩家认得出来 = 陪玩的核心体验** |
| OBS 自动化 | 开播自动建专用配置与场景（1080p30 / NVENC / CBR），推流结束自动收尾 | ⚠️ 陪玩场景未必需要推流，但「自动建场景」可复用 |
| 控制台 | DSH 侧边栏「直播」：舞台预览、换皮肤、开关播、模拟观众彩排、切音色 | ✅ 可直接改成陪玩控制台 |
| **缺口** | ①没有「和玩家同队/同服协作」的语义（她是主播，玩家是观众）；②**不看玩家的屏幕**；③UI 全在 DSH 侧边栏，不在游戏里 | ❌ 这三块要自己做 |

**已知硬伤（README 自述，值得当风险参考）**：

1. **舞台视频加载失败会让宿主进程退出** —— `MediaError 2` 后插件等 `Network.getResponseBody` 超时崩溃。「后续会加超时与降级」。> 这是**能让整个 DSH 挂掉**的 bug，说明这类插件对宿主进程的稳定性影响是真的。
2. 本地 GPT-SoVITS 的 `api_v2` 单句 100 秒以上（直调 `infer.py` 仅数秒），未定位。
3. 抖音只能走官方「直播伴侣」，普通账号没有第三方推流码。
4. 抖音采集链是「系统声音回环」，开监听会有回声。

### 4.4 维护活跃度

| 项 | 值 |
|---|---|
| stars / forks | 13 / 4 |
| 创建 / 最近推送 | 2026-10-30 / 2026-10-30 | 
| commits | 31 个，**全部集中在同一天**（03:03–04:42） |
| Releases | 0 |
| Issues | 0（open+closed） |
| npm | 未发布 |
| 仓库体积 | **381 MB**（含 character animation 资产 16 个 part） |

**判定：一次性的「发布式提交」**。31 个 commit 里有 16 个是 `feat(assets): character animation part N`，实际代码提交约 10 个。之后 17 天零活动、零 issue 响应。代码质量看起来不低（有 NOTICE.md、许可分层、已知问题清单），但**没有维护承诺**。

---

## 5. 可复用清单（回答 Q1）

按「拿来即用 / 拿来改 / 拿来抄」三档，共 7 组。

### 5.1 拿来即用

#### ① MC 身体层 —— `blueziii/dsh-mc-agent`（35★，v0.6.78）

**拿什么**：41 个 `mc_*` 工具（进服/寻路/挖矿/合成/熔炼/箱子/村民交易/睡觉种地/按图盖房/第一人称画面/记账）、战斗策略层、自主层（`ai-led`：只监测+叫醒，不替你吃捡穿）、长任务分片（单次 ≤11 秒带进度）、证据化成功判定（挖了要回读、打死要有掉血记录）。

**为什么是它**：src 3.7 万行、91 个 js/mjs 文件、96 个 tools、74 个「实机验证」文件、`踩坑档案.md` **613 KB / 151 个真 bug 的现象→根因→修法**、`CHANGELOG.md` 444 KB。这是我在整个生态里见过的**最厚的工程沉淀**（比 jcs130 还厚，虽然 star 少 31 倍）。

**怎么拿**：
```bash
pnpm add github:blueziii/dsh-mc-agent
pnpm add mineflayer-pathfinder mineflayer-collectblock mineflayer-tool mineflayer-pvp mineflayer-auto-eat minecrafthawkeye
```
然后把 `"dsh-mc-agent"` 加进 profile 的 `dsh.profile.bundles`。**它不在 npm**（`registry.npmjs.org/dsh-mc-agent` = 404），只能 github 装。

**风险**：`engines.dsh: ">=0.2.0-rc.2 <0.3.0"` —— 我们本机是 `0.2.1-rc.5`，兼容。依赖 6 个 mineflayer 扩展，都要单独装。

#### ② MC 身体层（备选，更「产品化」）—— `yzi1b/whale-craft`（60★，npm 已发布）

**拿什么**：npm `whale_craft@^0.2.0-beta.3` 一行装；**MC 模式 / MC+ 模式双 preset** 做权限隔离（MC 模式只给 MC 工具 + 文件锁在 `.whale-craft/` 内；MC+ 放开全部）；**看门狗**（收事件、记消息、适时唤醒/打断）；**长期记忆**（`<工作区>/.whale-craft/` 文档树，AI 自己维护）；**凭据管理器**（账户凭据写在宿主配置，AI 拿不到明文）；每会话一个独立机器人。
```bash
dsh plugin --profile web add whale_craft@^0.2.0-beta.3
```

**为什么值得看**：它是「AI 玩 MC」这个品类里**唯一一个把权限/记忆/唤醒/账户都产品化**的。`blueziii` 是它的魔改版，`jcs130` 的 `agent-mc-world` 是另一条独立路线。**如果我们要做「陪玩」，它的 MC/MC+ 权限分层 + 看门狗 + 记忆三件套的设计最值得直接照搬。**

#### ③ 直播 / 语音 / 弹幕 —— `y3519712124-ui/dsh-livestreamingcompanion`（13★）

**拿什么**：B 站官方 WebSocket（含 WBI 签名）弹幕、抖音浏览器桥、礼物/SC/上舰注意力队列、豆包云 + 本地 GPT-SoVITS 双 TTS（含逐字字幕与 wav→mp3 压缩）、舞台网页（可当 OBS 源）、点播、观众记忆、OBS 自动建场景、DSH 侧边栏控制台。

**怎么拿**：仓库 381 MB，**别整仓 clone**，只取 `packages/dsh-livestreamingcompanion/src` 里的弹幕/TTS/舞台三块；或从上游 `luckui/dsh-livestream`（53 MB，更小）取。

**风险**：①同一天提交后零维护；②「舞台视频 MediaError 会让宿主进程退出」这个 bug 未修 —— 如果我们复用它，**必须**加超时与降级；③大肥鱼素材 CC BY-NC-SA（非商用），商用要换角色。

#### ④ 无人值守调度 —— `gychen-NJU/dsh-game-daily`（56★，npm 12 版）

**拿什么**：一整套「按时间自动跑 agent 任务并汇报」的成熟范式（我们做「每天陪玩一小时」或「定时上线」会用到）：

```
设置页 ──POST /api/game-daily/apply──▶ state.json + automation/tasks.json
        └─▶ game-daily-register.ps1（提权一次）──▶ Windows 计划任务
                └─▶ node automation/run-headless.mjs --game <id>
                        └─▶ dsh --profile headless --patch <overlay.yml> "<prompt>"
                                └─▶ runs/<game>/<runId>/{meta.json,report.json,stdout.log,screens/}
                                        └─▶ 插件每 60s reconcile → 通知 → 汇报会话
```
关键设计：**`report.json` 是唯一判定依据**（不猜进程退出码）；**看门狗在「超时−5 分钟」写兜底报告**；**兜底对账**（连兜底报告都没写就重建）；**每个游戏固定一个汇报会话**（首次创建之后复用，被删自动重建）。

### 5.2 拿来改

#### ⑤ AI 的「眼睛」（渲染侧）—— `jcs130/dsh-minecraft-agent` 的 `mc-camera.ts`

**拿什么**：`src/mc-camera.ts`（33.8 KB）。这是**进程内无头第一人称相机**：
- 技术栈：`three` + `node-canvas-webgl` + `prismarine-viewer`
- `capture()` 返回 JPEG Buffer（走 `canvas.createJPEGStream`，因为 `toBuffer` 在该库上不可靠）
- 落盘 `data/screenshots/<username>/`
- **仅供 `mc_see` / `mc-loop` 使用；按需触发，不常驻渲染循环**
- **关键增值**：`mc_see` 会把附近实体的 3D 坐标**投影到第一人称画面上**，用 PIL 叠框 + 标签 + HUD（`mc-camera.ts:365`）—— 这就是「带标注的视觉输入」，比纯截图给模型的信息密度高得多

**为什么比 PrintWindow 靠谱**：它根本不抓屏幕。它从协议世界（mineflayer 的 world state）自己渲染，所以**不受窗口遮挡、DPI、OpenGL 黑帧影响**，可无头、可容器化。

**限制**：`node-canvas-webgl` / `canvas/gl` 不在 `package.json` 里（Windows 裸机是从 Mindcraft 的 `node_modules` robocopy 来的预编译），Docker 镜像自 2026-08-18 起内置。**这是它最大的部署坑。**

#### ⑥ 真人客户端的结构化通道 —— `yan-mc/minecraft-mod-dev` 的 Forge 探针

**拿什么**：一套「在真 MC 客户端里装探针 mod，把结构化状态暴露给 agent」的完整实现：
- 服务端探针：状态、命令、方块/NBT、配方、掉落、物品、日志、run dump
- **客户端探针：UI 控件树、槽位、鼠标点击、右键、截图、聊天命令**
- 启动器：`mcdev_prepare` 起真实 `runServer`/`runClient`，等进服，失败重试（TitleScreen 后显式 `/connect`，不用 quickPlay）
- 卡片执行器：YAML → 可重复的 in-game 检查（含断言、截图、干跑）

**为什么对我们关键**：如果我们的产品是「桌面 MC 客户端 + AI 陪玩」，那么**「客户端里有个 mod 帮我们把状态和画面拿出来、把动作塞进去」正是最正确的架构**。这个仓库证明了这条路在 DSH 里能走通（虽然它只服务 1.20.1 Forge 47.4.x / Windows / Java 17）。

**风险**：README 自称「研究/原型项目，不是生产级产品」；版本锁死 1.20.1；只有 Windows x64。

#### ⑦ HUD 读数 —— `yuanstarstar/dsh-game-stack` 的 `cv-recall` 思路

**拿什么**：**不要拿代码，拿设计**。
- 「编译一次、每帧 0 token」的资产化思路
- 两路 NCC（灰度 + 边缘）分开投票
- 3×3 分块多数票抵消局部遮挡/替换
- 场景 = 实体存在向量 + 全局直方图，离太远报 `unknown`
- `derived` 派生量（血量 = 在场红心数）
- `stale` 自检（分辨率/主题变了主动报错而不是静默错答）
- 失败码结构化（`NOT_FOUND` / `STALE_REF` / `TARGET_OCCLUDED` / `UIPI` / `DEADLINE`）

**如果只取代码**：`03-cv-recall/bundle/sidecar/pcv/`（feats/compile/observe/digits/ocrlib）可以当 MC HUD 读数模块；`ocr_digits.npz` 380 KB 的小 MLP 可以直接复用（纯 numpy 前向，不联网）。

### 5.3 拿来抄范式

#### ⑧ 引擎桥范式 —— `Smalldy/godot-bridge`（58★）

**抄什么**：**「游戏内 server + 宿主内原生 client」**，而不是 MCP。
> 游戏侧 `McpInteractionServer` autoload 监听 `127.0.0.1:9090`，说新行分隔 JSON；godot-bridge 在 DSH 宿主进程内**原生说同一协议**。No MCP protocol, no Python server, no editor addon.

对我们的直接映射：**在 MC 客户端 mod 里起一个 `127.0.0.1:PORT` 的 JSON-lines server，DSH 插件直接说这个协议**。比走 MCP 少一层、比截屏+OCR 稳一个数量级。它还有两个细节值得抄：`debug:true` 时**主动禁用 `eval`**（因为 `-d` 会让语法错误进交互式 `debug>` 提示符而死锁 —— issue #13）；诊断模式**只写一次 `quit`，永不写 `continue`**。

#### ⑨ 画面进面板范式 —— `elfgzp/dsh-godot-live`（0★）/ `davidmercer0620-ai/dsh-game-preview`（1★）

**抄什么**：原生渲染以 **MJPEG 流**进 DSH 面板 + 输入注入 + agent 截图。比「base64 图片塞进对话」体验好得多。

---

## 6. DSH 插件开发最小路径（含代码骨架）

> **本节全部依据本机已装 DSH 0.2.1-rc.5 的真实文件，不靠猜。**
> 最权威的来源不是任何 README，而是随包发布的官方 skill：
> `C:\Users\Lenovo\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-agent-preset\skills\cordis-plugin-development\`
> （`SKILL.md` + `references/host-plugin.md` + `references/ui-plugin.md` + `references/practices.md` + `templates/decoration/` 六个文件）
> 它在 DSH 里对应「创造模式 / 让 Agent 创建插件」那条流程。

### 6.1 官方有没有脚手架

**没有独立的 `create-dsh-plugin` CLI。** 官方的两条路是：

1. **Agent 创造模式**：DSH 侧边栏「插件 → 添加插件 → 让 Agent 创建插件」，进入创造模式后 agent 加载 `cordis-plugin-development` skill，照 `templates/` 抄。
2. **手写 + `plugin_manager install_bundle`**：在工作区写普通文件，然后让 `plugin_manager` 用绝对路径装进当前 profile。

CLI 只有安装/管理，没有 init：
```
$ dsh plugin --help
Usage: dsh plugin [options] [args...]
  manage a profile's plugins by forwarding the remaining arguments to pnpm in the profile directory
  --profile <name>   the profile whose plugins to manage (initialized on first use)
```
即 `dsh plugin --profile web add link:D:\path\to\my-plugin`。

**官方明确禁止**：不要手写 profile 的 `package.json` / `cordis.patch.yml`，不要在 `$DSH_HOME` 下建包，不要在 profile 目录里跑 pnpm —— 这些都交给 `install_bundle`。

### 6.2 最小结构（5 个文件）

```
my-mc-companion/
├── package.json          # 声明 dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # 往 profile 配置树里 insert 一行
├── index.js              # 宿主端：注册工具 / 系统提示词 / HTTP
├── client.js             # 网页端：注册侧边栏页面（可选，纯 Host 插件不需要）
├── locale/en.json        # 显示用 title/description（Plugin Manager 会读）
├── locale/zh.json
└── icon.svg              # 图标，≤256 KiB，必须在包内
```

`package.json`（照 `templates/decoration/package.json` 的最小版）：

```json
{
  "name": "@local/my-mc-companion",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: my-mc-companion
      name: '@local/my-mc-companion'
      config: {}
```

> `dsh.bundle.patch` 可以是**一个路径或一个有序路径列表**（`blueziii/dsh-mc-agent` 就用了 3 个：`./cordis.patch.yml` + `./presets/minecraft.patch.yml` + `./presets/minecraft-plus.patch.yml`）。多 bundle 的 patch 按 `dsh.profile.bundles` 顺序叠，再叠 profile 自己的 patch；**只有 profile 那层是热重载的，bundle 层要重启才组装**。

### 6.3 宿主端：注册工具给 agent

官方 API 是 `defineTool`（`@deepseek-ai/dsh-tools`），不是裸对象：

```js
// index.js
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-mc-companion'
export const inject = ['tools', 'systemPrompt', 'webServer']

export function apply(ctx, config) {
  // 1) 注册工具
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'mc_look',
    description: 'Capture what the player is looking at in Minecraft.',
    parameters: {
      region: { type: 'string', description: 'full | center' },
      annotate: { type: 'boolean' },
    },
    output: {
      schema: { type: 'object', properties: { path: { type: 'string' }, entities: { type: 'array' } } },
      render: (_args, value) => [{ type: 'text', text: `saved ${value.path}` }],
    },
    async execute(args, exec) {
      // args 已按 parameters 校验并推导出类型
      return await captureFrame(args, exec.signal)
    },
  })), 'mc-companion: mc_look')

  // 2) 注入系统提示词段落（name + order + text）
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'mc-companion',
    order: 900,
    text: '你在陪玩家玩 Minecraft。先看画面再说话；不确定就问，不要编造方块位置。',
  }), 'mc-companion: prompt')

  // 3) 给自己的面板开 HTTP 接口（侧边栏取数用）
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/mc-companion',
    handler: (req, res) => { /* ... */ },
  }), 'mc-companion: http')
}
```

要点（全部来自官方 `host-plugin.md`）：
- `index.js` 只能导出**一种**形式：`export function apply(ctx, config)` + 可选 `export const inject` / `export const Config`；**或**一个 service class 作 default export。**不要混。**
- 所有资源必须在 `apply` 里用 `ctx.effect` / `ctx.on` 注册并返回清理函数。
- 声明了 `Config` 的插件会在激活时校验该行的 `config`。
- 工具 schema DSL 支持 `string/number/integer/boolean/null/array/object/json/oneOf`。

### 6.4 网页端：注册侧边栏页面

官方槽位（`dsh-client-ui-sidebar` 的 README 原文）：

> 插件在 root 作用域的 **`sidebar.panellist`** list 中注册图标组件，提供 `id`、可选 `order`，以及字符串或 locale-aware 的 `label`。**同一个 id 寻址布局中 root 作用域 `main` keyed slot 的组件**；选择不存在的主面板条目会抛错，并保留当前选中态。

所以侧边栏页面 = **两次注册**（图标 + 主面板），`id`/`key` 必须对上。`dsh-game-stack` 和 `dsh-minecraft-agent` 都是这么写的：

```js
// client.js —— 注意：必须走 window.__ModuleLoader__ 的 lazy factory，
// id 必须等于包名，React 从浏览器模块表里 require，不要自己装 React
window.__ModuleLoader__.load({
  id: '@local/my-mc-companion',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    function PanelIcon() { return h('svg', { viewBox: '0 0 64 64', width: 24, height: 24 },
      h('rect', { x: 8, y: 8, width: 48, height: 48, fill: '#3aa757' })) }

    function Page() {
      const [state, setState] = React.useState(null)
      React.useEffect(() => {
        const ac = new AbortController()
        fetch('/mc-companion/state', { signal: ac.signal })
          .then(r => r.json()).then(setState).catch(() => {})
        return () => ac.abort()          // 组件卸载即取消
      }, [])
      return h('div', null, state ? `HP ${state.hp}` : '…')
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'mc-companion', order: 24,
          label: () => '陪玩',
        }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'mc-companion',
        }, Page))
      },
    }
  },
})
```

官方 `ui-plugin.md` 的硬性约束（踩了就出事）：
- factory 必须**无副作用**；样式/定时器/监听器一律在 `apply` 里用 `ctx.effect`/`ctx.on` 注册并返回清理。
- **不要**替换 app root，**不要**往 `document.body` 追加第二个应用。
- **不要**读别的插件的 DOM / 样式表 / 组件源码来估算位置 —— 选一个已经分配好空间的槽位。
- 可见文案走 Client locale service；容器与控件继承宿主主题。
- 编译产物要用部署方的 Client 构建工具产出这个格式；非基线运行时依赖要在 `dsh.client.external` 里声明。

其他常用槽位（做「游戏画面进面板」会用）：
- `conversation.composer.dock` —— 输入框下方（放状态条/按钮最稳）
- `shell.overlay` —— 全屏浮层（只在确实需要 overlay 且位置明确时用）
- `sidebar.footer.action`、`sidebar.settings`、`settings.section`、`sidebar.right.pane.tab`
- 右侧栏是**两阶段注册**：先 `ctx.sidebarRightTabs.register({id, kind, patterns, priority, title, guide})` 声明类型，再 `ctx.slots.register({name:'sidebar.right.pane.tab', key: definition.id}, Body)` 挂正文。

### 6.5 显示元数据（不做会被官方文档判为不合格）

```json
// locale/en.json
{ "meta": { "title": "MC Companion", "description": "Play Minecraft together with the agent." } }
// locale/zh.json
{ "meta": { "title": "MC 陪玩", "description": "和 agent 一起玩我的世界。" } }
```
图标可以是 SVG/PNG/JPEG/WebP，**≤ 256 KiB，必须在包内**（绝对路径、URL、指向包外的符号链接都会被拒）。缺失字段会回落到 `package.json` 的 `name`/`description`，缺图用面板默认图。

### 6.6 安装与验证

```powershell
# 方式一（官方推荐，让 plugin_manager 干活）
#   在 DSH 对话里：plugin_manager action=install_bundle target=D:\path\to\my-mc-companion

# 方式二（开发期软链，改代码即时生效）
dsh plugin --profile web add link:D:\path\to\my-mc-companion
# 改完仍需重启 DSH 才会重载模块
```

验证清单（官方 `SKILL.md` 的要求，别跳）：
1. 读**安装结果**的 `application` 和 `warnings` —— 不是日志、不是进程列表、不是页面 boot payload；
2. 用**免审批的** `cordis_inspect_query` 确认新行，**不要**用 `list_plugins`（每次都要审批）；
3. `application: applied` 之后**实际用一次**那个能力，或检查 live Client 注册；
4. 确认 bundle 详情与插件行里的 title/description/图标真的渲染出来了（中英双语各看一次）；
5. 换掉测试期间改过的用户状态；**如实报告验证不到的部分** —— 「装上了、槽位注册了」不等于「用户看到了」。

### 6.7 调试知识源（官方给的优先级）

1. **Inspection**：`cordis_inspect_query` 能查精确的 Service 方法、Event 模式、已挂载插件的 Config JSON Schema、本 Agent 能调的 Tool 列表、live Client Slots 和 theme tokens。
2. **包文档**：`Config.listConfigs` 传 `name` 找到条目，查 `entry` 拿 `packageDir`，读 `<packageDir>/README.md`。
3. **源码**：装好的包带 `lib/index.js` + `lib/types/**/*.d.ts`（含 JSDoc），**不是 `src/`**。
4. 环境变量：`DSH_PROFILE`（profile 名）、`DSH_PROFILE_DIR`（目录，其 `node_modules` 只放 profile 装的 bundle）。`dsh --profile "$env:DSH_PROFILE" --dump-config` 打完整合成配置。

---

## 7. 差异化建议（回答 Q2）

### 7.1 已经有谁在做「我们想做的事」

| 我们的设想 | 最接近的已有作品 | 差在哪 |
|---|---|---|
| AI 进入 MC 世界 | 12 个身体实现，blueziii / jcs130 / whale-craft 三个工程级 | **不缺，别做** |
| AI 陪玩家玩（第二玩家） | `Azetus/dsh-minecraft-p2`(1★)、`xizhilang2012/dsh-mc-companion`(0★)、`banbixieyang/dsh-mc-companion`(0★)、`Red0tsnow/dsh-companion`(3★) | 全是意向性仓库；`p2` 描述最准（「in-game chat 下指令挖矿/采集/放方块」）但方案未验证、无 star、无 release |
| 单机游戏内 AI 同伴 | `qimidandapigu/dsh-xiaotangyuan-game`(11★) | 与「陪玩」同题，但 8 月后停更，非 MC |
| AI 看得见 MC | 协议派已解决；渲染派 `jcs130 mc-camera` 已解决 | **不缺** |
| AI 看得见**玩家的**画面 | 无 | **真空** |
| 陪伴发生在游戏里 | 无（只有 `xiaozhaoz1/dshpet-mc` 桌宠 mod，1★） | **真空**（唯一需要跟「玩家已经装了 mod」换来的能力） |
| 直播/语音/弹幕 | `luckui` 一系已成熟 | **不缺，别做** |

**Q2 的直接回答**：**方向被认领了 6 次，产品一个都没做出来。** 这不是「别人已经做了」，而是「别人都想做、都停在 README」。**这在时间上对我们有利（没有强敌），但在验证上对我们不利（说明这条路有硬骨头，别人啃不动）** —— 而硬骨头就是下面三块。

### 7.2 三个真空，就是三个差异化支点

#### 支点 A：玩家侧感知（把「看屏幕」做成能看 OpenGL 的）

生态里 10+ 个截屏插件**全部**是 `PrintWindow`/`BitBlt`/UIA/OCR。这条路对 MC Java（GLFW/OpenGL）大概率黑帧。真正能抓 MC 客户端的是：

- **Windows Graphics Capture (WGC)** / `Windows.Graphics.Capture` —— Win10 1803+，能抓 DirectX/OpenGL 窗口，Win11 还支持抓单个窗口的客户区；
- **DXGI Desktop Duplication** —— 抓整个输出，帧率高，全屏/无边框都能拿；
- **OBS 的 game_capture 源**（内部就是 WGC/DXGI）—— 现成、稳、但重；
- **MC 自己 mod 侧渲染到纹理**（最干净，但要装 mod）。

> **判据**：`dsh-game-stack` 自己的 README 承认「独占全屏/反作弊……这类窗口的帧会是黑的」。这说明社区已经撞过这堵墙，但选择绕开（只做窗口化 2D 游戏）。**我们把 WGC 这块啃下来，就是别人抄不走的**。

**如果不想碰 WGC**：退一步，用 `jcs130` 的 `mc-camera` 路线 —— **不抓屏幕，从协议世界自己渲染**。缺点是那不是「玩家看到的画面」（第三人称 vs 玩家第一人称、玩家在做什么看不到）。**但「AI 知道玩家在哪、在看什么」可以通过协议拿到（玩家实体位置/朝向），不需要像素。** 这可能是性价比最高的折中：**世界状态走协议，玩家意图走游戏内聊天/语音，像素只在需要时用 WGC 补一帧**。

#### 支点 B：游戏内呈现（陪伴必须在游戏里发生）

生态里所有游戏 UI 都长在 DSH 侧边栏。但「陪玩」的体验发生在游戏里：AI 说的话要在游戏里听得见、AI 的存在要在画面里看得见。

可用的三条路：
1. **客户端 mod 渲染 overlay/HUD**（`xiaozhaoz1/dshpet-mc` 已有纯客户端桌宠 mod 的先例；`yan-mc` 的 Forge 探针证明了 mod↔DSH 通信可行）—— 重，但体验最好；
2. **MC 的 `/tellraw`、`/title`、计分板侧栏**（纯服务端，零 mod）—— 轻，但只能出文字；
3. **游戏内聊天 + 语音**（AI 在游戏里说话，玩家用语音回）—— `luckui` 的 TTS 链路可复用，MC 侧只需一个「把 TTS 音频播出来」的通道。

> **最小可行**：`/tellraw` + 侧边栏计分板显示 AI 状态 + 语音（`/playsound` 或本地 TTS 旁路）。**零 mod、一天能出原型**。

#### 支点 C：从「AI 自己玩」翻转成「AI 陪你玩」

这是**产品定义**的差异，不是技术的差异，而生态里**没有一个仓库**做过这个翻转。具体翻转四处：

| 维度 | 生态现状（AI 自己玩） | 陪玩应该是 |
|---|---|---|
| 目标来源 | agent 自己的 goal（`mc_goal`、自主层） | **玩家的意图**（他说「帮我砍点木头」） |
| 世界 | AI 一个人（或几个 bot） | **玩家和 AI 在同一个世界**，AI 看得见玩家 |
| 节奏 | 连续自主运行（jcs130「持续自主运行」、blueziii「ai-led 自主层」） | **跟着玩家的节奏**，玩家不动它就等着 |
| 成功判定 | 任务完成（挖到 64 铁） | **玩家开心**（这个无法自动化，但可以做信号：聊天频率、停留时长、主动发起） |

`Azetus/dsh-minecraft-p2` 的 README 一句话其实已经把产品定义写对了：**"brings a second player into your Minecraft Java Edition world. Chat with it in-game and ask it to mine, gather materials, or place blocks."** 它只是没做出来。

### 7.3 建议的定位（三选一）

| 定位 | 一句话 | 复用度 | 难度 | 竞争 |
|---|---|---|---|---|
| **A. 桌面 MC 陪玩（推荐）** | 玩家在自己电脑上开 MC，AI 作为第二个玩家进来，能看见玩家的画面、在游戏里说话、跟玩家协作 | 身体层复用 whale-craft/blueziii；直播层不用 | 中高（WGC + 游戏内呈现） | **零**（`p2` 是意向，未实现） |
| **B. MC 陪玩主播** | AI 自己玩 MC 并直播，观众弹幕互动 | 直播层 + 身体层全复用 | 低（`y3519712124-ui` 已 90% 做完） | 已有 5+ 个同款，红海 |
| **C. MC 模组开发陪跑** | AI 帮你写 MC 模组并自己进游戏验证 | `yan-mc` 全复用 | 低 | `yan-mc` 已占位（35★） |

**推荐 A**：唯一没有实现者的位置，且它需要的两块硬骨头（玩家侧感知、游戏内呈现）恰好是**别人绕开的**，不是**别人做失败的**。B 和 C 都是「已经有了，做得比我们早」。

### 7.4 如果选 A，最快的验证路径（2 周内）

1. **第 1–2 天**：`dsh plugin --profile web add link:` 装 `whale-craft`（npm 一行），确认能连本机 LAN 世界的 MC 服务器，AI 能走能挖——**验证身体层可用**；
2. **第 3–4 天**：写一个最小 DSH 插件（§6 的骨架），只做一件事：`mc_look` 工具返回「玩家实体位置/朝向/手持物/附近方块」——**验证协议侧能看见玩家**（不需要像素）；
3. **第 5–7 天**：加 WGC 抓帧（Node 侧可用 `windows-capture` / `@nut-tree` 系；或直接用 OBS WebSocket 让 OBS 抓完读帧）——**这是整个项目最大的技术风险，必须最先证伪**。如果 MC 窗口抓不到，立刻转向「协议感知 + 游戏内文字/语音」方案；
4. **第 8–10 天**：游戏内呈现最小版：`/tellraw` 说话 + 计分板侧栏显示 AI 状态；
5. **第 11–14 天**：把「玩家意图 → AI 行动」接起来，跑一次真人 30 分钟陪玩，记录：玩家主动说话次数、AI 主动说话次数、AI 卡住次数。

**第 7 天是 go/no-go**：WGC 抓 MC 窗口成不成，决定产品形态。

---

## 8. 未验证清单

以下条目我**没有**验证到，报告中相应结论请按「待验证」对待：

### 8.1 技术性未验证（影响最大）

| # | 未验证项 | 为什么重要 | 怎么验 |
|---|---|---|---|
| 1 | **`PrintWindow(PW_RENDERFULLCONTENT)` 能否抓到 MC Java（GLFW/OpenGL）窗口的帧** | 决定 `dsh-game-stack` 的 `cv-recall` 能否用于 MC；也决定「用现成截屏插件看 MC」这条路是否成立 | 起一个 MC 1.21 窗口化客户端，跑 `win_capture.py <hwnd>` 看 `std` 是否 < 1.5（黑帧） |
| 2 | **WGC / DXGI 在 MC 窗口上的实际可用性与帧率** | 支点 A 的核心假设 | 用 OBS game_capture 抓 MC 试；或写最小 WGC demo |
| 3 | **`dsh-game-stack` 在 DSH 0.2.1-rc.5 上能否真装起来** | 它是按「DSH Desktop + profile desktop」写的；我们本机是 web profile / 0.2.1-rc.5。`install-all.ps1` 只往 `profiles\desktop` 装 | 按 INSTALL.md 手动建 junction 试装 02-game-learn（纯 JS 无依赖） |
| 4 | **`blueziii/dsh-mc-agent` 能否接本机 LAN 世界**（而非专用服务器） | 陪玩场景玩家多半开「对局域网开放」 | 起 LAN 世界，`mc_connect` 到 `localhost:<port>` 试 |
| 5 | **`jcs130` 的 `mc-camera` 在 Windows 裸机的 `node-canvas-webgl` 是否可装** | 它自己说 Windows 是从 Mindcraft robocopy 来的预编译 | 试 `npm i node-canvas-webgl` 看是否要编译 |
| 6 | **`y3519712124-ui` 的「舞台视频 MediaError 让宿主进程退出」bug 是否真会复现** | 如果复现，复用它的代码有拖垮 DSH 的风险 | 装它的 stage，故意给一个坏视频 URL |
| 7 | **`whale-craft` 的 mineflayer 版本是否支持我们目标 MC 版本** | 它明说「此前对 Minecraft 26.2 的临时支持已移除，等 MineFlayer 支持」 | 查 mineflayer 4.37 支持到哪个协议版本 |

### 8.2 数据性未验证

| # | 未取到 | 说明 |
|---|---|---|
| 8 | `dsh 游戏感知` 查询的 `total_count` | 该次 GitHub search 返回 403（限流），未取到；主题已由 §3 源码调查覆盖 |
| 9 | `Darianliu23/dsh-stardew-blind-whale-farmer`(23★) 的机制 | 只看到描述，未读源码 |
| 10 | `ZSeven-W/dsh-game-studio`(566★) 是否上 npm | `dsh-game-studio` 在 npm 查为 404；但可能存在别的包名 |
| 11 | `universe-st/dsh-game-material-master` 的代码体量 | 只确认 npm 18 版、JS；未读源码 |
| 12 | 大部分 0–9★ 仓库的实际代码量 | 只用描述判断，未逐个 `/contents` 核查（73 个 MC 仓库里深查了 6 个） |
| 13 | `air158/dsh-livestream` 与上游的 diff 量 | 只确认非 GitHub fork、体积 34.8 MB；未逐文件比对 |
| 14 | 各插件的真实下载量 | npm 只查了版本数与时间，未查 `api.npmjs.org/downloads` |

### 8.3 判断性保留

| # | 我的判断 | 保留意见 |
|---|---|---|
| 15 | 「83.7% star < 10 = 周末项目生态」 | star 是滞后指标；有些新仓库（11 月创建）还没积累 star 但代码可能很好（`jcs130` 就是 4★ / 1.7 万行） |
| 16 | 「`dsh-game-stack` 是一次性导出」 | 依据是 3 个 commit + 无 docs 目录 + 无 npm；不排除作者在别处有开发仓库 |
| 17 | 「生态里没人做 WGC/DXGI」 | 依据是 598 条描述 + 数十个 README 的关键词扫描；**可能漏掉**某个仓库在代码里做了但没写进描述 |
| 18 | 「支点 B 用 `/tellraw` + 计分板一天能出原型」 | 未实测；`/title` 与计分板侧栏的刷新语义在不同版本有差异 |

---

## 附录：本报告用到的源码级证据位置

| 结论 | 证据文件（本地解包路径） |
|---|---|
| PrintWindow 抓帧 + 遮挡守卫 | `_tmp\dshrepos\game-stack-x\dsh-game-stack-main\01-coach-perceive\bundle\sidecar\win_capture.py`（240 行，读毕） |
| WinRT OCR 经常驻 PowerShell 桥 | 同上 `sidecar\coachd.py:52,63,72,727,848,876`；`03-cv-recall\bundle\sidecar\pcv\text.py:26,37,45` |
| 视觉实体编译/召回/字形模型 | `03-cv-recall\bundle\README.md`（448 行，读毕）+ `sidecar\pcv\{feats,compile,observe,digits,ocrlib}.py` |
| 5 个 bundle 的真实依赖与工具名 | `game-stack` 根 `README.md`、`INSTALL.md`、各 bundle 的 `package.json` / `cordis.patch.yml` |
| `dsh-game-stack` 无 Minecraft | 全仓 grep：`mineflayer`=0，MC 提及 33 次全在 launcher 文档 |
| 宿主插件 `apply/inject` 形态 | `02-game-learn\bundle\host.js`（40 行，读毕）；官方 `references\host-plugin.md` |
| 工具注册 API | 本机 `@deepseek-ai/dsh-tools\README.zh.md`「注册工具」节（`defineTool` 完整签名） |
| 侧边栏两次注册 | 本机 `@deepseek-ai/dsh-client-ui-sidebar\README.zh.md`（`sidebar.panellist` + `main`）；`game-stack\02-game-learn\bundle\client.js:617-620` |
| 官方脚手架模板 | 本机 `dsh-agent-preset\skills\cordis-plugin-development\templates\decoration\{package.json,cordis.patch.yml,index.js,client.js}` |
| MC 身体/摄像机架构 | `luckui/dsh-game` README（raw）；`y3519712124-ui` README；`jcs130\src\mc-camera.ts` 头注释与 `:365` |
| blueziii 工程体量 | `_tmp\dshrepos\mc-blueziii-x\dsh-mc-agent-main\src\`（91 文件 / 37,010 行）+ `踩坑档案.md`(613 KB) + `CHANGELOG.md`(444 KB) |
| jcs130 工程体量 | `_tmp\dshrepos\mc-agent-x\dsh-minecraft-agent-main\src\`（61 文件 / 17,222 行）+ 10 个 GitHub Release + npm 10 版 |
| 无人值守调度范式 | `gychen-NJU/dsh-game-daily` README「执行链路」节（raw） |
| 引擎桥范式 | `Smalldy/godot-bridge` README（raw），含 issue #13 的死锁复盘 |
| Forge 探针能力面 | `yan-mc/minecraft-mod-dev` README（raw），含 12 个 `mcdev_*` 工具表 |
| 官方 CLI 面 | 本机 `node lib\bin.js --help` / `plugin --help` 实跑输出 |
