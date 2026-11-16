# Android 交付与安装路线

## 已确认目标

- 面向广泛 Android 手机/平板；运行时探测设备能力，不按 Tab S8 型号分支。
- 支持 ARCore 的设备优先 WebXR `immersive-ar`；缺少 ARCore/WebXR 时，尝试经打印定位标记建立桌面坐标系的相机叠加 provider。
- 用户测试方式是下载 APK 后手动安装，不要求打开 ADB。
- 仓库内新增 `apps/android-ar-poc` 原生 ARCore 验证工程和 debug APK。它仅验证相机背景、水平面 hit-test、单个锚定测试方块及 tracking fail-closed；不是主客户端 APK，也不包含 voxel world/网络/AI companion。

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
- 当前环境（Windows 11）：Java 17；Android SDK `D:\\Android\\Sdk`，platform-tools `37.0.1`，platform `android-35`，build-tools `35.0.0`；Gradle `8.13` 位于 `D:\\Android\\gradle-8.13`。Android Studio 未安装；Gradle 通过本机解压分发版运行，尚未生成项目 wrapper。
- 构建命令（PowerShell，从仓库根目录）：`$env:ANDROID_HOME='D:\\Android\\Sdk'; $env:ANDROID_SDK_ROOT='D:\\Android\\Sdk'; & 'D:\\Android\\gradle-8.13\\bin\\gradle.bat' --no-daemon -p apps/android-ar-poc assembleDebug`。由于仓库路径含中文，`apps/android-ar-poc/gradle.properties` 设置了 AGP `android.overridePathCheck=true`。
- 已构建并安装：`apps/android-ar-poc/app/build/outputs/apk/debug/app-debug.apk`，applicationId `org.fangcun.ar.poc.debug`，versionCode `1`，versionName `0.1.0-debug`，target SDK `35`，SHA-256 `33564C604B087194BAFE4CA99519889032BCBAF5DC28C5546DD0A3CF741A9359`。这是可手动安装的 debug POC，并非 release 签名包。
- 真机：Samsung Galaxy Tab S8 Wi-Fi，型号 `SM-X800` / device `gts8pwifi`，Android 16 / API 36；ADB USB 授权成功。最新包成功以前台启动，相机背景可见；用户点按后已在真实桌面成功命中平面、建立 anchor 并显示绿色测试方块，屏幕状态为 `Tracking: RUNNING / Anchor placed`。因此相机背景、平面 hit-test、anchor 和虚拟物体绘制的首轮真机 smoke 已通过。
- 崩溃诊断：此前多次 `FATAL EXCEPTION: GLThread`，异常为 `Background shader failed`，调用链来自 `GLSurfaceView.queueEvent` 中纹理/shader 初始化早于 EGL surface 初始化。已将初始化和 session texture attachment 收敛到 `onSurfaceCreated`/GL 线程，并增加启动失败状态显示；修复后重装，当前前台进程存活，最近启动无新的 `AndroidRuntime` fatal exception。Adreno 730 / OpenGL ES 3.2；旧日志中的 GL info-log 为空，根因由线程时序和调用栈确认。
- 其他修正：每帧复用时复位相机 UV 输入缓冲区、tracking loss/Activity pause 清除待处理触摸、测试立方体沿 anchor 本地法线离开平面 3.5 cm。用户已反馈移动平板时方块稳定；手/物体遮住实景时方块仍渲染在前景，遮挡后恢复有轻微位移，目前对测试影响不大。当前 POC 没有 ARCore Depth 遮挡合成，因此该表现是已知能力限制；尚未测定量漂移值或 10 分钟帧率/热态。方块在截图中显得较大，先作为观感待办，不阻塞核心流程。

## 真机矩阵

至少验证：一台 ARCore 中档手机、一台不同厂商/屏幕尺寸的 ARCore 设备；标记模式再选一台确认不支持 ARCore 但摄像头性能合适的设备。登记 Android/System WebView/Chrome/ARCore 版本、屏幕密度、tracking/帧时间/热状态、手动安装和覆盖升级行为。Tab S8 只是首个可用平板，不是唯一目标或最低规格定义。

## APK 的交付门槛

- [ ] M0 WebXR ARCore 能力、LAN HTTPS/WSS 和配对风险实测完成
- [ ] 明确 WebView/TWA/外部浏览器选择并完成 TLS/camera/XR 权限 POC
- [ ] marker license、打印规格、跟踪 provider POC 与遮挡/丢失 fail-closed 通过
- [ ] 安装 debug APK、手动配对、AR/marker 放置、放置/拆除 smoke 通过
- [ ] 签名/升级/卸载/数据删除/权限告知说明完成
- [ ] 至少两个不同档 Android 机型矩阵通过；发行素材与 SBOM/许可门禁通过
