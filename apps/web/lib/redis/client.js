"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedis = getRedis;
const ioredis_1 = __importDefault(require("ioredis"));
function build() {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    const opts = {
        lazyConnect: false,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
    };
    return new ioredis_1.default(url, opts);
}
function getRedis() {
    if (!global.__elorae_redis) {
        global.__elorae_redis = build();
    }
    return global.__elorae_redis;
}
//# sourceMappingURL=client.js.map