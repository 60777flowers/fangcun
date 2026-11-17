# MCP 工具面 v0（stdio）

> 状态：**proposed**（2026-11-17）。关联：[Host API](HOST-API.md) §4.4、[结构 DSL](DSL-SPEC.md) §8。
> 本页描述的是 **v0 已实现的窄面**：外部 DSH agent 通过本机 stdio MCP 进程驱动方寸世界的 7 个工具。DSL `build_plan` / `build_commit` / `home_propose` / `world_undo` 等计划-批准面尚未实现，见文末「未实现」。

---

## 1. 运行方式

```powershell
# 1) 启动 Host（loopback 8765）
npm run host

# 2) 另一个终端启动 MCP server（先 build）
npm run mcp
```

`npm run mcp` = `npm run build && node scripts/mcp-server.mjs`。MCP 进程用 **stdin/stdout** 与 DSH 客户端通信；**stdout 只承载 JSON-RPC**，所有诊断写 stderr。

> 接到 DSH 等 MCP 客户端时，请把命令配置为 `node scripts/mcp-server.mjs`（先手动 `npm run build`）。直接让客户端 spawn `npm run mcp` 时，`tsc` 的构建日志会先写到 stdout，混进 MCP 流；本页的 `npm run mcp` 只适合在终端手动起停调试。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `FANGCUN_HOST` | `http://127.0.0.1:8765` | Host loopback base URL；必须是 http(s) URL，不接受 LAN/公网地址 |

MCP 进程不直接读写世界存档，只调用 Host 的 loopback `/api/core/*`；世界写入仍然只有一个入口（Host / worldd）。

---

## 2. 协议子集

传输：**newline-delimited JSON-RPC 2.0**（一行一条消息，JSON 内不得含裸换行）。

| 方法 | 说明 |
|---|---|
| `initialize` | 返回 `protocolVersion: "2024-11-05"`、`capabilities: { tools: {} }`、`serverInfo` |
| `notifications/initialized` | 通知，无响应 |
| `ping` | 返回空结果 `{}` |
| `tools/list` | 返回 §3 的 7 个工具 |
| `tools/call` | 执行工具；业务失败以 `{content, isError:true}` 返回 |

不支持（且 `capabilities` 不声明）：**streaming、resources、prompts、logging、sampling、batch 请求、进度通知**。未知方法（带 `id`）返回 `-32601`；非 JSON 返回 `-32700`；畸形请求返回 `-32600`；`tools/call` 缺少工具名返回 `-32602`。

`tools/call` 成功时 `result.content[0].text` 是紧凑 JSON；参数/业务失败时 `isError:true`，`text` 是一句可直接读的错误（不含堆栈、路径、token）。工具错误不会让进程崩溃。

---

## 3. 工具清单

所有工具 `inputSchema.additionalProperties: false`；多余参数直接 `isError`。坐标是整数格点，合法域由 `WorldSpec` 决定：`x,z∈[-8,8)`、`y∈[0,16)`；`y < WorldSpec.terrainTopY` 的行是受保护的地形层（阈值由 `packages/world-schema` 提供，本工具面不硬编码）。

### `world_observe`

无参数，只读。返回 `{ worldId, rev, blockCount, terrainTopY, blocksAboveTerrain[≤20], blocksAboveTerrainTruncated, homeGrantActive, candidateId? }`。

`blocksAboveTerrain` 每项 `{x,y,z,blockId}`。**注意**：Host 存档只记录方块 id、不记录放置者，所以这里无法区分玩家与 companion，只按“地形层以上的格子”列出；字段名也按此如实命名。

### `home_candidates`

无参数，只读。返回 `{ candidates: [{ candidateId, bounds:{min,maxExclusive}, score? }] }`。

Host 当前每次只提议一个候选（最近一次 tick 的结果），因此列表长度为 0 或 1；为空时先调用 `build_tick`。

### `home_claim`

参数 `{ candidateId: string(1-128) }`。批准该家园候选，返回 `{ approved: true, rev }`。只应传入 `home_candidates` 返回的 id；过期/已用 id 由 Host 拒绝并转成 `isError`。

### `build_tick`

无参数。执行一次 companion tick，返回 `{ status, committedOperations, rev }`。没有 grant 时 tick 只产生候选（配合 `home_candidates` / `home_claim`）；已有 grant 时提交一座小建筑。

### `place_block`

参数 `{ x, y, z, blockId }`。以玩家身份通过 `POST /api/core/intent` 放置一格：`clientId="mcp-agent"`、`seq` 为进程内单调递增、`baseRev` 在调用时重新读取。成功返回 `{ accepted:true, placed, at, rev }`；地形层、越界、非法方块 id、目标格已占用、Host 拒绝都会 `isError`。

### `break_block`

参数 `{ x, y, z }`。先读取当前状态，把该格现有方块作为 `expectedBlock` 发给 Host（并发改动会得到 `block_mismatch`），从而不会误删别的方块。空格或地形层返回 `isError`。

### `companion_say`

参数 `{ text: string(1-80) }`。调用 `POST /api/core/companion/say`，让 companion 气泡显示一句话；拒绝换行/控制字符。只发模型写的台词，**不读取**用户音频、聊天记录或相机帧。

---

## 4. 安全边界

1. **坐标与方块**：所有坐标在本地按 `WorldSpec` 校验（整数、`x/z∈[-8,8)`、`y∈[0,16)`）；`blockId` 必须属于 8 种方块；`y < terrainTopY` 的地形层拒绝写入。`world_observe` 会回传 `terrainTopY`，模型应以它为准，不要假设固定的地形层厚度。
2. **越权**：模型不能设置 `ownerUserId`、`grantId`、`plotId`、`approvalId`；工具不暴露这些身份字段。世界写入仍由 Host 做最终校验（占用/过期/预算/approval）。
3. **隐私**：工具返回只含世界摘要、候选、状态与错误码；不返回用户音频、文本、相机数据、文件路径或 token。
4. **宿主边界**：只访问 `FANGCUN_HOST` 指向的 loopback HTTP API，不读存档、不执行 shell、不联网。
5. **失败即数据**：越界/非法参数/Host 不可达都以 `isError` 工具结果返回，进程保持存活。

---

## 5. 测试

```powershell
npm test   # 含 packages/mcp/test/mcp.test.ts
```

覆盖：工具名与 schema 形状、`initialize`/`notifications/initialized`/`ping`/`tools/list`/`tools/call` 的 JSON-RPC 框架与错误码、stub fetch 下的 intent 序号与 `baseRev`、越界坐标/非法方块 id/地形层拒绝、`break_block` 的 `expectedBlock` 读取、Host 不可达时的 `isError`。

---

## 6. 未实现（诚实清单）

- 批量 JSON-RPC、进度通知、取消通知。
- resources / prompts / streaming / sampling。
- DSL 计划面：`build_plan`、`build_commit`、`build_cancel`、`home_propose`、`world_undo`（需先补齐 Host 的 plan/approval/undo 端点）。
- 独立 token 的 HTTP MCP 传输（HOST-API §4.4 的备用路径）。
- `companion_say` 依赖 Host 的 `/api/core/companion/say`（当前 Host 已实现，冒烟验证返回 200）；端点缺失时该工具返回 `isError`，其余工具不受影响。
