import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Back-office layout gates the VIRA chat widget on vira:use (and system "*").
 * The widget itself is mocked so this file only asserts the permission gate.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  lastEnabled: null as boolean | null,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("./BackofficeShell", () => ({
  BackofficeShell: ({ children }: { children: unknown }) =>
    createElement("div", { "data-shell": "1" }, children as never),
}));
vi.mock("@/components/vira/ViraWidget", () => ({
  ViraWidget: ({ enabled }: { enabled: boolean }) => {
    state.lastEnabled = enabled;
    return enabled ? createElement("span", { "data-vira": "on" }) : null;
  },
}));

const { default: BackofficeLayout } = await import("./layout");

const ISI = createElement("main", null, "isi");

beforeEach(() => {
  state.sesi = null;
  state.lastEnabled = null;
});

describe("backoffice layout — VIRA widget gate", () => {
  it("session without vira:use → widget disabled (renders none)", async () => {
    state.sesi = { user: { id: "u1", permissions: ["dashboard:view"] } };
    const tree = await BackofficeLayout({ children: ISI });
    expect(isValidElement(tree)).toBe(true);
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(state.lastEnabled).toBe(false);
    expect(html).not.toContain('data-vira="on"');
    expect(html).toContain("isi");
  });

  it('session with "*" → widget enabled', async () => {
    state.sesi = { user: { id: "admin", permissions: ["*"] } };
    const tree = await BackofficeLayout({ children: ISI });
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(state.lastEnabled).toBe(true);
    expect(html).toContain('data-vira="on"');
  });
});
