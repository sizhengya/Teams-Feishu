"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchTeamsUsers = searchTeamsUsers;
const axios_1 = __importDefault(require("axios"));
const retry_1 = require("../infra/retry");
const TENANT = process.env.GRAPH_TENANT_ID || "";
const CID = process.env.GRAPH_CLIENT_ID || "";
const SEC = process.env.GRAPH_CLIENT_SECRET || "";
let tok = "";
let exp = 0;
async function ensureGraphToken() {
    if (tok && Date.now() < exp)
        return tok;
    const r = await (0, retry_1.retryWithBackoff)(async () => axios_1.default.post(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: SEC, scope: "https://graph.microsoft.com/.default" }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
    tok = r.data.access_token;
    exp = Date.now() + (r.data.expires_in - 300) * 1000;
    return tok;
}
/**
 * 通过邮件前缀搜索 Teams (Azure AD) 用户
 * 使用 Microsoft Graph: GET /users?$filter=startswith(mail,'prefix')
 * 需要应用权限：User.Read.All
 */
async function searchTeamsUsers(emailPrefix) {
    const t = await ensureGraphToken();
    const filter = `startswith(mail,'${emailPrefix}') or startswith(userPrincipalName,'${emailPrefix}')`;
    const res = await (0, retry_1.retryWithBackoff)(async () => axios_1.default.get("https://graph.microsoft.com/v1.0/users", {
        params: { "$filter": filter, "$top": 10, "$select": "id,displayName,mail,department,userPrincipalName" },
        headers: { Authorization: `Bearer ${t}` }
    }));
    const users = res.data?.value || [];
    return users.map((u) => ({
        email: u.mail || u.userPrincipalName || "",
        displayName: u.displayName || "",
        platform: "teams",
        receiveIdType: "user_key",
        receiveId: u.id || "",
        department: u.department || "",
    }));
}
//# sourceMappingURL=graph-client.js.map