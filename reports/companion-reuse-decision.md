# Companion 复用决策记录

> **用途**：供主 Agent review；本文件未提交。
>
> **证据截止日**：2026-11-16（北京时间）。本记录使用该日期的仓库调查快照，不把快照中的版本、星标、发布物或许可证描述当作今日状态。
>
> **决策状态**：建议采纳；待逐项许可证与依赖审核后进入实现。

## 1. 决策摘要

**不直接采用任何一个候选作为本项目的 Companion runtime、MC 身体、Mod、启动器或依赖。** 推荐方案是：

> **自建受限 Companion runtime + 只复用已核实的架构模式。**

当前项目的目标不是把 AI 接入真实 Java Minecraft 服务器，而是在真实物理桌面上呈现一个 MC 风格的有限体素世界，玩家与一个大肥鱼 AI 在同一世界中建造。候选项目主要面向 Java Minecraft 客户端/服务器、mineflayer bot 或游戏 Mod；目标世界、权限边界和持久化模型均不相同。因此本次决策不做 fork，不复制候选源码、素材、角色卡、提示词、二进制发布包或未经审计的依赖。

实现边界如下：

- **v0**：单本地用户、单世界、单个 AI companion instance、一个经用户确认的 AI home plot。
- **worldd 是唯一世界权威和写入口**：AI 只能产生 schema 化 observe/plan/intent；所有提交由 worldd 做范围、权限、预算、冲突、`baseRev/hash/TTL` 和 approval 校验后原子执行。
- **DSH adapter 只保留受限接口**：`world_observe`、`build_plan`、`build_commit`、`build_cancel`、`world_undo`、`companion_say`；不得把模型、persona 或客户端变成世界写权限持有者。
- **未来接口只保留契约，不启用运行时功能**：`PersonaCard`、多 companion、`VisitInvitation/VisitEvent` 等只进入 versioned schema/拒绝未知版本测试；v0 不做账号、好友、跨用户访问、互访 UI、消息投递或公网服务。

依据：当前实施计划明确 v0 为 AR 桌面微缩世界、单用户单 AI，且“worldd 是唯一写入口”；`companion-runtime` 只产生受限意图，所有 world writes 经 worldd；未来 visit namespace 在 v0 必须 feature-disabled。[实施计划](../docs/IMPLEMENTATION-PLAN.md) §1–5、M3/M5；[ADR-0002](../docs/ADR-0002-companion-extensibility.md)。

## 2. 候选比较（截至 2026-11-16 快照）

| 候选 | 公共 GitHub | 许可证证据边界 | 目标世界/运行形态 | 可复用的架构模式 | 明确不复用/本次结论 |
|---|---|---|---|---|---|
| **luckui/dsh-game** | [github.com/luckui/dsh-game](https://github.com/luckui/dsh-game) | 报告 B 记录代码为 MIT；API 曾报 `NOASSERTION`，且大肥鱼动画单独标为 **CC BY-NC-SA 4.0**。代码与素材不能按一个许可证处理。 | DSH 插件 + mineflayer 子进程，连接真实 Java MC 服务器；另起真实客户端作摄像机/旁观窗口。`solo` 已实现，`duo`/跟随主人仍是下一阶段。 | **宿主/身体进程隔离**、IPC 超时与 watchdog、事件驱动时刻、长动作后台队列、紧急动作抢占、硬编码技能与模型规划分工、高层动作词表。 | 不复用 Mineflayer 身体、RCON、摄像机/HUD、清除或覆盖语义、角色动画、TTS、提示词或任何未逐文件审计的代码。结论：**最有价值的架构参考，不作为底座或依赖**。 |
| **Dwinovo/minecraft-numen** | [github.com/Dwinovo/minecraft-numen](https://github.com/Dwinovo/minecraft-numen) | 调查报告记录代码为 **LGPL-3.0**；截图/架构图与美术存在单独或保留权利边界，不能只看仓库主许可证。 | 双端 Java MC Mod；游戏中是真实玩家实体；可通过本机 streamable HTTP MCP、Bearer token 和同伴权限驱动，面向真实 MC 联机世界。 | **外部大脑与游戏实体解耦**、显式 token/角色权限、事件长轮询、人在回路的 consent、审计/限流、批量动作编排的接口思想。 | 不引入 Java Mod、Lua 执行、`eval`、MCP 服务端、Bearer/token 语义或真实 MC 玩家实体；本项目的结构 DSL 必须是受限 allowlist，禁止 Lua/JS/eval/RCON。结论：**参考授权与外脑边界，不作为运行时**。 |
| **mindcraft-bots/mindcraft** | [github.com/mindcraft-bots/mindcraft](https://github.com/mindcraft-bots/mindcraft) | 调查报告记录仓库为 **MIT**，但当前版本/依赖及下游 fork 关系仍应以固定 commit 和许可证文件复核。 | Node + mineflayer 的 LLM bot，可进入真实 Java MC 服务器；支持 bot profile、技能/记忆和多 agent 组合；不是本项目的 AR 世界。 | **profile/persona/model 槽位**、技能注册、任务编排、长期运行的 agent loop，以及把模型能力与游戏动作层分开的组织方式。 | 不复用其可执行技能/动态代码路径、`allow_insecure_coding` 类能力、bot 身体、真实 MC 认证/服务器连接、其 profile/提示词和模型供应商适配。结论：**只参考模块化和技能组织**。 |
| **yzi1b/whale-craft** | [github.com/yzi1b/whale-craft](https://github.com/yzi1b/whale-craft) | 证据冲突：报告 D 表格标为 **MIT**，报告 A 对其许可证标为“未取到”。在读取仓库 LICENSE/固定 commit 前，**不得宣称许可证已确认**。 | DSH 内运行的无头 mineflayer bot；报告记录已发布 npm、含 MC/MC+ preset、watchdog、记忆和凭据隔离；目标仍是真实 MC 世界。 | **最小权限 preset**、每会话独立 bot、watchdog/唤醒/打断、凭据不暴露给模型、记忆目录隔离。 | 不安装 npm 包、不复制其代码/记忆格式/凭据实现，不把 MC/MC+ 权限模式直接当作本项目的 world capability；本项目只借鉴“权限分层 + watchdog”原则。结论：**架构模式可参考，但许可证未闭环，暂不复用实现**。 |
| **Yoshino-JF/dafeiyu-mc** | [github.com/Yoshino-JF/dafeiyu-mc](https://github.com/Yoshino-JF/dafeiyu-mc) | 报告 B 将其与 Mindcraft 一并列为 MIT，但未证明下游仓库自身许可证、上游继承范围或所附资产/二进制的许可链；**不能把 MIT 作为该仓库当前已核实结论**。 | Mindcraft 衍生的“大肥鱼”bot + 桌面启动器；调查快照记录其随附 Paper/Java 运行环境、MC 26.1.2、记忆/技能文档和少量 release 下载。 | **启动器/子进程编排**、安装验收文档、记忆 schema、说过/做过指标和运行日志的可追踪思路。 | 不复用启动器、457 MB 发布包、随附 Paper/Java、角色资产、模型配置、记忆/提示词或未固定的下游 fork 代码。结论：**只看文档化与可观测性模式**。 |

### 2.1 横向判断

1. **目标世界不一致**：五个候选都以真实 Java MC 的 server/client/mod/bot 为中心；本项目 v0 是自建、有限、确定性的 AR 体素世界。直接接入其身体层会把 MC 的生存、实体、认证、tick、RCON 或 Mod 版本复杂度带入产品范围。
2. **“陪玩”不能等同于“AI 会玩 MC”**：`dsh-game` 的证据明确显示其产品定位更接近“AI 自己玩、用户旁观”；Numen 更接近真实 MC 中的第二个玩家；Mindcraft/whale-craft 是 bot agent 框架；`dafeiyu-mc` 主要是下游包装。它们都不能替代本项目的 AR 共建、home plot、事务审批和 worldd 权威。
3. **许可证不是星标或 README 的推论**：候选中至少 `whale-craft` 存在报告间许可证冲突，`dafeiyu-mc` 的下游继承边界未闭环，`dsh-game` 代码与动画素材是不同许可。任何“可直接复制”的结论都应暂停。

证据汇总来自：[报告 B：大肥鱼专题](report-b-dafeiyu.md) §1、§2、§4–§6；[报告 D：DSH 游戏生态](report-d-dsh-ecosystem.md) §1、§2、§5；[桌面 MC 调查报告](report-a-desktop-mc.md) §3.1.2、§3.1.7、§3.1.9；以及 [DSH 能力核查](dsh-capability-notes.md) §4–§5（DSH MCP 接入条件与 `dsh-game` 特征）。各调查均注明采样时间为 2026-11-16；未取到或冲突处在本记录中保留不确定性。

## 3. 只复用的架构模式

下列内容可以作为自建实现的设计输入，但不是代码导入清单：

- **受限工具面**：借鉴 `dsh-game` 的少量高层操作和 Numen 的外脑边界；本项目仍只暴露 schema 化 observe/plan/commit/cancel/undo/say。
- **事件驱动 Companion loop**：借鉴 `dsh-game` 的事件唤醒、长动作队列和紧急打断，以及 `whale-craft` 的 watchdog；运行时产出 `companion_intent`，不直接写 worldd。
- **分层安全**：借鉴 whale-craft 的权限 preset 与凭据隔离、Numen 的显式授权/consent；在本项目中落为 `owner + companion + plot + capability + budget + approval`，最终决策只能由 worldd 执行。
- **计划与执行分离**：借鉴 Mindcraft/dsh-game 的 profile、技能和规划分工，但把 AI 计划编译为有限 DSL（`box/line/wall/floor` 等经测试原语），材料来自 allowlist，所有操作 `put-to-empty` 或进入人工确认路径。
- **可追踪运行**：借鉴 `dafeiyu-mc` 的验收文档、memory schema、说过/做过指标和日志思路；本项目以 worldd revision、plan hash、审计事件、WAL/快照和可复现 mock AI 为准。

## 4. 明确不复用清单

以下能力即使在候选中存在，也不进入 v0：

- Mineflayer bot、Java/Fabric/Forge/NeoForge Mod、真实 MC server/client、Paper/Java bundled runtime、RCON、spectator 摄像机、OBS/直播管线。
- 任意 Lua、JS、shell、`eval`、动态技能代码、上游图纸脚本或可执行模型输出。
- 将 AI 权限放在 persona、prompt、客户端字段、MCP token 或“当前唯一 companion”全局单例中。
- 候选仓库的角色/IP/动画/贴图/视频、默认人设、提示词、音色、TTS/ASR 和未核实第三方素材。特别是报告记录的“大肥鱼”动画为 CC BY-NC-SA 4.0；本项目发行资产必须另建权利链。
- 将真实 MC 的清除、覆盖、掉落、生存、战斗、实体或多玩家语义映射为本项目的 world mutation。
- 把候选的 release/npm 包、锁文件或“当前最新版”直接放入本仓库。当前实现计划要求依赖和参考源码固定版本/commit，并有 SBOM、notice、secret scan、license scan 和迁移/回滚 smoke test。

## 5. v0 运行时决策

```text
DSH（受限 adapter）
  └─ observe / plan / say / cancel / undo
      └─ companion-runtime（单一 companion instance）
          └─ 结构化 intent / build plan
              └─ worldd（唯一权威、唯一 world write entry）
                  ├─ bounds / owner / home plot / allowlist
                  ├─ baseRev + canonical hash + TTL + budget
                  ├─ approval / conflict / idempotency
                  └─ atomic commit + revision + audit/WAL
Android AR client
  └─ 只渲染 replica、发送玩家输入、显示预览/确认；不能绕过 worldd
```

- 初始家园选址必须由 AI 提案、用户确认后由 worldd 签发 grant。
- home plot 内安全计划仅限占用空格、allowlist 材料、预算/限频/TTL/baseRev/hash 合法；越界、覆盖、拆除、触及玩家建筑或共享区必须人工确认。
- AI 可主动 observe、提出小目标和汇报进度，但主动性不等于写权限；暂停、撤销和条件 undo 由 worldd 控制。
- v0 不实现真实 Minecraft 的合成/战斗/生存规则，不实现实时多人联机，不实现语音，不实现跨用户异步互访，不上传游戏截图给模型。

依据：[实施计划](../docs/IMPLEMENTATION-PLAN.md) §2、§3、§4.3、M3、M5；[ADR-0001](../docs/ADR-0001-world-schema.md)；[ADR-0002](../docs/ADR-0002-companion-extensibility.md)。

## 6. 未来接口：保留但不启用

数据模型可从一开始携带稳定的 `userId`、`companionId`、`personaCardId/version`、`homePlotId` 和 `worldId`，以避免未来迁移依赖全局单例；但 v0 只 seed 一个本地 companion。

可保留的接口边界：

- `PersonaCard`：只影响人设/表达风格，不授予工具、文件、网络或 world commit 权限。
- 多 companion：未来可各自拥有 persona/home/state/budget；v0 不展示、不运行、不提供选择 UI。
- `VisitInvitation/VisitEvent`：仅保留 versioned、邀请驱动、短期、可撤销、只读/问候范围的 schema；v0 server 对所有 network-origin visit 请求 fail closed。

不得提前实现的内容：账号、好友图、跨用户 relay、公网 world token、远程写权限、异步消息投递、跨世界长期 memory 或任何把 visit ticket 转成 `build_commit` 的路径。若将来允许客 companion 建造，必须重新设计产品授权 UI、HomePlot/approval 流程并另立 ADR。[ADR-0002](../docs/ADR-0002-companion-extensibility.md) §3 已明确该边界。

## 7. 进入实现前的审计门

在任何第三方代码、依赖或资产进入仓库前，必须：

1. 固定具体 upstream commit/tag；记录获取日期、URL、SHA-256 和变更范围。
2. 逐文件确认许可证、NOTICE、素材/模型/动画/字体和上游继承关系；对冲突或 `NOASSERTION` 采取 fail-closed。
3. 生成依赖清单与 SBOM，执行许可证扫描、secret scan，并保留必要 notice。
4. 对二进制 release、npm 包和下游 fork 单独核实其源码、构建输入、第三方依赖和可再分发权，不以 README、星标、下载量或上游许可证推定可用。
5. 通过 worldd 侧负向测试：prompt injection、越界 plot、覆盖玩家方块、伪造 approval、过期 plan、revision 冲突、重复提交和断线恢复。

**最终决策**：候选项目用于验证“怎样隔离身体、怎样唤醒/打断、怎样分离计划与执行、怎样做权限和证据记录”；本仓库不直接复用其运行时代码。第一实现目标是一个可审计、受限、单用户单 AI 的 Companion runtime，所有世界权威由 worldd 执行，未来扩展接口只留契约且保持关闭。
