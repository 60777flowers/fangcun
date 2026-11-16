## 8. 角色规格：**3D 优先（VRM / glTF）**

> **决策变更记录**：v0.1 曾规划"八向纸片人"，理由是成本低。**用户已明确要求 3D 模型优先**，本版据此改写。
> 纸片人降级为**极早期占位**（已经被 3D 占位取代，见 §8.6）。

### 8.1 尺度：最容易被做错的一项

- **1.png** 里角色约 **2 格高**（旁边 3 格高的墙做参照）。
- **2.png** 里角色是近景 + 广角，视觉上像 **3–4 格高**的大手办。
- → **取 `heightBlocks: 2.2`，可在 1.8–3.5 调**。太小像"小人"，太大就不像"桌上玩具"。

| 参数 | 值 |
|---|---|
| `heightBlocks` | **2.2**（1.8–3.5） |
| `footprintBlocks` | 0.8（碰撞/避让） |
| `pivot` | **脚底中心**，代码里用 `Box3.min.y` 归零（M0 已这么做） |
| 朝向 | 模型面向 **+Z**；`facingOffsetDeg` 用于修正不同来源模型的朝向差异 |

> ⚠️ 不同来源的模型"原点/朝向/尺寸"全都不一样。**加载时必须做归一化**：量 `Box3` → 按 `heightBlocks` 缩放 → 用 `box.min.y` 把脚底对齐到地面。这段代码 M0 里已经有了，直接复用：
> ```js
> const box0 = new THREE.Box3().setFromObject(src);
> const k = CHAR_H / (box0.max.y - box0.min.y);
> const box = new THREE.Box3().setFromObject(model.scale.setScalar(k));
> model.position.y = GROUND - box.min.y;
> ```

### 8.2 技术管线

```
模型来源            →  归一化    →  渲染              →  动起来
VRoid Studio (VRM)     身高/脚底      @pixiv/three-vrm      VRMA 片段
BOOTH 购买 (VRM)       朝向修正       MToon 卡通材质        或 Mixamo 重定向
定制建模 (glTF/VRM)    骨骼映射       描边(outline)         或程序化(idle/走/尾摆)
                                      spring bone(尾巴/头发)
```

**核心依赖**（已核实，2026-11-16）：

| 包 | 版本 | 许可 | 用途 |
|---|---|---|---|
| `@pixiv/three-vrm` | **3.5.5** | MIT | VRM 加载 + MToon + 表情 + spring bone |
| `@pixiv/three-vrm-animation` | **3.5.5** | MIT | `.vrma` 动画片段加载 |
| `three` | 0.187 | MIT | 渲染（已用） |
| `GLTFLoader`（three 自带） | — | MIT | glTF/GLB 加载（**M0 已用**） |

**为什么是 VRM 而不是随便找个 glTF**：
- VRM 是**二次元角色的约定格式**：humanoid 骨骼标准命名 + MToon 材质 + 表情 blendShape + spring bone 全都在规范里
- 换模型不改代码（和 `character.json` 的思路一致）
- VRoid Studio 可以**免费捏一个**并导出 VRM

### 8.3 关键实现点（每条都是坑）

| 点 | 做法 | 坑 |
|---|---|---|
| **卡通感** | 用 MToon（three-vrm 内置），**不要** `MeshStandardMaterial` | 标准材质会立刻变"塑料手办"，效果图不是这种 |
| **描边** | 背面法线膨胀（复制 mesh、`BackSide` + 沿法线外扩） | 后处理描边在手机太贵；几何描边要处理蒙皮同步 |
| **头发/尾巴摆动** | VRM 的 spring bone（`VRMSpringBoneManager`） | 刚度/阻尼没调好会"抽搐"；尾巴比头发更需要阻尼 |
| **表情** | VRM expression：`happy/angry/sad/surprised/blink/blinkLeft/blinkRight` + 口型 `aa/ih/ou/ee/oh` | 口型要跟 TTS 对齐（简单做法：按音量驱动 `aa`） |
| **动画** | ① `.vrma` 现成片段（`@pixiv/three-vrm-animation`）② Mixamo 重定向 ③ 程序化 | Mixamo 是写实人形骨骼，重定向到 VRM 会"味道不对"；**Q 版角色程序化动画往往最省且最贴风格** |
| **手持物** | 挂到 `hand_r` 骨骼节点下（`bone.add(object)`） | 别用世界坐标跟随，会抖 |
| **阴影** | `castShadow = true` 的蒙皮网格 + 接触影圆片 | 蒙皮阴影在移动端偏贵；阴影贴图 1024 够 |

### 8.4 `character.json` v2（3D 版，直接替换旧 schema）

```json
{
  "id": "dafeiyu",
  "displayName": "大肥鱼",
  "renderMode": "vrm",
  "model": "models/dafeiyu.vrm",
  "heightBlocks": 2.2,
  "footprintBlocks": 0.8,
  "facingOffsetDeg": 180,
  "shadow": { "type": "contact", "radius": 0.5, "opacity": 0.30 },

  "rig": {
    "type": "vrm-humanoid",
    "handR": "rightHand",
    "handL": "leftHand",
    "head": "head"
  },

  "material": {
    "shader": "mtoon",
    "outline": { "enabled": true, "width": 0.004, "color": "#1a1a22" },
    "toneMapping": "aces"
  },

  "expressions": {
    "normal":    {},
    "happy":     { "happy": 0.8 },
    "surprised": { "surprised": 0.9, "blink": 0 },
    "talk":      { "aa": "audio" }
  },

  "animations": {
    "idle":  { "clip": "idle.vrma",  "loop": true,  "speed": 1.0 },
    "walk":  { "clip": "walk.vrma",  "loop": true,  "speed": 1.2 },
    "mine":  { "clip": "mine.vrma",  "loop": true },
    "place": { "clip": "place.vrma", "loop": false },
    "hold":  { "clip": "hold.vrma",  "loop": true },
    "kneel": { "clip": "kneel.vrma", "loop": true },
    "cheer": { "clip": "cheer.vrma", "loop": false },
    "talk":  { "clip": "talk.vrma",  "loop": true }
  },

  "attachments": [
    { "id":"orb",     "bone":"rightHand", "asset":"blocks/diamond_block", "emissive":true, "glowColor":"#4fd8ff" },
    { "id":"pickaxe", "bone":"leftHand",  "asset":"items/pickaxe" }
  ],

  "perf": { "maxTriangles": 20000, "maxMaterials": 4, "textureMaxSize": 1024 },

  "license": { "spdx": "UNLICENSED", "commercialUse": false, "source": "待定" }
}
```

### 8.5 美术交付硬约束（外包时直接复制这段）

| 项 | 要求 |
|---|---|
| 格式 | **VRM 1.0**（首选）或 glTF 2.0 + humanoid 骨骼 |
| 身高 | 建模按 **1.6–1.8 米**建模即可（代码会缩放到 2.2 方块）；**不要**自己按"格"建模 |
| 原点 | 脚底中心为原点，**面朝 +Z**（若面朝 -Z 就在 `facingOffsetDeg` 里写 180） |
| 三角面 | **≤ 20,000**/角色（含头发），骨骼 ≤ 80 根 |
| 材质 | **≤ 4 个**（MToon）；描边另算但不要引入新材质槽 |
| 贴图 | ≤ 1024×1024/张，总贴图 ≤ 3 张 |
| 表情 | 至少 `happy/surprised/angry/sad/blink` + 口型 `aa/ih/ou` |
| 物理 | 头发 + 尾巴用 spring bone，**尾巴刚度要低于头发** |
| 动画 | 每个状态一个片段（或程序化），**片段名必须与 `character.json` 对上** |
| 风格 | Q 版 2–3 头身、赛璐璐/动漫、粗描边；**不要 PBR 写实** |

### 8.6 当前占位（M0 已跑通）

`preview/m0.html` 已经用 **three 官方示例 `RobotExpressive.glb`**（464 KB，自带 Idle/Walking/Dance 等 12 个片段）替换了纸片人，验证了整条链路：

- `GLTFLoader` 加载 → `Box3` 归一化到 2.2 方块高 → `SkeletonUtils.clone()` 出两份 → `AnimationMixer` 播放 → `castShadow` 投影 + 接触影圆片
- 截图见 `docs/preview-m0.png`

> **这就是"换 3D 模型"的完整证明**：渲染架构、阴影、AR 层、协议层**一行没改**，只换了一个 loader。
> 正式模型到位后，把 `character.json` 的 `model` 指过去即可。

**兜底**：模型加载失败时自动退回胶囊体占位（`preview/m0.html` 里已实现），保证开发不被美术卡住。

### 8.7 许可红线

| 对象 | 结论 |
|---|---|
| 「大肥鱼 / 鲸鱼娘」 | DeepSeek 鲸鱼娘的**社区二创**，此前查证素材为 **CC BY-NC-SA 4.0（禁止商用）**；DeepSeek 官方规范禁止商标性使用与修改 |
| BOOTH / VRoid Hub 上的模型 | **逐个看许可**：允许商用 / 仅个人 / 禁止改编，三者差别巨大；**必须把许可写进 `character.json.license`** |
| VRoid Studio 产出 | 模型归创作者，可商用（具体条款以官方为准） |
| three 示例模型 | 仅用于开发占位，**不得随产品发布** |

→ **正式发布必须用原创或已购商用授权的角色。`character.json.license` 不填不允许合入主分支。**

