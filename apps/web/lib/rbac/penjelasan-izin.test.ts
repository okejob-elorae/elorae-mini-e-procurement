import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROUTE_PERMISSIONS } from "@/lib/rbac";
import {
  DESKRIPSI_PERAN_BAWAAN,
  GRUP_IZIN,
  GRUP_LAINNYA,
  IZIN_AKSES_HP,
  PENJELASAN_IZIN,
  bandingkanIzin,
  cocokCari,
  grupTercakup,
  halamanRingkas,
  kunciDeskripsiPeran,
  kunciIzin,
  letakDiMenu,
  penjelasanIzin,
} from "./penjelasan-izin";

/**
 * Jaring editor Peran & Izin. Izin tanpa penjelasan tampil sebagai kode
 * mentah di grup "Lainnya", dan kunci i18n yang hilang tampil sebagai nama
 * kuncinya — keduanya tidak gagal dengan berisik. Tes ini yang berisik.
 *
 * Teks i18n dibaca dari `lib/i18n/messages/*.json`. Sebelum fragmen i18n
 * digabung, arahkan `FRAGMEN_I18N=<berkas fragmen>` supaya isinya ikut dibaca.
 */

const APP = path.resolve(__dirname, "../../app");
type Pesan = Record<string, unknown>;
const bacaJson = (berkas: string): Pesan => JSON.parse(readFileSync(berkas, "utf8")) as Pesan;
const fragmen = process.env.FRAGMEN_I18N && existsSync(process.env.FRAGMEN_I18N) ? bacaJson(process.env.FRAGMEN_I18N) : null;
const pesan: Record<"id" | "en", Pesan[]> = {
  id: [bacaJson(path.resolve(__dirname, "../i18n/messages/id.json")), ...(fragmen ? [fragmen.id as Pesan] : [])],
  en: [bacaJson(path.resolve(__dirname, "../i18n/messages/en.json")), ...(fragmen ? [fragmen.en as Pesan] : [])],
};

function ambil(obj: unknown, kunci: string): unknown {
  return kunci
    .split(".")
    .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}
const kunciHilang = (kunci: string[]) =>
  (["id", "en"] as const).flatMap((bahasa) =>
    kunci.filter((k) => !pesan[bahasa].some((p) => typeof ambil(p, `izinPeran.${k}`) === "string")).map((k) => `${bahasa}: ${k}`),
  );

const SEMUA_KODE = [...new Set<string>([...Object.values(PERMISSIONS), IZIN_AKSES_HP])];

describe("penjelasan izin", () => {
  it("setiap kode izin punya penjelasan", () => {
    expect(SEMUA_KODE.filter((k) => !penjelasanIzin(k))).toEqual([]);
  });

  it("tidak ada penjelasan untuk kode yang tidak ada", () => {
    expect(Object.keys(PENJELASAN_IZIN).filter((k) => !SEMUA_KODE.includes(k))).toEqual([]);
  });

  it("setiap label dan keterangan ada di kedua bahasa", () => {
    const kunci = Object.values(PENJELASAN_IZIN).flatMap((e) => [e.label, e.keterangan]);
    expect(kunciHilang(kunci)).toEqual([]);
  });

  it("setiap grup dan keterangan peran bawaan punya teks di kedua bahasa", () => {
    const kunci = [
      ...[...GRUP_IZIN, GRUP_LAINNYA].map((g) => `grup.${g}`),
      ...Object.keys(DESKRIPSI_PERAN_BAWAAN).map((n) => `peranBawaan.${n}`),
    ];
    expect(kunciHilang(kunci)).toEqual([]);
  });

  it("kunci i18n setiap kode berbeda", () => {
    const kunci = SEMUA_KODE.map(kunciIzin);
    expect(kunci.filter((k, i) => kunci.indexOf(k) !== i)).toEqual([]);
  });

  it("setiap rute kantor di ROUTE_PERMISSIONS tercantum di halaman milik izinnya", () => {
    const hilang = Object.entries(ROUTE_PERMISSIONS)
      .filter(([rute]) => !rute.startsWith("/api/"))
      .filter(([rute, kode]) => !penjelasanIzin(kode)?.halaman.includes(rute))
      .map(([rute, kode]) => `${kode} → ${rute}`);
    expect(hilang).toEqual([]);
  });

  it("setiap halaman yang dicantumkan benar-benar ada", () => {
    const hilang = Object.values(PENJELASAN_IZIN)
      .flatMap((e) => e.halaman)
      .filter((r) => !existsSync(path.join(APP, r, "page.tsx")));
    expect([...new Set(hilang)]).toEqual([]);
  });

  it("izin yang dibutuhkan adalah kode lain yang dikenal", () => {
    const salah = Object.entries(PENJELASAN_IZIN)
      .filter(([kode, e]) => e.butuh !== undefined && (e.butuh === kode || !penjelasanIzin(e.butuh)))
      .map(([kode]) => kode);
    expect(salah).toEqual([]);
  });

  it("keterangan peran bawaan sama persis dengan seed", () => {
    const seed = readFileSync(path.resolve(__dirname, "../../../../packages/db/prisma/seed.ts"), "utf8");
    for (const [nama, deskripsi] of Object.entries(DESKRIPSI_PERAN_BAWAAN)) {
      const cocok = new RegExp(`name: '${nama}',\\s*description: '([^']*)'`).exec(seed);
      expect(cocok?.[1], nama).toBe(deskripsi);
    }
  });
});

describe("kunciDeskripsiPeran", () => {
  it("menerjemahkan hanya keterangan bawaan yang belum diubah", () => {
    expect(kunciDeskripsiPeran("PURCHASER", DESKRIPSI_PERAN_BAWAAN.PURCHASER)).toBe("peranBawaan.PURCHASER");
    expect(kunciDeskripsiPeran("PURCHASER", `  ${DESKRIPSI_PERAN_BAWAAN.PURCHASER} `)).toBe("peranBawaan.PURCHASER");
    expect(kunciDeskripsiPeran("PURCHASER", "Bagian beli kain")).toBeNull();
    expect(kunciDeskripsiPeran("PURCHASER", null)).toBeNull();
    expect(kunciDeskripsiPeran("KEUANGAN", DESKRIPSI_PERAN_BAWAAN.PURCHASER)).toBeNull();
    expect(kunciDeskripsiPeran("toString", "function toString() { [native code] }")).toBeNull();
  });
});

describe("grup dan urutan", () => {
  it("grup tercakup berurutan menurut bidang kerja, tanpa ganda, kode asing ke Lainnya", () => {
    expect(grupTercakup(["inventory:view", "purchase_orders:view", "purchase_orders:create", "kode:asing"])).toEqual([
      "pembelian",
      "gudang",
      GRUP_LAINNYA,
    ]);
    expect(grupTercakup([])).toEqual([]);
  });

  it("mengurutkan menurut grup lalu urutan entri; lihat sebelum tindakan", () => {
    const urut = ["kode:asing", "purchase_orders:create", "dashboard:view", "purchase_orders:view"].sort(bandingkanIzin);
    expect(urut).toEqual(["dashboard:view", "purchase_orders:view", "purchase_orders:create", "kode:asing"]);
  });
});

describe("halamanRingkas", () => {
  it("membuang rute rincian yang induknya sudah tercantum", () => {
    expect(
      halamanRingkas([
        "/backoffice/sales-orders",
        "/backoffice/sales-orders/[id]/pick-list",
        "/backoffice/returns/[id]",
        "/backoffice/sales-orders",
      ]),
    ).toEqual(["/backoffice/sales-orders", "/backoffice/returns/[id]"]);
  });
});

describe("letakDiMenu", () => {
  const menu = [
    { labelKey: "dashboard", href: "/backoffice/dashboard" },
    {
      labelKey: "sales",
      href: "/backoffice/sales-orders",
      children: [
        { labelKey: "navSalesOrders", href: "/backoffice/sales-orders" },
        { labelKey: "navFulfillment", href: "/backoffice/fulfillment" },
      ],
    },
    { labelKey: "inventory", href: "/backoffice/inventory", children: [{ labelKey: "inventory", href: "/backoffice/inventory" }] },
    { labelKey: "settings", href: "/backoffice/settings" },
  ];

  it("entri anak: grup lalu anak; anak bernama sama dengan grupnya cukup sekali", () => {
    expect(letakDiMenu("/backoffice/sales-orders", menu)).toEqual({ jalur: ["sales", "navSalesOrders"], tepat: true });
    expect(letakDiMenu("/backoffice/inventory", menu)).toEqual({ jalur: ["inventory"], tepat: true });
    expect(letakDiMenu("/backoffice/dashboard", menu)).toEqual({ jalur: ["dashboard"], tepat: true });
  });

  it("halaman di bawah entri menu memakai awalan terpanjang, bukan rute yang sekadar berawalan sama", () => {
    expect(letakDiMenu("/backoffice/settings/tax", menu)).toEqual({ jalur: ["settings"], tepat: false });
    expect(letakDiMenu("/backoffice/inventory/grn/new", menu)).toEqual({ jalur: ["inventory"], tepat: false });
    expect(letakDiMenu("/backoffice/sales-orders-lain", menu)).toBeNull();
    expect(letakDiMenu("/pwa", menu)).toBeNull();
  });
});

describe("cocokCari", () => {
  it("tanpa membedakan huruf besar dan aksen, setiap kata harus ada", () => {
    expect(cocokCari("", ["apa saja"])).toBe(true);
    expect(cocokCari("PO setujui", ["Setujui & kirim PO", "Pembelian"])).toBe(true);
    expect(cocokCari("eloraé", ["Elorae"])).toBe(true);
    expect(cocokCari("po hapus", ["Setujui & kirim PO"])).toBe(false);
  });
});
