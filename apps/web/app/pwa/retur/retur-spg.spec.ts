import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Daftar retur HP (`/pwa/retur`): salesman juga melihat nota yang dilaporkan
 * SPG di toko yang ia pegang, bertanda "Dari SPG", HANYA untuk dilihat —
 * tanpa tarik, minta koreksi, atau lapor ulang. SPG tetap melihat notanya
 * sendiri saja. Kuerinya diuji terhadap basis data di
 * `lib/receivables/retur-saya.test.ts`; di sini sambungan halaman dan layarnya.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  opsi: [] as Array<unknown>,
  pengganti: [] as string[][],
  koreksi: [] as string[][],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
}));
vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (k: string, p?: Record<string, unknown>) =>
      `${ns}.${k}${p ? JSON.stringify(p) : ""}`,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/receivables/pwa-queries", () => ({
  returSaya: vi.fn(async (_id: string, opsi?: unknown) => {
    state.opsi.push(opsi);
    return [
      baris({ id: "nrt-saya", milikSaya: true, langkah: "cek" }),
      baris({ id: "nrt-spg-cek", milikSaya: false, pelapor: "Rina", dariSpg: true, langkah: "cek" }),
      baris({ id: "nrt-spg-batal", milikSaya: false, pelapor: "Rina", dariSpg: true, langkah: "batal" }),
      baris({ id: "nrt-spg-beres", milikSaya: false, pelapor: null, dariSpg: true, langkah: "beres" }),
    ];
  }),
}));
vi.mock("@/lib/receivables/koreksi", () => ({
  penggantiUntuk: vi.fn(async (_j: string, ids: string[]) => {
    state.pengganti.push(ids);
    return new Map();
  }),
  koreksiTertunda: vi.fn(async (_j: string, ids: string[]) => {
    state.koreksi.push(ids);
    return new Map();
  }),
}));
vi.mock("@/app/pwa/TombolTarikLaporan", () => ({
  TombolTarikLaporan: ({ id, mode }: { id: string; mode?: string }) =>
    createElement("i", { "data-tarik": `${mode ?? "tarik"}:${id}` }),
}));
vi.mock("@/app/pwa/KoreksiTerkirim", () => ({ KoreksiTerkirim: () => null }));
vi.mock("@/app/pwa/TombolBantuanHp", () => ({ TombolBantuanHp: () => null }));

function baris(b: Record<string, unknown>) {
  return {
    noNrt: `NRT-${b.id}`,
    storeName: "Toko Satu",
    tanggal: "2026-10-01T00:00:00.000Z",
    nilaiKlaim: null,
    adaFoto: false,
    dariSpg: false,
    jumlahBarang: 3,
    pelapor: null,
    ...b,
  };
}

const { default: Halaman } = await import("./page");
const { ReturSayaClient } = await import("./ReturSayaClient");

const props = async () => {
  const el = (await Halaman()) as ReactNode;
  if (!isValidElement(el) || el.type !== ReturSayaClient) throw new Error("ReturSayaClient tidak dirender");
  return (el as ReactElement<{ baris: Array<Record<string, unknown>> }>).props;
};

beforeEach(() => {
  state.sesi = { user: { id: "sales-1", permissions: ["pwa:access"] } };
  state.tokoTetap = null;
  state.opsi = [];
  state.pengganti = [];
  state.koreksi = [];
});

describe("halaman /pwa/retur — nota SPG di toko yang dipegang", () => {
  it("salesman: kueri ikut nota SPG tokonya; pengganti/koreksi hanya untuk nota miliknya", async () => {
    await props();
    expect(state.opsi).toEqual([{ termasukSpgTokoSaya: true }]);
    // Nota batal milik SPG tidak dicarikan penggantinya untuk salesman ini.
    expect(state.pengganti).toEqual([[]]);
    expect(state.koreksi).toEqual([[]]);
  });

  it("SPG: hanya notanya sendiri", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access"] } };
    state.tokoTetap = "toko-1";
    await props();
    expect(state.opsi).toEqual([{ termasukSpgTokoSaya: false }]);
  });
});

describe("layar daftar retur — nota SPG hanya untuk dilihat", () => {
  const html = async () =>
    renderToStaticMarkup(createElement(ReturSayaClient, { baris: (await props()).baris as never })).replace(
      /&quot;/g,
      '"',
    );

  it("nota SPG bertanda 'Dari SPG' dengan nama pelapornya", async () => {
    const h = await html();
    expect(h).toContain('pwaRetur.dariSpgOleh{"nama":"Rina"}');
    // Tanpa nama pelapor: tanda tanpa nama.
    expect(h).toMatch(/pwaRetur\.dariSpg</);
  });

  it("tarik, minta koreksi, dan lapor ulang hanya pada nota milik sendiri", async () => {
    const h = await html();
    expect(h).toContain('data-tarik="tarik:nrt-saya"');
    expect(h).not.toContain("nrt-spg-cek\"");
    expect(h).not.toContain("koreksi:nrt-spg-beres");
    expect(h).not.toContain("salin=nrt-spg-batal");
    expect(h.match(/data-tarik=/g)).toHaveLength(1);
  });

  it("nota milik sendiri tidak bertanda SPG", async () => {
    const h = await html();
    const potong = h.split("NRT-nrt-saya")[1].split("NRT-nrt-spg-cek")[0];
    expect(potong).not.toContain("pwaRetur.dariSpg");
  });
});
