import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, getRequiredPermission } from "@/lib/rbac";
import { getNotificationHref } from "@/lib/notifications/navigation";
import { bolehMelapor, bolehMembacaArsip, bolehMemverifikasi, bolehMencatatNomorKonsi } from "@/lib/receivables/izin";
import {
  DESKRIPSI_PERAN_BAWAAN,
  IZIN_PERSETUJUAN,
  PERSETUJUAN_BAWAAN_PERAN_KANTOR,
  penjelasanIzin,
} from "./penjelasan-izin";

/**
 * Tiga peran kantor (keputusan pemilik 2026-11-01): KEUANGAN, ADMIN_PENJUALAN,
 * ADMIN_PAJAK. Isinya ditulis TIGA kali — `seed.ts` (basis data uji),
 * `seed-office-roles-permissions.sql` (produksi MariaDB, dijalankan tangan), dan
 * salinan PostgreSQL lokalnya `postgres/seed-office-roles-permissions.sql` — dan
 * tidak ada yang membandingkannya selain tes ini. Juga dijaga di sini: izin
 * persetujuan bawaan tiap peran persis yang diputuskan pemilik
 * (`PERSETUJUAN_BAWAAN_PERAN_KANTOR`, kosong kecuali retur pembeli SPG untuk
 * ADMIN_PENJUALAN), dan setiap izin hasil pemecahan benar-benar punya baris
 * `Permission` (izin tanpa baris tidak bisa diberikan di Peran & izin).
 */

const PRISMA = path.resolve(__dirname, "../../../../packages/db/prisma");
const seedTs = readFileSync(path.join(PRISMA, "seed.ts"), "utf8");
const sqlPeran = readFileSync(path.join(PRISMA, "seed-office-roles-permissions.sql"), "utf8");
const sqlPeranPg = readFileSync(path.join(PRISMA, "postgres", "seed-office-roles-permissions.sql"), "utf8");
const sqlIzin = readFileSync(path.join(PRISMA, "seed-max-features-permissions.sql"), "utf8");
const sqlIzin1102 = readFileSync(path.join(PRISMA, "seed-owner-2026-11-02-permissions.sql"), "utf8");
const sqlIzin1102Pg = readFileSync(path.join(PRISMA, "postgres", "seed-owner-2026-11-02-permissions.sql"), "utf8");
const sqlIzin1102b = readFileSync(path.join(PRISMA, "seed-owner-2026-11-02b-permissions.sql"), "utf8");
const sqlIzin1102bPg = readFileSync(path.join(PRISMA, "postgres", "seed-owner-2026-11-02b-permissions.sql"), "utf8");

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

function dariSql(peran: Peran, teks = sqlPeran, berkas = "seed-office-roles-permissions.sql"): string[] {
  const m = new RegExp(`WHERE r\\.name = '${peran}'\\s*AND p\\.code IN \\(([^)]*)\\)`).exec(teks);
  if (!m) throw new Error(`daftar izin ${peran} tidak ditemukan di ${berkas}`);
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

      it("salinan PostgreSQL memberi izin yang sama, keterangan yang sama, dan bukan peran sistem", () => {
        expect(urut(dariSql(peran, sqlPeranPg, "postgres/seed-office-roles-permissions.sql"))).toEqual(urut(izin));
        expect(new RegExp(`'${peran}', '([^']*)', false,`).exec(sqlPeranPg)?.[1]).toBe(DESKRIPSI_PERAN_BAWAAN[peran]);
      });

      it("izin persetujuan bawaannya persis yang diputuskan pemilik, tidak lebih", () => {
        const persetujuan = izin.filter((k) => (IZIN_PERSETUJUAN as readonly string[]).includes(k));
        expect(urut(persetujuan)).toEqual(urut([...PERSETUJUAN_BAWAAN_PERAN_KANTOR[peran]]));
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

  it("pemeriksaan awal salinan PostgreSQL juga menghitung persis gabungan izin ketiga peran", () => {
    const m = /SELECT COUNT\(\*\) FROM "Permission" WHERE code IN \(([^)]*)\)\s*\)\s*<> (\d+)/.exec(sqlPeranPg);
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

  it("pewarisan periksa pembayaran hanya sekali — pada run yang membuat baris payments:verify", () => {
    const penanda = sqlIzin.indexOf("SET @payments_verify_is_new");
    expect(penanda).toBeGreaterThan(-1);
    expect(penanda).toBeLessThan(sqlIzin.indexOf("'payments:verify', 'payments', 'verify'"));
    expect(sqlIzin).toMatch(/p_ada\.`code` = 'journals:manage'[\s\S]*?WHERE p\.`code` = 'payments:verify'\s*AND @payments_verify_is_new = 1/);
  });
});

/*
 * Izin baru keputusan pemilik 2026-11-02. Barisnya di produksi dibuat berkas sendiri
 * (`seed-owner-2026-11-02-permissions.sql`), bukan seed-max-features-permissions.sql: berkas itu
 * dijalankan sekali, dan menjalankannya ulang memberi lagi tautan turunan yang mungkin sudah dicabut.
 */
describe("izin keputusan pemilik 2026-11-02", () => {
  const KODE_1102 = [PERMISSIONS.SPG_RETURNS_APPROVE, PERMISSIONS.JUBELIO_PRICES_CONFIRM];

  it("setiap kode punya baris Permission di seed.ts, di berkas SQL produksi, dan di salinan PostgreSQL-nya", () => {
    for (const kode of KODE_1102) {
      expect(seedTs, kode).toContain(`code: "${kode}"`);
      expect(sqlIzin1102, kode).toContain(`WHERE NOT EXISTS (SELECT 1 FROM \`Permission\` WHERE \`code\` = '${kode}')`);
      expect(sqlIzin1102Pg, kode).toContain(`WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = '${kode}')`);
      expect(sqlIzin, kode).not.toContain(`'${kode}'`);
    }
  });

  it("keduanya izin persetujuan; retur pembeli dibuka lewat Awasi SPG, konfirmasi harga membuka halamannya sendiri", () => {
    expect(penjelasanIzin(PERMISSIONS.SPG_RETURNS_APPROVE)?.persetujuan).toBe(true);
    expect(penjelasanIzin(PERMISSIONS.SPG_RETURNS_APPROVE)?.butuh).toBe(PERMISSIONS.SPG_SALES_VIEW);
    expect(penjelasanIzin(PERMISSIONS.JUBELIO_PRICES_CONFIRM)?.persetujuan).toBe(true);
    expect(penjelasanIzin(PERMISSIONS.JUBELIO_PRICES_CONFIRM)?.butuh).toBeUndefined();
    expect(penjelasanIzin(PERMISSIONS.JUBELIO_PRICES_CONFIRM)?.halaman).toEqual(["/backoffice/jubelio/harga"]);
  });

  it("pengecualian pemilik: ADMIN_PENJUALAN retur pembeli SPG, KEUANGAN bayar gaji & komisi SPG (Q9); konfirmasi harga Jubelio tetap hanya admin", () => {
    expect(PERSETUJUAN_BAWAAN_PERAN_KANTOR).toEqual({
      KEUANGAN: [PERMISSIONS.SPG_COMMISSION_PAY],
      ADMIN_PENJUALAN: [PERMISSIONS.SPG_RETURNS_APPROVE],
      ADMIN_PAJAK: [],
    });
    for (const daftar of Object.values(PERSETUJUAN_BAWAAN_PERAN_KANTOR)) {
      for (const kode of daftar) expect(IZIN_PERSETUJUAN, kode).toContain(kode);
    }
    for (const peran of PERAN) expect(dariSeedTs(peran), peran).not.toContain(PERMISSIONS.JUBELIO_PRICES_CONFIRM);
  });

  it("berkas produksinya hanya menautkan ADMIN, dan ADMIN_PENJUALAN untuk retur pembeli SPG saja", () => {
    const peran = [...sqlIzin1102.matchAll(/r\.`name` = '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(urut(peran)).toEqual(["ADMIN", "ADMIN_PENJUALAN"]);
    expect(sqlIzin1102).toMatch(/r\.`name` = 'ADMIN_PENJUALAN'\s*AND p\.`code` = 'spg_returns:approve'\s*AND @spg_returns_approve_is_new = 1/);
  });

  it("tautan bawaan ADMIN_PENJUALAN hanya sekali — pada run yang membuat baris spg_returns:approve", () => {
    const penanda = sqlIzin1102.indexOf("SET @spg_returns_approve_is_new");
    expect(penanda).toBeGreaterThan(-1);
    expect(penanda).toBeLessThan(sqlIzin1102.indexOf("'spg_returns:approve', 'spg_returns', 'approve'"));
    const penandaPg = sqlIzin1102Pg.indexOf("AS spg_returns_baru");
    expect(penandaPg).toBeGreaterThan(-1);
    expect(penandaPg).toBeLessThan(sqlIzin1102Pg.indexOf("'spg_returns:approve', 'spg_returns', 'approve'"));
    expect(sqlIzin1102Pg).toMatch(/r\.name = 'ADMIN_PENJUALAN'\s*AND p\.code = 'spg_returns:approve'\s*AND \(SELECT spg_returns_baru FROM/);
  });

  it("berkas peran kantor menuntut baris spg_returns:approve sebelum menulis, di kedua salinan", () => {
    expect(sqlPeran).toContain("seed-owner-2026-11-02-permissions.sql");
    expect(sqlPeranPg).toContain("seed-owner-2026-11-02-permissions.sql");
    const pre = /SELECT COUNT\(\*\) FROM Permission WHERE code IN \(([^)]*)\)\) = (\d+)/.exec(sqlPeran);
    expect(kodeDalam(pre![1])).toContain(PERMISSIONS.SPG_RETURNS_APPROVE);
  });
});

/*
 * Izin baru dari jawaban pemilik putaran 4 (2026-11-02 malam, P22–P88). Barisnya di produksi dibuat
 * berkas sendiri (`seed-owner-2026-11-02b-permissions.sql`), dengan alasan yang sama seperti berkas
 * 2026-11-02: berkas sekali-jalan yang lama memberi lagi tautan turunan bila dijalankan ulang.
 */
describe("izin keputusan pemilik putaran 4 (2026-11-02b)", () => {
  const PERSETUJUAN_1102B: string[] = [
    PERMISSIONS.STORE_RETURNS_DECIDE_SHORTFALL,
    PERMISSIONS.VENDOR_BILLS_DECIDE_PRICE,
    PERMISSIONS.GOODS_RECEIPTS_CONFIRM_NO_PO,
    PERMISSIONS.SPG_SCHEDULES_APPROVE,
  ];
  const KERJA_1102B: string[] = [
    PERMISSIONS.DELIVERIES_CANCEL_NOTA,
    PERMISSIONS.RECEIVABLES_OVERDUE_REMINDER,
    PERMISSIONS.SPG_ATTENDANCE_RECORD,
    PERMISSIONS.SPG_ATTENDANCE_VERIFY,
  ];
  const KODE_1102B = [...PERSETUJUAN_1102B, ...KERJA_1102B];

  it("setiap kode punya baris Permission di seed.ts, di berkas SQL produksinya, dan di salinan PostgreSQL-nya — tidak di berkas sekali-jalan lama", () => {
    for (const kode of KODE_1102B) {
      expect(seedTs, kode).toContain(`code: "${kode}"`);
      expect(sqlIzin1102b, kode).toContain(`WHERE NOT EXISTS (SELECT 1 FROM \`Permission\` WHERE \`code\` = '${kode}')`);
      expect(sqlIzin1102bPg, kode).toContain(`WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE code = '${kode}')`);
      expect(sqlIzin, kode).not.toContain(`'${kode}'`);
      expect(sqlIzin1102, kode).not.toContain(`'${kode}'`);
    }
  });

  it("empat izin persetujuan (bawaannya hanya admin); empat izin kerja kantor bukan persetujuan", () => {
    for (const kode of PERSETUJUAN_1102B) expect(penjelasanIzin(kode)?.persetujuan, kode).toBe(true);
    for (const kode of KERJA_1102B) expect(penjelasanIzin(kode)?.persetujuan, kode).toBeUndefined();
    for (const peran of PERAN) {
      for (const kode of PERSETUJUAN_1102B) expect(dariSeedTs(peran), `${peran} ${kode}`).not.toContain(kode);
    }
  });

  it("bawaan pemilik: Admin Penjualan membatalkan nota bernota dan memasukkan catatan check-in; Keuangan memeriksanya, menerima pengingat jatuh tempo, dan membayar gaji SPG", () => {
    const keuangan = dariSeedTs("KEUANGAN");
    const penjualan = dariSeedTs("ADMIN_PENJUALAN");
    expect(penjualan).toContain(PERMISSIONS.DELIVERIES_CANCEL_NOTA);
    expect(penjualan).toContain(PERMISSIONS.SPG_ATTENDANCE_RECORD);
    expect(keuangan).toContain(PERMISSIONS.RECEIVABLES_OVERDUE_REMINDER);
    expect(keuangan).toContain(PERMISSIONS.SPG_ATTENDANCE_VERIFY);
    expect(keuangan).toContain(PERMISSIONS.SPG_COMMISSION_PAY);
    // Yang memasukkan catatan check-in bukan yang memeriksanya (P61a: "admin keuangan saja yang memeriksa").
    expect(penjualan).not.toContain(PERMISSIONS.SPG_ATTENDANCE_VERIFY);
    expect(keuangan).not.toContain(PERMISSIONS.SPG_ATTENDANCE_RECORD);
    expect(dariSeedTs("ADMIN_PAJAK").filter((k) => KODE_1102B.includes(k))).toEqual([]);
  });

  it("Keuangan membuka Komisi SPG dengan izin bayar saja, tanpa layar SPG lain (P28)", () => {
    expect(dariSeedTs("KEUANGAN")).not.toContain(PERMISSIONS.SPG_SALES_VIEW);
    expect(penjelasanIzin(PERMISSIONS.SPG_COMMISSION_PAY)?.butuh).toBeUndefined();
    expect(penjelasanIzin(PERMISSIONS.SPG_COMMISSION_PAY)?.halaman).toContain("/backoffice/komisi-spg");
    // Peta rute hanya bisa satu izin; halamannya memagari dirinya sendiri.
    expect(getRequiredPermission("/backoffice/komisi-spg")).toBeNull();
    expect(getRequiredPermission("/backoffice/komisi-spg/catatan-hadir")).toBeNull();
  });

  it("izin bawaan Keuangan tidak menjanjikan layar SPG yang ditolak P28 (register penjualan, barang hilang, mutasi)", () => {
    // P28 menanyakan "register penjualan, barang hilang, mutasi"; jawabannya "Keuangan hanya halaman
    // Komisi SPG". Penjelasan izin yang mencantumkan halaman itu untuk kode bawaan Keuangan berarti
    // menjanjikan tombol yang tidak bisa ia capai — mis. memeriksa uang klaim ekspedisi di Barang hilang.
    const layarSpgLain = ["/backoffice/spg-sales", "/backoffice/barang-hilang", "/backoffice/spg-transfers"];
    const dibuka = dariSeedTs("KEUANGAN").flatMap((kode) => penjelasanIzin(kode)?.halaman ?? []);
    expect(dibuka.filter((r) => layarSpgLain.some((l) => r === l || r.startsWith(`${l}/`)))).toEqual([]);
  });

  it("menerima pengingat jatuh tempo terpisah dari mengubah ambangnya (P48, Q14)", () => {
    expect(getRequiredPermission("/backoffice/settings/piutang")).toBe(PERMISSIONS.RECEIVABLES_MANAGE);
    expect(penjelasanIzin(PERMISSIONS.RECEIVABLES_OVERDUE_REMINDER)?.butuh).toBe(PERMISSIONS.RECEIVABLES_VIEW);
    expect(penjelasanIzin(PERMISSIONS.RECEIVABLES_OVERDUE_REMINDER)?.halaman).toEqual([]);
  });

  /*
   * Lonceng nota tagihan putus yang dibatalkan atau dikoreksi (P25, P34, P41a) sampai ke Keuangan
   * (`payments:verify`) dan ke admin pajak (`tax_invoices:manage`). Tautannya harus terbuka bagi mereka
   * dengan izin bawaannya: rincian pesanan butuh `field_sales_orders:view`, yang tidak dipegang keduanya,
   * jadi ketukannya dulu dipentalkan ke /backoffice.
   */
  it.each<[Peran, string, string]>([
    ["KEUANGAN", PERMISSIONS.PAYMENTS_VERIFY, "DELIVERY_NOTA_VOIDED"],
    ["KEUANGAN", PERMISSIONS.PAYMENTS_VERIFY, "DELIVERY_NOTA_CORRECTED"],
    ["ADMIN_PAJAK", PERMISSIONS.TAX_INVOICES_MANAGE, "TAX_INVOICE_NOTA_CHANGED"],
  ])("%s (penerima %s) bisa membuka tautan lonceng %s", (peran, penerima, jenis) => {
    const izin = dariSeedTs(peran);
    expect(izin).toContain(penerima);
    for (const data of [{ orderId: "fso-1", deliveryId: "d-1", docNo: "DLV/2026/0001" }, { orderId: "fso-1" }, {}]) {
      const href = getNotificationHref(jenis, data);
      expect(href, jenis).not.toBeNull();
      const wajib = getRequiredPermission(href!.split(/[?#]/)[0]);
      expect(wajib, href!).not.toBeNull();
      expect(izin, `${jenis} → ${href} butuh ${wajib}`).toContain(wajib);
    }
  });

  it("berkas produksinya hanya menautkan ADMIN, ADMIN_PENJUALAN, dan KEUANGAN", () => {
    const peran = [...sqlIzin1102b.matchAll(/r\.`name` = '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(urut(peran)).toEqual(["ADMIN", "ADMIN_PENJUALAN", "KEUANGAN"]);
  });

  it.each([
    ["ADMIN_PENJUALAN", "deliveries:cancel_nota", "cancel_nota_is_new", "cancel_nota_baru"],
    ["ADMIN_PENJUALAN", "spg_attendance:record", "attendance_record_is_new", "attendance_record_baru"],
    ["KEUANGAN", "receivables:overdue_reminder", "overdue_reminder_is_new", "overdue_reminder_baru"],
    ["KEUANGAN", "spg_attendance:verify", "attendance_verify_is_new", "attendance_verify_baru"],
    ["KEUANGAN", "spg_commission:pay", "spg_schedules_approve_is_new", "spg_schedules_approve_baru"],
  ])("tautan bawaan %s → %s hanya sekali, pada run yang membuat barisnya", (peran, kode, penanda, penandaPg) => {
    expect(sqlIzin1102b).toMatch(new RegExp(`r\\.\`name\` = '${peran}'\\s*AND p\\.\`code\` = '${kode}'\\s*AND @${penanda} = 1`));
    expect(sqlIzin1102bPg).toMatch(new RegExp(`r\\.name = '${peran}'\\s*AND p\\.code = '${kode}'\\s*AND \\(SELECT ${penandaPg} FROM`));
  });

  it("setiap penanda ditangkap SEBELUM baris izinnya dibuat", () => {
    const PENANDA: [string, string][] = [
      ["cancel_nota_is_new", "deliveries:cancel_nota"],
      ["overdue_reminder_is_new", "receivables:overdue_reminder"],
      ["return_shortfall_is_new", "store_returns:decide_shortfall"],
      ["spg_schedules_approve_is_new", "spg_schedules:approve"],
      ["attendance_record_is_new", "spg_attendance:record"],
      ["attendance_verify_is_new", "spg_attendance:verify"],
    ];
    for (const [penanda, kode] of PENANDA) {
      const [modul, aksi] = kode.split(":");
      const tangkap = sqlIzin1102b.indexOf(`SET @${penanda}`);
      expect(tangkap, penanda).toBeGreaterThan(-1);
      expect(tangkap, penanda).toBeLessThan(sqlIzin1102b.indexOf(`'${kode}', '${modul}', '${aksi}'`));
    }
    const tangkapPg = sqlIzin1102bPg.indexOf("CREATE TEMP TABLE izin_pemilik_2026_11_02b");
    expect(tangkapPg).toBeGreaterThan(-1);
    expect(tangkapPg).toBeLessThan(sqlIzin1102bPg.indexOf('INSERT INTO "Permission"'));
  });

  it("pemecahan P22: setiap pemegang receivables:decide_bearer ikut memegang store_returns:decide_shortfall, sekali saja", () => {
    expect(sqlIzin1102b).toMatch(
      /p_ada\.`code` = 'receivables:decide_bearer'\s*CROSS JOIN `Permission` p\s*WHERE p\.`code` = 'store_returns:decide_shortfall'\s*AND @return_shortfall_is_new = 1/,
    );
    expect(sqlIzin1102bPg).toMatch(
      /p_ada\.code = 'receivables:decide_bearer'\s*CROSS JOIN "Permission" p\s*WHERE p\.code = 'store_returns:decide_shortfall'\s*AND \(SELECT return_shortfall_baru FROM/,
    );
  });

  it("berkas peran kantor menuntut baris izin kerja baru sebelum menulis, di kedua salinan", () => {
    expect(sqlPeran).toContain("seed-owner-2026-11-02b-permissions.sql");
    expect(sqlPeranPg).toContain("seed-owner-2026-11-02b-permissions.sql");
    const pre = /SELECT COUNT\(\*\) FROM Permission WHERE code IN \(([^)]*)\)\) = (\d+)/.exec(sqlPeran);
    for (const kode of KERJA_1102B) expect(kodeDalam(pre![1]), kode).toContain(kode);
    expect(kodeDalam(pre![1])).toContain(PERMISSIONS.SPG_COMMISSION_PAY);
  });

  it("pemeriksaan akhir berkas peran kantor menampilkan izin persetujuan baru, tetapi tidak bayar gaji SPG pada KEUANGAN", () => {
    for (const teks of [sqlPeran, sqlPeranPg]) {
      const cek = teks.slice(teks.lastIndexOf("SELECT r.name AS peran"));
      for (const kode of PERSETUJUAN_1102B) expect(cek, kode).toContain(`'${kode}'`);
      expect(cek).toContain("'spg_commission:pay'");
      expect(cek).toMatch(/AND NOT \(r\.name = 'KEUANGAN' AND p\.code = 'spg_commission:pay'\)/);
    }
  });
});
