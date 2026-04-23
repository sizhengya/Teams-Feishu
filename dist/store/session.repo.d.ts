import { Session, PeerPlatform, SearchResult, PendingMessage } from "../types";
export declare function getDb(): any;
export declare function buildSessionId(peerPlatform: string, idType: string, id: string): string;
export declare function findOrCreate(ownerKey: string, ownerPlatform: PeerPlatform, sr: SearchResult): Session;
export declare function deactivateAll(ownerKey: string, ownerPlatform: PeerPlatform): void;
export declare function activateSession(ownerKey: string, ownerPlatform: PeerPlatform, sid: string): void;
export declare function findActive(ownerKey: string, ownerPlatform: PeerPlatform): Session | undefined;
export declare function listByOwner(ownerKey: string): Session[];
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
/**
 * 按 peer_receive_id 查找活跃 session（用于飞书用户发消息时查找对应 Teams 用户的 session）
 */
export declare function findActiveByPeer(peerId: string, peerPlatform: PeerPlatform): Session | undefined;
/**
 * 按 owner_platform + peer_platform 查找活跃 session
 * 用于：飞书用户发消息时，查找以该飞书用户为 owner 的 session
 */
export declare function findActiveByOwnerAndPeer(ownerKey: string, ownerPlatform: PeerPlatform, peerPlatform: PeerPlatform): Session | undefined;
/**
 * 查找活跃 session（alias for findActive）
 */
export declare function findActiveSessionByOwnerKey(ownerKey: string, ownerPlatform: PeerPlatform): Session | undefined;
/**
 * 查找所有者拥有与其他人的 session（排除指定 peer，active 或 idle 状态）
 * 用于判断用户是否正在和其他人聊天
 * @param ownerPlatform 所有者平台（'teams' 或 'feishu'），不能硬编码
 */
export declare function findOtherActiveSession(ownerKey: string, ownerPlatform: PeerPlatform, excludePeerId: string): Session | undefined;
/**
 * 按 peer_receive_id 或 owner_key 查找 session，忽略 owner_platform
 * 用于：Teams 用户发消息时，通过 Teams AAD ID 找到对应的飞书用户 session
 *
 * 两种情况：
 * 1. 飞书用户先发(/chat) → Teams AAD ID 在 owner_key，Feishu open_id 在 peer_receive_id
 * 2. Teams 用户先发 → Feishu open_id 在 owner_key，Teams AAD ID 在 peer_receive_id
 */
export declare function findSessionByPeerAnyOwner(teamsUserKey: string): Session | undefined;
/**
 * 通过 owner_key 和 owner_platform 精确查找 session
 * @param ownerKey 会话所有者的 ID（feishu open_id 或 teams AAD ID）
 * @param ownerPlatform 会话所有者的平台（'feishu' 或 'teams'）
 */
export declare function findSessionByOwnerKey(ownerKey: string, ownerPlatform: PeerPlatform): Session | undefined;
/** 通过 peer_receive_id 和 owner_platform 精确查找 session（已废弃，用 findSessionByOwnerKey 代替） */
export declare function findSessionByPeerReceiveIdAndOwnerPlatform(peerReceiveId: string, ownerPlatform: PeerPlatform): Session | undefined;
/** 更新 session 的 feishu_chat_id（用于 open_id 发送失败时 fallback） */
export declare function updateFeishuChatId(ownerKey: string, sid: string, chatId: string): void;
export declare function savePendingSelections(ownerKey: string, results: SearchResult[]): void;
export declare function getPendingSelections(ownerKey: string): SearchResult[] | null;
export declare function clearPendingSelections(ownerKey: string): void;
export declare function savePendingMessage(sessionId: string, ownerKey: string, formattedContent: string, timestamp: string): void;
export declare function flushPendingMessages(ownerKey: string, sessionId: string): PendingMessage[];
export declare function clearPendingMessagesForOwner(ownerKey: string): void;
