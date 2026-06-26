import Redis from "ioredis";
declare global {
    var __elorae_redis: Redis | undefined;
}
export declare function getRedis(): Redis;
