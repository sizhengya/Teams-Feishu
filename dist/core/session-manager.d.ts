import { Session, PeerPlatform, SearchResult, PendingMessage } from "../types";
export declare function parseCommand(text: string): {
    command: string;
    args: string;
} | null;
export declare function chatWithSearch(ownerKey: string, ownerPlatform: PeerPlatform, emailPrefix: string): Promise<{
    error: string;
    autoConnected?: undefined;
    results?: undefined;
} | {
    autoConnected: any;
    error?: undefined;
    results?: undefined;
} | {
    results: SearchResult[];
    error?: undefined;
    autoConnected?: undefined;
}>;
export declare function handleConnect(ownerKey: string, ownerPlatform: PeerPlatform, target: string): Promise<{
    error: string;
    session?: undefined;
} | {
    session: Session | undefined;
    error?: undefined;
}>;
export declare function handleSelect(ownerKey: string, ownerPlatform: PeerPlatform, index: number): {
    error: string;
    session?: undefined;
} | {
    session: any;
    error?: undefined;
};
export declare function switchToExistingSession(ownerKey: string, ownerPlatform: PeerPlatform, sessionId: string): {
    session: Session | undefined;
    previousUnread: any;
};
export declare function getActiveSession(ownerKey: string, ownerPlatform: PeerPlatform): Session | undefined;
export declare function listAllSessions(ownerKey: string, ownerPlatform?: PeerPlatform): Session[];
export declare function clearAllSessions(ownerKey: string): void;
export declare function flushPendingMessages(ownerKey: string, sessionId: string): PendingMessage[];
export interface SenderAsPeer {
    platform: PeerPlatform;
    receiveId: string;
    receiveIdType: string;
    displayName: string;
    email: string;
}
export interface EnsureReverseResult {
    decision: "deliver" | "deliver_activated" | "notify";
    session: Session;
}
/**
 * 接收方视角的反向 Session 决策（design §4）。
 *
 * - 若接收方无 active：自动激活反向 session → "deliver_activated"
 * - 若接收方 active 正是此发送方：→ "deliver"
 * - 若接收方 active 是别人：+unread + 存 pending formatted_content → "notify"
 *
 * 所有分支都在单事务内完成（design §7 并发与安全）。
 */
export declare function ensureReverseSession(receiverKey: string, receiverPlatform: PeerPlatform, senderAsPeer: SenderAsPeer, formattedContent: string, timestamp: string): EnsureReverseResult;
