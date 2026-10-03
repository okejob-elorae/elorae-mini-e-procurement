import { prisma } from '@elorae/db';
import { daftarPiutang, type BarisPiutang } from './queries';
import type { StatusKlaim } from './rules';
import { daftarKerjaRetur } from './return-queries';

const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Berapa banyak riwayat yang dibawa ke layar HP.
 *
 * Diberi nama, bukan angka telanjang di tengah kueri. Layar lapangan memang
 * riwayat — sales melihat yang terbaru, bukan seluruh tahun — tapi batas yang
 * tidak bernama dan tidak dilaporkan membuat baris ke-51 hilang tanpa ada yang
 * tahu ia pernah ada.
 */
const BATAS_LAPANGAN = 50;

export type TokoLapangan = {
  storeId: string;
  storeName: string;
  jumlahFaktur: number;
  sisa: number;
  /** Keadaan paling mendesak di toko ini — itulah yang dibaca sales duluan. */
  keadaan: BarisPiutang['keadaan'];
  alasan: BarisPiutang['alasan'];
  /** Nomor kontrabon atau BKM yang menempel pada keadaan itu. */
  doc: string | null;
};

/**
 * Ringkasan per toko untuk layar sales.
 *
 * Diringkas ke SATU kalimat per toko, bukan daftar faktur. Sales membacanya
 * sambil berdiri di depan toko — yang ia butuhkan adalah apakah boleh menagih
 * dan kalau tidak, kenapa. Rinciannya ada satu ketukan di bawah.
 */
const URUT: BarisPiutang['keadaan'][] = ['lewat', 'tertahan', 'klaim', 'tt', 'belum', 'lunas'];

export async function tokoLapangan(salesmanId: string): Promise<TokoLapangan[]> {
  const piutang = await daftarPiutang({ penagihId: salesmanId });

  const peta = new Map<string, TokoLapangan & { lunas: number }>();
  for (const p of piutang) {
    const grup = peta.get(p.storeId) ?? {
      storeId: p.storeId,
      storeName: p.storeName,
      jumlahFaktur: 0,
      sisa: 0,
      keadaan: 'lunas' as BarisPiutang['keadaan'],
      alasan: {},
      doc: null,
      lunas: 0,
    };
    // Yang dihitung hanya faktur yang masih bersisa: "4 faktur · 14,2 jt" untuk
    // toko yang dua fakturnya sudah lunas membuat sales mencari dua faktur yang
    // tidak perlu ditagih. Toko yang sudah lunas semua tetap menyebut jumlahnya.
    if (p.outstanding > 0) grup.jumlahFaktur += 1;
    else grup.lunas += 1;
    grup.sisa += p.outstanding;
    // Keadaan yang lebih mendesak menang. Urutannya sama dengan urutan
    // pemeriksaan keadaan faktur, jadi layar sales dan layar kantor tidak
    // pernah menyebut satu toko dengan dua cerita berbeda.
    if (URUT.indexOf(p.keadaan) < URUT.indexOf(grup.keadaan)) {
      grup.keadaan = p.keadaan;
      grup.alasan = p.alasan;
      grup.doc = p.alasan.noKontrabon ?? p.alasan.noKlaim ?? null;
    }
    peta.set(p.storeId, grup);
  }

  return [...peta.values()]
    .map(({ lunas, ...g }) => (g.jumlahFaktur === 0 ? { ...g, jumlahFaktur: lunas } : g))
    .sort((a, b) => URUT.indexOf(a.keadaan) - URUT.indexOf(b.keadaan) || b.sisa - a.sisa);
}

/** Faktur satu toko, untuk layar rincian sales. */
export async function fakturToko(
  salesmanId: string,
  storeId: string,
): Promise<{ storeName: string; baris: BarisPiutang[] } | null> {
  const semua = await daftarPiutang({ penagihId: salesmanId });
  const baris = semua.filter((p) => p.storeId === storeId);
  if (baris.length === 0) return null;
  return { storeName: baris[0].storeName, baris };
}

export type KlaimSaya = {
  id: string;
  docNo: string;
  storeName: string;
  tanggal: string;
  nilaiDiterima: number;
  status: StatusKlaim;
  catatan: string | null;
  method: string;
  /** Rincian bilyet kalau dibayar dengan giro; `null` untuk cara bayar lain. */
  giro: {
    nomor: string | null;
    bank: string | null;
    tanggalEfektif: string | null;
    status: 'MENUNGGU' | 'CAIR' | 'DITOLAK' | null;
  } | null;
};

/** BKM yang pernah dilaporkan sales ini. */
export async function klaimSaya(salesmanId: string): Promise<KlaimSaya[]> {
  const rows = await prisma.paymentClaim.findMany({
    where: { salesmanId },
    orderBy: [{ createdAt: 'desc' }],
    take: BATAS_LAPANGAN,
    select: {
      id: true,
      docNo: true,
      claimedTransferAt: true,
      receivedAmount: true,
      status: true,
      verifyNote: true,
      method: true,
      giroNo: true,
      giroBank: true,
      giroEffectiveDate: true,
      giroStatus: true,
      store: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo,
    storeName: r.store.name,
    tanggal: r.claimedTransferAt.toISOString(),
    nilaiDiterima: angka(r.receivedAmount),
    status: r.status as KlaimSaya['status'],
    catatan: r.verifyNote,
    method: r.method,
    giro:
      r.method === 'giro'
        ? {
            nomor: r.giroNo,
            bank: r.giroBank,
            tanggalEfektif: r.giroEffectiveDate?.toISOString() ?? null,
            status: (r.giroStatus as 'MENUNGGU' | 'CAIR' | 'DITOLAK' | null) ?? null,
          }
        : null,
  }));
}

export type FakturJanji = {
  id: string;
  invoiceNo: string;
  dueDate: string;
  outstanding: number;
};

/**
 * Faktur satu toko yang boleh masuk janji bayar dari lapangan.
 *
 * Yang ia TAGIH saja (aturan penagih, sama dengan layar Tagihan), yang masih
 * bersisa, dan yang belum dipegang toko lewat kontrabon berjalan — ketiganya
 * juga ditolak penulisnya; disaring di sini supaya penolakan itu tidak pernah
 * terlihat oleh sales yang berdiri di depan toko.
 */
export async function fakturSiapJanji(
  salesmanId: string,
  storeId: string,
): Promise<{ storeName: string; faktur: FakturJanji[] } | null> {
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { name: true } });
  if (!toko) return null;
  const semua = await daftarPiutang({ penagihId: salesmanId, storeId, hanyaTerbuka: true });
  return {
    storeName: toko.name,
    faktur: semua
      .filter((p) => p.outstanding > 0 && !p.alasan.noKontrabon)
      .map((p) => ({ id: p.id, invoiceNo: p.invoiceNo, dueDate: p.dueDate, outstanding: p.outstanding })),
  };
}

export type JanjiToko = {
  id: string;
  docNo: string;
  promisedDate: string;
  receivedBy: string | null;
  nilai: number;
  jumlahFaktur: number;
  dariLapangan: boolean;
  /** Kantor sudah mencocokkan foto lembarnya. Kontrabon kantor selalu `true`. */
  dikonfirmasi: boolean;
};

/**
 * Kontrabon yang masih berjalan di satu toko, untuk layar tagihan sales.
 *
 * Sales perlu melihat janji yang ia catat sendiri SUDAH sampai ke kantor dan
 * apakah sudah dikonfirmasi — tanpa ini, satu-satunya tanda laporannya terkirim
 * adalah kalimat keadaan faktur yang berubah.
 */
export async function janjiBerjalanDiToko(storeId: string): Promise<JanjiToko[]> {
  const rows = await prisma.collectionNote.findMany({
    where: { storeId, status: 'BERJALAN' },
    orderBy: [{ promisedDate: 'asc' }],
    take: BATAS_LAPANGAN,
    select: {
      id: true,
      docNo: true,
      promisedDate: true,
      receivedBy: true,
      amount: true,
      source: true,
      confirmedAt: true,
      _count: { select: { receivableLinks: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo,
    promisedDate: r.promisedDate.toISOString(),
    receivedBy: r.receivedBy,
    nilai: angka(r.amount),
    jumlahFaktur: r._count.receivableLinks,
    dariLapangan: r.source === 'FIELD',
    dikonfirmasi: r.source !== 'FIELD' || r.confirmedAt !== null,
  }));
}

export type ReturSaya = {
  id: string;
  noNrt: string;
  storeName: string;
  tanggal: string;
  /** Null untuk toko KONSI: harga dan nilai konsinyasi tidak pernah sampai ke HP. */
  nilaiKlaim: number | null;
  langkah: string;
  adaFoto: boolean;
  /** Dilaporkan SPG dengan baris barang. */
  dariSpg: boolean;
  /** Jumlah potong di nota (hanya nota yang membawa baris barang). */
  jumlahBarang: number;
};

/** Nota retur yang pernah dicatat sales ini. */
export async function returSaya(salesmanId: string): Promise<ReturSaya[]> {
  const rows = await prisma.storeReturn.findMany({
    where: { salesmanId },
    orderBy: [{ claimDate: 'desc' }],
    take: BATAS_LAPANGAN,
    select: { id: true, reportedBySpg: true, store: { select: { termsType: true } }, items: { select: { qty: true } } },
  });
  const milikSaya = rows.map((r) => r.id);
  if (milikSaya.length === 0) return [];
  const perId = new Map(rows.map((r) => [r.id, r]));

  // Dilingkupi ke nota milik sales ini; sebelumnya seluruh daftar kerja dimuat
  // hanya untuk menyaringnya lagi di memori.
  const kerja = await daftarKerjaRetur({ storeReturnIds: milikSaya });

  return kerja
    .filter((k) => k.jenis === 'NRT')
    .map((k) => {
      const r = perId.get(k.id);
      return {
        id: k.id,
        noNrt: k.nomor,
        storeName: k.storeName ?? '—',
        tanggal: k.tanggal,
        nilaiKlaim: r?.store.termsType === "KONSI" ? null : (k.nilaiKlaim ?? 0),
        langkah: k.langkah,
        adaFoto: k.adaFoto,
        dariSpg: r?.reportedBySpg ?? false,
        jumlahBarang: (r?.items ?? []).reduce((n, i) => n + i.qty, 0),
      };
    });
}

export type BebanSaya = {
  id: string;
  noNrt: string | null;
  storeName: string | null;
  nilai: number;
  status: 'DITETAPKAN' | 'LUNAS';
  catatan: string | null;
  diputuskanPada: string | null;
};

/**
 * Beban selisih yang ditanggung sales ini.
 *
 * Hanya yang sudah DITETAPKAN ke orangnya — beban yang masih terbuka belum
 * jadi tanggungan siapa pun, dan menampilkannya di sini akan menuduh sales
 * atas sesuatu yang belum diputuskan.
 */
export async function bebanSaya(userId: string): Promise<BebanSaya[]> {
  const rows = await prisma.returnCharge.findMany({
    where: { bearerUserId: userId, status: { in: ['DITETAPKAN', 'LUNAS'] } },
    orderBy: [{ status: 'asc' }, { decidedAt: 'desc' }],
    select: {
      id: true,
      amount: true,
      status: true,
      note: true,
      decidedAt: true,
      store: { select: { name: true } },
      storeReturn: { select: { noNrt: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    noNrt: r.storeReturn?.noNrt ?? null,
    storeName: r.store?.name ?? null,
    nilai: angka(r.amount),
    status: r.status as BebanSaya['status'],
    catatan: r.note,
    diputuskanPada: r.decidedAt?.toISOString() ?? null,
  }));
}

/** Nota retur yang menunggu dicek gudang — layar anak gudang. */
/** Satu baris barang nota retur, untuk dihitung gudang per baris. */
export type BarisGudang = {
  itemId: string | null;
  variantSku: string;
  itemName: string;
  qty: number;
  price: number;
  condition: "LAYAK" | "RUSAK" | "EXPIRED";
};

export type MenungguGudang = {
  id: string;
  noNrt: string;
  storeName: string;
  tanggal: string;
  nilaiKlaim: number;
  caraKirim: string;
  adaFoto: boolean;
  dariSpg: boolean;
  /** Baris barang nota (kosong untuk nota yang hanya membawa total). */
  baris: BarisGudang[];
};

export async function menungguGudang(): Promise<MenungguGudang[]> {
  // Yatim tidak ditampilkan di layar gudang: yang belum berpasangan bukan
  // pekerjaan menghitung, melainkan pekerjaan menjodohkan di kantor.
  const kerja = (await daftarKerjaRetur({ tanpaYatim: true })).filter((k) => k.langkah === 'cek');
  const nota = kerja.length
    ? await prisma.storeReturn.findMany({
        where: { id: { in: kerja.map((k) => k.id) } },
        select: {
          id: true,
          reportedBySpg: true,
          items: {
            orderBy: { itemName: 'asc' },
            select: { itemId: true, variantSku: true, itemName: true, qty: true, price: true, condition: true },
          },
        },
      })
    : [];
  const perId = new Map(nota.map((n) => [n.id, n]));
  return kerja.map((k) => {
    const n = perId.get(k.id);
    return {
      id: k.id,
      noNrt: k.nomor,
      storeName: k.storeName ?? '—',
      tanggal: k.tanggal,
      nilaiKlaim: k.nilaiKlaim ?? 0,
      caraKirim: k.caraKirim,
      adaFoto: k.adaFoto,
      dariSpg: n?.reportedBySpg ?? false,
      baris: (n?.items ?? []).map((i) => ({
        itemId: i.itemId,
        variantSku: i.variantSku,
        itemName: i.itemName,
        qty: i.qty,
        price: angka(i.price),
        condition: i.condition,
      })),
    };
  });
}
