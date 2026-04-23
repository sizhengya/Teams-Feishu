"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outboundQueue = exports.OutboundQueue = void 0;
const rate_limit_1 = require("./rate-limit");
const retry_1 = require("./retry");
class OutboundQueue {
    constructor() {
        this.items = [];
        this.running = false;
    }
    enqueue(i) { this.items.push(i); }
    get pending() { return this.items.length; }
    start() { if (this.running)
        return; this.running = true; this.worker(); }
    stop() { this.running = false; }
    async worker() { while (this.running) {
        if (!this.items.length) {
            await new Promise(r => setTimeout(r, 200));
            continue;
        }
        const it = this.items.shift();
        try {
            await rate_limit_1.feishuLimiter.waitForToken(it.targetKey);
            await (0, retry_1.retryWithBackoff)(it.execute);
        }
        catch (e) {
            console.error("[queue]", e);
        }
    } }
}
exports.OutboundQueue = OutboundQueue;
exports.outboundQueue = new OutboundQueue();
//# sourceMappingURL=queue.js.map