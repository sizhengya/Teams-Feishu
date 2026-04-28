import { Router, Request, Response } from "express";
import { routeTeamsInbound } from "../../core/router";
import { upsertUserLink } from "../../store/user-link.repo";
import { saveMessageMap, isDuplicate } from "../../store/message-map.repo";
import { sendFeishuMessage } from "../../outbound/feishu-client";
import { sendTeamsProactive, sendTeamsProactiveByKey } from "../../outbound/teams-client";
import * as fmt from "../../core/formatter";
import { InboundTeamsMessage } from "../../types";
import { v4 as uuidv4 } from "uuid";

const router = Router();

/** 欢迎消息（用户安装 Bot 时自动发送） */
const WELCOME_MSG = (() => {
  const domain = process.env.FEISHU_EMAIL_DOMAIN || "";
  const chatLine = domain
    ? `  /chat <邮箱地址>  — 搜索并连接飞书用户（飞书域名：@${domain}）`
    : "  /chat <邮箱地址>  — 搜索并连接飞书用户";
  return [
    "👋 欢迎使用飞书-Teams 消息桥接！",
    "",
    "📖 使用说明：",
    "",
    "在 Teams 中：",
    chatLine,
    "  示例：/chat zhengya.si@szylab.top",
    "  /select <序号>         — 从搜索结果中选择",
    "  /list                 — 查看所有会话",
    "  /who                  — 查看当前活跃会话",
    "  /help                 — 显示帮助",
    "",
    "连接后直接发消息即可跨平台转发 🔗",
  ].join("\n");
})();

/**
 * 将真实 Teams Bot Framework Webhook 格式转换为内部格式
 */
function parseRealTeamsFormat(body: any): InboundTeamsMessage | null {
  // 真实 Teams webhook 格式
  if (body.type && ["message", "conversationUpdate"].includes(body.type)) {
    const from = body.from || {};
    const conversation = body.conversation || {};
    return {
      teamsUserKey: from.aadObjectId || from.id || "",
      conversationId: conversation.id || "",
      serviceUrl: body.serviceUrl || "",
      messageId: body.id || "",
      senderDisplay: from.name || from.id || "Unknown",
      text: body.text || "",
      timestamp: body.timestamp || new Date().toISOString(),
    };
  }
  // 测试/简化格式（向后兼容）
  if (body.teamsUserKey !== undefined) {
    return {
      teamsUserKey: body.teamsUserKey,
      conversationId: body.conversationId || "",
      serviceUrl: body.serviceUrl || "",
      messageId: body.messageId || "",
      senderDisplay: body.senderDisplay || "Unknown",
      text: body.text || "",
      timestamp: body.timestamp || new Date().toISOString(),
    };
  }
  return null;
}

/**
 * 处理 conversationUpdate 事件（用户安装/卸载 Bot）
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const b = req.body; console.log("[teams] RAW:", JSON.stringify(b).substring(0,300));

    // --- conversationUpdate: 用户安装了 Bot ---
    if (b.type === "conversationUpdate" && b.membersAdded) {
      const botId = `28:${process.env.TEAMS_APP_ID || ""}`;
      for (const member of b.membersAdded || []) {
        if (member.id === botId) {
          const teamsUserKey = b.from?.aadObjectId || b.from?.id || "";
          const conversationId = b.conversation?.id || "";
          const serviceUrl = b.serviceUrl || "";

          if (teamsUserKey && conversationId && serviceUrl) {
            console.log(`[teams] Bot installed by user: ${teamsUserKey}`);
            upsertUserLink({ teamsUserKey, conversationId, serviceUrl, createdAt: new Date().toISOString() });
            try {
              await sendTeamsProactive(serviceUrl, conversationId, WELCOME_MSG);
              console.log(`[teams] Welcome message sent to ${teamsUserKey}`);
            } catch (e) {
              console.error(`[teams] Failed to send welcome message: ${e}`);
            }
          }
          return res.json({ status: "installed" });
        }
      }
    }

    // --- 普通消息 ---
    const msg = parseRealTeamsFormat(b);
    if (!msg) {
      console.error("[teams] Unknown webhook format:", JSON.stringify(b).substring(0, 200));
      return res.status(400).json({ error: "unknown_format" });
    }

    console.log(`[teams] incoming msg: from=${msg.teamsUserKey} conv=${msg.conversationId} text=${msg.text.substring(0, 50)}`);

    if (msg.teamsUserKey) {
      upsertUserLink({
        teamsUserKey: msg.teamsUserKey,
        conversationId: msg.conversationId,
        serviceUrl: msg.serviceUrl,
        createdAt: "",
      });
    }

    if (isDuplicate("teams", msg.messageId)) {
      return res.json({ status: "duplicate" });
    }

    const action = await routeTeamsInbound(msg);
    switch (action.type) {
      case "reply_bot":
        try {
          await sendTeamsProactive(msg.serviceUrl, msg.conversationId, action.text);
        } catch (e) {
          console.error("[teams] reply failed:", e);
        }
        return res.json({ status: "ok" });
      case "forward_to_feishu": {
        const uuid = uuidv4();
        let dstId: string = "";
        try {
          // deliver_activated：先发提示再发正文（design §4 + spec §4）
          if (action.tip) {
            await sendFeishuMessage(action.peerIdType, action.peerId, action.tip, action.feishuChatId);
          }
          dstId = await sendFeishuMessage(action.peerIdType, action.peerId, action.content, action.feishuChatId);
        } catch (e: any) {
          console.error(`[teams->feishu] send failed: HTTP=${e?.response?.status} code=${e?.response?.data?.code} msg=${e?.response?.data?.msg} violations=${JSON.stringify(e?.response?.data?.error?.field_violations)} peerIdType=${action.peerIdType} peerId=${action.peerId} chatId=${action.feishuChatId} contentLen=${action.content?.length}`);
          try {
            await sendTeamsProactive(msg.serviceUrl, msg.conversationId, "⚠️ 消息发送失败，请稍后重试");
          } catch { /* ignore */ }
          return res.status(500).json({ error: "forward_failed" });
        }
        // spec §4 第 4 步：无论何种 decision 都写 message_map（保留 srcMessageId 做去重）
        saveMessageMap({
          srcPlatform: "teams",
          srcMessageId: action.srcMessageId,
          dstPlatform: "feishu",
          dstMessageId: dstId,
          sessionId: action.sessionId,
          uuid,
          createdAt: "",
        });
        return res.json({ status: "forwarded" });
      }
      case "notify_feishu_peer": {
        // notify：不投递正文；发给接收方（飞书用户）通知文案
        const { getFeishuUserByOpenId } = await import("../../outbound/feishu-client");
        // 发送方邮箱前缀（用于 /chat 提示）
        let senderEmailPrefix = action.senderDisplay;
        try {
          // Teams 发送方通过 Graph 查也可，这里简化用 displayName
          // 若需要精确 email 前缀，可调用 graph-client.searchTeamsUsers
        } catch { /* ignore */ }
        const notification = fmt.formatNonActiveNotification(action.senderDisplay, action.unread, undefined, senderEmailPrefix);
        try {
          await sendFeishuMessage("open_id", action.receiverOpenId, notification, action.feishuChatId || action.receiverOpenId);
        } catch (e: any) {
          console.error("[teams->feishu] notify send failed:", e?.message);
        }
        // spec §4：notify 也写 message_map 审计
        saveMessageMap({
          srcPlatform: "teams",
          srcMessageId: action.srcMessageId,
          dstPlatform: "feishu",
          dstMessageId: "",
          sessionId: action.sessionId,
          uuid: uuidv4(),
          createdAt: "",
        });
        return res.json({ status: "ok" });
      }
      case "notify_teams_peer": {
        // 飞书→Teams 的 notify：由 Teams handler 里的这个 action 处理（router 不知道 feishu 入站）
        // 该分支理论上在 Teams 入站路径不会走到，保留以防路由复用。
        const { formatNonActiveNotification } = await import("../../core/formatter");
        const { getFeishuUserByOpenId } = await import("../../outbound/feishu-client");
        // Teams 侧 /chat 需完整邮箱，使用发送方的飞书邮箱全拼
        let chatHint = action.senderDisplay;
        try {
          const u = await getFeishuUserByOpenId(action.senderOpenId).catch(() => null) as { email?: string } | null;
          if (u?.email) chatHint = u.email;
        } catch { /* ignore */ }
        const notification = formatNonActiveNotification(action.senderDisplay, action.unread, undefined, chatHint);
        try {
          await sendTeamsProactiveByKey(action.teamsUserKey, notification);
        } catch (e: any) {
          console.error("[teams handler] notify_teams_peer send failed:", e?.message);
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
    console.error("[inbound/teams]", e);
    res.status(500).json({ error: "internal" });
  }
});

export default router;