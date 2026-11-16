# 本机环境实测（2026-11-16，Windows）

> 这些是"明天能不能跑起来"的硬约束，报告里必须体现。

## 硬件 / 系统
| 项 | 值 |
|---|---|
| GPU | **NVIDIA RTX 3060 Laptop** (4GB) + Intel Iris Xe |
| 内存 | **15.7 GB** |
| 虚拟显示器 | **GameViewer Virtual Display Adapter**（由 UU远程 安装） |

## 已装的"手机看电脑"基础设施（重要）
- **UU远程 3.13.4.4167**（网易，自带 GameViewer 虚拟显示器）→ 已经能手机看电脑/远程玩
- **ToDesk 4.8.4.2** → 远程桌面
- 结论：**R4「手机看到」不必从零造**，本机已有两套成熟串流/远控。问题变成"要不要为 MC 专门做一层"。

## Java（关键）
| 路径 | 版本 | 用途 |
|---|---|---|
| `C:\Users\Lenovo\AppData\Roaming\.minecraft\runtime\java-runtime-delta\bin\java.exe` | **OpenJDK 21.0.3 (Microsoft)** | ✅ 满足 dsh-game 摄像机客户端要 Java 21 |
| `C:\Users\Lenovo\AppData\Roaming\.minecraft\runtime\jre-legacy\bin` | 1.8.0.51 | 老版本 MC |
| `C:\Program Files\Java\jdk-17.0.5\bin` | 17.0.5 | PATH 上的 java |

## Minecraft 现状（有安装痕迹，但当前无游戏版本）
- `%APPDATA%\.minecraft` 里只有 `cache/` + `runtime/`，**`versions/` 不存在 → 当前没有可启动的 MC 版本**
- **PCL 启动器**：`C:\Users\Lenovo\Desktop\PCL\`，注册表记录曾装 **1.20.6**，`.minecraft` 指向 `C:\Users\Lenovo\Desktop\PCL\.minecraft\`
- **HMCL** 配置在 `%APPDATA%\.hmcl`（有 authlib-injector、账户文件）
- PCL 记录里 `ToolUpdateReleaseLast = 1.21.4`（用户关注/下载过 1.21.4 —— 正好是 dsh-game 测过的版本）
- 登录：`LoginType 0`，有 Microsoft 登录缓存字段（试过正版登录），也有离线名

## 联机工具（重要信号）
- **`D:\MC联机app\SakuraLauncher.exe`**（樱花联机启动器，19MB）
- **UU加速器 5.3.0.203**
→ 用户对「MC 联机」有明确诉求和现成工具。**"AI 一起玩"在他心里很可能 = "AI 和我联机进同一个服"**，而不是"AI 在旁边自己玩"。这与 dsh-game 只做「她自己玩」的缺口完全对上。

## 网络
- WLAN IP **192.168.68.54/22**（网络类别 = **Public**，Windows 防火墙默认入站较严）
- node.exe 已有入站 Allow 规则（`C:\program files\nodejs\node.exe`）
- 已实测：`dsh web --host 192.168.68.54 --port 3099` 监听成功，带 token 的 URL 返回 200，不带 token 返回 401
- ⚠️ 网络类别是 Public → 手机访问可能被拦，建议把该 WLAN 改成"专用网络"或加 `New-NetFirewallRule`

## Node / DSH
- Node **v24.19.0**，npm 11.17.0
- DSH **0.2.1-rc.5**（dsh-game 要求 **0.2.0-rc.2** 网页版 —— 版本不完全一致，是个风险点，需验证兼容性）
