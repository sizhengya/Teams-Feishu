export interface QueueItem {
    targetKey: string;
    execute: () => Promise<any>;
}
export declare class OutboundQueue {
    private items;
    private running;
    enqueue(i: QueueItem): void;
    get pending(): number;
    start(): void;
    stop(): void;
    private worker;
}
export declare const outboundQueue: OutboundQueue;
