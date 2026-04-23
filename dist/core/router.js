"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeTeamsInbound = routeTeamsInbound;
exports.routeFeishuInbound = routeFeishuInbound;
const sm = __importStar(require("./session-manager"));
const fmt = __importStar(require("./formatter"));
const notifier_1 = require("./notifier");
const repo = __importStar(require("../store/session.repo"));
async function routeTeamsInbound(msg) {
    const cmd = sm.parseCommand(msg.text);
    if (cmd) {
        switch (cmd.command) {
            case "chat": {
                if (!cmd.args)
                    return { type: "reply_bot", text: "⚠️ 请指定邮件前缀：/chat <邮件前缀>" };
                const result = await sm.chatWithSearch(msg.teamsUserKey, "teams", cmd.args);
                if (result.error)
                    return { type: "reply_bot", text: `❌ ${result.error}` };
                if (result.autoConnected) {
                    // pending 消息以 owner_key 存储，owner_key 是会话所有者的 ID
                    const ownerKey = result.autoConnected.ownerKey;
                    const pending = sm.flushPendingMessages(ownerKey, result.autoConnected.sessionId);
                    let reply = fmt.formatAutoConnect(result.autoConnected.displayName, result.autoConnected.peerEmail, result.autoConnected.peerPlatform);
                    if (pending.length > 0)
                        reply += "\n\n" + fmt.formatUnreadReplay(pending);
                    return { type: "reply_bot", text: reply };
                }
                return { type: "reply_bot", text: fmt.formatSearchResults(result.results) };
            }
            case "select": {
                const idx = parseInt(cmd.args, 10);
                if (isNaN(idx))
                    return { type: "reply_bot", text: "⚠️ 请输入数字：/select <序号>" };
                const r = sm.handleSelect(msg.teamsUserKey, "teams", idx);
                if (r.error === "no_pending")
                    return { type: "reply_bot", text: fmt.formatNoPending() };
                if (r.error === "out_of_range")
                    return { type: "reply_bot", text: fmt.formatSelectOutOfRange() };
                const pending = sm.flushPendingMessages(msg.teamsUserKey, r.session.sessionId);
                let reply = fmt.formatSwitchConfirm(r.session.displayName, r.session.peerPlatform);
                if (pending.length > 0)
                    reply += "\n\n" + fmt.formatUnreadReplay(pending);
                return { type: "reply_bot", text: reply };
            }
            case "list": return { type: "reply_bot", text: fmt.formatSessionList(sm.listAllSessions(msg.teamsUserKey)) };
            case "who": return { type: "reply_bot", text: fmt.formatWhoReply(sm.getActiveSession(msg.teamsUserKey, "teams")) };
            case "help": return { type: "reply_bot", text: fmt.formatHelpText() };
            case "clear":
                sm.clearAllSessions(msg.teamsUserKey);
                return { type: "reply_bot", text: fmt.formatClearConfirm() };
            case "connect": {
                if (!cmd.args)
                    return { type: "reply_bot", text: "⚠️ 请指定目标： /connect feishu:<open_id>\n示例： /connect feishu:ou_ed25f0ffb16486c6638b906a1d6d0da7" };
                const r = await sm.handleConnect(msg.teamsUserKey, "teams", cmd.args);
                if (r.error)
                    return { type: "reply_bot", text: `❌ ${r.error}` };
                return { type: "reply_bot", text: fmt.formatSwitchConfirm(r.session.displayName, r.session.peerPlatform) };
            }
        }
    }
    // Spec 9.3：普通消息路由（Scenario B）
    // Teams 用户发消息给飞书用户：
    // 1. 通过 session_states 找到飞书用户（owner_key = feishu open_id）拥有的 active session
    // 2. 如果找到此 Teams AAD ID 作为 peer 的 session，说明飞书用户之前通过 /chat 主动联系过，直接转发
    // 3. 如果没找到，说明这是 Teams 用户先发的消息 → 创建飞书用户的 idle session + 通知
    const feishuSession = repo.findSessionByPeerAnyOwner(msg.teamsUserKey);
    console.log(`[router] routeTeamsInbound: teamsUserKey=${msg.teamsUserKey.substring(0, 8)} feishuSession=${feishuSession?.sessionId} ownerPlatform=${feishuSession?.ownerPlatform} peerReceiveId=${feishuSession?.peerReceiveId} state=${feishuSession?.state}`);
    if (feishuSession) {
        // Feishu open_id：根据 owner_platform 判断
        const feishuOpenId = feishuSession.ownerPlatform === "teams" ? feishuSession.peerReceiveId : feishuSession.ownerKey;
        // 检查 Feishu 用户是否有与其他 Teams 用户的 active session（排除当前 Teams 用户）
        const otherActiveSession = repo.findOtherActiveSession(feishuOpenId, "feishu", msg.teamsUserKey);
        console.log(`[router] feishuOpenId=${feishuOpenId?.substring(0, 8)} otherActiveSession=${otherActiveSession?.sessionId} peer=${otherActiveSession?.peerReceiveId}`);
        if (otherActiveSession) {
            // Merge Window 检查：10 秒内的重复通知不发送
            if (!notifier_1.notificationMerger.shouldNotify(feishuSession.sessionId)) {
                return { type: "noop" };
            }
            notifier_1.notificationMerger.markNotified(feishuSession.sessionId);
            // Feishu 用户有与其他 Teams 用户的 active session → 发通知
            return { type: "notify_and_create_idle", content: fmt.formatFromTeams(msg.senderDisplay, msg.text), teamsUserKey: msg.teamsUserKey, senderDisplay: msg.senderDisplay };
        }
        if (feishuSession.state === "idle") {
            // Feishu A 有与 Teams C 的 session，但处于 idle（其他 active 也不存在）
            // → 按 spec 7.2 idle 路径处理：通知 + 存 pending
            if (!notifier_1.notificationMerger.shouldNotify(feishuSession.sessionId)) {
                return { type: "noop" };
            }
            notifier_1.notificationMerger.markNotified(feishuSession.sessionId);
            return { type: "notify_and_create_idle", content: fmt.formatFromTeams(msg.senderDisplay, msg.text), teamsUserKey: msg.teamsUserKey, senderDisplay: msg.senderDisplay };
        }
        // Feishu 用户与此 Teams 用户的 session 是 active → 直接转发
        return { type: "forward_to_feishu", sessionId: feishuSession.sessionId, content: fmt.formatFromTeams(msg.senderDisplay, msg.text), peerId: feishuOpenId, peerIdType: "open_id", feishuChatId: feishuSession.feishuChatId };
    }
    // Spec 7.2：Teams 用户先发消息 → 创建飞书用户的 idle session + 通知
    return { type: "notify_and_create_idle", content: fmt.formatFromTeams(msg.senderDisplay, msg.text), teamsUserKey: msg.teamsUserKey, senderDisplay: msg.senderDisplay };
}
async function routeFeishuInbound(msg, ownerKey) {
    // 用 feishu open_id 查找以该飞书用户为 owner 的 session（peer 是 Teams 用户）
    const active = repo.findActiveByOwnerAndPeer(ownerKey, "feishu", "teams");
    if (!active) {
        // 没有活跃会话，提示用户先选择会话
        return { type: "reply_bot", text: fmt.formatNoActiveWarning() };
    }
    if (active.state === "idle") {
        // Spec 10：非当前会话通知
        // 找到 Teams 用户侧的 session（peer_receive_id = ownerKey = Feishu open_id）
        const teamsSession = repo.findActiveByPeer(ownerKey, "feishu");
        if (teamsSession) {
            repo.incrementUnread(teamsSession.ownerKey, teamsSession.sessionId);
            repo.savePendingMessage(teamsSession.sessionId, teamsSession.ownerKey, fmt.formatFromFeishu(msg.senderDisplay, msg.text), msg.timestamp);
        }
        repo.incrementUnread(ownerKey, active.sessionId);
        if (!notifier_1.notificationMerger.shouldNotify(active.sessionId)) {
            return { type: "noop" };
        }
        notifier_1.notificationMerger.markNotified(active.sessionId);
        // 返回 notify_non_active：Teams handler 负责发给 Teams 用户（spec 10.3）
        return {
            type: "notify_non_active",
            sessionId: active.sessionId,
            ownerKey: teamsSession?.ownerKey || active.ownerKey,
            ownerPlatform: active.ownerPlatform,
            ownerDisplay: msg.senderDisplay,
            rawText: msg.text,
            timestamp: msg.timestamp,
        };
    }
    // active.peerReceiveId 是 Teams AAD ID，用于查 user_links
    return { type: "forward_to_teams", sessionId: active.sessionId, content: fmt.formatFromFeishu(msg.senderDisplay, msg.text), teamsUserKey: active.peerReceiveId };
}
//# sourceMappingURL=router.js.map