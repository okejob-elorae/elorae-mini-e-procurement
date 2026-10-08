import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { KOLOM_FOTO, urlFotoDalam } from '@/lib/foto/pembersih';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { bolehMembacaPelunasan, bolehMembacaPiutang, bolehMembacaRetur } from '@/lib/receivables/izin';
import { bolehMelihatBiaya } from '@/lib/salesman/biaya';

export const dynamic = 'force-dynamic';

/*
 * Siapa boleh mengunduh sebuah foto.
 *
 * Foto di sini adalah bukti transfer, nota retur, swafoto absen, surat sakit,
 * foto bukti terima — dokumen milik toko, sales, dan karyawan. Dulu cukup
 * masuk: siapa pun yang tahu id-nya bisa mengunduh foto mana pun.
 *
 * Urutan pemeriksaan, dari yang termurah:
 * 1. pengunggahnya sendiri (`Foto.uploadedById`, tanpa kueri tambahan);
 * 2. admin sistem (`*`);
 * 3. dokumen yang menunjuk foto ini (kolom dari `KOLOM_FOTO`), HANYA di model
 *    yang boleh dibaca penonton — semua dokumennya bila ia memegang izin baca
 *    modulnya, atau dokumen miliknya sendiri bila aturannya punya saringan
 *    pemilik. Model yang tidak boleh dibacanya tidak pernah dikueri.
 *
 * Model tidak punya kolom konteks, jadi langkah 3 memang mencari; tapi dibatasi
 * izin penonton, dijalankan berurutan (berhenti di temuan pertama, tidak
 * memborong koneksi pool), dan hasilnya disimpan peramban (`immutable`).
 */

type Izin = string[];

/** Penonton foto. `tokoTetap` dibaca malas — hanya aturan yang butuh yang memanggilnya. */
type Penonton = { id: string; tokoTetap: () => Promise<string | null> };

type Pembaca = {
  /** Boleh membaca SEMUA dokumen model ini. */
  semua: (izin: Izin) => boolean;
  /**
   * Saringan dokumen milik penonton sendiri, untuk yang tidak boleh semua.
   * `null` = tidak ada dokumen model ini yang miliknya (model tidak dikueri).
   */
  milik?: (p: Penonton) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
};

const punya =
  (...kode: string[]) =>
  (izin: Izin) =>
    kode.some((k) => hasPermission(izin, k));
const siapaPunYangMasuk = () => true;

/**
 * Aturan pembaca per model di `KOLOM_FOTO`. Kolom foto baru tanpa aturan di
 * sini hanya bisa dibuka pengunggahnya dan admin sistem — `route.spec.ts`
 * gagal bila ada model `KOLOM_FOTO` yang tidak terdaftar.
 */
const PEMBACA_FOTO: Readonly<Record<string, Pembaca>> = {
  // Modul piutang: pembaca lintas tugas, lewat `lib/receivables/izin.ts`.
  paymentClaim: {
    semua: bolehMembacaPelunasan,
    milik: (p) => ({ OR: [{ salesmanId: p.id }, { createdById: p.id }] }),
  },
  collectionNote: { semua: bolehMembacaPiutang, milik: (p) => ({ salesmanId: p.id }) },
  storeReturn: { semua: bolehMembacaRetur, milik: (p) => ({ salesmanId: p.id }) },
  // Bukti terima: kantor penjualan lapangan + arsip "Nota toko" (piutang);
  // salesman pemilik pesanan dan pengantarnya melihatnya di HP.
  fieldSalesDelivery: {
    semua: (izin) => punya(PERMISSIONS.FIELD_SALES_ORDERS_VIEW)(izin) || bolehMembacaPiutang(izin),
    milik: (p) => ({ OR: [{ deliveredById: p.id }, { order: { salesmanId: p.id } }] }),
  },
  gRN: { semua: punya(PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.PURCHASE_ORDERS_VIEW) },
  materialIssue: { semua: punya(PERMISSIONS.WORK_ORDERS_VIEW, PERMISSIONS.INVENTORY_VIEW) },
  fGReceipt: { semua: punya(PERMISSIONS.WORK_ORDERS_VIEW, PERMISSIONS.INVENTORY_VIEW) },
  contentPlan: { semua: punya(PERMISSIONS.CREATIVE_VIEW) },
  // Kiriman rusak: pengawas SPG atau gudang yang memutuskan (halaman yang sama).
  storeReceiptLine: { semua: punya(PERMISSIONS.SPG_SALES_VIEW, PERMISSIONS.INVENTORY_MANAGE) },
  storeProposal: { semua: punya(PERMISSIONS.STORES_VIEW, PERMISSIONS.STORES_MANAGE) },
  expenseClaim: { semua: bolehMelihatBiaya },
  attendance: { semua: punya(PERMISSIONS.FIELD_SALES_ORDERS_VIEW, PERMISSIONS.SPG_SALES_VIEW) },
  // Harga pesaing tampil di halaman toko untuk semua sales/SPG.
  competitorPrice: { semua: (izin) => punya(PERMISSIONS.STORES_VIEW)(izin) || izin.includes('pwa:access') },
  // Surat izin/sakit: hanya kantor yang memutuskan izin.
  leaveRequest: { semua: punya(PERMISSIONS.FIELD_SALES_ORDERS_VIEW) },
  // Satu laporan per toko per hari, dan HP SPG menampilkan laporan tokonya apa
  // pun SPG yang mengisinya — rekan satu toko (toko tetap yang sama) ikut boleh.
  spgDailyClose: {
    semua: punya(PERMISSIONS.SPG_SALES_VIEW),
    milik: async (p) => {
      const toko = await p.tokoTetap();
      return toko ? { storeId: toko } : null;
    },
  },
  // Bukti transfer fee KOL: tim Kreatif yang membayar dan keuangan yang memeriksa.
  kolPaymentTerm: { semua: punya(PERMISSIONS.CREATIVE_VIEW, PERMISSIONS.JOURNALS_VIEW) },
  // Dokumen keuangan: bukti voucher kas/bank dan setor pajak untuk keuangan;
  // bukti bayar pemasok juga untuk yang membuka register pembayaran pemasok.
  cashVoucher: { semua: punya(PERMISSIONS.JOURNALS_VIEW) },
  supplierPayment: { semua: punya(PERMISSIONS.JOURNALS_VIEW, PERMISSIONS.SUPPLIER_PAYMENTS_VIEW) },
  taxPayment: { semua: punya(PERMISSIONS.JOURNALS_VIEW) },
  // Foto SKB pemasok: siapa pun yang boleh membuka data master pemasok.
  supplier: { semua: punya(PERMISSIONS.SUPPLIERS_VIEW) },
  // Bukan dokumen pribadi: panduan display, foto produk, foto profil.
  displayGuide: { semua: siapaPunYangMasuk },
  itemImage: { semua: siapaPunYangMasuk },
  user: { semua: siapaPunYangMasuk },
};

const HARI_MS = 24 * 60 * 60 * 1000;
/** Antrean luring HP paling lama 14 hari; jendela dokumen JSON diberi lebih. */
const JENDELA_JSON_HARI = 15;

type Delegasi = { findMany: (args: unknown) => Promise<Record<string, unknown>[]> };

/** Apakah ada dokumen yang boleh dibaca penonton dan menunjuk foto ini. */
async function ditunjukDokumenTerbaca(url: string, dibuat: Date, userId: string, izin: Izin): Promise<boolean> {
  let toko: Promise<string | null> | null = null;
  const penonton: Penonton = {
    id: userId,
    tokoTetap: () =>
      (toko ??= prisma.user
        .findUnique({ where: { id: userId }, select: { assignedStoreId: true } })
        .then((u) => u?.assignedStoreId ?? null)),
  };

  for (const { model, kolom, json } of KOLOM_FOTO) {
    const aturan = PEMBACA_FOTO[model];
    if (!aturan) continue;
    const semua = aturan.semua(izin);
    if (!semua && !aturan.milik) continue;
    const milik = semua ? null : await aturan.milik!(penonton);
    if (!semua && !milik) continue;

    const syarat: Record<string, unknown>[] = [];
    if (json) {
      // Kolom JSON tidak bisa dicari isinya sama di Postgres dan MariaDB.
      // Dokumen yang menunjuk foto ditulis SESUDAH fotonya diunggah, dan foto
      // yang tidak ditunjuk dalam beberapa jam disapu — jadi cukup jendela ini.
      syarat.push({
        updatedAt: { gte: new Date(dibuat.getTime() - HARI_MS) },
        createdAt: { lte: new Date(dibuat.getTime() + JENDELA_JSON_HARI * HARI_MS) },
      });
    } else {
      syarat.push({ OR: kolom.map((k) => ({ [k]: { contains: url } })) });
    }
    if (milik) syarat.push(milik);

    const delegasi = (prisma as unknown as Record<string, Delegasi>)[model];
    const baris = await delegasi.findMany({
      where: { AND: syarat },
      select: Object.fromEntries(kolom.map((k) => [k, true])),
      take: json ? undefined : 20,
    });
    // `contains` bisa mengenai id lain yang diawali id ini; cocokkan URL utuh.
    if (baris.some((b) => kolom.some((k) => urlFotoDalam(b[k]).includes(url)))) return true;
  }
  return false;
}

/**
 * Sajikan satu foto.
 *
 * Ditandai `private` di Cache-Control supaya tidak nyangkut di cache bersama;
 * `immutable` aman karena isinya tidak pernah berubah setelah diunggah.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'TANPA_AKSES' }, { status: 401 });
  }

  const { id } = await params;
  // Bytes dibaca hanya sesudah akses diputuskan — foto bisa beberapa megabyte.
  const meta = await prisma.foto.findUnique({
    where: { id },
    select: { uploadedById: true, createdAt: true },
  });
  if (!meta) return NextResponse.json({ error: 'TIDAK_DITEMUKAN' }, { status: 404 });

  const userId = session.user.id;
  const izin = session.user.permissions ?? [];
  const boleh =
    meta.uploadedById === userId ||
    izin.includes('*') ||
    (await ditunjukDokumenTerbaca(`/api/foto/${id}`, meta.createdAt, userId, izin));
  if (!boleh) return NextResponse.json({ error: 'TANPA_AKSES' }, { status: 403 });

  const foto = await prisma.foto.findUnique({
    where: { id },
    select: { mime: true, bytes: true },
  });
  if (!foto) return NextResponse.json({ error: 'TIDAK_DITEMUKAN' }, { status: 404 });

  return new NextResponse(Buffer.from(foto.bytes), {
    headers: {
      'Content-Type': foto.mime,
      'Content-Length': String(foto.bytes.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
