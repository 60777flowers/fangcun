# 报告 H：`docs/DEV.md` v0.2 交接前对抗性审阅

> 审阅人：文档审阅（对抗角色）｜日期：2026-11-16｜被审版本：`docs/DEV.md` v0.2（491 行，自述"状态：可交接给开发团队"）
> 审阅对象：`docs/DEV.md` v0.2；对照物：`效果图/1.png`、`效果图/2.png`、`REPORT.md`、`preview/m0.html`、`reports/report-e|f|g`、DSH 本地 `dsh-mcp-client` README
> **方向变更插注**：审阅期间收到通知——用户已决定角色走 **3D（VRM/glTF）优先**，`ADR-3` 与 §8 将被改写。本报告对"其余章节"照原计划审，另加 **附录 A** 专审 3D 转向的增量缺口。P0/P1 中凡**仅因 3D 方向而成立**的条目，标 🔺。

---

## 1. 一句话结论

> **不能交接。补完 9 条 P0 才能交接；若按 3D 方向交，再加 1 条 P0（§8 全章 + ADR-3 重写）与 2 条 🔺P1（见附录 A）。**

理由不是"文档写得差"——它比多数同阶段文档好：有术语表、目录结构、ADR、风险表、明确的"不做"清单，而且**它引用的每一个 M0 数字我都实测复现了**（见 §1.1）。问题是它在**最要命的三处**给了假的确定性：

1. **Quick Start 是坏死的**——根目录没有 `package.json`，`npm install` 直接 `ENOENT`；`npm run dev:world` / `dev:client` 两个脚本不存在。文档开头承诺"读完 §2 就能开工"，第一个指令就报错。
2. **世界尺寸/坐标域三处自相矛盾**——`size.y=10` 装不下 §7.1 自己要求的 4 层地下；实测 M0 的世界是 **11 层（y=-4..+6）**；而 `snapshot` 没有 `origin` 字段，负坐标根本进不了 `uint16` 数组。接手的人写下的第一个数据结构就是错的。
3. **iOS 唯一路径的技术前提写反了**——文档说"8th Wall（MIT，已开源）"。**MIT 开源的那份不含 SLAM（世界跟踪）**；含 SLAM 的是 binary-only 许可的 `@8thwall/engine-binary`。而 `report-g` §6② 还写着"别碰 8th Wall"，与 `REPORT.md` §4.1 的"已开源、可用"完全相反。三份交接材料在这件决定 1.5–2.5 周工期的事上互相对撞，DEV.md 却把它当成已定结论写进了风险表的"缓解"栏。

交接前的判断标准不该是"写得全不全"，而是"新人照着做，第一周会不会掉坑里"。按这条标准，现在交出去，前三天就会卡在 §2.2，第一周会推翻世界数据结构，第二周会在 iOS 上撞墙。

### 1.1 先说清楚：哪些地方我实测过、并且是对的（别把这份报告当全盘否定）

| 文档声称 | 我的实测 | 结论 |
|---|---|---|
| §2.1 "444 个方块 → 1,300 三角形 / 12 个 draw call" | `cd preview && node shot.mjs` → `{"triangles":1300,"meshes":12,"blocks":444}` | ✅ **逐位吻合** |
| §2.1 "约 500 行" | `preview/m0.html` = 484 行 | ✅ |
| §2.1 "零美术资源、零官方素材" | 全部 `CanvasTexture` 程序化生成 | ✅ |
| §2.1 "复现：`cd preview && npm i && node shot.mjs`" | 实跑成功，输出 `preview/m0.png` | ✅ **唯一一条真能跑的 Quick Start** |
| 截图确定性 | 重跑后与 `docs/preview-m0.png` **sha256 完全一致**（`1cb42f9e…`） | ✅ 可做视觉回归基线 |
| §2.2 "Node v24.19.0 / npm 11.17.0 / git 2.39 / Chrome 157 / pnpm 未装 / WLAN 192.168.68.54" | 全部核对一致（Chrome 157.0.8103.51） | ✅ |
| §7.3 EULA 引文 "a single Minecraft block (including its textures and its 'look and feel') - we own that" | `_tmp/e_pages/mc-eula.html:312` **逐字命中** | ✅ 引文真实 |
| §7.3 "2026-09-14 下架 237 个仓库" | `_tmp/e_pages/2026-09-14-minecraft-7.md` 首行："entire network of **237** repositories, inclusive of the parent repository"；提交人为 Mojang AB（Microsoft 子公司） | ✅ **数字与主体都对** |
| §6.2 MCP 配置 YAML 字段 | 本地 `dsh-mcp-client/README.md`：`serverName` / `transport` / `url` / `headers` / `toolCallTimeoutMs` 全部存在；`Authorization: !!js` 那行 **就是 README 里的官方示例写法** | ✅ **配置写法正确**（落地细节仍缺，见 P1-8） |
| §11 "32×32×16 面剔除后 7,684" | 跑 `scripts/e_voxel_budget.js` → `tris=7684` | ✅ 数字可复现 |

**这些是可用的资产**：视觉方案（体素 + 接触阴影 + 移轴 + ACES）已经被一张能复现的截图证明；素材许可这条走对了；MCP 配置是照抄官方示例的。文档的骨架可信，**坏在具体接口和数字上**。

---

## 2. P0 问题清单（不修不能交接）

| # | 位置 | 问题 | 改法 |
|---|---|---|---|
| **P0-1** | §2.2 L82–87、§5 L157–187 | **Quick Start 跑不起来**：根目录无 `package.json`（`npm install` → `ENOENT: no such file or directory, open 'D:\研一上\AR_MC\package.json'`），`npm run dev:world`/`dev:client` 无脚本，`packages/` 整个目录不存在 | 改 §2.2 为"已验证/尚不存在"两段（替换文字见下）；§5 目录树顶部加状态行 |
| **P0-2** | §7.1 L277–282 / §6.1 L201 / L216 | **世界尺寸与坐标域三处矛盾**：`size:{x:14,y:10,z:14}` 装不下 §7.1 的"地表 y=0 + 地下 4 层"；实测 M0 是 **12×11×12 占用**（y=-4..+6）；`snapshot` 无 `origin`，负 y 无索引可放 | 加 `origin`，重算 `size`，给出索引公式（替换文字见下） |
| **P0-3** | §6.3 L259 / §7.2 L297–298 | **`roof` 原语用不了**：要求 `stairs:string`（楼梯），但 16 个方块里**没有楼梯**；`BlockDef.rotatable` 为"楼梯/门"定义了却无对应方块；`palette: Record<string,string>` 无法表达朝向（门朝南/楼梯朝向） | ①方块集补 `oak_stairs`/`oak_door`/`glass_pane`；②`palette` 值升级为带 `props`；③按 `dsh-game/blueprint.ts` 的真实约定重写 `layers`（替换文字见下） |
| **P0-4** | §3 L102、§4.1 L118、ADR-8 | **`AnchorProvider` 只有名字没有接口**。三种 provider 的方法集、坐标系、生命周期、"`photo` 到底做什么"全无定义。`report-e` §6.1 本来有 `interface ARSession{start,getCamera,hitTest,getLightEstimate?,getOcclusionMesh?,onFrame}`，DEV.md 改名时把方法全丢了 | 贴 TS 接口 + 三 provider 能力矩阵（替换文字见下） |
| **P0-5** | §1.2 L35(V1)、L47(V13)、L48(V14) | **三条 P0 验收在 AR 模式下不可控**。移轴是整屏后期，WebXR 的摄像头画面由浏览器合成器贴，页面拿不到（`REPORT.md` §4.2、`report-e` §3.4）；"机位高于桌面 20–35cm"在 AR 里是用户的手。M1 一验收就会发现 P0 要素做不到 | 把 V1/V13/V14 拆成"M0 静态图"与"AR 可承诺"两列（替换文字见下） |
| **P0-6** | §12 L461、ADR-8、§14 Q1 | **8th Wall 能力写反了**：MIT 的 `@8thwall/engine` **不含 SLAM**；含 SLAM 的是 binary-only 的 `@8thwall/engine-binary`（免费商用+需署名）。同时 `report-g` §6② 写"别碰"，`REPORT.md` §4.1 写"可用"，两判断未仲裁 | 替换 §12 该行 + 新增 ADR-11 仲裁（替换文字见下） |
| **P0-7** | §6.1 L196–216 | **协议缺三个必需件**：①`reject` 只有一个 `fix`，多 op 的 intent 被部分拒绝时无法表达（`report-f` §4.3 有 `ack.accepted/rejected[opIdx]`）；②无 `baseRev`，服务端无法判断 intent 是否基于过期状态；③§12 承诺的"虚影预览 + 撤销"在协议里**没有 `plan`/`plan_invalidated`/`undo`**，属于"写在风险表里的功能没有接口" | 整段替换为最小闭环（替换文字见下） |
| **P0-8** | §1.1 L26、§1.2 L46(V12) | **弹幕不是效果图要素**。我逐像素看过两张图：**没有任何弹幕/字幕/UI 文字**，只有右下角 B 站水印（1.png 也有，不止 2.png）。那 4 行弹幕只存在于 `preview/m0.html:21-24`（作者自己写的）。"视觉唯一标准"里出现虚构要素，会让团队去图里找一个不存在的东西 | V12 的"从哪张图看出"改为"—（本项目新增）"，并把 Q5 提前（替换文字见下） |
| **P0-9** | §9 L401–409、§14 Q1 | **工期不可执行**：里程碑加总 **18–32 人日**（1–2+2–4+3–5+5–7+7–14），`REPORT.md` §8 说 **14 天走完**，`report-e` §6.3 说阶段 0+1 **1 个人 3–4 天**；再加 §14 Q1 的 iOS +1.5–2.5 周 → 真实 **27–44 人日**（见下方替换表）。M4 一格要塞"弹幕+Bloom+性能+iOS+矿洞玩法" | 换成按交付物拆的估算表 + 不确定性区间（替换文字见下） |

### P0-1 替换文字

> §2.2 环境（本机实测，2026-11-16）下方：
> ```bash
> # ✅ 今天就能跑（唯一已验证的入口）
> cd preview && npm i && node shot.mjs      # → preview/m0.png（444 块 / 1,300 tri / 12 DC）
>
> # ⛔ 下面这条【尚不存在，别试】：根目录没有 package.json
> #   npm install && npm run dev:world && npm run dev:client
> #   它们要等 M1 的 PR-1 建好 workspaces 骨架之后才有
> ```
> §5 目录树第一行加：
> `> 状态（2026-11-16）：packages/* 尚未创建，仓库里只有 preview/。M1 的第一件事是把 §5 的骨架建出来（PR-1，约 0.5 天）。`

同时，§11/§13 里所有 `pnpm test:visual`、`pnpm bench`、`typecheck && test && bench` 都要标成"待 PR-1 建立"，或直接改成现在就能跑的 `node scripts/e_voxel_budget.js`（见 P1-1）。

### P0-2 替换文字

`§6.1` 的 `snapshot` 改为：

```ts
{ t:"snapshot", rev:1024,
  origin:[0,-4,0],                            // ★新增：世界最小角的世界坐标，必须
  size:{x:14,y:12,z:14},                      // ★改为 12：地表 y=0，地下 -1..-4，地上 1..7
  palette:[{id:"air"},{id:"grass_block"},...],// index 0 必须是 air（否则 0 会被读成"草方块"）
  blocks:"<base64 uint16>" }                  // 索引：idx = ((y-oy)*sz + (z-oz))*sx + (x-ox)
```

`§7.1` 表格改两行：

| 项 | 值 | 依据 |
|---|---|---|
| 高度 | **12**（地表 y=0；地下 −1..−4；地上 1..7 留余量） | 实测 M0 真实占用 y=−4..+6 共 11 层，取 12 给屋顶留余量 |
| ~~`island.scale.setScalar(0.42)`~~ | **删掉**（换算错误，见 P1-4） | 14 格 ×0.42 = 5.88 单位 = 5.88cm，不是 42cm |

并补一句：**"x/z 占用 12 格（岛直径），14 格是世界边界"**——实测 M0 的草地只有 106 列 = 12×12，四周各留 1 格空边，所以 `42cm` 这个数对不上（12×3=36cm，见 P1-4）。

### P0-3 替换文字

```ts
// —— 与 refsrc/dsh-game/packages/dsh-game/src/games/minecraft/blueprint.ts 对齐 ——
type BlockRef = string | { id: string; props?: Record<string,string> };  // props: facing/half/type

type Structure = {
  id?: string;
  origin: [number, number, number];          // [x,y,z]（明确写出来，现在是隐含的）
  anchor?: "min" | "center";                 // center = 仅 x/z 居中，y 不动（写清！）
  size: [number, number, number];            // [x,y,z]
  legend?: Record<string, BlockRef>;         // ★替换 palette：字符 → 方块（可带 props）
  layers?: string[][];                       // layers[层号 y][行号 z]，第 1 层在最下面
                                             //   行 0 = 最北侧（-z），行号向 +z 递增
                                             //   行内字符自西（-x）向东（+x）
                                             //   '.' = 清空该格；' ' = 不动（保留原方块）
  primitives?: Array<
    | { kind:"box";      from:[number,number,number]; to:[number,number,number]; b:BlockRef; mode:"fill"|"hollow"|"clear" }
    | { kind:"cylinder"; base:[x,y,z]; r:number; h:number; axis:"y"; b:BlockRef; hollow?:boolean }
    | { kind:"sphere";   center:[x,y,z]; r:number; b:BlockRef; hollow?:boolean }
    | { kind:"roof";     type:"gable"|"hip"; from:[x,y,z]; to:[x,y,z]; stairs:BlockRef; fill?:BlockRef; overhang?:number }
  >;
  avoidPlayers?: boolean;                    // 默认 true
  onConflict?: "skip"|"shift"|"abort";       // ★新增，默认 skip（否则批量建被拒一半）
  limits?: { maxBlocks:number; maxHeight:number };  // ★新增，默认 {600, 14}
};
```

三处必须同步改的连带项：

1. **`roof` 的 `style` 改名 `type`**——`kind` 已经是判别字段，再用 `style` 只是命名不一致；更重要的是**必须在 §7.2 补 `oak_stairs`**，否则 `stairs` 参数无方块可填。
2. **`layers` 的轴约定原来写错了**：原文 `layers[y][z] = 一行字符串` 只对了一半——`[y][z]` 是"层 / 行"，而行**不是**按 x 排列的容器索引，行内字符才是 x；而且原文**没有**说"行 0 在北、第 1 层在底下、`.` 清空 / 空格不动"这三条。`dsh-game` 的注释把这三条写得很死，抄漏了 LLM 就会把房子画反。
3. **`primitive` 的 `center` 元数不一致**：`cylinder.center:[x,z]`（2 维）vs `sphere.center:[x,y,z]`（3 维）。统一成 `base:[x,y,z]` + `axis`。

### P0-4 替换文字

```
§4.1 ar/ 层，直接贴接口（来源：report-e §6.1，改名 AnchorProvider）：

export interface AnchorProvider {
  readonly kind: 'webxr' | '8thwall' | 'fallback';
  readonly canPostProcessCamera: boolean;   // ★WebXR=false，另两者=true —— 决定能不能做 V1/V14
  start(canvas: HTMLCanvasElement): Promise<void>;
  getCamera(): THREE.PerspectiveCamera;     // WebXR 由浏览器控制，禁止改 projectionMatrix
  hitTest(screenX: number, screenY: number): Pose | null;   // Pose = {position,quaternion}
  getLightEstimate?(): { sh?: Float32Array; dir?: THREE.Vector3; intensity?: number } | null;
  getOcclusionMesh?(): THREE.Mesh | null;
  updateAnchors(): void;                    // 每帧调用；WebXR 内部走 XRFrame
  onFrame(cb: (t: number) => void): void;
  dispose(): void;
}
```

并补一张三 provider 能力矩阵（这张表是全文档最该有的表，现在完全没有）：

| | `webxr`（Android） | `8thwall`（iOS） | `fallback`（原 `photo`） |
|---|---|---|---|
| 平面检测 | ✅ ARCore | ✅ SLAM | ❌ 手动放置 |
| 拿得到摄像头纹理 | ❌（合成器贴的） | ✅ `VideoTexture` | ✅（有无均可） |
| 能否对真实画面做移轴 | ❌ | ✅ | ✅ |
| 光照估计 | ✅ `light-estimation`（可选特性） | ✅ | ❌ |
| 遮挡 | ✅ `depth-sensing`（可选） | ❌ | ❌ |
| 在 `requiredFeatures` 里只放 `hit-test` | ⚠️ **放了 `light-estimation` 会整条路 requestSession 失败**（report-e L673） | — | — |

> **`photo` 这个名字必须改**：`report-e` 叫 `FallbackAdapter`（3DOF 陀螺仪 + 手动放置）。叫 `photo` 会让接手的人以为"贴一张静态照片"，而实际上它是"实拍 + 陀螺仪 + 手动拖放"，两者观感差一个量级。

### P0-5 替换文字

§1.2 表格里 V1/V13/V14 三行改为：

| # | 要素 | M0 静态图（可验收） | AR 模式（可承诺） | 优先级 |
|---|---|---|---|---|
| V1 | 真实桌面 + 背景虚化 | 后期移轴模拟 | **Android/WebXR：只对 3D 内容做景深，真实桌面保持清晰**；iOS/8thwall：可对整屏做 | P0（M0）/ P1（AR） |
| V13 | 低角度略等距广角 | 固定机位：仰角 30–35°、FOV 38 | 由用户手持决定；只提供"默认俯视提示 + 双指调 FOV" | P1（M0）/ P2（AR） |
| V14 | 移轴微缩感 | ✅ 已实现 | **WebXR 下只作用于 3D 层**，见上 | P0（M0）/ P1（AR） |

理由写进注：`REPORT.md` §4.2 已明确"WebXR 里你改不了摄像头画面"；`report-e` §3.4 补了唯一例外（`camera-access` + `renderer.xr.getCameraTexture()`，但要多一次全屏拷贝、自己对齐内参、支持面比 depth-sensing 更窄，**不建议 v0 用**）。这条是"三个 P0 要素在主力平台上打折"，必须在 §1 就写清，不能留到 M1 才发现。

### P0-6 替换文字

§12 风险表 iOS 行改为：

| 风险 | 影响 | 缓解 |
|---|---|---|
| **iOS 没有 WebXR** | 一半用户看不到真 AR | `AnchorProvider` + **8th Wall 两条产物**：①`@8thwall/engine`（**MIT，但明确不含 SLAM**，只有 Image/Face/Sky）②`@8thwall/engine-binary`（**含 SLAM，binary-only 许可，免费商用、需署名**）。要世界跟踪只能用 ②；引入方式 `<script src="https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js" data-preload-chunks="slam">`（源：本地抓取 `_tmp/e_pages/8w-license.html`、`8w-mig-self.html`，2026-11-16）。最差退 `fallback` 模式（仍可玩） |

并加 **ADR-11（仲裁）**：

> **8th Wall 到底能不能用？** 结论：**能用，但"MIT 开源"这个说法是错的**。`report-g` §6② 的"平台 2026-02-28 终止、新项目注册不了"指的是**托管服务下线**；引擎本身免费、无需登录、可自托管（迁移指南明确"your project can live on beyond Feb 2027"）。但"开源的那份没有 SLAM"是硬事实。→ 选型：iOS 走 `engine-binary`（29.3 MB 解包体积，首屏成本真实），**不承诺 iOS 上的纯开源方案**。待核：2027-02 之后 binary 的长期可用性（见 §8 未验证清单）。

### P0-7 替换文字

§6.1 消息表补三行、`intent` 补两个字段：

```ts
// 服务端 → 客户端（新增）
{ t:"ack",  seq:42, rev:1025,
  accepted:[0,1,2],                       // 被接受的 op 下标
  rejected:[{i:3, reason:"occupied", expect:"grass_block"}] }   // 逐 op 结果，不再是单个 fix
{ t:"resync", fromRev:1024, toRev:1100 }  // rev 断层 → 客户端必须重拉快照
{ t:"plan", planId:"p1", cells:[[x,y,z,b],...], ttlMs:30000 }   // AI 虚影预览
{ t:"plan_invalidated", planId:"p1", reason:"player_overlap" }  // 玩家动到计划区 → AI 重规划

// 客户端 → 服务端（改）
{ t:"intent", seq:42, baseRev:1024,       // ★新增 baseRev：服务端拒绝基于过期状态的 intent
  ops:[...] }
{ t:"undo", targetRev:1020 }              // ★新增：撤销也是一次 op，可协作安全
```

然后**必须写死一条裁决规则**（现在是空白，而它是"AI 与玩家走同一条路径"这条纪律能否自洽的支点）：

> **批量 op 原子性**：一个 `intent` 内的 op 按 `onConflict` 处理——`skip`（默认，逐格跳过并在 `ack.rejected` 里列明）/ `shift`（整体平移 1 格重试，最多 4 次）/ `abort`（全拒）。**不做"部分成功"的静默**：AI 必须能从返回值里知道"哪几格没盖上"。

这条规则直接回答"`voxel_build` 批量建一栋房子会不会被拒一半"：**不会**，因为默认 `replaceAirOnly + skip`——占用的格子跳过，其余照建，返回 `placed/skipped`。但**前提是把这条写进文档**，否则实现者会各自发明。

### P0-8 替换文字

§1.1 表格 1.png 行改为：
`全景：桌面 + 草方块岛 + 木板房骨架 + 树 + 箱子 + TNT + 火把 + 两个 Q 版角色（右下 B 站水印）`

§1.2 V12 行改为：

| V12 | 弹幕式字幕 | —（**本项目新增，效果图中不存在**；4 行弹幕仅见于 `preview/m0.html`） | DOM + CSS（不进 WebGL） | P1（待 §14 Q5 拍板） |

并加一句注：`> 注意：两张效果图里没有任何 UI/文字层。§4.1 的 ui/（弹幕/物品栏/AI 气泡）全部是本项目新增，没有视觉基准，需要单独出 UI 稿——不要指望"照着效果图做"。`

### P0-9 替换文字

§9 改为按交付物拆分，删掉单一"估时"：

| 里程碑 | 交付物 | 估时（1 人，有 3D/前端经验，不熟 AR） | 不确定性 |
|---|---|---|---|
| M0 | 静态微缩截图 | 1–2 天（**已完成**） | — |
| PR-1 | workspaces 骨架 + `voxel-core` 类型 + 单测 | 0.5–1 天 | 低 |
| M1a | Android WebXR hit-test 把岛钉上桌 | 2–3 天 | **高**（真机成功率未测，`REPORT.md` §8 定为 go/no-go） |
| M1b | 点按放置/破坏 + 乐观更新回滚 | 2–4 天 | 中 |
| M1c | 撤销 / 虚影 / 画笔·橡皮·吸管（`report-f` §4.7 判为 **P0**，原 §9 完全没有） | **3.5 天** | 低 |
| M2 | `worldd` + WS + 重连 + 存档 | 3–4 天 | 中 |
| M3 | DSH + `voxel_*` + 角色状态机 | 5–7 天 | 中 |
| M4a | 视觉打磨（Bloom/颗粒/曝光跟随/矿洞） | 3–5 天 | 低 |
| M4b | iOS（8th Wall binary 接入） | **5–10 天** | **高**（29 MB 引擎 + SLAM 集成，无人做过） |
| M4c | 性能（真机 30fps）/ 真机适配 | 2–4 天 | 高（从未在手机上测过，`report-e` §7 #1） |
| | **合计** | **27–44 人日**（含 M0） | |

并在表下直接写：`> 与 REPORT.md §8 的"两周验证路径"不是同一件事：那是"能不能证伪"的最小路径（不含 iOS、不含打磨），本表是"能交给人看的产品"。两表不要混用。`

---

## 3. P1 问题清单（第一周会踩坑）

| # | 位置 | 问题 | 改法 |
|---|---|---|---|
| **P1-1** | §11 L438–439、§13.4 L476、§2.2 L76 | **工具链全空转**：`pnpm test:visual`、`pnpm bench` 不存在；根目录无 `tsconfig.json`、无测试框架、无 CI；§2.2 推荐 npm workspaces，§11/§13 全用 pnpm，而 pnpm 未装 | 定 `vitest` + 4 条真命令：`node scripts/e_voxel_budget.js`（已有）、`cd preview && node shot.mjs`（已有）、`npm test`（待建）、`npm run typecheck`（待建）。二选一：统一 npm，或 §2.2 改成"必须装 pnpm" |
| **P1-2** | §11 L445 标题"性能预算（有实测支撑）" | **名不副实**：全部数字来自 PC（实测渲染器 = RTX 3060 / 1600×900 / DPR 1），**没有任何手机实测**；`report-e` §7 #1 明说"中端安卓真机帧率 = 未验证"。且预算表主体是**三角形数**，而 `report-e` §3.4 的结论是 **移动端瓶颈在填充率**（1080×2340 @60fps = 152 Mpx/s，移轴再 +19%–100%） | 标题改"性能预算（PC 推算，手机未测）"；表内补三行：填充率上限、首帧时间、**输入→画面延迟（report-f §4.6 实测 8–20 ms）** |
| **P1-3** 🔺 | §11 L450 vs §8.2 L341 / ADR-3 | **自相矛盾**：预算写"角色 <30k（两个），Q 版骨骼模型 15k/个"，而 §8.2/ADR-3 说 v0 是 **billboard8 纸片人**（每角色 2 三角形）。这批数字显然是从 `scripts/e_voxel_budget.js` 的"2 个 Q 版角色 (VRM/glTF)"直接搬来的 | 🔺3D 方向下**这条自动变对**，但要改成**按 pass 计**：主 pass + 阴影 pass + 描边 pass ≈ ×3 → "两个角色 30k tris 意味着每帧 90k"。见附录 A-4 |
| **P1-4** | §7.1 L277、L282、REPORT §3.1 | **尺度换算错一个数量级**：`island.scale.setScalar(0.42)` 若按 1 单位=1cm，14 格 ×0.42 = **5.88 cm**，不是 42cm。正确值：cm 制 `×3`，米制 `×0.03`。另：一格"3cm"与 `REPORT.md` 的"3.5–4.5cm"冲突；且实测 M0 岛直径只有 **12 格 = 36cm**，不是 42cm | 删掉 0.42，改 `const VOXEL_CM = 3; island.scale.setScalar(UNIT_IS_CM ? 3 : 0.03)`，并注明"岛实测 12 格 ≈ 36cm，在 REPORT 的 38–48cm 区间**之外**，若要 42cm 需把 `CX*0.78` 提到 0.98 或改判 14 格" |
| **P1-5** | §7.1 L279 | **地下土层与 M0 实测不符**：§7.1 规定"3 层泥土 + 1 层石底"（统一），实测 M0：**55/106 根柱子底面在 y=−2（泥土）**、38 根到 −3、13 根到 −4。即**一半的岛底是悬空的**（桌面在 y=−4.02，岛底在 −2 → 2 格空隙），接触阴影落在离岛 2 格远的平面上——正是 `report-g` ④ 警告的"浮空/贴纸感" | §7.1 补一段可复制的列生成公式：`y=0 草 / −1..−2 泥 / −3 石（100%）/ −4 石（噪声）`，并让 §2.1 的截图重拍（现在的截图恰好把这个缺陷切在画框外） |
| **P1-6** | §6.1 L204 | **`actors` 消息不足以驱动 3D 角色**：①`anim:"build"` 不在 §8.3 定义的 8 个状态里（应为 `place`/`mine`）——**全文没有枚举定义**；②没有 `stateSince`，10Hz 采样下接收端无法知道动画播到哪；③`yaw:1.57` 未标单位（弧度？）；④`bubble` 无 TTL，客户端不知道该显示多久 | 改为 `{id,x,y,z,yawRad,state:"walk",stateSince:1234.5,bubble?}[]`，并写明"位置 4–10Hz + 客户端插值；**动画由本地状态机从 `state`+`stateSince` 驱动**，不靠 10Hz 采样" |
| **P1-7** | §6.1 L202–203 / §6.3 L253 / L261 | **方块引用三套类型混用**：WS 用 `b:17`（uint16 索引）、`Structure` 用 `b:string`（方块 id）、palette 用 `Record<string,string>`（字符→id）。同一个概念三种写法，客户端必然写出转换 bug | 全文统一为 `BlockRef = string \| {id, props?}`；WS 的线上编码才用 uint16，且必须写"线上用索引、代码里用 id、边界处只做一次转换" |
| **P1-8** | §6.2 L220–232 | **MCP 配置字段是对的（已核 README），但落地细节全缺**：①没说这段 YAML 写进**哪个配置文件的哪一节**；②`VOXEL_TOKEN` 怎么进 DSH 的进程环境没写（`!!js` 在 harness 进程求值，起服务时没 export 就变成 `Bearer undefined` → 401 且无明确诊断）；③没设 `failOnStartupError: true`，世界服务没起时 DSH **静默启动、无体素工具**，模型只会"胡说八道"；④worldd 用哪个 MCP SDK、哪个协议版本（README 说 SDK 选 `2026-07-28`，回落 legacy）没写 | 补：配置文件路径 + `export VOXEL_TOKEN=…` 的启动顺序 + `failOnStartupError: true` + `reconnect.maxAttempts` 说明（10 次×30s≈5 分钟后工具消失），以及"worldd 用 `@modelcontextprotocol/sdk` 的 `StreamableHTTPServerTransport`" |
| **P1-9** | 全文 | **没有存档格式**。`voxel-core/world.ts` 号称有"快照/差异"，但只有网络快照；进程重启世界归零。`report-f` §4.5 已有现成方案（`world.bin` = 32KB + rev 写文件头，每 5s / 200rev 落盘），DEV.md 一个字没提。M2 验收"断线重连不丢"也没定义"丢"指什么（本地未确认 op 必然丢） | 新增 §7.4 存档：文件格式、"rev 必须在文件头且重启后继续递增"（否则客户端以为世界被重置）、以及 M2 验收改为"重连后服务端状态一致；本地未确认的 op 丢弃并在 UI 提示" |
| **P1-10** | §1.2 全表、§6.3 | **效果图里最大的物体没有规格**：两张图的右半幅都是**石山/矿洞**（阶梯状堆叠、拱形洞口、内嵌煤矿石黑斑 + 钻石矿青斑），而 14 条要素里只有 V6"矿石嵌在石头里"。石山本身没有要素、没有原语（`primitives` 无 cave/mountain）、没有方块（16 个里的 `cobblestone` 在图上并未出现——图里的山体更像 `stone` 的平滑噪点面）。V2 也只写"不规则边缘"，**没写台地高差**（实测 M0 地面 106 列全在 y=0，完全平；图里房屋坐在 1–2 格台地上） | V2 补"岛面有 1–2 格台地高差"；新增 V15"石山/矿洞：阶梯状堆叠 + 拱形洞口 + 矿石内嵌"；`primitives` 补 `{kind:"cave", from, to, r}`（拱形挖洞） |
| **P1-11** 🔺 | §8.1–8.3 | **状态机表达不了 2.png 的姿势**：8 个互斥状态（idle/walk/mine/place/hold/kneel/cheer/talk），而 2.png 是"**跪姿 + 手持发光物**"同时成立——两状态二选一。图里还有"持 TNT"（1.png 背景角色），`attachments` 只定义了 orb/pickaxe/tail | 拆成正交三层：`posture`（stand/kneel/sit）× `handItem`（none/orb/pickaxe/tnt/block）× `base`（idle/walk/mine/place/cheer/talk）+ `facing`。这样 2.png 的姿势 = `kneel + orb` |
| **P1-12** | §1.3 L52 vs §14 Q4 L490 vs V6 L40 vs M4 L409 | **矿洞范围三处口径不一**：§1.3 说"矿石只是装饰与可挖"（已定），§14 Q4 说"是否要矿洞/挖掘玩法（待定）"，V6 是 P1，M4 又要做"矿洞玩法"。三处互相打脸，接手的人不知道该做多少 | 统一为：v0 = **装饰性矿石 + 可敲掉（掉 1 个方块，无物品系统）**；"挖掘玩法"移到 v1，Q4 从"待决"改成"已决（v0 不做玩法，只做可挖）" |
| **P1-13** | §4.1 L122、§1.2 V12 | **UI 没有视觉基准**：效果图里没有任何 UI；物品栏、AI 气泡、连接状态、弹幕全是新增，却没有尺寸/字体/安全区规范。实测 M0 的弹幕在 1600×900 上勉强排得开，但换成 390px 宽的手机竖屏就崩：第 3 行 `left:24%` + 16 个 34px 汉字 ≈ 638px，**六成文字在屏幕外**；第 4 行 `left:81%` 同样出框 | 补一节 UI 规范：安全区（`env(safe-area-inset-*)`）、字号 `clamp(14px,3.6vw,22px)`、弹幕分 lane（每 lane 6 秒/屏高 12%）、物品栏槽位 ≥44pt 触控 |
| **P1-14** | 全文 | **没有首帧/加载预算**：iOS 光 8th Wall 引擎就 29.3 MB（`report-e` §4.6），3D 角色按 15k tri + 贴图再加数 MB。全文档没有"首屏多久可玩"的指标和 loading 设计 | §11 补一行：`首帧 < 3s（局域网），可交互 < 6s；loading 期间显示 M0 静态图 + 进度条`；并规定模型体积上限 |
| **P1-15** | §9 M2 L407 | **交互工具集缺项且无估时**：`report-f` §4.7 把"撤销/虚影/画笔·橡皮·吸管"判为 **P0（3.5 人日）**，理由是"AR 里手指粗、误触率高，没有撤销玩家不敢建"。§9 的 M2 只写"点按放置/破坏、物品栏"，这 3.5 天在工期里凭空消失 | 并入 P0-9 的新估时表（已列 M1c） |

---

## 4. P2 建议清单（可以后面补）

| # | 位置 | 建议 |
|---|---|---|
| P2-1 | 根目录 `m0.html` | **0 字节空文件**。新人双击打开是白屏，会浪费半天。删掉，或写一个 3 行的 HTML 跳转到 `preview/m0.html` |
| P2-2 | `preview/m0.html:97`、`:80` | 注释与代码不符：L97 写"22×22 不规则岛"但 L99 是 `N = 14`；L80 写"12 种"但实际只定义 11 种。这种"注释撒谎"在交接时会直接误导人 |
| P2-3 | `preview/shot.mjs` | 跑一次控制台会有 1 条 404（favicon）。视觉回归要读控制台日志，这属于噪声。加一个空 favicon 或过滤 |
| P2-4 | `docs/preview-m0.png` 与 `preview/m0.png` | 两份拷贝，sha256 完全相同。改了一份忘另一份是必然的。§2.1 只引用一处即可 |
| P2-5 | §3 术语表 | 缺正文已用但未定义的词：`rev`、`pending`、`plan`、`ghost/虚影`、`site`、`footprint`、`pivot`、`facingOffsetDeg`、`DPR`、`anchor`、`Section/chunk 的关系`。**尤其 `chunk`（16×16×16）**：14×14×10 的世界只有 1 个 chunk，这个概念是空转的，但 §3/§5 又把它写成"网络同步与网格重建的最小单位" |
| P2-6 | §5 L160 | `voxel-core/` 只有 5 个文件，但 `intent.ts` 号称"协议类型+校验（三端唯一来源）"，却没提它要不要带 JSON Schema / zod。给个具体选型（建议 `zod` + `z.infer`） |
| P2-7 | §10 ADR | ADR 没有模板和状态字段。建议补 6 行模板（`编号/日期/状态: proposed\|accepted\|superseded/背景/决策/后果`），并把 ADR-11（8th Wall 仲裁）做成模板的第一个实例 |
| P2-8 | 全文 | 缺三个可直接复制的模板：**PR 模板**（§13.4 要求"bench 报告贴 PR"，但没有模板）、**美术需求单**（§8.4 那张表可以原样搬成 `docs/art-brief.md`，现在还埋在文档中段）、**CONTRIBUTING.md**（提交信息规范在 §13.5） |
| P2-9 | §8.3 L368 | `attachments.asset:"diamond_block"` 用的是 1×1 立方体方块，而 2.png 手里是**八面体水晶**（有棱角、会发光）。观感差一档。改名 `diamond_orb` 并单独建模 |
| P2-10 | `preview/m0.html:159` | M0 摆了 **3 个 TNT**，效果图里只有 **1 个**；树在 m0 里位于右侧，图里在中间偏后（房子与矿洞之间）。构图基准对不上，M0 的验收结论会虚高 |
| P2-11 | §1.2 | 建议补 **V15 胶片颗粒 + 曝光跟随环境光**（`report-e` §3.5：颗粒 0.03–0.06，"纯 CGI 的干净是'假'的主要来源"；曝光跟随"比任何材质调参都管用"）。这两条比 V12 弹幕更接近"像不像"的核心 |
| P2-12 | §7.3 | 纹理替代方案只写了 `programmerart-textures`（CC0，349 张）。`report-e` §5.3 还有 Kenney Voxel Pack 等备选，且 `report-e` §7 #9/#12 标注"许可原文未取到/像不像未验"。如果要发布，这块需要有一个人真的把 atlas 拼出来看一眼 |

---

## 5. 六个维度逐项评分

| 维度 | 分 | 一句话理由 |
|---|---|---|
| **A. 完整性**（能否直接开工） | **2/5** | 骨架齐（术语/目录/ADR/风险都有），但 Quick Start 第一条命令就 `ENOENT`，`AnchorProvider`、`anim` 枚举、`photo` provider、`blocks` 编码全悬空；错误处理、存档、配置、埋点、验收脚本五节全无 |
| **B. 内部一致性** | **2/5** | 世界尺寸 4 处不一致（14×14×10 / size.y=10 / 地下 4 层 / 实测 11 层）、角色高度 3 套数字（2–4 格 / 2.4 / 1.8–3.5）、性能预算与角色形态自相矛盾、`layers` 轴约定抄错、`scale 0.42` 换算错。给 2 不是 1，因为 M0 的 444/1300/12 三个数字**完全对得上** |
| **C. 合理性**（架构接口自洽） | **2/5** | 三层架构与"voxel-core 零 I/O"是对的；但 `AnchorProvider` 无接口（三个 provider 根本无法落到同一签名）、WS 缺 `ack/plan/undo/baseRev`（承诺的功能没有协议）、"AI 与玩家同路"与批量建造的冲突没有裁决规则 |
| **D. 可实现性** | **3/5** | 视觉方案已被 M0 证明（这是最不确定的一块，已经证伪成功），体素+阴影+移轴确实便宜；但估时低估约 1.5–2 倍、交互工具 3.5 天凭空消失、真机性能零实测、8th Wall 集成无人做过 |
| **E. 与效果图贴合度** | **3/5** | 体素/暖光/接触阴影/移轴/矿石/发光/角色尺度这些"神"抓得准；但最大的物体（石山矿洞）没有要素、台地与草丛缺失、弹幕是虚构、第二角色做成了另一个人 |
| **F. 交接友好度** | **2/5** | 有"读这份就能开工"的意图和 ADR/风险表，比多数文档强；但**没有"第一天做什么"**、没有 ADR/PR/美术单模板、Quick Start 断在最前面、隐性知识（比如"移轴在 WebXR 里做不到"）只存在于子报告里 |

> 总分 **14/30**。一句话：**"讲清楚了想做什么，没讲清楚怎么开始做，且在三个关键数字上给了假的确定性。"**

---

## 6. 漏掉的效果图要素

我按"一个没看过效果图的人能否只用文字复现"的标准，逐项比对了原图（2533×1384 / 2464×1374，已按原尺寸读）。以下 12 条是**图里明确存在、但 §1.2 的 14 条要素没有覆盖**的：

| # | 要素 | 证据（图里在哪） | 为什么重要 |
|---|---|---|---|
| **1** | **石山/矿洞**（阶梯状堆叠、拱形洞口、内嵌矿石） | 两张图的**右半幅主体**，约占画面 40% | 这是全图最大的几何体，比房子大三倍。§1.2 只有 V6"矿石嵌在石头里"，**山体本身完全没规格**（无原语、无方块、无高度） |
| **2** | **台地高差** | 1.png 房屋坐在 1–2 格高的台地上；2.png 前景草地与矿洞之间有明显 1 格台阶 | §1.2 V2 只说"不规则边缘"（俯视轮廓），没说侧面高度变化。实测 M0 地面 106 列**全在 y=0**，完全平 |
| **3** | **草丛/高草** | 1.png 树干旁、2.png TNT 旁各有 2 格高的小草簇 | 方块集里没有 `tall_grass`；它是最便宜的"活着"信号，成本几行 |
| **4** | **门与门内暖光** | 1.png 屋左墙有一个洞口，洞内有黄色火把光 | 方块集没有 `oak_door`。§1.2 只提火把，没提"门洞 + 内部光源"这个组合 |
| **5** | **侧墙小窗** | 1.png 房屋侧墙的小方洞 | m0 做了但 §1.2 未列为要素；`glass` 是唯一能当窗的方块 |
| **6** | **第二个角色（同一形象，持 TNT）** | 1.png 背景角色手里抱着一块 TNT（红白 "TNT" 字样清晰可见） | §8 只定义了一个角色 `dafeiyu`。而**图里两个角色是同一个蓝发鱼娘形象**，M0 却做成了两个人（`'?'` 黄盔深发猫耳），属于"看错了图" |
| **7** | **地上的钻石镐（道具）** | 2.png 岛面斜放一把钻石镐 | 既不是方块也不是 `attachments`（那是手持挂点），完全无规格。它是"角色刚干过活"的叙事道具 |
| **8** | **洞口下的碎石堆** | 2.png 矿洞前 3–5 块散落的石头 | 说明石山有"倾倒/开采"痕迹，不是干净的地形 |
| **9** | **胶片颗粒 + 曝光跟随环境光** | 两张图的整体质感（低对比、微噪） | `report-e` §3.5 明确："颗粒 0.03–0.06，纯 CGI 的干净是'假'的主要来源"；曝光跟随"比任何材质调参都管用"。**这两条比弹幕更接近"像不像"的核心** |
| **10** | **虚化的不对称结构** | 1.png：上方（房间背景）最糊、中前景（岛+角色）最清晰、画面最下缘再次变糊 | V14 只写"上下虚化"。实际是"**中间一条清晰带 + 上下渐强**"，且清晰带中心略低于画面中线（约 0.55–0.6），M0 用的是 `r=0.50` |
| **11** | **B 站水印在两张图上都有** | 1.png 右下、2.png 右下 | §1.1 只写"2.png 右下有 B 站水印"。小错，但"唯一标准"章节的事实错误成本很高 |
| **12** | **岛的侧面厚度 ≈ 4–5 格 + 底部暗色收边** | 两张图的岛侧面：草 1 层 + 泥土 2–3 层 + 更深一层暗色 | §7.1 写"3 层泥土 + 1 层石底"（合计 4 格）。`report-g` ⑤ 写的是"草(1)/泥土(2–3)/石头(2–3)/底部暗色收边"（最多 8 格）——**两份材料对土层厚度的说法差一倍**，而 30–45° 视角下侧面厚度直接决定"微缩感"。实测 M0 最多到 y=−4（5 格），但 52% 的柱子只有 3 格 |

### 反过来看 §1.3"明确不做"——有没有其实图里要求的？

**没有一项是图里要求的**（多人、昼夜、生存、VR 都不在图里）。但 §1.3 有一处**与其它章节打架**：它写"矿石只是装饰与可挖"（= 范围已定），而 §14 Q4 又问"是否要矿洞/挖掘玩法"（= 范围未定），M4 还要做"矿洞玩法"。这不是"多做了"，而是"同一件事在三个地方有三种状态"（见 P1-12）。

---

## 7. 交接前的最小补丁清单（按顺序，可直接照着改）

> 顺序按"阻塞关系"排：前面的不做，后面的做了也白做。粗体是**必须在今天之内完成**的（明天就要交出去）。

| 顺序 | 动作 | 预计 | 产出 |
|---|---|---|---|
| **1** | 改 **§2.2 Quick Start**：拆成"✅已验证 / ⛔尚不存在"两段（P0-1 替换文字），§5 目录树加状态行 | 10 min | 新人不会第一步就报错 |
| **2** | 改 **§7.1 + §6.1**：加 `origin`、`size.y` 改 12、删 `scale 0.42`、补索引公式（P0-2） | 20 min | 数据结构可写 |
| **3** | 改 **§1.1 + V12**：删掉"4 行弹幕"的虚构来源，加"两张图无 UI"的注（P0-8） | 5 min | 视觉基准不再撒谎 |
| **4** | 改 **§12 iOS 行 + 新增 ADR-11**：8th Wall 两个包、许可差异、引入方式、"MIT 不含 SLAM"（P0-6） | 20 min | iOS 方案建立在真事实上 |
| **5** | 改 **§6.3 Structure**：`legend` 带 props、`layers` 三条约定、`roof.type`、`onConflict`、`limits`；§7.2 补 `oak_stairs`/`oak_door`/`glass_pane`（P0-3） | 40 min | AI 建造路径可实现 |
| **6** | 改 **§6.1 协议**：`ack(accepted/rejected)` + `baseRev` + `plan/plan_invalidated` + `undo` + 批量原子性规则（P0-7） | 30 min | M2/M3 不用返工 |
| **7** | 改 **§4.1 ar/ 层**：贴 `AnchorProvider` 接口 + 三 provider 能力矩阵 + `photo`→`fallback` 改名（P0-4） | 30 min | AR 层可以动手 |
| **8** | 改 **§1.2 V1/V13/V14**：拆"M0 静态图 / AR 可承诺"两列（P0-5） | 15 min | 验收标准不再自欺 |
| **9** | 改 **§9 里程碑**：换成按交付物拆的估时表，补 M1c（撤销/虚影/工具）和 M4b/c（P0-9 + P1-15） | 30 min | 工期可承诺 |
| **10** | 补 **§7.4 存档** + M2 验收口径（P1-9） | 20 min | 重启不丢世界 |
| **11** | 补 **"第一天做什么"** 一节（新增 §15）：PR-1 的 checklist（建 workspaces / 抽 `intent.ts` 类型 / 跑通 `voxel-core` 的 mesher 单测 / 把 `scripts/e_voxel_budget.js` 接成 `npm run bench`） | 20 min | 交接的真·入口 |
| **12** | 补 **三个模板**：`docs/adr/0000-template.md`、`.github/pull_request_template.md`、`docs/art-brief.md`（把 §8.4 搬过去）（P2-7/P2-8） | 30 min | 新人不用问"格式是什么" |
| **13** | 🔺 按附录 A 重写 **§8 全章 + ADR-3**，补"3D 角色管线"一节 | 2–3 h | 3D 方向可执行 |
| **14** | 删根目录 0 字节 `m0.html`；改 `m0.html` 两处撒谎注释；补 §3 术语表缺词（P2-1/P2-2/P2-5） | 15 min | 少三个坑 |

第 1–9 项合计约 **3.5 小时**。这 9 项做完，文档就从"不能交接"变成"能交接（带已知风险）"。

---

## 8. 未验证清单（不要把这些当结论用）

| # | 未验证项 | 卡在哪 | 影响 |
|---|---|---|---|
| 1 | **中端安卓真机帧率与发热** | 从未在手机上跑过；M0 的 1,300 tri 是 RTX 3060 / 1600×900 的数字 | §11 的所有性能结论都是推算。P1-2 |
| 2 | **WebXR hit-test 在真桌面上的稳定性**（漂移/抖动/重定位） | 无真机；`REPORT.md` §8 自己定为 go/no-go | M1 能不能过，是整个项目最大的技术风险 |
| 3 | **`@8thwall/engine-binary` 的实际集成步骤与 SLAM 质量** | 只读到官方文档页（`_tmp/e_pages/8w-*.html`），**没有实测**。`report-e` §7 #6 也承认"具体怎么嵌入没看到步骤" | iOS 工期 5–10 天是猜的。P0-6 |
| 4 | **8th Wall 在微信/抖音内置浏览器的可用性** | 官方只承诺 Safari / SFSafariViewController(iOS 13+) / WKWebView(iOS 14.3+)，**未点名微信** | 分享链接的传播路径 |
| 5 | **2027-02 之后 8th Wall binary 的长期可用性** | 迁移指南只说"beyond Feb 2027"，无后续承诺 | 长期可发布性 |
| 6 | **VRM 0.x / 1.0 的朝向约定在 three.js 里的实际符号** | 两种版本约定不同，three-vrm 内部有转换；我**没有实测**过"加载后走 +Z 是前进还是倒退" | 🔺3D 方向的第一天就会撞上。见附录 A-3 |
| 7 | **免费 VRM 里是否存在"2–3 头身 Q 版 + 鱼尾"的可用模型** | 用户的判断是"网上应该会有"，我未做检索验证 | 🔺这可能是 3D 路线最大的单点风险。见附录 A-4 |
| 8 | **`sloemo01/diorama`（555★ MIT）的资产许可是否真的干净** | `report-g` §7 #8：`SOURCES.md`/`CREDITS.md` 在 main 分支 404 | 它是 `report-g` 里"视觉层第一选择"，但 DEV.md 完全没提 |
| 9 | **`island.scale` 在 AR 模式下的真实物理尺寸该是多少** | 我验证了 0.42 是错的，但"应该是 36cm 还是 42cm"取决于产品判断 | P1-4 |
| 10 | **`report-g` §6② "别碰 8th Wall" 的依据是 2026-02-28 的平台停止访问** | 我只核到"托管服务下线、引擎开源、binary 可自托管"，**没有核到"账号注册是否真的关闭"** | P0-6 的仲裁结论方向不受影响，但"注册不了"这句不能写进文档 |
| 11 | **效果图里岛面左缘的淡蓝区域是不是水** | 1.png 左缘 x≈0–40 有一块淡蓝灰色，尺寸太小无法确认是水面还是桌面反光 | 若是水，则方块集要加 `water`，且 §7.2 的 16 个方块要重排 |
| 12 | **弹幕到底是不是产品需求** | 图里没有，M0 里有，`§14 Q5` 待决 | P0-8 / P1-13 |

---

## 附录 A：3D 优先（v0.3 方向）的增量审查

> 前提：用户已决定"一开始就用 3D 模型（VRM/glTF），不走八向纸片人"。以下是**在 v0.2 之外**必须补、必须改、必须承认的东西。
> 一条好消息：**`§11` 的性能预算本来就是按 3D 写的**（"Q 版骨骼模型典型 15k/个"来自 `scripts/e_voxel_budget.js` 的"2 个 Q 版角色 (VRM/glTF)"），所以 3D 转向**修掉了一处原有矛盾**——`§11` 不必改数字，改口径即可（见 A-4）。这是个便宜的方向修正。

### A-1 逐条：文档里哪些地方隐含假设了 2D

| 位置 | 2D 假设 | 3D 下的问题 | 改法 |
|---|---|---|---|
| §3 L105 术语 `纸片人 billboard` / §8.2 L341 `billboard8` | 角色 = 2D 立绘切帧 | 概念本身作废 | 术语改为 `CharacterProvider`（`renderMode: "vrm" \| "billboard8"`），保留 billboard 作为**降级方案**而非主方案 |
| §4.1 L120 `character/ 纸片人 + 状态机 + 胶囊影` | 同上 | — | 改为 `character/ 模型加载 + 动画状态机 + 弹簧骨 + 胶囊影` |
| §8.2 L333–340 `assets/characters/dafeiyu/sprites/{idle,walk,...}/s0..s7.png` | 8 方向 × 8 状态目录结构 | 全部作废 | 改为 `model/dafeiyu.vrm`（或 `.glb`）+ `anim/*.glb`（动画片段）+ `character.json` |
| §8.2 L336 `s0 正对镜头，顺时针 45°` | 八向朝向约定 | 3D 朝向是连续角度，不是 8 档 | 改为"模型正面朝 **+Z**（three.js），`facingOffsetDeg` 默认 0；**导入后必须实测**（见 §8 未验证 #6 的 VRM 0.x/1.0 朝向陷阱）" |
| §8.3 L356 `animationFps: 10` | 逐帧切换立绘的帧率 | 3D 动画是按时间采样的，没有"帧率"概念 | 删掉，改为 `animationMixer.timeScale` 或直接不要 |
| §8.3 L357–364 `states.{idle:{frames:4,loop:true}}` | 状态 = 帧序列 | 状态 = 动画片段（clip）+ 过渡 | 改为 `states.{idle:{clip:"idle_breath",loop:true,fadeMs:200}}` |
| §8.3 L366 `expressions:["normal","happy","surprised"]` | 表情 = 整张图替换 | 3D 表情 = blendShape/morph target，**且 VRM 有标准预设名** | 改为 VRM 1.0 预设表情枚举：`happy / angry / sad / relaxed / surprised / blink / blinkLeft / blinkRight / lookUp / lookDown / lookLeft / lookRight / neutral`（"normal" 不在预设里，模型不会有这个 morph） |
| §8.3 L367–370 `attachments:[{id:"tail", bone:"root", asset:"tail"}]` | 尾巴 = 挂在 root 上的贴图 | 3D 里尾巴是**蒙皮骨链 + 弹簧骨**，不是 attachment | 从 `attachments` 删除；改为 `springBones: {chains:["tail","hairBack"], stiffness, gravityPower}` |
| §8.4 L384 `单帧 256×256/384×384 PNG，透明底，统一画布` | 立绘规格 | 全部作废 | 改为模型交付规格（见 A-2） |
| §8.4 L386 `阴影不画在立绘里` | 立绘内不能带阴影 | 3D 天然分离 | 保留结论，去掉原因 |
| §8.4 L387 `idle 必须有呼吸/尾巴摆动` | 立绘微动 | 3D 是骨骼动画 | 改为"`idle` clip ≥ 2 秒、首尾帧可循环，含呼吸 + 尾巴摆动" |
| §8.5 L390–392 `geometric placeholder：胶囊 + 名字 + 蓝色矩形` | 占位是 2D 矩形 | 占位仍然可用（胶囊） | 保留胶囊 + 名字，删"蓝色矩形"；**并新增 M0.5 用真模型替换一次**（见 A-5） |
| §2.1 L64–68 M0 截图 | 视觉基准含 2D 占位角色 | 3D 后这张图**不能作为角色视觉基准** | §2.1 加注："图中角色是 2D 占位，**不代表最终形象**；角色验收看 M0.5" |
| §11 L450 `<30k（两个角色）` | 数字本身是 3D 的 | ✅ 反而变对 | 但必须改成**按 pass 计**（A-4） |
| ADR-3 L421 `角色先做八向纸片人` | 核心决策 | 与用户决定相反 | 重写为 ADR-3'：**3D（VRM/glTF）优先**；否决的备选 = billboard8（理由：Q 版 3D + 弹簧骨能做连续转身/尾巴摆动/手持物跟手，纸片人做不到；代价：绑定/材质/体积） |

### A-2 3D 路线必须补写的规格（现在一个字都没有）

| 规格 | 建议写死的内容 |
|---|---|
| **模型格式** | `VRM 1.0`（首选，带 humanoid 骨映射 + 表情预设 + license meta）或 `glTF 2.0 + .bin`（备选）。**不允许 FBX 进仓库**（体积 + 需转换） |
| **骨骼命名** | 强制 VRM humanoid 标准：`Hips / Spine / Chest / UpperChest / Neck / Head / LeftUpperArm / LeftLowerArm / LeftHand / …（Right 同）/ LeftUpperLeg / … / LeftFoot`。自定义骨（尾巴/头发）用 `tail_01..N` / `hair_01..N`，前缀固定，便于程序化识别 |
| **朝向与缩放** | 正面朝 **+Z**；脚底中心 = 原点 (0,0,0)；`heightBlocks` 在**运行时**按包围盒归一到 2.4（不要在建模时硬编码，否则换模型就错） |
| **挂点** | `hand_r` / `hand_l` 必须存在（`attachments` 靠它挂 orb/pickaxe）；**并要求美交付时左右手不能反**（VRM 里 Left 是角色自己的左手，从镜头看是右边——这是最常见的翻车点） |
| **材质** | 二选一并写死：①`MToon`（three-vrm 自带，最贴 VRM，但 per-material 成本高）②`MeshToonMaterial + 自绘 gradientMap`（快，但要自己做描边）。**明确写"v0 用 MToon + 关闭 rim/matcap，只留 toon + outline"** |
| **描边** | 反向外壳（inverted hull）→ **三角面 ×2 + draw call ×1**。要么不做，要么写清代价（见 A-4）。3D 的 Q 版**没有描边就没有"二次元"感**，所以这是必做项，必须计入预算 |
| **动画片段清单** | 与 §8.3 的状态一一对应，**命名固定**：`idle_breath / walk / run? / mine / place / hold / kneel / cheer / talk / hit`。每个片段必须声明 `loop` 与 `duration`；**`walk` 必须是"原地循环"**（位移由代码驱动），否则会和位置插值打架 |
| **动画重定向** | 若用 Mixamo/BOOTH 的动画：必须声明"在 VRM humanoid 上做 retarget"，并写清工具（three-vrm 的 humanoid 映射 / Blender 的 VRM addon）。**这是 1–2 天的坑，不能默认"拖进来就能用"** |
| **蒙皮与 LOD** | 角色只有 2 个，**不做 LOD**；改为限制"单模型骨骼数 ≤ 80、蒙皮网格 ≤ 4、材质 ≤ 3"。理由写清：2 个角色做 LOD 是负 ROI，限制骨骼数才省钱 |
| **面部** | 表情 = VRM 预设 blendShape（A-1 那条）。**说话时是否有口型？** 现在 `voxel_say` 只出气泡、全文无音频 → 明确写"v0 无音频、无 viseme；`talk` 只做头部微动 + 表情切换"。否则接手的人会去做唇形同步 |
| **头发/尾巴物理** | `VRMSpringBone`（0.x）/ `VRM10SpringBoneJoint`（1.0）由 three-vrm 的 `update(delta)` 每帧算。**规范：链数 ≤ 4、总关节 ≤ 24、substeps = 1；低端机可整体关闭**（写进 `character.json` 的 `quality` 字段） |
| **手持物挂点** | `attachments` 保留，但语义改为"挂到 3D 骨节点上的独立 mesh"；`orb` 的发光走 Bloom 而不是贴图（与 V7 一致） |
| **移动端上限** | 单角色 ≤ 15k tri、≤ 80 骨、≤ 3 材质、贴图 ≤ 1024²、**单模型文件 ≤ 3 MB**（Draco/meshopt 压缩） |

### A-3 3D 路线新增的风险

| 风险 | 为什么是新的 | 缓解 |
|---|---|---|
| **模型来源与许可** | 2D 时是"找画师画"，3D 时是"找/买/授权模型"，且免费 VRM（VRoid Hub、BOOTH）**大量是"个人使用限定"**。好在 VRM 有**机读许可**（`VRM.meta.licenseName` / `allowedUser` / `commercialUssageName`） | 把 §8.6 的"`license` 字段强制"升级为 **CI 检查**：构建时读 VRM meta，`commercialUssageName !== "Allow"` 直接失败。这比 2D 那套手工填 JSON 可靠得多 |
| **找不到 Q 版模型**（最高风险） | 参考图是 **2–2.5 头身**的 Q 版 + 鱼尾。免费 VRM 绝大多数是 6–7 头身写实动漫比例；VRoid Studio 能捏但**很难压到 2.5 头身**（头再大就破面） | ①**M0.5 先随便拿一个免费 VRM 跑通管线**（不追求像），把"能不能加载/动画/描边/性能"验证掉；②同时开一条"自建/委托"线做形象；③**`renderMode` 保留 `billboard8` 作为 fallback**（成本 0.5 天，防止 3D 找不到模型卡死整个项目） |
| **绑定/蒙皮质量** | 买的模型可能是"静态网格"或权重很烂（腋下撕裂、裙摆穿腿） | 交付验收加一条"做 90° 抬臂 + 蹲下，检查无穿插"，写进 `art-brief.md` |
| **动画重定向** | 见 A-2，1–2 天的隐性成本 | 优先买"VRM 原生动画"（BOOTH 有 VRMA 格式），避免 Mixamo 重定向 |
| **卡通材质在 WebGL 的性能** | MToon 逐材质、描边翻倍、阴影 pass 翻倍；2 角色 × 3 材质 × 3 pass = 18 DC（还好），但三角面 ×3 | 见 A-4 的按 pass 预算 |
| **模型体积与首屏** | 单模型 3 MB + 纹理，叠加 8th Wall 的 29.3 MB | 写首帧预算（P1-14）；模型走 `KTX2 + meshopt`，或先加载低精度版 |
| **`actors` 消息驱动不了 3D 动画** | 2D 时 10Hz 切帧够用；3D 需要连续时间轴 | 见 P1-6：加 `stateSince`，动画本地驱动 |
| **AI 与角色的耦合变了** | 2D 时"状态机 + 八向"是纯前端；3D 后引入 `AnimationMixer`、IK、spring bone，**每帧 CPU 开销进主循环** | §13.6"渲染循环里不许分配对象"要加一条：`mixer.update()` / `vrm.update()` 之外不许 new；spring bone 的 `delta` 要 clamp（断线回来 `delta` 巨大 → 弹簧爆炸） |

### A-4 3D 会推翻的其它结论（直接指出来）

| 被推翻的 | 原结论 | 3D 下应该是 |
|---|---|---|
| **§11 角色三角面预算** | "角色 <30k（两个）" | **不是错，是口径错**。应改为"**单帧总提交三角形**：主 pass 30k + 阴影 pass 30k + 描边 pass 30k ≈ **90k**"，并与 `report-e` §4.1 的"80k–150k tris"社区口径对齐。`scripts/e_voxel_budget.js` 结尾已经算出"含阴影 pass 再 ×2 ≈ 67k"，把它接上再加描边就是 90k+ |
| **§11 的"角色是大头，不是体素"** | 结论对 | 但要补一句"**真正的大头是 pass 数**，不是三角面"——2 角色 3 pass 会把 30k 变成 90k，这才是要压的东西 |
| **§9 M0 是否需要改** | M0 已完成，1–2 天 | **M0 不用改，但要加 M0.5**：把任意一个免费 VRM 丢进 `preview/m0.html` 的场景（three-vrm + `GLTFLoader`），跑通"加载 / 播 idle / 描边 / 收阴影 / 测 fps"，**0.5–1 天**。它同时验证三件事：three-vrm 与 r187 的兼容性、MToon 的观感、真机能否扛住。**这是 3D 方向 ROI 最高的一个动作**，比先做 §8 的规格文档更值 |
| **§8.4 美术交付清单** | 8 状态 × 8 方向 × 2 角色 = 128 张（含帧数实际约 544 张） | **完全作废**。改为：2 个 VRM/glb 模型 + 10 个动画片段（每个 ≤ 3 秒）+ 1 套表情 blendShape + license meta。美术量从"上百张图"降到"一个模型 + 一套动画"，**这是 3D 转向最大的收益**，应该写进 §8 开头 |
| **ADR-3 的否决理由** | "glTF 真模型：建模贵、动画贵、蒙皮开销大" | 这条理由**有一半仍然成立**（建模/绑定/重定向确实贵），要保留到新的 ADR-3' 的"后果"里，否则团队会低估 3D 的隐形成本 |
| **§8.6 许可红线** | 靠 `character.json.license` 手填 | 升级为 VRM meta 机读 + CI 拦截（A-3） |

### A-5 给 3D 方向的落地顺序（建议直接写进 §9）

1. **M0.5（0.5–1 天）**：免费 VRM 丢进 M0 场景 → 加载/动画/描边/阴影/fps 五件事一次验证。**这是 go/no-go**：如果 MToon + 描边在目标手机上跑不动，就退回"`MeshToonMaterial` 无描边"，或退回 billboard8。
2. **定 `character.json` v2**：`renderMode` / `model` / `anim` 表 / `expressions`（VRM 预设名）/ `springBones` / `quality` / `license`（机读）。
3. **接 `AnimationMixer` 状态机**：`state → clip` 的映射表 + `fadeMs`，并在 `actors` 消息里传 `state + stateSince`。
4. **定美术需求单**：把 A-2 的表格搬成 `docs/art-brief.md`，作为对外唯一口径。
5. **CI 加 VRM license 检查**：`commercialUssageName` 必须为 Allow。

---

*本报告的全部实测数字可用以下命令复现：*
```
cd D:\研一上\AR_MC\preview && node shot.mjs          # 444 / 1300 / 12
node D:\研一上\AR_MC\scripts\e_voxel_budget.js       # 7684
node D:\研一上\AR_MC\_tmp\check-m0-bbox.mjs          # bbox 12×11×12, y=-4..6, 底面孔隙 55/106
```
