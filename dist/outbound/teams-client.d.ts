export declare function ensureTeamsToken(): Promise<string>;
/**
 * 向 Teams 用户发送主动消息（直接调 Bot Framework REST API，不需要对方先联系 Bot）
 * conversationReference 在用户安装 Bot 时通过 conversationUpdate 事件获得
 */
export declare function sendTeamsProactive(serviceUrl: string, conversationId: string, text: string): Promise<void>;
/**
 * 根据 teamsUserKey 查 userLink 发送（兼容旧接口）
 */
export declare function sendTeamsProactiveByKey(teamsUserKey: string, text: string): Promise<void>;
