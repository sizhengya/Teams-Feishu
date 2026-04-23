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
export declare function listAllSessions(ownerKey: string): Session[];
export declare function clearAllSessions(ownerKey: string): void;
export declare function flushPendingMessages(ownerKey: string, sessionId: string): PendingMessage[];
