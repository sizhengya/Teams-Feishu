"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryWithBackoff = retryWithBackoff;
const MAX = parseInt(process.env.MAX_RETRIES || "3", 10);
async function retryWithBackoff(fn, max = MAX) { let last; for (let i = 0; i <= max; i++) {
    try {
        return await fn();
    }
    catch (e) {
        last = e;
        if (i >= max)
            break;
        let d;
        if (e.response?.status === 429) {
            const ra = e.response.headers["retry-after"];
            d = ra ? parseInt(ra, 10) * 1000 : 1000;
        }
        else
            d = Math.pow(2, i) * 500 + Math.random() * 200;
        await new Promise(r => setTimeout(r, d));
    }
} throw last; }
//# sourceMappingURL=retry.js.map