# 方寸：AR 桌面微缩世界实施计划

> **状态：用户确认产品范围；本文是当前实施单一真源。**
> 产品决策确认：2026-11-16（本次会话）。技术细节若与旧文档冲突，以本文为准；旧文档中尚未验证的结论不得当作实现事实。
> 面向：后续产品、客户端、服务端、AI、视觉/资产与 QA 开发同事。

## 1. 已确认范围

### 1.1 产品定义

用户在**真实物理桌面**上通过手机摄像头看到一个 MC 风格的微缩方块世界；一个大肥鱼 AI 角色在其中建造，玩家能直接参与放置/拆除方块，并能让 AI 协作建造。手机是 AR 取景和操作端，PC 是开发初期的世界与 DSH 运行端。

### 1.2 已确认决策

| 项目 | v0 决策 |
|---|---|
| 产品形态 | 真实桌面 AR 微缩沙盒，不是把 MC 画面投到手机 |
| 首发平台 | Android 优先：支持 ARCore 的设备走 Chrome/WebXR 平面追踪与 anchors；不支持该能力的设备优先验证打印桌面定位标记的摄像头跟踪模式。用户已认可“非 ARCore 用打印标记尝试兼容”的方向；两种方案仍须在真实设备完成稳定性/性能验收后，才可作为正式支持项 |
| 角色 | 一个 3D 大肥鱼角色；开发期可使用合法占位模型；发行模型必须另过素材许可门禁 |
| 玩家输入 | 手机触屏直接参与方块建造；玩家本身不渲染为世界角色 |
| AI | PC 上的 DSH 是大脑；通过受限工具与玩家共用同一个世界状态 |
| 暂不包含 | iOS 真 AR、Windows 独立桌宠窗口、真实 PC Minecraft 联动、多人联机、语音、长期记忆、生存/战斗/红石 |

以上是产品范围，不代表对应技术已完成。Android 的 ARCore/WebXR 与打印标记跟踪均为待验证技术路线；平板/手机型号覆盖、遮挡与漂移表现、标记尺寸/打印方式、真机性能、iOS 方案、3D 正式素材和部署方式仍需验证。非 ARCore 模式必须明确依赖打印并保持标记在摄像头可见范围内；失去可靠 tracking 时暂停世界输入，不能假称已锚定。

### 1.3 工程建议（不是用户确认项）

- PC `worldd` 持有权威世界状态，手机只负责渲染、输入与临时预测。这样 DSH 可使用同一权威接口，手机切后台/刷新也不导致状态成为唯一副本。
- v0 使用自建有限体素世界，不接真实 Minecraft 服务端；本项目不是完整 MC 克隆。
- MVP 首先支持同一局域网的一台 PC 和一台 Android 设备。公网访问不在首发承诺内。
- Android 交付目标是可手动安装的 APK（便于用户在没有 ADB 的设备上测试）；构建系统和包签名/升级策略待 M0/M1 后单独确定。开发中优先保持跨设备 capability detection 与 provider abstraction，不做仅针对单一平板型号的分支。
- 一个会话中的 AI 方块修改先预览、再由用户明确确认；禁止 AI 任意执行脚本、未确认破坏或覆盖玩家建筑。

若产品负责人以后调整这些工程建议，需先更新 ADR 和本文，不允许各模块自行分叉。

## 2. 用户闭环与验收目标

### 2.1 主任务

1. PC 启动方寸世界服务及 DSH 连接；用户在 Android Chrome 打开配对链接。
2. 用户授权摄像头，在真实桌面检测水平面并放置/确认微缩岛锚点。
3. 玩家用触屏选方块、点格子放置；能拆除允许拆除的方块，操作结果在 AI/PC 检视端一致。
4. 玩家发出“帮我盖一个小木屋”之类的文字请求；AI 先生成受限建造计划和可视预览。
5. 玩家确认后服务端一次性校验并提交；大肥鱼在场景内移动/做建造动作并显示简短气泡。
6. 玩家可取消尚未提交的计划、撤销最近一笔未被覆盖的 AI 建造；断线后重连获得权威状态。

### 2.2 MVP 非目标

不做任意 MC 合成/怪物/生存规则、开放互联网多人、语音 ASR/TTS、跨会话偏好记忆、自动清理或改写玩家建筑、手机本地运行 DSH、游戏截图上传给模型、iOS 同期支持、用户模型在线市场、发布正式商业角色美术。

## 3. 总体架构

```text
Android Chrome / ARCore WebXR
  ├─ AR/session：能力探测；ARCore/WebXR 平面 hit-test + anchor，或打印标记检测 + marker transform；追踪状态显式建模
  ├─ render：three.js 体素网格 + 单个 3D 角色 + 透明 AR 合成
  ├─ input/ui：格点选择、放置/拆除、计划预览/确认/取消
  └─ replica：WSS 有序快照/事务；断线重同步
                    │ HTTPS + WSS（同源反向代理/同一安全上下文）
                    ▼
PC 方寸 Host
  ├─ worldd：有限世界权威、事务仲裁、存档/WAL、配对与限流
  ├─ DSH adapter：仅限 schema 化工具；worldd 是唯一写入口
  ├─ local inspector/mock-ai：真实客户端协议，不绕过权限
  └─ local data：世界存档、短期事件/审计；无云端同步
```

**AR 渲染边界：**WebXR 相机背景由浏览器/系统合成，普通页面通常拿不到背景纹理。MVP 不承诺对真实桌面摄像头画面做移轴、模糊或任意后期；仅对虚拟物体实现卡通材质、接触阴影与基础光照。实景遮挡/深度也不作为首发能力，除非设备实测证明可用且另有明确验收。

**非 ARCore Android 兼容路线（用户认可方向，技术可行性待 spike）：**调查基于开源/许可合规的 fiducial marker（如 AprilTag/ArUco 类）方案，将打印标记放置桌面作为稳定参考；优先实现由原生 Android 相机/视觉跟踪模块提供 marker pose，浏览器/WebView 只接收受限 pose/capability 并渲染交互。纯浏览器 fallback 只有在 Android Chrome 能可靠获取摄像头帧、目标库可合法分发、持续跟踪足够稳且功耗可接受时才考虑。标记必须持续可见；遮挡或低置信度时冻结/隐藏虚拟场景并禁用世界写入，恢复识别后需重定位确认。此模式仍是摄像头透视叠加，不能承诺无标记平面检测、实景深度遮挡或与 ARCore 等同稳定。

**运行时安全边界：**浏览器只能经 HTTPS/WSS 与 `worldd` 通信；DSH 到 `worldd` 使用本机 stdio 或 loopback HTTP + 独立短期凭证。不得把 MCP 服务暴露到局域网/公网；不得把 token 放 URL query、持久日志或客户端 bundle。

## 4. 唯一基础数据与协议规范（v1 已按 ADR-0001 锁定；运行时契约分阶段补全）

### 4.1 世界坐标

- 一个体素边长为 1 个逻辑单位，AR 映射为 **3 cm**；方块坐标整数 `(x,y,z)` 表示该格左下近角格点，体素占据 `[x,x+1)×[y,y+1)×[z,z+1)`。
- **已由 [ADR-0001](ADR-0001-world-schema.md) 锁定的 `WorldSpec v1`**：`size=[16,16,16]`, `origin=[-8,0,-8]`，合法半开范围为 `x,z∈[-8,8), y∈[0,16)`。逻辑数组统一 **x 最快、z 次之、y 最慢**：`i=((y-originY)*sizeZ+(z-originZ))*sizeX+(x-originX)`；代码与全坐标往返测试已实现。
- AR anchor 原点是岛 footprint 的中心垂线与实体桌面的交点；逻辑 `y=0` 映射到桌面高度。可见岛 footprint 为 `x,z∈[-7,7)`，岛体地形占用 `y∈[0,4)`，草地方块顶面到 `y=4`；玩家/AI 建造空间从 `y≥4` 开始。14×14 格、3 cm/格的 footprint 是 42×42 cm，岛体厚 12 cm，位于桌面上方。岛生成器须保证每个 footprint 柱体连续到底，不允许悬空；岛外的地形无需占满整个 16×16 域。
- AR hit-test 返回世界位姿后，将其局部原点直接映射到桌面上岛中心 `(x=0,z=0)`；体素格点 `(x,y,z)` 在 anchor 局部坐标为 `(x*0.03, y*0.03, z*0.03)` 米，方块中心为 `((x+0.5)*0.03, (y+0.5)*0.03, (z+0.5)*0.03)` 米；再由 anchor 姿态变换到 AR 世界坐标。这样 14 格岛的左右边界严格落在 ±21 cm，anchor 不需要半格补偿。
- 方块 ID 在权威协议中使用稳定字符串；快照 palette/紧凑编码只能由 schema 版本和 palette hash 明确绑定，未知块 ID 在权威协议/存档加载处 **fail closed 并拒绝快照**；仅渲染显示层可将已知但无贴图的块 ID 画成显式占位，不得静默把未知持久化数据映射成可写方块，也不得把本机枚举顺序当跨版本协议。
- 最大世界 4096 格；每个请求有独立方块数、结构边长、JSON 字节和执行时限上限。扩容需升级 `WorldSpec` 版本并迁移存档。

这是用于消除旧报告中 14×14×10、16×12×16、32×16×32 多种说法的统一建议。开始 `voxel-core`/协议实现前必须由技术负责人把这些字段写成共享 schema、测试和 ADR；不能再按旧文档分别实现。

### 4.2 修订和事务语义

- 一个成功提交的事务严格对应一个递增 `rev`；批量 AI 建造是一笔全原子事务，不接受“有的格子成功、有的失败”这种模糊结果。
- 所有修改由服务端串行仲裁。放置只允许目标为空；拆除需携带 `expectedBlock`/`baseRev` 条件。冲突、越界、权限错误均拒绝整笔事务。
- 客户端 `clientId + seq` 是幂等键。ACK 确认该请求及结果，但**不推进已应用的世界 revision**；只有按序 commit/delta 可推进 replica revision。重复旧 rev 丢弃，发现 revision 缺口立即请求快照。
- 客户端可先显示待确认 ghost，不将预测值写成权威体素；拒绝/超时只需清理 ghost，不会发生不可逆的副本回滚错误。
- AI 计划包括 `planId`、`baseRev`、canonical diff hash、预览、材料清单和短 TTL。玩家确认 UI 必须展示准确的占格/破坏/材料摘要；明确确认后由 UI 发 `approve_plan`，服务端创建绑定用户 session、planId/hash/baseRev 的短时单次 `approvalId`。AI/MCP 不能自行构造批准，也不能复用其他 session 的批准。commit 时服务端校验审批来源/过期/一次性使用，并重算/重验 hash、边界、权限、目标占用及 base revision；revision 已变化就要求重做计划。
- Undo 仅允许在当前格子仍等于该事务写入值时原子反向应用；否则拒绝并说明冲突，不覆盖后续玩家修改。

### 4.3 网络消息（命名和 schema 的唯一来源）

所有消息有 `protocolVersion`、`worldId`。消息字段必须由共享 schema 校验并生成 TS 类型；不要在 client/worldd/tools 重复手写类型。

| 方向 | 消息 | 必要字段/语义 |
|---|---|---|
| Client → Server | `hello` | protocolVersion、一次性配对后的 session credential、clientId、lastAppliedRev |
| Server → Client | `welcome` | protocolVersion、worldId、rev、完整 snapshot、world schema/palette hash |
| Client → Server | `intent` | seq、baseRev、单格放置/拆除 intent；不接受任意代码或方块属性 |
| Server → Client | `ack` | seq、accepted/rejected、reason、committedRev（只作确认，不推进 replica） |
| Client → Server | `approve_plan` | planId、diffHash、UI 当前展示版本；只接受经过真人确认的有效操作并在服务端创建短时一次性 approval 记录 |
| Server → Client | `approval_granted` | approvalId、planId、diffHash、expiry；仅原 session 可用，不写入日志 |
| Server → Client | `commit` | rev、txId、actor、canonical ops；所有连接按序广播 |
| Client → Server | `resync` | lastAppliedRev；revision gap / 超出 ring buffer 后回完整快照 |
| 双向 | `ping/pong` | 心跳和连接质量，不含凭证 |

服务入口为 Host 同源的 `/api/pair/exchange` 与 `/api/ws`；本机 DSH 使用 loopback-only MCP，不允许经反向代理暴露 `/api/mcp` 到手机或 LAN。配对流程：用户在 PC Host 本地 UI 明确点击“允许连接”，Host 显示短时一次性码/二维码；手机扫码后从 URL fragment 读取 code，经 HTTPS POST body 兑换一次性 WSS session ticket，随后清除 fragment/history；WebSocket URL 不带凭证，ticket 只在首个有长度上限的 `hello` 帧中提交，验证后立即作废。兑换、失败次数、ticket、Origin 与日志均有速率限制/脱敏。协议落地前更新接口 schema 和版本；无兼容处理的破坏改动必须升大版本。

### 4.4 DSH 工具面

v0 只开放最少工具；具体 JSON Schema 放入 `packages/protocol`，MCP 描述不得作为浏览器业务 API 使用。

| 工具 | 责任与约束 |
|---|---|
| `world_observe` | 返回边界内附近方块、岛摘要、最近的玩家建造意图；不回传摄像头画面/麦克风/隐私文件 |
| `build_plan` | 将受限结构 DSL 编译为 canonical diff；返回冲突、材料、网格预览数据、planId/hash/baseRev/expiry；纯 dry-run |
| `build_commit` | 入参必须含 `planId + approvalId`；服务端确认该一次性授权由同一用户 session 对相同 plan/hash/baseRev 发出且未过期后，二次校验并整笔原子提交 |
| `build_cancel` | 使未提交 plan 失效 |
| `world_undo` | 对可逆且未冲突的最近一次 AI 事务作条件撤销 |
| `companion_say` | 限字数、安全输出的场景气泡；MVP 不含 TTS |

AI 结构 DSL 仅支持 box、line、wall、floor、有限尺寸的 stairs/roof 等经过测试的原语；材料必须来自 `BlockDef` allowlist。不得使用 shell、Lua、JS/eval、RCON 或从上游图纸代码执行玩家/AI 文本。参考 `dsh-game` 只复用经逐文件审查的许可兼容纯算法；不要把其 Minecraft 清除语义、RCON 写入或未核实的图片预览能力当作本产品现成功能。

## 5. 模块化交接任务

建议仓库结构（目标结构，不代表当前已创建）：

```text
apps/
  host/                 PC 启动器/本地服务编排、配对 HTTPS/WSS
  client/               手机 Web UI 与 AR 页面
packages/
  world-schema/         WorldSpec、BlockDef、坐标和存档 schema
  protocol/             Zod/JSON schema、WS codec、MCP tool schema
  voxel-core/           生成器、mesh 输入、DSL 编译、纯仲裁函数
  worldd/               权威事务、连接、持久化、认证与限流
  render-voxel/          chunk mesh、材质、阴影与性能降级
  render-character/      单角色 loader/动画/行为状态
  ar-provider/           WebXR 生命周期、hit-test、anchors、transform
  dsh-adapter/           MCP host 接入、请求取消与结果映射
  qa-fixtures/           确定性地图、mock 模型/AI、协议场景
```

### 模块交接契约

| 模块 | Owner 建议 | 依赖/公开边界 | 首批交付物 | 主要测试归属 |
|---|---|---|---|---|
| `world-schema` | 全栈/数据 | 无运行时依赖；定义 `WorldSpec`、方块 ID、坐标、存档与版本升级 | 唯一 schema、坐标变换、迁移规则 | 原点/边界、index↔coord 往返、快照编解码 |
| `protocol` | 全栈/服务端 | 依赖 schema；输出 client/server/MCP 共用的类型和 validator | 版本化消息、DSL、error codes、fixture | fuzz/schema reject、向前/向后版本拒绝、codec round-trip |
| `voxel-core` | 体素工程师 | 纯 TS；不得依赖 three/fs/ws/LLM | seed map、结构 DSL compiler、事务 diff/undo | 属性测试、越界/预算/清除语义、确定性构景 |
| `worldd` | Node 服务端 | 依赖 schema/protocol/core；唯一写世界入口 | session、事务队列、WAL/快照、pairing API | 并发、幂等、恢复、鉴权、限流、恶意 payload |
| `render-voxel` | Three.js 客户端 | 读 replica 与 WorldSpec；不直接连 MCP/写真值 | chunk mesh、hit highlight、pending ghost、XR render path | voxel fixture golden image、变更影响范围、移动设备 profile |
| `ar-provider` | Android/WebXR | 只产生 pose/hit-test/capabilities；不解释业务方块/仲裁 | typed lifecycle/anchor/session adapter | 权限拒绝、tracking lost、pause/resume、relocalization、设备矩阵 |
| `render-character` | 角色/客户端 | 读 actor state/授权 manifest；不调用世界写接口 | 单模型加载、动作状态映射、资源释放/回退 | 模型合法性、缺失资源、反复装卸、帧时和内存 |
| `dsh-adapter` | DSH 集成 | 依赖 protocol 与本机权限；所有写操作经 worldd | MCP tool definitions、取消/超时/错误翻译、prompt boundaries | mock tool end-to-end、拒绝未确认 commit、越权和注入测试 |
| `client` / Host | 前端/桌面集成 | UI 编排、局域网配对；不持有 durable world truth | 安装/启动/配对/状态 UI、PWA 或本地 HTTPS host | fresh install、扫码兑换、断网、关闭与重启 |
| `qa-fixtures` | QA/全栈 | 供所有包共享确定性输入 | 世界 seed、固定请求集、乱序网络脚本、设备测试记录模板 | CI 核心回归和真机报告 |

**依赖顺序：**M0 Android ARCore/WebXR、打印标记 provider、TLS/WSS 风险验证可以与无依赖的资产清点并行；M1 schema 必须先于 core/protocol API 冻结；M2 可与 M3 的基础 Host skeleton 并行但不得各自定义数据；M3 后接 M4 连网 AR/marker 输入；M5 依赖 M3 的事务/预览接口及 M4 的用户确认 UI；M6 在发行资产和目标设备锁定后才能完成。当前代码已完成部分 M1/M2 核心与纯浏览器桌面预览，但 M0 与服务端里程碑尚未通过。

### M0：风险验证与产品基线（技术负责人 + Android/客户端）

**先做，未过门不扩全栈。**

- 任务：用真实支持 ARCore 的 Android 手机验证 HTTPS 安全上下文、Chrome WebXR `immersive-ar`、摄像头授权、水平面 hit-test、anchor 建立/跟踪丢失/恢复、alpha 渲染；用非 ARCore Android 设备验证打印 fiducial marker 的检测/pose、遮挡恢复、相机帧权限与功耗边界；两条路线都验证真实 LAN WSS 连通。同时用本机目标 DSH 版本验证其是否能接入 loopback stdio/HTTP MCP、列出并确认工具调用/取消/错误语义。若工具兼容未过，M5 前先实现/验证小型 Host plugin adapter，不得假设文档中的 MCP 配置片段可直接工作。
- 输出：设备/OS/Chrome/ARCore 版本矩阵；标记规格、打印尺寸和许可记录；两种模式的录屏和控制台日志；安全上下文和配对策略的实测操作步骤；tracking 稳定性/遮挡恢复/功耗原始数据；WebXR 与 marker provider 限制清单；DSH MCP 能力清单和最小连通 POC。
- Go：至少一台真实 ARCore Android 设备能进入 AR、放置并重定位场景，透明虚拟岛和阴影在 WebXR 合成画面可见；另至少一台非 ARCore Android 设备能用打印标记进入摄像头叠加模式，并在遮挡恢复后不跳变/不误写；同一局域网的 HTTPS/WSS 配对方案和 DSH MCP 连通 POC 均可复现。该 Go 仅批准继续实现，不等于多设备兼容或公开 beta。
- No-go：先停做产品 UI，解决 TLS/WSS、设备支持或桌面锚定问题；不能把 photo/3DOF 假锚定或无标记普通相机叠加算作 6DoF AR 成功。打印标记模式必须单独标注能力边界；公开 beta 前至少再在不同档次的第二台设备完成验收。

### M1：可构建骨架与共享 schema（技术负责人/全栈）

- 创建根工作区、锁文件、统一 Node/pnpm 或 npm 版本、format/lint/typecheck/test/build 脚本和 CI；README 中所有命令必须从 fresh clone 验证。
- 先实现 `WorldSpec`、坐标索引往返、BlockDef、协议版本/codec 与 JSON schema；删去文档重复定义。
- DoD：fresh clone 单命令安装；所有 package 构建；边界、负坐标、快照往返、已纳入消息 schema 的 frame 拒绝未知值测试通过；不存在 `test` 固定 exit 1 或文档虚构脚本。
- **当前 M1 partial 状态：**workspace/lock/typecheck/build/CI、WorldSpec、有限类型方块白名单、坐标/快照、intent/commit 与 hello/welcome/ack/resync/ping/pong/approve-plan/approval-granted 消息运行时校验和有界 JSON frame codec 已有实现及单元测试；已添加 `packages/protocol/schema/protocol-v1.json` 并在单元测试中用 Ajv 对目前每个实现的消息 envelope 与运行时 validator 交叉校验；仍未完成 schema 自动生成/漂移检查、fuzz/property suite、消息广播/握手服务和完整兼容矩阵。完整协议不得标记为已交付。

### M2：体素核心与桌面静态场景（体素/渲染）

- 把当前 `preview/m0.html` 中的确定性世界生成、面剔除/材质分桶迁入正式 package；生成种子固定；建设局部方块变更到受影响 chunk 重建的路径。
- 遵循统一 16³ 数据域；草岛 14×14，底面连续；相机/AR 物理尺度严格 3 cm/格。桌面静态预览与 WebXR render path 分开，不将后处理链直接套到 XR compositor。
- 建造单格选择高亮、空格放置 ghost 和可拆限制；真实 AR 下按桌面坐标显示。
- DoD：固定 seed 下截图稳定；网格变更不修改未受影响区域；桌面测试视图与 Android AR 各自有视觉基线；角色缺失时回退合法占位，不阻断世界。

### M3：worldd、同步、存档、安全（服务端/协议）

- 服务端事务串行队列；一条路径处理玩家、AI、undo；快照 + 增量日志恢复；认证、速率限制、payload 上限、Origin 校验和 WSS。
- 持久化承诺：ACK 之前事务须写入 WAL 并完成约定的 durable flush；启动先校验快照 hash，再重放 WAL；周期快照采用临时文件 + 原子替换；损坏时备份恢复并报告，不静默清空。
- session credential 短期、一次性兑换、可撤销、最小权限；日志脱敏；连接只监听必要接口，MCP loopback only。
- DoD：两个客户端同格竞争、重复 seq/rev、乱序包、掉包/断网/重连、服务重启、WAL 截断/快照损坏的确定性测试通过；ACK 过的状态重启后不丢；非 ACK 状态允许中断但须如实告知。

### M4：手机 AR 建造 UX（Android/客户端）

- 将 AR provider 能力和生命周期显式建模：unsupported/permission-denied/session-paused/tracking-lost/relocalizing/running/ended；anchor 与世界 transform 有稳定类型，不用 `unknown`。
- 按屏幕点击到 hit-test/raycast，再按 WorldSpec 将命中转换到格坐标；离屏/无 plane/低 tracking confidence 不可提交。
- 提供岛放置、确认/移动/重置、放置/拆除、物品栏、网络/AR 状态条、连接重试和用户可理解的拒绝信息。
- DoD：权限拒绝后可重试；session pause/resume 恢复；重定位后世界不跳变；一百次交替放置/拆除后服务端和画面一致；断线时禁止误报已保存。

### M5：大肥鱼 AI 共建（DSH/AI/服务端/角色）

- DSH 只经 `world_observe/build_plan/build_commit/build_cancel/world_undo/companion_say` 受限调用；`build_commit` 必须携带 worldd 签发、一次性、session/plan/hash/baseRev 绑定的 `approvalId`；只有玩家 UI 的明确确认路径可以请求签发。prompt 把世界聊天、方块标签和用户结构名作为不可信数据，不允许内容越权改系统规则。
- AI 构建默认只占空格；预览必须显示占格、冲突和材料，用户确认后才能提交；目标大于配置上限或触及玩家改动即拒绝/重计划。
- 角色行为由服务端事件驱动有限状态（idle/walk/build/talk）；位置由客户端插值，AI 不能任意 teleport；对话按长度/频率限速。无需模型动画片段时用程序化站立/行走/建造动作，不把无动画 VRM 当已有动画。
- DoD：20 个固定 build 请求中 ≥90% 生成合法 plan；不存在未确认 commit；计划过期/玩家同格修改时拒绝并可重计划；Mock AI 可在不调用真实模型情况下跑完整流程；实际 LLM 的延迟单独报告，不承诺固定秒数。

### M6：视觉资产、性能与发行候选（视觉/资产/QA）

- 角色运行时规格（身高、骨骼、贴图、动画）由一次授权模型实测定版，不将不同模型报告的 1.2 格/2.4 头身/材质数量混为规范。给 3D 角色配置简化模式和加载失败回退。
- 建立资产台账：文件、作者、来源 URL、取得日期/版本/hash、许可原文、可否修改/商用/再分发、署名、适用 build channel；CI 对 unknown/NC/非许可模型 fail closed。
- 发布版不得包含未清权的效果图、BlueFatFish 模型或 dsh-game CC BY-NC-SA 动画；CC BY-NC-SA 内容不得进入商业/广告/收费构建。需法务/资产负责人确认公开仓库现存图像的再分发依据，不能只靠 README 声明“仅参考”。
- Android 中档设备连续运行 10 分钟；测帧时间 p50/p95、长帧、内存、热降频、首屏/模型加载；先测再调预算，不把 PC headless 数字当手机实测。
- DoD：第三方告知、数据流图、安装/配对/关闭服务/备份恢复/卸载说明完成；依赖 notice、SBOM、secret scan、许可 scan、升级迁移与回滚 smoke test 可重复。

### 后续阶段（不阻塞 Android v0）

1. iOS：先核实 WebXR 不支持下的可用 AR SDK、SLAM binary 许可/分发与维护状态，再独立做设备 spike；未过门时明确“暂不支持稳定 6DoF AR”，不以 photo 3DOF 假称兼容。
2. Windows 独立桌宠窗：作为单独客户端和交互需求立项，不和 Android AR UI 共用一个 MVP 验收。
3. 真实 Minecraft 联动：另立 v2 项目，评估 Numen/协议 bot/客户端 mod，明确真实游戏版本、正版/联机与权限；当前自建 voxel authority 不等于 Minecraft server。

## 6. 客观验收矩阵（目标值为工程门槛，M0 后可依据实测调整）

| 领域 | 测试条件 | 建议初始门槛 |
|---|---|---|
| AR 锚定 | 两个不同档次的 ARCore Android；固定桌面标尺；建立 anchor 后沿 1 m 方形路线移动、重复 10 次 | 5 分钟内相对标尺漂移 p95 ≤3 cm，最大跳变 ≤5 cm；记录 raw 值，未达则标为已知不稳定而非通过 |
| 帧率/热 | 最低支持机型，WebXR 场景含 3D 角色/阴影，连续 10 分钟 | 稳态 p95 帧时间 ≤33 ms；记录热态、内存、掉帧；不得只报告平均 fps |
| 输入/同步 | Wi-Fi LAN，100 次 place/break、两客户端同格冲突、断网 30 秒恢复 | accepted 事务服务端和客户端最终一致；不重复应用 rev；accepted 数据重启保留；普通交互 p95 权威确认 ≤200 ms（本地 ghost 首帧 ≤100 ms） |
| AI 计划 | 固定 20 条中文请求，模型版本/温度/世界 seed 固定 | ≥18 条返回 schema 合法且越界/冲突均被拒绝；未确认 commit = 0；LLM 耗时另记 p50/p95 |
| 安全 | 错误/过期 credential、恶意 origin、大 payload、越界坐标、非法方块、prompt injection 文本 | 均在服务端拒绝；无写入/凭证日志；服务进程不崩溃 |
| 许可/隐私 | 对发布目录和运行数据作清单扫描 | 发布物无 unknown/未授权素材；相机帧只留客户端，不上传；摄像头/模型传输/DSH 外部模型请求的数据流告知可见 |

上述阈值是项目建议，不是当前实现成绩。自动化测量脚本、设备型号/系统/浏览器版本和原始日志需随验收结果提交。

**当前研发状态（2026-11-16）：**Node/TypeScript workspace 的 clean install、严格类型检查、30 个单元测试和本机 Chrome 桌面交互 smoke 已通过；PC 沙盒支持放置/拆除、AI-style 本地 proposal 预览/确认。Android WebXR/marker provider 仍只有纯类型/状态门控，没有原生或 WebXR 集成；当前环境未安装 Android SDK/Gradle，也没有 APK；LAN/TLS/WSS、持久化、实际 DSH/MCP 与角色资产均未完成。Samsung Tab S8 未启用 ADB，本轮尚未对平板实测。

## 7. 交付与协作约定

- 每个模块有负责人、PR、测试结果和复现说明；协议/schema 变更要同 PR 更新 client/worldd/DSH adapter 与 migration test。
- 架构决策采用 ADR，记录状态：`proposed / accepted / superseded`。把推断、待验证、实测明确区分。
- 所有代码依赖锁定版本；参考源码固定 upstream commit/hash，MIT notice 保留；被 `.gitignore` 排除的 `refsrc/` 不能作为唯一交接来源。
- PR 必须跑真实 `typecheck/test/build`；性能数据必须标设备和测试条件。fresh clone 不可重复构建视为阻断。
- 时间估算目前不足以承诺日历日期。M0/M1 先测安全上下文、设备 AR 与同步风险，再按模块负责人和实测吞吐量排期；正式角色制作、许可清理、iOS SLAM 可单独影响总周期。

## 8. 风险与发布阻断

| 级别 | 风险 | 处理/门禁 |
|---|---|---|
| P0 | Android 手机对 LAN HTTPS/WSS 的易用性无可靠现成结论 | M0 实机验证配对/TLS；未定前不发“零安装零配置”承诺 |
| P0 | 共享坐标/协议与旧文档矛盾 | 先落 schema/ADR/test，再并行写模块 |
| P0 | AI 覆盖/清除玩家建筑或 prompt injection | 原子 plan-confirm-commit；allowlist；无 arbitrary code；负向安全测试 |
| P0 | token query/明文 WS/MCP 暴露 | WSS、一次性最小权限凭证、loopback MCP、脱敏日志、Origin/限速 |
| P0 | 效果图公开仓库分发权、角色/动画素材许可链不完整 | 发行前权利人/许可文件逐资产确认；清不掉权就不进 release 包，公开仓库图像需另行处理 |
| P0 | DSH 对话/动作可能发送到外部模型提供方 | 数据流告知、明确用户配置的模型边界、默认不保留 journal/摄像头帧 |
| P1 | iOS WebXR 不支持且 8th Wall binary 能力/许可报告冲突 | iOS 另开 gate，未核实不承诺 |
| P1 | 当前静态 PC preview 被误读为真机 AR/系统完成 | 公开标记“仅静态 M0”；每个能力以测试记录为准 |
| P1 | VRM 性能、贴图体积与商用权不能从一个模型外推 | 目标设备和最终授权资产锁定后实测 |

## 9. 对旧文档的处置

- [DEV.md](DEV.md) 是历史技术草案，不再是并行契约；实现时以本文的数据模型、工具表、阶段和验收为准。
- [PLAN.md](../PLAN.md) 是调研问题清单，完成产品决策后不再作为产品范围依据。
- [REPORT.md](../REPORT.md) 与 `reports/` 保存调查素材/来源。其星数、平台能力、性能、许可和成本均须按采样日期/证据重验，不将摘要直接作为发行承诺。
- 产品定义确认为真实桌面 AR，但不代表所有先前写入的 AR SDK、视觉规格、3D 模型或时间估算也被确认。
