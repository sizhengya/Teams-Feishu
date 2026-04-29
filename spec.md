# Teams–飞书 消息桥接服务
技术规格说明（Spec）v3-final

---

## 1. 会话与路由基本规则

- 每个用户 **只能有一个 Active Session**
- 普通消息只能发送给 Active Session
- 无 Active 时发送普通消息 → 拒绝并提示

---

## 2. Session 行为规则

### 2.1 对称 Session

- A /chat B ⇒ 创建 A→B
- B 首次回复时 ⇒ **自动创建 B→A**
- 两条 Session **相互独立**

---

## 3. 消息投递决策（DeliveryDecision）

| Decision | 接收方状态 | 行为 |
|----|----|----|
| deliver | Active=发送方 | 直接投递正文 |
| deliver_activated | 无 Active | 仅通知，正文存 pending |
| notify | Active=他人 | 仅通知，正文存 pending |

> ⚠️ **notify 场景下绝不投递正文**

---

## 4. 普通消息处理流程（抽象）

1. 校验发送方是否有 Active
2. 格式化正文（含平台标识）
3. 调用 `ensureReverseSession`
4. **写 message_map（无论何种 decision）**
5. 根据 decision 决定投递内容

---

## 5. Bot 指令协议（两端一致）

| 指令 | 说明 |
|----|----|
| /chat \<prefix\> | 搜索并切换会话 |
| /select N | 选择候选结果 |
| /list | 列出所有 session |
| /who | 当前 active |
| /clear | 清空全部 |
| /help | 帮助 |

---

## 6. 未读消息规则

### 6.1 暂存

- 仅在 notify 场景
- 存 **formatted_content**
- 记录 original_timestamp

### 6.2 回放

- /chat 或 /select 时触发
- 最多回放 50 条
- 回放后：
  - pending 清空
  - unread_count = 0

---

## 7. 通知合并

- 同一 Session
- 10 秒内只发 1 次通知

---

## 8. 错误处理（用户可感知）

| 场景 | 提示 |
|----|----|
| 未 /chat 发消息 | ⚠️ 请先选择会话 |
| 搜索无结果 | ❌ 未找到用户 |
| Teams proactive 失败 | ❌ 对方尚未启用 Bot |

---

## 9. API

- `POST /api/v1/inbound/teams`
- `POST /api/v1/inbound/feishu`
- `GET /health`

---

## 10. 验收结论

- 所有 TC-01 ～ TC-21 必须通过
- notify 场景严禁正文泄漏