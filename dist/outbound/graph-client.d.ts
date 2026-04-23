import { SearchResult } from "../types";
/**
 * 通过邮件前缀搜索 Teams (Azure AD) 用户
 * 使用 Microsoft Graph: GET /users?$filter=startswith(mail,'prefix')
 * 需要应用权限：User.Read.All
 */
export declare function searchTeamsUsers(emailPrefix: string): Promise<SearchResult[]>;
