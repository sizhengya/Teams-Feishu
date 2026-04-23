import { Session, PeerPlatform, SearchResult, PendingMessage } from "../types";
export declare function getDb(): any;
export declare function buildSessionId(peerPlatform: string, idType: string, id: string): string;
export declare function findOrCreate(ownerKey: string, ownerPlatform: PeerPlatform, sr: SearchResult): Session;
export declare function deactivateAll(ownerKey: string, ownerPlatform: PeerPlatform): void;
export declare function activateSession(ownerKey: string, ownerPlatform: PeerPlatform, sid: string): void;
export declare function findActive(ownerKey: string, ownerPlatform: PeerPlatform): Session | undefined;
export declare function listByOwner(ownerKey: string, ownerPlatform?: PeerPlatform): Session[];
export declare function incrementUnread(ownerKey: string, sid: string): void;
export declare function clearUnread(ownerKey: string, sid: string): number;
export declare function getUnreadInfo(ownerKey: string, sid: string): {
    display: string;
    unread: number;
    email: string;
};
export declare function deleteAllByOwner(ownerKey: string): void;
/**
 * 按 peerReceiveId 查找 session（用于飞书用户发消息时查找对方平台用户的 session）
 * ownerPlatform = 'teams' 表示这是以 Teams 用户为 owner 的 session
 */
export declare function findSessionByPeer(peerPlatform: PeerPlatform, peerId: string): Session | undefined;
/** 更新 session 的 feishu_chat_id（用于 open_id 发送失败时 fallback） */
export declare function updateFeishuChatId(ownerKey: string, sid: string, chatId: string): void;
export declare function savePendingSelections(ownerKey: string, results: SearchResult[]): void;
export declare function getPendingSelections(ownerKey: string): SearchResult[] | null;
export declare function clearPendingSelections(ownerKey: string): void;
export declare function savePendingMessage(sessionId: string, ownerKey: string, formattedContent: string, timestamp: string): void;
export declare function flushPendingMessages(ownerKey: string, sessionId: string): PendingMessage[];
export declare function clearPendingMessagesForOwner(ownerKey: string): void;
