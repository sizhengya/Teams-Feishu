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
/**
 * 指令分发 —— 两端共用。命令路径不经过 ensureReverseSession。
 * 返回 null 表示不是命令，交给调用方走普通消息路径。
 */
async function handleCommandTeams(msg) {
    const cmd = sm.parseCommand(msg.text);
    if (!cmd)
        return null;
    switch (cmd.command) {
        case "chat": {
            if (!cmd.args)
                return { type: "reply_bot", text: "⚠️ 请指定邮件前缀：/chat <邮件前缀>" };
            const result = await sm.chatWithSearch(msg.teamsUserKey, "teams", cmd.args);
            if (result.error)
                return { type: "reply_bot", text: `❌ ${result.error}` };
            if (result.autoConnected) {
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
        case "list":
            return { type: "reply_bot", text: fmt.formatSessionList(sm.listAllSessions(msg.teamsUserKey, "teams"), sm.getActiveSession(msg.teamsUserKey, "teams")?.sessionId) };
        case "who":
            return { type: "reply_bot", text: fmt.formatWhoReply(sm.getActiveSession(msg.teamsUserKey, "teams")) };
        case "help":
            return { type: "reply_bot", text: fmt.formatHelpText() };
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
    return null;
}
/**
 * Teams 入站普通消息路由（design §6 "路由铁律"）：
 * 1. 先校验发送方 active（spec §1：无 active → 拒绝）
 * 2. 调 ensureReverseSession 决策
 * 3. 根据决策生成具体 RouteAction；message_map / 发送由 handler 执行
 */
async function routeTeamsInbound(msg) {
    const cmdResult = await handleCommandTeams(msg);
    if (cmdResult)
        return cmdResult;
    // spec §1：发送方必须有 active session
    const senderActive = repo.findActive(msg.teamsUserKey, "teams");
    if (!senderActive) {
        return { type: "reply_bot", text: fmt.formatNoActiveWarning() };
    }
    // 接收方（飞书用户）open_id + 其飞书 chat
    const receiverOpenId = senderActive.peerReceiveId;
    const receiverPlatform = senderActive.peerPlatform; // 预期 "feishu"
    const feishuChatId = senderActive.feishuChatId || receiverOpenId;
    const formatted = fmt.formatFromTeams(msg.senderDisplay, msg.text);
    const result = sm.ensureReverseSession(receiverOpenId, receiverPlatform, { platform: "teams", receiveId: msg.teamsUserKey, receiveIdType: "aad_id", displayName: msg.senderDisplay, email: "" }, formatted, msg.timestamp);
    if (result.decision === "deliver") {
        return { type: "forward_to_feishu", sessionId: result.session.sessionId, content: formatted, peerId: receiverOpenId, peerIdType: "open_id", feishuChatId, srcMessageId: msg.messageId };
    }
    if (result.decision === "deliver_activated") {
        const tip = fmt.formatAutoActivatedTip(msg.senderDisplay, "teams");
        return { type: "forward_to_feishu", sessionId: result.session.sessionId, content: formatted, peerId: receiverOpenId, peerIdType: "open_id", feishuChatId, tip, srcMessageId: msg.messageId };
    }
    // notify：通知合并窗口
    if (!notifier_1.notificationMerger.shouldNotify(result.session.sessionId)) {
        return { type: "noop" };
    }
    notifier_1.notificationMerger.markNotified(result.session.sessionId);
    const unread = repo.getDb().prepare("SELECT unread_count FROM sessions WHERE session_id=? AND owner_key=?").get(result.session.sessionId, receiverOpenId)?.unread_count || 1;
    return { type: "notify_feishu_peer", sessionId: result.session.sessionId, receiverOpenId, feishuChatId, senderDisplay: msg.senderDisplay, senderTeamsKey: msg.teamsUserKey, unread, srcMessageId: msg.messageId };
}
/**
 * 飞书入站普通消息路由（同上 design §6）。
 * 命令由 feishu handler 自行处理（保留历史行为，避免侵入过大）。
 */
async function routeFeishuInbound(msg, ownerKey) {
    // spec §1：发送方必须有 active session
    const senderActive = repo.findActive(ownerKey, "feishu");
    if (!senderActive) {
        return { type: "reply_bot", text: fmt.formatNoActiveWarning() };
    }
    const receiverTeamsKey = senderActive.peerReceiveId; // Teams AAD ID
    const receiverPlatform = senderActive.peerPlatform; // 预期 "teams"
    const formatted = fmt.formatFromFeishu(msg.senderDisplay, msg.text);
    const result = sm.ensureReverseSession(receiverTeamsKey, receiverPlatform, { platform: "feishu", receiveId: ownerKey, receiveIdType: "open_id", displayName: msg.senderDisplay, email: "" }, formatted, msg.timestamp);
    if (result.decision === "deliver") {
        return { type: "forward_to_teams", sessionId: result.session.sessionId, content: formatted, teamsUserKey: receiverTeamsKey, srcMessageId: msg.messageId };
    }
    if (result.decision === "deliver_activated") {
        const tip = fmt.formatAutoActivatedTip(msg.senderDisplay, "feishu");
        return { type: "forward_to_teams", sessionId: result.session.sessionId, content: formatted, teamsUserKey: receiverTeamsKey, tip, srcMessageId: msg.messageId };
    }
    if (!notifier_1.notificationMerger.shouldNotify(result.session.sessionId)) {
        return { type: "noop" };
    }
    notifier_1.notificationMerger.markNotified(result.session.sessionId);
    const unread = repo.getDb().prepare("SELECT unread_count FROM sessions WHERE session_id=? AND owner_key=?").get(result.session.sessionId, receiverTeamsKey)?.unread_count || 1;
    return { type: "notify_teams_peer", sessionId: result.session.sessionId, teamsUserKey: receiverTeamsKey, senderDisplay: msg.senderDisplay, senderOpenId: ownerKey, unread, srcMessageId: msg.messageId };
}
//# sourceMappingURL=router.js.map