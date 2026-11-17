# 设备验证方案（M0，可执行版）

> 目的：用最少的手工测试，验证 [ADR-0003](ADR-0003-android-client-and-ar-stack.md) 的产品/实现验收门，给“继续/回退”提供证据。
> 适用：M0 阶段；Tab S8 当前 ADB 已授权，原生 ARCore POC 首轮真机 smoke 已成功（相机背景、水平面命中、anchor、测试方块）。定量测试、新原生客户端集成验证与 marker provider 仍待完成；marker 是 v0 目标，必要时 ARCore 先交但 marker 必须紧随补齐。真实场景遮挡为已知限制，不作为 POC 通过条件。
> 记录要求：每个测试都要有 **日期、设备、系统版本、构建版本、原始数据、截图/录屏/日志**；没有证据的结果不算通过。

---

## 0. 测试环境与准备

### 0.1 设备

| 设备 | 用途 | 现状 |
|---|---|---|
| Samsung Galaxy Tab S8（SM-X800，Android 16/API 36） | 主测试机 / ARCore 主链 | ADB 已授权；原生 ARCore POC 已安装并完成首轮真机 smoke（相机背景、水平面命中、anchor、测试方块）；产品客户端、漂移/热态定量尚未完成 |
| 第二台 Android（ARCore 中端机优先） | 跨厂商/屏幕/性能兼容 | 待定/借用 |
| 非 ARCore / 无 GMS 设备 | v0 打印标记兼容目标 | 型号待借测；marker 属于 v0 范围。若阻塞核心闭环，允许 ARCore 主链先行，marker 紧随补齐；不能降为未来版本需求 |

### 0.2 PC 与网络

- Windows 11；`ANDROID_HOME=D:\Android\Sdk`；`adb` 可用。
- 手机/平板与 PC 在同一 Wi-Fi（建议 5 GHz，关闭 AP 隔离）。
- 关闭 VPN/代理（会改变局域网可见性）。

### 0.3 ADB 授权状态（已完成）

当前基线：Tab S8 的 ADB 已授权，设备状态为 `device`；不再需要先执行授权步骤。若授权被撤销，再按以下步骤恢复：

1. 设置 → 开发者选项 → 打开“USB 调试”；
2. 用 USB 连接 PC；
3. 平板弹出“允许 USB 调试吗？”→ 勾选“一律允许”→ 允许；
4. PC 执行：

```powershell
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb devices -l
# 期望：R52T7002ZLV  device
```

> 若授权被撤销或状态异常：`adb kill-server` 后重插；必要时在开发者选项里撤销 USB 调试授权后重新授权。

---

## 1. T0 环境采集（5 分钟）

```powershell
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb shell getprop ro.product.model
& $adb shell getprop ro.product.manufacturer
& $adb shell getprop ro.build.version.release
& $adb shell getprop ro.build.version.sdk
& $adb shell wm size
& $adb shell wm density
& $adb shell pm list packages | Select-String "arcore|google"
& $adb shell dumpsys package com.google.ar.core | Select-String "versionName|versionCode"
```

记录到表 T0（见 §8）。**判定**：能读出 ARCore 服务版本即说明设备侧具备 ARCore 运行时；读不到则记录“无 ARCore 服务”。

---

## 2. T1 ARCore 可用性与深度能力（10 分钟）

**目的**：确认设备能否进入 AR 会话、是否支持 Depth API。

**步骤**

1. 安装/启动现有 POC：

```powershell
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb install -r "D:\研一上\AR_MC\apps\android-ar-poc\app\build\outputs\apk\debug\app-debug.apk"
& $adb shell am start -n org.fangcun.ar.poc.debug/org.fangcun.ar.poc.ArPocActivity
```

2. 允许相机权限；在桌面上缓慢移动平板，等待出现平面；点按桌面放置方块。
3. 记录屏幕提示：`Tracking: RUNNING / Anchor placed` 或错误文案。
4. 深度能力：当前 POC 未接 Depth API，先用系统/第三方 AR 应用或后续 M0-2 构建确认；本测试先记录“是否已知支持 Depth API”（参考 ARCore 支持设备列表与厂商说明）。

**判定**

- 通过：能进入 AR、命中水平面、建立 anchor、看到方块；tracking 丢失时提示“world writes disabled”。
- 不通过：无 ARCore 服务、相机不可用、无法命中平面 → 记录原因，设备列入“不支持”。

---

## 3. T2 锚定漂移（30–40 分钟，需标尺）

**目的**：量化“5 分钟/1 m 路径”的漂移；这是桌面微缩世界能否成立的核心指标。

**准备**

- 在桌面上贴一条 30 cm 标尺/纸尺（或用 A4 打印 5 mm 网格纸）。
- 在桌面中心放一个小标记（胶带十字）作为“岛中心”参照。
- 平板固定在同一握持距离（约 40–60 cm），屏幕朝向桌面。

**步骤**

1. 启动 POC，点按桌面中心放置方块（anchor）。
2. 以桌面中心为起点，沿约 1 m × 1 m 的方形路径缓慢移动平板一圈（约 30 秒），回到起点。
3. 在起点保持 5 秒，截屏/录屏；用标尺量方块中心相对“岛中心”十字的偏移（x/z 两个方向）。
4. 重复 10 次（每次可重新进入或保持同一 anchor；记录是否重定位）。
5. 记录每次偏移、是否发生 tracking lost、恢复后是否跳变。

**记录表**（示例）

| 次数 | 偏移 x (cm) | 偏移 z (cm) | tracking lost? | 恢复后跳变 (cm) | 备注 |
|---:|---:|---:|---|---:|---|
| 1 | | | | | |
| … | | | | | |

**判定**

- 通过（建议门槛）：5 分钟内 p95 偏移 ≤3 cm，最大跳变 ≤5 cm。
- 未达：标记“已知不稳定”，记录原始值；不阻断 M0，但影响产品承诺与 UI 提示。

---

## 4. T3 10 分钟热态/帧时/内存（15 分钟）

**目的**：拿到第一份真机性能基线，避免用 PC 截图代替。

**步骤**

```powershell
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb shell dumpsys thermalservice > before-thermal.txt
& $adb shell dumpsys meminfo org.fangcun.ar.poc.debug > before-mem.txt
& $adb shell screenrecord --time-limit 600 /sdcard/fangcun-10min.mp4
# 同时：启动 POC，保持 AR 会话 10 分钟，期间缓慢移动、点按放置 3–5 次
& $adb pull /sdcard/fangcun-10min.mp4 .
& $adb shell dumpsys thermalservice > after-thermal.txt
& $adb shell dumpsys meminfo org.fangcun.ar.poc.debug > after-mem.txt
& $adb shell dumpsys gfxinfo org.fangcun.ar.poc.debug > gfxinfo.txt
```

**记录**

- 设备温度/热状态（`thermalservice` 前后对比）；
- 内存 PSS（前后）；
- 帧时：`gfxinfo` 的 percentile（POC 只有方块，不能代表最终场景；作为基线）；
- 是否掉帧/降频/相机断开。

**判定**：POC 阶段只要求“10 分钟不崩、不严重降频”；最终门槛在 M0-2/M6 用真实场景测（p95 ≤33 ms）。

---

## 5. T4 局域网配对与证书固定（M0-5 后，20 分钟）

**目的**：验证“自签名证书 + 指纹固定 + 一次性码”的可复现性。

**前置**：Host 侧 M0-5 TLS 配对 spike 可供测试；具体启动方式以该 spike 的实际交付说明为准，本方案不预设 npm 脚本名。

**步骤**

1. PC 启动 Host，记录二维码内容与证书指纹（终端会打印）。
2. 平板安装 M0-5 客户端，扫码；观察是否一次配对成功。
3. **负向测试**：把二维码中的 `fp` 改一位（或用脚本生成错误指纹的码），再次连接；必须被拒绝，且不出现“忽略证书”选项。
4. **过期测试**：等待配对码过期（5 分钟）后再用；必须失败并提示重新生成。
5. **撤销测试**：Host 端撤销 session；客户端应在 ≤2 秒内收到 `session_revoked` 并断开。
6. 抓包（可选）：确认 token 不在 URL/日志中；确认 TLS 版本 ≥1.2。

**判定**：全部通过；任何一项失败记录为 P0 缺陷并修复 TLS 配对后重测。不得为绕过证书/配对失败而关闭证书指纹校验或降低传输安全。

---

## 6. T5 SceneView 冒烟（M0-2 后，20 分钟）

**目的**：验证“SceneView + ARCore + glTF + 自定义 MeshNode”在真机可用。

**步骤**

1. 安装 M0-2 APK；允许相机。
2. 依次确认：
   - 相机背景可见、平面命中、anchor 放置；
   - 一个 GLB 角色（或立方体模型）随 anchor 显示；
   - 一个自定义 MeshNode（例如 3×3×3 体素块）显示正确、可旋转视角；
   - 暂停/恢复、tracking 丢失/恢复不崩。
3. 录屏 1 分钟；记录帧时/内存（同 T3 方法）。

**判定**：全部可见且无崩溃；否则按 ADR-0003 G1/G2 回退（降版本或改 Filament 直连）。

---

## 7. T6 DSH/MCP 工具闭环（M0-6 后，20 分钟）

**目的**：确认真实 DSH 能否调用受限工具、取消、超时、错误处理。

**步骤**

1. PC 启动 `packages/mcp-adapter` 的 mock 服务（M0-6 产物），暴露 7 个工具。
2. 在 DSH 中配置 MCP（stdio 或 loopback HTTP，按 M0-6 结论）。
3. 依次调用：
   - `world_observe` → 返回世界摘要；
   - `build_plan` → 返回 planId/diffHash；
   - `build_commit`（不带 approvalId）→ 必须被拒绝；
   - 取消一个进行中的调用 → 必须返回 cancelled；
   - 超时（mock 延迟 10 s）→ 必须返回 timeout，不挂起。
4. 记录 DSH 版本、配置方式、工具列表、错误文案。

**判定**：5 项全通过；否则 M5 前改用宿主插件适配器，并记录原因。

---

## 8. T7 打印标记 provider 真机验证（v0 目标，ARCore 主链可先行）

**目的**：验证非 ARCore/无 GMS 设备的原生 CameraX + marker provider 是否能进入可锚定、fail-closed 的桌面 AR 主流程。此项是 v0 目标；若 marker 实现阻塞 ARCore 主链，可先完成 T1–T6 的 ARCore 主链，再紧随完成此项，不得从 v0 验收范围中删除。

1. 使用与实现版本/许可证匹配的 marker family 和固定 ID；打印哑光标记。记录纸张/标记物理尺寸、打印缩放和文件 hash。初次 POC 可由打印页面显示单个 marker 与虚拟岛，不要求四角标记阵列成为产品协议。
2. 记录打印机缩放（必须 100%，用尺量 marker 实际边长）。
3. 在 30/50/70 cm、自然光/台灯环境测试识别成功率和 pose 抖动；标记必须一直在相机视野内才能承诺稳定。
4. 遮挡 marker >300 ms 时必须冻结所有世界写入；恢复后先进入 relocalizing，要求 pose 连续稳定且用户确认后才能恢复输入。
5. 在至少一台确认不支持 ARCore/无 GMS 的设备实测；记录相机权限、帧率、CPU/热态与 drift。真实场景深度遮挡缺失为已知限制，不阻断核心闭环。

---

## 9. 记录模板

### 9.1 设备与环境（T0）

| 项 | 值 |
|---|---|
| 设备型号 | |
| 厂商 | |
| Android 版本 / API | |
| 屏幕分辨率 / 密度 | |
| ARCore 服务版本 | |
| 测试日期 | |

### 9.2 测试结果汇总

| 测试 | 结果（通过/失败/阻塞） | 关键数据 | 证据文件 |
|---|---|---|---|
| T1 ARCore 可用 | | | |
| T2 漂移 | | p95=__ cm；max=__ cm | |
| T3 10 分钟热态 | | p95=__ ms；内存 __ MB | |
| T4 配对/TLS | | | |
| T5 SceneView | | | |
| T6 DSH/MCP | | | |
| T7 标记 provider / 遮挡恢复 | | 检出率=__%；漂移=__cm；写入冻结=__ | |

### 9.3 证据文件命名

```text
evidence/<YYYYMMDD>/<device>-<test>-<result>.<ext>
例：evidence/20261118/tabs8-T2-drift-pass.mp4
   evidence/20261118/tabs8-T3-thermal-after.txt
```

---

## 10. 判定与回退

| 门 | 通过后 | 失败后 |
|---|---|---|
| G1 工具链 | 进入 M1 | 降 SceneView 版本或改 Filament 直连；完成替代验证后再进入 M1 |
| G2 AR 会话 | 进入 M3 | 用 POC 的 ARCore 原生渲染器重写相机背景；M3 延后 |
| G3 深度 | 作为可选增强 | 缺少真实遮挡作为 v0 已知限制，UI 如实标注；不阻塞核心闭环 |
| G4 配对 | 进入 M2 | 修复 TLS/证书指纹配对后重测；不得关闭证书校验或降级传输安全 |
| G5 DSH | 进入 M5 | 宿主插件适配器；mock 先行 |
| G6 设备矩阵 | 进入 v0.5 | 限定支持机型；第二台设备列入前置 |
| G7 角色 | 进入 M6 | 程序化角色；正式资产延后 |

---

## 11. 安全与注意事项

- 测试时不要遮挡摄像头太久；ARCore 会进入 relocalizing，属正常。
- 平板发烫时暂停，记录温度；不要边充电边做 10 分钟热测（会干扰热数据）。
- 录屏可能包含桌面隐私；证据文件只留在本机/项目目录，不上传。
- 配对测试使用测试用一次性码；不要把真实 token 贴到聊天/issue。
- 标记纸测试避免强反光；哑光纸 + 漫射光。

---

## 12. 现在就能做的三件事

1. **T0/T1**：用已授权 ADB 和首轮 smoke 基线，记录 ARCore 版本、SDK/API、Chrome/WebView 版本和复测证据。
2. **T2**：用现有 POC 做 10 次漂移测量，量化 ARCore 锚定稳定性。
3. **T3**：完成 10 分钟热态/内存基线，为后续场景性能预算提供对照。
4. **T5**：ARCore 主链完成后验证 SceneView/Filament 原生客户端；若 T7 marker spike 尚未完成，可 ARCore 先行，但 v0 release 不得忘记补 marker provider。

把结果按 §9 模板发回即可；T4–T7 依赖相应原生 Host/客户端产物后执行。
