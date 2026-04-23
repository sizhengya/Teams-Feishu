"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchPeerUsers = searchPeerUsers;
const feishu_client_1 = require("../outbound/feishu-client");
const graph_client_1 = require("../outbound/graph-client");
/**
 * 根据调用方平台，搜索对方平台用户（通过邮件前缀）
 *
 * Teams 用户 → 搜飞书用户（调用飞书通讯录 API）
 * 飞书用户 → 搜 Teams 用户（调用 Microsoft Graph API）
 */
async function searchPeerUsers(callerPlatform, emailPrefix) {
    if (callerPlatform === "teams") {
        // Teams 用户要找飞书用户
        return await (0, feishu_client_1.searchFeishuUsers)(emailPrefix);
    }
    else {
        // 飞书用户要找 Teams 用户
        return await (0, graph_client_1.searchTeamsUsers)(emailPrefix);
    }
}
//# sourceMappingURL=user-resolver.js.map