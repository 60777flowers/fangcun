# 方寸后续技术路线计划（v2，2026-11-17）

> 本文是 [ADR-0003](ADR-0003-android-client-and-ar-stack.md) 与产品团队最新确认后的**执行计划**：架构、技术选型、里程碑、依赖、验收、测试、风险、发布与合规。
> 接口细节见 [HOST-API](HOST-API.md) 与 [DSL-SPEC](DSL-SPEC.md)；设备验证见 [DEVICE-TEST-PLAN](DEVICE-TEST-PLAN.md)；审核意见见 [REVIEW-2](REVIEW-2.md)。
> 不再用传统团队人数、人日或日历周数推断交付时间。每个里程碑只以可复现证据、依赖出口和产品取舍作为推进条件。

---

## 1. 执行摘要

### 1.1 已拍板的技术路线

- **Android 客户端：原生 Kotlin + Jetpack Compose + SceneView（Filament + ARCore）**，业务运行不依赖 Chrome/WebView；APK 仍需通过局域网连接 PC Host，不承诺脱机拥有权威世界。
- **AR：v0 目标同时提供 ARCore 与打印标记 provider**；ARCore 是已验证的主链，标记（CameraX + BoofCV）并行开发。若标记实现经 M0 spike 证实会阻塞最小闭环，先交付 ARCore 核心链并将标记作为下一兼容增量，不把延期包装成已支持。
- **角色：glTF 2.0 / GLB + Filament 卡通材质**，不引入 VRM 运行时；VRM 仅作为素材来源，经 Blender 转换。
- **Host：Node 24 + TypeScript**，`worldd` 仍是唯一写入口；SQLite（WAL）持久化；WSS + 自签名证书指纹固定 + 一次性配对码。
- **PC 检视页：three.js（loopback）**，与手机同一 `rev`，默认只读 + 审批/暂停/撤销。

### 1.2 三个交付档位

| 档位 | 范围 | 出口标准 |
|---|---|---|
| **v0 核心闭环** | Host/worldd + 原生 Android ARCore 客户端 + Companion mock + PC 检视/调试端；打印标记为 v0 目标并行验证 | 玩家 place/break、用户批准 home、AI 安全建造、撤销和断线恢复；手机/PC 同 rev。若 marker spike 阻塞核心闭环，先交 ARCore 闭环并紧随补 marker，不把未通过标记测试的设备标成支持 |
| **v0 稳定交付** | 在核心闭环上补 SQLite/WAL、安全配对、真 DSH/LLM、签名 APK、隐私/许可和稳定性 | 固定请求与负向测试通过；无未授权提交；设备/热态/同步证据齐全；可安装、升级、卸载 |
| **兼容扩展** | 扩展第二设备矩阵、已验证的 marker 设备覆盖、正式角色与性能档位 | ARCore 与 marker 设备各有明确支持结论和数据；未达标设备明确不支持。标记为 v0 目标；若因阻塞条件顺延，列为核心闭环后的首个兼容增量 |

### 1.3 执行原则

- 不估算传统团队人数/人日/日历工期；当前人与 agent 的协作效率尚在探索，历史人日数字不作为计划或承诺。
- 保留 WBS、任务依赖、DoD、风险和验收证据要求。每个任务按“最小可复现切片”推进，发现技术不确定项先做 spike，再调整下一步。
- 先打通可运行核心闭环；不让非关键的渲染观感/角色资产/兼容扩展阻塞端到端验证。
- 标记 provider 是 v0 目标之一，但允许依照产品确认的降级条件：若其实现阻塞核心闭环，先完成 ARCore 主链，标记随后作为优先兼容增量，不得宣称已支持。

---

## 2. 当前基线（2026-11-17）

### 2.1 已验证

- `npm test`：**76/76 通过**；`npm run typecheck` 通过；`npm run demo:companion` 输入 `y` 后输出 `12 blocks at revision 1`、`208 blocks`（本次复跑）。
- `packages/` 7 个包：world-schema、protocol、voxel-core、worldd、companion-schema、companion-runtime、ar-provider（约 2.4k 行）。
- Android 原生 POC（`apps/android-ar-poc`）：ARCore 1.51.0 + GLES 2，Tab S8 上相机背景、水平面 hit-test、anchor、测试方块已跑通；tracking 丢失时 fail closed。
- 构建链：JDK 17.0.5、Gradle 8.13、AGP 8.13.0、SDK platform 35、build-tools 35.0.0；**无 Gradle wrapper**。
- 设备：Samsung Galaxy Tab S8（SM-X800，Android 16/API 36，Adreno 730，GLES 3.2）；ADB 已授权，原生 ARCore POC 已完成首轮真机 smoke。定量 ARCore 基线、SceneView 新客户端及 marker 证据仍待采集。

### 2.2 未验证（不得当作已交付）

- 持久化/WAL、WS 服务、配对/TLS、会话与限流。
- 真实 DSH/MCP 工具闭环。
- 正式体素客户端、AR 内放置/拆除、角色渲染、标记模式。
- 第二台设备、10 分钟热态、定量漂移、深度遮挡。
- release 签名、升级/卸载、SBOM/许可扫描。

### 2.3 现有资产处置

| 资产 | 处置 |
|---|---|
| TS 七个包 | 保留；协议升 v2；补黄金用例与错误码 |
| `apps/simulator` | 升级为 `host-connected`（WS 客户端），用于无真机联调 |
| `apps/android-ar-poc` | 保留为回归证据；不直接改造成产品客户端 |
| `preview/`、`reports/` | 历史材料；不进入发布包 |
| `效果图/`、模型截图 | 许可未确认，发布前移除/替换（见 §15） |

---

## 3. 目标架构

### 3.1 组件图

```text
┌──────────────────────── Android APK（Kotlin） ────────────────────────┐
│ Compose UI  │  feature-build / feature-companion / feature-connect   │
│             │  ar-core (ArProvider: ArCore + Marker target for v0)  │
│             │  render-scene (SceneView/Filament: voxel MeshNode,     │
│             │                character ModelNode, cel material)     │
│             │  core-replica (welcome/commit/resync)                 │
│             │  net (OkHttp WSS, cert pinning, backoff)               │
└───────────────────────────────┬───────────────────────────────────────┘
                 WSS 8443（TLS 1.2+，证书指纹固定，一次性 token）
┌───────────────────────────────▼───────────────────────────────────────┐
│ PC Host（Node 24 / TS）                                                │
│  host: HTTPS/WSS、配对、会话、限流、静态资源、PC 检视页                │
│  worldd: 事务仲裁、grant/plan/approval、预算、undo、审计               │
│  companion-runtime: observe→goal→plan→commit/ask→say                  │
│  persistence: SQLite WAL（world/commit/plan/grant/session/audit）      │
│  mcp-adapter: stdio（默认）或 loopback HTTP（备用）                    │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ loopback WS 4173               │ stdio / 127.0.0.1:4174
        ┌───────▼────────┐              ┌────────▼────────┐
        │ PC 检视页       │              │ DSH / LLM        │
        │ three.js 只读   │              │ 受限工具调用      │
        └────────────────┘              └─────────────────┘
```

### 3.2 数据流（一次 AI 自动建造）

1. companion-runtime 观察世界（`world_observe`）→ 选择小目标（如“补一面墙”）。
2. 生成 DSL → `build_plan`（纯 dry-run）→ 服务端返回 `planId/diffHash/baseRev/blockCount/requiresApproval`。
3. `scope=home_plot` 且纯放置空格、预算内 → 服务端策略自动批准；否则 `plan_proposed` 推给手机/PC 等待 `approve_plan`。
4. `build_commit(planId, approvalId?)` → worldd 二次校验（rev/hash/grant/budget/tracking/占用）→ 单事务写 SQLite → 广播 `commit`。
5. 手机/PC 按 `rev` 应用 replica；companion 发 `companion_state/companion_say` 气泡。
6. 用户可 `undo`（条件反向事务）或 `pause_companion` / `revoke_plot`。

### 3.3 信任边界

- 手机/PC 都是不可信客户端；只信 worldd 的校验结果。
- LLM 输出是不可信数据；工具 schema + 服务端策略是唯一授权。
- 相机帧不出设备；日志不含 token/图像/完整对话。
- MCP 只在本机；不监听 LAN。

---

## 4. 技术选型清单

### 4.1 客户端

| 层 | 选型 | 版本（拟） | 许可 | 理由 / 替代 |
|---|---|---|---|---|
| 语言/UI | Kotlin + Jetpack Compose | Kotlin 2.2.x；Compose BOM 2026.x | Apache-2.0 | 原生、声明式 UI；替代 XML View 无必要 |
| 3D/AR SDK | SceneView（`arsceneview`/`sceneview`） | **4.18.0**（AGP 8 / compileSdk 36 线） | Apache-2.0 | Compose + Filament + ARCore；`MeshNode`/`ModelNode`/record-replay；4.69.5 需 AGP 9.4/compileSdk 37，暂不追 |
| 渲染底层 | Filament | 随 SceneView（gltfio） | Apache-2.0 | 成熟 PBR/材质系统；自定义 `.filamat` 做卡通 |
| AR | ARCore SDK | 1.51.0（POC）→ 1.54.0（随 SceneView） | Google 免费 SDK | 唯一成熟的 Android 6DoF 方案；设备覆盖见 M0 |
| 网络 | OkHttp（WebSocket） | 5.x | Apache-2.0 | 成熟；自定义 TrustManager 做指纹固定 |
| 序列化 | kotlinx.serialization | 1.8.x | Apache-2.0 | 与 JSON Schema/黄金用例对齐 |
| 设置存储 | DataStore（Preferences） | 1.1.x | Apache-2.0 | token 加密存 Keystore 派生密钥 |
| 二维码 | ZXing core | 3.5.x | Apache-2.0 | 开源；不引入闭源扫码 SDK |
| 相机 | CameraX | 1.4.x | Apache-2.0 | 原生相机帧（marker provider spike/兼容路线） |
| 标记检测 | BoofCV（`boofcv-android`） | 1.6.x | Apache-2.0 | v0 marker 目标的候选库；以设备 spike 验证稳定性/合成/功耗后决定是否纳入首个闭环 |

### 4.2 Host / PC

| 层 | 选型 | 版本（拟） | 许可 | 理由 |
|---|---|---|---|---|
| 运行时 | Node.js | 24 LTS | MIT | 现有工作区已用；`node:sqlite` 可用 |
| 语言 | TypeScript | 5.9.x | Apache-2.0 | 现有代码 |
| WS/HTTP | `ws` + Node `https`（HTTP/1.1 Upgrade） | 8.x | MIT | WebSocket 标准走 HTTP/1.1；不引入 `http2` 兼容层 |
| 校验 | Ajv + JSON Schema | 8.x | MIT | 现有 schema 已用 |
| 持久化 | `node:sqlite`（WAL） | Node 24 内置 | MIT | 零原生依赖；本机实测可用；备选 better-sqlite3 |
| Host UI | 本地网页（Vite/vanilla TS） | — | MIT | 配对二维码/状态/备份/日志；不引入 Electron |
| PC 检视页 | three.js + Vite | three 0.18x | MIT | 与体素/GLB 生态一致；本地打包无 CDN |
| 测试 | `node:test` + Playwright（inspector） | 内置 / 1.x | MIT/Apache-2.0 | 与现有测试风格一致 |

### 4.3 明确不引入

- Unity / Unreal：闭源、包体大、与“开源优先”冲突（未来 iOS 另议）。
- Godot：官方 ARCore 插件已休眠，不作为主路线。
- VRM 运行时（three-vrm/UniVRM）：本决策用 GLB；仅 PC 检视页如需角色预览再引入 three-vrm。
- 闭源扫码/云 AR/云锚点：v0 不需要，且引入账号与网络依赖。

---

## 5. 工程结构

```text
apps/
  android-client/            Kotlin（新）
    app/                     Compose 入口、导航、DI
    core-model/              WorldSpec/BlockDef/协议模型/错误码
    core-replica/            welcome/commit/resync
    core-mesh/               体素 mesher（面剔除/材质分桶）
    ar-core/                 ArProvider 接口 + ArCoreProvider / MarkerProvider（marker 为 v0 目标，按 M0 spike 门控）
    render-scene/            SceneView 场景、MeshNode、ModelNode、卡通材质
    net/                     OkHttp WS、配对、TLS 固定、重连
    feature-build/           选择/ghost/物品栏/确认
    feature-companion/       计划/审批/暂停/撤销/气泡
    feature-connect/         扫码/手动码/状态
  android-ar-poc/            现有 POC（保留，回归证据）
  pc-inspector/              three.js + Vite（新）
  simulator/                 现有 Canvas 2D；升级 host-connected
packages/
  world-schema/              保留
  protocol/                  升 v2；schema + golden + 生成器
  voxel-core/                保留；DSL 编译器可复用
  worldd/                    保留；接 SQLite/审计/undo
  host/                      新：HTTP/WS/配对/会话/静态资源
  companion-schema/          保留
  companion-runtime/         保留；接 host
  mcp-adapter/               新：MCP tools + policy
  qa-fixtures/               新：世界种子、20 条中文请求、注入样本、设备记录模板
docs/                        ADR/计划/接口/测试
scripts/                     开发、备份、设备、CI
```

**代码归属原则**

- TS 是 Host 与契约的唯一真源；Kotlin 只实现客户端需要的子集（WorldSpec、协议模型、replica、mesher、错误码）。
- 跨语言以 **JSON Schema + golden fixtures** 约束，不做代码生成器的强绑定（生成器可作为后续优化）。
- 不允许两端各自手写协议字段后“靠联调对齐”。

---

## 6. 契约与接口

| 契约 | 文档 | 冻结时点 | 变更规则 |
|---|---|---|---|
| 世界模型/坐标 | ADR-0001 + `world-schema` | 已冻结 | 破坏性变更升 `WorldSpec` 版本 + 迁移 |
| 协议 v2 | [HOST-API](HOST-API.md) §5–6 | M1 出口 | 任何 wire 变更升 `protocolVersion` |
| 错误码/文案 | HOST-API §5.2 | M1 出口 | 新增码需补两端文案与测试 |
| Host HTTP API | HOST-API §4 | M1 出口 | OpenAPI 文件与实现同 PR |
| 结构 DSL | [DSL-SPEC](DSL-SPEC.md) | M1 出口 | 新增原语升 `dslVersion` + 向量 |
| 工具面（MCP） | DSL-SPEC §8 | M1 出口 | schema 与 policy 同 PR |
| 角色运行时 | 本文 §7.4 | M6 前 | 变更需资产负责人确认 |

---

## 7. 模块设计要点

### 7.1 Host

- `host` 与 `worldd` 分层：`host` 只做传输/会话/静态资源；`worldd` 只做世界与策略。
- 所有写路径（玩家/AI/undo/PC 检视）走同一个 `commit` 队列，单线程串行。
- SQLite 单事务提交；提交成功才广播；广播失败不影响持久化。
- 断线重连：`hello.lastAppliedRev` → 环形缓存补 `commit`；缺口 → `welcome` 全量。
- 备份/恢复/损坏 fail-closed 见 HOST-API §7。

### 7.2 Android 客户端

- `ArProvider` 接口只暴露：`capabilities`、`tracking`、`pose`、`hitTest(screenX,screenY)`、`depthAvailable`、`sessionLifecycle`。
- 世界渲染不依赖 ARCore 类型；`MarkerProvider` 不改 render/input/net。
- 格子选择用**世界空间射线 vs 体素 AABB**（不依赖 ARCore hit-test 的平面多边形），这样标记模式与 PC 端可用同一算法；ARCore hit-test 只用于“放置岛屿”。
- 输入状态机：`idle → selecting → ghost → confirming → pending → applied/rejected`；pending 期间禁止重复提交。
- tracking 丢失：立即清空待处理触摸/ghost，冻结写入，UI 明确提示；恢复后要求重新对准/确认。
- 体素 mesher：面剔除 + 按材质分桶 + 单 `VertexBuffer`；4096 格规模无需 chunk 流式；**v0 先整网格重建**，实测 >4 ms 再按受影响区域优化。
- 角色：`ModelNode` + 骨骼动画；动画状态机由 `companion_state` 驱动；缺失模型回退程序化角色。

### 7.3 PC 检视页

- three.js 场景：体素 `InstancedMesh` 或合并几何 + GLB 角色；相机轨道控制；显示 rev/tracking/companion/审计。
- 只读 + 审批/暂停/撤销；不发起 `intent`。
- 用于验收“手机与 PC 同 rev”、无真机时的计划预览、演示。

### 7.4 角色运行时契约

| 项 | 约定 |
|---|---|
| 格式 | GLB/glTF 2.0；Y-up；米制；原点在脚底中心 |
| 尺寸 | 站立高度 1.2 体素（3.6 cm）±10%；可在 manifest 覆盖 |
| 骨骼 | humanoid 最小集：hips/spine/head/armL/armR/legL/legR；可选尾巴/耳朵 |
| 动画 | `idle`、`walk`、`build`、`talk` 四段循环；帧率 ≤30 fps；总大小 ≤8 MB |
| 材质 | Filament `.filamat`；基础色 + 卡通阶梯 + 描边；不使用 MToon 运行时 |
| 回退 | 模型缺失/加载失败 → 程序化方块角色（不阻断世界） |
| 许可 | 每个资产登记来源/作者/许可/hash/可用渠道；未知 → CI fail |

---

## 8. 里程碑与 WBS

> 任务按依赖、可独立验证的证据和退出条件组织，不以成员数/人日/日历周数推算完工时间。可跨模块并行，但质量门与产品降级决策不能跳过。

### M0 风险验证

| ID | 任务 | 依赖 | 出口证据/DoD |
|---|---|---|---|
| M0-1 | 原生工具链：JDK 21（若 SceneView 确认需要）、SDK 36、固定 Kotlin/AGP/SceneView 版本、Gradle wrapper、CI 构建 | — | 干净检出可 `gradlew assembleDebug`；精确版本锁定；CI 可复现 |
| M0-2 | SceneView/Filament spike：ARSceneView、ARCore、glTF、Compose、自定义 MeshNode | M0-1 | Tab S8 相机背景/plane/anchor/体素网格；pause/resume/tracking loss；录屏和崩溃日志；SceneView 路线通过或启动 Filament 直连回退 |
| M0-3 | 打印标记可行性 spike：CameraX 帧、BoofCV 检测、pose 与原生合成，不先做完整 provider | M0-1；可与 M0-2 并行 | marker 识别、桌面 pose、标记暂时不可见时的冻结/恢复与功耗粗测；记录真实遮挡为已知限制，回答是否会阻塞 v0 核心流程 |
| M0-4 | Tab S8 ARCore 设备基线：固定桌面标尺、移动/重定位、热态/帧时 | POC 可运行；可与 M0-2/M0-3 并行 | 原始数据、设备/OS/ARCore 版本和录屏；记录 Depth API 能力，真实遮挡缺失可作为已知限制；未达漂移门槛即记录降级 |
| M0-5 | TLS 配对 spike：自签证书 + 指纹固定 + 一次性码；禁止 LAN 明文回退 | Host spike 可最小实现；可并行 | 正确指纹可配对，错误指纹拒绝，过期/撤销有效；抓包/日志不泄漏 token |
| M0-6 | DSH/MCP 能力探测：stdio/host plugin、工具注册、取消、timeout | 可并行 | 记录目标 DSH 版本和真实 mock tool 闭环；未通过则确定 adapter 路线，不阻塞 mock Companion |
| M0-7 | M0 产品/技术门评审 | M0-1..6 证据 | 决定 SceneView/Filament，并按阻塞条件确认 marker 是否紧随 ARCore 核心链或并行推进；明确缺口 owner 与下一切片 |

**v0 AR 优先级**：ARCore 主链必须可用；打印标记目标是在 v0 一起交付。若 M0-3 证明 marker 会阻塞“Host + 玩家建造 + Companion 家园”核心闭环，则先合入 ARCore 闭环，再紧随实现 marker 兼容；不得因此停止 Host/Companion 核心流程，也不得在 marker 未通过设备验证时宣传已支持。

### M1 契约冻结

| ID | 最小任务切片 | 依赖 | 可验证产物 / 退出条件 |
|---|---|---|---|
| M1-1 | protocol v2 schema、运行时校验和正反例 | M0 产品/AR 主路线选定 | 所有 wire 消息有正反例；未知字段拒绝 |
| M1-2 | 稳定错误码与 Android/PC 文案映射 | M1-1 | 每个错误码都有用户文案和测试 |
| M1-3 | DSL compiler、canonical serialization、SHA-256 测试向量 | M0；可与 M1-1 并行 | DSL fixtures 展开一致；黄金 hash 逐字节通过 |
| M1-4 | TS/Kotlin 共享 JSON golden fixtures | M1-1, M1-3 | 两端解析/序列化同一 fixtures 结果一致 |
| M1-5 | Host API schema/OpenAPI 与关键时序定稿 | M1-1 | 文档、schema、实现接口字段对齐 |
| M1-6 | Node 与 Android CI/build、schema drift 检查 | M0-1 | 干净检出可重复构建；PR 检查真实运行 |

### M2 Host 最小可用闭环

| ID | 最小任务切片 | 依赖 | 可验证产物 / 退出条件 |
|---|---|---|---|
| M2-1 | SQLite 仓储、schema migration、快照/备份/恢复 | M1 | 重启不丢已确认 rev；损坏时恢复或 fail closed |
| M2-2 | 单事务 commit、条件 undo、budget、audit | M2-1 | 成功时 rev 一次递增；失败无部分写；undo 冲突安全拒绝 |
| M2-3 | TLS 配对、session、限流和本地配对 UI | M0-5 | 错误指纹/过期/撤销均拒绝；LAN 不提供明文回退 |
| M2-4 | WSS hello/welcome/intent/ack/commit/resync | M1, M2-2 | 双客户端顺序、冲突、重连和缺口恢复测试通过 |
| M2-5 | plan/grant/approval/autocommit policy | M1-3, M2-4 | owner/plot/hash/rev/TTL/budget/tracking 逐项负测 |
| M2-6 | PC inspector 只读视图及审批/暂停/撤销入口 | M2-4, M2-5 | 与 Host 显示同一 worldId/rev；不持有写权限 |
| M2-7 | 集成恢复切片 | M2-1..6 | 操作、断网、重启、损坏恢复脚本可重复 |

### M3 Android 原生客户端核心

| ID | 最小任务切片 | 依赖 | 可验证产物 / 退出条件 |
|---|---|---|---|
| M3-1 | Kotlin/Compose 工程、设置和配对界面 | M0-1, M1 | debug APK 可构建、安装、显示连接状态 |
| M3-2 | 可替换 ArProvider：ARCore provider 与 tracking 状态 | M0-2 | 权限、pause/resume、lost/relocalizing 状态可见且 fail closed |
| M3-3 | 体素 mesh/材质最小 renderer | M3-1, M0-2 | 固定 seed 世界在真实 anchor 下可见；缺角色不阻塞 |
| M3-4 | 射线选格、ghost、材料栏、确认/取消 | M3-2, M3-3 | 目标格与 WorldSpec 一致；越界/占用有反馈 |
| M3-5 | WSS replica、ack/commit/resync、退避重连 | M1, M2-4 | 同一 fixtures 与 TS 一致；断线恢复无重复 rev |
| M3-6 | 错误码/世界 rev/AR/Host 状态 UI | M1-2, M3-5 | 连接、tracking、保存/拒绝状态可区分 |

### M4 玩家闭环

| ID | 最小任务切片 | 依赖 | 可验证产物 / 退出条件 |
|---|---|---|---|
| M4-1 | 玩家 place/break 与 ghost/ack/冲突反馈 | M3-4, M3-5 | 连续交替操作后客户端/Host blocks 与 rev 一致 |
| M4-2 | 双端同格冲突、乱序/重复包、resync | M2-4, M4-1 | 冲突只允许一笔提交；所有端恢复同一 rev |
| M4-3 | 相机权限拒绝、后台、旋转、tracking loss/recovery | M3-2 | tracking 不可用时不误报已保存；恢复需确认 |
| M4-4 | 核心玩家闭环验收 | M4-1..3 | 真机放置/拆除、PC 同 rev、重连通过并留原始证据 |

### M5 Companion 与 AI 核心闭环

| ID | 最小任务切片 | 依赖 | 可验证产物 / 退出条件 |
|---|---|---|---|
| M5-1 | Host 内 Companion service/tick/state 与 grant 生命周期 | M2-5 | owner、tracking、pause/revoke gating 有测试 |
| M5-2 | home 候选、用户批准、plan 预览、暂停/撤销/气泡 UI | M3-6, M2-5 | 首次 grant 必须由用户确认；越界/覆盖负测全拒 |
| M5-3 | MCP tools + server-side policy（先 mock DSH） | M0-6, M1-3/4 | observe/plan/commit/cancel/undo/say 有限 schema 闭环 |
| M5-4 | DSH adapter 与注入 fixtures | M5-3 | cancel/timeout/error 可恢复；未授权 commit 为 0 |
| M5-5 | 预算/限额/审计与可观察进度 | M5-1..4 | 额度耗尽暂停；计划、提交和拒绝有审计记录 |

### M6 角色和观感（不阻塞核心闭环）

| ID | 最小任务切片 | 依赖 | 可验证产物 / 退出条件 |
|---|---|---|---|
| M6-1 | 可替换 GLB 契约与程序化占位角色 | M1 | 授权占位角色可加载；失败可回退 |
| M6-2 | 卡通材质/描边与最小 idle/build 动画 | M3-3, M6-1 | Tab S8 录屏验收；不影响世界可用性 |
| M6-3 | 角色与体素场景性能测量 | M6-2 | 帧时、内存、热态原始记录；未达标则降级角色效果 |

### M7 打印标记兼容（v0 目标；可并行，按 marker gate 调度）

| ID | 最小任务切片 | 依赖 | 可验证产物 / 退出条件 |
|---|---|---|---|
| M7-1 | CameraX 帧采集与 fiducial 检测 | M0-3 | 测试纸与 30/50/70 cm 检出数据可重现 |
| M7-2 | pose 求解、滤波、置信度与桌面坐标 | M7-1 | pose 延迟/抖动、丢失/恢复原始记录 |
| M7-3 | 原生相机与 Filament 合成 spike | M7-1 | 选定一种合成方案并提供录屏；异常时 fail closed |
| M7-4 | MarkerProvider 接入通用 ArProvider/replica | M7-2, M7-3, M3-2 | marker 与 ARCore 共用输入/网络；低置信度不允许写入 |
| M7-5 | 非 ARCore/no-GMS 设备验收 | M7-4 | 至少目标设备实测；未达标时明确设备不支持，不把计划写成支持 |

M7-1..4 与 M2/M3/M5 的核心工作并行推进。若 spike 显示合成或跟踪风险会阻塞最小闭环，按产品批准的降级顺序先交付 ARCore 主链；标记保持下一可执行切片并在发布说明写明未支持范围。

### M8 安全、恢复与发行

| ID | 最小任务切片 | 依赖 | 可验证产物 / 退出条件 |
|---|---|---|---|
| M8-1 | 鉴权、重放、注入、越权与模糊负测 | M2, M5 | 所有负例拒绝；没有凭证/图像日志 |
| M8-2 | 长稳、温升、帧时、功耗与降级策略 | M4, M6, M7 | 目标设备原始数据与明确降级阈值 |
| M8-3 | 隐私数据流、相机权限和外部模型告知 | M5 | 可审阅的数据流图、用户文案和删除说明 |
| M8-4 | release 签名、覆盖升级、卸载和恢复流程 | M2 | 签名不入库；升级/回滚行为有证据 |
| M8-5 | SBOM、依赖/素材许可与资产台账 | M6 | 未知/未授权素材 fail closed |
| M8-6 | RC 构建与发行检查 | M8-1..5 | fresh checkout/release build、测试和设备证据齐全 |

### 8.1 执行次序

- 核心顺序：M0 中的 ARCore/SceneView gate 与 Host/API/DSL 最小合同 → M2 Host + M3 Android 最小场景并行 → M4 玩家事务闭环 → M5 Companion mock 闭环 → M8 安全/发行。
- M7 marker spike 与 Host/ARCore 核心并行；M0-3 明确是否影响核心可演示切片，避免 marker 不确定性把所有工作锁住。
- M6 先保留可替换占位角色；正式外观与动画不阻塞输入、同步和 Companion 建造。
- 每次只拉取可在一个验证循环内验收的切片；测试通过且能在演示链上看到结果才推进下一切片，不对传统团队速度作预估。

---

## 9. 关键路径与并行

> 以下展示依赖关系，不包含传统团队人数、人日或日历工期估算。

```text
M0 主链验证 ─→ M1 契约 ─┬─→ M2 Host ─┐
        ├─ M0 marker spike (parallel)   ├─→ M4 玩家闭环 ─→ M5 Companion ─→ M8
        └─→ M0/M1 exit ────────────────┴─→ M3 Android 核心
M7 MarkerProvider implementation continues alongside M2/M3/M5; gate defines v0 core cutoff
```

- **关键路径**：M0 → M1 → M3 → M4 → M5 → M8。M2 与 M3 可并行，但 M4 需要两者都完成。
- M6 的资产管线（M6-1）可在 M1 后独立启动；材质/动画需 M3 渲染就绪。
- M7 可与 M2/M3/M5 的独立切片并行；具体并行以任务依赖与验证条件为准。
- 实际依赖出口决定执行顺序；M7 标记工作按 M0 spike 的结论并行推进，若阻塞核心闭环则紧随 ARCore 主链，不按团队人数推定顺序。

---

## 10. 验收矩阵

| 领域 | 条件 | 门槛 | 证据 |
|---|---|---|---|
| AR 锚定 | 两台 ARCore 设备；标尺；1 m 方形路径 ×10 | 5 分钟 p95 漂移 ≤3 cm，最大跳变 ≤5 cm；不达标标“已知不稳定” | 原始数据 + 录屏 |
| 帧时/热 | 目标设备，含角色/阴影，10 分钟 | 稳态 p95 ≤33 ms；记录内存/热降频 | Perfetto/`dumpsys` + 截图 |
| 输入/同步 | LAN，100 次 place/break，双端冲突，断网 30 s | 最终一致；不重复应用 rev；ACK 数据重启保留；p95 确认 ≤200 ms | 自动化日志 |
| AI 计划 | 20 条中文固定请求，模型/温度/seed 固定 | ≥18 条合法或安全拒绝；0 未授权提交 | fixture + 报告 |
| 安全 | 错误/过期 token、错误指纹、超大帧、越界、注入 | 全部拒绝；无写入/凭证日志；进程不崩 | 负向测试 |
| 持久化 | 杀进程、WAL 损坏、快照损坏、备份恢复 | ACK 数据不丢；损坏可恢复或拒绝启动 | 恢复演练记录 |
| 标记（v0 目标） | 30/50/70 cm；打印标记可见性丢失/恢复 | 最小 spike 记录检出率、pose 稳定性、延迟、合成与安全恢复；真实场景遮挡可作为已知限制；未达标不得宣称兼容 | 录屏 + 原始数据 |
| 许可/隐私 | 发布包与运行数据扫描 | 无未知许可资产；相机帧不出设备；告知可见 | SBOM/台账/隐私文档 |

### 10.1 交付检查单

**v0.1 内部演示**

- [ ] M0 ARCore 主链、标记 spike、Host 配对和 DSH 探测均有记录；marker 未过门时明确列为待完成兼容项
- [ ] 协议 v2 + DSL 冻结；Kotlin/TS 黄金用例全绿
- [ ] Host：SQLite 重启不丢、配对/撤销/限流、单事务提交
- [ ] Android：扫码配对、AR 放置/拆除、ghost 与冲突提示、tracking 丢失冻结
- [ ] AI（mock）：20 条请求 ≥18 合法；home 候选 → 自动建 12 格 → 撤销
- [ ] PC 检视页与手机同 rev；断网 30 s 恢复
- [ ] 演示脚本、录屏、已知问题清单

**v0.5 可用 beta**

- [ ] 真实 DSH/LLM 接入；延迟与数据流记录
- [ ] 角色 GLB + 卡通材质 + idle/walk/build/talk；真机性能达标
- [ ] 签名 release APK；覆盖升级/卸载/备份恢复通过
- [ ] 安全负向测试全绿；SBOM/许可/资产台账通过
- [ ] 10 分钟热态/帧时报告；第二台 ARCore 设备记录

**兼容扩展（目标归属 v0；若按阻塞条件顺延则优先补齐）**

- [ ] MarkerProvider + 打印规范 + 非 ARCore 设备验收；未通过设备验证前不宣称支持
- [ ] 检出率/位姿抖动及标记暂时不可见时的安全恢复达标；真实场景遮挡仍按已知限制说明
- [ ] 双设备矩阵 + 公开 beta 门槛

---

## 11. 测试策略

1. **单元测试**：TS（world-schema/voxel-core/protocol/worldd/companion）+ Kotlin（model/replica/mesh/hash）。
2. **契约测试**：同一批 `golden/*.json` 在 Node 与 Kotlin 两侧解析/序列化一致；canonical hash 向量 A/B。
3. **集成测试**：无头 Host + 两个 WS 客户端（Node 脚本）模拟手机/PC；并发、乱序、断线、重启。
4. **Android 仪器测试**：Compose UI 状态机、权限拒绝、rotation、后台恢复；AR 用 SceneView record/replay（无需真人反复走位）。
5. **设备实验室**：按 DEVICE-TEST-PLAN 执行；每次记录设备/OS/版本/原始数据。
6. **模糊测试**：协议帧、DSL、快照；用固定种子与超时。
7. **性能**：Android Macrobenchmark/Perfetto；Host 用 `--cpu-prof` 与 1000 次提交压测。
8. **回归门**：任何 PR 必须跑 typecheck/test/build；协议/DSL 变更必须更新 fixture 与本文。

---

## 12. 设备矩阵

| 设备 | 角色 | 要求 | 状态 |
|---|---|---|---|
| Samsung Galaxy Tab S8（SM-X800） | 主开发/验收 | ARCore、深度（如支持）、Android 16 | ADB 已授权；POC 已完成首轮真机 smoke；定量基线待补 |
| 第二台 ARCore 手机（中端） | 兼容性验收 | ARCore、Android 12+ | 待定/借用 |
| 非 ARCore/无 GMS 设备 | v0 marker 目标验收；若核心链受阻则 ARCore 先行并紧随补齐 | 摄像头可用、Android 10+ | 型号待借测；ARCore 主链已有 Tab S8 首轮 POC smoke |

> M0 必须记录：型号、Android/API、ARCore 版本、深度支持、屏幕密度、跟踪/帧时/热；Chrome 仅作历史环境字段，不是原生客户端前置。

---

## 13. 安全与隐私

### 13.1 威胁模型（摘要）

| 威胁 | 场景 | 控制 |
|---|---|---|
| 局域网窃听/中间人 | 同 Wi-Fi 攻击者 | TLS 1.2+、证书指纹固定、token 不落日志 |
| 未授权客户端 | 猜配对码/重放 token | 一次性码、5 分钟 TTL、限流、token 哈希、会话撤销 |
| 越权 AI | 模型要求扩地/拆除/执行代码 | 工具 schema、plot/budget、approval、无 eval/shell/RCON |
| 提示注入 | 玩家文本/方块名注入 | 不可信数据、策略层校验、20 条注入样本 |
| 供应链 | 第三方 SDK/依赖 | 版本锁定、SBOM、许可扫描、可选 vendoring |
| 数据泄露 | 相机帧/对话上传 | 帧不出设备；日志脱敏；外部模型告知 |

### 13.2 隐私

- 相机帧只在设备内处理；不录制、不上传。
- AI 请求如需外部模型，由用户配置并在 UI 明示数据流；默认不保存对话历史。
- 日志不含 token、证书私钥、完整对话、图像。
- 卸载/重置：删除本地数据库与配对信息；提供“删除我的数据”说明。

---

## 14. 发布与合规

| 项 | 要求 | 里程碑 |
|---|---|---|
| 签名 | 离线 keystore；CI 通过 secrets 注入；备份与恢复责任人 | M8-4 |
| 版本 | `versionCode` 单调；`versionName` 语义化；协议版本独立 | M8-4 |
| SBOM | CycloneDX（Gradle + npm）；随 release 归档 | M8-5 |
| 许可 | 依赖许可清单；禁止 NC/未知许可进入发布包；资产台账逐文件 | M8-5 |
| 资产 | 角色/贴图/音效来源、作者、许可原文、hash、渠道；`效果图/` 与模型截图发布前移除或替换 | M8-5 |
| 隐私 | 数据流图、权限说明、第三方告知、卸载删除说明 | M8-3 |
| 升级 | 覆盖安装、降级拒绝、数据库迁移、备份恢复 | M8-4 |
| 发布检查单 | 构建可复现、测试全绿、设备矩阵记录、已知问题清单 | M8-6 |

---

## 15. 运维与支持

- Host 启动：检查端口/证书/数据库；失败给出可操作提示（不静默）。
- 日志：结构化 JSON，滚动保留 14 天；`--diagnostics` 打包（脱敏）。
- 备份：手动 + 升级前自动；保留 5 份；恢复流程演练。
- 故障：worldd 崩溃 → 重启恢复 + 审计；数据库损坏 → 备份恢复或拒绝启动。
- 无默认遥测；崩溃上报需用户显式开启（v1 再议）。

---

## 16. 风险登记册

| ID | 风险 | 概率/影响 | 触发 | 缓解 | Owner | 决策点 |
|---|---|---|---|---|---|---|
| R1 | SceneView/工具链不兼容 | 中/高 | M0-2 构建或运行失败 | 降版本；改 Filament + ARCore 直连（POC 已验证） | A | M0 结束 |
| R2 | 目标设备缺 ARCore/GMS，marker 兼容未验证 | 高/高 | marker spike/第二设备未通过 | v0 目标双路径；先以 ARCore 跑通主闭环，marker 未通过则明确设备限制并紧随补做 | 产品/技术 | M0 marker gate |
| R3 | 卡通角色观感/性能不达标 | 中/中 | M6-2/5 未达参考 | 简化材质/关描边/程序化角色 | E/A | M6 中 |
| R4 | 10 分钟热/掉帧 | 中/中 | M0-4/M8-2 超标 | 质量档位、分辨率缩放、阴影关闭 | A | M0 / M8 |
| R5 | 配对体验（IP/证书变化） | 中/中 | 用户多次重扫 | 手动码、二维码刷新、清晰文案 | B | M0-5 |
| R6 | AI 越权/注入 | 中/高 | 负向测试失败 | 策略层、approval、工具白名单、审计 | C | M5 |
| R7 | DSH 集成不确定 | 中/高 | M0-6 不可用 | MCP/宿主插件双路径；mock 先行 | C | M0 |
| R8 | SceneView 单一维护者 | 低/中 | 长期停更/漏洞 | 版本固定、端口层、可 vendoring | A | 每季度 |
| R9 | 进度滑期 | 高/中 | 里程碑连续延期 | 砍范围（先 v0.1）、并行 M2/M3、复用 mock | 全员 | 每里程碑 |
| R10 | 资产许可 | 高/高 | 发布扫描失败 | 台账、fail closed、替换占位 | E | M8 |
| R11 | 标记精度/合成不满足 v0 易用性 | 中/中 | M0/M7 检出、pose、恢复不达门槛 | 简化目标/限定工作距离；不阻塞 ARCore 核心，标记设备不达标不列支持 | A/D | marker gate |
| R12 | 双端同步边界 | 低/高 | 并发/重连测试失败 | 单事务、环形缓存、resync、负向测试 | B | M2 |

---

## 17. 迁移计划

1. **文档**：IMPLEMENTATION-PLAN/ANDROID-DELIVERY/ROADMAP 加“已按 ADR-0003 更新”提示；旧 WebXR 客户端描述标 superseded。
2. **代码**：新增 `apps/android-client`、`packages/host`、`packages/mcp-adapter`、`packages/qa-fixtures`、`apps/pc-inspector`；现有包保留。
3. **协议**：v1 → v2；不保留双版本运行；迁移脚本只处理存档（`schemaVersion`）。
4. **POC**：保留 `apps/android-ar-poc`，作为回归与设备验证参考；不合并到产品客户端。
5. **模拟器**：`apps/simulator` 增加 `host-connected` 模式；保留 `local-demo` 模式。
6. **CI**：Node + Android 双流水线；Android 构建产物留档；schema drift 检查。

---

## 18. 不做清单（v0/v1）

- iOS 真 AR、Windows 独立桌宠窗、真实 Minecraft 联动、多人实时联机、跨用户异步串门运行时。
- 语音 ASR/TTS、长期记忆、账号系统、云同步、云锚点。
- 任意方块/合成/怪物/生存规则；玩家化身。
- 在浏览器里跑产品客户端；WebView 承载 AR 业务。
- AI 执行任意脚本/shell/eval/RCON；AI 拆除/覆盖玩家建筑。

---

## 19. 变更管理

- **架构变更**：先写 ADR（proposed → accepted），再改代码；本文与 ADR-0003 同步更新。
- **协议/DSL 变更**：先改 schema/fixture，再改两端；同 PR 更新 [HOST-API](HOST-API.md)/[DSL-SPEC](DSL-SPEC.md)。
- **PR 门禁**：typecheck/test/build；协议变更跑跨语言一致性；Android 变更附设备/模拟器证据。
- **里程碑评审**：每个 M 出口做 30 分钟评审，记录“通过/有条件通过/回退”，写入本文附录。

---

## 20. 附录

### 20.1 已可用命令（当前仓库）

```powershell
npm ci
npm run typecheck
npm test                 # 76/76
npm run demo:companion   # 输入 y：12 blocks at revision 1
npm run simulator        # http://127.0.0.1:4173/
npm run test:simulator   # 需要 Chrome
```

### 20.2 目标命令（实现后）

```powershell
# Host + PC 检视页
npm run host             # HTTPS/WSS 8443 + loopback 4173
npm run inspector        # 或由 host 直接托管 /inspector/

# Android
cd apps/android-client
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -s Fangcun:V

# 备份/恢复
npm run host -- backup
npm run host -- restore --from <file>
```

> 以上“目标命令”在对应里程碑完成前不存在；不得在 README/交接材料中写成已可用。

### 20.3 术语

- **worldd**：权威世界服务；唯一写入口。
- **grant**：用户授予 AI 的家园地块与预算。
- **plan**：DSL 编译后的候选事务；有 `planId/diffHash/baseRev/TTL`。
- **approval**：用户对高风险计划的一次性批准；绑定 session/plan/hash/baseRev。
- **replica**：客户端按 commit 应用的世界副本。
- **tracking lease**：客户端 AR 跟踪就绪状态；AI 自动施工的前提之一。
