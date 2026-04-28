import { Router, Request, Response } from "express";
import { isDuplicate, saveMessageMap } from "../../store/message-map.repo";
import { sendTeamsProactive, sendTeamsProactiveByKey } from "../../outbound/teams-client";
import { searchTeamsUsers } from "../../outbound/graph-client";
import { upsertUserLink } from "../../store/user-link.repo";
import { sendFeishuMessage, getFeishuUserByOpenId } from "../../outbound/feishu-client";
import { formatSessionList, formatWhoReply, formatNoActiveWarning, formatFromFeishu, formatAutoActivatedTip } from "../../core/formatter";
import { savePendingSelections, getPendingSelections, clearPendingSelections } from "../../store/session.repo";
import { v4 as uuidv4 } from "uuid";

function extractText(evt: any): string {
  try { return JSON.parse(evt.message?.content || "{}").text || ""; } catch { return ""; }
}

const HELP_MSG = [
  "📖 飞书端指令帮助",
  "",
  "/chat <邮箱前缀>       — 搜索 Teams 用户并发起会话",
  "                        示例：/chat zhengya.si",
  "/select <序号>          — 从搜索结果中选择",
  "/connect teams:<邮箱>   — 直接连接 Teams 用户",
  "/list                   — 查看所有会话",
  "/who                    — 查看当前活跃会话",
  "/clear                  — 清空所有会话",
  "/help                   — 显示本帮助",
  "",
  "💡 连接后直接发消息即可跨平台转发 🔗",
].join("\n");

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  try {
    const b = req.body;
    if (b.challenge) return res.json({ challenge: b.challenge });

    const evt = b.event || {};
    const senderOpenId = evt.sender?.sender_id?.open_id || b.senderOpenId || "";
    const senderDisplay = evt.sender?.name || b.senderDisplay || senderOpenId;
    const chatId = evt.message?.chat_id || b.chatId || "";
    const messageId = evt.message?.message_id || b.messageId || "";
    const rawText = b.text || extractText(evt) || "";
    // 如果 senderDisplay 是 open_id（事件中无名称），尝试获取用户真实姓名
    let resolvedSenderDisplay = senderDisplay;
    if (senderDisplay === senderOpenId && senderOpenId) {
      try {
        const userInfo = await getFeishuUserByOpenId(senderOpenId);
        if (userInfo?.name) resolvedSenderDisplay = userInfo.name;
      } catch { /* ignore */ }
    }

    if (isDuplicate("feishu", messageId)) return res.json({ status: "duplicate" });

    // 命令解析
    const cmdMatch = /^\/(\S+)(?:\s+(.*))?$/i.exec(rawText.trim());
    const cmd = cmdMatch ? cmdMatch[1].toLowerCase() : null;
    const args = cmdMatch?.[2]?.trim() || "";

    // ownerKey = 飞书用户的 open_id
    const ownerKey = senderOpenId;

    // 动态导入（避免循环依赖）
    const sm = await import("../../core/session-manager");
    const { default: db } = await import("../../store/db");

    // --- /chat <Teams邮箱前缀> ---
    if (cmd === "chat") {
      if (!args) {
        const reply = "⚠️ 请指定邮箱前缀：/chat <邮箱前缀>\n示例：/chat zhengya.si";
        try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
        return res.json({ status: "ok" });
      }
      try {
        const results = await searchTeamsUsers(args);
        if (results.length === 0) {
          const reply = `❌ 未找到匹配用户：${args}\n\n请检查邮件前缀后重试`;
          try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
          return res.json({ status: "ok" });
        }
        if (results.length === 1) {
          // 获取飞书用户信息（仅用于日志；spec §2.1：A /chat B 只建 A→B）
          const feishuUser = await getFeishuUserByOpenId(ownerKey).catch(() => null) as { name: string; email: string } | null;

          const { findOrCreate, activateSession, flushPendingMessages, getDb } = await import("../../store/session.repo");
          const { formatUnreadReplay } = await import("../../core/formatter");

          const feishuSearchResult = {
            email: results[0].email,
            displayName: results[0].displayName,
            platform: "teams" as const,
            receiveIdType: results[0].receiveIdType || "user_key",
            receiveId: results[0].receiveId,
          };

          // spec §2.1：只建 owner→peer 的 session
          const feishuSession = findOrCreate(ownerKey, "feishu", feishuSearchResult);
          activateSession(ownerKey, "feishu", feishuSession.sessionId);

          // 更新 feishu_chat_id（方便后续 fallback 发送）
          getDb().prepare("UPDATE sessions SET feishu_chat_id=? WHERE session_id=? AND owner_key=?").run(chatId, feishuSession.sessionId, ownerKey);

          // 回放 pending 消息（如果有）
          const unreadPending = flushPendingMessages(ownerKey, feishuSession.sessionId);
          let reply = `✅ 找到唯一匹配：${results[0].displayName}（${results[0].email}）\n已自动切换到与【${results[0].displayName}（Teams）】的对话`;
          if (unreadPending.length > 0) reply += "\n\n" + formatUnreadReplay(unreadPending);
          try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
          return res.json({ status: "ok" });
        }
        // 多结果：暂存并展示列表
        savePendingSelectionsToFile(ownerKey, results);
        const lines = results.map((r, i) => `${i+1}️⃣  ${r.email} — ${r.displayName}${r.department ? `（${r.department}）` : ""}`);
        const reply = `🔍 搜索结果：\n\n${lines.join("\n")}\n\n👉 输入 /select <序号> 选择对象`;
        try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
        return res.json({ status: "ok" });
      } catch (e: any) {
        console.error("[feishu /chat] error:", e);
        const reply = `❌ 搜索失败：${e?.message || e}`;
        try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
        return res.json({ status: "ok" });
      }
    }

    // --- /select <序号> ---
    if (cmd === "select") {
      const idx = parseInt(args, 10);
      if (isNaN(idx)) {
        const reply = "⚠️ 请输入数字：/select <序号>";
        try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
        return res.json({ status: "ok" });
      }
      const pending = getPendingSelectionsFromFile(ownerKey);
      if (!pending || pending.length === 0) {
        const reply = "⚠️ 没有待选择的搜索结果\n请先使用 /chat <邮箱前缀> 搜索\n示例：/chat zhengya.si";
        try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
        return res.json({ status: "ok" });
      }
      if (idx < 1 || idx > pending.length) {
        const reply = "⚠️ 序号超出范围，请重新选择";
        try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
        return res.json({ status: "ok" });
      }
      const selected = pending[idx - 1];
      // spec §2.1：/select 只建 owner→peer session
      const { findOrCreate, activateSession, flushPendingMessages, getDb } = await import("../../store/session.repo");
      const { formatUnreadReplay } = await import("../../core/formatter");

      const feishuSearchResult = {
        email: selected.email,
        displayName: selected.displayName,
        platform: "teams" as const,
        receiveIdType: selected.receiveIdType || "user_key",
        receiveId: selected.receiveId,
      };

      const feishuSession = findOrCreate(ownerKey, "feishu", feishuSearchResult);
      activateSession(ownerKey, "feishu", feishuSession.sessionId);
      getDb().prepare("UPDATE sessions SET feishu_chat_id=? WHERE session_id=? AND owner_key=?").run(chatId, feishuSession.sessionId, ownerKey);

      clearPendingSelectionsFromFile(ownerKey);
      // 回放 pending 消息（如果有）
      const unreadPending = flushPendingMessages(ownerKey, feishuSession.sessionId);
      let reply = `✅ 已切换到与【${selected.displayName}（Teams）】的对话`;
      if (unreadPending.length > 0) reply += "\n\n" + formatUnreadReplay(unreadPending);
      try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
      return res.json({ status: "ok" });
    }

    // --- /connect teams:<邮箱> ---
    if (cmd === "connect" && args.toLowerCase().startsWith("teams:")) {
      const email = args.slice(6).trim();
      if (!email) {
        const reply = "⚠️ 请指定邮箱：/connect teams:<邮箱>\n示例：/connect teams:zhengya@company.com";
        try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
        return res.json({ status: "ok" });
      }
      try {
        const results = await searchTeamsUsers(email);
        if (results.length === 0) {
          const reply = `❌ 未找到 Teams 用户：${email}\n\n请检查邮箱是否正确`;
          try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
          return res.json({ status: "ok" });
        }
        const user = results[0];

        // 获取飞书用户信息（用于在 Teams 侧 session 显示和主动消息）
        const feishuUser = await getFeishuUserByOpenId(ownerKey).catch(() => null) as { name: string; email: string } | null;
        const feishuDisplayName = feishuUser?.name || ownerKey;
        const feishuEmail = feishuUser?.email || "";

        // 创建 conversation 并发主动消息
        try {
          console.log("[feishu /connect] Creating conv for:", user.receiveId);
          await createTeamsConversationAndSend(user.receiveId, `💬 ${feishuDisplayName}（飞书）请求与您建立会话。\n\n请回复任意消息开始沟通。`, feishuDisplayName);
        } catch (e: any) {
          console.error("[feishu /connect] Teams proactive failed:", e?.message);
          const reply = `❌ 连接失败：${e?.message || "请确认对方在 Teams 上安装了 Bot"}`;
          try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
          return res.json({ status: "ok" });
        }

        // 建立 session（双向）
        const { buildSessionId, deactivateAll } = await import("../../store/session.repo");
        const thisChatId = chatId;
        const txn = db.transaction(() => {
          // Feishu 侧 session
          deactivateAll(ownerKey, "feishu");
          const feishuSid = buildSessionId("teams", "user_key", user.receiveId);
          db.prepare(`INSERT OR REPLACE INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state,unread_count,feishu_chat_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
            feishuSid, ownerKey, "feishu", "teams", user.receiveIdType || "user_key", user.receiveId, user.email, user.displayName, "active", 0, thisChatId
          );
          db.prepare(`INSERT OR REPLACE INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(ownerKey, 'feishu', feishuSid);
          // Teams 侧 session（让 Teams 发消息给这个飞书用户），peerEmail 存飞书用户的邮箱
          const teamsSid = buildSessionId("feishu", "open_id", ownerKey);
          db.prepare(`INSERT OR REPLACE INTO sessions (session_id,owner_key,owner_platform,peer_platform,peer_receive_id_type,peer_receive_id,peer_email,display_name,state,unread_count,feishu_chat_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
            teamsSid, user.receiveId, "teams", "feishu", "open_id", ownerKey, feishuEmail, feishuDisplayName, "active", 0, thisChatId
          );
          db.prepare(`INSERT OR REPLACE INTO session_states (owner_key,owner_platform,active_session_id) VALUES (?,?,?)`).run(user.receiveId, 'teams', teamsSid);
        });
        txn();

        const reply = `✅ 已找到并连接：${user.displayName}（${user.email}）\n\n已切换到与【${user.displayName}（Teams）】的对话`;
        try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
        return res.json({ status: "ok" });
      } catch (e: any) {
        console.error("[feishu /connect] error:", e);
        const reply = `❌ 连接失败：${e?.message || e}`;
        try { await sendFeishuMessage("open_id", senderOpenId, reply, chatId); } catch { /* ignore */ }
        return res.json({ status: "ok" });
      }
    }

    // --- /list ---
    if (cmd === "list") {
      try {
        // 仅列出该飞书用户作为 owner、peer 为 Teams 的会话（spec §5：用户视角）
        let sessions = sm.listAllSessions(ownerKey, "feishu")
          .filter(s => s.peerPlatform === "teams");
        // 过滤"自己"：peer_email 等于当前飞书用户自己的邮箱 → 历史遗留 self 条目
        try {
          const self = await getFeishuUserByOpenId(ownerKey).catch(() => null) as { email?: string } | null;
          const selfEmail = (self?.email || "").toLowerCase();
          if (selfEmail) sessions = sessions.filter(s => (s.peerEmail || "").toLowerCase() !== selfEmail);
        } catch { /* ignore */ }
        const active = sm.getActiveSession(ownerKey, "feishu");
        const reply = formatSessionList(sessions, active?.sessionId, "feishu");
        await sendFeishuMessage("open_id", senderOpenId, reply, chatId);
      } catch (e: any) {
        console.error("[feishu /list] send failed:", e?.message);
      }
      return res.json({ status: "ok" });
    }

    // --- /who ---
    if (cmd === "who") {
      try {
        const s = sm.getActiveSession(ownerKey, "feishu");
        const reply = formatWhoReply(s, "feishu");
        await sendFeishuMessage("open_id", senderOpenId, reply, chatId);
      } catch (e: any) {
        console.error("[feishu /who] send failed:", e?.message);
      }
      return res.json({ status: "ok" });
    }

    // --- /help ---
    if (cmd === "help") {
      try {
        await sendFeishuMessage("open_id", senderOpenId, HELP_MSG, chatId);
      } catch (e: any) {
        console.error("[feishu /help] send failed:", e?.message);
      }
      return res.json({ status: "ok" });
    }

    // --- /clear ---
    if (cmd === "clear") {
      try {
        sm.clearAllSessions(ownerKey);
        await sendFeishuMessage("open_id", senderOpenId, "🗑️ 所有会话已清空", chatId);
      } catch (e: any) {
        console.error("[feishu /clear] send failed:", e?.message);
      }
      return res.json({ status: "ok" });
    }

    // --- 普通消息路由（design §6 "路由铁律"）---
    // 1. 先 ensureReverseSession（由 routeFeishuInbound 内部调用）
    // 2. 再写 message_map
    // 3. 最后发送
    const { routeFeishuInbound } = await import("../../core/router");
    // 飞书 create_time 是毫秒字符串，需要先转 ISO 才能下游正确解析
    const rawTs = evt.message?.createTime || evt.message?.create_time;
    let normalizedTs: string;
    if (rawTs && /^\d+$/.test(String(rawTs))) {
      normalizedTs = new Date(parseInt(String(rawTs), 10)).toISOString();
    } else if (rawTs) {
      normalizedTs = String(rawTs);
    } else {
      normalizedTs = new Date().toISOString();
    }
    const inboundMsg = {
      senderOpenId: ownerKey,
      senderDisplay: resolvedSenderDisplay,
      chatId,
      messageId,
      text: rawText,
      timestamp: normalizedTs,
    };
    const action = await routeFeishuInbound(inboundMsg, ownerKey);

    switch (action.type) {
      case "reply_bot":
        try { await sendFeishuMessage("open_id", senderOpenId, action.text, chatId); } catch { /* ignore */ }
        return res.json({ status: "ok" });
      case "forward_to_teams": {
        try {
          if (action.tip) await sendTeamsProactiveByKey(action.teamsUserKey, action.tip);
          await sendTeamsProactiveByKey(action.teamsUserKey, action.content);
          saveMessageMap({ srcPlatform: "feishu", srcMessageId: action.srcMessageId, dstPlatform: "teams", dstMessageId: "", sessionId: action.sessionId, uuid: uuidv4(), createdAt: "" });
        } catch (e: any) {
          console.error("[feishu->teams] forward failed:", e?.message);
          try { await sendFeishuMessage("open_id", senderOpenId, "❌ 对方尚未启用 Bot 或消息发送失败", chatId); } catch { /* ignore */ }
        }
        return res.json({ status: "forwarded" });
      }
      case "notify_teams_peer": {
        // spec §10：飞书→Teams notify；接收方看到通知，发送方不收任何回执
        const { formatNonActiveNotification } = await import("../../core/formatter");
        // Teams 侧 /chat 需完整邮箱（chatUsage("teams")），使用发送方的飞书邮箱全拼
        let chatHint = action.senderDisplay;
        try {
          const u = await getFeishuUserByOpenId(action.senderOpenId).catch(() => null) as { email?: string } | null;
          if (u?.email) chatHint = u.email;
        } catch { /* ignore */ }
        const notification = formatNonActiveNotification(action.senderDisplay, action.unread, undefined, chatHint);
        try {
          await sendTeamsProactiveByKey(action.teamsUserKey, notification);
        } catch (e: any) {
          console.error("[feishu->teams] notify send failed:", e?.message);
        }
        saveMessageMap({ srcPlatform: "feishu", srcMessageId: action.srcMessageId, dstPlatform: "teams", dstMessageId: "", sessionId: action.sessionId, uuid: uuidv4(), createdAt: "" });
        return res.json({ status: "ok" });
      }
      case "noop":
        return res.json({ status: "ok" });
      default:
        return res.json({ status: "ok" });
    }
  } catch (e) {
    console.error("[inbound/feishu]", e);
    res.status(500).json({ error: "internal" });
  }
});

// ===== Pending Selections (多结果选择) =====
// 直接使用顶部导入的 session.repo 函数（db 在模块级别已初始化，无循环依赖）
function savePendingSelectionsToFile(ownerKey: string, results: import("../../types").SearchResult[]): void {
  savePendingSelections(ownerKey, results);
}
function getPendingSelectionsFromFile(ownerKey: string): import("../../types").SearchResult[] | null {
  return getPendingSelections(ownerKey);
}
function clearPendingSelectionsFromFile(ownerKey: string): void {
  clearPendingSelections(ownerKey);
}

/**
 * 向 Teams 用户发主动消息（优先用已缓存的 conversation）
 * @param teamsUserAadId Teams 用户的 AAD ID
 * @param text 消息内容
 * @param senderDisplayName 发送方（飞书用户）的显示名称
 */
async function createTeamsConversationAndSend(teamsUserAadId: string, text: string, senderDisplayName?: string): Promise<void> {
  const { getUserLink } = await import("../../store/user-link.repo");
  const { sendTeamsProactive } = await import("../../outbound/teams-client");
  const { upsertUserLink } = await import("../../store/user-link.repo");

  // 先查 user_links，看是否有现成的 conversation
  const existing = getUserLink(teamsUserAadId);
  if (existing) {
    console.log(`[feishu /connect] reusing cached conversation for ${teamsUserAadId}`);
    try {
      await sendTeamsProactive(existing.serviceUrl, existing.conversationId, text);
      return;
    } catch (e: any) {
      console.warn(`[feishu /connect] cached conv failed (${e?.message}), trying to recreate`);
    }
  }

  // 没有缓存，创建新 conversation
  const { ensureTeamsToken } = await import("../../outbound/teams-client");
  const token = await ensureTeamsToken();
  const tenantId = process.env.GRAPH_TENANT_ID || "";

  const createUrl = `https://smba.trafficmanager.net/amer/v3/conversations`;
  const createPayload = {
    bot: { tenantId, id: process.env.TEAMS_BOT_ID || process.env.TEAMS_APP_ID },
    isGroup: false,
    members: [{ "odata.type": "microsoft.bot.service.bots.v4.channels.teams.IOSBotChannel", "aadObjectId": teamsUserAadId }],
    channelData: { tenant: tenantId },
  };
  const cr = await fetch(createUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(createPayload),
  });
  if (!cr.ok) {
    const errText = await cr.text();
    throw new Error(`createConversation: ${cr.status} ${errText}`);
  }
  const conv = await cr.json() as { id?: string; serviceUrl?: string };
  if (!conv.id || !conv.serviceUrl) throw new Error("missing conversation id/serviceUrl");

  upsertUserLink({ teamsUserKey: teamsUserAadId, conversationId: conv.id, serviceUrl: conv.serviceUrl, createdAt: new Date().toISOString() });
  await sendTeamsProactive(conv.serviceUrl, conv.id, text);
}

export default router;
