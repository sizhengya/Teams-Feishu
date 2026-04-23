import { InboundTeamsMessage, InboundFeishuMessage, RouteAction } from "../types";
/**
 * Teams 入站普通消息路由（design §6 "路由铁律"）：
 * 1. 先校验发送方 active（spec §1：无 active → 拒绝）
 * 2. 调 ensureReverseSession 决策
 * 3. 根据决策生成具体 RouteAction；message_map / 发送由 handler 执行
 */
export declare function routeTeamsInbound(msg: InboundTeamsMessage): Promise<RouteAction>;
/**
 * 飞书入站普通消息路由（同上 design §6）。
 * 命令由 feishu handler 自行处理（保留历史行为，避免侵入过大）。
 */
export declare function routeFeishuInbound(msg: InboundFeishuMessage, ownerKey: string): Promise<RouteAction>;
