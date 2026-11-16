# 方寸 · Fangcun

> **在真实桌面上，出现一个 Minecraft 风格的微缩世界；你用手机摄像头看着它，用手指和 AI 角色一起建造。**

**仓库**：<https://github.com/60777flowers/fangcun>　｜　**许可**：根目录代码/文档按 [LICENSE](LICENSE)；子包须核对元数据（素材除外）　｜　**协作**：[CONTRIBUTING.md](CONTRIBUTING.md)

```bash
git clone https://github.com/60777flowers/fangcun.git
```


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

## 当前项目状态

> **产品方向已确认：**在真实物理桌面上用 Android 设备摄像头呈现 MC 风格微缩方块世界；玩家参与建设，大肥鱼 AI 在同一世界协作建设。支持 ARCore 的设备优先用 WebXR 平面追踪；不支持的设备将评估打印定位标记的摄像头跟踪兼容模式，但该路线仍待技术 spike 与设备验收。v0 不含真实 PC Minecraft 联动、Windows 独立桌宠窗口、iOS 真 AR、多人、语音。
> **实现状态：**已搭建共享 TypeScript 工作区，落地 16³ WorldSpec、分阶段协议消息校验/有界 frame codec、确定性岛屿、原子体素事务与内存版 `WorldAuthority`；PC 桌面沙盒已可运行。尚无持久化/WAL、联网会话、HTTPS/WSS 配对、真实 Android ARCore/WebXR、原生打印标记 provider、DSH/MCP 适配或正式角色资产。不得把计划写成已交付能力。

## 现在该读哪份文件

| 你想… | 读 |
|---|---|
| **接手实现** | **[docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)** —— 已确认范围、单一架构/协议建议、分模块任务和可测验收 |
| 查看独立审核结论 | [docs/REVIEW.md](docs/REVIEW.md) |
| 看现有静态预览 | [docs/m0-final.png](docs/m0-final.png)（仅桌面静态截图；可复跑：`cd preview && npm i && node shot.mjs`） |
| 看旧开发草案 | [docs/DEV.md](docs/DEV.md) —— 历史参考，接口和计划不作为实现真源 |
| 看调查材料 | [REPORT.md](REPORT.md)、[PLAN.md](PLAN.md)、[reports/](reports/) |

## 工程核心快速验证

```bash
npm ci
npm run typecheck
npm test
```

运行 PC 桌面沙盒（仅本机服务，不包含 AR）：

```bash
npm run simulator
# 浏览器打开 http://127.0.0.1:4173/
```

当前已交付的纯核心包：

- `packages/world-schema`：16×16×16 坐标、索引、稳定方块白名单与 3 cm 映射。
- `packages/protocol`：intent/commit、hello/welcome/ack/resync/ping/pong、plan approval 消息校验与有上限 UTF-8 frame codec；完整网络服务握手/广播仍未实现。
- `packages/voxel-core`：确定性 14×14 岛、原子事务、玩家/AI 建造区规则、快照和 replica commit 应用。
- `packages/worldd`：内存权威协调器原型，包含 `clientId + seq` 幂等、revision 检查；不包含 WAL、网络监听或身份认证。

桌面模拟器已可本地运行；真实 Android AR 页面尚未宣称完成。后续 Android 交付按可手动安装 APK 规划，不依赖 ADB；先通过 capability detection 覆盖 ARCore/WebXR 与打印标记 provider，不为 Tab S8 写专用逻辑。真实设备矩阵、HTTPS/WSS 配对与 M0 录屏仍需实测。

## 两条产品铁律

1. **目标场景中只有一个大肥鱼 AI 角色**；运行时模型尚未定版，替换/降级机制属于实施要求而非现成能力。
2. **玩家本人不出现在世界里** —— 没有玩家化身/皮肤/身体。玩家是"上帝之手"：手指点哪就在哪放/拆。

## 视觉参考图（`效果图/`，当前已跟踪）

`效果图/1.png`、`2.png`、`3.png` 是**AI 视频生成的帧**，带第三方平台水印。它们目前已在仓库文件中，但本仓库尚无可审计的公开再分发权利链；不属于 MIT 许可范围，也不得视为已获公开分发许可。

> 它们只作团队内部视觉讨论材料，不是规格。**仓库已跟踪这些图片，但目前没有在本仓库中形成可审计的公开再分发授权链**；“非 MIT / 仅参考”不等于获得公开分发许可。发布门禁见 [docs/REVIEW.md](docs/REVIEW.md)。
> 视觉讨论背景见 [docs/DEV.md](docs/DEV.md) §1.1；实际实现与验收以 [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) 为准。

## 角色模型调研样例（非当前运行时资产）

### 蓝色小肥鱼 Deepseek 鲸鱼娘 VRM

![正面](docs/model-check-front.png)

> 这是已跟踪的第三方模型渲染截图；本仓库当前没有记录其公开分发许可链。署名不等于授权；发布/再分发前须另行清权或移除此图及相关渲染图。

| | |
|---|---|
| **状态** | 本地寻源与渲染样例；非默认资产、非发行候选 |
| **模型名** | 蓝色小肥鱼 Deepseek 鲸鱼娘 |
| **作者** | **木子恶魔 / MZEM** ｜ B站 <https://space.bilibili.com/95816706> |
| **发布页** | <https://www.aplaybox.com/details/model/ayXkRzVflmnd>（模之屋 Aplaybox） |
| **格式** | VRM 1.0（Blender VRM Add-on 4.5.0 导出）｜17.6 MB |
| **许可** | **个人非商业使用**；**必须署名**；**禁止二次配布**；禁止商用；禁止拆取素材 |

> ⚠️ 这是本地调查/渲染样例，不是项目默认或发行资产。当前授权材料禁止二次分发，且发布页条款仍需逐项复核；不要打包、提交模型、抽取素材或将本地用户文件同步到仓库。
> 正式运行时角色尚未定版。模型导入/目录位置和授权门禁以 [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) 为准；旧 [docs/DEV.md](docs/DEV.md) 中的下载/路径说明为历史草案。

### 本地样例模型测量（调查/渲染记录，非已批准运行时角色，2026-11-16）

| 项 | 样例测量值 | 限制 |
|---|---|---|
| 三角面 | **45,663**（34,873 顶点 / 6 网格） | 仅该样例解析结果；手机 GPU/描边/阴影预算未验证 |
| 材质 | **6 个，全 MToon** | 不是产品预算，最终模型未定 |
| 贴图 | **8 张**，其中 5 张 2048²；原始 13.76 MB，RGBA 显存估算约 **90 MB** | 需在获准资产上实测纹理压缩与内存 |
| 骨骼/弹簧 | humanoid **53** + 尾巴 **13**；22 条 / 91 关节 | 不代表目标模型结构或已测帧耗 |
| 表情/动画 | 19 个表情；未包含动画片段 | 该样例需程序化动作；发行素材需单独验证 |
| 本地归一化高度 | **1.2 体素** | 仅本地样例数值；产品角色尺度待运行时模型确认 |

### 本地样例观察（不是产品缺陷或发行承诺）

1. **描边没有自动出现** —— `@pixiv/three-vrm` 只读 MToon 的描边参数，**不会生成描边网格**。要接近效果图那种"粗描边赛璐璐"，必须自己做背面法线膨胀（或 outline pass）。旧技术记录见 [docs/DEV.md](docs/DEV.md) §8.10；是否实现由最终授权角色与真机测量决定。
2. **一只眼睛偏红** —— 正面渲染时左眼为红/粉色，参考图里是双眼蓝。需确认是模型设计（异色瞳）还是贴图/材质路径问题，**确认前不要当作 bug 改**。


## 目录

```
fangcun/
├─ docs/IMPLEMENTATION-PLAN.md  当前实现交接真源
├─ docs/REVIEW.md               独立审核与修订记录
├─ docs/DEV.md                  历史开发草案
├─ docs/m0-final.png      M0 渲染结果
├─ preview/               M0 静态原型（程序化方块贴图 + three.js 官方示例占位模型）
├─ REPORT.md              调研总报告
├─ PLAN.md                调查计划
└─ reports/               子报告 a–i + 对抗性审阅
```

## 快速开始

根工程（桌面 sandbox 与纯核心）：

```bash
npm ci
npm run typecheck
npm test
npm run test:simulator   # 需要 Chrome；可设置 CHROME_PATH
npm run simulator       # 开启本机页面，http://127.0.0.1:4173/
```

原静态 Three.js 截图预览（独立依赖）：

```bash
cd preview
npm ci
node shot.mjs           # 用 headless Chrome 渲染一帧 → preview/m0.png
```

> 根工作区的 core/shared messages 仍不是完整联网 worldd，也没有 AR 页面。原 M0 静态截图脚本仍依赖 `shot.mjs` 内本机 Chrome 路径，不是可移植 CI。Android APK、真实 ARCore/marker provider、TLS/WSS 与 DSH 仍待实施/实测，见 [docs/ANDROID-DELIVERY.md](docs/ANDROID-DELIVERY.md)、[docs/M0-DEVICE-TEST.md](docs/M0-DEVICE-TEST.md) 和 [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)。

## 尚未决定的事

- 正式角色资产及授权方式（本地样例不能用于发行；目标模型身高/性能尚未定版）
- iOS AR 技术与 SDK/SLAM 许可门禁（不属于 v0）
- Windows 独立桌宠窗口和真实 Minecraft 联动（不属于 v0）
- **占位模型 `preview/assets/RobotExpressive.glb` 来自 three.js 官方示例，仅用于开发，不得随产品发布**

---

## 许可

- **仓库根目录代码与文档：[MIT](LICENSE)** © 2026 Fangcun (方寸) contributors；各子包元数据应与此范围一致
- **素材不在 MIT 范围内**：
  - `效果图/`、`docs/model-check-*.png`、`preview/vrm-*.png`、含第三方占位模型的 M0 截图 —— 含水印/第三方角色的素材；当前已跟踪但公开再分发权利链未确认，不属于 MIT，发布前须逐项清权或排除并处理现存副本
  - 角色模型 —— 版权归原作者（当前「蓝色小肥鱼」© 木子恶魔/MZEM），且**禁止二次配布** → 本仓库不含任何 `.vrm`
  - `preview/assets/RobotExpressive.glb` —— three.js 官方示例，仅开发占位，不得随产品发布
- 详见 [LICENSE](LICENSE) 末尾的「关于素材」一节。
