# Teams–飞书 消息桥接服务（Teams–Feishu Bridge）

企业级 Teams ↔ 飞书 **一对一消息桥接 PoC 方案**  
支持任意用户双向发起会话、对称 Session、未读暂存与安全投递。

---

## ✨ 核心能力

- ✅ Teams / 飞书 **任意用户 ↔ 任意用户**
- ✅ **对称 Session 自动创建**
- ✅ 单 Active Session，彻底避免串话
- ✅ 非 Active 消息仅通知，正文不误投
- ✅ 未读消息暂存 + 切换回放
- ✅ 全量消息审计（deliver / notify 全覆盖）

---

## 🧠 设计原则（一句话版）

> **先判断，再发消息；只发 Active，会话不打断**

---

## 🏗️ 架构概览
Teams 用户 ⇄ Teams Bot ⇄ Bridge Service ⇄ 飞书 Bot ⇄ 飞书 用户
│
SQLite

- Bot **无状态**
- Bridge **统一状态与路由**
- Session **完全按用户隔离**

---

## 🧩 关键特性

| 能力 | 说明 |
|----|----|
| 对称 Session | A→B 存在 ⇒ B→A 必定存在 |
| 自动激活 | 接收方无 active 时自动激活并提示 |
| 未读保护 | Active≠发送方 ⇒ 只通知不送正文 |
| 回放机制 | 切换会话自动回放未读 |
| 审计合规 | 所有路径写 message_map |

---

## 📂 文档结构

| 文件 | 适用对象 | 内容 |
|----|----|----|
| README.md | 管理 / 初读 | 项目概览 |
| spec.md | 开发 / 测试 | 行为规范 |
| design.md | 架构 / 高级开发 | 状态机 / 数据模型 |

---

## 🚦 当前状态

- ✅ PoC Ready
- ✅ v3-final：6 个关键 Bug 已修复
- ✅ 可直接部署验证

👉 **详细规则与实现请查看 `spec.md` 与 `design.md`**