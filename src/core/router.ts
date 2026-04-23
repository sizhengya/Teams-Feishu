import { InboundTeamsMessage, InboundFeishuMessage, RouteAction, PeerPlatform } from "../types";
import * as sm from "./session-manager";
import * as fmt from "./formatter";
import { notificationMerger } from "./notifier";
import * as repo from "../store/session.repo";

/**
 * 指令分发 —— 两端共用。命令路径不经过 ensureReverseSession。
 * 返回 null 表示不是命令，交给调用方走普通消息路径。
 */
async function handleCommandTeams(msg: InboundTeamsMessage): Promise<RouteAction | null> {
  const cmd = sm.parseCommand(msg.text);
  if (!cmd) return null;
  switch (cmd.command) {
    case "chat": {
      if (!cmd.args) return { type: "reply_bot", text: "⚠️ 请指定邮件前缀：/chat <邮件前缀>" };
      const result = await sm.chatWithSearch(msg.teamsUserKey, "teams", cmd.args);
      if (result.error) return { type: "reply_bot", text: `❌ ${result.error}` };
      if (result.autoConnected) {
        const ownerKey = result.autoConnected.ownerKey;
        const pending = sm.flushPendingMessages(ownerKey, result.autoConnected.sessionId);
        let reply = fmt.formatAutoConnect(result.autoConnected.displayName, result.autoConnected.peerEmail, result.autoConnected.peerPlatform);
        if (pending.length > 0) reply += "\n\n" + fmt.formatUnreadReplay(pending);
        return { type: "reply_bot", text: reply };
      }
      return { type: "reply_bot", text: fmt.formatSearchResults(result.results!) };
    }
    case "select": {
      const idx = parseInt(cmd.args, 10);
      if (isNaN(idx)) return { type: "reply_bot", text: "⚠️ 请输入数字：/select <序号>" };
      const r = sm.handleSelect(msg.teamsUserKey, "teams", idx);
      if (r.error === "no_pending") return { type: "reply_bot", text: fmt.formatNoPending() };
      if (r.error === "out_of_range") return { type: "reply_bot", text: fmt.formatSelectOutOfRange() };
      const pending = sm.flushPendingMessages(msg.teamsUserKey, r.session!.sessionId);
      let reply = fmt.formatSwitchConfirm(r.session!.displayName, r.session!.peerPlatform);
      if (pending.length > 0) reply += "\n\n" + fmt.formatUnreadReplay(pending);
      return { type: "reply_bot", text: reply };
    }
    case "list":
      return { type: "reply_bot", text: fmt.formatSessionList(sm.listAllSessions(msg.teamsUserKey)) };
    case "who":
      return { type: "reply_bot", text: fmt.formatWhoReply(sm.getActiveSession(msg.teamsUserKey, "teams")) };
    case "help":
      return { type: "reply_bot", text: fmt.formatHelpText() };
    case "clear":
      sm.clearAllSessions(msg.teamsUserKey);
      return { type: "reply_bot", text: fmt.formatClearConfirm() };
    case "connect": {
      if (!cmd.args) return { type: "reply_bot", text: "⚠️ 请指定目标： /connect feishu:<open_id>\n示例： /connect feishu:ou_ed25f0ffb16486c6638b906a1d6d0da7" };
      const r = await sm.handleConnect(msg.teamsUserKey, "teams", cmd.args);
      if (r.error) return { type: "reply_bot", text: `❌ ${r.error}` };
      return { type: "reply_bot", text: fmt.formatSwitchConfirm(r.session!.displayName, r.session!.peerPlatform) };
    }
  }
  return null;
}

/**
 * Teams 入站普通消息路由（design §6 "路由铁律"）：
 * 1. 先校验发送方 active（spec §1：无 active → 拒绝）
 * 2. 调 ensureReverseSession 决策
 * 3. 根据决策生成具体 RouteAction；message_map / 发送由 handler 执行
 */
export async function routeTeamsInbound(msg: InboundTeamsMessage): Promise<RouteAction> {
  const cmdResult = await handleCommandTeams(msg);
  if (cmdResult) return cmdResult;

  // spec §1：发送方必须有 active session
  const senderActive = repo.findActive(msg.teamsUserKey, "teams");
  if (!senderActive) {
    return { type: "reply_bot", text: fmt.formatNoActiveWarning() };
  }
  // 接收方（飞书用户）open_id + 其飞书 chat
  const receiverOpenId = senderActive.peerReceiveId;
  const receiverPlatform: PeerPlatform = senderActive.peerPlatform; // 预期 "feishu"
  const feishuChatId = senderActive.feishuChatId || receiverOpenId;

  const formatted = fmt.formatFromTeams(msg.senderDisplay, msg.text);
  const result = sm.ensureReverseSession(
    receiverOpenId,
    receiverPlatform,
    { platform: "teams", receiveId: msg.teamsUserKey, receiveIdType: "aad_id", displayName: msg.senderDisplay, email: "" },
    formatted,
    msg.timestamp,
  );

  if (result.decision === "deliver") {
    return { type: "forward_to_feishu", sessionId: result.session.sessionId, content: formatted, peerId: receiverOpenId, peerIdType: "open_id", feishuChatId, srcMessageId: msg.messageId };
  }
  if (result.decision === "deliver_activated") {
    const tip = fmt.formatAutoActivatedTip(msg.senderDisplay, "teams");
    return { type: "forward_to_feishu", sessionId: result.session.sessionId, content: formatted, peerId: receiverOpenId, peerIdType: "open_id", feishuChatId, tip, srcMessageId: msg.messageId };
  }
  // notify：通知合并窗口
  if (!notificationMerger.shouldNotify(result.session.sessionId)) {
    return { type: "noop" };
  }
  notificationMerger.markNotified(result.session.sessionId);
  const unread = (repo.getDb().prepare("SELECT unread_count FROM sessions WHERE session_id=? AND owner_key=?").get(result.session.sessionId, receiverOpenId) as any)?.unread_count || 1;
  return { type: "notify_feishu_peer", sessionId: result.session.sessionId, receiverOpenId, feishuChatId, senderDisplay: msg.senderDisplay, senderTeamsKey: msg.teamsUserKey, unread, srcMessageId: msg.messageId };
}

/**
 * 飞书入站普通消息路由（同上 design §6）。
 * 命令由 feishu handler 自行处理（保留历史行为，避免侵入过大）。
 */
export async function routeFeishuInbound(msg: InboundFeishuMessage, ownerKey: string): Promise<RouteAction> {
  // spec §1：发送方必须有 active session
  const senderActive = repo.findActive(ownerKey, "feishu");
  if (!senderActive) {
    return { type: "reply_bot", text: fmt.formatNoActiveWarning() };
  }
  const receiverTeamsKey = senderActive.peerReceiveId; // Teams AAD ID
  const receiverPlatform: PeerPlatform = senderActive.peerPlatform; // 预期 "teams"

  const formatted = fmt.formatFromFeishu(msg.senderDisplay, msg.text);
  const result = sm.ensureReverseSession(
    receiverTeamsKey,
    receiverPlatform,
    { platform: "feishu", receiveId: ownerKey, receiveIdType: "open_id", displayName: msg.senderDisplay, email: "" },
    formatted,
    msg.timestamp,
  );

  if (result.decision === "deliver") {
    return { type: "forward_to_teams", sessionId: result.session.sessionId, content: formatted, teamsUserKey: receiverTeamsKey, srcMessageId: msg.messageId };
  }
  if (result.decision === "deliver_activated") {
    const tip = fmt.formatAutoActivatedTip(msg.senderDisplay, "feishu");
    return { type: "forward_to_teams", sessionId: result.session.sessionId, content: formatted, teamsUserKey: receiverTeamsKey, tip, srcMessageId: msg.messageId };
  }
  if (!notificationMerger.shouldNotify(result.session.sessionId)) {
    return { type: "noop" };
  }
  notificationMerger.markNotified(result.session.sessionId);
  const unread = (repo.getDb().prepare("SELECT unread_count FROM sessions WHERE session_id=? AND owner_key=?").get(result.session.sessionId, receiverTeamsKey) as any)?.unread_count || 1;
  return { type: "notify_teams_peer", sessionId: result.session.sessionId, teamsUserKey: receiverTeamsKey, senderDisplay: msg.senderDisplay, senderOpenId: ownerKey, unread, srcMessageId: msg.messageId };
}
