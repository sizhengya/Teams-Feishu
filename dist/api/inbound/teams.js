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
const fmt = __importStar(require("../../core/formatter"));
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
                let dstId = "";
                try {
                    // deliver_activated：先发提示再发正文（design §4 + spec §4）
                    if (action.tip) {
                        await (0, feishu_client_1.sendFeishuMessage)(action.peerIdType, action.peerId, action.tip, action.feishuChatId);
                    }
                    dstId = await (0, feishu_client_1.sendFeishuMessage)(action.peerIdType, action.peerId, action.content, action.feishuChatId);
                }
                catch (e) {
                    console.error(`[teams->feishu] send failed: HTTP=${e?.response?.status} code=${e?.response?.data?.code} msg=${e?.response?.data?.msg} violations=${JSON.stringify(e?.response?.data?.error?.field_violations)} peerIdType=${action.peerIdType} peerId=${action.peerId} chatId=${action.feishuChatId} contentLen=${action.content?.length}`);
                    try {
                        await (0, teams_client_1.sendTeamsProactive)(msg.serviceUrl, msg.conversationId, "⚠️ 消息发送失败，请稍后重试");
                    }
                    catch { /* ignore */ }
                    return res.status(500).json({ error: "forward_failed" });
                }
                // spec §4 第 4 步：无论何种 decision 都写 message_map（保留 srcMessageId 做去重）
                (0, message_map_repo_1.saveMessageMap)({
                    srcPlatform: "teams",
                    srcMessageId: action.srcMessageId,
                    dstPlatform: "feishu",
                    dstMessageId: dstId,
                    sessionId: action.sessionId,
                    uuid,
                    createdAt: "",
                });
                return res.json({ status: "forwarded" });
            }
            case "notify_feishu_peer": {
                // notify：不投递正文；发给接收方（飞书用户）通知文案
                const { getFeishuUserByOpenId } = await Promise.resolve().then(() => __importStar(require("../../outbound/feishu-client")));
                // 发送方邮箱前缀（用于 /chat 提示）
                let senderEmailPrefix = action.senderDisplay;
                try {
                    // Teams 发送方通过 Graph 查也可，这里简化用 displayName
                    // 若需要精确 email 前缀，可调用 graph-client.searchTeamsUsers
                }
                catch { /* ignore */ }
                const notification = fmt.formatNonActiveNotification(action.senderDisplay, action.unread, undefined, senderEmailPrefix);
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", action.receiverOpenId, notification, action.feishuChatId || action.receiverOpenId);
                }
                catch (e) {
                    console.error("[teams->feishu] notify send failed:", e?.message);
                }
                // spec §4：notify 也写 message_map 审计
                (0, message_map_repo_1.saveMessageMap)({
                    srcPlatform: "teams",
                    srcMessageId: action.srcMessageId,
                    dstPlatform: "feishu",
                    dstMessageId: "",
                    sessionId: action.sessionId,
                    uuid: (0, uuid_1.v4)(),
                    createdAt: "",
                });
                return res.json({ status: "ok" });
            }
            case "notify_teams_peer": {
                // 飞书→Teams 的 notify：由 Teams handler 里的这个 action 处理（router 不知道 feishu 入站）
                // 该分支理论上在 Teams 入站路径不会走到，保留以防路由复用。
                const { formatNonActiveNotification } = await Promise.resolve().then(() => __importStar(require("../../core/formatter")));
                const { getFeishuUserByOpenId } = await Promise.resolve().then(() => __importStar(require("../../outbound/feishu-client")));
                let emailPrefix = action.senderDisplay;
                try {
                    const u = await getFeishuUserByOpenId(action.senderOpenId).catch(() => null);
                    if (u?.email)
                        emailPrefix = u.email.split("@")[0];
                }
                catch { /* ignore */ }
                const notification = formatNonActiveNotification(action.senderDisplay, action.unread, undefined, emailPrefix);
                try {
                    await (0, teams_client_1.sendTeamsProactiveByKey)(action.teamsUserKey, notification);
                }
                catch (e) {
                    console.error("[teams handler] notify_teams_peer send failed:", e?.message);
                }
                (0, message_map_repo_1.saveMessageMap)({ srcPlatform: "feishu", srcMessageId: action.srcMessageId, dstPlatform: "teams", dstMessageId: "", sessionId: action.sessionId, uuid: (0, uuid_1.v4)(), createdAt: "" });
                return res.json({ status: "ok" });
            }
            case "noop":
                return res.json({ status: "ok" });
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