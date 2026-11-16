# 报告 J：大肥鱼 3D 模型寻源 + 「用户可替换模型插槽」设计

- 作者：子代理 J
- 日期：2026-11-16
- 工作目录：`D:\研一上\AR_MC`
- 隔离下载区：`D:\研一上\AR_MC\_tmp\models\`（**未写入 assets，未污染工程**）
- 关键证据：8 张实机渲染图（`_tmp\models\screenshots\`）、2 份 VRM 元数据 JSON、3 份仓库源码

---

## 1. 执行摘要

**找到了，而且是两个不同层次的「找到」。**

### 1.1 最像的那一个：`蓝色小肥鱼Deepseek`（VRM 1.0，Q 版 2.4 头身）

- **作者**：木子恶魔
- **原始发布页**：<https://www.aplaybox.com/details/model/ayXkRzVflmnd>（模之屋 / Aplaybox）
- **取得途径（可复现）**：DSH 插件 `drliuhuan/dsh-plugin-vrmpet3d` 以 Brotli 压缩形式随包分发，文件 `assets/models/BlueFatFish.vrm.br`（15,411,050 B），解压后 `BlueFatFish.vrm` **18,480,432 B**，SHA256 `C14879FF5C425010…`
- **逐项对照用户描述**（★=命中）：蓝发（★，发梢青蓝渐变）、蓝眼（★）、女仆装深蓝+白蕾丝（★，围裙上有鲸鱼 logo）、白色女仆头饰（★，带浅蓝蝴蝶结）、**鲸鱼尾巴**（★，`WeiBa*` 13 个骨节、分中/左/右三束，侧视可见拖在身后）、2–3 头身 Q 版（★，**实测 2.41 头身**）、赛璐璐粗描边（★，MToon + 描边材质）
- **许可：不能内置、不能改、不能分发。** VRM 内嵌元数据写死：`avatarPermission: "onlyAuthor"`、`allowRedistribution: false`、`modification: "prohibited"`、`commercialUsage: "personalNonProfit"`、`creditNotation: "required"`。Aplaybox 页面为前端渲染 SPA，条款正文**未取到**（见 §7）。该插件作者是单独拿到「随本插件分发」的授权，**这个授权不延伸给我们**。
- **→ 结论：只能作为「用户自备模型」的示范案例**，官方包不得内置，也不得改制。

### 1.2 许可最干净、可直接下载的那一个：`DeepSeek-chan`（VRM 1.0，3.4 头身）

- **3D 模型**：ニケ ／ **角色原作**：上善无形（原创 OC「溟月」）／ **女仆版二次设计**：ZipZipPipe
- **仓库**：<https://github.com/tegnike/deepseek-chan-vrm>（★21 / fork 5，创建 2026-10-31，最后推送 2026-11-08）
- **文件**：`DeepSeek-chan.vrm` **33,616,628 B**（VRM 1.0，GLB2 容器）+ `DeepSeek-chan.blend` 26,536,472 B（贴图已打包）+ 三视图 `docs/images/preview.png`
- **许可：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)** —— **允许非商业使用、允许修改、允许再分发；禁止商业使用；必须署名（三位）；改编作品须同协议**。VRM 元数据与 README 一致，双重自洽。
- **像不像**：身份 100%（就是她）、配色/服装/头饰/鲸尾全中，**但头身比 3.4，属于「半 Q 版」，不是用户要的 2–3 头身纯 Q 版**；鲸尾比 BlueFatFish 更夸张更好看（翘起的尾鳍在正面就可见）。
- **→ 结论：这是唯一「能进安装包 + 能写进 LICENSE」的 3D 选择**，代价是比例偏少年。

### 1.3 第三个：`鲸鱼娘 Live2D`（不是 3D）

- **Live2D 模型**：氵六青（B 站 UID 11272072）／经 `Andersen216/dsh-whale-girl-live2d` 分发（★95）
- `assets/model/c_0120.moc3` **2,119,552 B** + `texture_00.png` 1,768,051 B；44 表情 / 8 动作 / 物理
- **许可分层**：代码 MIT；**美术素材 CC BY-NC-SA 4.0**；模型作者《使用须知》原文：「商用直播√ 自印物料√ 禁止任何形式的盗用以及出售，此模型为无偿分享」。
- **→ 结论：2D，不能当 3D 角色骨架用；但它是 `billboard8` / Live2D 降级通道的最佳素材。**

### 1.4 建议路径（一句话）

> **内置默认角色用 `DeepSeek-chan`（CC BY-NC-SA，非商业 + 三人署名）；把 `BlueFatFish` 当作「用户自备最强案例」写进文档和插槽示例；商用 build 切换成 VRoid「ヴィータ」或许可完全干净的占位角色。**

理由：BlueFatFish 像但不可分发；DeepSeek-chan 可分发且身份准确；Vita 许可最宽松（可商用/可再分发/免署名）但不是这个角色，正好当「无角色占位」和「商用兜底」。三者的许可强度与「像不像」正好互补，**这就是插槽必须存在的商业理由**，不是技术洁癖。

---

## 2. 各渠道扫描结果

> 说明：GitHub REST core 限额 60/h 在本次扫描中被打满两次（`remaining: 0`，reset 后恢复），因此部分检索改用 `codeload` / `jsDelivr data API` / 仓库 HTML 树页 / 已下载源码，全部为可复现的一手路径。

### 2.1 GitHub（关键词检索，`/search/repositories`）

| # | 关键词 | 结果 | 关键命中 | 链接 |
|---|---|---|---|---|
| 1 | `大肥鱼` | **找到**（多条） | `LIN428924379/baifanyu` ★129（Android 桌宠，2 套皮肤 14 表情）；`duliangkuan/raise-an-ai` ★103；`Andersen216/dsh-whale-girl-live2d` ★95；`Kaalia0912/dsh-whale-musume-persona` ★85；`xiaoshihou514/dsh-desktop-pet` ★65；`lmy414/bluedafeiyu` ★48；`AATINF/deepseek-whale-girl-assets` ★50（93 张图）；`yanzwzz/dsh-whale-girl-pet` ★50（50 段 webm） | <https://github.com/search?q=%E5%A4%A7%E8%82%A5%E9%B1%BC&type=repositories> |
| 2 | `dafeiyu` / `DaFeiYu` | 找到（仓库名维度稀疏，多为同人工具） | `luckui/dsh-game`（见 §3） | 同上 |
| 3 | `鲸鱼娘` | **找到**（人格/桌宠插件为主） | 见 #1；另 `OMGLogic/dsh-whale-persona` ★55 | <https://github.com/search?q=%E9%B2%B8%E9%B1%BC%E5%A8%98&type=repositories> |
| 4 | `deepseek vrm` | **找到（12 条，2 条真模型）** | **`tegnike/deepseek-chan-vrm` ★21 ← 本次主答案**；`drliuhuan/dsh-plugin-vrmpet3d` ★13 ← 内置 BlueFatFish | <https://github.com/search?q=deepseek+vrm&type=repositories> |
| 5 | `whale girl vrm` / `whale maid model` | 未命中有效 3D 模型（多为桌宠/persona） | — | — |
| 6 | `大肥鱼 模型` / `大肥鱼 live2d` / `大肥鱼 mmd` | 检索时 core 限额被打满（403）；改用上面 #1 的完整结果 + 逐仓库文件树扫描（§2.2），**未见任何 `.pmx/.vmd/.blend` 的 MMD 模型** | — | — |

### 2.2 GitHub（逐仓库文件树扫描 —— 判定「有没有模型文件」的硬证据）

方法：`https://data.jsdelivr.com/v1/packages/gh/<repo>@main?structure=flat` 取完整文件清单，匹配 `\.(vrm|glb|gltf|vrma|pmx|fbx|blend|moc3|psd|clip|unitypackage)$`。

| 仓库 | 文件数 | 命中模型文件 | 结论 |
|---|---|---|---|
| `tegnike/deepseek-chan-vrm` | — | **`.vrm` ×1 + `.blend` ×1** | ✅ **有 3D 模型 + 源文件** |
| `drliuhuan/dsh-plugin-vrmpet3d` | — | **`BlueFatFish.vrm.br` + `SampleModel.vrm.br` + 28 个 `.vrma.br`** | ✅ 有 3D 模型 + 动作库 |
| `Andersen216/dsh-whale-girl-live2d` | — | **`.moc3` + 贴图 + `model3.json`** | ✅ 有 Live2D（非 3D） |
| `yanzwzz/dsh-whale-girl-pet` | 64 | 0 | ❌ 纯 2D（50 段 webm） |
| `Pal-AI-Lab/Coopanion` | 85 | 0 | ❌ 无模型资源（AGPL 代码 + 2D 素材） |
| `blacksunshy/coopanion-fatfish` | 32 | 0 | ❌ 同上 |
| `LIN428924379/baifanyu` | 66 | 0 | ❌ Android 桌宠，2D 皮肤 |
| `duliangkuan/raise-an-ai` | 77 | 0 | ❌ 平台型项目 |
| `lmy414/bluedafeiyu` | 299 | 0 | ❌ 插画/表情包站源码 |
| `Kaalia0912/dsh-whale-musume-persona` | 8 | 0 | ❌ 纯人设文本 |
| `xiaoshihou514/dsh-desktop-pet` | 14 | 0 | ❌ 2D |
| `OMGLogic/dsh-whale-persona` | 11 | 0 | ❌ 纯人设文本 |
| `AATINF/deepseek-whale-girl-assets` | 307（205 jpg + 93 png） | 0 | ❌ **93 张图片素材包，不是模型** |

> **这一栏是本次报告最硬的结论**：DSH 生态里被大量复用的「大肥鱼」，**在 GitHub 上只有 3 个可运行的媒体资产源**（1 个 VRM、1 个 VRM+动作包、1 个 Live2D），其余全是 2D 贴图 / webm / 人设文本。

### 2.3 模之屋 / Aplaybox

| 关键词 | 结果 | 链接 |
|---|---|---|
| 大肥鱼 / 鲸鱼娘 / DeepSeek | **找到 1 条确定条目**：`蓝色小肥鱼Deepseek`，作者 木子恶魔 | <https://www.aplaybox.com/details/model/ayXkRzVflmnd> |

- 页面 HTTP 200，但返回的是 15,472 B 的 Vue SPA 外壳（`<title>专业模型创作分享社区_模之屋_PlayBox</title>`），**模型条款正文未能取得**。
- 从 `app.js`（863,987 B）中提取到真实接口表：`/api/web/v1/work/{getWorkDetails,search,downloadWorkNewV2,…}`；实测 `POST getWorkDetails` → **405**，`GET getWorkDetails?id=` / `?workId=` / `GET work/search?keyword=` → **200 但返回同一份 SPA 外壳**（接口有额外的来源/签名校验）。**按「未取到」记录，不推测条款。**
- 交叉确认渠道：① 插件 `drliuhuan/dsh-plugin-vrmpet3d` 的 `assets/models/README.md` 把该页登记为「source」并注明「经作者授权分发，需注明来源与作者」；② VRM 文件内嵌 metadata 自带 `name=蓝色小肥鱼Deepseek` / `authors=[木子恶魔]`。两条独立证据互相印证，**该条目真实存在**。

### 2.4 B 站

| 关键词 | 结果 | 链接 |
|---|---|---|
| 大肥鱼 模型 / 大肥鱼 MMD / 鲸鱼娘 模型 / 大肥鱼 live2d | **未取到**：`search.bilibili.com/all` 返回 200（27 万字节）但结果是**无关内容**（越南语字母歌、iOS 教程等），典型风控/降级页；不含可用 BVID 与模型线索 | <https://search.bilibili.com/all?keyword=大肥鱼%20模型> |

- 侧面证据（**非本次重新核验**，来自 `xxnb0/deepseek-chan-fanpack` 的 `docs/community-sources.md` 台账）：原作者 **上善无形** 2026-08-02 发布视觉资料并标 CC BY-NC-SA 4.0（`https://www.bilibili.com/opus/1231977657712771073`）；2026-09-30 有商业化声明（`…/opus/1253873972180680713`）；女仆版 **ZipZipPipe** 的素材声明在 `https://t.bilibili.com/1231980045693616162`；Live2D 作者 **氵六青** UID 11272072。
- **这三条 B 站链接是本项目署名链的根**，建议上线前人工复核一次（见 §7）。

### 2.5 米游社 / 贴吧 / QQ 群文档

**未取到。** 无可用的公开检索入口（贴吧/QQ 群文档不在 web 可检索范围），不做推测。

### 2.6 爱发电 / 闲鱼 / 淘宝

| 平台 | 结果 | 价格区间 | 备注 |
|---|---|---|---|
| 爱发电 | **未取到**：无通用检索 API，未定位到该角色的赞助页 | — | 若需要，只能人工在站内搜「大肥鱼 / 鲸鱼娘」 |
| 闲鱼 | **未取到**（无公开检索接口） | — | 常见「代做 VRM/MMD」服务，估价 200–2000 元，**未验证** |
| 淘宝 | **未取到**（无公开检索接口） | — | 同上 |
| **BOOTH（实际有货，见 §2.8）** | **找到付费商品**：`大肥鱼 DeepSeek`，¥5,000 | ≈ 240 CNY | **禁止再配布/转卖** |

### 2.7 国际平台

| 平台 | 关键词 | 结果 | 链接 |
|---|---|---|---|
| **VRoid Hub** | `whale` / `maid` / `chibi` / `dafeiyu` | **未取到（403）**：`hub.vroid.com` 对非浏览器请求返回 403；`/api/models?q=` 返回 400 | <https://hub.vroid.com/> |
| **BOOTH.pm** | `whale maid` | 找到 5 件，**均非 VRM/3D 模型**（语音素材、瞳孔去除工具、鲸鱼毛巾等） | <https://booth.pm/ja/search/whale%20maid> |
| **BOOTH.pm** | `クジラ メイド VRM` | 找到通用 3D 模型（マヌカ / セレスティア / 竜胆 / ゾメちゃん），**无鲸鱼女仆** | <https://booth.pm/ja/search/クジラ%20メイド%20VRM> |
| **BOOTH.pm** | `DeepSeek` | **找到**：`大肥鱼 DeepSeek`（Adang's Shop One，¥5,000，下载商品）——**Koikatsu 角色卡**，条款「本製品の再配布や転売を禁止します」 | <https://booth.pm/ja/items/9118321> |
| **Sketchfab** | `chibi maid`（`downloadable=true`） | 找到 6 件，**全部 CC-BY**：`Chibi Rem - Confession`(lemonleon)、`Voxel Maids`(Staycalm182)、`Chibi Maid Stroll`(Chicorrita)、`Tiburona Maid @kame_3t`(anyone_but_antimonio)、`Mama Riley chibi model`、`Sassy Frank`。**无鲸鱼娘** | <https://sketchfab.com/search?q=chibi+maid&type=models&downloadable=true> |
| **Live2D Cubism 官方示例** | — | 页面存在（`サンプルモデル`），是官方示例模型集合（Hiyori 等），**不含鲸鱼娘** | <https://www.live2d.com/en/learn/sample/> |

### 2.8 渠道扫描总表（一屏版）

| 渠道 | 关键词 | 结果 | 链接 |
|---|---|---|---|
| GitHub | `大肥鱼` `鲸鱼娘` `deepseek vrm` 等 12 组 | ✅ **3 个媒体资产源**（VRM / VRM+VRMA / Live2D） | <https://github.com/tegnike/deepseek-chan-vrm> |
| GitHub | `luckui/dsh-game` 资产目录 | ❌ **只有 11 段 webm + LICENSE.md，无模型无源文件** | §3 |
| 模之屋 | 大肥鱼 / 鲸鱼娘 | ✅ 1 条（`ayXkRzVflmnd`）；⚠️ 条款未取到 | <https://www.aplaybox.com/details/model/ayXkRzVflmnd> |
| B 站 | 4 组 | ❌ 风控降级，未取到 | — |
| 米游社/贴吧/QQ | — | ❌ 未取到 | — |
| 爱发电/闲鱼/淘宝 | — | ❌ 未取到（仅 BOOTH 有付费 Koikatsu 卡） | <https://booth.pm/ja/items/9118321> |
| VRoid Hub | 4 组 | ❌ 403 | <https://hub.vroid.com/> |
| BOOTH | 3 组 | ⚠️ 找到 1 个付费 Koikatsu 卡（禁再配布），无 VRM | 同上 |
| Sketchfab | `chibi maid` `whale girl` | ⚠️ 6 件 CC-BY 通用 Q 版女仆，**无鲸鱼娘** | 见 §2.7 |
| Live2D 官方 | — | ❌ 无该角色 | <https://www.live2d.com/en/learn/sample/> |

---

## 3. `luckui/dsh-game` 素材溯源

### 3.1 目录里到底有什么

本地克隆：`D:\研一上\AR_MC\refsrc\dsh-game`（另一份快照在 `_tmp\dshrepos\game-stack-x`，是**另一个仓库** `yuanstarstar/dsh-game-stack`，勿混）。

`packages/dsh-game/assets/dafeiyu/` 实际内容（12 个文件，全部）：

| 文件 | 字节 | 类型 |
|---|---:|---|
| LICENSE.md | 1,563 | 许可与署名 |
| angry.webm | 2,133,008 | 透明通道视频 |
| laugh.webm | 2,033,942 | 同上 |
| rice-enter.webm | 568,041 | 同上 |
| rice-exit.webm | 568,887 | 同上 |
| riceloop.webm | 2,015,938 | 同上 |
| ricetalk.webm | 2,144,521 | 同上 |
| sad.webm | 1,719,143 | 同上 |
| scared.webm | 1,827,064 | 同上 |
| shocked.webm | 1,881,899 | 同上 |
| shy.webm | 2,239,896 | 同上 |
| think.webm | 1,776,618 | 同上 |

**一共 11 段 webm（合计约 18.9 MB）+ 1 份 LICENSE.md。**

### 3.2 有没有 3D 模型 / 立绘源文件？——**没有**

用 git 索引而不是文件浏览器验证（避免漏掉被忽略的目录）：

```
git -C refsrc\dsh-game ls-files | Select-String '\.(vrm|glb|gltf|fbx|pmx|pmd|blend|psd|clip|png|jpg|webp|moc3|model3\.json)$'
```

结果：全仓库图片只有 `docs/images/*.jpg`（4 张文档截图）、`assets/minecraft/*.jpg`（2 张封面）、`assets/werewolf/*.jpg`（17 张卡面）、`games/ddlc/censor/*.png`（3 张审查卡）。**`.vrm` / `.glb` / `.pmx` / `.blend` / `.psd` / `.clip` 一个都没有。**

再查全历史删除记录：

```
git log --all --diff-filter=D --name-only
→ 0c0728f 2026-10-24 refactor: remove the in-browser 3D view of Minecraft
   packages/dsh-game/src/games/minecraft/body/viewer.ts
```

唯一被删的「3D」相关文件是 `viewer.ts`——它是 **prismarine-viewer 的第三人称方块世界画面**（文件头注释：「用 prismarine-viewer 的渲染（three.js，在浏览器里画方块和生物）」「http://127.0.0.1:<port>/third/ 第三人称跟拍」），**与世界渲染有关，与角色模型无关**。这条 commit 反而证明：他们**曾经**在浏览器里画 3D，但画的是 Minecraft 世界，不是大肥鱼。

### 3.3 署名指向谁

`packages/dsh-game/assets/dafeiyu/LICENSE.md` 要点（原文摘录）：

> **许可：CC BY-NC-SA 4.0**：署名、非商业性使用、相同方式共享。本仓库代码的 MIT 许可不覆盖这些片段。
>
> - 形象原型：**上善无形**的原创角色「溟月」；**ZipZipPipe** 在此基础上画出了带 DeepSeek 元素的女仆鲸鱼娘，社区称为「大肥鱼」。
> - 设定图、六视图的作者：**上善无形、ZipZipPipe、YunYueSama、xiaoweigen**。资料来自这些社区仓库：
>   - [xiaoweigen/deepseek-dafeiyu-assets](https://github.com/xiaoweigen/deepseek-dafeiyu-assets)（CC BY-NC-SA 4.0）
>   - [xxnb0/deepseek-chan-fanpack](https://github.com/xxnb0/deepseek-chan-fanpack)（主体为 CC BY-NC-SA 4.0）
>   - [treapgogo/deepseek-whale-girl](https://github.com/treapgogo/deepseek-whale-girl)（其中的设定图，CC BY-NC-SA 4.0）
> - 这些片段是怎么做的：以上设定图作为参考，先用**字节跳动 Seedream** 生成一张 Q 版全身立绘，再用 **Seedance** 以这张立绘为首尾帧生成各个表情的短片，最后抠成透明背景。它们是上述作品的衍生作品，所以按相同协议发布。

**署名链（四层）**：

```
上善无形「溟月」（形象原型，CC BY-NC-SA 4.0）
  └─ ZipZipPipe「DeepSeek 女仆鲸鱼娘」（二次设计，CC BY-NC-SA 4.0）
       ├─ YunYueSama / xiaoweigen / treapgogo / xxnb0（设定图、六视图衍生）
       └─ dsh-game 的 11 段 webm（Seedream→Seedance 生成的衍生视频）
```

### 3.4 对项目的直接可用性判断

| 问题 | 结论 |
|---|---|
| 能当 3D 角色吗 | **不能**。webm 是带 alpha 的视频，只能做 `billboard8` / 表情视频层 |
| 能当立绘源文件改吗 | **不能**。没有 PSD/CLIP，只有成品视频 |
| 能商用吗 | **不能**。CC BY-NC-SA 4.0 明确 NC |
| 能内置吗 | **能（非商业项目）**，必须保留完整四人署名 + 标明改动 + 同协议 |
| 数量与体积 | 11 段 / 18.9 MB，平均 1.7 MB/段，透明 VP9 |
| 对插槽设计的价值 | **极高**：它证明「同一角色的资产可能是视频而不是模型」，插槽必须原生支持 `billboard8` 降级（见 §5.5） |

### 3.5 顺带核实的两个上游设定图仓库

| 仓库 | 实际内容 | 有无 3D | 许可 |
|---|---|---|---|
| `xiaoweigen/deepseek-dafeiyu-assets` | 6 张原尺寸 PNG 六视图/设定图 + `NOTICE.md` + `licenses/YunYueSama-*` | ❌ 无 | CC BY-NC-SA 4.0（YunYueSama 部分另用其自定义署名许可） |
| `treapgogo/deepseek-whale-girl` | `characters/dafeiyu/reference-sheets/`（Q 版 + 成熟版设定图 2 张）+ `characters/brand/` logo ×2 + 260 张 webp 画廊 | ❌ 无（仅 2 张角色立绘 + 品牌图） | 仓库自述 CC BY-NC-SA 4.0 |
| `xxnb0/deepseek-chan-fanpack` | 46 JSON / 33 MD / 26 PNG / 12 GIF / 2 MP4：**提示词包 + 桌宠 2D 素材 + 社区溯源台账**（`docs/community-sources.md` 46 条来源） | ❌ 无 | 主体 CC BY-NC-SA 4.0 |

> 这份 `docs/community-sources.md` 是目前**最完整的社区署名台账**，含「上善无形 2026-08-02 视觉资料（标 CC BY-NC-SA 4.0）」「2026-09-30 商业化声明（反对未授权商业化及周边售卖）」「ZipZipPipe 素材声明」等条目，建议直接引入本项目的 `NOTICE` 作为二级来源（但注意该文档自己也标注「部分为旧引文、未重新核验」）。

---

## 4. 替代方案对比

### 4.1 打分口径

| 维度 | 权重 | 说明 |
|---|---:|---|
| 形象命中 | 40 | 蓝发/蓝眼/深蓝女仆装/白蕾丝/白头饰+蓝饰/鲸尾/赛璐璐 |
| 头身比命中 | 20 | 2–3 头身为满分（用户明确要求 Q 版） |
| 「能不能进安装包」 | 25 | 许可允许再分发 = 满分；仅个人/禁止再分发 = 0 |
| 工程可用性 | 15 | 骨骼/表情/弹簧/动作/体积/性能 |

> 「像不像」= 前两项；「能不能用」= 后两项。**两个分数必须分开报**，否则会把「最像」误当成「能用」。

### 4.2 四强对比

| | **A. 蓝色小肥鱼Deepseek** | **B. DeepSeek-chan** | **C. 鲸鱼娘 Live2D (c_0120)** | **D. ヴィータ (Vita)** |
|---|---|---|---|---|
| 来源 | 模之屋 `ayXkRzVflmnd`（木子恶魔） | GitHub `tegnike/deepseek-chan-vrm`（モデラー ニケ） | GitHub `Andersen216/dsh-whale-girl-live2d`（Live2D 氵六青） | VRoid 官方示例 / `drliuhuan` 插件内置 |
| 格式 | **VRM 1.0** | **VRM 1.0** + `.blend` | **Live2D Cubism 4**（`.moc3` + 贴图 + `model3.json`） | VRM 0.x |
| 体积 | **18.48 MB**（br 后 15.41 MB） | **33.62 MB**（blend 另 26.54 MB） | 2.12 MB + 1.77 MB 贴图 | 13.97 MB |
| 面数 | **45,663** | **92,344** | 未统计（2D） | 未统计 |
| 贴图 | 8 张，14.4 MB（最大 `TiPen_Color_Studio.png` 7.8 MB） | 8 张，22.6 MB（**6 张 4096²** + 2 张 1024²） | 1 张 2048 图集 | — |
| 骨骼 | 53 humanoid / 146 bones | 53 humanoid / 229 bones | 2D 参数 | 54 bones |
| 表情 | 18 preset + 1 custom（`TiePen`） | 18 preset + 23 custom（部件级） | **44 表情** | 15 |
| 弹簧 | **22 链 / 12 碰撞体**（尾巴 `WeiBa*` 13 个骨节，中/左/右三束） | **40 链 / 11 碰撞体 / 4 组**（发/裙/尾/丝带） | 物理 3 | 18 链 |
| 内置动画 | **0** | **0** | **8 动作** | 0 |
| 实测全高 | **0.9708 m** | **1.7408 m** | — | 1.713 m |
| 实测头身比 | **2.41 头身** ✅ | **3.45 头身** ⚠️ | — | ≈5 头身（**估**，未逐网格量）❌ |
| **像不像（0–100）** | **95** | **88** | **82**（但是 2D） | **20** |
| 许可 | VRM 元数据：`onlyAuthor` / `allowRedistribution:false` / `modification:prohibited` / `personalNonProfit` | **CC BY-NC-SA 4.0** | **CC BY-NC-SA 4.0** + 作者「商用直播√ 自印物料√ 禁止盗用/出售」 | VRoid Hub 许可：`redistribution=allow` `modification=allow` `corporate_commercial_use=allow` `credit=unnecessary` |
| **能商用吗** | ❌ 否 | ❌ 否（NC） | ⚠️ 分层：作者口头允许商用直播/自印，**但角色形象 CC BY-NC-SA 的 NC 仍生效** | ✅ **是** |
| 能改吗 | ❌ 明确禁止 | ✅ 允许（须 SA） | ✅ 允许（须 SA） | ✅ 允许 |
| 能随包再分发吗 | ❌ 禁止 | ✅ **允许**（须署名 + NC + SA） | ✅ 允许（须署名 + NC + SA） | ✅ 允许，且免署名 |
| **能进我们的安装包吗** | ❌ **不能** | ✅ **能（非商业 build）** | ✅ 能（但要 Live2D 运行时） | ✅ **能（任何 build）** |
| 取得难度 | 需登录/注册 Aplaybox | `git clone` 即可 | `git clone` 即可 | `git clone` 即可 |

### 4.3 排序（三个问题，三个答案）

1. **哪个最像？** → **A. BlueFatFish**（95 分）。唯一做到「严格 2.4 头身 + 全部元素命中」的 3D 模型。可惜它的 VRM 元数据是全套限制里最严的一档。
2. **哪个许可最干净？** → **D. Vita**（可商用/可改/可再分发/免署名）。但它**不是这个角色**，只能当「占位角色」和「商用兜底」。
3. **「最像」且「能合法内置」的交集？** → **只有 B. DeepSeek-chan**。88 分，CC BY-NC-SA 4.0，非商业项目可随包分发，三人署名齐全，还有 `.blend` 源文件可以自己改比例（**这是它相对 A 的隐藏优势：A 禁止修改，B 明确允许修改**）。

> **如果哪天必须「2–3 头身」且「能商用」，只有两条路**：① 找 A 的作者 木子恶魔 谈授权；② 拿 B 的 `.blend`（CC BY-NC-SA 允许改）把比例改成 2.5 头身自建一个 —— 但**改完仍是 NC**，商用还是得回到 ①或另请建模。

### 4.4 为什么不选 MMD / PMX

用户描述的画风（粗描边、赛璐璐）很像 MMD 圈子产物，但：

- **本次扫描范围内**（GitHub 12 个仓库的文件树 + 模之屋条目 + B 站检索 + BOOTH + Sketchfab）**未发现**任何 `大肥鱼` 的 `.pmx` 配布；注意 B 站/贴吧/QQ 群未能有效检索（§7 #9），因此**不能**断言「网上不存在」；
- MMD 模型进 Web 需要 `pmx → glTF` 转换（`babylon-mmd` / Blender MMD Tools），且**没有 VRM humanoid 映射**，SpringBone 要重建，工程量约为直接接 VRM 的 4–6 倍；
- 我们的目标平台是 Web/AR，VRM 1.0 是唯一「有标准骨骼 + 标准弹簧 + 标准表情 + 官方 Web 运行时」的格式。

**结论：技术上只支持 `.vrm` / `.glb`，明确拒收 `.pmx/.pmd` 并给出人话提示**（这也有现成先例：`drliuhuan/dsh-plugin-vrmpet3d` 就是按 magic bytes 识别并拒绝 `.pmx/.pmd`/`.vmd`）。

---

## 5. 模型插槽设计（任务 B 全部 7 点）

### 5.0 设计目标与不可动摇的三条约束

| # | 约束 | 来源 |
|---|---|---|
| C1 | **用户能自己换，且换完不被升级覆盖** | 用户原话「模型必须是可选项接口，让用户能自行修改/替换」 |
| C2 | **官方不得内置不可分发的模型** | A 的元数据 `allowRedistribution:false`；若内置，整个安装包变成不可分发物 |
| C3 | **没有动画是常态，不是异常** | 实测 A、B 两个 VRM 的 `animations` 均为 **0**。插槽必须自带程序化动画兜底 |

派生设计原则：**注册表驱动（registry-driven）** + **双层（内置/用户）合并** + **三级降级（vrm → glb → billboard8）** + **许可即数据（license as data）**。

---

### 5.1 目录与注册表

#### 5.1.1 目录树（内置）

```
assets/characters/                     # 随包发布，只读，升级时整体替换
├── index.json                         # ★ 唯一注册表（内置层）
├── _schema/
│   ├── index.schema.json              # JSON Schema，CI 校验
│   └── skin.schema.json
├── dafeiyu/                           # 角色 id（稳定，不可改）
│   ├── README.md                      # 给人看的：这是谁、怎么换皮肤
│   ├── LICENSE                        # 角色级许可（CC BY-NC-SA 4.0 全文）
│   ├── NOTICE.md                      # 署名链（三人）
│   └── skins/
│       ├── chibi-maid/                # 皮肤 id
│       │   ├── model.vrm
│       │   ├── thumb.webp             # 256×256，列表用
│       │   ├── preview.webp           # 1024×1024，详情用
│       │   ├── motions/
│       │   │   ├── idle.vrma
│       │   │   └── cheer.vrma
│       │   └── license/
│       │       ├── LICENSE.txt
│       │       ├── NOTICE.md
│       │       └── provenance.json    # 来源 URL / 取得日期 / sha256 / 作者
│       └── hanfu/                     # 同一角色的第二套皮肤（古风）
│           └── …
└── _placeholder/                      # 无模型时的程序化角色（见 5.5.4）
    └── skin.json
```

关键点：

- **一个目录 = 一个角色**；**一个 `skins/<id>/` = 一套造型**。角色与皮肤两层，天然支持「同一角色多皮肤」。
- `index.json` 是**唯一真源**，目录只放资产。**不允许**靠扫描目录猜角色（否则用户丢个文件夹进去就可能因为缺 `model.vrm` 而崩）。
- `model.vrm` 文件名固定（不是硬编码，而是注册表里写死 `model: "dafeiyu/skins/chibi-maid/model.vrm"`），这样换文件不用改 JSON。

#### 5.1.2 注册表 `assets/characters/index.json`（完整示例）

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "2026-11-16",
  "characters": [
    {
      "id": "dafeiyu",
      "displayName": "大肥鱼",
      "aliases": ["鲸鱼娘", "DeepSeek娘", "蓝色大肥鱼", "溟月"],
      "description": "DeepSeek 鲸鱼娘，社区二创形象；本内置皮肤为半 Q 版。",
      "defaultSkin": "chibi-maid",
      "skins": [
        {
          "id": "chibi-maid",
          "displayName": "Q 版女仆（半 Q）",
          "enabled": true,
          "model": "dafeiyu/skins/chibi-maid/model.vrm",
          "format": "vrm",                    // vrm | glb | gltf | live2d | billboard8
          "renderMode": "auto",               // auto | vrm | glb | billboard8
          "thumb": "dafeiyu/skins/chibi-maid/thumb.webp",
          "preview": "dafeiyu/skins/chibi-maid/preview.webp",

          "transform": {
            "heightBlocks": 2.4,              // 目标身高（1 方块 = 1 世界单位）
            "origin": "feet",                 // feet | center
            "facing": "+z",                   // +z | -z（VRM0 常见 -z）
            "yawOffsetDeg": 0,
            "scaleMultiplier": 1.0
          },
          "anchor": {                         // 挂点：手持物 / 头顶 / 背
            "handR": { "type": "bone", "name": "rightHand", "offset": [0, -0.02, 0.02] },
            "handL": { "type": "bone", "name": "leftHand" },
            "head":  { "type": "bone", "name": "head", "offset": [0, 0.16, 0] },
            "back":  { "type": "bbox", "anchor": "top-center", "offset": [0, -0.2, -0.1] }
          },
          "motions": {
            "idle":    "dafeiyu/skins/chibi-maid/motions/idle.vrma",
            "cheer":   "dafeiyu/skins/chibi-maid/motions/cheer.vrma",
            "walk":    null,
            "sleep":   null
          },
          "expressions": {                    // 状态 → 模型内 preset 名
            "neutral": "neutral",
            "happy":   "happy",
            "sad":     "sad",
            "angry":   "angry",
            "surprised": "surprised",
            "blink":   "blink"
          },
          "fallback": {                       // 5.5 的降级素材
            "sprite": null,
            "billboard8": null
          },
          "budget": {                         // 实测值，用于生成体积策略
            "fileBytes": 33616628,
            "triangles": 92344,
            "textures": 8,
            "maxTextureSize": 4096,
            "decodedTextureBytes": 23756800
          },
          "license": {
            "spdx": "CC-BY-NC-SA-4.0",
            "commercialUse": "no",            // yes | no | unknown
            "modification": "allowed",         // allowed | prohibited | unknown
            "redistribution": "allowed",       // allowed | package-only | prohibited | unknown
            "attribution": ["上善无形", "ZipZipPipe", "ニケ"],
            "sourceUrl": "https://github.com/tegnike/deepseek-chan-vrm",
            "files": ["dafeiyu/skins/chibi-maid/license/LICENSE.txt",
                      "dafeiyu/skins/chibi-maid/license/NOTICE.md"],
            "provenance": "dafeiyu/skins/chibi-maid/license/provenance.json"
          },
          "source": "builtin"                 // builtin | user-fs | user-idb
        }
      ]
    }
  ]
}
```

**为什么 `license` 是对象而不是一个字符串**：因为现实里「许可」至少是三维的（商用 / 可否修改 / 可否再分发），一个 SPDX 字符串表达不了 CC BY-NC-SA 之外的那些自定义条款（A 就是典型：VRM 元数据 + Aplaybox 页面 + 插件授权三层）。UI 上直接渲染成三个徽章。

> ⚠️ **两个必须注意的落地细节**
> 1. **示例里的 `motions` 是「有动作包时」的写法**。实测 DeepSeek-chan 与 BlueFatFish 的 `animations` **都是 0**，所以真正内置时的 `motions` 应全部为 `null`，走 §5.5 的 **L1 程序化动画**。写 `.vrma` 只是展示扩展位。
> 2. **VRMA 动作数据的许可是独立的一套权利**，和模型授权不是一回事。若要用别人打包的 `.vrma`（例如某些插件自带的动作包），必须单独核实其来源与许可，不能因为「模型是 CC BY-NC-SA」就推定「动作也能随便用」。自建 VRMA（用 Blender/Unity 自己 K 帧）最干净。

#### 5.1.3 用户注册表 `index.user.json`（同 schema，可只写差异）

放在用户数据目录（见 5.2），**只允许新增/覆盖同 id 角色，不允许删除内置**：

```jsonc
{
  "schemaVersion": 1,
  "characters": [
    {
      "id": "my-waifu",
      "displayName": "我的鲸鱼娘",
      "defaultSkin": "default",
      "skins": [{ "id": "default", "model": "my-waifu/skins/default/model.vrm", "source": "user-fs", "license": { "commercialUse": "unknown", "attribution": [] } }]
    }
  ]
}
```

#### 5.1.4 合并算法（`CharacterRegistry.resolve()`）

```ts
type Source = 'builtin' | 'user-fs' | 'user-idb';

interface SkinEntry { id: string; source: Source; /* …见上 */ }

function mergeRegistry(builtin: Registry, user: Registry): Registry {
  const byId = new Map<string, Character>();
  for (const c of builtin.characters) byId.set(c.id, { ...c, source: 'builtin' });
  for (const c of user.characters ?? []) {
    const prev = byId.get(c.id);
    if (!prev) { byId.set(c.id, { ...c, source: 'user-fs' }); continue; }
    // 同 id：皮肤按 skinId 合并，用户皮肤覆盖同名内置皮肤，其余保留
    const skins = new Map(prev.skins.map(s => [s.id, s]));
    for (const s of c.skins) skins.set(s.id, { ...s, source: 'user-fs' });
    byId.set(c.id, { ...prev, ...c, skins: [...skins.values()] });
  }
  return { schemaVersion: 1, characters: [...byId.values()] };
}
```

不变量（写进单测）：
1. `resolve()` 后每个角色**至少有一个 `enabled !== false` 的皮肤**，否则回退到 `_placeholder`；
2. `model` 路径必须是**相对注册表所在根**的路径，禁止 `..`、禁止绝对路径、禁止 URL（防目录穿越，桌面端尤其重要）；
3. 同一 `id` 不得跨角色重复；同一 `skin id` 在同一角色内唯一；
4. `format` 与实际文件 magic bytes 不一致时，**以 magic bytes 为准**并升级为 warning。

#### 5.1.5 热更新 / 监听

- 桌面端（有 fs）：`fs.watch(userRoot/index.user.json)` + `fs.watch(内置 index.json)`，debounce 300 ms → 重新 `resolve()` → 发 `registry-changed` 事件 → UI 列表刷新（**不自动换当前角色**，避免正在播动画时被打断）。
- 浏览器端：无 fs，用「刷新角色列表」按钮 + `IndexedDB` 变更事件。

---

### 5.2 配置分层：内置 vs 用户自定义

#### 5.2.1 三层位置

| 层 | 位置 | 谁写 | 升级时 | 可否被用户改 |
|---|---|---|---|---|
| **内置** | `<install>/assets/characters/` | 我们 | **整体替换** | ❌ 改了会丢（要在 UI 里明说） |
| **用户（桌面）** | Win `%APPDATA%\AR-MC\characters\`<br>mac `~/Library/Application Support/AR-MC/characters/`<br>Linux `$XDG_DATA_HOME/AR-MC/characters/`（默认 `~/.local/share`） | 用户 / 应用 | **永不触碰** | ✅ |
| **用户（纯浏览器）** | IndexedDB `ar-mc` → objectStore `characters`（key = `charId/skinId/file`） | 应用 | 永不触碰 | ✅ |

> 名字建议 `AR-MC`（与项目同名），**不要**用 `dsh-*` 前缀，避免和其它插件目录混淆。

#### 5.2.2 为什么不能放安装目录

1. **升级会覆盖**：DSH 插件/应用更新是「整包替换」，用户丢进去的东西 100% 丢失（这是 C1 的直接违背）。
2. **权限**：Windows 的 `Program Files` 默认只读；macOS 的 `.app` 签名会因写入而失效。
3. **多用户**：同一台机器多个账号应各有各的老婆。

#### 5.2.3 文件系统 vs IndexedDB 权衡

| 维度 | 文件系统（桌面） | IndexedDB（浏览器） |
|---|---|---|
| 大文件 | ✅ 33 MB 无压力，可流式读 | ⚠️ Chrome 单 origin 配额通常为磁盘的 60%，但**移动端 Safari 只有 ~1 GB 且可能被清理** |
| 用户可操作性 | ✅ 资源管理器直接丢文件、可备份、可 git | ⚠️ 必须走 UI 导入，用户看不见 |
| 被清空风险 | 低（用户自己删才会没） | **高**（清站点数据 / 隐私模式 / 系统回收） |
| 外部工具处理 | ✅ 可用 Blender 直接改 | ❌ 不能 |
| 实现成本 | 需要 fs 权限（Tauri/Electron 有；纯 Web 无） | ✅ 纯 Web 可用，`File` → `Blob` → IDB |
| 路径安全 | ⚠️ 要防 `..` 穿越 | ✅ 无路径概念 |
| 备份/迁移 | ✅ 复制目录即可 | ⚠️ 要写导出/导入（`.zip`） |

**决策：双通道，统一抽象。**

```ts
interface CharacterSource {
  readonly kind: 'builtin' | 'user-fs' | 'user-idb';
  list(): Promise<SkinEntry[]>;
  read(path: string): Promise<ArrayBuffer>;     // 只读；写只允许 user-*
  watch?(cb: () => void): () => void;           // 桌面可选
}
```

- 桌面 → `FsCharacterSource`（root = 用户数据目录），**优先**；
- 纯浏览器 → `IdbCharacterSource`，导入时把 `File` 整个存成 `Blob`；
- 两者**共用同一个 `index.user.json` schema**（IDB 里存一份 JSON 记录），所以逻辑只有一套。

**降级**：桌面端如果 fs 不可用（例如 Web 版），自动只用 IDB，并在设置页显示「当前为浏览器存储，清站点数据会丢失角色，建议定期导出」。

#### 5.2.4 用户目录里到底放什么

```
%APPDATA%\AR-MC\
├── characters\
│   ├── index.user.json          # 用户注册表（可手写）
│   └── my-waifu\
│       └── skins\default\model.vrm
├── settings.json                # 当前角色/皮肤、音量、画质档
├── cache\
│   └── thumbs\<sha1>.webp       # 缩略图缓存（可删）
└── logs\
```

规则：**`characters\` 下的一切都属于用户**；应用只做「读 + 在用户点导入时写」，**不做任何自动清理**。

---

### 5.3 加载与校验

#### 5.3.1 支持矩阵

| 扩展名 | 容器 | 支持 | 说明 |
|---|---|---|---|
| `.vrm` | GLB（magic `glTF`） | ✅ 一等公民 | VRM 0.x 与 1.0 都接（`@pixiv/three-vrm` 同时支持，`VRMUtils.rotateVRM0()` 处理朝向） |
| `.glb` | GLB | ✅ | 有 skin 就能挂 VRM 骨骼映射（按 node 名匹配）；无 skin 走静态模式 |
| `.gltf` + `.bin` + 贴图 | JSON | ⚠️ 只在「文件夹导入」时支持 | 单文件导入会缺依赖，提示用户改用 `.glb` |
| `.pmx` / `.pmd` / `.vmd` | MMD 二进制 | ❌ **明确拒绝** | 识别 magic bytes（`PMX ` / `Pmd ` / `Vocaloid Motion Data`）→ 给专属文案（「这是 MMD 模型，本应用不支持；可用 Blender + MMD Tools 转成 glTF」） |
| `.fbx` / `.blend` / `.obj` | — | ❌ | 提示同上，给转换路径 |

#### 5.3.2 体积与预算上限（**依据实测数据制定**）

| 项 | 软上限（警告） | 硬上限（拒绝） | 依据 |
|---|---:|---:|---|
| 单文件 | 20 MB | **64 MB** | B=32 MB 能过；A=18 MB 很轻；>64 MB 在移动端解压+上传会明显卡 |
| 三角面 | 60k | **200k** | A=45k（轻）、B=92k（中）；200k 以上 AR 手机必掉帧 |
| 贴图总解码内存 | 64 MB | **256 MB** | B 的 6×4096² RGBA ≈ **402 MB**（若全按 RGBA 解）→ 见下方降采样策略 |
| 单张贴图边长 | 2048 | **4096** | 超过 4096 在多数移动 GPU 上会被拒绝或极慢 |
| 骨骼数 | 128 | 512 | B=229、A=146 |
| 材质数 | 16 | 64 | B=10、A=14 |
| 弹簧链 | 40 | 128 | B=40 |

**贴图降采样策略（必须做，否则 B 直接爆显存）**：

```ts
// 加载后、上传 GPU 前
for (const tex of collectTextures(gltf)) {
  const max = quality === 'mobile' ? 1024 : quality === 'desktop' ? 2048 : 4096;
  if (tex.image.width > max) downscale(tex.image, max);   // 用 OffscreenCanvas
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
}
```

效果：B 的 6 张 4096² → 2048² 后显存从 ~402 MB 降到 ~100 MB；1024² 后 ~25 MB。**移动端必须 1024。**

#### 5.3.3 必需项分级（没有骨骼怎么办）

| 等级 | 要求 | 不满足时 |
|---|---|---|
| **T0 可站立** | humanoid ≥ `{hips, spine, chest, neck, head, leftUpperArm, rightUpperArm, leftUpperLeg, rightUpperLeg}`（9 个） | → **静态模式**：能显示、能旋转缩放、不能播 VRMA；idle 用程序化整体浮动 |
| **T1 可动作** | T0 + 四肢完整（`lowerArm/lowerLeg/hand/foot`） | → 只能播「上半身」动作，腿用正弦摆动 |
| **T2 可表情** | 有 `expressionManager` 且至少 `blink` | → 不眨眼，用整体缩放脉冲代替「情绪」 |
| **T3 可物理** | `springBoneManager` 有链 | → 尾巴/头发不摇；若有 `WeiBa*`/`tail*` 骨骼则挂程序化正弦 |

判定逻辑（伪代码）：

```ts
function classify(gltf): { mode: RenderMode; tier: 0|1|2|3; reasons: string[] } {
  if (gltf.userData.vrm) {
    const hb = gltf.userData.vrm.humanoid?.humanBones ?? {};
    const t0 = REQUIRED_T0.every(b => hb[b]);
    return { mode: 'vrm', tier: t0 ? (hasFullLimbs(hb) ? (hasExpr ? 3 : 2) : 1) : 0, reasons: [] };
  }
  if (hasSkinnedMesh(gltf.scene)) return { mode: 'glb', tier: 1, reasons: ['no-vrm-humanoid'] };
  return { mode: 'billboard8', tier: 0, reasons: ['no-skeleton'] };
}
```

**静态模型的处理（明确回答「没有骨骼的静态模型怎么办」）**：
1. **不拒绝**，降到 `billboard8`/`static` 模式，仍然可用（作为「摆件/雕像」）；
2. 程序化 idle：`y = sin(t*1.2)*0.01`、`rotation.y = sin(t*0.6)*0.05`（呼吸 + 摆头）；
3. 交互（点击、说话气泡、状态表情）**照常工作** —— 因为它们挂的是 UI 层，不依赖骨骼；
4. UI 上明确标注「此模型无骨骼：不能做动作，只当摆件」，并给「换一个」按钮。

#### 5.3.4 归一化（身高 / 朝向 / 原点）

```ts
function normalize(root: THREE.Object3D, spec: TransformSpec) {
  const box = new THREE.Box3().setFromObject(root);
  const h = box.max.y - box.min.y;
  const s = (spec.heightBlocks / h) * (spec.scaleMultiplier ?? 1);
  root.scale.setScalar(s);

  // 1) 脚底贴地
  root.position.y -= box.min.y * s;
  // 2) 水平居中（用 bbox 中心，不用原点，因为很多模型原点在裆部）
  const cx = (box.min.x + box.max.x) / 2 * s, cz = (box.min.z + box.max.z) / 2 * s;
  root.position.x -= cx; root.position.z -= cz;
  // 3) 朝向：VRM1 面向 +Z；VRM0 经 rotateVRM0 后也是 +Z
  root.rotation.y = THREE.MathUtils.degToRad(spec.yawOffsetDeg ?? 0) + (spec.facing === '-z' ? Math.PI : 0);
  return { scale: s, rawHeight: h };
}
```

实测数据（供默认值用）：

| 模型 | 原始全高 | 头身比 | 归一化到 2.4 方块后 scale |
|---|---:|---:|---:|
| A BlueFatFish | 0.9708 m | 2.41 | 2.472 |
| B DeepSeek-chan | 1.7408 m | 3.45 | 1.379 |
| D Vita | 1.7130 m | ≈5 | 1.401 |

> 注意：**归一化按「全高」而不是「头高」**。否则 2 头身和 6 头身的角色站在一起时，2 头身的会显得像巨人（因为头大）。

#### 5.3.5 校验流水线与错误码（人话文案是交付物的一部分）

```ts
type LoadError =
  | 'E_TOO_BIG' | 'E_NOT_MODEL' | 'E_MMD' | 'E_TRUNCATED' | 'E_GLTF_PARSE'
  | 'E_NO_SCENE' | 'E_HEIGHT_RANGE' | 'E_TOO_MANY_TRIS' | 'E_TEX_TOO_LARGE'
  | 'E_NO_HUMANOID' | 'E_EXPR_MISSING' | 'E_NETWORK';
```

| 错误码 | 触发 | 用户看到的中文文案 | 下一步按钮 |
|---|---|---|---|
| `E_MMD` | magic `PMX `/`Pmd ` | 「这是 MMD 模型（.pmx/.pmd），本应用还不支持。请用 Blender 的 MMD Tools 转成 .glb 再导入。」 | 「看看怎么转」→ 文档 |
| `E_NOT_MODEL` | 不是 GLB/GLTF | 「这个文件不是 3D 模型。需要 .vrm 或 .glb 文件（不是图片、不是压缩包）。」 | 「重新选择」 |
| `E_TRUNCATED` | 文件头合法但长度不足 | 「文件好像没下载完整（只有 12 MB，声明 33 MB）。请重新下载。」 | 「重新下载」 |
| `E_GLTF_PARSE` | 解析异常 | 「模型文件损坏或版本太新，读不出来。换一个文件试试？」 | 「重新选择」 |
| `E_TOO_BIG` | > 64 MB | 「模型 78 MB，超过 64 MB 上限。可以先用 Blender 压缩贴图再导入。」 | 「怎么压缩」 |
| `E_TOO_MANY_TRIS` | > 200k | 「这个模型有 32 万面，手机上会卡。仍要使用吗？」（**警告可继续**） | 「仍然使用」/「换一个」 |
| `E_TEX_TOO_LARGE` | 单边 > 4096 | 自动降采样，**不报错**，只记 warning | — |
| `E_HEIGHT_RANGE` | 全高 < 0.2 或 > 3 m | 「模型尺寸异常（高 12 米）。可能单位不对，我们已按默认身高缩放。」（**自动修正**） | — |
| `E_NO_HUMANOID` | 无 VRM 骨骼 | 「能显示，但这个模型没有人体骨骼，不能做动作，只能当摆件。」（**警告继续**） | 「仍然使用」 |
| `E_NETWORK` | 下载 `motions/*.vrma` 失败 | 「动作文件没下下来，角色会站着不动。」（**降级继续**） | 「重试」 |

**原则：能降级的一律降级 + 一条可读警告；只有「根本读不了」才弹错误。** 每个错误都必须带**一个可点的下一步**，不许只丢一行红字。

#### 5.3.6 校验伪代码（可直接贴进实现）

```ts
async function loadSkin(entry: SkinEntry, src: CharacterSource) {
  const buf = await src.read(entry.model);                       // 1. 读
  const magic = new Uint8Array(buf.slice(0, 12));
  if (isMMD(magic)) throw new LoadError('E_MMD');
  if (!isGLB(magic) && !isGLTFJson(buf)) throw new LoadError('E_NOT_MODEL');
  const declared = readDeclaredLength(buf);                      // 2. 完整性
  if (declared && declared > buf.byteLength) throw new LoadError('E_TRUNCATED');

  const gltf = await new GLTFLoader().parseAsync(buf, '');       // 3. 解析（GLTFLoader 支持 ArrayBuffer）
  if (!gltf.scene) throw new LoadError('E_NO_SCENE');

  const stats = measure(gltf);                                    // 4. 预算
  if (stats.bytes > HARD.fileBytes) throw new LoadError('E_TOO_BIG', stats);
  const warn = [];
  if (stats.triangles > SOFT.triangles) warn.push('E_TOO_MANY_TRIS');
  if (stats.maxTextureSize > HARD.maxTextureSize) { downsample(gltf, qualityMax()); warn.push('E_TEX_TOO_LARGE'); }

  const vrm = gltf.userData.vrm;
  const mode = classify(gltf);
  if (vrm && !hasT0(vrm)) warn.push('E_NO_HUMANOID');             // 5. 骨骼分级
  if (!vrm) warn.push('E_NO_HUMANOID');

  normalize(gltf.scene, entry.transform);                         // 6. 归一化
  return { gltf, vrm, mode, stats, warnings: warn };
}
```

---

### 5.4 运行时切换：能不能不刷新页面就换模型？

**能。** 而且必须做到，否则「用户可替换」体验会很差（AR 场景下刷新页面 = 重新进 AR = 重新对平面，代价极高）。

#### 5.4.1 架构：单舞台 + 双缓冲

```ts
class CharacterStage {
  private current: MountedCharacter | null = null;
  private staging: MountedCharacter | null = null;

  async swap(entry: SkinEntry) {
    // 1) 后台加载（不阻塞当前角色，动画继续播）
    const next = await mountCharacter(entry);

    // 2) 显存预算检查（见 5.4.5）
    if (this.current && memProjected(this.current, next) > VRAM_BUDGET) {
      this.current.setVisible(false);          // 先藏，不 dispose，失败可回滚
      await nextFrame();
    }

    // 3) 一帧内交换
    this.scene.add(next.root);
    this.applyTransform(next, this.currentPose);   // 位置/朝向/缩放沿用
    next.play(this.stateMachine.currentState);     // 状态机跟着走
    if (this.current) { this.current.root.removeFromParent(); this.current.dispose(); }
    this.current = next;
  }
}
```

#### 5.4.2 换模型时，**正在播的动画**怎么办

这是整个插槽最容易写错的地方。三个坑：

| 坑 | 现象 | 正确做法 |
|---|---|---|
| **Clip 绑骨架** | 把 `mixer.clipAction(clipA)` 直接给新模型 → 动作错乱/抽搐/T-pose | **缓存 `VRMAnimation`（与骨架无关的中间表示），每次切换用 `createVRMAnimationClip(vrmAnim, newVrm)` 重新生成 Clip**。`three-vrm-animation` 就是为此设计的 |
| **mixer 绑 root** | 旧 mixer 还在 tick 已释放的骨架 → 报错或 NaN | `oldMixer.stopAllAction(); oldMixer.uncacheRoot(oldRoot); oldMixer.setTime(0)` |
| **状态丢失** | 切完模型回到 idle，正在表达的「开心」没了 | 切换时保存 `{ state, expressionValues, pose }`，挂载后 `applyState()` 重放 |

```ts
interface MotionCache {
  // key = motion 文件路径（不是 clip）
  get(vrmAnimUrl: string): Promise<VRMAnimation>;   // 原始数据，跨模型可复用
}
function buildClipFor(vrm: VRM, vrmAnim: VRMAnimation) {
  return createVRMAnimationClip(vrmAnim, vrm);      // ← 每换一次模型重建一次
}
```

**如果当前正在播一次性动作**（例如「比心」播到 60%）：默认策略是**等它播完再换**（<1.5 s），UI 上显示「正在换装…」。若要立即换，则把动作**从头重播**（不 interpolate 到新骨架，肉眼看不出差异，但不会错位）。

#### 5.4.3 挂点（手持物 / 头顶装饰）

```ts
function migrateAttachments(from: MountedCharacter, to: MountedCharacter) {
  for (const [slot, obj] of from.attachments) {
    const spec = to.skin.anchor[slot];
    obj.removeFromParent();                       // ★ 必须先摘下，否则会被一起 dispose
    const parent = resolveAnchor(to, spec);       // bone 优先，bbox 兜底
    parent.add(obj);
    obj.position.fromArray(spec.offset ?? [0, 0, 0]);
    to.attachments.set(slot, obj);
  }
}
```

- `resolveAnchor`：`bone` 型按**骨骼名**找（`rightHand` / `head`），VRM 用 `humanoid.getNormalizedBoneNode()` 取（**统一到 normalized 空间**，避免不同模型的 rest pose 差异）；`bbox` 型挂在 `root` 上并用 bbox 比例算偏移。
- 找不到骨骼：降级到 `bbox` 锚点 + 控制台 warning，**不要抛错**（用户导的模型可能没有手指骨）。
- 挂点物体本身**不随模型释放**（它是我们自己的 `Object3D`），只换父节点。

#### 5.4.4 弹簧骨骼（尾巴 / 头发 / 裙子）

- `VRMSpringBoneManager` 是**每个 VRM 实例私有**的，`update(delta)` 必须用**新实例**调，旧实例随旧模型一起丢弃。
- 切换后**必须重置时间累积器**（`spring.reset()` 若可用，否则 `spring.update(0)` 两次），否则旧链的速度会带进来导致「头发炸开」——这是常见 bug。
- 若新模型**没有**弹簧链但有 `WeiBa*` / `tail*` / `hair*` 骨骼：挂一个**程序化尾巴摆动**（见 5.5.3），保证「鲸鱼尾巴会动」这个角色特征不丢。
- 若新模型**完全没有**尾巴骨：不补、不造假，UI 不提示（用户自己选的模型）。

#### 5.4.5 旧模型怎么释放（**逐项 checklist**）

three.js 不会自动回收 GPU 资源，漏一项就是显存泄漏。**必须按这个清单走**：

```ts
function disposeCharacter(c: MountedCharacter) {
  c.mixer?.stopAllAction();
  if (c.mixer && c.root) c.mixer.uncacheRoot(c.root);       // 1. 解绑动画

  const geo = new Set<THREE.BufferGeometry>();
  const mat = new Set<THREE.Material>();
  const tex = new Set<THREE.Texture>();

  c.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      if (m.geometry) geo.add(m.geometry);
      for (const mm of (Array.isArray(m.material) ? m.material : [m.material])) {
        if (!mm) continue;
        mat.add(mm);
        for (const k of Object.keys(mm)) {                   // 2. 材质上的所有贴图
          const v = (mm as any)[k];
          if (v && v.isTexture) tex.add(v);
        }
      }
      if (m.skeleton) m.skeleton.dispose?.();                 // 3. 骨架
    }
  });

  for (const t of tex) t.dispose();                           // 4. 贴图
  for (const m of mat) m.dispose();                           // 5. 材质
  for (const g of geo) g.dispose();                           // 6. 几何
  c.root.removeFromParent();                                  // 7. 摘树
  c.root.clear();                                             // 8. 断引用
  c.vrm = null; c.mixer = null;                               // 9. 断 VRM 引用（含 springBoneManager）
  c.attachments.clear();
}
```

实测规模（B）：**8 张贴图 / 10 个材质 / 66 个 mesh / 1 个 skin（229 骨）**。漏 dispose 一次 ≈ 100–400 MB 显存。

**额外注意**：
- **不要** `THREE.Cache.clear()`（会误伤其它资源）。
- 缩略图/预览图是 `<img>`，走浏览器缓存，不归 three 管。
- 若用了 `PMREMGenerator` 生成的环境贴图，它是**全局共享**的，不要跟着角色释放。

#### 5.4.6 失败回滚

```
swap(entry):
  try  → 成功：dispose 旧的
  catch → 保留旧的（若已 setVisible(false) 则恢复 true），toast 显示错误文案（§5.3.5），状态机回滚
```

#### 5.4.7 同一皮肤重载（用户替换了同名文件）

`model.vrm` 的 mtime/sha256 变了 → 视为「同 id 新版本」→ 走一次完整 swap（**不能用增量**，因为拓扑可能完全变了）。UI 给「重新加载」按钮。

---

### 5.5 兼容性降级：`renderMode: "vrm" | "glb" | "billboard8"`

#### 5.5.1 自动选择（`renderMode: "auto"`）

```
读 magic bytes
├─ 非 GLB/GLTF ─────────────────────────────→ 报错（§5.3.5）
└─ GLB/GLTF
   ├─ 有 extensions.VRMC_vrm 或 extensions.VRM ──→ "vrm"
   ├─ 有 SkinnedMesh + 至少 T0 骨骼 ─────────────→ "glb"（可播 glTF AnimationClip / 程序化）
   ├─ 有 SkinnedMesh 但骨骼不足 ─────────────────→ "glb-static"（只显示）
   └─ 无网格/只有贴图（或 skin.json 指向 sprite）→ "billboard8"
```

显式指定优先于 auto（方便调试和强制降级）。

#### 5.5.2 五级降级阶梯（**状态机怎么退化**）

| 级别 | 条件 | idle | 「开心」 | 「思考」 | 「说话」 | 备注 |
|---|---|---|---|---|---|---|
| **L0 完整** | VRM + T3 + VRMA | `idle.vrma` 循环 | `cheer.vrma` + `happy` 表情 | 抬头 + `think` 表情 | 口型 `aa/ih/ou` 驱动 | 理想态 |
| **L1 有骨无动作** | VRM + T2，无 `.vrma` | **程序化**：呼吸 + 摆头 + 手臂微摆 | 表情 `happy` + 跳跃（根节点 y 位移） | 头抬 15° + 视线偏移 | 表情口型 | **本项目的默认态**（A/B 都无内置动画） |
| **L2 无表情** | 有骨，无 `expressionManager` | 程序化（同上） | 整体缩放脉冲 1.0→1.05 + 转圈 | 头部倾斜 | 气泡打字机（无口型） | |
| **L3 无骨（静态）** | `glb-static` | 整体浮动 `y=sin(t)*0.01` | 弹跳 + 星星粒子（UI 层） | 不动作，只出气泡 | 气泡 | 「当摆件」 |
| **L4 只有图** | `billboard8` | 8 方向循环 + 2 帧呼吸 | 切「开心」帧组 | 切「思考」帧组 | 嘴部帧 | 用 dsh-game 的 webm / 六视图 PNG |

**状态机契约（写进代码的类型）**：

```ts
type CharState = 'idle' | 'thinking' | 'working' | 'happy' | 'sad' | 'error' | 'sleep';
type Capability = { motion: boolean; expression: boolean; lipsync: boolean; spring: boolean };

// 状态机永远只发「语义」，适配层根据 Capability 决定怎么演
interface StatePresenter {
  present(state: CharState, caps: Capability): void;
}
```

这样**状态机完全不知道模型长什么样**，换模型/降级都不需要改状态机 —— 这是「可替换」能成立的架构前提。

#### 5.5.3 程序化 idle 规格（L1/L2 用，直接可抄）

```ts
function proceduralIdle(vrm: VRM, t: number) {
  const h = vrm.humanoid;
  const set = (b: string, axis: 'x'|'y'|'z', v: number) => {
    const n = h.getNormalizedBoneNode(b as any); if (n) n.rotation[axis] = v;
  };
  set('spine', 'x', 0.02 + Math.sin(t * 1.6) * 0.012);          // 呼吸
  set('chest', 'x', Math.sin(t * 1.6 + 0.3) * 0.010);
  set('head',  'y', Math.sin(t * 0.55) * 0.14);                  // 左右看
  set('head',  'x', Math.sin(t * 1.6 + 0.6) * 0.02);
  set('leftUpperArm',  'z', -1.15 + Math.sin(t * 1.6) * 0.03);   // 手臂微摆（T-pose → A-pose）
  set('rightUpperArm', 'z',  1.15 - Math.sin(t * 1.6 + 0.2) * 0.03);

  // 尾巴：优先 VRM 弹簧；无弹簧但有尾骨则手工摆
  for (const name of findBones(/^(WeiBa|tail|Tail)/)) {
    const n = h.getNormalizedBoneNode(name) ?? vrm.scene.getObjectByName(name);
    if (n) n.rotation.x = Math.sin(t * 1.2 + n.id * 0.3) * 0.08;
  }
}
```

> 这段已经在我们的实测里跑通过（`_tmp/i_vrm/test/index.html` 的 `tickProcedural`），B 模型上效果正常。

#### 5.5.4 `billboard8` 规格（把 2D 素材变成「能转的 3D」）

- **8 个方位**：`N, NE, E, SE, S, SW, W, NW`（每 45°）。
- **状态组**：`idle`（2 帧呼吸循环）/ `happy` / `sad` / `think` / `talk`（3 帧口型）。
- **命名约定**（写进 `skin.json`）：

```jsonc
"billboard8": {
  "dirs": 8,
  "fps": 8,
  "frames": {
    "idle":  { "pattern": "idle_{dir}_{frame}.webp",  "count": 2 },
    "happy": { "pattern": "happy_{dir}_{frame}.webp", "count": 4 }
  }
}
```

- **自动生成路径**（我们有素材）：
  1. `dsh-game` 的 11 段 webm（透明 alpha）→ `ffmpeg` 抽帧 → 按朝向无（只有正面）→ 退化为 `billboard1`（永远面向相机），但 8 个状态组齐全；
  2. `treapgogo` 的六视图 PNG（正/侧/背）→ 用 AI 补 5 个中间角度 → 8 方向；
  3. `xiaoweigen` 的六视图 → 同上。
- 渲染：`THREE.Sprite` 或 plane + `lookAt(camera)`，按相机与角色的**方位角**选帧，`Math.round(angle / (2π/8)) % 8`。
- 优点：**体积小**（一个状态 8 方向 × 2 帧 × 30 KB ≈ 0.5 MB）、**任何设备都能跑**、**许可通常最宽松**（很多 2D 素材是 CC BY-NC-SA 但不用处理骨骼）。

#### 5.5.5 画质档与预算联动

| 档位 | 目标设备 | 贴图上限 | 三角面上限 | 弹簧 | 阴影 | billboard8 帧率 |
|---|---|---:|---:|---|---|---:|
| `ultra` | 桌面独显 | 4096 | 200k | 开 | 开 | 12 |
| `desktop` | 桌面核显 | 2048 | 120k | 开 | 关 | 8 |
| `mobile` | 手机 AR | **1024** | 60k | 开（链数截断 20） | 关 | 6 |
| `low` | 老设备/省电 | 512 | 30k | 关 | 关 | 4 |

`mobile` 档下 B（92k 面 / 6×4K）会触发：贴图降 1024 + 面数超限警告 → 建议用户换 A（45k）或降级到 billboard8。

---

### 5.6 许可与合规

#### 5.6.1 责任怎么划（三层，写进用户协议）

| 层 | 谁保证 | 我们做什么 | 出问题怎么办 |
|---|---|---|---|
| **内置角色** | **我们保证** | 每个内置皮肤**必须**带 `license/`（LICENSE 全文 + NOTICE + provenance.json，含来源 URL、取得日期、sha256），CI 卡门禁 | 我们下架并换默认皮肤 |
| **用户导入** | **用户保证** | 首次导入弹一次确认：「你导入的模型由你自行确保授权；本应用只在本机存储和使用，不上传、不再分发」；记录 `declaredBy: "user"` | 收到投诉 → 提供「一键删除该角色」路径，配合取证 |
| **运行时/引擎** | 各自 | three.js(MIT)、@pixiv/three-vrm(MIT)、Live2D Cubism Core(专有，若启用) | 按各自条款 |

**关键法律事实（必须写进文档，别自我安慰）**：
- 用户「自己有一个模型」≠「我们可以分发它」。**我们只做本地读取**，从不把用户模型打进导出包、不上传、不做 CDN 缓存，这是把风险压在「用户自用」这一侧的**唯一**做法。
- CC BY-NC-SA 的 **NC 是对「使用」的限制**，不是对「分发」的限制；所以非商业项目**可以**随包分发 B，但**一旦项目商业化就必须换掉**。

#### 5.6.2 `license` 字段语义（UI 徽章直接映射）

```jsonc
"license": {
  "spdx": "CC-BY-NC-SA-4.0",     // 或 "LicenseRef-Proprietary" / "Unknown"
  "commercialUse": "no",          // yes | no | unknown  ← 只允许这三值
  "modification": "allowed",      // allowed | prohibited | unknown
  "redistribution": "allowed",    // allowed | package-only | prohibited | unknown
  "attribution": ["上善无形","ZipZipPipe","ニケ"],
  "sourceUrl": "https://…",
  "files": ["…/LICENSE.txt","…/NOTICE.md"],
  "provenance": "…/provenance.json",
  "declaredBy": "vendor"          // vendor | user
}
```

| 徽章 | 条件 | 文案 |
|---|---|---|
| 🟢 | `commercialUse: "yes"` | 「可商用」 |
| 🟡 | `"no"` 且 `redistribution` 允许 | 「仅非商业（可随包）」 |
| 🟠 | `"no"` 且 `redistribution: "prohibited"` | 「仅个人使用 / 不可分发」 |
| 🔴 | `"unknown"` | 「许可未知，请自行确认」 |
| ⚪ | 用户导入且未填 | 「你自己导入的，授权由你负责」 |

**内置皮肤的硬门禁（CI）**：

```js
// scripts/check-characters.mjs
for (const skin of builtinSkins) {
  assert(skin.license, 'missing license');
  assert(skin.license.files.every(f => existsSync(f)), 'missing license file');
  assert(skin.license.commercialUse !== 'unknown', 'builtin must declare commercialUse');
  assert(skin.license.attribution.length > 0 || skin.license.spdx === 'CC0-1.0', 'missing attribution');
  // 且：LICENSE 文本的 sha256 与 provenance.json 记录一致
}
```

#### 5.6.3 导出 / 截图 / 录屏政策

- 默认**不把角色资产写进任何导出物**（导出的是世界存档 + 角色 id 引用，不是模型本体）。
- 截图/录屏默认**包含角色**（这是产品核心体验），但设置里有「导出时隐藏角色」开关；商用素材由用户自行承担（在导出弹窗里一句话提示）。
- 用户模型**永不进入**「分享世界」的网络载荷 —— 分享的是 `{charId, skinId}`，对方没有就回退到占位角色。这条是硬编码的隐私边界。

#### 5.6.4 对本项目的最终建议（可直接抄进方案）

| build | 默认皮肤 | 理由 |
|---|---|---|
| `community`（免费非商业） | **B. DeepSeek-chan**（CC BY-NC-SA 4.0）+ 三人署名 + LICENSE 全文 | 身份准确、可再分发、可修改；NC 与项目定位一致 |
| `commercial`（若将来收费/带广告/卖周边） | **D. VRoid ヴィータ**（可商用、免署名）或程序化占位 | B 的 NC 会污染整个产品 |
| **任何 build** | ❌ **绝不内置 A. BlueFatFish** | `allowRedistribution:false` + `modification:prohibited` |
| 文档/示例 | ✅ 可以把 A 作为「用户自备模型」的示范，附 Aplaybox 链接与「需自行取得授权」提示 | 我们只是告诉用户「有这么个模型」，不是分发 |

---

## 6. 用户自助换模型的 3 步说明（非程序员版）

> 这一段可以直接放进「设置 → 角色 → 帮助」页面。

### 桌面版

**第 1 步：准备一个模型文件**
去 [VRoid Studio](https://vroid.com/studio)（免费）捏一个导出 `.vrm`，或者从模之屋 / BOOTH 下载一个 `.vrm` / `.glb`。
> ⚠️ 只认 `.vrm` 和 `.glb`。`.pmx`（MMD）不行。

**第 2 步：拖进来**
打开 **设置 → 角色 → 导入模型**，把文件**拖进窗口**（或点「选择文件」）。

**第 3 步：点一下就用**
列表里出现她的缩略图 → 点一下 → 立刻换上（**不用重启、不用刷新**）。
不喜欢就点「**恢复内置角色**」。

### 网页版（没有文件系统权限时）

同上 3 步，只是文件会存在**浏览器里**：
> ⚠️ 清理浏览器数据会丢角色。重要的话请点「导出角色包」备份成 `.zip`。

### 给愿意动手的人（可选，不算一步）

把模型文件直接丢进这个文件夹，然后在设置里点「刷新角色列表」：

```
Windows:  %APPDATA%\AR-MC\characters\我的角色\skins\default\model.vrm
macOS:    ~/Library/Application Support/AR-MC/characters/我的角色/skins/default/model.vrm
Linux:    ~/.local/share/AR-MC/characters/我的角色/skins/default/model.vrm
```

> 这个目录**升级不会动**。

---

## 7. 未验证清单

> 以下条目本次**没有拿到一手证据**，报告中所有相关表述都按「未取到/待核验」处理，未做推测。

| # | 未验证事项 | 现状 | 建议如何补 |
|---|---|---|---|
| 1 | **Aplaybox `ayXkRzVflmnd` 页面的正式条款**（是否允许转载/改模/商用） | 页面为 Vue SPA（15,472 B 外壳）；`/api/web/v1/work/getWorkDetails` POST→405、GET→返回同一外壳 | 人工用浏览器打开并截图存档；或直接联系作者 木子恶魔 |
| 2 | **BlueFatFish 的 VRM 元数据是否反映作者真实意图** | 元数据是 `onlyAuthor / 禁止再分发 / 禁止修改`，但这类字段常是 VRM 导出时的默认值，Aplaybox 页面可能更宽松 | 同上；在拿到页面条款前，**按最严格解读**（本报告就是这么做的） |
| 3 | 木子恶魔的联系方式 / 是否愿意授权 | 未取到 | 通过 Aplaybox 私信 |
| 4 | B 站四条署名根链接的**当前原文**（上善无形 2026-08-02 / 2026-09-30 商业化声明、ZipZipPipe 素材声明、氵六青主页） | 本次未抓取（B 站检索被风控；opus 链接未逐条读） | 人工打开 4 条链接存档 PDF |
| 5 | 氵六青《使用须知》的**原始文件**（`DS鲸鱼娘/使用须知.txt`） | 只见到 `Andersen216` 仓库 `PROVENANCE.md` 的**转抄**，未见原件 | 向 Andersen216 索要原件或截图 |
| 6 | 模之屋是否存在**其它**大肥鱼模型条目 | 搜索接口不可用，只确认了 1 条 | 人工站内搜「大肥鱼」「鲸鱼娘」 |
| 7 | VRoid Hub 上是否有 `whale` / `maid` / `chibi` 的可商用模型 | 403 | 浏览器人工检索，按「商用可」筛选 |
| 8 | 闲鱼/淘宝「代做 VRM」的价格区间 | 未取到，报告中的 200–2000 元是**估算，不可引用** | 人工询价 3 家 |
| 9 | 米游社/贴吧/QQ 群文档里是否有配布 | 未取到 | 人工 |
| 10 | `AATINF/deepseek-whale-girl-assets` 的 93 张图是否含**可用于 billboard8 的多视角**素材 | 只看了文件清单（205 jpg + 93 png），未逐张看 | 抽 10 张看朝向覆盖 |
| 11 | DeepSeek-chan 的 40 条弹簧链在**移动端**的实际帧率 | 只在桌面 headless SwiftShader 下渲染过（能出图，未测帧率） | 真机 profile |
| 12 | BlueFatFish 在 `mobile` 档（贴图降 1024）下的画质可接受度 | 未测 | 出对比图 |
| 13 | `dsh-game` 的 11 段 webm 能否无损转成 `billboard8` 帧序列（alpha 保留） | 未转 | `ffmpeg -c:v libvpx-vp9 -pix_fmt yuva420p` 抽帧试 1 段 |
| 14 | BOOTH `大肥鱼 DeepSeek`（¥5,000）到底是 Koikatsu 卡还是含 VRM | 商品描述只写 "This is Koikaisu Card" + 禁再配布 | 购买或问卖家（**不建议买**，禁再配布） |

---

## 附录 A：实测数据（可复现）

### A.1 两个 VRM 的解析结果

| 指标 | DeepSeek-chan | BlueFatFish |
|---|---|---|
| 文件 | `DeepSeek-chan.vrm` | `BlueFatFish.vrm` |
| 字节 | 33,616,628 | 18,480,432 |
| SHA256（前 16） | `9FA455E48EE2271D` | `C14879FF5C425010` |
| 容器 | GLB2，chunk `JSON 248,864` + `BIN 33,367,736` | GLB2，chunk `JSON 87,392` + `BIN 18,393,012` |
| 生成器 | `VRM Add-on for Blender v4.10.2` + `Khronos glTF Blender I/O v5.2.41` | `VRM Add-on for Blender v4.5.0` + `v5.0.21` |
| VRM 版本 | **1.0**（`VRMC_vrm`） | **1.0**（`VRMC_vrm`） |
| 扩展 | `KHR_materials_unlit`, `KHR_materials_emissive_strength`, `VRMC_materials_mtoon`, `VRMC_node_constraint`, `VRMC_vrm`, `VRMC_springBone` | `KHR_materials_unlit`, `KHR_materials_emissive_strength`, `VRMC_materials_mtoon`, `VRMC_vrm`, `VRMC_springBone` |
| nodes / meshes / materials | 295 / 66 / 10 | 152 / 6 / 6 |
| textures / images / skins | 8 / 8 / 1 | 7 / 8 / 1 |
| **animations** | **0** | **0** |
| humanoid bones | **53**（含 10 指 ×2 + 眼） | **53** |
| 表情 | 18 preset + 23 custom | 18 preset + 1 custom（`TiePen`） |
| lookAt | `expression` | `bone` |
| 弹簧链 / 碰撞体 / 组 | 40 / 11 / 4 | 22 / 12 / 2 |
| 三角面（three.js 实测） | 92,344 | 45,663 |
| 最大骨骼数 | 229 | 146 |
| morph targets | 115 | 35 |
| bbox（m） | 1.518 × **1.741** × 1.187 | 0.743 × **0.971** × 0.880 |
| 头部网格高（m） | 0.505 | 0.403（`head.001`） |
| **头身比** | **3.45** | **2.41** |
| 贴图 | 8 张 = 22.59 MB；6×4096²（`upper_body_4k`, `hair_4k`, `head_4k`, `accessories_4k`, `DeepSeek_Apron_Logo_4K`, `UpperSkin_MatchedToFace` 11.05 MB PNG）+ 2×1024² | 8 张 = 14.42 MB；最大 `TiPen_Color_Studio.png` 7.83 MB |

### A.2 元数据原文（关键字段）

**DeepSeek-chan**（`extensions.VRMC_vrm.meta`）：

```json
{
  "name": "DeepSeek-chan",
  "authors": ["ニケ"],
  "licenseUrl": "https://vrm.dev/licenses/1.0/",
  "otherLicenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "avatarPermission": "everyone",
  "commercialUsage": "personalNonProfit",
  "creditNotation": "required",
  "allowRedistribution": true,
  "modification": "allowModificationRedistribution",
  "copyrightInformation": "Original character 溟月 (Mingyue) by 上善无形 / Maid design by ZipZipPipe / 3D model by ニケ / Licensed under CC BY-NC-SA 4.0",
  "thirdPartyLicenses": "溟月 by 上善无形 (CC BY-NC-SA 4.0): https://www.bilibili.com/opus/1231977657712771073 / Maid design by ZipZipPipe (CC BY-NC-SA 4.0): https://t.bilibili.com/1231980045693616162"
}
```

**BlueFatFish**（`extensions.VRMC_vrm.meta`）：

```json
{
  "name": "蓝色小肥鱼Deepseek",
  "authors": ["木子恶魔"],
  "licenseUrl": "https://vrm.dev/licenses/1.0/",
  "avatarPermission": "onlyAuthor",
  "allowExcessivelyViolentUsage": false,
  "allowExcessivelySexualUsage": false,
  "commercialUsage": "personalNonProfit",
  "allowPoliticalOrReligiousUsage": false,
  "allowAntisocialOrHateUsage": false,
  "creditNotation": "required",
  "allowRedistribution": false,
  "modification": "prohibited"
}
```

> 两者 `commercialUsage` 都是 `personalNonProfit` → **都不能商用**。差别在**能否再分发/修改**：B 可以，A 不行。这一条差异决定了谁进安装包。

### A.3 VRoid ヴィータ（`SampleModel.vrm`）的许可查询串

```
https://hub.vroid.com/license?allowed_to_use_user=everyone&characterization_allowed_user=everyone
  &corporate_commercial_use=allow&credit=unnecessary&modification=allow
  &personal_commercial_use=profit&redistribution=allow
  &sexual_expression=allow&version=1&violent_expression=allow
```

→ **允许再分发、允许修改、允许个人与法人商用、无需署名**。这是四个候选里唯一「商用无风险」的。（VRoid Hub 本体 403，此串来自模型文件内嵌元数据，**原件可信**。）

### A.4 隔离下载区的文件清单

| 路径 | 字节 | 说明 |
|---|---:|---|
| `_tmp\models\tegnike-deepseek-chan\DeepSeek-chan.vrm` | 33,616,628 | **B，VRM 1.0** |
| `_tmp\models\tegnike-deepseek-chan\DeepSeek-chan.blend` | 26,536,472 | B 的 Blender 源文件（可改比例） |
| `_tmp\models\tegnike-deepseek-chan\preview.png` | 959,356 | 官方三视图 |
| `_tmp\models\tegnike-deepseek-chan\DeepSeek-chan-meta.json` | ~4 KB | 本次解析产物 |
| `_tmp\models\bluefatfish\BlueFatFish.vrm` | 18,480,432 | **A，VRM 1.0**（由 `.br` 解压） |
| `_tmp\models\bluefatfish\SampleModel-Vita.vrm` | 13,967,836 | **D，VRM 0.x** |
| `_tmp\models\bluefatfish\BlueFatFish-meta.json` | — | 解析产物 |
| `_tmp\models\screenshots\*.png` | 8 张 | 实机渲染（正/45°/背/侧 × 2 个模型） |
| `_tmp\models\_repos\*.zip` + 已解压的 `*_x\` | zip 659.7 MB；`_tmp\models` 全目录 1.02 GB / 884 文件 | 9 个仓库快照（含 3 个设定图库、2 个插件、Live2D） |
| `_tmp\models\probe-vrm.mjs` | — | 无依赖 VRM 解析脚本（读 GLB chunk + meta + bbox + 贴图尺寸 + 缩略图） |
| `_tmp\i_vrm\test\shot.html` / `shot.mjs` | — | 无头 Chrome 渲染器（three r187 + @pixiv/three-vrm 3.5.5） |

> **全部在 `_tmp` 隔离区内，未写入 `assets/`。**

### A.5 复现步骤

```powershell
# 1) 拿 B
curl.exe -sSL -o DeepSeek-chan.zip https://codeload.github.com/tegnike/deepseek-chan-vrm/zip/refs/heads/main
Expand-Archive DeepSeek-chan.zip -DestinationPath _tmp\models\_repos\deepseek-chan

# 2) 拿 A（Brotli，需解压）
curl.exe -sSL -o plugin.zip https://codeload.github.com/drliuhuan/dsh-plugin-vrmpet3d/zip/refs/heads/main
Expand-Archive plugin.zip -DestinationPath _tmp\models\_repos\vrmpet3d
node -e "const fs=require('fs'),z=require('zlib');fs.writeFileSync('BlueFatFish.vrm',z.brotliDecompressSync(fs.readFileSync('assets/models/BlueFatFish.vrm.br')))"

# 3) 解析元数据（不装任何依赖）
node _tmp\models\probe-vrm.mjs _tmp\models\bluefatfish\BlueFatFish.vrm

# 4) 渲染实机图（需 Chrome）
cd _tmp\i_vrm; node test\shot.mjs     # → shots3\*.png
```

---

## 附录 B：给实现者的 8 条硬结论

1. **没有动画是常态**：A、B 的 `animations` 都是 0。**程序化 idle 不是兜底，是主路径**，必须第一天就写。
2. **贴图才是性能杀手，不是面数**：B 有 6 张 4096²，若全按 RGBA 上传 ≈ 400 MB 显存；移动端必须降到 1024。**面数 92k 不是问题，贴图是。**
3. **VRM 1.0 是唯一可行的标准**：三份候选（A/B/D）全是 VRM；MMD 一个都没找到，且转换成本高 4–6 倍。
4. **`avatarPermission` / `allowRedistribution` 是机器可读的法律信号**：加载时读它，直接决定 UI 是「可内置」还是「请自备」。这比人读 README 靠谱。
5. **许可必须三元组化**（商用 / 改 / 分发），一个 SPDX 字符串不够用。
6. **换模型的三处必错点**：Clip 绑骨架、挂点没摘、弹簧状态没重置。三条都写进单测。
7. **`index.json` 是唯一真源**：不要扫目录猜角色；用户目录只做「合并覆盖」，永不动内置。
8. **默认皮肤要能一行配置换掉**（`defaultSkin`）：商用 build 和非商用 build 共用一套代码，只换注册表 —— 这是把许可风险挡在发布流程外的唯一低成本办法。

---

*报告结束。所有事实性断言均可回溯到 §2/§3/附录 A 的 URL、git 命令或实测数值；未能取得的一律记入 §7。*
