# 审核报告（第二轮）：技术路线决策与后续计划

> **历史审核快照，不是当前计划或状态。** 本文记录 2026-11-17 当日的架构审查与当时证据；表中的人日、团队工期、两周日历安排和“marker v1”均属于过时的历史估算/方案，不得解释为当前排期或范围。最新决策：Android 原生 APK；ARCore 与打印标记均为 v0 目标，若 marker 阻塞核心闭环可先交 ARCore 并紧随补齐；不估人日或日历工期。现行架构以 [ADR-0003](ADR-0003-android-client-and-ar-stack.md)、执行顺序以 [TECH-ROADMAP](TECH-ROADMAP.md)、设备状态以 [DEVICE-TEST-PLAN](DEVICE-TEST-PLAN.md) 为准。
>
> 审核日期：2026-11-17（Asia/Shanghai）
> 审核对象：仓库现状（`docs/`、`packages/`、`apps/`、构建链）＋本轮新增的 [ADR-0003](ADR-0003-android-client-and-ar-stack.md)、[HOST-API](HOST-API.md)、[DSL-SPEC](DSL-SPEC.md)、[TECH-ROADMAP](TECH-ROADMAP.md)、[DEVICE-TEST-PLAN](DEVICE-TEST-PLAN.md)
> 审核方式（审核日快照）：只读代码/文档审查 + 可复现命令 + 公开资料取证；当日未进行真机测试、未构建 Android 客户端、未验证 DSH 接入。
> 结论（仅反映审核当日）：技术路线与计划当时具备有条件交接基础；本文结论不是当前交付状态。

---

## 1. 审核日结论（仅历史记录）

### 1.1 一句话

2026-11-17 审核时曾认为：客户端技术路线已选择 **原生 Kotlin + SceneView/Filament + ARCore + glTF**，并建议按当时 M0 验证门执行。此判断仅反映当日文档状态；后续技术路线、工具链、POC、marker 范围和实测结果以最新 ADR/DEVICE-TEST-PLAN 为准，不要用本节判断当前可交接性。

### 1.2 当日评审打分（历史快照，不是当前质量/验收结论）

| 维度 | 上一轮 | 本轮（2026-11-17） | 说明（当日） |
|---|---|---|---|
| 产品边界 | A | A | 未变，且用户补答了 4 个关键产品问题 |
| 技术路线决策 | C | **A-** | 选项矩阵 + 证据 + 回退门齐备；工具链兼容性待 M0 实测 |
| 接口/契约 | C | **B+** | 协议 v2、Host API、DSL、错误码、状态机已写；实现待做 |
| 任务拆解/排期 | D+ | **B（历史评审分）** | 当日草案含 M0–M8、≤4 人日切片与团队情景；这些估算已废弃，不是当前排期 |
| 验收/测试 | B | **B+** | 验收矩阵 + 设备协议 + 跨语言黄金用例；缺真机数据 |
| 工程化 | C | **B-** | 工具链升级、wrapper、CI 已列入 M0-1；尚未执行 |
| 安全/合规 | C+ | **B** | 威胁模型、隐私、SBOM、资产台账已列；资产清权仍未做 |
| 可交接性（当日判断） | 否 | **有条件可以（历史评语）** | 不是当前状态；当前交接/验收以最新代码和设备记录为准 |

### 1.3 审核日观察（历史快照，不是最新产品/技术决策）

1. **客户端从 Web/WebXR 改为原生 APK**：这是本轮最重要的变更，依据是“自包含 APK + 非浏览器承载 + 标记可扩展 + 开源成熟”四条硬约束（详见 ADR-0003 §5）。
2. **角色从 VRM 改为 glTF/GLB**：与原生 Filament 渲染匹配；VRM 仅作为素材来源，经 Blender 转换。
3. **协议从“11 条消息”扩到完整产品闭环**：补 plot/grant、plan 生命周期、companion 状态/气泡、undo、tracking、错误码。
4. **Host 从“内存原型”升级为“SQLite WAL + 审计 + 恢复”**：明确单事务、逆操作、损坏回退。
5. **审核当日曾评估 WBS**：当时方案列 122 人日和多个团队日历情景；这只是 2026-11-17 的历史估算，已明确弃用。当前不估人日/工期，按依赖、验证证据和验收门推进。

---

## 2. 审核证据

### 2.1 审核当日复跑的命令与结果（历史证据，不代表当前分支/设备状态）

| 命令 | 结果 | 用途 |
|---|---|---|
| `npm test` | **47/47（当日历史快照）** | 只验证审核时源码；不代表当前分支测试结果 |
| `npm run typecheck` | 通过（当日历史快照） | 不代表当前原生客户端可构建 |
| `npm run demo:companion`（输入 `y`） | 当日记录为提交 12 方块；该命令/输出不是当前 APK 或 Host 联调验收证据 | 审核时原型记录 |
| `node -e "DatabaseSync..."` | `node:sqlite ok` | 验证 Host 持久化选型可用 |
| `adb devices -l`（审核日快照） | `R52T7002ZLV unauthorized` | 审核当日需人工确认 RSA；当前 ADB 已授权且 POC 已完成首轮真机 smoke，见 [DEVICE-TEST-PLAN](DEVICE-TEST-PLAN.md) |
| `git log --oneline` | HEAD `94102b4`；工作区仅 `dsh-neutral-mode/` 未跟踪 | 交接基线 |

### 2.2 公共资料取证（采样日 2026-11-17）

- Chrome 的 WebXR 在 Android 上**由 ARCore 提供**；hit-test/anchors/depth 已发布，plane detection 仍是 Developer Trial，Augmented Images 不在 WebXR 能力表。
  <https://developers.google.com/ar/develop/webxr/arcore-comparison>
- WebXR 要求安全上下文、兼容浏览器、ARCore 设备，并明确要求 **Google Play Services for AR**。
  <https://developers.google.com/ar/develop/webxr/requirements>
- Godot 官方文档：ARCore 插件“不由 Godot 基金会维护、目前休眠、未在积极开发”。
  <https://docs.godotengine.org/en/stable/tutorials/xr/arcore_intro.html>
- SceneView：Apache-2.0，1,374 stars，2026-11-16 有推送；`MeshNode`/`ModelNode`/`ARSceneView`/record-replay 均为一等能力。
  <https://github.com/sceneview/sceneview>
- Filament：Apache-2.0，20,752 stars；ARCore SDK 为 Google 免费 SDK；BoofCV/OkHttp/three.js 许可与活跃度见 ADR-0003 §5.2。

> 这些是“路线选择”的证据，不是“本机可用”的证据；后者必须由 M0 设备测试给出。

---

## 3. 对上一轮 P0/P1 的闭环情况

### 3.1 上一轮 4 个 P0

| 编号 | 上一轮问题 | 本轮处理 | 状态 |
|---|---|---|---|
| P0-1 | Android 技术栈未决且文档互相矛盾 | [ADR-0003](ADR-0003-android-client-and-ar-stack.md)：原生 + SceneView + ARCore + glTF；Web/Godot/Unity/混合四案有证据与否决理由 | **已关闭（决策层）** |
| P0-2 | 客户端↔worldd 契约不完整（缺 plot/plan/undo/tracking、错误码自由字符串） | [HOST-API](HOST-API.md) §5–6：消息表、错误码表、状态机、时序；[DSL-SPEC](DSL-SPEC.md) 补工具面 | **已关闭（设计层）** |
| P0-3 | Host 第一阶段接口无规格 | [HOST-API](HOST-API.md) §4/§7：HTTP/WS 端点、配对、SQLite DDL、提交/撤销算法 | **已关闭（设计层）** |
| P0-4 | 无法排期 | [TECH-ROADMAP](TECH-ROADMAP.md) §8–§10：WBS、人日、依赖、多档团队情景（1/2/3/4 人与兼职）、关键路径 | **已关闭（计划层）** |

> “关闭（设计层）”不等于“实现完成”；对应的实现任务在 M1–M5。

### 3.2 上一轮 P1 的处置

| P1 | 处置 | 状态 |
|---|---|---|
| M0 门禁证据缺失、模板过期 | [DEVICE-TEST-PLAN](DEVICE-TEST-PLAN.md)：T0–T7 可执行步骤；M0 门 G1–G7 | 已补方案；证据待测 |
| 文档一致性（companion-schema 重复行、CONTRIBUTING 过期、README 状态、M2 声明偏宽） | 本轮已加“已更新”提示并修正关键表述（见 §5） | 部分完成 |
| 结构 DSL 缺规范 | [DSL-SPEC](DSL-SPEC.md)：原语、展开顺序、限额、canonical hash 向量 | 已关闭 |
| MCP 工具 schema 与 20 条中文请求缺失 | DSL-SPEC §8 给出 schema；20 条 fixture 列入 M5-4 | 部分（fixture 待写） |
| 持久化只有承诺 | HOST-API §7：DDL、提交算法、恢复/备份 | 已关闭（设计） |
| 审计无 schema | HOST-API §7.5：事件类型、字段、保留期 | 已关闭 |
| PC 检视端无归属 | ADR-0003 §6.6 + TECH-ROADMAP M2-6 | 已关闭 |
| 设备/性能协议 | DEVICE-TEST-PLAN T2/T3 | 已关闭（方案） |
| 合规无 owner/期限 | TECH-ROADMAP §14/§16（R10） | 部分（执行待做） |
| 工程化（wrapper/CI/Node 版本） | TECH-ROADMAP M0-1/M1-6 | 已列入任务 |

---

## 4. 本轮新发现

### 4.1 P0（开工前必须处理）

1. **工具链不满足 SceneView 4.18 的前提**：本机 JDK 17、SDK platform 35、无 Gradle wrapper；SceneView 4.18 需要 compileSdk 36、Kotlin 2.2+，4.69 还需要 AGP 9.4/compileSdk 37/JDK 21。
   → 已列为 M0-1（2 人日）；**在 M0-1 完成前不要开始 M3 客户端代码**。
2. **M0 证据不完整**：ARCore 只在 POC 上验证了相机/平面/anchor/方块渲染，尚未验证 SceneView、深度、10 分钟热态、第二台设备、TLS 配对、DSH 工具闭环。
   → 已列为 M0-2..M0-6；ADR-0003 §9 给出回退动作。
3. **旧文档仍可能误导接手者**：`docs/IMPLEMENTATION-PLAN.md` 的“Chrome/WebXR + three.js”描述、`docs/ANDROID-DELIVERY.md` 的“APK 壳/外部 Chrome”、`docs/PROJECT-STATUS-AND-ROADMAP.md` 阶段 C 的“复用 WebXR provider”仍留在正文。
   → 本轮已加提示/改写（见 §5）；后续 PR 需彻底删除旧描述，而不是只加提示。

### 4.2 P1（M0/M1 期间）

1. **SceneView 单一维护者与版本跳跃**：4.18 → 4.69 的 API/工具链跨度大；需端口层隔离，锁定 4.18.0 并记录升级路径。
2. **glTF 角色管线的观感风险**：MToon/描边/弹簧骨在 Filament 里只能近似；M6-2/M6-5 需要真机对照参考图，失败则用程序化角色。
3. **标记合成方案未定**：审核日的方案把 marker 排为 v1；该范围判断已被用户更新为 v0 目标。透明 Surface vs 外部纹理仍需 spike 选择；marker 可在 ARCore 主链之后紧随实现，但不得再称为 v1 或不影响 v0。
4. **无 GMS 设备覆盖未量化**：ARCore 要求 Play Services for AR；国产 ROM 覆盖需实测。打印标记是 v0 目标兼容路径之一，不是只在未来 v1 才开始的备选项；第二台非 ARCore/无 GMS 设备验证仍需完成。
5. **配对体验**：IP 变化导致证书重签/重扫；扫码失败需手动码兜底；需在 M0-5 写清楚用户路径与错误文案。
6. **`node:sqlite` 的稳定性**：Node 24 内置、本机可用，但 API 仍在演进；仓储层接口化，必要时切 better-sqlite3。
7. **PC 检视页的权限**：默认只读 + 审批；如果未来允许 PC 放置，需要单独 threat model（本计划已禁止）。
8. **资产许可**：`效果图/`、`docs/model-check-*.png`、`preview/vrm-*.png` 仍在仓库；发布前必须移除/替换/补授权，且需要 owner 与日期（R10）。

### 4.3 P2（清理/卫生）

- `dsh-neutral-mode/` 未跟踪目录（与本项目交付无关）；`蓝色小肥鱼…zip` 15 MB 在根目录（已被 `.gitignore` 排除）；`preview/` 下大量一次性 `patch-*.mjs` 脚本；`apps/android-ar-poc/*.png` 测试截图（部分已忽略）。
- `docs/M0-DEVICE-TEST.md` 仍写“型号待确认/Android 待填写”，与 `ANDROID-DELIVERY.md` 冲突；建议合并到 `DEVICE-TEST-PLAN.md` 或标注 deprecated。
- `CONTRIBUTING.md` §3 仍写“正式 workspace 和 CI 尚未建立”（实际已有），需改。
- `README.md` 状态段写“下一阶段将实现 companion 循环与 DSH adapter”（实际已有 companion-runtime），需改。

---

## 5. 本轮已做的文档修订

| 文件 | 修订 |
|---|---|
| `docs/ADR-0003-android-client-and-ar-stack.md` | 新增：技术路线决策、选项矩阵、证据、验证门、迁移 |
| `docs/HOST-API.md` | 新增：配对/TLS、HTTP/WS、协议 v2、错误码、状态机、SQLite、MCP 边界、测试用例 |
| `docs/DSL-SPEC.md` | 新增：DSL 原语、校验流水线、canonical hash 向量、MCP 工具 schema、安全边界 |
| `docs/TECH-ROADMAP.md` | 新增：目标架构、选型、M0–M8 WBS、排期、验收、测试、风险、合规、迁移 |
| `docs/DEVICE-TEST-PLAN.md` | 新增：T0–T7 可执行测试与记录模板 |
| `docs/IMPLEMENTATION-PLAN.md` | 顶部加“2026-11-17 决策更新”提示，指向 ADR-0003 |
| `docs/ANDROID-DELIVERY.md` | 顶部加“客户端形态已更新”提示；旧“APK 壳”段落标注 superseded |
| `docs/PROJECT-STATUS-AND-ROADMAP.md` | 阶段 C 改为原生客户端联调；删除“复用 WebXR provider”表述 |
| `CONTRIBUTING.md` | 修正“workspace/CI 未建立”；更新第一优先级任务为 M0 |
| `README.md` | 文档索引加入新文档；状态段改为“原生客户端路线已定，M0 验证中” |

> 具体改动见各文件顶部/相应小节；本轮不修改业务代码。

---

## 6. 新文档的质量评估

### 6.1 ADR-0003

**优点**：把“产品形态”作为第一权重，而不是技术偏好；每个被否方案都有可核查证据；给出回退动作，不是“必须成功”；明确 M0 失败时的替代（Filament 直连）。

**不足**：
- SceneView 4.18 在本机工具链上的兼容性未实测（M0-1 解决）。
- 评分是工程判断，不是量化模型；权重可被质疑（已在文中说明）。
- 角色观感风险只能到 M6 才见分晓；ADR 给了回退但不是提前验证。

### 6.2 HOST-API

**优点**：把“信任边界”写成可测试的规则；错误码与 UI 文案成对；SQLite DDL/提交算法可直接实现；测试用例覆盖并发/重放/损坏。

**不足**：
- 证书 SAN/轮换、PC 检视页 token 注入方式需在 M0-5/M2 实现时定稿。
- `node:sqlite` API 兼容性需在 M2-1 加一层仓储接口。
- 多世界、账号、访客等未来能力只留了 `worldId`，未做设计（符合 v0 范围）。

### 6.3 DSL-SPEC

**优点**：原语少而明确；展开顺序/重复格/预算全部 fail closed；canonical hash 有可复现向量；工具 schema 可直接落 `packages/protocol`。

**不足**：
- `roof_gable` 的“宽轴收窄”语义需要参考实现与截图对齐；当前只有文字规则。
- 20 条中文请求 fixture 未写（M5-4）。
- 示例计划的格数已人工核对（22/12），但仍建议在 M1-3 用编译器生成并断言。

### 6.4 TECH-ROADMAP

**优点**：WBS 到 ≤4 人日、有依赖/角色/DoD；关键路径与并行清晰；风险有触发条件与 owner；排期有 1/2/3–4 人情景。

**不足**：
- 人日是估算，M0 后需按实际速度重估（文中已声明）。
- 单人兼职情景的日历跨度很长，需要产品侧接受“先 v0.1、后 beta”的取舍。
- 设备/资产的依赖（第二台设备、正式角色）未锁定供应商/来源。

### 6.5 DEVICE-TEST-PLAN

**优点**：现在就能做 T0–T3；命令可直接复制；记录模板统一；判定与回退一一对应。

**不足**：
- T2 的“偏移”测量依赖人工读数，建议后续用录屏 + 图像测量脚本辅助。
- T4–T7 依赖 M0 产物，当前只能准备环境。

---

## 7. 一致性检查（本轮已发现并修正/待修正）

| 项 | 状态 |
|---|---|
| 协议消息数：旧文档 11 条 vs 新文档完整闭环 | 新文档已补齐；旧 §4.3 表仍保留，已在 IMPLEMENTATION-PLAN 顶部提示“以 HOST-API 为准” |
| `companion-schema` 在 IMPLEMENTATION-PLAN 模块表出现两次 | **本轮已删除重复行并同步模块名** |
| TECH-ROADMAP v0 人日 96 vs 摘要 96.5 | **本轮修正为 96** |
| README/CONTRIBUTING 过期表述 | 本轮修正 |
| M0-DEVICE-TEST.md 与 ANDROID-DELIVERY 冲突 | 本轮在 M0-DEVICE-TEST 顶部标注“旧模板，以 DEVICE-TEST-PLAN 为准” |
| `PROJECT-STATUS-AND-ROADMAP` 阶段 C “复用 WebXR provider” | 本轮改为“原生客户端 provider” |
| `ANDROID-DELIVERY` “APK = WebView 壳” | 本轮标注 superseded，指向 ADR-0003 |

---

## 8. 交接判定

### 8.1 结论

**可以有条件交接。** 条件：

1. M0 的 G1–G7 至少通过 G1/G2/G4/G5；G3/G6/G7 允许“明确降级”但必须有记录。
2. 工具链升级完成（JDK 21、SDK 36、Gradle wrapper、Android CI）。
3. 旧文档的 superseded 段落删除或改写完成（本轮已改写阶段 C/模块表；ANDROID-DELIVERY 的旧正文仍在，需在 M0 前删除或归档）。
4. `packages/protocol` 的 v2 schema + 黄金用例落地，Kotlin 侧能跑通同一批 fixture。
5. 资产许可台账建立，发布包不包含未清权素材。

### 8.2 不建议现在做的事

- 不要先写 Android 客户端再补契约；M1 必须先冻结协议/DSL/错误码。
- 不要用 WebView/浏览器“先跑起来”；这与 ADR-0003 的产品形态冲突，会浪费两端工作。
- 不要把“POC 通过”当作“客户端可用”；POC 只证明 ARCore 基础能力。
- 不要在 M0 未过门时承诺日期；当前人日只是估算。

---

## 9. 下一步（两周）

| 周 | 任务 | 产出 |
|---|---|---|
| 第 1 周 | 用户执行 T0–T3（ADB 授权、ARCore 版本、漂移、10 分钟热态）；开发执行 M0-1 工具链 + M0-2 SceneView 冒烟 | 设备数据、SceneView 录屏、构建产物 |
| 第 1 周末 | M0-5 TLS 配对 spike；M0-6 DSH 工具探测 | 配对演示、工具闭环记录 |
| 第 2 周 | M1-1/M1-3 协议 v2 + DSL 编译器 + 向量；M1-4 跨语言 fixture | schema、编译器、CI 绿 |
| 第 2 周末 | M0 评审（G1–G7）；更新估算与风险 | 评审记录、是否进入 M2/M3 |

---

## 10. 附录

### 10.1 本轮新增/修改文件

- 新增：`docs/ADR-0003-android-client-and-ar-stack.md`、`docs/HOST-API.md`、`docs/DSL-SPEC.md`、`docs/TECH-ROADMAP.md`、`docs/DEVICE-TEST-PLAN.md`、`docs/REVIEW-2.md`
- 修改：`docs/IMPLEMENTATION-PLAN.md`、`docs/ANDROID-DELIVERY.md`、`docs/PROJECT-STATUS-AND-ROADMAP.md`、`docs/M0-DEVICE-TEST.md`、`CONTRIBUTING.md`、`README.md`

### 10.2 证据边界

- 未做：真机新客户端、Host 实现、DSH 实际接入、标记模式、10 分钟热测、第二台设备。
- 已做：文档/代码审查、47 项测试、demo 复跑、构建链探测、公开资料取证、SQLite 可用性测试。
- 因此：**决策与计划可交接；实现与验收仍需 M0 证据**。

### 10.3 参考

- 上一轮审核：[REVIEW.md](REVIEW.md)
- 当前实施真源：[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)（客户端部分以 ADR-0003 为准）
- 技术路线：[ADR-0003](ADR-0003-android-client-and-ar-stack.md)、[TECH-ROADMAP](TECH-ROADMAP.md)
- 接口：[HOST-API](HOST-API.md)、[DSL-SPEC](DSL-SPEC.md)
- 设备：[DEVICE-TEST-PLAN](DEVICE-TEST-PLAN.md)
