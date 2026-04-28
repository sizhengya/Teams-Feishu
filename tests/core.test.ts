/**
 * 针对 v3-final 核心决策逻辑的单测。
 * 使用独立临时 DB（通过 DB_PATH 环境变量），避免污染 data/bridge.db。
 *
 * 运行：`DB_PATH=/tmp/test-bridge.db npx ts-node tests/core.test.ts`
 */
import fs from "fs";
import path from "path";

const TEST_DB = "/tmp/bridge-test-" + Date.now() + ".db";
process.env.DB_PATH = TEST_DB;

// 必须在 import 应用代码之前设置 DB_PATH
/* eslint-disable @typescript-eslint/no-var-requires */
const db = require("../src/store/db").default;
const repo = require("../src/store/session.repo");
const sm = require("../src/core/session-manager");
const { routeTeamsInbound, routeFeishuInbound } = require("../src/core/router");
const { notificationMerger } = require("../src/core/notifier");

let passed = 0;
let failed = 0;

function assert(cond: any, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function resetDb() {
  db.exec("DELETE FROM sessions; DELETE FROM session_states; DELETE FROM pending_messages; DELETE FROM message_maps; DELETE FROM pending_selections; DELETE FROM user_links;");
  // 清 merger 内存
  (notificationMerger as any).m = new Map();
}

// 准备一对已建立双向 session 的用户（/connect 已完成的状态）
function seedBidirectional(feishuOpenId: string, teamsAad: string) {
  const feishuSid = repo.buildSessionId("teams", "aad_id", teamsAad);
  const teamsSid = repo.buildSessionId("feishu", "open_id", feishuOpenId);
  db.prepare(`INSERT INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(feishuSid, feishuOpenId, "feishu", "teams", "aad_id", teamsAad, "bob@x.com", "Bob", "active");
  db.prepare(`INSERT INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(feishuOpenId, "feishu", feishuSid);
  db.prepare(`INSERT INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(teamsSid, teamsAad, "teams", "feishu", "open_id", feishuOpenId, "alice@x.com", "Alice", "active");
  db.prepare(`INSERT INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(teamsAad, "teams", teamsSid);
  return { feishuSid, teamsSid };
}

// =============================================================================

async function testPendingMessagesSchema() {
  console.log("\n[TC-01] pending_messages schema 与 insert 匹配");
  resetDb();
  const fOid = "ou_test1", tAad = "aad_test1";
  seedBidirectional(fOid, tAad);
  const sid = repo.buildSessionId("teams", "aad_id", tAad);
  // 直接调 repo.savePendingMessage 不应抛错
  try {
    repo.savePendingMessage(sid, fOid, "[Bob | teams]：hi", "2026-04-22T00:00:00Z");
    const rows = db.prepare("SELECT * FROM pending_messages WHERE owner_key=?").all(fOid);
    assert(rows.length === 1, "savePendingMessage 成功写入");
    assert(rows[0].formatted_content === "[Bob | teams]：hi", "formatted_content 正确");
  } catch (e: any) {
    assert(false, "savePendingMessage 不应抛错: " + e.message);
  }
}

async function testDeliver() {
  console.log("\n[TC-02] deliver: sender 和 receiver 都 active=彼此");
  resetDb();
  const fOid = "ou_alice", tAad = "aad_bob";
  seedBidirectional(fOid, tAad);
  // Teams Bob 发给 Feishu Alice（双方 active 指向对方）
  const action = await routeTeamsInbound({
    teamsUserKey: tAad, conversationId: "c1", serviceUrl: "s", messageId: "m1",
    senderDisplay: "Bob", text: "hello", timestamp: "2026-04-22T00:00:00Z",
  });
  assert(action.type === "forward_to_feishu", `action.type=forward_to_feishu (got ${action.type})`);
  if (action.type === "forward_to_feishu") {
    assert(action.peerId === fOid, "peerId = Feishu open_id");
    assert(!action.tip, "deliver 不应带 tip");
    assert(action.srcMessageId === "m1", "srcMessageId 正确保留");
  }
  const unread = db.prepare("SELECT unread_count FROM sessions WHERE owner_key=? AND peer_receive_id=?").get(fOid, tAad) as any;
  assert(unread?.unread_count === 0, "unread 仍为 0");
  assert(db.prepare("SELECT COUNT(*) c FROM pending_messages").get().c === 0, "不写 pending");
}

async function testDeliverActivated() {
  console.log("\n[TC-03] deliver_activated: receiver 无 active → 仅通知，正文存 pending（spec v3-final §3）");
  resetDb();
  const fOid = "ou_alice2", tAad = "aad_bob2";
  // Teams Bob 发起：先 /chat → Bob 有 active 指向 Alice。Alice（receiver）还没有任何 session。
  const tSid = repo.buildSessionId("feishu", "open_id", fOid);
  db.prepare(`INSERT INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(tSid, tAad, "teams", "feishu", "open_id", fOid, "alice@x.com", "Alice", "active");
  db.prepare(`INSERT INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(tAad, "teams", tSid);

  const action = await routeTeamsInbound({
    teamsUserKey: tAad, conversationId: "c1", serviceUrl: "s", messageId: "m-first",
    senderDisplay: "Bob", text: "SECRET-NO-LEAK", timestamp: "2026-04-22T00:00:00Z",
  });
  assert(action.type === "notify_feishu_peer", `action.type=notify_feishu_peer (got ${action.type})`);
  if (action.type === "notify_feishu_peer") {
    const hasBody = JSON.stringify(action).includes("SECRET-NO-LEAK");
    assert(!hasBody, "deliver_activated action 不带正文（spec §3 铁律）");
  }
  // pending 应已写入正文
  const pending = db.prepare("SELECT * FROM pending_messages WHERE owner_key=?").all(fOid) as any[];
  assert(pending.length === 1, "pending 存 1 条");
  assert(pending[0].formatted_content.includes("SECRET-NO-LEAK"), "pending.formatted_content 含正文");
  // receiver 不应被自动激活（等待用户 /chat）
  const revActive = db.prepare("SELECT active_session_id FROM session_states WHERE owner_key=?").get(fOid) as any;
  assert(!revActive, "receiver 不被自动激活（必须由用户 /chat 触发回放）");
  // unread +1
  const sid = repo.buildSessionId("teams", "aad_id", tAad);
  const rev = db.prepare("SELECT unread_count FROM sessions WHERE owner_key=? AND session_id=?").get(fOid, sid) as any;
  assert(rev?.unread_count === 1, "unread=1");
  // design §2 "A→B ≠ B→A"：Teams 发送方 Bob 的 active 不应被改（仍指向 tSid）
  const senderActive = db.prepare("SELECT active_session_id FROM session_states WHERE owner_key=?").get(tAad) as any;
  assert(senderActive?.active_session_id === tSid, "发送方 active 未被改写（design §2）");
}

async function testNotify() {
  console.log("\n[TC-04] notify: receiver active 是别人");
  resetDb();
  const fOid = "ou_alice3", bobAad = "aad_bob3", cAad = "aad_carol";
  // Alice ↔ Carol active（双向）
  seedBidirectional(fOid, cAad);
  // Bob 发给 Alice：Bob 侧先建立 active 指向 Alice
  const tSid = repo.buildSessionId("feishu", "open_id", fOid);
  db.prepare(`INSERT INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(tSid, bobAad, "teams", "feishu", "open_id", fOid, "alice@x.com", "Alice", "active");
  db.prepare(`INSERT INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(bobAad, "teams", tSid);

  const action = await routeTeamsInbound({
    teamsUserKey: bobAad, conversationId: "c1", serviceUrl: "s", messageId: "m-notify",
    senderDisplay: "Bob", text: "SECRET-DO-NOT-DELIVER", timestamp: "2026-04-22T00:01:00Z",
  });
  assert(action.type === "notify_feishu_peer", `action.type=notify_feishu_peer (got ${action.type})`);
  // spec: notify 不含正文
  if (action.type === "notify_feishu_peer") {
    const hasBody = JSON.stringify(action).includes("SECRET-DO-NOT-DELIVER");
    assert(!hasBody, "notify action 不带正文（spec §3 铁律）");
  }
  // pending 里存的是 formatted_content
  const pending = db.prepare("SELECT * FROM pending_messages WHERE owner_key=?").all(fOid);
  assert(pending.length === 1, "pending 存 1 条");
  assert((pending[0] as any).formatted_content.includes("SECRET-DO-NOT-DELIVER"), "pending.formatted_content 含正文");
  // unread +1
  const rev = db.prepare("SELECT unread_count FROM sessions WHERE owner_key=? AND peer_receive_id=?").get(fOid, bobAad) as any;
  assert(rev?.unread_count === 1, "unread=1");
  // Alice ↔ Carol 的 session unread 未受影响
  const carolS = db.prepare("SELECT unread_count FROM sessions WHERE owner_key=? AND peer_receive_id=?").get(fOid, cAad) as any;
  assert(carolS?.unread_count === 0, "与 Carol 的 session unread 未变");
}

async function testNoActive() {
  console.log("\n[TC-05] spec §1: 发送方无 active → 拒绝");
  resetDb();
  const bobAad = "aad_bob4";
  // Bob 无任何 session
  const action = await routeTeamsInbound({
    teamsUserKey: bobAad, conversationId: "c", serviceUrl: "s", messageId: "m",
    senderDisplay: "Bob", text: "hi", timestamp: "2026-04-22T00:00:00Z",
  });
  assert(action.type === "reply_bot", `action.type=reply_bot (got ${action.type})`);
  if (action.type === "reply_bot") {
    assert(action.text.includes("请先选择会话"), "文案包含提示");
  }
}

async function testNotifyMerge() {
  console.log("\n[TC-06] spec §7: 10s 内通知合并");
  resetDb();
  const fOid = "ou_m", bobAad = "aad_bm", cAad = "aad_cm";
  seedBidirectional(fOid, cAad);
  const tSid = repo.buildSessionId("feishu", "open_id", fOid);
  db.prepare(`INSERT INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(tSid, bobAad, "teams", "feishu", "open_id", fOid, "alice@x.com", "Alice", "active");
  db.prepare(`INSERT INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(bobAad, "teams", tSid);

  const a1 = await routeTeamsInbound({ teamsUserKey: bobAad, conversationId: "c", serviceUrl: "s", messageId: "m1", senderDisplay: "Bob", text: "a", timestamp: "t1" });
  const a2 = await routeTeamsInbound({ teamsUserKey: bobAad, conversationId: "c", serviceUrl: "s", messageId: "m2", senderDisplay: "Bob", text: "b", timestamp: "t2" });
  assert(a1.type === "notify_feishu_peer", "第 1 条 notify");
  assert(a2.type === "noop", `第 2 条应 noop (merge)，实际 ${a2.type}`);
  // 但 pending_messages 应是 2 条（消息必须落库，只是通知被合并）
  const pending = db.prepare("SELECT COUNT(*) c FROM pending_messages").get() as any;
  assert(pending.c === 2, `pending 有 2 条 (got ${pending.c})`);
}

async function testReversedDirection() {
  console.log("\n[TC-07] routeFeishuInbound deliver");
  resetDb();
  const fOid = "ou_r", tAad = "aad_r";
  seedBidirectional(fOid, tAad);
  const action = await routeFeishuInbound({
    senderOpenId: fOid, senderDisplay: "Alice", chatId: "ch", messageId: "fm1", text: "hi bob", timestamp: "t",
  }, fOid);
  assert(action.type === "forward_to_teams", `action.type=forward_to_teams (got ${action.type})`);
  if (action.type === "forward_to_teams") {
    assert(action.teamsUserKey === tAad, "teamsUserKey 正确");
    assert(action.srcMessageId === "fm1", "srcMessageId 保留");
  }
}

async function testFlushAndReplay() {
  console.log("\n[TC-08] spec §6.2 /chat 触发回放且清空");
  resetDb();
  const fOid = "ou_re", tAad = "aad_re";
  // 模拟已有 pending 的 idle session（Bob→Alice 之前发过 notify）
  const sid = repo.buildSessionId("teams", "aad_id", tAad);
  db.prepare(`INSERT INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state,unread_count) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(sid, fOid, "feishu", "teams", "aad_id", tAad, "bob@x.com", "Bob", "idle", 2);
  repo.savePendingMessage(sid, fOid, "[Bob | teams]：m1", "t1");
  repo.savePendingMessage(sid, fOid, "[Bob | teams]：m2", "t2");
  const flushed = sm.flushPendingMessages(fOid, sid);
  assert(flushed.length === 2, "回放 2 条");
  assert(flushed[0].text === "m1" && flushed[1].text === "m2", "回放顺序正确");
  const remaining = db.prepare("SELECT COUNT(*) c FROM pending_messages WHERE owner_key=?").get(fOid) as any;
  assert(remaining.c === 0, "回放后 pending 清空");
}

(async () => {
  try {
    await testPendingMessagesSchema();
    await testDeliver();
    await testDeliverActivated();
    await testNotify();
    await testNoActive();
    await testNotifyMerge();
    await testReversedDirection();
    await testFlushAndReplay();
  } catch (e) {
    console.error("测试运行异常:", e);
    failed++;
  }
  console.log(`\n========== ${passed} passed, ${failed} failed ==========`);
  // 清理
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(TEST_DB, { force: true }); fs.rmSync(TEST_DB + "-shm", { force: true }); fs.rmSync(TEST_DB + "-wal", { force: true }); } catch { /* ignore */ }
  process.exit(failed > 0 ? 1 : 0);
})();
