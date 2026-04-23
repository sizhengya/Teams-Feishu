declare class NotificationMerger {
    private m;
    shouldNotify(sid: string): boolean;
    markNotified(sid: string): void;
}
export declare const notificationMerger: NotificationMerger;
export {};
