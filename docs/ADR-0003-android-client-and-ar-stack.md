# ADR-0003：Android 客户端与 AR 技术栈决策

- 状态：**accepted with validation gates**（2026-11-17，用户确认原生 APK、ARCore 与打印标记均为 v0 目标；若 marker 阻塞核心闭环，ARCore 可先行并紧随补齐）
- 决策范围：Android 客户端形态、AR 跟踪来源、3D 渲染/角色管线、客户端网络与配对方式；PC Host 与共享协议仍按现有 TS 工作区演进
- 验收边界：ARCore 与打印标记均是 v0 产品目标，均需真机验证；标记可以因实现阻塞而排在 ARCore 主链之后，但不是降为“未来 v1 目标”。真实遮挡为已知限制，不阻断核心闭环。
- 取代：`docs/IMPLEMENTATION-PLAN.md` §3 中“Android Chrome / ARCore WebXR + three.js”的客户端假设、§5 的 `client`/`render-voxel`/`ar-provider` 模块假设；`docs/ANDROID-DELIVERY.md`“APK = WebView/TWA 壳 + 外部 Chrome”的交付假设；`docs/PROJECT-STATUS-AND-ROADMAP.md` 阶段 C 中“复用已通过的 ARCore provider”表述
- 相关文档：[实施计划](IMPLEMENTATION-PLAN.md)、[技术路线计划](TECH-ROADMAP.md)、[Host API](HOST-API.md)、[结构 DSL](DSL-SPEC.md)、[设备验证](DEVICE-TEST-PLAN.md)、[审核报告](REVIEW-2.md)

---

## 1. 决策摘要

**Android 客户端采用不依赖浏览器承载业务的原生 Kotlin APK**：目标栈为 Jetpack Compose UI + SceneView（Filament + ARCore）；角色走 **glTF 2.0 / GLB**；联网走 OkHttp WebSocket + 自签名证书指纹固定；PC Host 继续用 Node/TypeScript 持有权威世界，并额外提供一个 **PC 检视页**（three.js，loopback）。APK 与 Host 属于同一联网产品，权威世界始终由 PC Host 持有；此决策不承诺 APK 离线作为独立沙盒运行。SceneView 仍需 M0 实机验证，失败回退到已跑通的 Filament + ARCore 直连 POC。

产品已确认与路线约束：原生 APK 内置 Android 业务客户端，不需外部浏览器；PC Host 仍是联网产品的权威世界服务。ARCore 与打印标记都希望进入 v0，但若 marker spike 会阻塞可演示主流程，先完成 ARCore 主链并紧随推进 marker 兼容。真实遮挡缺失可作为已知限制。技术选型本身（SceneView 版本、CameraX/BoofCV 合成）不视作已验证事实。

四条子决策：

| 编号 | 决策 | 说明 |
|---|---|---|
| D1 | 客户端形态：**原生 APK，不依赖浏览器承载 Android 业务** | 用户确认 APK 自带 Android 客户端；联网产品中的权威世界仍由 PC Host 持有，Android APK 是原生取景/交互客户端 |
| D2 | AR 跟踪：**v0 目标同时支持 ARCore 与打印标记** | ARCore 是已实机验证的主链；CameraX + BoofCV 标记路线需 M0 spike。若标记实现阻塞最小闭环，可先交付 ARCore 核心流程并紧随补标记兼容；未验证前不得宣称支持 |
| D3 | 渲染与角色：**SceneView（Filament）+ glTF/GLB** | 体素用自定义 `MeshNode`；角色用 `ModelNode`；卡通材质用 Filament `.filamat`；不引入 VRM 运行时 |
| D4 | 网络与配对：**WSS + 证书指纹固定 + 一次性配对码** | 原生客户端不受浏览器“安全上下文/可信证书”约束；扫描二维码即完成配对，无需安装 CA |

**一句话理由**：产品要求“原生 APK 内置 Android 业务 + 桌面 6DoF + v0 打印标记目标 + 开源成熟组件”，只有原生客户端同时满足；Web/WebXR 路线在“APK 内置业务”“非浏览器承载”“v0 标记兼容目标”三条上结构性不成立，Godot 的 Android AR 插件已停止维护，Unity 成熟但不是开源路线。

路线和里程碑用于组织依赖及验收，不构成人日/日历工期承诺。

---

## 2. 背景与约束

### 2.1 产品约束（已确认）

- 真实桌面上的 16³ 微缩体素世界，3 cm/格；手机是取景与输入端，PC 持有权威世界。
- 单用户、单 companion、单 home plot；AI 可在授权地块内自主放置空格块，越界/覆盖/扩地必须人工确认。
- Android 交付为**可手动安装的 APK**；v0 不接真实 Minecraft、不做 iOS、不做多人实时联机。
- 用户 2026-11-17 明确选择：
  1. **v0 目标为 ARCore + 打印标记**；若标记阻塞核心闭环，可先完成 ARCore 主链并紧随补齐标记兼容；
  2. 原生 APK 的 Android 业务不依赖浏览器，权威世界由 PC Host 持有；
  3. 角色**可以导出 glTF/GLB**；
  4. **需要 PC 检视端**（同一世界、只读为主）。

### 2.2 工程约束（实测）

| 项 | 现状 | 影响 |
|---|---|---|
| 设备 | Samsung Galaxy Tab S8（SM-X800，Android 16/API 36，Adreno 730，GLES 3.2）；ADB 已授权，原生 ARCore POC 已完成首轮真机 smoke（相机背景、水平面命中、anchor、测试方块） | 原生路线已有可复用验证；WebXR 路线不是当前客户端方案 |
| 本机构建链 | JDK 17.0.5、Gradle 8.13、AGP 8.13.0、Android SDK platform **35**、build-tools 35.0.0；无 Gradle wrapper | 采用 SceneView 4.x 需升级 SDK platform 36 与可能的 JDK 21（M0-1） |
| 现有代码 | 7 个 TS 包（world-schema/protocol/voxel-core/worldd/companion-schema/companion-runtime/ar-provider），47 项测试通过；`npm run demo:companion` 可跑通一次 home grant + 12 方块提交 | TS 侧继续作为 Host 与共享契约；`ar-provider`（浏览器抽象）不再作为客户端基础 |
| 现有 POC | `apps/android-ar-poc` 原生 Java + ARCore 1.51.0 + GLES 2；无世界/网络/角色 | 保留为回归证据；新客户端另建模块，不复用其渲染代码 |

### 2.3 上一版假设为什么不成立

上一版实施计划把客户端定为“Android Chrome + WebXR immersive-ar + three.js”，APK 仅作 WebView/TWA 壳。该假设存在四个结构性冲突：

1. **交付形态冲突**：WebView/TWA 壳无法保证 `immersive-ar`；外部 Chrome 又无法接原生桥，APK 与浏览器之间没有可用的业务通道。
2. **设备覆盖冲突**：Chrome 的 WebXR 在 Android 上由 **ARCore** 提供能力，且官方要求设备安装并启用 **Google Play Services for AR**；未安装/未启用该服务的设备无法进入 AR 会话（无 GMS 机型常见）。这与“打印标记兼容非 ARCore 设备”的既定方向直接冲突。
3. **能力冲突**：Chrome 已发布 hit-test/anchors/depth/光照估计，但 **plane detection 仍是 Developer Trial**，**Augmented Images 不在 WebXR 能力表内**；标记/图像跟踪没有浏览器内路径。
4. **网络与相机约束**：WebXR 要求安全上下文；局域网自签名证书需要用户安装 CA，才能让浏览器信任并授权相机。原生客户端可用“证书指纹固定”绕开这一整套用户体验问题。

---

## 3. 候选方案

| 方案 | 客户端 | AR | 渲染/角色 | 一句话 |
|---|---|---|---|---|
| **A. Web/WebXR** | Chrome 页面 + PWA | WebXR（ARCore） | three.js + three-vrm | 迭代最快、TS 复用最高，但依赖浏览器/GMS，无法自包含 APK |
| **B. 原生（本决策）** | Kotlin + Compose | ARCore + CameraX/BoofCV 标记（v0 目标；按阻塞条件调度） | SceneView/Filament + glTF | Android 业务内置于 APK、可扩展标记、开源渲染栈，需 Kotlin 端口与工具链升级 |
| **C. Godot 4** | Godot 导出 APK | godot_arcore 插件 | Godot + godot-vrm | 引擎开源，但 Android AR 插件已停止维护 |
| **D. Unity** | Unity 导出 APK | AR Foundation（ARCore/ARKit） | Unity + UniVRM | AR+VRM 最成熟，但引擎闭源、包体与许可成本高 |
| **E. 混合 WebView** | 原生壳 + 透明 WebView | 原生 ARCore | three.js（WebView 内） | 兼顾 TS 与原生 AR，但相机/WebGL 合成与桥接延迟风险高 |

---

## 4. 评估

### 4.1 评估标准与权重

权重按“产品可达性优先、开源成熟度其次、工程效率再次”设定；评分为工程判断（1–5），不是精确测量。

| 标准 | 权重 | 说明 |
|---|---|---|
| C1 原生 APK / Android 业务不依赖浏览器 | 0.20 | 用户明确要求；PC Host 仍持有权威世界 |
| C2 设备覆盖（ARCore 优先 + 标记可扩展） | 0.15 | 无 GMS 设备的兼容路径是否可行 |
| C3 AR 能力（6DoF/锚定/深度/状态） | 0.15 | 桌面微缩世界的稳定性与遮挡 |
| C4 角色与美术管线 | 0.10 | glTF/卡通材质/骨骼动画 |
| C5 开源成熟度与许可 | 0.15 | 用户明确“优先开源成熟方案” |
| C6 与现有 TS 代码/协议复用 | 0.10 | 降低重复实现与漂移 |
| C7 工程效率与团队门槛 | 0.10 | 上手速度、构建链复杂度 |
| C8 性能/热/功耗 | 0.05 | 10 分钟连续 AR 的可行性 |

### 4.2 评分矩阵

| 方案 | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | 加权总分 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A Web/WebXR | 1 | 2 | 4 | 5 | 4 | 5 | 5 | 2 | **3.30** |
| **B 原生 SceneView** | **5** | **4** | **5** | **4** | **5** | **3** | **3** | **5** | **4.35** |
| C Godot 4 | 5 | 2 | 2 | 3 | 4 | 2 | 3 | 4 | 3.20 |
| D Unity | 5 | 4 | 5 | 5 | 2 | 2 | 3 | 4 | 3.85 |
| E 混合 WebView | 4 | 4 | 4 | 5 | 4 | 4 | 2 | 2 | 3.80 |

### 4.3 结论

- **B 胜出**：在 C1/C2/C3/C5/C8 五个关键项上均为最高或接近最高；代价集中在 C6（Kotlin 端口）与 C7（工具链/双语言），可用“JSON Schema + 黄金用例 + 薄端口层”把代价控制在可接受范围。
- **D（Unity）是唯一在 AR+角色上全面更强的替代**，但违反“开源优先”，且包体、构建链与许可成本不适合当前项目；若未来团队扩到多人、要同时做 iOS，可重新评估。
- **E（混合）只有在原生渲染被证伪时才考虑**：透明 WebView + WebGL 合成、pose 桥延迟、两套运行时都是硬风险。
- **A（Web）不是坏方案，而是产品形态不匹配**：它是 PC 检视页的最佳技术（本决策保留 three.js 用于检视端）。
- **C（Godot）被成熟的官方文档否证**：Godot 官方文档明确该 ARCore 插件“不由 Godot 基金会维护、目前处于休眠、未在积极开发”。

---

## 5. 关键证据

> 采样日期均为 2026-11-17（Asia/Shanghai）。星数/活跃度是当时快照，不是长期承诺。

### 5.1 浏览器路线的硬约束

- Google ARCore 官方《WebXR compared to ARCore》：Chrome 的 WebXR **使用 ARCore** 提供 Android AR 能力；hit-test/anchors/depth/光照估计为 Shipped，**plane detection 为 Developer Trial**，Augmented Faces/Images/Instant Placement 在 WebXR 无对应项。
  <https://developers.google.com/ar/develop/webxr/arcore-comparison>
- Google《WebXR requirements》：需要**安全上下文**、**WebXR 兼容浏览器**、**ARCore 支持设备**，并明确要求设备“安装并启用 **Google Play Services for AR**”。
  <https://developers.google.com/ar/develop/webxr/requirements>
- caniuse：Chrome for Android 仅“partial support”，Android 系统浏览器/QQ/百度/UC 不支持 WebXR。
  <https://caniuse.com/webxr>
- 无预装 Google Play 的 ARCore 兼容设备清单（小米/华为/OPPO/vivo 等 OEM 商店机型）说明“支持 ARCore 的机型”与“具备 Play 服务”不是同一件事。
  <https://biz-help.airdroid.com/zh-CN/support/solutions/articles/154000198566>

### 5.2 原生路线的成熟组件

| 组件 | 许可 | 活跃度/成熟度证据 | 用途 |
|---|---|---|---|
| SceneView（`io.github.sceneview`） | Apache-2.0 | 1,374 stars；2026-11-16 仍有推送；Compose + Filament + ARCore；`MeshNode` 支持自定义 VertexBuffer；`ModelNode` 支持 glTF 骨骼/形态动画；`ARSceneView` 支持 plane/depth/instant placement、AugmentedImage、Record & Replay；4.18.0 的 POM 依赖 ARCore 1.54.0 | 客户端 AR + 3D 渲染主框架 |
| Filament | Apache-2.0 | 20,752 stars；持续活跃；Android/iOS/桌面/WebGL2 | SceneView 底层渲染器；自定义材质/卡通描边 |
| ARCore SDK | Google 免费 SDK（非开源） | POC 已用 1.51.0 在 Tab S8 验证；Depth API 设备相关 | 6DoF、平面 hit-test、anchor、深度 |
| BoofCV | Apache-2.0 | 1,206 stars；纯 Java；`boofcv-android`/`boofcv-kotlin` 模块；2026-11-16 有推送 | 打印标记（ArUco/AprilTag 类）检测与 pose 候选，v0 目标路线 |
| CameraX | Apache-2.0 | Android Jetpack 组件 | 标记模式的相机帧（v0 目标） |
| OkHttp | Apache-2.0 | 47,108 stars；WebSocket + 自定义 TrustManager | 客户端 WSS 与证书固定 |
| three.js | MIT | 118,663 stars | PC 检视页 |
| Node `node:sqlite` | Node 内置（MIT 许可的 Node） | 本机 Node 24.19 实测可用（`DatabaseSync`） | Host 持久化（零原生依赖） |

链接：<https://github.com/sceneview/sceneview> ｜ <https://github.com/google/filament> ｜ <https://github.com/lessthanoptimal/BoofCV> ｜ <https://github.com/opencv/opencv>（Apache-2.0，作为标记备选）｜ <https://github.com/square/okhttp> ｜ <https://github.com/mrdoob/three.js> ｜ <https://nodejs.org/api/sqlite.html>

### 5.3 被否方案的关键证据

- Godot 官方文档：“This plugin is **not** maintained by the Godot Foundation. The plugin currently lies dormant and is not under active development.”
  <https://docs.godotengine.org/en/stable/tutorials/xr/arcore_intro.html>
- AR.js（浏览器内标记）虽为 MIT、约 6,000 stars，但纯 Web 标记跟踪不作为当前原生客户端路线；浏览器 AR 的限制仅用于解释已否决的候选方案。
  <https://github.com/AR-js-org/AR.js>
- three-vrm（MIT）是 Web 路线最强的角色资产，但本决策已选 glTF 原生管线，故仅在 PC 检视页需要角色预览时再引入。
  <https://github.com/pixiv/three-vrm>

---

## 6. 决策细节

### 6.1 分层技术栈

```text
Android 客户端（Kotlin / Compose）
  ├─ feature-connect     配对二维码扫描（ZXing）、会话状态、重连
  ├─ feature-build       格子选择、ghost、物品栏、确认/取消
  ├─ feature-companion   家园候选、计划预览、批准/暂停/撤销、气泡
  ├─ ar-core             ArProvider 接口：tracking 状态、pose、hit-test、depth 能力
  │    ├─ ArCoreProvider（v0）
  │    └─ MarkerProvider（v0 目标：CameraX + BoofCV）
  ├─ render-scene        SceneView/Filament：体素 MeshNode、角色 ModelNode、卡通材质
  ├─ core-replica        welcome/commit/resync 应用、rev 单调性、缺口检测
  ├─ core-model          WorldSpec/BlockDef/协议模型/错误码（由 JSON Schema 生成或对照）
  └─ net                 OkHttp WSS、证书指纹固定、配对、心跳、退避重连

PC Host（Node 24 / TypeScript）
  ├─ worldd              权威事务、grant/plan/approval、预算、审计、undo
  ├─ host                HTTPS/WSS、配对、会话、限流、静态资源
  ├─ companion-runtime   观察→目标→计划→提交/等待→气泡
  └─ mcp-adapter         DSH 工具面（stdio/loopback）

PC 检视页（three.js，loopback）
  └─ 同一 worldId/rev 的只读视图 + 批准/暂停/撤销入口（可选）
```

### 6.2 客户端不变量

1. 客户端**永不**持有权威世界；本地只有 replica 与未确认 ghost。
2. 只有 `commit` 可推进本地 rev；`ack` 只表示请求被接受/拒绝。
3. 任何写入都要求 `tracking.state == running` 且 pose 年龄 ≤ 500 ms；标记模式另加置信度阈值。
4. 世界坐标映射严格按 `WorldSpec v1`：3 cm/格，anchor 原点 = 岛 footprint 中心垂线与桌面交点。
5. 相机帧**不上传**；只上传 pose/tracking 状态与用户操作。

### 6.3 渲染层子决策：SceneView vs Filament 直连

| 维度 | SceneView 4.18（推荐） | Filament + ARCore 直连（回退） |
|---|---|---|
| AR 会话/相机背景/平面/深度 | `ARSceneView` 已封装 | 需自写 EGL/外部纹理/会话生命周期（POC 已有部分） |
| glTF/骨骼动画 | `ModelNode` + gltfio | gltfio 可用，但需自管场景/材质 |
| 自定义体素网格 | `MeshNode`（VertexBuffer） | 直接 `VertexBuffer/RenderableManager` |
| Compose 集成 | 一等公民 | 需 `AndroidView` + SurfaceView 手工接 |
| 调试 | record/replay、Rerun 桥 | 自建 |
| 风险 | 单一维护者、工具链较新（compileSdk 36/Kotlin 2.2+） | 代码量较大，但完全可控 |
| 结论 | **主选**；M0-2 验证 | **回退**；M0-2 失败即切换并重新评估范围 |

> 选择 SceneView 的理由不是“少写代码”，而是它把 ARCore 相机合成、平面/深度、glTF 加载和 Compose 生命周期这些**最容易踩坑且最难测**的部分收敛到一个可替换的端口后面；我们同时用 `ArProvider` 和场景封装把它隔离，避免被单一 SDK 锁死。
>
> 4.18.0 与 4.69.5 的 API 差异（`MeshNode`、`depthMode`、record/replay）以 M0-2 实测为准；若 4.18 缺少所需能力，则升级到 4.69 工具链或切换 Filament 直连。

### 6.4 角色管线（glTF 2.0）

- 运行时只接受 **GLB/glTF 2.0**：骨骼动画 + 可选形态键；材质用 Filament `.filamat`（卡通光照 + 背面法线膨胀描边）。
- 资产制作：Blender 导出 GLB；VRM 若要用，先在 Blender 中转换为 glTF（MToon → 卡通材质近似，弹簧骨 → 用节点弹簧/烘焙近似），不承诺 VRM 语义等价。
- 角色行为由服务端事件驱动有限状态（idle/walk/build/talk）；位置由客户端插值，AI 不得 teleport。
- 占位角色必须存在且可替换；模型加载失败时回退到程序化方块角色，不阻断世界。

### 6.5 标记模式（v0 目标，与 ARCore 同属 v0 范围）

- 打印标记兼容明确属于 v0 目标，不是 v1/未来版目标。它与 ARCore 共用 provider/pose 合同；世界渲染/输入/网络不得依赖 ARCore 类型。先做 M0 feasibility spike；如阻塞最小可玩闭环，允许先交 ARCore 主链，但 marker 工作必须紧随推进并在 v0 关闭，不能从范围里删除。任何具体设备/模式未通过测试前不宣称已支持。
- 方案：CameraX 取帧（1280×720，分析帧率 ≥10 Hz）+ BoofCV 检测打印标记（A4/A3 打印纸，标记边长 60–80 mm），`solvePnP` 得到桌面坐标系；单应/重投影误差 + 标记像素尺寸给出置信度；一欧元滤波平滑。
- 合成：优先分别 spike “透明 Filament Surface 叠加 CameraX Preview”与“CameraX `SurfaceTexture` → Filament 外部纹理全屏 quad”；选型依据真机生命周期、延迟、设备兼容和 fail-closed 行为。
- 失败闭环：标记不可见/低置信度 >300 ms → 冻结世界写入、隐藏或降级虚拟内容，恢复后要求重定位确认。
- 已知限制：无实景深度遮挡；标记必须保持可见；不宣称与 ARCore 等价的稳定性。

### 6.6 PC 检视页

- 由 Host 在 `127.0.0.1` 提供静态页（three.js 本地打包，无 CDN），连接 loopback 会话；默认只读，允许“批准计划/暂停 companion/撤销最近 AI 事务”。
- 用途：联调、验收（“手机与 PC 显示同一 rev”）、演示、无真机时查看 AI 计划。
- 不作为产品交付端；不暴露到 LAN。

### 6.7 Host 与协议

- Host 继续用 TS；协议以 **JSON Schema 为唯一源**，`packages/protocol/golden/*.json` 作为跨语言黄金用例；Kotlin 侧用同一批用例做解析/序列化一致性测试。
- 协议升到 **v2**：补齐 plot/grant、plan 生命周期、companion 状态/气泡、undo、tracking、错误码等消息（详见 [HOST-API](HOST-API.md)）。
- 持久化用 **SQLite（Node 内置 `node:sqlite`，WAL）**：单事务提交、审计、undo 逆操作、快照与损坏回退（详见 HOST-API §7）。
- 配对：Host 首次启动生成自签名 ECDSA P-256 证书；二维码携带 `host/port/certSha256/code`；客户端 OkHttp 只信任该指纹；配对码 5 分钟、一次性、限次；session token 12 小时、可撤销、仅哈希落库。

---

## 7. 被否方案与理由（摘要）

| 方案 | 否决理由 |
|---|---|
| A Web/WebXR | 不能满足“自包含 APK、不依赖浏览器”；AR 依赖 Chrome + ARCore + Play Services for AR；无 WebXR 标记跟踪；局域网 TLS/相机授权体验差；WebGL/XR 热预算不确定。保留 three.js 用于 PC 检视页。 |
| C Godot 4 | 官方 ARCore 插件休眠、无人维护；godot-vrm 为社区级；引擎开源不等于 AR 路线可交付。 |
| D Unity | 技术上最强，但引擎闭源、包体/构建链/许可成本高，与“开源成熟优先”冲突；未来若做 iOS 且团队扩大可重评。 |
| E 混合 WebView | 透明 WebView + WebGL 合成、pose 桥接延迟、两套运行时与调试成本；仅在原生渲染被证伪时作为兜底。 |

---

## 8. 后果

### 8.1 正面

- Android 业务随原生 APK 交付，不依赖浏览器；联网产品的权威世界仍由 PC Host 持有。
- v0 目标包含 ARCore 与打印标记；若标记阻塞核心闭环，先完成 ARCore 主链并紧随补齐标记兼容。
- AR/渲染/角色/网络都建立在成熟开源组件上（SceneView/Filament/BoofCV/OkHttp/three.js）。
- 不再需要浏览器安全上下文、CA 安装、Chrome 版本兼容与 WebView 能力赌博。
- 现有 TS 权威世界、协议校验、companion 运行时与测试全部保留。

### 8.2 负面

- 引入 Kotlin 客户端：world/protocol 的纯逻辑需要在 Kotlin 侧有对应实现（以黄金用例约束，估计 600–900 行）。
- 构建链升级：SDK platform 36、Kotlin 2.2/2.3、可能 JDK 21、Gradle wrapper；需在 M0-1 完成。
- 角色管线从“three-vrm 直接跑 VRM”变为“glTF + 自定义卡通材质”，MToon/弹簧骨只做近似。
- SceneView 为单一维护者的第三方 SDK：需要版本固定、端口层隔离、必要时 vendoring。
- **ARCore 是本路线唯一非开源的核心依赖**（免费 SDK，但闭源）；开源 SLAM/平面检测方案（ORB-SLAM 系列等）在移动端产品化、功耗、许可与维护成本上不满足 v0，故未进入候选。打印标记模式以 BoofCV 为候选，可在无 GMS 设备上绕开 ARCore；其实现与设备支持仍需验证。
- iOS 不会因此获得复用（SceneView 的 Swift 端已标记 deprecated）；iOS 仍需独立立项。

### 8.3 中性

- 体素网格在客户端生成（4096 格，成本可忽略），不引入网格流式协议。
- PC 检视页复用 three.js，但不与 Android 共享渲染代码，只共享协议与数据。

---

## 9. 验证门（M0）

> 只有 M0 全绿才进入 M1 之后的规模化实现；任一项失败按“回退动作”处理，不允许“先写着看”。

| 门 | 验证内容 | 通过标准 | 失败回退 |
|---|---|---|---|
| G1 工具链 | JDK/SDK/Kotlin/AGP + SceneView 4.18.0 能构建并安装 | `assembleDebug` 成功；Tab S8 启动不崩 | 降到 SceneView 4.17/4.16，或改用 Filament + ARCore 直连，并重新验证兼容性 |
| G2 AR 会话 | ARSceneView 在 Tab S8 上相机背景、平面命中、anchor、暂停/恢复 | 连续 10 分钟无崩溃；tracking 丢失/恢复不跳变（肉眼 + 录屏） | 回到 ARCore 原生渲染器 + 自写相机背景（POC 已验证） |
| G3 深度/遮挡 | Depth API 在目标设备的可用性与观感 | 有 depth 的设备可作增强；缺少真实遮挡可接受为 v0 已知限制，不阻塞核心闭环 | UI 明确标注“真实遮挡为已知限制” |
| G4 配对/TLS | 自签名证书 + 指纹固定 + 一次性码 | 错误指纹必须拒绝；正确指纹一次配对成功；token 过期/撤销生效 | TLS 配对未通过前，真实设备产品链路不得判为通过；开发联调限 loopback |
| G5 DSH 工具面 | 目标 DSH 版本能调用 MCP 工具、取消、超时、错误 | 完成一次 mock 工具闭环（observe/plan/commit/reject） | 改走宿主插件适配器；仍以 worldd 为唯一写入口 |
| G6 设备矩阵基线 | Tab S8 + 第二台 Android 的 ARCore 可用性/深度/帧时 | 两台设备均有记录；至少一台达到 p95 ≤33 ms | 降低渲染质量档位；把第二台设备列入 v0.5 前置 |
| G7 角色加载 | GLB 模型 + 骨骼动画在真机可跑（卡通材质与完整角色留 M6） | GLB 加载、一段骨骼动画播放、无崩溃 | 先用程序化角色；正式资产延后到 M6 |

**M0 出口物**：设备矩阵记录、录屏/日志、TLS 配对演示、DSH 工具闭环记录、SceneView 构建产物与版本锁定、风险更新。

---

## 10. 迁移与兼容

| 现有资产 | 处置 |
|---|---|
| `packages/world-schema`、`voxel-core`、`protocol`、`worldd`、`companion-*` | **保留**，作为 Host 权威与契约源；协议升 v2，补错误码/黄金用例 |
| `packages/ar-provider`（浏览器抽象） | 保留为历史/参考；不再作为客户端基础；其 tracking 状态枚举可映射到 Kotlin `ArTrackingState` |
| `apps/simulator`（Canvas 2D，本地世界） | 升级为 `host-connected` 模式，作为无真机时的联调工具；不替代 PC 检视页 |
| `apps/android-ar-poc`（原生 Java POC） | 保留为回归证据；新客户端另建 `apps/android-client`，不直接改 POC |
| `docs/IMPLEMENTATION-PLAN.md` §3/§5 客户端部分 | 由本 ADR 取代；在原文加“已更新”提示并链接本文件 |
| `docs/ANDROID-DELIVERY.md` “APK 壳/外部 Chrome” | 作废；改为原生 APK 的签名/升级/权限说明 |
| `docs/PROJECT-STATUS-AND-ROADMAP.md` 阶段 C | 改为“原生客户端联调”，删除“复用 WebXR provider”表述 |

---

## 11. 未决问题（不阻塞本决策）

1. 第二台测试设备的具体型号（建议：一台中端 ARCore 手机；预算/借用即可）。
2. 标记纸的正式规格（A4 vs A3、标记边长、是否四角）——v0 标记实现定稿前确定。
3. 正式角色资产的来源与许可——M6 前定，不影响架构。
4. DSH 的具体版本与工具注册方式——M0-6 探测后写入 [技术路线计划](TECH-ROADMAP.md)。
5. PC 检视页是否允许“玩家放置/拆除”——建议 v0 只读 + 审批；若允许，需单独 threat model。

---

## 12. 参考

- Google ARCore：WebXR vs ARCore、WebXR requirements、Depth API、Supported devices
  <https://developers.google.com/ar/develop/webxr/arcore-comparison> ｜ <https://developers.google.com/ar/develop/webxr/requirements> ｜ <https://developers.google.com/ar/develop/depth> ｜ <https://developers.google.com/ar/devices>
- caniuse WebXR：<https://caniuse.com/webxr>
- SceneView：<https://github.com/sceneview/sceneview>；4.18.0 POM：<https://repo1.maven.org/maven2/io/github/sceneview/arsceneview/4.18.0/arsceneview-4.18.0.pom>
- Filament：<https://github.com/google/filament>
- Godot ARCore 文档：<https://docs.godotengine.org/en/stable/tutorials/xr/arcore_intro.html>
- BoofCV：<https://github.com/lessthanoptimal/BoofCV>；OpenCV：<https://github.com/opencv/opencv>
- three.js：<https://github.com/mrdoob/three.js>；three-vrm：<https://github.com/pixiv/three-vrm>；AR.js：<https://github.com/AR-js-org/AR.js>
- OkHttp：<https://github.com/square/okhttp>
- Node SQLite：<https://nodejs.org/api/sqlite.html>
