"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationMerger = void 0;
const W = parseInt(process.env.NOTIFICATION_MERGE_WINDOW_MS || "10000", 10);
class NotificationMerger {
    constructor() {
        this.m = new Map();
    }
    shouldNotify(sid) { const t = this.m.get(sid); return !t || Date.now() - t >= W; }
    markNotified(sid) { this.m.set(sid, Date.now()); }
}
exports.notificationMerger = new NotificationMerger();
//# sourceMappingURL=notifier.js.map