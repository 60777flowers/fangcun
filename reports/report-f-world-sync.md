# 报告 F：世界权威、双人（玩家 + AI）同步、AI 建造接口

> 项目：桌面 AR 微缩 Minecraft（手机摄像头看桌面上的 diorama，手机点按建造，大肥鱼在同一个世界里一起建）
> 作者：子代理 F　｜　采样日期：**2026-11-16（北京时间）**　｜　本机：Windows / Node v24.19.0 / npm 11.17.0 / 局域网 192.168.68.54
>
> **测量口径**：本报告里标「实测」的数字，全部来自本机当天跑的脚本，可复现：
> - 脚本 `_tmp/poc/f-probe.js`，原始输出 `_tmp/poc/f-probe-result3.json`
> - 被测服务端：本机 Minecraft **1.20.1** 服务端（`_tmp/poc/mcserver/server.jar`，flat / creative / `online-mode=false` / `view-distance=4` / `enable-rcon=true` / `simulation-distance=4`）
> - 客户端：mineflayer **4.39.0**（`_tmp/poc/node_modules`，与 `dsh-game` 依赖同版本）
> - 星标数：GitHub API 当天已被打满限流，部分沿用同日兄弟代理的抓取缓存 `_tmp/gh_stars.json`（同为 2026-11-16），取不到的写「未取到」，**不编造**

---

## 1. 执行摘要

**世界放哪：选 B —— PC 上跑一个自建的体素世界服务（Node），它持有真值；手机是"渲染 + 输入"客户端，AI 通过同一个服务（或包成 MCP 给 DSH）建造。** 不选 A（手机当权威），因为手机浏览器会在切后台/锁屏/刷新时丢世界，而这个产品最怕的就是"我刚盖的东西没了"；也不选 C（真 MC 服务端 + mineflayer 镜像），因为"玩家在手机上点一下"天生要被代理成一个不在场的 bot，**玩家的意图和游戏的结果之间隔了一层会静默失败的代理**，而且 Q 版大肥鱼、Q 版玩家、桌面 diorama 这三件事在真 MC 里要靠资源包/模组硬改——产品要的"可爱微缩"恰好是 MC 客户端最不擅长的那部分。

**AI 怎么建造：以"结构指令"为主（图纸 DSL / 形状原语 → 本地解释器展开成方块），以"逐块放置"兜底，不开放任意脚本。** 直接证据是 `luckui/dsh-game` 已经把这套跑通了：模型交一张字符图纸（`design`），立刻拿回正面/侧面/俯视三张投影 + 材料清单 + 问题列表（行不齐、悬空、方块名写错），改到满意再 `build`；图纸上限 16×16×12，大而圆的东西（穹顶、圆塔、拱）用形状原语（`box/sphere/cylinder/cone/pyramid/arch/line` + `hollow/open/cut/repeat/mirror/roof`）写。一条 7×6 的木屋图纸在 200 token 量级（实测 210 字符正文 + 5 行图例），而"逐块放 120 块"要 120 次 tool call、6000 token 量级 —— 差一到两个数量级。

**一句话路线**：**B 做现在，C 留后路。** 把 B 里的"世界权威"抽成一个接口（`WorldAuthority`），今天用自建体素实现（可加合成/怪物，但要自己写）；将来真要做生存玩法时，换一个 `McAuthority` 实现（内部就是 mineflayer/RCON + 区块镜像），**手机端渲染、同步协议、AI 建造接口全部不动**。反过来，如果先做 A，世界权威长在手机里，这条路将来要整条重写。

```
┌─────────────┐   ①点击/拖拽（带 seq 的意图）     ┌──────────────────────────────┐
│  手机浏览器  │ ───────────────────────────────▶ │  PC：world 服务（Node）       │
│ three.js AR │ ◀─────────────────────────────── │  · 体素真值 32×32×16          │
│  (WebXR)    │   ④权威增量 {rev,ops,cells}      │  · 仲裁/撤销/快照             │
└─────────────┘                                  │  · 建造工具（fill/mirror…）   │
      ▲ ②乐观本地放置（立刻可见，不等回包）        │  · 玩家行为聚合（Site 模型）  │
      │                                          └──────────┬───────────────────┘
      │                                                     │ ③ build_plan / build_commit
      │                                          ┌──────────▼───────────────────┐
      └──────── ⑤ AI 的建造动画/虚影 ──────────── │  DSH（PC）大肥鱼 agent        │
                                                 │  mcp__mcworld__* （MCP/HTTP） │
                                                 └──────────────────────────────┘
```

**三条硬结论：**

1. **带宽根本不是问题，延迟全在"节拍"上。** 实测 16384 块（正好是 32×32×16 整个 diorama）一次性改完，服务端只发 **26 个 `multi_block_change` 包 / 15616 条记录 / 25.9 KB（压缩后，2 字节/记录）**；AI 盖一栋 5×5×3 的房子（75 块）只花 **75 个 `block_change` 包 / 1199 字节 / 16 字节/事件**。真正花时间的是 MC 的 tick：`/setblock` 从发出到手机上能看见方块，实测 **p50 23.3 ms / p95 31.1 ms**（本机回环），这是"命令排队到下一个 tick + 区块改动在 tick 末 flush"的固有下限。
2. **C 方案里"点了没反应"是结构性的，不是 bug。** mineflayer 的 `placeBlock` 明确区分两种失败：5 秒内服务端没回话（`Server did not answer the placement`）和明确被拒（`Server refused to place`）；而 `dsh-game` 的生存放置流程每块要 `lookAt` → （遇到可交互方块还要蹲 150 ms）→ `placeBlock` → `sleep(200)`，**一块 ≥200 ms 起步**，还要先走到 4.5 格以内。这和"手机上点一下就要见到方块"是相反的手感。
3. **AI 建造的瓶颈不是"放得慢"，是"放错地方"。** 所以接口的第一等公民不是 `place(x,y,z)`，而是 `build(spec)` + `dry_run`：先返回要动的格子、和玩家已有建筑的重叠、材料清单、以及一张等轴预览图（MCP 支持回图），模型看过再 commit。

---

## 2. 三个权威方案：对比、打分、推荐

### 2.1 方案定义（先对齐概念）

| 方案 | 权威（真值）在哪 | 手机是什么 | AI 怎么接进来 | 谁在算世界 |
|---|---|---|---|---|
| **A. 手机本地** | 手机页面内存（IndexedDB 兜底） | 全部：渲染 + 权威 + 输入 | WebSocket 连手机（手机开 WS 服务或经 PC 中继） | 手机 |
| **B. PC 自建体素服务** | PC 上的 Node 进程 | 渲染 + 输入（乐观本地） | 直连同一个服务 / 包成 MCP 给 DSH | PC |
| **C. 真 MC 服务端** | MC 服务端（Java） | 渲染 + 输入（点按变成代理命令） | mineflayer bot 或 RCON | MC 服务端 |

### 2.2 逐项对比

| 维度 | A. 手机本地 | B. PC 体素服务 | C. 真 MC 服务端 |
|---|---|---|---|
| **一致性 / 冲突处理** | 单写者，天然无冲突；AI 的写入也要排队进手机的仲裁器。但"权威"跟着一个会被系统回收的页面走 | 服务端权威 + 客户端乐观更新 + 回滚。冲突可按格 CAS 裁决（§4.4），可重放、可审计 | 游戏自己裁决：区块没加载、方块被占、玩家不在范围内都会失败；失败信息藏在 bot 的返回值里，玩家看不见 |
| **断线重连** | 页面一刷新/切后台被节流 → 世界在内存里没了，只能靠 IndexedDB 快照恢复（丢最近几秒）；AI 断线后手机需要重开 WS 服务，地址会变 | 服务端常驻：客户端重连 → 拉 `rev` 快照 + 重放增量。AI 断线 → MCP 层自动重连（`dsh-mcp-client` 自带 500 ms→30 s 退避，见 §6.4） | 服务端常驻，重连由协议栈处理；但代理 bot 断线=AI 从世界里消失，重连后位置/背包要恢复 |
| **延迟（点一下→看见）** | 最低：本地改 + 本地重绘，**<16 ms**（一帧内），AI 的改动额外加一次 WS RTT | 一次 LAN 往返 + 服务端应用：**约 8–20 ms**（服务端腿实测 0.09–1.7 ms，Wi-Fi 两段为估算，见 §4.6），加渲染 | MC tick 下限：实测 **p50 23.3 / p95 31.1 ms**（本机回环，`/setblock`→`block_change`），再加 WS 与渲染，**35–90 ms**；沿用 prismarine-viewer 的 section 重建节流再加 0–50 ms |
| **能否多人** | 不能（第二个玩家要连到第一个玩家的手机，页面后台即失效） | 能（服务端天然多方；手机 1..N + AI 1..N） | 能（原生多人，但每个手机玩家都要一个代理 bot，N 个 bot 同时在线） |
| **实现工作量（估算）** | 3–5 人日做单机原型；+2 人日做持久化仍救不了多人 | **8–12 人日**：世界服务 2–3、渲染接入 3–5、同步协议 2、AI 接口 2 | 12–20 人日：服务端运维 2–3、mineflayer 适配 4–6、镜像渲染 4–6、代理建造/反作弊/权限 3–5，且产品问题（§3.7）无解 |
| **还算不算 Minecraft** | ❌ 只有名字和贴图 | ⚠️ 方块、贴图、比例、建造手感是 MC 的；合成/怪物/物理/红石要自己写 | ✅ 全套：合成、怪物、物理、红石、维度、村庄 |
| **典型失败模式** | 手机锁屏 / 浏览器 OOM / 刷新 → 世界丢 | 服务没起来 → 全体黑屏（可用手机端离线模式兜底） | 服务器版本/端口/正版验证/反作弊/区块加载 任何一项不对 → "点了没反应" |

### 2.3 打分（需求匹配 + 工程可行性）

权重按 `_rubric.md`：R2「AI 一起玩」权重 3，**但本项目的 R2 具体化成了"同一张桌子上一起建造"**，所以我把"双人同世界且 AI 能看见玩家的建造"记为最高权重项；另加两把本任务专属的尺子：**AR/微缩视觉**（Q 版角色、桌面尺度）与**"建造手感"**（点一下必须马上有反应）。

| 评分项（权重） | A 手机本地 | B PC 体素 | C 真 MC |
|---|---|---|---|
| 双人同世界 + AI 感知玩家（×3） | 2 | **5** | 4（能，但玩家是"代理"） |
| 建造手感/延迟（×3） | **5** | 4 | 2 |
| AR 微缩视觉可控（Q 版角色、桌面尺度）（×3） | **5** | **5** | 1 |
| 一致性/断线韧性（×2） | 1 | **5** | 4 |
| "还算 Minecraft" 的玩法深度（×2） | 1 | 3 | **5** |
| 工作量/风险（×2，越大越好） | 3 | 4 | 2 |
| 可演进（以后加合成/怪物）（×2） | 1 | 3 | **5** |
| **加权总分（满分 85）** | **48** | **72** | **53** |

> 算分方式：每项 1–5 分 × 权重（权重合计 17，满分 5×17 = 85），逐项相加：
> A = 2×3 + 5×3 + 5×3 + 1×2 + 1×2 + 3×2 + 1×2 = 48；
> B = 5×3 + 4×3 + 5×3 + 5×2 + 3×2 + 4×2 + 3×2 = 72；
> C = 4×3 + 2×3 + 1×3 + 4×2 + 5×2 + 2×2 + 5×2 = 53。
> A 的 5 分项集中在"手感"和"视觉"，正好是它唯一的优势；C 的失分集中在"手感"和"视觉"，正好是本产品的立身之本。

### 2.4 推荐与"以后加合成/怪物要不要重写"

**推荐 B，并把 B 的"权威层"做成可替换的接口。**

- **"如果以后要加合成/怪物，哪个不用重写？"** 严格答案是 **C 不用重写**——C 天然有合成、怪物、物理、红石、AI 寻路（`mineflayer-pathfinder`）、掉落物。**但这不等于"应该先做 C"**：C 的重写成本不在这两件事上，而在"玩家没有 MC 客户端"这个前提上（§3.7）。
- **B 的准确说法**：B 要加合成/怪物，**要自己写玩法，但不用重写架构**——前提是今天就把边界画对：
  - `WorldAuthority` 接口：`getBlock/setBlock/applyBatch/snapshot/rev`；
  - 所有玩法规则（合成表、怪物 AI、掉落）都写在这个接口之上，**不许写进手机端**；
  - 手机端只认"方块 + 状态 id + 贴图"，而状态 id 直接用 `minecraft-data` 的编号（§3.3）。
  这样将来换成 C，只需实现一个 `McAuthority`（内部 mineflayer + 区块镜像），**手机渲染、同步协议、AI 建造接口一行不改**。
- **不选 A 的理由不是"性能"，是"权威的位置"**：A 把真值放在一个会被 OS 挂起、会被用户刷新、会被浏览器内存上限杀掉的进程里。对一个"一起建造"的产品，这是把最贵的东西（世界）放在最不可靠的地方。
- **不选 C 的理由是产品的，不是技术的**：技术上 C 完全可行（§3 给了完整管线和数字），但它把"玩家"变成了"一个不在场的 bot 的遥控器"，而且 Q 版大肥鱼/ Q 版玩家/ 桌面 diorama 这三件事在真 MC 里全要靠资源包和模组硬改。**如果哪天产品转向"真生存 + 多人联机"，再迁 C**，迁移成本被 B 的接口设计压到最低。

---

## 3. 若选 C（真 MC）：镜像成微缩视图，可行吗？

**结论：技术上可行，管线是现成的，数字也都很小；但"手感"和"人不在世界里"这两条是产品级硬伤。**

### 3.1 三层管线与可复用件

| 层 | 要做什么 | 现成可复用 | 采样/证据 |
|---|---|---|---|
| 权威 | 真 MC 服务端（1.20.1 / 1.21.4 都可以） | 官方 server.jar；`dsh-game` 的 `tools/mc-server.mjs` 起服脚本 | 本机实测 1.20.1 起服 3.5 s（`_tmp/poc/mcserver/f-probe-out.log`："Done (3.494s)"） |
| 代理/桥 | 手机点击 → bot 放方块 或 RCON `/setblock`；把 `block_change` 转成增量推给手机 | `mineflayer@4.39.0`、`minecraft-protocol@1.68.0`；RCON 客户端可直接抄 `dsh-game/src/games/minecraft/rcon.ts`（157 行，含断线重连/背压） | [mineflayer](https://github.com/PrismarineJS/mineflayer)（7768★，MIT，2026-11-14 仍在推） |
| 镜像/渲染 | state id → 模型/贴图 → three.js 网格 | `prismarine-chunk@1.41.0` + `prismarine-viewer@1.33.0` 的 `WorldRenderer`（支持到 **1.21.4**，见 `viewer/lib/version.js`） | 本机 `_tmp/poc/node_modules/prismarine-viewer` |

`prismarine-viewer` 的版本支持列表（本地 `viewer/lib/version.js`，2026-11-16 读）：
`1.8.8 … 1.19, 1.20.1, 1.21.1, 1.21.4` —— **1.21.4 在列**，正好与 `dsh-game` 测过的版本一致。

### 3.2 事件频率与数据量：给数字

**（1）机制（源码级）**：mineflayer 的 `blockUpdate` 不是自己造的事件，而是 `prismarine-world` 每改一格发一次：

```js
// mineflayer/lib/plugins/blocks.js:591-593（4.39.0）
const forwardedEvents = ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload']
bot.world.on(event, (...args) => bot.emit(event, ...args))
```
```js
// prismarine-world/src/world.js:104-108
_emitBlockUpdate (oldBlock, newBlock, position) {
  this.emit('blockUpdate', oldBlock, newBlock)
  this.emit(`blockUpdate:${position}`, oldBlock, newBlock)
}
```
服务端侧对应的是 `block_change`（单格）与 `multi_block_change`（批量）两种包；协议定义（`minecraft-data` 的 `pc/1.21.4/protocol.json`）：
- `packet_block_change = { location: position(8B), type: varint }`
- `packet_multi_block_change = { chunkCoordinates(bitfield 22+22+20 bit), records: array<varint> }`

**（2）实测（1.20.1，本机回环，view-distance=4）**

| 场景 | 块数 | 服务端发出的包 | 记录数 | 压缩后字节 | 字节/事件 | 依据 |
|---|---|---|---|---|---|---|
| 玩家点一下放 1 块 | 1 | 1× `block_change` | 1 | ~16 B | 16 | 75 条 burst 的均值（含 TCP 头） |
| 玩家拖建 / 快速连点（估 3–10 次/秒） | 3–10 /s | 3–10 /s `block_change` | 同 | **~50–160 B/s** | 16 | 同上推算 |
| AI 盖 5×5×3 小屋 | **75** | **75× `block_change`** | 75 | **1199 B** | 16 | `f-probe-result3.json → setblockBurst` |
| `/fill` 16×16×1 | 256 | 4× `multi_block_change` | 256 | 502 B | 2 | `→ fill[0]` |
| `/fill` 16×16×3 | 768 | 8× `multi_block_change` | 512（其余原本已是石头） | 909 B | 2 | `→ fill[1]` |
| `/fill` **32×32×16 = 整个 diorama** | 16384 | **26× `multi_block_change`** | **15616**（768 格原本就是石头） | **25909 B** | 2 | `→ fill[2]` |
| 玩家入场（109 个 chunk column） | — | 109× `chunkColumnLoad` | — | 56538 B | — | `→ join`（294 ms 到 spawn） |

**（3）推算 32×32×16 局部建造的"每秒事件数"**

> ⚠️ 口径警告：上面的 1:1 只对**无连接状态**的方块成立（石头、木板）。真实玩家放**栅栏 / 玻璃板 / 红石线 / 楼梯**时，邻居的连接状态会跟着变，一次点击可能产生 **1–N 个 `block_change`**（N = 受影响的邻居数，最多 6）。做容量规划时按 **×2** 留余量。

- 这个区域 = 2×2 个 chunk × 1 个 section = **4 个 16³ section，16384 格**。
- 常态建造（一个人点按）：**1–10 事件/s**，即 16–160 B/s。
- AI 一波建造（75 块小屋）：**75 事件 / 一次 tick flush（≤50 ms）**，约 **1500 事件/s 的瞬时尖峰**，1.2 KB。
- 最坏情况（工具一次性重铺整个区域，比如"清空重来"）：**15616 条记录 / 26 个包 / 25.9 KB**，MC 侧一次 tick 内就能发完（实测 16384 块 `/fill` 的 RCON 回包 46 ms）。

**结论：把 32×32×16 的 diorama 全量重写一遍也只有 26 KB。带宽和数据量对这条链路完全不构成瓶颈**；瓶颈只有一个，就是下一节的 tick。

### 3.3 state id → 纹理坐标：完整管线（每一步都有现成实现）

这是 `prismarine-viewer` 已经做完的事，**不要自己写**。四步：

**第 1 步：state id → 方块名 + 属性**（`minecraft-data` + `prismarine-registry`）
```js
const registry = require('prismarine-registry')('1.21.4')
const block = registry.blocksByStateId[stateId]   // { name:'oak_stairs', properties:{facing:'east',half:'bottom'}, ... }
```
实测规模（本机 `minecraft-data@3.119.0`）：**1.21.4 有 1095 种方块、27866 个 block state、1385 种物品**（`_tmp/poc/probe-md.js` 输出）。1.20.6 是 1060 / 26684。

**第 2 步：方块名 + 属性 → 方块模型（elements + 每面贴图名）**
`minecraft-assets` 提供原版 `blocksStates`（变体/多部件规则）与 `blocksModels`（cube_all、 stairs、door 等模型 JSON，含 `elements.from/to` 与 `faces`）。
`prismarine-viewer/viewer/lib/modelsBuilder.js` 的 `prepareBlocksStates(mcAssets, atlas)` 把它们**预编译**成"每个 state 的模型 + 每个面的 UV 矩形"，写进 `blocksStates/<version>.json`（`prerender.js:27`）。

**第 3 步：贴图名 → 图集 UV**
`atlas.js` 的 `makeTextureAtlas()`：把 `assets/<version>/blocks/*.png` 全部 16×16 贴图拼进一张 `nextPowerOfTwo(ceil(sqrt(n))) × 16` 的正方形图集，并产出
```js
texturesIndex[name] = { u, v, su, sv }   // 归一化 UV
```
再在 `prepareModel()` 里把 `#all`/`#side` 这类继承链解析掉、按 `uv` 字段折算成最终的 `u,v,su,sv`（`modelsBuilder.js:36-92`）。

**第 4 步：每个 section 生成几何**
`models.js` 的 `getSectionGeometry(x, y, z, world, blocksStates)` 遍历 16³，按 `elemFaces` 的六个面定义拼 `positions/normals/colors/uvs/indices`；`worker.js` 在 Web Worker 里算，主线程只 upload `BufferGeometry`（`worldrenderer.js:46-56`）。

**能不能直接用 `prismarine-viewer` 的 `WorldRenderer`？能，而且这是最省事的路。**

```js
// 手机端伪代码（直接复用，不 fork）
import { WorldRenderer } from 'prismarine-viewer/viewer/lib/worldrenderer'
const renderer = new WorldRenderer(scene, 2)      // 2 个 worker（手机别开 4 个）
renderer.setVersion('1.21.4')                     // 加载 textures/1.21.4.png + blocksStates/1.21.4.json
renderer.addColumn(cx, cz, chunkColumn)           // 初始：prismarine-chunk 解出来的列
renderer.setBlockStateId(new Vec3(x, y, z), stateId)  // 之后：每个 block_change 一行
```
它的内部约束要提前知道（都会影响手感/内存）：
- **section 重建是 50 ms 一批**：`worker.js:63-87` 用 `setInterval(..., 50)` 排空 dirty 集 → **单块更新最多 +50 ms 才出现在画面上**。
- 每改一格要标脏本 section，以及跨边界的邻 section（`worldrenderer.js:142-153`）。
- 材质是 `MeshLambertMaterial({vertexColors, transparent, alphaTest})`，**依赖顶点色 + 图集**；AR 场景里要重新打光/加描边得自己换材质。
- three 版本被钉在 **0.128.0**（`prismarine-viewer@1.33.0` 的 dependency），而当前 three 是 **0.187.0**。若手机端要用新的 WebXR/后处理，**建议只复用它的 `models.js + modelsBuilder.js + atlas.js`（纯数据管线），渲染自己写**。

### 3.4 延迟链（端到端，逐段给数字）

以"手机点一下 → 手机上看见方块"为目标，C 方案的链路：

| # | 段 | 数值 | 来源 |
|---|---|---|---|
| 1 | 触摸 → JS 处理完、WS 发出 | 1–5 ms | 估算（未在手机上实测） |
| 2 | 手机 ↔ PC 同 AP Wi-Fi 单程 | 2–5 ms（RTT 3–10 ms） | 估算；本报告未实测 |
| 3 | Node 收到 → 发命令 | <1 ms | 实测：RCON 新连接 + 鉴权 **1.5 ms p50**（`rconAuthHandshakeMs`） |
| 4 | RCON `/setblock` 回包 | **2.0 ms p50 / 2.3 ms p95** | 实测 `rconRoundTripMs` |
| 5 | **命令生效 → `block_change` 到客户端** | **23.3 ms p50 / 31.1 ms p95（min 12.5 / max 31.5）** | 实测 `blockUpdateMs`；机制＝命令排队进下一个 tick + 区块改动在 tick 末广播 |
| 6 | 客户端 `block_change` → 转增量 → WS 回手机 | 2–5 ms | 估算 |
| 7 | 手机渲染一格 | 自研 instanced：<1 ms；复用 WorldRenderer：**+0–50 ms** | `worker.js:63` 的 50 ms 节流 |
| | **合计（bot/RCON 路径）** | **约 35–90 ms**；复用 WorldRenderer 最坏 **85–140 ms** | |

**`/setblock` 与 bot 放置的差异（实测 + 源码）**

| | RCON `/setblock` | mineflayer `bot.placeBlock` |
|---|---|---|
| 实测往返 | 命令回包 **2 ms**；方块广播 **23.3 ms p50** | mineflayer 的 `placeBlock` Promise 在 **1.5 ms p50 / 5.4 ms p95** 就 resolve（24/24 成功） |
| 这个 1.5 ms 能不能当"已生效"？ | — | **不能完全当**：`place_block.js:28-38` 的 resolve 条件是"收到该格 update"，且在 `acked && inFlight==1` 时**即使方块类型没变也 resolve**（用来表达"服务器拒了"）。跨客户端可见性仍应按 tick 广播（≈25 ms）算 |
| 消耗物品/游戏逻辑 | ❌ 绕过（不扣物品、不触发附魔/成就、`replace` 语义要自己写） | ✅ 正常（扣物品、触发邻居更新、有 `blockPlaced` 事件） |
| 反作弊 | ✅ 不走玩家（但要有 RCON 权限；公网服基本不给） | ❌ 容易被判异常（看服务器；`dsh-game` 要求自建 `online-mode=false`） |
| 远处的方块 | 需要先 `forceload`（`dsh-game/creative.ts:70`） | 需要人走过去（4.5 格内，`placeBlock.ts:135`） |
| 适合 | **AI 建造、批量、工具**（快、可控） | **玩家代理**（合法、有物理） |

**取舍建议**：AR 场景里"玩家"其实不需要一个走路的 bot。**用 RCON/服务端命令直接改方块、把"玩家"当成一个纯 UI 身份**，比维护一个 bot 身体简单一个数量级；代价是失去"物品栏/行走/打怪"这些你暂时也不需要的东西。

### 3.5 手感风险清单（每条有证据）

| 风险 | 具体表现 | 证据 |
|---|---|---|
| **静默失败** | 点在没加载的区块 / 被别的实体占住 / 反作弊拦下 → 客户端什么都没收到 | `place_block.js:28-34`：5 s 超时抛 `Server did not answer the placement`，或 `Server refused to place …the block is still X` |
| **慢** | 生存放置一块 ≥200 ms（`lookAt` → 蹲 150 ms → `placeBlock` → `sleep(200)`） | `dsh-game/src/games/minecraft/body/placeBlock.ts:152-173` |
| **够不着** | 目标 >4.5 格要先寻路走过去 | `placeBlock.ts:135-138`（`patchedGoto`） |
| **tick 节拍** | 无论多快，广播至少等到下一个 tick 末 | 实测 p50 23.3 ms、min 12.5 ms（不可能低于半个 tick 的分布特征） |
| **版本绑定** | 服务端版本必须与 mineflayer/minecraft-data 对得上（`dsh-game` 只在 1.21.4 测过） | `dsh-game/README.md`（“只在 1.21.4 测过、必须 `online-mode=false`”，本机克隆版可查） |
| **区块加载** | 远处的 setblock 会失败，必须先 `forceload` | `creative.ts:70`（`forceload add`，一次最多 256 区块，代码里按 16×16 分块） |

### 3.6 "人不在世界里"的割裂感 —— 这是 C 的真问题

不是延迟问题，是**主体性**问题：

1. **玩家没有第一人称视角。** 手机摄像头对着桌子，看到的是一个上帝视角的微缩模型。C 方案里"你"在游戏里是一个旁观者/代理 bot，**你无法"走进去"**。
2. **玩家的动作没有身体反馈。** 没有手、没有脚步声、没有"跳一下"。MC 的沉浸感有很大一部分来自身体；C 里这部分被抽走了，只剩下"点一下，模型变一下"。
3. **打怪/被怪打无法表达。** 你没有客户端，怪物不会追你；bot 被怪打，你在手机上只会看到"方块没变"。
4. **UI 断层。** 合成、背包、工作台这些 MC 的核心交互都是"对着一个 GUI 点"，AR 界面上要么不做（那就不是 MC），要么重做（那 C 的优势就没了）。
5. **Q 版化成本。** 参考图里的两个 Q 版角色（大肥鱼 + 玩家）在真 MC 里需要：自定义实体/皮肤 + 资源包 + 客户端 mod；而 `dsh-game` 的做法是**另外开一个真 MC 客户端当"摄像机"**（`camera.ts`，Java 21 + 官方 jar），已经是在绕。AR 里你无论如何都要自己渲染，那"真 MC 客户端"就白开了。

**一句话**：C 给你的是"一个真的世界"，代价是"你不在里面"；B 给你的是"你在里面"，代价是"世界是假的"。**这个产品的卖点是"在桌子上一起盖东西"，选 B。**

---

## 4. 自建体素（B 方案）：数据结构与同步协议

### 4.1 尺寸、坐标、朝向（先把约定钉死）

| 约定 | 取值 | 理由 |
|---|---|---|
| 世界尺寸 | **32 (x) × 16 (y) × 32 (z)** = 16384 格 | 一张 60 cm 桌子上 32 格 → 每格 1.875 cm，手指点得中；参考图里的岛 + 小屋 + 树 + 两个角色装得下 |
| 原点 | 世界左下后角 (0,0,0)，y 向上 | 与 MC 一致，方便对拍 |
| 区块 | 16³ section；32×32×16 = **4 个 section** | 与 MC 的 section 对齐，将来镜像 C 时不用换单位 |
| 朝向 | `north = -z, south = +z, west = -x, east = +x` | 与 `dsh-game/blueprint.ts` 的"第一行在最北边"一致，AI 图纸可以原样搬 |
| 地面 | `y=0` 是草地那一层，`y<0` 不给放 | 岛是"浮在桌上的"，底面用草/泥土两层做厚度 |

> **为什么不是 64³**：64³ = 26 万格，手机端一次全量重绘的顶点数会到 10 万级，低端手机会掉帧；32³ 的可见面数在 3000–6000 量级，一个 BufferGeometry 就够。要更大时按 section 增量更新，不换数据结构。

### 4.2 数据结构建议：**先用 `Uint16Array`，不要一上来就 palette + 位压缩**

**推荐（32³ 规模）**
```ts
const SX = 32, SY = 16, SZ = 32
const world = new Uint16Array(SX * SY * SZ)      // 直接存 block state id
const idx = (x, y, z) => (y * SZ + z) * SX + x    // 行主序，与 section 无关
```
- 内存：**16384 × 2 B = 32 KB**。手机端"乐观副本 + 服务端副本"两份也就 64 KB。
- 读写：**实测 2.5 ns/次（约 3.9 亿次/秒）**（`_tmp/f-bench.js`，本机 Node 24）。
- 整区重写 16384 格：**apply 1.68 ms，JSON 序列化 0.78 ms**（同脚本）。
- 好处：O(1) 随机访问、无 palette 间接层、无跨 long 边界的位运算 bug（这是自研体素最常见的翻车点）。

**什么时候才需要 palette + 位压缩**（>128³ 或要存盘/传网时）：

`prismarine-chunk` 的做法（本机 1.41.0 源码）：
- section 体积 `16×16×16 = 4096`（`src/pc/common/constants.js: BLOCK_SECTION_VOLUME`）；
- 三种容器：`SingleValueContainer`（全同）/ `IndirectPaletteContainer`（本地调色板）/ `DirectPaletteContainer`（全局）；
- **每格最少 4 bit，最多 8 bit，超过 8 bit 切全局调色板 16 bit**（`MIN_BITS_PER_BLOCK=4, MAX_BITS_PER_BLOCK=8, GLOBAL_BITS_PER_BLOCK=16`）；
- 位数组按 64 bit long 存，**值不跨 long**（padding），所以 4 bit 时每个 long 装 16 个值。

据此算一个 16³ section 的字节数：

| 编码 | 每格位数 | section 字节 | 32×32×16 全部 4 个 section |
|---|---|---|---|
| 单值（全空气/全石头） | 0 | 0 + palette | ~0 |
| 本地调色板（≤16 种） | 4 | 2048 | 8 KB |
| 本地调色板（≤256 种） | 8 | 4096 | 16 KB |
| 全局调色板 | 16 | 8192 | 32 KB |
| **直接 `Uint16Array`（推荐）** | 16 | 8192 | **32 KB** |

**结论**：在 32³ 这个尺度，palette 的最好情况省 24 KB、最坏情况一样，而代价是一层间接 + 位打包代码。**不划算。** 等到世界 >128³、或要把世界存成文件/传整份快照时再上 palette（那时 `prismarine-chunk` 直接拿来用，别自己写）。

### 4.3 同步协议

**设计原则**：客户端乐观更新 → 服务端权威 → 广播带 `rev` 的增量 → 客户端按 `rev` 对账、不匹配就回滚重放。

**消息表（WebSocket，JSON 文本帧 + 大批量二进制帧）**

| 方向 | 消息 | 字段 | 说明 |
|---|---|---|---|
| C→S | `hello` | `{clientId, name, lastRev?}` | 重连带 `lastRev`，服务端能补发就补发 |
| S→C | `welcome` | `{worldId, rev, size:[32,16,32], palette:[{id,name,props}], snapshot?}` | `snapshot` 是全量（二进制帧）；太大就只给 `rev` 让客户端请求分块 |
| C→S | `intent` | `{seq, ops:[Op], if?:Predicate}` | **唯一写入口**；`seq` 客户端自增，用于幂等与回滚 |
| S→C | `ack` | `{seq, rev, accepted:[opIdx], rejected:[{opIdx, reason}]}` | 只回给发起者 |
| S→C | `ops` | `{rev, by:'player:alice'|'ai:dafeiyu', ts, ops:[Op]}` | 广播给所有人（含 AI） |
| S→C | `resync` | `{fromRev, toRev}` | `rev` 断层，客户端必须重新拉快照 |
| S→C | `presence` | `{players:[{id,name,pos,looking}], ai:{pos,state,busy}}` | 10 Hz 节流；AR 里画"别人的光标/大肥鱼在哪" |
| S→C | `site` | `{siteId, owner, kind, bbox, materials, trend, rev}` | 玩家建造聚合的结果（§5.5），也给 UI 显示"大肥鱼看到你在盖墙" |
| S→C | `plan` | `{planId, cells, previewPng?}` | AI 的虚影预览（半透明 instanced mesh），玩家能看见它要干什么 |
| S→C | `plan_invalidated` | `{planId, reason:'player_overlap'}` | 玩家的操作动到了 AI 的计划区 → AI 必须重新规划 |
| C↔S | `ping` / `pong` | `{t}` | 心跳 5 s，用于测 RTT 和判死 |

**Op 编码**

```ts
type Op =
  | { op:'place'; x:number; y:number; z:number; block:BlockRef }        // 单格
  | { op:'break'; x:number; y:number; z:number }
  | { op:'cells'; cells: Array<[x,y,z,stateId?]>; block?:BlockRef }     // 稀疏批量（AI 的 diff）
  | { op:'box'; from:[x,y,z]; to:[x,y,z]; block:BlockRef; mode:'fill'|'hollow'|'replace'|'clear'; mask?:BlockRef[] }
  | { op:'mirror'; axis:'x'|'z'; of: Region }                            // 工具
  | { op:'undo'; targetRev:number }

type Predicate =
  | { kind:'empty' }                       // 只能放在空气上（AI 默认）
  | { kind:'is'; block:BlockRef }          // 只能替换成指定方块（CAS）
  | { kind:'owner'; by:string }            // 只能改自己放的（AI 回滚自己时用）
```

**帧大小（实测/推算，本机 Node 24）**

| 批量 | JSON 字节 | JSON+deflate | 5 B/格二进制 | 二进制+deflate |
|---|---|---|---|---|
| 1 格（单 op） | 85 B | — | 13 B | — |
| 75 格（AI 小屋） | **847 B** | **213 B** | 383 B | ~250 B |
| 1024 格 | 11706 B | — | 5128 B | — |
| **16384 格（整区）** | **192570 B** | **34855 B** | **81928 B** | **19619 B** |

依据：`_tmp/f-bench2.js`。**建议**：`cells.length ≤ 256` 走 JSON（可读、好调试）；超过就走二进制帧（`[count:u32][stateId:u16][x:u8,z:u8,y:u8]×n`），并开 WS 的 `permessage-deflate`。16384 格的整区重写压缩后 **19.6 KB**，比 MC 自己的 25.9 KB 还小。

### 4.4 冲突裁决（玩家 vs AI 同时动同一格）

**规则（按优先级）**

1. **单写者事件循环**：服务端是单进程单线程（Node 事件循环），所有 `intent` 串行应用 → 到达顺序即裁决顺序，无需锁、无时钟。
2. **格级 last-writer-wins**：后到的写覆盖先到的，但**必须过谓词**（默认 `empty`）。所以 AI 的"往这放"在玩家已经放了东西时会**被拒**（`reason:'occupied'`），而不是覆盖玩家。
3. **玩家优先（软规则）**：AI 的 `intent` 默认带 `{kind:'empty'}` + `avoid` 区域（来自 §5.5 的 Site 模型）。玩家没有谓词限制——**玩家永远能覆盖 AI**，这是"一起建造"的心理契约：AI 是客人，玩家是主人。
4. **批量原子性**：一个 `intent` 里的多个 op 要么全过、要么全拒（`on_conflict:'skip'` 时逐格跳过并报告）。这样"一栋房子的 120 格"不会盖一半。
5. **计划失效**：玩家的写操作如果落在某个未提交的 `plan` 区域内 → 服务端发 `plan_invalidated` 给 AI；AI 侧把计划标记为 stale，下次必须重新 `build_plan`（这比"默默盖到玩家的墙上"好得多）。

**客户端乐观更新 + 回滚（伪代码）**

```ts
// ---------- 客户端 ----------
let serverRev = 0
const pending: Map<number, Intent> = new Map()   // seq -> intent
const shadow = new Map<string, number>()          // "x,y,z" -> 客户端看到的 stateId

function onTapPlace(x, y, z, block) {
  const seq = nextSeq++
  const prev = local.get(x, y, z)
  local.set(x, y, z, block)                       // ① 立刻可见（<1 帧）
  pending.set(seq, { seq, ops: [{ op:'place', x, y, z, block }], undo:{ x, y, z, prev } })
  ws.send({ type:'intent', seq, baseRev: serverRev, ops: pending.get(seq)!.ops })
  markPending(x, y, z)                            // ② 视觉上标"未确认"（微弱描边/半透明）
}

function onAck(ack) {
  for (const idx of ack.rejected) {               // ③ 被拒 → 回滚这一条
    const it = pending.get(ack.seq)!
    for (const op of it.ops) rollback(op, it.undo)
  }
  pending.delete(ack.seq)
  serverRev = ack.rev
}

function onOps(msg) {                             // ④ 权威广播
  if (msg.rev !== serverRev + 1 && msg.rev !== serverRev) { ws.send({type:'hello', lastRev: serverRev}); return }
  // 先把还没确认的本地意图"抬起来"，应用权威 op，再把 pending 重放到上面
  const lifted = liftPending()
  applyOps(msg.ops)
  serverRev = msg.rev
  replayPending(lifted)
  dirtySections(msg.ops)                          // ⑤ 标脏 → 下一帧重建网格
}
```

**为什么先"抬起再重放"**：如果只是"服务端 op 覆盖本地"，玩家正在拖的那一笔会被自己的旧状态打断，看起来像"方块闪了一下又回去"。抬起的成本是 O(pending)，通常 <5 条。

### 4.5 断线重连与快照

- 服务端保留 **最近 512 个 rev 的增量环形缓冲**（每个 rev 只存压缩后的二进制帧，16384 格的整区也就 20 KB，512 个 rev 的常态总量 <2 MB）。
- 客户端重连带 `lastRev`：
  - `lastRev ≥ rev-512` → 逐帧补发 `ops`；
  - 否则 → 发 `resync` + 全量快照（32 KB 的 `Uint16Array`，deflate 后约 8–12 KB；实测同类 JSON 压缩率约 5.5×）。
- **AI 侧（DSH/MCP）不需要增量**：它每次调用都拿"当前世界摘要 + 自己的计划"，断线由 `dsh-mcp-client` 自动重连（`reconnect.enabled` 默认 true，500 ms 起、翻倍到 30 s、10 次后放弃）。见 §6.4。
- **世界持久化**：服务端每 5 s / 每 200 个 rev 落一次盘（`world.bin` = 32 KB + `rev` + `undo` 摘要），进程重启后 `rev` 继续递增（写进文件头），客户端不会以为"世界被重置"。

### 4.6 B 方案的延迟预算（端到端）

| # | 段 | 数值 | 来源 |
|---|---|---|---|
| 1 | 触摸 → 本地乐观放置 | **<16 ms（一帧）** | 设计保证（同步写 `Uint16Array` 实测 2.5 ns） |
| 2 | WS 发出 + 手机↔PC 单程 | 3–8 ms | 估算（LAN；未在手机上实测） |
| 3 | 服务端校验 + 应用 + 序列化 | 单格 **0.09 ms**；1024 格 **0.12 ms**；16384 格 **1.7 ms** | 实测 `_tmp/f-bench.js` |
| 4 | 广播回程 | 3–8 ms | 估算 |
| 5 | 客户端对账 + 标脏 | <0.5 ms | 设计 |
| 6 | 网格重建（自研） | 单 section <2 ms（估算，未实测）；复用 prismarine-viewer 则 +0–50 ms | `worker.js:63` 节流 |
| | **合计（自研渲染）** | **约 8–20 ms；p95 <30 ms** | |
| | 合计（复用 WorldRenderer） | 约 10–70 ms | |

对比 C 的 35–90 ms：**B 的主要优势不是"快 2 倍"，是"没有 tick 这个不可压缩的地板"**——你可以在 8 ms 内把方块画出来，剩下的时间用来做动画（放置时的弹跳、粒子、音效），这才是"手感"。

### 4.7 建造工具：做哪些、为什么

| 工具 | 优先级 | 成本 | 对"一起建造"的影响 | 说明 |
|---|---|---|---|---|
| **撤销 / 重做** | **P0** | 0.5 人日 | ★★★★★ | AR 里手指粗、遮挡多，误触率远高于桌面。**没有撤销，玩家不敢放开手脚建**。按 actor 存 50 步，undo 本身也是一次 op（协作安全） |
| **AI 虚影（ghost）** | **P0** | 0.5 人日 | ★★★★★ | AI 建造前先显示半透明预览，玩家能"看见它要干什么"、能提前让开或反对。`dsh-game` 用 4000 个实体做 ghost（`GHOST_MAX`）；B 里就是 instanced mesh，几乎零成本 |
| 画笔 / 橡皮 / 吸管 | **P0** | 1 人日 | ★★★★ | 手机上的基本输入形态；吸管（取色）是"我也想用这个材料"的最低成本表达 |
| 选区填充 / 清空 | **P1** | 1 人日 | ★★★☆ | `box fill/clear` 一个 op 就够；AI 也用同一个 op |
| 镜像 / 对称 | **P1** | 0.5 人日 | ★★★☆ | "你盖左边我盖右边"，最后合成一栋对称的房子——**协作感最强的一个工具**，实现只是一个 op |
| 复制粘贴（选中→变换） | **P2** | 1.5 人日 | ★★☆ | 有点用，但和"一起建造"关系不大 |
| 材质替换（把木头全换成石头） | **P2** | 0.5 人日 | ★★☆ | 对 AI 更有用（"这个配色我不喜欢"），对人类是锦上添花 |
| 红石 / 物理 / 水流 | ✗ | — | — | 明确不做。做了就要回答"为什么水会流但火不会烧" |

**结论**：P0 三个（撤销、虚影、画笔/橡皮/吸管）+ P1 两个（选区、镜像）合计约 **3.5 人日**，是"一起建造"体验的分水岭；**撤销和虚影是必须有的，不做会显得"AI 在乱动我的世界"**。

---

## 5. AI 怎么"建造"（本项目核心创新点）

### 5.1 三种输出形态对比

| 形态 | 模型输出 | 优点 | 缺点 | 实测/证据 |
|---|---|---|---|---|
| **1. 逐块** | 一次 tool call 放一块：`place(x,y,z,block)` | 表达力最强（任意形状）；实现最简单；错一块不影响别的 | **token 爆炸 + 往返爆炸**：120 块 ≈ 120 次调用；每次调用至少 25 token 参数 + 模型在两次之间的思考（20–50 token）→ **约 6000 token、120 次串行往返（按 1–2 s/次 = 2–4 分钟）**；模型还要自己记账"我放到哪了" | 本报告推算；参数规模按 `dsh-game` 的 `place` action 形状（`session.ts:105`） |
| **2. 结构指令** | 一次交一张"图纸/规格"：字符图纸或 JSON spec | **token 便宜 1–2 个数量级**：一张 7×6×5 的字符图纸约 250 字符、**~150–250 token**；一次往返；本地解释器负责展开、查错、材料清单 | 表达力受限于 DSL（斜的、极不规则的形状要靠原语组合）；需要写解释器 | `dsh-game` 已跑通：`design` 收字符图纸 → 回三视图/材料/问题；`build` 按名字+坐标盖；上限 16×16×12（`blueprint.ts:52`） |
| **3. 脚本** | 模型写 Lua/JS，沙箱执行 | 最强（循环、条件、随机、复用函数） | **风险最大**：要沙箱、要限时/限内存、要审计副作用；出错难回滚；调试信息对模型不友好 | `minecraft-numen` 走的就是这条（Lua 原子动作，一次调用连做几十步）；它为此写了整套 Java 侧沙箱与插件 API（见 §6.3） |

**推荐：2 为主 + 1 兜底，明确不开放 3（至少第一版不开）。**

- **为什么 2 是主力**：这个产品的建造是"盖小东西"——一间 5×5 的木屋、一段墙、一棵树、一个火把。这类东西用**参数化规格**表达最省 token，而且解释器可以在**模型看到结果之前**就把错误挡掉（悬空、超界、和玩家重叠、材料不够），这正是 `dsh-game` 的 `design` 在做的事：先给三视图和问题列表，让模型自己改，改好了再盖。
- **为什么 1 必须留**：规格覆盖不到的"手术式修改"——"把你刚放的这 3 块换成石头"、"把门挪到右边一格"。这类用 `cells` 单点/小批量 op 最直接。**兜底阈值建议 ≤64 格**，超过就必须走规格。
- **为什么不做 3**：脚本的价值在"复杂算法"（比如程序化生成一座城堡），而本产品的世界只有 32³、玩家就在旁边看着。**为一个 32³ 的世界引入沙箱执行器，收益远小于风险**（会话中途卡死、无限循环、写到别人的建筑上）。如果将来要做"生成一整座岛"，再考虑"受限脚本"（只允许纯函数 + 白名单原语 + 200 ms 超时 + 10 万格上限）。

### 5.2 结构指令：JSON Schema 设计

设计目标（逐条对应用户要求）：**方块类型、坐标、尺寸、朝向、门窗洞、屋顶、材料替换、和玩家已有建筑对齐/避让**。

#### 5.2.1 顶层：`build` 规格

```jsonc
{
  "kind": "build",                  // 固定
  "id": "hut_a",                    // 模型自己起名，后续 commit/undo/mirror 引用
  "anchor": {                       // ① 坐标从哪来（这是"对齐"的核心）
    "mode": "adjacent",             //   world | player | ref | snap | adjacent | extend
    "ref": "site:wall-3",           //   ref/adjacent/extend 必填：玩家在盖的墙，或自己上一座建筑
    "side": "east",                 //   adjacent 时贴哪一边
    "gap": 2,                       //   留几格空（默认 1）
    "at": [12, 0, 8],               //   world 模式必填；其它模式可作微调偏移
    "snap": 4                       //   snap 模式：对齐到 4 格网格；或 "wall_plane"
  },

  "footprint": { "w": 5, "d": 4, "h": 3 },   // ② 尺寸：宽(东西) × 深(南北) × 高
  "facing": "south",                          // ③ 朝向：门朝哪边；决定 w/d 的展开轴

  "style": {                                  // ④ 材料与屋顶
    "palette": {
      "wall":    "oak_planks",
      "frame":   "oak_log",                   //   转角/立柱，可选
      "floor":   "oak_planks",
      "roof":    "oak_stairs",
      "window":  "glass_pane",
      "door":    "oak_door",
      "foundation": "cobblestone"             //   地面不平时垫的
    },
    "roof": { "type": "gable", "axis": "x", "overhang": 1, "material": "oak_stairs" },
    // type: flat | gable | hip | shed | none（none = 玩家自己盖屋顶）
    "wall_thickness": 1,
    "floor": true,                            // 是否铺地板
    "hollow": true                            // 默认空心（省材料，也符合"房子"的直觉）
  },

  "openings": [                               // ⑤ 门窗洞：在展开后的墙面上挖
    { "face": "south", "u": 2, "v": 0, "w": 1, "h": 2, "type": "door"  },
    { "face": "east",  "u": 1, "v": 1, "w": 2, "h": 1, "type": "window" },
    { "face": "north", "u": 1, "v": 0, "w": 1, "h": 2, "type": "none"  }   // 只挖空，装门/装窗由玩家来
  ],
  // face: north|south|east|west|top；u 沿墙面横向、v 从地面往上；超界的开口会被裁掉并在 warnings 里报

  "swaps": [                                  // ⑥ 材料替换（把已有方块换掉，用于"改造"）
    { "from": "cobblestone", "to": "stone_bricks", "region": "footprint" }
  ],

  "avoid": [                                  // ⑦ 避让：这些区域一律不碰
    { "ref": "site:wall-3", "pad": 1, "policy": "shrink" },
    { "region": [[10,0,6],[14,2,7]], "policy": "abort" }
  ],

  "on_conflict": "shift",                     // ⑧ 被占时：skip | shift | abort（shift=整体挪 1 格再试，最多 4 次）
  "limits": { "max_blocks": 600, "max_height": 12, "budget_ms": 2000 },
  "dry_run": true                             // ⑨ 默认 true：只算不盖，返回 diff + 预览图
}
```

#### 5.2.2 下层：几何原语（规格表达不了时用）

先把"形状原语"当作 `build` 的一种 `kind`，一次可以写多个 op（照抄 `dsh-game/shapes.ts` 的语法，已被验证够用）：

```jsonc
{
  "kind": "primitives",
  "id": "tower_b",
  "anchor": { "mode": "ref", "ref": "hut_a", "side": "east", "gap": 3 },
  "ops": [
    { "op": "cylinder", "base": [0,0,0], "r": 2, "h": 6, "axis": "y", "block": "stone_bricks", "hollow": true },
    { "op": "sphere",   "center": [0,6,0], "r": 3, "block": "stone_bricks", "hollow": true, "open": "bottom" },
    { "op": "cone",     "base": [0,9,0], "r": 3, "h": 3, "block": "spruce_planks" },
    { "op": "box",      "from": [0,0,0], "to": [4,0,4], "block": "oak_planks", "mode": "fill" },
    { "op": "line",     "from": [0,1,0], "to": [0,5,0], "block": "oak_fence" },
    { "op": "arch",     "from": [-2,1,0], "to": [2,1,0], "r": 2, "block": "stone_bricks" },
    { "op": "pyramid",  "base": [0,9,0], "size": 5, "h": 3, "block": "cobblestone" },
    { "op": "cut",      "region": { "from": [-1,1,0], "to": [1,3,0] }, "shape": { "kind": "door", "w": 1, "h": 2 } },
    { "op": "mirror",   "axis": "x", "of": "hut_a" },
    { "op": "repeat",   "count": 3, "step": [-4,0,0], "of": "window_unit" }
  ]
}
```

原语清单（与 `dsh-game/shapes.ts` 对齐，`SHAPE_LIMITS = {size:256, blocks:1_000_000}`，本产品自己收紧到 32³ / 2000 块）：

| op | 参数 | 用途 |
|---|---|---|
| `box` | `from,to,block,mode:fill\|hollow\|replace\|clear` | 墙、地板、地基 |
| `line` | `from,to,block` | 栏杆、梁 |
| `sphere` | `center,r,block,hollow,open` | 穹顶、圆球装饰 |
| `cylinder` | `base,r,h,axis,block,hollow,open` | 圆塔、井 |
| `cone` | `base,r,h,block` | 尖顶 |
| `pyramid` | `base,size,h,block` | 金字塔顶、斜屋顶 |
| `arch` | `from,to,r,block` | 拱门、桥洞 |
| `cut` | `region,shape` | 挖门洞/窗洞/隧道 |
| `mirror` | `axis,of` | 对称建筑 |
| `repeat` | `count,step,of` | 柱廊、一排窗 |
| `roof` | `type,from,to,material,overhang` | 用楼梯铺坡屋顶（`gable` 人字 / `hip` 四坡） |

#### 5.2.3 返回值：模型看到的"结果"

```jsonc
// 示例输出（数字仅示意结构，实际由解释器按 spec 算）
{
  "ok": true,
  "id": "hut_a",
  "dry_run": true,
  "rev": 128,
  "bbox": [[12,0,8],[16,3,11]],
  "cells": 96,                                   // 会动的格子数
  "by_block": { "oak_planks": 74, "oak_log": 8, "glass_pane": 4, "oak_door": 1, "oak_stairs": 31 },
  "conflicts": [ { "pos": [14,1,8], "reason": "occupied:oak_planks@player:alice", "policy": "skip" } ],
  "warnings": [ "地面在 (13,0,9) 处矮 1 格，已用 cobblestone 垫平", "北墙的开口 v=0..1 超出 h=3，已裁到 h=3" ],
  "preview": { "png": "<base64 或资源 id>", "views": ["iso_se", "front", "top"] },
  "next": "把这份结果给玩家看；玩家同意后调用 build_commit(id)"
}
```

**关键点**：`dry_run` 的返回里同时给**数字**（多少块、什么材料、几处冲突）和**图**（等轴 + 正视 + 俯视）。`dsh-mcp-client` 支持把图片投影进对话（§6.4），所以大肥鱼可以"看着自己的设计"再决定，而不是盲盖。

### 5.3 字符图纸：为什么还要保留它

字符图纸不是"落后"，它在两个场景比 JSON 更好：

1. **模型画得准**。逐层字符图 + 图例是**天然的二维对齐网格**，模型（和人类）都不会数错格子；JSON 里"第 3 层第 2 行第 4 格"要另外算坐标。
2. **三视图是免费的检查器**。`dsh-game/blueprint.ts` 的 `projections()` 直接给出正面/侧面/俯视三张图，`describeBlueprint()` 顺手报"行长短不一、悬空、方块名不存在、超过上限"——**模型看一眼就知道自己画错没有**，这比让模型自己在脑内做 3D 校验可靠得多。

实测成本（`dsh-game` 内置的 `cabin` 参考图，7×6×5）：正文 210 字符 + 图例 5 行 ≈ **150–250 token**，换来一栋 **150 块**的房子（逐层数：42 + 22 + 22 + 22 + 42）；同样的房子用逐块放置要 **6000 token 量级**（§5.1 推算）。

**建议**：**两种入口都留，共用一个解释器**——
- `build_from_blueprint(name, text, anchor)`：字符图纸（人/模型都好读好改，适合"小木屋、围墙、桥"）
- `build(spec)`：JSON 规格（适合参数化批量生成、需要精确控制门窗/屋顶时）
- 两者最终都编译成同一个 `cells` 列表 → 同一个 `dry_run` → 同一个 `commit`。

### 5.4 对齐与避让：算法

```ts
function resolveAnchor(spec, world, sites): { origin: Vec3, basis: {right: Vec3, fwd: Vec3} } {
  switch (spec.anchor.mode) {
    case 'world':    return { origin: spec.anchor.at, basis: BASIS[spec.facing] }
    case 'player':   return { origin: player.cursorCell, basis: BASIS[spec.facing] }
    case 'ref': {                                    // 贴着某个 Site/建筑
      const r = sites.get(spec.anchor.ref)            // {bbox, kind, materials, longAxis}
      return { origin: placeBeside(r, spec.anchor.side, spec.anchor.gap), basis: BASIS[spec.facing] }
    }
    case 'adjacent': {                               // 和参考建筑"共用一面墙"或留 gap
      const r = sites.get(spec.anchor.ref)
      return { origin: flushAgainst(r, spec.anchor.side, spec.anchor.gap), basis: BASIS[spec.facing] }
    }
    case 'extend': {                                 // 把玩家的墙接长（最讨喜的协作动作）
      const r = sites.get(spec.anchor.ref)
      assert(r.kind === 'wall' || r.kind === 'floor')
      const dir = r.longAxis === 'x' ? (spec.anchor.side === 'east' ? +1 : -1) : (spec.anchor.side === 'south' ? +1 : -1)
      return { origin: r.endAlong(dir), basis: BASIS[spec.facing] }   // 同平面、同高度
    }
    case 'snap': {                                   // 对齐网格 / 对齐到玩家的墙面
      const p = spec.anchor.at ?? player.cursorCell
      return { origin: spec.anchor.snap === 'wall_plane'
                 ? new Vec3(p.x, p.y, nearestWallPlane(p))            // 让两面墙在同一 z 上
                 : p.floorTo(spec.anchor.snap)                        // 4 格网格
             , basis: BASIS[spec.facing] }
    }
  }
}

/** 展开 → 冲突求解 → 返回 cells（纯函数，可 dry_run） */
function plan(spec, world, sites) {
  const { origin, basis } = resolveAnchor(spec, world, sites)
  let cells = expand(spec, origin, basis)             // footprint + walls + floor + roof + openings
  const blocked = new Set<string>()
  for (const a of spec.avoid) for (const c of cellsOf(a, sites)) if (c.pad) pad(c, a.pad, blocked) else blocked.add(key(c))
  for (let attempt = 0; attempt < 4; attempt++) {
    const hits = cells.filter(c => blocked.has(key(c)))
    if (!hits.length) return { cells, conflicts: [] }
    if (spec.on_conflict === 'abort') return { error: 'conflict', hits }
    if (spec.on_conflict === 'shift') { cells = cells.map(c => ({ ...c, x: c.x + dirX(spec.facing) })) ; continue }
    return { cells: cells.filter(c => !blocked.has(key(c))), conflicts: hits.map(h => ({ pos: h, reason: 'occupied' })) }
  }
  return { error: 'no_space' }
}
```

**四条经验规则**（写进给模型的提示词里）：

1. **先 `extend` 再新建**：玩家在盖墙 → 优先"帮他把墙接长"（同材料、同高度、同平面），这比在旁边另起一栋更像"一起"。
2. **永远留 1 格缝**：AI 新建的东西和玩家已有建筑至少隔 1 格，除非 `anchor.mode === 'adjacent'` 且模型显式说要共用墙。
3. **地面不平时先垫**：`auto_foundation` 向下最多补 3 格；超过 3 格就返回 `uneven_ground`，让模型换地方（不要默默盖出一根柱子）。
4. **不要抢玩家的"视线中心"**：玩家鼠标/手指最后一次点的位置附近 3 格是"热点"，AI 默认避开（避免挡住玩家正在看的地方）。

### 5.5 AI 如何感知玩家在干什么

**目标**：把"玩家每秒 3–5 次放置/破坏"压成"玩家在盖一面 9×3 的橡木墙"这种**一句话**，并且带位置、材料、进度、趋势，让模型能接话、能帮忙、能避让。

#### 5.5.1 事件流 → Site（聚合规则）

```
输入：每个 op 事件 {rev, by, op:'place'|'break', pos, block, ts}
输出：Site = { id, owner, kind, bbox, materials{}, n_place, n_break, trend, last_seen, rev }

规则（按顺序）：
R1 自回声剔除   by=='ai' 的事件不进聚合（AI 自己放的）；但如果 AI 放的块在 1 s 内被玩家拆掉，
                记一次 'rejected_by_player'（这比"没反应"有用得多）。
R2 时间窗       ts 落在同一个 2000 ms 窗口内的事件才可能合并；超窗就新开一个 cluster。
R3 空间连通     与已有 cluster 的 bbox 的 3D 曼哈顿距离 ≤ 2（或同一个 16³ section）→ 并入。
R4 最小规模     一个 cluster 累计改动 < 3 块 → 不发（避免"抖一下"就打扰模型）。
R5 形状分类     （见下表）
R6 节流         同一个 Site 2 s 内最多发 1 条；只有 trend 变化（building→paused→demolishing）时提前发。
R7 输出上限     每次给模型的"当前活动"最多 3 个 Site、每个 ≤ 120 token。
```

#### 5.5.2 分类规则（用 bbox 的几何特征，不用 ML）

设 `dx,dy,dz` 为 bbox 尺寸，`n = n_place + n_break`，`fill = n / (dx*dy*dz)`，`ratio = n_place / max(1, n_break)`：

| kind | 判定 | 例子 |
|---|---|---|
| `wall` | 有一轴 = 1，另一水平轴 ≥ 3，`dy ≥ 2`，`fill ≥ 0.5` | 9×3×1 的墙 |
| `floor` | `dy = 1`，`dx,dz ≥ 2`，`fill ≥ 0.6` | 5×1×5 的地板 |
| `pillar` | `dx = 1 且 dz = 1`，`dy ≥ 2` | 柱子、塔基 |
| `tower` | `dx,dz ∈ [2,6]`，`dy ≥ 3`，且"内部是空的"（中心格多为空气） | 圆塔 |
| `roof` | 有 ≥2 层，且上层面积 < 下层面积（收缩） | 人字顶 |
| `scatter` | `fill < 0.3` | 随手放的花/火把 |
| `demolishing` | `n_break > 2 * n_place` | 在拆东西 |
| `paused` | 距上次事件 > 8 s 且该 Site 未完成（比如墙还没封顶） | 玩家走开了 |

`trend` 用最近 3 个窗口的 n 做线性判断：`↑ building`、`→ steady`、`↓ paused/demolishing`。

#### 5.5.3 给模型的输出（这就是"玩家在干什么"）

```jsonc
{
  "rev": 431,
  "now": 1763380000000,
  "activities": [
    {
      "site": "site:wall-3",
      "kind": "wall",
      "owner": "player:alice",
      "where": [12, 0, 3],
      "size": [9, 3, 1],
      "axis": "x",
      "materials": { "oak_planks": 21, "oak_log": 6 },
      "progress": { "placed": 27, "broken": 0, "fill": 0.83, "trend": "building", "last_seen_ms": 800 },
      "relation_to_ai": { "distance": 6, "near_build": "hut_a", "gap": 2 },
      "suggestion_hint": "他这面墙 9 格长、还差东边 2 格没封；可以 extend"
    }
  ]
}
```

**给模型的一句话版本**（实际喂进上下文的就这一行，约 60 token）：

> 玩家在 (12,0,3) 盖墙：9×3×1，橡木 21 块 + 原木 6 块，还差东边 2 格没封；离你的 hut_a 有 2 格。他 0.8 秒前还在放。

#### 5.5.4 参考实现（伪代码）

```ts
class ActivityAggregator {
  private clusters = new Map<string, Cluster>()

  onEdit(e: EditEvent) {
    if (e.by.startsWith('ai')) { this.noteAiEdit(e); return }        // R1
    const c = this.findCluster(e)                                    // R2+R3
    if (c) c.add(e); else this.clusters.set(e.id, Cluster.from(e))
  }

  /** 每 500 ms 跑一次：分类 + 节流 + 产出 */
  tick(now: number): Activity[] {
    const out: Activity[] = []
    for (const c of this.clusters.values()) {
      if (c.n < 3) continue                                          // R4
      if (now - c.lastEmit < 2000 && c.trendUnchanged()) continue     // R6
      c.kind = classify(c.bbox, c.nPlace, c.nBreak)                   // R5
      c.trend = trendOf(c.windows)
      c.lastEmit = now
      out.push(c.toActivity())
    }
    return out.sort(byRecency).slice(0, 3)                            // R7
  }

  /** 供 anchor.mode='ref'/'extend' 用的 Site 注册表 */
  sites(): Map<string, Site> { /* bbox, kind, longAxis, materials, owner, rev */ }
}
```

**两个工程细节**：

- **UI 提示 > 推断**：如果手机 UI 有"当前工具"（画笔/墙/地板/橡皮），把这个 `tool` 字段随事件一起发上来。有了它，`kind` 直接就是 `wall`/`floor`，分类器只需要算尺寸和进度——**别让模型去猜一件 UI 已经知道的事**。
- **事件要带 `rev`**：模型引用"玩家那面墙"时用 `site:wall-3`，服务端用 `rev` 做版本校验；如果 `rev` 已经变了，返回 `stale`，让模型重新看——避免"照着旧图盖到新墙上"。

### 5.6 给模型的工具描述（提示词骨架）

工具描述要短、要有边界、要告诉模型"什么时候用哪个"。建议（中文，约 30 行）：

```
world_describe()        → 世界多大、现在有什么、玩家在盖什么（每次开工前先看）
world_snapshot(region, view) → 看一眼（iso/front/top/layer）；不确定位置时先看
build(spec)             → 按规格盖：尺寸/朝向/门窗/屋顶/材料/对齐/避让；默认 dry_run，
                          返回要动的格子 + 冲突 + 预览图；确认后用 build_commit(id)
build_from_blueprint    → 逐层字符图（小木屋、围墙、桥这类）；三视图会自动给你检查
blocks_edit(cells)      → 少于 64 块的精细修改（换材料、补一格、拆一块）
player_activity()       → 玩家最近在干什么（墙/地板/塔/在拆），带位置和材料
history_undo(rev)       → 撤销自己上一次的改动（玩家不受影响）

规则：
- 不确定就先 dry_run，看过 preview 再 commit。
- 优先 extend 玩家的半成品，别在旁边另起一栋。
- 永远给玩家留 1 格通道；不要盖在他正在看的地方（3 格内）。
- 一次最多 600 块；超了拆成两次。
- 盖完用一句话告诉玩家你盖了什么、用了什么材料（别报坐标）。
```

**为什么描述要这么写**：`dsh-game` 的经验是——**工具的 `description` 就是模型的产品说明书**，长一点没关系（每次请求都带，但只有 30 行），关键是每条都写"什么时候用"和"别做什么"。上面 6 条规则里，有 4 条是**约束**而不是能力说明，这正是"AI 不乱来"的来源。

---

## 6. 现成可复用的轮子（版本 / 许可 / 采样日期 2026-11-16）

> 版本与许可全部来自 `npm view <pkg> version|license`（2026-11-16 实测），或本地已安装包读取 `package.json`；星标来自 GitHub API 缓存 `_tmp/gh_stars.json`（同日）；GitHub API 当天限流，未取到的写"未取到"。

### 6.1 体素 / 3D 引擎

| 名称 | 版本 | 许可 | 发布/更新 | 对"微缩 diorama"的适用性 |
|---|---|---|---|---|
| **three** | **0.187.0** | MIT | 2026-10-30 | ✅ **用**。WebXR（AR hit-test）+ 实例化网格 + 后处理都成熟；手机上走 WebGL2 |
| **@babylonjs/core** | 9.36.0 | Apache-2.0 | 2026-11-12 | ⭕ 可选。功能不差，但社区/示例在 WebXR 上不如 three 多；**不换** |
| noa-engine | 0.33.0 | MIT | **2023-05-19（3 年未发版）** | ❌ 不适合。它是"无限体素世界 + 第一人称 + 碰撞 + ECS"，diorama 完全用不到它的 chunk 流式加载和物理；只有 AO 网格算法值得抄 |
| voxel-engine | 0.20.2 | **npm 未声明许可**（`npm view license` 为空） | 2022-11-08 | ❌ 不能用。许可不明 + 停更 |
| oasis-engine | 0.7.15 | MIT | 2023-06-21 | ❌ 停更 |
| colyseus / @colyseus/core | 0.18.12 / 0.18.28 | MIT | 2026-11 | ⭕ 房间/状态同步框架。2 人场景**过重**；如果以后要"多张桌子 / 多个房间"再考虑 |
| **ws** | **8.23.0** | MIT | 2026-11-12 | ✅ **用**。二进制帧 + `permessage-deflate` 直接支持 §4.3 的批量帧 |
| socket.io | 4.8.4 | MIT | 2026-09 | ⭕ 有房间/重连/降级，但体积大；本项目用 `ws` + 自己 30 行重连即可 |
| protobufjs | 8.8.1 | BSD-3-Clause | 2026-10 | ⭕ 等到协议稳定再上；现在 JSON + 二进制帧够了 |

### 6.2 方块数据 / 渲染管线

| 名称 | 版本 | 许可 | 实测规模（2026-11-16） | 用途 |
|---|---|---|---|---|
| **minecraft-data** | **3.119.0** | MIT | 1.21.4：**1095 方块 / 27866 block state / 1385 物品**；协议 769、dataVersion 4189（本机 `probe-md.js`） | state id ↔ 方块名/属性；合成表（以后加合成时直接有） |
| **prismarine-registry** | 1.12.0 | MIT | — | `registry.blocksByStateId[id]`（§3.3 第 1 步） |
| prismarine-block | 1.23.0 | MIT | — | 方块对象（boundingBox、shapes、properties） |
| prismarine-chunk | 1.41.0 | MIT | section 4096 格；palette 4/8 bit，全局 16 bit（`src/pc/common/constants.js`） | 区块编解码参考实现；C 方案必须用 |
| prismarine-world | 3.7.0 | MIT | 每改一格发 1 次 `blockUpdate`（`src/world.js:104`） | 事件源；B 方案不需要 |
| minecraft-assets | 1.19.0 | MIT | **142 MB 解包 / 62,683 文件**（`npm view dist.unpackedSize`） | **只在构建期用**：生成图集 + blocksStates；绝不要打进手机包 |
| **prismarine-viewer** | **1.33.0** | MIT | 支持到 **1.21.4**；自带生成物：`public/textures/1.21.4.png` = **340.9 KB**，`public/blocksStates/1.21.4.json` = **11.6 MB**（1061 个方块，gzip 后 **254 KB**；剪到 50 种常用方块 = **399 KB / gzip 11.5 KB**） | `models.js + modelsBuilder.js + atlas.js` 是"state id → 几何 + UV"的完整答案；`WorldRenderer` 可直接跑但 three 钉在 0.128 |
| three（被 prismarine-viewer 钉住的版本） | 0.128.0 | MIT | — | 若复用 `WorldRenderer` 就得接受这个版本（本机 `prismarine-viewer/package.json`） |

**手机首屏体积账**（这是"能不能在手机上跑"的关键）：
- 方案 1（复用整份）：图集 341 KB + blocksStates gzip 254 KB ≈ **0.6 MB**，另加 three（~600 KB min）。
- 方案 2（剪裁到 50 种方块）：图集 341 KB（可再裁到 64 格图集 ≈ 40 KB）+ gzip 11.5 KB ≈ **0.35 MB** → **推荐**，因为 diorama 根本用不到 1061 种方块。

### 6.3 AI 建造参考实现

| 项目 | 许可 | 采样 | 能抄什么 |
|---|---|---|---|
| **luckui/dsh-game**（本地克隆 `refsrc/dsh-game`） | **MIT**（Copyright 2026 luckui；`git remote` = `https://github.com/luckui/dsh-game.git`） | 2026-11-16 本地全量源码 | **本项目最直接的参考**：`blueprint.ts`（字符图纸 + 三视图 + 材料 + 悬空检测 + `TEMPLATES` 5 张参考图）、`shapes.ts`（形状 DSL：box/sphere/cylinder/cone/pyramid/arch/line + hollow/open/cut/repeat/mirror/roof）、`creative.ts`（RCON 逐层盖 + `forceload` + 每层 60–800 ms 节奏）、`rcon.ts`（157 行 RCON 客户端，含背压/重连）、`session.ts`（35 个 action 的工具表 + 事件推送 `onBodyEvent`） |
| **Dwinovo/minecraft-numen**（言出法随） | **LGPL-3.0** | README 2026-11-16 抓取（`_tmp/readmes/Dwinovo__minecraft-numen.md`） | **"外接大脑 = 自己当 MCP server"的现成范例**：`mcp_server_ExternalHost.java` 里 7 个工具（`list_companions` / `create_companion` / `delete_companion` / `get_events` / `guide` / `say` / `get_replies`），并且有 `send` / `answer_consent` 的"人在回路"设计。它证明了"模型写 Lua 程序批量执行"这条路可行，但也说明**需要一整套 Java 侧沙箱 + 插件 API**——本产品第一版不划算 |
| Mindcraft | 见仓库 | 仓库已迁移：`kolbytn/mindcraft` → **`mindcraft-bots/mindcraft`**（web_fetch 2026-11-16 跟随重定向确认）；星标**未取到**（GitHub API 限流） | 技能= `skills/*.js` 可执行代码 + prompt 拼装；**它也是"逐动作 tool call"路线的代表**，正好可以对照本报告 §5.1 的 token 账 |
| Voyager | **MIT** | 7330★，**pushed 2024-04-03（已停更）**（`_tmp/gh_stars.json`） | "技能库 = 可执行代码 + 向量检索 + 迭代修正"的思路，可以借来做"盖过的好东西存成模板"（对应本报告的 `sites` + `TEMPLATES`） |

### 6.4 DSH 侧：把世界服务包成 MCP（最小设计）

**结论：世界服务暴露成 Streamable HTTP MCP，DSH 用 `@deepseek-ai/dsh-mcp-client` 接，工具名自动变成 `mcp__mcworld__*`。**

配置（`dsh-mcp-client@0.2.1-rc.5`，字段见其 README，2026-11-16 读本地包）：

```yaml
- id: mcp-mcworld
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: mcworld                 # 工具名 = mcp__mcworld__<rawName>
    transport: streamable-http
    url: http://192.168.68.54:8788/mcp  # 世界服务（PC，局域网）
    toolCallTimeoutMs: 60000            # 默认值；盖 600 块也够
    reconnect:
      enabled: true                     # 默认 true：500ms 起、翻倍到 30s、10 次后放弃
```

| 工具（raw name） | 输入 | 输出 | 用途 |
|---|---|---|---|
| `world_describe` | `{region?, detail?:'brief'\|'full'}` | 文本：尺寸、材料直方图、已有建筑、玩家在盖什么 | 开工前"看一眼" |
| `world_snapshot` | `{region, view:'iso'\|'front'\|'top'\|'layer', layer?}` | **PNG 图片** + 尺寸 | 视觉确认（MCP 支持回图，见下） |
| `build_plan` | `{spec}`（§5.2 的完整 schema） | `{cells, by_block, conflicts[], preview_png}` | **dry-run**，默认入口 |
| `build_commit` | `{id}` | `{rev, placed, skipped, conflicts[]}` | 真正盖 |
| `build_cancel` | `{id}` | `{ok}` | 撤掉未提交的计划 |
| `build_from_blueprint` | `{name, text, anchor}` | 同 `build_plan` | 字符图纸入口 |
| `blocks_edit` | `{cells:[{x,y,z,block}], if:'empty'\|'any'}` | `{rev, placed, conflicts[]}` | ≤64 块的精细修改（兜底） |
| `player_activity` | `{since_rev?, window_s?}` | §5.5.3 的聚合结果 | AI 感知玩家 |
| `history_undo` | `{rev}` | `{rev, reverted}` | 撤销自己 |

**三条来自 `dsh-mcp-client` README 的关键事实**（决定了这个设计可行）：

1. **图片会被投影进对话**（模型支持图片且 harness 开了 attachment 时）→ `world_snapshot` / `build_plan.preview_png` 可以让大肥鱼"看着自己的图纸"决定，而不是盲盖。
2. **stdio 子进程的环境变量会按 `/KEY|PASSWORD|SECRET|TOKEN/i` 洗掉** → 如果世界服务做成 stdio 子进程，RCON 密码这类要显式写在 `env` 里；**用 streamable-http 更简单**（本设计选它）。
3. **断线自动重连（500 ms→30 s，10 次后放弃），工具集在重连后自动刷新** → AI 侧不需要自己写重连。

**一个省一次往返的技巧**：MCP 是请求-响应，模型不会"自动感知"玩家在干什么。与其让模型每次都先调 `player_activity` 再 `build_plan`（多一次往返 + 多一次 token），**不如把最近的 `player_activity` 摘要塞进 `world_describe` 和 `build_plan` 的返回值**：

```jsonc
{ "ok": true, "id": "hut_a", ...,
  "meanwhile": "玩家正在你西边 6 格盖一面 9×3 的橡木墙，还差 2 格没封。" }
```
这一行约 30 token，但让"一起建造"从"各盖各的"变成"知道对方在干嘛"。

**为什么用 MCP 而不是写 DSH 插件**：
- 世界服务可以被手机、其他客户端、其他 agent 同时用；MCP 是标准接口，换语言/换实现不影响 DSH。
- DSH 插件要跟版本走（`dsh-mcp-client` 的 peerDependencies 全是 `0.2.1-rc.5`），而 MCP 只依赖协议版本。
- 反过来，如果要做**实时**（AI 一边盖玩家一边看到、玩家一动 AI 立刻知道），MCP 不够——那时给 DSH 写一个 20 行的小插件订阅 WS 的 `site`/`ops` 事件即可，**两者可以并存**。

### 6.5 不建议用 / 不建议 fork 的

| 东西 | 为什么不 |
|---|---|
| `voxel-engine` | npm 许可字段为空（**许可不明**）+ 2022 停更，商用/开源分发都有风险 |
| `noa-engine` | 为无限世界设计，3 年未发版；diorama 只需要"网格 + 一个相机"，它的 chunk 流式/物理/AO 都用不上 |
| `oasis-engine` | 2023 后停更 |
| fork `prismarine-web-client`（558★） | 它是"完整网页版 MC 客户端"（协议栈 + 区块流 + 玩家实体），目标是"看到整个服务器"；本产品要的是"一个 32³ 的 diorama + AR 锚定"，fork 成本远大于自写渲染 |

---

## 7. 未验证清单（写给下一个接手的人）

| # | 未验证的事 | 影响 | 建议怎么验 |
|---|---|---|---|
| 1 | **手机真机端到端延迟**（触摸→WS→PC→回包→渲染） | §2.2/§4.6 的 8–20 ms 是"PC 侧实测 + 两段估算" | 手机上打点：`performance.now()` 在 `pointerdown` 与 `requestAnimationFrame` 首帧之间 |
| 2 | 手机 ↔ PC 同 AP 的 Wi-Fi RTT | 估算 3–10 ms，未实测 | `ping` 手机的局域网 IP，或 WS 心跳 100 次取 p50 |
| 3 | 手机 GPU 上 32³ 网格重建耗时 | §4.6 的"<2 ms/section"是估算 | 真机上用 `renderer.info` + `performance.now()` 包住 rebuild |
| 4 | prismarine-viewer 在手机浏览器的帧率/内存（three 0.128 + 11.6 MB JSON） | 决定要不要复用 `WorldRenderer` | 已装 `_tmp/poc/node_modules/prismarine-viewer`，起个静态服务用手机开（本报告未做） |
| 5 | 全量 `blocksStates` 的 `JSON.parse` 耗时（11.6 MB） | 首屏卡顿风险 | 同上；或直接改用剪裁版（399 KB） |
| 6 | mineflayer 在**真实反作弊服务器**上的放置成功率 | C 方案的核心风险；本报告只在无插件本机服测了 24/24 | 找一台 Paper + 常见反作弊的服，跑 `placeBlock` 100 次统计失败率 |
| 7 | 为什么 bot 放置的 `blockUpdate` 比 RCON `/setblock` 快一个数量级（1.5 ms vs 23.3 ms） | 影响 §3.4 的"该按哪个数算延迟" | 怀疑是 `place_block.js:31` 的 resolve 条件在 `acked` 后放宽（同一格只要有 update 就 resolve，哪怕类型没变）；用第二个旁观 bot 交叉验证"另一侧看到方块的时刻" |
| 8 | Minecraft **1.21.4** 服务端实测（本报告只测了 1.20.1） | `dsh-game` 测的是 1.21.4，两者协议不同（769 vs 763） | 下个 1.21.4 服务端重跑 `f-probe.js`（脚本只依赖 mineflayer，改 `version` 即可） |
| 9 | 手机屏幕点选 3D 方块的命中准确率（手指 vs 方块 1.8 cm） | 决定要不要"放大镜"或"选中高亮"辅助 | 真机上做 20 人 × 20 次的点选实验 |
| 10 | `dsh-game` 与本机 DSH 0.2.1-rc.5 的兼容性（它 pin 0.2.0-rc.2） | 与本报告的 MCP 设计相关，但属于兄弟报告范围 | 见 `reports/report-d-dsh-ecosystem.md` |
| 11 | 全套 MCP 工具在 DSH 里的实际 token 开销 | 9 个工具的描述+schema 每轮都带 | 起服务后看 `/context` 或日志里的 tool 定义长度 |

---

## 8. 附录：实测原始数据与复现命令

### 8.1 延迟与事件量（`_tmp/poc/f-probe-result3.json`，2026-11-16 18:09）

| 指标 | 值 |
|---|---|
| 服务端 | Minecraft 1.20.1（flat / creative / `online-mode=false` / view-distance 4 / RCON on） |
| 加入：到 spawn | 294 ms；`chunkColumnLoad` = **109**；收到 **56,538 B**（压缩后） |
| `bot.placeBlock` → 该格 `blockUpdate` | n=24，**p50 1.5 ms / p95 5.4 ms / max 7.3 ms**，24/24 成功 |
| RCON `/setblock` 回包 | **p50 2.0 ms / p95 2.3 ms**（含 TCP+鉴权 1.5 ms） |
| RCON `/setblock` → `block_change` | **p50 23.3 ms / p95 31.1 ms / min 12.5 / max 31.5**（n=16） |
| `/fill` 256 块 | 4× `multi_block_change`，256 记录，**502 B**，2 B/记录 |
| `/fill` 16384 块 | **26× `multi_block_change`，15616 记录，25,909 B**，2 B/记录，RCON 回包 46 ms |
| 75 条 `/setblock`（=5×5×3 小屋） | **75× `block_change`，1199 B，16 B/事件**，RCON 回包 19 ms |

### 8.2 服务端腿微基准（`_tmp/f-bench.js` / `_tmp/f-bench2.js`）

| 指标 | 值 |
|---|---|
| `Uint16Array` 单格写 | **2.5 ns**（≈3.92 亿次/秒） |
| 16384 格批量应用 | **1.68 ms** |
| 1 格 op 的 JSON | 85 B（`cells` 形式 68 B） |
| 75 格 op 的 JSON | **847 B**（deflate 213 B） |
| 16384 格 op 的 JSON | **192,570 B**（deflate 34,855 B）；5 B/格二进制 81,928 B（deflate **19,619 B**） |

### 8.3 渲染数据体积（`_tmp/f-blocksstates.js`，读 prismarine-viewer 自带生成物）

| 文件 | 原始 | gzip |
|---|---|---|
| `public/textures/1.21.4.png`（16px tile 图集） | **340.9 KB** | — |
| `public/blocksStates/1.21.4.json`（1061 个方块，全量） | **12,142,204 B ≈ 11.6 MB** | **260,570 B ≈ 254 KB** |
| 剪裁到 50 种常用方块 | **408,944 B ≈ 399 KB** | **11,731 B ≈ 11.5 KB** |

### 8.4 复现命令

```powershell
# 1) 起本地 1.20.1 服（flat/creative/online-mode=false，先改 server.properties: enable-rcon=true, rcon.password=probepw）
cd D:\研一上\AR_MC\_tmp\poc\mcserver
& 'C:\Program Files\Java\jdk-17.0.5\bin\java.exe' -Xms1G -Xmx2G -jar server.jar nogui

# 2) 跑测量（会自己 tp 到 3000,-60,3000 的空地，避免旧方块干扰）
cd D:\研一上\AR_MC\_tmp\poc
node f-probe.js > f-probe-result.json

# 3) 微基准与体积
node ..\f-bench.js ; node ..\f-bench2.js ; node ..\f-blocksstates.js
```

> 说明：`/fill` 的"窗口耗时"里含 400 ms 的静默判定，**不要把它当延迟读**；延迟只看 `rconReplyMs` / `blockUpdateMs`。`bot.placeBlock` 的 1.5 ms 是否可作为"权威已生效"存疑，见 §7 第 7 条。

---

*报告 F 完。所有"实测"数字均可在上述脚本与日志中复现；所有"估算"均已标注；未能取到的数据列在 §7。*

