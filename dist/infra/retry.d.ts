export declare function retryWithBackoff<T>(fn: () => Promise<T>, max?: number): Promise<T>;
