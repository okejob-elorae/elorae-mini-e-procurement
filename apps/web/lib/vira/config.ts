export const VIRA_TOKEN_ISSUER = "elorae";
export const VIRA_TOKEN_AUDIENCE = "vira-mcp";
export const VIRA_TOKEN_TTL_SECONDS = 600;
export const VIRA_CLOCK_SKEW_SECONDS = 30;
export const VIRA_LIST_DEFAULT_LIMIT = 20;
export const VIRA_LIST_MAX_LIMIT = 50;
export const VIRA_RATE_LIMIT_TOKEN_PER_MIN = 10;
export const VIRA_RATE_LIMIT_MCP_PER_MIN = 60;
export const VIRA_SERVICE_KEY_HEADER = "x-vira-service-key";
export const VIRA_USE_PERMISSION = "vira:use";
export const VIRA_MIN_SECRET_LENGTH = 32;

export type ViraEnv = { tokenSecret?: string; serviceKey?: string; appUrl?: string };

function readTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readSecret(value: string | undefined): string | undefined {
  const trimmed = readTrimmed(value);
  if (trimmed === undefined || trimmed.length < VIRA_MIN_SECRET_LENGTH) return undefined;
  return trimmed;
}

/** Reads env on every call (no caching). Trims values. A secret shorter than
 *  VIRA_MIN_SECRET_LENGTH is treated as unset. appUrl has its trailing "/" removed. */
export function getViraEnv(env: NodeJS.ProcessEnv = process.env): ViraEnv {
  const appUrl = readTrimmed(env.VIRA_APP_URL)?.replace(/\/+$/, "");
  return {
    tokenSecret: readSecret(env.VIRA_TOKEN_SECRET),
    serviceKey: readSecret(env.VIRA_SERVICE_KEY),
    appUrl: appUrl ? appUrl : undefined,
  };
}
