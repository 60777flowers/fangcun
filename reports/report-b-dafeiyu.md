# 报告 B：「大肥鱼陪玩 MC」专题 —— IP 考古、技术解剖与可复用性判定

> 调查人：子代理 B　｜　采样日：**2026-11-16**（北京时间）　｜　时区注：GitHub 提交时间戳为 +0900
> 方法：mcmod 词条 + GitHub REST API + `git clone` 全量源码静态阅读 + B 站 web API + npm registry + 社区帖
> 纪律：凡未取到写「未取到」；star / 下载量为 2026-11-16 当日快照，不跨日引用

---

## 1. 执行摘要

### 1.1 一句话回答：用户说的「大肥鱼陪玩 MC」到底是哪个？

**是 `luckui/dsh-game`（GitHub，14★，MIT），不是 mcmod 的 `[bff]大肥鱼AI聊天`。**

判据（按证据强度排序）：

| # | 证据 | 出处 |
|---|---|---|
| 1 | 仓库自述就是「**让你的 AI 自己玩游戏**。一个 DSH 插件：装上以后，DSH 的 agent 会以 Q 版鲸鱼娘「大肥鱼」的身份**自己操作游戏，边玩边说，你在旁边看**」——「陪玩 MC」这个说法的语义（AI 进游戏、边玩边说、人看）与它逐字对应 | [README](https://github.com/luckui/dsh-game) |
| 2 | MC 是它三款游戏之一，且是**唯一有「桌面真客户端 + 摄像机 + 直播」形态**的那款：Java 版真实客户端旁观跟拍、OBS 抓窗口 | `src/games/minecraft/camera.ts`、README |
| 3 | 它与本项目**同栈**：DeepSeek Harness 插件（`@deepseek-ai/dsh-tools` 0.2.0-rc.2、`cordis.patch.yml`、DSH 侧边栏「游戏」标签）。用户既然在用 DSH，看到的极可能就是这个 | `packages/dsh-game/package.json`、`cordis.patch.yml` |
| 4 | 「大肥鱼」在它这里是**人设**：`cordis.patch.yml` 的 persona prefix 写着「你是 DeepSeek，大家叫你「大肥鱼」——一条爱吃白饭的鲸鱼娘」，并带 11 段 Q 版表情动画 | `cordis.patch.yml`、`assets/dafeiyu/` |
| 5 | 对照组全部不匹配：mcmod `[bff]` 是**纯聊天、无动作、无多人、只有 173 次浏览、2026-11-15 才收录**；CooLink 闭源且只有 1057 次浏览；`dafeiyu-mc` 三个 release 合计 27 次下载 | 见 §4、§5 |

**但必须同时说清一个关键落差**：`dsh-game` 的产品定位是「**她自己玩，你在旁边看**」，不是「和你一起玩」。它的源码里 `duo`（双人同服一起玩）模式**写了类型、写了注释，但被硬编码禁用**：

```ts
// packages/dsh-game/src/games/minecraft/setup.ts:4
//   玩法：solo（她自己玩，主人在旁边看）；duo（主人用自己的客户端进同一个服务器一起玩）是下一阶段，现在选不了

// setup.ts:74-76
mode: 'solo',   // 双人模式还没做：存下来的也按单人
```

而连接时又显式关掉了「同伴行为」：

```ts
// packages/dsh-game/src/games/minecraft/session.ts:288-293
this.status = await runtime.command<MinecraftStatus>('connect', {
  host: ..., port: ..., username: ...,
  companion: false,        // ← 关掉「跟着主人」的默认行为
}, 60_000);
```

### 1.2 五个最关键的发现

1. **它不是 mod，是 mineflayer bot。** 零 Forge/Fabric 依赖、零 MC 版本绑定、零客户端 mod。MC 版本在开局时用 Server List Ping 协商，`minecraft-data` 按协商结果加载方块/配方表。这是它对 mcmod mod 路线的**绝对优势**：一次开发覆盖全版本、全加载器、原版服、Paper 服。
2. **它有 34 个原子动作的词表，但只对模型暴露 3 个工具。** 工具是 `game_start` / `game_continue` / `game_act`；`game_act` 收一个 `action` 字符串，动作词表在每个「时刻」（moment）里动态下发。这是「**通用回合制外壳 + 实时身体**」的设计，而不是 Numen 那种固定 Lua API。
3. **它没有第一人称视觉。** 模型的「眼睛」是：结构化文本（坐标/维度/昼夜/血量/饥饿/背包/24 格内实体）+ 按需渲染的 **65×65 方块俯视图 PNG**（`look` 动作）+ 图纸投影图。整份源码里 `screenshot` / `createScreenshot` **零命中**；摄像机客户端只服务于人和直播。
4. **「跟着你走」的能力已经写好了，只是没接上。** body 里有完整的 `owner` 追踪（`visible` / `distance` / `relativeDirection`）、`follow` 相位机（`inactive` / `target-lost` / `approaching` / `nearby` / `blocked`）、`resumeFollowing()`（任务做完自动回到跟随主人）、以及 **`player-gaze` 事件**（射线-包围盒 + 视线遮挡判定，主人盯着她超过阈值才触发）。`duo` 只差一次接线。
5. **成熟度是「高质量但极短命」**：52 个 commit 集中在 **3 天**（2026-10-24 22 个、10-25 26 个、10-26 3 个），之后 **21 天零提交**；14★ / 4 fork / 0 issue / 0 release / 1 位贡献者 / 未上 npm（`dsh-game` 这个 npm 包名已被他人占用于 2026-08-19 注册）。

### 1.3 「抄不抄」的明确建议

> **不要抄 mcmod 那个 mod（复用度 8%）。直接把 `dsh-game` 当底座（复用度 72%），第一件事是把 `companion: true` + `owner` 接上，把 `duo` 做出来。**

- 若用户要的是「AI 自己玩得很像样，我在旁边看/直播」→ `dsh-game` **已经就是成品**，改造成本接近 0，只需补齐发布（npm 改名、打包、release）。
- 若用户要的是「AI 跟我一起玩、听我指挥、跟着我」→ `dsh-game` 是**最省力的起点**（body 全套已就绪），要补的是交互层与 agent 循环重设计，估 **2–3 人周**（见 §6.3）。
- 若用户要的是「同服多人、AI 认识每个人、能 @ 任意人的桌宠」→ 那是 **CooLink 的形态**，但它闭源拿不到；得自己写，`dsh-game` 的 body 仍可复用。

---

## 2. `luckui/dsh-game` 深度解剖

### 2.1 成熟度（2026-11-16 快照）

| 指标 | 值 | 来源 |
|---|---|---|
| stars / forks / watchers | **14 / 4 / 0** | GitHub API |
| open issues | **0** | GitHub API |
| 贡献者 | **1（luckui，52 commits）** | `/contributors` |
| 总 commit | **52** | `git rev-list --count` |
| 提交日期分布 | 10-18: 1　**10-24: 22**　**10-25: 26**　10-26: 3 | `git log --date=short` |
| 最后提交 | **2026-10-26 13:41:46 +0900**（距采样日 **21 天**） | `git log -1` |
| 创建时间 | 2026-10-18T06:05:03Z | GitHub API |
| releases / tags | **0 / 0** | `/releases` → `[]` |
| license | **MIT**（API 报 `NOASSERTION`，因 LICENSE 尾部附加了素材例外条款） | `LICENSE` |
| 素材许可 | 大肥鱼 11 段 webm：**CC BY-NC-SA 4.0**（禁止商用） | `assets/dafeiyu/LICENSE.md` |
| 代码量 | MC 目录 TS **0.65 MB**（全 `src` 1.07 MB）；`mineflayerAdapter.ts` 单文件 **185 KB**；`session.ts` 94 KB；自测 `test/minecraft-survival.ts` 110 KB | 文件清单 |
| 语言 / 运行时 | TypeScript / Node 22（`target: node22`） | `build.mjs` |
| npm | **未发布**（README 明说从源码构建）。`dsh-game` 包名已被 `dushaobindoudou` 于 2026-08-19 占用（`"name reserved; first release in development"`） | npm registry |

**成熟度判读**：基础设施质量远高于 star 数所暗示的水平（见 §2.2 的工程细节），但**社区验证为零、维护中断 3 周、无发布物**。这是典型的「一个人三天冲刺做出来的高质量原型」。

### 2.2 架构：三层 + 一个子进程

```
DSH 宿主
 └─ dsh-game（插件，lib/index.js）
     ├─ cordis.patch.yml → 注册 agent 预设「大肥鱼玩游戏」
     │    └─ persona（人设 prefix）+ dsh-game/agent（只 3 个工具，无 fs / 无 shell）
     ├─ agent 层  src/agent.ts  ── game_start / game_continue / game_act
     ├─ game 层   src/games/{minecraft,werewolf,ddlc,renpy}/
     │    ├─ session.ts  → 34 个动作、时刻生成、图纸/日志/摄像机调度
     │    ├─ camera.ts   → 启动真实 MC 客户端（minecraft-launcher-core）
     │    └─ rcon.ts     → 手写 Source RCON 客户端
     └─ body 层（**独立子进程**）lib/minecraft-worker.cjs
          └─ mineflayerAdapter.ts + actions/ + craftPlanner + farming + build ...
```

**子进程隔离**（`body/runtimeManager.ts:217-234`）——这一步做得比多数同类项目认真：

```ts
fork(workerPath, [], {
  execArgv: ['--heapsnapshot-near-heap-limit=1', '--max-old-space-size=2048'],
  env: { ...process.env, DSH_GAME_MINECRAFT_WORKER: '1' },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  windowsHide: true,
})
```

- 命令/响应走 IPC，**每条命令独立超时**；只有 `connect` 超时才重置 worker，其余保留 worker（避免一次卡顿炸掉整个身体）。
- 事件流（`MinecraftRuntimeEvent`）单向推送，含结构化 `log` 级别。
- 可写 JSONL debug trace + worker 日志。

**安全边界**：agent 预设只挂 `persona` + `dsh-game/agent`，**没有文件读写、没有 shell**。这是刻意的（`cordis.patch.yml` 注释：「只带游戏工具，不带文件和 shell」）。

### 2.3 MC 身体：mineflayer 技术栈

```jsonc
// packages/dsh-game/package.json
"mineflayer": "4.39.0",
"mineflayer-auto-eat": "5.0.3",
"mineflayer-collectblock": "1.6.0",
"mineflayer-pathfinder": "2.4.5",
"mineflayer-pvp": "1.3.2",
"mineflayer-tool": "1.2.0",
"minecraft-launcher-core": "3.18.2",   // 只为摄像机客户端
"vec3": "0.2.0"
```

**三个 mineflayer 插件打了本地补丁**（`pnpm-workspace.yaml` 的 `patchedDependencies`）：

| 补丁 | 大小 | 作用 |
|---|---|---|
| `mineflayer-pathfinder@2.4.5.patch` | 16.5 KB | 门/梯子/卡死等寻路细节 |
| `mineflayer-collectblock@1.6.0.patch` | 2.8 KB | 采集 |
| `mineflayer-tool@1.2.0.patch` | 1.2 KB | 选工具 |

补丁来源注释写明「**来自 hiyoriai**」，且 commit 有一条 `feat(minecraft): bring over the mineflayer body from hiyoriai`——**这套身体是从另一个项目搬过来的**，不是从零写的。这点很重要：说明存在一个更早的 `hiyoriai` 项目，`dsh-game` 的 MC 能力有前身。

**MC 版本支持**：没有硬编码版本。开局时

1. `pingServer()` 手写 Server List Ping（VarInt 编码、协议号 `-1`）拿到 `version.name` 与在线人数；
2. 用这个版本号去找主人装好的 `.minecraft/versions/<version>/`（摄像机要）；
3. mineflayer 按服务器协商的版本连接，`minecraft-data` 提供该版本的方块/物品/配方表；
4. `check-blocks` 命令专门校验图纸里的方块 id 在这个版本存不存在。

→ **理论上支持 mineflayer 4.39.0 覆盖的所有 Java 版版本**；实际验证过的版本未在仓库中声明（**未取到**）。

### 2.4 agent 工具清单：3 个工具 + 34 个动态动作

#### 2.4.1 注册给模型的工具（`src/agent.ts`，仅 3 个）

| 工具 | 参数 | 返回 | 语义 |
|---|---|---|---|
| `game_start` | `game`（枚举：minecraft / werewolf / ddlc）、`mood` | 该游戏的背景+规则+facts | 开一局 |
| `game_continue` | `after`（integer，上次看到的时刻编号，首次填 0）、`mood` | `{text, image}` —— text 是这段时间发生的事+此刻能做的事；image 是截图/渲染图 | 等下一个「时刻」。**不调用它游戏就停在原处**（狼人杀/DDLC 真停；MC 是世界照走、只是她不决策） |
| `game_act` | `action`（string）、`index`（int）、`name`（string）、`text`（string）、`mood` | `{text, image}` | 做一件事；动作与参数由「时刻」里的【你现在能做的事】给出 |

**这个工具面设计非常克制**：34 个动作不是 34 个 tool，而是 1 个 tool 的一个字符串参数。好处是 token 省、动作可随游戏/版本动态扩展、不需要每次改 tool schema；坏处是**没有 JSON Schema 级约束、模型容易填错参数**，所以作者写了 `refuse()`（`session.ts:333-355`）做参数校验并返回教学式错误。

#### 2.4.2 动态动作词表（`session.ts:96-131`，共 34 个）

按能力分组：

| 组 | 动作 |
|---|---|
| 元 | `goal`（写长期目标，每个时刻复述）、`stop`、`journal`（看世界日志）、`mark`（记地点）、`chat`（在游戏聊天栏打字） |
| 采集/生产 | `collect`、`craft`、`smelt`、`pickup`、`dig`、`place`、`bucket`、`use`、`equip`、`drop` |
| 移动 | `go`（给坐标，**挡路的方块会挖开，地下也能直线挖过去**，40 格石头约 15 秒）、`go_to_player`、**`follow`** |
| 战斗/自保 | `attack`、`flee`、`hide`、`sleep` |
| 感知 | `look`（65×65 俯视地形图 PNG + 水量/高度/平地清单）、`find`（找方块/生物，返回坐标+距离） |
| 建造 | `template`（参考图纸）、`design`（自己画图纸）、`view`（看某层切片）、`site`（选地址+放虚影）、`show`（带看，摄像机绕建筑转一圈）、`build`（照图纸盖） |
| 农业 | `farm`、`harvest`、`breed`、`shear` |

**动作粒度判断**：这是「**高级技能**」而不是「原子操作」。`collect oak_log ×8` 一条指令内部包含「找最近的树→寻路→挖→捡→重复到 8 个」。对 LLM 来说这是正确的粒度（省 token、成功率高），但也意味着**模型无法做像素级/方块级的精确创作**——除了建造走的是「图纸」这条另一条路（见 §2.7）。

#### 2.4.3 与 Numen 的 API 风格对比（重要）

| | `dsh-game` | Numen 言出法随 |
|---|---|---|
| 暴露方式 | 3 个通用 tool，动作名是字符串 | 固定 Lua API（原子动作库）+ 少量 Java 工具调用 |
| 组合方式 | 模型每回合选 1 个动作 | **模型写一段 Lua 程序，一次调用连做几十步** |
| 调用开销 | 每动作一次模型往返 | 一次往返 = 一个程序 |
| 参数校验 | 运行时 `refuse()` 教学式拒绝 | schema/沙箱层 |
| 扩展 | 改 `ACTIONS` 数组 | 写插件注册新 Lua API |

→ Numen 的「一次写程序做几十步」在长任务上明显更省 token、更连贯；`dsh-game` 的「一动作一往返」在**实时反应**（挨打还手、苦力怕靠近）上更自然，因为身体有独立反射弧不经过模型。

### 2.5 观察通道：模型到底「看到」什么

**结论：没有第一人称画面。** 证据：在 `src/games/minecraft/` 全目录 grep `screenshot|createScreenshot|captureScreen|截图`，**零命中**。`this.image` 只在三处被赋值：

```ts
session.ts:437  this.image = { data: renderTerrain(scan, colors, spots), mediaType: 'image/png' }   // look：俯视地形图
session.ts:728  this.image = { data: renderBlueprint(bp, colors),     mediaType: 'image/png' }   // design/build：图纸立体渲染
session.ts:765  takeImage()  // 取走上面那张图
```

模型的观察 = **结构化文本 + 两张「生成的图」**：

**（a）每个「时刻」的结构化状态**（`moment()`，`session.ts:1316-1345`）：

```
你的目标（14:32 写的）：盖一个小木屋
身体正在：采集 oak_log（23 秒了，到现在背包 +5 oak_log）
排着队：craft crafting_table → craft wooden_pickaxe
背包：oak_log×7、dirt×3、stick×2
你泡在水里（look 看看周围哪里是陆地）。
附近 24 格内：zombie（18 格）、cow（7 格）、sheep（12 格）
```
外加 `where`：`主世界 (128, 64, -340) · 夜晚·下雨 · 血量 14.5/20 · 饥饿 17/20`

**（b）`look` 生成的 65×65 俯视图**：地面方块颜色、水是蓝的、越亮越高，附「水占多少、地面多高、附近哪里有平地」。这是**用渲染图替代视觉**的巧思——比截图省 token、比纯文本有空间感。

**（c）图纸投影图**：正面/侧面/俯视三张 + 四个角的立体渲染 + 材料清单 + 图上问题。

**（d）`view` 某层切片图**：看圆顶/塔里面是不是空的、门洞在哪。

**判断**：这套「眼睛」对**建造/种地/探索**够用，对**战斗微操、红石、精细美学**不够用。若要接多模态视觉（真的看画面），需另加截图通道——而它已经有摄像机客户端在跑，加截图的技术距离很短（见 §6.3）。

### 2.6 「世界不会停下来等她」怎么实现

这是它相对 Numen / 回合制游戏最核心的差异化。机制：

1. **身体有独立反射弧，不经模型**（`workerEntry.ts`）：饿了自己吃、挨打还手（`fought-back` 事件）、苦力怕靠近跑开（`creeper-evaded`）、掉水往上游、憋气危险上浮（`oxygen-danger`，含 `surface`/`last-breathable-position`/`shore`/`failed` 四级恢复策略）。
2. **长动作后台做 + 排队**：`ACTIONS` 里 18 个动作标记为 `LONG`（`session.ts:136`），`game_act` **立刻返回**；动作进 `queue` 按序执行。`URGENT = {attack, flee, hide}` 不排队，直接抢占；`RESUMABLE` 集合（采集/走路/挖/盖房）被打断后**原样续做**，而 `craft`/`smelt` 不续做（「免得多做一份」）——这个细节说明作者踩过坑。
3. **时刻由事件触发而非轮询**：动作完成/失败、挨打、天黑天亮、死亡、饥饿、玩家进出、**游戏内聊天**、主人插话。`wait()` 阻塞直到 `urgent || lines.length || nudged || disconnected`，最长 120 秒兜底。
4. **模型说话与身体动作并行**：`session.realtime === true` 时
   ```ts
   // agent.ts:359-363
   const voicing = voiceOwnWords(ctx, exec, args.mood);  // 开始念
   const result = await session.act(action);             // 同时身体已经在动
   await voicing;                                        // 念完再交回结果
   ```
   注释写得很清楚：「实时游戏：她说话的同时身体就开始动（动作本身立刻返回）；念完再交回结果，免得下一句话叠在这句上」。

**评价**：这是全项目最值得抄的一段设计。它把「LLM 延迟」从关键路径上移走了。

### 2.7 复杂技能怎么组织：硬编码流程 vs 模型规划

**答案是混合，而且分工清晰**：

| 技能 | 谁负责 | 证据 |
|---|---|---|
| 找树→挖→捡→凑数 | **硬编码**（`gatherWood.ts` 11.9 KB、`collectionStrategy.ts`、`collectblock` + 补丁） | 模型只说「要 8 个 oak_log」 |
| 合成链（缺中间材料先合成） | **硬编码规划器**（`craftPlanner.ts` 24.6 KB） | 模型只说「要 wooden_pickaxe」 |
| 垫方块爬高、盖完拆脚手架 | **硬编码**（`build.ts` 15.4 KB、`placeBlock.ts`） | 模型只说「按图纸盖」 |
| 种地/收割补种/繁殖/剪毛 | **硬编码**（`farming.ts` 18.2 KB） | 模型说「farm wheat_seeds 3」 |
| 相机绕建筑飞一圈 | **硬编码**（`show` + director） | 模型说「show 房子名」 |
| **盖什么形状** | **模型规划** | `design`：字符图纸或形状语言（box/sphere/cylinder/cone/arch/roof/line/blueprint + hollow/open/repeat/mirror/cut），最大 256³、100 万块 |
| **去哪、干什么、什么顺序** | **模型规划** | `goal` + 每时刻决策 |
| 图纸渲染/投影/材料清单 | 硬编码（`preview.ts` 17 KB、`blueprint.ts` 17.3 KB、`shapes.ts` 28.2 KB、`terrainMap.ts`） | |

**关键判断**：这是**正确**的分工。把「怎么挖到木头」交给模型是浪费且不可靠；把「盖成什么样」交给模型才发挥 LLM 的价值。而「图纸」这个中间表示（字符图/形状语言 → 体素 → 逐层放置）是**把不可靠的自由度约束住**的关键设计，值得直接借鉴。

### 2.8 摄像机客户端：怎么做的

`camera.ts` 头部注释就是完整答案：

> 开一个真的 Minecraft 客户端（离线账户，旁观模式），自动挂在她身上，画面就是她的视角。主人看、OBS 抓直播画面都用这个窗口。主人自己想玩，用自己的客户端正常进服，互不干扰。
> - 游戏文件（版本、库、资源）用主人装好的 `.minecraft`（HMCL 或官方启动器装的），**不另下载**
> - 摄像机有自己的游戏目录（DSH 主目录下），设置和主人自己玩的那份分开：失焦不暂停、不放背景音乐、跳过首次进入的引导
> - 开局后直接连服务器（`--quickPlayMultiplayer`）

工程细节：

- **依赖**：`minecraft-launcher-core@3.18.2`（CJS，因此 build 时 `external`，避免 ESM 包里 `require('child_process')` 失效）。
- **Java 发现链**（`findJava`）：主人填的 → HMCL 自带（`.hmcl/java/.../javaw.exe`）→ 官方启动器（含微软商店版 `Packages/Microsoft.4297127D64EC6*`）→ `.minecraft/runtime` → 系统 `javaw`。
- **`options.txt` 关键项**：`pauseOnLostFocus: false`、`inactivityFpsLimit: 'minimized'`、`maxFps: 60`、`renderDistance: 10`、`guiScale: 2`、`lang: zh_cn`、`narrator: 0`、`soundCategory_music: 0`。注释里有实测数据：「**afk 11 分钟后约 10 帧，minimized 一直约 33 帧**」——因为 1.21.2 起非活动帧率限制默认 afk，而摄像机从来没人操作。这种实测注释说明作者真的跑过直播。
- **旁观挂载**：靠 RCON `spectate`，`RESPECTATE_MS = 30_000` 定期重挂（对方按 Shift 会被甩开）。
- **跟拍机位**（`body/followCam.ts`，11.2 KB）——**这是全项目最被低估的一块**：
  - 理想机位：身后 4 格、高 20°、看向身前一点；**不跟头**（注释解释：原版 F5 跟着头转，低头挖脚下、扭头看墙时镜头会往天花板/墙里甩，撞上了贴到后脑勺「整屏是头发」）。
  - 遮挡处理：身后被挡时在 12 个方位角 × 4 个俯仰档里找够远、离理想方向近的，镜头永远离她 ≥1.8 格。
  - 极端情况：哪个方向都不够 1.8 格（钻进一格宽小坑）→ 连续 0.3 秒退回第一人称；有方向能退到 2.2 格且连续 0.8 秒才出来（**进/出用不同阈值和时间，防抖**）。
  - 平滑：每步挪 40%；夹角 >90° 或远了 6 格直接切；两次直切至少隔 2 秒（防穿墙）。
  - 朝向：1.2 秒里挪了 0.9 格以上才算「在走」（干活时原地挪半步不算）。
- **HUD 叠加层**（`hudOverlay.ts` 28.8 KB + `hudPage.ts` 12 KB）：因为旁观者挂在别人身上时**原版不画那个人的血条/饱食度/快捷栏，服务器也不发**，所以自己画——一个**透明、点不到、不抢焦点**的小窗口贴在摄像机窗口下沿，跟着移动缩放；贴图**从游戏 jar 里解**（`gameJar.ts` 手写 ZIP 中央目录解析器，`zlib` 解压），物品图标由模型 JSON 解析成 flat/top/left/right 图层。数据由游戏层每 250 ms 写状态文件，窗口自己读。

### 2.9 RCON 用来干什么

`rcon.ts` 手写 Source RCON（`net` socket，自己拼 14 字节头）。用途：

| 用途 | 命令 |
|---|---|
| 切游戏模式 | `gamemode creative|survival <name>` |
| **摄像机旁观挂载/重挂** | `spectate <target>` |
| 摄像机机位 | `kill @e[type=item_display,tag=dsh_cam]` → `summon item_display ...` → `tp ...`（**用 item_display 实体当镜头挂点**） |
| 图纸虚影 | `summon block_display` / `setblock`（`ghost.ts`，上限 4000 块） |
| 创造模式逐层放方块 | `placeLayers`（`creative.ts`） |
| 开局检查 | `list`（验证密码） |

`RconLink`（长连接）的注释里踩坑记录很硬核：

> 原版 RCON 一次读只处理一个包，几条命令被合进同一个 TCP 段，**它一条都不执行、直接断开**（跟拍换机位要连着发 kill + summon + spectate，合包以后镜头实体再也放不出来）

→ 所以改成「一次只有一条在路上：写一条、等同一个编号的回复再写下一条」，带 backlog 计数（排着的旧位置没用，跳过）、5 秒无回音重连、1 秒退避。

### 2.10 与「一起玩」的差距：逐项核对

| 需求要素 | 现状 | 代码证据 | 差距 |
|---|---|---|---|
| 两个玩家同服 | ⚠️ 她自己是一个真实玩家 `DaFeiYu`，你可以用自己客户端进同一个服 | `session.ts:255`、`camera.ts` 注释「主人自己想玩，用自己的客户端正常进服，互不干扰」 | **同服成立**，但 UI 上 `mode` 硬编码 `solo` |
| 跟随玩家 | ✅ 能力已有 | `ACTIONS` 里 `follow`（`session.ts:103`）→ `body('follow_player')`；body 默认行为就是 `resumeFollowing()` 跟主人 | 未被 agent 默认使用（`companion: false`） |
| 走到玩家身边 | ✅ | `go_to_player`（`session.ts:102`） | — |
| 听玩家指挥 | ⚠️ 部分 | ①游戏内聊天以 `【游戏聊天】玩家：内容` 事件进模型（`session.ts:910`）②DSH 游戏页有「主人 ›」输入栏，插话时游戏暂停等她回答（`gametab.tsx` `OwnerInput`） | 没有「指令→动作」的语义层；发现她得自己理解「跟我来」 |
| 认识/区分特定玩家 | ✅ body 有 | `owner` 字段（`name/visible/distance/relativeDirection`）、`players`/`spectators` 集合、`cannot follow itself` 守卫、**单人服务器时自动认定唯一人类为主人**（`workerEntry.ts:463-467`） | `ownerName` 存了但**没传给 session**（死配置） |
| 注意到你在看她 | ✅ | `player-gaze` 事件：射线-包围盒求交 + 视线遮挡 raycast + hold/latch/rearm 状态机（`playerGaze.ts` 4.4 KB）。阈值实测：**连续注视 4 秒**（`GAZE_HOLD_MS=4000`）、**8 格内**（`GAZE_MAX_DISTANCE=8`）、移开后 **1 秒**重新武装（`GAZE_REARM_MS=1000`） | 未被 agent 的 prompt 利用 |
| 语音对话（她说） | ✅ TTS | 豆包语音（火山引擎），`DOUBAO_TTS_API_KEY` / `APP_ID` / `ACCESS_KEY`；19 音色可选；不配只有字幕 | 需要额外付费 key |
| 语音对话（你说话） | ❌ | 无 ASR。你说的话要么打字进 DSH，要么在游戏聊天栏打字 | **缺 ASR** |
| 多人（≥3 人） | ❌ | 全项目只有「主人」一个关系概念 | 无多玩家关系模型 |
| AI 主动发起互动 | ⚠️ | 有 `game_continue` 的 120 秒兜底，但没有「主动找你说话」的驱动 | 需加 |

**结论**：`dsh-game` 是「**AI 自己玩 + 你可以旁观与插话**」；「**AI 和你一起玩**」在 body 层已具备 80% 的零件，在 product 层是 0%。

---

## 3. 「大肥鱼」IP 考古

### 3.1 大肥鱼不是人，是 DeepSeek 的社区二创形象

**证据链（可核查，来自 `dsh-game` 自己的素材许可文件，这是目前最权威的一手说明）**：

> 形象原型：**上善无形**的原创角色「**溟月**」；**ZipZipPipe** 在此基础上画出了带 DeepSeek 元素的女仆鲸鱼娘，社区称为「**大肥鱼**」。
> 设定图、六视图的作者：上善无形、ZipZipPipe、YunYueSama、xiaoweigen。资料来自这些社区仓库：
> - [xiaoweigen/deepseek-dafeiyu-assets](https://github.com/xiaoweigen/deepseek-dafeiyu-assets)（CC BY-NC-SA 4.0）
> - [xxnb0/deepseek-chan-fanpack](https://github.com/xxnb0/deepseek-chan-fanpack)（主体 CC BY-NC-SA 4.0）
> - [treapgogo/deepseek-whale-girl](https://github.com/treapgogo/deepseek-whale-girl)（设定图 CC BY-NC-SA 4.0）
>
> 以上设定图作为参考，先用字节跳动 Seedream 生成 Q 版全身立绘，再用 Seedance 以立绘为首尾帧生成各表情短片，最后抠成透明背景。
> —— `packages/dsh-game/assets/dafeiyu/LICENSE.md`

**辅助证据**：百度百科有独立词条「大肥鱼」（副标题「**DeepSeek 图标的衍生二创形象**」）与「鲸鱼娘」（副标题「**DeepSeek 的拟人化网络形象**」）。*注：baike 页面直接抓取返回 403（百度安全验证），副标题来自搜索引擎索引，未能读到正文。*

**命名由来**（多处一致）：DeepSeek 的鲸鱼 logo + 「吃 token」的梗 → 「太能吃，所以叫大肥鱼」。`dsh-game` 的 persona 原文：

> 你是 DeepSeek，大家叫你「大肥鱼」——一条爱吃白饭的鲸鱼娘。主人花钱烧 token 让你玩电脑上的游戏，主人在旁边看你玩。

mcmod `[bff]` 的角色卡也是同一套设定（「最爱吃的食物是『大米饭』（Token），因为太能吃，所以被大家称作大肥鱼，但你一直强调自己是『鲸鱼』，是哺乳动物！」）。

**重要法务提示**：大肥鱼形象与动画是 **CC BY-NC-SA 4.0**（署名、**非商业**、相同方式共享）。**若本项目要做商业产品，不能直接用这些素材**；需联系原作者或另做形象。

### 3.2 时间线（可核查事件）

| 日期 | 事件 | 来源 |
|---|---|---|
| 2026-08-19 | B站 `BV1wWbd6KEth`「大肥鱼燃烧 1.3 亿 Token 做的 MC 模组到底有多强？？」发布（SandWalls，**341,674 播放**，4,379 赞，273 秒）。描述只有一句「第一次用 AI 做东西，费了不少 Token」 | B站 API |
| 2026-08-19 | npm 包名 `dsh-game` 被 `dushaobindoudou` 注册（占位，非本项目） | npm registry |
| **2026-09-23** | **`Pal-AI-Lab/Coopanion` 仓库创建**——「大肥鱼桌宠」的宿主产品起点 | GitHub API |
| 2026-10-14/15 | `blacksunshy/coopanion-fatfish`（**大肥鱼功能复合包**）仓库创建 + npm 首发 `0.2.0` | GitHub / npm |
| 2026-10-18 | `luckui/dsh-game` 创建，首个 commit「dsh-game: let your DeepSeek Harness agent play games」 | git log |
| 2026-10-20 | B站 `BV1ednc6jE3j`「分享自己给大肥鱼做的一系列插件，以及长期养鱼的心得」（湖上的优尤，**584,656 播放**） | B站 API |
| 2026-10-24 | B站 `BV1nJHK6gEtd`「花 4 毛钱让 1000 个蓝色大肥鱼建造故宫」（**3,571,950 播放**，170,320 赞）——大肥鱼 MC 内容的播放峰值 | B站 API |
| **2026-10-24~26** | **`dsh-game` 三天冲刺：49 个 commit**（22+26+3），MC 身体从 `hiyoriai` 搬入 | git log |
| 2026-10-25 | linux.do 帖「最近抖音怎么大肥鱼突然爆火」（734 浏览）——抖音「量产大肥鱼直播间」现象开始 | linux.do |
| 2026-10-28 | B站 `BV1eAs96TEM2`「我做了个插件，让大肥鱼能陪我打电话、看视频、打游戏！」（湖上的优尤，**148,242 播放**）→ 仓库 `Yuuyuko-uu/dsh-fish-buddy` | B站 API / desc |
| 2026-10-29 | linux.do 帖「抖音大肥鱼直播」（849 浏览） | linux.do |
| 2026-10-29 | mcmod 收录 `肥鱼连线 (CooLink)`（推算，词条显示「收录 18 天前」） | mcmod |
| 2026-10-30 | `Yoshino-JF/dafeiyu-mc` 创建（「大肥鱼：会自己玩 Minecraft 的 AI 陪玩角色」，基于 Mindcraft） | GitHub API |
| 2026-11-01 | linux.do 帖「抖音上现在正在量产的大肥鱼直播间都是基于什么项目的？」（343 浏览） | linux.do |
| 2026-11-03 | `dafeiyu-mc` v1.0.2 发布（457 MB，18 次下载） | GitHub releases |
| **2026-11-04** | **`LingLuoYv63/Big-Fat-Fish` 创建**（2 个 commit，全是 "Add files via upload"） | GitHub API |
| 2026-11-06 | PalAILab **官方** B站教程「大肥鱼桌宠入门教程…【B站AI创造公开赛】」（30,357 播放） | B站 API |
| **2026-11-07** | **B站 `BV1ZH456BENv`「当你把大肥鱼接入到网页版 MC…」——1,342,168 播放、91,433 赞、121,505 投币、86,556 收藏**。但它是**B站网页版 MC（toy/OpusMC）**，不是 Java 版 | B站 API |
| 2026-11-09 | linux.do 帖「大肥鱼抖音直播 demo 开源」（403 浏览） | linux.do |
| 2026-11-10 | `Dwinovo/minecraft-numen` v0.1.5 十版本齐发 | GitHub releases |
| **2026-11-15** | **mcmod 收录 `[bff]大肥鱼AI聊天`**（词条显示「收录 1 天前」） | mcmod |
| 2026-11-16 | Coopanion v0.2.21；`cortico-world-fatfish` npm 0.6.26；**`dsh-game` 距最后提交 21 天** | 各源 |

### 3.3 三个「大肥鱼 MC」的关系图

```
        大肥鱼（DeepSeek 鲸鱼娘二创形象，CC BY-NC-SA）
         │
    ┌────┴─────────────────────────┬───────────────────────┐
    │                              │                       │
【A】桌宠宿主路线                【B】Bot 路线            【C】Mod 路线
Coopanion 3,155★ 113万下载      dsh-game 14★            mcmod [bff] 173 浏览
  │  (AGPL-3.0, 桌宠本体)          (MIT, DSH 插件,          (MIT, Forge 1.20.1,
  │   无任何 MC 代码)               mineflayer bot)          纯聊天, 无动作)
  ├─ cortico-world-fatfish 29★        │                       │
  │    「大肥鱼功能复合包」            └─ 摄像机 + 34 动作      └─ 作者 LingLuoYv
  │    DSH 对话/语音/TTS                                       声明：与 CooLink 无关
  ├─ coopanion-connector-dsh 23★
  │    DSH ↔ 桌宠 WebSocket 桥
  └─ 肥鱼连线 CooLink（**闭源**，抖音乡贼）
       Forge 1.20.1，客户端+服务端
       MC ↔ 本地 Coopanion（127.0.0.1）
       把游戏状态每 2 秒写进 MC/live.md

        【D】另一个"大肥鱼陪玩"：Yoshino-JF/dafeiyu-mc 1★（Mindcraft 分支）
             .exe 启动器 + Paper + Node22 + Java25，MC 26.1.2，27 次下载
```

**回答「它们是不是同一个大肥鱼」**：
- **形象是同一个**（DeepSeek 鲸鱼娘二创），四者都在用。
- **代码完全无关**。`[bff]` 作者 `LingLuoYv` 在 mcmod 词条里**主动声明**「与『肥鱼连线』（CooLink）并非为同一作者」——正因为社区把它们混为一谈。
- **CooLink 与 Coopanion 的关系**：CooLink 是**第三方**给 Coopanion 写的 MC 桥（Coopanion 官方 README **完全没有提 Minecraft**，我 grep 过 `Minecraft` 零命中）。作者 `抖音乡贼` 与 Pal-AI-Lab 是否有关：**未验证**。
- **`dsh-game` 与 Coopanion 的关系**：无关。`dsh-game` 是**另一条并行路线**（DSH 插件 + mineflayer），只是借用了同一个形象、同一个称谓。

### 3.4 社区热度 vs 工程成熟度：严重错位

| 维度 | 数据 |
|---|---|
| 大肥鱼 MC 内容的**播放量** | 单条最高 3,571,950（BV1nJHK6gEtd）；「网页版 MC」1,342,168；「1.3 亿 Token 模组」341,674；「陪打电话/看视频/打游戏」148,242 |
| 大肥鱼**桌宠产品**下载量 | Coopanion 累计 **1,134,163**（最新 30 个 release），单版 Windows 安装包 4,369 |
| 大肥鱼**桌宠**社区规模 | PalAILab 官方 B站 11,048 粉；QQ 群 5 个（多数已满）；第三方插件生态 **193 个** GitHub 仓库含 "coopanion" |
| 大肥鱼**MC 方向**的工程 | `dsh-game` 14★、`dafeiyu-mc` 1★、`[bff]` 0★、CooLink 闭源 1057 浏览 |
| 抖音生态 | linux.do 至少 5 个帖讨论「量产大肥鱼直播间」，多人质疑「抖音禁止无人直播」、怀疑是「引流卖教程」 |

**判断**：大肥鱼是 **2026 年秋的现象级 DeepSeek 二创 IP**，桌宠本体已经很成熟（百万下载），但**「大肥鱼 玩 MC」这条细分方向仍是散兵游勇**——没有任何一个项目同时做到「高 star + 有 release + 多人 + 语音 + 动作」。这正是空档。

---

## 4. 对照物：mcmod `[bff]大肥鱼AI聊天` 技术解剖（降级为对照）

> 词条：<https://www.mcmod.cn/class/32872.html>　class id 32872　作者 LingLuoYv（mcmod uid 1405220）
> 快照：收录 2026-11-15（词条显示「1 天前」）、最后编辑 2026-11-15、总浏览 **173**、昨日指数 115、等级 1.0「默默无闻」
> 平台 Java / **Forge** / **客户端需装，服务端无效** / MC 版本仅 **1.20.1**（1 个版本）/ 标注「开源」

### 4.1 仓库事实

| 项 | 值 |
|---|---|
| `LingLuoYv63/Big-Fat-Fish` | **0★ / 0 fork / 0 watcher / 0 issue** |
| commit | **2 个**（`Initial commit` 2026-11-04T13:50:29Z，`Add files via upload` 2026-11-04T14:25:25Z） |
| release / tag | **0 / 0** |
| license | **MIT** |
| 体积 / 语言 | 83 KB / Java **36,413 字节** |
| 文件构成 | **仅 8 个 .java**：`AiClient` 5,802 / `BigFatFishAI` 660 / `ChatHandler` 9,073 / `ClientEvents` 1,749 / `Config` 7,933 / `ForgeEvents` 3,415 / `GameSession` 6,099 / `NetworkHandler` 1,682 |

### 4.2 致命发现：这个仓库**不可构建**

仓库根目录只有三项：

```
.gitignore     file
LICENSE        file
java/          dir     ← 直接就是 java/com/bigfatfish/bigfatfishai/*.java
```

**没有** `build.gradle`、`settings.gradle`、`gradle.properties`、`gradlew`、`src/main/resources/META-INF/mods.toml`、`pack.mcmeta`、`mixins.json`、`assets/*/lang`。

→ **无法编译出可加载的 Forge mod**（没有 `mods.toml`，Forge 根本不会认这个 jar）。所谓「开源」实际是**源码片段公开**，不是可复现工程。CurseForge 上那个 jar 对应的构建文件没有公开。

**顺带**：`ClientEvents` 注册了 `key.bigfatfish.cancel_ai` 翻译键，但仓库没有 `lang` 文件——按键设置界面会显示原始 key 字符串。

### 4.3 架构自相矛盾

全部业务逻辑写在**服务端事件**上（`ServerChatEvent` / `ServerPlayer` / `MinecraftServer` / `ServerTickEvent`），但发布形态是「**客户端需装、服务端无效**」。唯一客户端代码是 K 键。

→ 推断（**未取到 jar 里的 mods.toml，属推断**）：发布 jar 的 `mods.toml` 把 `side` 标成 `CLIENT`。于是：

- **单人**：客户端 JVM 里同时跑集成服务器，`ServerChatEvent` 照常触发 → 能工作。
- **真多人服**：服务端没装这个 mod，事件根本不发生 → 完全失效。

**这就是「无法多人游戏」的真正原因**，不是「适配性不足」，是**架构就装反了**。mcmod 词条把它描述成「采用了监听玩家在聊天框发送消息的方式，造成多人游戏体验完全不佳」——实际是**多人游戏里它什么都不做**。

### 4.4 代码级缺陷清单

| # | 缺陷 | 位置 | 影响 |
|---|---|---|---|
| 1 | **对话历史全局共享**：`private static final List<JsonObject> HISTORY`，**不按 UUID 分桶** | `GameSession.java:18` | 同一 JVM 内两个玩家共享一条对话；配合上一条，LAN 场景会出现串话 |
| 2 | **无流式**：`HttpResponse.BodyHandlers.ofString()` 阻塞等到完整响应 | `ChatHandler.java` `callAI()` | `deepseek-reasoner` 思考期可达数十秒 → **这才是「打断思考 K 键」存在的真实原因**，不是设计选择 |
| 3 | **记忆功能是空壳**：`requestDiary()` 恒 `return null`（注释「占位，下一轮实现日记请求」）→ `writeDiary()` 永不落盘 → `loadRecentDiaries()` 永远读不到东西 | `AiClient.java:末尾`、`GameSession.java` | Config 里 4 个 diary 项 + `ENABLE_DIARY` 默认 `true`，**全是死配置** |
| 4 | **无 TTS / 无 ASR**：全仓库零音频代码 | — | 纯文字聊天 |
| 5 | **无任何动作能力**：无 Entity、无 FakePlayer、无寻路、无 Baritone、无 Level 交互 | — | 「AI 不会动」 |
| 6 | `testConnectionAsync` 发 `max_tokens: 1` 的 `"ping"` | `AiClient.java` | 部分服务商会因此计费/报错 |
| 7 | `isOnCooldown()` 是有副作用的 getter（未冷却时写入时间戳并返回 false） | `GameSession.java` | 命名误导，逻辑本身正确 |

### 4.5 可复用的部分

| 可抄 | 说明 |
|---|---|
| `Config.java` 的 `ForgeConfigSpec` 写法 | 22 个配置项，分 5 组，每项带 `comment()` 多行说明与示例 URL（OpenAI / DeepSeek / Groq / Ollama）。这是**教科书级的 mod 配置 UX**，可直接照抄模式 |
| `AiClient.explainError()` | HTTP 状态码 → 中文原因映射（400/401/402/403/404/422/429/500/502-504），并抽取 `error.message` 拼在括号里。实用 |
| 默认角色卡 | 鲸鱼娘 persona，多行文本块 |
| `CancelPacket` 打断模式 | 客户端按键 → 空包发服务端 → 服务端置 `CANCELLED` → 回主线程时丢弃结果。**这个模式本身值得抄**（只是该配流式） |
| 不能抄 | 对话 UI（没有，用原版聊天栏）、记忆系统（空壳）、构建工程（不存在） |

### 4.6 结论

**8% 可复用。** 它是一个新人作者 3 天写出的「能跑的最简 LLM 聊天 mod」，价值在于**配置 UX 与错误文案的示范**，不在于架构。它**不能**作为底座：不可构建、客户端限定、无动作、无多人、无流式、记忆是假的。

---

## 5. 横向同类项目表

> 全部 star / 下载量为 **2026-11-16** 快照。CurseForge 下载量统一**未取到**（Cloudflare 403 或 JS 渲染，见 §7）。

### 5.1 第一梯队：真正能跑的「AI 在 MC 里自主行动」

| 项目 | 形态 | star | MC 版本 / 加载器 | 许可 | 多人 | 语音 | 动作 | 发布 / 下载 | 风评 / 备注 |
|---|---|---|---|---|---|---|---|---|---|
| **`Dwinovo/minecraft-numen`**<br>言出法随 | **Mod**（Java，游戏内具身 agent） | **611** / 70 fork | **12 个版本**：1.20.1/1.20.2/1.20.4（Fabric+Forge）、1.20.6–1.21.11（Fabric+NeoForge）、26.1.2/26.2（Fabric+NeoForge） | **LGPL-3.0**（素材另议） | ✅「双端模组，服务端与客户端都安装后即可在联机服中使用。每位玩家使用自己的 API key」 | ✅ 输入+输出 | ✅ **Lua 原子动作 API**（感知/移动/挖掘/建造/交互）+ 少量 Java 工具（加载技能） | **100 个 release / 200 个 asset / 累计 5,545 次下载**；CurseForge project **1581109** | 最强竞品。官网 numen.dwinovo.cn、QQ 群 1121662678、Discord。作者 B站 万圣Dwin 6,130 粉，教程 `BV1YJ336EEBk` **89,078 播放**。**可作为 MCP 服务器被外部 agent 驱动**（Claude Code / Codex / Cursor） |
| **`luckui/dsh-game`** | **DSH 插件 + mineflayer bot** | 14 / 4 fork | 不限（Server List Ping 协商，mineflayer 4.39.0 覆盖范围） | **MIT**（动画 CC BY-NC-SA） | ⚠️ 同服可，但 `duo` 禁用 | ✅ 出（豆包 TTS），❌ 入 | ✅ **34 个高级动作** + 图纸建造 | **0 release，未上 npm** | 本报告主角。52 commit / 3 天 / 1 人 / 21 天未更新 |
| **`mindcraft-bots/mindcraft`** → `Yoshino-JF/dafeiyu-mc` | **Bot + 桌面启动器**（Node + WebView2） | 1 / 0 fork | **MC 26.1.2**（启动器自带 Paper + Java 25） | **MIT** | ⚠️ 单 bot 接入服 | ✅ 可选（阿里云百炼）+ 千问向量做参考对话检索 | ✅ mineflayer 全套 + 记忆/技能自写 | **3 个 release，合计 27 次下载**（v1.0.2 18 / v1.0.1 7 / v1.0.0 2），457 MB | 名字最贴「AI 陪玩」。`bots/DaFeiYu/` 存记忆/教训/地点/自写技能/战斗记录/复活点。docs 目录异常丰富（INTERFACES/PLAN/VOICE/memory-schema/minebot-diff/log-spec/metrics-said-vs-did + 3 天验收报告） |
| **`yc-software/minecraft-agent-harness`** | Bot 框架 | **223** / — | 不限 | — | — | — | mineflayer tools + persistent sessions + shell sandboxes | — | 2026-10-29 更新 |

### 5.2 第二梯队：桌宠 / 陪伴层（MC 只是场景之一）

| 项目 | star / 下载 | 许可 | MC 支持 | 语音 | 备注 |
|---|---|---|---|---|---|
| **`Pal-AI-Lab/Coopanion`** | **3,155** / 128 fork；**累计 1,134,163 次下载**（最新 30 release）；单版 Windows 安装包 4,369 | AGPL-3.0（API 报 NOASSERTION） | ❌ **README 无 Minecraft** | ✅ 本地 ASR（FunASR 230 MB / Whisper 360 MB）+ 说话键 | 桌宠本体。看屏幕、点击、打字（computer use）、`PARTNER.md` 记忆、11 语言、OBS 源、World 扩展市场。**MC 靠第三方** |
| `blacksunshy/coopanion-fatfish`（大肥鱼功能复合包） | 29 / 5 fork；npm 0.6.26（2026-11-16） | AGPL-3.0 | ❌ | ✅ 19 Edge TTS 音色 + 可插拔 HTTP 引擎 | DSH ↔ 桌宠桥接，**大肥鱼 IP 的官方扩展位** |
| `blacksunshy/coopanion-connector-dsh` | 23 / 3 fork | — | ❌ | — | DSH Host 插件，`ws://127.0.0.1:19387/coopanion/pet` |
| `Yuuyuko-uu/dsh-fish-buddy`（鱼搭子） | **65** / 4 fork | 代码未标，素材不单独授权 | ⚠️ 截图/陪看，非 MC 内 | ✅ DSH 会话 TTS | Python tkinter 挂件 + DSH 插件，`127.0.0.1:8777`，PP-OCRv6（Apache-2.0）。B站 148,242 + 584,656 播放 |
| `yuanstarstar/dsh-game-stack` | 46 / 4 fork，MIT | MIT | ⚠️ 通用「眼睛和手」 | ✅ | 5 个 bundle：眼睛和手 / 脑子 / 眼力 / 嘴 / 腿。一帧 140–216 ms。B站 146,565 播放 |
| `takboo/dsh-coopanion` | 18 | — | ❌ | — | DSH 桌宠移植 |
| `Xiaxin1235/dsh-coopanion` | 0 | AGPL-3.0 | ❌ | — | 同上（另一份） |
| `himoew/DeepSeekPet` | 12 | AGPL-3.0 | ❌ | — | 大肥鱼桌宠衍生 |
| `kiven72/DaFeiYu-ZhuoChong-Alpha` | 11 | — | ❌ | — | 离线版大肥鱼桌宠 |

### 5.3 第三梯队：中文 AI VTuber / 直播机器人

| 项目 | star | 语言 / 许可 | 最后更新 | MC 能力 | 语音 | 备注 |
|---|---|---|---|---|---|---|
| **`AkagawaTsurunaki/ZerolanLiveRobot`** | **833** / 71 fork | Python / MIT | **2026-04-14（停滞 7 个月）** | ⚠️ 由 `KonekoMinecraftBot` 承担：mineflayer + **有限状态机**（打怪/砍树/睡觉），语音指令控制 | ✅ LLM+ASR+TTS+OCR+CV | 生态完整：ZerolanCore（推理服务）/ ZerolanData（接口）/ ZerolanPlayground（**Unity + Vuforia 的 AR 形象展示器**）。要求至少一张消费级显卡。作者 B站 赤川鹤鸣_Channel |
| `AkagawaTsurunaki/KonekoMinecraftBot` | 44 / 14 fork | TypeScript | 2025-12-22 | ✅ mineflayer + FSM + DB-Scan + 单层感知机 | — | 只有 538 KB，小而完整 |

### 5.4 第四梯队：同类但很弱 / 只有演示

| 项目 | star | 说明 |
|---|---|---|
| `Goodbird-git/Player2NPC` | 21 / 21 fork | PlayerEngine 框架的 showcase，Java，2026-01 后停更 |
| `bingdongni/MineAgent` | 2 | Java / LGPL-3.0，1.21.1，自主生存+寻路+工具+记忆 |
| `NemoKing1210/Friendai` | 1 | Fabric / MIT，聊天或**语音**对话，跟随/取物/走路/挖矿 |
| `zee110413-ui/altron` | 2 | Apache-2.0，Java mod（Forge/Baritone）+ Python brain，语音+视觉 |
| `mazamaka/maxbob-minecraft-companion` | 1 | **闭源** showcase，`mc.maxbob.xyz`，Forge mod + LLM planner + 签名 Windows 启动器 |
| `espresso95/minecraft-companions-mod` | 0 | Fabric 客户端面板 + Paper 桥，token 监控 |
| `cflaaa/minecraft-numen-1.16.5` | 0 | Numen 的 **1.16.5 非官方移植**（「LLM AI companions as server-side fake players, driven via MCP」） |
| `legomaster188/aiciv` | 0 | Fabric 26.3，LLM AI players 作为**服务端假玩家**，「No client mod needed」 |
| `yiwan4403-oss/daifeiyu` | 0 | 大肥鱼 · Resident，AGPL-3.0，Python，「Minecraft、QQ、CLI 只是她的不同居所」 |
| `KHomo-514/ChineseChess` | 0 | 1.21.1 NeoForge 象棋，作者「大肥鱼吃白饭」 |
| `AhmadTariq1337/minecraft-mcp-server` | 1 | 纯 MCP server，给任意 agent 手/眼/腿 |

### 5.5 关键洞察：三条技术路线的取舍

| | **Bot 路线**（dsh-game / mineflayer） | **Mod 路线**（Numen / bff） | **桌宠桥路线**（CooLink + Coopanion） |
|---|---|---|---|
| 版本绑定 | **无**（协商） | 强（12 版本 × 2 loader 才能说「通用」） | 强（Forge 1.20.1） |
| 客户端改动 | **零** | 必须装 | 必须装 + 装桌宠 |
| 多人 | 天然是「一个玩家」 | 需专门设计（Numen 做到了） | **设计得最好**（@ 别人的桌宠） |
| 视觉 | ❌ 无画面（需另做） | ⚠️ 客户端侧可以截 | ❌ 无 |
| 动作质量 | 中（高级技能，mineflayer 生态成熟） | **高**（Numen 的 Lua 原子动作 + 假玩家） | 低（纯聊天 + 状态同步） |
| 语音 | 外挂（TTS 独立） | 外挂 | **原生**（桌宠本来就会说话） |
| 工程门槛 | **最低** | 高（Java + 多版本构建） | 中 |
| 谁最适合本项目 | ✅ **首选** | 若要「真·实体在游戏里」 | 若要「陪伴感 + 多人社交」 |

---

## 6. 可复用性判定 + 自研工作量拆解

### 6.1 复用度评分

| 对象 | 复用度 | 理由 |
|---|---|---|
| **`luckui/dsh-game`（整体当底座）** | **72%** | 见下拆解 |
| ├ 作为「MC 身体 + 动作层」 | **85%** | mineflayer 全套 + 3 个补丁 + 34 动作 + 建造/农业/下界 + 自测 110 KB，换成别的语言重写要 1–2 人月 |
| ├ 作为「摄像机 / 直播层」 | **90%** | 真客户端 + `quickPlayMultiplayer` + RCON `spectate` + 跟拍机位 + HUD 叠加，几乎是独一份 |
| ├ 作为「agent 工具设计」 | **75%** | 3 工具 + 动态动作词表很省 token；但缺 schema 约束、缺「一次写程序做多步」 |
| ├ 作为「陪玩交互层」 | **35%** | `solo` 硬编码，`duo` 未做，`ownerName` 死配置，无 ASR，无多玩家关系 |
| └ 作为「可发布的工程」 | **20%** | 0 release、未上 npm、包名被占、21 天未更新、单人维护、中文注释为主 |
| **`LingLuoYv63/Big-Fat-Fish`（mcmod bff）** | **8%** | 不可构建 + 客户端限定 + 无动作 + 无多人 + 无流式 + 记忆是假的 |
| **`肥鱼连线 CooLink`（架构参考）** | **70%（只能参考）** | 闭源。但「mod 只做状态桥 + 智能在桌面 agent + 2 秒写状态文件」是本项目最该学的架构 |
| **`Pal-AI-Lab/Coopanion`（陪伴层）** | **60%（但许可受限）** | 3,155★、百万下载、ASR/TTS/记忆/computer use 全都成熟；**AGPL-3.0 + 素材 CC BY-NC-SA，商用要先解决许可** |

### 6.2 「照抄大肥鱼（dsh-game）」会长什么样

**会得到的：**
- 一个 DSH 插件，侧边栏点「游戏」→「▶ 让大肥鱼玩」
- 一个叫 `DaFeiYu` 的 bot 进你的服务器，自己定目标、砍树、挖矿、盖房子、种地、去下界
- 一个真实 MC 客户端窗口旁观跟拍她，叠着自己画的 HUD
- 她边玩边用豆包语音说话，11 段表情动画
- OBS 能抓这个窗口直播
- 每个世界一本日志，下次接着玩

**会缺的：**
1. **「一起玩」**——她是主角，你是观众。想让她跟着你、听你指挥、主动找你说话，得自己接 `duo`。
2. **语音输入**——你只能打字，不能说话。
3. **多人社交**——她只认一个「主人」，其他人对她是陌生人（甚至会被 `attack`）。
4. **视觉**——她看不到游戏画面（只有俯视图），所以做不了「你看这个」这类指代。
5. **可发布的形态**——没有 release、没上 npm、包名被占、一个人维护。
6. **商用许可**——形象动画 CC BY-NC-SA，**不能商用**。
7. **中文硬编码**——prompt、动作描述、错误文案全是中文写死在源码里，做多语言要重构。

### 6.3 「让 AI 和我一起玩」要加什么（具体到文件与接口）

> 前提：`duo` 的**全部底层零件**已经在 body 里，缺的是接线与交互层。

#### 阶段 0：接通已有的东西（**0.5–1 人日**）

| # | 改什么 | 具体位置 |
|---|---|---|
| 1 | 放开 `solo` 硬编码 | `setup.ts:74-76` 的 `mode: 'solo'` → 读 `raw.mode`；`mcsetup.tsx` 放开 mode 选择 |
| 2 | 把 `ownerName` 传下去 | `runtime.ts:417-429` 的 `new MinecraftSession({...})` 增加 `owner: setup.ownerName`；`MinecraftOptions` 加字段 |
| 3 | `companion: true` + 传 owner | `session.ts:288-293` → `companion: true, owner: this.options.owner` |
| 4 | 验证 `resumeFollowing()` 生效 | `workerEntry.ts:192-243`：owner 存在且无任务时，默认行为应为 `follow_player(owner)` |
| 5 | prompt 加「同伴」人设 | `cordis.patch.yml` 的 persona prefix + `session.ts:253-273` 的 `facts`：把「你自己决定玩什么」改成「跟着主人，主人说话就回应」 |

**验收**：进服后 bot 自动跟在你身后 ≤3 格；你走它走；你停下它停在附近；`follow` 相位在 `nearby`/`approaching` 之间切换（`workerEntry.ts:500-510`）。

#### 阶段 1：交互层（**3–5 人日**）

| # | 要做的 | 建议实现 |
|---|---|---|
| 6 | **游戏内指令语义** | 在 `session.ts` 的 `【游戏聊天】` 事件里加意图识别：`跟我来 / 别跟着 / 挖这个 / 放这里 / 打它 / 等我` → 直接映射到 `ACTIONS`（`follow` / `stop` / `dig` / `place` / `attack`）。**不要全交给模型**，高频指令走规则更快更稳 |
| 7 | **主动发起** | 新增 `MOMENT` 触发源：主人上线/下线、主人靠近/远离、`player-gaze` 触发、玩家血量低、玩家死亡 → 主动说一句。`playerGaze.ts` 的产物现在没被用，接上就是「你盯着她看，她会问你干嘛」 |
| 8 | **指代解析** | 主人说「这个/这里」时，用 `owner` 的 `yaw/pitch` 做 raycast 得到目标方块（复用 `playerGaze.ts` 的 `measurePlayerGaze` 思路），而不是让模型猜 |
| 9 | **一动作一往返 → 批处理** | 现在 `game_act` 一次一个动作。参考 Numen：加一个 `game_plan` 工具，收 `[action, action, ...]` 数组顺序执行，减少模型往返（对「跟我来顺便砍点树」这类复合指令必要） |

#### 阶段 2：语音（**1–2 人周**）

| # | 要做的 | 建议实现 |
|---|---|---|
| 10 | **ASR** | Coopanion 已经内置 FunASR（230 MB）/ Whisper（360 MB）本地识别，走 `127.0.0.1` HTTP。要么复用它的服务，要么自己接 `faster-whisper` + VAD |
| 11 | **TTS 换本地** | 现在是豆包云（要付费 key）。`coopanion-fatfish` 已经做了可插拔 TTS（`engine: 'http'`，POST `{input, voice, speed}` → wav/mp3 + `fallbackEdge`），直接照这个接口约定做，可换 GPT-SoVITS / Edge-TTS |
| 12 | **打断** | 「说话键」打断她当前发言 —— Coopanion 的 `tts_hush` / `speak()` 链路已有现成实现可参考（`agent.ts:76-89` 的 `withMic` 是同一思路） |
| 13 | **延迟预算** | 目标 <1.5 s。建议：VAD 本地 → ASR 流式 → LLM 首 token → TTS 首句（**分句流水线**，`coopanion-fatfish` 的 `sentencePipelineEnabled` 就是这个） |

#### 阶段 3：视觉（**3–5 人日**，可选）

| # | 要做的 | 建议实现 |
|---|---|---|
| 14 | **第一人称截图** | 摄像机客户端已经在跑。最省的办法：给摄像机客户端加一个轻量 mod（或 `/tp` 到固定机位 + 外部截屏），按需截图 → 作为 `image` 附件进 `game_continue`。**注意 token 成本与延迟** |
| 15 | **替代方案（更省）** | 扩展现有 `look`：把 65×65 俯视图换成 / 增加「以她为原点的 16×16×16 体素切片图」+「主人视线方向的 raycast 结果文本」。多数「你看这个」场景**不需要真视觉** |
| 16 | **指代锁定** | 主人指着某方块时，直接把方块 id + 坐标塞进 moment 的 `notes`，比让模型看图更可靠 |

#### 阶段 4：多人 + 可发布（**1–2 人周**）

| # | 要做的 |
|---|---|
| 17 | **多玩家关系模型**：`Map<playerName, {role: 'owner'|'friend'|'stranger', affinity}>`；`ownerName` 之外再加白名单；对 stranger 默认不攻击、不跟随 |
| 18 | **`@` 语法**（学 CooLink）：`@大肥鱼 过来` 才触发，避免刷屏 |
| 19 | **发布**：`dsh-game` 包名被占 → 改 `@luckui/dsh-game` 或 `dsh-game-mc`；加 GitHub Actions 出 release；补英文 README |
| 20 | **许可清理**：换掉 CC BY-NC-SA 动画（或联系原作者拿商用授权）；AGPL 依赖（若引入 Coopanion 代码）要评估传染性 |

**总计**：阶段 0+1（能「一起玩」的最小可用）≈ **2–3 人周**；加语音 ≈ **4–5 人周**；加多人+发布 ≈ **6–8 人周**。

### 6.4 三个方案的最终建议

| 方案 | 做法 | 适用 | 工作量 | 风险 |
|---|---|---|---|---|
| **① 抄 dsh-game（推荐）** | fork → 阶段 0+1 → 自己发布 | 要「AI 跟我一起玩」，且接受 mineflayer 的动作粒度 | 2–3 人周出 MVP | 上游 21 天未更新、单人维护；需自己接手 |
| **② 用 Numen 当底座** | 它支持 **MCP 外接大脑** → 把 DSH 当大脑，不用自己写身体 | 要「AI 在游戏里是真实体、动作质量高」；能接受装 mod | 1–2 人周（MCP 对接） | LGPL-3.0；Lua 沙箱要学；版本要跟（12 个版本） |
| **③ 学 CooLink 架构** | mod 只做状态桥（2 秒写 `live.md` + 事件推送），智能全在桌面 agent | 要「陪伴感 + 多人社交」，且愿意写 Forge mod | 4–6 人周 | CooLink 闭源无参考实现；Forge 1.20.1 版本绑定 |
| **④ 抄 mcmod bff** | ❌ 不建议 | — | 等于从零 | 不可构建、无动作、无多人 |

**一句话**：**MC 的「身体」用 dsh-game（或 Numen），「陪伴感」学 CooLink，「语音」抄 Coopanion 的接口约定，三者拼起来就是用户要的东西。**

---

## 7. 未验证清单

| # | 未验证项 | 原因 | 建议怎么补 |
|---|---|---|---|
| 1 | **用户看到的到底是哪一个「大肥鱼陪玩 MC」** | 同名指代至少 5 个（§1.1、§3.3），无法从文字判断 | **直接问用户**：是「AI 自己玩、我在旁边看」还是「AI 跟我一起玩」？是 Java 版还是网页版？有没有见过摄像机窗口？ |
| 2 | CurseForge 上 `big-fat-fish` / `coolink` 的**下载量与更新日期** | Cloudflare 403「Just a moment...」；`api.cfwidget.com` 两个 slug 均 404 | 用浏览器手动看，或申请 CurseForge API key |
| 3 | `[bff]` mod 发布 jar 里的 **`mods.toml` 的 `side` 设置** | 仓库无该文件。§4.3 的「客户端限定」是**从 mcmod「客户端需装/服务端无效」推断**，未见原件 | 下载 CurseForge jar 解包看 `META-INF/mods.toml` |
| 4 | `[bff]` **是否真的在 CurseForge 上线** | 链接存在但 403，无法区分「存在但被 Cloudflare 拦」与「404」 | 同上 |
| 5 | `抖音乡贼` 与 `Pal-AI-Lab` 的**关系**；CooLink 是否官方 | mcmod 只写作者名；Coopanion 官方 README 无任何 MC 字样 | 查 Coopanion 的 World 扩展市场列表、Discord |
| 6 | **CooLink 与 Coopanion 的通信协议** | mcmod 只说「每 2 秒写进她工作区的 `MC/live.md`」「只连 127.0.0.1」，未说回传通道（HTTP？文件？WS？） | 抓 CooLink jar 反编译，或用 Process Monitor 看它连什么端口 |
| 7 | **大肥鱼的原始形象作者** | `dsh-game` 的 LICENSE 说「原型上善无形的溟月，ZipZipPipe 画成鲸鱼娘」；B站 `BV1bAWn6NEpr` 描述说「鲸鱼娘形象作者：@ZipZipPipe / 表情包：@赤风RED」——**两处说法不完全一致** | 查 `xiaoweigen/deepseek-dafeiyu-assets` 的 commit 历史与 README |
| 8 | `dafeiyu-mc` 用的 **Mindcraft 上游版本** | `package.json` 的 `name` 是 `mindcraft`，但没写 fork 自哪个 commit/版本 | diff 上游 `mindcraft-bots/mindcraft` |
| 9 | **`hiyoriai` 项目**是什么、`dsh-game` 的 body 有多少来自它 | 只有一条 commit message「bring over the mineflayer body from hiyoriai」和 pnpm 补丁注释 | GitHub 搜 `hiyoriai`；查该 commit 的 diff |
| 10 | `dsh-game` **实际验证过的 MC 版本** | 仓库未声明；只有「协商 + minecraft-data」的机制描述 | 跑 `tools/mc-selftest.mjs`，或看 `test/minecraft-survival.ts` 有没有版本断言 |
| 11 | **B站 `大肥鱼打游戏`（mid=3546707958696755，1,969 粉）是不是 luckui 本人** | 该账号发 dsh-game 相关视频（`BV1Hjn16QEhJ` 118,993 播放「dsh 游戏启动器发布」），但 `x/space/wbi/arc/search` 返回 `-412 request was banned`（需 wbi 签名） | 手动看该 UP 主页简介/置顶 |
| 12 | **`dsh-game` 的 issues / PRs 具体内容** | GitHub API 限流（`core remaining=0`）；`open_issues_count = 0` 已知，但是否有已关闭 issue、有无 PR 未确认 | 限流恢复后查 `/issues?state=all` |
| 13 | **大肥鱼抖音直播的变现规模**（「一天几百块」） | linux.do 帖内多人质疑是「引流卖教程」；自称数据无法核实 | 需要平台侧数据，公开渠道不可查 |
| 14 | Coopanion 的**确切 AGPL 版本** | API 报 `NOASSERTION`；README badge 写 `AGPL-3.0` | 读 `LICENSE` 全文 |
| 15 | **手机摄像头相关**（用户关心的「能否被手机摄像头看到」） | **不在本报告范围**，归子代理 C | — |

---

## 8. 附：本报告的可复现命令

```powershell
# 仓库成熟度（2026-11-16 快照）
curl.exe -s -H "User-Agent: research-agent" https://api.github.com/repos/luckui/dsh-game
# → stars 14, forks 4, open_issues 0, created 2026-10-18T06:05:03Z, pushed 2026-10-26T04:42:30Z

# 全量源码（本报告所有代码级判断的来源）
git clone --depth 1 https://github.com/luckui/dsh-game.git
git fetch --unshallow
git rev-list --count HEAD                 # 52
git log --date=short --pretty=format:"%ad" | Group-Object | Sort-Object Name
```

**本地已留一份完整克隆供复核**（含 `.git` 历史，46.6 MB）：
`D:\研一上\AR_MC\refsrc\dsh-game\`　—　后续要改造/对照，直接在这个目录里看，不必重新 clone。

```powershell
# 关键证据位置（相对 refsrc/dsh-game/）
# packages/dsh-game/src/games/minecraft/setup.ts:4,74-76      ← duo 未实现
# packages/dsh-game/src/games/minecraft/session.ts:96-131     ← 34 个动作
# packages/dsh-game/src/games/minecraft/session.ts:288-293    ← companion:false
# packages/dsh-game/src/agent.ts:259-368                      ← 3 个工具
# packages/dsh-game/src/games/minecraft/body/workerEntry.ts:192-243,455-476  ← 跟随/owner
# packages/dsh-game/src/games/minecraft/body/playerGaze.ts    ← 视线判定（4s/8格/1s）
# packages/dsh-game/src/games/minecraft/body/followCam.ts     ← 跟拍机位算法
# packages/dsh-game/src/games/minecraft/camera.ts             ← 真客户端启动
# packages/dsh-game/src/games/minecraft/rcon.ts               ← 手写 RCON
# packages/dsh-game/assets/dafeiyu/LICENSE.md                 ← IP 授权链

# B站数据（需带 buvid Cookie，否则 412）
curl.exe -s -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.bilibili.com/" `
  -H "Cookie: buvid3=...; b_nut=1700000000" `
  "https://api.bilibili.com/x/web-interface/view?bvid=BV1ZH456BENv"
```

**报告完。**
