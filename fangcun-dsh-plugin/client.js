/**
 * Client half of the Fangcun world panel.
 *
 * The centre column becomes a messaging-style pet manager: a companion
 * conversation list on the left, the selected companion's chat in the middle
 * (plus the island console tab), and that companion's profile on the right.
 * The user inventory strip lives at the bottom of the left column.
 *
 * Data comes from the Host half's authenticated routes under
 * `/api/fangcun-host/*`; the browser calls them same-origin with the page
 * cookie, so the Fangcun Host needs no CORS or second port. The social
 * endpoints (`/api/core/companions`, `/api/core/inventory`, per-companion chat)
 * are being added to the Host concurrently: this panel renders whatever the
 * Host answers and degrades to clearly-labelled read-only/placeholder states
 * instead of throwing when they are missing.
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
      'inventory.title': '我的道具',
      'inventory.empty': '还没有道具。',
      'inventory.unavailable': '道具接口暂不可用，Host 更新后会出现。',
      'inventory.readonly': '当前选中的是别人的桌宠，只能查看道具。',
      'give.prompt': '送给 {name}',
      'give.ok': '已把「{item}」送给 {name}',
      'give.err.full': '对方的道具栏满了（最多 2 件）。',
      'give.err.notOwned': '你没有这件道具。',
      'give.err.notOwner': '别人的桌宠，只能看不能动。',
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
      'inventory.title': 'My items',
      'inventory.empty': 'No items yet.',
      'inventory.unavailable': 'Item API unavailable; it appears once the Host ships it.',
      'inventory.readonly': 'The selected companion belongs to someone else; items are view-only.',
      'give.prompt': 'Give to {name}',
      'give.ok': 'Gave “{item}” to {name}',
      'give.err.full': 'Their item slots are full (2 max).',
      'give.err.notOwned': "You don't own that item.",
      'give.err.notOwner': "Someone else's pet — view only.",
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
      '.fc-profile{grid-area:profile}',
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
      '.fc-avatar{flex:0 0 auto;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--dsw-alias-fill-l1);border:0.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}',
      '.fc-avatar[data-mine="true"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.fc-inv{flex:0 0 auto;border-top:0.5px solid var(--dsw-alias-border-l3);display:flex;flex-direction:column;gap:6px;padding:8px 10px 10px;max-height:190px;overflow:auto}',
      '.fc-inv-head{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:0}',
      '.fc-inv-items{display:flex;flex-wrap:wrap;gap:6px}',
      '.fc-item{display:flex;align-items:center;gap:5px;max-width:100%;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 7px 4px 5px;cursor:pointer;font-family:inherit;font-size:11px;min-width:0}',
      '.fc-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.fc-item[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-fill-l1)}',
      '.fc-item[data-readonly="true"]{cursor:default}',
      '.fc-item-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}',
      '.fc-item-icon{flex:0 0 auto;display:flex;color:var(--dsw-alias-label-secondary)}',
      '.fc-givebar{display:flex;flex-direction:column;gap:5px;border:0.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);border-radius:8px;padding:6px 8px}',
      '.fc-givebar-row{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}',
      '.fc-givebar-name{font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}',
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
      '.fc-slot{display:flex;align-items:center;gap:7px;min-height:34px;border-radius:8px;border:0.5px dashed var(--dsw-alias-border-l2);padding:4px 8px;background:var(--dsw-alias-bg-base);font-size:11.5px;min-width:0}',
      '.fc-slot[data-filled="true"]{border-style:solid}',
      '.fc-slot-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.fc-slot-empty{color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.fc-tip-host{position:relative;display:inline-flex;min-width:0}',
      '.fc-tip{position:fixed;z-index:60;min-width:170px;max-width:250px;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-tooltip-bg);color:var(--dsw-alias-tooltip-label);font-size:11px;line-height:1.5;box-shadow:0 6px 20px rgba(0,0,0,.24);pointer-events:none;transform:translateY(-100%)}',
      '.fc-tip-title{font-weight:600;margin-bottom:2px}',
      '.fc-tip-lock{color:var(--dsw-alias-state-warn-label);margin-top:3px}',
      '.fc-collapse{display:none;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:1px 7px;font-size:11px;cursor:pointer;font-family:inherit}',
      '.fc-footerbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;min-height:20px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);padding:0 2px;min-width:0;overflow:hidden}',
      '@media (max-width:1100px){.fc-body{grid-template-columns:230px minmax(0,1fr);grid-template-areas:"list chat" "list profile";grid-template-rows:minmax(0,1fr) auto}.fc-profile{max-height:230px}.fc-collapse{display:inline-flex}.fc-profile-body[data-collapsed="true"]{display:none}}',
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

    function Avatar({ companion, size = 26 }) {
      return h('span', {
        className: 'fc-avatar',
        'data-mine': companion?.isMine ? 'true' : 'false',
        style: { width: `${size}px`, height: `${size}px` },
        'aria-hidden': true,
      }, h(FangcunGlyph, { size: Math.round(size * 0.66), active: companion?.isMine === true }))
    }

    /** Item sprites; `icon` is the sprite name the Host sends (seed item: "basin"). */
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
      const [social, setSocial] = useState(null)
      const [host, setHost] = useState(null)
      const [selectedId, setSelectedId] = useState(null)
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(null)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [unread, setUnread] = useState({})
      const [giveItemId, setGiveItemId] = useState(null)
      const [giveState, setGiveState] = useState(null)
      const [tab, setTab] = useState('chat')
      const [island, setIsland] = useState(null)
      const [islandFailed, setIslandFailed] = useState(false)
      const [islandFrameLoaded, setIslandFrameLoaded] = useState(false)
      const [profileOpen, setProfileOpen] = useState(true)
      const [copied, setCopied] = useState(false)

      const mountedRef = useRef(true)
      const selectedRef = useRef(null)
      const seenRef = useRef(new Map())
      const frameTimerRef = useRef(null)

      const useActivePanelId = typeof usePanelInfo === 'function' ? usePanelInfo : fallbackPanelInfo
      const activePanelId = useActivePanelId((info) => info.activePanelId)
      const isActivePanel = activePanelId === undefined || activePanelId === null || activePanelId === PANEL_ID

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

      const run = useCallback(async (kind, task) => {
        setBusy(kind)
        setError(null)
        setNotice(null)
        setGiveState(null)
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
        setGiveItemId(null)
        setGiveState(null)
        loadSocial(true)
      }, [loadSocial])

      const onPickItem = useCallback((item) => {
        if (!selected) {
          setGiveState({ kind: 'error', text: t('chat.none') })
          return
        }
        if (!selected.isMine) {
          setGiveState({ kind: 'error', text: t('inventory.readonly') })
          setGiveItemId(null)
          return
        }
        setGiveState(null)
        setGiveItemId((current) => (current === item.itemId ? null : item.itemId))
      }, [selected, t])

      const onGive = useCallback(async () => {
        if (!selected || !selected.isMine || !giveItemId) return
        const item = inventory.find((row) => row.itemId === giveItemId)
        const payload = await run('give', () => callApi('/give', {
          method: 'POST',
          body: JSON.stringify({ companionId: selected.companionId, itemId: giveItemId }),
        }))
        if (!payload || payload.failed) {
          const code = payload?.failed?.code ?? 'unknown'
          const mapped = {
            companion_inventory_full: t('give.err.full'),
            item_not_owned: t('give.err.notOwned'),
            not_owner: t('give.err.notOwner'),
            unknown_item: t('give.err.unknownItem'),
            companion_not_found: t('give.err.companionMissing'),
            invalid_companion: t('give.err.companionMissing'),
            social_unavailable: t('give.err.unavailable'),
          }[code]
          setGiveState({ kind: 'error', text: mapped ?? t('give.err.unknown', { code }) })
          return
        }
        setGiveItemId(null)
        setGiveState({ kind: 'ok', text: t('give.ok', { item: item?.name ?? giveItemId, name: selected.name }) })
        await loadSocial(true)
      }, [giveItemId, inventory, loadSocial, run, selected, t])

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

      const islandUrl = island?.url ?? 'http://127.0.0.1:4173/?mode=host'
      const showIslandFrame = island?.embeddable === true && !islandFailed
      const revisionText = typeof host?.revision === 'number' ? host.revision : '–'
      const blockText = typeof host?.blockCount === 'number' ? host.blockCount : '–'

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

      const renderItemCard = (item) => {
        const selectedItem = giveItemId === item.itemId
        const readOnly = !selectedIsMine
        return h(Tip, {
          key: item.itemId,
          title: item.name,
          description: item.description ?? t('item.descriptionMissing'),
          lock: readOnly ? t('profile.readonly') : null,
        },
        h('button', {
          type: 'button',
          className: 'fc-item',
          'data-selected': selectedItem ? 'true' : 'false',
          'data-readonly': readOnly ? 'true' : 'false',
          'aria-label': `${t('item.icon')}: ${item.name}`,
          onClick: () => onPickItem(item),
        },
        h('span', { className: 'fc-item-icon' }, h(ItemIcon, { icon: item.icon, size: 16 })),
        h('span', { className: 'fc-item-name' }, item.name)))
      }

      const renderProfile = () => {
        if (!selected) {
          return h('div', { className: 'fc-profile-body' }, h('div', { className: 'fc-empty' }, t('profile.none')))
        }
        const slots = [0, 1].map((index) => selected.items?.[index] ?? null)
        return h('div', {
          className: 'fc-profile-body',
          'data-collapsed': profileOpen ? 'false' : 'true',
        },
        h('div', { className: 'fc-profile-top' },
          h(Avatar, { companion: selected, size: 40 }),
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
        h('div', { className: 'fc-slots' },
          slots.map((item, index) => item
            ? h(Tip, {
              key: `${item.itemId}-${index}`,
              title: item.name,
              description: item.description ?? t('item.descriptionMissing'),
              lock: selected.isMine ? null : t('profile.readonly'),
            },
            h('div', { className: 'fc-slot', 'data-filled': 'true' },
              h('span', { className: 'fc-item-icon' }, h(ItemIcon, { icon: item.icon, size: 16 })),
              h('span', { className: 'fc-slot-name' }, item.name)))
            : h('div', { key: `empty-${index}`, className: 'fc-slot', 'data-filled': 'false' },
              h('span', { className: 'fc-slot-empty' }, t('profile.emptySlot'))))),
        selected.isMine
          ? null
          : h('div', { className: 'fc-lock' }, h('span', { 'aria-hidden': true }, '🔒'), h('span', null, t('profile.readonly'))))
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

      const renderIslandPane = () => {
        if (island === null) {
          return h('div', { className: 'fc-island' },
            h('div', { className: 'fc-warnbox' }, h('div', null, t('island.loading'))))
        }
        if (showIslandFrame) {
          return h('div', { className: 'fc-island' },
            h('iframe', {
              className: 'fc-frame',
              src: islandUrl,
              title: t('island.title'),
              onLoad: onFrameLoad,
              onError: onFrameError,
              referrerPolicy: 'no-referrer',
              'data-fangcun-island': true,
            }))
        }
        const reasons = Array.isArray(island.reasons) ? island.reasons.filter(Boolean) : []
        const title = islandFailed && island.embeddable === true ? t('island.timeout') : t('island.blocked')
        return h('div', { className: 'fc-island' },
          h('div', { className: 'fc-warnbox', style: { margin: 'auto', padding: '18px' } },
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
            }, t('island.retry'))))
      }

      const renderInventory = () => {
        const unavailable = social !== null && social.inventoryAvailable === false
        const giveItem = giveItemId ? inventory.find((item) => item.itemId === giveItemId) ?? null : null
        return h('div', { className: 'fc-inv' },
          h('div', { className: 'fc-inv-head' },
            h('span', { className: 'fc-card-title', style: { fontSize: '11.5px' } }, t('inventory.title')),
            h('span', { className: 'fc-count' }, String(inventory.length)),
            h('span', { className: 'fc-spacer' }),
            selectedIsMine
              ? null
              : h('span', { className: 'fc-lock' }, h('span', { 'aria-hidden': true }, '🔒'), h('span', null, t('inventory.readonly')))),
          unavailable
            ? h('div', { className: 'fc-inline', 'data-kind': 'hint' }, t('inventory.unavailable'))
            : inventory.length === 0
              ? h('div', { className: 'fc-inline', 'data-kind': 'hint' }, t('inventory.empty'))
              : h('div', { className: 'fc-inv-items' }, inventory.map(renderItemCard)),
          giveItem && selectedIsMine
            ? h('div', { className: 'fc-givebar' },
              h('div', { className: 'fc-givebar-name' }, t('give.prompt', { name: selected.name })),
              h('div', { className: 'fc-givebar-row' },
                h('button', {
                  type: 'button',
                  className: 'fc-btn',
                  'data-variant': 'primary',
                  'data-size': 'sm',
                  disabled: busy !== null,
                  onClick: onGive,
                }, busy === 'give' ? '…' : t('give.prompt', { name: selected.name })),
                h('button', {
                  type: 'button',
                  className: 'fc-btn',
                  'data-size': 'sm',
                  onClick: () => setGiveItemId(null),
                }, t('action.cancel'))))
            : null,
          giveState
            ? h('div', { className: 'fc-inline', 'data-kind': giveState.kind }, giveState.text)
            : null,
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
          renderInventory()),
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
              }, t('tab.island')))),
          tab === 'chat' ? renderChatPane() : renderIslandPane()),
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
          renderProfile())),
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
    }
  },
})
