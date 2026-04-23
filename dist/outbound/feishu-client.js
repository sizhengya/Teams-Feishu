"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendFeishuMessage = sendFeishuMessage;
exports.getFeishuUserByOpenId = getFeishuUserByOpenId;
exports.searchFeishuUsers = searchFeishuUsers;
const axios_1 = __importDefault(require("axios"));
const uuid_1 = require("uuid");
const retry_1 = require("../infra/retry");
const rate_limit_1 = require("../infra/rate-limit");
const AID = process.env.FEISHU_APP_ID || "";
const SEC = process.env.FEISHU_APP_SECRET || "";
const BASE = "https://open.feishu.cn/open-apis";
let tok = "";
let exp = 0;
async function ensureToken() {
    if (tok && Date.now() < exp)
        return tok;
    const r = await axios_1.default.post(`${BASE}/auth/v3/tenant_access_token/internal`, { app_id: AID, app_secret: SEC });
    tok = r.data.tenant_access_token;
    exp = Date.now() + (r.data.expire - 300) * 1000;
    return tok;
}
/** 发送飞书消息（优先用 open_id，失败后尝试 chat_id fallback） */
async function sendFeishuMessage(idType, id, content, chatIdFallback) {
    await rate_limit_1.feishuLimiter.waitForToken(id);
    const t = await ensureToken();
    const uuid = (0, uuid_1.v4)();
    // Try primary ID type first
    try {
        const res = await (0, retry_1.retryWithBackoff)(async () => axios_1.default.post(`${BASE}/im/v1/messages`, { receive_id: id, msg_type: "text", content: JSON.stringify({ text: content }), uuid }, { params: { receive_id_type: idType }, headers: { Authorization: `Bearer ${t}` } }));
        // 检查 API 返回码（非 0 表示失败）；Feishu API 错误码在 res.data.code
        const apiCode = res.data?.code;
        if (apiCode !== 0 && apiCode !== undefined) {
            const apiErr = new Error(`Feishu API error ${apiCode}: ${res.data?.msg || ""}`);
            apiErr.code = apiCode;
            throw apiErr;
        }
        return res.data?.data?.message_id || "";
    }
    catch (err) {
        const errCode = err?.code ?? err?.response?.data?.code;
        // If open_id failed with cross-app error, try chat_id fallback
        if ((errCode === 99992361 || errCode === 99991661) && chatIdFallback) {
            console.log(`[feishu] primary send failed (${errCode}), falling back to chat_id ${chatIdFallback}`);
            const res2 = await axios_1.default.post(`${BASE}/im/v1/messages`, { receive_id: chatIdFallback, msg_type: "text", content: JSON.stringify({ text: content }), uuid }, { params: { receive_id_type: "chat_id" }, headers: { Authorization: `Bearer ${t}` } });
            const apiCode2 = res2.data?.code;
            if (apiCode2 !== 0 && apiCode2 !== undefined)
                throw new Error(`Feishu chat_id fallback failed: ${res2.data?.msg}`);
            return res2.data?.data?.message_id || "";
        }
        throw err;
    }
}
/**
 * 根据 open_id 获取飞书用户信息（名称、邮箱等）
 */
async function getFeishuUserByOpenId(openId) {
    const t = await ensureToken();
    try {
        const r = await axios_1.default.get(`${BASE}/contact/v3/users/${openId}`, {
            params: { user_id_type: "open_id" },
            headers: { Authorization: `Bearer ${t}` }
        });
        if (r.data?.code === 0 && r.data?.data?.user) {
            const u = r.data.data.user;
            return {
                name: u.name || "",
                email: u.enterprise_email || u.email || ""
            };
        }
    }
    catch { }
    return null;
}
/**
 * 通过邮件前缀搜索飞书用户
 * 使用飞书通讯录 API：POST /contact/v3/users/batch_get_id（按 email）
 * 或使用搜索 API：GET /search/v1/user
 *
 * 这里使用 GET /contact/v3/users 按 email 模糊匹配的方式
 * 实际部署时需要应用有 contact:user.base:readonly 权限
 */
async function searchFeishuUsers(emailPrefix) {
    const t = await ensureToken();
    // 优先尝试官方搜索 API（需要 search:user 权限）
    try {
        const res = await (0, retry_1.retryWithBackoff)(async () => axios_1.default.get(`${BASE}/search/v1/user`, {
            params: { query: emailPrefix, page_size: 10 },
            headers: { Authorization: `Bearer ${t}` }
        }));
        const items = res.data?.data?.items || [];
        const filtered = items
            .map((u) => ({
            email: u.enterprise_email || u.email || "",
            displayName: u.name || "",
            platform: "feishu",
            receiveIdType: "open_id",
            receiveId: u.open_id || "",
            department: u.department_name || "",
        }))
            .filter((r) => r.email.toLowerCase().startsWith(emailPrefix.toLowerCase()) && r.receiveId);
        if (filtered.length > 0)
            return filtered;
    }
    catch (err) {
        console.warn("[feishu-search] search API failed:", err.message);
    }
    // 降级方案：用通讯录 API 列举用户并客户端过滤（需要 contact:user.base:readonly）
    // 飞书企业邮箱前缀格式: name@company.domain
    // 尝试用 batch_get_id 精确匹配（emailPrefix 可能是完整邮箱）
    const emailsToTry = [emailPrefix];
    // 如果 emailPrefix 不含 @，尝试加上默认域名
    if (!emailPrefix.includes("@")) {
        // 尝试从已知的用户里找匹配的，或者跳过
    }
    try {
        const res2 = await (0, retry_1.retryWithBackoff)(async () => axios_1.default.post(`${BASE}/contact/v3/users/batch_get_id`, {
            emails: emailsToTry,
            include_resigned: false,
        }, {
            params: { user_id_type: "open_id" },
            headers: { Authorization: `Bearer ${t}` }
        }));
        const list = res2.data?.data?.user_list || [];
        const found = list.filter((u) => u.user_id);
        if (found.length > 0) {
            // batch_get_id 返回的字段是 user_id (open_id 类型)，直接用它
            return found.map((u) => ({
                email: u.email || emailPrefix,
                displayName: u.email ? u.email.split('@')[0] : emailPrefix,
                platform: "feishu",
                receiveIdType: "open_id",
                receiveId: u.user_id,
                department: "",
            }));
        }
    }
    catch (err2) {
        console.warn("[feishu-search] batch_get_id failed:", err2.message);
    }
    return [];
}
//# sourceMappingURL=feishu-client.js.map