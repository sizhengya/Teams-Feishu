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
exports.parseCommand = parseCommand;
exports.chatWithSearch = chatWithSearch;
exports.handleConnect = handleConnect;
exports.handleSelect = handleSelect;
exports.switchToExistingSession = switchToExistingSession;
exports.getActiveSession = getActiveSession;
exports.listAllSessions = listAllSessions;
exports.clearAllSessions = clearAllSessions;
exports.flushPendingMessages = flushPendingMessages;
const repo = __importStar(require("../store/session.repo"));
const user_resolver_1 = require("./user-resolver");
const CMD_RE = /^\/(chat|list|who|help|clear|select|connect)\s*(.*)/i;
function parseCommand(text) {
    const m = CMD_RE.exec(text.trim());
    if (!m)
        return null;
    return { command: m[1].toLowerCase(), args: (m[2] || "").trim() };
}
async function chatWithSearch(ownerKey, ownerPlatform, emailPrefix) {
    try {
        const results = await (0, user_resolver_1.searchPeerUsers)(ownerPlatform, emailPrefix);
        if (results.length === 0)
            return { error: "未找到匹配用户，请检查邮件前缀" };
        if (results.length === 1) {
            const session = connectToSearchResult(ownerKey, ownerPlatform, results[0]);
            return { autoConnected: session };
        }
        repo.savePendingSelections(ownerKey, results);
        return { results };
    }
    catch (err) {
        return { error: `搜索失败：${err.message || err}` };
    }
}
async function handleConnect(ownerKey, ownerPlatform, target) {
    let platform = null;
    let value = target;
    if (target.startsWith("feishu:")) {
        platform = "feishu";
        value = target.slice(7);
    }
    else if (target.startsWith("teams:")) {
        platform = "teams";
        value = target.slice(6);
    }
    if (!platform)
        return { error: "请指定平台： /connect feishu:<id> 或 /connect teams:<id>" };
    if (platform === "teams") {
        const results = await (0, user_resolver_1.searchPeerUsers)("teams", value);
        if (results.length === 0)
            return { error: "未找到匹配用户" };
        const user = results[0];
        const { buildSessionId } = await Promise.resolve().then(() => __importStar(require("../store/session.repo")));
        const { default: db } = await Promise.resolve().then(() => __importStar(require("../store/db")));
        const txn = db.transaction(() => {
            repo.deactivateAll(ownerKey, ownerPlatform);
            const feishuSid = buildSessionId("teams", "user_key", user.receiveId);
            db.prepare(`INSERT OR REPLACE INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state,unread_count,feishu_chat_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(feishuSid, ownerKey, "feishu", "teams", user.receiveIdType || "user_key", user.receiveId, user.email, user.displayName, "active", 0, "");
            db.prepare(`INSERT OR REPLACE INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(ownerKey, ownerPlatform, feishuSid);
            const teamsSid = buildSessionId("feishu", "open_id", ownerKey);
            db.prepare(`INSERT OR REPLACE INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state,unread_count,feishu_chat_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(teamsSid, user.receiveId, "teams", "feishu", "open_id", ownerKey, user.email, user.displayName, "active", 0, "");
            db.prepare(`INSERT OR REPLACE INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(user.receiveId, "teams", teamsSid);
        });
        txn();
        return { session: repo.findActive(ownerKey, ownerPlatform) };
    }
    else {
        return { error: "Teams 用户连接需要通过邮件前缀搜索：\n/chat <teams邮件前缀>" };
    }
}
function handleSelect(ownerKey, ownerPlatform, index) {
    const pending = repo.getPendingSelections(ownerKey);
    if (!pending || pending.length === 0)
        return { error: "no_pending" };
    if (index < 1 || index > pending.length)
        return { error: "out_of_range" };
    const selected = pending[index - 1];
    const session = connectToSearchResult(ownerKey, ownerPlatform, selected);
    repo.clearPendingSelections(ownerKey);
    return { session };
}
function connectToSearchResult(ownerKey, ownerPlatform, sr) {
    const txn = repo.getDb().transaction(() => {
        repo.deactivateAll(ownerKey, ownerPlatform);
        // findOrCreate now finds existing session by peer_receive_id (ignoring ID type)
        const s = repo.findOrCreate(ownerKey, ownerPlatform, sr);
        repo.activateSession(ownerKey, ownerPlatform, s.sessionId);
        repo.clearUnread(ownerKey, s.sessionId);
        return s;
    });
    return txn();
}
function switchToExistingSession(ownerKey, ownerPlatform, sessionId) {
    const txn = repo.getDb().transaction(() => {
        repo.deactivateAll(ownerKey, ownerPlatform);
        repo.activateSession(ownerKey, ownerPlatform, sessionId);
        const prev = repo.clearUnread(ownerKey, sessionId);
        return prev;
    });
    const prev = txn();
    const session = repo.findActive(ownerKey, ownerPlatform);
    return { session, previousUnread: prev };
}
function getActiveSession(ownerKey, ownerPlatform) { return repo.findActive(ownerKey, ownerPlatform); }
function listAllSessions(ownerKey) { return repo.listByOwner(ownerKey); }
function clearAllSessions(ownerKey) { repo.deleteAllByOwner(ownerKey); repo.clearPendingSelections(ownerKey); repo.clearPendingMessagesForOwner(ownerKey); }
function flushPendingMessages(ownerKey, sessionId) { return repo.flushPendingMessages(ownerKey, sessionId); }
//# sourceMappingURL=session-manager.js.map