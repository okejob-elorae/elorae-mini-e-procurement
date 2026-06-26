"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SalesReturnLockBusyError = void 0;
exports.withSalesReturnLock = withSalesReturnLock;
const node_crypto_1 = require("node:crypto");
const client_1 = require("./client");
const DEFAULT_TTL_MS = 10_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000;
const ACQUIRE_RETRY_DELAY_MS = 50;
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;
class SalesReturnLockBusyError extends Error {
    constructor(salesReturnId) {
        super(`SalesReturn ${salesReturnId} is being modified by another admin`);
        this.name = "SalesReturnLockBusyError";
    }
}
exports.SalesReturnLockBusyError = SalesReturnLockBusyError;
async function withSalesReturnLock(salesReturnId, fn, opts = {}) {
    const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    const acquireTimeoutMs = opts.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
    const redis = (0, client_1.getRedis)();
    const key = `salesreturn-lock:${salesReturnId}`;
    const token = (0, node_crypto_1.randomBytes)(16).toString("hex");
    const acquireDeadline = Date.now() + acquireTimeoutMs;
    let acquired = false;
    while (Date.now() < acquireDeadline) {
        const result = await redis.set(key, token, "PX", ttlMs, "NX");
        if (result === "OK") {
            acquired = true;
            break;
        }
        await new Promise((r) => setTimeout(r, ACQUIRE_RETRY_DELAY_MS));
    }
    if (!acquired)
        throw new SalesReturnLockBusyError(salesReturnId);
    try {
        return await fn();
    }
    finally {
        await redis.eval(RELEASE_SCRIPT, 1, key, token);
    }
}
//# sourceMappingURL=lock.js.map