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
const message_map_repo_1 = require("../../store/message-map.repo");
const teams_client_1 = require("../../outbound/teams-client");
const graph_client_1 = require("../../outbound/graph-client");
const feishu_client_1 = require("../../outbound/feishu-client");
const formatter_1 = require("../../core/formatter");
const session_repo_1 = require("../../store/session.repo");
const uuid_1 = require("uuid");
function extractText(evt) {
    try {
        return JSON.parse(evt.message?.content || "{}").text || "";
    }
    catch {
        return "";
    }
}
const HELP_MSG = [
    "📖 飞书端指令帮助",
    "",
    "/chat <Teams邮件前缀> — 搜索 Teams 用户并发起会话",
    "/select <序号>        — 从搜索结果中选择",
    "/connect teams:<邮箱> — 直接连接 Teams 用户",
    "/list                 — 查看所有会话",
    "/who                  — 查看当前活跃会话",
    "/clear                — 清空所有会话",
    "/help                 — 显示本帮助",
    "",
    "💡 连接后直接发消息即可跨平台转发 🔗",
].join("\n");
const router = (0, express_1.Router)();
router.post("/", async (req, res) => {
    try {
        const b = req.body;
        if (b.challenge)
            return res.json({ challenge: b.challenge });
        const evt = b.event || {};
        const senderOpenId = evt.sender?.sender_id?.open_id || b.senderOpenId || "";
        const senderDisplay = evt.sender?.name || b.senderDisplay || senderOpenId;
        const chatId = evt.message?.chat_id || b.chatId || "";
        const messageId = evt.message?.message_id || b.messageId || "";
        const rawText = b.text || extractText(evt) || "";
        // 如果 senderDisplay 是 open_id（事件中无名称），尝试获取用户真实姓名
        let resolvedSenderDisplay = senderDisplay;
        if (senderDisplay === senderOpenId && senderOpenId) {
            try {
                const userInfo = await (0, feishu_client_1.getFeishuUserByOpenId)(senderOpenId);
                if (userInfo?.name)
                    resolvedSenderDisplay = userInfo.name;
            }
            catch { /* ignore */ }
        }
        if ((0, message_map_repo_1.isDuplicate)("feishu", messageId))
            return res.json({ status: "duplicate" });
        // 命令解析
        const cmdMatch = /^\/(\S+)(?:\s+(.*))?$/i.exec(rawText.trim());
        const cmd = cmdMatch ? cmdMatch[1].toLowerCase() : null;
        const args = cmdMatch?.[2]?.trim() || "";
        // ownerKey = 飞书用户的 open_id
        const ownerKey = senderOpenId;
        // 动态导入（避免循环依赖）
        const sm = await Promise.resolve().then(() => __importStar(require("../../core/session-manager")));
        const { default: db } = await Promise.resolve().then(() => __importStar(require("../../store/db")));
        // --- /chat <Teams邮件前缀> ---
        if (cmd === "chat") {
            if (!args) {
                const reply = "⚠️ 请指定邮件前缀：/chat <Teams邮件前缀>\n示例：/chat alice@company.com";
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                }
                catch { /* ignore */ }
                return res.json({ status: "ok" });
            }
            try {
                const results = await (0, graph_client_1.searchTeamsUsers)(args);
                if (results.length === 0) {
                    const reply = `❌ 未找到匹配用户：${args}\n\n请检查邮件前缀后重试`;
                    try {
                        await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                    }
                    catch { /* ignore */ }
                    return res.json({ status: "ok" });
                }
                if (results.length === 1) {
                    // 获取飞书用户信息（用于在 Teams 侧 session 显示）
                    const feishuUser = await (0, feishu_client_1.getFeishuUserByOpenId)(ownerKey).catch(() => null);
                    const feishuDisplayName = feishuUser?.name || ownerKey;
                    const feishuEmail = feishuUser?.email || "";
                    // 使用 findOrCreate 查找/创建 session（优先返回有 pending 的 idle session）
                    const { findOrCreate, activateSession, flushPendingMessages, getDb } = await Promise.resolve().then(() => __importStar(require("../../store/session.repo")));
                    const { formatUnreadReplay } = await Promise.resolve().then(() => __importStar(require("../../core/formatter")));
                    const feishuSearchResult = {
                        email: results[0].email,
                        displayName: results[0].displayName,
                        platform: "teams",
                        receiveIdType: results[0].receiveIdType || "user_key",
                        receiveId: results[0].receiveId,
                    };
                    // 查找/创建飞书用户侧的 session
                    const feishuSession = findOrCreate(ownerKey, "feishu", feishuSearchResult);
                    const teamsSearchResult = {
                        email: feishuEmail,
                        displayName: feishuDisplayName,
                        platform: "feishu",
                        receiveIdType: "open_id",
                        receiveId: ownerKey,
                    };
                    const teamsSession = findOrCreate(results[0].receiveId, "teams", teamsSearchResult);
                    // 激活 session
                    activateSession(ownerKey, "feishu", feishuSession.sessionId);
                    activateSession(results[0].receiveId, "teams", teamsSession.sessionId);
                    // 更新 feishu_chat_id
                    getDb().prepare("UPDATE sessions SET feishu_chat_id=? WHERE session_id=? AND owner_key=?").run(chatId, feishuSession.sessionId, ownerKey);
                    // 回放 pending 消息（如果有）
                    const unreadPending = flushPendingMessages(ownerKey, feishuSession.sessionId);
                    let reply = `✅ 找到唯一匹配：${results[0].displayName}（${results[0].email}）\n已自动切换到与【${results[0].displayName}（Teams）】的对话`;
                    if (unreadPending.length > 0)
                        reply += "\n\n" + formatUnreadReplay(unreadPending);
                    try {
                        await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                    }
                    catch { /* ignore */ }
                    return res.json({ status: "ok" });
                }
                // 多结果：暂存并展示列表
                savePendingSelectionsToFile(ownerKey, results);
                const lines = results.map((r, i) => `${i + 1}️⃣  ${r.email} — ${r.displayName}${r.department ? `（${r.department}）` : ""}`);
                const reply = `🔍 搜索结果：\n\n${lines.join("\n")}\n\n👉 输入 /select <序号> 选择对象`;
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                }
                catch { /* ignore */ }
                return res.json({ status: "ok" });
            }
            catch (e) {
                console.error("[feishu /chat] error:", e);
                const reply = `❌ 搜索失败：${e?.message || e}`;
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                }
                catch { /* ignore */ }
                return res.json({ status: "ok" });
            }
        }
        // --- /select <序号> ---
        if (cmd === "select") {
            const idx = parseInt(args, 10);
            if (isNaN(idx)) {
                const reply = "⚠️ 请输入数字：/select <序号>";
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                }
                catch { /* ignore */ }
                return res.json({ status: "ok" });
            }
            const pending = getPendingSelectionsFromFile(ownerKey);
            if (!pending || pending.length === 0) {
                const reply = "⚠️ 没有待选择的搜索结果\n请先使用 /chat <邮件前缀> 搜索";
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                }
                catch { /* ignore */ }
                return res.json({ status: "ok" });
            }
            if (idx < 1 || idx > pending.length) {
                const reply = "⚠️ 序号超出范围，请重新选择";
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                }
                catch { /* ignore */ }
                return res.json({ status: "ok" });
            }
            const selected = pending[idx - 1];
            // 获取飞书用户信息（用于在 Teams 侧 session 显示）
            const feishuUser = await (0, feishu_client_1.getFeishuUserByOpenId)(ownerKey).catch(() => null);
            const feishuDisplayName = feishuUser?.name || ownerKey;
            const feishuEmail = feishuUser?.email || "";
            // 使用 findOrCreate 查找/创建 session（优先返回有 pending 的 idle session）
            const { findOrCreate, activateSession, flushPendingMessages, getDb } = await Promise.resolve().then(() => __importStar(require("../../store/session.repo")));
            const { formatUnreadReplay } = await Promise.resolve().then(() => __importStar(require("../../core/formatter")));
            const feishuSearchResult = {
                email: selected.email,
                displayName: selected.displayName,
                platform: "teams",
                receiveIdType: selected.receiveIdType || "user_key",
                receiveId: selected.receiveId,
            };
            const feishuSession = findOrCreate(ownerKey, "feishu", feishuSearchResult);
            const teamsSearchResult = {
                email: feishuEmail,
                displayName: feishuDisplayName,
                platform: "feishu",
                receiveIdType: "open_id",
                receiveId: ownerKey,
            };
            const teamsSession = findOrCreate(selected.receiveId, "teams", teamsSearchResult);
            activateSession(ownerKey, "feishu", feishuSession.sessionId);
            activateSession(selected.receiveId, "teams", teamsSession.sessionId);
            getDb().prepare("UPDATE sessions SET feishu_chat_id=? WHERE session_id=? AND owner_key=?").run(chatId, feishuSession.sessionId, ownerKey);
            clearPendingSelectionsFromFile(ownerKey);
            // 回放 pending 消息（如果有）
            const unreadPending = flushPendingMessages(ownerKey, feishuSession.sessionId);
            let reply = `✅ 已切换到与【${selected.displayName}（Teams）】的对话`;
            if (unreadPending.length > 0)
                reply += "\n\n" + formatUnreadReplay(unreadPending);
            try {
                await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
            }
            catch { /* ignore */ }
            return res.json({ status: "ok" });
        }
        // --- /connect teams:<邮箱> ---
        if (cmd === "connect" && args.toLowerCase().startsWith("teams:")) {
            const email = args.slice(6).trim();
            if (!email) {
                const reply = "⚠️ 请指定邮箱：/connect teams:<邮箱>\n示例：/connect teams:zhengya@company.com";
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                }
                catch { /* ignore */ }
                return res.json({ status: "ok" });
            }
            try {
                const results = await (0, graph_client_1.searchTeamsUsers)(email);
                if (results.length === 0) {
                    const reply = `❌ 未找到 Teams 用户：${email}\n\n请检查邮箱是否正确`;
                    try {
                        await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                    }
                    catch { /* ignore */ }
                    return res.json({ status: "ok" });
                }
                const user = results[0];
                // 获取飞书用户信息（用于在 Teams 侧 session 显示和主动消息）
                const feishuUser = await (0, feishu_client_1.getFeishuUserByOpenId)(ownerKey).catch(() => null);
                const feishuDisplayName = feishuUser?.name || ownerKey;
                const feishuEmail = feishuUser?.email || "";
                // 创建 conversation 并发主动消息
                try {
                    console.log("[feishu /connect] Creating conv for:", user.receiveId);
                    await createTeamsConversationAndSend(user.receiveId, `💬 ${feishuDisplayName}（飞书）请求与您建立会话。\n\n请回复任意消息开始沟通。`, feishuDisplayName);
                }
                catch (e) {
                    console.error("[feishu /connect] Teams proactive failed:", e?.message);
                    const reply = `❌ 连接失败：${e?.message || "请确认对方在 Teams 上安装了 Bot"}`;
                    try {
                        await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                    }
                    catch { /* ignore */ }
                    return res.json({ status: "ok" });
                }
                // 建立 session（双向）
                const { buildSessionId, deactivateAll } = await Promise.resolve().then(() => __importStar(require("../../store/session.repo")));
                const thisChatId = chatId;
                const txn = db.transaction(() => {
                    // Feishu 侧 session
                    deactivateAll(ownerKey, "feishu");
                    const feishuSid = buildSessionId("teams", "user_key", user.receiveId);
                    db.prepare(`INSERT OR REPLACE INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state,unread_count,feishu_chat_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(feishuSid, ownerKey, "feishu", "teams", user.receiveIdType || "user_key", user.receiveId, user.email, user.displayName, "active", 0, thisChatId);
                    db.prepare(`INSERT OR REPLACE INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(ownerKey, 'feishu', feishuSid);
                    // Teams 侧 session（让 Teams 发消息给这个飞书用户），peerEmail 存飞书用户的邮箱
                    const teamsSid = buildSessionId("feishu", "open_id", ownerKey);
                    db.prepare(`INSERT OR REPLACE INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state,unread_count,feishu_chat_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(teamsSid, user.receiveId, "teams", "feishu", "open_id", ownerKey, feishuEmail, feishuDisplayName, "active", 0, thisChatId);
                    db.prepare(`INSERT OR REPLACE INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(user.receiveId, 'teams', teamsSid);
                });
                txn();
                const reply = `✅ 已找到并连接：${user.displayName}（${user.email}）\n\n已切换到与【${user.displayName}（Teams）】的对话`;
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                }
                catch { /* ignore */ }
                return res.json({ status: "ok" });
            }
            catch (e) {
                console.error("[feishu /connect] error:", e);
                const reply = `❌ 连接失败：${e?.message || e}`;
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
                }
                catch { /* ignore */ }
                return res.json({ status: "ok" });
            }
        }
        // --- /list ---
        if (cmd === "list") {
            try {
                const sessions = sm.listAllSessions(ownerKey);
                const reply = (0, formatter_1.formatSessionList)(sessions);
                await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
            }
            catch (e) {
                console.error("[feishu /list] send failed:", e?.message);
            }
            return res.json({ status: "ok" });
        }
        // --- /who ---
        if (cmd === "who") {
            try {
                const s = sm.getActiveSession(ownerKey, "feishu");
                const reply = (0, formatter_1.formatWhoReply)(s);
                await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
            }
            catch (e) {
                console.error("[feishu /who] send failed:", e?.message);
            }
            return res.json({ status: "ok" });
        }
        // --- /help ---
        if (cmd === "help") {
            try {
                await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, HELP_MSG, chatId);
            }
            catch (e) {
                console.error("[feishu /help] send failed:", e?.message);
            }
            return res.json({ status: "ok" });
        }
        // --- /clear ---
        if (cmd === "clear") {
            try {
                sm.clearAllSessions(ownerKey);
                await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, "🗑️ 所有会话已清空", chatId);
            }
            catch (e) {
                console.error("[feishu /clear] send failed:", e?.message);
            }
            return res.json({ status: "ok" });
        }
        // --- 普通消息路由：区分两种场景 ---
        // 场景 A：飞书用户主动发给 Teams（飞书用户拥有 active feishu→teams session）
        // 场景 B：飞书用户回复 Teams 用户的消息（Teams 用户拥有 teams→feishu session，飞书用户是 peer）
        let active = sm.getActiveSession(ownerKey, "feishu");
        let isScenarioB = false;
        let teamsSession;
        // 查找 Teams 侧 session（以该飞书用户为 peer）：
        // 当 active 存在时 → 用 findActiveByOwnerAndPeer 获取 Feishu 用户的 active Teams session
        // 当 active 不存在时 → 用 findSessionByOwnerKey 查找 Teams 侧 session（owner=Teams用户）
        const { findActiveByOwnerAndPeer, findSessionByOwnerKey, findSessionByPeerReceiveIdAndOwnerPlatform } = await Promise.resolve().then(() => __importStar(require("../../store/session.repo")));
        const peerSession = active
            ? findActiveByOwnerAndPeer(ownerKey, "feishu", "teams") // Feishu 用户的 active Teams session
            : findSessionByOwnerKey(ownerKey, "teams"); // 当无 active 时，查找 Teams 侧 session
        // === 路由判断（参考 v3-final ensureReverseSession 逻辑） ===
        // 1. active 存在，且 peerReceiveId === teamsUserKey → 直接投递（场景 A）
        // 2. active 存在，但 peerReceiveId !== teamsUserKey → pending（不该发给其他人）
        // 3. active 不存在，有 peerSession（idle） → pending + 通知
        // 4. active 不存在，无 peerSession → 提示
        if (active) {
            // 场景 A：有 active session
            const teamsUserKey = active.peerReceiveId;
            if (teamsSession) {
                // 已经有与该 Teams 用户的 session（之前场景 B 找到的）
                // → 直接投递
                isScenarioB = true;
                const { activateSession, clearUnread } = await Promise.resolve().then(() => __importStar(require("../../store/session.repo")));
                const { default: db } = await Promise.resolve().then(() => __importStar(require("../../store/db")));
                db.transaction(() => {
                    activateSession(ownerKey, "feishu", peerSession.sessionId);
                    activateSession(peerSession.ownerKey, peerSession.ownerPlatform, peerSession.sessionId);
                })();
                clearUnread(ownerKey, peerSession.sessionId);
                clearUnread(peerSession.ownerKey, peerSession.sessionId);
                active = peerSession;
            }
            else {
                // 用 active.peerReceiveId 投递（场景 A）
                // 检查是否有与另一个 Teams 用户的 peerSession（场景 B 情况）
                const anyPeerSession = findSessionByPeerReceiveIdAndOwnerPlatform(ownerKey, "teams");
                // 比较 ownerKey（Teams 用户 ID）而不是 peerReceiveId
                console.log(`[FEISHU-IN] peer mismatch check: active.peerReceiveId=${active.peerReceiveId?.substring(0, 8)} anyPeerSession.ownerKey=${anyPeerSession?.ownerKey?.substring(0, 8)} anyPeerSession.sessionId=${anyPeerSession?.sessionId}`);
                if (anyPeerSession && anyPeerSession.ownerKey !== active.peerReceiveId) {
                    // active 存在，但用户也在和另一个 Teams 用户通信 → pending
                    const ts = evt.message?.createTime || evt.message?.create_time || new Date().toISOString();
                    const { incrementUnread, savePendingMessage } = await Promise.resolve().then(() => __importStar(require("../../store/session.repo")));
                    const { sendTeamsProactiveByKey } = await Promise.resolve().then(() => __importStar(require("../../outbound/teams-client")));
                    const targetTeamsUser = anyPeerSession.ownerKey; // Teams 用户的 AAD ID
                    console.log(`[FEISHU-IN] active exists but peer mismatch: target=${targetTeamsUser.substring(0, 8)}`);
                    incrementUnread(targetTeamsUser, anyPeerSession.sessionId);
                    // Bug #5 修复：存 formatted_content（含平台标识），不是原始文本
                    const formattedContent = (0, formatter_1.formatFromFeishu)(resolvedSenderDisplay, rawText);
                    savePendingMessage(anyPeerSession.sessionId, targetTeamsUser, formattedContent, ts);
                    let feishuEmailPrefix = resolvedSenderDisplay;
                    try {
                        const feishuUser = await (0, feishu_client_1.getFeishuUserByOpenId)(ownerKey).catch(() => null);
                        if (feishuUser?.email)
                            feishuEmailPrefix = feishuUser.email.split("@")[0];
                    }
                    catch { /* ignore */ }
                    const dbRef = (await Promise.resolve().then(() => __importStar(require("../../store/db")))).default;
                    const { formatNonActiveNotification } = await Promise.resolve().then(() => __importStar(require("../../core/formatter")));
                    const unreadCount = dbRef.prepare("SELECT unread_count FROM sessions WHERE session_id=? AND owner_key=?").get(anyPeerSession.sessionId, targetTeamsUser)?.unread_count || 1;
                    const teamsNotif = formatNonActiveNotification(resolvedSenderDisplay, unreadCount, undefined, feishuEmailPrefix);
                    // Bug #3 修复：sendTeamsProactiveByKey 现在会 throw
                    try {
                        await sendTeamsProactiveByKey(targetTeamsUser, teamsNotif);
                    }
                    catch (e) {
                        console.error(`[FEISHU-IN] notify send failed:`, e?.message);
                    }
                    // Bug #6 修复：写 message_map 审计
                    (0, message_map_repo_1.saveMessageMap)({ srcPlatform: "feishu", srcMessageId: messageId, dstPlatform: "teams", dstMessageId: "", sessionId: anyPeerSession.sessionId, uuid: (0, uuid_1.v4)(), createdAt: "" });
                    // 注意：飞书发送方（senderOpenId）不需收到任何通知。
                    return res.json({ status: "ok" });
                }
                // 正常投递场景 A
            }
        }
        else if (peerSession) {
            // 无 active，但有与某 Teams 用户的 session（idle）→ deliver_activated：自动激活 + 先发提示再发正文
            const ts = evt.message?.createTime || evt.message?.create_time || new Date().toISOString();
            const { incrementUnread, savePendingMessage, activateSession, clearUnread } = await Promise.resolve().then(() => __importStar(require("../../store/session.repo")));
            const { sendTeamsProactiveByKey } = await Promise.resolve().then(() => __importStar(require("../../outbound/teams-client")));
            const { formatFromFeishu } = await Promise.resolve().then(() => __importStar(require("../../core/formatter")));
            const teamsUserKey = peerSession.ownerKey;
            console.log(`[FEISHU-IN] no active, peerSession idle: teamsUserKey=${teamsUserKey.substring(0, 8)}`);
            // Bug #4 修复：deliver_activated → 先发提示再发正文
            const formattedContent = formatFromFeishu(resolvedSenderDisplay, rawText);
            const tip = (0, formatter_1.formatAutoActivatedTip)(resolvedSenderDisplay, "feishu");
            // 自动激活双方的 session
            const txn = db.transaction(() => {
                activateSession(ownerKey, "feishu", peerSession.sessionId);
                activateSession(teamsUserKey, peerSession.ownerPlatform, peerSession.sessionId);
            });
            txn();
            clearUnread(ownerKey, peerSession.sessionId);
            clearUnread(teamsUserKey, peerSession.sessionId);
            // 先发提示，再发正文
            // Bug #3 修复：sendTeamsProactiveByKey 会 throw
            try {
                await sendTeamsProactiveByKey(teamsUserKey, tip);
                await sendTeamsProactiveByKey(teamsUserKey, formattedContent);
                (0, message_map_repo_1.saveMessageMap)({ srcPlatform: "feishu", srcMessageId: messageId, dstPlatform: "teams", dstMessageId: "", sessionId: peerSession.sessionId, uuid: (0, uuid_1.v4)(), createdAt: "" });
            }
            catch (e) {
                console.error(`[FEISHU-IN] deliver_activated failed:`, e?.message);
                // 通知发送方
                try {
                    await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, "⚠️ 消息发送失败，对方可能未安装 Bot", chatId);
                }
                catch { /* ignore */ }
            }
            return res.json({ status: "ok" });
        }
        else {
            // 无 active 且无 peerSession → 返回提示，让用户先通过 /chat 建立会话
            // 参考飞书 Bot 处理非当前会话的做法：提示用户先建立连接
            const reply = (0, formatter_1.formatNoActiveWarning)();
            try {
                await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, reply, chatId);
            }
            catch { /* ignore */ }
            return res.json({ status: "ok" });
        }
        // 转发消息：场景 A 时用 active.peerReceiveId；场景 B 时用 teamsSession.ownerKey
        const content = (0, formatter_1.formatFromFeishu)(resolvedSenderDisplay, rawText);
        const teamsUserKey = isScenarioB ? (teamsSession?.ownerKey ?? active.peerReceiveId) : active.peerReceiveId;
        try {
            await (0, teams_client_1.sendTeamsProactiveByKey)(teamsUserKey, content);
            const uuid = (0, uuid_1.v4)();
            (0, message_map_repo_1.saveMessageMap)({
                srcPlatform: "feishu",
                srcMessageId: messageId,
                dstPlatform: "teams",
                dstMessageId: "",
                sessionId: active.sessionId,
                uuid,
                createdAt: "",
            });
        }
        catch (e) {
            console.error("[feishu->teams] forward failed:", e?.message);
            try {
                await (0, feishu_client_1.sendFeishuMessage)("open_id", senderOpenId, "⚠️ 消息发送失败，请稍后重试", chatId);
            }
            catch { /* ignore */ }
            return res.json({ status: "ok" });
        }
        return res.json({ status: "forwarded" });
    }
    catch (e) {
        console.error("[inbound/feishu]", e);
        res.status(500).json({ error: "internal" });
    }
});
// ===== Pending Selections (多结果选择) =====
// 直接使用顶部导入的 session.repo 函数（db 在模块级别已初始化，无循环依赖）
function savePendingSelectionsToFile(ownerKey, results) {
    (0, session_repo_1.savePendingSelections)(ownerKey, results);
}
function getPendingSelectionsFromFile(ownerKey) {
    return (0, session_repo_1.getPendingSelections)(ownerKey);
}
function clearPendingSelectionsFromFile(ownerKey) {
    (0, session_repo_1.clearPendingSelections)(ownerKey);
}
/**
 * 向 Teams 用户发主动消息（优先用已缓存的 conversation）
 * @param teamsUserAadId Teams 用户的 AAD ID
 * @param text 消息内容
 * @param senderDisplayName 发送方（飞书用户）的显示名称
 */
async function createTeamsConversationAndSend(teamsUserAadId, text, senderDisplayName) {
    const { getUserLink } = await Promise.resolve().then(() => __importStar(require("../../store/user-link.repo")));
    const { sendTeamsProactive } = await Promise.resolve().then(() => __importStar(require("../../outbound/teams-client")));
    const { upsertUserLink } = await Promise.resolve().then(() => __importStar(require("../../store/user-link.repo")));
    // 先查 user_links，看是否有现成的 conversation
    const existing = getUserLink(teamsUserAadId);
    if (existing) {
        console.log(`[feishu /connect] reusing cached conversation for ${teamsUserAadId}`);
        try {
            await sendTeamsProactive(existing.serviceUrl, existing.conversationId, text);
            return;
        }
        catch (e) {
            console.warn(`[feishu /connect] cached conv failed (${e?.message}), trying to recreate`);
        }
    }
    // 没有缓存，创建新 conversation
    const { ensureTeamsToken } = await Promise.resolve().then(() => __importStar(require("../../outbound/teams-client")));
    const token = await ensureTeamsToken();
    const tenantId = process.env.GRAPH_TENANT_ID || "";
    const createUrl = `https://smba.trafficmanager.net/amer/v3/conversations`;
    const createPayload = {
        bot: { tenantId, id: process.env.TEAMS_BOT_ID || process.env.TEAMS_APP_ID },
        isGroup: false,
        members: [{ "odata.type": "microsoft.bot.service.bots.v4.channels.teams.IOSBotChannel", "aadObjectId": teamsUserAadId }],
        channelData: { tenant: tenantId },
    };
    const cr = await fetch(createUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(createPayload),
    });
    if (!cr.ok) {
        const errText = await cr.text();
        throw new Error(`createConversation: ${cr.status} ${errText}`);
    }
    const conv = await cr.json();
    if (!conv.id || !conv.serviceUrl)
        throw new Error("missing conversation id/serviceUrl");
    upsertUserLink({ teamsUserKey: teamsUserAadId, conversationId: conv.id, serviceUrl: conv.serviceUrl, createdAt: new Date().toISOString() });
    await sendTeamsProactive(conv.serviceUrl, conv.id, text);
}
exports.default = router;
//# sourceMappingURL=feishu.js.map