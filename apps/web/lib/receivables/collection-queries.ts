import { prisma } from '@elorae/db';
import { daftarPiutang, type BarisPiutang } from './queries';
import { selisihHari } from './rules';

/** Ubah Decimal Prisma ke number. Aturan uang sengaja tidak menyentuh Decimal. */
const angka = (v: unknown): number => Number(v ?? 0);

export type BarisKontrabon = {
  id: string;
  docNo: string;
  storeName: string;
  salesmanName: string | null;
  handoverDate: string;
  promisedDate: string;
  receivedBy: string | null;
  nilaiSerah: number;
  /** Sisa yang belum terbayar dari faktur-faktur di kontrabon ini, hari ini. */
  sisaSekarang: number;
  jumlahFaktur: number;
  status: 'BERJALAN' | 'SELESAI' | 'BATAL';
  /** Positif = masih ada waktu, negatif = sudah lewat janji. Null kalau tertutup. */
  sisaHari: number | null;
};

/**
 * Daftar kontrabon beserta sisa yang masih menggantung di tiap tanda terima.
 *
 * `nilaiSerah` adalah nilai saat faktur diserahkan — angka yang tercetak di
 * kertasnya dan tidak boleh berubah. `sisaSekarang` dihitung ulang dari klaim,
 * jadi sebuah kontrabon yang sudah dibayar sebagian menunjukkan keduanya, dan
 * selisihnya adalah apa yang sudah masuk.
 */
export async function daftarKontrabon(opts?: {
  status?: 'BERJALAN' | 'SELESAI' | 'BATAL';
}): Promise<BarisKontrabon[]> {
  const rows = await prisma.collectionNote.findMany({
    where: opts?.status ? { status: opts.status } : undefined,
    orderBy: [{ promisedDate: 'asc' }],
    select: {
      id: true,
      docNo: true,
      handoverDate: true,
      promisedDate: true,
      receivedBy: true,
      amount: true,
      status: true,
      store: { select: { name: true } },
      salesman: { select: { name: true } },
      receivableLinks: { select: { receivableId: true } },
    },
  });
  if (rows.length === 0) return [];

  /*
   * Sisa dihitung lewat `daftarPiutang`, yang sudah menghitung ulang dari klaim.
   * Membaca kolom `outstanding` di sini akan lebih murah tapi melanggar aturan
   * yang sama yang dijaga di seluruh modul: kolom itu cache, bukan kebenaran.
   */
  // Hanya piutang yang benar-benar ada di kontrabon-kontrabon ini. Sebelumnya
  // daftar ini memuat setiap piutang yang pernah ada untuk mengisi satu kolom.
  const idPiutang = [
    ...new Set(rows.flatMap((r) => r.receivableLinks.map((l) => l.receivableId))),
  ];
  const semuaPiutang = await daftarPiutang({ receivableIds: idPiutang });
  const sisaPerPiutang = new Map(semuaPiutang.map((p) => [p.id, p.outstanding]));
  const hariIni = new Date();

  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo,
    storeName: r.store.name,
    salesmanName: r.salesman.name,
    handoverDate: r.handoverDate.toISOString(),
    promisedDate: r.promisedDate.toISOString(),
    receivedBy: r.receivedBy,
    nilaiSerah: angka(r.amount),
    sisaSekarang: r.receivableLinks.reduce(
      (sum, l) => sum + (sisaPerPiutang.get(l.receivableId) ?? 0),
      0,
    ),
    jumlahFaktur: r.receivableLinks.length,
    status: r.status as BarisKontrabon['status'],
    sisaHari: r.status === 'BERJALAN' ? selisihHari(hariIni, r.promisedDate) : null,
  }));
}

export type TokoSiapKontrabon = {
  storeId: string;
  storeName: string;
  piutang: BarisPiutang[];
  total: number;
};

/**
 * Piutang yang boleh masuk kontrabon baru, dikelompokkan per toko.
 *
 * Yang disaring keluar: piutang lunas, dan piutang yang sudah dipegang toko
 * lewat kontrabon lain yang masih berjalan. Keduanya adalah alasan penolakan
 * di penulis — menyaringnya di sini supaya penolakan itu tidak pernah terlihat
 * oleh orang yang menyusun tanda terima.
 */
export async function piutangSiapKontrabon(): Promise<TokoSiapKontrabon[]> {
  const [semua, terpakai] = await Promise.all([
    // Kontrabon hanya untuk faktur yang masih terbuka.
    daftarPiutang({ hanyaTerbuka: true }),
    prisma.collectionNoteReceivable.findMany({
      where: { collectionNote: { status: 'BERJALAN' } },
      select: { receivableId: true },
    }),
  ]);

  const sudahDipegang = new Set(terpakai.map((t) => t.receivableId));
  const kandidat = semua.filter((p) => p.outstanding > 0 && !sudahDipegang.has(p.id));

  // Dikelompokkan menurut id, bukan nama: dua toko boleh bernama sama, dan
  // menggabungkannya akan menghasilkan tanda terima yang tak bisa diserahkan.
  const perToko = new Map<string, TokoSiapKontrabon>();
  for (const p of kandidat) {
    const grup = perToko.get(p.storeId) ?? {
      storeId: p.storeId,
      storeName: p.storeName,
      piutang: [],
      total: 0,
    };
    grup.piutang.push(p);
    grup.total += p.outstanding;
    perToko.set(p.storeId, grup);
  }

  return [...perToko.values()].sort((a, b) => b.total - a.total);
}

export type RincianKontrabon = {
  baris: BarisKontrabon;
  fotoUrl: string | null;
  catatan: string | null;
  faktur: {
    id: string;
    invoiceNo: string;
    nilaiSerah: number;
    sisaSekarang: number;
    keadaan: string;
  }[];
  klaim: { id: string; docNo: string; nilaiDiterima: number; status: string }[];
};

/**
 * Satu kontrabon, faktur-fakturnya, dan klaim yang lahir darinya.
 *
 * `nilaiSerah` per faktur adalah nilai saat kertasnya ditandatangani dan tidak
 * pernah berubah; `sisaSekarang` dihitung ulang. Keduanya ditampilkan karena
 * selisihnya adalah apa yang sudah dibayar sejak diserahkan.
 */
export async function rincianKontrabon(id: string): Promise<RincianKontrabon | null> {
  const r = await prisma.collectionNote.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      handoverDate: true,
      promisedDate: true,
      receivedBy: true,
      amount: true,
      status: true,
      photoUrl: true,
      note: true,
      store: { select: { name: true } },
      salesman: { select: { name: true } },
      receivableLinks: {
        select: { amount: true, receivable: { select: { id: true, invoiceNo: true } } },
      },
      claims: {
        select: { id: true, docNo: true, receivedAmount: true, status: true },
      },
    },
  });
  if (!r) return null;

  // Satu kontrabon, jadi hanya faktur yang ada di dalamnya.
  const semua = await daftarPiutang({
    receivableIds: r.receivableLinks.map((l) => l.receivable.id),
  });
  const perPiutang = new Map(semua.map((p) => [p.id, p]));
  const hariIni = new Date();

  const faktur = r.receivableLinks.map((l) => {
    const p = perPiutang.get(l.receivable.id);
    return {
      id: l.receivable.id,
      invoiceNo: l.receivable.invoiceNo,
      nilaiSerah: angka(l.amount),
      sisaSekarang: p?.outstanding ?? 0,
      keadaan: p?.keadaan ?? 'lunas',
    };
  });

  return {
    baris: {
      id: r.id,
      docNo: r.docNo,
      storeName: r.store.name,
      salesmanName: r.salesman?.name ?? null,
      handoverDate: r.handoverDate.toISOString(),
      promisedDate: r.promisedDate.toISOString(),
      receivedBy: r.receivedBy,
      nilaiSerah: angka(r.amount),
      sisaSekarang: faktur.reduce((s, f) => s + f.sisaSekarang, 0),
      jumlahFaktur: r.receivableLinks.length,
      status: r.status as BarisKontrabon['status'],
      sisaHari: r.status === 'BERJALAN' ? selisihHari(hariIni, r.promisedDate) : null,
    },
    fotoUrl: r.photoUrl,
    catatan: r.note,
    faktur,
    klaim: r.claims.map((k) => ({
      id: k.id,
      docNo: k.docNo,
      nilaiDiterima: angka(k.receivedAmount),
      status: k.status,
    })),
  };
}
