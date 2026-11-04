import { prisma } from '@elorae/db';
import { daftarPiutang, type BarisPiutang } from './queries';
import type { CekSelisih, StatusKlaim } from './rules';
import { kurangPerBarang } from "./selisih-retur";
import { adaSusulanSesudahLapor, daftarKerjaRetur, waktuDijodohkan } from './return-queries';

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
 * Tagihan konsinyasi ikut, DENGAN nilainya (P18 "berikan selengkapnya saja"),
 * tetapi hanya untuk pemegang toko sekarang (P31) — `daftarPiutang({ penagihId })`
 * menegakkannya di kueri.
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

/** Faktur satu toko, untuk layar rincian sales — tagihan konsinyasi dengan nilainya bagi pemegang toko (P18/P31). */
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
 * Yang ia TAGIH saja (aturan penagih, sama dengan layar Tagihan — tagihan
 * konsinyasi hanya bagi pemegang toko, P31), yang masih
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
 *
 * Kontrabon yang memegang tagihan konsinyasi hanya untuk pemegang toko SEKARANG
 * (P31, "pemegang toko") — nilainya nominal tagihan konsi. Tanpa `penontonId`
 * kontrabon itu tidak dibawa sama sekali: arah yang aman bila pemanggilnya
 * belum menyebut siapa yang melihat.
 */
export async function janjiBerjalanDiToko(storeId: string, penontonId?: string): Promise<JanjiToko[]> {
  const toko = penontonId ? await prisma.store.findUnique({ where: { id: storeId }, select: { salesmanId: true } }) : null;
  const bolehKonsi = penontonId !== undefined && toko?.salesmanId === penontonId;
  const rows = await prisma.collectionNote.findMany({
    where: {
      storeId,
      status: "BERJALAN",
      ...(bolehKonsi ? {} : { receivableLinks: { none: { receivable: { isConsignment: true } } } }),
    },
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
  /**
   * Nilai nota retur. Untuk toko KONSI hanya bila diminta `nilaiKonsi` (HP
   * salesman, P57); HP SPG tetap null (P18a — SPG tidak pernah melihat nilai
   * konsinyasi).
   */
  nilaiKlaim: number | null;
  langkah: string;
  adaFoto: boolean;
  /** Dilaporkan SPG dengan baris barang. */
  dariSpg: boolean;
  /** Jumlah potong di nota (hanya nota yang membawa baris barang). */
  jumlahBarang: number;
  /**
   * Nota ini dicatat oleh penonton sendiri. `false` = nota SPG di toko yang ia
   * pegang: hanya untuk dilihat — menarik, minta koreksi, dan lapor ulang
   * tetap milik pelapornya (penulisnya pun menolak orang lain).
   */
  milikSaya: boolean;
  /** Nama SPG pelapor, hanya untuk nota yang bukan milik penonton. */
  pelapor: string | null;
};

/**
 * Nota retur yang pernah dicatat orang ini.
 *
 * `termasukSpgTokoSaya` (layar salesman, bukan SPG): ikut nota yang dilaporkan
 * SPG di toko yang ia PEGANG sekarang (`Store.salesmanId`) — barang itu akan ia
 * bawa atau tagih potongannya, jadi ia perlu tahu. Nota sales lain di tokonya
 * tidak ikut: yang ditambahkan hanya laporan SPG.
 */
export async function returSaya(
  salesmanId: string,
  opsi?: { termasukSpgTokoSaya?: boolean; nilaiKonsi?: boolean },
): Promise<ReturSaya[]> {
  const rows = await prisma.storeReturn.findMany({
    where: opsi?.termasukSpgTokoSaya
      ? { OR: [{ salesmanId }, { reportedBySpg: true, store: { salesmanId } }] }
      : { salesmanId },
    orderBy: [{ claimDate: 'desc' }],
    take: BATAS_LAPANGAN,
    select: {
      id: true,
      salesmanId: true,
      reportedBySpg: true,
      salesman: { select: { name: true, email: true } },
      store: { select: { termsType: true } },
      items: { select: { qty: true } },
    },
  });
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const perId = new Map(rows.map((r) => [r.id, r]));

  // Dilingkupi ke nota yang terpilih di atas; sebelumnya seluruh daftar kerja
  // dimuat hanya untuk menyaringnya lagi di memori.
  const kerja = await daftarKerjaRetur({ storeReturnIds: ids });

  return kerja
    .filter((k) => k.jenis === 'NRT')
    .map((k) => {
      const r = perId.get(k.id);
      return {
        id: k.id,
        noNrt: k.nomor,
        storeName: k.storeName ?? '—',
        tanggal: k.tanggal,
        nilaiKlaim: r?.store.termsType === "KONSI" && !opsi?.nilaiKonsi ? null : (k.nilaiKlaim ?? 0),
        langkah: k.langkah,
        adaFoto: k.adaFoto,
        dariSpg: r?.reportedBySpg ?? false,
        jumlahBarang: (r?.items ?? []).reduce((n, i) => n + i.qty, 0),
        milikSaya: r?.salesmanId === salesmanId,
        pelapor: r && r.salesmanId !== salesmanId ? (r.salesman?.name ?? r.salesman?.email ?? null) : null,
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
  /** Yang sudah dipotong dari komisinya. */
  sudahDipotong: number;
  /** Yang masih akan dipotong. */
  sisa: number;
  /** Potongan yang melebihi besarnya sekarang — dikembalikan (P87). */
  kelebihan: number;
  /** Seluruh barangnya kembali lewat susulan: bebannya nol, barisnya tetap. */
  pulih: boolean;
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
      settledAmount: true,
      status: true,
      note: true,
      decidedAt: true,
      store: { select: { name: true } },
      storeReturn: { select: { noNrt: true } },
    },
  });
  const sen = (n: number) => Math.round(n * 100);
  return rows.map((r) => ({
    id: r.id,
    noNrt: r.storeReturn?.noNrt ?? null,
    storeName: r.store?.name ?? null,
    nilai: angka(r.amount),
    status: r.status as BebanSaya['status'],
    catatan: r.note,
    diputuskanPada: r.decidedAt?.toISOString() ?? null,
    sudahDipotong: angka(r.settledAmount),
    sisa: Math.max(0, sen(angka(r.amount)) - sen(angka(r.settledAmount))) / 100,
    kelebihan: Math.max(0, sen(angka(r.settledAmount)) - sen(angka(r.amount))) / 100,
    pulih: sen(angka(r.amount)) === 0,
  }));
}

/** Satu selisih retur yang perlu dicari sales pemegang toko (P88). */
export type SelisihReturSaya = {
  chargeId: string;
  storeReturnId: string;
  noNrt: string;
  noNri: string | null;
  storeId: string;
  storeName: string;
  /** Tanggal nota retur (ISO). */
  tanggal: string;
  /** Nilai selisihnya — juga untuk toko konsinyasi (P18: HP salesman). */
  nilai: number;
  /** Barang yang kurang, sesudah hitungan asli dan setiap susulan. */
  barang: { itemName: string; variantSku: string | null; qtyKurang: number }[];
  /** SPG toko itu, kalau ada — mungkin mereka yang tahu di mana barangnya. */
  spg: string[];
  cek: CekSelisih;
  cekCatatan: string | null;
  cekPada: string | null;
  /** Masih menunggu laporan sales: belum dilapor, atau barang temuannya sudah datang dan masih ada sisa. */
  perluDicek: boolean;
};

/**
 * Selisih retur yang belum diputuskan di toko yang SEKARANG dipegang orang ini
 * (rotasi toko memindahkan tugasnya). Yang ditandai `perluDicek` dihitung di
 * beranda (`jumlahSelisihPerluDicek`).
 */
export async function selisihReturSaya(userId: string): Promise<SelisihReturSaya[]> {
  const rows = await prisma.returnCharge.findMany({
    where: {
      status: 'TERBUKA',
      amount: { gt: 0 },
      storeReturn: { status: { not: 'BATAL' }, store: { salesmanId: userId } },
    },
    orderBy: [{ createdAt: 'asc' }],
    take: BATAS_LAPANGAN,
    select: {
      id: true,
      amount: true,
      checkStatus: true,
      checkNote: true,
      checkedAt: true,
      storeReturn: {
        select: {
          id: true,
          noNrt: true,
          claimDate: true,
          storeId: true,
          store: { select: { name: true } },
          items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } },
          warehouseReturn: {
            select: { noNri: true, status: true, items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } } },
          },
          followUps: {
            where: { status: 'FINAL' },
            select: { id: true, createdAt: true, items: { select: { itemId: true, variantSku: true, itemName: true, qty: true } } },
          },
        },
      },
    },
  });
  const tokoIds = [...new Set(rows.flatMap((r) => (r.storeReturn ? [r.storeReturn.storeId] : [])))];
  const dijodohkan = await waktuDijodohkan(rows.flatMap((r) => r.storeReturn?.followUps.map((f) => f.id) ?? []));
  const spg = tokoIds.length
    ? await prisma.user.findMany({ where: { assignedStoreId: { in: tokoIds } }, select: { name: true, email: true, assignedStoreId: true } })
    : [];
  const spgPerToko = new Map<string, string[]>();
  for (const u of spg) {
    if (!u.assignedStoreId) continue;
    spgPerToko.set(u.assignedStoreId, [...(spgPerToko.get(u.assignedStoreId) ?? []), u.name ?? u.email]);
  }
  return rows.flatMap((r) => {
    const n = r.storeReturn;
    if (!n) return [];
    const hitungan = [
      ...(n.warehouseReturn?.status === 'FINAL' ? n.warehouseReturn.items : []),
      ...n.followUps.flatMap((f) => f.items),
    ];
    const cek = r.checkStatus as CekSelisih;
    // Satu aturan dengan daftar kerja kantor (`adaSusulanSesudahLapor`): saat susulan DICATAT gudang
    // atau DIJADIKAN susulan nota ini, mana yang lebih akhir — bukan `receivedAt`, tanggal datang
    // ketikan orang yang bisa lebih awal dari laporan sales walau barangnya baru dicatat sesudahnya.
    const susulanSesudahLapor = adaSusulanSesudahLapor(
      n.followUps.map((f) => ({ createdAt: f.createdAt, dijodohkanAt: dijodohkan.get(f.id) ?? null })),
      r.checkedAt,
    );
    return [
      {
        chargeId: r.id,
        storeReturnId: n.id,
        noNrt: n.noNrt,
        noNri: n.warehouseReturn?.noNri ?? null,
        storeId: n.storeId,
        storeName: n.store.name,
        tanggal: n.claimDate.toISOString(),
        nilai: angka(r.amount),
        barang: kurangPerBarang(n.items, hitungan)
          .filter((k) => k.qtyKurang > 0)
          .map((k) => ({ itemName: k.itemName, variantSku: k.variantSku, qtyKurang: k.qtyKurang })),
        spg: spgPerToko.get(n.storeId) ?? [],
        cek,
        cekCatatan: r.checkNote,
        cekPada: r.checkedAt?.toISOString() ?? null,
        perluDicek: cek === 'DITANYAKAN' || (cek === 'DITEMUKAN' && susulanSesudahLapor),
      },
    ];
  });
}

/** Berapa selisih retur yang menunggu laporan sales ini — tugas di beranda HP. */
export async function jumlahSelisihPerluDicek(userId: string): Promise<number> {
  return (await selisihReturSaya(userId)).filter((s) => s.perluDicek).length;
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

/**
 * Nota retur yang selisihnya masih hidup — gudang menghitung barang SUSULAN-nya.
 * Yang dilaporkan sales "ditemukan" (barangnya sedang dikirim balik) tampil
 * lebih dulu. Bentuknya sama dengan `MenungguGudang`; halaman gudang
 * mengosongkan klaim dan jumlah kurangnya sebelum sampai ke penghitung
 * (`untukPenghitungSusulan` — hitungan buta), dan catatan sales tidak pernah
 * dibawa. `tidakBolehMenghitung`: pelapor nota, pelapor cek, penanggung beban,
 * dan pemegang toko — dua tangan.
 */
export type MenungguSusulan = MenungguGudang & {
  chargeId: string;
  dilaporkanDitemukan: boolean;
  tidakBolehMenghitung: string[];
};

export async function menungguSusulanGudang(): Promise<MenungguSusulan[]> {
  const rows = await prisma.returnCharge.findMany({
    where: {
      status: { in: ['TERBUKA', 'DITETAPKAN'] },
      amount: { gt: 0 },
      // Begitu sebagian beban dipotong, penulisnya menolak susulan (`SUDAH_DIPOTONG`, P87 bawaan
      // yang disetujui) — beban itu tidak ditawarkan ke gudang lagi.
      settledAmount: 0,
      storeReturn: { status: { not: 'BATAL' } },
    },
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      checkStatus: true,
      checkedById: true,
      bearerUserId: true,
      storeReturn: {
        select: {
          id: true,
          noNrt: true,
          claimDate: true,
          claimedAmount: true,
          deliveryMethod: true,
          photoUrl: true,
          reportedBySpg: true,
          salesmanId: true,
          store: { select: { name: true, salesmanId: true } },
          items: {
            orderBy: { itemName: 'asc' },
            select: { itemId: true, variantSku: true, itemName: true, qty: true, price: true, condition: true },
          },
        },
      },
    },
  });
  const hasil: MenungguSusulan[] = rows.flatMap((r) => {
    const n = r.storeReturn;
    if (!n) return [];
    return [
      {
        id: n.id,
        noNrt: n.noNrt,
        storeName: n.store.name,
        tanggal: n.claimDate.toISOString(),
        nilaiKlaim: angka(n.claimedAmount),
        caraKirim: n.deliveryMethod,
        adaFoto: Boolean(n.photoUrl),
        dariSpg: n.reportedBySpg,
        baris: n.items.map((i) => ({
          itemId: i.itemId,
          variantSku: i.variantSku,
          itemName: i.itemName,
          qty: i.qty,
          price: angka(i.price),
          condition: i.condition,
        })),
        chargeId: r.id,
        dilaporkanDitemukan: r.checkStatus === 'DITEMUKAN',
        tidakBolehMenghitung: [n.salesmanId, r.checkedById, r.bearerUserId, n.store.salesmanId].filter(
          (x): x is string => Boolean(x),
        ),
      },
    ];
  });
  return hasil.sort((a, b) => Number(b.dilaporkanDitemukan) - Number(a.dilaporkanDitemukan));
}
