import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/rbac";
import { bolehMelapor, bolehMembacaArsip, bolehMemverifikasi, bolehMencatatNomorKonsi } from "@/lib/receivables/izin";
import { IZIN_PERSETUJUAN, penjelasanIzin } from "./penjelasan-izin";

/**
 * Tiga peran kantor (keputusan pemilik 2026-11-01): KEUANGAN, ADMIN_PENJUALAN,
 * ADMIN_PAJAK. Isinya ditulis DUA kali — `seed.ts` (basis data uji) dan
 * `seed-office-roles-permissions.sql` (produksi, dijalankan tangan) — dan tidak
 * ada yang membandingkannya selain tes ini. Juga dijaga di sini: tidak ada izin
 * persetujuan bawaan, dan setiap izin hasil pemecahan benar-benar punya baris
 * `Permission` (izin tanpa baris tidak bisa diberikan di Peran & izin).
 */

const PRISMA = path.resolve(__dirname, "../../../../packages/db/prisma");
const seedTs = readFileSync(path.join(PRISMA, "seed.ts"), "utf8");
const sqlPeran = readFileSync(path.join(PRISMA, "seed-office-roles-permissions.sql"), "utf8");
const sqlIzin = readFileSync(path.join(PRISMA, "seed-max-features-permissions.sql"), "utf8");

const PERAN = ["KEUANGAN", "ADMIN_PENJUALAN", "ADMIN_PAJAK"] as const;
type Peran = (typeof PERAN)[number];
const VARIABEL_SEED: Record<Peran, string> = {
  KEUANGAN: "keuanganRole",
  ADMIN_PENJUALAN: "adminPenjualanRole",
  ADMIN_PAJAK: "adminPajakRole",
};

const kodeDalam = (teks: string): string[] => [...teks.matchAll(/["']([a-z_]+:[a-z_:]+)["']/g)].map((m) => m[1]);

function dariSeedTs(peran: Peran): string[] {
  const m = new RegExp(`roleId: ${VARIABEL_SEED[peran]}\\.id,\\s*codes: \\[([\\s\\S]*?)\\]`).exec(seedTs);
  if (!m) throw new Error(`daftar izin ${peran} tidak ditemukan di seed.ts`);
  return kodeDalam(m[1]);
}

function dariSql(peran: Peran): string[] {
  const m = new RegExp(`WHERE r\\.name = '${peran}'\\s*AND p\\.code IN \\(([^)]*)\\)`).exec(sqlPeran);
  if (!m) throw new Error(`daftar izin ${peran} tidak ditemukan di seed-office-roles-permissions.sql`);
  return kodeDalam(m[1]);
}

const urut = (kode: string[]) => [...new Set(kode)].sort();

/** Kode hasil pemecahan 2026-11-01. */
const KODE_PECAHAN = [
  PERMISSIONS.PAYMENTS_VERIFY,
  PERMISSIONS.RECEIVABLES_DECIDE_BEARER,
  PERMISSIONS.CONSIGNMENT_NOTE_NUMBER,
  PERMISSIONS.CONSIGNMENT_TAX_NUMBER,
  PERMISSIONS.CONSIGNMENT_LOCK,
  PERMISSIONS.STORE_STOCKTAKES_APPROVE,
  PERMISSIONS.STORE_TRANSFERS_APPROVE,
  PERMISSIONS.STORE_TRANSFERS_DECIDE_SHORTFALL,
  PERMISSIONS.SPG_COMMISSION_PAY,
];

describe("tiga peran kantor", () => {
  for (const peran of PERAN) {
    describe(peran, () => {
      const izin = dariSeedTs(peran);

      it("seed.ts dan berkas SQL produksi memberi izin yang sama", () => {
        expect(urut(dariSql(peran))).toEqual(urut(izin));
      });

      it("tidak memegang izin persetujuan apa pun secara bawaan", () => {
        expect(izin.filter((k) => (IZIN_PERSETUJUAN as readonly string[]).includes(k))).toEqual([]);
      });

      it("setiap izinnya dijelaskan di Peran & izin, dan izin yang dibutuhkannya ikut", () => {
        expect(izin.filter((k) => !penjelasanIzin(k))).toEqual([]);
        const butuhHilang = izin
          .map((k) => penjelasanIzin(k)?.butuh)
          .filter((b): b is string => b !== undefined && !izin.includes(b));
        expect(butuhHilang).toEqual([]);
      });

      it("bukan peran sistem: dibuat isSystem = 0 di SQL dan false di seed.ts", () => {
        expect(sqlPeran).toMatch(new RegExp(`'${peran}', '[^']*', 0, 1, NOW\\(3\\)`));
        expect(seedTs).toMatch(
          new RegExp(`where: \\{ name: "${peran}" \\},\\s*update: \\{ isSystem: false \\},[\\s\\S]*?isSystem: false,`),
        );
      });
    });
  }

  it("KEUANGAN memeriksa pembayaran tetapi tidak mencatat BKM, jadi tidak memeriksa catatannya sendiri", () => {
    const izin = dariSeedTs("KEUANGAN");
    expect(bolehMemverifikasi(izin)).toBe(true);
    expect(bolehMelapor(izin)).toBe(false);
    expect(izin).not.toContain(PERMISSIONS.PAYMENTS_MANAGE);
  });

  it("ADMIN_PENJUALAN mengetik nomor nota, ADMIN_PAJAK nomor faktur pajak — tidak saling tukar", () => {
    expect(bolehMencatatNomorKonsi(dariSeedTs("ADMIN_PENJUALAN"), "NOTA")).toBe(true);
    expect(bolehMencatatNomorKonsi(dariSeedTs("ADMIN_PENJUALAN"), "PAJAK")).toBe(false);
    expect(bolehMencatatNomorKonsi(dariSeedTs("ADMIN_PAJAK"), "PAJAK")).toBe(true);
    expect(bolehMencatatNomorKonsi(dariSeedTs("ADMIN_PAJAK"), "NOTA")).toBe(false);
    expect(dariSeedTs("ADMIN_PAJAK")).toContain(PERMISSIONS.TAX_INVOICES_MANAGE);
  });

  it("admin penjualan dan admin pajak tidak membuka arsip piutang (brief: hanya konsinyasi)", () => {
    expect(bolehMembacaArsip(dariSeedTs("ADMIN_PENJUALAN"))).toBe(false);
    expect(bolehMembacaArsip(dariSeedTs("ADMIN_PAJAK"))).toBe(false);
  });

  it("pemeriksaan awal SQL menghitung persis gabungan izin ketiga peran", () => {
    const m = /SELECT COUNT\(\*\) FROM Permission WHERE code IN \(([^)]*)\)\) = (\d+)/.exec(sqlPeran);
    expect(m).not.toBeNull();
    const gabungan = urut(PERAN.flatMap(dariSeedTs));
    expect(urut(kodeDalam(m![1]))).toEqual(gabungan);
    expect(Number(m![2])).toBe(gabungan.length);
  });
});

describe("izin hasil pemecahan 2026-11-01", () => {
  it("setiap kode punya baris Permission di seed.ts dan di berkas SQL produksi", () => {
    for (const kode of KODE_PECAHAN) {
      expect(seedTs, kode).toContain(`code: "${kode}"`);
      expect(sqlIzin, kode).toContain(`WHERE NOT EXISTS (SELECT 1 FROM \`Permission\` WHERE \`code\` = '${kode}')`);
    }
  });

  it("hanya periksa pembayaran yang diwariskan ke pemegang izin lama; persetujuan tidak", () => {
    const warisan = [...sqlIzin.matchAll(/p_ada\.`code` = '([a-z_:]+)'\s*CROSS JOIN `Permission` p\s*WHERE p\.`code` (?:IN \(([^)]*)\)|= '([a-z_:]+)')/g)];
    const diwariskan = warisan.flatMap((m) => (m[2] ? kodeDalam(m[2]) : [m[3]]));
    expect(diwariskan.filter((k) => (KODE_PECAHAN as string[]).includes(k))).toEqual([PERMISSIONS.PAYMENTS_VERIFY]);
  });

  it("setiap kode persetujuan hasil pemecahan ditandai persetujuan di Peran & izin", () => {
    const persetujuan = KODE_PECAHAN.filter((k) => k !== PERMISSIONS.PAYMENTS_VERIFY
      && k !== PERMISSIONS.CONSIGNMENT_NOTE_NUMBER && k !== PERMISSIONS.CONSIGNMENT_TAX_NUMBER);
    for (const kode of persetujuan) expect(penjelasanIzin(kode)?.persetujuan, kode).toBe(true);
    for (const kode of [PERMISSIONS.PAYMENTS_VERIFY, PERMISSIONS.CONSIGNMENT_NOTE_NUMBER, PERMISSIONS.CONSIGNMENT_TAX_NUMBER]) {
      expect(penjelasanIzin(kode)?.persetujuan, kode).toBeUndefined();
    }
  });
});
