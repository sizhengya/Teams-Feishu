"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.buildSessionId = buildSessionId;
exports.findOrCreate = findOrCreate;
exports.deactivateAll = deactivateAll;
exports.activateSession = activateSession;
exports.findActive = findActive;
exports.listByOwner = listByOwner;
exports.incrementUnread = incrementUnread;
exports.clearUnread = clearUnread;
exports.getUnreadInfo = getUnreadInfo;
exports.deleteAllByOwner = deleteAllByOwner;
exports.findSessionByPeer = findSessionByPeer;
exports.findActiveByPeer = findActiveByPeer;
exports.findActiveByOwnerAndPeer = findActiveByOwnerAndPeer;
exports.findActiveSessionByOwnerKey = findActiveSessionByOwnerKey;
exports.findOtherActiveSession = findOtherActiveSession;
exports.findSessionByPeerAnyOwner = findSessionByPeerAnyOwner;
exports.findSessionByOwnerKey = findSessionByOwnerKey;
exports.findSessionByPeerReceiveIdAndOwnerPlatform = findSessionByPeerReceiveIdAndOwnerPlatform;
exports.updateFeishuChatId = updateFeishuChatId;
exports.savePendingSelections = savePendingSelections;
exports.getPendingSelections = getPendingSelections;
exports.clearPendingSelections = clearPendingSelections;
exports.savePendingMessage = savePendingMessage;
exports.flushPendingMessages = flushPendingMessages;
exports.clearPendingMessagesForOwner = clearPendingMessagesForOwner;
const db_1 = __importDefault(require("./db"));
function r2s(r) { return { sessionId: r.session_id, ownerKey: r.owner_key, ownerPlatform: r.owner_platform, peerPlatform: r.peer_platform, peerReceiveIdType: r.peer_receive_id_type, peerReceiveId: r.peer_receive_id, peerEmail: r.peer_email, displayName: r.display_name, state: r.state, unreadCount: r.unread_count, lastMessageAt: r.last_message_at || "", feishuChatId: r.feishu_chat_id || undefined }; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDb() { return db_1.default; }
function buildSessionId(peerPlatform, idType, id) { return `${peerPlatform}:${idType}:${id}`; }
function findOrCreate(ownerKey, ownerPlatform, sr) {
    // Find existing session by peer_receive_id + peer_receive_id_type (exact match required)
    let row = db_1.default.prepare("SELECT * FROM sessions WHERE owner_key=? AND owner_platform=? AND peer_receive_id=? AND peer_receive_id_type=? AND peer_platform=? LIMIT 1").get(ownerKey, ownerPlatform, sr.receiveId, sr.receiveIdType, sr.platform);
    if (row) {
        // Update display name/email if search result has better info
        if (sr.displayName && row.display_name !== sr.displayName) {
            db_1.default.prepare("UPDATE sessions SET display_name=?, peer_email=? WHERE session_id=? AND owner_key=?").run(sr.displayName, sr.email, row.session_id, ownerKey);
            row.display_name = sr.displayName;
            row.peer_email = sr.email;
        }
        return r2s(row);
    }
    // Create new session
    const sid = buildSessionId(sr.platform, sr.receiveIdType, sr.receiveId);
    db_1.default.prepare("INSERT INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name) VALUES (?,?,?,?,?,?,?,?)").run(sid, ownerKey, ownerPlatform, sr.platform, sr.receiveIdType, sr.receiveId, sr.email, sr.displayName);
    row = db_1.default.prepare("SELECT * FROM sessions WHERE session_id=? AND owner_key=?").get(sid, ownerKey);
    return r2s(row);
}
function deactivateAll(ownerKey, ownerPlatform) { db_1.default.prepare("UPDATE sessions SET state='idle' WHERE owner_key=? AND owner_platform=?").run(ownerKey, ownerPlatform); }
function activateSession(ownerKey, ownerPlatform, sid) {
    db_1.default.prepare("UPDATE sessions SET state='active',unread_count=0 WHERE session_id=? AND owner_key=?").run(sid, ownerKey);
    const e = db_1.default.prepare("SELECT 1 FROM session_states WHERE owner_key=? AND owner_platform=?").get(ownerKey, ownerPlatform);
    if (e)
        db_1.default.prepare("UPDATE session_states SET active_session_id=? WHERE owner_key=? AND owner_platform=?").run(sid, ownerKey, ownerPlatform);
    else
        db_1.default.prepare("INSERT INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)").run(ownerKey, ownerPlatform, sid);
}
function findActive(ownerKey, ownerPlatform) {
    const st = db_1.default.prepare("SELECT active_session_id FROM session_states WHERE owner_key=? AND owner_platform=?").get(ownerKey, ownerPlatform);
    if (!st?.active_session_id)
        return undefined;
    const r = db_1.default.prepare("SELECT * FROM sessions WHERE session_id=? AND owner_key=?").get(st.active_session_id, ownerKey);
    return r ? r2s(r) : undefined;
}
function listByOwner(ownerKey) { return db_1.default.prepare("SELECT * FROM sessions WHERE owner_key=? ORDER BY last_message_at DESC").all(ownerKey).map(r2s); }
function incrementUnread(ownerKey, sid) { db_1.default.prepare("UPDATE sessions SET unread_count=unread_count+1,last_message_at=datetime('now') WHERE session_id=? AND owner_key=?").run(sid, ownerKey); }
function clearUnread(ownerKey, sid) { const r = db_1.default.prepare("SELECT unread_count FROM sessions WHERE session_id=? AND owner_key=?").get(sid, ownerKey); const c = r?.unread_count || 0; db_1.default.prepare("UPDATE sessions SET unread_count=0 WHERE session_id=? AND owner_key=?").run(sid, ownerKey); return c; }
function getUnreadInfo(ownerKey, sid) { const r = db_1.default.prepare("SELECT display_name,unread_count,peer_email FROM sessions WHERE session_id=? AND owner_key=?").get(sid, ownerKey); return { display: r?.display_name || "", unread: r?.unread_count || 0, email: r?.peer_email || "" }; }
function deleteAllByOwner(ownerKey) { db_1.default.prepare("DELETE FROM sessions WHERE owner_key=?").run(ownerKey); db_1.default.prepare("DELETE FROM session_states WHERE owner_key=?").run(ownerKey); }
/**
 * 按 peerReceiveId 查找 session（用于飞书用户发消息时查找对方平台用户的 session）
 * ownerPlatform = 'teams' 表示这是以 Teams 用户为 owner 的 session
 */
function findSessionByPeer(peerPlatform, peerId) {
    const sid = `${peerPlatform}:open_id:${peerId}`;
    const r = db_1.default.prepare("SELECT * FROM sessions WHERE session_id=? AND owner_platform=?").get(sid, peerPlatform === "feishu" ? "teams" : "feishu");
    return r ? r2s(r) : undefined;
}
/**
 * 按 peer_receive_id 查找活跃 session（用于飞书用户发消息时查找对应 Teams 用户的 session）
 */
function findActiveByPeer(peerId, peerPlatform) {
    const r = db_1.default.prepare("SELECT * FROM sessions WHERE peer_receive_id=? AND peer_platform=? AND state='active' LIMIT 1").get(peerId, peerPlatform);
    return r ? r2s(r) : undefined;
}
/**
 * 按 owner_platform + peer_platform 查找活跃 session
 * 用于：飞书用户发消息时，查找以该飞书用户为 owner 的 session
 */
function findActiveByOwnerAndPeer(ownerKey, ownerPlatform, peerPlatform) {
    const r = db_1.default.prepare("SELECT * FROM sessions WHERE owner_key=? AND owner_platform=? AND peer_platform=? AND state='active' LIMIT 1").get(ownerKey, ownerPlatform, peerPlatform);
    return r ? r2s(r) : undefined;
}
/**
 * 查找活跃 session（alias for findActive）
 */
function findActiveSessionByOwnerKey(ownerKey, ownerPlatform) {
    return findActive(ownerKey, ownerPlatform);
}
/**
 * 查找所有者拥有与其他人的 session（排除指定 peer，active 或 idle 状态）
 * 用于判断用户是否正在和其他人聊天
 * @param ownerPlatform 所有者平台（'teams' 或 'feishu'），不能硬编码
 */
function findOtherActiveSession(ownerKey, ownerPlatform, excludePeerId) {
    const r = db_1.default.prepare("SELECT * FROM sessions WHERE owner_key=? AND owner_platform=? AND state IN ('active','idle') AND peer_receive_id<>? LIMIT 1").get(ownerKey, ownerPlatform, excludePeerId);
    return r ? r2s(r) : undefined;
}
/**
 * 按 peer_receive_id 或 owner_key 查找 session，忽略 owner_platform
 * 用于：Teams 用户发消息时，通过 Teams AAD ID 找到对应的飞书用户 session
 *
 * 两种情况：
 * 1. 飞书用户先发(/chat) → Teams AAD ID 在 owner_key，Feishu open_id 在 peer_receive_id
 * 2. Teams 用户先发 → Feishu open_id 在 owner_key，Teams AAD ID 在 peer_receive_id
 */
function findSessionByPeerAnyOwner(teamsUserKey) {
    // 查找以 Teams 用户为 peer 的飞书用户 session（飞书用户拥有这个 session）
    // 优先查找 owner_platform=feishu 的 session（飞书用户视角，能看到对方是谁）
    // 再查找 owner_platform=teams 的 session（Teams 用户视角，peer 是飞书用户）
    const r = db_1.default.prepare("SELECT * FROM sessions WHERE (owner_key=? AND owner_platform='teams') OR (peer_receive_id=? AND owner_platform='feishu') ORDER BY CASE WHEN owner_platform='feishu' THEN 0 ELSE 1 END, last_message_at DESC LIMIT 1").get(teamsUserKey, teamsUserKey);
    const s = r ? r2s(r) : undefined;
    console.log(`[repo] findSessionByPeerAnyOwner(${teamsUserKey.substring(0, 8)}...) => session_id=${s?.sessionId} owner_platform=${s?.ownerPlatform} display=${s?.displayName} state=${s?.state}`);
    return s;
}
/**
 * 通过 owner_key 和 owner_platform 精确查找 session
 * @param ownerKey 会话所有者的 ID（feishu open_id 或 teams AAD ID）
 * @param ownerPlatform 会话所有者的平台（'feishu' 或 'teams'）
 */
function findSessionByOwnerKey(ownerKey, ownerPlatform) { const r = db_1.default.prepare("SELECT * FROM sessions WHERE owner_key=? AND owner_platform=? LIMIT 1").get(ownerKey, ownerPlatform); return r ? r2s(r) : undefined; }
/** 通过 peer_receive_id 和 owner_platform 精确查找 session（已废弃，用 findSessionByOwnerKey 代替） */
function findSessionByPeerReceiveIdAndOwnerPlatform(peerReceiveId, ownerPlatform) { const r = db_1.default.prepare("SELECT * FROM sessions WHERE peer_receive_id=? AND owner_platform=? LIMIT 1").get(peerReceiveId, ownerPlatform); return r ? r2s(r) : undefined; }
/** 更新 session 的 feishu_chat_id（用于 open_id 发送失败时 fallback） */
function updateFeishuChatId(ownerKey, sid, chatId) {
    db_1.default.prepare("UPDATE sessions SET feishu_chat_id=? WHERE session_id=? AND owner_key=?").run(chatId, sid, ownerKey);
}
// ===== Pending Selections (多结果选择) =====
function savePendingSelections(ownerKey, results) {
    db_1.default.prepare("INSERT INTO pending_selections (owner_key,results_json) VALUES (?,?) ON CONFLICT(owner_key) DO UPDATE SET results_json=excluded.results_json,created_at=datetime('now')").run(ownerKey, JSON.stringify(results));
}
function getPendingSelections(ownerKey) {
    const r = db_1.default.prepare("SELECT results_json FROM pending_selections WHERE owner_key=?").get(ownerKey);
    if (!r)
        return null;
    try {
        return JSON.parse(r.results_json);
    }
    catch {
        return null;
    }
}
function clearPendingSelections(ownerKey) { db_1.default.prepare("DELETE FROM pending_selections WHERE owner_key=?").run(ownerKey); }
// ===== Pending Messages (非活跃会话的未读消息缓存) =====
function savePendingMessage(sessionId, ownerKey, formattedContent, timestamp) {
    // formatted_content 格式：[发送方 | 平台]：消息内容
    const match = formattedContent.match(/^\[(.+?) \| (\w+)\]：(.+)$/);
    const senderDisplay = match ? match[1] : "未知";
    const text = match ? match[3] : formattedContent;
    db_1.default.prepare("INSERT INTO pending_messages (session_id,owner_key,sender_display,text,formatted_content,original_timestamp) VALUES (?,?,?,?,?,?)").run(sessionId, ownerKey, senderDisplay, text, formattedContent, timestamp);
}
function flushPendingMessages(ownerKey, sessionId) {
    const rows = db_1.default.prepare("SELECT formatted_content,original_timestamp FROM pending_messages WHERE owner_key=? AND session_id=? ORDER BY id ASC").all(ownerKey, sessionId);
    db_1.default.prepare("DELETE FROM pending_messages WHERE owner_key=? AND session_id=?").run(ownerKey, sessionId);
    return rows.map(r => {
        // formatted_content 格式：[发送方 | 平台]：消息内容
        const match = r.formatted_content.match(/^\[(.+?) \| (\w+)\]：(.+)$/);
        return match
            ? { from: match[1], text: match[3], ts: r.original_timestamp, platform: match[2] }
            : { from: "未知", text: r.formatted_content, ts: r.original_timestamp };
    });
}
function clearPendingMessagesForOwner(ownerKey) {
    db_1.default.prepare("DELETE FROM pending_messages WHERE owner_key=?").run(ownerKey);
}
//# sourceMappingURL=session.repo.js.map