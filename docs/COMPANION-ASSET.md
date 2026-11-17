# Companion Asset (默认角色模型)

## 当前默认模型

| 项 | 值 |
|---|---|
| 名称 | 蓝色小肥鱼 Deepseek鲸鱼娘 |
| 作者 | 木子恶魔 / MZEM |
| 发布平台 | 模之屋 |
| 作者联系 | https://space.bilibili.com/95816706 |
| 格式 | VRM 1.0（glTF 2.0 + `VRMC_vrm` / `VRMC_materials_mtoon` / `VRMC_springBone`） |
| 规模 | 6 mesh / ~34.9k verts / 6 material / 8 PNG 贴图 / 146 bones / **无动画剪辑** |

### 授权边界（模型自带免责声明摘要）

- 允许**个人非商业**使用（个人形象、非盈利动画/截图等）。
- **禁止商用**：售卖、付费内容、企业宣传等均不允许。
- **禁止二次配布**：不得再次上传/转发/分享模型文件到任何平台。
- **禁止拆取素材**：不得提取纹理/骨骼/网格用于改造或制作其他模型。
- **必须标注来源**：公开传播包含本模型的作品时需注明来源。

因此本项目**不把 `.vrm` 纳入 Git**（`.gitignore` 已含 `*.vrm`）。仓库只记录来源与放置方式；
产品发布时应提供官方下载地址，由用户自行下载并放入指定目录。

## 放置位置

```
apps/android-ar-poc/app/src/main/assets/models/companion/default.vrm
```

文件缺失时应用**自动回退**到程序化方块鱼（`CompanionMesh`），不会崩溃。

构建产物会包含该文件（APK 约 16.7 MB）。若要发布不含该模型的版本，删除该文件重新构建即可。

## 换模型接口

当前是**按路径替换**，模型文件放在固定位置：

1. 把新的 `.vrm`（或标准 `.glb`）命名为 `default.vrm`，覆盖上面的路径，重新构建安装。
2. 如果要同时保留多个模型，在
   `ArPocRenderer.COMPANION_ASSET`（`apps/android-ar-poc/.../ArPocRenderer.java`）
   改成对应资源路径即可，例如 `models/companion/fish2.vrm`。

渲染侧只依赖 `VrmModel.load(context, assetPath)` 这一个入口，因此换模型不需要改渲染代码。

### 模型要求

`VrmModel` 是最小实现，支持范围明确：

- 支持：`POSITION` / `NORMAL` / `TEXCOORD_0` / indices，`pbrMetallicRoughness.baseColorTexture`，
  材质自带 alpha（按 0.35 阈值 discard）。
- **不支持**：骨骼蒙皮、形态键、动画、MToon 完整参数、透明排序、布料/弹簧骨。
  当前按**绑定姿势**渲染，整对象做漂浮/转向等程序化动作。
- 因此新模型应尽量选择**静态姿势自然**的模型；T/A-pose 明显的模型观感会差。

后续计划：接入骨骼动画后，`VrmModel` 会扩展为真正的 glTF 蒙皮渲染器，届时换模型无需再考虑姿势问题。

## 后续（产品化时）

- Host 侧增加 `companionModelId`，由设置或 DSH 选择模型；客户端按 id 映射到本地资源。
- 接入官方下载源提示与校验（哈希），避免把授权文件打包进分发物。
- 资产台账（`docs/PROJECT-STATUS-AND-ROADMAP.md` 的素材许可项）登记来源与授权结论。
