# ADR-0001：共享体素世界 Schema 与事务 v1

- 状态：accepted（技术基线；实现仍需持续 review）
- 日期：2026-11-16
- 来源：[实施方案 §4](IMPLEMENTATION-PLAN.md#4-唯一基础数据与协议规范v1-已按-adr-0001-锁定运行时契约分阶段补全)与本次研发执行期间的工程默认值

## 决策

- 逻辑世界域为 16×16×16，原点 `(-8, 0, -8)`，每格映射 3 cm；合法坐标均为半开区间。
- 稠密存储顺序为 x 最快、z 次之、y 最慢；稳定方块 ID 使用代码定义的字符串 allowlist。正式角色/材质资源不属于本 ADR。
- 种子岛 footprint 为 `[-7,7) × [-7,7)`，地面占用 `y=[0,1)`（单层草方块），所有柱体连续到底；初版固定材质层。
- 建造与拆除的业务操作只能作用于 `y>=4`；初始地形受保护。AI 只放置空格、不拆除；玩家可拆除建造区方块。服务端以后仍须以 session 确定 actor，禁止信任客户端自报权限。
- 事务采用严格 `baseRev === currentRev`；全量校验通过后才原子应用。同一事务最多 256 格、禁止重复目标格；操作 canonical 输出按线性 index 升序。成功事务恰好递增一个 revision；拆除需要 expected block。
- 当前方块 ID 使用 `grass/dirt/stone/planks/log/leaves/sand/glass`，未知 ID 在协议与快照处 fail closed。ID 未来扩展必须同步更新 schema 与资源目录。
- intent frame 上限 16 KiB、server commit frame 上限 512 KiB；提交消息最多 256 操作。
- 快照显式携带 `schemaVersion=1`；未知版本、非法/稀疏 cell array 和未知方块必须拒绝，不做静默迁移。

## 后果与边界

- 本 ADR 仅锁定可自动测试的纯数据核心，不声称 LAN 服务、存档 durability、ARCore/WebXR 或 DSH 已完成。
- `WorldAuthority` 当前是单进程内存协调原型；真实并发队列、client credential、WAL durable flush、快照原子替换、限流、Origin、重连与消息广播仍属于 M3 服务实现门槛。
- 收到 ACK 不代表客户端已应用 commit；只有连续 revision 的 commit 更新 replica，revision 缺口触发 resync。
- 当前 MCP plan/approval、撤销授权及完整协议消息集合未实现，属于后续 M3/M5 工作。
- 区块分块、地形美术、正式模型许可和艺术方向不由本 ADR 决定。
