/**
 * Client half of the Fangcun world panel.
 *
 * The centre column is a messaging-style pet manager: companion conversations
 * on the left with a "我的仓库" item warehouse underneath, the selected
 * companion's chat (plus the island console tab) in the middle, and that
 * companion's profile on the right — followed by the companion model section
 * (recommended model card, GLB/VRM thumbnail import, avatar upload, and a local
 * copy of the model into the Android client assets).
 *
 * Items move from the warehouse onto the profile's two slots by drag and drop,
 * with a click/tap fallback. Another user's companion is strictly read-only.
 *
 * Data comes from the Host half's authenticated routes under
 * `/api/fangcun-host/*`; the browser calls them same-origin with the page
 * cookie. The Host's social API is being extended concurrently: this panel
 * renders whatever is present and degrades to labelled placeholders instead of
 * throwing. Model bytes never enter the panel bundle or the Host store — the
 * browser reads the file locally and the Host half copies it to the Android
 * asset directory on request.
 *
 * Panel convention: one `sidebar.panellist` icon row addressed by `id`, plus one
 * keyed `main` cell with the same id — so the page only exists while selected in
 * the sidebar, and the 2 s poll only runs while the panel is open.
 */
window.__ModuleLoader__.load({
  id: '@local/fangcun-dsh-plugin',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'fangcunPanel'
    const PANEL_ID = 'fangcun-panel'
    const API_BASE = '/api/fangcun-host'
    const POLL_MS = 2000
    const ISLAND_LOAD_TIMEOUT_MS = 6000
    const MODEL_MAX_BYTES = 64 * 1024 * 1024
    const RECOMMENDED_MODEL_URL = 'https://www.aplaybox.com/details/model/ayXkRzVflmnd'

    // ---------------------------------------------------------------- GLB/VRM
    const GLB_MAGIC = 0x46546c67
    const CHUNK_JSON = 0x4e4f534a
    const CHUNK_BIN = 0x004e4942

    /** Parse the GLB container: 12-byte header, JSON chunk and BIN chunk. */
    function parseGlbContainer(buffer) {
      if (buffer.byteLength < 12) throw new Error('file is too small to be a GLB/VRM container')
      const view = new DataView(buffer)
      if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB/VRM file (glTF magic missing)')
      const version = view.getUint32(4, true)
      const declaredLength = view.getUint32(8, true)
      const end = Math.min(declaredLength === 0 ? buffer.byteLength : declaredLength, buffer.byteLength)
      let offset = 12
      let json = null
      let bin = null
      while (offset + 8 <= end) {
        const chunkLength = view.getUint32(offset, true)
        const chunkType = view.getUint32(offset + 4, true)
        const start = offset + 8
        const stop = start + chunkLength
        if (stop > buffer.byteLength) break
        if (chunkType === CHUNK_JSON && json === null) {
          json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, chunkLength)))
        } else if (chunkType === CHUNK_BIN && bin === null) {
          bin = new Uint8Array(buffer, start, chunkLength)
        }
        offset = stop + ((4 - (chunkLength % 4)) % 4)
      }
      if (json === null) throw new Error('GLB container has no JSON chunk')
      return { json, bin, version, declaredLength }
    }

    /** VRM 1.0 (`VRMC_vrm`) and VRM 0.x (`VRM`) metadata, normalised. */
    function decodeVrmMeta(gltf) {
      const meta1 = gltf?.extensions?.VRMC_vrm?.meta
      const meta0 = gltf?.extensions?.VRM?.meta
      const meta = meta1 ?? meta0 ?? null
      if (!meta || typeof meta !== 'object') {
        return { name: null, author: null, version: null, specVersion: null, thumbnailImageIndex: null }
      }
      const name = typeof meta.name === 'string' && meta.name
        ? meta.name
        : (typeof meta.title === 'string' && meta.title ? meta.title : null)
      let author = null
      if (Array.isArray(meta.authors)) {
        const list = meta.authors.filter((entry) => typeof entry === 'string' && entry)
        author = list.length > 0 ? list.join(', ') : null
      } else if (typeof meta.authors === 'string' && meta.authors) {
        author = meta.authors
      } else if (typeof meta.author === 'string' && meta.author) {
        author = meta.author
      }
      const rawThumb = meta1 ? meta.thumbnailImage : meta.texture
      const thumbnailImageIndex = typeof rawThumb === 'number' && Number.isInteger(rawThumb) && rawThumb >= 0
        ? rawThumb
        : null
      return {
        name,
        author,
        version: typeof meta.version === 'string' ? meta.version : null,
        specVersion: meta1 ? 'VRM 1.0' : 'VRM 0.x',
        thumbnailImageIndex,
      }
    }

    /**
     * Resolve the VRM thumbnail image bytes from the embedded JSON/BIN chunks.
     * Returns `thumbnail: null` when the model has no embedded image instead of
     * failing, so the caller can fall back to parsed metadata.
     */
    function extractThumbnail(gltf, bin) {
      const meta = decodeVrmMeta(gltf)
      const index = meta.thumbnailImageIndex
      if (index === null || !bin) return { meta, thumbnail: null, mime: null }
      const image = Array.isArray(gltf.images) ? gltf.images[index] : null
      if (!image || typeof image !== 'object' || image.bufferView === undefined) {
        return { meta, thumbnail: null, mime: null }
      }
      const bufferView = Array.isArray(gltf.bufferViews) ? gltf.bufferViews[image.bufferView] : null
      if (!bufferView || typeof bufferView !== 'object' || (bufferView.buffer ?? 0) !== 0) {
        return { meta, thumbnail: null, mime: null }
      }
      const byteOffset = typeof bufferView.byteOffset === 'number' ? bufferView.byteOffset : 0
      const byteLength = typeof bufferView.byteLength === 'number' ? bufferView.byteLength : 0
      if (byteLength <= 0 || byteOffset < 0 || byteOffset + byteLength > bin.byteLength) {
        return { meta, thumbnail: null, mime: null }
      }
      return {
        meta,
        thumbnail: bin.subarray(byteOffset, byteOffset + byteLength),
        mime: typeof image.mimeType === 'string' ? image.mimeType : 'image/png',
      }
    }

    /** Full preview extraction used by the file picker; invalid files throw to the caller. */
    function extractModelPreview(buffer) {
      const parsed = parseGlbContainer(buffer)
      const { meta, thumbnail, mime } = extractThumbnail(parsed.json, parsed.bin)
      return { version: parsed.version, meta, thumbnail, mime }
    }

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error ?? new Error('could not read the image'))
        reader.readAsDataURL(blob)
      })
    }

    /**
     * The Host caps a decoded avatar image at 64 KiB, so a VRM thumbnail is
     * downscaled to a small JPEG before upload. When canvas/image decoding is
     * unavailable the raw data URL is returned and the Host's own validation
     * reports the real reason.
     */
    async function prepareAvatarDataUrl(blob) {
      try {
        const bitmap = await createImageBitmap(blob)
        const attempts = [
          { size: 256, quality: 0.82 },
          { size: 192, quality: 0.8 },
          { size: 128, quality: 0.75 },
        ]
        for (const attempt of attempts) {
          const canvas = document.createElement('canvas')
          const scale = Math.min(1, attempt.size / Math.max(bitmap.width, bitmap.height, 1))
          canvas.width = Math.max(1, Math.round(bitmap.width * scale))
          canvas.height = Math.max(1, Math.round(bitmap.height * scale))
          const context = canvas.getContext('2d')
          if (!context) break
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL('image/jpeg', attempt.quality)
          if (dataUrl.length <= 80_000) {
            try { bitmap.close?.() } catch { /* not all engines expose close */ }
            return dataUrl
          }
        }
        try { bitmap.close?.() } catch { /* ignore */ }
      } catch { /* fall back to the raw bytes */ }
      return blobToDataUrl(blob)
    }

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return ''
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    const zh = {
      'title': '方寸世界',
      'subtitle': '桌宠社交 · 伙伴对话 · 岛屿控制台',
      'sidebar.label': '方寸世界',
      'status.running': '运行中',
      'status.starting': '启动中',
      'status.stopped': '未运行',
      'revision': '修订',
      'blocks': '方块',
      'action.refresh': '刷新',
      'action.tick': '建造 tick',
      'action.start': '启动 Host',
      'action.starting': '正在启动…',
      'action.send': '发送',
      'action.cancel': '取消',
      'action.collapse': '收起',
      'action.expand': '展开',
      'tab.chat': '对话',
      'tab.island': '岛屿控制台',
      'tab.console': '控制台',
      'console.status': '运行状态',
      'console.pet': '宠物设置',
      'console.demo': '演示',
      'console.companionState': '伙伴状态',
      'console.houseProposal': '等待主人同意盖房',
      'console.housePlan': '计划盖 {count} 个方块',
      'house.approve': '同意盖房',
      'house.reject': '拒绝',
      'house.approved': '已同意，开始建造。',
      'house.rejected': '已拒绝这次盖房。',
      'house.alreadyHandled': '该提议已被处理（可能已在平板上同意或已过期）。',
      'house.failed': '处理失败：{code}',
      'house.unavailable': '盖房决策接口尚未启用。',
      'console.build': '建造进度',
      'console.building': '建造中 {done}/{total}',
      'console.built': '已建造 {done}/{total}',
      'console.buildError': '建造出错：{error}',
      'console.noBuild': '当前没有建造任务。',
      'pet.name': '名字',
      'pet.personality': '性格',
      'pet.scale': '大小',
      'pet.actions': '动作',
      'pet.save': '保存',
      'pet.saved': '已保存。',
      'pet.actionDone': '已切换到「{action}」。',
      'pet.readonly': '别人的桌宠，不能修改设置。',
      'pet.notPrimary': '这个伙伴不是主桌宠，大小和动作只对主桌宠生效。',
      'pet.err.name': '名字需要 1–24 个字符。',
      'pet.err.personality': '性格需要 1–60 个字符。',
      'pet.err.scale': '大小需要在 0.5–3 之间。',
      'pet.err.action': '这个动作不可用。',
      'pet.err.notOwner': '别人的桌宠，不能修改设置。',
      'pet.err.generic': '保存失败：{code}',
      'demo.button': '演示：懒懒小屋',
      'demo.real.button': '演示：认真盖房',
      'demo.real.note': '创建盖房提议并在面板里等待你同意；同意后按 24 方块的节奏建造（含台阶座位）。',
      'demo.lazy.button': '演示：懒懒小屋',
      'demo.lazy.note': '盖 9 个方块的小屋；完成后伙伴会说「房子盖好了，我先坐下休息会」。',
      'demo.cancelledProposal': '已取消待批提案，{name}开始自己盖。',
      'demo.runningTip': '演示进行中',
      'demo.reset.button': '重置世界',
      'demo.reset.note': '清空所有方块回到初始世界（会断开平板连接，平板会自动重连）。',
      'demo.reset.confirm': '确认重置？会清空所有方块',
      'demo.reset.accept': '确认重置',
      'demo.reset.cancel': '取消',
      'demo.reset.running': '正在重置…',
      'demo.reset.done': '已重置：rev {rev} · {count} 方块',
      'demo.reset.unavailable': '重置接口尚未启用。',
      'demo.reset.refused': '重置被拒绝：{reason}',
      'demo.err.buildInProgress': '建造进行中，不能启动新演示。',
      'demo.err.grantMissing': '还没有家园授权（grant_missing），请先批准家园选址。',
      'demo.err.generic': '演示失败：{code}',
      'demo.note': '演示会让伙伴自己选地、提议并盖一间小屋；需要主人同意时会显示在上方。',
      'demo.idle': '还没有开始演示。',
      'demo.starting': '正在启动演示…',
      'demo.started': '演示已启动。',
      'demo.running': '演示进行中：懒懒小屋建造中。',
      'demo.awaiting': '等待主人同意盖房，同意后会继续建造。',
      'demo.done': '演示完成。',
      'demo.refused': '演示被拒绝：{reason}',
      'demo.unavailable': '该演示尚未启用（Host 还没有 /api/core/demo/lazy-house）。',
      'demo.disabled': '建造进行中，暂时不能再启动演示。',
      'island.openTab': '在新标签页打开',
      'island.copyUrl': '复制地址',
      'island.copied': '已复制',
      'list.title': '伙伴',
      'list.empty': '还没有伙伴。',
      'list.legacy': '多伙伴接口暂不可用，当前显示本机桌宠；Host 更新后会自动出现。',
      'list.loading': '加载中…',
      'list.unread': '有新消息',
      'chat.title': '对话',
      'chat.empty': '还没有对话。说点什么，或先执行一次建造 tick。',
      'chat.placeholder': '对伙伴说点什么…',
      'chat.unavailable': '对话暂不可用（Host 还未提供按伙伴的聊天接口）。',
      'chat.none': '先选一个伙伴。',
      'profile.title': '伙伴资料',
      'profile.owner': '主人',
      'profile.ownerMine': '你',
      'profile.personality': '性格',
      'profile.state': '当前状态',
      'profile.action': '当前动作',
      'profile.avatar': '形象模型',
      'profile.none': '未选择伙伴。',
      'profile.readonly': '别人的桌宠，只能看不能动',
      'profile.slots': '道具栏',
      'profile.emptySlot': '空位',
      'warehouse.title': '我的仓库',
      'warehouse.hint': '把仓库里的道具拖到右边的格子里送给它',
      'warehouse.hintSelected': '已选中「{item}」：点右边的空格子送给 {name}',
      'warehouse.empty': '仓库是空的（Host 还没有发放道具）。',
      'warehouse.unavailable': '道具接口暂不可用，Host 更新后会出现。',
      'warehouse.readonly': '当前选中的是别人的桌宠，只能查看道具。',
      'warehouse.drop': '拖到这里',
      'warehouse.locked': '已锁定',
      'warehouse.lockHint': '先选中一个仓库道具，再点这个格子。',
      'warehouse.count': '×{count}',
      'give.ok': '已把「{item}」送给 {name}',
      'give.err.full': '对方的道具栏满了（最多 2 件）。',
      'give.err.notOwned': '你没有这件道具。',
      'give.err.notOwner': '别人的桌宠，只能看不能动。',
      'give.err.alreadyHeld': '对方已经有这件道具了。',
      'give.err.unknownItem': '这件道具不存在。',
      'give.err.companionMissing': '找不到这个伙伴，可能已经离开了。',
      'give.err.unavailable': '赠送接口暂不可用（Host 还未提供）。',
      'give.err.unknown': '赠送失败：{code}',
      'item.descriptionMissing': '暂无道具说明',
      'item.icon': '道具图标',
      'island.title': '岛屿控制台',
      'island.loading': '正在检测岛屿控制台…',
      'island.blocked': '岛屿控制台无法内嵌显示，请在新标签页打开。',
      'island.open': '在新标签页打开岛屿控制台',
      'island.reachable': '控制台地址',
      'island.pairing': '配对码',
      'island.host': 'Host 地址',
      'island.hint': '控制台与 Host 在同一台机器上：打开后可直接查看岛屿、调试方块与伙伴。',
      'island.timeout': '控制台加载超时，可能被浏览器策略拦截。',
      'island.retry': '重新检测',
      'pairing.empty': '未获取',
      'state.idle': '发呆',
      'state.planning': '思考中',
      'state.building': '建造中',
      'state.paused': '暂停',
      'state.sleeping': '睡觉中',
      'state.awaiting_approval': '等待批准',
      'state.notRunning': '方寸 Host 没有在运行',
      'state.notRunningHint': '点上面的「启动 Host」，或手动执行：',
      'state.startFailed': '插件无法启动 Host 进程，请手动启动：',
      'meta.world': '世界',
      'error.route': '面板接口不可用',
      'error.generic': '操作失败',
      'you': '你',
      'companion': '伙伴',
      'tick.committed': 'tick 已提交',
      'tick.paused': 'tick 已暂停',
      'tick.approval': 'tick 需要先批准家园选址',
      'tick.other': 'tick 完成',
      'model.title': '伙伴模型',
      'model.current': '当前头像',
      'model.file': '模型文件',
      'model.import': '导入模型',
      'model.setAvatar': '设为头像',
      'model.install': '安装到客户端',
      'model.parsed': '模型已解析。',
      'model.noThumb': '模型没有内嵌缩略图，已读取模型信息。',
      'model.parseFailed': '无法解析模型文件',
      'model.tooLarge': '模型文件超过 64 MB，请换一个更小的模型。',
      'model.avatarOk': '已设为头像。',
      'model.avatarUnsupported': 'Host 暂不支持 avatarImage 字段（接口正在扩展中），头像只在本地预览。',
      'model.avatarTooLarge': '缩略图过大，Host 拒绝保存（图片上限 64 KB）。',
      'model.avatarInvalid': '缩略图格式不受支持（Host 只接受 PNG/JPEG）。',
      'model.installOk': '模型已保存到客户端资源。',
      'model.installFailed': '保存模型失败',
      'model.rebuild': '模型已保存到客户端资源，需要重新构建并安装 APK 才会在平板上生效。',
      'model.command': '在 apps/android-ar-poc 目录执行：',
      'model.path': '保存位置',
      'model.size': '文件大小',
      'model.readonly': '别人的桌宠：模型只读',
      'model.recommend': '推荐模型：蓝色小肥鱼 Deepseek鲸鱼娘（木子恶魔）',
      'model.recommendNote': '下载 .vrm 后点「导入模型」；模型版权归作者，禁止商用与二次分发，仅本地使用',
      'model.recommendLink': '前往下载',
      'model.localOnly': '模型只保存在你本机，不会进入仓库',
      'model.busy.parse': '正在解析…',
      'model.busy.avatar': '正在保存头像…',
      'model.busy.install': '正在保存模型…',
      'model.meta': '名称：{name} · 作者：{author} · {spec}',
      'model.metaUnknown': '未提供模型名称/作者',
      'model.noFile': '还没有选择模型文件。',
    }

    const en = {
      'title': 'Fangcun World',
      'subtitle': 'pet social · companion chat · island console',
      'sidebar.label': 'Fangcun World',
      'status.running': 'running',
      'status.starting': 'starting',
      'status.stopped': 'stopped',
      'revision': 'rev',
      'blocks': 'blocks',
      'action.refresh': 'Refresh',
      'action.tick': 'Build tick',
      'action.start': 'Start Host',
      'action.starting': 'Starting…',
      'action.send': 'Send',
      'action.cancel': 'Cancel',
      'action.collapse': 'Collapse',
      'action.expand': 'Expand',
      'tab.chat': 'Chat',
      'tab.island': 'Island console',
      'tab.console': 'Console',
      'console.status': 'Runtime status',
      'console.pet': 'Pet settings',
      'console.demo': 'Demo',
      'console.companionState': 'Companion state',
      'console.houseProposal': 'Waiting for the owner to approve the house',
      'console.housePlan': 'planning {count} blocks',
      'house.approve': 'Approve house',
      'house.reject': 'Reject',
      'house.approved': 'Approved — building starts.',
      'house.rejected': 'Rejected this house.',
      'house.alreadyHandled': 'That proposal was already handled (approved on the tablet or expired).',
      'house.failed': 'Could not decide: {code}',
      'house.unavailable': 'The house decision endpoint is not enabled yet.',
      'console.build': 'Build progress',
      'console.building': 'building {done}/{total}',
      'console.built': 'built {done}/{total}',
      'console.buildError': 'Build failed: {error}',
      'console.noBuild': 'No build job right now.',
      'pet.name': 'Name',
      'pet.personality': 'Personality',
      'pet.scale': 'Scale',
      'pet.actions': 'Actions',
      'pet.save': 'Save',
      'pet.saved': 'Saved.',
      'pet.actionDone': 'Switched to “{action}”.',
      'pet.readonly': "Someone else's pet — settings are read-only.",
      'pet.notPrimary': 'This companion is not the primary pet; scale and actions apply to the primary pet only.',
      'pet.err.name': 'The name must be 1–24 characters.',
      'pet.err.personality': 'The personality must be 1–60 characters.',
      'pet.err.scale': 'The scale must be between 0.5 and 3.',
      'pet.err.action': 'That action is not available.',
      'pet.err.notOwner': "Someone else's pet — settings are read-only.",
      'pet.err.generic': 'Save failed: {code}',
      'demo.button': 'Demo: lazy house',
      'demo.real.button': 'Demo: real house',
      'demo.real.note': 'Creates a house proposal and waits for your approval in the panel; approving starts the paced 24-block build (stairs seat included).',
      'demo.lazy.button': 'Demo: lazy house',
      'demo.lazy.note': 'Builds a 9-block house; afterwards the companion says “房子盖好了，我先坐下休息会”.',
      'demo.cancelledProposal': 'Cancelled the pending proposal; {name} starts building instead.',
      'demo.runningTip': 'Demo running',
      'demo.reset.button': 'Reset world',
      'demo.reset.note': 'Clears every block back to the seed world (the tablet connection drops and reconnects automatically).',
      'demo.reset.confirm': 'Reset for real? All blocks will be cleared',
      'demo.reset.accept': 'Confirm reset',
      'demo.reset.cancel': 'Cancel',
      'demo.reset.running': 'Resetting…',
      'demo.reset.done': 'Reset done: rev {rev} · {count} blocks',
      'demo.reset.unavailable': 'The reset endpoint is not enabled yet.',
      'demo.reset.refused': 'Reset refused: {reason}',
      'demo.err.buildInProgress': 'A build is running; the demo cannot be started right now.',
      'demo.err.grantMissing': 'No home grant yet (grant_missing); approve a home plot first.',
      'demo.err.generic': 'Demo failed: {code}',
      'demo.note': 'The demo lets the companion pick a plot, propose it and build a small house; an owner approval appears above when needed.',
      'demo.idle': 'The demo has not started yet.',
      'demo.starting': 'Starting the demo…',
      'demo.started': 'Demo started.',
      'demo.running': 'Demo running: the lazy house is being built.',
      'demo.awaiting': 'Waiting for the owner to approve the house; building continues afterwards.',
      'demo.done': 'Demo finished.',
      'demo.refused': 'Demo refused: {reason}',
      'demo.unavailable': 'This demo is not enabled yet (the Host has no /api/core/demo/lazy-house).',
      'demo.disabled': 'A build is running; the demo cannot be started right now.',
      'island.openTab': 'Open in a new tab',
      'island.copyUrl': 'Copy URL',
      'island.copied': 'Copied',
      'list.title': 'Companions',
      'list.empty': 'No companions yet.',
      'list.legacy': 'The multi-companion API is not available yet, showing the local pet. It appears automatically once the Host ships it.',
      'list.loading': 'Loading…',
      'list.unread': 'New message',
      'chat.title': 'Chat',
      'chat.empty': 'No messages yet. Say something, or run a build tick first.',
      'chat.placeholder': 'Say something to the companion…',
      'chat.unavailable': 'Chat unavailable (the Host does not expose per-companion chat yet).',
      'chat.none': 'Pick a companion first.',
      'profile.title': 'Companion profile',
      'profile.owner': 'Owner',
      'profile.ownerMine': 'you',
      'profile.personality': 'Personality',
      'profile.state': 'State',
      'profile.action': 'Active action',
      'profile.avatar': 'Avatar model',
      'profile.none': 'No companion selected.',
      'profile.readonly': "Someone else's pet — view only, nothing can be changed",
      'profile.slots': 'Item slots',
      'profile.emptySlot': 'empty',
      'warehouse.title': 'My warehouse',
      'warehouse.hint': 'Drag an item from the warehouse onto a slot on the right to give it away',
      'warehouse.hintSelected': '“{item}” selected — click an empty slot on the right to give it to {name}',
      'warehouse.empty': 'The warehouse is empty (the Host has not issued items yet).',
      'warehouse.unavailable': 'Item API unavailable; it appears once the Host ships it.',
      'warehouse.readonly': 'The selected companion belongs to someone else; items are view-only.',
      'warehouse.drop': 'Drop here',
      'warehouse.locked': 'locked',
      'warehouse.lockHint': 'Pick an item in the warehouse first, then click this slot.',
      'warehouse.count': '×{count}',
      'give.ok': 'Gave “{item}” to {name}',
      'give.err.full': 'Their item slots are full (2 max).',
      'give.err.notOwned': "You don't own that item.",
      'give.err.notOwner': "Someone else's pet — view only.",
      'give.err.alreadyHeld': 'That companion already holds this item.',
      'give.err.unknownItem': 'That item does not exist.',
      'give.err.companionMissing': 'That companion is gone.',
      'give.err.unavailable': 'The give endpoint is not available yet.',
      'give.err.unknown': 'Give failed: {code}',
      'item.descriptionMissing': 'No description',
      'item.icon': 'Item icon',
      'island.title': 'Island console',
      'island.loading': 'Checking the island console…',
      'island.blocked': 'The island console cannot be embedded here; open it in a new tab.',
      'island.open': 'Open the island console in a new tab',
      'island.reachable': 'Console URL',
      'island.pairing': 'Pairing code',
      'island.host': 'Host URL',
      'island.hint': 'The console runs on the same machine: inspect the island, tweak blocks and watch companions.',
      'island.timeout': 'The console did not load in time; a browser policy may have blocked the frame.',
      'island.retry': 'Re-check',
      'pairing.empty': 'unavailable',
      'state.idle': 'idle',
      'state.planning': 'planning',
      'state.building': 'building',
      'state.paused': 'paused',
      'state.sleeping': 'sleeping',
      'state.awaiting_approval': 'awaiting approval',
      'state.notRunning': 'The Fangcun Host is not running',
      'state.notRunningHint': 'Use “Start Host” above, or run manually:',
      'state.startFailed': 'The plugin could not spawn the Host process; start it manually:',
      'meta.world': 'world',
      'error.route': 'panel route unavailable',
      'error.generic': 'action failed',
      'you': 'You',
      'companion': 'Companion',
      'tick.committed': 'tick committed',
      'tick.paused': 'tick paused',
      'tick.approval': 'tick needs a home-site approval first',
      'tick.other': 'tick finished',
      'model.title': 'Companion model',
      'model.current': 'Current avatar',
      'model.file': 'Model file',
      'model.import': 'Import model',
      'model.setAvatar': 'Set as avatar',
      'model.install': 'Install into client',
      'model.parsed': 'Model parsed.',
      'model.noThumb': 'The model has no embedded thumbnail; its metadata was read instead.',
      'model.parseFailed': 'Could not parse the model file',
      'model.tooLarge': 'The model file exceeds 64 MB; pick a smaller one.',
      'model.avatarOk': 'Avatar saved.',
      'model.avatarUnsupported': 'The Host does not accept avatarImage yet (its field is being extended); the avatar is only previewed locally.',
      'model.avatarTooLarge': 'The thumbnail is too large for the Host (64 KB image cap).',
      'model.avatarInvalid': 'Unsupported thumbnail format (the Host accepts PNG/JPEG only).',
      'model.installOk': 'Model saved into the client assets.',
      'model.installFailed': 'Could not save the model',
      'model.rebuild': 'The model is saved into the client assets; rebuild and install the APK for it to appear on the tablet.',
      'model.command': 'Run from apps/android-ar-poc:',
      'model.path': 'Saved to',
      'model.size': 'Size',
      'model.readonly': "Someone else's pet: model is read-only",
      'model.recommend': 'Recommended model: Blue Chubby Fish / Deepseek whale girl (by 木子恶魔)',
      'model.recommendNote': 'After downloading the .vrm press “Import model”; the model is the author’s copyright — no commercial use or redistribution, local use only',
      'model.recommendLink': 'Download page',
      'model.localOnly': 'The model stays on your machine and never enters the repository',
      'model.busy.parse': 'Parsing…',
      'model.busy.avatar': 'Saving avatar…',
      'model.busy.install': 'Saving model…',
      'model.meta': 'Name: {name} · Author: {author} · {spec}',
      'model.metaUnknown': 'No model name/author provided',
      'model.noFile': 'No model file selected yet.',
    }

    const CSS = [
      '.fc-page{flex:1 1 auto;height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;padding:18px 22px 14px;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;overflow:hidden}',
      '.fc-head{flex:0 0 auto;display:flex;align-items:center;gap:10px;min-width:0}',
      '.fc-mark{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:var(--dsw-alias-fill-l1);border:0.5px solid var(--dsw-alias-border-l3)}',
      '.fc-title-wrap{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.fc-title{font-size:17px;font-weight:600;line-height:1.25;margin:0;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.fc-subtitle{font-size:11.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fc-pill{display:inline-flex;align-items:center;gap:6px;border:0.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:3px 10px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.fc-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-state-idle-primary)}',
      '.fc-dot[data-status="running"]{background:var(--dsw-alias-state-success-primary)}',
      '.fc-dot[data-status="starting"]{background:var(--dsw-alias-state-warn-primary)}',
      '.fc-dot[data-status="stopped"]{background:var(--dsw-alias-state-error-primary)}',
      '.fc-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.fc-spacer{flex:1 1 auto}',
      '.fc-btn{border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);border-radius:7px;padding:0 12px;height:28px;font-size:12px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}',
      '.fc-btn:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover)}',
      '.fc-btn[disabled]{opacity:.45;cursor:default}',
      '.fc-btn[data-variant="primary"]{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}',
      '.fc-btn[data-variant="primary"]:hover:not([disabled]){background:var(--dsw-alias-button-primary-hover)}',
      '.fc-btn[data-size="sm"]{height:24px;padding:0 9px;font-size:11.5px;border-radius:6px}',
      '.fc-body{flex:1 1 auto;min-height:0;display:grid;gap:12px;grid-template-columns:250px minmax(0,1fr) 280px;grid-template-areas:"list chat profile"}',
      '.fc-card{min-width:0;min-height:0;display:flex;flex-direction:column;border:0.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.fc-list{grid-area:list}',
      '.fc-chat{grid-area:chat}',
      '.fc-rightcol{grid-area:profile;min-height:0;min-width:0;display:flex;flex-direction:column;gap:12px;overflow:auto}',
      '.fc-profile{flex:0 0 auto}',
      '.fc-model{flex:0 0 auto}',
      '.fc-card-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l3);min-width:0}',
      '.fc-card-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.fc-count{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.fc-card-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fc-banner{flex:0 0 auto;margin:8px 10px 0;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.5}',
      '.fc-convs{flex:1 1 auto;min-height:0;overflow:auto;padding:6px}',
      '.fc-conv{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;border:0.5px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);border-radius:9px;padding:7px 8px;cursor:pointer;text-align:left;font-family:inherit}',
      '.fc-conv:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.fc-conv[data-selected="true"]{background:var(--dsw-alias-fill-l1);border-color:var(--dsw-alias-border-l3)}',
      '.fc-conv-body{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;text-align:left}',
      '.fc-conv-name{display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;min-width:0}',
      '.fc-conv-name>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fc-conv-preview{font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fc-conv-tags{display:flex;align-items:center;gap:5px;flex:0 0 auto}',
      '.fc-tag{font-size:9.5px;line-height:1;padding:2px 5px;border-radius:999px;background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-tertiary);border:0.5px solid var(--dsw-alias-border-l3);white-space:nowrap}',
      '.fc-unread{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary);flex:0 0 auto}',
      '.fc-avatar{flex:0 0 auto;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--dsw-alias-fill-l1);border:0.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);overflow:hidden}',
      '.fc-avatar[data-mine="true"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.fc-avatar-img{width:100%;height:100%;object-fit:cover;display:block}',
      '.fc-warehouse{flex:0 0 auto;border-top:0.5px solid var(--dsw-alias-border-l3);display:flex;flex-direction:column;gap:6px;padding:8px 10px 10px;max-height:230px;overflow:auto}',
      '.fc-warehouse-head{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:0}',
      '.fc-warehouse-hint{font-size:10px;line-height:1.45;color:var(--dsw-alias-label-tertiary)}',
      '.fc-warehouse-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}',
      '.fc-item{position:relative;display:flex;align-items:center;gap:6px;min-width:0;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 7px;cursor:grab;font-family:inherit;font-size:11px;text-align:left}',
      '.fc-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.fc-item[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-fill-l1)}',
      '.fc-item[data-dragging="true"]{opacity:.55}',
      '.fc-item[data-readonly="true"]{cursor:default}',
      '.fc-item-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto}',
      '.fc-item-count{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-tertiary)}',
      '.fc-item-icon{flex:0 0 auto;display:flex;color:var(--dsw-alias-label-secondary)}',
      '.fc-inline{font-size:10.5px;line-height:1.45;overflow-wrap:anywhere}',
      '.fc-inline[data-kind="ok"]{color:var(--dsw-alias-state-success-primary)}',
      '.fc-inline[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.fc-inline[data-kind="hint"]{color:var(--dsw-alias-label-tertiary)}',
      '.fc-lock{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:var(--dsw-alias-state-warn-label);min-width:0}',
      '.fc-manual{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;background:var(--dsw-alias-fill-l1);border-radius:5px;padding:3px 6px;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}',
      '.fc-chat-head-tabs{display:flex;align-items:center;gap:2px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:7px;padding:1px;background:var(--dsw-alias-bg-base);flex:0 0 auto}',
      '.fc-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-family:inherit;padding:3px 9px;border-radius:5px;cursor:pointer;white-space:nowrap}',
      '.fc-tab[data-active="true"]{background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary)}',
      '.fc-conv-select{display:none;height:26px;max-width:46%;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;padding:0 6px;outline:none}',
      '.fc-log{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:6px}',
      '.fc-empty{margin:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center;max-width:34ch;line-height:1.6}',
      '.fc-warnbox{margin:auto;display:flex;flex-direction:column;align-items:center;gap:8px;max-width:40ch;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6}',
      '.fc-msg{display:flex;gap:8px;align-items:baseline;min-width:0}',
      '.fc-msg[data-role="user"]{justify-content:flex-end}',
      '.fc-role{flex:0 0 auto;color:var(--dsw-alias-label-tertiary);font-size:10px;text-transform:uppercase;letter-spacing:.05em}',
      '.fc-bubble{max-width:74%;border-radius:9px;padding:5px 10px;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l3);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;line-height:1.55}',
      '.fc-msg[data-role="user"] .fc-bubble{background:var(--dsw-alias-fill-l1)}',
      '.fc-composer{flex:0 0 auto;display:flex;gap:8px;padding:10px 14px 12px;border-top:0.5px solid var(--dsw-alias-border-l3)}',
      '.fc-input{flex:1 1 auto;min-width:0;height:32px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 10px;font-size:12.5px;font-family:inherit;outline:none}',
      '.fc-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.fc-input[disabled]{opacity:.6}',
      '.fc-msglist{display:flex;flex-direction:column;gap:6px;min-height:0}',
      '.fc-island{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}',
      '.fc-frame{flex:1 1 auto;min-height:0;width:100%;border:0;display:block;background:var(--dsw-alias-bg-base)}',
      '.fc-consolerow{display:flex;align-items:baseline;gap:8px;font-size:11.5px;min-width:0;text-align:left}',
      '.fc-consolerow .fc-label{color:var(--dsw-alias-label-tertiary);flex:0 0 auto;min-width:60px}',
      '.fc-consolerow .fc-value{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;min-width:0}',
      '.fc-linkbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 16px;border-radius:8px;border:0.5px solid transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-size:12.5px;font-weight:600;text-decoration:none;font-family:inherit}',
      '.fc-linkbtn:hover{background:var(--dsw-alias-button-primary-hover)}',
      '.fc-linkbtn[data-size="sm"]{height:26px;padding:0 10px;font-size:11.5px;border-radius:6px}',
      '.fc-profile-body{flex:1 1 auto;min-height:0;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.fc-profile-top{display:flex;align-items:center;gap:10px;min-width:0}',
      '.fc-profile-name{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fc-profile-owner{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.fc-rows{display:flex;flex-direction:column;gap:6px}',
      '.fc-row{display:flex;align-items:baseline;gap:8px;min-width:0;font-size:12px}',
      '.fc-label{color:var(--dsw-alias-label-tertiary);flex:0 0 auto;min-width:62px}',
      '.fc-value{color:var(--dsw-alias-label-primary);min-width:0;overflow-wrap:anywhere}',
      '.fc-divider{height:0.5px;background:var(--dsw-alias-border-l3);margin:1px 0}',
      '.fc-slots{display:flex;flex-direction:column;gap:6px}',
      '.fc-slot{display:flex;align-items:center;gap:7px;min-height:38px;border-radius:8px;border:0.5px dashed var(--dsw-alias-border-l2);padding:5px 8px;background:var(--dsw-alias-bg-base);font-size:11.5px;min-width:0;box-sizing:border-box;text-align:left;font-family:inherit;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.fc-slot[data-filled="true"]{border-style:solid}',
      '.fc-slot[data-can-give="true"]:hover{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-fill-l1)}',
      '.fc-slot[data-dropping="true"]{border-color:var(--dsw-alias-brand-primary);border-style:solid;background:var(--dsw-alias-fill-l1);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent)}',
      '.fc-slot[data-locked="true"]{cursor:not-allowed;opacity:.72}',
      '.fc-slot[data-feedback="ok"]{border-color:var(--dsw-alias-state-success-primary);border-style:solid}',
      '.fc-slot[data-feedback="error"]{border-color:var(--dsw-alias-state-error-primary);border-style:solid}',
      '.fc-slot-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto}',
      '.fc-slot-empty{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:1 1 auto}',
      '.fc-slot-hint{font-size:9.5px;color:var(--dsw-alias-label-tertiary);flex:0 0 auto}',
      '.fc-slot .fc-tip-host{flex:1 1 auto;min-width:0}',
      '.fc-tip-host{position:relative;display:inline-flex;min-width:0}',
      '.fc-tip{position:fixed;z-index:60;min-width:170px;max-width:250px;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-tooltip-bg);color:var(--dsw-alias-tooltip-label);font-size:11px;line-height:1.5;box-shadow:0 6px 20px rgba(0,0,0,.24);pointer-events:none;transform:translateY(-100%)}',
      '.fc-tip-title{font-weight:600;margin-bottom:2px}',
      '.fc-tip-lock{color:var(--dsw-alias-state-warn-label);margin-top:3px}',
      '.fc-collapse{display:none;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:1px 7px;font-size:11px;cursor:pointer;font-family:inherit}',
      '.fc-footerbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;min-height:20px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);padding:0 2px;min-width:0;overflow:hidden}',
      '.fc-model-body{flex:1 1 auto;min-height:0;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:9px}',
      '.fc-reco{border:0.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-fill-l1);border-radius:9px;padding:8px 9px;display:flex;flex-direction:column;gap:5px}',
      '.fc-reco-title{font-size:11.5px;font-weight:600;line-height:1.45;color:var(--dsw-alias-label-primary)}',
      '.fc-reco-note{font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.fc-reco-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.fc-reco-local{font-size:10px;color:var(--dsw-alias-state-success-primary)}',
      '.fc-model-current{display:flex;align-items:center;gap:10px;min-width:0}',
      '.fc-model-thumb{width:64px;height:64px;border-radius:10px;object-fit:cover;border:0.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-fill-l1);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);overflow:hidden;flex:0 0 auto}',
      '.fc-model-thumb-img{width:100%;height:100%;object-fit:cover;display:block}',
      '.fc-model-current-meta{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.fc-model-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.fc-model-file{font-size:10.5px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}',
      '.fc-model-meta{font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.fc-hidden-file{display:none}',
      '.fc-console{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
      '.fc-console-card{border:0.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base);padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.fc-console-head{display:flex;align-items:center;gap:8px;min-width:0}',
      '.fc-console-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.fc-console-row{display:flex;align-items:baseline;gap:8px;font-size:11.5px;min-width:0}',
      '.fc-console-row .fc-label{min-width:72px}',
      '.fc-form-row{display:flex;align-items:center;gap:8px;min-width:0}',
      '.fc-form-label{flex:0 0 auto;min-width:56px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
      '.fc-form-input{flex:1 1 auto;min-width:0;height:28px;border-radius:7px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:0 8px;font-size:12px;font-family:inherit;outline:none}',
      '.fc-form-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.fc-form-input[disabled]{opacity:.55}',
      '.fc-range{flex:1 1 auto;min-width:0;accent-color:var(--dsw-alias-brand-primary)}',
      '.fc-range-value{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:32px;text-align:right}',
      '.fc-actions-grid{display:flex;flex-wrap:wrap;gap:6px}',
      '.fc-action-btn{border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);border-radius:999px;padding:3px 11px;font-size:11.5px;cursor:pointer;font-family:inherit}',
      '.fc-action-btn:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover)}',
      '.fc-action-btn[data-active="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.fc-action-btn[disabled]{opacity:.45;cursor:default}',
      '.fc-progress{height:8px;border-radius:999px;background:var(--dsw-alias-fill-l1);overflow:hidden;border:0.5px solid var(--dsw-alias-border-l3)}',
      '.fc-progress-bar{height:100%;background:var(--dsw-alias-state-success-primary);border-radius:999px;transition:width .25s}',
      '.fc-console-hint{font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.fc-island-links{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:0.5px solid var(--dsw-alias-border-l3);font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:0;overflow:hidden}',
      '.fc-island-link{color:var(--dsw-alias-link);text-decoration:none;font-size:11px;white-space:nowrap}',
      '.fc-island-link:hover{text-decoration:underline}',
      '.fc-demo-row{display:flex;flex-direction:column;gap:4px;padding-top:2px}',
      '.fc-demo-row + .fc-demo-row{border-top:0.5px solid var(--dsw-alias-border-l3);padding-top:8px;margin-top:2px}',
      '.fc-btn[data-variant="danger"]{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}',
      '.fc-btn[data-variant="danger"]:hover:not([disabled]){filter:brightness(1.06)}',
      '.fc-btn[data-variant="danger-outline"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:transparent}',
      '.fc-btn[data-variant="danger-outline"]:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover-danger)}',
      '.fc-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px;border-radius:8px;border:0.5px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-base)}',
      '.fc-confirm-text{font-size:11.5px;font-weight:600;color:var(--dsw-alias-state-error-primary);min-width:0}',
      '@media (max-width:1100px){.fc-body{grid-template-columns:230px minmax(0,1fr);grid-template-areas:"list chat" "list profile";grid-template-rows:minmax(0,1fr) auto}.fc-rightcol{max-height:340px}.fc-collapse{display:inline-flex}.fc-profile-body[data-collapsed="true"]{display:none}}',
      '@media (max-width:800px){.fc-body{grid-template-columns:minmax(0,1fr);grid-template-areas:"chat" "profile";grid-template-rows:minmax(0,1fr) auto}.fc-list{display:none}.fc-conv-select{display:inline-block}}',
    ].join('')

    function statusLabel(t, status) {
      if (status === 'running') return t('status.running')
      if (status === 'starting') return t('status.starting')
      return t('status.stopped')
    }

    function stateLabel(t, state) {
      if (typeof state !== 'string' || !state) return '–'
      const key = `state.${state}`
      const text = t(key)
      return text === key ? state : text
    }

    function timeLabel(atMs) {
      if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return ''
      const date = new Date(atMs)
      if (Number.isNaN(date.getTime())) return ''
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }

    async function callApi(path, init) {
      let response
      try {
        response = await fetch(`${API_BASE}${path}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          ...init,
        })
      } catch (error) {
        throw new Error(`${error?.message ?? String(error)}`)
      }
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload?.ok === false) {
        const error = new Error(payload?.error?.message ?? `HTTP ${response.status}`)
        error.code = payload?.error?.code ?? `http_${response.status}`
        error.status = response.status
        throw error
      }
      return payload
    }

    function BrandMark({ size = 20 }) {
      return h('svg', {
        viewBox: '0 0 32 32',
        width: size,
        height: size,
        'aria-hidden': true,
        style: { display: 'block' },
      },
      h('rect', { x: 1, y: 1, width: 30, height: 30, rx: 7, fill: '#123a5c' }),
      h('path', { d: 'M6 21h4v4H6zm0-6h4v4H6zm6 6h4v4h-4zm6 0h4v4h-4zm6-6h4v4h-4z', fill: '#5fd0e6' }),
      h('path', { d: 'M9.5 12.5c3-3 7.5-3.4 11-1.2l3.4-2v7.4l-3.4-2c-3.5 2.2-8 1.8-11-1.2z', fill: '#f7b955' }),
      h('circle', { cx: 17.4, cy: 14.1, r: 1.05, fill: '#123a5c' }))
    }

    /** Sidebar row glyph: inherits the row's color so active/hover states stay native. */
    function FangcunGlyph({ size = 18, active = false }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block' },
      },
      h('rect', { x: 2.6, y: 3.2, width: 3.6, height: 3.6, rx: 0.7, fill: 'currentColor', opacity: active ? 0.95 : 0.8 }),
      h('rect', { x: 7.4, y: 3.2, width: 3.6, height: 3.6, rx: 0.7, fill: 'currentColor', opacity: active ? 0.7 : 0.5 }),
      h('rect', { x: 2.6, y: 8, width: 3.6, height: 3.6, rx: 0.7, fill: 'currentColor', opacity: active ? 0.7 : 0.5 }),
      h('path', {
        d: 'M10 13.4c2.1-3 5.9-4.2 9.3-2.6l2.2 2-2.2 2c-3.4 1.6-7.2 0.4-9.3-2.6z',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinejoin: 'round',
        fill: active ? 'currentColor' : 'none',
        fillOpacity: active ? 0.2 : 0,
      }),
      h('path', { d: 'M10 13.4 6.6 10.2v6.4L10 13.4z', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }),
      h('circle', { cx: 18.6, cy: 11.9, r: 0.95, fill: 'currentColor' }))
    }

    /** Item sprites; `icon` is the sprite name the Host catalog sends. */
    function ItemIcon({ icon, size = 16 }) {
      if (icon === 'basin') {
        return h('svg', {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('ellipse', { cx: 12, cy: 8.6, rx: 8, ry: 2.5, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', {
          d: 'M4.3 9.1 6 16.8a2.7 2.7 0 0 0 2.6 2.1h6.8a2.7 2.7 0 0 0 2.6-2.1l1.7-7.7',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M8.3 11.8c1.2.7 2.4 1 3.7 1s2.5-.3 3.7-1', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: 0.6 }))
      }
      if (icon === 'cup') {
        return h('svg', {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', { d: 'M5 8h11v7.5A3.5 3.5 0 0 1 12.5 19h-4A3.5 3.5 0 0 1 5 15.5z', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
        h('path', { d: 'M16 10.2h1.6a2.4 2.4 0 0 1 0 4.8H16', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M2.8 8h15.4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M8 5.6c.5-.8 1.2-1.2 2-1.2s1.5.4 2 1.2', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round', opacity: 0.55 }))
      }
      if (icon === 'bell') {
        return h('svg', {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M12 4.2c-3.3 0-5.4 2.4-5.4 5.6 0 3.4-.9 4.6-1.9 5.7h14.6c-1-1.1-1.9-2.3-1.9-5.7 0-3.2-2.1-5.6-5.4-5.6z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M10.1 18.6a2 2 0 0 0 3.8 0', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M12 4.2V2.8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
      }
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block' },
      },
      h('rect', { x: 4, y: 6, width: 16, height: 13, rx: 3, stroke: 'currentColor', strokeWidth: 1.5 }),
      h('path', { d: 'M4 10.5h16', stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.6 }),
      h('circle', { cx: 9, cy: 7.6, r: 0.9, fill: 'currentColor', opacity: 0.7 }))
    }

    /** Avatar: the companion's Host image when present, else the fish glyph. */
    function Avatar({ companion, size = 26, override = null }) {
      const source = override
        ?? (typeof companion?.avatarImage === 'string' && companion.avatarImage ? companion.avatarImage : null)
      return h('span', {
        className: 'fc-avatar',
        'data-mine': companion?.isMine ? 'true' : 'false',
        style: { width: `${size}px`, height: `${size}px` },
        'aria-hidden': true,
      }, source
        ? h('img', { className: 'fc-avatar-img', src: source, alt: '', draggable: false })
        : h(FangcunGlyph, { size: Math.round(size * 0.66), active: companion?.isMine === true }))
    }

    /** Fixed-position tooltip so scroll containers cannot clip the preview. */
    function Tip({ title, description, lock, children }) {
      const [pos, setPos] = useState(null)
      const onEnter = useCallback((event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 262)), top: rect.top - 8 })
      }, [])
      const onLeave = useCallback(() => setPos(null), [])
      return h('span', { className: 'fc-tip-host', onMouseEnter: onEnter, onMouseLeave: onLeave },
        children,
        pos === null ? null : h('span', {
          className: 'fc-tip',
          style: { left: `${pos.left}px`, top: `${pos.top}px` },
          role: 'tooltip',
        },
        h('span', { className: 'fc-tip-title' }, title ?? ''),
        description ? h('div', null, description) : null,
        lock ? h('div', { className: 'fc-tip-lock' }, lock) : null))
    }

    function decodeTick(t, result) {
      const status = typeof result?.status === 'string' ? result.status : ''
      if (status === 'committed') return t('tick.committed')
      if (status === 'paused') return t('tick.paused')
      if (status === 'home_approval_required') return t('tick.approval')
      return t('tick.other')
    }

    const fallbackPanelInfo = (selector) => selector({ activePanelId: PANEL_ID })

    function FangcunPanel({ t, usePanelInfo }) {
      // Hook order (also documented for the structural test): social, host,
      // selectedId, draft, busy, error, notice, unread, warehouseSelected,
      // slotFeedback, tab, island, islandFailed, islandFrameLoaded, profileOpen,
      // copied, dragItemId, dropSlot, model, petDraft, petBusy, petFeedback,
      // demo, copiedIsland, resetState, houseFeedback, demoNotice,
      // dismissedProposalId.
      const [social, setSocial] = useState(null)
      const [host, setHost] = useState(null)
      const [selectedId, setSelectedId] = useState(null)
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(null)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [unread, setUnread] = useState({})
      const [warehouseSelected, setWarehouseSelected] = useState(null)
      const [slotFeedback, setSlotFeedback] = useState(null)
      const [tab, setTab] = useState('chat')
      const [island, setIsland] = useState(null)
      const [islandFailed, setIslandFailed] = useState(false)
      const [islandFrameLoaded, setIslandFrameLoaded] = useState(false)
      const [profileOpen, setProfileOpen] = useState(true)
      const [copied, setCopied] = useState(false)
      const [dragItemId, setDragItemId] = useState(null)
      const [dropSlot, setDropSlot] = useState(null)
      const [model, setModel] = useState({
        file: null,
        previewUrl: null,
        meta: null,
        busy: null,
        error: null,
        notice: null,
        install: null,
        avatarPreview: null,
      })
      const [petDraft, setPetDraft] = useState({ companionId: null, name: '', personality: '', scale: 1, dirty: false })
      const [petBusy, setPetBusy] = useState(null)
      const [petFeedback, setPetFeedback] = useState(null)
      const [demo, setDemo] = useState(null)
      const [copiedIsland, setCopiedIsland] = useState(false)
      const [resetState, setResetState] = useState(null)
      const [houseFeedback, setHouseFeedback] = useState(null)
      const [demoNotice, setDemoNotice] = useState(null)
      const [dismissedProposalId, setDismissedProposalId] = useState(null)

      const mountedRef = useRef(true)
      const selectedRef = useRef(null)
      const seenRef = useRef(new Map())
      const frameTimerRef = useRef(null)
      const fileInputRef = useRef(null)
      const modelFileRef = useRef(null)
      const previewBlobRef = useRef(null)
      const previewUrlRef = useRef(null)
      const dragRef = useRef(null)
      const resetTimerRef = useRef(null)

      const useActivePanelId = typeof usePanelInfo === 'function' ? usePanelInfo : fallbackPanelInfo
      const activePanelId = useActivePanelId((info) => info.activePanelId)
      const isActivePanel = activePanelId === undefined || activePanelId === null || activePanelId === PANEL_ID

      const patchModel = useCallback((patch) => setModel((current) => ({ ...current, ...patch })), [])

      const applySocial = useCallback((payload, { full }) => {
        setSocial(payload)
        if (payload.host) setHost(payload.host)

        const companions = Array.isArray(payload.companions) ? payload.companions : []
        const current = selectedRef.current
        if (!current || !companions.some((c) => c.companionId === current)) {
          const next = payload.selectedCompanionId ?? companions[0]?.companionId ?? null
          selectedRef.current = next
          setSelectedId(next)
        }

        // Unread: a newer last message on a non-selected companion. The first
        // payload only seeds the baseline, so opening the panel is not noisy.
        const nextUnread = {}
        const seen = seenRef.current
        for (const companion of companions) {
          const atMs = companion.lastMessage?.atMs
          const key = companion.companionId
          const previous = seen.get(key)
          if (typeof atMs === 'number' && (previous === undefined || atMs > previous)) {
            if (previous !== undefined && key !== selectedRef.current) nextUnread[key] = true
            seen.set(key, atMs)
          }
        }
        if (selectedRef.current) delete nextUnread[selectedRef.current]
        setUnread((existing) => ({ ...existing, ...nextUnread }))
        // A dismissed (cancelled) proposal stays hidden until the Host confirms it
        // is gone; a different proposal id is a new ask and shows again.
        const proposalId = payload.live?.houseProposal?.proposalId ?? null
        setDismissedProposalId((current) => (current !== null && current !== proposalId ? null : current))
        if (full) setError(null)
      }, [])

      const loadSocial = useCallback(async (full = false) => {
        const selected = selectedRef.current
        const query = new URLSearchParams()
        if (selected) query.set('companionId', selected)
        if (full) query.set('force', '1')
        const suffix = query.toString() ? `?${query.toString()}` : ''
        try {
          const payload = await callApi(`/social${suffix}`, { method: 'GET' })
          if (!mountedRef.current) return
          applySocial(payload, { full })
        } catch (failure) {
          if (!mountedRef.current) return
          if (failure?.code === 'http_401' || failure?.code === 'http_404') {
            setError(t('error.route'))
          }
          // A stopped Host is a normal state for this panel (start button).
        }
      }, [applySocial, t])

      useEffect(() => {
        if (!isActivePanel) return undefined
        loadSocial(true)
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          loadSocial(false)
        }, POLL_MS)
        return () => clearInterval(timer)
      }, [isActivePanel, loadSocial])

      useEffect(() => {
        mountedRef.current = true
        return () => {
          mountedRef.current = false
          if (frameTimerRef.current) clearTimeout(frameTimerRef.current)
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
          previewUrlRef.current = null
          previewBlobRef.current = null
          modelFileRef.current = null
        }
      }, [])

      const companions = Array.isArray(social?.companions) ? social.companions : []
      const inventory = Array.isArray(social?.inventory) ? social.inventory : []
      const selected = useMemo(
        () => companions.find((companion) => companion.companionId === selectedId) ?? companions[0] ?? null,
        [companions, selectedId],
      )
      const transcript = social?.transcript ?? null
      const messages = Array.isArray(transcript?.messages) ? transcript.messages : []
      const status = host?.status ?? social?.host?.status ?? 'stopped'
      const notRunning = status !== 'running'
      const selectedIsMine = selected?.isMine === true
      const actions = Array.isArray(social?.pet?.actions) ? social.pet.actions : []
      const actionName = useMemo(() => {
        const id = selected?.activeAction
        if (!id) return null
        const row = actions.find((action) => action.id === id)
        return row?.displayName ?? id
      }, [actions, selected])
      const canChat = status === 'running' && busy === null && transcript?.available === true && selected !== null
      const canGive = selectedIsMine && busy === null

      // ---------------------------------------------------- console + pet form
      const pet = social?.pet ?? null
      const primaryCompanionId = social?.primaryCompanionId ?? pet?.companionId ?? null
      const isPrimary = selected !== null && primaryCompanionId !== null && selected.companionId === primaryCompanionId
      const live = social?.live ?? null
      const build = live?.build ?? null
      const houseProposalRaw = live?.houseProposal ?? null
      // A proposal cancelled by the lazy-house demo is hidden until the Host
      // confirms it disappeared (the poll would otherwise re-show it briefly).
      const houseProposal = houseProposalRaw && houseProposalRaw.proposalId !== dismissedProposalId
        ? houseProposalRaw
        : null
      const activeActionId = isPrimary
        ? (pet?.activeAction ?? selected?.activeAction ?? null)
        : (selected?.activeAction ?? null)

      // Keep the form in sync with the Host until the user edits a field; a
      // failed save drops `dirty` so this effect reverts to the Host values.
      useEffect(() => {
        if (!selected) return
        setPetDraft((current) => {
          if (current.companionId === selected.companionId && current.dirty) return current
          const sameCompanion = current.companionId === selected.companionId
          return {
            companionId: selected.companionId,
            name: selected.name ?? '',
            personality: selected.personality ?? '',
            scale: isPrimary && typeof pet?.scale === 'number'
              ? pet.scale
              : (sameCompanion && typeof current.scale === 'number' ? current.scale : 1),
            dirty: false,
          }
        })
      }, [selected, isPrimary, pet?.scale])

      const setDraftField = useCallback((field, value) => {
        setPetDraft((current) => ({ ...current, [field]: value, dirty: true }))
      }, [])

      const petLookup = useCallback((id) => {
        const row = actions.find((action) => action.id === id)
        return row?.displayName ?? id
      }, [actions])

      const onSavePet = useCallback(async () => {
        if (!selected || !selected.isMine || petBusy !== null) return
        const name = String(petDraft.name ?? '').trim()
        const personality = String(petDraft.personality ?? '').trim()
        if (name.length < 1 || name.length > 24) { setPetFeedback({ kind: 'error', text: t('pet.err.name') }); return }
        if (personality.length < 1 || personality.length > 60) { setPetFeedback({ kind: 'error', text: t('pet.err.personality') }); return }
        let scale
        if (isPrimary) {
          scale = Number(petDraft.scale)
          if (!Number.isFinite(scale) || scale < 0.5 || scale > 3) { setPetFeedback({ kind: 'error', text: t('pet.err.scale') }); return }
        }
        setPetBusy('save')
        setPetFeedback(null)
        try {
          await callApi('/pet', {
            method: 'POST',
            body: JSON.stringify({
              companionId: selected.companionId,
              name,
              personality,
              ...(isPrimary ? { scale } : {}),
            }),
          })
          if (!mountedRef.current) return
          setPetDraft((current) => ({ ...current, dirty: false }))
          setPetFeedback({ kind: 'ok', text: t('pet.saved') })
          await loadSocial(true)
        } catch (failure) {
          if (!mountedRef.current) return
          const code = failure?.code ?? 'unknown'
          const mapped = {
            invalid_pet_name: t('pet.err.name'),
            invalid_companion_name: t('pet.err.name'),
            invalid_pet_personality: t('pet.err.personality'),
            invalid_companion_personality: t('pet.err.personality'),
            invalid_pet_scale: t('pet.err.scale'),
            invalid_pet_action: t('pet.err.action'),
            unknown_pet_action: t('pet.err.action'),
            not_owner: t('pet.err.notOwner'),
          }[code]
          setPetFeedback({ kind: 'error', text: mapped ?? t('pet.err.generic', { code }) })
          // Revert the fields to the Host's values (also re-synced by the effect).
          setPetDraft({
            companionId: selected.companionId,
            name: selected.name ?? '',
            personality: selected.personality ?? '',
            scale: isPrimary && typeof pet?.scale === 'number' ? pet.scale : 1,
            dirty: false,
          })
          await loadSocial(true)
        } finally {
          if (mountedRef.current) setPetBusy(null)
        }
      }, [isPrimary, loadSocial, pet?.scale, petBusy, petDraft, selected, t])

      const onAction = useCallback(async (actionId) => {
        if (!selected || !selected.isMine || petBusy !== null || busy !== null) return
        if (!isPrimary) {
          setPetFeedback({ kind: 'error', text: t('pet.notPrimary') })
          return
        }
        setPetBusy('action')
        setPetFeedback(null)
        try {
          await callApi('/pet', {
            method: 'POST',
            body: JSON.stringify({ companionId: selected.companionId, action: actionId }),
          })
          if (!mountedRef.current) return
          setPetFeedback({ kind: 'ok', text: t('pet.actionDone', { action: petLookup(actionId) }) })
          await loadSocial(true)
        } catch (failure) {
          if (!mountedRef.current) return
          const code = failure?.code ?? 'unknown'
          const mapped = code === 'not_owner'
            ? t('pet.err.notOwner')
            : (code === 'unknown_pet_action' || code === 'invalid_pet_action' ? t('pet.err.action') : null)
          setPetFeedback({ kind: 'error', text: mapped ?? t('pet.err.generic', { code }) })
        } finally {
          if (mountedRef.current) setPetBusy(null)
        }
      }, [busy, isPrimary, loadSocial, petBusy, petLookup, selected, t])

      const demoRefusalText = useCallback((failure) => {
        const code = failure?.code ?? 'unknown'
        if (code === 'demo_unavailable') return t('demo.unavailable')
        if (code === 'build_in_progress') return t('demo.err.buildInProgress')
        if (code === 'grant_missing') return t('demo.err.grantMissing')
        if (typeof failure?.status === 'number' && failure.status >= 400 && failure.status < 500) {
          return t('demo.refused', { reason: failure?.message ?? code })
        }
        return t('demo.err.generic', { code })
      }, [t])

      const onDemo = useCallback(async (flow) => {
        if (!selectedIsMine || busy !== null || petBusy !== null) return
        if (build?.inProgress === true) {
          setDemo({ flow, state: 'disabled', atMs: Date.now() })
          return
        }
        setDemo({ flow, state: 'starting', atMs: Date.now() })
        try {
          const payload = await callApi(`/demo/${flow}`, { method: 'POST', body: '{}' })
          if (!mountedRef.current) return
          // The lazy demo cancels any pending proposal on the Host: hide the
          // approval card at once and confirm it in a short inline note.
          if (flow === 'lazy-house' && payload.cancelledProposal === true) {
            const cancelledId = houseProposalRaw?.proposalId ?? null
            setDismissedProposalId(cancelledId ?? 'cancelled')
            setHouseFeedback(null)
            setDemoNotice(t('demo.cancelledProposal', { name: selected?.name ?? t('companion') }))
          }
          if (flow !== 'lazy-house') setDemoNotice(null)
          setDemo({
            flow,
            state: typeof payload.state === 'string'
              ? payload.state
              : (flow === 'real-house' && payload.proposalId ? 'awaiting' : 'started'),
            jobId: payload.jobId ?? null,
            message: payload.message ?? null,
            atMs: Date.now(),
          })
          await loadSocial(true)
        } catch (failure) {
          if (!mountedRef.current) return
          setDemo({
            flow,
            state: failure?.code === 'demo_unavailable' ? 'unavailable' : 'refused',
            message: demoRefusalText(failure),
            atMs: Date.now(),
          })
        }
      }, [build?.inProgress, busy, demoRefusalText, houseProposalRaw?.proposalId, loadSocial, petBusy, selected?.name, selectedIsMine, t])

      /** Per-flow view: the active flow follows the live build summary. */
      const demoViewFor = useCallback((flow) => {
        if (!demo || demo.flow !== flow) return { state: 'idle' }
        if (demo.state === 'unavailable') return { state: 'unavailable', message: demo.message }
        if (demo.state === 'refused') return { state: 'refused', message: demo.message }
        if (demo.state === 'disabled') return { state: 'disabled' }
        if (build?.inProgress === true) {
          return { state: 'running', completed: build.completedBlocks, total: build.totalBlocks }
        }
        if (demo.state === 'starting') return { state: 'starting' }
        if (demo.state === 'awaiting') return { state: 'awaiting' }
        if (build && build.totalBlocks > 0 && build.completedBlocks >= build.totalBlocks) {
          return { state: 'done', completed: build.completedBlocks, total: build.totalBlocks }
        }
        if (build && build.completedBlocks > 0) {
          return { state: 'running', completed: build.completedBlocks, total: build.totalBlocks }
        }
        if (houseProposal) return { state: 'awaiting' }
        if (demo.state === 'done') return { state: 'done' }
        return { state: 'started', message: demo.message }
      }, [build, demo, houseProposal])

      const demoStatusText = useCallback((view) => {
        if (view.state === 'idle') return t('demo.idle')
        if (view.state === 'starting') return t('demo.starting')
        if (view.state === 'running') {
          return t('demo.running') + (view.total > 0 ? ` ${t('console.building', { done: view.completed, total: view.total })}` : '')
        }
        if (view.state === 'awaiting') return t('demo.awaiting')
        if (view.state === 'done') return t('demo.done')
        if (view.state === 'refused') return view.message ?? t('demo.refused', { reason: '' })
        if (view.state === 'unavailable') return t('demo.unavailable')
        if (view.state === 'disabled') return t('demo.disabled')
        return t('demo.started')
      }, [t])

      const onResetWorld = useCallback(async () => {
        if (busy !== null || petBusy !== null) return
        if (build?.inProgress === true) {
          setResetState({ stage: 'refused', message: t('demo.err.buildInProgress') })
          return
        }
        if (!resetState || resetState.stage !== 'confirm') {
          // First click never triggers the reset; it only asks for confirmation.
          setResetState({ stage: 'confirm' })
          return
        }
        setResetState({ stage: 'running' })
        try {
          const payload = await callApi('/demo/reset-world', { method: 'POST', body: '{}' })
          if (!mountedRef.current) return
          setResetState({
            stage: 'done',
            rev: typeof payload.rev === 'number' ? payload.rev : null,
            blockCount: typeof payload.blockCount === 'number' ? payload.blockCount : null,
          })
          setDemo(null)
          await loadSocial(true)
        } catch (failure) {
          if (!mountedRef.current) return
          if (failure?.code === 'demo_unavailable') {
            setResetState({ stage: 'unavailable', message: t('demo.reset.unavailable') })
          } else if (failure?.code === 'build_in_progress') {
            setResetState({ stage: 'refused', message: t('demo.err.buildInProgress') })
          } else {
            setResetState({
              stage: 'refused',
              message: t('demo.reset.refused', { reason: failure?.message ?? failure?.code ?? 'refused' }),
            })
          }
          await loadSocial(true)
        }
      }, [build?.inProgress, busy, loadSocial, petBusy, resetState, t])

      const onCancelReset = useCallback(() => {
        setResetState(null)
      }, [])

      /** Approve or reject the pending house proposal from the PC panel. */
      const onDecideHouse = useCallback(async (approve) => {
        const proposalId = houseProposal?.proposalId
        if (!proposalId || petBusy !== null || busy !== null) return
        if (build?.inProgress === true) {
          setHouseFeedback({ kind: 'error', text: t('demo.err.buildInProgress') })
          return
        }
        setPetBusy('decide')
        setHouseFeedback(null)
        try {
          await callApi('/house/decide', {
            method: 'POST',
            body: JSON.stringify({ proposalId, approve }),
          })
          if (!mountedRef.current) return
          setHouseFeedback({ kind: 'ok', text: approve ? t('house.approved') : t('house.rejected') })
          if (!approve) setDemo(null)
          await loadSocial(true)
        } catch (failure) {
          if (!mountedRef.current) return
          const code = failure?.code
          if (code === 'proposal_not_found' || code === 'proposal_expired') {
            setHouseFeedback({ kind: 'hint', text: t('house.alreadyHandled') })
            if (!approve) setDemo(null)
            await loadSocial(true)
          } else if (code === 'house_unavailable') {
            setHouseFeedback({ kind: 'error', text: t('house.unavailable') })
          } else if (code === 'grant_missing') {
            setHouseFeedback({ kind: 'error', text: t('demo.err.grantMissing') })
          } else {
            setHouseFeedback({ kind: 'error', text: t('house.failed', { code: code ?? 'unknown' }) })
          }
        } finally {
          if (mountedRef.current) setPetBusy(null)
        }
      }, [build?.inProgress, busy, houseProposal?.proposalId, loadSocial, petBusy, t])

      // The two-step confirmation reverts on its own after ~5 s.
      useEffect(() => {
        if (resetTimerRef.current) {
          clearTimeout(resetTimerRef.current)
          resetTimerRef.current = null
        }
        if (resetState?.stage !== 'confirm') return undefined
        resetTimerRef.current = setTimeout(() => {
          resetTimerRef.current = null
          if (mountedRef.current) setResetState((current) => (current?.stage === 'confirm' ? null : current))
        }, 5000)
        return () => {
          if (resetTimerRef.current) {
            clearTimeout(resetTimerRef.current)
            resetTimerRef.current = null
          }
        }
      }, [resetState?.stage])

      const onCopyIslandUrl = useCallback(async () => {
        try {
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText('http://127.0.0.1:4173/?mode=host')
            setCopiedIsland(true)
            setTimeout(() => { if (mountedRef.current) setCopiedIsland(false) }, 1500)
          }
        } catch { /* clipboard is best-effort */ }
      }, [])

      const run = useCallback(async (kind, task) => {
        setBusy(kind)
        setError(null)
        setNotice(null)
        try {
          return await task()
        } catch (failure) {
          if (!mountedRef.current) return { failed: failure }
          if (failure?.code === 'host_not_running') {
            await loadSocial(true)
            setError(`${t('state.notRunning')} — ${failure?.message ?? ''}`.trim())
          } else if (failure?.code === 'http_401' || failure?.code === 'http_404') {
            setError(`${t('error.route')}: ${failure?.message ?? String(failure)}`)
          } else {
            setError(`${t('error.generic')}: ${failure?.message ?? String(failure)}`)
          }
          return { failed: failure }
        } finally {
          if (mountedRef.current) setBusy(null)
        }
      }, [loadSocial, t])

      const onRefresh = useCallback(() => run('refresh', () => loadSocial(true)), [loadSocial, run])

      const onTick = useCallback(async () => {
        const payload = await run('tick', async () => {
          const response = await callApi('/tick', { method: 'POST', body: '{}' })
          await loadSocial(true)
          return response
        })
        if (payload && !payload.failed && mountedRef.current) setNotice(decodeTick(t, payload.result))
      }, [loadSocial, run, t])

      const onSend = useCallback(async (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        const text = draft.trim()
        if (!text || busy !== null || !selected) return
        setDraft('')
        const payload = await run('send', () => callApi('/chat', {
          method: 'POST',
          body: JSON.stringify({ companionId: selected.companionId, text }),
        }))
        if (payload && !payload.failed && mountedRef.current) {
          setSocial((current) => {
            if (!current) return current
            const nextMessages = Array.isArray(payload.messages) ? payload.messages : current.transcript?.messages ?? []
            return {
              ...current,
              transcript: { ...(current.transcript ?? {}), available: true, companionId: selected.companionId, messages: nextMessages },
            }
          })
          loadSocial(true)
        }
      }, [busy, draft, loadSocial, run, selected])

      const clearDragState = useCallback(() => {
        dragRef.current = null
        setDragItemId(null)
        setDropSlot(null)
      }, [])

      const selectCompanion = useCallback((companionId) => {
        if (!companionId || companionId === selectedRef.current) return
        selectedRef.current = companionId
        setSelectedId(companionId)
        setUnread((existing) => {
          if (!existing[companionId]) return existing
          const next = { ...existing }
          delete next[companionId]
          return next
        })
        setWarehouseSelected(null)
        setSlotFeedback(null)
        clearDragState()
        // A previewed avatar/model belongs to the previous companion.
        setModel((current) => ({ ...current, avatarPreview: null }))
        loadSocial(true)
      }, [clearDragState, loadSocial])

      const giveItem = useCallback(async (slotIndex, itemId) => {
        if (!selected || !selected.isMine || !itemId) return
        const item = inventory.find((row) => row.itemId === itemId)
        setSlotFeedback(null)
        const payload = await run('give', () => callApi('/give', {
          method: 'POST',
          body: JSON.stringify({ companionId: selected.companionId, itemId }),
        }))
        if (!payload || payload.failed) {
          const code = payload?.failed?.code ?? 'unknown'
          const mapped = {
            companion_inventory_full: t('give.err.full'),
            item_not_owned: t('give.err.notOwned'),
            item_already_held: t('give.err.alreadyHeld'),
            not_owner: t('give.err.notOwner'),
            unknown_item: t('give.err.unknownItem'),
            companion_not_found: t('give.err.companionMissing'),
            invalid_companion: t('give.err.companionMissing'),
            social_unavailable: t('give.err.unavailable'),
          }[code]
          setSlotFeedback({ index: slotIndex, kind: 'error', text: mapped ?? t('give.err.unknown', { code }) })
          return
        }
        setWarehouseSelected(null)
        setSlotFeedback({ index: slotIndex, kind: 'ok', text: t('give.ok', { item: item?.name ?? itemId, name: selected.name }) })
        await loadSocial(true)
      }, [inventory, loadSocial, run, selected, t])

      const onPickWarehouseItem = useCallback((item) => {
        if (!selected) {
          setSlotFeedback({ index: 0, kind: 'error', text: t('chat.none') })
          return
        }
        if (!selected.isMine) {
          setSlotFeedback({ index: 0, kind: 'error', text: t('warehouse.readonly') })
          setWarehouseSelected(null)
          return
        }
        setSlotFeedback(null)
        setWarehouseSelected((current) => (current === item.itemId ? null : item.itemId))
      }, [selected, t])

      const onWarehouseDragStart = useCallback((event, item) => {
        if (!selectedIsMine) {
          event.preventDefault()
          return
        }
        dragRef.current = item.itemId
        setDragItemId(item.itemId)
        setSlotFeedback(null)
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move'
          try { event.dataTransfer.setData('text/plain', item.itemId) } catch { /* some browsers restrict reads */ }
        }
      }, [selectedIsMine])

      const onSlotDragOver = useCallback((event, index) => {
        if (!canGive) return
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        setDropSlot(index)
      }, [canGive])

      const onSlotDragLeave = useCallback((index) => {
        setDropSlot((current) => (current === index ? null : current))
      }, [])

      const onSlotDrop = useCallback((event, index) => {
        event.preventDefault()
        if (!canGive) return
        let itemId = dragRef.current
        try {
          const transferred = event.dataTransfer?.getData('text/plain')
          if (transferred) itemId = transferred
        } catch { /* keep the ref value */ }
        clearDragState()
        if (itemId) giveItem(index, itemId)
      }, [canGive, clearDragState, giveItem])

      const onSlotClick = useCallback((index) => {
        if (!selected) return
        if (!selectedIsMine) {
          setSlotFeedback({ index, kind: 'error', text: t('profile.readonly') })
          return
        }
        if (!warehouseSelected) {
          setSlotFeedback({ index, kind: 'hint', text: t('warehouse.lockHint') })
          return
        }
        giveItem(index, warehouseSelected)
      }, [giveItem, selected, selectedIsMine, t, warehouseSelected])

      const onStart = useCallback(() => run('start', async () => {
        const response = await callApi('/start', { method: 'POST', body: '{}' })
        await loadSocial(true)
        return response
      }), [loadSocial, run])

      // Island console: Host-side framing preflight plus a browser-side load
      // timeout, so a blocked frame becomes a visible card, never a blank box.
      const loadIsland = useCallback(async () => {
        try {
          const payload = await callApi('/island', { method: 'GET' })
          if (!mountedRef.current) return
          setIsland(payload)
          setIslandFailed(payload.embeddable !== true)
        } catch (failure) {
          if (!mountedRef.current) return
          setIsland({ ok: false, url: 'http://127.0.0.1:4173/?mode=host', reachable: false, embeddable: false, reasons: [failure?.message ?? String(failure)] })
          setIslandFailed(true)
        }
      }, [])

      useEffect(() => {
        if (tab !== 'island') return undefined
        if (island === null) loadIsland()
        return undefined
      }, [tab, island, loadIsland])

      useEffect(() => {
        if (tab !== 'island' || islandFailed) return undefined
        if (frameTimerRef.current) clearTimeout(frameTimerRef.current)
        frameTimerRef.current = setTimeout(() => {
          if (!islandFrameLoaded) setIslandFailed(true)
        }, ISLAND_LOAD_TIMEOUT_MS)
        return () => {
          if (frameTimerRef.current) clearTimeout(frameTimerRef.current)
        }
      }, [tab, islandFailed, islandFrameLoaded])

      const onFrameLoad = useCallback(() => {
        setIslandFrameLoaded(true)
        if (frameTimerRef.current) clearTimeout(frameTimerRef.current)
      }, [])

      const onFrameError = useCallback(() => {
        setIslandFailed(true)
        if (frameTimerRef.current) clearTimeout(frameTimerRef.current)
      }, [])

      const onCopyPairing = useCallback(async () => {
        const code = host?.pairingCode
        if (!code) return
        try {
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => { if (mountedRef.current) setCopied(false) }, 1500)
          }
        } catch { /* clipboard is best-effort */ }
      }, [host])

      // -------------------------------------------------------- model import
      const onPickModel = useCallback(async (event) => {
        const file = event?.target?.files?.[0] ?? null
        if (event?.target) event.target.value = ''
        if (!file) return
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current)
          previewUrlRef.current = null
        }
        previewBlobRef.current = null
        modelFileRef.current = file
        patchModel({
          file: { name: file.name, size: file.size },
          previewUrl: null,
          meta: null,
          busy: null,
          error: null,
          notice: null,
          install: null,
        })
        if (file.size > MODEL_MAX_BYTES) {
          patchModel({ error: t('model.tooLarge') })
          modelFileRef.current = null
          return
        }
        patchModel({ busy: 'parse' })
        try {
          const buffer = await file.arrayBuffer()
          const preview = extractModelPreview(buffer)
          if (preview.thumbnail) {
            const blob = new Blob([preview.thumbnail], { type: preview.mime ?? 'image/png' })
            const url = URL.createObjectURL(blob)
            previewBlobRef.current = blob
            previewUrlRef.current = url
            patchModel({
              busy: null,
              previewUrl: url,
              meta: {
                name: preview.meta.name,
                author: preview.meta.author,
                version: preview.meta.version,
                specVersion: preview.meta.specVersion,
                hasThumbnail: true,
              },
              notice: t('model.parsed'),
            })
          } else {
            patchModel({
              busy: null,
              meta: {
                name: preview.meta.name,
                author: preview.meta.author,
                version: preview.meta.version,
                specVersion: preview.meta.specVersion,
                hasThumbnail: false,
              },
              notice: t('model.noThumb'),
            })
          }
        } catch (failure) {
          patchModel({
            busy: null,
            error: `${t('model.parseFailed')}: ${failure?.message ?? String(failure)}`,
          })
        }
      }, [patchModel, t])

      const onSetAvatar = useCallback(async () => {
        if (!selected?.isMine || !previewBlobRef.current) return
        patchModel({ busy: 'avatar', error: null, notice: null })
        try {
          const dataUrl = await prepareAvatarDataUrl(previewBlobRef.current)
          const payload = await callApi('/avatar', {
            method: 'POST',
            body: JSON.stringify({ companionId: selected.companionId, avatarImage: dataUrl }),
          })
          if (!mountedRef.current) return
          patchModel({ busy: null, avatarPreview: dataUrl, notice: t('model.avatarOk'), error: null })
          if (payload?.companion) await loadSocial(true)
        } catch (failure) {
          if (!mountedRef.current) return
          const code = failure?.code
          const mapped = code === 'avatar_unsupported'
            ? t('model.avatarUnsupported')
            : (code === 'avatar_too_large'
              ? t('model.avatarTooLarge')
              : (code === 'invalid_avatar' ? t('model.avatarInvalid') : null))
          patchModel({
            busy: null,
            error: mapped ?? `${t('error.generic')}: ${failure?.message ?? String(failure)}`,
          })
        }
      }, [loadSocial, patchModel, selected, t])

      const onInstallModel = useCallback(async () => {
        const file = modelFileRef.current
        if (!file || !selected?.isMine) return
        patchModel({ busy: 'install', error: null, notice: null, install: null })
        try {
          const payload = await callApi(`/model?companionId=${encodeURIComponent(selected.companionId)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: file,
          })
          if (!mountedRef.current) return
          patchModel({
            busy: null,
            install: { path: payload.path, command: payload.command, bytes: payload.bytes },
            notice: t('model.installOk'),
          })
        } catch (failure) {
          if (!mountedRef.current) return
          patchModel({ busy: null, error: `${t('model.installFailed')}: ${failure?.message ?? String(failure)}` })
        }
      }, [patchModel, selected, t])

      // ---------------------------------------------------------------- view
      const islandUrl = island?.url ?? 'http://127.0.0.1:4173/?mode=host'
      const showIslandFrame = island?.embeddable === true && !islandFailed
      const revisionText = typeof host?.revision === 'number' ? host.revision : '–'
      const blockText = typeof host?.blockCount === 'number' ? host.blockCount : '–'
      const modelCompanionImage = selected?.avatarImage ?? null
      const modelPreviewImage = model.previewUrl
        ?? (model.avatarPreview && selected ? model.avatarPreview : null)
        ?? modelCompanionImage

      const renderConversationRow = (companion) => {
        const last = companion.lastMessage
        const preview = last
          ? `${last.role === 'user' ? `${t('you')}: ` : ''}${last.text}`
          : (companion.personality ?? '')
        const hasUnread = unread[companion.companionId] === true && companion.companionId !== selectedId
        return h('button', {
          key: companion.companionId,
          type: 'button',
          className: 'fc-conv',
          'data-selected': companion.companionId === selectedId ? 'true' : 'false',
          onClick: () => selectCompanion(companion.companionId),
          title: companion.name,
        },
        h(Avatar, { companion, size: 28 }),
        h('span', { className: 'fc-conv-body' },
          h('span', { className: 'fc-conv-name' },
            h('span', null, companion.name),
            hasUnread ? h('span', { className: 'fc-unread', 'aria-label': t('list.unread') }) : null),
          h('span', { className: 'fc-conv-preview' }, preview || '—')),
        h('span', { className: 'fc-conv-tags' },
          companion.isMine ? null : h('span', { className: 'fc-tag' }, `${t('profile.owner')} ${companion.ownerUserId ?? '?'}`)),
        companion.isMine ? null : h('span', { className: 'fc-tag', title: t('profile.readonly') }, '🔒'))
      }

      const renderWarehouseItem = (item) => {
        const readOnly = !selectedIsMine
        const selectedItem = warehouseSelected === item.itemId
        return h(Tip, {
          key: item.itemId,
          title: item.name,
          description: item.description ?? t('item.descriptionMissing'),
          lock: readOnly ? t('profile.readonly') : null,
        },
        h('button', {
          type: 'button',
          className: 'fc-item',
          draggable: !readOnly,
          'data-selected': selectedItem ? 'true' : 'false',
          'data-dragging': dragItemId === item.itemId ? 'true' : 'false',
          'data-readonly': readOnly ? 'true' : 'false',
          onClick: () => onPickWarehouseItem(item),
          onDragStart: (event) => onWarehouseDragStart(event, item),
          onDragEnd: clearDragState,
          'aria-label': `${t('item.icon')}: ${item.name}`,
        },
        h('span', { className: 'fc-item-icon' }, h(ItemIcon, { icon: item.icon, size: 16 })),
        h('span', { className: 'fc-item-name' }, item.name),
        item.count > 1 ? h('span', { className: 'fc-item-count' }, t('warehouse.count', { count: item.count })) : null))
      }

      const renderWarehouse = () => {
        const unavailable = social !== null && social.inventoryAvailable === false
        const readOnly = !selectedIsMine
        return h('div', { className: 'fc-warehouse' },
          h('div', { className: 'fc-warehouse-head' },
            h('span', { className: 'fc-card-title', style: { fontSize: '11.5px' } }, t('warehouse.title')),
            h('span', { className: 'fc-count' }, String(inventory.length)),
            h('span', { className: 'fc-spacer' }),
            readOnly
              ? h('span', { className: 'fc-lock' }, h('span', { 'aria-hidden': true }, '🔒'), h('span', null, t('warehouse.readonly')))
              : null),
          readOnly
            ? null
            : h('div', { className: 'fc-warehouse-hint' },
              warehouseSelected
                ? t('warehouse.hintSelected', {
                  item: inventory.find((row) => row.itemId === warehouseSelected)?.name ?? warehouseSelected,
                  name: selected?.name ?? '',
                })
                : t('warehouse.hint')),
          unavailable
            ? h('div', { className: 'fc-inline', 'data-kind': 'hint' }, t('warehouse.unavailable'))
            : inventory.length === 0
              ? h('div', { className: 'fc-inline', 'data-kind': 'hint' }, t('warehouse.empty'))
              : h('div', { className: 'fc-warehouse-grid' }, inventory.map(renderWarehouseItem)),
          error ? h('div', { className: 'fc-inline', 'data-kind': 'error' }, error) : null,
          notice ? h('div', { className: 'fc-inline', 'data-kind': 'ok' }, notice) : null,
          notRunning
            ? h('div', null,
              h('div', { className: 'fc-inline', 'data-kind': 'error' }, t('state.notRunning')),
              h('div', { className: 'fc-inline', 'data-kind': 'hint' },
                host?.spawnFailed ? t('state.startFailed') : t('state.notRunningHint')),
              h('div', { className: 'fc-manual' }, host?.manualCommand ?? 'node scripts/run-host.mjs'))
            : null,
          host?.lastError ? h('div', { className: 'fc-inline', 'data-kind': 'error' }, host.lastError) : null)
      }

      const renderSlots = () => {
        const slots = [0, 1].map((index) => selected?.items?.[index] ?? null)
        const locked = !selectedIsMine
        const feedback = slotFeedback
        return h(React.Fragment, null,
          h('div', { className: 'fc-slots' },
            slots.map((item, index) => {
              const dropping = dropSlot === index && canGive
              const feedbackKind = feedback?.index === index ? feedback.kind : null
              const common = {
                key: item ? `${item.itemId}-${index}` : `empty-${index}`,
                className: 'fc-slot',
                'data-filled': item ? 'true' : 'false',
                'data-can-give': canGive ? 'true' : 'false',
                'data-dropping': dropping ? 'true' : 'false',
                'data-locked': locked ? 'true' : 'false',
                'data-feedback': feedbackKind ?? undefined,
                onClick: () => onSlotClick(index),
                onDragOver: (event) => onSlotDragOver(event, index),
                onDragLeave: () => onSlotDragLeave(index),
                onDrop: (event) => onSlotDrop(event, index),
                title: locked ? t('profile.readonly') : (item ? item.name : t('warehouse.drop')),
              }
              const body = item
                ? [h('span', { className: 'fc-item-icon' }, h(ItemIcon, { icon: item.icon, size: 16 })),
                  h('span', { className: 'fc-slot-name' }, item.name)]
                : [h('span', { className: 'fc-slot-empty' }, locked ? t('profile.emptySlot') : t('warehouse.drop')),
                  h('span', { className: 'fc-slot-hint' }, locked ? t('warehouse.locked') : '')]
              const content = item
                ? h(Tip, {
                  title: item.name,
                  description: item.description ?? t('item.descriptionMissing'),
                  lock: locked ? t('profile.readonly') : null,
                }, h('span', { style: { display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 } }, body))
                : body
              return h('div', common, content)
            })),
          feedback
            ? h('div', {
              className: 'fc-inline',
              'data-kind': feedback.kind === 'error' ? 'error' : (feedback.kind === 'ok' ? 'ok' : 'hint'),
            }, feedback.text)
            : null)
      }

      const renderProfile = () => {
        if (!selected) {
          return h('div', { className: 'fc-profile-body' }, h('div', { className: 'fc-empty' }, t('profile.none')))
        }
        return h('div', {
          className: 'fc-profile-body',
          'data-collapsed': profileOpen ? 'false' : 'true',
        },
        h('div', { className: 'fc-profile-top' },
          h(Avatar, {
            companion: selected,
            size: 40,
            override: model.avatarPreview,
          }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'fc-profile-name' }, selected.name),
            h('div', { className: 'fc-profile-owner' },
              `${t('profile.owner')}：` + (selected.isMine ? t('profile.ownerMine') : (selected.ownerUserId ?? '?'))))),
        h('div', { className: 'fc-rows' },
          h('div', { className: 'fc-row' },
            h('span', { className: 'fc-label' }, t('profile.personality')),
            h('span', { className: 'fc-value' }, selected.personality ?? '–')),
          h('div', { className: 'fc-row' },
            h('span', { className: 'fc-label' }, t('profile.state')),
            h('span', { className: 'fc-value' }, stateLabel(t, selected.state))),
          h('div', { className: 'fc-row' },
            h('span', { className: 'fc-label' }, t('profile.action')),
            h('span', { className: 'fc-value' }, actionName ?? '–')),
          h('div', { className: 'fc-row' },
            h('span', { className: 'fc-label' }, t('profile.avatar')),
            h('span', { className: 'fc-value' }, selected.avatarModelId ?? selected.personaId ?? '–'))),
        h('div', { className: 'fc-divider' }),
        h('div', { className: 'fc-label' }, t('profile.slots')),
        renderSlots(),
        selectedIsMine
          ? null
          : h('div', { className: 'fc-lock' }, h('span', { 'aria-hidden': true }, '🔒'), h('span', null, t('profile.readonly'))))
      }

      const renderModelSection = () => {
        const readOnly = !selectedIsMine
        const busyModel = model.busy
        const metaText = model.meta
          ? (model.meta.name || model.meta.author
            ? t('model.meta', {
              name: model.meta.name ?? '?',
              author: model.meta.author ?? '?',
              spec: model.meta.specVersion ?? '',
            })
            : t('model.metaUnknown'))
          : null
        return h('section', { className: 'fc-card fc-model' },
          h('div', { className: 'fc-card-head' },
            h('span', { className: 'fc-card-title' }, t('model.title')),
            h('span', { className: 'fc-spacer' }),
            readOnly ? h('span', { className: 'fc-tag' }, t('model.readonly')) : null),
          h('div', { className: 'fc-model-body' },
            h('div', { className: 'fc-reco' },
              h('div', { className: 'fc-reco-title' }, t('model.recommend')),
              h('div', { className: 'fc-reco-note' }, t('model.recommendNote')),
              h('div', { className: 'fc-reco-row' },
                h('a', {
                  className: 'fc-linkbtn',
                  'data-size': 'sm',
                  href: RECOMMENDED_MODEL_URL,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                }, t('model.recommendLink')),
                h('span', { className: 'fc-reco-local' }, t('model.localOnly')))),
            h('div', { className: 'fc-model-current' },
              h('span', { className: 'fc-model-thumb' },
                modelPreviewImage
                  ? h('img', { className: 'fc-model-thumb-img', src: modelPreviewImage, alt: '' })
                  : h(FangcunGlyph, { size: 34, active: selectedIsMine })),
              h('div', { className: 'fc-model-current-meta' },
                h('div', { className: 'fc-row' },
                  h('span', { className: 'fc-label', style: { minWidth: '54px' } }, t('model.current')),
                  h('span', { className: 'fc-value' }, selected?.name ?? '–')),
                h('div', { className: 'fc-row' },
                  h('span', { className: 'fc-label', style: { minWidth: '54px' } }, t('model.file')),
                  h('span', { className: 'fc-value' }, selected?.avatarModelId ?? '–')))),
            h('div', { className: 'fc-model-actions' },
              h('button', {
                type: 'button',
                className: 'fc-btn',
                'data-size': 'sm',
                disabled: readOnly || busy !== null || busyModel !== null,
                onClick: () => fileInputRef.current?.click(),
              }, busyModel === 'parse' ? t('model.busy.parse') : t('model.import')),
              h('input', {
                ref: fileInputRef,
                type: 'file',
                accept: '.vrm,.glb',
                className: 'fc-hidden-file',
                onChange: onPickModel,
                'aria-label': t('model.import'),
              }),
              h('button', {
                type: 'button',
                className: 'fc-btn',
                'data-size': 'sm',
                disabled: readOnly || busy !== null || busyModel !== null || !model.previewUrl,
                onClick: onSetAvatar,
              }, busyModel === 'avatar' ? t('model.busy.avatar') : t('model.setAvatar')),
              h('button', {
                type: 'button',
                className: 'fc-btn',
                'data-variant': 'primary',
                'data-size': 'sm',
                disabled: readOnly || busy !== null || busyModel !== null || !model.file,
                onClick: onInstallModel,
              }, busyModel === 'install' ? t('model.busy.install') : t('model.install'))),
            model.file
              ? h('div', { className: 'fc-model-file' },
                `${model.file.name} · ${formatBytes(model.file.size)}`)
              : h('div', { className: 'fc-inline', 'data-kind': 'hint' }, t('model.noFile')),
            metaText
              ? h('div', { className: 'fc-model-meta' }, metaText)
              : null,
            model.meta && model.meta.hasThumbnail === false
              ? h('div', { className: 'fc-inline', 'data-kind': 'hint' }, t('model.noThumb'))
              : null,
            model.error ? h('div', { className: 'fc-inline', 'data-kind': 'error' }, model.error) : null,
            model.notice ? h('div', { className: 'fc-inline', 'data-kind': 'ok' }, model.notice) : null,
            model.install
              ? h('div', { className: 'fc-reco', style: { background: 'var(--dsw-alias-bg-base)' } },
                h('div', { className: 'fc-inline', 'data-kind': 'ok' }, t('model.rebuild')),
                h('div', { className: 'fc-model-file' }, `${t('model.path')}: ${model.install.path}`),
                h('div', { className: 'fc-model-file' }, `${t('model.command')} ${model.install.command}`))
              : null,
            readOnly
              ? h('div', { className: 'fc-inline', 'data-kind': 'hint' }, t('model.readonly'))
              : null))
      }

      const renderChatPane = () => {
        if (!selected) {
          return h('div', { className: 'fc-log' }, h('div', { className: 'fc-empty' }, t('chat.none')))
        }
        const unavailable = social !== null && transcript?.available === false
        return h(React.Fragment, null,
          h('div', { className: 'fc-log' },
            unavailable
              ? h('div', { className: 'fc-warnbox' },
                h('div', null, t('chat.unavailable')),
                transcript?.reason ? h('div', { className: 'fc-card-hint' }, transcript.reason) : null)
              : messages.length === 0
                ? h('div', { className: 'fc-empty' }, t('chat.empty'))
                : h('div', { className: 'fc-msglist' },
                  messages.map((message, index) => h('div', {
                    key: `${message.atMs ?? 'm'}-${index}`,
                    className: 'fc-msg',
                    'data-role': message.role,
                  },
                  h('span', { className: 'fc-role' },
                    `${message.role === 'user' ? t('you') : (selected.name ?? t('companion'))}` +
                    (timeLabel(message.atMs) ? ` ${timeLabel(message.atMs)}` : '')),
                  h('span', { className: 'fc-bubble' }, message.text))))),
          h('form', { className: 'fc-composer', onSubmit: onSend },
            h('input', {
              className: 'fc-input',
              value: draft,
              maxLength: 500,
              placeholder: t('chat.placeholder'),
              disabled: !canChat,
              onChange: (event) => setDraft(event.target.value),
              'aria-label': t('chat.placeholder'),
            }),
            h('button', {
              type: 'submit',
              className: 'fc-btn',
              'data-variant': 'primary',
              disabled: !canChat || draft.trim().length === 0,
            }, busy === 'send' ? '…' : t('action.send'))))
      }

      const renderConsolePane = () => {
        const companionStateText = live?.companionState
          ? stateLabel(t, live.companionState)
          : (selected?.state ? stateLabel(t, selected.state) : '–')
        const completed = build?.completedBlocks ?? 0
        const total = build?.totalBlocks ?? 0
        const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : 0
        const demoBusy = petBusy !== null || busy !== null
        const demoBlockedByBuild = build?.inProgress === true
        const editable = selectedIsMine
        return h('div', { className: 'fc-console' },
          h('section', { className: 'fc-console-card' },
            h('div', { className: 'fc-console-head' },
              h('span', { className: 'fc-console-title' }, t('console.status')),
              h('span', { className: 'fc-spacer' }),
              h('span', { className: 'fc-tag' }, statusLabel(t, status))),
            h('div', { className: 'fc-console-row' },
              h('span', { className: 'fc-label' }, t('revision')),
              h('span', { className: 'fc-value' }, String(revisionText))),
            h('div', { className: 'fc-console-row' },
              h('span', { className: 'fc-label' }, t('blocks')),
              h('span', { className: 'fc-value' }, String(blockText))),
            h('div', { className: 'fc-console-row' },
              h('span', { className: 'fc-label' }, t('console.companionState')),
              h('span', { className: 'fc-value' }, companionStateText)),
            houseProposal
              ? h('div', { className: 'fc-house-ask', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                h('div', { className: 'fc-confirm-text', style: { color: 'var(--dsw-alias-state-warn-label)' } },
                  t('console.houseProposal') +
                  (typeof houseProposal.planBlockCount === 'number'
                    ? ` · ${t('console.housePlan', { count: houseProposal.planBlockCount })}`
                    : '')),
                h('div', { className: 'fc-form-row' },
                  h('button', {
                    type: 'button',
                    className: 'fc-btn',
                    'data-variant': 'primary',
                    'data-size': 'sm',
                    disabled: petBusy !== null || busy !== null || build?.inProgress === true,
                    onClick: () => onDecideHouse(true),
                  }, petBusy === 'decide' ? '…' : t('house.approve')),
                  h('button', {
                    type: 'button',
                    className: 'fc-btn',
                    'data-variant': 'danger-outline',
                    'data-size': 'sm',
                    disabled: petBusy !== null || busy !== null || build?.inProgress === true,
                    onClick: () => onDecideHouse(false),
                  }, t('house.reject'))),
                houseFeedback
                  ? h('div', { className: 'fc-inline', 'data-kind': houseFeedback.kind }, houseFeedback.text)
                  : null)
              : (houseFeedback
                ? h('div', { className: 'fc-inline', 'data-kind': houseFeedback.kind }, houseFeedback.text)
                : null),
            build && (build.inProgress || build.totalBlocks > 0)
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
                h('div', { className: 'fc-console-row' },
                  h('span', { className: 'fc-label' }, t('console.build')),
                  h('span', { className: 'fc-value' },
                    build.inProgress
                      ? t('console.building', { done: completed, total })
                      : t('console.built', { done: completed, total }))),
                h('div', { className: 'fc-progress', role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100' },
                  h('div', { className: 'fc-progress-bar', style: { width: `${percent}%` } })),
                build.lastError ? h('div', { className: 'fc-inline', 'data-kind': 'error' }, t('console.buildError', { error: build.lastError })) : null)
              : h('div', { className: 'fc-console-hint' }, t('console.noBuild'))),
          h('section', { className: 'fc-console-card' },
            h('div', { className: 'fc-console-head' },
              h('span', { className: 'fc-console-title' }, t('console.pet')),
              h('span', { className: 'fc-spacer' }),
              editable ? null : h('span', { className: 'fc-tag' }, t('pet.readonly'))),
            editable ? null : h('div', { className: 'fc-console-hint' }, t('pet.readonly')),
            h('div', { className: 'fc-form-row' },
              h('span', { className: 'fc-form-label' }, t('pet.name')),
              h('input', {
                className: 'fc-form-input',
                type: 'text',
                maxLength: 24,
                value: petDraft.name ?? '',
                disabled: !editable || petBusy !== null,
                onChange: (event) => setDraftField('name', event.target.value),
                'aria-label': t('pet.name'),
              })),
            h('div', { className: 'fc-form-row' },
              h('span', { className: 'fc-form-label' }, t('pet.personality')),
              h('input', {
                className: 'fc-form-input',
                type: 'text',
                maxLength: 60,
                value: petDraft.personality ?? '',
                disabled: !editable || petBusy !== null,
                onChange: (event) => setDraftField('personality', event.target.value),
                'aria-label': t('pet.personality'),
              })),
            isPrimary
              ? h('div', { className: 'fc-form-row' },
                h('span', { className: 'fc-form-label' }, t('pet.scale')),
                h('input', {
                  className: 'fc-range',
                  type: 'range',
                  min: 0.5,
                  max: 3,
                  step: 0.1,
                  value: typeof petDraft.scale === 'number' ? petDraft.scale : 1,
                  disabled: !editable || petBusy !== null,
                  onChange: (event) => setDraftField('scale', Number(event.target.value)),
                  'aria-label': t('pet.scale'),
                }),
                h('span', { className: 'fc-range-value' }, Number(petDraft.scale ?? 1).toFixed(1)))
              : h('div', { className: 'fc-console-hint' }, t('pet.notPrimary')),
            isPrimary
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                h('span', { className: 'fc-form-label', style: { minWidth: 0 } }, t('pet.actions')),
                h('div', { className: 'fc-actions-grid' },
                  actions.map((action) => h('button', {
                    key: action.id,
                    type: 'button',
                    className: 'fc-action-btn',
                    'data-active': activeActionId === action.id ? 'true' : 'false',
                    disabled: !editable || petBusy !== null || busy !== null,
                    onClick: () => onAction(action.id),
                  }, action.displayName))))
              : null,
            h('div', { className: 'fc-form-row' },
              h('span', { className: 'fc-spacer' }),
              h('button', {
                type: 'button',
                className: 'fc-btn',
                'data-variant': 'primary',
                'data-size': 'sm',
                disabled: !editable || petBusy !== null || busy !== null,
                onClick: onSavePet,
              }, petBusy === 'save' ? '…' : t('pet.save'))),
            petFeedback
              ? h('div', { className: 'fc-inline', 'data-kind': petFeedback.kind }, petFeedback.text)
              : null),
          h('section', { className: 'fc-console-card' },
            h('div', { className: 'fc-console-head' },
              h('span', { className: 'fc-console-title' }, t('console.demo'))),
            (() => {
              const renderDemoRow = (flow) => {
                const view = demoViewFor(flow)
                const kind = view.state === 'refused' || view.state === 'unavailable'
                  ? 'error'
                  : (view.state === 'done' ? 'ok' : 'hint')
                const titleKey = flow === 'real-house' ? 'demo.real.button' : 'demo.lazy.button'
                const noteKey = flow === 'real-house' ? 'demo.real.note' : 'demo.lazy.note'
                return h('div', { className: 'fc-demo-row' },
                  h('div', { className: 'fc-form-row' },
                    h('button', {
                      type: 'button',
                      className: 'fc-btn',
                      'data-variant': 'primary',
                      'data-size': 'sm',
                      disabled: !editable || demoBusy || demoBlockedByBuild,
                      onClick: () => onDemo(flow),
                      title: demoBlockedByBuild ? t('demo.runningTip') : t(titleKey),
                    }, t(titleKey))),
                  h('div', { className: 'fc-console-hint' }, t(noteKey)),
                  h('div', { className: 'fc-inline', 'data-kind': kind }, demoStatusText(view)),
                  flow === 'lazy-house' && demoNotice
                    ? h('div', { className: 'fc-inline', 'data-kind': 'ok' }, demoNotice)
                    : null)
              }
              const resetStage = resetState?.stage ?? 'idle'
              const resetBusy = resetStage === 'running'
              const resetDone = resetStage === 'done'
              const resetError = resetStage === 'refused' || resetStage === 'unavailable'
              const resetStatusText = resetDone
                ? t('demo.reset.done', { rev: resetState?.rev ?? '?', count: resetState?.blockCount ?? '?' })
                : (resetError
                  ? (resetState?.message ?? t('demo.reset.refused', { reason: '' }))
                  : (resetBusy ? t('demo.reset.running') : null))
              return [
                renderDemoRow('real-house'),
                renderDemoRow('lazy-house'),
                h('div', { className: 'fc-demo-row' },
                  resetStage === 'confirm'
                    ? h('div', { className: 'fc-confirm' },
                      h('span', { className: 'fc-confirm-text' }, t('demo.reset.confirm')),
                      h('button', {
                        type: 'button',
                        className: 'fc-btn',
                        'data-variant': 'danger',
                        'data-size': 'sm',
                        onClick: onResetWorld,
                      }, t('demo.reset.accept')),
                      h('button', {
                        type: 'button',
                        className: 'fc-btn',
                        'data-size': 'sm',
                        onClick: onCancelReset,
                      }, t('demo.reset.cancel')))
                    : h('button', {
                      type: 'button',
                      className: 'fc-btn',
                      'data-variant': 'danger-outline',
                      'data-size': 'sm',
                      disabled: demoBusy || demoBlockedByBuild || resetBusy,
                      onClick: onResetWorld,
                      title: demoBlockedByBuild ? t('demo.disabled') : t('demo.reset.button'),
                    }, resetBusy ? t('demo.reset.running') : t('demo.reset.button')),
                  h('div', { className: 'fc-console-hint' }, t('demo.reset.note')),
                  resetStatusText
                    ? h('div', {
                      className: 'fc-inline',
                      'data-kind': resetDone ? 'ok' : (resetError ? 'error' : 'hint'),
                    }, resetStatusText)
                    : null)
              ]
            })()))
      }

      const renderIslandPane = () => {
        const islandLinks = h('div', { className: 'fc-island-links' },
          h('a', {
            className: 'fc-island-link',
            href: islandUrl,
            target: '_blank',
            rel: 'noreferrer noopener',
          }, t('island.openTab')),
          h('span', null, '·'),
          h('button', {
            type: 'button',
            className: 'fc-btn',
            'data-size': 'sm',
            onClick: onCopyIslandUrl,
            title: islandUrl,
          }, t('island.copyUrl')),
          copiedIsland ? h('span', null, t('island.copied')) : null,
          h('span', { className: 'fc-spacer' }),
          h('span', { className: 'fc-offscreen-url', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, islandUrl))
        let content
        if (island === null) {
          content = h('div', { className: 'fc-warnbox' }, h('div', null, t('island.loading')))
        } else if (showIslandFrame) {
          content = h('iframe', {
            className: 'fc-frame',
            src: islandUrl,
            title: t('island.title'),
            onLoad: onFrameLoad,
            onError: onFrameError,
            referrerPolicy: 'no-referrer',
            'data-fangcun-island': true,
          })
        } else {
          const reasons = Array.isArray(island.reasons) ? island.reasons.filter(Boolean) : []
          const title = islandFailed && island.embeddable === true ? t('island.timeout') : t('island.blocked')
          content = h('div', { className: 'fc-warnbox', style: { margin: 'auto', padding: '18px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, title),
            h('a', { className: 'fc-linkbtn', href: islandUrl, target: '_blank', rel: 'noreferrer noopener' },
              t('island.open')),
            reasons.length > 0 ? h('div', { className: 'fc-card-hint', style: { whiteSpace: 'normal' } }, reasons.join(' · ')) : null,
            h('div', { className: 'fc-consolerow' },
              h('span', { className: 'fc-label' }, t('island.reachable')),
              h('span', { className: 'fc-value' }, islandUrl)),
            h('div', { className: 'fc-consolerow' },
              h('span', { className: 'fc-label' }, t('island.host')),
              h('span', { className: 'fc-value' }, host?.hostUrl ?? 'http://127.0.0.1:8765')),
            h('div', { className: 'fc-consolerow' },
              h('span', { className: 'fc-label' }, t('island.pairing')),
              h('span', { className: 'fc-value' }, host?.pairingCode ?? t('pairing.empty'))),
            h('div', { className: 'fc-card-hint', style: { maxWidth: '46ch', whiteSpace: 'normal' } }, t('island.hint')),
            h('button', {
              type: 'button',
              className: 'fc-btn',
              'data-size': 'sm',
              onClick: () => { setIsland(null); setIslandFailed(false); setIslandFrameLoaded(false) },
            }, t('island.retry')))
        }
        return h('div', { className: 'fc-island' }, content, islandLinks)
      }

      return h('section', {
        className: 'fc-page',
        'aria-label': t('title'),
        'data-fangcun-panel': true,
        'data-status': status,
      },
      h('style', null, CSS),
      h('header', { className: 'fc-head' },
        h('span', { className: 'fc-mark' }, h(BrandMark, { size: 22 })),
        h('div', { className: 'fc-title-wrap' },
          h('h1', { className: 'fc-title' }, t('title')),
          h('span', { className: 'fc-subtitle' }, t('subtitle'))),
        h('span', { className: 'fc-pill' },
          h('span', { className: 'fc-dot', 'data-status': status }),
          h('span', null, statusLabel(t, status))),
        h('span', { className: 'fc-meta' },
          `${t('revision')} ${revisionText} · ${blockText} ${t('blocks')}` +
          (typeof host?.worldId === 'string' ? ` · ${host.worldId}` : '')),
        h('span', { className: 'fc-spacer' }),
        notRunning
          ? h('button', {
            type: 'button',
            className: 'fc-btn',
            'data-variant': 'primary',
            disabled: busy !== null,
            onClick: onStart,
          }, busy === 'start' || status === 'starting' ? t('action.starting') : t('action.start'))
          : null,
        h('button', { type: 'button', className: 'fc-btn', disabled: busy !== null, onClick: onRefresh },
          busy === 'refresh' ? '…' : t('action.refresh')),
        h('button', {
          type: 'button',
          className: 'fc-btn',
          'data-variant': 'primary',
          disabled: busy !== null || notRunning,
          onClick: onTick,
        }, busy === 'tick' ? '…' : t('action.tick'))),
      h('div', { className: 'fc-body' },
        h('aside', { className: 'fc-card fc-list' },
          h('div', { className: 'fc-card-head' },
            h('span', { className: 'fc-card-title' }, t('list.title')),
            h('span', { className: 'fc-count' }, String(companions.length))),
          social === null
            ? h('div', { className: 'fc-convs' }, h('div', { className: 'fc-empty' }, t('list.loading')))
            : h('div', { className: 'fc-convs' },
              social.available === false ? h('div', { className: 'fc-banner' }, t('list.legacy')) : null,
              companions.length === 0
                ? h('div', { className: 'fc-empty' }, t('list.empty'))
                : companions.map(renderConversationRow)),
          renderWarehouse()),
        h('section', { className: 'fc-card fc-chat' },
          h('div', { className: 'fc-card-head' },
            companions.length > 0
              ? h('select', {
                className: 'fc-conv-select',
                value: selectedId ?? '',
                'aria-label': t('list.title'),
                onChange: (event) => selectCompanion(event.target.value),
              }, companions.map((companion) => h('option', {
                key: companion.companionId,
                value: companion.companionId,
              }, companion.name)))
              : null,
            h('span', { className: 'fc-card-title' }, selected?.name ?? t('chat.title')),
            selected?.state ? h('span', { className: 'fc-tag' }, stateLabel(t, selected.state)) : null,
            h('span', { className: 'fc-spacer' }),
            h('div', { className: 'fc-chat-head-tabs' },
              h('button', {
                type: 'button',
                className: 'fc-tab',
                'data-active': tab === 'chat' ? 'true' : 'false',
                onClick: () => setTab('chat'),
              }, t('tab.chat')),
              h('button', {
                type: 'button',
                className: 'fc-tab',
                'data-active': tab === 'island' ? 'true' : 'false',
                onClick: () => setTab('island'),
              }, t('tab.island')),
              h('button', {
                type: 'button',
                className: 'fc-tab',
                'data-active': tab === 'console' ? 'true' : 'false',
                onClick: () => setTab('console'),
              }, t('tab.console')))),
          tab === 'chat'
            ? renderChatPane()
            : (tab === 'island' ? renderIslandPane() : renderConsolePane())),
        h('div', { className: 'fc-rightcol' },
          h('aside', { className: 'fc-card fc-profile' },
            h('div', { className: 'fc-card-head' },
              h('span', { className: 'fc-card-title' }, t('profile.title')),
              selectedIsMine ? null : h('span', { className: 'fc-tag' }, t('profile.readonly')),
              h('span', { className: 'fc-spacer' }),
              h('button', {
                type: 'button',
                className: 'fc-collapse',
                onClick: () => setProfileOpen((value) => !value),
                'aria-expanded': profileOpen ? 'true' : 'false',
              }, profileOpen ? t('action.collapse') : t('action.expand'))),
            renderProfile()),
          renderModelSection())),
      h('div', { className: 'fc-footerbar' },
        h('span', null, host?.hostUrl ?? ''),
        host?.pairingCode
          ? h('button', {
            type: 'button',
            className: 'fc-btn',
            'data-size': 'sm',
            onClick: onCopyPairing,
            title: t('island.pairing'),
            style: { height: '20px', fontSize: '10.5px', padding: '0 7px' },
          }, `${t('island.pairing')}: ${copied ? '✓' : host.pairingCode}`)
          : null,
        h('span', { className: 'fc-spacer' }),
        h('span', null, t('subtitle'))))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fangcun-panel: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          locale: NS,
          label: () => t('sidebar.label'),
        }, FangcunGlyph))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ t }),
        }, FangcunPanel))
      },
      // Structural-test hooks; only when the test harness opts in. Production
      // plugins export exactly { inject, apply }.
      ...(typeof window !== 'undefined' && window.__DSH_FANGCUN_TEST__ === true
        ? { __test: { parseGlbContainer, extractModelPreview, decodeVrmMeta, extractThumbnail } }
        : {}),
    }
  },
})
