# 报告 G：桌面 AR 微缩 Minecraft —— 既有实现与可复用库考古

- **采样日**：2026-11-16（北京时间）
- **作者**：子代理 G
- **范围**：Minecraft Earth / HoloLens MC / GitHub 开源 AR-MC 项目 / WebAR 与体素基础设施 / 中文圈
- **数据口径**：GitHub stars 与 `pushed_at` 均为 2026-11-16 通过 `api.github.com` 采样；npm 版本通过 `npm view` 采样；浏览器支持通过 caniuse 采样（其数据标注为 2026-10 StatCounter）。拿不到的写"未取到"，**不编造**。

---

## 1. 执行摘要

**没有。截至 2026-11-16，世界上不存在任何一个"能在真实桌面上 AR 玩 Minecraft"的现成库、npm 包或可运行的开源项目。**

这不是"我没搜到"，而是有量化证据的：GitHub 全站搜索 `minecraft augmented reality` 命中 **12 个仓库**（全部 ≤4 stars，最大的是 2010 年的 3 stars 仓库）；`minecraft hololens` 命中 **2 个**（都是同一个 4 stars 的博客仓库）；`arcore voxel minecraft` 命中 **0 个**。真正做过这件事的只有两个闭源产品——**Minecraft Earth（2021-06-30 已关服）** 和 **Microsoft HoloLens 的 E3 2015 演示（从未公开发布，无 SDK，硬件已停产）**。社区里最接近"复刻"的 `crips24/Mooncraft`（自述 "a remake of minecraft earth's AR mechanic using unity"）是 **0 star、无代码的空仓库**。

**但积木是齐的，而且比预期齐得多。** 缺的不是能力，是"把三块拼起来"的那一层胶水：

1. **平面放置**（把东西放到桌上、贴地、跟随）→ `three.js` r187 自带 `ARButton` + WebXR hit-test，官方示例 `webxr_ar_hittest.html` 就是完整可跑的 60 行代码（已核验源码，见 §4.1）。
2. **微缩模型视觉**（移轴、颗粒、玩具感、Q 版小人）→ `sloemo01/diorama`（555★，MIT，2026-11-16 仍在提交）＋ npm `@sloemo/diorama@1.0.1`，是专门做"Three.js 微缩立体模型"的代码工具箱。
3. **MC 风格体素渲染与建造** → `vyse12138/minecraft-threejs`（582★ MIT）、`shaoruu/mine.js`（331★ MIT）、`danielesteban/blocks`（WebXR 多人**体素引擎**）等一大批可直接读的 MIT 实现。

**最短路径不是"找库"，是"用 three.js 的 hit-test 做放置 + 抄 diorama 的视觉 + 写一个 40 行的体素网格"**——一个 Android 上能跑的真 AR demo，估 **3–5 人日**；如果只是要"效果图那一眼"（不要求真 AR），**0.5–1 人日**就够，且这条路和后续真 AR 是同一份代码。

**两个必须先知道的硬约束：**

- **iOS Safari 至今不支持 WebXR**（caniuse：Safari on iOS 3.2–27.2 全部 ❌ Not supported，含最新 27.2/TP）。选 Web 路线 = 只有安卓能真 AR。iPhone 只能走 `model-viewer` 的 Quick Look（放一个静态模型，不可交互建造），或 Unity AR Foundation 原生。
- **8th Wall 已经死了**（Niantic 公告：平台访问 2026-02-28 终止、托管 2027-02-28 拆除，新项目今天连账号都注册不了）。任何"用 8th Wall 绕过 iOS 限制"的方案直接作废。

---

## 2. Minecraft Earth buildplate 全解剖

### 2.1 基本事实（可引用）

| 项 | 内容 | 来源 |
|---|---|---|
| 开发/发行 | Mojang Studios + Blackbird Interactive / Xbox Game Studios | [Wikipedia](https://en.wikipedia.org/wiki/Minecraft_Earth) |
| 技术栈 | **C++**，基于 **Bedrock 引擎**；AR 用 **Azure Spatial Anchors** + OpenStreetMap 地图数据；Xbox Live 账号 | [Minecraft Wiki (de)](https://de.minecraft.wiki/w/Minecraft_Earth) |
| 时间线 | 2019-05 公布（MC 十周年）→ 2019-07-16 西雅图/伦敦封测 → 2019-10-17 冰岛/新西兰 EA → 2019-12-11 全球 → 2021-01 最后一版 0.33.0 → 2021-06-30 停服 → 2021-07-01 删档 | [Wikipedia](https://en.wikipedia.org/wiki/Minecraft_Earth) |
| 关服原因 | Mojang 官方口径：**COVID-19 疫情**及其对现实世界出行的影响；GeekWire 同报 | [Wikipedia 引 GeekWire](https://en.wikipedia.org/wiki/Minecraft_Earth) |
| 未上线地区 | **中国大陆**、古巴、伊朗、缅甸、苏丹、伊拉克、阿联酋 | [Wikipedia](https://en.wikipedia.org/wiki/Minecraft_Earth) |
| 商业表现 | 首周约 140 万下载（Sensor Tower），首周流水约 **9.3 万美元** | 同上 |
| 荣誉 | 纽约游戏奖 Best AR/VR；TIME 2019 百大发明；GCA Best VR/AR 提名 | 同上 |

### 2.2 Buildplate 到底是什么

**Buildplate = 一块可携带的、有边界的、微缩化的 Minecraft 世界切片。** 它同时是"存档""关卡""商品"和"AR 锚点"。

**尺寸与比例（这是全篇最有用的一组数字）：**

| buildplate 尺寸 | 桌上呈现边长 | 比例 |
|---|---|---|
| 8×8（默认） | 约 **58 cm**（23 英寸） | **约 1:14** |
| 32×32 | 约 **50 cm**（20 英寸） | 约 1:64 |

来源：[Minecraft Wiki — Earth:Buildplate #Scale](https://minecraft.wiki/w/Earth:Buildplate)

注意这条设计的精妙处：**板子变大，比例就变小，桌上占位几乎不变（58cm → 50cm）。** 也就是说"它在你的桌子上占多大"是恒定的，"一格有多大"是可变的。这是微缩感的根。

**垂直方向：** 建高上限 **221 格**；地面以下只有 **3 格**，再往下是基岩封底（wiki 图注原文："8×8 about 5 down. You can see how it is bordered by bedrock."）。→ **侧面永远是一个 3 格厚的"土层切片"**，这正是效果图里"草—泥土—石头"分层的现实来源。

**获取方式：** 新玩家默认 8×8；升级到 **Lv 1 / 5 / 10 / 15 / 20 / 25** 各解锁一块新板；也可用 ruby 在商店买（8×8 / 16×16 / 32×32）。来源同上。

### 2.3 两种尺度：Build Mode 与 Play Mode

这是 MCE 最值得抄、也最容易被忽略的机制——**同一个世界，两种尺度，一键切换。**

- **Build Mode（AR 微缩）**：玩家在真实平面上选一个位置放下 buildplate，板子以 1:14 左右的微缩形态叠在摄像头画面上。玩家可以**绕着桌子走**从不同角度看，并直接在板上建造、和板上的生物互动。要求开阔、平坦的表面。
- **Play Mode（1:1 实境）**：放置**之前**可以选择"全尺寸放置"（full scale）。此时玩家以生存模式进入世界，用配置好的快捷栏，会被岩浆烧、会被敌对生物攻击——就像玩一个 Adventure。

来源：[Minecraft Wiki — Earth:Buildplate #Scale](https://minecraft.wiki/w/Earth:Buildplate)、[Wikipedia #Gameplay](https://en.wikipedia.org/wiki/Minecraft_Earth)

**这是产品级的核心洞察：微缩不是妥协，微缩是"编辑态"；1:1 是"沉浸态"。** 用户先像玩积木一样搭，再"缩小自己走进去"。

### 2.4 多人、分享与"钉住"

- **Invite Friend**：放板的人点"Invite Friend"，对方**扫一个二维码**加入。零账号摩擦。来源：[Earth:Buildplate #Multiplayer](https://minecraft.wiki/w/Earth:Buildplate)
- **分享链接**：可以生成临时或永久链接，别人不必到现场也能看你的作品。
- **Pin / Anheften（钉住）**：把作品作为一个**永久全息**钉在真实地点。**钉之前要过审**——Mojang 声称有 7×24 审核团队。未受邀的路人可以在本地和这个固定世界互动，但**离开即重置**；只有受邀者能修改和取资源。

来源：[Minecraft Wiki (de) #Baugrundstücke](https://de.minecraft.wiki/w/Minecraft_Earth)（转述 theverge / windowscentral 的原始报道）

### 2.5 一堆"反直觉但重要"的设计约束

- **"本质上是个 2D 游戏"**：能往上建、往下挖，但**只有当现实中有可攀爬的结构时**玩家才能上/下。——对我们是好消息：**AI 角色只需要在岛表面寻路，不需要飞行**。
- **没有昼夜循环**：buildplate 和 adventure 恒定日光照亮。→ 效果图里那种"永远金色午后"是设计选择，不是巧合。来源同上。
- **背包无限**（槽位和堆叠都无限），没有工作台合成网格，**合成/烧炼要真实时间（几分钟）**。
- **工具/近战武器攻击距离更长**（因为要在微缩尺度上操作），远程武器基本不需要。
- **铁很稀有**，只能靠 adventure 挖矿。
- **两个不同的放置音效**：`SFX_buildplate_drop`（放下）与 `SFX_buildplate_placed_updated`（落定）。→ "放下"和"落定"是两个动作、两声反馈。

### 2.6 可抄清单（8 条，按性价比排序）

> 这部分是给产品/美术直接拿去用的。

**① 用 1:14 定死"微缩感"，并且让占位恒定。**
8×8 板 = 桌上 58cm ≈ 一格 7.25cm；32×32 板 = 50cm ≈ 一格 1.56cm。**我们的岛建议定在桌面 38–48cm 见方、一格 3.5–4.5cm**（比 8×8 板更小一格、更"模型"）。关键：**玩家缩放时改的是"一格多大"，不是"岛占多大"**。这一条决定了整个观感是不是"微缩模型"而不是"小游戏"。

**② 两段式尺度切换：Build(微缩) ↔ Play(1:1)，做一个过渡动画。**
哪怕不做 1:1 行走，也要做"镜头从桌面上方俯冲到岛内、草叶变成齐腰高"的 1.5 秒过渡。这是情绪高潮，成本极低（相机 tween + FOV/DOF 变化），ROI 最高。

**③ 放置前先给"尺寸选择"，再 confirm。**
hit-test 出平面 → 显示 reticle → **先让玩家拖一个 scale 滑块**（MCE 是"全尺寸 or 桌面尺寸"二选一）→ 再落下。避免"放下去发现太大/太小要重来"。这是纯 UI 活，半天。

**④ 抄"接触阴影"，不要抄"浮空"。**
MCE 的板是**坐在**平面上的。效果图里岛是浮空的，但**底下有一层柔和接触阴影**——这是"它真的在这个桌子上"的唯一证据。做法：一个软 edge 的 radial-gradient 贴片（或 SSAO/PCSS 软阴影）+ 一盏方向光的硬投影，两层叠加。**没有接触阴影，AR 一定"贴纸感"。**

**⑤ 侧面的"三格土层"是免费的叙事。**
草(1) / 泥土(2–3) / 石头(2–3) / 底部暗色收边。MCE 因为只有 3 格深 + 基岩封底，剖面天然像地质标本。我们的岛按这个比例做，**侧面比顶面更重要**——用户是从斜上方 30–45° 看的，看到的一半是侧面。

**⑥ 锁死太阳，不做昼夜。**
MCE 的板永远白天。我们锁一个 **35–45° 仰角、偏暖（约 4200–5000K）、略偏左前** 的主光，加一盏冷色补光（天光）。方块投影清晰、方向一致——这正是"移轴微缩摄影"的布光逻辑。不要做 time-of-day。

**⑦ 二维码即房间，别做账号。**
如果未来要"朋友进来一起建"，抄 MCE 的 Invite Friend → 扫二维码。零注册、零好友关系、零隐私合规负担。当前版本大肥鱼是 AI，用不上；但这是最省事的联机入口。

**⑧ "钉在你家桌子上"而不是"钉在地图上"。**
MCE 的 Pin 是钉在**地理坐标**（要审核、有 7×24 审核团队——这是它的成本黑洞）。我们反过来：**钉在这个房间/这张桌子**，换个房间就没了。既省掉全部审核成本，又强化"这是你家桌子上的世界"这个私密感。这是 MCE 想做但做不到的（它被地理位置绑架了）。

**⑨（附加）放置音效拆两拍**：`drop`（下坠/落下）+ `placed`（落定/尘埃/微光）。成本几乎为零，质感提升最大的一处。

---

## 3. GitHub / 开源项目全景表

> 按"可复用度"排序，不是按 stars。stars/日期为 2026-11-16 采样。
> 说明：`louis-e/arnis` 等少数仓库因 GitHub Search API 限流（403）在第二轮未能刷新 `pushed_at`，已标注。

### 3.1 A 级：代码可直接拿来用（有能跑的产物）

| 仓库 | Stars | 语言 | 最后提交 | 许可 | 做到哪一步 | 怎么用 |
|---|---|---|---|---|---|---|
| [danielesteban/blocks](https://github.com/danielesteban/blocks) | **未取到**（API 403 限流） | JS | 未取到 | 未取到（仓库无 LICENSE 文件被检出） | **能跑的产品级 Demo**：`blocks.gatunes.com`，自述 "webxr multiplayer voxels engine"，带 Docker 部署、chunk 存储、worldgen 插件、多人同步 | 唯一一个"**WebXR + 体素 + 多人**"三件事都做了的开源引擎。可直接读它的 chunk 网格化与 XR 相机接管；但它做的是**无限世界第一人称**，要改成桌面微缩需重写相机与尺度层 |
| [sloemo01/diorama](https://github.com/sloemo01/diorama) · npm `@sloemo/diorama@1.0.1` | **555** | JS | **2026-11-16** | **MIT** | **能跑 + 有 4 个成片 demo**（Pikachu vs Charizard / Dust Kings / Pool / Bank job，均 26–48s） | **本项目视觉层的第一选择。** 它是"Three.js 微缩立体模型"的 playbook + 代码工具箱：像素/描边卡通/像素+描边三种观感、自由 orbit、调色板吸附、**玩具比例且有真实关节动画的小人**、逐实体帧级 QA。README 明确要求资产"允许商用与再分发"并留 `SOURCES.md`/`CREDITS.md` 证据。`npx @sloemo/diorama` 一条命令拉下来 |
| [Earth-Restored/MCeToJava](https://github.com/Earth-Restored/MCeToJava) | 2 | C# | 2026-10-07 | **MIT** | **能跑的工具**：`MceToJava convert buildplate.json --biome="snowy_plains"` | **内容管线的钥匙。** MCE 的 buildplate 是 JSON，这个工具能把它转成 Java 版世界。→ 真实 MCE 官方设计的地图可以变成我们的体素数据源。2 stars 但功能明确、MIT |
| [nirholas/3D-AR-Studio](https://github.com/nirholas/3D-AR-Studio) · npm `3d-ar-studio@0.3.1` | 11 | JS | 2026-11-15 | **Apache-2.0** | **能跑的库**（不是 demo）："place any number of 3D models in your real room via WebXR, Quick Look or Scene Viewer"，带 MCP server、房间级共享 | 现成的"WebAR 放置工作室"。**注意**：只有 11 stars、版本 0.3.1、依赖里挂了个 `@modelcontextprotocol/sdk`（MCP 味道很重，工程质量未知）。适合**抄结构**而非直接依赖 |

### 3.2 B 级：参考实现（读代码/抄算法，不直接依赖）

| 仓库 | Stars | 语言 | 最后提交 | 许可 | 做到哪一步 | 价值 |
|---|---|---|---|---|---|---|
| [vyse12138/minecraft-threejs](https://github.com/vyse12138/minecraft-threejs) | **582** | TypeScript | 2026-10-30 | **MIT** | 能跑的 MC 克隆（three.js + TS） | **最值得读的一份**：区块网格化、方块拾取（raycast + face normal）、放置/破坏、纹理图集。建造交互几乎可以整段搬 |
| [satansdeer/minecraft-react](https://github.com/satansdeer/minecraft-react) | 500 | JS | 2024-04-10 | MIT | 能跑（R3F 版） | React 技术栈的话看这个，但已停更 |
| [shaoruu/mine.js](https://github.com/shaoruu/mine.js) | 331 | Rust/WASM | 2024-03-23 | MIT | 能跑（WASM 体素世界） | 性能天花板参考；若岛很大再考虑 |
| [earthwalker17/map-of-middle-earth](https://github.com/earthwalker17/map-of-middle-earth) | 58 | TypeScript | 2026-10-06 | MIT | 能跑（web 端成片） | **视觉参考之王**：three.js **WebGPU + TSL** 做的"漂浮微缩中土大陆"，GIS 地形、大气、植被、24 个地标、确定性捕捉。**"漂浮岛 + 移轴 + 电影感"这件事它做到了** |
| [danieljan-design/noxe-pixel-engine](https://github.com/danieljan-design/noxe-pixel-engine) | 61 | JS | 2026-11-08 | MIT | 能跑 | 实时把 3D 微缩场景渲染成**像素画**，带 time-of-day / 天气 / 程序化音效 / 60fps MP4 导出、无需构建。若想要"更 MC 的像素质感"看它 |
| [BlueMap-Minecraft/BlueMap](https://github.com/BlueMap-Minecraft/BlueMap) | **2862** | Java | 2026-11-16 | MIT | 产品级 | MC 世界 → 浏览器 3D 模型。**如果走"MC 存档 → 网页微缩"路线，这是现成的后端** |
| [joshmarinacci/voxeljs-next](https://github.com/joshmarinacci/voxeljs-next) · npm `voxeljs-next@0.0.15` | 152 | JS | 2021-02-17 | **BSD-3** | 能跑（voxel.js 后继） | 老牌体素引擎的正统续作；已停更但架构干净 |
| [dgreenheck/minecraft-threejs-clone](https://github.com/dgreenheck/minecraft-threejs-clone) | 162 | JS | 2024-09-15 | 未声明 | 能跑 | 简单可读，适合快速摘 raycast 逻辑 |
| [LabyStudio/js-minecraft](https://github.com/LabyStudio/js-minecraft) | 110 | JS | 2024-01-28 | NOASSERTION | 能跑 | 专注"讲清渲染与物理"，教学向 |
| [jerrychan7/WebMC](https://github.com/jerrychan7/WebMC) | 86 | JS | 2024-05-25 | 未声明 | 能跑 | 零依赖纯 WebGL 手写，适合理解底层 |
| [fenomas/noa](https://github.com/fenomas/noa) · npm `noa-engine@0.33.0` | （未取到，受限流） | JS | 未取到 | **MIT** | 引擎库（voxel 引擎 + ECS + AO 光照） | 有 **AO（环境光遮蔽）** 和干净的 voxel mesh 生成，是 three.js 系里最"引擎"的一个。缺点：库形态老旧（ES5 时代 API）、社区小 |
| [louis-e/arnis](https://github.com/louis-e/arnis) | **18642** | Rust | 2026-11-15 | **Apache-2.0** | 产品级（arnismc.com） | **方向是反的**：真实世界 → MC。不属于本产品，但是"现实 ↔ 体素"最成熟的工程示范，值得看它的坐标/尺度处理 |

### 3.3 C 级：玩具 / 尸体（看一眼即可，别接）

| 仓库 | Stars | 语言 | 最后提交 | 许可 | 实际状态 |
|---|---|---|---|---|---|
| [crips24/Mooncraft](https://github.com/crips24/Mooncraft) | **0** | — | 2025-04-07 | 无 | 自述"用 Unity 复刻 MCE 的 AR 机制"，**0 star、无代码**。这是全站最接近"复刻品"的东西，也是空壳 |
| [ellisbywater/AR-Blox](https://github.com/ellisbywater/AR-Blox) | 1 | ShaderLab | 2020-08-09 | 无 | "Minecraft lite AR implementation，Unity ARFoundation"。2020 年，1 star，无许可——**不能商用** |
| [MatthewHallberg/ARkitMinecraft](https://github.com/MatthewHallberg/ARkitMinecraft) | 38 | C# | **2017-06-29** | 无 | 2017 年 ARKit 刚发布时的 Unity 玩具。9 年未更新，无许可，别碰 |
| [VoxxxelAR/ARVoxelKit](https://github.com/VoxxxelAR/ARVoxelKit) | 80 | Swift | **2017-10-15** | MIT | 原生 iOS ARKit 体素套件。**2017 年停更**，ARKit 1.x API，编译都过不去。不过 MIT，算法可读 |
| [taian/JimuAR](https://github.com/taian/JimuAR) | 0 | C# | 2017-09-01 | 无 | Unity 5 + Vuforia，"AR Minecraft"。Vuforia 的识别式 AR，不是平面 AR |
| [nihalsyed12/ARBlockBuilder](https://github.com/nihalsyed12/ARBlockBuilder) | 0 | C# | 2022-06-08 | 无 | Unity AR 放方块，玩具 |
| [blazjerman/MinecraftAR](https://github.com/blazjerman/MinecraftAR) | 1 | C# | 2024-10-28 | 无 | 无说明、无许可 |
| [colemaring/MC-AR-Sandbox](https://github.com/colemaring/MC-AR-Sandbox) | 2 | Java | 2025-05-07 | 无 | 无说明 |
| [MaksumRifai/voxelar](https://github.com/MaksumRifai/voxelar) | 10 | HTML | 2025-08-31 | 无 | 网页体素 AR，10 stars，无许可 |
| [SantiagoSchez/ARVoxelEditor](https://github.com/SantiagoSchez/ARVoxelEditor) | 14 | C | **2015-02-01** | GPL-2.0 | ARToolKit 时代的体素编辑器。**GPL-2.0 会传染**，且技术栈已死 |
| [YadavAashutosh/GestureVox-AR-Voxel-Builder](https://github.com/YadavAashutosh/GestureVox-AR-Voxel-Builder) | 3 | Python | 2026-04-13 | 无 | MediaPipe 手势 + OpenGL 的"空中"体素建造。**没有平面检测**，是"在空气里画方块"，不是"放在桌上" |

### 3.4 Minecraft Earth 的"考古层"（关服后的社区复原，意外地很有用）

MCE 虽然死了，但它的**数据格式被社区完全逆向**了。这是一条被严重低估的资产：

| 仓库 | Stars | 语言 | 最后提交 | 许可 | 作用 |
|---|---|---|---|---|---|
| [Earth-Restored/Solace](https://github.com/Earth-Restored/Solace) | **94** | C# | **2026-11-12** | **MIT** | MCE 的**替代服务器**，活跃开发中。功能表里 **Buildplates ✅ / Crafting ✅ / Smelting ✅ / Store ✅**（Profile 与 Boost Minis 施工中）。基于 [Project-Genoa/Vienna](https://github.com/Project-Genoa/Vienna)（16★） |
| [Project-Earth-Team/Api](https://github.com/Project-Earth-Team/Api) | 42 | C# | 2022-05-21 | NOASSERTION | MCE API 的重建，已停更 |
| [Project-Earth-Team/EarthBuildplateEditor](https://github.com/Project-Earth-Team/EarthBuildplateEditor) | 6 | C# | 2021-01-19 | 无 | **查看和编辑 buildplate 数据**的工具（作者自述 "very early"） |
| [Earth-Restored/BuildPlateStandardizer](https://github.com/Earth-Restored/BuildPlateStandardizer) | 1 | C# | 2026-04-03 | MIT | buildplate 版本 101–111 → v1 的转换器。说明格式有多代 |
| [Slexom/earth2java](https://github.com/Slexom/earth2java) | 26 | Java | 2024-07-22 | MIT | 把 MCE 独占生物搬进 Java 版 |
| [katorly/Minecraft-Earth-Buildplate](https://github.com/katorly/Minecraft-Earth-Buildplate) · [andiricum2/MC-Earth-Buildplates](https://github.com/andiricum2/MC-Earth-Buildplates) | 1 / 1 | — | 2024 | 无 | 社区**手工复刻的 buildplate**存档 |
| [Earth-Restored/MCeToJava](https://github.com/Earth-Restored/MCeToJava) | 2 | C# | 2026-10-07 | MIT | **见 A 级表**——buildplate JSON → Java 世界 |

> **结论**：MCE 的**客户端与 AR 层**完全不可复用（闭源 C++、Bedrock 引擎、服务器已拆）。但 **buildplate 内容**是可取的——通过 `MCeToJava` 拿到 Java 存档，再用 `BlueMap` 或自写解析器转成体素数据，我们就能**白嫖 Mojang 专业关卡设计师做的几十个微缩岛**。这是"抄内容"而不是"抄代码"，法律上是灰区（存档是用户数据，但美术资产是 Mojang 的），**建议只作为内部参考/布局学习，不直接发行**。

### 3.5 定量证明："没有现成库"

GitHub Search API 的全站命中数（2026-11-16 采样）：

| 查询 | 命中仓库总数 | 最高 star |
|---|---|---|
| `minecraft augmented reality` | **12** | 4 |
| `minecraft hololens` | **2** | 4 |
| `arcore voxel minecraft` | **0** | — |
| `ar voxel builder` | 9 | 3 |
| `tabletop augmented reality` | 18 | 2 |
| `minecraft webxr` | 10 | 2 |
| `minecraft threejs` | 420 | 2862（BlueMap，非 AR） |
| `minecraft ar` | 3420 | 18642（arnis，非 AR；**这个词组被 "ar" 子串污染**：Arclight、Ars Nouveau、ProjectAres…） |

**读法**：任何"MC + AR"的交叉查询命中数都在个位数到十几个、最高 4 stars；而"MC + three.js"有 420 个、最高 2862 stars。**说明这个交叉领域是真空的**——不是没人想做，是做出来的都活不过 demo 阶段。

---

## 4. 可复用基础设施库

> 全部为 2026-11-16 `npm view` 实采。许可列直接来自 registry。

### 4.1 Web AR 放置（核心，必用）

#### `three` — **v0.187.0（= r187），MIT**

这是整条 Web 路线唯一必需的重依赖。它自带 ARButton 与 hit-test 示例，**官方示例就是完整可跑的**（源码已核验：`examples/webxr_ar_hittest.html`，4312 字符；`examples/jsm/webxr/ARButton.js`，5485 字符）。

**最小接入（40 行，逐字来自官方示例，已核验）：**

```js
import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 20);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;                       // ← 关键
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

// 只请求 hit-test 能力
document.body.appendChild(
  ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] })
);

// reticle：贴地的环
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial()
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

let hitTestSource = null;
let hitTestSourceRequested = false;

function animate(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
        });
      });
      session.addEventListener('end', () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const results = frame.getHitTestResults(hitTestSource);
      if (results.length) {
        reticle.visible = true;
        reticle.matrix.fromArray(results[0].getPose(referenceSpace).transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }
  renderer.render(scene, camera);
}
```

**放下微缩岛（在 `select` 事件里，抄官方 `onSelect` 的写法，改成"把岛挂到 reticle 上"）：**

```js
const controller = renderer.xr.getController(0);
controller.addEventListener('select', () => {
  if (!reticle.visible) return;
  island.matrix.fromArray(reticle.matrix.elements);   // 继承 reticle 的位姿
  island.matrix.decompose(island.position, island.quaternion, island.scale);
  island.scale.setScalar(0.42);                        // 0.42m ≈ 一格 4cm 的 10 格岛
  scene.add(island);
  reticle.visible = false;
});
scene.add(controller);
```

> 关键数字：**`reticle.matrix` 给的是真实米制位姿**。所以 `island.scale.setScalar(0.42)` 就是"这块岛在桌上占 42cm"——MCE 的 58cm 标定可以直接搬进这行代码。**这是整个项目里最重要的一行。**

#### 其他 WebAR 库（横向对比）

| 包/产品 | 版本 | 许可 | 平面检测？ | 结论 |
|---|---|---|---|---|
| `three`（ARButton + hit-test） | **0.187.0** | MIT | **✅ 有** | **首选。** 唯一同时满足"免费 + 有平面检测 + 生态最大" |
| `@react-three/xr` | **6.6.32** | **MIT**（LICENSE 为 Bela Bohlender 的 MIT 文本，已核验） | ✅ 有（封装 WebXR） | React 栈选它。底层同一套 WebXR，能力等价 |
| `@react-three/fiber` | **9.8.2** | MIT | — | React 渲染器 |
| `@react-three/drei` | **10.7.9** | MIT | — | 现成 helper（OrbitControls、Environment、ContactShadows…） |
| `aframe` | **1.8.0** | MIT | ✅ 有 | HTML 声明式，出原型最快，但性能与可控性差 |
| `@google/model-viewer` | **4.4.0** | **Apache-2.0** | ⚠️ 只有"放模型"，无建造 | **iOS 唯一体面退路**：`ar` + `ar-modes="webxr scene-viewer quick-look"`，iPhone 走 Quick Look 放静态岛 |
| `babylonjs` / `@babylonjs/core` | **9.36.0** | **Apache-2.0** | ✅ 有（WebXR） | three 的等价替代。**体素/大场景性能通常更好**，但生态与素材少于 three |
| `@zappar/zappar-threejs` | **4.3.0** | MIT（客户端） | ✅ 有（自有 SLAM） | 真能救 iOS，但核心 `@zappar/zappar@4.4.0` 是 **Proprietary**，需商业授权；Zapworks 有 14 天试用 + Developer 计划（非商用无限 views）。**要钱，且锁平台** |
| `mind-ar` | **1.2.5** | MIT | ❌ **只有图像跟踪 + 人脸跟踪** | **做不了"放在桌上"。** README 原文只列 Image tracking 与 Face tracking |
| `@ar-js-org/ar.js` | **3.4.8** | MIT | ❌ **只有图像/标记/地理位置** | 同上，**做不了桌面放置** |
| `ar.js`（旧包） | 2.2.2 | MIT | ❌ | 已弃用，用 `@ar-js-org/ar.js` |
| **8th Wall** | — | — | ✅ 有 | **已停服。** 见 §6 |

#### 浏览器支持现状（caniuse，采样 2026-11-16）

| 平台 | WebXR 状态 |
|---|---|
| Chrome 桌面 79–160 | ◐ 部分支持 |
| **Chrome for Android 157** | **◐ 部分支持（AR 可用）** |
| **Safari on iOS 3.2 – 27.2（含 27.2/TP）** | **❌ 全部不支持** |
| Safari 桌面 | ❌ 默认关闭 |
| Firefox Android 160–163 | ❌ 默认关闭 |
| Samsung Internet 12–31 | ◐ 部分支持 |
| 全球覆盖率 | **78.02%** |

来源：<https://caniuse.com/webxr>

> **决策含义**：WebXR 路线的真 AR 只覆盖 **Android + 桌面 Chromium（可模拟）**。如果验收设备是 iPhone，必须换 Unity 原生，或接受 `model-viewer` 的"放一个静态模型"降级体验。

### 4.2 体素渲染与引擎

| 包 | 版本 | 许可 | 说明 |
|---|---|---|---|
| `noa-engine` | **0.33.0** | **MIT** | fenomas/noa。带 **AO 环境光遮蔽**、干净 voxel mesh 生成、ECS 架构。API 是 ES5 时代风格，集成成本中高 |
| `voxeljs-next` | **0.0.15** | **BSD-3** | voxel.js 正统后继，2021 停更。架构干净但老 |
| `voxel-engine` / `voxel.js` | **未取到**（registry 无名） | — | 已死，别用 |
| `prismarine-chunk` | **1.41.0** | MIT | **解析真实 MC 区块数据** → 读 `.mca` / MCE 转换后的存档 |
| `prismarine-world` | **3.7.0** | MIT | 世界/区块存取抽象 |
| `minecraft-data` | **3.119.0** | MIT | 全版本方块 ID / 属性数据库。**做 MC 风格必装**（否则方块 ID 要手抄） |
| `minecraft-assets` | **1.19.0** | MIT | 方块贴图资源（⚠️ 贴图本身是 Mojang 版权资产，**仅限开发/研究，不可发行**） |

> **重要提醒**：`minecraft-assets` 这个包 **MIT 的是代码，不是贴图**。Mojang 的方块贴图是注册商标+版权资产。任何公开产品必须**重画自己的 16×16 方块贴图**（或者用 CC0 体素包）。这是最容易踩的法律坑。

**自写体素层的最小方案（推荐，比接引擎省事）：**

一个 `InstancedMesh` + 一张纹理图集 + 一个 `Uint8Array` 存方块 ID，就够 10×10~32×32 的岛了。10×10×10 = 1000 个实例，手机毫无压力。

```js
// 岛：10×10 格，一格 4cm → 0.4m 见方；+3 层地下 → 总高约 0.55m
const S = 10, CELL = 0.04;
const geo = new THREE.BoxGeometry(CELL, CELL, CELL);
const mat = new THREE.MeshLambertMaterial({ map: atlas });
const mesh = new THREE.InstancedMesh(geo, mat, S * S * 8);
mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

const m = new THREE.Matrix4();
let i = 0;
for (let x = 0; x < S; x++)
  for (let z = 0; z < S; z++)
    for (let y = 0; y < 8; y++) {
      const id = getBlock(x, y, z);              // 0 = 空
      if (!id) continue;
      m.makeTranslation((x - S/2) * CELL, y * CELL, (z - S/2) * CELL);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, palette[id]);
    }
mesh.count = i;
```

### 4.3 移轴 / 微缩视觉（这是"效果图那一眼"的关键）

| 方案 | 版本/路径 | 许可 | 说明 |
|---|---|---|---|
| `postprocessing` — `DepthOfFieldEffect` | **6.39.6** | **Zlib** | **首选。** 源码已核验存在（`src/effects/DepthOfFieldEffect.js`，15048 字符）。基于 CoC 的景深，支持 `focusDistance` / `focalLength` / `bokehScale`。**移轴的本质就是"焦平面极窄"** → `focalLength` 调小、`bokehScale` 调大（3–6） |
| three `BokehPass` | r187 `examples/jsm/postprocessing/BokehPass.js` | MIT | 已核验存在（5532 字符）。轻量备选，效果不如上面 |
| three `HorizontalTiltShiftShader` / `VerticalTiltShiftShader` | r187 `examples/jsm/shaders/` | MIT | 已核验存在（1792 字符）。**真·移轴**：按屏幕 Y 做横向模糊量渐变。便宜、快、专治"微缩感"。可与 DOF 叠加 |
| `@react-three/postprocessing` | **3.2.2** | MIT | React 封装 |
| `three-stdlib` | **2.36.1** | MIT | shader/postprocessing 合集 |

**移轴配方（可直接用）：**

```js
// 伪移轴：屏幕上 1/3 清晰，上下渐糊 —— 这是"微缩模型摄影"的招牌
const tilt = new ShaderPass(VerticalTiltShiftShader);
tilt.uniforms.v.value = 3.0;   // 垂直位置（0..1，对准岛的中心）
tilt.uniforms.r.value = 0.55;  // 清晰带半径（越小越"模型"）
tilt.renderToScreen = true;
composer.addPass(tilt);
```

> 为什么必须做这一步：**人眼判断"这是不是模型"，靠的是景深**。真实的 40cm 桌面物体在手机镜头上是"全清晰"的；而微缩模型摄影是"只有一条带清晰"。**不做移轴，AR 出来就像"贴在画面上的 PNG"**；做了移轴，同一个几何立刻变成"桌子上的模型"。这是全项目 ROI 最高的 10 行代码。

### 4.4 物理 / 辅助（可选）

| 包 | 版本 | 许可 | 用途 |
|---|---|---|---|
| `three-mesh-bvh` | **0.9.18** | MIT | 加速 raycast（体素多时必需） |
| `@dimforge/rapier3d-compat` | **0.21.0** | **Apache-2.0** | 物理（方块掉落、TNT 炸） |
| `cannon-es` | **0.20.0** | MIT | 轻量物理备选 |
| `three-bvh-csg` | **0.0.18** | MIT | 布尔运算（挖洞） |
| `three-nebula` | **13.3.0** | MIT | 粒子（火把火星、放置尘埃、TNT） |

---

## 5. 三条最短路径对比

> 前提假设：验收看的是"效果图那一眼"（真实桌面 + 移轴 + 浮岛 + 两个 Q 版角色 + 弹幕字幕）。

### 路线甲：出图优先 —— 纯 three.js 合成，不做真 AR

**做法**：一张真实桌面的照片/视频当背景板（或者用 three 里贴一张桌子纹理 + 一个 blur 的 HDRI），把微缩岛渲染在上面，加移轴 + 暖光 + 接触阴影 + 弹幕字幕 overlay。**没有任何 AR、没有摄像头、没有 hit-test。**

**工作量：0.5 – 1 人日**

- 场景搭起来（岛 + 房骨架 + 树 + 箱 + TNT + 火把 + 花草）：用 `@sloemo/diorama` 的代码箱 + 自己的方块几何，约 4–6h
- 布光 + 移轴 + 接触阴影：2–3h
- Q 版角色：先用占位（胶囊 + 大头），或直接找现成 GLB
- 弹幕字幕：纯 DOM/CSS，20 分钟

**优点**：今天就能出图；和路线乙**共用同一份场景代码**（只是把背景从"照片"换成"摄像头 passthrough"）。
**缺点**：不是 AR，不能交付"手机上点按建造"。

**→ 这是"最短路径"的字面答案。** 如果目标是"先让老板看到效果图那一眼"，走这条；它不浪费，因为岛的场景图在乙里原样复用。

### 路线乙：WebXR 真 AR，Android 优先（**推荐主线**）

**做法**：路线甲的场景 + `ARButton` + hit-test + reticle + 缩放到 0.4m + 触摸/射线建造。

**工作量：3 – 5 人日**

| 任务 | 估时 |
|---|---|
| 场景（复用甲） | 1d（若甲已做则 0） |
| hit-test 放置 + scale 选择 + 落定音效 | 0.5d |
| 触摸拾取方块（raycast + face normal + 邻格放置）+ 网格吸附 | 1d |
| 移轴 + 接触阴影 + 光 | 0.5d |
| 大肥鱼角色（GLB + 简单朝向/走动）+ 弹幕字幕 | 1d |
| 机型适配 / 性能 / 权限 / 踩坑 | 1d |

**优点**：全部是 Web 技术，改一行就能迭代；和甲共用场景；`three` 生态素材最多；**不用装 App，扫链接就能玩**（这对 Demo 演示极其重要）。
**缺点**：**iPhone 完全不能用**（WebXR 在 iOS Safari 不存在）；Android 也需要 Chrome（微信内置浏览器不行，得引导"用浏览器打开"）；长时间 AR 会发热掉帧。

### 路线丙：Unity + AR Foundation 原生（要 iOS / 要上架才走）

**做法**：Unity + AR Foundation（ARCore + ARKit 双后端）+ 自写体素网格 + URP 后处理（DoF）。

**工作量：8 – 12 人日**

| 任务 | 估时 |
|---|---|
| 工程搭建 + AR Foundation + 平面检测 + 放置 | 2d |
| 体素数据 + 网格化（贪心合并）+ 贴图图集 | 2–3d |
| 建造交互（射线 + 放置/破坏 + 撤销） | 2d |
| 视觉（URP 后处理 DoF、阴影、接触阴影、光照） | 1–2d |
| 角色 + 字幕 UI + 状态机 | 1–2d |
| 双端打包 / 权限 / 上架 | 1–2d |

**优点**：**唯一能同时覆盖 iPhone 和 Android 的路**；性能与稳定性最好；能上架。
**缺点**：是路线甲/乙的**完全重写**（不能复用 three.js 场景）；迭代慢；需要 Unity 许可证与打包链路；对"今天就要看效果"是灾难。

### 三条路横向对比

| | 甲（合成） | 乙（WebXR） | 丙（Unity） |
|---|---|---|---|
| 工期 | **0.5–1 人日** | **3–5 人日** | **8–12 人日** |
| 真 AR | ❌ | ✅（仅 Android） | ✅（双端） |
| iPhone | — | ❌ | ✅ |
| 与甲复用 | — | **100% 场景复用** | 0（重写） |
| 交付形态 | 图/视频 | 一个 URL | App |
| 可迭代性 | 极高 | 高 | 中 |
| 风险 | 无 | iOS 覆盖、发热、内置浏览器 | 工期、包体、上架 |

**建议组合**：**甲 → 乙**（同一份代码，先出图再上 AR），把丙留到"确认要上架且必须覆盖 iPhone"之后再启动。**千万不要一上来就做丙。**

---

## 6. 死路清单（明确"别碰"）

**① 别去找"现成的桌面 AR MC 库"。**
不存在（见 §3.5 的定量证据）。花在搜索上的每一天都是沉没成本。**接受"要自己拼"这个前提，然后直接开工。**

**② 别碰 8th Wall。**
Niantic 已公告全线关停：**平台访问 2026-02-28 终止**（今天 2026-11-16 已经过了——新项目连账号都注册不了）、托管服务 2027-02-28 拆除并删数据。官方说"正在探索开源部分组件"，但**没有时间表、没有仓库**。任何基于 8th Wall 的方案今天起就是死路。
来源：<https://info.nianticspatial.com/blog/next-chapter>

**③ 别用 MindAR / AR.js 做桌面放置。**
它们只有**图像跟踪 / 人脸跟踪 / 标记 / 地理位置**，**没有平面检测（plane detection）**。MindAR README 原文只列 "Image tracking and Face tracking"；AR.js 原文是 "Image Tracking, Location-based AR and Marker tracking"。用它们做"放在桌上"= 在桌上贴一张识别图，用户挪一下桌子就废。**这是最容易犯的错，因为它们的 README/demo 看起来最像"WebAR"。**

**④ 别指望 iOS Safari 的 WebXR。**
caniuse 采样（2026-11-16）：Safari on iOS **3.2 到 27.2（含 TP）全部 ❌ Not supported**，WebKit bug #208988 仍开着。这不是"再等等"，是 Apple 的战略选择（他们要推 RealityKit / Quick Look）。**要么接受"iPhone 用不了"，要么换 Unity。**

**⑤ 别想"复活 Minecraft Earth 客户端"。**
服务器能复活（`Solace` 94★ MIT，活跃），**但 AR 客户端不能**：闭源 C++、Bedrock 引擎、Mojang 从未开源、官方安装包已下架、服务器已拆、账号数据 2021-07-01 已删。`Solace` 复活的是**服务端协议**，玩家还得有原版 APK 才能连——**这跟"我们做 AR"毫无关系**。

**⑥ 别碰 HoloLens 路线。**
2015 E3 那个 demo **从未发布、无 SDK、无源码**；HoloLens 1 已停产、HoloLens 2 也已于 2024 年停产、微软把重心转给美军 IVAS。它的**交互设计**可以抄（见下），**技术一点都用不上**。

**⑦ 别去 Unity Asset Store 找 "Minecraft AR" 资产。**
"Minecraft" 是微软注册商标，Asset Store 上不可能有这个名字的商品（搜到的只会是 "VoxelVerse" 之类通用体素包）。**通用体素资产有，MC 风格资产没有。**

**⑧ 别把 three.js 的 MC 克隆直接改成 AR。**
`minecraft-threejs`、`mine.js` 这些都是**第一人称、无限世界、区块流式加载**。我们的需求是**第三人称、10×10 格、固定边界、微缩**。把前者的相机/世界管理剥掉之后，剩下的只有"区块网格化"和"raycast 拾取"——这两块各 100 行。**为这两块去整合一个 5000 行的项目，是负收益。** 直接抄代码片段，不要 fork。

**⑨ 别用 arnis 的思路（它方向反了）。**
`arnis`（18642★）是 **真实世界 → Minecraft**，把 OSM 数据变成 MC 存档。我们要的是 **Minecraft → 真实桌面**。方向相反，一行代码都不能复用（除了坐标/尺度处理的思想）。

**⑩ 别在"微缩"里做昼夜循环。**
MCE 的 buildplate 恒定日光是有道理的：**微缩模型摄影是"布光"不是"等光"**。做 time-of-day 会让"暖色阳光 + 清晰方块投影"这个核心视觉每 10 分钟崩一次。

---

## 7. 未验证清单

> 以下条目我**没有拿到一手证据**，报告中相关表述已标注，请勿当作已确认事实使用。

| # | 未验证项 | 卡在哪 | 影响 |
|---|---|---|---|
| 1 | `danielesteban/blocks` 的 **stars / 最后提交 / 许可** | GitHub API 触发 403 限流（未认证 60 req/h）；HTML 页正文被截断，只取到 `<title>`（"webxr multiplayer voxels engine"）与 README（master 分支，含 `blocks.gatunes.com` 与 Docker 部署） | 表里标"未取到"。但它是**唯一同时做 WebXR + 体素 + 多人**的开源引擎，值得人工再核一次 |
| 2 | Unity Asset Store 是否存在可用的体素 AR 资产 | Asset Store GraphQL 返回 400；搜索页 JS 渲染 | §6⑦ 的结论是**基于商标逻辑的推断**，不是搜过 Asset Store 全量 |
| 3 | **"AR Builder: Pixel Art 3D Voxel"**（App Store `id6807085822`）的功能与状态 | `apps.apple.com` 三次尝试均 429 / 内容空；仅从搜索结果标题推断它是一个**在售的 iOS AR 体素建造 App** | 如果它真的做了"在桌上搭体素"，是**最接近的竞品参考**（非 MC 品牌）。建议人工在 iPhone 上装一下 |
| 4 | OSCHINA《Blocktopograph 结合 ARCore 实现 Minecraft 客厅投影技术》正文 | 页面 JS 渲染，只取到站点导航 | 标题暗示"中文圈有人用 ARCore 做过 MC 客厅投影"，**内容未验证**，可能是标题党/AI 生成 |
| 5 | Sundai Club "Minecraft AR (MicrocosmXR)" 项目详情 | 页面 JS 渲染，只取到标题 | 可能是一个学生做的桌面 MC AR 项目，**未验证** |
| 6 | Mojang 官方关服公告原文 | `minecraft.net/en-us/article/minecraft-earth-coming-end` 已随官网改版下线；GeekWire 原文 403（Cloudflare 挑战） | 关服原因采用 **Wikipedia 转述 + KitGuru 二手**，非一手 |
| 7 | MCE 是否直接调用 **ARKit / ARCore** | Minecraft Wiki 只写 "Azure Spatial Anchors"；「ARKit/ARCore」是**我的推断**（2019 年的手机 AR 必然落在其一之上，且 Azure Spatial Anchors 在手机上就是包装 ARKit/ARCore） | 结论"必然用其一"成立，但**没有官方文档明说** |
| 8 | `sloemo01/diorama` 到底打包了哪些资产、许可是否真的干净 | `refs/SOURCES.md` 与 `CREDITS.md` 在 main 分支 404（可能在别的路径或未公开） | **用它的资产前必须自己核一遍 license**。README 声称要求"允许商用与再分发"，但证据文件我没取到 |
| 9 | `louis-e/arnis` / `fenomas/noa` 的精确 `pushed_at` | 第二轮 API 403 | 报告中 arnis 写 2026-11-15（第一轮采样有效），noa 写"未取到" |
| 10 | MCE buildplate → 可用于我们的体素数据的**端到端管线**是否真的通 | `MCeToJava` 只验证了 README 与用法（`convert buildplate.json`），**没有实际跑过** | 若要"白嫖 MCE 关卡"，需先跑通一次并确认输出格式 |
| 11 | 中文圈（B站/知乎/CSDN）是否有**开源**的桌面 MC AR | B站 API 实采（见下），只找到 MCE 宣传片与"AR 眼镜玩 MC"；知乎/CSDN 未系统检索 | 大概率没有，但未穷尽 |

**附：B站实采结果（2026-11-16，`api.bilibili.com` 搜索 API）**

关键词 `AR 我的世界`：

| bvid | 播放 | 标题 |
|---|---|---|
| BV1nE411R7G2 | 139,437 | AR手游《我的世界：地球》EA宣传片 |
| BV1vx411Y7BV | 17,832 | 【MCRAFT GO】我的世界AR游戏 |
| BV1Me4y1h7uP | 253,589 | 当用AR眼镜来玩我的世界！超真实的体验！ |
| BV19J411S7X1 | 3,809 | 我的世界AR版，第一时间体验！ |
| BV1HV4y1g7jj | 429 | AR我的世界这样的Minecraft 你们玩过吗？ |

另：`BV1Cf421v7Qj`「谁不想玩一次桌面MR版本的Minecraft呢？2015年微软公布了基于MR头显的《我的世界》游戏」——**这正是 HoloLens 2015 桌面 MC 演示的中文解说**，可作为"用户记忆中的那个东西"的佐证。

**读法**：中文圈**没有原创的桌面 MC AR 开源项目**，内容全是（a）MCE 官方宣传片搬运、（b）AR 眼镜串流玩 MC、（c）商业小游戏广告。`MCRAFT GO` 未验证是否为真 AR。**"我记得看到过"这个印象，最可能来自 HoloLens 2015 的 E3 演示视频，或 MCE 的宣传物料。**

---

## 8. 给父 Agent 的三句话

1. **没有现成库，答案就是"没有"**。但 `three` r187 的 `ARButton` + hit-test（官方示例 40 行，已核验）+ `postprocessing` 的 `DepthOfFieldEffect` + 自写 1000 实例的 `InstancedMesh`，**3–5 人日**能做出 Android 上真能玩的版本。
2. **视觉的秘密只有两件事**：**移轴**（`VerticalTiltShiftShader`，10 行）和**接触阴影**。做完这两件，同样的几何立刻从"贴纸"变成"桌子上的模型"。MCE 的 1:14（8×8 板 = 桌上 58cm）直接搬进 `island.scale.setScalar(0.42)`。
3. **iOS 是唯一的分叉点**。WebXR 在 iOS Safari 上**至今为零**，8th Wall 已死。要么接受"安卓 Demo + iPhone 看 Quick Look 静态模型"，要么走 Unity 原生（+8 人日，且场景全部重写）。**这个决定必须现在做，不能拖到后面。**

---

*报告完。所有 stars/日期为 2026-11-16 采样；所有 URL 已附；未取到项已在 §7 列明。*
