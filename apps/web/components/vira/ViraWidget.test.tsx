import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * VIRA chat embed: nothing until enabled + both NEXT_PUBLIC URLs are set; the
 * host bridge mints a same-origin token and never persists it; the script tag
 * is injected at most once and torn down with ViraHost on unmount.
 */

type FakeScript = {
  id: string;
  src: string;
  async: boolean;
  tagName: string;
  remove: () => void;
};

const dom = vi.hoisted(() => {
  const scripts: FakeScript[] = [];
  const document = {
    body: {
      appendChild(el: FakeScript) {
        scripts.push(el);
        return el;
      },
    },
    getElementById(id: string) {
      return scripts.find((s) => s.id === id) ?? null;
    },
    createElement(tag: string) {
      const el: FakeScript = {
        id: "",
        src: "",
        async: false,
        tagName: tag.toUpperCase(),
        remove() {
          const i = scripts.indexOf(el);
          if (i >= 0) scripts.splice(i, 1);
        },
      };
      return el;
    },
  };
  const windowObj: {
    ViraHost?: unknown;
    ViraWidget?: { unmount?: () => void };
    dispatchEvent: ReturnType<typeof vi.fn>;
  } = {
    dispatchEvent: vi.fn(),
  };
  return { scripts, document, windowObj };
});

vi.stubGlobal("document", dom.document);
vi.stubGlobal("window", dom.windowObj);
vi.stubGlobal(
  "Event",
  class Event {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  },
);

const {
  VIRA_SCRIPT_ID,
  ViraWidget,
  appendViraScriptOnce,
  fetchViraToken,
  installViraHost,
  teardownViraWidget,
} = await import("./ViraWidget");

beforeEach(() => {
  dom.scripts.splice(0, dom.scripts.length);
  delete dom.windowObj.ViraHost;
  delete dom.windowObj.ViraWidget;
  dom.windowObj.dispatchEvent.mockClear();
  vi.unstubAllEnvs();
  process.env.NEXT_PUBLIC_VIRA_WIDGET_URL = "";
  process.env.NEXT_PUBLIC_VIRA_RUNTIME_URL = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("ViraWidget — render gate", () => {
  it("renders nothing when enabled is false", () => {
    process.env.NEXT_PUBLIC_VIRA_WIDGET_URL = "http://widget.example/vira.js";
    process.env.NEXT_PUBLIC_VIRA_RUNTIME_URL = "http://runtime.example";
    expect(renderToStaticMarkup(createElement(ViraWidget, { enabled: false }))).toBe("");
    expect(dom.scripts).toHaveLength(0);
  });

  it("renders nothing and adds no script when either env URL is empty", () => {
    process.env.NEXT_PUBLIC_VIRA_WIDGET_URL = "http://widget.example/vira.js";
    process.env.NEXT_PUBLIC_VIRA_RUNTIME_URL = "";
    expect(renderToStaticMarkup(createElement(ViraWidget, { enabled: true }))).toBe("");
    expect(dom.scripts).toHaveLength(0);

    process.env.NEXT_PUBLIC_VIRA_WIDGET_URL = "";
    process.env.NEXT_PUBLIC_VIRA_RUNTIME_URL = "http://runtime.example";
    expect(renderToStaticMarkup(createElement(ViraWidget, { enabled: true }))).toBe("");
    expect(dom.scripts).toHaveLength(0);
  });
});

describe("fetchViraToken", () => {
  it("POSTs /api/vira/token with same-origin credentials", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: "t1", expiresAt: "2099-01-01T00:00:00.000Z" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchViraToken()).resolves.toEqual({
      token: "t1",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/vira/token", {
      method: "POST",
      credentials: "same-origin",
    });
  });

  it("throws token <status> on non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })),
    );
    await expect(fetchViraToken()).rejects.toThrow("token 403");
  });
});

describe("script mount / cleanup", () => {
  it("adds the script once across repeated mounts", () => {
    const url = "http://widget.example/vira.js";
    appendViraScriptOnce(url);
    appendViraScriptOnce(url);
    expect(dom.scripts).toHaveLength(1);
    expect(dom.scripts[0]).toMatchObject({
      id: VIRA_SCRIPT_ID,
      src: url,
      async: true,
    });
  });

  it("cleanup removes the script and ViraHost", () => {
    const unmount = vi.fn();
    installViraHost("http://runtime.example");
    appendViraScriptOnce("http://widget.example/vira.js");
    dom.windowObj.ViraWidget = { unmount };

    expect(dom.windowObj.ViraHost).toBeDefined();
    expect(dom.scripts).toHaveLength(1);
    expect(dom.windowObj.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "vira:host-ready" }),
    );

    teardownViraWidget();

    expect(unmount).toHaveBeenCalledOnce();
    expect(dom.scripts).toHaveLength(0);
    expect(dom.windowObj.ViraHost).toBeUndefined();
  });
});
