# ADR-0002：单桌宠 v0 与多 companion / 异步访问扩展边界

- 状态：accepted（范围与接口方向；schema/runtime 尚未实现）
- 日期：2026-11-16
- 来源：[IMPLEMENTATION-PLAN.md §1–2、§4–5](IMPLEMENTATION-PLAN.md)

## 用户决策

- v0 的真实运行形态保持**单用户 + 单 AI 桌宠 + 一个用户授权的 AI home plot**。
- AI 有桌宠式主动性：会观察世界并提出自己想做的安全小目标；用户批准其 home plot 选址/grant 后，AI 可在该 plot 里自动放置空格块、经营/装饰自己的家。
- 人格卡、多 AI、异步串门是未来扩展需求，本次只留数据/接口边界和隔离原则；v0 不做相应 UI、账号、好友系统或跨用户网络服务。

## 稳定身份与数据边界

未来 schema 使用不可变 ID，禁止把“当前唯一 AI”写成权限特判：

- `UserId`：归属本地 profile/未来账号；v0 可用本地固定 owner ID。
- `CompanionId`：AI 实例身份，不等同 `PersonaCardId`。
- `PersonaCardId + version`：人设/语言/表达风格的受信本地配置；内容只影响输出风格，不携带 tool grants、shell、文件、网络或 commit 权限。
- `HomePlotId + worldId + ownerUserId + companionId`：授权绑定；保存合法坐标 AABB/格集合、允许的 block allowlist、单笔/每日预算、expires/revoked state 和审计 rev。
- `CompanionState`：有限状态/当前小目标/取消 token；只存明确需要的短期世界事件，v0 不要求长期对话记忆。

存档/protocol 统一预留带 `schemaVersion` 和稳定字符串 ID 的对象字段；未来多实例迁移不得改变 v1 world voxel coordinate/cell ordering。

## 自主权限策略

1. 首次 `choose_home` 只读 observe：系统对候选位置检查边界、初始地形、占用、用户建筑标记；向用户显示位置/尺寸/预期预算，用户批准后签发 `HomePlotGrant`。
2. `scope=home_plot` 的 plan 只有在**全部为 put-to-empty**、operation 均位于当前 grant、材料 allowlist、预算/限频/plan TTL/baseRev/hash 均满足时才可自动 commit；worldd 服务端完成授权决策，LLM 不持有 grant 的签名能力。
3. 删除、覆盖、移动/扩展 plot、触及 plot 外或由玩家建成的 block、越过预算，均需逐次展示 diff 并由真人确认；追踪丢失时禁止空间写入。
4. 用户能暂停 companion、撤销 grant；undo 采用条件反向事务，不能覆盖后续玩家修改。

## 未来异步 visit 接口（v0 feature-disabled）

未来只允许邀请驱动、可撤销、短期/单次、明确列明权限的异步 visit；不提供“AI 自动浏览别人的世界”。预留事件 envelope（版本化、无可重放写凭证）：

```ts
type VisitInvitationV1 = {
  schemaVersion: 1; visitId: string; hostWorldId: string;
  hostUserId: string; hostCompanionId: string;
  guestUserId: string; guestCompanionId: string;
  scope: "read-summary" | "send-greeting"; // v1 visit 不包含建造/删除
  createdAt: string; expiresAt: string; state: "pending" | "accepted" | "declined" | "expired" | "revoked";
};
type VisitEventV1 = {
  schemaVersion: 1; visitId: string; eventId: string;
  actorCompanionId: string; kind: "greeting" | "visit-note";
  payload: { text: string }; createdAt: string;
};
```

- 两边用户需要各自授权；事件存于本地收件箱或未来受控 relay，默认文本/summary only，且按 TTL 删除。
- 永不传递模型凭证、pair ticket、文件路径、长期对话 memory、摄像头/麦克风、私人世界坐标，或可直接调用 `build_commit` 的 token。
- 若以后要让客人 AI 在主人的世界建造，必须另立 ADR/产品授权 UI，并沿主人 worldd 的 HomePlot/approval 规则重新授权，不能重用 visit ticket。
- v0 对外网络入口不存在；收到任何 visit/network envelope 一律拒绝，不可默认为只读放行。

## 后果

- 现在可以安全实现单 companion，但所有 world mutation 要带 actor/owner/scope 决策输入，以便之后扩展。
- v0 模拟器无需为多 AI/visit 加复杂 UI；仅应避免全局单例 API 使身份/权限迁移困难。
- “人格卡可导入”未来必须有严格 schema、签名/来源提示和 hostile-text 测试；卡片本身从来不是安全边界。
