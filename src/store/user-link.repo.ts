import db from "./db";
import { UserLink } from "../types";
export function upsertUserLink(l: UserLink): void {
  db.prepare("INSERT INTO user_links (teams_user_key,conversation_id,service_url) VALUES (?,?,?) ON CONFLICT(teams_user_key) DO UPDATE SET conversation_id=excluded.conversation_id,service_url=excluded.service_url").run(l.teamsUserKey,l.conversationId,l.serviceUrl);
}
export function getUserLink(k: string): UserLink|undefined {
  const r:any = db.prepare("SELECT * FROM user_links WHERE teams_user_key=?").get(k);
  return r ? { teamsUserKey:r.teams_user_key, conversationId:r.conversation_id, serviceUrl:r.service_url, createdAt:r.created_at } : undefined;
}
