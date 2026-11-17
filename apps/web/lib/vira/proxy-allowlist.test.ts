import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetToken = vi.fn();

vi.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

import { proxy } from "../../proxy";

function req(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("proxy VIRA allow-list", () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("/api/vira/confirm passes without a session cookie", async () => {
    const res = await proxy(req("/api/vira/confirm"));
    expect(res.status).toBe(200);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it("/api/vira/mcp still passes without a session cookie", async () => {
    const res = await proxy(req("/api/vira/mcp"));
    expect(res.status).toBe(200);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it("/api/vira/confirmx does not pass without a session", async () => {
    const res = await proxy(req("/api/vira/confirmx"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHENTICATED" });
    expect(mockGetToken).toHaveBeenCalled();
  });

  it("/api/vira/token does not pass without a session", async () => {
    const res = await proxy(req("/api/vira/token"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHENTICATED" });
    expect(mockGetToken).toHaveBeenCalled();
  });
});
