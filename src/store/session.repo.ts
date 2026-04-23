import db from "./db";
import { Session, PeerPlatform, SearchResult, PendingMessage } from "../types";
function r2s(r:any):Session { return { sessionId:r.session_id, ownerKey:r.owner_key, ownerPlatform:r.owner_platform, peerPlatform:r.peer_platform, peerReceiveIdType:r.peer_receive_id_type, peerReceiveId:r.peer_receive_id, peerEmail:r.peer_email, displayName:r.display_name, state:r.state, unreadCount:r.unread_count, lastMessageAt:r.last_message_at||"", feishuChatId:r.feishu_chat_id||undefined }; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDb(): any { return db; }

export function buildSessionId(peerPlatform:string, idType:string, id:string):string { return `${peerPlatform}:${idType}:${id}`; }

export function findOrCreate(ownerKey:string, ownerPlatform:PeerPlatform, sr:SearchResult):Session {
  // Find existing session by peer_receive_id + peer_receive_id_type (exact match required)
  let row:any = db.prepare("SELECT * FROM sessions WHERE owner_key=? AND owner_platform=? AND peer_receive_id=? AND peer_receive_id_type=? AND peer_platform=? LIMIT 1").get(ownerKey, ownerPlatform, sr.receiveId, sr.receiveIdType, sr.platform);
  if(row) {
    // Update display name/email if search result has better info
    if(sr.displayName && row.display_name !== sr.displayName) {
      db.prepare("UPDATE sessions SET display_name=?, peer_email=? WHERE session_id=? AND owner_key=?").run(sr.displayName, sr.email, row.session_id, ownerKey);
      row.display_name = sr.displayName;
      row.peer_email = sr.email;
    }
    return r2s(row);
  }
  // Create new session
  const sid = buildSessionId(sr.platform, sr.receiveIdType, sr.receiveId);
  db.prepare("INSERT INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name) VALUES (?,?,?,?,?,?,?,?)").run(sid,ownerKey,ownerPlatform,sr.platform,sr.receiveIdType,sr.receiveId,sr.email,sr.displayName);
  row = db.prepare("SELECT * FROM sessions WHERE session_id=? AND owner_key=?").get(sid,ownerKey);
  return r2s(row);
}
export function deactivateAll(ownerKey:string, ownerPlatform:PeerPlatform):void { db.prepare("UPDATE sessions SET state='idle' WHERE owner_key=? AND owner_platform=?").run(ownerKey, ownerPlatform); }
export function activateSession(ownerKey:string, ownerPlatform:PeerPlatform, sid:string):void {
  db.prepare("UPDATE sessions SET state='active',unread_count=0 WHERE session_id=? AND owner_key=?").run(sid,ownerKey);
  const e=db.prepare("SELECT 1 FROM session_states WHERE owner_key=? AND owner_platform=?").get(ownerKey, ownerPlatform);
  if(e) db.prepare("UPDATE session_states SET active_session_id=? WHERE owner_key=? AND owner_platform=?").run(sid,ownerKey,ownerPlatform);
  else db.prepare("INSERT INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)").run(ownerKey,ownerPlatform,sid);
}
export function findActive(ownerKey:string, ownerPlatform:PeerPlatform):Session|undefined {
  const st:any=db.prepare("SELECT active_session_id FROM session_states WHERE owner_key=? AND owner_platform=?").get(ownerKey, ownerPlatform);
  if(!st?.active_session_id) return undefined;
  const r:any=db.prepare("SELECT * FROM sessions WHERE session_id=? AND owner_key=?").get(st.active_session_id,ownerKey);
  return r?r2s(r):undefined;
}
export function listByOwner(ownerKey:string):Session[] { return(db.prepare("SELECT * FROM sessions WHERE owner_key=? ORDER BY last_message_at DESC").all(ownerKey) as any[]).map(r2s); }
export function incrementUnread(ownerKey:string, sid:string):void { db.prepare("UPDATE sessions SET unread_count=unread_count+1,last_message_at=datetime('now') WHERE session_id=? AND owner_key=?").run(sid,ownerKey); }
export function clearUnread(ownerKey:string, sid:string):number { const r:any=db.prepare("SELECT unread_count FROM sessions WHERE session_id=? AND owner_key=?").get(sid,ownerKey); const c=r?.unread_count||0; db.prepare("UPDATE sessions SET unread_count=0 WHERE session_id=? AND owner_key=?").run(sid,ownerKey); return c; }
export function getUnreadInfo(ownerKey:string, sid:string):{display:string;unread:number;email:string} { const r:any=db.prepare("SELECT display_name,unread_count,peer_email FROM sessions WHERE session_id=? AND owner_key=?").get(sid,ownerKey); return{display:r?.display_name||"",unread:r?.unread_count||0,email:r?.peer_email||""}; }
export function deleteAllByOwner(ownerKey:string):void { db.prepare("DELETE FROM sessions WHERE owner_key=?").run(ownerKey); db.prepare("DELETE FROM session_states WHERE owner_key=?").run(ownerKey); }

/**
 * 按 peerReceiveId 查找 session（用于飞书用户发消息时查找对方平台用户的 session）
 * ownerPlatform = 'teams' 表示这是以 Teams 用户为 owner 的 session
 */
export function findSessionByPeer(peerPlatform:PeerPlatform, peerId:string):Session|undefined {
  const sid = `${peerPlatform}:open_id:${peerId}`;
  const r:any=db.prepare("SELECT * FROM sessions WHERE session_id=? AND owner_platform=?").get(sid, peerPlatform==="feishu"?"teams":"feishu");
  return r?r2s(r):undefined;
}

/** 更新 session 的 feishu_chat_id（用于 open_id 发送失败时 fallback） */
export function updateFeishuChatId(ownerKey:string, sid:string, chatId:string):void {
  db.prepare("UPDATE sessions SET feishu_chat_id=? WHERE session_id=? AND owner_key=?").run(chatId, sid, ownerKey);
}

// ===== Pending Selections (多结果选择) =====
export function savePendingSelections(ownerKey:string, results:SearchResult[]):void {
  db.prepare("INSERT INTO pending_selections (owner_key,results_json) VALUES (?,?) ON CONFLICT(owner_key) DO UPDATE SET results_json=excluded.results_json,created_at=datetime('now')").run(ownerKey,JSON.stringify(results));
}
export function getPendingSelections(ownerKey:string):SearchResult[]|null {
  const r:any=db.prepare("SELECT results_json FROM pending_selections WHERE owner_key=?").get(ownerKey);
  if(!r) return null;
  try{ return JSON.parse(r.results_json); }catch{ return null; }
}
export function clearPendingSelections(ownerKey:string):void { db.prepare("DELETE FROM pending_selections WHERE owner_key=?").run(ownerKey); }

// ===== Pending Messages (非活跃会话的未读消息缓存) =====

export function savePendingMessage(sessionId:string, ownerKey:string, formattedContent:string, timestamp:string):void {
  // 按 design §3: pending_messages 只存 formatted_content（含平台标识）+ original_timestamp。
  // 发送方名/原文在回放时从 formatted_content 的 "[sender | platform]：text" 前缀解析。
  db.prepare("INSERT INTO pending_messages (session_id,owner_key,formatted_content,original_timestamp) VALUES (?,?,?,?)").run(sessionId,ownerKey,formattedContent,timestamp);
}

export function flushPendingMessages(ownerKey:string, sessionId:string):PendingMessage[] {
  const rows:any[] = db.prepare("SELECT formatted_content,original_timestamp FROM pending_messages WHERE owner_key=? AND session_id=? ORDER BY id ASC").all(ownerKey,sessionId);
  db.prepare("DELETE FROM pending_messages WHERE owner_key=? AND session_id=?").run(ownerKey,sessionId);
  return rows.map(r => {
    // formatted_content 格式：[发送方 | 平台]：消息内容
    const match = r.formatted_content.match(/^\[(.+?) \| (\w+)\]：(.+)$/);
    return match
      ? { from: match[1], text: match[3], ts: r.original_timestamp, platform: match[2] as "feishu" | "teams" }
      : { from: "未知", text: r.formatted_content, ts: r.original_timestamp };
  });
}

export function clearPendingMessagesForOwner(ownerKey:string):void {
  db.prepare("DELETE FROM pending_messages WHERE owner_key=?").run(ownerKey);
}
