'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { bolehMelapor, bolehMengelola } from '@/lib/receivables/izin';
import {
  alihkanBeban,
  batalkanRetur,
  bebanTokoDiNota,
  catatHitunganGudang,
  catatHitunganSusulan,
  catatReturToko,
  jadikanSusulan,
  jodohkanRetur,
  laporHasilCekSelisih,
  lepasPasangan,
  lepasSusulan,
  putuskanBeban,
  tandaiBebanLunas,
  type AlasanGagalRetur,
  type BarisBarang,
  type BarisReturSpg,
  type HasilSelaras,
} from '@/lib/receivables/return-writer';
import { tandaiBebanReturDipotong, tandaiKelebihanReturDikembalikan } from '@/lib/receivables/potong-beban-retur';
import { kurangPerBarang } from '@/lib/receivables/selisih-retur';
import { JENIS_KABAR, kabariPengguna } from '@/lib/notifications/kabar-pengguna';
import { fanOutAdminNotification } from '@/lib/notifications/admin-fanout';
import {
  batalkanReturSendiri,
  pindahkanNriKeToko,
  pindahkanReturKeToko,
  type AlasanKoreksi,
  type GagalKoreksi,
} from '@/lib/receivables/koreksi';
import type { AlasanPengganti } from '@/lib/receivables/pengganti';
import { formatIDR } from '@/lib/sales-orders/format';
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { kaitReturBerubah } from "@/lib/finance/lapangan/kait";
import { kaitPotongSalesRetur } from "@/lib/finance/operasional/kait";

export type KodeAksiRetur =
  | 'TANPA_AKSES'
  | 'TANGGAL_TIDAK_VALID'
  | "TOKO_TIDAK_DIIZINKAN"
  | AlasanGagalRetur
  | AlasanPengganti
  | 'GAGAL';
/** `noNrt` hanya pada `ADA_SELISIH_DITEMUKAN`: nota yang barang selisihnya sedang dikirim balik. */
export type HasilAksiRetur = { ok: true } | { ok: false; kode: KodeAksiRetur; noNrt?: string };

/**
 * Hasil hitungan gudang. Klaim toko baru dikembalikan SESUDAH hitungan
 * tersimpan — layar hitung tidak menampilkannya selama menghitung.
 */
export type HasilHitunganGudang =
  | {
      ok: true;
      noNri: string;
      klaim: { nilai: number; qty: number } | null;
      fisik: { nilai: number; qty: number };
    }
  | { ok: false; kode: KodeAksiRetur };

/** Hasil hitungan barang susulan. Sisa selisihnya baru diperlihatkan sesudah tersimpan. */
export type HasilHitunganSusulan =
  | { ok: true; noNri: string; fisik: { nilai: number; qty: number }; sisaSelisih: number }
  | { ok: false; kode: KodeAksiRetur };

function segarkan() {
  revalidatePath('/backoffice/retur-toko');
  revalidatePath('/backoffice/piutang');
  revalidatePath('/backoffice/pelunasan');
}

/** Layar yang membaca selisih retur dan bebannya — kantor, gudang, dan HP salesman. */
function segarkanSelisih() {
  segarkan();
  revalidatePath('/backoffice/beban-selisih');
  revalidatePath('/backoffice/laporan/komisi-salesman');
  revalidatePath('/gudang-retur');
  revalidatePath('/pwa');
  revalidatePath('/pwa/retur');
  revalidatePath('/pwa/beban');
  revalidatePath('/pwa/piutang');
}

/**
 * Hasil koreksi salah toko. `DIPAKAI_DI_BKM` membawa nomor BKM-nya, supaya
 * layarnya bisa menyebut dokumen mana yang harus dibetulkan dulu.
 */
export type HasilKoreksiRetur =
  | { ok: true }
  | { ok: false; kode: 'TANPA_AKSES' | 'GAGAL' | AlasanKoreksi }
  | { ok: false; kode: 'DIPAKAI_DI_BKM'; docNo: string[] }
  /** Bulan hitungannya sudah dikunci di siklus konsinyasi — layar meminta konfirmasi lalu mengulang. */
  | { ok: false; kode: 'SIKLUS_TERKUNCI'; noKonsi: string[] };

const keHasil = (g: GagalKoreksi): HasilKoreksiRetur =>
  'docNo' in g
    ? { ok: false, kode: g.alasan, docNo: g.docNo }
    : 'noKonsi' in g
      ? { ok: false, kode: g.alasan, noKonsi: g.noKonsi }
      : { ok: false, kode: g.alasan };

/** "YYYY-MM-DD" dibaca sebagai tengah malam WIB, bukan UTC. */
function tanggalWib(teks: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) return null;
  const d = new Date(`${teks}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/*
 * Kabar ke orang lapangan. Semuanya dipanggil SESUDAH transaksinya selesai dan tidak pernah
 * melempar: hitungan dan keputusan beban sudah tersimpan, dan kabar yang gagal tidak boleh
 * membuatnya tampak gagal. Pelaku yang kebetulan penerimanya sendiri tidak dikabari.
 *
 * Rupiah selisih ikut ke HP salesman, juga untuk toko konsinyasi: HP salesman menampilkan konsi
 * lengkap (P18, P18a). HP SPG tidak pernah menerima kabar-kabar ini.
 */

/** Kabar ke pelapor NRT bahwa gudang sudah menghitung fisiknya — dengan selisihnya kalau ada. */
async function kabarReturDihitung(storeReturnId: string, pelakuId: string): Promise<void> {
  try {
    const nota = await prisma.storeReturn.findUnique({
      where: { id: storeReturnId },
      select: {
        noNrt: true,
        salesmanId: true,
        claimedAmount: true,
        store: { select: { name: true, termsType: true } },
        warehouseReturn: { select: { physicalAmount: true, items: { select: { qty: true } } } },
      },
    });
    if (!nota?.salesmanId || !nota.warehouseReturn || nota.salesmanId === pelakuId) return;
    const klaim = Number(nota.claimedAmount);
    const fisik = Number(nota.warehouseReturn.physicalAmount);
    const selisih = klaim - fisik;
    // Nilai toko KONSI tidak pernah sampai ke HP — kabarnya cukup jumlah potong.
    const potong = nota.warehouseReturn.items.reduce((n, i) => n + i.qty, 0);
    await kabariPengguna(nota.salesmanId, {
      jenis: JENIS_KABAR.RETUR_DIHITUNG,
      judul: `Retur ${nota.noNrt} sudah dihitung gudang`,
      isi:
        nota.store.termsType === "KONSI"
          ? `${nota.store.name}${potong > 0 ? ` · ${potong} potong diterima` : ""}`
          : `${nota.store.name} · klaim ${formatIDR(klaim)}, fisik ${formatIDR(fisik)}` +
            (selisih > 0 ? ` · selisih ${formatIDR(selisih)}` : ''),
      data: { returnId: storeReturnId },
    });
  } catch (err) {
    console.error('[kabar] retur dihitung gagal', storeReturnId, err);
  }
}

/**
 * Kabar ke pelapor NRT bahwa kantor memindahkan atau membatalkan notanya — sales
 * tidak boleh mendapati laporannya berubah tanpa diberi tahu.
 */
async function kabarReturDikoreksi(
  storeReturnId: string,
  jenis: 'PINDAH' | 'BATAL',
  alasan: string,
  pelakuId: string,
): Promise<void> {
  try {
    const nota = await prisma.storeReturn.findUnique({
      where: { id: storeReturnId },
      select: { noNrt: true, salesmanId: true, store: { select: { name: true } } },
    });
    if (!nota?.salesmanId || nota.salesmanId === pelakuId) return;
    await kabariPengguna(nota.salesmanId, {
      jenis: jenis === 'PINDAH' ? JENIS_KABAR.RETUR_DIPINDAH_TOKO : JENIS_KABAR.RETUR_DIBATALKAN,
      judul:
        jenis === 'PINDAH'
          ? `Retur ${nota.noNrt} dipindah ke ${nota.store.name}`
          : `Retur ${nota.noNrt} dibatalkan kantor`,
      isi: `Alasan: ${alasan.trim()}`,
      data: { returnId: storeReturnId },
    });
  } catch (err) {
    console.error('[kabar] koreksi retur gagal', storeReturnId, err);
  }
}

/** Kabar ke sales yang ditetapkan menanggung selisih retur. */
async function kabarBebanRetur(chargeId: string, penanggungId: string, alasan: string, pelakuId: string): Promise<void> {
  if (penanggungId === pelakuId) return;
  try {
    const beban = await prisma.returnCharge.findUnique({
      where: { id: chargeId },
      select: {
        amount: true,
        storeReturnId: true,
        store: { select: { name: true } },
        storeReturn: { select: { noNrt: true, store: { select: { name: true } } } },
        warehouseReturn: { select: { noNri: true } },
      },
    });
    if (!beban) return;
    const nomor = beban.storeReturn?.noNrt ?? beban.warehouseReturn?.noNri ?? '';
    const toko = beban.storeReturn?.store.name ?? beban.store?.name ?? '';
    await kabariPengguna(penanggungId, {
      jenis: JENIS_KABAR.RETUR_DIBEBANKAN,
      judul: nomor ? `Selisih retur ${nomor} dibebankan ke Anda` : 'Selisih retur dibebankan ke Anda',
      isi:
        [toko, formatIDR(beban.amount.toString())].filter(Boolean).join(' · ') +
        `. Dipotong dari komisi Anda. Alasan: ${alasan.trim()}`,
      data: beban.storeReturnId ? { chargeId, returnId: beban.storeReturnId } : { chargeId },
    });
  } catch (err) {
    console.error('[kabar] beban retur gagal', chargeId, err);
  }
}

/** Nota, tokonya, dan barang yang masih kurang — bahan kabar selisih ke pemegang toko. */
async function bacaSelisihNota(storeReturnId: string) {
  const nota = await prisma.storeReturn.findUnique({
    where: { id: storeReturnId },
    select: {
      noNrt: true,
      storeId: true,
      store: { select: { name: true, salesmanId: true } },
      items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } },
      warehouseReturn: { select: { status: true, items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } } } },
      followUps: { where: { status: 'FINAL' }, select: { items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } } } },
      charges: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true, amount: true } },
    },
  });
  if (!nota) return null;
  const hitungan = [
    ...(nota.warehouseReturn?.status === 'FINAL' ? nota.warehouseReturn.items : []),
    ...nota.followUps.flatMap((f) => f.items),
  ];
  const pcs = kurangPerBarang(nota.items, hitungan).reduce((n, k) => n + k.qtyKurang, 0);
  return { ...nota, pcs, beban: nota.charges[0] ?? null };
}

/**
 * Kabar ke salesman pemegang toko SEKARANG (P85): selisih baru yang harus ia tanyakan ke toko
 * dan SPG-nya, sisa sesudah barang susulan dihitung, atau selisih yang sudah tertutup.
 */
async function kabarSelisihRetur(
  storeReturnId: string,
  pelakuId: string,
  jenis: 'BARU' | 'SISA' | 'TERTUTUP',
): Promise<void> {
  try {
    const nota = await bacaSelisihNota(storeReturnId);
    const pemegang = nota?.store.salesmanId ?? null;
    if (!nota || !pemegang || pemegang === pelakuId) return;
    const nilai = formatIDR(Number(nota.beban?.amount ?? 0));
    const data = { chargeId: nota.beban?.id ?? '', returnId: storeReturnId, storeId: nota.storeId };
    if (jenis === 'TERTUTUP') {
      await kabariPengguna(pemegang, {
        jenis: JENIS_KABAR.RETUR_DIHITUNG,
        judul: `Selisih retur ${nota.noNrt} tertutup`,
        isi: `${nota.store.name} · barang susulannya sudah dihitung gudang, tidak ada lagi yang kurang.`,
        data: { returnId: storeReturnId },
      });
      return;
    }
    await kabariPengguna(pemegang, {
      jenis: JENIS_KABAR.RETUR_SELISIH_CEK,
      judul: jenis === 'BARU' ? `Retur ${nota.noNrt} kurang — mohon dicek` : `Barang susulan retur ${nota.noNrt} sudah dihitung`,
      isi:
        jenis === 'BARU'
          ? `${nota.store.name} · kurang ${nota.pcs} pcs (${nilai}). Tanyakan ke toko dan SPG; kalau ketemu, kirim balik ke gudang.`
          : `${nota.store.name} · masih kurang ${nota.pcs} pcs (${nilai}) — laporkan lagi.`,
      data,
    });
  } catch (err) {
    console.error('[kabar] selisih retur gagal', storeReturnId, err);
  }
}

/**
 * Kabar ke salesman pemegang toko bahwa selisih retur ditanggung TOKO (P84, keputusan 1
 * 2026-10-29: "sales dikabari untuk menagih kekurangannya"), berubah karena barang susulan, atau
 * dialihkan dari toko. Yang masih harus ditagih dibaca dari BKM yang memotong nota itu
 * (`bebanTokoDiNota`). Saat diputuskan, toko yang BELUM memotong nota returnya tetap dikabarkan —
 * tanpa angka tagihan, karena belum ada yang tertahan: bagian selisihnya baru tidak dikreditkan
 * begitu nota itu dipotong di BKM, dan saat itulah sales menagihnya.
 */
async function kabarBebanTokoRetur(
  storeReturnId: string,
  pelakuId: string,
  jenis: 'DITANGGUNG' | 'BERUBAH' | 'DILEPAS',
  tertahanSebelum = 0,
): Promise<void> {
  try {
    const nota = await prisma.storeReturn.findUnique({
      where: { id: storeReturnId },
      select: {
        noNrt: true,
        storeId: true,
        store: { select: { name: true, salesmanId: true } },
        charges: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true, amount: true } },
      },
    });
    const pemegang = nota?.store.salesmanId ?? null;
    if (!nota || !pemegang || pemegang === pelakuId) return;
    const data = { chargeId: nota.charges[0]?.id ?? '', returnId: storeReturnId, storeId: nota.storeId };
    if (jenis === 'DILEPAS') {
      if (!(tertahanSebelum > 0)) return;
      await kabariPengguna(pemegang, {
        jenis: JENIS_KABAR.RETUR_DITANGGUNG_TOKO,
        judul: `Selisih retur ${nota.noNrt} tidak lagi ditanggung ${nota.store.name}`,
        isi: 'Tidak perlu ditagih lagi ke toko.',
        data,
      });
      return;
    }
    const beban = await bebanTokoDiNota(prisma, storeReturnId);
    if (!(beban.tertahan > 0)) {
      // Toko belum mengambil potongan selisih ini: tidak ada angka untuk ditagih sekarang.
      if (jenis !== 'DITANGGUNG') return;
      const selisih = Number(nota.charges[0]?.amount ?? 0);
      if (!(selisih > 0)) return;
      await kabariPengguna(pemegang, {
        jenis: JENIS_KABAR.RETUR_DITANGGUNG_TOKO,
        judul: `Selisih retur ${nota.noNrt} ditanggung ${nota.store.name}`,
        isi:
          `Selisih ${formatIDR(selisih)}. Toko belum memotong nota retur ini di pembayarannya; kalau nanti ` +
          'dipotong, bagian selisihnya tidak dikurangkan dari tagihannya — tagih saat itu.',
        data,
      });
      return;
    }
    if (jenis === 'DITANGGUNG' && !(beban.tampil > 0)) return;
    await kabariPengguna(pemegang, {
      jenis: JENIS_KABAR.RETUR_DITANGGUNG_TOKO,
      judul: `Selisih retur ${nota.noNrt} ditanggung ${nota.store.name}`,
      isi:
        beban.tampil > 0
          ? `${formatIDR(beban.tampil)} tidak dikurangkan dari tagihannya; tagih saat berkunjung.`
          : 'Barang susulannya sudah dihitung — tidak ada lagi yang perlu ditagih ke toko.',
      data,
    });
  } catch (err) {
    console.error('[kabar] beban toko retur gagal', storeReturnId, err);
  }
}

/** Kabar ke sales penanggung bahwa barang retur ketemu dan bebannya mengecil (atau hapus). */
async function kabarBebanSalesBerkurang(storeReturnId: string, penanggungId: string, pelakuId: string): Promise<void> {
  if (penanggungId === pelakuId) return;
  try {
    const nota = await bacaSelisihNota(storeReturnId);
    if (!nota || !nota.beban) return;
    await kabariPengguna(penanggungId, {
      jenis: JENIS_KABAR.RETUR_DIBEBANKAN,
      judul: `Barang retur ${nota.noNrt} ketemu — beban Anda menjadi ${formatIDR(Number(nota.beban.amount))}`,
      isi: nota.store.name,
      data: { chargeId: nota.beban.id, returnId: storeReturnId },
    });
  } catch (err) {
    console.error('[kabar] beban sales berkurang gagal', storeReturnId, err);
  }
}

/** Kabar sesudah hitungan susulan dipasang atau dilepas, menurut apa yang terjadi pada bebannya. */
async function kabarSesudahSusulan(storeReturnId: string, selaras: HasilSelaras, pelakuId: string): Promise<void> {
  try {
    const { kejadian, sebelum, sesudah, chargeId } = selaras;
    if (kejadian === 'TANPA_HITUNGAN' || kejadian === 'TETAP') return;
    // Tidak ada beban sebelum maupun sesudahnya (mis. susulan yang dilepas dari nota yang tetap
    // tertutup oleh hitungan lainnya): tidak ada yang berubah bagi pemegang toko.
    if (kejadian === 'COCOK' && !sebelum) return;
    if (kejadian === 'BARU') return kabarSelisihRetur(storeReturnId, pelakuId, 'BARU');
    if (!sebelum || sebelum.status === 'TERBUKA') {
      return kabarSelisihRetur(storeReturnId, pelakuId, sesudah && sesudah.amount > 0 ? 'SISA' : 'TERTUTUP');
    }
    if (!chargeId) return;
    const beban = await prisma.returnCharge.findUnique({ where: { id: chargeId }, select: { bearer: true, bearerUserId: true } });
    if (beban?.bearer === 'SALES' && beban.bearerUserId) await kabarBebanSalesBerkurang(storeReturnId, beban.bearerUserId, pelakuId);
    if (beban?.bearer === 'TOKO') await kabarBebanTokoRetur(storeReturnId, pelakuId, 'BERUBAH');
  } catch (err) {
    console.error('[kabar] sesudah susulan gagal', storeReturnId, err);
  }
}

/**
 * Bolehkah orang lapangan ini melaporkan retur untuk toko itu?
 *
 * Tokonya ditetapkan SERVER, tidak pernah dipercaya dari isian HP — termasuk
 * kiriman ulang antrean luring, yang memanggil aksi yang sama:
 * - SPG hanya untuk toko tetapnya (`User.assignedStoreId`);
 * - salesman, selama kunci "hanya toko sendiri" menyala, hanya toko yang ia pegang;
 * - selain itu (kunci mati) toko mana pun, seperti sebelumnya.
 * Kantor (`receivables:manage`) tidak melewati pemeriksaan ini.
 */
async function tokoBolehDilapor(userId: string, storeId: string, tokoTetap: string | null): Promise<boolean> {
  if (tokoTetap) return storeId === tokoTetap;
  if (!(await tokoTerkunci())) return true;
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { salesmanId: true } });
  return toko?.salesmanId === userId;
}

async function butuh(izin: string) {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!hasPermission(session.user.permissions ?? [], izin)) return null;
  return session.user.id;
}

/**
 * Catat klaim retur dari toko (NRT).
 *
 * Boleh dilakukan sales lapangan: dialah yang memegang notanya dan memotretnya.
 * Menghitung fisiknya pekerjaan gudang, dan menetapkan bebannya pekerjaan
 * keuangan — masing-masing izinnya sendiri.
 */
export async function catatReturTokoAction(input: {
  noNrt: string;
  storeId: string;
  claimDate: string;
  deliveryMethod: 'SALES' | 'TOKO' | 'EKSPEDISI';
  claimedAmount?: number;
  items?: BarisBarang[];
  photoUrl?: string | null;
  note?: string;
  /** Dari antrean offline HP: kiriman ulang dengan kunci sama tidak mencatat dua kali. */
  idempotencyKey?: string | null;
  /** Nota batal yang digantikan nota ini ("Laporkan ulang"). */
  menggantikanId?: string | null;
  /** Baris barang dari HP SPG (barang, varian, qty, kondisi) — tanpa harga. */
  barisSpg?: BarisReturSpg[];
  /**
   * Pelapor menyatakan barangnya retur LAIN, bukan barang selisih nota lain yang sedang
   * dikirim balik (penolakan `ADA_SELISIH_DITEMUKAN`).
   */
  returLain?: boolean;
}): Promise<HasilAksiRetur> {
  const session = await auth();
  if (!session?.user?.id || !bolehMelapor(session.user.permissions)) {
    return { ok: false, kode: 'TANPA_AKSES' };
  }
  const userId = session.user.id;
  const kantor = hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE);

  const tanggal = tanggalWib(input.claimDate);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const tokoTetap = kantor ? null : await ambilTokoTetap(userId);
    if (!kantor && !(await tokoBolehDilapor(userId, input.storeId, tokoTetap))) {
      return { ok: false, kode: "TOKO_TIDAK_DIIZINKAN" };
    }
    // SPG: nota dari toko tetapnya, dengan baris dari buku tokonya. Harga dan
    // nama baris disusun penulis dari master — rincian berharga dari HP dibuang.
    const dariSpg = tokoTetap !== null;
    const hasil = await catatReturToko({
      ...input,
      items: dariSpg ? undefined : input.items,
      barisSpg: dariSpg ? input.barisSpg : undefined,
      claimDate: tanggal,
      salesmanId: userId,
      olehUserId: userId,
      // Dari hak akses, sesudah isian HP — HP tidak bisa mengirimnya sendiri.
      lintasPelapor: kantor,
      reportedBySpg: dariSpg,
      returLain: input.returLain === true,
    });
    if (!hasil.ok) {
      return 'noNrt' in hasil ? { ok: false, kode: hasil.alasan, noNrt: hasil.noNrt } : { ok: false, kode: hasil.alasan };
    }
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('catatReturToko gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Catat hitungan fisik gudang (NRI).
 *
 * Dibatasi ke `inventory_opname:count` dan BUKAN ke izin piutang. Seluruh guna
 * retur dua sisi ini adalah bahwa yang mengklaim dan yang menghitung bukan orang
 * yang sama; menyatukan keduanya di satu izin membatalkan gunanya.
 */
export async function catatHitunganGudangAction(input: {
  storeReturnId?: string | null;
  storeId?: string | null;
  receivedAt: string;
  deliveryMethod: 'SALES' | 'TOKO' | 'EKSPEDISI';
  physicalAmount?: number;
  items?: BarisBarang[];
  note?: string;
}): Promise<HasilHitunganGudang> {
  const userId = await butuh(PERMISSIONS.INVENTORY_OPNAME_COUNT);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  const tanggal = tanggalWib(input.receivedAt);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };
  // Tanggal terima boleh mundur (barang datang kemarin, dihitung hari ini),
  // tapi tidak boleh di masa depan: barang yang belum sampai tidak bisa dihitung.
  if (tanggal.getTime() > Date.now()) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await catatHitunganGudang({
      ...input,
      receivedAt: tanggal,
      warehouseUserId: userId,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    // Jurnal retur toko (persediaan kembali + pendapatan dibalik sebesar fisik) — sesudah commit.
    await kaitReturBerubah({ nriIds: [hasil.id] }, userId);
    segarkan();
    // Penerimaan yatim (tanpa NRT) belum punya pelapor; ia dikabarkan saat dijodohkan.
    if (input.storeReturnId) void kabarReturDihitung(input.storeReturnId, userId);
    // Selisih baru: pemegang toko SEKARANG diminta menanyakan ke toko dan SPG (P85, P22).
    if (input.storeReturnId && hasil.selisihBaru) void kabarSelisihRetur(input.storeReturnId, userId, 'BARU');
    return { ok: true, noNri: hasil.noNri, klaim: hasil.klaim, fisik: hasil.fisik };
  } catch (err) {
    console.error('catatHitunganGudang gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Jodohkan penerimaan gudang yatim dengan nota toko. */
export async function jodohkanReturAction(
  warehouseReturnId: string,
  storeReturnId: string,
): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await jodohkanRetur({ warehouseReturnId, storeReturnId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    await kaitReturBerubah({ nriIds: [warehouseReturnId] }, userId);
    segarkan();
    // Baru sekarang hitungan gudang menempel ke nota si pelapor — bagi dia, inilah saat returnya dihitung.
    void kabarReturDihitung(storeReturnId, userId);
    if (hasil.selisihBaru) void kabarSelisihRetur(storeReturnId, userId, 'BARU');
    return { ok: true };
  } catch (err) {
    console.error('jodohkanRetur gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Lepas pasangan NRT–NRI. Ditolak kalau bebannya sudah diputuskan atau notanya punya susulan. */
export async function lepasPasanganAction(warehouseReturnId: string): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await lepasPasangan({ warehouseReturnId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    await kaitReturBerubah({ nriIds: [warehouseReturnId] }, userId);
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('lepasPasangan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Salesman pemegang toko melaporkan hasil mencari barang selisih retur: ditemukan
 * (barangnya dikirim balik) atau tidak ditemukan (dengan jawaban toko dan SPG).
 * Pekerjaan lapangan — `pwa:access`; penulisnya hanya menerima pemegang toko itu.
 */
export async function laporHasilCekSelisihAction(
  chargeId: string,
  hasil: 'DITEMUKAN' | 'TIDAK_DITEMUKAN',
  catatan: string | null,
): Promise<HasilAksiRetur> {
  const session = await auth();
  if (!session?.user?.id || !bolehMelapor(session.user.permissions)) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const h = await laporHasilCekSelisih({ chargeId, hasil, catatan, olehUserId: session.user.id });
    if (!h.ok) return { ok: false, kode: h.alasan };
    if (h.notifikasi) void fanOutAdminNotification(h.notifikasi);
    segarkanSelisih();
    return { ok: true };
  } catch (err) {
    console.error('laporHasilCekSelisih gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Hitungan gudang atas barang SUSULAN — barang selisih yang ketemu di toko dan dikirim balik.
 * Izin menghitung, sama dengan hitungan pertama; hitungannya buta.
 */
export async function catatHitunganSusulanAction(input: {
  storeReturnId: string;
  receivedAt: string;
  deliveryMethod: 'SALES' | 'TOKO' | 'EKSPEDISI';
  physicalAmount?: number;
  items?: BarisBarang[];
  note?: string;
}): Promise<HasilHitunganSusulan> {
  const userId = await butuh(PERMISSIONS.INVENTORY_OPNAME_COUNT);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  const tanggal = tanggalWib(input.receivedAt);
  if (!tanggal || tanggal.getTime() > Date.now()) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await catatHitunganSusulan({ ...input, receivedAt: tanggal, warehouseUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    // Jurnal: hitungan susulannya sendiri dan jurnal hitungan asli nota itu (nilai fisiknya bertambah).
    await kaitReturBerubah({ nriIds: [hasil.id], nrtIds: [input.storeReturnId] }, userId);
    segarkanSelisih();
    void kabarSesudahSusulan(input.storeReturnId, hasil.selaras, userId);
    return { ok: true, noNri: hasil.noNri, fisik: hasil.fisik, sisaSelisih: hasil.sisaSelisih };
  } catch (err) {
    console.error('catatHitunganSusulan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Jadikan penerimaan gudang tanpa nota sebagai barang susulan sebuah nota retur — pekerjaan penjodohan. */
export async function jadikanSusulanAction(warehouseReturnId: string, storeReturnId: string): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const hasil = await jadikanSusulan({ warehouseReturnId, storeReturnId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    if (hasil.notifikasi) void fanOutAdminNotification(hasil.notifikasi);
    await kaitReturBerubah({ nriIds: [warehouseReturnId], nrtIds: [storeReturnId] }, userId);
    segarkanSelisih();
    void kabarSesudahSusulan(storeReturnId, hasil.selaras, userId);
    return { ok: true };
  } catch (err) {
    console.error('jadikanSusulan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Lepas hitungan susulan dari notanya. Ditolak sesudah bebannya diputuskan. */
export async function lepasSusulanAction(warehouseReturnId: string): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    // Notanya dibaca SEBELUM dilepas: sesudahnya penunjuknya sudah kosong.
    const nota = await prisma.warehouseReturn.findUnique({
      where: { id: warehouseReturnId },
      select: { followUpOfStoreReturnId: true },
    });
    const hasil = await lepasSusulan({ warehouseReturnId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    if (hasil.notifikasi) void fanOutAdminNotification(hasil.notifikasi);
    const nrtId = nota?.followUpOfStoreReturnId ?? null;
    await kaitReturBerubah({ nriIds: [warehouseReturnId], ...(nrtId ? { nrtIds: [nrtId] } : {}) }, userId);
    segarkanSelisih();
    if (nrtId) void kabarSesudahSusulan(nrtId, hasil.selaras, userId);
    return { ok: true };
  } catch (err) {
    console.error('lepasSusulan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Tetapkan siapa menanggung selisih retur toko.
 *
 * Keputusan manager dengan izinnya sendiri, `store_returns:decide_shortfall` (P22: izin
 * "memutuskan penanggung" dipecah dua — barang hilang SPG tetap `receivables:decide_bearer`).
 * Tombol, aksi, lonceng, dan baris Beranda memakai kode yang sama.
 */
export async function putuskanBebanAction(
  chargeId: string,
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN',
  alasan: string,
  bearerUserId?: string | null,
): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.STORE_RETURNS_DECIDE_SHORTFALL);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await putuskanBeban({ chargeId, bearer, alasan, bearerUserId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    await kaitReturBerubah({ chargeIds: [chargeId] }, userId);
    segarkanSelisih();
    // Penulis hanya menyimpan orangnya untuk beban SALES; aturan yang sama di sini.
    if (bearer === 'SALES' && bearerUserId) void kabarBebanRetur(chargeId, bearerUserId, alasan, userId);
    if (bearer === 'TOKO') {
      const beban = await prisma.returnCharge.findUnique({ where: { id: chargeId }, select: { storeReturnId: true } });
      if (beban?.storeReturnId) void kabarBebanTokoRetur(beban.storeReturnId, userId, 'DITANGGUNG');
    }
    return { ok: true };
  } catch (err) {
    console.error('putuskanBeban gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Tandai beban gudang / perusahaan sudah diganti. Tidak menyentuh piutang. */
export async function tandaiBebanLunasAction(chargeId: string): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await tandaiBebanLunas({ chargeId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    revalidatePath('/backoffice/beban-selisih');
    return { ok: true };
  } catch (err) {
    console.error('tandaiBebanLunas gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Batalkan nota retur toko. Potongan yang menunjuknya tetap tertahan. */
export async function batalkanReturAction(
  storeReturnId: string,
  alasan: string,
): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await batalkanRetur({ storeReturnId, alasan, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    revalidatePath('/pwa/retur');
    void kabarReturDikoreksi(storeReturnId, 'BATAL', alasan, userId);
    return { ok: true };
  } catch (err) {
    console.error('batalkanRetur gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Alihkan beban yang sudah diputuskan — atau lengkapi orangnya. Izinnya sama dengan memutuskan. */
export async function alihkanBebanAction(
  chargeId: string,
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN',
  alasan: string,
  bearerUserId?: string | null,
): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.STORE_RETURNS_DECIDE_SHORTFALL);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    /*
     * Dibaca sebelum penulis menimpanya: mengalihkan ke sales LAIN (atau melengkapi orang pada
     * beban SALES yang tersimpan tanpa orang) adalah beban baru bagi orang itu, sedangkan
     * menyimpan ulang orang yang sama bukan. Begitu pula tahanan toko yang dilepas: pemegang toko
     * hanya perlu tahu kalau tadinya ada yang ia tagih. Pembacaan yang gagal tidak menghalangi.
     */
    const sebelum = await prisma.returnCharge
      .findUnique({ where: { id: chargeId }, select: { bearer: true, bearerUserId: true, storeReturnId: true } })
      .catch(() => null);
    const tertahanToko =
      sebelum?.bearer === 'TOKO' && bearer !== 'TOKO' && sebelum.storeReturnId
        ? await bebanTokoDiNota(prisma, sebelum.storeReturnId)
            .then((b) => b.tampil)
            .catch(() => 0)
        : 0;
    const hasil = await alihkanBeban({ chargeId, bearer, alasan, bearerUserId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    await kaitReturBerubah({ chargeIds: [chargeId] }, userId);
    segarkanSelisih();
    const orangSama = sebelum?.bearer === 'SALES' && sebelum.bearerUserId === bearerUserId;
    if (bearer === 'SALES' && bearerUserId && !orangSama) {
      void kabarBebanRetur(chargeId, bearerUserId, alasan, userId);
    }
    const nrtId = sebelum?.storeReturnId ?? null;
    if (nrtId && sebelum?.bearer === 'TOKO' && bearer !== 'TOKO') {
      void kabarBebanTokoRetur(nrtId, userId, 'DILEPAS', tertahanToko);
    }
    if (nrtId && bearer === 'TOKO' && sebelum?.bearer !== 'TOKO') void kabarBebanTokoRetur(nrtId, userId, 'DITANGGUNG');
    return { ok: true };
  } catch (err) {
    console.error('alihkanBeban gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Potongan beban selisih retur dari komisi sales (dan kelebihannya dikembalikan) — dicatat di
 * Laporan → Komisi salesman, mekanisme yang sama dengan potongan barang hilang, dengan izin yang
 * sama (`receivables:manage`). Komisi salesman dibayar di luar sistem; yang dicatat di sini
 * adalah berapa yang dipotong bulan itu.
 */
type IsianPotongRetur = { salesmanId: string; bulan: string; jumlah: unknown; kunci: unknown; catatan?: unknown };
export type HasilPotongRetur = { ok: true; nilai: number } | { ok: false; code: string };

async function potongRetur(isian: IsianPotongRetur, jenis: 'POTONG' | 'KEMBALI'): Promise<HasilPotongRetur> {
  const session = await auth();
  if (!session?.user?.id || !bolehMengelola(session.user.permissions)) return { ok: false, code: 'TANPA_AKSES' };
  const userId = session.user.id;
  try {
    const masukan = { ...isian, olehUserId: userId };
    const h = jenis === 'POTONG' ? await tandaiBebanReturDipotong(masukan) : await tandaiKelebihanReturDikembalikan(masukan);
    if (!h.ok) return { ok: false, code: h.kode };
    // Rujukan yang sama dengan penulisnya (`potong-beban-retur.ts`): kunci layar di-trim.
    const kunci = typeof isian.kunci === 'string' ? isian.kunci.trim() : '';
    const refId = `${jenis === 'KEMBALI' ? 'kembali:' : ''}${isian.salesmanId}:${isian.bulan}:${kunci}`;
    // Jurnalnya sesudah commit; kiriman ulang (`ulang`) hanya menyusulkan jurnal yang belum ada.
    await kaitPotongSalesRetur(refId, userId);
    segarkanSelisih();
    if (!h.ulang && isian.salesmanId !== userId) {
      void kabariPengguna(isian.salesmanId, {
        jenis: JENIS_KABAR.RETUR_DIBEBANKAN,
        judul:
          jenis === 'POTONG'
            ? `Beban selisih retur ${formatIDR(h.nilai)} dipotong dari komisi ${isian.bulan}`
            : `Kelebihan potong selisih retur ${formatIDR(h.nilai)} dikembalikan`,
        isi: jenis === 'POTONG' ? 'Rinciannya ada di Beban saya.' : `Dikembalikan bersama komisi ${isian.bulan}.`,
        data: {},
      });
    }
    return { ok: true, nilai: h.nilai };
  } catch (err) {
    console.error('potong beban retur gagal:', err);
    return { ok: false, code: 'GAGAL' };
  }
}

export async function tandaiBebanReturDipotongAction(isian: IsianPotongRetur): Promise<HasilPotongRetur> {
  return potongRetur(isian, 'POTONG');
}

export async function tandaiKelebihanReturDikembalikanAction(isian: IsianPotongRetur): Promise<HasilPotongRetur> {
  return potongRetur(isian, 'KEMBALI');
}

/**
 * Sales menarik nota retur yang ia catat sendiri — salah toko, salah nomor.
 *
 * Hanya sebelum gudang menghitung dan selama nota tidak dipakai potongan di BKM
 * yang masih hidup (aturannya di `batalkanReturSendiri`). Kantor diberi tahu.
 */
export async function tarikReturSendiriAction(storeReturnId: string, alasan: string): Promise<HasilKoreksiRetur> {
  const session = await auth();
  if (!session?.user?.id || !bolehMelapor(session.user.permissions)) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const hasil = await batalkanReturSendiri({ storeReturnId, salesmanId: session.user.id, alasan });
    if (!hasil.ok) return keHasil(hasil);
    void fanOutAdminNotification(hasil.notifikasi);
    segarkan();
    revalidatePath('/pwa/retur');
    revalidatePath(`/backoffice/retur-toko/${storeReturnId}`);
    return { ok: true };
  } catch (err) {
    console.error('tarikReturSendiri gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Kantor memindahkan nota retur — beserta hitungan gudang dan beban terbukanya — ke toko yang benar. */
export async function pindahkanReturAction(
  storeReturnId: string,
  tokoTujuanId: string,
  alasan: string,
  setujuSiklusTerkunci = false,
): Promise<HasilKoreksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const hasil = await pindahkanReturKeToko({ storeReturnId, tokoTujuanId, alasan, olehUserId: userId, setujuSiklusTerkunci });
    if (!hasil.ok) return keHasil(hasil);
    await kaitReturBerubah({ nrtIds: [storeReturnId] }, userId);
    segarkan();
    revalidatePath(`/backoffice/retur-toko/${storeReturnId}`);
    revalidatePath('/pwa/retur');
    void kabarReturDikoreksi(storeReturnId, 'PINDAH', alasan, userId);
    return { ok: true };
  } catch (err) {
    console.error('pindahkanRetur gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Kantor menetapkan atau membetulkan toko hitungan gudang yang belum berpasangan. */
export async function pindahkanNriAction(
  warehouseReturnId: string,
  tokoTujuanId: string,
  alasan: string,
  setujuSiklusTerkunci = false,
): Promise<HasilKoreksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const hasil = await pindahkanNriKeToko({ warehouseReturnId, tokoTujuanId, alasan, olehUserId: userId, setujuSiklusTerkunci });
    if (!hasil.ok) return keHasil(hasil);
    await kaitReturBerubah({ nriIds: [warehouseReturnId] }, userId);
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('pindahkanNri gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
