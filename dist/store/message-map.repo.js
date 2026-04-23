"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveMessageMap = saveMessageMap;
exports.isDuplicate = isDuplicate;
const db_1 = __importDefault(require("./db"));
function saveMessageMap(m) { db_1.default.prepare("INSERT INTO message_maps (src_platform,src_message_id,dst_platform,dst_message_id,session_id,uuid) VALUES (?,?,?,?,?,?)").run(m.srcPlatform, m.srcMessageId, m.dstPlatform, m.dstMessageId, m.sessionId, m.uuid); }
function isDuplicate(p, mid) { return !!db_1.default.prepare("SELECT 1 FROM message_maps WHERE src_platform=? AND src_message_id=?").get(p, mid); }
//# sourceMappingURL=message-map.repo.js.map