import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getRequiredPermission, hasPermission, PERMISSIONS, requirePermission } from "@/lib/rbac";
import { gateAllows, type ViraGate } from "../akses";
import { VIRA_PARITY_CASES, VIRA_TOOLS } from "./index";
import type { ParityCase, ViraTool } from "./types";

/**
 * Parity: every VIRA tool's gate must equal the gate of the UI screen or action it mirrors.
 * Tool cards only add rows to their module's `parityCases`; this file is the engine that checks
 * them. A mismatch in either direction fails: a tool that shows what the UI blocks, or blocks
 * what the UI shows.
 */

const sesi = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "parity-user", permissions: sesi.permissions } })),
}));

const WEB_ROOT = path.resolve(__dirname, "../../..");
const KODE_IZIN = /^[a-z0-9_]+(:[a-z0-9_]+)+$/;

/** The shape requirePermission / requireAnyPermission throw (lib/rbac.ts): status 403, fixed message. */
function izinDitolak(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as Error & { status?: unknown }).status === 403 &&
    err.message === "Forbidden: Insufficient permissions"
  );
}

function kodeGerbang(gate: ViraGate): string[] {
  switch (gate.kind) {
    case "anyValidToken":
    case "izin":
      return [];
    case "code":
      return [gate.code];
    case "anyOf":
    case "allOf":
      return [...gate.codes];
  }
}

/** Exported permission-code constants (strings or string arrays) of a predicate's module. */
function kodeDariModul(mod: Record<string, unknown>): string[] {
  const kode: string[] = [];
  for (const nilai of Object.values(mod)) {
    if (typeof nilai === "string" && KODE_IZIN.test(nilai)) kode.push(nilai);
    if (Array.isArray(nilai)) for (const v of nilai) if (typeof v === "string" && KODE_IZIN.test(v)) kode.push(v);
    if (nilai && typeof nilai === "object" && !Array.isArray(nilai)) {
      for (const v of Object.values(nilai)) if (typeof v === "string" && KODE_IZIN.test(v)) kode.push(v);
    }
  }
  return kode;
}

async function himpunanIzin(tool: ViraTool, kasus: ParityCase): Promise<string[][]> {
  const kode = new Set(kodeGerbang(tool.gate));
  if (tool.gate.kind === "izin") {
    if (kasus.kind === "pageCode") for (const c of kasus.codes) kode.add(c);
    if (kasus.kind === "predicate") {
      for (const c of kodeDariModul((await import(/* @vite-ignore */ kasus.module)) as Record<string, unknown>)) {
        kode.add(c);
      }
    }
  }
  const himpunan: string[][] = [[], ["unrelated:code"], ["*"], ...[...kode].map((c) => [c])];
  if (tool.gate.kind === "allOf") {
    const semua = [...tool.gate.codes];
    himpunan.push(semua);
    for (const hilang of semua) himpunan.push(semua.filter((c) => c !== hilang));
  }
  const unik = new Map(himpunan.map((h) => [JSON.stringify([...h].sort()), h]));
  return [...unik.values()];
}

type HasilUi = { boleh: boolean } | { gagal: string };

/** A page "names" a code when it holds it as a string literal, or as the `PERMISSIONS.<KEY>`
 *  constant from lib/rbac.ts whose value is that code (how most pages spell their gate). */
function halamanMenyebut(teks: string, kode: string): boolean {
  if (["\"", "'", "`"].some((q) => teks.includes(`${q}${kode}${q}`))) return true;
  return Object.entries(PERMISSIONS).some(
    ([kunci, nilai]) => nilai === kode && new RegExp(`\\bPERMISSIONS\\.${kunci}\\b`).test(teks),
  );
}

async function hasilUi(kasus: ParityCase, izin: string[]): Promise<HasilUi> {
  switch (kasus.kind) {
    case "route": {
      const kode = getRequiredPermission(kasus.path);
      if (!kode) return { gagal: `route ${kasus.path} has no permission rule` };
      return { boleh: hasPermission(izin, kode) };
    }
    case "predicate": {
      const mod = (await import(/* @vite-ignore */ kasus.module)) as Record<string, unknown>;
      const fn = mod[kasus.exportName];
      if (typeof fn !== "function") return { gagal: `${kasus.module} has no function ${kasus.exportName}` };
      // Predicates take the permission list; one that wants a session-like object gets one.
      const arg = fn.length === 1 && /session|sesi/i.test(String(fn).slice(0, 80))
        ? { user: { id: "parity-user", permissions: izin } }
        : izin;
      return { boleh: Boolean(await (fn as (a: unknown) => unknown)(arg)) };
    }
    case "pageCode": {
      // Cards spell page files from the repo root ("apps/web/app/…"); both forms resolve.
      const teks = readFileSync(path.resolve(WEB_ROOT, kasus.pageFile.replace(/^apps\/web\//, "")), "utf8");
      const hilang = kasus.codes.filter((c) => !halamanMenyebut(teks, c));
      if (hilang.length) {
        return { gagal: `${kasus.pageFile} has no string literal or PERMISSIONS constant for ${hilang.join(", ")}` };
      }
      return { boleh: kasus.codes.some((c) => hasPermission(izin, c)) };
    }
    case "writeAction":
      // Wave-1 (#540) only adds the ParityCase variant. The write-action parity engine is VIRA-27 (#544).
      return {
        gagal: `writeAction parity for ${kasus.tool} is not implemented yet (VIRA-27)`,
      };
    case "action": {
      vi.resetModules();
      vi.doMock(kasus.libModule, async (asli) => {
        const nyata = (await asli().catch(() => ({}))) as Record<string, unknown>;
        return { ...nyata, [kasus.libExport]: vi.fn(async () => []) };
      });
      try {
        sesi.permissions = izin;
        const mod = (await import(/* @vite-ignore */ kasus.actionModule)) as Record<string, unknown>;
        const fn = mod[kasus.actionExport];
        if (typeof fn !== "function") return { gagal: `${kasus.actionModule} has no function ${kasus.actionExport}` };
        try {
          await (fn as (...a: unknown[]) => unknown)(...kasus.args);
          return { boleh: true };
        } catch (err) {
          if (izinDitolak(err)) return { boleh: false };
          return { gagal: `${kasus.actionExport} threw something other than the permission error: ${String(err)}` };
        }
      } finally {
        vi.doUnmock(kasus.libModule);
        sesi.permissions = [];
      }
    }
  }
}

/** Every mismatch between the tool's gate and the UI, as readable lines. Empty = parity holds. */
async function periksaParitas(tool: ViraTool, kasus: ParityCase): Promise<string[]> {
  const masalah: string[] = [];
  for (const izin of await himpunanIzin(tool, kasus)) {
    const harapan = gateAllows(tool.gate, izin);
    const ui = await hasilUi(kasus, izin);
    if ("gagal" in ui) {
      masalah.push(`${tool.name} ${JSON.stringify(izin)}: ${ui.gagal}`);
    } else if (ui.boleh !== harapan) {
      masalah.push(
        `${tool.name} ${JSON.stringify(izin)}: tool gate allows=${harapan} but UI (${kasus.kind}) allows=${ui.boleh}`,
      );
    }
  }
  return masalah;
}

function cakupan(tools: readonly ViraTool[], cases: readonly ParityCase[]): string[] {
  return tools
    .filter((t) => t.name !== "whoami")
    .flatMap((t) => {
      const n = cases.filter((c) => c.tool === t.name).length;
      return n === 1 ? [] : [`${t.name}: ${n === 0 ? "no parity case" : `${n} parity cases (expected exactly 1)`}`];
    });
}

describe("VIRA tool parity — real registry", () => {
  const nyata = VIRA_TOOLS.filter((t) => t.name !== "whoami");

  it("every tool except whoami has exactly one parity case", () => {
    expect(cakupan(VIRA_TOOLS, VIRA_PARITY_CASES)).toEqual([]);
  });

  it("no parity case points at a tool that does not exist", () => {
    const nama = new Set(VIRA_TOOLS.map((t) => t.name));
    expect(VIRA_PARITY_CASES.filter((c) => !nama.has(c.tool)).map((c) => c.tool)).toEqual([]);
  });

  it.each(nyata.map((t) => [t.name, t] as const))("%s: gate equals the UI gate", async (_nama, tool) => {
    const kasus = VIRA_PARITY_CASES.find((c) => c.tool === tool.name);
    expect(kasus, `${tool.name} has no parity case`).toBeDefined();
    expect(await periksaParitas(tool, kasus!)).toEqual([]);
  });
});

/* ── Self-test: fakes live only in this file, never in VIRA_TOOLS ───────────────────────── */

// vi.mock is hoisted above these constants, so the mock calls spell the ids out literally.

const PALSU_AKSI = "virtual:vira-parity/fake-action";
const PALSU_LIB = "virtual:vira-parity/fake-lib";
const PALSU_PREDIKAT = "virtual:vira-parity/fake-predicate";

vi.mock("virtual:vira-parity/fake-lib", () => ({ bacaPalsu: async () => ["real-row"] }));
vi.mock("virtual:vira-parity/fake-predicate", () => ({
  IZIN_PALSU: ["parity_fixture:view", "parity_fixture:list"],
  bolehPalsu: (izin: string[]) => ["parity_fixture:view", "parity_fixture:list"].some((c) => hasPermission(izin, c)),
}));
vi.mock("virtual:vira-parity/fake-action", () => ({
  aksiPalsu: async () => {
    const { auth } = await import("@/lib/auth");
    const s = (await auth()) as unknown as { user: { permissions: string[] } };
    requirePermission(s.user.permissions, "parity_fixture:view");
    const lib = (await import(/* @vite-ignore */ PALSU_LIB)) as { bacaPalsu: () => Promise<unknown> };
    return lib.bacaPalsu();
  },
  aksiRusak: async () => {
    throw new Error("database exploded");
  },
}));

/** Literal codes the pageCode fake reads back from THIS file. */
const KODE_HALAMAN_PALSU = ["parity_fixture:view", "parity_fixture:export"];
const BERKAS_INI = "lib/vira/tools/parity.spec.ts";

function alatPalsu(name: string, gate: ViraGate): ViraTool {
  return { name, title: name, description: "parity self-test", gate, inputShape: {}, handler: async () => null };
}

type KasusUji = [label: string, tool: ViraTool, kasus: ParityCase, cocok: boolean];

const KASUS_UJI: KasusUji[] = [
  [
    "route — matching gate",
    alatPalsu("fake_route_ok", { kind: "code", code: "items:view" }),
    { tool: "fake_route_ok", kind: "route", path: "/backoffice/items" },
    true,
  ],
  [
    "route — mismatched gate",
    alatPalsu("fake_route_bad", { kind: "code", code: "inventory:view" }),
    { tool: "fake_route_bad", kind: "route", path: "/backoffice/items" },
    false,
  ],
  [
    "route — path without a permission rule",
    alatPalsu("fake_route_none", { kind: "code", code: "items:view" }),
    { tool: "fake_route_none", kind: "route", path: "/no-such-area/anything" },
    false,
  ],
  [
    "predicate — matching izin gate",
    alatPalsu("fake_pred_ok", {
      kind: "izin",
      name: "bolehPalsu",
      check: (izin) => ["parity_fixture:view", "parity_fixture:list"].some((c) => hasPermission(izin, c)),
    }),
    { tool: "fake_pred_ok", kind: "predicate", module: PALSU_PREDIKAT, exportName: "bolehPalsu" },
    true,
  ],
  [
    "predicate — izin gate that forgets one of the codes",
    alatPalsu("fake_pred_bad", { kind: "izin", name: "lupaSatu", check: (izin) => hasPermission(izin, "parity_fixture:view") }),
    { tool: "fake_pred_bad", kind: "predicate", module: PALSU_PREDIKAT, exportName: "bolehPalsu" },
    false,
  ],
  [
    "pageCode — matching anyOf gate",
    alatPalsu("fake_page_ok", { kind: "anyOf", codes: KODE_HALAMAN_PALSU }),
    { tool: "fake_page_ok", kind: "pageCode", pageFile: BERKAS_INI, codes: KODE_HALAMAN_PALSU },
    true,
  ],
  [
    "pageCode — allOf gate where the page needs any one",
    alatPalsu("fake_page_bad", { kind: "allOf", codes: KODE_HALAMAN_PALSU }),
    { tool: "fake_page_bad", kind: "pageCode", pageFile: BERKAS_INI, codes: KODE_HALAMAN_PALSU },
    false,
  ],
  [
    "pageCode — code the page names through its PERMISSIONS constant",
    alatPalsu("fake_page_const", { kind: "code", code: PERMISSIONS.VIRA_USE }),
    { tool: "fake_page_const", kind: "pageCode", pageFile: BERKAS_INI, codes: [PERMISSIONS.VIRA_USE] },
    true,
  ],
  [
    "pageCode — code that is not a literal in the page file",
    alatPalsu("fake_page_missing", { kind: "code", code: "absent_code:view" }),
    {
      tool: "fake_page_missing",
      kind: "pageCode",
      pageFile: "lib/vira/config.ts",
      codes: ["absent_code:view"],
    },
    false,
  ],
  [
    "action — matching gate",
    alatPalsu("fake_action_ok", { kind: "code", code: "parity_fixture:view" }),
    {
      tool: "fake_action_ok",
      kind: "action",
      actionModule: PALSU_AKSI,
      actionExport: "aksiPalsu",
      libModule: PALSU_LIB,
      libExport: "bacaPalsu",
      args: [],
    },
    true,
  ],
  [
    "action — mismatched gate",
    alatPalsu("fake_action_bad", { kind: "anyValidToken" }),
    {
      tool: "fake_action_bad",
      kind: "action",
      actionModule: PALSU_AKSI,
      actionExport: "aksiPalsu",
      libModule: PALSU_LIB,
      libExport: "bacaPalsu",
      args: [],
    },
    false,
  ],
  [
    "action — action that throws something other than the permission error",
    alatPalsu("fake_action_broken", { kind: "anyValidToken" }),
    {
      tool: "fake_action_broken",
      kind: "action",
      actionModule: PALSU_AKSI,
      actionExport: "aksiRusak",
      libModule: PALSU_LIB,
      libExport: "bacaPalsu",
      args: [],
    },
    false,
  ],
];

describe("VIRA tool parity — engine self-test (fakes in this file only)", () => {
  it.each(KASUS_UJI)("%s", async (_label, tool, kasus, cocok) => {
    const masalah = await periksaParitas(tool, kasus);
    if (cocok) {
      expect(masalah).toEqual([]);
    } else {
      expect(masalah.length).toBeGreaterThan(0);
      for (const baris of masalah) expect(baris.startsWith(`${tool.name} [`)).toBe(true);
    }
  });

  it("a mismatch message names the tool, the permission set, the expected and the actual result", async () => {
    const [, tool, kasus] = KASUS_UJI[1];
    const masalah = await periksaParitas(tool, kasus);
    expect(masalah).toContain(
      'fake_route_bad ["inventory:view"]: tool gate allows=true but UI (route) allows=false',
    );
  });

  it("allOf gates are tested with all codes together and with each code missing", async () => {
    const tool = alatPalsu("fake_allof", { kind: "allOf", codes: ["a_fix:view", "b_fix:view"] });
    const sets = await himpunanIzin(tool, { tool: "fake_allof", kind: "route", path: "/backoffice/items" });
    const kunci = sets.map((s) => JSON.stringify([...s].sort()));
    expect(kunci).toEqual(
      expect.arrayContaining([
        "[]",
        '["unrelated:code"]',
        '["*"]',
        '["a_fix:view"]',
        '["b_fix:view"]',
        '["a_fix:view","b_fix:view"]',
      ]),
    );
  });

  it("izin gates on a predicate are tested with every code the predicate module exports", async () => {
    const [, tool, kasus] = KASUS_UJI[3];
    const kunci = (await himpunanIzin(tool, kasus)).map((s) => JSON.stringify(s));
    expect(kunci).toEqual(expect.arrayContaining(['["parity_fixture:view"]', '["parity_fixture:list"]']));
  });

  it("coverage reports a missing and a duplicate parity case by tool name", () => {
    const a = alatPalsu("fake_a", { kind: "anyValidToken" });
    const b = alatPalsu("fake_b", { kind: "anyValidToken" });
    const who = alatPalsu("whoami", { kind: "anyValidToken" });
    const r = (tool: string): ParityCase => ({ tool, kind: "route", path: "/backoffice/items" });
    expect(cakupan([who, a, b], [r("fake_b"), r("fake_b")])).toEqual([
      "fake_a: no parity case",
      "fake_b: 2 parity cases (expected exactly 1)",
    ]);
  });
});
