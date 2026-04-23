"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureTeamsToken = ensureTeamsToken;
exports.sendTeamsProactive = sendTeamsProactive;
exports.sendTeamsProactiveByKey = sendTeamsProactiveByKey;
const user_link_repo_1 = require("../store/user-link.repo");
const TEAMS_APP_ID = process.env.TEAMS_APP_ID || "";
const TEAMS_BOT_ID = process.env.TEAMS_BOT_ID || TEAMS_APP_ID;
const TEAMS_TENANT_ID = process.env.GRAPH_TENANT_ID || "";
let tokenCache = { token: "", expiresAt: 0 };
async function ensureTeamsToken() {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) {
        return tokenCache.token;
    }
    const clientId = process.env.GRAPH_CLIENT_ID || TEAMS_APP_ID;
    const clientSecret = process.env.GRAPH_CLIENT_SECRET || process.env.TEAMS_APP_PASSWORD || "";
    const tenantId = TEAMS_TENANT_ID;
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://api.botframework.com/.default",
    });
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Teams token failed: ${resp.status} ${text}`);
    }
    const data = (await resp.json());
    tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return tokenCache.token;
}
/**
 * 向 Teams 用户发送主动消息（直接调 Bot Framework REST API，不需要对方先联系 Bot）
 * conversationReference 在用户安装 Bot 时通过 conversationUpdate 事件获得
 */
async function sendTeamsProactive(serviceUrl, conversationId, text) {
    const token = await ensureTeamsToken();
    // serviceUrl 形如 https://smba.trafficmanager.net/amer/<tenant>/
    const base = serviceUrl.endsWith("/") ? serviceUrl : serviceUrl + "/";
    const sendUrl = `${base}v3/conversations/${conversationId}/activities`;
    const payload = {
        type: "message",
        text,
        from: { id: `28:${TEAMS_BOT_ID}` },
        conversation: { id: conversationId },
        channelId: "msteams",
    };
    const resp = await fetch(sendUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept-Encoding": "identity",
        },
        body: JSON.stringify(payload),
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Teams send failed: ${resp.status} ${body}`);
    }
    console.log(`[teams-proactive] sent to ${conversationId}: ${text.substring(0, 60)}`);
}
/**
 * 根据 teamsUserKey 查 userLink 发送（兼容旧接口）
 */
async function sendTeamsProactiveByKey(teamsUserKey, text) {
    const link = (0, user_link_repo_1.getUserLink)(teamsUserKey);
    if (!link) {
        throw new Error(`[teams] no userLink for ${teamsUserKey}`);
    }
    await sendTeamsProactive(link.serviceUrl, link.conversationId, text);
}
//# sourceMappingURL=teams-client.js.map