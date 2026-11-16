# 贡献指南 · Contributing

> 仓库：**https://github.com/60777flowers/fangcun**
> 先读 **[docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)**（当前范围、架构建议、接口与验收），再动手。**[docs/DEV.md](docs/DEV.md) 是历史草案，禁止直接按其中的协议/尺寸实现。**

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

| | |
|---|---|
| 主分支 | `main`（保护，只能通过 PR 合入） |
| 分支命名 | `feat/<短描述>`、`fix/<短描述>`、`docs/<短描述>` |
| 提交信息 | Conventional Commits：`feat(mesher): greedy meshing`、`fix(sync): 回滚时未清 pending` |
| PR 大小 | 单 PR ≤ 400 行改动；大改先开 issue 对齐 |

## 3. PR 检查清单

> 正式 workspace 和 CI 尚未建立。以下为**落地后的目标门槛**，不能误认为当前命令已可运行；首个工程任务是让 fresh clone 可执行 install/typecheck/test/build。

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

按 [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) 的顺序：

1. **M0 Android AR/TLS/WSS 风险 spike**：真机验证 WebXR 桌面锚定、透明渲染和可复现 LAN 配对
2. **M1 workspace + 共享 schema**：建立可构建/可测试骨架，统一坐标和协议
3. **M2 体素渲染迁移**：从静态 preview 提取确定性可测试核心

正式角色制作、iOS、独立桌宠窗和真实 Minecraft 联动均不阻塞 v0。

## 6. 有问题找谁

- 文档与需求：见 [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)；问题按 ADR 记录
- 架构决策：`docs/IMPLEMENTATION-PLAN.md` 与后续 ADR，**改架构先记录决策再改代码**
