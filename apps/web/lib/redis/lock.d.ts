export declare class SalesReturnLockBusyError extends Error {
    constructor(salesReturnId: string);
}
export declare function withSalesReturnLock<T>(salesReturnId: string, fn: () => Promise<T>, opts?: {
    ttlMs?: number;
    acquireTimeoutMs?: number;
}): Promise<T>;
