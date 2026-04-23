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
const express_1 = require("express");
const router_1 = require("../../core/router");
const user_link_repo_1 = require("../../store/user-link.repo");
const message_map_repo_1 = require("../../store/message-map.repo");
const feishu_client_1 = require("../../outbound/feishu-client");
const teams_client_1 = require("../../outbound/teams-client");
const uuid_1 = require("uuid");
const router = (0, express_1.Router)();
/** 欢迎消息（用户安装 Bot 时自动发送） */
const WELCOME_MSG = [
    "👋 欢迎使用飞书-Teams 消息桥接！",
    "",
    "📖 使用说明：",
    "",
    "在 Teams 中：",
    "  /chat <飞书邮件前缀>  — 搜索并连接飞书用户",
    "  /select <序号>         — 从搜索结果中选择",
    "  /list                 — 查看所有会话",
    "  /who                  — 查看当前活跃会话",
    "  /help                 — 显示帮助",
    "",
    "连接后直接发消息即可跨平台转发 🔗",
].join("\n");
/**
 * 将真实 Teams Bot Framework Webhook 格式转换为内部格式
 */
function parseRealTeamsFormat(body) {
    // 真实 Teams webhook 格式
    if (body.type && ["message", "conversationUpdate"].includes(body.type)) {
        const from = body.from || {};
        const conversation = body.conversation || {};
        return {
            teamsUserKey: from.aadObjectId || from.id || "",
            conversationId: conversation.id || "",
            serviceUrl: body.serviceUrl || "",
            messageId: body.id || "",
            senderDisplay: from.name || from.id || "Unknown",
            text: body.text || "",
            timestamp: body.timestamp || new Date().toISOString(),
        };
    }
    // 测试/简化格式（向后兼容）
    if (body.teamsUserKey !== undefined) {
        return {
            teamsUserKey: body.teamsUserKey,
            conversationId: body.conversationId || "",
            serviceUrl: body.serviceUrl || "",
            messageId: body.messageId || "",
            senderDisplay: body.senderDisplay || "Unknown",
            text: body.text || "",
            timestamp: body.timestamp || new Date().toISOString(),
        };
    }
    return null;
}
/**
 * 处理 conversationUpdate 事件（用户安装/卸载 Bot）
 */
router.post("/", async (req, res) => {
    try {
        const b = req.body;
        console.log("[teams] RAW:", JSON.stringify(b).substring(0, 300));
        // --- conversationUpdate: 用户安装了 Bot ---
        if (b.type === "conversationUpdate" && b.membersAdded) {
            const botId = `28:${process.env.TEAMS_APP_ID || ""}`;
            for (const member of b.membersAdded || []) {
                if (member.id === botId) {
                    const teamsUserKey = b.from?.aadObjectId || b.from?.id || "";
                    const conversationId = b.conversation?.id || "";
                    const serviceUrl = b.serviceUrl || "";
                    if (teamsUserKey && conversationId && serviceUrl) {
                        console.log(`[teams] Bot installed by user: ${teamsUserKey}`);
                        (0, user_link_repo_1.upsertUserLink)({ teamsUserKey, conversationId, serviceUrl, createdAt: new Date().toISOString() });
                        try {
                            await (0, teams_client_1.sendTeamsProactive)(serviceUrl, conversationId, WELCOME_MSG);
                            console.log(`[teams] Welcome message sent to ${teamsUserKey}`);
                        }
                        catch (e) {
                            console.error(`[teams] Failed to send welcome message: ${e}`);
                        }
                    }
                    return res.json({ status: "installed" });
                }
            }
        }
        // --- 普通消息 ---
        const msg = parseRealTeamsFormat(b);
        if (!msg) {
            console.error("[teams] Unknown webhook format:", JSON.stringify(b).substring(0, 200));
            return res.status(400).json({ error: "unknown_format" });
        }
        console.log(`[teams] incoming msg: from=${msg.teamsUserKey} conv=${msg.conversationId} text=${msg.text.substring(0, 50)}`);
        if (msg.teamsUserKey) {
            (0, user_link_repo_1.upsertUserLink)({
                teamsUserKey: msg.teamsUserKey,
                conversationId: msg.conversationId,
                serviceUrl: msg.serviceUrl,
                createdAt: "",
            });
        }
        if ((0, message_map_repo_1.isDuplicate)("teams", msg.messageId)) {
            return res.json({ status: "duplicate" });
        }
        const action = await (0, router_1.routeTeamsInbound)(msg);
        switch (action.type) {
            case "reply_bot":
                try {
                    await (0, teams_client_1.sendTeamsProactive)(msg.serviceUrl, msg.conversationId, action.text);
                }
                catch (e) {
                    console.error("[teams] reply failed:", e);
                }
                return res.json({ status: "ok" });
            case "forward_to_feishu": {
                const uuid = (0, uuid_1.v4)();
                let dstId;
                try {
                    dstId = await (0, feishu_client_1.sendFeishuMessage)(action.peerIdType, action.peerId, action.content, action.feishuChatId);
                }
                catch (e) {
                    console.error(`[teams->feishu] send failed: HTTP=${e?.response?.status} code=${e?.response?.data?.code} msg=${e?.response?.data?.msg} violations=${JSON.stringify(e?.response?.data?.error?.field_violations)} peerIdType=${action.peerIdType} peerId=${action.peerId} chatId=${action.feishuChatId} contentLen=${action.content?.length}`);
                    // Fallback: notify user of failure via Teams
                    try {
                        await (0, teams_client_1.sendTeamsProactive)(msg.serviceUrl, msg.conversationId, "⚠️ 消息发送失败，请稍后重试");
                    }
                    catch { }
                    return res.status(500).json({ error: "forward_failed" });
                }
                (0, message_map_repo_1.saveMessageMap)({
                    srcPlatform: "teams",
                    srcMessageId: msg.messageId,
                    dstPlatform: "feishu",
                    dstMessageId: dstId,
                    sessionId: action.sessionId,
                    uuid,
                    createdAt: "",
                });
                // 消息已转发到飞书，不需要额外回复
                return res.json({ status: "forwarded" });
            }
            case "notify_and_create_idle": {
                // v3-final ensureReverseSession 模式：先判断决策，再决定发送行为
                const { findActive, findOrCreate, buildSessionId, getDb, incrementUnread, savePendingMessage, activateSession, clearUnread } = await Promise.resolve().then(() => __importStar(require("../../store/session.repo")));
                const { getFeishuUserByOpenId } = await Promise.resolve().then(() => __importStar(require("../../outbound/feishu-client")));
                const { formatFromTeams, formatAutoActivatedTip } = await Promise.resolve().then(() => __importStar(require("../../core/formatter")));
                const { v4: freshUuid } = await Promise.resolve().then(() => __importStar(require("uuid")));
                // 找飞书用户（receiver）以 Teams 用户（sender）为 peer 的 session
                const { findSessionByPeerAnyOwner } = await Promise.resolve().then(() => __importStar(require("../../store/session.repo")));
                const existingSession = findSessionByPeerAnyOwner(action.teamsUserKey);
                const feishuOpenId = existingSession?.ownerPlatform === "teams"
                    ? existingSession.peerReceiveId
                    : (existingSession?.ownerKey ?? "");
                if (!feishuOpenId) {
                    console.error("[teams->feishu] notify_and_create_idle: no feishuOpenId for", action.teamsUserKey);
                    return res.json({ status: "error" });
                }
                // senderAsPeer: Teams 发送方作为飞书用户的 peer
                const senderAsPeer = existingSession
                    ? { platform: "teams", receiveId: action.teamsUserKey, receiveIdType: "aad_id", displayName: existingSession.displayName, email: existingSession.peerEmail || "" }
                    : { platform: "teams", receiveId: action.teamsUserKey, receiveIdType: "aad_id", displayName: action.senderDisplay, email: "" };
                // Step 1: 确保接收方（飞书用户）存在反向 session
                const revSid = buildSessionId("teams", senderAsPeer.receiveIdType, senderAsPeer.receiveId);
                const rev = findOrCreate(feishuOpenId, "feishu", senderAsPeer);
                const revSessionId = rev.sessionId;
                // Step 2: 查接收方当前 active session
                const cur = findActive(feishuOpenId, "feishu");
                const formattedContent = formatFromTeams(action.senderDisplay, msg.text);
                if (cur && cur.peerReceiveId === action.teamsUserKey) {
                    // 正好是发给当前 active 的 peer → 直接投递
                    const feishuChatId = cur.feishuChatId || feishuOpenId;
                    try {
                        await (0, feishu_client_1.sendFeishuMessage)("open_id", feishuOpenId, formattedContent, feishuChatId);
                        (0, message_map_repo_1.saveMessageMap)({ srcPlatform: "teams", srcMessageId: msg.messageId, dstPlatform: "feishu", dstMessageId: "", sessionId: revSessionId, uuid: freshUuid(), createdAt: "" });
                    }
                    catch (e) {
                        console.error(`[teams->feishu] deliver failed:`, e?.message);
                    }
                    return res.json({ status: "ok" });
                }
                else if (cur) {
                    // Bug #7 修复：peer mismatch 检测——接收方 active 是别人（另一个 Teams 用户）
                    // 类似于 feishu.ts 的 peer mismatch 逻辑：存 pending + 发通知
                    console.log(`[teams->feishu] peer mismatch: cur.peerReceiveId=${cur.peerReceiveId?.substring(0, 8)} action.teamsUserKey=${action.teamsUserKey?.substring(0, 8)}`);
                    incrementUnread(feishuOpenId, revSessionId);
                    savePendingMessage(revSessionId, feishuOpenId, formattedContent, msg.timestamp);
                    (0, message_map_repo_1.saveMessageMap)({ srcPlatform: "teams", srcMessageId: msg.messageId, dstPlatform: "feishu", dstMessageId: "", sessionId: revSessionId, uuid: freshUuid(), createdAt: "" });
                    const { formatNonActiveNotification } = await Promise.resolve().then(() => __importStar(require("../../core/formatter")));
                    let teamsEmailPrefix = action.senderDisplay;
                    try {
                        const { getFeishuUserByOpenId: gf } = await Promise.resolve().then(() => __importStar(require("../../outbound/feishu-client")));
                        const teamsUser = await gf(action.teamsUserKey).catch(() => null);
                        if (teamsUser?.email)
                            teamsEmailPrefix = teamsUser.email.split("@")[0];
                    }
                    catch { /* ignore */ }
                    const feishuNotif = formatNonActiveNotification(action.senderDisplay, (await Promise.resolve().then(() => __importStar(require("../../store/session.repo")))).getDb().prepare("SELECT unread_count FROM sessions WHERE session_id=? AND owner_key=?").get(revSessionId, feishuOpenId)?.unread_count || 1, undefined, teamsEmailPrefix);
                    try {
                        await (0, feishu_client_1.sendFeishuMessage)("open_id", feishuOpenId, feishuNotif, feishuOpenId);
                    }
                    catch (e) {
                        console.error(`[teams->feishu] notify failed:`, e?.message);
                    }
                    return res.json({ status: "ok" });
                }
                else {
                    // deliver_activated: 接收方无 active → 自动激活 + 先发提示再发正文
                    activateSession(feishuOpenId, "feishu", revSessionId);
                    const { default: dbRef } = await Promise.resolve().then(() => __importStar(require("../../store/db")));
                    activateSession(action.teamsUserKey, "teams", revSessionId);
                    dbRef.prepare("UPDATE sessions SET last_message_at=datetime('now') WHERE session_id=? AND owner_key=?").run(revSessionId, feishuOpenId);
                    clearUnread(feishuOpenId, revSessionId);
                    clearUnread(action.teamsUserKey, revSessionId);
                    const tip = formatAutoActivatedTip(action.senderDisplay, "teams");
                    try {
                        await (0, feishu_client_1.sendFeishuMessage)("open_id", feishuOpenId, tip, feishuOpenId);
                        await (0, feishu_client_1.sendFeishuMessage)("open_id", feishuOpenId, formattedContent, feishuOpenId);
                        (0, message_map_repo_1.saveMessageMap)({ srcPlatform: "teams", srcMessageId: msg.messageId, dstPlatform: "feishu", dstMessageId: "", sessionId: revSessionId, uuid: freshUuid(), createdAt: "" });
                    }
                    catch (e) {
                        console.error(`[teams->feishu] deliver_activated failed:`, e?.message);
                    }
                    return res.json({ status: "ok" });
                }
            }
            case "notify_non_active": {
                // Feishu→Teams 方向：飞书用户发消息给 Teams 用户，但对方 session 处于 idle
                // v3-final ensureReverseSession 决策：notify
                const { findSessionByPeerReceiveIdAndOwnerPlatform, incrementUnread, savePendingMessage } = await Promise.resolve().then(() => __importStar(require("../../store/session.repo")));
                const { formatNonActiveNotification, formatFromFeishu } = await Promise.resolve().then(() => __importStar(require("../../core/formatter")));
                const { v4: freshUuid } = await Promise.resolve().then(() => __importStar(require("uuid")));
                const teamsSession = findSessionByPeerReceiveIdAndOwnerPlatform(action.ownerKey, "teams");
                console.log(`[teams] notify_non_active: ownerKey=${action.ownerKey?.substring(0, 8)} teamsSession=${teamsSession?.sessionId} teamsSession.ownerKey=${teamsSession?.ownerKey?.substring(0, 8)}`);
                if (!teamsSession) {
                    console.error("[teams] notify_non_active: no teams session for", action.ownerKey);
                    return res.json({ status: "ok" });
                }
                incrementUnread(action.ownerKey, teamsSession.sessionId);
                // Bug #5 修复：存 formatted_content（含平台标识），不是原始文本
                const formattedContent = formatFromFeishu(action.ownerDisplay, action.rawText);
                savePendingMessage(teamsSession.sessionId, action.ownerKey, formattedContent, action.timestamp);
                // 构造通知
                let feishuEmailPrefix = action.ownerDisplay;
                try {
                    const { getFeishuUserByOpenId } = await Promise.resolve().then(() => __importStar(require("../../outbound/feishu-client")));
                    const u = (await getFeishuUserByOpenId(action.ownerKey));
                    if (u?.email)
                        feishuEmailPrefix = u.email.split("@")[0];
                }
                catch { /* ignore */ }
                const notification = formatNonActiveNotification(action.ownerDisplay, (await Promise.resolve().then(() => __importStar(require("../../store/session.repo")))).getDb().prepare("SELECT unread_count FROM sessions WHERE session_id=? AND owner_key=?").get(teamsSession.sessionId, action.ownerKey)?.unread_count || 1, undefined, feishuEmailPrefix);
                // Bug #3 修复：sendTeamsProactiveByKey 现在会 throw，调用方 catch 后通知发送方
                // 注意：要用 teamsSession.ownerKey（Teams AAD ID），不能用 action.ownerKey（Feishu open_id）
                console.log(`[teams] notify_non_active: sending to teamsSession.ownerKey=${teamsSession.ownerKey?.substring(0, 8)} notification=${notification.substring(0, 60)}`);
                try {
                    await (0, teams_client_1.sendTeamsProactiveByKey)(teamsSession.ownerKey, notification);
                }
                catch (e) {
                    console.error("[teams] notify_non_active: send failed:", e?.message);
                    // 通知发送方（飞书用户）发送失败
                    try {
                        const { sendFeishuMessage: sf } = await Promise.resolve().then(() => __importStar(require("../../outbound/feishu-client")));
                        await sf("open_id", action.ownerKey, "⚠️ 消息发送失败，对方可能未安装 Bot", action.ownerKey);
                    }
                    catch { /* ignore */ }
                }
                // Bug #6 修复：notify 路径也写 message_map
                (0, message_map_repo_1.saveMessageMap)({ srcPlatform: "feishu", srcMessageId: "", dstPlatform: "teams", dstMessageId: "", sessionId: teamsSession.sessionId, uuid: freshUuid(), createdAt: "" });
                return res.json({ status: "ok" });
            }
            default:
                return res.json({ status: "ok" });
        }
    }
    catch (e) {
        console.error("[inbound/teams]", e);
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;
//# sourceMappingURL=teams.js.map