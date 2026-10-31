'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { bolehMelapor } from '@/lib/receivables/izin';
import {
  alihkanBeban,
  batalkanRetur,
  catatHitunganGudang,
  catatReturToko,
  jodohkanRetur,
  lepasPasangan,
  putuskanBeban,
  tandaiBebanLunas,
  type AlasanGagalRetur,
  type BarisBarang,
  type BarisReturSpg,
} from '@/lib/receivables/return-writer';
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

export type KodeAksiRetur =
  | 'TANPA_AKSES'
  | 'TANGGAL_TIDAK_VALID'
  | "TOKO_TIDAK_DIIZINKAN"
  | AlasanGagalRetur
  | AlasanPengganti
  | 'GAGAL';
export type HasilAksiRetur = { ok: true } | { ok: false; kode: KodeAksiRetur };

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

function segarkan() {
  revalidatePath('/backoffice/retur-toko');
  revalidatePath('/backoffice/piutang');
  revalidatePath('/backoffice/pelunasan');
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
 * Kabar ke orang lapangan. Keduanya dipanggil SESUDAH transaksinya selesai dan tidak pernah
 * melempar: hitungan dan keputusan beban sudah tersimpan, dan kabar yang gagal tidak boleh
 * membuatnya tampak gagal. Pelaku yang kebetulan penerimanya sendiri tidak dikabari.
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
      isi: [toko, formatIDR(beban.amount.toString())].filter(Boolean).join(' · ') + `. Alasan: ${alasan.trim()}`,
      data: beban.storeReturnId ? { chargeId, returnId: beban.storeReturnId } : { chargeId },
    });
  } catch (err) {
    console.error('[kabar] beban retur gagal', chargeId, err);
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
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
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
    return { ok: true };
  } catch (err) {
    console.error('jodohkanRetur gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Lepas pasangan NRT–NRI. Ditolak kalau bebannya sudah diputuskan. */
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

/** Tetapkan siapa menanggung selisih. Inilah yang melepas faktur. */
export async function putuskanBebanAction(
  chargeId: string,
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN',
  alasan: string,
  bearerUserId?: string | null,
): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await putuskanBeban({ chargeId, bearer, alasan, bearerUserId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    await kaitReturBerubah({ chargeIds: [chargeId] }, userId);
    segarkan();
    revalidatePath('/backoffice/beban-selisih');
    // Penulis hanya menyimpan orangnya untuk beban SALES; aturan yang sama di sini.
    if (bearer === 'SALES' && bearerUserId) void kabarBebanRetur(chargeId, bearerUserId, alasan, userId);
    return { ok: true };
  } catch (err) {
    console.error('putuskanBeban gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Tandai beban sudah diganti. Tidak menyentuh piutang. */
export async function tandaiBebanLunasAction(chargeId: string): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await tandaiBebanLunas({ chargeId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
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

/** Alihkan beban yang sudah diputuskan — atau lengkapi orangnya. */
export async function alihkanBebanAction(
  chargeId: string,
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN',
  alasan: string,
  bearerUserId?: string | null,
): Promise<HasilAksiRetur> {
  const userId = await butuh(PERMISSIONS.RECEIVABLES_MANAGE);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    /*
     * Dibaca sebelum penulis menimpanya: mengalihkan ke sales LAIN (atau melengkapi orang pada
     * beban SALES yang tersimpan tanpa orang) adalah beban baru bagi orang itu, sedangkan
     * menyimpan ulang orang yang sama bukan. Pembacaan yang gagal tidak menghalangi pengalihan.
     */
    const sebelum =
      bearer === 'SALES' && bearerUserId
        ? await prisma.returnCharge
            .findUnique({ where: { id: chargeId }, select: { bearer: true, bearerUserId: true } })
            .catch(() => null)
        : null;
    const hasil = await alihkanBeban({ chargeId, bearer, alasan, bearerUserId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    await kaitReturBerubah({ chargeIds: [chargeId] }, userId);
    segarkan();
    revalidatePath('/backoffice/beban-selisih');
    const orangSama = sebelum?.bearer === 'SALES' && sebelum.bearerUserId === bearerUserId;
    if (bearer === 'SALES' && bearerUserId && !orangSama) {
      void kabarBebanRetur(chargeId, bearerUserId, alasan, userId);
    }
    return { ok: true };
  } catch (err) {
    console.error('alihkanBeban gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
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
