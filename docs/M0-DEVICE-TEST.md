# M0 真机验证记录模板

> **2026-11-17 更新：本模板早于原生客户端决策，部分字段（Tab S8 型号、Android 版本）已由 [ANDROID-DELIVERY](ANDROID-DELIVERY.md) 与 [DEVICE-TEST-PLAN](DEVICE-TEST-PLAN.md) 取代。新的可执行测试请用 [DEVICE-TEST-PLAN](DEVICE-TEST-PLAN.md)；本文件保留为历史模板。**

状态：**待实测**。本文件不是设备兼容性承诺，也不替代录屏、控制台日志和原始测量。

## 已知测试设备

- 设备：Samsung Galaxy Tab S8（具体型号：待从“设置 → 关于平板电脑”确认，例如 SM-X7xx）
- Android：待填写
- Chrome：待填写
- Google Play services / ARCore：待填写
- 连接方式：不依赖 ADB；优先二维码/手动打开 URL 与手动安装 APK
- 时间戳约定：JS `performance.now()`；原生 `SystemClock.elapsedRealtime()` 必须经校准映射（记录 bridge latency），不得直接传给 `observedAtMs`

## 路线 A：ARCore / WebXR

1. PC Host 使用 HTTPS，同一局域网可访问；不要把 token 放 URL。
2. Android Chrome 打开测试页并确认安全上下文。
3. 授权相机；调用 `immersive-ar`，确认水平面 hit-test。
4. 建立桌面 anchor，放置岛；沿 1 m 方形路线走一圈，重复 10 次。
5. 暂停 Chrome、遮挡相机、恢复，记录 `tracking-lost / relocalizing / running` 状态和世界是否跳变。
6. 记录帧时间 p50/p95、内存、热状态、首屏/模型加载时间。

## 路线 B：打印定位标记

1. 使用项目固定版本、固定 ID 的标记；记录纸张尺寸、实际边长和打印缩放。
2. 标记放在桌面，确保全程在摄像头可视范围内；先检测 marker pose，再放置/确认岛。
3. 遮挡或低置信度时必须冻结/隐藏虚拟场景并禁用世界写入。
4. 恢复识别后重新确认 anchor；记录是否跳变、误写、漂移和功耗。
5. 不把 marker 模式描述成无标记 6DoF AR；单独记录能力与限制。

## 证据与判定

- [ ] 录屏（含系统状态栏和路线）
- [ ] 浏览器控制台日志
- [ ] 设备/系统/浏览器/ARCore 版本
- [ ] 10 次重定位的漂移原始数据
- [ ] 帧时间 p50/p95、内存、热降频、功耗
- [ ] LAN HTTPS/WSS 配对步骤可复现
- [ ] tracking 丢失时没有事务提交

未安装 Android SDK/Gradle 或未完成原生 provider 前，不生成“可安装 APK”作为已完成能力。APK 构建应在 provider POC 通过后落地，并提供 debug APK 手动安装与可撤销的 release 签名策略。
