import { prisma } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { PPN_BAWAAN } from "@/lib/finance/pajak/ppn";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { daftarkanSumberSapuan, type DokumenTanpaJurnal, type OpsiCariSapuan } from "@/lib/finance/sapuan/registri";
import { barisKlaim, barisRetur, peranPotongan, SUMBER_LAPANGAN, type SumberLapangan } from "./aturan";
import { bacaBahanRetur } from "./jurnal";
import { postingJurnalLapanganAman } from "./tertunda";

/*
 * Pencari "dokumen lapangan tanpa jurnal" untuk sapuan terjadwal (registri
 * `lib/finance/sapuan/registri.ts`) dan layar Rekonsiliasi piutang. Setiap
 * pencari menghormati `sejak`/`sampai`/`batas`, tidak pernah menyapu sebelum
 * tanggal mulai buku besar (dokumen sebelum itu masuk saldo awal), dan
 * mengembalikan [] bila tanggal mulai belum ditetapkan.
 *
 * "Tanpa jurnal" = belum punya jurnal GENERASI PERTAMA (sourceId = id dokumen).
 * Jurnal bergenerasi yang sudah ada tetapi tertinggal dari keadaan dokumennya
 * diselaraskan oleh kait pasca-commit dan tombol "Selaraskan" di layar
 * rekonsiliasi, bukan oleh sapuan ini.
 */

const HALAMAN = 100;

type Kandidat = { id: string; tanggal: Date; label: string };

/** Ambil kandidat per halaman sampai `batas` dokumen tanpa jurnal terkumpul. */
async function kumpulkan(
  sourceType: SumberLapangan,
  opsi: OpsiCariSapuan,
  halaman: (lewati: number, ambil: number, sejak: Date) => Promise<Kandidat[]>,
  saring: (k: Kandidat[]) => Promise<Kandidat[]> = async (k) => k,
): Promise<DokumenTanpaJurnal[]> {
  const mulai = await readGlCutover();
  if (!mulai || opsi.batas <= 0) return [];
  const sejak = opsi.sejak.getTime() < mulai.getTime() ? mulai : opsi.sejak;
  if (sejak.getTime() > opsi.sampai.getTime()) return [];
  const hasil: DokumenTanpaJurnal[] = [];
  for (let lewati = 0; hasil.length < opsi.batas; lewati += HALAMAN) {
    const kandidat = await halaman(lewati, HALAMAN, sejak);
    if (kandidat.length === 0) break;
    const berjurnal = new Set(
      (
        await prisma.journal.findMany({
          where: { sourceType, sourceId: { in: kandidat.map((k) => k.id) } },
          select: { sourceId: true },
        })
      ).map((j) => j.sourceId),
    );
    for (const k of await saring(kandidat.filter((k) => !berjurnal.has(k.id)))) {
      hasil.push({ id: k.id, tanggal: k.tanggal, label: k.label });
      if (hasil.length >= opsi.batas) break;
    }
    if (kandidat.length < HALAMAN) break;
  }
  return hasil;
}

export function cariNotaTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  return kumpulkan(SUMBER_LAPANGAN.NOTA, opsi, async (lewati, ambil, sejak) =>
    (
      await prisma.fieldSalesDelivery.findMany({
        where: { invoiceDate: { gte: sejak, lte: opsi.sampai }, order: { orderType: "PUTUS" } },
        orderBy: [{ invoiceDate: "asc" }, { id: "asc" }],
        skip: lewati,
        take: ambil,
        select: { id: true, docNo: true, invoiceDate: true },
      })
    ).map((d) => ({ id: d.id, tanggal: d.invoiceDate, label: d.docNo })),
  );
}

export function cariKlaimTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  const nilaiPerKlaim = new Map<string, boolean>();
  return kumpulkan(
    SUMBER_LAPANGAN.BKM,
    opsi,
    async (lewati, ambil, sejak) => {
      const rows = await prisma.paymentClaim.findMany({
        where: { status: "TERVERIFIKASI", verifiedAt: { gte: sejak, lte: opsi.sampai }, store: { termsType: { not: "KONSI" } } },
        orderBy: [{ verifiedAt: "asc" }, { id: "asc" }],
        skip: lewati,
        take: ambil,
        select: {
          id: true,
          docNo: true,
          verifiedAt: true,
          method: true,
          storeId: true,
          receivedAmount: true,
          deductions: { select: { amount: true, storeReturnId: true, deductionType: { select: { postingRole: true, pkpOnly: true } } } },
        },
      });
      for (const k of rows) {
        const baris = barisKlaim({
          terverifikasi: true,
          cara: k.method,
          diterima: Number(k.receivedAmount),
          storeId: k.storeId,
          potongan: k.deductions.map((p) => ({ nilai: Number(p.amount), retur: p.storeReturnId !== null, peran: peranPotongan(p.deductionType) })),
        });
        nilaiPerKlaim.set(k.id, baris.length > 0);
      }
      return rows.map((k) => ({ id: k.id, tanggal: k.verifiedAt!, label: k.docNo }));
    },
    async (k) => k.filter((x) => nilaiPerKlaim.get(x.id)),
  );
}

export function cariReturTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  return kumpulkan(
    SUMBER_LAPANGAN.RETUR,
    opsi,
    async (lewati, ambil, sejak) =>
      (
        await prisma.warehouseReturn.findMany({
          where: { status: "FINAL", finalisedAt: { gte: sejak, lte: opsi.sampai } },
          orderBy: [{ finalisedAt: "asc" }, { id: "asc" }],
          skip: lewati,
          take: ambil,
          select: { id: true, noNri: true, finalisedAt: true },
        })
      ).map((n) => ({ id: n.id, tanggal: n.finalisedAt!, label: n.noNri })),
    // Bernilai dan bukan toko konsinyasi (retur konsinyasi = jurnal konsinyasi).
    async (k) => {
      const tetap: Kandidat[] = [];
      for (const x of k) {
        const b = await bacaBahanRetur(prisma, x.id);
        if (!b || b.konsinyasi) continue;
        const sasaran = barisRetur({
          konsinyasi: false,
          storeId: b.storeId,
          tanggal: b.tanggal,
          // PPN tidak mengubah ada/tidaknya baris; bawaan cukup untuk menyaring.
          pengaturanPpn: PPN_BAWAAN,
          nilai: b.nilai,
          stokLayak: b.stokLayak,
          nilaiRusak: b.rusak,
        });
        if (sasaran.length > 0) tetap.push(x);
      }
      return tetap;
    },
  );
}

export function cariTukarTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  return kumpulkan(SUMBER_LAPANGAN.TUKAR, opsi, async (lewati, ambil, sejak) =>
    (
      await prisma.storeExchange.findMany({
        where: { status: "SELESAI", completedAt: { gte: sejak, lte: opsi.sampai } },
        orderBy: [{ completedAt: "asc" }, { id: "asc" }],
        skip: lewati,
        take: ambil,
        select: { id: true, docNo: true, completedAt: true },
      })
    ).map((d) => ({ id: d.id, tanggal: d.completedAt!, label: d.docNo })),
  );
}

/**
 * Hasil untuk registri sapuan (`GenerateAutoJournalResult`). Kegagalan yang
 * tidak punya kode di tipe itu (akun bukan daun, biaya stok tidak ditemukan,
 * galat) SUDAH dicatat sebagai `JOURNAL_PENDING` oleh `postingJurnalLapanganAman`,
 * lalu dilempar supaya runner mencatatnya per dokumen — tidak pernah dipetakan
 * ke kode lain yang artinya berbeda.
 */
async function postingSapuan(sumber: SumberLapangan, id: string, olehUserId: string): Promise<GenerateAutoJournalResult> {
  const r = await postingJurnalLapanganAman(sumber, id, olehUserId);
  if (r.ok) return r.journalId ? { ok: true, journalId: r.journalId, created: r.created } : { ok: false, code: "NOTHING_TO_POST" };
  switch (r.code) {
    case "UNMAPPED_ROLE":
      return { ok: false, code: "UNMAPPED_ROLE", ...(r.role ? { role: r.role } : {}) };
    case "UNBALANCED":
      return { ok: false, code: "UNBALANCED" };
    case "NOTHING_TO_POST":
    case "BELUM_BERLAKU":
    case "GL_CUTOVER_NOT_CONFIGURED":
      return { ok: false, code: "NOTHING_TO_POST" };
    default:
      throw new Error(`Jurnal ${sumber} ${id} gagal: ${r.code}${r.detail ? ` (${r.detail})` : ""}`);
  }
}

daftarkanSumberSapuan({
  sourceType: SUMBER_LAPANGAN.NOTA,
  label: "Nota tagihan putus",
  cariTanpaJurnal: cariNotaTanpaJurnal,
  posting: (id, olehUserId) => postingSapuan(SUMBER_LAPANGAN.NOTA, id, olehUserId),
});

daftarkanSumberSapuan({
  sourceType: SUMBER_LAPANGAN.BKM,
  label: "Pelunasan piutang (BKM)",
  cariTanpaJurnal: cariKlaimTanpaJurnal,
  posting: (id, olehUserId) => postingSapuan(SUMBER_LAPANGAN.BKM, id, olehUserId),
});

daftarkanSumberSapuan({
  sourceType: SUMBER_LAPANGAN.RETUR,
  label: "Retur toko (NRI)",
  cariTanpaJurnal: cariReturTanpaJurnal,
  posting: (id, olehUserId) => postingSapuan(SUMBER_LAPANGAN.RETUR, id, olehUserId),
});

daftarkanSumberSapuan({
  sourceType: SUMBER_LAPANGAN.TUKAR,
  label: "Tukar barang",
  cariTanpaJurnal: cariTukarTanpaJurnal,
  posting: (id, olehUserId) => postingSapuan(SUMBER_LAPANGAN.TUKAR, id, olehUserId),
});
