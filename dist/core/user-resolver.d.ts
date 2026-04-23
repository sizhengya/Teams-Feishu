import { SearchResult, PeerPlatform } from "../types";
/**
 * 根据调用方平台，搜索对方平台用户（通过邮件前缀）
 *
 * Teams 用户 → 搜飞书用户（调用飞书通讯录 API）
 * 飞书用户 → 搜 Teams 用户（调用 Microsoft Graph API）
 */
export declare function searchPeerUsers(callerPlatform: PeerPlatform, emailPrefix: string): Promise<SearchResult[]>;
