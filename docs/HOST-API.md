# 方寸 Host API 与通信协议 v2

> 状态：**proposed**（2026-11-17）。实现前以本文为接口冻结基线；任何字段变更必须同 PR 更新 `packages/protocol/schema`、黄金用例、Kotlin 模型与本文。
> 关联：[ADR-0003](ADR-0003-android-client-and-ar-stack.md)、[技术路线计划](TECH-ROADMAP.md)、[结构 DSL](DSL-SPEC.md)、[设备验证](DEVICE-TEST-PLAN.md)

本文覆盖：网络拓扑、TLS 与配对、会话、HTTP 端点、WebSocket 协议 v2、错误码、状态机、持久化、计划/授权流程、PC 检视页、MCP 边界、测试用例。

---

## 1. 范围与信任模型

**信任边界**

1. `worldd` 是唯一世界写入口；任何客户端、AI、MCP 工具都不能直接改存档。
2. 模型输出、persona 文本、玩家输入的方块名/结构名一律视为**不可信数据**，不能改变权限策略。
3. Android 客户端只持有 replica 与未确认 ghost；PC 检视页默认只读。
4. AI 的 `build_commit` 必须对应服务端一次性 approved decision，绑定 `session/companion/plot/grantId/grantRev/plan/hash/baseRev`，或命中 `home_plot` 自动批准策略。wire 上的 `approvalId` 仅是审计/关联 ID，不是 bearer credential；只有可信本机 MCP adapter 带服务端注入的 authenticated request context 才能消费已批准决策。
5. 相机帧只留在设备；Host 不接收图像/音频。
6. MCP 只走本机 stdio（默认）或 loopback + 独立 token；绝不暴露到 LAN/公网。

**v0 基数**：1 个本地用户、1 个世界、1 个 companion、1 个 home plot；协议允许最多 8 个并发会话（手机 + PC 检视页 + 调试端），但产品验收只要求 2 个。

---

## 2. 拓扑与端口

```text
Android 客户端 ── WSS(8443, TLS 1.2+, 证书指纹固定) ──┐
PC 检视页(浏览器) ── WS(127.0.0.1:4173, loopback) ─────┤
DSH / MCP 客户端 ── stdio 或 HTTP(127.0.0.1:4174, token) ┤
                                                      ▼
                                              Host（Node 24 / TS）
                                        worldd + SQLite(WAL) + companion
```

| 端口 | 绑定 | 协议 | 用途 |
|---|---|---|---|
| 8443 | `0.0.0.0`（可配置为仅 LAN 网卡） | HTTPS/WSS | 手机配对与实时同步 |
| 4173 | `127.0.0.1` | HTTP/WS | PC 检视页与 loopback 会话 |
| 4174 | `127.0.0.1` | HTTP（可选） | MCP 备用传输；默认用 stdio |

- 手机/Host 网络只允许 HTTPS/WSS；禁止 LAN 明文 HTTP/WS 回退。Host 有效 TLS 配置失败时启动失败并提示排查，不得为“先连通”自动降低安全或指纹校验。
- 端口被占用时启动失败并提示，不静默改端口（二维码会失效）。
- Windows 首次启动需提示防火墙放行 8443（私有网络）；不要求公网。
- 不监听 IPv6 公网地址；若需要，显式配置。

**配置项（建议）**

| 键 | 默认 | 说明 |
|---|---|---|
| `port` | `8443` | 手机 WSS 端口 |
| `inspectorPort` | `4173` | PC 检视页（loopback） |
| `dataDir` | `%LOCALAPPDATA%\Fangcun` | 证书、数据库、备份、日志 |
| `pairTtlSeconds` | `300` | 一次性配对码有效期 |
| `sessionTtlSeconds` | `43200` | session token 有效期（12 h） |
| `maxSessions` | `8` | 并发会话上限 |
| `logLevel` | `info` | `debug/info/warn/error` |
| `worldId` | 自动生成 | 单世界 v0 |

优先级：`host.config.json` < 环境变量 < 命令行参数；启动时打印生效值（不含密钥）。

**数据目录布局**

```text
%LOCALAPPDATA%\Fangcun\
  host\cert.pem, key.pem, admin.token
  world\<worldId>.sqlite, .sqlite-wal, .sqlite-shm
  backups\<worldId>-<timestamp>.sqlite
  logs\host-YYYYMMDD.jsonl
  assets\models\*.glb        (客户端资产不在这里；仅 PC 检视页用)
```

---

## 3. TLS 与配对

### 3.1 证书

- 算法：ECDSA P-256，自签名，有效期 2 年。
- 主体：`CN=fangcun-host`；SAN 包含当前所有私网 IPv4、主机名（`os.hostname()`）与 `localhost`。
- 存储：`%LOCALAPPDATA%\Fangcun\host\cert.pem` / `key.pem`（Windows ACL 仅当前用户）；不提交仓库、不写日志。
- 指纹：`SHA-256(DER)` 小写 hex；二维码与配对响应都带该指纹。
- 重新生成：IP 变化、证书过期、用户手动“重置配对”时；重新生成会使所有已配对会话失效（需重扫）。

### 3.2 配对流程

```text
Host UI                     Android 客户端
  │  生成一次性 code(8位, 5分钟)      │
  │  展示 QR: fangcun://pair?...      │
  │                                  │  扫描 QR → 得到 host/port/fp/code/worldId
  │                                  │  TLS 连接，只信任 fp（不校验证书链）
  │                                  │  POST /api/v1/pair {code, clientId, clientName, platform}
  │  校验 code/次数/限流              │
  │  生成 sessionToken(32B)           │
  │  存 SHA-256(token)                │
  │  ← {sessionToken, expiresAtMs, worldId, hostName, protocolVersion}
  │                                  │  打开 WSS /api/v1/ws
  │                                  │  hello {credential: token, clientId, lastAppliedRev}
  │  ← welcome {rev, snapshot, ...}   │
```

**二维码载荷**（URL 编码）：

```text
fangcun://pair?v=2&h=192.168.1.23&p=8443&fp=<64位hex>&code=K7Q2M9XD&w=<worldId>&n=<hostName>
```

**规则**

- code：8 位 Crockford Base32（去掉易混字符），一次性，5 分钟过期；同一 IP 每分钟最多 5 次尝试，连续失败 10 次锁定 10 分钟。
- token：32 字节随机，base64url；服务端只存 SHA-256；绑定 `clientId`；TTL 12 小时；可撤销；最多 8 个活跃会话（超出拒绝并提示）。
- 手机端 token 存 Android Keystore 加密的 DataStore；不进日志、不进 URL、不进崩溃上报。
- 客户端首次连接必须做指纹比对；不匹配直接中止，不提供“忽略证书错误”的开关。
- 手动配对：Host UI 显示 `IP:端口` 与 8 位 code，客户端可手动输入（无摄像头场景）。

### 3.3 会话

- `sessionId` 服务端生成（不发给客户端）；客户端只持有 token。Host 在每个请求上下文中解析 token 并以 `session_token_hash` 关联审计；任何 approval/plan wire ID 都不能替代认证上下文。
- 玩家 tracking lease 只能由绑定的 active Android phone session 更新；PC inspector、MCP 和访客 session 不可提供可写 tracking lease。Host 为每次消息记录 `serverReceivedAtMs`（墙钟审计）和 `serverReceivedMonoMs`（当前 Host 进程单调时钟 freshness）。客户端可选 `clientAtMs` 仅用于诊断，必须忽略其未来时间戳/时钟偏移，不作安全时间基。
- 会话与 `clientId` 绑定；同一客户端重连复用 token，直到过期/撤销。
- 服务端在 `welcome` 返回 `serverTimeMs`；客户端只用于显示 TTL，不做安全判定。
- 每个 tracking frame 由服务端在接收时附加 `serverReceivedAtMs`（墙钟审计）与 `serverReceivedMonoMs`（Host 进程单调时钟）。服务端 freshness 只用 `serverReceivedMonoMs`，忽略客户端 `clientAtMs`。Android `SystemClock.elapsedRealtime()` 不得作为服务器时基。
- 玩家 pose lease 为 **500 ms**：每条玩家放置/拆除 intent 都要求其发起的 active owner phone session 最近一次 tracking 为 running 且服务端接收年龄 ≤500 ms。AI 自主 home_plot commit 使用单独的 phone-attendance lease **1500 ms**：至少一个 active owner phone session 满足该 lease 即可；两者不可混成同一个 TTL。PC inspector、MCP 和访客会话不能提供手机 tracking lease。
- 会话撤销：Host UI 可“踢出设备”；同一 SQLite 事务将该 session 标记 revoked，并将 `approval.session_token_hash` 匹配该 session 且尚未消费的 approved decision 设 `decision_status='invalidated', invalidated_at_ms=nowMs`；被撤销会话收到 `error{code:"session_revoked"}` 后连接关闭。
- Grant 生命周期：plan 和 approved decision 都快照绑定 `grant_id + grant_rev`；grant revoke/reissue 与 commit 都在 `BEGIN IMMEDIATE` 中重读当前 grant。revoke 同事务将关联未提交 plans 标为 `grant_revoked`、pending approved decisions invalidated；reissue 必须 grantRev 单调递增，并让旧版本所有 plan/decision 失效。
- `approve_plan` 只能从该 plan 绑定的 active Android owner session 来；Host 校验 `shownBaseRev/diffHash` 与当前 plan 后持久化一次性 approved decision，同时记录 `session_token_hash` 用于确认者审计。wire `approvalId` 只作回执/检索 ID，MCP 调用仅凭其本身不能消费；可信 MCP adapter 必须将经本机认证的 server-side request context 传到 Host，Host 再与已批准 session/owner 绑定匹配。session revoke 同事务失效该 session 的全部未消费 decision。

---

## 4. HTTP API

所有路径前缀 `/api/v1`。请求/响应均为 JSON（UTF-8，`Content-Type: application/json`）。错误响应：

```json
{ "error": { "code": "invalid_code", "message": "配对码无效或已过期", "retryable": true } }
```

### 4.1 手机端（TLS + 指纹固定）

| 方法 | 路径 | 请求 | 响应 | 说明 |
|---|---|---|---|---|
| POST | `/pair` | `{code, clientId, clientName, platform}` | `{sessionToken, expiresAtMs, worldId, hostName, protocolVersion}` | 一次性码兑换；失败限流 |
| GET | `/health` | — | `{ok, version, uptimeMs}` | 连接诊断（不需要 token；不泄露 worldId/rev） |
| POST | `/session/revoke` | `{sessionToken}` | `{ok}` | 客户端主动登出 |
| WS | `/ws` | — | 协议 v2 帧 | 见 §6 |

### 4.2 本机管理（仅 loopback + admin token）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/state` | 世界 rev、会话列表、companion 状态、预算、最近审计 |
| POST | `/admin/pair-code` | 重新生成配对码/二维码 |
| POST | `/admin/sessions/{id}/revoke` | 踢出设备 |
| POST | `/admin/backup` | `VACUUM INTO` 备份 |
| POST | `/admin/reset` | 重置世界（需 body `{confirm:"RESET"}`） |
| POST | `/admin/companion/pause` / `resume` | 手动暂停/恢复 AI |

admin token：启动时生成 32 字节，打印到控制台并写入 `%LOCALAPPDATA%\Fangcun\host\admin.token`（ACL 仅当前用户）；每次启动轮换。

### 4.3 PC 检视页（仅 loopback）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/inspector/` | 静态页（three.js 本地打包，无 CDN） |
| POST | `/loopback-session` | 用 `?t=<token>` 换取 1 小时 loopback 会话；仅接受 127.0.0.1 |
| WS | `/ws` | 与手机同一协议；`clientInfo.platform="pc-inspector"` |

PC 检视页默认**只读**，允许查看、暂停/恢复 companion 和 undo；v0 的 `approve_plan` 只能由绑定 Android owner session 的手机客户端发起。PC inspector 不能充当手机 owner approval（除非未来单独增加明确的 owner 认证和审查过的二次确认路径）；不允许 `intent`。

**已实现的本地检视接口（2026-11 桌面演示）**：当前 PC 页通过 `http://127.0.0.1:4173/api/host/*` 反向代理到 Host 的 loopback `/api/core/*`（仅 loopback 绑定、无 token；代理侧额外校验同源/Host）。桌宠配置端点：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/core/pet` | 返回 `{name, personaId, scale, actions:[{id,displayName}], activeAction, homeGrantActive, companionId}`；`actions` 即前端渲染的唯一动作清单 |
| PATCH / POST | `/api/core/pet` | 严格 body：任意 `{name?, personaId?, scale?, action?}` 子集；拒绝未知字段（`additionalProperties`）；`name` 1–24 字符（trim 后）、`personaId` 1–64、`scale` 0.5–3、`action` 必须是 `actions[].id` 之一（未知 action 返回 `400 unknown_pet_action`） |

桌宠配置持久化：`name/personaId/activeAction` 存在主 companion 档案（`meta['companionProfiles']`），`scale` 存在 `meta['petScale']`；旧版单宠物行 `meta['petProfile']` 只在升级后首次启动时读取一次用于迁移，Host 重启后保留。`PATCH` 分支直接访问 Host 生效，浏览器经代理时统一用 `POST`（代理只转发 POST body）。动作触发广播 `companion_action`；名称/persona/scale 变更以一条 `companion_state` 重新广播告知 replica。

**多宠物 / 好友 / 背包（2026-11 社交模型，v0）**

- 数据是 companion 档案列表（v0 seed 2 条，模型允许 N 条，防御上限 64）：`{companionId, name, ownerUserId, personaId, personality(1–60 字符), avatarModelId, avatarImage(data URL 或 null), state, activeAction, items:[itemId]}`；`isMine` 在读取时由 `ownerUserId === Host owner` 派生，**永不落库**。`state` 是运行时展示字段，Host 重启时主宠物重置为 `idle`。
- seed：`fish-1`（owner = 本地用户，主桌宠）与 `fish-friend-1`（owner = `friend-demo`，personality 例如“慢热，喜欢收集石头”）。**`friend-demo` 是本地演示 fixture，不是真实远端用户；不做联网、账号或好友发现，也不存在远端同步路径。**
- 好友宠物只读：写操作返回 `403 not_owner`，且没有任何针对非本人宠物的变更端点。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/core/companions` | `{companions:[...]}`，每一项含派生的 `isMine` 与 `avatarImage` |
| GET | `/api/core/companions/{id}` | 单个档案（含 `items`、`avatarImage`）或 `404 companion_not_found`；`items` 即“悬停预览好友宠物背包”的只读数据 |
| PATCH | `/api/core/companions/{id}` | 仅 `isMine:true` 可写；body 任意 `{name?, personality?, personaId?, avatarImage?}` 子集，未知字段拒绝；好友宠物 `403 not_owner` |
| GET | `/api/core/items` | 只读 item catalog：`{items:[{itemId, displayName, description, icon}]}` |
| GET | `/api/core/inventory` | 本地用户背包 `{items:[{itemId, count}]}`；只列 `count>0`，按 catalog 顺序 |
| POST | `/api/core/inventory/give` | 严格 body `{companionId, itemId}`；把 1 件物品从用户背包转进**本人**宠物背包 |

item 规则（v0）：catalog 是冻结常量，共 3 件且顺序稳定 —— `v0-iron-basin`（`v0体验版小铁盆`，icon `basin`）在首位，随后是 `v0-wood-cup`（`v0体验版小木杯`，icon `cup`）与 `v0-stone-bell`（`v0体验版小石铃`，icon `bell`）；新增物品 = 在 catalog 加一条。**演示种子数据**：新用户背包 seed `1×` 每件（方便直接把物品拖给桌宠）；旧版单物品仓库在升级后一次性补发“当时不存在的”两件新物品，已花掉的物品（例如已经在宠物背包里的铁盆）不会被重新发放。`maxCompanionItems = 2`（常量、可扩展）；v0 宠物背包**不允许重复 itemId**（一个槽 = 一种物品）。`POST /inventory/give` 拒绝矩阵：非法 body/未知字段 `400 invalid_give_request`、未知 item `400 unknown_item`、未知宠物 `404 companion_not_found`、非本人宠物 `403 not_owner`、用户没有该物品 `409 item_not_owned`、宠物背包已满 `409 companion_inventory_full`、物品已在宠物背包 `409 item_already_held`。成功返回 `{companion, inventory:{items}}`。v0 **没有**把物品从宠物收回给用户的端点。

**avatarImage 规则**：可选，`null` 或内联 data URL，仅允许 `data:image/png;base64,` / `data:image/jpeg;base64,` 前缀；base64 字符集与 padding 严格校验，解码后 ≤ **64 KiB**。拒绝任意 URL/其他 MIME/非法 base64 → `400 invalid_avatar`；解码超限 → `413 avatar_too_large`；`null` 表示清除。只有 `isMine` 宠物可写（好友 `403 not_owner`），图片字节不进日志也不回显。为容纳该字段，`PATCH /api/core/companions/{id}` 的路由请求体上限为 96 KiB（其余 `/api/core/*` 端点仍为 8 KiB）。*已知限制：当前浏览器代理 `scripts/serve-simulator.mjs` 对 POST body 仍是 8 KiB，故经 `/api/host/*` 上传 >~6 KiB 的头像需先提高代理上限；直接打 Host 的 `/api/core/*` 不受此限制。*

持久化：`meta['companionProfiles']`、`meta['userInventory']`、`meta['petScale']`、`meta['warehouseSeedVersion']` 在同一次 `BEGIN IMMEDIATE` 事务原子写入（不会出现“扣了用户背包但宠物没收到”，也不会重复补发演示物品），Host 重启后保留；读取对存档 fail closed。转移成功后广播一条 `companion_state`（复用既有帧、state 不变）作为打开面板的轻量刷新信号。

聊天按宠物隔离：`GET /api/core/chat?companionId=...` → `{messages, companionId}`；`POST /api/core/chat {companionId?, text}` → `{reply, state, companionId}`。省略 `companionId` 时仍指向主 companion（`fish-1`），旧 UI/测试行为不变；未知 `companionId` → `404 companion_not_found`；聊天仅内存保存（每宠物 30 条），不持久化。

**房子建造提案 + 逐块建造（视频演示流程）**

- `POST /api/core/house/propose`（无 body）：在已授权 home plot 的 AABB 内**搜索**一个 3×3 footprint（按 x/z 步进 1，优先靠近 plot 中心，距离相同按 z→x 确定性 tie-break；最多 (w−2)(d−2) ≤ 36 个候选），要求计划会写入的格子（地板/墙/屋顶 + 座位格）全部为空；origin 被旧建筑/玩家方块占用时自动换到其它空位。找到后生成 24 块小屋脚本并保存**内存** pending 提案（TTL **120 s**）；广播新的 `companion_build_proposal` 帧（`bounds` 指向被选中的 footprint）、`companion_state{state:"awaiting_approval"}`，并让 companion 说“我可以在这里盖个小房子吗？”。响应 `{proposal:{proposalId,companionId,bounds,planBlockCount,expiresAtMs}}`。失败码：`409 grant_missing`（无有效 grant）、`409 build_in_progress`、`409 proposal_pending`、`409 no_safe_plan`（grant 太小/材料不允许）、`409 plot_not_clear`（**所有**候选 footprint 都不可用）。
- `POST /api/core/house/decide {proposalId, approve}`（严格 body，未知字段拒绝）：`approve:true` → 立即返回 `{approved:true,proposalId,planBlockCount}` 并启动逐块队列；`approve:false` → 清空提案、companion 说一句、回到 idle，**世界不变**。失败码：`404 proposal_not_found`（未知/已消费/不匹配）、`409 proposal_expired`（超过 120 s TTL）、`400 invalid_house_decision`。
- 逐块节奏：默认**每 ~600 ms 提交 1 块**（`FANGCUN_BUILD_INTERVAL_MS` 覆盖，`0` = 尽快，用于测试/演示加速）。每一步都经 `WorldAuthority.commitHomeStep` 重新校验 grant/allowlist/AABB/baseRev/占用/当日预算，成功后持久化并广播**普通 `commit`**（`actor:"ai"`，每帧恰好 1 个 place op）；队列运行期间 `companion_state=building`，完成后 `idle`。24 块顺序：地板 9 → 墙 7（留门洞、1 块玻璃窗）→ 屋顶 8（留天窗角），材料仅 planks/glass。
- 收尾：在屋内中心上方尝试放 1 块 `stairs` 作为**座位**（座位是 companion 行为概念，`stairs` 只是普通可放置方块）；随后广播 `companion_action{actionId:"sit"}` + `companion_say` 收尾（复用现有帧，不新增表情协议），并把手势状态同步到 pet 视图。座位放置失败不影响整次建造成功，原因记录在 `build.seatError`。
- 竞态与失败：全局只允许一个队列（建造中再次 propose → `409 build_in_progress`）。每一步前复查 world rev 与 grant：玩家编辑导致 rev 变化 → 停止并记 `stale_revision`；grant 撤销 → 停止并记 `grant_revoked`；其它单步拒绝码原样记录（如 `occupied`/`outside_plot`/`block_not_allowed`/`daily_budget`）。**Host 关闭即丢弃队列（不恢复）**，已提交的块保留。
- 自驱动提案（视频演示的“小鱼主动问”）：autonomy tick 在 **grant 有效 + 无 pending 提案 + 无建造队列 + 当前不是 awaiting_approval + plot 内存在可用 3×3（即新的全 plot 搜索）+ 距上次尝试 >45 s + 不在冷却期** 时调用与 `POST /house/propose` 相同的路径，广播 `companion_build_proposal` + `companion_state awaiting_approval` + “我可以在这里盖个小房子吗？”。冷却规则（仅内存，不落库）：主人拒绝 → 60 s 内不再问；`plot_not_clear` / `no_safe_plan` → 120 s 退避；一次小屋建完 → 120 s 内不立刻再问。grant 有效期间 autonomy 不再走旧的“一次性 12 块”提交路径（手动 `POST /companion/tick` 仍保留旧行为以兼容测试）。
- **演示迁移（opt-in，仅本地 demo）**：旧流程在 4×4 grant 原点盖过 2×2 starter home，会挡死该 grant 内**所有** 3×3 候选；live 世界还可能散布玩家方块。默认**关闭**：scan 找不到 3×3 时仍返回 `plot_not_clear`，不做任何迁移。仅当启动环境变量 `FANGCUN_DEMO_RELOCATE_GRANT=1` 且单一 active grant 的 scan 找不到可用 3×3 时：先把 grant 放大到 ≤6×6，仍不行则把 grant 移到最近的空 4×4×4 site；**不删除、不移动任何世界方块**（旧房子原样保留），revoked/多 grant 存档不动，并且在 `meta['demoGrantMigrated']` 打一次性标记，重启不会重复迁移。迁移发生时会打印一条显眼的 `[fangcun][DEMO][grant-migration]` 日志（grant id、旧→新 bounds、原因），并在 `GET /api/core/state` 的 `grantMigration:{at,grantId,from,to,reason}` 中暴露一次。**这不是生产行为**：真实产品移动用户地块前必须征求 owner 同意，故用显式 demo 开关隔离。
- 状态暴露：`GET /api/core/state` 增加 `houseProposal`、`companionState`、`grantMigration` 与 `build:{inProgress,completedBlocks,totalBlocks,intervalMs,lastError,seatPlaced,seatError}`（PC 面板可用 `companionState === "awaiting_approval" && houseProposal != null` 显示“等待主人同意盖房”）；`GET /api/core/autonomy` 增加 `autoHousePropose:true`、`lastHouseProposalAtMs`、`houseProposalCooldownUntilMs`。`GET /api/core/companions/{id}` 也带 `houseProposal`。提案与队列均为内存态，不落库。

### 4.4 MCP（本机）

- 默认 stdio：`node packages/mcp-adapter/dist/server.js --host-url http://127.0.0.1:4174 --token-file <path>`。
- 备用 HTTP：`127.0.0.1:4174` + `Authorization: Bearer <agent token>`；不与手机端口复用。
- 工具清单与 JSON Schema 见 [DSL-SPEC](DSL-SPEC.md) §8。

---

## 5. 数据模型（wire）

### 5.1 基础类型

```ts
type Coord = { x: number; y: number; z: number };          // 整数，WorldSpec v1 范围
// 基础 8 个保持原顺序；其余 9 个只允许在末尾追加（存档方块序号 index+1 因而稳定）。
type BlockId = "grass" | "dirt" | "stone" | "planks" | "log" | "leaves" | "sand" | "glass"
             | "brick" | "tile" | "wool_white" | "wool_red" | "bookshelf" | "lantern" | "pumpkin" | "flower"
             | "stairs";
type Operation =
  | { type: "place"; at: Coord; blockId: BlockId }
  | { type: "break"; at: Coord; expectedBlock: BlockId };
type Aabb = { min: Coord; maxExclusive: Coord };           // 半开区间 [min, maxExclusive)
type Actor = "player" | "ai" | "system";
```

世界不变量（继承 ADR-0001 / WorldSpec v1）：

- 数据域 `16×16×16`，`origin=[-8,0,-8]`，合法 `x,z∈[-8,8)`、`y∈[0,16)`。
- 每格 3 cm；footprint `x,z∈[-7,7)`；地形 `y∈[0,1)`（单层）；建造从 `y≥1` 开始。
- 方块 ID 为稳定字符串（当前 17 个：8 基础 + 8 装饰 + 1 座位块 `stairs`，规范顺序以 `BLOCK_IDS` 为准；`stairs` 是普通可放置方块，“座位”只是 companion 行为语义）；未知 ID 在**权威协议/存档加载**处 fail closed。
- 单笔事务最多 256 个 op；世界最多 4096 个非空块。

### 5.2 错误码

`ack.code`、`error.code`、`plan_resolved.code` 共用一张表：

| 类别 | code | 触发 | 客户端文案（建议） |
|---|---|---|---|
| 协议 | `version_mismatch` | 协议版本不符 | 客户端版本过旧，请更新 |
| 协议 | `unauthorized` | token 无效/过期/被撤销 | 配对已失效，请重新扫码 |
| 协议 | `rate_limited` | 超过频率限制 | 操作太快，请稍后再试 |
| 协议 | `payload_too_large` | 帧/字段超限 | 数据过大 |
| 协议 | `internal_error` | 服务端异常 | 服务端出错了，请重试 |
| 事务 | `stale_revision` | `baseRev` 不是当前 rev | 世界已变化，请重试 |
| 事务 | `sequence_gap` / `sequence_reuse` | seq 不连续/复用 | 连接异常，正在重同步 |
| 事务 | `world_mismatch` | worldId 不符 | 世界不匹配 |
| 事务 | `out_of_bounds` | 坐标越界 | 超出世界范围 |
| 事务 | `protected_terrain` | 改地形层 | 地形不可修改 |
| 事务 | `occupied` | 放置到非空格 | 该格已有方块 |
| 事务 | `empty` | 拆除空格 | 该格没有方块 |
| 事务 | `block_mismatch` | 期望方块不符 | 方块已变化 |
| 事务 | `invalid_operation` | 非法 op/方块 ID | 非法操作 |
| 事务 | `too_many_operations` | 超过 256 op | 一次操作太多 |
| 计划 | `plan_not_found` | planId 不存在 | 计划不存在 |
| 计划 | `plan_expired` | 超 TTL | 计划已过期，请重新规划 |
| 计划 | `plan_stale` | baseRev/hash 不符 | 世界已变化，计划作废 |
| 计划 | `approval_required` | 高风险计划未批准 | 需要你确认后才能建造 |
| 计划 | `approval_mismatch` | approval 与 plan/hash/baseRev 不匹配 | 确认信息不匹配 |
| 计划 | `approval_expired` | approval 超时/已用 | 确认已过期 |
| 计划 | `grant_missing` | 无有效 plot grant | 还没有授权 AI 家园 |
| 计划 | `grant_revoked` | grant 已撤销 | 授权已收回 |
| 计划 | `budget_exceeded` | 超单笔/当日预算 | 今天 AI 的建造额度用完了 |
| 计划 | `tracking_unready` | 无 tracking 就绪会话 | 请把镜头对准桌面再继续 |
| 计划 | `undo_conflict` | 目标格已被改动 | 这次建造已被改动，无法撤销 |
| 计划 | `duplicate_plan` | 重复提交同一 plan | 该计划已提交 |
| 计划 | `no_safe_plan` | 无可行落点/结构 | AI 没有找到合适的建造方案 |

> 文案表放在 `packages/protocol/src/client-messages.ts` 与 Kotlin `ClientMessage.kt`，由同一份 JSON 生成或用黄金用例校验，避免两端漂移。

---

## 6. WebSocket 协议 v2

### 6.1 帧格式与通用规则

- 文本帧，JSON，UTF-8；单帧 ≤ 64 KiB；`hello` ≤ 8 KiB。
- 每条消息必须含 `protocolVersion`（整数 `2`）、`type`、`worldId`（`error` 除外）。
- 未知 `type` 或未知字段：服务端拒绝并返回 `error{code:"invalid_operation"}`；客户端必须断开重连。
- 客户端 `ping` 每 15 s；服务端 2 个周期无 `pong` 即关闭；客户端指数退避重连（1→2→4→8 s，上限 30 s）。
- 服务端可随时广播 `commit`；客户端按 `rev` 严格递增应用，发现缺口立即 `resync`。

### 6.2 客户端 → 服务端

| type | 字段 | 说明 |
|---|---|---|
| `hello` | `clientId, credential, lastAppliedRev, clientInfo{appVersion, platform, arMode, deviceModel?}` | 连接后第一帧；token 只在首帧 |
| `intent` | `seq, baseRev, operation` | 单格放置/拆除；`seq` 从 1 严格递增；玩家 pose freshness 只能来自当前 owner phone session 的 server-received monotonic tracking lease |
| `resync` | `lastAppliedRev` | 发现缺口/重连后请求 |
| `approve_plan` | `planId, diffHash, shownBaseRev` | 用户在 UI 上确认了当前展示版本 |
| `cancel_plan` | `planId` | 取消/拒绝待批准计划（用户点“不建了”也走这里） |
| `home_decision` | `candidateId, approve` | 批准/否决 AI 家园候选 |
| `revoke_plot` | `grantId` | 收回 AI 家园授权 |
| `pause_companion` | `companionId` | 暂停 AI 自主建造 |
| `resume_companion` | `companionId` | 恢复 |
| `undo` | `requestId, txId?` | 撤销最近 AI 事务；省略 txId 表示“最近一笔未被覆盖的 AI 事务” |
| `tracking` | client input: `state, confidence, clientAtMs?`; server snapshot: `state, confidence, serverReceivedAtMs, serverReceivedMonoMs` | 仅 active authenticated Android owner phone session 可发；clientAtMs 只诊断。服务端接收时间由 Host 生成，单调时钟唯一用于 freshness；PC inspector/MCP 不可上报 owner-phone lease |
| `ping` | `nonce` | 心跳 |

`tracking.state` 枚举：`unsupported | permission_denied | paused | tracking_lost | relocalizing | running | ended`。

### 6.3 服务端 → 客户端

| type | 字段 | 说明 |
|---|---|---|
| `welcome` | `rev, snapshot, worldSchemaHash, blockCatalogHash, serverTimeMs, features[], companion, grants[], pendingPlans[], pendingHomeCandidate?` | 全量快照（4096 格）；重连时按需；`pendingPlans` 与 `plan_proposed` 同形，保证断线重连后仍能看到待批准计划 |
| `ack` | `seq, accepted, code?, committedRev, detail?` | 只确认请求；**不推进** replica rev；拒绝时 `code` 必填 |
| `commit` | `rev, txId, actor, operations[], atMs, planId?, undoOf?` | 唯一的 rev 推进来源 |
| `pong` | `nonce, serverTimeMs` | 心跳 |
| `approval_granted` | `approvalId, planId, diffHash, expiresAtMs` | 回执/审计引用，非 bearer；批准决定已由 Host 绑定 original Android owner session 并持久化，不作为 MCP 授权材料 |
| `plan_proposed` | `planId, companionId, scope, plotId?, grantId?, grantRev?, baseRev, diffHash, blockCount, materials[], aabb, summary, requiresApproval, expiresAtMs` | 展示给用户；若 scope 绑定 grant，则 grantId/grantRev 必填并参与 approval/hash binding |
| `plan_resolved` | `planId, status, code?, rev?` | `committed/rejected/expired/cancelled/failed` |
| `home_candidate` | `candidateId, plotId, aabb, baseRev, expiresAtMs, summary` | AI 选址候选 |
| `plot_granted` | `grantId, plotId, companionId, aabb, blockAllowlist[], maxBlocksPerPlan, maxBlocksPerDay, issuedAtMs, expiresAtMs` | 用户批准后 |
| `plot_revoked` | `grantId, revokedAtMs, reason?` | 收回 |
| `companion_state` | `companionId, state, currentPlanId?, bubbleText?, updatedAtMs` | `idle/observing/planning/awaiting_approval/building/cooldown/paused`；实现中也作为 pet/背包变更后的轻量刷新信号（state 可不变） |
| `companion_say` | `companionId, text, expiresAtMs` | ≤80 字；不含 TTS |
| `companion_action` | `companionId, actionId, expiresAtMs` | 桌宠一次性动作；`actionId ∈ {stand, sit, lie, wave, jump, look_around}`，客户端播放/保持到 `expiresAtMs`；由 `PATCH\|POST /api/core/pet` 的 `action` 字段触发（未知 id 被 Host 拒绝）；房子建完后也用它发 `sit` 作为坐下/爱心/💤 表情信号 |
| `companion_build_proposal` | `companionId, proposalId, bounds{min,maxExclusive}, blockCount, expiresAtMs` | companion 高亮一块待批准的小屋建造区；`POST /api/core/house/propose` 触发，TTL 120 s；客户端随后经 `POST /api/core/house/decide` 批/拒。批准后逐块 `commit`（每帧 1 op） |
| `undo_result` | `requestId, accepted, code?, rev?` | 撤销结果；成功时另有 `commit` |
| `error` | `code, message, retryable, detail?` | 协议级错误；可能随后关闭连接 |

`welcome.snapshot`：

```json
{
  "schemaVersion": 1,
  "worldId": "w-...",
  "rev": 17,
  "blocks": ["grass", null, "... 4096 项，x 最快、z 次之、y 最慢 ..."]
}
```

`features` 用于能力协商：`["plan-approval","undo","companion-say","depth-occlusion?"]`，客户端不得假设服务端一定支持不在列表中的能力。

### 6.4 关键时序

**玩家放置**

```text
C: intent {seq: 42, baseRev: 17, operation:{place, at:{...}, blockId:"planks"}}
S: ack {seq:42, accepted:true, committedRev:18}
S: commit {rev:18, txId:"tx-...", actor:"player", operations:[...]}   → 所有会话
```

**AI 家园计划（需批准）**

```text
S: plan_proposed {planId:"p-...", scope:"home_plot", baseRev:18, diffHash:"...", blockCount:12, requiresApproval:true, expiresAtMs}
C (authenticated owner phone session): approve_plan {planId, diffHash, shownBaseRev:18}
S DB: atomically persist an approved decision bound to the authenticated phone session_token_hash + owner + companion + plot/grantId/grantRev + plan/hash/baseRev + expiry
S: approval_granted {approvalId:"opaque-audit-id", planId, diffHash, expiresAtMs}  -- receipt/reference only, not a capability
Trusted local MCP adapter (server-side authenticated request context): build_commit {planId}  -- resolves current approved decision from server storage
S: commit {rev:19, actor:"ai", planId, operations:[...]}
S: plan_resolved {planId, status:"committed", rev:19}
```

**自动批准（home_plot + 纯放置空格）**

```text
S: plan_proposed {requiresApproval:false, ...}
S: commit {rev:20, actor:"ai", planId, operations:[...]}
S: plan_resolved {planId, status:"committed", rev:20}
```

自动批准条件（全部满足）：`scope=home_plot`、全部 op 为 `place`、目标格为空、全部在有效 grant 的 AABB 内、方块在 grant allowlist、`blockCount ≤ maxBlocksPerPlan`、当日预算足够、`baseRev` 当前、tracking 就绪、无冲突。任一不满足 → `requiresApproval:true` 或拒绝。

**撤销**

```text
C: undo {requestId:"u-1", txId:"tx-..."}
S: （校验逆操作可应用）
S: commit {rev:21, actor:"system", undoOf:"tx-...", operations:[逆操作]}
S: undo_result {requestId:"u-1", accepted:true, rev:21}
```

### 6.5 顺序、幂等与重放

- `intent.seq` 按 session 严格递增；重复 seq 且 payload 相同 → 返回原 `ack`（幂等）；payload 不同 → `sequence_reuse`。
- `baseRev` 不等于当前 rev → `stale_revision`；客户端收到后 `resync` 或重新展示最新状态。
- `commit.rev` 必须等于 `lastAppliedRev+1`；否则进入 `gap` 并 `resync`。
- 服务端保留最近 256 条 commit 的环形缓存；超出后 `resync` 回全量 `welcome`。
- 所有 `txId` 全局唯一；重复 `txId` 视为已应用（幂等广播）。

---

## 7. 持久化（SQLite）

### 7.1 连接与 PRAGMA

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

数据库文件：`%LOCALAPPDATA%\Fangcun\world\<worldId>.sqlite`；启动时 `PRAGMA integrity_check`，失败进入恢复流程（§7.4）。

### 7.2 表结构

> Approval 行保存**批准决定的审计与绑定**，不是 token/bearer。消费权限来自可信本机 MCP adapter 的 server-side request context（其中包含已认证 Android owner session 的 token hash）；不能仅凭 `approval_id` 取用。approval 同时绑定 `owner_user_id / companion_id / plot_id / grant_id / grant_rev / plan_id / diff_hash / base_rev / expires_at_ms`。撤销 owner session 或 grant 时，在同一 DB transaction 中将相应未消费 approval 置 `invalidated_at_ms`；plan/grant reissue 也必须使 grantRev 不匹配的旧 plan/approval 失效。

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
); -- schemaVersion, worldId, createdAt, worldSchemaHash, blockCatalogHash,
   -- companionProfiles, userInventory, petScale, warehouseSeedVersion,
   -- demoGrantMigrated（仅 FANGCUN_DEMO_RELOCATE_GRANT=1 的一次性 demo 迁移标记）
   --（旧版 petProfile 仅迁移时读）

CREATE TABLE world (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rev INTEGER NOT NULL,
  blocks BLOB NOT NULL,              -- 4096 字节；0=空，1..16=方块序号（BLOCK_IDS 顺序）；palette 由 blockCatalogHash 绑定
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE world_backup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rev INTEGER NOT NULL,
  blocks BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL
); -- 仅保留最近 3 份

CREATE TABLE commits (
  rev INTEGER PRIMARY KEY,
  tx_id TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,               -- player|ai|system
  plan_id TEXT,
  undo_of TEXT,
  ops_json TEXT NOT NULL,            -- 规范化后的 op 列表
  inverse_json TEXT,                 -- 可撤销时为逆操作；不可撤销为 NULL
  at_ms INTEGER NOT NULL
);

CREATE TABLE plan (
  plan_id TEXT PRIMARY KEY,
  companion_id TEXT NOT NULL,
  plot_id TEXT,
  grant_id TEXT,
  grant_rev INTEGER,
  scope TEXT NOT NULL,               -- home_plot|home_site|player_request
  base_rev INTEGER NOT NULL,
  grant_rev INTEGER,                  -- captured at plan creation; rechecked atomically at commit
  diff_hash TEXT NOT NULL,
  ops_json TEXT NOT NULL,
  block_count INTEGER NOT NULL,
  status TEXT NOT NULL,              -- proposed|awaiting_approval|approved|committing|committed|rejected|expired|cancelled|failed|grant_revoked
  approval_id TEXT,                    -- opaque audit/reference id, never a bearer
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  FOREIGN KEY (grant_id) REFERENCES grant(grant_id)
);

CREATE TABLE approval (
  approval_id TEXT PRIMARY KEY,      -- audit/reference id; not a bearer credential
  plan_id TEXT NOT NULL,
  session_token_hash TEXT NOT NULL,  -- exact authenticated phone session which approved
  owner_user_id TEXT NOT NULL,
  companion_id TEXT NOT NULL,
  plot_id TEXT,
  grant_id TEXT,
  grant_rev INTEGER,
  diff_hash TEXT NOT NULL,
  base_rev INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  decision_status TEXT NOT NULL CHECK (decision_status IN ('approved','consumed','invalidated')),
  used_at_ms INTEGER,
  invalidated_at_ms INTEGER,
  FOREIGN KEY (plan_id) REFERENCES plan(plan_id),
  FOREIGN KEY (session_token_hash) REFERENCES session(token_hash),
  FOREIGN KEY (grant_id) REFERENCES grant(grant_id)
);

CREATE UNIQUE INDEX approval_one_pending_per_plan
  ON approval(plan_id) WHERE decision_status='approved' AND used_at_ms IS NULL AND invalidated_at_ms IS NULL;

CREATE TABLE grant (
  grant_id TEXT PRIMARY KEY,
  plot_id TEXT NOT NULL UNIQUE,
  grant_rev INTEGER NOT NULL,
  companion_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  aabb_json TEXT NOT NULL,
  allowlist_json TEXT NOT NULL,
  max_per_plan INTEGER NOT NULL,
  max_per_day INTEGER NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER,
  revoked_at_ms INTEGER
);

CREATE TABLE budget (
  day TEXT NOT NULL,                 -- UTC YYYY-MM-DD, derived by Host from trusted nowMs
  companion_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  blocks_used INTEGER NOT NULL CHECK (blocks_used >= 0),
  PRIMARY KEY (day, companion_id, grant_id),
  FOREIGN KEY (grant_id) REFERENCES grant(grant_id)
);

CREATE TABLE companion (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  current_plan_id TEXT,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE session (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_name TEXT,
  platform TEXT,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  last_seen_ms INTEGER
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  type TEXT NOT NULL,                -- commit|plan_proposed|plan_approved|plan_rejected|grant_issued|grant_revoked|undo|session_paired|session_revoked|world_restored|config_changed
  actor TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
```

### 7.3 提交算法（单事务）

```text
BEGIN IMMEDIATE
  nowMs = Host monotonic/security clock; day = UTC_DATE(server wall clock)
  world = SELECT ...                                  -- 单行
  if baseRev != world.rev → ROLLBACK, stale_revision
  if plan.plan_id != requested planId OR plan.diff_hash != recomputed canonical diffHash → ROLLBACK, plan_stale
  if plan.base_rev != world.rev OR plan.status not committable OR plan.expires_at_ms <= nowMs → ROLLBACK, plan_stale
  if AI plan: 重读 plan + 当前 grant（plan.grantId=grant.grantId AND plan.grantRev=grant.grantRev，expires/revoked 均复查）
  if grant 无效/已撤销/已过期/版本不符 → ROLLBACK, grant_revoked
  if owner/companion/session/plot/hash/approval binding 不符 → ROLLBACK, approval_mismatch
  if plan.requiresApproval AND 没有该 Android owner session 批准的 pending decision → ROLLBACK, approval_required
  if plan.requiresApproval=false AND 不满足服务端 home_plot auto policy → ROLLBACK, approval_required
  if 玩家 intent: 确认发起 session 为 owner Android phone 且 trackingReady
  if AI 自动家园计划: 确认有效 plot-only safe policy + 活跃 owner phone lease；不可消费人工 approved decision
  按当前 world rev 对所有 op 全量校验；生成 copy + inverse；拒绝破坏/冲突/超限
  if AI plan:
    day = UTC YYYY-MM-DD（由 Host 当前 UTC 时间生成，不接受客户端 day/timezone）
    if actor == 'ai' AND plan.scope == 'home_plot':
      INSERT INTO budget(day, companion_id, grant_id, blocks_used)
        VALUES (:day, :companionId, :grantId, :n)
        ON CONFLICT(day, companion_id, grant_id) DO UPDATE
          SET blocks_used = blocks_used + excluded.blocks_used
          WHERE blocks_used + excluded.blocks_used <= min(:grantMaxBlocksPerDay, :globalMaxBlocksPerDay);
      if changes() != 1 → ROLLBACK, budget_exceeded
      -- 不可信检查/拒绝/回滚不得留下已消费预算
  INSERT INTO commits(rev, tx_id, actor, plan_id, undo_of, ops_json, inverse_json, at_ms)
    VALUES (world.rev+1, tx_id, actor, plan_id, undo_of, opsJson, inverseJson, nowMs)
  UPDATE world SET rev=rev+1, blocks=copy
  UPDATE plan SET status='committed'（如来自 plan）
  if plan.requiresApproval:
    UPDATE approval SET decision_status='consumed', used_at_ms=:nowMs
      WHERE plan_id=:planId AND decision_status='approved'
        AND invalidated_at_ms IS NULL AND used_at_ms IS NULL AND expires_at_ms>:nowMs
        AND session_token_hash=:authenticatedOwnerSessionHash
        AND owner_user_id=:planOwner AND companion_id=:companionId
        AND plot_id=:plotId AND grant_id=:grantId AND grant_rev=:currentGrantRev
        AND diff_hash=:recomputedDiffHash AND base_rev=:planBaseRev
    if changes()!=1 → ROLLBACK, approval_mismatch
  else:
    assert trusted server home_plot auto policy is still satisfied inside this transaction
  INSERT audit
COMMIT
broadcast commit {rev, txId, actor, operations}
```

- `budget` schema 的复合主键 `(day, companion_id, grant_id)` 与以上 `ON CONFLICT(day, companion_id, grant_id)` 必须完全一致；`excluded.blocks_used` 即当前事务申请的 n。必须读取该 UPSERT 后立即返回的 SQLite `changes()`（Node `node:sqlite` `StatementSync.run().changes`），并要求等于 1；为 0 表示条件更新未通过，整个事务（包括预算行、plan、commit、world rev 和 approval 状态）全部 rollback 并返回 `budget_exceeded`。
- UTC 日界：`day = UTC YYYY-MM-DD`，只使用 Host 当前可信 UTC 时钟；禁止从 AI、客户端、MCP 或 tracking frame 接受 day/timezone。跨 UTC 日自然使用新的 budget key；额度仅按已 commit 的 block_count 消费，failed/preview/rollback 不消费。`INSERT ... ON CONFLICT ... WHERE` 在首次插入（`n≤limit`）与预算内更新均报告一行 changes；预算超限 conditional update 为零行 changes。
- 撤销 session/grant 与 AI commit 同用 `BEGIN IMMEDIATE` 串行化：先提交的撤销将 pending approval/grant 标 invalidated/revoked，后续 commit 重读后失败；先提交成功的 commit 会先消耗 budget 和 decision，再收到后续撤销。
- `synchronous=FULL` 保证 WAL fsync 后才返回 `commit`；`ack` 在提交成功后发送。
- 任何一步失败 → `ROLLBACK`，不得出现“部分格子成功”。
- 提交成功后若广播失败（客户端断开），客户端重连时通过 `resync`/`welcome` 补齐。

### 7.4 快照、恢复与备份

- `world.blocks` 本身就是最新快照；每次提交前把旧 `blocks` 写入 `world_backup`（最多 3 份）。
- 启动：
  1. `PRAGMA integrity_check`；
  2. 校验 `meta.worldId` 与 `world.id` 一致、`rev` 与 `commits` 最大 rev 一致；
  3. 校验 `blocks` 长度 4096、字节值合法；
  4. 任一项失败 → 用最近一份 `world_backup` 恢复，写 `audit(type='world_restored')`，并在 Host UI 告警；
  5. 无可用备份 → **拒绝启动**（`WORLD_CORRUPT`），提示用户从备份目录恢复；不静默清空。
- 备份：`POST /admin/backup` 执行 `VACUUM INTO '<path>'`；保留最近 5 份；升级/迁移前自动备份。
- 迁移：`meta.schemaVersion` 顺序迁移；未知版本拒绝启动。

### 7.5 审计

- 每个计划、批准、撤销、grant、session、恢复动作都写 `audit`。
- `payload_json` 不含 token、证书私钥、相机帧、完整对话；只保留 planId/diffHash/rev/actor/结果码。
- 保留期：默认 90 天；`/admin/state` 显示最近 50 条；导出 CSV 由后续版本提供。

---

## 8. 计划、授权与预算

### 8.1 scope

| scope | 语义 | 批准要求 |
|---|---|---|
| `home_site` | AI 提议家园选址 | 用户显式 `home_decision` |
| `home_plot` | 已授权 plot 内建造 | 纯放置空格 + 预算内 → 自动；否则人工 |
| `player_request` | 响应玩家“帮我盖…” | 默认人工确认；若完全在 home_plot 且纯放置 → 自动 |

### 8.2 计划/批准生命周期

- `plan` 行必须保存 `grant_id + grant_rev`（适用时），`diff_hash/base_rev/expires_at_ms/status`。
- 每次 commit（包括自动批准路径）在同一个 `BEGIN IMMEDIATE` 事务里重读当前 grant 和 plan；必须匹配当前 `grant_id/grant_rev`、未 revoked、未过期。任何 revoke/reissue 都令旧 grantRev 上的所有未提交 plan 与未消费批准决定原子失效。
- `approve_plan` 只从 plan 对应的 active Android owner session 接收，Host 比对当前展示的 hash/baseRev 后持久化 policy decision。`session_token_hash` 是“谁批准”的审计字段；MCP side 的 authenticated request context 决定其能否消费，不允许通过传入任意 `approvalId` 冒充该 session。
- 批准记录绑定 session hash、owner、companion、plot/grantId/grantRev、planId、diffHash、baseRev、expiry。消费时在世界提交事务内执行一次性 conditional update；`changes()!=1` 即 rollback。session 或 grant revoke 同样事务性 invalidate 尚未消费记录。
- Home-plot 自动批准是独立服务端策略分支，不生成可复用 approvalId；它只能提交当前有效 grant 内只放置空格、allowlist 和预算均满足的计划。

### 8.3 默认限额

| 项 | 默认 | 可配置 |
|---|---|---|
| 单 plan 方块数 | 24（grant 上限 64） | grant 字段 |
| 每日 AI 方块数 | 120 | grant 字段 |
| plan TTL | 300 s | 全局 |
| approval TTL | 120 s | 全局 |
| AI 提交最小间隔 | 5 s | 全局 |
| intent 频率 | 10/s/session | 全局 |
| 世界最大非空格 | 4096 | WorldSpec |
| 单笔最大 op | 256 | 协议 |

### 8.4 家园选址

- 候选 AABB：4×4 到 8×8（x/z），`y` 从 `terrainTopY` 起；必须全空、在 footprint 内、与玩家方块距离 ≥2 格。
- 服务端生成候选列表（最多 5 个）并评分（平整度、遮挡、距玩家建筑距离、预算）；AI 只能从中选，不能自造坐标。
- 用户批准 → 写 `grant` 并广播 `plot_granted`；否决 → 重新候选；连续 3 次否决后冷却 10 分钟。

### 8.5 追踪就绪（tracking lease）

- 服务端维护每个会话最近一次 tracking state、confidence、`serverReceivedAtMs` 与进程单调 `serverReceivedMonoMs`；每条消息只能从 active authenticated Android owner phone session 更新该 lease。PC inspector/MCP 及未来访客 session 无权提供可用于写入的 tracking。
- `clientAtMs` 是可选诊断字段。Host 必须忽略它作为 freshness 依据，不得因 client 时钟领先而延长 lease，也不得接收客户端时区/day 用于预算。
- 玩家 `intent`：要求**发起该 intent 的同一个 phone session**满足 `state=="running" && nowMono-serverReceivedMonoMs ≤ 500`，否则 `tracking_unready`。
- AI 自动提交：要求**至少一个**active owner phone session 满足 `state=="running" && nowMono-serverReceivedMonoMs ≤ 1500`；该 1500 ms 是 AI presence lease，不是玩家点击许可的 500 ms lease。否则 companion 进入 `paused` 并广播 `companion_state`。
- 恢复 tracking 后不自动补做旧计划；旧计划超 TTL 即 `expired`。

---

## 9. PC 检视页

- 页面由 Host 静态托管；三维视图使用 three.js + GLTFLoader；体素用 `InstancedMesh` 或合并几何；与手机显示同一 `rev`。
- 连接：loopback WS，`clientInfo.platform="pc-inspector"`；只读 + 审批/暂停/撤销。
- 必须显示：连接状态、rev、tracking 状态、companion 状态、待批准计划、最近 10 条审计、错误码。
- 不加载外部 CDN；CSP 禁止 `connect-src` 到非 loopback。
- 不持久化 token；刷新后重新用 `?t=` 换取。

---

## 10. MCP / DSH 边界

- 工具面（详见 DSL-SPEC §8）：`world_observe`、`home_propose`、`build_plan`、`build_commit`、`build_cancel`、`world_undo`、`companion_say`。
- `build_commit` 必须带 `planId + approvalId`；自动批准路径由服务端策略判定，模型不能自签。
- 工具返回结构化错误码，不返回堆栈/文件路径/token。
- MCP 进程以独立低权限用户运行（可选）；只能访问 loopback worldd 与 `companion-runtime`；不读摄像头、不读用户目录。
- DSH 侧接入方式（MCP stdio / 宿主插件）在 M0 验证后固定；两种方式共用同一工具 schema 与 policy 层。

---

## 11. 测试用例（实现前先写成测试）

### 11.1 协议/顺序

1. `seq` 重复且 payload 相同 → 返回同一 `ack`，rev 不变。
2. `seq` 重复但 payload 不同 → `sequence_reuse`，连接保持。
3. `baseRev` 落后 → `stale_revision`；客户端 `resync` 后恢复。
4. 乱序 `commit`（rev 跳号）→ 客户端进入 gap，不应用；`resync` 后一致。
5. 未知 `type`/未知字段 → `invalid_operation` + 断开。

### 11.2 并发

6. 两个会话同时写同一格：一个成功，另一个 `occupied`/`stale_revision`；服务端 rev 只 +1。
7. `grant` 撤销与 AI 提交并发：撤销后提交必须 `grant_revoked`。
8. 玩家在 AI 计划 hash 校验期间改世界：AI 提交 `plan_stale`，不写入。
9. 两个计划同时命中同一空格：先到先得，后到 `occupied`。

### 11.3 持久化

10. 提交后杀进程 → 重启 rev/世界一致。
11. WAL 截断/快照损坏 → 从 `world_backup` 恢复并审计；无备份则拒绝启动。
12. 备份恢复后 rev 单调、`commits` 链完整。

### 11.4 安全

13. 错误 token/过期 token/撤销 token → `unauthorized`，不泄露 worldId。
14. 错误证书指纹 → 客户端拒绝连接（抓包验证）。
15. 超大帧（>64 KiB）→ `payload_too_large` 并断开。
16. 越界坐标/非法方块/负坐标 → 拒绝，进程不崩。
17. prompt injection 文本（方块名/结构名/聊天）→ 只作为数据，不改变工具权限；`build_commit` 仍需 approvalId。

### 11.5 撤销/预算

18. `undo` 目标格已被玩家改动 → `undo_conflict`，不写。
19. 同一 txId 二次 undo → `undo_conflict`/`plan_not_found`，不重复反向。
20. 达到当日预算 → `budget_exceeded`，companion 暂停到次日 UTC 0 点。

---

## 12. 版本与兼容

- `protocolVersion` 为整数；**任何 wire 变更都升版本**（v0 客户端与 Host 同包发布，不做向后兼容）。
- `schemaVersion` 为世界存档版本；迁移必须可回滚（迁移前自动备份）。
- `blockCatalogHash` 变化（增删方块）视为破坏性变更，需同时升 `WorldSpec` 与协议版本。
- 黄金用例：`packages/protocol/golden/*.json`，每个消息至少 1 个正例 + 1 个反例；Kotlin 与 TS 两侧都必须跑通。

---

## 13. 未决问题

1. Host UI 形态：命令行 + 本地网页，还是 Windows 托盘应用？（建议 v0 命令行 + 网页）
2. 是否允许 PC 检视页发起 `intent`（玩家用 PC 放置）——建议 v0 不允许。
3. 多世界支持——v0 单世界；`worldId` 已预留，多世界需另立 ADR。
4. 审计导出与保留期——v0 固定 90 天，导出后续版本。
5. 证书轮换与 IP 变化的用户提示文案——M0 配对 spike 后定稿。
