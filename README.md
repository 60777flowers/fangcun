# 方寸 · Fangcun

> **在真实桌面上，出现一个 Minecraft 风格的微缩世界；你用手机摄像头看着它，用手指和 AI 角色一起建造。**

一句话定位：**AR 桌面微缩沙盒**（tabletop AR sandbox）——不是 PC 游戏、不是投屏、不是 VR。

```
        ☁  真实桌面背景（虚焦）
   ┌──────────────────────────────┐
   │   🌳                         │
   │  🏠  敞口木板房              │
   │ 🧰 ▓TNT        ⛏ 钻石镐      │
   │ ████████████████  ~1.2 格的角色站在这
   │ ══════════════   接触阴影     │
   └──────────────────────────────┘
        手机 = AR 取景器 + 输入设备
```

---

## 现在该读哪份文件

| 你想… | 读 |
|---|---|
| **马上开始写代码** | **[docs/DEV.md](docs/DEV.md)** —— 架构、接口契约、角色模型规格、里程碑、ADR（**先读这一份**） |
| 看我们自己渲染出来的第一版 | [docs/m0-final.png](docs/m0-final.png)（可复跑：`cd preview && npm i && node shot.mjs`） |
| 看完整调研结论与选型理由 | [REPORT.md](REPORT.md) |
| 看调查计划原文 | [PLAN.md](PLAN.md) |
| 看某一专项的原始报告 | [reports/](reports/) 下的 `report-a…i` + 审阅报告 |

## 两条产品铁律

1. **世界里只有一个角色**（默认大肥鱼），但角色是**可选、可替换**的（`vrm → glb → billboard8 → 胶囊` 降级链）。
2. **玩家本人不出现在世界里** —— 没有玩家化身/皮肤/身体。玩家是"上帝之手"：手指点哪就在哪放/拆。

## 视觉参考图（**不在仓库内**）

`效果图/1.png`、`2.png`、`3.png` 是**AI 视频生成的帧**，带第三方平台水印，因此**不随仓库分发**，由项目负责人单独提供到本地 `效果图/` 目录（已在 `.gitignore` 中）。

> 它们只作**感觉参考**，不是规格：同一段视频里角色数量/身高/位置都在变（生成模型的一致性缺陷）。
> **采其"感觉"，不采其"数字"** —— 详见 [docs/DEV.md](docs/DEV.md) §1.1。

## 目录

```
fangcun/
├─ docs/DEV.md            开发文档（先读这个）
├─ docs/m0-final.png      M0 渲染结果
├─ preview/               M0 可跑原型（three.js，零美术资源）
├─ REPORT.md              调研总报告
├─ PLAN.md                调查计划
└─ reports/               子报告 a–i + 对抗性审阅
```

## 快速开始

```bash
cd preview
npm install
node shot.mjs        # 用 headless Chrome 渲染一帧 → preview/m0.png
```

> 工程骨架（`packages/voxel-core` / `worldd` / `client`）**尚未搭建**，见 DEV.md 附录 B 的 30 分钟脚手架清单。

## 尚未决定的事

- 开源还是闭源、用什么许可（当前仓库为 private，无 LICENSE）
- 正式角色美术：VRoid 自捏 / 外包定制 / 用户自选
- **占位模型 `preview/assets/RobotExpressive.glb` 来自 three.js 官方示例，仅用于开发，不得随产品发布**
