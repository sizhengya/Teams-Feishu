import { Session, PeerPlatform, SearchResult, PendingMessage } from "../types";
import * as repo from "../store/session.repo";
import { searchPeerUsers } from "./user-resolver";

const CMD_RE = /^\/(chat|list|who|help|clear|select|connect)\s*(.*)/i;

export function parseCommand(text: string) {
  const m = CMD_RE.exec(text.trim());
  if (!m) return null;
  return { command: m[1].toLowerCase(), args: (m[2] || "").trim() };
}

export async function chatWithSearch(ownerKey: string, ownerPlatform: PeerPlatform, emailPrefix: string) {
  try {
    const results = await searchPeerUsers(ownerPlatform, emailPrefix);
    if (results.length === 0) return { error: "未找到匹配用户，请检查邮件前缀" };
    if (results.length === 1) {
      const session = connectToSearchResult(ownerKey, ownerPlatform, results[0]);
      return { autoConnected: session };
    }
    repo.savePendingSelections(ownerKey, results);
    return { results };
  } catch (err: unknown) {
    return { error: `搜索失败：${(err as Error).message || err}` };
  }
}

export async function handleConnect(ownerKey: string, ownerPlatform: PeerPlatform, target: string) {
  let platform: PeerPlatform | null = null;
  let value = target;
  if (target.startsWith("feishu:")) { platform = "feishu"; value = target.slice(7); }
  else if (target.startsWith("teams:")) { platform = "teams"; value = target.slice(6); }
  if (!platform) return { error: "请指定平台： /connect feishu:<id> 或 /connect teams:<id>" };

  if (platform === "teams") {
    const results = await searchPeerUsers("teams", value);
    if (results.length === 0) return { error: "未找到匹配用户" };
    const user = results[0];
    const { buildSessionId } = await import("../store/session.repo");
    const { default: db } = await import("../store/db");
    const txn = db.transaction(() => {
      repo.deactivateAll(ownerKey, ownerPlatform);
      const feishuSid = buildSessionId("teams", "user_key", user.receiveId);
      db.prepare(`INSERT OR REPLACE INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state,unread_count,feishu_chat_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        feishuSid, ownerKey, "feishu", "teams", user.receiveIdType || "user_key", user.receiveId, user.email, user.displayName, "active", 0, ""
      );
      db.prepare(`INSERT OR REPLACE INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(ownerKey, ownerPlatform, feishuSid);
      const teamsSid = buildSessionId("feishu", "open_id", ownerKey);
      db.prepare(`INSERT OR REPLACE INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state,unread_count,feishu_chat_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        teamsSid, user.receiveId, "teams", "feishu", "open_id", ownerKey, user.email, user.displayName, "active", 0, ""
      );
      db.prepare(`INSERT OR REPLACE INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(user.receiveId, "teams", teamsSid);
    });
    txn();
    return { session: repo.findActive(ownerKey, ownerPlatform) };
  } else {
    return { error: "Teams 用户连接需要通过邮件前缀搜索：\n/chat <teams邮件前缀>" };
  }
}

export function handleSelect(ownerKey: string, ownerPlatform: PeerPlatform, index: number) {
  const pending = repo.getPendingSelections(ownerKey);
  if (!pending || pending.length === 0) return { error: "no_pending" };
  if (index < 1 || index > pending.length) return { error: "out_of_range" };
  const selected = pending[index - 1];
  const session = connectToSearchResult(ownerKey, ownerPlatform, selected);
  repo.clearPendingSelections(ownerKey);
  return { session };
}

function connectToSearchResult(ownerKey: string, ownerPlatform: PeerPlatform, sr: SearchResult) {
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

export function switchToExistingSession(ownerKey: string, ownerPlatform: PeerPlatform, sessionId: string) {
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

export function getActiveSession(ownerKey: string, ownerPlatform: PeerPlatform): Session | undefined { return repo.findActive(ownerKey, ownerPlatform); }
export function listAllSessions(ownerKey: string, ownerPlatform?: PeerPlatform): Session[] { return repo.listByOwner(ownerKey, ownerPlatform); }
export function clearAllSessions(ownerKey: string): void { repo.deleteAllByOwner(ownerKey); repo.clearPendingSelections(ownerKey); repo.clearPendingMessagesForOwner(ownerKey); }
export function flushPendingMessages(ownerKey: string, sessionId: string): PendingMessage[] { return repo.flushPendingMessages(ownerKey, sessionId); }

// ===== v3-final 核心算法 =====
// design §4 ensureReverseSession：接收方视角统一决策
// 所有跨平台普通消息路由必须先调此函数，再写 message_map，最后发送。
// 返回 { decision, session } — session 是接收方→发送方的反向 session（receiverKey 为 owner）。

export interface SenderAsPeer {
  platform: PeerPlatform;      // 发送方所在平台
  receiveId: string;           // 发送方在其平台的 ID
  receiveIdType: string;       // aad_id | open_id | user_key
  displayName: string;
  email: string;
}

export interface EnsureReverseResult {
  decision: "deliver" | "deliver_activated" | "notify";
  session: Session;            // 反向 session（receiver 视角）
}

/**
 * 接收方视角的反向 Session 决策（design §4 / spec §3）。
 *
 * - 若接收方无 active：保持 idle 反向 session，+unread + 存 pending → "deliver_activated"
 *   （行为与 notify 相同：仅通知，正文存 pending；不激活、不投递正文）
 * - 若接收方 active 正是此发送方：→ "deliver"
 * - 若接收方 active 是别人：+unread + 存 pending formatted_content → "notify"
 *
 * 所有分支都在单事务内完成（design §7 并发与安全）。
 */
export function ensureReverseSession(
  receiverKey: string,
  receiverPlatform: PeerPlatform,
  senderAsPeer: SenderAsPeer,
  formattedContent: string,
  timestamp: string
): EnsureReverseResult {
  const sr: SearchResult = {
    email: senderAsPeer.email,
    displayName: senderAsPeer.displayName,
    platform: senderAsPeer.platform,
    receiveIdType: senderAsPeer.receiveIdType,
    receiveId: senderAsPeer.receiveId,
  };
  const db = repo.getDb();
  const txn = db.transaction((): EnsureReverseResult => {
    const session = repo.findOrCreate(receiverKey, receiverPlatform, sr);
    const active = repo.findActive(receiverKey, receiverPlatform);
    if (!active) {
      // spec v3-final §3：无 active 时也只通知 + 存 pending，绝不投递正文
      repo.incrementUnread(receiverKey, session.sessionId);
      repo.savePendingMessage(session.sessionId, receiverKey, formattedContent, timestamp);
      return { decision: "deliver_activated", session };
    }
    if (active.sessionId === session.sessionId) {
      return { decision: "deliver", session: active };
    }
    repo.incrementUnread(receiverKey, session.sessionId);
    repo.savePendingMessage(session.sessionId, receiverKey, formattedContent, timestamp);
    return { decision: "notify", session };
  });
  return txn();
}
