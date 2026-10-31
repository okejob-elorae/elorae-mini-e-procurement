import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { PPN_BAWAAN, type PengaturanPpn } from "@/lib/finance/pajak/ppn";

/*
 * Bug 5 uji akuntansi 2: faktur piutang yang diketik manual atau diimpor dan
 * bertanggal sejak tanggal mulai buku besar tidak pernah dijurnal, jadi subbuku
 * piutang ≠ buku besar (Toko Sinar Jaya −4.250.000, Butik Anggrek −2.220.000).
 *
 * Lewat AKSI dan PENULIS ASLI (faktur manual, impor, pembatalan impor) terhadap
 * basis data sungguhan, termasuk kait pasca-commit. Yang ditiru: sesi, pemetaan
 * akun (ke akun milik tes ini), tanggal mulai buku besar, pengaturan PPN, dan
 * notifikasi. Pengguna, toko, dan akun milik tes sendiri; faktur bertanggal
 * 2002; semua baris dihapus lewat `seededId()`/`seededIds()`.
 */

const h = vi.hoisted(() => ({
  akun: new Map<string, string>(),
  mulai: new Date("2002-01-01T00:00:00+07:00") as Date | null,
  ppn: null as unknown as PengaturanPpn,
  sesi: null as unknown as { user: { id: string; permissions: string[] } },
}));

vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: vi.fn(async (role: string) => {
      const id = h.akun.get(role);
      if (!id) throw new m.UnmappedRoleError(role);
      return id;
    }),
  };
});
vi.mock("@/lib/finance/sales/sweep", async (asli) => ({
  ...(await asli<typeof import("@/lib/finance/sales/sweep")>()),
  readGlCutover: vi.fn(async () => h.mulai),
}));
vi.mock("@/lib/finance/pajak/ppn-pengaturan", () => ({ bacaPengaturanPpn: vi.fn(async () => h.ppn) }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { batalkanImporAction, buatFakturManualAction, simpanImporAction } from "@/app/actions/receivable-import";
import { cariInfoDokumen } from "@/app/backoffice/finance/journals/_sumber/info-dokumen";
import { kunciDokumen } from "@/app/backoffice/finance/journals/_sumber/tautan";
import { sumberSapuanTerdaftar } from "@/lib/finance/sapuan/semua";
import { JEJAK } from "@/lib/receivables/jejak";
import type { BarisImpor } from "@/lib/receivables/impor/baris";
import { penandaBebanRetur } from "@/lib/receivables/penanda-beban";
import { SUMBER_LAPANGAN } from "./aturan";
import { selaraskanJurnalFaktur } from "./jurnal";
import { rekonsiliasiPiutangToko } from "./rekonsiliasi-queries";
import { cariFakturTanpaJurnal } from "./sapuan-faktur";
import { postingJurnalLapanganAman } from "./tertunda";

// Kait pasca-commit dimatikan di bawah vitest kecuali dinyalakan (lihat `kait.ts`); tes ini memang menguji kaitnya.
process.env.JURNAL_LAPANGAN_KAIT_UJI = "1";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `UJFKT-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);
const TAHUN = 2002;
const NON_PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };
const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP", tarifPersen: 12, pakaiDppNilaiLain: true, hargaJualTermasukPpn: true, berlakuSejak: null };

const PERAN_UJI: Array<[string, "ASET" | "LIABILITAS" | "PENDAPATAN"]> = [
  ["AR_STORE", "ASET"],
  ["SALES_REVENUE", "PENDAPATAN"],
  ["PPN_KELUARAN", "LIABILITAS"],
];

d("jurnal faktur piutang manual & impor (test bed only)", () => {
  let akunIds: string[] = [];
  let keuanganId = "";
  let periodeLama: string[] = [];
  let tokoId = "";
  let tokoKonsiId = "";
  let piutangIds: string[] = [];
  let jejakIds: string[] = [];
  let urut = 0;

  beforeAll(async () => {
    akunIds = [];
    keuanganId = "";
    periodeLama = (await prisma.accountingPeriod.findMany({ where: { year: TAHUN }, select: { id: true } })).map((p) => p.id);
    h.akun.clear();
    for (const [role, type] of PERAN_UJI) {
      const a = await prisma.chartAccount.create({ data: { code: `${tag}-${role}`, name: `${tag} ${role}`, type, depth: 1 } });
      akunIds.push(a.id);
      h.akun.set(role, a.id);
    }
    keuanganId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-keu@uji.local`, name: `${tag} Keuangan` } })).id;
    h.sesi = { user: { id: keuanganId, permissions: ["receivables:manage"] } };
  });

  afterAll(async () => {
    if (akunIds.length) {
      const jurnal = await prisma.journalLine.findMany({ where: { chartAccountId: { in: seededIds(akunIds) } }, select: { journalId: true } });
      if (jurnal.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds([...new Set(jurnal.map((j) => j.journalId))]) } } });
      await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    }
    const lama = new Set(periodeLama);
    const periode = await prisma.accountingPeriod.findMany({ where: { year: TAHUN }, select: { id: true } });
    const baru = periode.map((p) => p.id).filter((id) => !lama.has(id));
    if (baru.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(baru) } } });
    if (keuanganId) await prisma.user.delete({ where: { id: seededId(keuanganId) } });
  });

  beforeEach(async () => {
    tokoId = "";
    tokoKonsiId = "";
    piutangIds = [];
    jejakIds = [];
    h.mulai = wib(`${TAHUN}-01-01`);
    h.ppn = NON_PKP;
    h.akun.clear();
    PERAN_UJI.forEach(([role], i) => h.akun.set(role, akunIds[i]));
    urut += 1;
    tokoId = (await prisma.store.create({ data: { code: `${tag}-T${urut}`, name: `${tag} Butik ${urut}`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    tokoKonsiId = (await prisma.store.create({ data: { code: `${tag}-K${urut}`, name: `${tag} Konsi ${urut}`, address: "uji", termsType: "KONSI", isActive: true } })).id;
  });

  afterEach(async () => {
    if (akunIds.length) {
      const jurnal = await prisma.journalLine.findMany({ where: { chartAccountId: { in: seededIds(akunIds) } }, select: { journalId: true } });
      if (jurnal.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds([...new Set(jurnal.map((j) => j.journalId))]) } } });
    }
    const sisa = await prisma.receivable.findMany({ where: { storeId: { in: seededIds([tokoId, tokoKonsiId].filter(Boolean)) } }, select: { id: true } });
    const semua = [...new Set([...piutangIds, ...sisa.map((r) => r.id)])];
    const notif = await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING" }, select: { id: true, metadata: true }, orderBy: { createdAt: "desc" }, take: 300 });
    const milik = notif.filter((n) => semua.includes(String((n.metadata as Record<string, unknown> | null)?.docId ?? "")));
    if (milik.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik.map((n) => n.id)) } } });
    const ent = [...semua, ...jejakIds];
    if (ent.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(ent) } } });
    if (semua.length) {
      await prisma.receivableItem.deleteMany({ where: { receivableId: { in: seededIds(semua) } } });
      await prisma.receivable.deleteMany({ where: { id: { in: seededIds(semua) } } });
    }
    if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
    if (tokoKonsiId) await prisma.store.delete({ where: { id: seededId(tokoKonsiId) } });
  });

  async function saldoPeran(id: string): Promise<Record<string, number>> {
    const j = await prisma.journal.findMany({
      where: { sourceType: SUMBER_LAPANGAN.FAKTUR, OR: [{ sourceId: id }, { sourceId: { startsWith: `${id}#` } }] },
      select: { lines: { select: { chartAccountId: true, debit: true, credit: true } } },
    });
    const peranDari = new Map(PERAN_UJI.map(([r], i) => [akunIds[i], r]));
    const hasil: Record<string, number> = {};
    for (const l of j.flatMap((x) => x.lines)) {
      const r = peranDari.get(l.chartAccountId) ?? "?";
      hasil[r] = Math.round(((hasil[r] ?? 0) + Number(l.debit) - Number(l.credit)) * 100) / 100;
    }
    for (const k of Object.keys(hasil)) if (hasil[k] === 0) delete hasil[k];
    return hasil;
  }

  const jumlahGenerasi = (id: string) =>
    prisma.journal.count({ where: { sourceType: SUMBER_LAPANGAN.FAKTUR, OR: [{ sourceId: id }, { sourceId: { startsWith: `${id}#` } }] } });

  async function fakturManual(o: { tanggal: string; nilai: number; storeId?: string }) {
    const invoiceNo = `${tag}/INV/${++urut}`;
    const r = await buatFakturManualAction({ invoiceNo, storeId: o.storeId ?? tokoId, invoiceDate: o.tanggal, dueDate: `${TAHUN}-12-31`, amount: o.nilai });
    const f = await prisma.receivable.findUnique({ where: { invoiceNo }, select: { id: true } });
    if (f) piutangIds.push(f.id);
    return { r, id: f?.id ?? "", invoiceNo };
  }

  function barisImpor(noFaktur: string, nilai: number, sisa: number, tgl: string): BarisImpor {
    return {
      baris: 2,
      noFaktur,
      kodeToko: `${tag}-T${urut}`,
      namaToko: null,
      tglFaktur: wib(tgl),
      jatuhTempo: wib(`${TAHUN}-12-31`),
      nilai,
      sisaTertulis: sisa,
      sales: null,
      sisa,
      masalah: [],
    };
  }

  it("faktur manual sesudah tanggal mulai dijurnal lewat aksinya: DR piutang toko / CR penjualan PUTUS, bertanggal faktur; rekonsiliasi 0", async () => {
    const { r, id } = await fakturManual({ tanggal: `${TAHUN}-03-10`, nilai: 2_220_000 });
    expect(r).toEqual({ ok: true });

    expect(await saldoPeran(id)).toEqual({ AR_STORE: 2_220_000, SALES_REVENUE: -2_220_000 });
    const j = await prisma.journal.findFirstOrThrow({
      where: { sourceType: SUMBER_LAPANGAN.FAKTUR, sourceId: id },
      select: { date: true, description: true, lines: { select: { chartAccountId: true, channel: true, storeId: true } } },
    });
    expect(j.date.toISOString()).toBe(wib(`${TAHUN}-03-10`).toISOString());
    expect(j.description).toContain(`${tag}/INV/`);
    const pendapatan = j.lines.find((l) => l.chartAccountId === h.akun.get("SALES_REVENUE"));
    const piutang = j.lines.find((l) => l.chartAccountId === h.akun.get("AR_STORE"));
    expect(pendapatan).toMatchObject({ channel: "PUTUS", storeId: tokoId });
    expect(piutang?.storeId).toBe(tokoId);

    const rekon = await rekonsiliasiPiutangToko({ storeIds: [tokoId] });
    const b = rekon.baris.find((x) => x.storeId === tokoId);
    expect(b).toMatchObject({ bukuBesar: 2_220_000, modul: 2_220_000, selisih: 0, diLuarJurnal: 0, cocok: true });

    // Dijalankan ulang: idempoten.
    expect(await selaraskanJurnalFaktur(id, keuanganId)).toMatchObject({ ok: true, created: false });
    expect(await jumlahGenerasi(id)).toBe(1);
  });

  it("faktur sebelum tanggal mulai tidak dijurnal (masuk saldo awal); tanpa tanggal mulai tidak ada yang dijurnal", async () => {
    const lama = await fakturManual({ tanggal: `${TAHUN - 1}-12-20`, nilai: 500_000 });
    expect(lama.r).toEqual({ ok: true });
    expect(await jumlahGenerasi(lama.id)).toBe(0);
    expect(await selaraskanJurnalFaktur(lama.id, keuanganId)).toEqual({ ok: false, code: "BELUM_BERLAKU" });

    h.mulai = null;
    const baru = await fakturManual({ tanggal: `${TAHUN}-03-10`, nilai: 500_000 });
    expect(await selaraskanJurnalFaktur(baru.id, keuanganId)).toEqual({ ok: false, code: "GL_CUTOVER_NOT_CONFIGURED" });
    expect(await jumlahGenerasi(baru.id)).toBe(0);
  });

  it("PKP: PPN keluaran dipisah dari nilai faktur, DPP di memo", async () => {
    h.ppn = PKP;
    const { id } = await fakturManual({ tanggal: `${TAHUN}-04-02`, nilai: 1_110_000 });
    expect(await saldoPeran(id)).toEqual({ AR_STORE: 1_110_000, SALES_REVENUE: -1_000_000, PPN_KELUARAN: -110_000 });
    const ppn = await prisma.journalLine.findFirstOrThrow({
      where: { journal: { sourceType: SUMBER_LAPANGAN.FAKTUR, sourceId: id }, chartAccountId: h.akun.get("PPN_KELUARAN") },
      select: { memo: true },
    });
    expect(ppn.memo).toContain("DPP");
  });

  it("impor: dijurnal sebesar sisa saat impor; pembatalan impor membalik jurnalnya dan dokumennya tetap terbaca", async () => {
    const r = await simpanImporAction([
      barisImpor(`${tag}/IMP/001`, 1_250_000, 1_250_000, `${TAHUN}-08-20`),
      barisImpor(`${tag}/IMP/005`, 3_000_000, 1_000_000, `${TAHUN}-08-20`),
    ]);
    expect(r).toMatchObject({ ok: true, hasil: { masuk: 2 } });
    const f = await prisma.receivable.findMany({ where: { storeId: tokoId }, select: { id: true, invoiceNo: true }, orderBy: { invoiceNo: "asc" } });
    piutangIds.push(...f.map((x) => x.id));
    const [satu, lima] = f;
    expect(await saldoPeran(satu.id)).toEqual({ AR_STORE: 1_250_000, SALES_REVENUE: -1_250_000 });
    expect(await saldoPeran(lima.id)).toEqual({ AR_STORE: 1_000_000, SALES_REVENUE: -1_000_000 });
    const rekon = await rekonsiliasiPiutangToko({ storeIds: [tokoId] });
    expect(rekon.baris.find((x) => x.storeId === tokoId)).toMatchObject({ bukuBesar: 2_250_000, modul: 2_250_000, selisih: 0 });

    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { action: JEJAK.FAKTUR_IMPOR, entityId: { in: seededIds(f.map((x) => x.id)) } }, select: { id: true } });
    jejakIds.push(jejak.id);
    expect(await batalkanImporAction(jejak.id, "salah berkas")).toEqual({ ok: true, dihapus: 2 });
    expect(await prisma.receivable.count({ where: { id: { in: seededIds(f.map((x) => x.id)) } } })).toBe(0);
    expect(await saldoPeran(satu.id)).toEqual({});
    expect(await saldoPeran(lima.id)).toEqual({});
    expect(await jumlahGenerasi(satu.id)).toBe(2);

    // Jurnal faktur yang sudah dihapus tetap menunjuk dokumen yang bisa dibaca (bukan "yatim").
    const info = await cariInfoDokumen([{ jenis: SUMBER_LAPANGAN.FAKTUR, id: satu.id }]);
    expect(info.get(kunciDokumen(SUMBER_LAPANGAN.FAKTUR, satu.id))?.nomor).toBe(`${satu.invoiceNo} (impor dibatalkan)`);
  });

  it("nota pengiriman, faktur beban retur, dan toko konsinyasi tidak dijurnal sebagai faktur; pencari sapuan hanya menemukan yang berhak", async () => {
    const dasar = { storeId: tokoId, invoiceDate: wib(`${TAHUN}-05-05`), dueDate: wib(`${TAHUN}-06-05`), amount: 300_000, outstanding: 300_000 };
    const nota = await prisma.receivable.create({ data: { ...dasar, invoiceNo: `${tag}/DLV/${urut}`, source: "DELIVERY" }, select: { id: true } });
    const beban = await prisma.receivable.create({
      data: { ...dasar, invoiceNo: `${tag}/BEBAN/${urut}`, source: "MANUAL", note: `Selisih retur ditanggung toko. ${penandaBebanRetur(`${tag}-c1`)}` },
      select: { id: true },
    });
    const konsi = await prisma.receivable.create({ data: { ...dasar, storeId: tokoKonsiId, invoiceNo: `${tag}/KONSI/${urut}`, source: "MANUAL" }, select: { id: true } });
    const lunasSebelumImpor = await prisma.receivable.create({
      data: { ...dasar, invoiceNo: `${tag}/LUNAS/${urut}`, source: "IMPORT", paidBeforeImport: 300_000, outstanding: 0 },
      select: { id: true },
    });
    const sebelumMulai = await prisma.receivable.create({
      data: { ...dasar, invoiceDate: wib(`${TAHUN - 1}-12-01`), invoiceNo: `${tag}/LAMA/${urut}`, source: "MANUAL" },
      select: { id: true },
    });
    const berhak = await prisma.receivable.create({ data: { ...dasar, invoiceNo: `${tag}/OK/${urut}`, source: "MANUAL" }, select: { id: true } });
    piutangIds.push(nota.id, beban.id, konsi.id, lunasSebelumImpor.id, sebelumMulai.id, berhak.id);

    const opsi = { sejak: wib(`${TAHUN - 1}-01-01`), sampai: wib(`${TAHUN}-12-31`), batas: 500 };
    const ditemukan = (await cariFakturTanpaJurnal(opsi)).map((x) => x.id).filter((id) => piutangIds.includes(id));
    expect(ditemukan).toEqual([berhak.id]);

    for (const id of [nota.id, beban.id, konsi.id, lunasSebelumImpor.id]) {
      const r = await selaraskanJurnalFaktur(id, keuanganId);
      // Bukan kegagalan (tidak menulis JOURNAL_PENDING), dan tidak ada jurnal.
      expect(r.ok ? r.journalId : r.code).toSatisfy((v: unknown) => v === null || v === "BELUM_BERLAKU" || v === "NOTHING_TO_POST");
      expect(await jumlahGenerasi(id)).toBe(0);
    }
    expect(await selaraskanJurnalFaktur(berhak.id, keuanganId)).toMatchObject({ ok: true, created: true });
    expect((await cariFakturTanpaJurnal(opsi)).map((x) => x.id).filter((id) => piutangIds.includes(id))).toEqual([]);

    // Tanpa tanggal mulai, pencari tidak menyapu apa pun.
    h.mulai = null;
    expect((await cariFakturTanpaJurnal(opsi)).filter((x) => piutangIds.includes(x.id))).toEqual([]);
  });

  it("terdaftar di sapuan terjadwal (diimpor `semua.ts`, satu-satunya pintu runner)", () => {
    // Modul tes ini sendiri mengimpor `sapuan-faktur` (mendaftarkannya), jadi registri saja bukan bukti:
    // yang dibuktikan adalah baris impornya di `semua.ts`.
    const semua = readFileSync(resolve(__dirname, "../sapuan/semua.ts"), "utf8");
    expect(semua).toContain(`import "@/lib/finance/lapangan/sapuan-faktur";`);
    expect(sumberSapuanTerdaftar().map((s) => s.sourceType)).toContain(SUMBER_LAPANGAN.FAKTUR);
  });

  it("dua penyelarasan bersamaan tidak menggandakan jurnal", async () => {
    h.mulai = null;
    const { id } = await fakturManual({ tanggal: `${TAHUN}-07-07`, nilai: 750_000 });
    h.mulai = wib(`${TAHUN}-01-01`);
    const hasil = await Promise.all([selaraskanJurnalFaktur(id, keuanganId), selaraskanJurnalFaktur(id, keuanganId)]);
    expect(hasil.every((r) => r.ok)).toBe(true);
    expect(await jumlahGenerasi(id)).toBe(1);
    expect(await saldoPeran(id)).toEqual({ AR_STORE: 750_000, SALES_REVENUE: -750_000 });
  });

  it("peran belum dipetakan: aksinya tetap berhasil, JOURNAL_PENDING bernomor faktur; posting ulang menyelesaikannya", async () => {
    h.akun.delete("SALES_REVENUE");
    const { r, id, invoiceNo } = await fakturManual({ tanggal: `${TAHUN}-09-09`, nilai: 400_000 });
    expect(r).toEqual({ ok: true });
    expect(await jumlahGenerasi(id)).toBe(0);
    const tanda = (await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING" }, select: { id: true, readAt: true, metadata: true }, orderBy: { createdAt: "desc" }, take: 300 })).filter(
      (n) => (n.metadata as Record<string, unknown> | null)?.docId === id,
    );
    expect(tanda).toHaveLength(1);
    expect(tanda[0].metadata).toMatchObject({ kind: "faktur_piutang", reason: "UNMAPPED_ROLE", role: "SALES_REVENUE", docNo: invoiceNo });

    h.akun.set("SALES_REVENUE", akunIds[1]);
    expect(await postingJurnalLapanganAman(SUMBER_LAPANGAN.FAKTUR, id, keuanganId)).toMatchObject({ ok: true, created: true });
    const sesudah = await prisma.adminNotification.findUniqueOrThrow({ where: { id: tanda[0].id }, select: { readAt: true } });
    expect(sesudah.readAt).not.toBeNull();
  });
});
