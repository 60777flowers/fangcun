# 报告 C：手机↔电脑互联 / 「手机看到」/ 手机端跑 DSH —— 决策报告

> 调查截止：**2026-11-16（北京时间）** ｜ star / 版本采样日：**2026-11-16**
> 归属：R4（手机看到）、R5（互联）、R6（手机端 DSH）
> 本机环境：Windows，Node **v24.19.0**，npm **11.17.0**，DSH **0.2.1-rc.5**，Java **17.0.5**，WLAN **192.168.68.54/22**
> 写作纪律：凡本机实测的数字都标「实测」；凡来自官方文档/README 的标「文档」；凡按物理/工程推算的标「推算」；拿不到的写「未取到」，并在第 9 节「未验证清单」里汇总。

---

## 0. 执行摘要：手机摄像头到底该怎么用

### 0.1 一句话结论

**不要把手机摄像头对着屏幕。** 正确的拆法是：**「AI 怎么看」走协议状态 + PC 端截图（不用摄像头、不用手机）；「人怎么看 AI」走手机浏览器/串流（现在就能用）。** 摄像头那条路对 AI 侧没有任何增量信息，只有不可逆的信息损失；对人也是最差的一种"显示方式"。

### 0.2 「手机看到」其实是三个不同的需求，代价差 20 倍

用户那句「最好轻量化、能用手机摄像头看到」里，混着三件互不相关的事：

| 编号 | 真实需求（用户可能的意思） | 该用什么实现 | 结论 |
|---|---|---|---|
| **①** | **AI 需要"看"游戏画面**（摄像头拍屏幕 → OCR/多模态） | **不需要摄像头**：mineflayer 直读结构化状态（血量/背包/方块/实体/事件）；确需像素时 PC 本机截图（DXGI/`mss`/DXcam，0 ms 通路） | **淘汰摄像头**，见 §2 |
| **②** | **人不在电脑前，想用手机看 AI 在玩**（或自己在手机上玩） | **串流真客户端窗口**：Sunshine + Moonlight（LAN 25–55 ms）；只想要"聊天+思考过程"时直接开 DSH Web GUI | **推荐**，见 §3、§5 |
| **③** | **人想确认"AI 到底在干什么"**（bot 的第一人称） | 参考实现 `luckui/dsh-game` 的做法是**开一个真 MC 客户端旁观 AI**，画面是一个 Windows 窗口 → 手机只能看窗口串流；prismarine-viewer 是理论上"零安装网页"的替代，但**本次实测渲染不出来**（§4.2） | **③b 窗口串流推荐；③a 降级** |

### 0.3 三条必须写进决策的硬约束（都已实测/读到原文）

1. **摄像头方案对 AI 侧无效**：AI 与游戏在同一台机器上，摄像头拍屏幕只会把「像素级精确的帧缓冲」变成「摩尔纹 + 5–7 px 的小字 + 对焦抖动」。（§2.4 有量化推算）
2. **手机拿不到麦克风除非 HTTPS**：DSH 语音输入 = 浏览器麦克风 + 本地 SenseVoice，官方约束「Browser microphone access requires HTTPS or loopback」。手机用 `http://192.168.68.54:3080` 打开 → 麦克风按钮不可用。三条解法见 §5.4。
3. **生产实现里 AI 的画面是一个原生窗口，不是网页**：`dsh-game` 的摄像机是一个真 MC 客户端（离线号 `DaFeiYuCam`，RCON `spectator`/`spectate`），HUD 网页只绑 `127.0.0.1:7391`（给 OBS 用）。所以「手机看 AI 画面」= **串流那个窗口/显示器**，不是"打开一个网页"。

### 0.4 推荐（含反例，见 §8）

| 场景 | 推荐 | 一句话理由 |
|---|---|---|
| 在家，同 WiFi，只想看 AI 玩 | **Sunshine + Moonlight**（串流摄像机窗口所在显示器） | 真画面、HUD 完整、手机只装一个 app、LAN 25–55 ms |
| 在家，只想看 AI 说什么/想什么 | **手机浏览器开 DSH Web**（`?token=` 链接） | 零安装、已经有 token 鉴权（实测 401→200） |
| 出门在外 | Moonlight over **Tailscale**（或临时 cloudflared 隧道 + `--trusted-host`） | 不用公网 IP、免费 |
| 想让 AI "看"画面 | **别用摄像头**：mineflayer 状态 + `screenshot` 工具（PC 本机） | 0 延迟 0 信息损失，还能直接喂多模态 |
| 只有手机、没有 Windows 电脑 | ①摄像头（唯一可能），但不要指望 AI 能读懂 | 这是唯一让①成立的前提 |
| 想自己在手机上"一起玩" | **GeyserMC + 基岩版**（手机玩 Java 服） | 手机版与 Java 版不互通，Geyser 是桥梁（5969★） |

---

## 1. 方法与采样说明

### 1.1 做了哪些实测（可复现，附录 §10 有完整命令与输出）

| # | 实验 | 结果 |
|---|---|---|
| E1 | 本机 Node/npm/DSH/Java 版本 | Node v24.19.0 / npm 11.17.0 / dsh 0.2.1-rc.5 / Java 17.0.5 |
| E2 | `npm i mineflayer prismarine-viewer` | **188 包 / 3 分钟 / 857 MB 磁盘**（含 canvas+playwright） |
| E3 | 本地起官方 MC 1.20.1 服务端 | 45.6 MB jar，`Done (3.389s)`，端口 25565 |
| E4 | mineflayer bot 登录 + prismarine-viewer 起服务 | login 445 ms → spawn 735 ms → viewer 1424 ms；`RSS 130.6 MB` |
| E5 | 用 socket.io 客户端模拟手机浏览器，统计收到的渲染数据 | 6 秒收到 **109 × `loadChunk` + 61 × `entity` + 5 × `position`，共 3,059 KiB** |
| E6 | 用 headless Chromium（SwiftShader）+ 有头 Chromium（RTX 3060/ANGLE D3D11）截图 | 页面 262 ms 加载完、11 个资源 2.5 MB、**0 个 JS 报错**，但**画布只有天空色**（两种 GPU 后端都一样）→ **渲染失败，根因未定位** |
| E7 | Windows 防火墙入站规则核查 | `node.exe` 只有 **Public** profile 的放行规则；Private 无 → 手机大概率连不上（§5.5） |

### 1.2 star 采样（2026-11-16，GitHub API `/repos` 与 `/search/repositories` 实取）

| 仓库 | ★ (2026-11-16) | License | 最后 push | 备注 |
|---|---:|---|---|---|
| Genymobile/scrcpy | **154,945** | Apache-2.0 | 2026-11-14 | 电脑控手机（方向要注意） |
| rustdesk/rustdesk | **129,663** | AGPL-3.0 | 2026-11-16 | 可自建 |
| fatedier/frp | **110,592** | Apache-2.0 | 2026-11-10 | 需公网 VPS |
| obsproject/obs-studio | 79,612 | GPL-2.0 | 2026-11-11 | 窗口采集+HUD 叠加 |
| termux/termux-app | 64,982 | NOASSERTION | 2026-11-05 | Android 上的 Linux 环境 |
| moeru-ai/airi | 51,469 | MIT | 2026-11-16 | 数字人陪玩（含 MC） |
| **SunshineStream/Sunshine**（原 LizardByte/Sunshine，已改名） | **43,457** | GPL-3.0 | 2026-11-16 | 串流主机端，170 open issues |
| tailscale/tailscale | 39,181 | BSD-3-Clause | 2026-11-16 | 零配置组网 |
| **pavlobu/deskreen** | 21,756 | AGPL-3.0 | 2026-07-08 | 浏览器当第二屏 |
| moonlight-stream/moonlight-qt | 19,547 | GPL-3.0 | 2026-11-15 | 客户端（PC） |
| termux/termux-packages | 17,374 | NOASSERTION | 2026-11-16 | Node 26.13.1 在此 |
| zerotier/ZeroTierOne | 17,259 | NOASSERTION | 2026-09-03 | 备选组网 |
| cloudflare/cloudflared | 16,609 | Apache-2.0 | 2026-11-12 | 免费隧道 |
| HMCL-dev/HMCL | 10,999 | GPL-3.0 | 2026-11-15 | 启动器（dsh-game 依赖） |
| rustdesk/rustdesk-server | 10,750 | AGPL-3.0 | 2026-11-08 | 自建中继 |
| PrismarineJS/mineflayer | 7,768 | MIT | 2026-11-14 | AI 的"身体" |
| moonlight-stream/moonlight-android | 7,500 | GPL-3.0 | 2026-10-17 | 客户端（手机） |
| mindcraft-bots/mindcraft | 6,017 | MIT | 2026-10-27 | LLM+mineflayer 参考 |
| **GeyserMC/Geyser** | 5,969 | MIT | 2026-11-15 | 基岩版↔Java 版桥 |
| MineDojo/MineDojo | 2,284 | MIT | 2024-03-18 | 已停更 |
| PrismarineJS/node-minecraft-protocol | 1,422 | BSD-3-Clause | 2026-10-27 | 协议层 |
| PrismarineJS/minecraft-data | 961 | 无 license 字段 | 2026-11-03 | 72 个 PC 版本数据 |
| dev47apps/droidcam-obs-plugin | 767 | GPL-2.0 | 2026-06-23 | DroidCam 的 OBS 插件 |
| GeyserMC/Floodgate | 705 | MIT | 2026-09-17 | 免正版账号进服 |
| PrismarineJS/prismarine-web-client | 558 | MIT | 2026-10-06 | 网页版 MC 客户端 |
| **PrismarineJS/prismarine-viewer** | **408** | MIT | 2026-10-06 | **npm 最新版停在 2025-02-09** |
| DeviceFarmer/minicap | 397 | NOASSERTION | 2026-11-12 | Android 截屏底层 |
| PaddlePaddle/PaddleOCR | 92,750 | Apache-2.0 | 2026-09-16 | OCR（若坚持走 OCR） |

> 闭源、无 GitHub star 的对象：DroidCam、Iriun、Camo Studio、IP Webcam、EpocCam、Parsec、ToDesk、向日葵、spacedesk。这些在第 3、4 节用表格单列，star 栏写「闭源」。

### 1.3 npm 侧实取（2026-11-16）

| 包 | 版本 | 发布时间 | 关键依赖 |
|---|---|---|---|
| prismarine-viewer | **1.33.0** | **2025-02-09**（npm 记录 `modified` 同日） | `three@0.128.0`（2021 年版本）、`prismarine-chunk ^1.22`、`socket.io` |
| mineflayer | 4.39.0 | 2026-09-06 | `minecraft-protocol`、`minecraft-data` |
| minecraft-data | 3.119.0 | — | 覆盖 72 个 PC 版本（含 1.21.11 / 26.1） |

> **注意**：prismarine-viewer 仓库还有提交（pushed 2026-10-06），但 **npm 已经 21 个月没发版**，且把 `three` 死钉在 2021 年的 0.128.0。这与 §4.2 的渲染失败高度吻合。

---

## 2. 方案①：手机摄像头拍电脑屏幕

### 2.1 链路

```
 ┌────────────┐   ①光学二次成像    ┌──────────────┐   ②编码/网络   ┌─────────────┐
 │ 显示器      │ ────────────────▶ │ 手机摄像头    │ ─────────────▶ │ 电脑         │
 │ 1920×1080  │  摩尔纹/反光/      │ 12MP, 30fps  │  USB/WiFi      │ 虚拟摄像头   │
 │ MC 画面     │  对焦/色偏/滚动快门 │              │  100–500 ms    │ 驱动         │
 └────────────┘                    └──────────────┘                └──────┬──────┘
                                                                          │ ③再解码
                                                                          ▼
                                                              ┌──────────────────────┐
                                                              │ OCR / 多模态模型      │
                                                              │ → 游戏状态（低置信度）│
                                                              └──────────────────────┘
```

**这条链路上每一跳都在丢信息，而终点想要的（游戏状态）本来在起点就有无损版本。**

### 2.2 现成 app 实况（2026-11-16）

| 工具 | 平台 | 免费额度 | 是否要装驱动 | 延迟量级 | 结论 |
|---|---|---|---|---|---|
| **DroidCam（Classic）** | Android | 官网原文：**"Unlimited free usage at standard definition"**（即免费不限时**仅 SD**，HD 需内购） | **要**：官网写明 *"works with a PC Client component that installs the webcam drivers"* | 100–300 ms（WiFi，推算） | 能跑，画质/延迟都差 |
| **DroidCam Webcam & OBS Camera**（新版，闭源） | Android/iOS | 免费+内购 | OBS 插件方式可免系统驱动（`droidcam-obs-plugin` 767★ GPL-2.0） | 同上 | 同上 |
| **Iriun Webcam** | Android/iOS | 免费（1080p 宣传） | 要装虚拟摄像头 | 100–300 ms | 备选 |
| **Camo Studio** | iOS/Android | 订阅制、免费档有限制 | 要 | 100–300 ms | 贵 |
| **IP Webcam**（闭源） | Android | 免费带广告 | **不要**（浏览器/RTSP/MJPEG 直取，最轻） | **200–500 ms**（MJPEG 推算） | **这条链路上最轻的一种**，但仍无 AI 价值 |
| **EpocCam** | iOS/Android | 免费带广告/付费 HD | 要 | 150–300 ms | 同上 |
| **scrcpy `--video-source=camera`** | Android 12+ | 免费开源，**免 root** | 不要 | 35–70 ms（scrcpy README 原文 low latency: 35~70ms） | **技术上最优的"手机当摄像头"**，但方向仍是"给电脑当摄像头"，不是给 AI 读屏 |
| **Android 14 原生「设备当 USB 摄像头」** | Android 14+ | 系统自带 | 不要（标准 UVC） | 低（USB） | 免装第三方，最干净 |

> 证据：DroidCam 官网原文抓取 2026-11-16（`dev47apps.com`）；scrcpy 相机模式文档 `doc/camera.md`「Camera mirroring is supported for devices with Android 12 or higher」；Android 14 的 UVC webcam 能力见 AOSP 文档 `source.android.com/docs/core/camera/webcam`。

### 2.3 这条链路"人看"是什么体验

- **可用**，很多人就是这么用的（把旧手机当摄像头开 Zoom）。
- 但对"看 MC"是**反向优化**：手机屏幕本来就在你手上，你却让它去看另一块屏幕再传回来。
- 实测类比的替代：`scrcpy` 直接传**屏幕像素**（不经过光学），同一台手机延迟 35–70 ms、分辨率无损、颜色无损。**"摄像头 vs 截屏"不是取舍，是降级。**

### 2.4 量化：手机拍屏后，OCR 还能读 MC 的 HUD 吗？

**结论：读不了（至少撑不起 agent 的决策循环）。** 下面是推算，实验设计见 §9（V1）。

**第 1 步：分辨率预算**

| 量 | 取值 | 说明 |
|---|---|---|
| 显示器 | 24″ 1920×1080 | 像素间距 ≈ **0.2745 mm** |
| MC HUD 字号 | GUI scale 2 → 字形 **16 px**；scoreboard/物品名常见 scale 1 → **8–9 px** | 原版位图字体，字形本身 8×8 |
| 手机主摄 | 12 MP（4032×3024），等效 26 mm，水平 FOV ≈ 66° | 主流机型 |
| 拍摄距离 | 1.2 m（手持/支架） | 覆盖宽度 ≈ 1.55 m → **0.385 mm/相机像素** |
| 采样比 | 0.385 / 0.2745 ≈ **1.4 屏幕像素 / 相机像素** | 即相机在**欠采样**屏幕 |
| 成像后字高 | 16 px → **≈11 相机 px**；8–9 px → **≈6 相机 px** | 再叠加镜头 PSF 1–2 px 模糊 |
| OCR 可靠阈值 | Tesseract 官方建议 ~300 DPI，实务上大写字母高度 **≥10–12 px** 才稳 | 6 px 的字形 + 位图字体硬边缘 = 不可靠 |

**第 2 步：摩尔纹**

屏幕 RGB 子像素间距 ≈ 0.09 mm，相机采样 0.385 mm → **欠采样 4.3 倍**。拍屏幕必然产生低频拍频条纹（摩尔纹），条纹的走向会**横穿字形笔画**。MC 的位图字体没有抗锯齿、笔画只有 1 px 宽 → **摩尔纹对它是毁灭性的**（这是"最坏情况"：硬边缘 + 周期性点阵）。

**第 3 步：时序**

滚动快门 + 自动对焦呼吸 + 手抖 → 帧与帧之间有几像素的几何抖动 → **无法靠多帧平均恢复**；每帧都是一次新的抽奖。

**第 4 步：成功率估计（推算，未实测）**

| 目标 | 最好情况（三脚架/手动对焦/无摩尔纹角度） | 手持实际情况 |
|---|---|---|
| 聊天框大字（GUI scale 2，16 px） | 60–85% 字符正确率 | 30–60% |
| HUD 数字（血量/饥饿/坐标，8–9 px） | <30% | <10% |
| 动态元素（掉落物名、nametag、伤害数字） | ≈0 | ≈0 |
| **能否支撑 agent 每 0.5–2 s 一次可靠决策** | **不能** | **不能** |

> 这四行是**按成像物理推算的估计值**，不是实测。要变成实测只需一个下午：同一台电脑拍 100 帧 → 跑 PaddleOCR/Tesseract → 统计字符准确率（见 §9 未验证清单 V1）。

### 2.5 关键判断

> **这条路对 AI 侧无效，只对"人看"有效——而且人对它也不满意。**

理由排序：
1. **信息论上就是负和**：起点（帧缓冲）是无损的，终点（相机成像）是有损的。任何"AI 读屏"需求都应直接读帧缓冲。
2. **成本更高**：手机 app + PC 驱动 + 支架 + 补光 + 对位，比 `dsh web --host` 一条命令重得多。
3. **延迟更差**：100–500 ms vs 串流 25–70 ms vs 本机截图 <5 ms。
4. **唯一合理前提**：**AI 不在电脑上**（跑在手机上），且**不允许在电脑装任何软件**（不能跑 scrcpy/串流）——这时摄像头是唯一能"看见"的物理通道。但那个场景下，用户也没有"桌面 MC"可玩了，与项目前提冲突。

---

## 3. 方案②：手机当第二屏 / 远程桌面 / 串流

### 3.1 表格（方向先分清，这是最容易搞混的地方）

| 方案 | 方向 | 谁装什么 | 延迟 | 免费 | 公网 IP | 能否给 AI 用 |
|---|---|---|---|---|---|---|
| **scrcpy** 154,945★ Apache-2.0 | **电脑控手机**（反了！） | PC 装 scrcpy，手机只开 USB 调试 | **35–70 ms**（README 原文 `low latency: 35~70ms`，启动 ~1 s） | 全免费开源 | 不需要 | 不能（传的是手机屏，不是 PC 屏） |
| **Sunshine + Moonlight** 43,457★ GPL-3.0 + 19,547★ GPL-3.0 | PC → 手机 | PC 装 Sunshine，手机装 Moonlight | **LAN 25–55 ms**（§3.3 组件预算），公网 +20–80 ms | 全免费开源 | 不需要（LAN）；外网需 Tailscale/端口映射 | **能**（真画面可截图喂多模态） |
| **RustDesk** 129,663★ AGPL-3.0（+server 10,750★） | 双向桌面控制 | 两端都装 | 50–200 ms（软件编码，推算） | 客户端免费；自建需服务器 | 自建要 | 能但画质/帧率差 |
| **Parsec**（闭源） | PC → 手机 | 两端装 + 账号 | 20–50 ms | 个人免费 | 不需要（打洞） | 能 |
| **ToDesk / 向日葵**（闭源，国内） | 双向 | 两端装 | 50–150 ms | 免费档限速/限画质 | 不需要 | 能但差 |
| **spacedesk**（闭源） | PC → 手机当**扩展屏** | 两端装 | 30–80 ms | 个人免费 | LAN only | 能 |
| **Deskreen** 21,756★ AGPL-3.0 | PC → **任意浏览器** | 只装 PC | 100–300 ms（WebRTC 浏览器端，推算） | 免费开源 | 需自己解决穿透 | 能，但延迟高 |
| **Moonlight Android** 7,500★ GPL-3.0 | 客户端 | 手机装 | 同上 | 免费 | — | 自带**虚拟手柄**（手机当手柄的现成答案） |

### 3.2 Sunshine 能不能只抓「MC 那个窗口」？—— 不能（文档级证据）

抓取 Sunshine 官方配置文档 `docs/configuration.md`（98 KB，2026-11-16），与显示相关的配置项只有：

| 配置项 | 含义 | 是不是"选窗口" |
|---|---|---|
| `output_name` | 选**哪一台显示器**（索引 / EDID GUID） | ❌ 是选显示器 |
| `capture` | 强制采集后端（`kms`/`ddx`/`wgc`…） | ❌ 是选后端 |
| `dd_configuration_option` / `dd_manual_resolution` / `dd_manual_refresh_rate` / `dd_hdr_option` | 动态改分辨率/刷新率/HDR | ❌ |
| `adapter_name` | 选显卡 | ❌ |

**没有任何 `window` / `app` 之类的窗口选择项。** 结论：**Sunshine 只能整显示器采集。**

于是"手机只看 MC 窗口"有三条落地路径：

| 路径 | 做法 | 代价 |
|---|---|---|
| **A. 独占全屏 + 只串流主显示器** | 摄像机客户端全屏，Sunshine `output_name` 指向主屏 | 最简单；但手机看到的是整个桌面（你得把别的东西都收起来） |
| **B. 虚拟显示器** | 装第三方虚拟显示驱动（如 Virtual Display Driver / IddSampleDriver 系）→ 生成一块虚拟屏 → 把 MC 窗口拖上去 → Sunshine 指向它 | 需要装驱动、多显示器配置；**这是"只串流一个窗口"最干净的做法** |
| **C. 自己做一层窗口采集 → 网页** | `Windows.Graphics.Capture` / OBS 窗口采集 + WebRTC/MJPEG 塞回 DSH 页面 | 工程量中等（但这是唯一能"把画面嵌进 DSH 页面"的路，见 §4.3） |

> 参考实现 `dsh-game` 走的是 **A 的变体**：它开一个"不可激活"的 MC 客户端窗口，用 OBS 的**窗口捕获**抓它、再叠一个 `127.0.0.1:7391` 的 HUD 浏览器源。**注意：OBS 能按窗口抓，Sunshine 不能。** 如果用户本来就要直播，OBS 那条线已经解决"窗口级"问题。

### 3.3 延迟预算（LAN，1080p60，组件级推算）

| 环节 | 典型值 | 备注 |
|---|---|---|
| 采集（DXGI Desktop Duplication / WGC） | 1–5 ms | |
| 编码（NVENC/AMF/QSV，H.264/HEVC） | 5–15 ms | 低延迟预设 |
| 网络（千兆有线） | 1–2 ms | |
| 网络（WiFi 5 / 6） | 3–8 ms | 2.4G 会更差 |
| 解码（手机硬解） | 5–15 ms | |
| 显示（一帧间隔 @60fps） | 8–17 ms | vsync 不开可减 |
| **合计（LAN）** | **25–55 ms** | 与 scrcpy 官方 35–70 ms 同量级 |
| **合计（公网直连/DERP 中继）** | **+20–80 ms** | 取决于路径 |

### 3.4 MC 服务器反作弊会不会管？

- **单机 / 自建离线服**：完全不管。`dsh-game` 的前提就是 `online-mode=false` + RCON。
- **有反作弊的多人服**：远程桌面本身不触发任何检测（它就是"人在玩"）；但**输入自动化**（脚本按键、自动瞄准）在某些服会被判宏。串流方案下"人"是真人在操作，风险≈0；**bot（mineflayer）进公共服才是真正的风险点**（协议层 bot 常被判定为外挂）。这属于 report-A 的范围，此处只标边界。

---

## 4. 方案③：手机看 AI 的"第一人称"

### 4.1 无头 bot 能出画面吗？—— 默认不能，需要额外一层

mineflayer 是**协议级** bot：它维护世界模型（方块、实体、背包、时间），但**没有渲染器**。它的 `bot.blockAt()`、`bot.entities`、`bot.health`、`bot.inventory` 是结构化数据，**没有像素**。

要出画面有三条路：

```
 (a) prismarine-viewer：把 bot 的世界模型序列化 → socket.io → 浏览器 three.js 渲染
     优点：手机开网页就行，零安装
     缺点：画面简陋（无原版材质包/HUD/动画）、实体表现差、版本支持滞后、**本次实测白屏**（§4.2）

 (b) 真客户端旁观（dsh-game 的做法）：开一个真 MC 客户端，RCON 切 spectator 挂到 bot 身上
     优点：100% 原版画面、有 HUD、有材质/光影/动画
     缺点：要装同版本客户端 + 开 RCON + 吃一份客户端性能；画面是**原生窗口**，手机要看必须串流

 (c) 纯截图给 AI：PC 本机截屏（DXGI/mss/DXcam）→ 直接喂多模态
     优点：0 延迟、像素级精确、不需要手机
     缺点：只是"AI 的输入"，不是"人看的东西"
```

### 4.2 实测：prismarine-viewer 能不能用？（**本次最重要的负面结果**）

**环境**：Windows / Node v24.19.0 / mineflayer 4.39.0 / prismarine-viewer 1.33.0 / MC 1.20.1 官方服务端（本地）。

**实测输出（原文）**

```
Prismarine viewer web server running on *:3007
=== EVENTS ===
login @445ms
spawn @735ms pos=(-0.5, -60, 4.5)
viewer started @1424ms
HTTP GET / -> 200, 473 bytes, hasCanvas=true
socket.io handshake -> 200, 0{"sid":"...","upgrades":["websocket"],...}
RSS=130.6MB heapUsed=40.8MB
```

**数据面：通。** 用一个 socket.io 客户端模拟浏览器连上去，6 秒内收到：

```
SOCKET hist {"version":1,"entity":61,"loadChunk":109,"position":5} bytes 3059KiB
PROBE {"pos":[0.5,-60,-7.5],"belowBlock":"grass_block","columns":109}
```

即：bot 确实加载了 **109 个 chunk**、站在 `grass_block` 上，viewer 也确实把 **109 个 `loadChunk` + 61 个 `entity`** 推送给了客户端，**6 秒 3 MB JSON**，页面 262 ms 加载完、11 个资源 2.5 MB、**0 个 JS 报错**。

**渲染面：失败。** 无论哪种 GPU 后端，画布都只有天空色：

| 后端 | 结果 |
|---|---|
| headless Chromium + SwiftShader（软件渲染） | 白屏（纯天空色） |
| **有头 Chromium + RTX 3060 Laptop / ANGLE D3D11**（真实 GPU） | **白屏（纯天空色）** |
| `firstPerson: true` / `false` | 都白屏 |

截图见 `reports/assets/poc-prismarine-viewer-blank.png`（3,144 字节 —— 纯色图）。canvas 尺寸 1962×4354 正常创建，WebGL 上下文正常，`renderer` 报的是 `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU ... Direct3D11)`，**但场景里没有画出任何几何体**。

**根因未定位**（诚实记录）。最可疑的三点：
1. npm 上前端包停在 **2025-02-09**，`three` 钉在 2021 年的 **0.128.0**；而本次服务端/数据是 **minecraft-data 3.119（1.20.1）** → chunk 段格式/材质表可能对不上，网格生成静默失败（浏览器侧 worker 里报错不冒泡到 page）。
2. 项目 open issues **70 个**、总 star 只有 **408** → 长尾问题无人修。
3. 无原版材质包，渲染本身就很"素"，即便修好也不是"陪玩画面"。

**结论（对决策最重要的一句）**：
> **"手机浏览器零安装看 bot 第一人称"这个美好设想，在 2026-11 的实际可维护版本上是不可靠的。** 它数据面通、成本极低（一条 npm），但**画面层不可信**。要做产品不能把它当主路径。

### 4.3 参考实现的真相：AI 的画面是一个 Windows 窗口

抓 `luckui/dsh-game` 的 README（2026-11-16）：

| 事实 | 原文/证据 | 对我们的含义 |
|---|---|---|
| AI 的身体 | mineflayer，单独打包成**子进程** | 无渲染能力 |
| AI 的"眼睛"（画面） | **开一个真的 MC 客户端**（离线号 `DaFeiYuCam`），RCON 发 `gamemode spectator` / `spectate` / `data get entity` 挂到 bot 身上 | 画面 = 原生窗口 |
| 窗口行为 | "不抢焦点、不锁鼠标……被设成『不可激活』"；切视角靠给窗口发 F5 | 适合"人在旁边看"，不适合"远程看" |
| HUD | "透明、点击穿透的小窗口（PowerShell 现场编译的 C#）" | 叠在窗口上，不在网页里 |
| HUD 网页 | "HUD 网页开在本机端口 **7391**，只监听 `127.0.0.1`" | **手机看不到**（除非改 host） |
| 直播 | "OBS 用『窗口捕获』抓摄像机窗口，再加一个『浏览器源』填 `http://127.0.0.1:7391/`" | 窗口级采集已被 OBS 解决 |
| 依赖 | Windows + DSH Web + Node 22+ + 同版本 MC 客户端 + Java 21 + RCON + 离线服 | 手机端 0 依赖 |

> **所以 R4 的答案从"技术上"坍缩成一句话**：**AI 的画面是一个 Windows 窗口；"手机看到"= 把这个窗口送到手机上。** 摄像头（①）和 prismarine-viewer（③a）都不是这个窗口。

### 4.4 三种"③"的取舍

| 变体 | 手机端安装 | 画面真实度 | 延迟 | 工程量 | 结论 |
|---|---|---|---|---|---|
| ③a prismarine-viewer | 0（浏览器） | ★★（无 HUD/材质/动画，**实测白屏**） | <100 ms | 极小 | 降级/实验 |
| **③b 真客户端窗口 + Sunshine/Moonlight** | 1 个 app | ★★★★★（原版画面 + HUD） | 25–55 ms | 小（装两个软件） | **推荐** |
| ③c 窗口采集 → WebRTC → DSH 页面 | 0（浏览器） | ★★★★★ | 50–150 ms | **中**（要写 capture→encode→stream） | 若"必须嵌在 DSH 页面里"才做 |

---

## 5. R5：手机↔电脑互联

### 5.1 先分类：三种"连"

| 层级 | 用途 | 方案 |
|---|---|---|
| **L1 控制面** | 手机看/发消息给 AI（聊天、思考过程、任务） | DSH Web GUI（HTTP+WS） |
| **L2 视频面** | 手机看游戏画面 | Sunshine+Moonlight / OBS+Deskreen / RustDesk |
| **L3 音频面** | 手机当麦克风（说话给 AI） | 浏览器 `getUserMedia` → **必须 HTTPS 或 loopback** |

三层可以独立选，**不要用同一个方案硬套三层**（这是"轻量化"的关键：L1 用网页，L2 用串流，L3 用 HTTPS）。

### 5.2 穿透/组网对比

| 方案 | 需要公网 IP | 手机装 app | 延迟加价 | 成本 | 免费额度 | 适合 |
|---|---|---|---|---|---|---|
| **同 WiFi + LAN IP** | 否 | 否 | **0–5 ms** | 0 | — | 家里（首选，零安装） |
| **Tailscale** 39,181★ | 否（WireGuard 打洞，失败走 DERP） | 是 | 直连 +5–20 ms / 中继 +50–150 ms | 免费层 | 官方 Free/Personal 层（**具体设备数本次未从页面取到**，页面为 JS 渲染 → 未验证） | 外出首选 |
| **ZeroTier** 17,259★ | 否 | 是 | 同量级 | 免费层 | 25 节点（历史值，**未复核**） | 备选 |
| **cloudflared 隧道** 16,609★ | 否 | 否 | +30–100 ms（绕 Cloudflare 边缘） | 0（quick tunnel 免账号） | 无限时 | 临时演示 / 只为拿 HTTPS |
| **frp** 110,592★ | **是**（VPS） | 否 | 取决于 VPS：10–40 ms | ¥30–60/月 | 无 | 长期自建、可控 |
| **adb reverse**（USB） | 否 | 否 | ~1 ms | 0 | — | 调试 / 拿 secure context 的偏方（§5.4 ④） |

### 5.3 DSH Web 在局域网上的真实行为（已实测，含 403/401 规则）

**规则（读 `dsh-client-connection/README.zh.md` 原文）**：
- 每个请求先过浏览器信任栅栏：`Host` 必须是 **loopback**、**等于监听器的绑定 IP 字面量**、或命中 `trustedHosts`；`Origin` 必须是同一 authority；`sec-fetch-site: cross-site` 一律拒绝。
- **Host/Origin 校验失败 → 403；Host 可信但未认证 → 401。**
- `dsh web --host 0.0.0.0` **不受支持**（必须填具体网卡 IP 字面量）。
- 每个进程生成一个随机启动 token，`dsh-web-app` 打印并打开 `?token=...`；`GET /?token=...` 通过后写一个 **host+port 绑定的签名 cookie**（`HttpOnly`、`SameSite=Strict`、默认 30 天，只有监听器本身是 TLS 时才带 `Secure`），然后 302 到干净的 `./`。**静态资源保持公开。**

**实测（父代理在本机跑的，2026-11-16 17:41）**：

| 请求 | 结果 |
|---|---|
| `GET http://192.168.68.54:3099/`（不带 token） | **401** |
| `GET http://192.168.68.54:3099/?token=<token>` | **200**，38,343 字节 HTML |
| `GET /api` | 401 |

**给用户的结论**：
- 手机打开 `http://192.168.68.54:3080/?token=<电脑上打印的那串>` → **一次**即可，之后 cookie 记住（同 IP 同端口，最多 30 天）。
- **不需要 `--trusted-host`**（直连 IP 时 Host 就等于绑定 IP，天然通过栅栏）。
- **只有**走反向代理/域名（`xxx.trycloudflare.com`、`xxx.ts.net`、自签域名）时才必须 `--trusted-host <那个 authority>`。
- 换端口/换 IP → cookie 失效，要重新用新 token 链接进。
- ⚠️ 安全：绑非 loopback 后**同网段任何人都能加载静态资源**（登录态仍需 token/cookie）。家里 WiFi 可接受，公司/咖啡厅不建议。

### 5.4 手机麦克风：必须有 HTTPS（或 loopback）—— 三条最省事的路

**约束**：DSH 语音输入 = 浏览器麦克风（`getUserMedia`）+ 本地 SenseVoice；官方原文「Browser microphone access requires HTTPS or loopback」。浏览器规范里 `http://192.168.x.x` **不是**安全上下文（只有 `http://localhost` / `127.0.0.1` 被特别对待）→ **麦克风按钮点了没反应**。

| # | 方案 | 命令/操作 | 证书信任 | 成本 | 延迟 | 适合 |
|---|---|---|---|---|---|---|
| **①** | **Tailscale + `tailscale serve`** | `tailscale serve --bg localhost:3080` → 手机开 `https://<机器名>.<tailnet>.ts.net/`（官方示例：`tailscale serve localhost:3000`，默认走 443/HTTPS） | **自动、合法**（ts.net 由 Tailscale 签发，手机天然信任） | 免费层 | +5–30 ms | **最省事，推荐** |
| **②** | **cloudflared quick tunnel** | `cloudflared tunnel --url http://127.0.0.1:3080` → 得到 `https://xxx.trycloudflare.com`；DSH 需加 `--trusted-host xxx.trycloudflare.com` | **合法**（Cloudflare 边缘证书） | 0，免账号 | +30–100 ms | 临时试/给别人演示 |
| **③** | **自签证书 + 手机装 CA** | `mkcert`（或 openssl）签一张含 `192.168.68.54` 的证书 → `dsh web --host 192.168.68.54 --tls-cert c.pem --tls-key k.pem`；Android：设置→安全→加密与凭据→安装证书→**CA 证书** | 需要手动装（Chrome 信任用户 CA） | 0 | LAN 原生 | 只在 LAN、不想用第三方 |
| **④**（偏方） | **`adb reverse` + localhost** | `adb reverse tcp:3080 tcp:3080` → 手机浏览器开 `http://localhost:3080` | **不需要证书**（loopback 就是安全上下文） | 0 | ~1 ms（USB） | 调试 / 不想折腾证书 |

> 注意：③ 里的自签必须把 **IP 写进 SAN**（`subjectAltName=IP:192.168.68.54`），否则 Chrome 报 `NET::ERR_CERT_COMMON_NAME_INVALID`；并且 **HTTP 与 HTTPS 的 cookie audience 不同**（DSH 文档明确：`https:` 的 cookie 不能通过 TLS 监听器认证），换协议要重新拿 token。
>
> 公网暴露提醒：②/① 会把 DSH 暴露到公网。DSH 的 token+cookie 是"防误撞"，不是"抗攻击的账号体系"——**不要把它直接挂到公网长期开放**，Tailscale 至少还有设备级网络隔离。

### 5.5 Windows 防火墙：实测结论 + 命令

**实测（本机）**：

```
Get-NetFirewallProfile → Domain/Private/Public 全部 Enabled，DefaultInboundAction = NotConfigured（等效 Block）
node.exe 的入站放行规则 → 只有 2 条，Profile = Public（没有 Private/Domain）
```

**这意味着**：家里的 WLAN 通常被 Windows 识别为 **Private**，而 `node.exe` 只在 **Public** 有放行 → **手机连 `192.168.68.54:3080` 会被静默丢弃**（浏览器一直转圈）。

> 关于"首次监听会不会弹允许对话框"：Windows 对"首次入站监听的可执行文件"确实会弹一次"允许访问"对话框；但**本次机器上的规则集里没有任何 Private 的 node 规则**，说明**不能依赖弹窗**（弹过也可能只对 Public 生效，或当年点了取消）。**结论：装机脚本里必须显式加规则。**

```powershell
# 给 DSH Web 与 prismarine-viewer 开一条"仅私有网络 + 仅本网段"的入站放行
New-NetFirewallRule -DisplayName "DSH web 3080 (LAN private)" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3080 `
  -Profile Private -RemoteAddress 192.168.68.0/22

New-NetFirewallRule -DisplayName "MC viewer 3007 (LAN private)" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3007 `
  -Profile Private -RemoteAddress 192.168.68.0/22

# Sunshine：直接按"程序"放行，省得逐个端口对（它用的是一串派生端口，默认基端口 port = 47989）
New-NetFirewallRule -DisplayName "Sunshine (program, LAN private)" -Direction Inbound `
  -Program "C:\Program Files\Sunshine\sunshine.exe" -Action Allow -Profile Private
```

> Sunshine 的完整端口清单以官方安装向导/`docs` 的 Ports 一节为准（本次只从配置文档核实到基端口默认 `port = 47989`，其余派生端口**未逐个核对**，故上面用"程序级放行"规避）。

> 排查口诀：`Test-NetConnection <PC-IP> -Port 3080` 在**另一台设备**上跑才是有效测试（在本机测自己 LAN IP 会走 loopback，**绕过防火墙**，看起来总是通）。

---

## 6. 延迟预算表（给设计用）

| 场景 | 目标 | 依据 | 我们方案能不能满足 |
|---|---|---|---|
| **人自己玩 MC（串流当显示器）** | **< 50 ms** 才有"我在玩"的手感；50–80 ms 可接受；> 100 ms 明显拖影 | 经验值（设计目标） | Sunshine LAN 25–55 ms ✔；公网 60–130 ms ⚠️ |
| **人看 AI 玩（旁观）** | **< 200 ms** 足够（AI 动作本来就慢） | 经验值 | 全部方案 ✔（连摄像头 300 ms 都能忍） |
| **AI 决策回路** | **0.5–3 s/次**（LLM 推理主导，网络无关） | DSH/LLM 实际 | ✔（画面延迟不是瓶颈，**模型延迟才是**） |
| **语音对话往返** | **< 1.5 s** 才有"在聊"的感觉：VAD 0.2 s + ASR 0.3 s + LLM 首 token 0.5 s + TTS 0.3 s | 经验拆解 | DSH 本地 SenseVoice ✔；豆包 TTS 需网络 ⚠️ |
| **画面像素延迟（组件级）** | 采集 1–5 + 编码 5–15 + 网络 1–8 + 解码 5–15 + 显示 8–17 = **25–55 ms** | §3.3 推算，与 scrcpy 35–70 ms 同量级 | ✔ |

> 这四条预算加起来说明一件事：**"看 AI"对延迟极不敏感（200 ms 就够），"自己玩"才敏感（<50 ms）。** 因此如果用户主要在电脑前自己玩、只是偶尔拿起手机看一眼，**串流的画质优先级高于延迟**（可以开高码率、低帧率）。

---

## 7. R6：手机端跑 DSH 现实吗？

### 7.1 技术上：能（Node 不是瓶颈）

**Termux 的 Node 版本（实取 `termux-packages` 的 `build.sh`，2026-11-16）**：

| 包 | `TERMUX_PKG_VERSION` |
|---|---|
| `nodejs` | **26.13.1** |
| `nodejs-lts` | **24.22.3** |

- 两者都远高于 DSH 参考实现要求的 Node 22+（`dsh-game` README：Node.js 22+）。
- 依赖链：`libc++ openssl c-ares libicu libsqlite zlib libffi`（`nodejs` 的 `TERMUX_PKG_DEPENDS`）→ 纯用户态，**不需要 root**。

### 7.2 但：三个"不值得"的理由（都有实测/文档支撑）

**理由 1：磁盘。** 本次实测（Windows，同一套代码）：

| 目录 | 大小 |
|---|---:|
| `node_modules` 合计（mineflayer + prismarine-viewer + canvas + playwright） | **857 MB** |
| └ `minecraft-data` | **495 MB**（72 个版本的协议/方块/贴图数据） |
| └ `prismarine-viewer` | **257 MB**（npm 元数据 `unpackedSize = 269,284,936` 字节） |
| └ `three` | 24 MB |
| └ `canvas`（原生模块） | 35 MB |

手机上装"Agent + 一个 bot"起步就是 **几百 MB 到 1 GB** 的 `node_modules`（视是否要 viewer 而定），Termux 还要另算 Node 本体。

**理由 2：原生模块。** `prismarine-viewer` 在 Node 侧 `require('canvas')`（`viewer/lib/entities.js` 第 7 行）——本次在没有 canvas 时直接 `Error: Cannot find module 'canvas'` 崩掉。装上 `canvas@3.2.3` 后 4 秒装好（Windows 有 prebuilt，**35 MB**）。**arm64 Android 上 node-canvas 没有官方 prebuilt，需要现场编译 Cairo/Pango**（Termux 可以，但要装 `pkg install cairo pango libjpeg-turbo` 等一长串，编译十几分钟）→ 这是"手机上跑"的第一个真门槛。

**理由 3：常驻。** Android 会用 **phantom process killer**（Android 12+ 对"非前台子进程数"上限约 32 个，超了杀）和电池优化杀后台 Node；Termux 需要 `termux-wake-lock` + 关电池优化 + 前台通知，且**系统升级/省电策略变化会周期性把长驻进程干掉**。对"陪玩"这种要连续跑几小时的任务，可靠性明显低于 Windows 服务。

### 7.3 架构上：手机根本不需要跑 Agent

DSH 的形态（实取 `dsh --help` 与 `package.json`）：

| 入口 | 形态 | 手机能不能用 |
|---|---|---|
| `dsh web` | 浏览器 UI（HTTP+WS） | **能，这就是"手机端 DSH"的答案** |
| `dsh headless "task"` | 一次性跑完打印结果 | 能（但不适合实时陪玩） |
| `dsh --profile sdk` / `acp` | JSON-RPC / ACP over stdio | 能（给外部程序驱动，不是给人用） |
| `dsh plugin ...` | 插件管理（pnpm） | 手机上跑 pnpm 装插件，很痛 |

**决策：**

| | 手机跑 Agent | **电脑跑 Agent + 手机只做屏/麦克风/摄像头（推荐）** |
|---|---|---|
| 算力 | 手机 SoC 跑 LLM 不现实（除非小模型，效果差） | 有 GPU/大内存 |
| 常驻 | Android 会杀 | Windows 稳定 |
| 工具链 | DSH 的 `pwsh` 工具在 Android 上是空的（没有 PowerShell）→ 得改 profile | 原生匹配 |
| 磁盘 | 1 GB+ | 已有 |
| 调试 | 难 | 易 |
| 延迟 | 无优势（模型在云端） | 同 |

**唯一例外**：你想让 AI 用手机的**摄像头/麦克风/通知/位置**做"具身感知"（比如 AI 真的"看见"你在房间里的动作）。这时手机端只需要跑一个**瘦客户端**（采传感器 → WebSocket 发 PC），**不需要跑整个 DSH**。

### 7.4 顺便：手机当"手柄/语音输入/第二屏"的成熟开源项目

| 需求 | 现成方案 | 状态 |
|---|---|---|
| 手机当**手柄** | **Moonlight Android 自带虚拟手柄**（7,500★）；或 `scrcpy --otg`（USB 键鼠） | 成熟 |
| 手机当**第二屏** | **Deskreen**（21,756★，PC 装，手机浏览器打开）；spacedesk（闭源免费） | 成熟但延迟一般 |
| 手机**语音输入**给 PC | 手机浏览器开 DSH Web（HTTPS）→ 麦克风 → 本地 SenseVoice；或 Termux + `whisper.cpp` | 前者成熟 |
| 手机**玩 Java 版 MC** | **GeyserMC/Geyser**（5,969★ MIT）+ Floodgate（705★）：让基岩版客户端进 Java 服务器 | 成熟，但要服务端装插件 |
| 手机**看 AI 画面** | Sunshine + Moonlight | 成熟（本报告推荐） |

> 特别提醒：**手机版 MC（基岩版）和 Java 版不互通**。如果用户想"拿手机跟电脑上的人一起玩"，答案不是"手机跑 DSH"，而是 **服务端装 Geyser**。这是 R5 里最容易踩的认知坑。

---

## 8. 决策矩阵（3 方案 × 6 维度）与明确推荐

### 8.1 矩阵

| 维度 | ① 手机拍屏 | ② 远程桌面/串流 | ③a prismarine-viewer | ③b 真客户端窗口串流 |
|---|---|---|---|---|
| **延迟** | **100–500 ms**（光学+编码+网络+再解码） | **25–70 ms**（LAN） | <100 ms（网页本地，**但画不出来**） | **25–55 ms**（LAN） |
| **安装成本** | 高：手机 app + PC 虚拟摄像头驱动 + 支架/对位/补光 | 低：PC 装 Sunshine，手机装 Moonlight（各 1 个） | 极低：`npm i` 一条（但 **857 MB**） | 中：MC 客户端 + RCON + Sunshine + Moonlight |
| **是否需 root** | 否 | 否 | 否 | 否 |
| **局域网 / 公网** | LAN（USB 最稳） | LAN 首选；公网需 Tailscale/frp | LAN 直接可（监听 `*:3007`，**无鉴权**） | LAN 首选；公网同 ② |
| **对 MC 的侵入性** | **零** | 零（但抓整屏） | 零（只读 bot 世界模型） | 低（多开一个 spectator 客户端） |
| **能否被 AI 消费** | **差**（信息不可逆损失，OCR 不可靠） | 中（真画面，可截图喂多模态） | **差**（渲染失败/画面简陋） | **中高**（同一窗口可截图） |
| **谁受益** | 只有"人"，且体验最差 | 人 | 人（实验性质） | **人（推荐）** |
| **一句话** | **淘汰** | 兜底 | 实验 | **主选** |

### 8.2 明确推荐

> **推荐方案 ③b ——「电脑跑 Agent + 真 MC 客户端旁观 + Sunshine/Moonlight 把那个窗口串到手机」，并把 ①（手机摄像头拍屏）明确淘汰。**
>
> 理由（按重要性）：
> 1. **AI 侧完全不需要摄像头**：mineflayer 直接给出 `health/food/inventory/entities/blocks/事件流`，精度高于截图且 0 延迟；确需像素时 PC 本机截屏（DXGI）即可，多模态还能直接吃。
> 2. **人侧要的是"真画面"**：③b 给的是 100% 原版画面 + HUD（`dsh-game` 已经把它做出来了：真客户端 + RCON spectator + 不可激活窗口 + C# HUD 叠加），手机只装一个 Moonlight。
> 3. **①是纯降级**：更慢（100–500 ms）、更贵（驱动+支架）、更差（摩尔纹/小字/色偏），且**对 AI 毫无增量**。
> 4. **③a 不可靠**：本次实测两种 GPU 后端都白屏；npm 21 个月没发版；star 408、70 个 open issue → 不能当产品主路径。
> 5. **手机端零安装**：Moonlight 是成熟开源客户端（7,500★），带虚拟手柄；不想装 app 时用 DSH Web 看聊天/思考。

### 8.3 什么情况下改用另一个（反例，必须写清）

| 情况 | 改用 | 为什么 |
|---|---|---|
| **只要看 AI 说了什么/在想什么，不看游戏画面** | **DSH Web（手机浏览器）** | 零安装、已有 token 鉴权；比串流轻一个数量级 |
| **只有手机，没有 Windows 电脑**（AI 也跑在手机上） | **①摄像头**（唯一可能） | 没有别的物理通道；但别指望多模态能读懂 HUD |
| **必须把画面嵌在 DSH 页面里**（不想装 Moonlight） | **③c 自写窗口采集→WebRTC** | 工程量中等，但产品形态最统一 |
| **网络极差 / 只想看静态状态** | **③a 降级为"定时截图推 MJPEG"** | 30 行代码，比 viewer 靠谱（viewer 的渲染层不可信） |
| **想在手机上"自己玩"而不是看 AI** | **Geyser + 基岩版**，或 Moonlight 虚拟手柄 | 手机版不能直连 Java 服 |
| **要出门在外看** | **Moonlight over Tailscale**；只为 HTTPS 用 **cloudflared 临时隧道** | 免费、无需公网 IP |
| **需要手机麦克风** | 必须上 **HTTPS**（Tailscale serve / cloudflared / 自签+装 CA / adb reverse） | 浏览器安全上下文硬约束 |

### 8.4 给产品的一句话建议

> **把"手机摄像头"这个提法从需求里删掉，换成"手机上的两个入口"：**
> **入口 1（图文/语音）= DSH Web 网页**（含麦克风，需 HTTPS）；
> **入口 2（画面）= Moonlight 串流摄像机窗口**。
> **AI 的"看"永远走协议状态 + 本机截图，永不经过摄像头。**

---

## 9. 未验证清单（诚实边界）

| # | 未验证的事 | 为什么没验 | 怎么验（可执行） |
|---|---|---|---|
| **V1** | **手机拍屏 → OCR 的真实成功率**（§2.4 全是推算） | 手头没有"已渲染的 MC 画面"（prismarine-viewer 白屏）；也没有装 OCR | 用真实客户端开 HUD → 手机拍 100 帧 → `PaddleOCR`/`Tesseract` → 统计字符准确率与置信度分布 |
| **V2** | **prismarine-viewer 白屏的根因** | 前端 worker 内错误不冒泡；时间不够 | 用 Chrome DevTools 附到页面看 worker 控制台；或换 1.16.5/1.18.2 服务端复测（判断是否版本错配） |
| **V3** | Sunshine 串流的**端到端实测延迟**（本报告 25–55 ms 是组件推算） | 没有第二台设备做接收端 | 手机装 Moonlight → 用 `obs` 或"高速摄像机拍两个时钟"测 pixel-to-pixel；或看 Moonlight 内置统计（latency/fps） |
| **V4** | **虚拟显示器**在 Windows 上给 Sunshine 用的具体驱动与稳定性 | 未装（会改显示配置，风险） | 装 Virtual Display Driver → `output_name` 指向它 → 只把 MC 拖上去 |
| **V5** | Tailscale / ZeroTier 的**当前免费额度**（设备数/用户数） | 官网定价页是 JS 渲染，`curl` 拿不到；GitHub API 也已限流（60/h 用尽） | 打开 `tailscale.com/pricing`、`zerotier.com/pricing` 人工抄；或看 `tailscale status --json` 的 plan 字段 |
| **V6** | Cloudflare 免费隧道对**视频流**的条款限制 | 没取到 ToS 原文（未验证） | 读 Cloudflare Self-Serve Subscription Agreement §2.8 |
| **V7** | **Termux 实机**跑 Node 26 + mineflayer（内存/发热/常驻时长） | 本机没有 Android 设备/模拟器 | 真机：`pkg install nodejs-lts` → `npm i mineflayer` → 连本地服务端跑 2 小时，记 RSS/温度/被杀次数 |
| **V8** | node-canvas 在 **arm64 Android** 上的编译成功率 | 同上 | `pkg install cairo pango libjpeg-turbo` 后 `npm i canvas`，记录耗时/报错 |
| **V9** | MC 默认字体「8×8 位图字形」的**官方出处**（我在 §2.4 按常识使用） | 未抓 `assets/minecraft/font/ascii.png` 的元数据 | 解包客户端 jar 看 `assets/minecraft/textures/font/ascii.png`（16×16 个 8×8 字形）+ `font/default.json` 的 `size: 8` |
| **V10** | **1.21.4 / 26.x** 上 mineflayer + `dsh-game` 的组合是否稳定 | 本次只用 1.20.1（Java 17） | 换 Java 21 + 1.21.4 服务端复跑 §4.2 的 E4/E5 |
| **V11** | 手机浏览器打开 DSH Web 的**真实体验**（滚动、输入法、横屏） | 没有真手机 | 手机连 LAN → 开 token 链接 → 走一遍创建会话/看终端/发消息 |
| **V12** | `dsh web` 的 cookie 在**重启后是否仍有效**（密钥持久化在 `$DSH_HOME/.credentials.yaml`） | 未重启验证 | 重启 DSH Web（同 IP 同端口）→ 手机刷新看是否还是登录态 |

---

## 10. 附录：复现命令与原始输出

### 10.1 环境

```powershell
node -v            # v24.19.0
npm -v             # 11.17.0
dsh --version      # 0.2.1-rc.5
java -version      # java version "17.0.5" 2022-10-18 LTS
```

### 10.2 起一个本地 MC 1.20.1（3 秒）

```powershell
# 版本清单 → 1.20.1 的 server.jar（47,791,053 字节，sha1 84194a2f...）
curl.exe -L -o server.jar https://piston-data.mojang.com/v1/objects/84194a2f286ef7c14ed7ce0090dba59902951553/server.jar
# server.properties: online-mode=false, level-type=minecraft\:flat, view-distance=4, enable-rcon 关（本次不需要）
java -Xms512M -Xmx1500M -jar server.jar nogui
# → [Server thread/INFO]: Done (3.389s)!
```

> 顺带发现：本次 `version_manifest_v2.json` 里 `latest.release` 是 **26.3**（2026 年 MC 已改用年份式版本号）；1.20.1 需要 **Java 17**，1.21.1/1.21.4 需要 **Java 21**（manifest 的 `javaVersion.majorVersion` 字段实取）。

### 10.3 bot + viewer（E4/E5/E6 的核心脚本）

```js
// poc.js 片段
const bot = mineflayer.createBot({ host: "127.0.0.1", port: 25565, username: "AI_Bot", version: "1.20.1", auth: "offline" });
bot.once("spawn", () => {
  mineflayerViewer(bot, { port: 3007, firstPerson: true, viewDistance: 4 });
});
// 输出：login @445ms / spawn @735ms / viewer started @1424ms
//       Prismarine viewer web server running on *:3007
//       HTTP GET / -> 200, 473 bytes, hasCanvas=true
//       socket.io handshake -> 200, {"sid":"...","upgrades":["websocket"],...}
//       RSS=130.6MB heapUsed=40.8MB
```

```js
// 模拟"手机浏览器"收渲染数据
const sock = io("http://127.0.0.1:3008", { transports: ["websocket"] });
sock.onAny((n, ...a) => { hist[n] = (hist[n] || 0) + 1; });
// 6 秒后：{"version":1,"entity":61,"loadChunk":109,"position":5}  bytes 3059KiB
```

```powershell
# 截图（headless 用 SwiftShader；有头用真实 GPU）
node shot2.js   # 有头 + RTX 3060 → viewer-headed.png（3,144 字节，纯天空色）
```

> 本次用到的 5 个脚本已存到 `reports/assets/poc/`（`bot.js` / `debug.js` / `poc2.js` / `shot2.js` / `viewer_bot2.js`），配 §10.2 的服务端即可完整复跑；截图存 `reports/assets/poc-prismarine-viewer-blank.png`。

### 10.4 手机接入 DSH Web（实测，父代理 2026-11-16 17:41）

```powershell
node <dsh>\lib\bin.js web --host 192.168.68.54 --port 3099 --no-open
# dsh web: http://192.168.68.54:3099/?token=<TOKEN>
# dsh web: listening on 192.168.68.54 over plain HTTP; restrict this port to a trusted proxy or network
```

| 请求 | 结果 |
|---|---|
| `GET http://192.168.68.54:3099/` | 401 |
| `GET http://192.168.68.54:3099/?token=<TOKEN>` | 200（38,343 字节） |
| `GET /api` | 401 |

### 10.5 防火墙核查

```powershell
Get-NetFirewallProfile | Select Name,Enabled,DefaultInboundAction
# Domain/Private/Public: Enabled=True, DefaultInboundAction=NotConfigured

Get-NetFirewallApplicationFilter | ? { $_.Program -like "*node.exe*" } | % { $_ | Get-NetFirewallRule }
# → 2 条 Allow，Profile = Public（**没有 Private**）
```

---

## 11. 参考链接（全部 2026-11-16 抓取/核对）

- Sunshine（改名 `SunshineStream/Sunshine`）：https://github.com/LizardByte/Sunshine ｜ 配置文档 https://raw.githubusercontent.com/LizardByte/Sunshine/master/docs/configuration.md
- Moonlight：https://github.com/moonlight-stream/moonlight-qt ｜ https://moonlight-stream.org/
- scrcpy：https://github.com/Genymobile/scrcpy ｜ 相机模式 https://raw.githubusercontent.com/Genymobile/scrcpy/master/doc/camera.md ｜ 延迟口径（README `35~70ms`）
- RustDesk：https://github.com/rustdesk/rustdesk ｜ 自建服务端 https://github.com/rustdesk/rustdesk-server
- Deskreen：https://github.com/pavlobu/deskreen
- DroidCam：https://www.dev47apps.com/ ｜ OBS 插件 https://github.com/dev47apps/droidcam-obs-plugin
- Android 14 当 USB 摄像头：https://source.android.com/docs/core/camera/webcam
- prismarine-viewer：https://github.com/PrismarineJS/prismarine-viewer ｜ npm `prismarine-viewer@1.33.0`（2025-02-09）
- mineflayer：https://github.com/PrismarineJS/mineflayer ｜ npm `4.39.0`（2026-09-06）
- Termux：https://github.com/termux/termux-app ｜ Node 版本来源 `termux-packages/packages/nodejs{, -lts}/build.sh`（26.13.1 / 24.22.3）
- Tailscale：https://github.com/tailscale/tailscale ｜ https://tailscale.com/pricing（额度未取到）
- ZeroTier：https://github.com/zerotier/ZeroTierOne ｜ https://www.zerotier.com/pricing/
- cloudflared：https://github.com/cloudflare/cloudflared ｜ frp：https://github.com/fatedier/frp
- Geyser：https://github.com/GeyserMC/Geyser ｜ Floodgate：https://github.com/GeyserMC/Floodgate
- OBS：https://github.com/obsproject/obs-studio
- 参考实现 `dsh-game`：https://github.com/luckui/dsh-game （README 抓取 2026-11-16）
- DSH 内部文档：`@deepseek-ai/dsh-client-connection/README.zh.md`（浏览器信任栅栏/403/401）、`@deepseek-ai/dsh-host-webserver`（host/tls）、`dsh-experimental-voice-input-bundle`（麦克风需 HTTPS）
- 安全上下文（麦克风约束的规范依据）：https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
