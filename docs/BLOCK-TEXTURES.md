# Block textures (材质与方块扩展接口)

Voxel blocks are rendered from a single texture atlas. Both the atlas source and the
block→texture mapping are **data**, so adding a block or swapping a texture pack never
requires touching renderer code.

## Default pack: ProgrammerArt (CC0 1.0)

| 项 | 值 |
|---|---|
| 名称 | ProgrammerArt |
| 作者 | deathcap and contributors |
| 来源 | https://github.com/deathcap/ProgrammerArt |
| 许可 | CC0 1.0 Universal（公共领域，可自由使用/修改/再分发，无需署名） |
| 位置 | `assets/block-textures/programmerart/blocks/*.png` |
| 说明 | 原创 16×16 体素方块贴图，风格接近原版 Minecraft |

这是**已经 vendor 进仓库**的贴图子集（30 张，共约 3.4 KB），因此 clone 后无需联网即可构建。
CC0 允许我们再分发；仍在 `assets/block-textures/programmerart/LICENSE` 保留原始许可文本。

> 注意：**Mojang 原版材质不能入库**。它是 Mojang 版权素材，不属于 CC0。如需原版观感，
> 请使用下面的"自定义资源包"路径，把自备资源包放在本地（已被 `.gitignore` 忽略）。

## 构建

```powershell
npm run atlas
```

脚本：`scripts/build-block-atlas.mjs`
输入：`assets/block-textures/block-mapping.json` + `assets/block-textures/<pack>/blocks/*.png`
输出（提交入库，体积很小）：
- `apps/android-ar-poc/app/src/main/assets/textures/block-atlas.png`
- `apps/android-ar-poc/app/src/main/assets/textures/block-atlas.json`

图集布局：正方形近似网格，默认每格 16×16，采样用 `NEAREST`（保持像素风，且不会串色）。

## 新增一个方块

1. 在 `packages/world-schema` 的 `BLOCK_IDS` 末尾追加 id（追加而非插入，保持已有 id 位置稳定）。
2. 在 `assets/block-textures/block-mapping.json` 的 `blocks` 里加一行：

```json
"my_block": { "top": "grass_top", "side": "dirt", "bottom": "stone" }
```

3. 如果引用的是新贴图，把 `16×16` PNG 放进 `assets/block-textures/<pack>/blocks/`，
   或写进 `extraTextures` 强制打包（未被任何方块引用的贴图不会自动进图集）。
4. `npm run atlas`，然后重新构建 APK。

渲染侧不需要改代码：`block-atlas.json` 已经给出每个方块三个面的 tile 索引，
Android 端按 `tileSize/columns/rows` 换算 UV 即可。

## 新增/替换材质包

- 目录约定：`assets/block-textures/<pack>/blocks/*.png`，贴图必须为 `tileSize`（默认 16）正方形。
- 在 mapping 里把 `"pack"` 改成新目录名；或用环境变量/参数覆盖（脚本读取 `mapping.pack`）。
- 自定义包建议放到 `assets/block-textures/local-<name>/` 并加入 `.gitignore`，
  只提交 mapping，避免版权素材进入仓库。
- 缺图会**构建失败并报出具体文件名**，不会静默使用占位色。

## 当前映射（16 个方块）

grass / dirt / stone / planks / log / leaves / sand / glass /
brick / tile / wool_white / wool_red / bookshelf / lantern / pumpkin / flower

未在 mapping 中声明的方块 id 会由 Android 端回退为纯色方块（防止新方块导致崩溃）。
