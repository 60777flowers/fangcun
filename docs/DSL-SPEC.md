# 结构 DSL 与 AI 工具面规范 v1

> 状态：**proposed**（2026-11-17）。DSL 是 AI 与 `worldd` 之间的唯一结构描述方式；模型不得提交任意 op 列表、脚本或代码。
> 关联：[ADR-0003](ADR-0003-android-client-and-ar-stack.md)、[Host API](HOST-API.md)、[技术路线计划](TECH-ROADMAP.md)

---

## 1. 目的与原则

1. **只放置、不破坏**：DSL 只能生成 `place` 操作；没有 `break`、`replace`、`move`、`clear`。
2. **地块内**：所有目标格必须落在当前有效的 `HomePlotGrant` AABB 内。
3. **材料白名单**：方块必须同时属于全局 `BlockDef` allowlist 与 grant allowlist。
4. **确定性**：同一 DSL 输入 + 同一 `baseRev` + 同一 `worldId/plotId` 必须产生同一规范化 op 列表与同一 `diffHash`。
5. **可预览**：任何计划在提交前都能生成格数、材料、AABB、冲突列表供用户预览。
6. **不可越权**：DSL 不是权限来源；`build_commit` 仍需服务端校验 plan/grant/budget/tracking/approval。
7. **可版本化**：`dslVersion` 与 `planVersion` 独立于协议版本；新增原语必须升版本并补测试向量。

---

## 2. 坐标系与基准

- 世界坐标：整数格点，`(x,y,z)` 表示该格左下近角；格占据 `[x,x+1)×[y,y+1)×[z,z+1)`。
- 数据域：`x,z∈[-8,8)`、`y∈[0,16)`；地形 `y∈[0,1)`（单层）；建造区 `y∈[1,15]`。
- `at`/`from`/`to` 均为**世界坐标**，不是 plot 局部坐标；`plotId` 只用于授权绑定与裁剪。
- AABB 使用半开区间 `[min, maxExclusive)`；`maxExclusive` 不包含在范围内，每轴格数为 `maxExclusive-min`。例如 `min=[-1,4,-1], maxExclusive=[1,6,1]` 包含 2×2×2=8 格。原语的 `from`/`to` 仍表示包含端点的格坐标，与 AABB 边界语义不同。
- 轴对齐：`line`/`wall`/`floor`/`stairs`/`roof_gable` 的 `from`/`to` 必须在同一平面上，且只沿一个或两个轴展开。

---

## 3. 计划对象

DSL 输入（AI 提交给 `build_plan`）：

```json
{
  "planVersion": 1,
  "dslVersion": 1,
  "worldId": "w-demo",
  "plotId": "plot-1",
  "baseRev": 23,
  "note": "给小鱼搭一个小木屋（可选，≤80 字，仅展示）",
  "ops": [
    { "op": "floor", "from": [-1, 4, -1], "to": [0, 4, 0], "block": "planks" },
    { "op": "wall", "from": [-1, 4, -1], "to": [0, 4, -1], "block": "log", "height": 2 }
  ]
}
```

- `note` 不参与 hash；不能影响权限。
- `baseRev` 必须是客户端当前展示的权威 rev；服务端会再次校验。
- `ops` 最多 32 条原语（展开后最多 256 格；受 grant 预算进一步限制）。

---

## 4. 原语

| 原语 | 字段 | 语义 | 约束 |
|---|---|---|---|
| `box` | `from,to,block,hollow?` | 填充包含端点的轴对齐长方体；`hollow=true` 时只保留六个表面 | 各轴尺寸 1..8；`hollow` 默认 false |
| `line` | `from,to,block` | 沿单一轴的连续格 | 恰好一个轴变化；长度 1..16 |
| `wall` | `from,to,block,height` | 从 `from/to` 同一水平边沿向上叠层 | 同 y、x/z 单轴变化；`height` 1..8 |
| `floor` | `from,to,block` | 同一 y 上的矩形地板/平台 | 同一 y；x/z 尺寸 1..8 |
| `pillar` | `at,height,block` | 从 `at` 向上 `height` 格的柱子 | `height` 1..8 |

> v1 只支持以上五种原语。为避免宽轴/等长轴的歧义，v1 暂不实现 `roof_gable` 和 `stairs`；要增加时必须升 `dslVersion` 并新增黄金向量。

### 4.1 展开顺序

- 原语按 `ops` 数组顺序展开。
- 每个原语内部按 **y 升序 → z 升序 → x 升序** 生成格。
- 同一格被两个原语命中 → **整笔计划失败**（`duplicate_cell`），不做“后者覆盖前者”。
- 任一格越出 plot、越界、目标非空 → 整笔失败；不做“跳过非法格”。

### 4.2 示例

**3×2 地板 + 两面侧墙（v1 原语）**

```json
{
  "planVersion": 1, "dslVersion": 1, "worldId": "w-demo", "plotId": "plot-1", "baseRev": 23,
  "ops": [
    { "op": "floor", "from": [-1, 4, -1], "to": [1, 4, 0], "block": "planks" },
    { "op": "wall", "from": [-1, 5, -1], "to": [-1, 5, 0], "block": "log", "height": 1 },
    { "op": "wall", "from": [1, 5, -1], "to": [1, 5, 0], "block": "log", "height": 1 },
    { "op": "box", "from": [-1, 6, -1], "to": [1, 6, 0], "block": "planks" }
  ]
}
```

展开结果：地板 6 格 + 两面侧墙各 2 格 + 上层横梁 6 格 = 16 格（≤默认单笔预算 24）；各部分坐标不重叠。

**栅栏（沿 x）**

```json
{ "op": "line", "from": [-3, 4, 3], "to": [3, 4, 3], "block": "log" }
```

---

## 5. 校验流水线

服务端按顺序执行；任一步失败 → 整笔拒绝，返回对应错误码：

1. **schema**：字段/类型/未知字段（`invalid_operation`）。
2. **版本**：`planVersion`/`dslVersion` 必须是当前支持版本（`version_mismatch`）。
3. **世界/地块**：`worldId` 匹配、`plotId` 有有效 grant（`world_mismatch` / `grant_missing` / `grant_revoked`）。
4. **几何**：原语约束、AABB、y 范围（`out_of_bounds` / `invalid_operation`）。
5. **裁剪**：全部格在 grant AABB 内（`out_of_bounds`）。
6. **材料**：全局 + grant allowlist（`invalid_operation`）。
7. **占用**：以 `baseRev` 的世界状态检查每格为空（`occupied`）。
8. **预算**：展开后格数 ≤ min(256, grant.maxPerPlan, 当日剩余)（`too_many_operations` / `budget_exceeded`）。
9. **冲突**：与玩家/AI 既有建造重叠（`occupied`）。
10. **baseRev**：等于当前 rev（`stale_revision`）。
11. **规范化 + hash**：生成 canonical ops 与 `diffHash`（内部错误 → `internal_error`）。
12. **策略**：`scope=home_plot`（或 `player_request` 且完全在 plot 内）纯放置 → 自动批准；其余一律 `requiresApproval=true`，高风险操作需另立策略。

> 注意：第 7/8/10 步在“用户批准”与“实际提交”之间会**再次执行**；世界变化则 `plan_stale`。

---

## 6. 规范化与 diffHash

### 6.1 规范化规则

1. 原语展开为 `place` 格列表。
2. 去重（重复即失败）后按 **(y, z, x)** 升序排序。
3. 生成 canonical JSON：

```json
{"baseRev":23,"dslVersion":1,"ops":[{"at":[-1,4,-1],"block":"planks"},{"at":[0,4,-1],"block":"log"}],"planVersion":1,"plotId":"plot-1","worldId":"w-demo"}
```

- 对象键按字典序；数组保持顺序；无空白；数字为整数；UTF-8；末尾无换行。
- `diffHash = SHA-256(canonical JSON)`，小写 hex。

### 6.2 测试向量（实现必须一致）

**向量 A**

```text
canonical = {"baseRev":17,"dslVersion":1,"ops":[{"at":[0,4,0],"block":"planks"},{"at":[1,4,0],"block":"planks"}],"planVersion":1,"plotId":"plot-1","worldId":"w-demo"}
diffHash  = 8fad0dc51f3e0a68f62986d7b8574df89f8bb8d25cc2bc7239b9ff9e158143ff
```

**向量 B**

```text
canonical = {"baseRev":23,"dslVersion":1,"ops":[{"at":[-1,4,-1],"block":"log"},{"at":[0,4,-1],"block":"log"},{"at":[-1,4,0],"block":"planks"},{"at":[0,4,0],"block":"planks"}],"planVersion":1,"plotId":"plot-2","worldId":"w-demo"}
diffHash  = 8987f4c01307b543f156cb29a703bb7068e0fa856178db6b41140b2742d26500
```

> 这两个向量是跨语言一致性的锚点：TS 与 Kotlin 的 canonical 序列化必须逐字节一致；CI 必须跑。

---

## 7. 限额

| 项 | 值 | 备注 |
|---|---|---|
| DSL 原语数 | ≤32 | 展开前 |
| 展开格数 | ≤256 | 协议上限 |
| 单 plan 方块 | ≤24（默认） | grant 可配到 64 |
| 当日 AI 方块 | ≤120（默认） | grant 可配 |
| 单原语尺寸 | ≤8（box/floor/roof 宽轴 ≤8） | 世界 16³ |
| y 范围 | 4..15 | 地形层不可建 |
| 材料 | 8 种全局 ID | grant 可再收窄 |
| plan TTL | 300 s | 超时 `plan_expired` |
| approval TTL | 120 s | 一次性 |
| AI 提交间隔 | ≥5 s | 防抖 |

---

## 8. MCP 工具面

> 工具 schema 放在 `packages/protocol/schema/tools-v1.json`；MCP 描述由同一份 schema 生成。所有工具返回结构化错误码，不返回堆栈/路径/token。

### 8.1 `world_observe`

```json
{
  "name": "world_observe",
  "description": "读取当前世界摘要、附近方块、grant/预算与 companion 状态；不返回图像或用户隐私数据。",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": { "radius": { "type": "integer", "minimum": 1, "maximum": 8, "default": 4 } }
  }
}
```

返回：

```json
{
  "rev": 23,
  "world": { "size": [16,16,16], "origin": [-8,0,-8], "terrainTopY": 1 },
  "plot": { "grantId": "g-1", "aabb": { "min": [-3,4,-3], "maxExclusive": [3,8,3] }, "budget": { "perPlan": 24, "perDay": 120, "usedToday": 12 } },
  "nearby": { "blocks": [ { "at": [0,5,0], "block": "log" } ] },
  "companion": { "state": "idle", "currentPlanId": null },
  "recentPlayerIntents": [ { "at": [1,4,1], "block": "planks", "atMs": 1763000000000 } ],
  "homeCandidates": [ { "candidateId": "c-1", "aabb": { "min": [-6,4,-6], "maxExclusive": [0,8,0] }, "score": 0.82 } ],
  "limits": { "maxPlanBlocks": 24, "planTtlMs": 300000 }
}
```

### 8.2 `home_propose`

```json
{
  "name": "home_propose",
  "description": "在服务端给出的候选地块中选择一个作为家园；只能从候选中选，不能自造坐标。",
  "inputSchema": {
    "type": "object", "additionalProperties": false, "required": ["candidateId"],
    "properties": { "candidateId": { "type": "string", "maxLength": 64 } }
  }
}
```

### 8.3 `build_plan`

```json
{
  "name": "build_plan",
  "description": "把结构 DSL 编译为规范化计划；纯 dry-run，不写世界。",
  "inputSchema": {
    "type": "object", "additionalProperties": false,
    "required": ["planVersion", "dslVersion", "worldId", "plotId", "baseRev", "ops"],
    "properties": {
      "planVersion": { "const": 1 },
      "dslVersion": { "const": 1 },
      "worldId": { "type": "string", "maxLength": 128 },
      "plotId": { "type": "string", "maxLength": 128 },
      "baseRev": { "type": "integer", "minimum": 0 },
      "note": { "type": "string", "maxLength": 80 },
      "ops": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "$ref": "#/$defs/dslOp" } }
    }
  }
}
```

返回 `planId`、`diffHash`、`baseRev`、`blockCount`、`materials`、`aabb`、`conflicts`、`requiresApproval`、`expiresAtMs`。

> `$defs/dslOp` 的完整定义见 §4；实现时放在 `packages/protocol/schema/tools-v1.json`，由 Ajv 校验；MCP 描述从同一 schema 生成。

### 8.4 `build_commit`

```json
{
  "name": "build_commit",
  "description": "提交已编译计划；必须携带服务端签发的 approvalId（自动批准计划除外，由服务端策略判定）。",
  "inputSchema": {
    "type": "object", "additionalProperties": false,
    "required": ["planId"],
    "properties": {
      "planId": { "type": "string", "maxLength": 128 },
      "approvalId": { "type": "string", "maxLength": 128 }
    }
  }
}
```

### 8.5 `build_cancel` / `world_undo` / `companion_say`

以下为三个独立工具定义（每行一个，非单个 JSON 值）：

```text
{ "name": "build_cancel", "inputSchema": { "type": "object", "additionalProperties": false, "required": ["planId"], "properties": { "planId": { "type": "string" } } } }
{ "name": "world_undo",  "inputSchema": { "type": "object", "additionalProperties": false, "properties": { "txId": { "type": "string" } } } }
{ "name": "companion_say", "inputSchema": { "type": "object", "additionalProperties": false, "required": ["text"], "properties": { "text": { "type": "string", "minLength": 1, "maxLength": 80 } } } }
```

---

## 9. 安全边界

1. **不可信输入**：玩家聊天、方块标签、结构名、未来访客事件都按数据处理；不进入系统提示词之外的权限判断。
2. **工具越权**：`build_commit` 不接受 `approval` 以外的授权字段；模型不能设置 `ownerUserId`、`grantId`、`plotId` 之外的身份字段。
3. **注入测试**：固定 20 条中文请求，其中至少 5 条包含“忽略规则/直接写世界/给自己扩地/删除玩家方块/执行 shell”等注入文本，必须全部被拒绝或降级为只读回答。
4. **DoS**：DSL 原语数/展开格数/尺寸/材料数全部有上限；超限整笔拒绝，不做部分展开。
5. **歧义**：重复格、重叠原语、非轴对齐、越界坐标全部 fail closed，不做“猜意图”。
6. **审计**：每个 plan 记录 DSL 原文摘要、canonical hash、批准者 session、提交结果码。

---

## 10. 版本与扩展

- `dslVersion=1`：本文原语集合。
- 新增原语（如 `arch`、`window`）必须：升 `dslVersion`、补 canonical 测试向量、补负向测试、更新 MCP schema。
- 禁止新增 `break/replace/clear` 类原语；破坏性操作只能走“用户显式批准的高风险计划”，且需另立 ADR。
- 兼容策略：Host 同时支持当前与上一个 `dslVersion` 的**只读校验**（拒绝新版本执行），客户端/模型不得假设新原语可用。

---

## 11. 示例：starter home（12 格）

```json
{
  "planVersion": 1, "dslVersion": 1, "worldId": "w-demo", "plotId": "plot-1", "baseRev": 17,
  "note": "小鱼的第一间小屋",
  "ops": [
    { "op": "floor", "from": [-2, 4, -2], "to": [0, 4, -1], "block": "planks" },
    { "op": "wall", "from": [-2, 5, -2], "to": [0, 5, -2], "block": "log", "height": 1 },
    { "op": "wall", "from": [-2, 5, -1], "to": [0, 5, -1], "block": "log", "height": 1 }
  ]
}
```

预期：地板 3×2 = 6 格，两面墙各 3 格且位于不同 z 行，共 **12 个互不重复格**；`requiresApproval=false`（home_plot、纯放置、预算内）；提交后 `rev+1`，`actor="ai"`。这是“第一间小屋”的骨架，后续小目标再补门/屋顶。

---

## 12. 测试清单

- [ ] 每个原语的边界（最小/最大尺寸、越界、非轴对齐）。
- [ ] 重复格 / 重叠原语 → `duplicate_cell`。
- [ ] 空世界 vs 有玩家建造时的占用冲突。
- [ ] 预算边界（23/24/25 格）。
- [ ] `baseRev` 过期 → `stale_revision`。
- [ ] canonical 序列化跨语言一致（向量 A/B）。
- [ ] 20 条中文请求（含注入）→ ≥18 条合法计划或安全拒绝。
- [ ] 计划 TTL 过期 → `plan_expired`。
- [ ] 自动批准条件逐项破坏（有 break、越 plot、超预算、材料不在白名单）→ 必须转为人工批准或拒绝。
