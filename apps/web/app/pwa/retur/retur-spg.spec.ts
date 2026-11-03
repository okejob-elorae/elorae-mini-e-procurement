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
  selisihDiminta: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "id",
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
  returSaya: vi.fn(async (_id: string, opsi?: { nilaiKonsi?: boolean }) => {
    state.opsi.push(opsi);
    // Nilai retur toko konsi hanya untuk HP salesman (P57); HP SPG tetap tanpa (P18a).
    const nilaiKonsi = opsi?.nilaiKonsi ? 125_000 : null;
    return [
      baris({ id: "nrt-saya", milikSaya: true, langkah: "cek", nilaiKlaim: nilaiKonsi }),
      baris({ id: "nrt-spg-cek", milikSaya: false, pelapor: "Rina", dariSpg: true, langkah: "cek" }),
      baris({ id: "nrt-spg-batal", milikSaya: false, pelapor: "Rina", dariSpg: true, langkah: "batal" }),
      baris({ id: "nrt-spg-beres", milikSaya: false, pelapor: null, dariSpg: true, langkah: "beres" }),
    ];
  }),
  selisihReturSaya: vi.fn(async (id: string) => {
    state.selisihDiminta.push(id);
    return [];
  }),
}));
vi.mock("@/app/actions/store-returns", () => ({ laporHasilCekSelisihAction: vi.fn() }));
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
  state.selisihDiminta = [];
});

describe("halaman /pwa/retur — nota SPG di toko yang dipegang", () => {
  it("salesman: kueri ikut nota SPG tokonya; pengganti/koreksi hanya untuk nota miliknya", async () => {
    await props();
    expect(state.opsi).toEqual([{ termasukSpgTokoSaya: true, nilaiKonsi: true }]);
    // Selisih retur yang perlu dicek hanya untuk salesman.
    expect(state.selisihDiminta).toEqual(["sales-1"]);
    // Nota batal milik SPG tidak dicarikan penggantinya untuk salesman ini.
    expect(state.pengganti).toEqual([[]]);
    expect(state.koreksi).toEqual([[]]);
  });

  it("SPG: hanya notanya sendiri", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access"] } };
    state.tokoTetap = "toko-1";
    const p = await props();
    expect(state.opsi).toEqual([{ termasukSpgTokoSaya: false, nilaiKonsi: false }]);
    expect(state.selisihDiminta).toEqual([]);
    // HP SPG: nilai retur toko konsi tetap tidak sampai.
    expect(p.baris.find((b) => b.id === "nrt-saya")?.nilaiKlaim).toBeNull();
  });

  it("salesman pemegang toko: nilai retur toko konsi tampil sebagai rupiah (P57)", async () => {
    const p = await props();
    expect(p.baris.find((b) => b.id === "nrt-saya")?.nilaiKlaim).toBe(125_000);
    const html = renderToStaticMarkup(createElement(ReturSayaClient, { baris: p.baris as never }));
    expect(html).toContain("125.000");
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

describe("bagian selisih retur — tombol hanya untuk yang masih menunggu laporan Anda", () => {
  // Bentuk persis `SelisihReturSaya` (lib/receivables/pwa-queries.ts).
  const selisih = (b: Record<string, unknown>) => ({
    chargeId: "c1",
    storeReturnId: "sr1",
    noNrt: "NRT-1",
    noNri: "NRI-1",
    storeId: "toko-1",
    storeName: "Toko Satu",
    tanggal: "2026-10-01T00:00:00.000Z",
    nilai: 75_000,
    barang: [{ itemName: "Kaos Elorae", variantSku: "KE-M", qtyKurang: 2 }],
    spg: ["Rina"],
    cek: "DITANYAKAN",
    cekCatatan: null,
    cekPada: null,
    perluDicek: true,
    ...b,
  });
  const render = async (baris: Array<Record<string, unknown>>) => {
    const { SelisihPerluDicek } = await import("./SelisihPerluDicek");
    return renderToStaticMarkup(createElement(SelisihPerluDicek, { baris: baris as never })).replace(/&quot;/g, '"');
  };

  it("menampilkan barang yang kurang dari kolom `barang`, dan tombol lapor untuk yang perlu dicek", async () => {
    const h = await render([selisih({})]);
    expect(h).toContain("Kaos Elorae");
    expect(h).toContain('pwaRetur.selisih.kurangPcs{"n":2}');
    expect(h).toContain("75.000");
    expect(h).toContain("pwaRetur.selisih.ditemukan");
    expect(h).toContain("pwaRetur.selisih.tidakDitemukan");
    expect(h).toContain("pwaRetur.selisih.judul");
  });

  it("yang sudah dilaporkan dan menunggu kantor: catatan dan waktunya tampil, tanpa tombol", async () => {
    const h = await render([
      selisih({ cek: "TIDAK_DITEMUKAN", cekCatatan: "toko bilang sudah dikirim", cekPada: "2026-10-02T07:30:00.000Z", perluDicek: false }),
    ]);
    expect(h).toContain("toko bilang sudah dikirim");
    expect(h).toContain("pwaRetur.selisih.laporTerakhir");
    expect(h).not.toContain("2026-10-02T07:30");
    expect(h).toContain("pwaRetur.selisih.sudahDilaporJudul");
    expect(h).not.toContain("pwaRetur.selisih.ditemukan<");
    expect(h).not.toContain("pwaRetur.selisih.tidakDitemukan<");
  });
});
