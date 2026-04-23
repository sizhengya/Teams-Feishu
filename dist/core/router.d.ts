import { InboundTeamsMessage, InboundFeishuMessage, RouteAction } from "../types";
export declare function routeTeamsInbound(msg: InboundTeamsMessage): Promise<RouteAction>;
export declare function routeFeishuInbound(msg: InboundFeishuMessage, ownerKey: string): Promise<RouteAction>;
