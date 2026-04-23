import Database, { Database as DatabaseType } from "better-sqlite3";
import path from "path";
import fs from "fs";
const DB_PATH = process.env.DB_PATH || "./data/bridge.db";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db: DatabaseType = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS user_links (
    teams_user_key TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
    service_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT NOT NULL, owner_key TEXT NOT NULL, owner_platform TEXT NOT NULL,
    peer_platform TEXT NOT NULL, peer_receive_id_type TEXT NOT NULL,
    peer_receive_id TEXT NOT NULL, peer_email TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'idle',
    unread_count INTEGER NOT NULL DEFAULT 0, last_message_at TEXT,
    feishu_chat_id TEXT,
    PRIMARY KEY (session_id, owner_key)
  );
  CREATE TABLE IF NOT EXISTS session_states (
    owner_key TEXT NOT NULL, owner_platform TEXT NOT NULL, active_session_id TEXT,
    PRIMARY KEY (owner_key, owner_platform)
  );
  CREATE TABLE IF NOT EXISTS message_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT, src_platform TEXT NOT NULL,
    src_message_id TEXT NOT NULL, dst_platform TEXT NOT NULL,
    dst_message_id TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL,
    uuid TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pending_selections (
    owner_key TEXT PRIMARY KEY, results_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pending_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL, owner_key TEXT NOT NULL,
    formatted_content TEXT NOT NULL,
    original_timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pm_session ON pending_messages(owner_key, session_id);
  CREATE INDEX IF NOT EXISTS idx_mm_src ON message_maps(src_platform, src_message_id);
`);

// Migration: legacy pending_messages table may carry extra NOT NULL columns
// (sender_display / text) from older versions. Detect and rebuild to match
// the v3-final design (formatted_content only). Pending messages are
// transient notification buffers, so rebuild is safe.
try {
  const cols = db.prepare("PRAGMA table_info(pending_messages)").all() as Array<{ name: string }>;
  const names = cols.map(c => c.name);
  const hasLegacy = names.includes("sender_display") || names.includes("text");
  if (hasLegacy) {
    db.exec(`
      BEGIN;
      DROP TABLE pending_messages;
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL, owner_key TEXT NOT NULL,
        formatted_content TEXT NOT NULL,
        original_timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pm_session ON pending_messages(owner_key, session_id);
      COMMIT;
    `);
    console.log("[db] pending_messages migrated to v3-final schema");
  }
} catch (e) {
  console.error("[db] pending_messages migration failed:", e);
}
export default db;
