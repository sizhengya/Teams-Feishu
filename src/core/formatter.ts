import { Session, SearchResult, PendingMessage, PeerPlatform } from "../types";
export function formatFromTeams(sender:string,text:string):string { return `[${sender} | Teams]：${text}`; }
export function formatFromFeishu(sender:string,text:string):string { return `[${sender} | 飞书]：${text}`; }

// /chat 用法提示：
//   飞书侧（搜索 Teams 用户）→ 使用邮箱前缀，例如 /chat zhengya.si
//   Teams 侧（搜索飞书用户）→ 使用完整邮箱，例如 /chat zhengya.si@szylab.top
export function chatUsage(viewer:PeerPlatform):{ syntax:string; example:string } {
  return viewer === "teams"
    ? { syntax: "/chat <邮箱地址>", example: "/chat zhengya.si@szylab.top" }
    : { syntax: "/chat <邮箱前缀>", example: "/chat zhengya.si" };
}
export function formatNonActiveNotification(display:string,unread:number,email?:string,emailPrefix?:string):string { const emailInfo=email?`（${email}）`:""; const chatCmd=emailPrefix||display; return `🔔 新消息（非当前会话）\n\n来自：${display}${emailInfo}\n\n📌 当前不在该会话\n👉 输入 /chat ${chatCmd} 切换查看（未读 ${unread}）`; }
export function formatSwitchConfirm(display:string,platform:string):string { return `✅ 已切换到与【${display}（${platform==="feishu"?"飞书":"Teams"}）】的对话`; }
export function formatSearchResults(results:SearchResult[]):string {
  if(results.length===0) return "❌ 未找到匹配用户\n\n请检查输入后重试";
  const lines = results.map((r,i)=>`${i+1}️⃣  ${r.email} — ${r.displayName}${r.department?`（${r.department}）`:""}`);
  return `🔍 搜索结果：\n\n${lines.join("\n")}\n\n👉 输入 /select <序号> 选择对象`;
}
export function formatAutoConnect(display:string,email:string,platform:string):string { return `✅ 找到唯一匹配：${display}（${email}）\n已自动切换到与【${display}（${platform==="feishu"?"飞书":"Teams"}）】的对话`; }
export function formatSessionList(sessions:Session[], activeSessionId?:string, viewer:PeerPlatform="feishu"):string {
  if(sessions.length===0) { const u=chatUsage(viewer); return `📭 暂无会话\n\n输入 ${u.syntax} 发起会话\n示例：${u.example}`; }
  const lines=sessions.map(s=>{
    // spec: 🟢 仅标记 session_states.active_session_id 所指的唯一 session
    const isActive = activeSessionId ? s.sessionId===activeSessionId : s.state==="active";
    const m=isActive?"🟢":"⚪";
    const p=s.peerPlatform==="feishu"?"飞书":"Teams";
    const u=s.unreadCount>0?` (未读 ${s.unreadCount})`:"";
    const email=s.peerPlatform==="teams"&&s.peerEmail?` <${s.peerEmail}>`:"";
    return `${m} ${s.displayName}（${p}）${email}${u}`;
  });
  return `📋 所有会话：\n\n${lines.join("\n")}`;
}
export function formatWhoReply(s:Session|undefined, viewer:PeerPlatform="feishu"):string { if(!s) { const u=chatUsage(viewer); return `📌 当前无活跃会话\n\n输入 ${u.syntax} 开始聊天\n示例：${u.example}`; } const p=s.peerPlatform==="feishu"?"飞书":"Teams"; return `📌 当前正在与：【${s.displayName}（${p}）】对话${s.peerEmail?`\n📧 ${s.peerEmail}`:""}\n\n你的回复将发送给 ${s.displayName}`; }
export function formatNoActiveWarning(viewer:PeerPlatform="feishu"):string { const u=chatUsage(viewer); return `⚠️ 请先选择会话对象\n\n输入 ${u.syntax} 搜索并发起会话\n示例：${u.example}\n输入 /help 查看帮助`; }
export function formatHelpText(viewer:PeerPlatform="feishu"):string {
  const u = chatUsage(viewer);
  const domain = process.env.FEISHU_EMAIL_DOMAIN || "";
  const chatHint = viewer === "teams" && domain
    ? `  — 搜索飞书用户并发起会话（飞书域名：@${domain}）`
    : "  — 搜索对方平台用户并发起会话";
  return ["📖 指令帮助","",`${u.syntax}${chatHint}`,`                  示例：${u.example}`,"/select <序号>    — 从搜索结果中选择","/connect feishu:<open_id> — 直接连接飞书用户（无需搜索）","/connect teams:<邮箱>  — 直接连接 Teams 用户（无需搜索）","/list             — 列出所有会话","/who              — 查看当前活跃会话","/clear            — 清空所有会话","/help             — 显示本帮助","","💡 普通消息将自动发送给当前活跃会话的对象"].join("\n");
}
export function formatClearConfirm():string { return "🗑️ 所有会话状态已清空"; }
export function formatSelectOutOfRange():string { return "⚠️ 序号超出范围，请重新选择"; }
export function formatNoPending(viewer:PeerPlatform="feishu"):string { const u=chatUsage(viewer); return `⚠️ 没有待选择的搜索结果\n请先使用 ${u.syntax} 搜索\n示例：${u.example}`; }
export function formatAutoActivatedTip(displayName:string, platform:string):string { const p=platform==="feishu"?"飞书":"Teams"; return `💬 ${displayName}（${p}）已与您建立会话，开始传递消息`; }
export function formatUnreadReplay(messages:PendingMessage[]):string {
  if(messages.length===0) return "";
  const MAX=50;
  const truncated=messages.length>MAX?messages.slice(-MAX):messages;
  const header="📨 以下是未读消息：\n";
  const body=truncated.map(m=>{
    // ts 可能是 ISO 字符串、毫秒数字、或毫秒字符串
    let d: Date;
    if (!m.ts) d = new Date();
    else if (typeof m.ts === "number") d = new Date(m.ts);
    else if (/^\d+$/.test(m.ts)) d = new Date(parseInt(m.ts, 10));
    else d = new Date(m.ts);
    const localTs = isNaN(d.getTime())
      ? "—"
      : d.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const platLabel = m.platform==="feishu"?"飞书":"Teams";
    return `[${m.from} | ${platLabel}]（${localTs}）：${m.text}`;
  }).join("\n");
  const suffix=messages.length>MAX?`\n\n⚠️ 更早的消息（共${messages.length}条）已省略`:"";
  return header+body+suffix;
}
