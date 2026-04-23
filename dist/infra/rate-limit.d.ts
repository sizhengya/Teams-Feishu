export declare class TokenBucketLimiter {
    private b;
    private qps;
    constructor(q?: number);
    consume(k: string): boolean;
    waitForToken(k: string): Promise<void>;
}
export declare const feishuLimiter: TokenBucketLimiter;
