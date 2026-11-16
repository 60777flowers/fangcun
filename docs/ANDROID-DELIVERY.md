# Android 交付与安装路线

## 已确认目标

- 面向广泛 Android 手机/平板；运行时探测设备能力，不按 Tab S8 型号分支。
- 支持 ARCore 的设备优先 WebXR `immersive-ar`；缺少 ARCore/WebXR 时，尝试经打印定位标记建立桌面坐标系的相机叠加 provider。
- 用户测试方式是下载 APK 后手动安装，不要求打开 ADB。
- 当前仓库尚无 Android 原生工程、Android SDK/Gradle，也没有可交付 APK；本文件是后续构建门槛，不是已打包声明。

## 建议的 APK 技术决策（M0 Spike 后接受）

先保持主客户端为 HTTPS Web 应用，通过 PC Host 配对/局域网运行；在 WebXR 与桌面配对可复现之后，选一个轻量 Android WebView/TWA 容器作为 APK 交付壳：

1. APK 仅提供安装入口、相机权限说明、受限 WebView/Custom Tabs 和安全外部链接处理；世界状态仍由 PC Host 持有。
2. 主路径在 Android System WebView/Chrome 里检测 WebXR `immersive-ar`，不能假设 Android 全系都支持。
3. 打印标记路线先作独立 POC。若需要原生相机帧/marker pose，则提供单独的 Android `MarkerTrackingProvider` 原生模块，经窄接口向 UI 输出 pose、confidence、时间戳和追踪状态；不向 JS 暴露任意文件/代码桥。
4. tracking 丢失/pose 过期时冻结或隐藏虚拟世界，并禁止任何事务提交；绝不能仅把 camera texture 和静态模型叠加称为稳定跟踪。
5. 不嵌入云端 API key、权限凭证或长效 pair token；局域网请求仍走 TLS/WSS 及短期一次性 session。

若 Android WebView 不支持所需 WebXR，APK 可按设备策略启动外部 Chrome Custom Tab/浏览器；稳定 ARCore 覆盖仍按设备能力/Google Services/浏览器版本验收。标记模式需要单独原生 provider 或经验证的浏览器能力；不通过设备型号判断。

## 手动安装与签名

- 开发包：生成 `app-debug.apk`，记录 applicationId、versionCode、target SDK 和 SHA-256；用户在平板上允许“安装未知应用”后手动打开 APK。
- Release：Android keystore 永不提交到 git/CI artifacts；签名凭证通过受控 secrets 输入，签名丢失会影响覆盖升级，必须备份并记录恢复责任人。
- 上传/分发前检查素材/依赖许可、隐私告知、相机/网络权限、SBOM 与 APK hash。
- 当前环境确认：Java 17 可用，但未发现 Android Studio、Android SDK/ANDROID_HOME、ADB、sdkmanager、Gradle 或 wrapper；因此现在不能可靠生成或在 Tab S8 手动安装验证 APK。不能用桌面 Web 预览代替 APK。

## 真机矩阵

至少验证：一台 ARCore 中档手机、一台不同厂商/屏幕尺寸的 ARCore 设备；标记模式再选一台确认不支持 ARCore 但摄像头性能合适的设备。登记 Android/System WebView/Chrome/ARCore 版本、屏幕密度、tracking/帧时间/热状态、手动安装和覆盖升级行为。Tab S8 只是首个可用平板，不是唯一目标或最低规格定义。

## APK 的交付门槛

- [ ] M0 WebXR ARCore 能力、LAN HTTPS/WSS 和配对风险实测完成
- [ ] 明确 WebView/TWA/外部浏览器选择并完成 TLS/camera/XR 权限 POC
- [ ] marker license、打印规格、跟踪 provider POC 与遮挡/丢失 fail-closed 通过
- [ ] 安装 debug APK、手动配对、AR/marker 放置、放置/拆除 smoke 通过
- [ ] 签名/升级/卸载/数据删除/权限告知说明完成
- [ ] 至少两个不同档 Android 机型矩阵通过；发行素材与 SBOM/许可门禁通过
