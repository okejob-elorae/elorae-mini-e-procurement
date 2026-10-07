import { prisma, Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import {
  batasPotongNota,
  hitungSisaPiutang,
  returTerpakaiMelebihi,
  sisaBolehDilunasi,
  STATUS_KLAIM_HIDUP,
  tertahanPiutang,
  type StatusKlaim,
} from './rules';
import { PILIH_POTONGAN, potonganRetur } from './deductions';
import { idBebanDariCatatan, penandaBebanRetur } from './penanda-beban';
import { catatJejak, JEJAK } from './jejak';
import { giroMenahanVerifikasi, STATUS_GIRO } from './giro';

/**
 * Penulis piutang — satu-satunya tempat kolom `outstanding` boleh berubah.
 *
 * Aturannya: sisa TIDAK PERNAH diketik dan TIDAK PERNAH dikurangi bertahap.
 * Setiap kali ada yang menyentuh sebuah piutang — klaim diverifikasi, ditolak,
 * dibatalkan, atau returnya berubah — nilainya dihitung ulang dari nol.
 *
 * Pengurangan bertahap terlihat lebih hemat, tapi menyimpang begitu satu klaim
 * dibatalkan atau sebuah retur berubah, dan penyimpangan itu tidak terlihat
 * sampai ada yang menagih ke tempat yang salah.
 */

type Klien = typeof prisma | Prisma.TransactionClient;

const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Sisa satu piutang dihitung dari nol, TANPA menyimpannya — beserta bagian
 * sisa yang hanya ditahan Aturan 2 (`tertahanPiutang`).
 *
 * `null` berarti piutangnya tidak ada.
 */
export async function bacaSisaDanTahanan(
  client: Klien,
  receivableId: string,
): Promise<{ sisa: number; tertahan: number } | null> {
  const piutang = await client.receivable.findUnique({
    where: { id: receivableId },
    select: {
      amount: true,
      paidBeforeImport: true,
      claimLinks: {
        select: {
          settledAmount: true,
          paymentClaim: {
            select: {
              status: true,
              invoiceAmount: true,
              deductions: { select: PILIH_POTONGAN },
            },
          },
        },
      },
    },
  });
  if (!piutang) return null;

  const klaimList = piutang.claimLinks.map((link) => ({
    status: link.paymentClaim.status as StatusKlaim,
    nilaiFaktur: angka(link.paymentClaim.invoiceAmount),
    potonganRetur: potonganRetur(link.paymentClaim.deductions),
    nilaiDilunasiPiutangIni: angka(link.settledAmount),
  }));
  return {
    sisa: hitungSisaPiutang(angka(piutang.amount), klaimList, angka(piutang.paidBeforeImport)),
    tertahan: tertahanPiutang(klaimList),
  };
}

/**
 * Sisa satu piutang dihitung dari nol, TANPA menyimpannya.
 *
 * `null` berarti piutangnya tidak ada. Dipakai penjaga yang perlu tahu sisanya
 * sebelum memutuskan apa pun; yang menyimpan adalah `hitungUlangPiutang`.
 */
export async function bacaSisaPiutang(client: Klien, receivableId: string): Promise<number | null> {
  return (await bacaSisaDanTahanan(client, receivableId))?.sisa ?? null;
}

/**
 * Hitung ulang satu piutang dan simpan hasilnya.
 *
 * Mengembalikan sisa yang baru supaya pemanggil bisa melaporkannya tanpa
 * membaca ulang dari database.
 */
export async function hitungUlangPiutang(client: Klien, receivableId: string): Promise<number> {
  return (await hitungUlangPiutangDanTahanan(client, receivableId)).sisa;
}

/**
 * `hitungUlangPiutang` yang juga mengembalikan bagian sisa yang sedang ditahan
 * Aturan 2 — untuk penjaga "BKM lain tidak boleh melunasi yang ditahan".
 */
export async function hitungUlangPiutangDanTahanan(
  client: Klien,
  receivableId: string,
): Promise<{ sisa: number; tertahan: number }> {
  const baca = await bacaSisaDanTahanan(client, receivableId);
  if (baca === null) return { sisa: 0, tertahan: 0 };
  const { sisa } = baca;

  await client.receivable.update({
    where: { id: receivableId },
    data: {
      outstanding: new Prisma.Decimal(sisa),
      // Tanggal lunas ikut dibersihkan kalau sisanya kembali > 0 — misalnya
      // ketika sebuah klaim dibatalkan setelah sempat terverifikasi.
      settledAt: sisa === 0 ? new Date() : null,
    },
  });

  return baca;
}

/** Hitung ulang setiap piutang yang disentuh sebuah klaim. */
export async function hitungUlangDariKlaim(client: Klien, paymentClaimId: string): Promise<void> {
  const links = await client.paymentClaimReceivable.findMany({
    where: { paymentClaimId },
    select: { receivableId: true },
  });
  for (const link of links) {
    await hitungUlangPiutang(client, link.receivableId);
  }
}

export type PemakaianRetur = {
  /**
   * Batas potong NRT ini di seluruh BKM hidup (`batasPotongNota`): nilai
   * klaimnya, atau — sesudah bebannya ditetapkan ke TOKO — fisik + yang
   * ditagih balik lewat faktur beban.
   */
  nilai: number;
  /** Nilai yang diklaim toko di NRT. */
  nilaiKlaim: number;
  /** Jumlah potongan atas NRT ini di seluruh BKM yang masih hidup. */
  terpakai: number;
};

/**
 * Berapa dari setiap nota retur yang sudah dipotongkan di BKM yang masih hidup
 * (DIKIRIM atau TERVERIFIKASI), dan berapa batasnya.
 *
 * Penjaga "satu NRT tidak dipakai melebihi batasnya" hanya utuh kalau dibaca
 * DI DALAM transaksi serializable yang juga menulis potongannya: dua BKM yang
 * membaca pemakaian nol bersamaan lalu sama-sama menulis adalah persis celah
 * yang ditutup, dan basis data sendirilah yang menolak salah satunya.
 *
 * `kecualiKlaimId`/`kecualiPotonganId`: potongan milik dokumen yang sedang
 * diperiksa tidak ikut dihitung — ia ditambahkan sendiri oleh pemanggil.
 * NRT yang tidak ada tidak muncul di peta; pemanggil menolaknya sebagai
 * nota yang tidak ditemukan.
 */
export async function pemakaianRetur(
  client: Klien,
  returIds: string[],
  opsi?: { kecualiKlaimId?: string; kecualiPotonganId?: string },
): Promise<Map<string, PemakaianRetur>> {
  const unik = [...new Set(returIds.filter(Boolean))];
  const hasil = new Map<string, PemakaianRetur>();
  if (unik.length === 0) return hasil;

  const retur = await client.storeReturn.findMany({
    where: { id: { in: unik } },
    select: {
      id: true,
      claimedAmount: true,
      warehouseReturn: { select: { physicalAmount: true, status: true } },
      // Beban yang sudah ditetapkan ke toko menurunkan batas potongnya.
      charges: { where: { bearer: 'TOKO', status: { not: 'TERBUKA' } }, select: { id: true } },
    },
  });

  // Yang ditagih ke toko = faktur bebannya (penanda di catatan). Beban toko
  // tanpa faktur berarti tidak ada yang ditagih: toko tidak memotong lebih dari
  // barang yang sampai.
  const idBebanToko = retur.flatMap((r) => r.charges.map((c) => c.id));
  const ditagih = new Map<string, number>();
  if (idBebanToko.length > 0) {
    const faktur = await client.receivable.findMany({
      where: { source: 'MANUAL', OR: idBebanToko.map((id) => ({ note: { contains: penandaBebanRetur(id) } })) },
      select: { amount: true, note: true },
    });
    for (const f of faktur) {
      const id = idBebanDariCatatan(f.note);
      if (id) ditagih.set(id, (ditagih.get(id) ?? 0) + angka(f.amount));
    }
  }

  for (const r of retur) {
    const nri = r.warehouseReturn;
    const nilaiKlaim = angka(r.claimedAmount);
    hasil.set(r.id, {
      nilai: batasPotongNota({
        nilaiKlaim,
        nilaiFisik: nri && nri.status === 'FINAL' ? angka(nri.physicalAmount) : null,
        bebanTokoDitagih: r.charges.length > 0 ? r.charges.reduce((s, c) => s + (ditagih.get(c.id) ?? 0), 0) : null,
      }),
      nilaiKlaim,
      terpakai: 0,
    });
  }

  const potongan = await client.paymentClaimDeduction.findMany({
    where: {
      storeReturnId: { in: unik },
      paymentClaim: { status: { in: [...STATUS_KLAIM_HIDUP] } },
      ...(opsi?.kecualiKlaimId ? { paymentClaimId: { not: opsi.kecualiKlaimId } } : {}),
      ...(opsi?.kecualiPotonganId ? { id: { not: opsi.kecualiPotonganId } } : {}),
    },
    select: { storeReturnId: true, amount: true },
  });
  for (const p of potongan) {
    const u = p.storeReturnId ? hasil.get(p.storeReturnId) : undefined;
    if (u) u.terpakai += angka(p.amount);
  }
  return hasil;
}

/**
 * Nota retur pertama yang akan terpakai melebihi batasnya (`PemakaianRetur.nilai`)
 * kalau potongan baru ini ditambahkan, atau `null` kalau semuanya muat. `baru` boleh memuat NRT
 * yang sama lebih dari sekali — dijumlahkan.
 */
export async function returYangMelebihi(
  client: Klien,
  baru: { storeReturnId: string | null | undefined; nilai: number }[],
  opsi?: { kecualiKlaimId?: string; kecualiPotonganId?: string },
): Promise<string | null> {
  const perNota = new Map<string, number>();
  for (const b of baru) {
    if (!b.storeReturnId) continue;
    perNota.set(b.storeReturnId, (perNota.get(b.storeReturnId) ?? 0) + b.nilai);
  }
  if (perNota.size === 0) return null;
  const dipakai = await pemakaianRetur(client, [...perNota.keys()], opsi);
  for (const [id, nilai] of perNota) {
    const u = dipakai.get(id);
    // NRT yang tidak ada (penunjuk menggantung) dilewati di sini: pembuatan BKM
    // dan penautan ulang sudah menolaknya lebih dulu sebagai "tidak ditemukan",
    // dan pada BKM lama Aturan 2 menahannya penuh (`potonganRetur`). Menolaknya
    // "terpakai" justru salah alamat dan mengunci transfer yang sah.
    if (!u) continue;
    if (returTerpakaiMelebihi(u.nilai, u.terpakai, nilai)) return id;
  }
  return null;
}

export type HasilKoreksi =
  | { ok: true; piutangDihitungUlang: number }
  | {
      ok: false;
      alasan:
        | 'TIDAK_DITEMUKAN'
        | 'SUDAH_DIBATALKAN'
        | 'ALASAN_WAJIB'
        | 'RETUR_BEDA_TOKO'
        | 'RETUR_TERPAKAI';
    };

/**
 * Batalkan klaim yang salah catat.
 *
 * BUKAN penolakan. Menolak berarti keuangan melihat dan uangnya tidak ada;
 * membatalkan berarti klaimnya sendiri keliru — salah faktur, salah nominal,
 * salah tautan retur. Sebelum ini hanya penolakan yang ada, jadi membetulkan
 * salah ketik menuntut seseorang mencatat pernyataan palsu tentang rekening.
 *
 * Barisnya TIDAK dihapus: ia satu-satunya tempat kekeliruan dan koreksinya
 * sama-sama terlihat. Piutangnya dihitung ulang, jadi yang sempat ditahan atau
 * dilepas oleh klaim ini kembali seperti semula.
 */
export async function batalkanKlaim(input: {
  paymentClaimId: string;
  alasan: string;
  olehUserId: string;
}): Promise<HasilKoreksi> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  return runSerializable(async (tx) => {
    const klaim = await tx.paymentClaim.findUnique({
      where: { id: input.paymentClaimId },
      select: { id: true, docNo: true, status: true, verifyNote: true },
    });
    if (!klaim) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (klaim.status === 'DIBATALKAN') {
      return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
    }

    await tx.paymentClaim.update({
      where: { id: klaim.id },
      data: {
        status: 'DIBATALKAN',
        verifiedById: input.olehUserId,
        verifiedAt: new Date(),
        verifyNote: input.alasan.trim(),
      },
    });

    const links = await tx.paymentClaimReceivable.findMany({
      where: { paymentClaimId: klaim.id },
      select: { receivableId: true },
    });
    for (const l of links) await hitungUlangPiutang(tx, l.receivableId);

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KLAIM_DIBATALKAN,
      entityType: 'PaymentClaim',
      entityId: klaim.id,
      changes: { before: { status: klaim.status }, after: { status: 'DIBATALKAN' } },
      metadata: { docNo: klaim.docNo, piutangDihitungUlang: links.length },
      reason: input.alasan,
    });

    return { ok: true as const, piutangDihitungUlang: links.length };
  });
}

/**
 * Tautkan ulang sebuah potongan ke nota retur — atau lepaskan tautannya.
 *
 * Tanpa ini, potongan yang menunjuk nota retur yang sudah tidak ada menahan
 * uang SELAMANYA dan tidak ada satu layar pun yang bisa membetulkannya.
 * Penjagaannya benar — uangnya ditahan, bukan lepas — tapi tanpa pintu keluar
 * ia berubah jadi jebakan.
 *
 * Mengubah tautan mengubah berapa yang ditahan, jadi piutangnya dihitung ulang
 * dan alasannya wajib.
 */
export async function tautkanUlangPotongan(input: {
  deductionId: string;
  storeReturnId: string | null;
  alasan: string;
  olehUserId: string;
}): Promise<HasilKoreksi> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  // Serializable: penjaga pemakaian NRT di bawah membaca lalu menulis, dan
  // hanya utuh kalau basis data menolak penulis kedua yang membaca bersamaan.
  return runSerializable(async (tx) => {
    const potongan = await tx.paymentClaimDeduction.findUnique({
      where: { id: input.deductionId },
      select: {
        id: true,
        name: true,
        amount: true,
        storeReturnId: true,
        paymentClaim: { select: { id: true, docNo: true, storeId: true, status: true } },
      },
    });
    if (!potongan) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

    if (input.storeReturnId) {
      const retur = await tx.storeReturn.findUnique({
        where: { id: input.storeReturnId },
        select: { storeId: true },
      });
      // Nota retur toko lain tidak boleh memotong pembayaran toko ini — itu
      // memindahkan pengurang dari satu tagihan ke tagihan lain.
      if (!retur) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      if (retur.storeId !== potongan.paymentClaim.storeId) {
        return { ok: false as const, alasan: 'RETUR_BEDA_TOKO' as const };
      }
      // Menautkan ulang tidak boleh menjadi jalan memakai NRT melebihi nilainya.
      // Potongan pada BKM yang sudah ditolak/dibatalkan tidak memakai apa pun.
      const hidup = (STATUS_KLAIM_HIDUP as readonly string[]).includes(potongan.paymentClaim.status);
      if (
        hidup &&
        (await returYangMelebihi(
          tx,
          [{ storeReturnId: input.storeReturnId, nilai: angka(potongan.amount) }],
          { kecualiPotonganId: potongan.id },
        ))
      ) {
        return { ok: false as const, alasan: 'RETUR_TERPAKAI' as const };
      }
    }

    await tx.paymentClaimDeduction.update({
      where: { id: potongan.id },
      data: { storeReturnId: input.storeReturnId },
    });

    const links = await tx.paymentClaimReceivable.findMany({
      where: { paymentClaimId: potongan.paymentClaim.id },
      select: { receivableId: true },
    });
    for (const l of links) await hitungUlangPiutang(tx, l.receivableId);

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.POTONGAN_DITAUTKAN,
      entityType: 'PaymentClaimDeduction',
      entityId: potongan.id,
      changes: {
        before: { storeReturnId: potongan.storeReturnId },
        after: { storeReturnId: input.storeReturnId },
      },
      metadata: { docNo: potongan.paymentClaim.docNo, potongan: potongan.name },
      reason: input.alasan,
    });

    return { ok: true as const, piutangDihitungUlang: links.length };
  });
}

export type HasilVerifikasi =
  | { ok: true; sisaBaru: number[] }
  | {
      ok: false;
      alasan:
        | 'TIDAK_DITEMUKAN'
        | 'SUDAH_DIPUTUSKAN'
        | 'ALASAN_WAJIB'
        | 'GIRO_BELUM_CAIR'
        | 'BUKAN_GIRO_MENUNGGU'
        | 'PEMERIKSA_SAMA'
        | 'MELEBIHI_SISA'
        | 'RETUR_DITAHAN'
        | 'RETUR_TERPAKAI';
    };

/**
 * Verifikasi atau tolak sebuah klaim pembayaran.
 *
 * Inilah satu-satunya pintu tempat piutang boleh berkurang. Seluruh perubahan
 * berjalan dalam satu transaksi: kalau perhitungan ulang gagal, status klaim
 * ikut batal — supaya tidak pernah ada klaim yang tercatat terverifikasi
 * sementara piutangnya masih penuh.
 *
 * Giro lewat pintu yang SAMA, tidak di sebelahnya. Klaim giro yang masih
 * menunggu tidak bisa diverifikasi biasa: bilyetnya ada, uangnya belum —
 * Aturan 1 berlaku lagi. Yang membukanya hanya `giro: 'CAIR'`, yang menyetel
 * status giro dan memverifikasi klaim dalam transaksi ini juga, sehingga tidak
 * pernah ada giro yang tercatat cair sementara piutangnya masih penuh.
 */
export async function putuskanKlaim(input: {
  paymentClaimId: string;
  keputusan: 'TERVERIFIKASI' | 'DITOLAK';
  olehUserId: string;
  catatan?: string | null;
  /**
   * Hasil kliring bilyet giro. `CAIR` hanya bersama `TERVERIFIKASI`,
   * `DITOLAK` hanya bersama `DITOLAK`.
   */
  giro?: 'CAIR' | 'DITOLAK';
}): Promise<HasilVerifikasi> {
  if (
    (input.giro === 'CAIR' && input.keputusan !== 'TERVERIFIKASI') ||
    (input.giro === 'DITOLAK' && input.keputusan !== 'DITOLAK')
  ) {
    // Kesalahan pemanggil, bukan masukan pengguna — tidak ada tombol yang bisa
    // menyusun pasangan ini.
    throw new Error(`putuskanKlaim: giro ${input.giro} tidak cocok dengan ${input.keputusan}`);
  }
  // Menolak tanpa alasan membuat sales tidak tahu harus membetulkan apa, dan
  // itu persis kebocoran informasi yang program ini dibuat untuk menutup.
  if (input.keputusan === 'DITOLAK' && !input.catatan?.trim()) {
    return { ok: false, alasan: 'ALASAN_WAJIB' };
  }

  return runSerializable(async (tx) => {
    const klaim = await tx.paymentClaim.findUnique({
      where: { id: input.paymentClaimId },
      select: {
        id: true,
        docNo: true,
        status: true,
        verifyNote: true,
        giroStatus: true,
        salesmanId: true,
        createdById: true,
      },
    });
    if (!klaim) return { ok: false, alasan: 'TIDAK_DITEMUKAN' as const };
    if (klaim.status !== 'DIKIRIM') return { ok: false, alasan: 'SUDAH_DIPUTUSKAN' as const };

    /*
     * Pemisahan tugas: yang melaporkan atau mencatatkan BKM tidak boleh
     * memutuskannya — berlaku juga untuk admin. Kalau pelapor bisa mengesahkan
     * laporannya sendiri, Aturan 1 ("klaim bukan lunas") runtuh: tidak ada mata
     * kedua yang mencocokkan klaim dengan mutasi rekening.
     */
    if (input.olehUserId === klaim.salesmanId || input.olehUserId === klaim.createdById) {
      return { ok: false, alasan: 'PEMERIKSA_SAMA' as const };
    }

    if (input.giro) {
      if (klaim.giroStatus !== STATUS_GIRO.MENUNGGU) {
        return { ok: false, alasan: 'BUKAN_GIRO_MENUNGGU' as const };
      }
    } else if (input.keputusan === 'TERVERIFIKASI' && giroMenahanVerifikasi(klaim.giroStatus)) {
      return { ok: false, alasan: 'GIRO_BELUM_CAIR' as const };
    }

    if (input.keputusan === 'TERVERIFIKASI') {
      /*
       * Diperiksa ULANG saat verifikasi, di dalam transaksi serializable.
       * Pembuatan BKM hanya membandingkan dengan sisa dari klaim yang SUDAH
       * terverifikasi, jadi dua BKM tertunda bisa sama-sama melunasi seluruh
       * faktur. Dulu verifikasi kedua dijepit diam-diam ke nol — keuangan
       * mengira dua transfer tercatat, padahal satu tidak mengurangi apa pun.
       */
      const tautan = await tx.paymentClaimReceivable.findMany({
        where: { paymentClaimId: klaim.id },
        select: { receivableId: true, settledAmount: true },
      });
      for (const t of tautan) {
        const baca = await bacaSisaDanTahanan(tx, t.receivableId);
        if (baca === null) continue;
        if (angka(t.settledAmount) > baca.sisa) {
          return { ok: false, alasan: 'MELEBIHI_SISA' as const };
        }
        /*
         * Bagian sisa yang hanya ditahan potongan retur BKM lain yang sudah
         * terverifikasi lepas sendiri begitu returnya beres. Melunasinya lagi
         * di sini membuat toko membayarnya dua kali (KEPUTUSAN SEMENTARA
         * PEMILIK 2026-10-06). Dibaca ulang di transaksi serializable ini.
         */
        if (angka(t.settledAmount) > sisaBolehDilunasi(baca.sisa, baca.tertahan)) {
          return { ok: false, alasan: 'RETUR_DITAHAN' as const };
        }
      }

      // Satu NRT tidak boleh terpakai melebihi nilainya di seluruh BKM hidup —
      // menjaga juga BKM lama yang tercatat sebelum penjaga pembuatan ada.
      const potonganNota = await tx.paymentClaimDeduction.findMany({
        where: { paymentClaimId: klaim.id, storeReturnId: { not: null } },
        select: { storeReturnId: true, amount: true },
      });
      if (
        await returYangMelebihi(
          tx,
          potonganNota.map((p) => ({ storeReturnId: p.storeReturnId, nilai: angka(p.amount) })),
          { kecualiKlaimId: klaim.id },
        )
      ) {
        return { ok: false, alasan: 'RETUR_TERPAKAI' as const };
      }
    }

    const sekarang = new Date();
    // Compare-and-swap pada status: sales bisa menarik BKM-nya sendiri tepat saat
    // ini (`batalkanKlaimSendiri`). `updateMany` Prisma memilih id dulu lalu
    // memperbarui menurut id saja — syarat status TIDAK diperiksa ulang saat
    // menulis — jadi penjaga ini hanya utuh karena transaksinya serializable:
    // basis data sendiri yang menolak salah satu dari dua penulis bersamaan.
    const ubah = await tx.paymentClaim.updateMany({
      where: { id: klaim.id, status: 'DIKIRIM' },
      data: {
        status: input.keputusan,
        verifiedById: input.olehUserId,
        verifiedAt: sekarang,
        verifyNote: input.catatan?.trim() || null,
        ...(input.giro
          ? {
              giroStatus: input.giro,
              ...(input.giro === 'CAIR' ? { giroSettledAt: sekarang } : {}),
            }
          : {}),
      },
    });
    if (ubah.count === 0) return { ok: false, alasan: 'SUDAH_DIPUTUSKAN' as const };

    const links = await tx.paymentClaimReceivable.findMany({
      where: { paymentClaimId: klaim.id },
      select: { receivableId: true },
    });
    const sisaBaru: number[] = [];
    for (const link of links) {
      sisaBaru.push(await hitungUlangPiutang(tx, link.receivableId));
    }

    /*
     * Keputusan ini bisa dibalik lewat basis data, dan barisnya hanya menyimpan
     * keadaan terakhir. Pasangan sebelum/sesudah di sini adalah satu-satunya
     * tempat keputusan yang tergantikan masih bisa dibaca.
     */
    await catatJejak(tx, {
      userId: input.olehUserId,
      action:
        input.keputusan === 'TERVERIFIKASI' ? JEJAK.KLAIM_DIVERIFIKASI : JEJAK.KLAIM_DITOLAK,
      entityType: 'PaymentClaim',
      entityId: klaim.id,
      changes: {
        before: {
          status: klaim.status,
          verifyNote: klaim.verifyNote,
          ...(input.giro ? { giroStatus: klaim.giroStatus } : {}),
        },
        after: {
          status: input.keputusan,
          verifyNote: input.catatan?.trim() || null,
          ...(input.giro ? { giroStatus: input.giro } : {}),
        },
      },
      // `giro` membedakan keputusan kliring dari keputusan atas mutasi rekening
      // biasa — keduanya keputusan klaim yang sama, lewat pintu yang sama.
      metadata: {
        docNo: klaim.docNo,
        piutangDihitungUlang: links.length,
        ...(input.giro ? { giro: input.giro } : {}),
      },
      reason: input.catatan,
    });

    return { ok: true as const, sisaBaru };
  });
}
