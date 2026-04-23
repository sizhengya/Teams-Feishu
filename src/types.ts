export type PeerPlatform = "feishu" | "teams";

export interface UserLink {
  teamsUserKey: string;
  conversationId: string;
  serviceUrl: string;
  createdAt: string;
}

export interface Session {
  sessionId: string;
  ownerKey: string;
  ownerPlatform: PeerPlatform;
  peerPlatform: PeerPlatform;
  peerReceiveIdType: string;
  peerReceiveId: string;
  peerEmail: string;
  displayName: string;
  state: "active" | "idle";
  unreadCount: number;
  lastMessageAt: string;
  feishuChatId?: string;
}

export interface SearchResult {
  email: string;
  displayName: string;
  platform: PeerPlatform;
  receiveIdType: string;
  receiveId: string;
  department?: string;
}

export type Command = "chat" | "list" | "who" | "help" | "clear" | "select" | "connect";

export interface ParsedCommand {
  command: Command;
  args: string;
}

export interface MessageMapEntry {
  srcPlatform: PeerPlatform;
  srcMessageId: string;
  dstPlatform: PeerPlatform;
  dstMessageId: string;
  sessionId: string;
  uuid: string;
  createdAt: string;
}

export interface InboundTeamsMessage {
  teamsUserKey: string;
  conversationId: string;
  serviceUrl: string;
  messageId: string;
  senderDisplay: string;
  text: string;
  timestamp: string;
}

export interface InboundFeishuMessage {
  senderOpenId: string;
  senderDisplay: string;
  chatId: string;
  messageId: string;
  text: string;
  timestamp: string;
}

export type RouteAction =
  | { type: "forward_to_feishu"; sessionId: string; content: string; peerId: string; peerIdType: string; feishuChatId?: string; tip?: string; srcMessageId: string }
  | { type: "forward_to_teams"; sessionId: string; content: string; teamsUserKey: string; tip?: string; srcMessageId: string }
  | { type: "notify_feishu_peer"; sessionId: string; receiverOpenId: string; feishuChatId?: string; senderDisplay: string; senderTeamsKey: string; unread: number; srcMessageId: string }
  | { type: "notify_teams_peer"; sessionId: string; teamsUserKey: string; senderDisplay: string; senderOpenId: string; unread: number; srcMessageId: string }
  | { type: "reply_bot"; text: string }
  | { type: "noop" };

export interface PendingMessage { from: string; text: string; ts: string; platform?: "feishu" | "teams"; }

// DeliveryResult - v3 spec style return from ensureReverseSession
export interface DeliveryResult{decision:"deliver"|"deliver_activated"|"notify";senderNotifyText?:string;}
