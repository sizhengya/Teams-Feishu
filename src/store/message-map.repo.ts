import db from "./db";
import { MessageMapEntry } from "../types";
export function saveMessageMap(m:MessageMapEntry):void { db.prepare("INSERT INTO message_maps (src_platform,src_message_id,dst_platform,dst_message_id,session_id,uuid) VALUES (?,?,?,?,?,?)").run(m.srcPlatform,m.srcMessageId,m.dstPlatform,m.dstMessageId,m.sessionId,m.uuid); }
export function isDuplicate(p:string,mid:string):boolean { return !!db.prepare("SELECT 1 FROM message_maps WHERE src_platform=? AND src_message_id=?").get(p,mid); }
