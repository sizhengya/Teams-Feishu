"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.feishuLimiter = exports.TokenBucketLimiter = void 0;
class TokenBucketLimiter {
    constructor(q) {
        this.b = new Map();
        this.qps = q || parseInt(process.env.FEISHU_QPS_PER_TARGET || "5", 10);
    }
    consume(k) { const n = Date.now(); let b = this.b.get(k); if (!b) {
        b = { tokens: this.qps, last: n };
        this.b.set(k, b);
    } b.tokens = Math.min(this.qps, b.tokens + (n - b.last) / 1000 * this.qps); b.last = n; if (b.tokens >= 1) {
        b.tokens--;
        return true;
    } return false; }
    async waitForToken(k) { while (!this.consume(k))
        await new Promise(r => setTimeout(r, 200)); }
}
exports.TokenBucketLimiter = TokenBucketLimiter;
exports.feishuLimiter = new TokenBucketLimiter();
//# sourceMappingURL=rate-limit.js.map