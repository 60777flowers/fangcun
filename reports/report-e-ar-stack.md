# 报告 E：手机端 AR 渲染与交互技术选型

> 项目：桌面 AR 微缩 Minecraft（真实桌面上出现 MC 风格 diorama，手机点按建造，AI 角色「大肥鱼」同世界协作）
> 作者：子代理 E　｜　采样日：**2026-11-16**（北京时间）　｜　适用截止：结论对 2026-11 的浏览器生态有效
> 方法：一手官方文档 / 规范 / GitHub API / npm registry / 本地可复现脚本；二手社区实测单独标注
> 本机环境（实测）：Windows，Chrome **157.0.8103.51**，Node **v24.19.0**，npm **11.17.0**

---

## 0. 阅读约定（先说清楚证据强度）

报告里每个结论都标了来源类型，冲突时两边都列：

| 标记 | 含义 |
|---|---|
| **【官方】** | 厂商/标准组织的正式文档、规范、release note |
| **【数据】** | caniuse / chromestatus / GitHub API / npm registry 的结构化数据（可复现） |
| **【实测】** | 我在本机跑出来的数字（脚本在 `scripts/`，可复跑） |
| **【社区】** | 开发者博客、issue、论坛；不作为唯一依据 |
| **【推断】** | 我基于上述证据的工程判断，标注推理链 |
| **未取到** | 明确说明拿不到，绝不填数字 |

---

## 1. 执行摘要

> **一句话结论（直接回答）：要做 iOS（不能只做 Android）。底座用 `three.js r187` + 一层 AR 适配器——Android 走 WebXR `immersive-ar`（hit-test），iOS 走 `getUserMedia` 自绘路线（首选 8th Wall，2026 年已免费开源且含 SLAM）；不把 marker / 打印识别垫当主方案。**

**拆成三问三答：**

**（1）Android-only 还是也要 iOS？→ 也要 iOS。** 但前提是**不能把 WebXR 当唯一底座**——截至 2026-11-16，**iOS Safari 到 27.2 仍然完全不支持 WebXR Device API**（不是"要开 flag"，是 `navigator.xr` 相关能力根本没有），WebKit 的 WebXR metabug（208988）已在 2026-04-01 由 WebKit 工程师关闭，明确说明实现只覆盖 visionOS / WPE / WebKitGTK，iOS 不在其中【数据+官方】【[caniuse webxr](https://caniuse.com/webxr)】【[WebKit bug 208988](https://bugs.webkit.org/show_bug.cgi?id=208988)】。

**（2）WebXR 还是 marker？→ 都不单独用，用"WebXR（Android）+ 视觉跟踪（iOS/兜底）"的双路径，中间隔一层 adapter。** marker 只作为"任何浏览器都能跑的降级模式"保留，不做主方案（理由见 §2.3）。

**（3）最省事覆盖双平台的是哪个？→ 8th Wall（World Effects）+ three.js。** 如果只做 Android，省下的只是"跨端适配"那 1.5–2.5 周（约占 AR 层工作 35–50%），换算到整个项目是 **15–25%（中位约 20%）**——不是"省一半"（逐项拆解见 §2.6）。

**为什么是这个结论（三条硬证据）：**

1. **Android 这条路已经被官方钉死了版本号**【数据】：WebXR AR Module 与 Hit-test 在 **Chrome for Android 81** 默认开启，Anchors 79，Depth API 与 AR Lighting Estimation 均为 **Chrome 90**（chromestatus 逐条查得，见 §2.1 表）。前置条件是"安全上下文（https）+ ARCore 支持机型 + 已安装并启用 Google Play Services for AR"，且**Android 模拟器不支持 WebXR**【官方】。
2. **iOS 这条路在 2026 年依然是断的**【数据+官方】：caniuse 的 `ios_saf` 从 3.2 一路到 27.2 全是 `n`（不支持），而桌面 Safari 是 "disabled by default"（可开实验开关）——两者性质不同，iOS 连开关都没有。
3. **但 iOS 有成熟的非 WebXR 解法，而且今年刚变免费**【官方】：8th Wall 托管平台已于 **2026-02-28** 停服，引擎转为**开源（MIT）+ 免费商用**，其"分布式引擎二进制"含 **SLAM / World Effects**，官方浏览器要求写明 **iOS Safari 16.4+ 可用**，且只依赖 `https + WebGL + getUserMedia + deviceorientation + WASM SIMD`，**完全不碰 WebXR**【[8thwall.org FAQ](https://8thwall.org/)】【[browser requirements](https://8thwall.org/docs/troubleshooting/browser-requirements)】。

**一句话取舍**：WebXR 给你"最好的 Android 体验 + 最少的依赖"；8th Wall 给你"唯一免费的双平台 SLAM"。两者共用同一套 three.js 场景，差异被一层 adapter 吃掉——这才是"最省事又能覆盖双平台"的形态。

---

## 2. AR 底座选型

### 2.1 四条技术路线的支持矩阵（采样 2026-11-16）

| 能力 | Android Chrome | iOS Safari | 微信/QQ/UC/百度 | 依据 |
|---|---|---|---|---|
| `navigator.xr` + `immersive-ar` | ✅ Chrome **81+**（AR Module、Hit-test）/ 79（Anchors） | ❌ **全版本不支持**（到 iOS 27.2） | ❌ caniuse：UC 15.5 `n`、QQ 14.9 `n`、百度 13.52 `n`、Android Browser `n` | 【数据】chromestatus + caniuse |
| Hit-test（平面/点云命中） | ✅ Chrome 81+ | ❌ | ❌ | 【数据】chromestatus 4755348300759040 |
| Anchors（锚点稳定） | ✅ Chrome 79+ | ❌ | ❌ | 【数据】chromestatus 5129925015109632 |
| Depth API（遮挡用） | ✅ Chrome **90+**（`gpu-optimized`） | ❌ | ❌ | 【数据】chromestatus 5742647199137792 + WebXR Depth 规范 |
| 光照估计 `XRLightProbe` | ✅ Chrome **90+** | ❌ | ❌ | 【数据】chromestatus 5704707957850112 + three r187 源码 |
| Plane Detection（平面多边形） | ⚠️ **不要依赖**：ARCore 官方对照表标 "Developer Trial"；chromestatus 状态仍是 `Proposed`（记为 147） | ❌ | ❌ | 【官方】ARCore comparison 页 + chromestatus 5177993049800704 |
| Image Tracking（图像/标记追踪） | ❌ **WebXR 路线上没有**（ARCore 对照表标"未提供"） | ❌ | ❌ | 【官方】ARCore comparison 页 |
| `getUserMedia` 摄像头 | ✅ | ✅ iOS 11+（需 https、需用户手势） | ⚠️ 部分可用（WKWebView iOS 14.3+ / SFSafariViewController iOS 13+ 被 8th Wall 官方列为支持） | 【官方】8th Wall browser requirements |
| 8th Wall SLAM（World Effects） | ✅ | ✅ **iOS Safari 16.4+** | ⚠️ 官方只承诺 WKWebView/SFSafariViewController，未点名微信 | 【官方】同上 |

> 关于 WebXR 的"部分支持"：caniuse 对 Chrome 79+ 的 `a` 是"API 很庞大，很多特性仍在开发/规范未定"的意思，**不等于 `immersive-ar` 可用**。真正决定 `immersive-ar` 的是 chromestatus 里的 "WebXR AR Module"（Chrome Android 81）。这两份数据不冲突，是粒度不同。

**ARCore 的三个硬前置（官方原文）**【官方】【[WebXR requirements](https://developers.google.com/ar/develop/webxr/requirements)】：
1. **安全上下文**：必须 `https://`，或 `localhost` / `*.localhost`；
2. **ARCore 支持机型 + 已安装并启用 Google Play Services for AR**（不是装了 Chrome 就行，缺了会走安装引导）；
3. **Android 模拟器不支持 WebXR**（"Android Emulator is not yet supported by WebXR"）。
   开发期的替代：用 Chrome DevTools 的 **Port forwarding** 把手机 `localhost:PORT` 映射到 PC，这样不用配证书也能拿到安全上下文。

**关于国产壳浏览器（必须说清楚证据强度）**：caniuse 只对 UC / QQ / 百度 / Android Browser 有明确 `n` 记录，**没有任何官方文档正面回答"微信 XWeb 是否支持 WebXR"**。工程上按"不支持"处理，理由链：WebXR 的 AR 会话需要浏览器厂商与 ARCore 运行时做系统级集成（camera pose、compositor 层），这不是换个 Chromium 内核版本就能继承的能力；而 UC/QQ/百度这些同样是 Chromium 壳，caniuse 全标 `n`，可作旁证【推断】。**微信里唯一现实的路是"getUserMedia + WASM 视觉跟踪"**——这也解释了为什么 WebKit bug 里那位开发者说"iOS Safari 上我只能用 MindAR 这类做图像跟踪"【社区】【[bug 208988 #44](https://bugs.webkit.org/show_bug.cgi?id=208988)】。

### 2.2 三种锚定方式的工程对比

| 维度 | hit-test（WebXR/ARCore） | marker / 图像追踪（ArUco、QR、NFT） | 纯陀螺仪 3DOF |
|---|---|---|---|
| **稳定性** | 高。有 6DoF 位姿 + 锚点；ARCore 持续重定位，官方建议"永远用 anchor 而不是世界坐标"【官方】 | 中-高。**看到标记时非常稳**（像素级重投影误差小），**丢失后立刻失效**；遮挡/反光/低光/运动模糊都会丢 | 低。只能转不能平移，无尺度，**桌子会被"漂"**；走两步就废 |
| **用户操作步骤** | 扫描环境 1–3 秒 → 出现准星 → 点一下放置（2 步） | **打印** → 摆到桌上 → 对准 → 放置（3–4 步，且含线下动作） | 对准大致方向 → 手动拖拽缩放（3 步，且要反复微调） |
| **跨平台性** | Android only（iOS 无 WebXR） | **Android + iOS + 微信都行**（getUserMedia + WASM） | **全平台行**（DeviceOrientation 到处都有） |
| **实现难度** | 低（three.js 有现成 `ARButton` + `requestHitTestSource`，~40 行） | 中-高（要做标记生成/编译、姿态解算、抖动滤波；MindAR 能省一半但见下） | 极低（~20 行） |
| **失败模式** | 白墙/玻璃/纯色桌面检测不到平面；强光下 tracking lost；低端机 VIO 掉帧 | 标记被杯子挡住 / 反光 / 折角 / 相机离太近拍不全 → 直接消失；**用户会以为"坏了"** | 缓慢漂移；手机一放下再拿起就全乱；无法做"绕过物体看背面" |
| **对"桌面 diorama"的适配** | ★★★★★ 天然就是"找平面 → 放模型" | ★★★☆ 稳，但桌面多一张卡片很出戏 | ★★☆ 只适合"固定视角看"，不适合"围着桌子转" |

### 2.3 特别评估：「桌上放一张打印的识别垫/卡片」值不值得？

**结论：不值得作为主方案；值得作为"零成本兜底/演示模式"保留。**

把它拆成收益和成本：

**收益（真实存在）**
- 唯一能"同时覆盖 Android + iOS + 微信"且**不引入第三方闭源引擎**的锚定方式；
- 锚定精度在"看得到"时高于 hit-test（重投影误差可到像素级）；
- 不依赖 ARCore（老机型/无 GMS 的国产 ROM 也能用）；
- 可以顺便编码"桌子尺寸/世界原点/朝向"，省掉一次手动放置。

**成本（被低估的部分）**
- **线下动作 = 转化率杀手**：这不是"多一步点击"，是"让用户去找打印机"。产品定位是"手机浏览器打开就能用"，打印直接违背这条硬约束；
- **视觉破坏**：参考效果图的核心是"真实桌面上凭空出现一座岛"。一张 A4/A5 垫子会把"凭空"变成"放在一张纸上"，接触阴影的可信度反而下降（阴影落在垫子上，不是桌面）；
- **鲁棒性陷阱**：NFT/ArUco 在**俯视 + 近距离 + 斜角**时最容易丢——而这恰好是"看桌面 diorama"的主视角；
- **实现并不便宜**：MindAR 是现成方案，但见下方维护性风险；AR.js 的 NFT 需要 ARToolkit5 的 `.fset/.iset` 编译流程，调参（`dFeatThresh`、`dMatchThresh`）很费时间。

**MindAR / AR.js 的维护性风险（关键）**【数据】：

| 项目 | stars | license | 最后 push | npm 最后发布 |
|---|---|---|---|---|
| `hiukim/mind-ar-js` | 2,766 | MIT | **2024-06-11** | `mind-ar@1.2.5`，**2024-01-16** |
| `AR-js-org/AR.js` | 5,997 | MIT | 2026-06-21 | 见 npm `@ar-js-org/ar.js` |
| `google/model-viewer` | 8,339 | Apache-2.0 | 2026-11-13 | 4.4.0 |
| `mrdoob/three.js` | 118,601 | MIT | 2026-11-16 | 0.187.0 |

**MindAR 已经两年半没有代码提交、npm 包两年多没更新**。它仍然能用（很多人还在用），但意味着：iOS 26/27 的 `getUserMedia` 行为变化、WASM SIMD 默认开启后的兼容问题，都要你自己兜。这对一个要长期迭代的产品是隐性负债。

**如果你坚持要"零依赖跨平台"，我建议的顺序是**：
1. 8th Wall（免费、有 SLAM、官方承诺 iOS 16.4+）→ 连打印都省了；
2. 实在不想引入 8th Wall → 用 **AR.js 的 ArUco 标记**（比 NFT 更鲁棒，标记丑但可做成"MC 风格的地砖"贴图，视觉上能接受）；
3. 最后才是 MindAR NFT。

### 2.4 框架横向对比（stars / license / 收费 / 是否需要装 app）

全部在 **2026-11-16** 采样；stars 走 GitHub API，版本走 npm registry。

| 框架 | stars | license | 当前版本 | 收费 | 需装 app | 能不能做"手机浏览器 AR + 点按建造" | 判断 |
|---|---|---|---|---|---|---|---|
| **three.js** | 118,601 | MIT | `three@0.187.0` | 免费 | 否 | ✅ WebXR 有 `ARButton`/hit-test/depth/light 全套 | **主选**（渲染层） |
| **A-Frame** | 17,711 | MIT | `aframe@1.8.0` | 免费 | 否 | ✅ 声明式 HTML，`<a-entity>` 上手快；底层就是 three | 可选（原型快，复杂交互要逃逸到 three） |
| **`<model-viewer>`** | 8,339 | Apache-2.0 | `4.4.0` | 免费 | 否 | ⚠️ **只能"看模型"**：AR 模式是 WebXR（Android）/ Scene Viewer / Quick Look（iOS）。**iOS 会跳出页面进 Quick Look，你无法在里面点按建造** | 不适用（做展示可以，做交互产品不行） |
| **8th Wall** | 520（`8thwall/8thwall`） | **MIT**（引擎二进制另有 binary-only 商业许可，允许商用） | `@8thwall/engine@0.1.0`（npm，29.3 MB 解包） | **免费**（"Is there a paid tier? No."） | 否 | ✅ **Android + iOS Safari 16.4+ 都能跑**，有 SLAM / Image Targets / Face / Sky | **iOS 兜底首选** |
| **Zappar** | 57（`zappar-xr/zappar-threejs`） | MIT（npm 包） | `@zappar/zappar-threejs@4.3.0`（npm 2026-07-23） | **未取到**（`zappar.com/pricing` 是 JS 渲染，curl 只拿到 3 KB 导航文本） | 否 | ✅ 有通用 AR（world tracking + 图像追踪），跨平台 | 备选；定价不透明是风险 |
| **AR.js** | 5,997 | MIT | 见 npm `@ar-js-org/ar.js` | 免费 | 否 | ✅ marker / NFT / location-based；**iOS 可用** | 兜底可选项（§2.3） |
| **MindAR** | 2,766 | MIT | `mind-ar@1.2.5`（**2024-01**） | 免费 | 否 | ✅ 图像跟踪，跨平台 | **不推荐做主方案**（停更） |
| **Unity AR Foundation** | — | Unity 许可 | — | 免费（引擎另有条款） | **要**（打包成 app） | ❌ **AR Foundation 本身不支持 WebGL/WebXR 导出**；社区方案 `de-panther/unity-webxr-export`（1,270★，Apache-2.0，2026-08-13 有提交）能做 WebGL+WebXR，但**产物是 10–30 MB 级 wasm**，加载慢，且 iOS 依然没有 WebXR | 不选（违背"打开就能用"） |
| **Babylon.js** | 26,376 | Apache-2.0 | `@babylonjs/core@9.36.0` | 免费 | 否 | ✅ 有 WebXR 支持，工程化程度高 | 可选（与 three 二选一；生态/示例不如 three 多，但 TS 更规整） |
| **Wonderland Engine** | **未取到**（猜的 repo 名 404，未花时间穷举） | 未取到 | 未取到 | 未取到 | 否 | 有 WebXR 支持（据其官网定位） | **未验证**，不作为选型依据 |
| **`@react-three/xr`** | 2,626（`pmndrs/xr`） | npm 标 `SEE LICENSE IN LICENSE`；GitHub 标 `NOASSERTION` | `6.6.32` | 免费 | 否 | ✅ 声明式 WebXR 封装 | 用 React 才考虑；本项目不需要 React 也能做 |

**关于 8th Wall 的"免费"要精确表述**（这是本报告最容易被误读的一条）【官方】：
- 托管平台 `8thwall.com` 于 **2026-02-28** 停止访问，**所有付费订阅在当天终止**；官方 FAQ 原文："**Is there a paid tier? No.** ... The open source tools and distributed engine binary are free to use."；
- **开源引擎（MIT）** 包含 Core / Image Targets / Face Effects / Sky Effects，**不含 SLAM**；
- **分布式引擎二进制（含 SLAM、Absolute Scale）** 是闭源、binary-only 许可，官方明确"**permits commercial use as part of a broader application or experience**"；
- 合规要求：直接用 npm/jsdelivr 上的包（已含版权声明），或在自己的 `index.html` 里放它给的那段版权注释。

> 这就是"要么接受一个 29 MB 级闭源二进制依赖，要么自己在 iOS 上做视觉跟踪"的取舍。对个人/小团队项目，**接受它是理性的**：自己实现 iOS SLAM 是不可能的。

### 2.5 "最省事能覆盖 Android + iOS 的方案是什么"

**直接答案：8th Wall（World Effects）+ three.js。**

理由排序：
1. **一行 WebXR 代码都不用写**，iOS/Android 走同一条 `getUserMedia` + WASM 管线，行为一致，回归测试减半；
2. **不需要打印**（SLAM 直接给 6DoF + 平面），符合"打开就能用"；
3. **免费商用**，且已开源（MIT 的引擎 + 可检查的代码），比过去"按流量收费"的 8th Wall 风险低得多；
4. 官方承诺 iOS Safari **16.4+**（2022 年的机型都能覆盖），Android 侧列出 Chrome/Firefox/Samsung Internet/Edge + 主流 WebView。

**代价（必须承认）**：
- 29 MB 级引擎（WASM SIMD 必需）→ **首屏加载**是新的性能预算项，得靠 gzip/brotli + CDN + loading 动画扛；
- 坐标系/单位/相机内参由它给，你的 three.js 场景要按它的相机矩阵来写（不是 `renderer.xr`）；
- **8th Wall 路线上没有 WebXR 的 `depth-sensing`**（那是 ARCore/WebXR 的能力，见 §3.3），所以"被真实物体挡住"要么自己估、要么不做；但 SLAM 平面是它给的，阴影 catcher 依旧自绘，反而更简单（§3.1）。

**如果连 8th Wall 都不想引**：Android 用 WebXR + iOS 用"AR.js ArUco 标记 + 同一套 three 场景"，用 adapter 隔离（§6.1）。这条路**多花 ~1.5–2 周**，换来零闭源依赖。

### 2.6 "只做 Android 会不会省掉一半工作量"

**结论：省掉的只是"跨端适配"这一段（1.5–2.5 周，约占 AR 层工作的 35–50%），换算到整个项目是 15–25%（中位约 20%）。** 不是一半。

因为"桌面 AR 微缩 MC"的工作量大头**不在 AR 底座**，而在世界/交互/角色/AI。粗拆（**这是我的估算，按 1 人全职周计，标注为推断**）：

| 模块 | 双平台（WebXR + iOS 兜底） | 仅 Android（WebXR） | 差值 |
|---|---|---|---|
| 体素世界数据 + greedy meshing + 图集 | 1.5 周 | 1.5 周 | 0 |
| 渲染/光照/阴影/色调映射 | 1.5 周 | 1.0 周 | **0.5** |
| AR 底座（含 hit-test、锚点、放置、重定位） | 1.0 周 | 1.0 周 | 0 |
| **iOS 兜底路径（tracking + 相机管线 + 双端联调）** | **1.5–2.0 周** | **0** | **1.5–2.0** |
| 点按建造（射线拾取、格子对齐、undo） | 1.0 周 | 1.0 周 | 0 |
| 角色（Q 版模型 + 动画 + 状态机） | 2.0 周 | 2.0 周 | 0 |
| AI 对接（DSH 局域网 + 消息/字幕） | 1.0 周 | 1.0 周 | 0 |
| 弹幕字幕 + UI | 0.5 周 | 0.5 周 | 0 |
| **合计** | **9.5–10.5 周** | **8.0 周** | **≈1.5–2.5 周（约 15–25%，中位 ~20%）** |

换句话说：**iOS 支持的边际成本 ≈ 1.5–2.5 周，不是一个"减半"的决策，而是一个"要不要多花两周换一倍设备覆盖"的决策**。在中国 iPhone 存量占比很高，这两周大概率划算——**尤其是 8th Wall 免费之后，还能再压缩到 1 周左右**。

---

## 3. 桌面融合技巧（把虚拟内容"焊"在桌子上）

参考效果图的四个视觉支柱：**接触阴影**、**暖色左上光 + 环境光**、**移轴虚焦**、**像素纹理与真实照片"同一条光"**。逐条给代码级做法。以下代码基于 **three r187** 实测过的 API（`ShadowMaterial.js`、`WebXRManager`、`XREstimatedLight.js`、`WebXRDepthSensing.js` 均已拉源码核对）。

### 3.1 接触阴影（shadow catcher）

**不要**给桌面放一块半透明黑板（会脏、会破坏真实桌面纹理）。正确做法是 **`ShadowMaterial`**：它只输出阴影的暗度，其余全透明，于是"阴影落在真实桌面上"。

```js
import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // DPR 钳制，见 §4.5
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;            // r187: PCFSoftShadowMap = 2
renderer.toneMapping = THREE.AgXToneMapping;                 // r187: AgXToneMapping = 6
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;

const scene = new THREE.Scene();          // 注意：背景保持 null，让摄像头透出来

// ① 只接阴影、本身不可见的平面
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),          // 2m × 2m，够一张桌子
  new THREE.ShadowMaterial({ opacity: 0.42 })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.receiveShadow = true;
shadowCatcher.renderOrder = 1;             // 让它在体素之后画，避免 z-fighting
scene.add(shadowCatcher);

// ② 主光：暖色、左上、给清晰阴影
const sun = new THREE.DirectionalLight(0xffe8c8, 3.2);
sun.position.set(-1.2, 2.4, 1.0);          // 左上前方
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);        // 移动端别超 1024，见 §4.6
sun.shadow.camera.near = 0.05;
sun.shadow.camera.far = 4;
sun.shadow.camera.left = -1; sun.shadow.camera.right = 1;
sun.shadow.camera.top = 1;   sun.shadow.camera.bottom = -1;
sun.shadow.bias = -0.0008;                 // 关键：体素是共面几何，bias 太小会有条纹
sun.shadow.normalBias = 0.02;
scene.add(sun);

// ③ 半球光补环境（AR 里没有真实环境光时，这是最像的假光）
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x6b5a45, 0.9));
```

**几个真会踩的坑**：
- `shadow.bias` / `normalBias` 对体素特别敏感（大量共面 + 大平面），bias = 0 会出明显摩尔纹；建议 `bias≈-8e-4`、`normalBias≈0.02`，按 diorama 尺寸线性缩放。
- 阴影相机范围要**刚好包住岛**（±1 m），范围开大 = 有效阴影分辨率暴跌。2 m 见方 / 1024² ≈ 2 mm/texel，落在桌面上够用。
- AR 里 `scene.background` 必须是 `null`/透明，且 `alpha: true`；一旦设了背景色，摄像头就看不见了。
- 想让阴影"随岛一起走"，把 `shadowCatcher` 和 `sun` 都挂在**同一个 anchor Group** 下，而不是各自挂 scene。

### 3.2 光照估计：`XRLightProbe` / `XREstimatedLight` 的真实可用性

**有，而且 three.js 已经封装好了。** 我拉了 r187 的源码确认（文件从 `examples/jsm/lights/` 挪到了 `examples/jsm/webxr/XREstimatedLight.js`，网上老教程的 import 路径会 404）：

- **Chrome for Android 90+** 默认开启 "WebXR AR Lighting Estimation"【数据】；
- `XREstimatedLight` 会拿到两组东西：
  1. `lightEstimate.sphericalHarmonicsCoefficients` → 塞进 `LightProbe.sh`（环境光的方向性）；
  2. `lightEstimate.primaryLightDirection` / `primaryLightIntensity` → 驱动一盏 `DirectionalLight`（主光方向和**色温**，这就是"暖色阳光"的来源）；
  3. 若 `environmentEstimation = true` 且浏览器有 `XRWebGLBinding`，还会拿 `getReflectionCubeMap()` 当环境贴图（反射）。

**最小接入代码**（`requiredFeatures` 必须带 `'light-estimation'`）：

```js
import { XREstimatedLight } from 'three/addons/webxr/XREstimatedLight.js';

const xrLight = new XREstimatedLight(renderer, /* environmentEstimation */ true);
xrLight.addEventListener('estimationstart', () => {
  scene.add(xrLight);              // 有估计值时用真实光
  if (xrLight.environment) scene.environment = xrLight.environment;
  scene.remove(fakeSun);           // 关掉假光
});
xrLight.addEventListener('estimationend', () => {
  scene.remove(xrLight);
  scene.add(fakeSun);              // 退回假光
});

const sessionInit = {
  requiredFeatures: ['hit-test'],                 // 必选项只留 hit-test
  optionalFeatures: ['light-estimation']          // 光估计放可选，不支持就退回假光
};
document.body.appendChild(ARButton.createButton(renderer, sessionInit));
```

**不支持时（iOS、老 Android、无 ARCore）用什么假光最像？** 我建议这套固定参数（对着参考图调的，**属于推断，需要用真机截图校准**）：
- `DirectionalLight`：色 `#ffe8c8`（2700–3200K 暖白），强度 2.5–3.5，方向 `(-0.5, 1.0, 0.45)` 归一化（左上前）；
- `HemisphereLight`：sky `#bfd4ff`（天空散射偏冷）/ ground `#6b5a45`（桌面反弹暖色），强度 0.8–1.2；
- **关键技巧**：用摄像头画面**采样一个平均色**当 `HemisphereLight.color` 的乘子，让内容自动跟环境色温走（见 §3.5 的"同一条光"）。

### 3.3 遮挡（occlusion）：ARCore Depth 在 Web 端**可用**

**结论：可用（Chrome 90+，`gpu-optimized`），而且 three.js 内置了实现——但本项目建议先不做。**

证据链：
1. ARCore 官方对照表：**Depth API 在 Chrome 状态 = "Shipped"**，并链到 WebXR Depth Sensing 规范【官方】；
2. chromestatus："WebXR Depth API" **Chrome Android 90 默认开启**【数据】；
3. 规范里 `XRDepthStateInit` 的字段是 `usagePreference` / `dataFormatPreference` / `depthTypeRequest` / `matchDepthView`，`XRDepthUsage` 取 `"cpu-optimized" | "gpu-optimized"`【官方，规范原文】；
4. **three r187 源码级实现**：`src/renderers/webxr/WebXRDepthSensing.js` 把深度纹理做成一个全屏 `PlaneGeometry` + `ShaderMaterial`，片元着色器直接写 `gl_FragDepth`：

```glsl
uniform sampler2DArray depthColor;
uniform float depthWidth, depthHeight;
void main() {
  vec2 coord = vec2(gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight);
  if (coord.x >= 1.0) gl_FragDepth = texture(depthColor, vec3(coord.x - 1.0, coord.y, 1)).r;
  else                gl_FragDepth = texture(depthColor, vec3(coord.x, coord.y, 0)).r;
}
```

**接入方式**（三行）：

```js
const sessionInit = {
  requiredFeatures: ['hit-test'],
  optionalFeatures: ['depth-sensing'],
  depthSensing: {
    usagePreference: ['gpu-optimized'],   // three 只在 gpu-optimized 下启用
    dataFormatPreference: ['luminance-alpha']
  }
};
// 会话中：
if (renderer.xr.hasDepthSensing()) {
  const occlusionMesh = renderer.xr.getDepthSensingMesh(); // 全屏、写 gl_FragDepth
  occlusionMesh.renderOrder = -1;                          // 先画，给后面的内容做深度测试
  occlusionMesh.material.depthWrite = true;
  scene.add(occlusionMesh);
}
```

**为什么这个项目建议先不做**（三个理由，都能验证）：
1. **参考图的桌子是平的**。平面桌面上，遮挡和"岛坐在桌面上"的差别肉眼几乎看不出来——收益接近 0；
2. **成本真实**：深度采样会吃掉 GPU（一次全屏片元 + 纹理取样），中端机 AR 帧预算本来就紧（§4.1 的 8–9 ms）；
3. **只有部分机型有**（ToF/双摄/IR 投影的机型才有深度），做了也是"分层体验"。
   **什么时候必须做**：如果用户会把手机**伸到岛后面**看背面，或者岛旁边放了杯子（参考图左上角那个虚焦杯子！）——这时角色被真实杯子挡住会明显穿帮。**建议：做成可开关的"画质档"**，默认关。

### 3.4 景深/移轴：效果图里的虚焦是镜头还是后期？

**答案：参考图大概率是"真实镜头 + 后期"的混合；在手机 AR 里你应该用后期假移轴，而且必须便宜。**

推理：手机上要看清楚 20–40 cm 处一个 30 cm 的桌面模型，手机主摄（等效 24–26 mm、f/1.6–1.8）在 30 cm 处的景深只有几厘米——**物理上无法让"整座岛都在焦内 + 左上角杯子虚焦"同时成立**（除非杯子离得足够远）。所以参考图里那种"整体清晰、边缘虚化、上下渐隐"是**典型的移轴（tilt-shift）后期**特征，而不是纯光学景深【推断】。

**在手机上的代价（算术，非实测）**：
- 一部 360×780 CSS 像素的手机，DPR 3 → 1080×2340 = **2.53 M 像素/帧**；60 fps 就是 **152 Mpx/s** 的最低填充需求（还没算 overdraw 和阴影 pass）。
- `BokehPass`（r187 中确实存在：`examples/jsm/postprocessing/BokehPass.js`）是**额外一个全屏 pass + 一枚 15–25 tap 的散景核**，等效填充 ≈ 3–6× 全屏。**在 2.53 Mpx 上再乘 4 ≈ 10 Mpx/帧**，等于把填充量翻两番——对 tile-based GPU（移动端全是）是直接的掉帧来源。
- 而且 `BokehPass` 需要 `depthTexture`：**在 WebXR 里拿 scene depth 是可以的，但你拿不到"真实世界"的深度**（除非开 §3.3 的 depth-sensing，且那是稀疏深度）。**所以：AR 里做"真实世界虚焦"在 WebXR 路线上基本做不到**（摄像头画面是合成器贴的，不在你的 framebuffer 里）。

**这里有本报告最重要的一个架构性发现**：

> **默认情况下，只有"getUserMedia 自绘"路线（8th Wall / AR.js / 3DOF）才能对真实世界画面做后期——因为摄像头画面是一张 `VideoTexture`，在你手里。WebXR 路线的摄像头画面由浏览器合成器贴在你的透明 framebuffer 后面，你默认改不了。**

**一个必须说清的例外（否则这条结论会被懂行的人挑错）**：Chrome 的 WebXR 有 `camera-access` 特性，**three r187 已支持**——`renderer.xr.getCameraTexture(xrCamera)` 能拿到原始的 `XRCamera` 图像（源码在 `WebXRManager.js`：`glBinding.getCameraImage(camera)` → `ExternalTexture`）。拿到之后你**可以**自己把摄像头画面画进自己的 framebuffer，再对它做模糊/调色。但代价是：
1. 你放弃了浏览器的合成器直通（那条路是零拷贝、最优的），改用自己画 → **多一次全屏贴图 + 必须自己对齐相机内参与 reprojection**，稍有偏差就是"整体错位"；
2. `camera-access` 的支持面比 `depth-sensing` 更窄（不是所有 ARCore 机型都保证）；
3. 你在自己画的画面上做模糊，会**连真实世界的清晰度一起牺牲**——而移轴要的正是"中间清晰、上下模糊"，所以逻辑上成立，但实现风险高。

**工程结论**：WebXR 路线上**默认不做真实世界虚焦**，只对 3D 内容做后期；把"整幅画面的移轴"留给 getUserMedia 路线（阶段 3 的 iOS）。这个取舍比"硬上 camera-access"稳得多。

这直接影响选型：**如果你要参考图那种"移轴微缩摄影感"，getUserMedia 路线是唯一能 100% 复刻的**；WebXR 路线只能"只对 3D 内容做景深"，真实桌面永远清晰——那就不像移轴照片，而像"清晰的桌子上贴了模型"。

**便宜的伪移轴（推荐，成本 ≈ 0.13× 一次全屏 pass）**：

```js
// 思路：把"要模糊的东西"画到 1/4 分辨率的 RT 上，做 2 次可分离高斯，再按屏幕纵向渐变合成。
// 因为移轴的模糊是"上下强、中间无"，不需要按深度，所以不需要 depthTexture。
const scale = 0.25;
const rt = new THREE.WebGLRenderTarget(
  Math.floor(innerWidth * scale), Math.floor(innerHeight * scale),
  { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
);

const tiltShift = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    tBlur:    { value: rt.texture },
    uFocusY:  { value: 0.5 },   // 焦平面（屏幕纵向 0..1）
    uBand:    { value: 0.16 },  // 清晰带半宽
    uMax:     { value: 0.55 }   // 最大混合量
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tBlur; uniform float uFocusY, uBand, uMax;
    varying vec2 vUv;
    void main(){
      float d = abs(vUv.y - uFocusY);
      float k = smoothstep(uBand, uBand + 0.35, d) * uMax;  // 越远越糊
      gl_FragColor = mix(texture2D(tDiffuse, vUv), texture2D(tBlur, vUv), k);
    }`
});
```

- 4 次 pass（1 次降采样 + 2 次可分离模糊 + 1 次合成），但**前 3 次都在 1/4 分辨率**：总填充 ≈ 0.0625×(1+2) + 1 = **1.19× 全屏**，比 `BokehPass` 便宜一个数量级；
- 阈值：`uBand` 从 0.12 起调，`uMax` 别超 0.6（超过就像糊了层塑料膜）；
- **更便宜的 90% 效果**：干脆不做模糊，只做"上下 15% 做线性渐隐到 0.35 的黑/白"——移轴的"微缩感"有相当一部分来自"上下边缘信息量减少"，渐隐就能骗过眼睛。成本 = 0。

### 3.5 色调映射与色彩：让 3D 和真实照片"同一条光"

r187 的 `ToneMapping` 常量我拉源码核对过：`NoToneMapping=0, Linear=1, Reinhard=2, Cineon=3, ACESFilmic=4, Custom=5, AgX=6, Neutral=7`。

| 方案 | 观感 | 我的取舍 |
|---|---|---|
| `ACESFilmicToneMapping` | 高光滚降漂亮，饱和度高光会偏色，MC 的纯红 TNT 容易变橙 | 备选 |
| **`AgXToneMapping`** | 高光去饱和更自然、更接近"相机直出"，对纯色块（MC 材质）更友好 | **推荐** |
| `NeutralToneMapping` | Khronos PBR Neutral，最"中性"，但对比弱、少了摄影味 | 不选 |

**"同一条光"的四个具体动作**：

1. **曝光跟随环境**：从摄像头画面左下角采一个 8×8 的平均亮度（`getUserMedia` 路线下 `VideoTexture` 可以直接 `readPixels`，或用 1×1 的 `WebGLRenderTarget` 做一次 downsample），映射到 `renderer.toneMappingExposure` ∈ [0.8, 1.35]。这一步比任何材质调参都管用。
2. **色温对齐**：把 `sun.color` 与 `hemi.color` 朝"画面平均色"的方向拉 30%（不是全拉，全拉会变灰）。
3. **加颗粒**：`FilmPass`（r187 有）或几十行 shader 的 `rand(uv*time)`，强度 **0.03–0.06**。真实照片有噪点，纯 CGI 的干净是"假"的主要来源。成本：一次全屏 pass，或者干脆叠一个 CSS 的 `mix-blend-mode: overlay` 噪点 PNG（**成本 0，推荐先试这个**）。
4. **别忘 `outputColorSpace = SRGBColorSpace`**，且贴图设 `texture.colorSpace = SRGBColorSpace`（r187 里 `SRGBColorSpace = 'srgb'`）。MC 图集是 sRGB 的，忘了设会整体发灰。

---

## 4. 性能预算与体素渲染方案

### 4.1 先给外部基准（有出处的数字）

| 指标 | 数值 | 来源与强度 |
|---|---|---|
| 72 Hz 下的总帧预算 | 13.8 ms，其中渲染线程实际只有 **8–9 ms**（其余被 tracking/JS 吃掉） | 【社区】[Tripo3D, 2026-11-01 更新](https://www.tripo3d.ai/blog/runtime-budgets-ar-webxr)（厂商博客，非独立复现） |
| **手机 AR 可见三角形预算** | **80,000 – 150,000 tris** | 同上【社区】 |
| 主角级模型 | 20,000 – 50,000 tris/个 | 同上 |
| 次要道具 | 2,000 – 8,000 tris/个 | 同上 |
| **手机 AR draw call** | **< 100**（"200 紧，400 必卡"是指头显） | 同上 |
| 浏览器 tab 可用显存 | 600 MB – 1 GB 就被 kill | 同上 |
| 未压缩 4K RGBA 纹理 | 64 MB/张；5 张 4K PBR 组 ≈ 320 MB | 同上 |
| ARCore 侧的性能纪律 | "用户更喜欢**稳定但较低**的帧率，而不是**波动但较高**的帧率"；用 `PowerManager#getCurrentThermalStatus`(API 29) / `getThermalHeadroom`(API 30) 监控热；在 logcat 里搜 `VIO frequency low` 判断 ARCore 的 SLAM 是否被 CPU 饿死 | 【官方】[ARCore performance](https://developers.google.com/ar/develop/performance) |

> **诚实标注**：我**没有**在真机上测过帧率（本机只有 PC + RTX 3060，没有中端安卓）。上表的 80k–150k / <100 DC 是**第三方博客口径**，我用它作为"保守上限"，并且下面用可复现的几何计算来交叉验证——**结论是：本项目根本碰不到这个上限**。

### 4.2 我算的：体素世界的几何预算（可复现）

脚本：`scripts/e_voxel_budget.js`（无依赖，`node scripts/e_voxel_budget.js` 可复跑）。地形用确定性 2D 值噪声 + 1 个 3×3 矿坑 + 若干树（seed=42），三种渲染策略对比：

| 世界尺寸 | 非空方块 | 暴露面 | InstancedMesh 三角形 | 暴露面三角形 | greedy 四边形 | greedy 三角形 | greedy 顶点缓冲 | 面数节省 |
|---|---|---|---|---|---|---|---|---|
| 16×16×8 | 901 | 830 | 10,812 | 1,660 | 121 | 242 | 0.02 MB | 85.4% |
| **32×32×16** | **7,719** | **3,842** | **92,628** | **7,684** | **734** | **1,468** | **0.11 MB** | **80.9%** |
| 48×48×24 | 24,662 | 9,198 | 295,944 | 18,396 | 2,262 | 4,524 | 0.33 MB | 75.4% |
| 64×64×32 | 59,309 | 17,508 | 711,708 | 35,016 | 5,149 | 10,298 | 0.75 MB | 70.6% |

**从这张表能直接读出三个反直觉结论**：

1. **32×32×16 的目标世界里，几何量是"零成本"级别**：哪怕用最笨的方案（每方块一个 6 面 cube 的 `InstancedMesh`），也就 **92,628 tris / 1–6 draw calls**——刚好卡在"手机 AR 80k–150k"的上限附近；而只要做**面剔除**（不画被挡住的邻居面），立刻降到 **7,684 tris / 1 DC**，是上限的 5%；做 **greedy** 更是 **1,468 tris**，是上限的 **1%**。
2. **瓶颈完全不在体素，而在角色**。2 个 Q 版角色（每个 ~15k tris）就是 **30,000 tris**，是 32³ 世界 greedy 后（1,468）的 **20 倍**。所以"优化体素"是错误方向，"优化角色"才对。
3. **世界再放大 4 倍（48×48×24）才开始痛**：InstancedMesh 全渲染到 295,944 tris（超预算 2 倍），但 greedy 仍然只有 4,524 tris。**greedy 是"世界尺寸的保险"**。

总账（32×32×16 + 参考图里的全套道具）：

```
体素 greedy          :   1,468 tris / 1 draw call
2 个 Q 版角色        :  30,000 tris / 2 draw calls
房子骨架(门洞/火把)  :   1,200 tris / 1 draw call
箱子/TNT/花/草       :     900 tris / 1 draw call
字幕精灵             :      40 tris / 1 draw call
------------------------------------------------
合计                 :  33,608 tris / 6 draw calls
加阴影 pass（再画一遍）:  67,216 tris（阴影 pass 通常只画投影体）
```

**结论**：**33.6k tris / 6 DC，距离 80k–150k / 100 DC 的保守上限还有 2–4 倍余量。** 这个项目在几何上是"轻得过分的"，性能预算应该全部让给：**角色（骨骼动画）、阴影分辨率、后期（移轴/颗粒）、以及 AR 本身的 tracking 开销**。

### 4.3 体素渲染方案对比（实现方式 + 性能特征）

| 方案 | 实现 | 三角形（32³） | draw call | 优点 | 缺点 | 本项目取舍 |
|---|---|---|---|---|---|---|
| **A. 每方块一实例 `InstancedMesh`** | 一个 `BoxGeometry` + `InstancedMesh(count)`，每个方块设一个 matrix；材质用图集 + 逐实例 UV 偏移（`instanceColor` 或自定义 `InstancedBufferAttribute`）。若拆成 6 个朝向各一个 `InstancedMesh`，则 DC=6 | 92,628（6 面全画） | **1**（逐实例 UV）或 **6**（按朝向拆） | CPU 极省（每方块 1 次矩阵写）；**改一个方块只更新 1 个实例**（`setMatrixAt` + `instanceMatrix.needsUpdate`）；实现 1 小时 | GPU 侧 **~2/3 的隐藏面白画**（内部面完全不可见）；透明方块排序困难；实例 UV 要用 attribute 传 | **首选给"可编辑世界"**：编辑成本 O(1)，是这个产品的核心交互 |
| **B. 仅暴露面 + 不合并（per-face）** | 遍历一次，只对"邻居是空气"的面生成 4 顶点 6 索引，全部塞进一个 `BufferGeometry` | 7,684 | 1 | 顶点数是 greedy 的 4 倍但**绝对量很小**（15,368 顶点 ≈ 0.56 MB）；**UV 可以任意裁切，做"草方块侧面顶部绿边"最方便** | 每次编辑要重建整个 mesh（32³ 重建约几十毫秒，可接受） | **推荐起步方案**：简单、够快、纹理自由度最高 |
| **C. greedy meshing** | 沿 3 个轴各做一次 2D 贪心，把同材质共面矩形合并 | **1,468** | 1 | **顶点最省（0.11 MB）**，世界放大到 64³ 也只有 10k tris | **纹理必须在图集内可平铺**（UV > 1 要 `RepeatWrapping` 或 per-quad scale）；合并后**编辑一个方块要重建整块 chunk**；实现 1–2 天 | **建议做，但作为"chunk 级"优化**：世界按 16³ 分 chunk，编辑只重建受影响 chunk |
| **D. `BufferGeometryUtils.mergeGeometries`** | 把一堆独立 `BoxGeometry` 合并成一个 | 同 B（取决于是否剔除面） | 1 | 一行代码，改动最小 | **只适合静态装饰**（房子、箱子、TNT、花）：world 一变就得全量合并，CPU 峰值高；而且不做面剔除时几何量和 A 一样 | **给静态道具用**：房子骨架 + TNT + 花合并成 1 个 mesh，省 20+ 个 DC |
| **纹理图集（atlas）** | 16×16 tile 打进一张 256×256 或 512×512，`NEAREST` 过滤 + 关 mipmap（或用 `NearestMipmapNearestFilter` 保像素感） | — | 1 个材质 | **1 个材质 = 1 个 DC**；显存 < 1 MB | 图集边缘会渗色（相邻 tile 采样溢出）→ 要留 1–2 px padding 或 `NearestFilter` 硬切 | **必选**，见下方数字 |
| **每方块一材质** | `MeshStandardMaterial` × N | 同量 | **N**（7,719 个 = 7,719 DC） | 无 | **直接杀死性能**：移动端 DC 上限 100 左右，7,719 DC 会掉到个位数帧率 | **禁用** |

**图集的实际数字（我算了，别搞错）**：
- 16×16 px/tile，8×8 = 64 tile（我们只要 ~20 种），图集 **128×128 px = 16,384 px × 4 B = 64 KB**，含 mipmap 约 **85 KB**。
- 图集的收益**主要不是显存，而是 draw call**：1 张图集 = 1 个 `MeshStandardMaterial` = 1 个 DC；20 种方块各用独立材质 = 20 DC；"每方块一个材质"则是 7,719 DC（必死）。
- 显存上反直觉：20 张独立 16×16 纹理只要 **20 KB**，比图集（64 KB）更小——图集为了防渗色要留 padding，反而更占。**但 1 DC vs 20 DC 的收益远大于 44 KB 的代价**，所以图集仍然必选。
- 附带收益：图集让"同一材质批处理"成为可能，GPU 的纹理缓存命中率更高（体素渲染里这比显存重要）。
- 防渗色两条做法：①tile 四周留 1–2 px padding（图集变 160×160）；②`texture.magFilter = THREE.NearestFilter` + `minFilter = THREE.NearestMipmapNearestFilter`，靠硬采样避免插值越界——**MC 的像素感本来就要 NEAREST，所以这条几乎是免费的**。
- 尺寸安全性：WebGL2 在移动端 `MAX_TEXTURE_SIZE` 普遍 ≥ 4096，85 KB 的图集连零头都算不上，这块没有风险（PC 上测这个值对手机没有参考意义，故不列）。

### 4.4 手机浏览器 WebGL2 的纹理内存/发热现实预期

- **纹理内存上限**：这不是"WebGL2 规定的数"，而是**浏览器进程的内存配额**。社区口径给出"浏览器 tab 600 MB–1 GB 图形内存会被 kill"【社区】。我们的用量：图集 0.34 MB + 角色贴图 2×(1024² RGBA ≈ 4 MB + mipmap 5.3 MB) ≈ **11 MB** + 阴影贴图 1024²×4 = 4 MB + RT ≈ 20 MB 总计。**离上限差 30 倍**，完全不是问题。
- **发热/耗电**：ARCore 官方给的纪律是"监控 thermal status + 别让 CPU 饿死 VIO"【官方】。社区经验是"**持续负载约 10 分钟后开始降频**"【社区，Tripo3D】。**工程含义**：①目标帧率定 **30 fps 稳定** > 60 fps 波动（这正是 ARCore 官方原话的意思）；②准备一个"过热降档"：连续 3 分钟帧时间 > 33 ms 就把 DPR 从 2 降到 1.5、阴影贴图从 1024 降到 512。
- **AR 模式下的实际帧率经验值**：**未取到可信的、可复现的第三方实测数据集**。我不编。可用的替代是上面的 8–9 ms 渲染预算 + 自己的真机 profiling（列入 §7 未验证清单）。

### 4.5 分辨率策略（这是移动端最有效的一根杠杆）

```js
// ① DPR 钳制：这是第一步，也是最有效的一步
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));   // 360×780@DPR3 → 别用 3

// ② WebXR 里 `setPixelRatio` 无效，要用 framebuffer scale
renderer.xr.setFramebufferScaleFactor(0.85);   // 必须在 session 开始前调用
// 0.85² ≈ 0.72 的像素量 → 约 28% 的填充节省，视觉几乎无损（AR 里内容本身是"贴"在真实画面上的）

// ③ 动态分辨率：按滚动平均帧时间调 scale
let acc = 0, n = 0, scale = 1.0;
function autoRes(dt) {
  acc += dt; n++;
  if (n < 60) return;
  const avg = acc / n; acc = 0; n = 0;
  if (avg > 0.033 && scale > 0.6) { scale -= 0.1; renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * scale); }
  else if (avg < 0.020 && scale < 1.0) { scale += 0.05; renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * scale); }
}
```

- **阴影贴图尺寸**：1024²（≈4 MB）是甜点；512² 在 2 m 阴影相机下约 4 mm/texel，小岛边缘会明显锯齿；2048² 在手机上收益递减且多 12 MB。**固定 1024**。
- **MSAA**：WebXR 会话里 `antialias` 由合成器决定，你设了也没用；非 WebXR 路线（getUserMedia）保留 `antialias: true`，但成本约 +20% 带宽，低端机可关。
- **后处理分辨率**：所有模糊类 pass 一律在 1/4 分辨率（§3.4）。

### 4.6 一个容易忽略的预算项：8th Wall 路线的引擎体积

如果走 8th Wall，`@8thwall/engine@0.1.0` 解包 **29,293,936 B（29.3 MB）**【数据】。WASM SIMD 是**硬要求**（官方 browser requirements 明列）。含义：
- 首屏要 loading 态，且必须 gzip/brotli + CDN（wasm 压缩比通常 3–4×，实际传输 8–10 MB 量级，**未实测**）；
- 局域网直连（手机 ↔ PC）时，29 MB 从 PC 传给手机在 Wi-Fi 5 上约 3–8 秒，可接受但要显示进度；
- 相对地，纯 three.js 路线的 bundle（three + addons）约 **600–700 KB gzip**（未实测，量级判断）。

---

## 5. 素材与许可（这条决定能不能发布）

### 5.1 Minecraft 官方纹理能不能随产品分发？

**不能。** 这是全报告法律风险最高的一条，证据是 EULA 原文 + 真实下架案例。

**Minecraft EULA 原文（2026-11-16 抓取）**【官方】【[minecraft.net/en-us/eula](https://www.minecraft.net/en-us/eula)】：

> "**Do not distribute or make commercial use of anything we've made without our permission.**"
> "By 'distribute anything we've made' what we mean is: **give copies of our game software or content to anyone else**; make commercial use of anything we've made; try to make money from anything we've made; ..."
> "**a single Minecraft block (including its textures and its 'look and feel') - we own that**; your creation of a Gothic Cathedral with a rollercoaster running through it - we don't own that."
> "we retain ownership of our Minecraft intellectual property, which includes the game itself (**including its content like the textures of our blocks** and our character skins)"

**Minecraft 品牌/素材使用指南原文**（比 EULA 更细，且有个反直觉的定义）【官方】【[minecraft.net/en-us/usage-guidelines](https://www.minecraft.net/en-us/usage-guidelines)】：

> "**Do not redistribute our games or any alterations of our games or game files**"
> "Do not make commercial use or commercially exploit anything that we have made unless these guidelines say it's okay"
> "In these guidelines, commercial use means **any uses of our name, brand, or assets that you use and share with others (regardless of whether you receive payment or provide it for free)**."
> 必需声明："**NOT AN OFFICIAL MINECRAFT [PRODUCT/SERVICE/EVENT/etc.]. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT**"

**注意那个"免费也算 commercial use"的定义**——它把"我免费放出去"这条退路也堵了。指南允许的是"粉丝创作、视频、服务器、地图"这类场景，**不是"把 MC 方块贴图打进我的 Web 应用"**。

**真实下架案例（这是最有力的证据，且就发生在 2026 年）**【数据，GitHub 官方 dmca 仓库】：

| 日期 | 目标 | 规模 | 链接 |
|---|---|---|---|
| **2026-09-14** | `Eaglercraft-Archive/EaglercraftX-1.8-workspace` + 全部 fork。**Eaglercraft 就是"浏览器里的 Minecraft 克隆"** | **237 个仓库**（"processed the takedown notice against the entire network of 237 repositories"） | [2026-09-14-minecraft-7.md](https://github.com/github/dmca/blob/master/2026/09/2026-09-14-minecraft-7.md) |
| 2025-07-11 | `DustyDel/EagsTestServer`（Eaglercraft 1.12 服务端） | 3 个 | [2025-07-11-minecraft.md](https://github.com/github/dmca/blob/master/2025/07/2025-07-11-minecraft.md) |

2026-09 那封通知里 Mojang 的授权代表明确写："**The entire repository is infringing.**"，并引用 EULA 的三条禁令。**Eaglercraft 的形态和我们这个项目高度相似（WebGL/浏览器里跑 MC 风格世界 + MC 素材），这是最直接的风险参照。**

### 5.2 `minecraft-assets` 这类 npm 包算不算合规？

**结论：代码 MIT 不等于素材可用；"运行时从 Mojang 下载"不能洗白，而且工程上也不可靠。**

【数据】`minecraft-assets@1.19.0`，license `MIT`，最后更新 2026-08-22；`mc-assets@0.2.91`（2026-11-07）；`minecraft-data@3.119.0`（2026-10-29）。这些包的 **MIT 只覆盖它们自己的代码**，不覆盖 Mojang 的贴图/模型。

"运行时从 Mojang 服务器拉取"这条路的问题：
1. **法律定性不明**：复制行为发生在用户设备上，形式上像"深度链接"，但你的产品**明知且以分发为目的**地引导下载 Mojang 的版权素材，还可能违反 EULA 里"不得以不公平/不合理的方式让别人获取我们的东西"（"give access to anything we've made in a way that is unfair or unreasonable"）。**我没有找到任何判例或官方许可，所以这是"未定"，不是"安全"。**
2. **工程上脆弱**：依赖 Mojang 的 CDN 路径、版本目录结构、CORS 策略。它们一变你就白屏。
3. **产品上不可接受**：首屏要等第三方 CDN，和"打开就能用"冲突。

**建议：明确不用。** 风险收益比太差——我们只需要 ~20 张 16×16 的图。

### 5.3 替代方案：CC0 / CC-BY 的体素贴图（具体到可下载）

**首选（我已实测下载验证）**：`programmerart-textures`

| 项 | 实测值 |
|---|---|
| npm 包 | `programmerart-textures@2.1.0` |
| 许可 | **CC0-1.0**（README 原文："Creative Commons Zero 1.0 Universal Public Domain Dedication"、"Original textures designed for voxel games, freely released for any use"） |
| 仓库 | `github.com/deathcap/ProgrammerArt` |
| 体积 | tarball **1,090.1 KB**，643 个文件 |
| 内容 | `textures/blocks/` 下 **349 个 PNG，全部 16×16 px**（我读了 PNG 头验证：`anvil_base.png → 16x16`） |
| 覆盖 | `blocks/grass_top`、`blocks/dirt`、`blocks/grass_side`、`blocks/stone` 等 MC 同构命名，直接能做图集 |
| 署名要求 | 无（CC0） |

**用法注意**：它的**文件名**沿用了 MC 的命名（`grass_side` 之类，属于功能性描述），但**画面是原创 CC0**。建议把它当"我们的美术基线"：重命名进自己的图集、按需要改配色（比如把草色调暖一点以匹配暖阳光），并把 CC0 声明写进 `THIRD_PARTY_NOTICES.md`（虽然 CC0 不要求，但便于审计）。

**其他可核实的候选**：

| 来源 | 许可 | 适用性 | 状态 |
|---|---|---|---|
| 自己画 16×16 图集（~20 tile） | 自有 | **最干净**，且能精确控制"暖色调/像素风" | 推荐作为最终方案；1–2 天工作量 |
| `kenney.nl/assets/voxel-pack` | CC0（Kenney 全站通用） | 偏 3D 模型/低多边形，不是 16×16 像素图集 | 页面 **403 Forbidden（curl 被 Cloudflare 拦）**，许可未直接取到 → **未验证** |
| OpenGameArt 的 CC0 16×16 tileset | 逐包不同（多为 CC0/CC-BY） | 需逐包核对 | **未取到具体包**（未穷举） |
| Minetest Game 贴图 | CC BY-SA（社区通行说法） | 与 MC 风格接近 | 我在 `minetest/minetest_game` 的 `LICENSE.md` 拿到 404，**未取到**，不引用 |

### 5.4 Q 版角色：社区二创形象的商用边界

这是第二个高风险项。分三层：

**第一层：厂商官方素材（DeepSeek 的鲸鱼 logo 等）——不能当角色用。**
官方《DeepSeek 品牌素材使用规范》原文【官方】【[guidelines.md](https://github.com/deepseek-ai/awesome-deepseek-integration/blob/main/docs/_logo%20svg/guidelines.md)】：

> "All use of brand assets must be **legitimate and necessary, limited solely to descriptive and nominative use. Trademark use is prohibited**."
> "Use DeepSeek assets **accurately and appropriately**. Do not use incorrect, counterfeit or low-quality assets, and **do not alter them without authorization**."
> "You may use these brand assets **only if you have actually integrated DeepSeek models or APIs**..."

即：logo 只能"指名道姓地提到"，**不能当商标性使用、不能改**。把鲸鱼 logo 拟人化成一个女仆装角色 = 改动 + 商标性使用 → 不行。

**第二层：社区二创的「DeepSeek 鲸鱼娘」——明确不可商用。**
据一份公开的"素材出处核查"文档记录【二手，需自行复核原始出处】【[dsh-pets ATTRIBUTION.md](https://github.com/bloodarea/dsh-pets/blob/main/assets/characters/deepseek/ATTRIBUTION.md)】：

```
上善无形 / 上善（原始鲸鱼娘形象）
  └─ ZipZipPipe（加入 DeepSeek 元素与女仆装，声明 CC BY-NC-SA 4.0）
       ├─ lmy414/ai-chan-sheets（设定图/三视图）
       └─ Photonico/AI_characters（Q 版）
```
> "ZipZipPipe 在《大AI和小AI们》简介与 2026-09-12 动态中明确：DeepSeek 二次设计采用 **CC BY-NC-SA 4.0**，**形象不可商业化**。"

> ⚠️ **证据强度说明**：上面这段的中介是我实际抓取的 GitHub 文档，它引用的**原始出处是 B 站动态**（`bilibili.com/opus/1247156596114456581`），我**没有直接打开该动态核实**（B 站在无 Cookie 环境下大概率拒绝抓取）。**如果你要据此做商用决策，必须自己去打开那条动态确认。** 但即便这条记录有误，"社区二创 + 未声明商用许可"的默认状态也是**不可商用**，方向不变。

**CC BY-NC-SA 的 NC = 禁止商业使用，SA = 衍生作品必须同许可。** 这意味着：哪怕我们只做"非商业 demo"，一旦发布带广告/收费/公司主体，就越界了；而且 SA 会传染到我们的角色资产。

**第三层：所以怎么办？**
- **立刻可做**：用**原创占位角色**（不是鲸鱼娘，只是"蓝发 + 鲸鱼尾巴 + 女仆裙"的**风格借用**——**风格/配色/服装类型本身不受版权保护**，受保护的是"具体表达"）。这条边界在实践中是可行的，但**越接近原设计越危险**，建议换掉标志性元素（比如把鲸鱼尾换成鱼鳍披风、把发色从标志性蓝换成青绿）。
- **要商用就自己画/委托画**，并保留创作过程记录（谁画的、什么时候、参考了什么）。
- **AI 生成的角色**：注意生成模型的 ToS（多数平台声称对输出不主张版权，但不保证不侵权第三方 IP），**不要用"某角色的名字"当 prompt**。

### 5.5 占位模型的格式建议

| 格式 | 适用 | 优点 | 缺点 | 建议 |
|---|---|---|---|---|
| **glTF / GLB** | three.js 原生 | `GLTFLoader` 一等公民；单文件；PBR；骨骼动画；Draco/meshopt 可压 | 无面部绑定标准 | **首选**（尤其 `glTF + Draco`） |
| **VRM** | 虚拟形象生态 | 基于 glTF；自带**每模型许可元数据**；SpringBone（裙摆/尾巴物理）现成 | three.js 需社区 loader（`@pixiv/three-vrm`，**未验证版本**）；VRM 的许可是**逐模型**的，不是格式给的 | 若要做"可换装/换人设"再上 |
| **Spritesheet（2D 序列帧）** | Q 版小比例角色 | **最便宜**（1 个 quad + 1 张图，~40 tris）；像素风天然契合；不用骨骼 | 不能自由转视角（只有几个朝向）；和 3D 岛的风格统一要调 | **强烈建议作为第一阶段占位**：参考图里角色只有 1/10 屏高，2D billboard 完全够，还能立刻有"表情/口型" |

**VRM 的许可要点**（避免误以为"VRM 就免费"）【官方】【[vrm.dev license](https://vrm.dev/en/vrm/meta/license/)】：VRM 把许可写在**模型元数据**里，包括"**For commercial use: Disallow / Allow**"、"A person who can perform with this avatar"、以及再分发许可（`CC0 / CC BY / CC BY-NC / CC BY-SA / CC BY-NC-SA / CC BY-ND / CC BY-NC-ND / Redistribution Prohibited / Other`）。**用任何 VRM 模型前必须读它的 meta，不能看格式就假设可用。**

**我的推荐路径**：
1. **第 1 周**：Spritesheet billboard（8 朝向 × 4 帧 idle），先把"岛上有两个小家伙在动"做出来；
2. **第 3–4 周**：换成 glTF（自制/委托），加骨骼 idle/working 两套动画；
3. **可选**：如果要做"玩家自定义角色"，才引入 VRM（并做许可校验 UI）。

---

## 6. 推荐架构

### 6.1 分层（关键是把 AR 关掉也不影响其他层）

```
┌─────────────────────────────────────────────────────────┐
│ 表现层  three.js r187: 体素 mesh + 图集 + 阴影 + 移轴后期  │
├─────────────────────────────────────────────────────────┤
│ 世界层  VoxelWorld (32×32×16, chunk 16³, greedy)          │
│         编辑 API: setBlock(x,y,z,id) → 重建受影响 chunk    │
│         权威状态在 PC（DSH 侧），手机是"瘦客户端 + 预测"    │
├─────────────────────────────────────────────────────────┤
│ 交互层  Raycaster → 命中面 → 相邻空格 → 放置预览 → 提交    │
│         长按删除 / 撤销栈 / 触觉反馈 (navigator.vibrate)   │
├─────────────────────────────────────────────────────────┤
│ 角色层  billboard 或 glTF + 状态机 (idle/走/建造/说话)     │
│         位置由 PC 的 AI 决策驱动，手机做插值              │
├─────────────────────────────────────────────────────────┤
│ ★ AR 适配层（唯一需要按平台分叉的地方）                    │
│   interface ARSession {                                  │
│     start(): Promise<void>                               │
│     getCamera(): THREE.Camera                            │
│     hitTest(screenX, screenY): Pose | null               │
│     getLightEstimate?(): {sh, dir, intensity} | null      │
│     getOcclusionMesh?(): THREE.Mesh | null                │
│     onFrame(cb): void                                    │
│   }                                                      │
│   ├── WebXRAdapter   (Android Chrome 81+)                │
│   ├── EighthWallAdapter (iOS 16.4+ / Android, 含 SLAM)    │
│   └── FallbackAdapter  (3DOF + 手动放置，任何浏览器)      │
└─────────────────────────────────────────────────────────┘
```

**为什么这层抽象是必须的，不是过度设计**：
1. WebXR 的相机是 `renderer.xr.getCamera()`（**由浏览器控制，你不能改 projection matrix**），8th Wall 的相机是**你自己控制**的 `PerspectiveCamera` + 它的内参；
2. WebXR 的摄像头画面**你拿不到**（合成器贴的），8th Wall/3DOF 的摄像头是**你的 `VideoTexture`**；
3. 这两条差异会一路渗透到"能不能做移轴"（§3.4）、"阴影怎么投"、"点击怎么拾取"。**在 adapter 边界上把差异吃掉，上层一行业务代码都不用改。**

### 6.2 三阶段落地路线（每阶段都可交付、可演示）

**阶段 0（1–2 天）：没有 AR 也能验证视觉**
纯 three.js + `OrbitControls`，把岛、房子、TNT、两个角色、弹幕字幕全摆出来，加阴影和 AgX 色调映射，截一张 1080p 图。**先确认"好不好看"**——这是整个项目最不确定的部分，不该被 AR 阻塞。

**阶段 1（第 1 周）：Android Chrome WebXR + 点按建造**
- `ARButton.createButton(renderer, { requiredFeatures:['hit-test'], optionalFeatures:['light-estimation','depth-sensing'] })`
  （**注意不要把 `light-estimation` 放进 `requiredFeatures`**：不支持该特性的设备会直接 `requestSession` 失败，整条路就断了。必选项只留 `hit-test`。）
- hit-test 出准星 → 点击 → 把岛 `anchor` 到那个位姿；
- 建造：`Raycaster` 打体素 mesh → 用命中面的法线取相邻格 → 网格对齐 → 提交；
- 阴影用 §3.1 的 `ShadowMaterial`（diorama 跟着 anchor 走，shadowCatcher 作为它的兄弟节点）；
- **验收标准**：中端安卓上稳定 30 fps（用 `renderer.info.render.calls` 确认 DC < 60）。

**阶段 2（第 2 周）：AI 接入 + 字幕**
- 手机 ↔ PC（DSH）走局域网 WebSocket；世界权威状态在 PC，手机发 `setBlock` 意图，PC 回 `worldDiff`（乐观更新 + 冲突回滚）；
- AI 的"思考"变成弹幕字幕（DOM 层，`position: absolute` + 逐字动画，**不要用 3D 文字**：DOM 的字形渲染和动画成本远低于 `TextGeometry`）。

**阶段 3（第 3 周，可选）：iOS**
- 接 8th Wall：`EighthWallAdapter` 用它的帧循环喂 `getCamera()`，摄像头画面挂到全屏 quad（或让它自己合成）；
- 此时 §3.4 的移轴/颗粒可以作用在**真实画面**上，视觉直接到位——这是 iOS 路线的意外红利。

### 6.3 "如果只能做一件事，做什么"

> **做「阶段 0 + 阶段 1 的阴影/移轴/色调映射」——也就是"在真实的桌子上，让一座会投下柔和阴影的 MC 小岛稳定地待着"，加上"点一下就能放一个方块"。**

理由：
1. 这一件事**就验证了产品的全部核心假设**（"桌面微缩"的视觉冲击 + "点按建造"的可玩性），而它**不需要 iOS、不需要 AI、不需要角色**；
2. 它的技术风险最高（"像不像"是玄学），失败要早发现；
3. 它的依赖最少（只有 three.js + 一个 Android 手机），**今天下午就能开始**；
4. 一旦这件事成立，"加 iOS""加 AI 角色""加弹幕"都是**线性工程**；一旦不成立，后面全是沉没成本。

**具体到代码量**：约 **600–900 行**（体素世界 200 + 渲染/阴影 150 + hit-test/放置 120 + 交互/UI 150）。**1 个人 3–4 天能跑通。**

---

## 7. 未验证清单（不要把这些当结论用）

| # | 未验证项 | 为什么重要 | 怎么验证（建议） |
|---|---|---|---|
| 1 | **中端安卓真机帧率** | 全报告的 30/60 fps 结论都是推算，我没在手机上测过 | Redmi/realme 级机型 + Chrome remote debugging + `renderer.info` + `requestAnimationFrame` 埋点 |
| 2 | **WebXR 里的 BokehPass 实际耗时** | §3.4 的成本是算术，不是测量 | 真机开 `EXT_disjoint_timer_query_webgl2`（若可用）或二分法 |
| 3 | **8th Wall 在微信内的可用性** | 官方只承诺 WKWebView(iOS 14.3+)/SFSafariViewController，**没点名微信** | 微信内打开 demo，看 `getUserMedia` 是否被拦、WASM SIMD 是否可用 |
| 4 | **抖音/夸克/UC 的实际内核版本与 WASM SIMD 支持** | 决定"分享链接给朋友"能不能用 | 各壳浏览器打开 caniuse 的 wasm-simd 测试页 + 一个 `getUserMedia` demo |
| 5 | **8th Wall 二进制在 AR 场景的真实 fps 与首屏加载时间** | 29 MB 是硬成本 | 本地起 https + 真机测 LCP/首帧 |
| 6 | **`@8thwall/engine@0.1.0` 的开源版是否真能独立跑通 SLAM** | 文档说开源版"不含 SLAM，但可以嵌入闭源 SLAM 模块"，**具体怎么嵌入我没看到步骤** | 读 `github.com/8thwall/engine` 的 README/安装指引（我拉 API 时被 403 限流，未取到） |
| 7 | **Zappar 的实际定价** | `zappar.com/pricing` 是 JS 渲染，curl 只拿到 3 KB 骨架 | 用真浏览器打开，或直接问销售 |
| 8 | **Wonderland Engine 的任何数据** | 我猜的 repo 名全 404，未穷举 | 官网 + GitHub 搜索 |
| 9 | **Kenney Voxel Pack 的许可原文** | 页面 403 | 浏览器打开，或找它的 GitHub 镜像 |
| 10 | **Minetest 贴图的许可** | 想作为 CC-BY-SA 备选 | `minetest/minetest_game` 仓库根目录找 LICENSE（我试的路径 404） |
| 11 | **MC 素材"运行时下载"的法律定性** | §5.2 的结论是"未定"，不是"违法"也不是"合法" | 需律师意见；工程上一律避免 |
| 12 | **`programmerart-textures` 的图是否真的"像 MC"** | CC0 是干净了，但可能丑到不能用 | 我已下载（`_tmp/e_tex/package/textures/blocks/`），拼一张 atlas 肉眼看 |
| 13 | **`@pixiv/three-vrm` 与 three r187 的兼容性** | 阶段 3 才需要 | `npm view @pixiv/three-vrm` + 跑官方 example |
| 14 | **iOS 26/27 上 MindAR 的实际表现** | 若走"零闭源依赖"路线必须知道 | 真机 iPhone 打开 MindAR 官方 demo |
| 15 | **AR 里 `ShadowMaterial` 在真实桌面上的观感** | 阴影黑度/边缘硬度需要视觉校准（`opacity` 0.42 是猜的） | 阶段 0 的截图对比真实照片 |

---

## 附录 A：本报告用到的可复现命令

```powershell
# 版本 / 许可（2026-11-16 采样）
npm view three version license
npm view @8thwall/engine version license dist.unpackedSize
npm view mind-ar version time.modified
npm view @zappar/zappar-threejs version license
npm view @google/model-viewer version license
npm view aframe version license

# 体素几何预算（本报告 §4.2 的表）
node scripts/e_voxel_budget.js

# CC0 贴图包（§5.3，已实测：349 个 16×16 PNG）
npm pack programmerart-textures   # 1,090.1 KB

# GitHub 元数据
Invoke-RestMethod "https://api.github.com/repos/mrdoob/three.js" -Headers @{'User-Agent'='dsh'}

# caniuse 原始数据（证明 iOS Safari 到 27.2 都不支持）
curl.exe -sL "https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/webxr.json"

# chrome platform status（注意：响应带 XSSI 前缀 ")]}'"，要剥掉）
curl.exe -sL "https://chromestatus.com/api/v0/features/5450241148977152"
```

## 附录 B：本机环境实测数据

| 项 | 值 |
|---|---|
| OS | Windows（PowerShell 5.1.26100.9818） |
| Chrome | **157.0.8103.51**（`C:\Program Files\Google\Chrome\Application\chrome.exe`） |
| Node | v24.19.0 |
| npm | 11.17.0 |
| 项目内 `_tmp/poc/node_modules/three` | **0.128.0**（旧，被 `prismarine-viewer` 传递依赖带进来的，**不要用它做 AR**） |

> 注意：`_tmp/poc` 里那个 `three@0.128.0` 是 2021 年的版本，`XREstimatedLight`、`WebXRDepthSensing`、`AgXToneMapping` **全都没有**。新代码必须用 `three@0.187.0`。

---

*报告结束。所有 star / 版本 / 许可均为 2026-11-16 采样；所有"未取到"均已显式标注；所有【推断】均已标注推理依据。*
