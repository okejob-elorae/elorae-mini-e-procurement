import { describe, it, expect } from "vitest";
import { getViraEnv, VIRA_MIN_SECRET_LENGTH } from "./config";

function envOf(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...vars } as NodeJS.ProcessEnv;
}

describe("getViraEnv", () => {
  it("unset vars → all undefined", () => {
    expect(getViraEnv(envOf())).toEqual({
      tokenSecret: undefined,
      serviceKey: undefined,
      appUrl: undefined,
    });
  });

  it("a secret shorter than the minimum is treated as unset", () => {
    const short = "a".repeat(VIRA_MIN_SECRET_LENGTH - 1);
    const env = getViraEnv(envOf({ VIRA_TOKEN_SECRET: short, VIRA_SERVICE_KEY: short }));
    expect(short).toHaveLength(31);
    expect(env.tokenSecret).toBeUndefined();
    expect(env.serviceKey).toBeUndefined();
  });

  it("a secret of exactly the minimum length is returned", () => {
    const exact = "a".repeat(VIRA_MIN_SECRET_LENGTH);
    const env = getViraEnv(envOf({ VIRA_TOKEN_SECRET: exact, VIRA_SERVICE_KEY: exact }));
    expect(exact).toHaveLength(32);
    expect(env.tokenSecret).toBe(exact);
    expect(env.serviceKey).toBe(exact);
  });

  it("values are trimmed", () => {
    const secret = "s".repeat(32);
    const key = "k".repeat(32);
    const env = getViraEnv(
      envOf({
        VIRA_TOKEN_SECRET: `  ${secret}\n`,
        VIRA_SERVICE_KEY: `\t${key} `,
        VIRA_APP_URL: "  https://x.test  ",
      }),
    );
    expect(env).toEqual({ tokenSecret: secret, serviceKey: key, appUrl: "https://x.test" });
  });

  it("whitespace padding does not count toward the minimum length", () => {
    expect(getViraEnv(envOf({ VIRA_TOKEN_SECRET: ` ${"a".repeat(31)} ` })).tokenSecret).toBeUndefined();
  });

  it("VIRA_APP_URL has its trailing slash removed", () => {
    expect(getViraEnv(envOf({ VIRA_APP_URL: "https://x.test/" })).appUrl).toBe("https://x.test");
  });

  it("reads env on every call (no caching)", () => {
    const env = envOf();
    expect(getViraEnv(env).appUrl).toBeUndefined();
    env.VIRA_APP_URL = "https://x.test";
    expect(getViraEnv(env).appUrl).toBe("https://x.test");
  });
});
