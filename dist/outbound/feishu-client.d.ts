import { SearchResult } from "../types";
/** 发送飞书消息（优先用 open_id，失败后尝试 chat_id fallback） */
export declare function sendFeishuMessage(idType: string, id: string, content: string, chatIdFallback?: string): Promise<string>;
/**
 * 根据 open_id 获取飞书用户信息（名称、邮箱等）
 */
export declare function getFeishuUserByOpenId(openId: string): Promise<{
    name: string;
    email: string;
} | null>;
/**
 * 通过邮件前缀搜索飞书用户
 * 使用飞书通讯录 API：POST /contact/v3/users/batch_get_id（按 email）
 * 或使用搜索 API：GET /search/v1/user
 *
 * 这里使用 GET /contact/v3/users 按 email 模糊匹配的方式
 * 实际部署时需要应用有 contact:user.base:readonly 权限
 */
export declare function searchFeishuUsers(emailPrefix: string): Promise<SearchResult[]>;
