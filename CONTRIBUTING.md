# 贡献指南 · Contributing

> 仓库：**https://github.com/60777flowers/fangcun**
> 先读 **[docs/ADR-0003](docs/ADR-0003-android-client-and-ar-stack.md)**（客户端/AR 技术栈决策）与 **[docs/TECH-ROADMAP](docs/TECH-ROADMAP.md)**（执行计划），再读 **[docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)**（范围与验收）。**[docs/DEV.md](docs/DEV.md) 是历史草案，禁止直接按其中的协议/尺寸实现。**

---

## 1. 十分钟上手

```bash
git clone https://github.com/60777flowers/fangcun.git
cd fangcun

# 安装、类型检查和单元测试
npm ci
npm run typecheck
npm test

# 启动已实现的桌面沙盒预览（不含 AR/联网）
npm run simulator        # 打开 http://127.0.0.1:4173/
npm run test:simulator   # Chrome 浏览器交互回归
```

> Android ARCore/marker provider、APK、联网 worldd/WAL 与 DSH 实际适配仍未完成；目标模块和验收门见 [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)。
> 不要为跑示例而下载或复制未确认授权的角色模型；本地模型导入/运行说明须在资产、安全和存储规范完成后另行提供。

## 2. 分支与提交

**分支模型：`beta` 集成 + `main` 发布 + 短生命周期特性分支。**

```
feature 分支 ──PR──▶ beta ──(验证通过)──▶ main ──▶ tag vX.Y.Z
```

| | |
|---|---|
| `beta` | **集成分支，也是默认分支。所有 PR 都提到这里。** 日常开发合入这条线，允许短暂不稳定 |
| `main` | **发布分支**。只接受来自 `beta` 的合入，随时可构建、测试全绿；对外宣传和版本 tag 以这里为准 |
| 特性分支 | 从 `beta` 切出、**按一个可验证的切片命名**，PR 合入后立即删除（本地与远端都删） |
| 分支命名 | `feat/<短描述>`、`fix/<短描述>`、`docs/<短描述>`、`chore/<短描述>`；用短横线，全小写，≤5 个词 |
| 合入方式 | 外部贡献走 PR 到 **`beta`**（Squash merge）；维护者小改动可 fast-forward 保持线性 |
| 发布节奏 | `beta` 上 `npm run build && npm test && npm run test:browser` 全绿后，`beta` → `main` 合入并打 tag |
| 版本标记 | 只在 `main` 上打 annotated tag，形如 `v0.1.0-demo`、`v0.2.0-ar-lan`；不建 release 分支 |
| 过期分支 | 合入后当天删除；超过两周未动的分支先 rebase 到最新 `beta`，仍无进展则关闭 |
| 提交信息 | Conventional Commits：`feat(mesher): greedy meshing`、`fix(sync): 回滚时未清 pending` |
| PR 大小 | 单 PR ≤ 400 行改动；大改先开 issue 对齐 |

> 本地开发请先 `git checkout beta && git pull`，再从 `beta` 切特性分支。
> 历史阶段分支（`feat/phase1-voxel-sandbox`、`feat/companion-extensibility`）已合入 `main` 并删除；
> 需要追溯请用 `git log`，不要恢复成长期分支。

## 3. PR 检查清单

> Node 工作区与 Linux CI 已建立（`npm ci` / `npm run typecheck` / `npm test` 可跑）；**Android 构建与 CI 尚未建立**（无 Gradle wrapper，工具链升级见 TECH-ROADMAP M0-1）。以下门槛中与 Android/协议 v2/原生客户端相关的部分仍是目标，不是当前成绩。

- [ ] workspace 脚本真实存在并在干净检出中通过
- [ ] schema/协议变更同步更新 client、worldd、DSH adapter，并通过兼容/迁移测试
- [ ] 性能结论附设备、OS、浏览器和原始数据，不用 PC 截图代替真机数据
- [ ] 新增素材 → 先完成逐文件权利核验并在资产台账登记来源、许可原文/hash、署名和 build channel；LICENSE 备注不能替代授权
- [ ] 新增模型 → **不要把 `.vrm` 提交上来**（见 §4）

## 4. 素材红线（会卡住合并）

> 仓库当前已跟踪的带水印视觉图、角色模型渲染截图也须清理/补全授权；未来新增审核不代表现存文件已获许可。见 [docs/REVIEW.md](docs/REVIEW.md)。

| 类型 | 规则 |
|---|---|
| 角色模型 `.vrm` / `.zip` | **一律不入库**。`.gitignore` 已排除；本地使用也须确认对应许可和来源，不要由仓库提供未授权下载/分发指引。 |
| 模型截图/渲染图 | 未取得相应公开分发许可前不得新增或发布；署名不自动等于授权 |
| Minecraft 官方纹理 | **禁止**。用逐项核验许可的资产或程序化生成 |
| 效果图 `效果图/` | 当前已跟踪，但公开再分发权利链未确认；不得把“非 MIT/仅参考”当成授权，发布门禁见 [docs/REVIEW.md](docs/REVIEW.md) |

## 5. 当前的第一优先级任务

按 [docs/TECH-ROADMAP.md](docs/TECH-ROADMAP.md) 的 M0/M1：

1. **M0 原生 ARCore/SceneView、LAN TLS 配对、DSH 工具面验证**：真机跑通 SceneView + glTF + 自定义网格；证书指纹固定配对；mock 工具闭环（见 [docs/DEVICE-TEST-PLAN.md](docs/DEVICE-TEST-PLAN.md)）
2. **M1 协议 v2 + DSL + 黄金用例**：冻结 [docs/HOST-API.md](docs/HOST-API.md) 与 [docs/DSL-SPEC.md](docs/DSL-SPEC.md)，建立跨语言一致性测试
3. **M2 Host + PC 检视页 / M3 Android 客户端核心**：契约冻结后并行

正式角色制作、iOS、独立桌宠窗和真实 Minecraft 联动均不阻塞 v0。

## 6. 有问题找谁

- 文档与需求：见 [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)；问题按 ADR 记录
- 架构决策：`docs/IMPLEMENTATION-PLAN.md` 与后续 ADR，**改架构先记录决策再改代码**
