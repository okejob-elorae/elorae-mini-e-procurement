import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch } from "./internal-api";

beforeEach(() => {
  vi.stubEnv("INTERNAL_API_SECRET", "test-secret");
  vi.stubEnv("INTERNAL_API_URL", "http://internal.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("apiFetch timeout", () => {
  it("passes an AbortSignal to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("POST", "/jubelio/outbox/enqueue/1", { userId: "u1" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves a synthetic 504 when fetch rejects with a TimeoutError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")),
    );

    const res = await apiFetch("POST", "/jubelio/outbox/enqueue/1", { userId: "u1", timeoutMs: 50 });

    expect(res).toEqual({
      ok: false,
      status: 504,
      error: "apiFetch: POST /jubelio/outbox/enqueue/1 timed out after 50ms",
    });
  });

  it("aborts a fetch that never answers once timeoutMs elapses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
      ),
    );

    const res = await apiFetch("POST", "/jubelio/outbox/enqueue/1", { userId: "u1", timeoutMs: 20 });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(504);
  });

  it("still rejects on a non-timeout failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(apiFetch("POST", "/jubelio/outbox/enqueue/1", { userId: "u1" })).rejects.toThrow(
      "fetch failed",
    );
  });

  it("still resolves ok with data on a 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ batchId: "b1" }), { status: 200 })),
    );

    const res = await apiFetch<{ batchId: string }>("POST", "/jubelio/salesorders/resync", { userId: "u1" });

    expect(res).toEqual({ ok: true, status: 200, data: { batchId: "b1" } });
  });
});
