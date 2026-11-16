# 贡献指南 · Contributing

> 仓库：**https://github.com/60777flowers/fangcun**
> 先读 **[docs/DEV.md](docs/DEV.md)**（架构 / 接口契约 / 里程碑），再动手。

---

## 1. 十分钟上手

```bash
git clone https://github.com/60777flowers/fangcun.git
cd fangcun

# 看效果（现在唯一能跑的部分）
cd preview
npm install
node shot.mjs            # headless Chrome 渲染一帧 → preview/m0.png
```

> 工程骨架（`packages/voxel-core` / `worldd` / `client`）**还没搭**，见 DEV.md 附录 B。
> 想跑 VRM 验货：`node vrm-shot.mjs`（需先把自己的 `.vrm` 放到 `preview/assets/_user_xxx.vrm`，见 §4）。

## 2. 分支与提交

| | |
|---|---|
| 主分支 | `main`（保护，只能通过 PR 合入） |
| 分支命名 | `feat/<短描述>`、`fix/<短描述>`、`docs/<短描述>` |
| 提交信息 | Conventional Commits：`feat(mesher): greedy meshing`、`fix(sync): 回滚时未清 pending` |
| PR 大小 | 单 PR ≤ 400 行改动；大改先开 issue 对齐 |

## 3. PR 检查清单（合并前必须全绿）

- [ ] `npm run typecheck` 通过
- [ ] `npm run test` 通过
- [ ] `npm run bench` 无性能回归（把数字贴进 PR）
- [ ] 改了 `voxel-core/intent.ts` 的类型 → **三端同步**（`worldd` / `client` / `tools`）
- [ ] 新增素材 → 在 `LICENSE` 的"素材"一节登记来源与许可
- [ ] 新增模型 → **不要把 `.vrm` 提交上来**（见 §4）

## 4. 素材红线（会卡住合并）

| 类型 | 规则 |
|---|---|
| 角色模型 `.vrm` / `.zip` | **一律不入库**。`.gitignore` 已排除。自己下载后放本地 |
| 模型截图 | 可以入库，**必须署名作者**（当前使用的模型见 README「角色模型」章节） |
| Minecraft 官方纹理 | **禁止**。用 CC0（`programmer-art` 一类）或程序化生成 |
| 效果图 `效果图/` | 已入库，但**不属于 MIT**，仅作设计参考 |

## 5. 当前的第一优先级任务

按 DEV.md §9 的里程碑，缺的是：

1. **附录 B 脚手架**（30 分钟）—— 谁先接手谁搭，搭完提交
2. **M0.5 VRM 冒烟测试**（0.5–1 天）—— 真模型进场景，验加载/描边/阴影/帧率
3. **M1 WebXR 放置**（2–4 天）—— Android 先跑通

## 6. 有问题找谁

- 文档与需求：见 `docs/DEV.md` 的「待决问题」（§14）
- 架构决策：`docs/DEV.md` §10 的 ADR 记录，**改架构先改 ADR 再改代码**
