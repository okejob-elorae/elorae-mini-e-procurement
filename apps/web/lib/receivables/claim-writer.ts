import { Prisma } from '@elorae/db';
import { bentrokPengganti, catatDiganti, periksaKlaimLama, type AlasanPengganti } from './pengganti';
import { runSerializable } from '@/lib/db/tx-retry';
import { bentrokKunciKiriman } from './idempoten';
import { denganNomorUnik } from './nomor';
import { hitungUlangPiutang, returYangMelebihi } from './writer';
import { tanggalWib } from '@/lib/dashboard/hari-wib';
import { catatJejak, JEJAK } from './jejak';
import { periksaGiro, STATUS_GIRO, type AlasanGiro, type GiroSah } from './giro';
import { fotoBolehDipakai } from './foto-pencatat';
import { PERMISSIONS } from '@/lib/rbac';

/**
 * Penulis klaim pembayaran (BKM).
 *
 * BKM adalah laporan sales: "toko sudah transfer sekian". Ia TIDAK mengurangi
 * piutang sepeser pun — Aturan 1. Yang mengurangi hanyalah admin keuangan yang
 * mencocokkannya dengan mutasi rekening, dan itu jalur lain (`putuskanKlaim`).
 *
 * Di sinilah potongan retur ditautkan ke nota returnya. Tautan itu yang membuat
 * Aturan 2 bisa bekerja: tanpa `storeReturnId`, sebuah potongan hanyalah
 * pengurang harga biasa dan tidak pernah ditahan.
 */

type Klien = Prisma.TransactionClient;

const D = (n: number) => new Prisma.Decimal(n);

export type BarisPelunasan = { receivableId: string; nilai: number };
export type BarisPotongan = {
  nama: string;
  nilai: number;
  deductionTypeId?: string | null;
  storeReturnId?: string | null;
  catatan?: string | null;
};

export type AlasanGagalKlaim =
  | 'TANPA_PIUTANG'
  | 'PIUTANG_TIDAK_DITEMUKAN'
  | 'BEDA_TOKO'
  | 'SUDAH_LUNAS'
  | 'MELEBIHI_SISA'
  | 'NILAI_TIDAK_VALID'
  | 'POTONGAN_MELEBIHI'
  | 'RETUR_TIDAK_DITEMUKAN'
  | 'RETUR_BEDA_TOKO'
  | 'RETUR_TERPAKAI'
  | 'FOTO_WAJIB'
  /** Foto `/api/foto/<id>` diunggah orang lain, dan pencatat bukan orang kantor. */
  | 'FOTO_BUKAN_MILIK'
  | 'JENIS_BUTUH_RETUR'
  | 'JENIS_BUTUH_CATATAN'
  | 'JENIS_HANYA_PKP'
  | 'NOMOR_BENTROK'
  | 'KUNCI_DIPAKAI'
  | AlasanPengganti
  | AlasanGiro;

/** Isian bilyet giro dari formulir, sebelum diperiksa. */
export type IsianGiro = {
  nomor: string;
  bank: string;
  tanggalTerbit: Date | null;
  tanggalEfektif: Date | null;
};

/** Nomor BKM berikutnya dalam tahun berjalan. */
async function nomorBerikutnya(tx: Klien, tahun: number): Promise<string> {
  const depan = `BKM/${tahun}/`;
  const terakhir = await tx.paymentClaim.findFirst({
    where: { docNo: { startsWith: depan } },
    orderBy: { docNo: 'desc' },
    select: { docNo: true },
  });
  const urutan = terakhir ? Number(terakhir.docNo.slice(depan.length)) + 1 : 1;
  return `${depan}${String(urutan).padStart(4, '0')}`;
}

/**
 * Catat klaim pembayaran dari sales.
 *
 * Sisa tiap piutang dihitung ulang lebih dulu — kolom `outstanding` tidak
 * dipercaya di sini, sama seperti di seluruh modul. Sebuah faktur yang ternyata
 * sudah lunas ditolak seluruh daftarnya, bukan disaring diam-diam, supaya sales
 * tahu laporannya sudah basi sebelum dikirim.
 */
export async function buatKlaimPembayaran(input: {
  storeId: string;
  salesmanId: string;
  createdById: string;
  claimedTransferAt: Date;
  method: string;
  pelunasan: BarisPelunasan[];
  potongan?: BarisPotongan[];
  transferPhotoUrl?: string | null;
  breakdownPhotoUrl?: string | null;
  collectionNoteId?: string | null;
  /** Kunci kiriman dari antrean offline HP. Laporan dari kantor tidak membawanya. */
  idempotencyKey?: string | null;
  /** Wajib kalau `method` giro; diabaikan untuk cara bayar lain. */
  giro?: IsianGiro | null;
  /**
   * BKM yang digantikan laporan ini ("Laporkan ulang" / "Buat ulang"). Harus
   * sudah ditolak atau dibatalkan, dan belum pernah punya pengganti.
   */
  menggantikanId?: string | null;
  /** Kantor boleh mengganti BKM sales siapa pun; sales hanya miliknya sendiri. */
  lintasPelapor?: boolean;
}): Promise<{ ok: true; id: string; docNo: string } | { ok: false; alasan: AlasanGagalKlaim }> {
  const pelunasan = input.pelunasan.filter((p) => p.nilai > 0);
  if (pelunasan.length === 0) return { ok: false, alasan: 'TANPA_PIUTANG' };

  const potongan = (input.potongan ?? []).filter((p) => p.nama.trim() && p.nilai > 0);
  if ([...pelunasan, ...potongan].some((b) => !Number.isFinite(b.nilai) || b.nilai <= 0)) {
    return { ok: false, alasan: 'NILAI_TIDAK_VALID' };
  }

  /*
   * Foto bukti wajib — bukti transfer, kuitansi tunai yang ditandatangani toko,
   * atau bilyet giro, menurut cara bayarnya. Inilah satu-satunya yang dipegang
   * admin keuangan saat mencocokkan; tanpanya BKM hanya klaim lisan yang tidak
   * bisa diverifikasi maupun dibantah.
   */
  const fotoTransfer = input.transferPhotoUrl?.trim();
  if (!fotoTransfer) return { ok: false, alasan: 'FOTO_WAJIB' };

  /*
   * Giro diperiksa di sini, sebelum transaksi, dengan fungsi yang SAMA dengan
   * formulirnya. Isian giro pada cara bayar lain dibuang: formulir bisa membawa
   * sisa ketikan sebelum cara bayarnya diganti, dan transfer yang ikut
   * berstatus "menunggu cair" tidak akan pernah bisa diverifikasi.
   */
  let giro: GiroSah | null = null;
  if (input.method === 'giro') {
    const periksa = periksaGiro({
      nomor: input.giro?.nomor,
      bank: input.giro?.bank,
      tanggalTerbit: input.giro?.tanggalTerbit,
      tanggalEfektif: input.giro?.tanggalEfektif,
    });
    if (!periksa.ok) return { ok: false, alasan: periksa.alasan };
    giro = periksa.giro;
  }

  const nilaiFaktur = pelunasan.reduce((s, p) => s + p.nilai, 0);
  const totalPotongan = potongan.reduce((s, p) => s + p.nilai, 0);
  // Potongan yang melebihi nilai faktur berarti toko mengirim uang negatif.
  if (totalPotongan > nilaiFaktur) return { ok: false, alasan: 'POTONGAN_MELEBIHI' };

  const kunci = input.idempotencyKey?.trim() || null;

  const simpan = () =>
    denganNomorUnik(() =>
      runSerializable(async (tx) => {
        /*
         * Kiriman ulang dikenali PALING DULU, sebelum sisa piutang diperiksa:
         * fakturnya mungkin sudah diverifikasi lunas sejak kiriman pertama, dan
         * menolaknya "sudah lunas" membuat sales mengira laporannya hilang.
         * Kunci milik sales lain tidak pernah menyerahkan BKM orang itu.
         */
        if (kunci) {
          const ada = await tx.paymentClaim.findUnique({
            where: { idempotencyKey: kunci },
            select: { id: true, docNo: true, salesmanId: true },
          });
          if (ada) {
            return ada.salesmanId === input.salesmanId
              ? { ok: true as const, id: ada.id, docNo: ada.docNo }
              : { ok: false as const, alasan: 'KUNCI_DIPAKAI' as const };
          }
        }

        /*
         * Foto bukti harus unggahan pencatatnya sendiri — kecuali orang kantor
         * (pengelola piutang atau keuangan) yang menyalin foto laporan sales.
         * Tanpa ini bukti transfer sales lain bisa dilaporkan ulang sebagai
         * bukti sendiri. Sesudah kunci kiriman: kiriman ulang dari HP sudah
         * tercatat dan dikembalikan apa adanya.
         */
        const fotoSah = await fotoBolehDipakai(tx, {
          urls: [fotoTransfer, input.breakdownPhotoUrl],
          userId: input.createdById,
          izinKantor: [PERMISSIONS.RECEIVABLES_MANAGE, PERMISSIONS.JOURNALS_MANAGE],
        });
        if (!fotoSah) return { ok: false as const, alasan: 'FOTO_BUKAN_MILIK' as const };

        const lama = input.menggantikanId
          ? await periksaKlaimLama(tx, {
              lamaId: input.menggantikanId,
              salesmanId: input.salesmanId,
              lintasPelapor: input.lintasPelapor,
            })
          : null;
        if (lama && !lama.ok) return { ok: false as const, alasan: lama.alasan };

        const ids = pelunasan.map((p) => p.receivableId);
        const toko = await tx.store.findUnique({
          where: { id: input.storeId },
          select: { isPkp: true },
        });
        const piutang = await tx.receivable.findMany({
          where: { id: { in: ids } },
          select: { id: true, storeId: true },
        });
        if (piutang.length !== ids.length) {
          return { ok: false as const, alasan: 'PIUTANG_TIDAK_DITEMUKAN' as const };
        }
        if (piutang.some((p) => p.storeId !== input.storeId)) {
          return { ok: false as const, alasan: 'BEDA_TOKO' as const };
        }

        for (const baris of pelunasan) {
          const sisa = await hitungUlangPiutang(tx, baris.receivableId);
          if (sisa === 0) return { ok: false as const, alasan: 'SUDAH_LUNAS' as const };
          // Melunasi lebih dari sisanya membuat porsi klaim ini melebihi 100%
          // dan menggeser perhitungan setiap klaim lain atas faktur yang sama.
          if (baris.nilai > sisa) return { ok: false as const, alasan: 'MELEBIHI_SISA' as const };
        }

        /*
         * Aturan yang melekat pada jenis potongan, dipaksa di sini.
         *
         * `DARI_RETUR` menuntut tautan ke nota retur — dan tautan itulah yang
         * membuat Aturan 2 bekerja. Sebelum jenis potongan ada, penautan
         * sepenuhnya bergantung pada ingatan orang yang mengetik, dan sebuah
         * potongan retur yang lupa ditautkan lolos sebagai pengurang biasa yang
         * tidak pernah ditahan.
         */
        const idJenis = [
          ...new Set(potongan.map((p) => p.deductionTypeId).filter((x): x is string => Boolean(x))),
        ];
        if (idJenis.length > 0) {
          const jenis = await tx.deductionType.findMany({
            where: { id: { in: idJenis } },
            select: { id: true, method: true, noteRequired: true, pkpOnly: true },
          });
          const peta = new Map(jenis.map((j) => [j.id, j]));
          for (const p of potongan) {
            const j = p.deductionTypeId ? peta.get(p.deductionTypeId) : undefined;
            if (!j) continue;
            if (j.method === 'DARI_RETUR' && !p.storeReturnId) {
              return { ok: false as const, alasan: 'JENIS_BUTUH_RETUR' as const };
            }
            if (j.noteRequired && !p.catatan?.trim()) {
              return { ok: false as const, alasan: 'JENIS_BUTUH_CATATAN' as const };
            }
            /*
             * PPh 23 hanya boleh dipotongkan toko PKP. Sebelum `Store.isPkp` ada,
             * `pkpOnly` adalah aturan yang tidak menjaga apa pun — tidak ada satu
             * kolom pun yang bisa ditanya, jadi ia hanya kalimat di layar jenis
             * potongan. Potongan pajak yang seharusnya tidak ada mengurangi
             * tagihan diam-diam dan baru ketahuan jauh di belakang.
             */
            if (j.pkpOnly && !toko?.isPkp) {
              return { ok: false as const, alasan: 'JENIS_HANYA_PKP' as const };
            }
          }
        }

        const returIds = [
          ...new Set(potongan.map((p) => p.storeReturnId).filter((x): x is string => Boolean(x))),
        ];
        if (returIds.length > 0) {
          const retur = await tx.storeReturn.findMany({
            where: { id: { in: returIds } },
            select: { id: true, storeId: true },
          });
          if (retur.length !== returIds.length) {
            return { ok: false as const, alasan: 'RETUR_TIDAK_DITEMUKAN' as const };
          }
          // Nota retur toko lain tidak boleh memotong pembayaran toko ini —
          // itu memindahkan pengurang dari satu tagihan ke tagihan lain.
          if (retur.some((r) => r.storeId !== input.storeId)) {
            return { ok: false as const, alasan: 'RETUR_BEDA_TOKO' as const };
          }
          /*
           * Satu nota retur tidak boleh terpotong melebihi nilainya di seluruh
           * BKM yang masih hidup. Dulu yang diperiksa hanya tokonya, dan nota
           * Rp1 jt bisa dipotongkan penuh di dua BKM — toko membayar kurang
           * dua kali untuk barang yang sama. Dibaca di transaksi serializable
           * ini juga, jadi dua BKM yang tiba bersamaan tidak bisa sama-sama lolos.
           */
          if (
            await returYangMelebihi(
              tx,
              potongan.map((p) => ({ storeReturnId: p.storeReturnId, nilai: p.nilai })),
            )
          ) {
            return { ok: false as const, alasan: 'RETUR_TERPAKAI' as const };
          }
        }

        const klaim = await tx.paymentClaim.create({
          data: {
            // Tahun WIB: tanggal transfer disimpan tengah malam WIB, dan di
            // server UTC `getFullYear()` atas 1 Januari WIB masih tahun lalu.
            docNo: await nomorBerikutnya(tx, Number(tanggalWib(input.claimedTransferAt).slice(0, 4))),
            storeId: input.storeId,
            salesmanId: input.salesmanId,
            createdById: input.createdById,
            collectionNoteId: input.collectionNoteId ?? null,
            claimedTransferAt: input.claimedTransferAt,
            method: input.method,
            invoiceAmount: D(nilaiFaktur),
            deductionTotal: D(totalPotongan),
            receivedAmount: D(nilaiFaktur - totalPotongan),
            transferPhotoUrl: fotoTransfer,
            breakdownPhotoUrl: input.breakdownPhotoUrl?.trim() || null,
            idempotencyKey: kunci,
            replacesClaimId: lama ? input.menggantikanId : null,
            status: 'DIKIRIM',
            // Giro BELUM uang: klaimnya DIKIRIM seperti yang lain, dan status
            // giro MENUNGGU menahan verifikasinya sampai bilyetnya cair.
            ...(giro
              ? {
                  giroNo: giro.nomor,
                  giroBank: giro.bank,
                  giroIssueDate: giro.tanggalTerbit,
                  giroEffectiveDate: giro.tanggalEfektif,
                  giroStatus: STATUS_GIRO.MENUNGGU,
                }
              : {}),
            receivableLinks: {
              create: pelunasan.map((p) => ({
                receivableId: p.receivableId,
                settledAmount: D(p.nilai),
              })),
            },
            deductions: {
              create: potongan.map((p) => ({
                name: p.nama.trim(),
                amount: D(p.nilai),
                note: p.catatan?.trim() || null,
                deductionTypeId: p.deductionTypeId ?? null,
                storeReturnId: p.storeReturnId ?? null,
              })),
            },
          },
          select: { id: true, docNo: true },
        });

        /*
         * Piutang TIDAK berkurang di sini. Aturan 1: selama klaim berstatus
         * DIKIRIM, nilai yang diakui nol. Perhitungan ulang tetap dijalankan agar
         * kolom cache-nya konsisten — dan hasilnya memang tidak berubah, yang
         * justru membuktikan aturannya bekerja.
         */
        for (const baris of pelunasan) {
          await hitungUlangPiutang(tx, baris.receivableId);
        }

        await catatJejak(tx, {
          userId: input.createdById,
          action: JEJAK.KLAIM_DIBUAT,
          entityType: 'PaymentClaim',
          entityId: klaim.id,
          changes: {
            after: {
              docNo: klaim.docNo,
              invoiceAmount: nilaiFaktur,
              deductionTotal: totalPotongan,
              receivedAmount: nilaiFaktur - totalPotongan,
            },
          },
          metadata: {
            storeId: input.storeId,
            jumlahFaktur: pelunasan.length,
            ...(lama?.ok ? { menggantikan: input.menggantikanId, menggantikanDocNo: lama.nomor } : {}),
            // Potongan yang tertaut nota retur dicatat terpisah: itulah yang
            // menentukan berapa nanti ditahan, dan tautannya bisa diubah.
            potonganRetur: potongan.filter((p) => p.storeReturnId).length,
            ...(giro
              ? {
                  giroNo: giro.nomor,
                  giroBank: giro.bank,
                  giroEffectiveDate: giro.tanggalEfektif.toISOString(),
                }
              : {}),
          },
        });

        if (lama && input.menggantikanId) {
          await catatDiganti(tx, {
            jenis: 'bkm',
            lamaId: input.menggantikanId,
            baruId: klaim.id,
            nomorBaru: klaim.docNo,
            olehUserId: input.createdById,
          });
        }

        return { ok: true as const, id: klaim.id, docNo: klaim.docNo };
      }),
    );

  try {
    try {
      return await simpan();
    } catch (err) {
      // Kiriman kembarnya menang lebih dulu. Percobaan ini membaca kuncinya
      // yang kini sudah tercatat dan mengembalikan BKM yang sama.
      if (!bentrokKunciKiriman(err)) throw err;
      return await simpan();
    }
  } catch (err) {
    // Dua pengganti untuk BKM lama yang sama tiba bersamaan: yang kalah ditolak.
    if (bentrokPengganti(err)) return { ok: false, alasan: 'SUDAH_DIGANTI' };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, alasan: 'NOMOR_BENTROK' };
    }
    throw err;
  }
}
