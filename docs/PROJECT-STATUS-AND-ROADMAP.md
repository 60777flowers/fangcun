# 方寸项目阶段总结与后续路线图

> 更新日期：2026-11-17（Asia/Shanghai）
> 当前分支：`feat/companion-extensibility`
> 最近推送提交：`058a415`（`feat: wire safe companion home demo and Android AR POC`）
> 本文是交接摘要；产品范围和细分验收以 [实施计划](IMPLEMENTATION-PLAN.md)、[Android 交付记录](ANDROID-DELIVERY.md) 与 ADR 为准。
>
> **2026-11-17 技术路线更新：**客户端已改为**原生 Kotlin + SceneView/Filament + ARCore + glTF**（见 [ADR-0003](ADR-0003-android-client-and-ar-stack.md)）；完整后续执行计划见 [TECH-ROADMAP](TECH-ROADMAP.md)，接口见 [HOST-API](HOST-API.md)/[DSL-SPEC](DSL-SPEC.md)，设备验证见 [DEVICE-TEST-PLAN](DEVICE-TEST-PLAN.md)。下文“阶段 C”已按新路线改写；历史 WebXR/WebView 假设仅保留在旧文档中，不再作为实现依据。

## 1. 项目目标

方寸不是 Minecraft 画面投影，也不是接入真实 Minecraft 服务器。目标是在真实桌面上呈现一个有限体素微缩世界：Android 是摄像头 AR 与交互端，PC Host/worldd 持有权威世界状态，用户与一个主动的大肥鱼 AI 桌宠共建。

v0 产品边界已经明确：

- 一个本地用户、一个世界、一个 AI companion、一片经用户批准的 AI home plot。
- AI 可以主动观察并提出自己的家园位置；用户批准后，AI 可在该 plot 内自主放置方块装饰。
- 自动施工仅限空格、allowlist 方块、plot 内、有预算及有效 world revision/hash/TTL 的小型计划。
- 不允许 AI 拆除/覆盖占用方块，或修改玩家/共享区域。越界/高风险建造需要预览和用户明确批准。
- 未来 persona card、多 AI、异步跨用户串门只保留版本化 schema，不在 v0 启用。

## 2. 当前架构

```text
Android AR client (POC only today)
  camera / plane hit-test / anchor / render
             │  尚未接产品协议与 LAN
             ▼
PC Host / worldd (当前只有内存权威原型)
  owner + companion + home grant
  candidate -> owner approval -> plan -> eligibility -> atomic commit
             │
             └── companion-runtime (纯逻辑、受限意图与计划)

DSH adapter / MCP tools / persistence / WSS：尚未接通
```

可信写入口只能是 worldd；模型输出和 persona 文本不是授权。候选项目调查结论为自建受限 runtime，只复用 watchdog、attention、计划/执行分层等架构模式，不复用 Minecraft bot 身体层或未经审计的素材。详情见 [Companion 复用决策](../reports/companion-reuse-decision.md)。

## 3. 已完成并验证

### 基础体素与协议

- `WorldSpec v1`：16³、有界坐标、3 cm/voxel、地形与建造高度分离、稳定 block allowlist。
- 确定性岛屿生成、坐标索引、快照验证、原子 place/break transaction。
- 有界协议消息、严格 validator、JSON frame codec、replica 按序应用 commit。
- 桌面模拟器支持选择格子、放置/拆除、预览结构和确认事务；该模拟器仍使用浏览器内本地 world，不是服务端同步客户端。

### Companion 与 worldd 原型

- schema：`PersonaCard`、`CompanionInstance`、`HomePlotGrant`、future visit contracts。
- Companion runtime：确定性 home 候选、空地/边界检查、canonical plan、SHA-256 diff、TTL、预算、tracking 与 autonomy preflight。
- Autonomy reducer：observe、提出 home、等待用户审批、plan、commit、pause/cancel/tracking loss；reducer 不直接写 world。
- 内存版 `WorldAuthority`：owner/companion binding、候选审批、grant、撤销、限频/UTC 日预算、异步 hash 期间对 revoke/world edit 的并发复核、AI 原子提交。
- `runCompanionTick` 和 `npm run demo:companion`：可以实际跑完“AI 提议候选 → 用户批准 → Companion tick → 12 个 starter-home 方块由 worldd commit，revision 0→1”。每次 demo 都创建全新内存世界。

### Android ARCore POC

- 单独原生工程 `apps/android-ar-poc` 已用 Android SDK platform 35、build-tools 35、Gradle 8.13 构建。
- Samsung Galaxy Tab S8 Wi-Fi（SM-X800、Android 16/API 36、Adreno 730、GLES 3.2）通过 USB ADB 安装并实测。
- 真机已确认相机背景、水平面命中、anchor 建立、绿色测试立方体绘制；用户反馈移动平板时显示稳定。
- 修复了 GL surface 初始化前创建 shader 的崩溃、相机 UV buffer 未逐帧复位、暂停/丢追踪后残留触摸延迟重放、测试方块相对 anchor 的偏移。
- 已知问题：当前没有真实物体遮挡合成，遮挡期间方块仍显示在前景；短暂遮挡后用户观察到轻微位移，目前可接受。该 POC 没有连接 voxel world、worldd、AI、Host/WSS。
- 完整设备/build/hash 记录与后续事项见 [ANDROID-DELIVERY.md](ANDROID-DELIVERY.md) 和 [AR-POC-FOLLOWUPS.md](AR-POC-FOLLOWUPS.md)。

### 验证记录

最近一次验证：

- `npm run typecheck`：通过。
- `npm test`：76/76 通过，包含 grant revoke 和并发编辑竞态测试、Companion home tick 闭环测试。
- `npm run test:simulator`：通过，place/break/preview/explicit commit smoke 无 browser error。
- `npm run demo:companion`：输入确认后输出 12-block AI commit at revision 1，seeded world 变为 208 blocks。
- Android Gradle `assembleDebug`：通过；测试 POC 已安装在 Tab S8。

## 4. 到最终产品还差什么

### P0：把单机逻辑变成可连接的产品闭环

- 实际产品客户端：从 Android 画面选 voxel grid、显示 world/AR 状态、做 placement preview、确认/取消。
- Host 服务：只监听 loopback/LAN 所需接口，提供经过审计的 session auth、配对、TLS/WSS、Origin 校验、速率和 payload 上限。
- Android/桌面客户端 ↔ worldd：welcome snapshot、intent、ack、commit 广播、resync；确认两个端显示同一权威 revision。
- 把原生 ARCore pose/plane hit transform 接入 `WorldSpec` 与正式体素 renderer；POC 目前只放单色 cube，不是岛屿/方块客户端。
- 明确 ADB 外的用户分发方式、签名/更新和数据清理说明；当前只有 debug APK。

### P1：服务端可靠性与安全边界

- worldd 快照/WAL、durable flush、启动恢复、备份、迁移和 corrupt-state fail-safe。
- 将 demo 中构造器传入的 owner/issuer seed 替换为真实可信 Host/session 边界；限制 grant issue/revoke、审批、撤销及多连接并发。
- 让 plan/approval 审计记录与 world commit 一致持久化；实现条件 undo、用户暂停/撤销 UI、错误恢复。
- 两个客户端竞争、重连、断网、重启、序号重放、预算边界、prompt injection 和未授权 owner 全链路测试。

### P2：把 Companion 接入 DSH 并完成可观察的共建

- 实际接入 DSH 的受限 tool adapter；MCP 仅 loopback/stdio，未经检查不假定 DSH 的工具协议兼容。
- tools 只提供 observe/plan/commit/cancel/undo/say 的有限 schema；拒绝任意代码、shell/eval、RCON、Mineflayer 或模型自签 approval。
- 从一次性 starter plan 扩到受限 DSL/结构原语、反复自主小目标、attention/watchdog、取消/重计划、进度气泡和安全 undo。
- 角色渲染/动画/动作状态、模型来源许可及 fallback；当前没有实际大肥鱼模型或动画运行时。
- 固定 mock AI 请求集与安全拒绝验收，再单独测真实模型延迟、隐私和数据流。

### P3：设备、性能与发行质量

- 第二台不同档 ARCore 设备矩阵、重复 anchor 路径漂移量化、landscape/rotation/camera crop、暂停恢复、长时间热态/内存/帧时间。
- 评估真实遮挡：ARCore Depth API 的设备覆盖与稳定度，或明确把无遮挡作为 v0 已知限制；不能误导成已有能力。
- 独立评估非 ARCore 打印 fiducial marker 路线及许可证、打印尺寸、遮挡恢复与功耗；当前没有 marker provider。
- 正式素材许可链、SBOM、依赖 license/secret scan、相机与外部模型数据流告知、签名 release 与升级/卸载测试。
- 达到两个设备和稳定同步门槛后再讨论公开 beta；Tab S8 一台设备 smoke 不是普遍兼容性验收。

## 5. 建议后续路线

### 阶段 A：统一可演示的 PC Host 核心

1. 为 worldd 加 Host adapter 和本地 snapshot/intent/commit API，先使用 loopback 和一份稳定协议。
2. 将现有桌面 simulator 增加 `local-demo` 与 `host-connected` 模式；connected mode 的每次玩家提交及 companion commit 都来自 worldd ack/commit，而不是浏览器本地 `applyTransaction`。
3. 在 UI 加 Companion home proposal/批准/暂停状态，让同一世界 revision 可见；先完成桌面端交互和重连。

### 阶段 B：DSH Adapter

1. 检查目标 DSH 版本和实际 MCP 接口，做 capability/timeout/cancel POC。
2. 实现最少权限 tools 和纯 mock agent end-to-end。
3. 再让 mock loop 换成 DSH 实例；所有 commit 仍由 worldd 校验。

### 阶段 C：Android 原生客户端联调

1. 新建 `apps/android-client`（Kotlin/Compose + SceneView/Filament）：ARCore 会话、体素 `MeshNode`、glTF 角色、射线选格、ghost 与 worldd WSS。POC 的 ARCore 会话/锚定经验沿用，渲染代码不复用。
2. 对齐 PC Host、PC 检视页与 Android replica 的 welcome/ack/commit/resync；手机与 PC 必须显示同一 `rev`。
3. 真机完成 place/break/companion commit/撤销/掉线恢复闭环；POC 的 shader 初始化与 hit-test 修复不等于这一步已完成。

### 阶段 D：持久化、安全、发行与扩展

- 达到 WAL/recovery、权限撤销/undo、安全测试和设备性能门槛后，再做签名 APK/release。
- persona cards、多 companion、异步访问保持 feature-disabled，除非另立产品决策与 ADR。

## 6. 当前风险/明确不承诺

- worldd 当前数据结构、budget、grants 都在内存；进程重启会丢，不得用于真实多人或公网。
- Companion demo 的 owner identity 由本地脚本预置；生产 app 必须由 Host/session 认证后注入，不能信任客户端传来的 userId。
- Android APK 是 ARCore renderer POC，不是方寸客户端，也不包含网络、世界 replica、AI 或大肥鱼角色。
- DSH/MCP 未集成；“AI 可规划/自动建造”目前只在单机确定性 mock/本地 runtime 路径有实现证据。
- 未确认第二设备兼容性、定量 tracking drift、深度遮挡、marker fallback、WAL recovery、release 签名或公开 beta。
- 工作区可能有用户本地目录 `dsh-neutral-mode/`，它不属于本总结所记录的提交内容；保留原样。

## 7. 常用命令

```powershell
npm run typecheck
npm test
npm run test:simulator
npm run demo:companion
$env:ANDROID_HOME='D:\Android\Sdk'
$env:ANDROID_SDK_ROOT='D:\Android\Sdk'
& 'D:\Android\gradle-8.13\bin\gradle.bat' --no-daemon -p apps/android-ar-poc assembleDebug
```
