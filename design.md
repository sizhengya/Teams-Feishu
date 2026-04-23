# Teams–飞书 消息桥接服务
架构与核心设计（Design）v3-final

---

## 1. 核心设计目标

- 防串话
- 防误发
- 状态可审计
- Session 清晰可解释

---

## 2. 核心抽象

### 2.1 Session
Session = Owner + Peer
Active 只对 Owner 生效

- A→B ≠ B→A
- Active 永远是 **Owner 视角**

---

## 3. 数据模型（关键表）

### sessions

| 字段 | 说明 |
|----|----|
| session_id | peerPlatform:idType:peerId |
| owner_key | 会话拥有者 |
| state | active / idle |
| unread_count | 未读数 |

---

### session_states


owner_key → active_session_id

---

### pending_messages

- 只存 **formatted_content**
- 用于回放
- 回放即删除

---

## 4. ensureReverseSession（核心算法）

```ts
function ensureReverseSession(receiverKey, senderAsPeer, formatted, ts) {
  session = findOrCreate(receiverKey, senderAsPeer)
  active = findActive(receiverKey)

  if (!active) {
    activate(session)
    return "deliver_activated"
  }

  if (active.id === session.id) {
    return "deliver"
  }

  incrementUnread(session)
  savePending(formatted, ts)
  return "notify"
}


⚠️ 必须在发送前调用


5. 状态机（简化）
            ┌──────────┐
            │   idle   │
            └────┬─────┘
                 │ activate
                 ▼
            ┌──────────┐
            │  active  │
            └──────────┘


6. 路由铁律（v3-final）

先 ensureReverseSession
再写 message_map
最后才发送消息
notify 永不投递正文


7. 并发与安全

Active 切换：SQLite 事务
去重键：(src_platform, src_message_id)
所有跨平台消息统一 Bot 身份


8. 架构结论

这是一个“状态优先、用户视角绝对化”的消息桥接模型

适合：

企业 PoC
合规环境
多平台共存场景