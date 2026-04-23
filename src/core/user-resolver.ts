import { SearchResult, PeerPlatform } from "../types";
import { searchFeishuUsers } from "../outbound/feishu-client";
import { searchTeamsUsers } from "../outbound/graph-client";

/**
 * 根据调用方平台，搜索对方平台用户（通过邮件前缀）
 *
 * Teams 用户 → 搜飞书用户（调用飞书通讯录 API）
 * 飞书用户 → 搜 Teams 用户（调用 Microsoft Graph API）
 */
export async function searchPeerUsers(
  callerPlatform: PeerPlatform,
  emailPrefix: string
): Promise<SearchResult[]> {
  if (callerPlatform === "teams") {
    // Teams 用户要找飞书用户
    return await searchFeishuUsers(emailPrefix);
  } else {
    // 飞书用户要找 Teams 用户
    return await searchTeamsUsers(emailPrefix);
  }
}
