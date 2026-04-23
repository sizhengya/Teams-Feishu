"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertUserLink = upsertUserLink;
exports.getUserLink = getUserLink;
const db_1 = __importDefault(require("./db"));
function upsertUserLink(l) {
    db_1.default.prepare("INSERT INTO user_links (teams_user_key,conversation_id,service_url) VALUES (?,?,?) ON CONFLICT(teams_user_key) DO UPDATE SET conversation_id=excluded.conversation_id,service_url=excluded.service_url").run(l.teamsUserKey, l.conversationId, l.serviceUrl);
}
function getUserLink(k) {
    const r = db_1.default.prepare("SELECT * FROM user_links WHERE teams_user_key=?").get(k);
    return r ? { teamsUserKey: r.teams_user_key, conversationId: r.conversation_id, serviceUrl: r.service_url, createdAt: r.created_at } : undefined;
}
//# sourceMappingURL=user-link.repo.js.map