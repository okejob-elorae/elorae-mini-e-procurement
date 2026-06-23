import Redis, { type RedisOptions } from "ioredis";

declare global {
  // eslint-disable-next-line no-var
  var __elorae_redis: Redis | undefined;
}

function build(): Redis {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  const opts: RedisOptions = {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  };
  return new Redis(url, opts);
}

export function getRedis(): Redis {
  if (!global.__elorae_redis) {
    global.__elorae_redis = build();
  }
  return global.__elorae_redis;
}
