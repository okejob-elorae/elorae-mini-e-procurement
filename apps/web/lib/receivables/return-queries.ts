import { prisma } from '@elorae/db';
import { REF_KOMISI_SALESMAN } from "@/lib/spg/hilang";
import {
  awalanKembaliRetur,
  awalanPotongRetur,
  ringkasPotonganRetur,
  type PotonganReturSales,
} from "@/app/backoffice/laporan/komisi-salesman/potongan-retur";
import { nilaiFisikNota } from "./deductions";
import { giliranRetur, langkahRetur, type CekSelisih, type LangkahRetur } from './rules';
import { JEJAK } from "./jejak";

const angka = (v: unknown): number => Number(v ?? 0);

export type CaraKirim = 'SALES' | 'TOKO' | 'EKSPEDISI';
export type StatusBeban = 'TERBUKA' | 'DITETAPKAN' | 'LUNAS';
export type Penanggung = 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN';

/**
 * Satu baris daftar kerja retur.
 *
 * Dua jenis baris hidup di daftar yang sama: nota toko (NRT) dan penerimaan
 * gudang yang belum berpasangan. Menggabungkannya disengaja — kalau dipisah jadi
 * dua halaman, penerimaan yatim tidak pernah dilihat siapa pun, karena tidak ada
 * yang tahu ia ada sampai notanya muncul.
 *
 * `langkah` dan `giliran` dibawa sebagai kata, bukan kalimat jadi, supaya
 * kalimatnya ikut berganti bahasa bersama sisa aplikasi.
 */
export type BarisKerjaRetur = {
  jenis: 'NRT' | 'GUDANG_YATIM';
  id: string;
  nomor: string;
  nomorPasangan: string | null;
  storeId: string | null;
  storeName: string | null;
  salesmanId: string | null;
  salesmanName: string | null;
  tanggal: string;
  caraKirim: CaraKirim;
  adaFoto: boolean;
  nilaiKlaim: number | null;
  nilaiFisik: number | null;
  selisih: number;
  langkah: LangkahRetur;
  /**
   * Giliran siapa, sesudah hasil cek sales pemegang toko ikut dibaca
   * (`giliranRetur`): selisih yang masih ditanyakan ke toko dan SPG-nya giliran
   * `sales`, barang yang dilaporkan ditemukan dan belum dihitung giliran `gudang`.
   */
  giliran: ReturnType<typeof giliranRetur>;
  bebanId: string | null;
  bebanStatus: StatusBeban | null;
  penanggung: Penanggung | null;
  jumlahPotongan: number;
  nilaiDipotong: number;
  /** Hasil cek sales pemegang toko atas selisihnya; `null` = nota tanpa beban selisih. */
  cekSelisih: CekSelisih | null;
  /** Hitungan barang susulan nota ini yang sudah final (P22a). */
  jumlahSusulan: number;
};

const PILIH_NRT = {
  id: true,
  noNrt: true,
  storeId: true,
  salesmanId: true,
  claimDate: true,
  deliveryMethod: true,
  claimedAmount: true,
  photoUrl: true,
  status: true,
  store: { select: { name: true, salesmanId: true } },
  salesman: { select: { name: true } },
  warehouseReturn: { select: { noNri: true, physicalAmount: true, status: true } },
  // Barang susulan yang sudah dihitung gudang ikut menjadi nilai fisik nota (P22a).
  followUps: { where: { status: "FINAL" }, select: { id: true, physicalAmount: true, createdAt: true } },
  charges: {
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, bearer: true, amount: true, checkStatus: true, checkedAt: true },
  },
  deductions: { select: { amount: true } },
} as const;

/**
 * Satu nota toko sebagai baris daftar kerja. Diekspor untuk diuji; pemanggil
 * lain memakai `daftarKerjaRetur`/`rincianRetur`.
 *
 * Nilai fisiknya `nilaiFisikNota` — hitungan asli DITAMBAH barang susulan yang
 * sudah final — sama dengan yang dibaca penahan Aturan 2 dan penulis selisihnya.
 * Kalau di sini hanya hitungan asli, nota yang selisihnya sudah ditutup barang
 * susulan tetap tampil "menunggu keputusan" tanpa beban yang bisa diputuskan.
 */
export function dariNrt(r: {
  id: string;
  noNrt: string;
  storeId: string;
  claimDate: Date;
  deliveryMethod: string;
  claimedAmount: unknown;
  photoUrl: string | null;
  status: string;
  store: { name: string; salesmanId: string | null };
  salesmanId: string | null;
  salesman: { name: string | null } | null;
  warehouseReturn: { noNri: string; physicalAmount: unknown; status: string } | null;
  followUps: { physicalAmount: unknown; createdAt: Date; dijodohkanAt?: Date | null }[];
  charges: {
    id: string;
    status: string;
    bearer: string | null;
    amount: unknown;
    checkStatus: string;
    checkedAt: Date | null;
  }[];
  deductions: { amount: unknown }[];
}): BarisKerjaRetur {
  const nri = r.warehouseReturn;
  // Hitungan yang masih draft dianggap belum ada — sama seperti di pembaca
  // potongan. Angka yang masih bisa berubah tidak melepas apa pun.
  const final = nri !== null && nri.status === 'FINAL';
  const nilaiKlaim = angka(r.claimedAmount);
  const nilaiFisik = final ? nilaiFisikNota({ warehouseReturn: nri, followUps: r.followUps }) : null;
  const beban = r.charges[0] ?? null;
  const bebanDiputuskan = r.charges.some((c) => c.status !== 'TERBUKA');
  const dilapor = beban?.checkedAt ?? null;
  // Toko tanpa pemegang: tidak ada yang bisa menanyakan ke toko — giliran kantor.
  const cek =
    beban && beban.status === "TERBUKA" && r.store.salesmanId
      ? {
          status: beban.checkStatus as CekSelisih,
          adaSusulanSesudahLapor: adaSusulanSesudahLapor(r.followUps, dilapor),
          // P88 belum menetapkan batas hari lapor sales — tidak ada batas yang lewat.
          batasLewat: false,
        }
      : null;

  const langkah = langkahRetur({
    dibatalkan: r.status === 'BATAL',
    adaNotaToko: true,
    adaHitunganFinal: final,
    nilaiKlaim,
    nilaiFisik,
    bebanDiputuskan,
  });

  return {
    jenis: 'NRT',
    id: r.id,
    nomor: r.noNrt,
    nomorPasangan: nri?.noNri ?? null,
    storeId: r.storeId,
    storeName: r.store.name,
    salesmanId: r.salesmanId,
    salesmanName: r.salesman?.name ?? null,
    tanggal: r.claimDate.toISOString(),
    caraKirim: r.deliveryMethod as CaraKirim,
    adaFoto: Boolean(r.photoUrl),
    nilaiKlaim,
    nilaiFisik,
    selisih: nilaiFisik === null ? 0 : Math.max(0, nilaiKlaim - nilaiFisik),
    langkah,
    giliran: giliranRetur(langkah, cek),
    bebanId: beban?.id ?? null,
    bebanStatus: (beban?.status as StatusBeban) ?? null,
    penanggung: (beban?.bearer as Penanggung) ?? null,
    jumlahPotongan: r.deductions.length,
    nilaiDipotong: r.deductions.reduce((s, d) => s + angka(d.amount), 0),
    cekSelisih: beban ? (beban.checkStatus as CekSelisih) : null,
    jumlahSusulan: r.followUps.length,
  };
}

/**
 * Adakah barang susulan yang masuk ke nota ini SESUDAH sales pemegang toko melapor (`dilapor`)?
 * Satu aturan giliran untuk daftar kerja kantor (`dariNrt`) dan HP pemegang (`selisihReturSaya`).
 *
 * Yang dibandingkan: kapan susulan DICATAT atau DIJADIKAN susulan nota ini (jejak
 * RETUR_SUSULAN_DIJODOHKAN, lihat `waktuDijodohkan`), mana yang lebih akhir — bukan tanggal
 * terimanya: `receivedAt` disimpan pukul 00.00 WIB, jadi susulan yang dihitung siang sesudah
 * laporan pagi tampak "sebelum". Penerimaan tanpa nota yang dihitung SEBELUM laporan tetapi
 * dijadikan susulan SESUDAHNYA adalah barang yang datang sesudah laporan.
 */
export function adaSusulanSesudahLapor(
  followUps: { createdAt: Date; dijodohkanAt?: Date | null }[],
  dilapor: Date | null,
): boolean {
  if (dilapor === null) return false;
  return followUps.some((f) => (f.dijodohkanAt && f.dijodohkanAt > f.createdAt ? f.dijodohkanAt : f.createdAt) > dilapor);
}

/**
 * Kapan tiap hitungan gudang terakhir DIJADIKAN susulan sebuah nota (`jadikanSusulan`) — dari
 * jejaknya, karena tidak ada kolom untuk itu. Hitungan yang langsung dicatat sebagai susulan
 * (`catatHitunganSusulan`) tidak punya jejak ini: waktunya `createdAt`. Satu kueri untuk semua id.
 */
export async function waktuDijodohkan(ids: string[]): Promise<Map<string, Date>> {
  const peta = new Map<string, Date>();
  if (ids.length === 0) return peta;
  const jejak = await prisma.auditLog.findMany({
    where: { action: JEJAK.RETUR_SUSULAN_DIJODOHKAN, entityType: "WarehouseReturn", entityId: { in: ids } },
    select: { entityId: true, createdAt: true },
  });
  for (const j of jejak) {
    const ada = peta.get(j.entityId);
    if (!ada || j.createdAt > ada) peta.set(j.entityId, j.createdAt);
  }
  return peta;
}

export type LingkupKerjaRetur = {
  /** Hanya nota tertentu — dipakai layar yang menampilkan satu folder atau satu sales. */
  storeReturnIds?: string[];
  storeId?: string;
  /** Sembunyikan penerimaan gudang yatim; sebagian layar tidak memerlukannya. */
  tanpaYatim?: boolean;
};

/**
 * Daftar kerja retur — nota toko dan penerimaan gudang yatim dalam satu daftar.
 *
 * Lingkupnya opsional dan sengaja: layar daftar kerja memang butuh semuanya,
 * tapi layar yang cuma menampilkan satu toko atau satu sales tidak — dan
 * sebelum lingkup ini ada, membuka satu folder arsip memuat setiap nota retur
 * yang pernah dicatat.
 */
export async function daftarKerjaRetur(
  lingkup?: LingkupKerjaRetur,
): Promise<BarisKerjaRetur[]> {
  const [nrt, yatim] = await Promise.all([
    prisma.storeReturn.findMany({
      where: {
        ...(lingkup?.storeReturnIds ? { id: { in: lingkup.storeReturnIds } } : {}),
        ...(lingkup?.storeId ? { storeId: lingkup.storeId } : {}),
      },
      orderBy: [{ claimDate: 'desc' }],
      select: PILIH_NRT,
    }),
    lingkup?.tanpaYatim || lingkup?.storeReturnIds
      ? Promise.resolve([])
      : prisma.warehouseReturn.findMany({
      // Hitungan barang susulan juga tanpa `storeReturnId`, tapi ia bukan yatim — ia milik
      // nota yang selisihnya ia kurangi (`followUpOfStoreReturnId`), dan penulisnya menolak
      // menjodohkan atau memindahkannya.
      where: {
        storeReturnId: null,
        followUpOfStoreReturnId: null,
        ...(lingkup?.storeId ? { storeId: lingkup.storeId } : {}),
      },
      orderBy: [{ receivedAt: 'desc' }],
      select: {
        id: true,
        noNri: true,
        storeId: true,
        receivedAt: true,
        deliveryMethod: true,
        physicalAmount: true,
        store: { select: { name: true } },
      },
    }),
  ]);

  const dijodohkan = await waktuDijodohkan(nrt.flatMap((r) => r.followUps.map((f) => f.id)));
  const baris: BarisKerjaRetur[] = [
    ...nrt.map((r) => dariNrt({ ...r, followUps: r.followUps.map((f) => ({ ...f, dijodohkanAt: dijodohkan.get(f.id) ?? null })) })),
    ...yatim.map((r) => ({
      jenis: 'GUDANG_YATIM' as const,
      id: r.id,
      nomor: r.noNri,
      nomorPasangan: null,
      storeId: r.storeId,
      storeName: r.store?.name ?? null,
      salesmanId: null,
      salesmanName: null,
      tanggal: r.receivedAt.toISOString(),
      caraKirim: r.deliveryMethod as CaraKirim,
      adaFoto: false,
      nilaiKlaim: null,
      nilaiFisik: angka(r.physicalAmount),
      selisih: 0,
      langkah: 'jodoh' as const,
      giliran: 'keuangan' as const,
      bebanId: null,
      bebanStatus: null,
      penanggung: null,
      jumlahPotongan: 0,
      nilaiDipotong: 0,
      cekSelisih: null,
      jumlahSusulan: 0,
    })),
  ];

  // Yang perlu dikerjakan naik ke atas; sisanya menurut tanggal.
  const prioritas: Record<LangkahRetur, number> = {
    keputusan: 0,
    cek: 1,
    jodoh: 2,
    beres: 3,
    batal: 4,
  };
  return baris.sort(
    (a, b) => prioritas[a.langkah] - prioritas[b.langkah] || b.tanggal.localeCompare(a.tanggal),
  );
}

export type RingkasanKerjaRetur = {
  perLangkah: Record<LangkahRetur, number>;
  perluDikerjakan: number;
  /** Nilai yang masih ditahan dari piutang oleh retur yang belum tuntas. */
  nilaiTertahan: number;
};

/**
 * Ringkasan kepala halaman.
 *
 * `nilaiTertahan` dihitung dari yang benar-benar SUDAH DIPOTONG toko, bukan dari
 * nilai klaim notanya. Nota yang belum dipakai memotong pembayaran mana pun
 * tidak menahan apa-apa — uangnya belum berkurang.
 */
export function ringkasKerjaRetur(baris: BarisKerjaRetur[]): RingkasanKerjaRetur {
  const perLangkah: Record<LangkahRetur, number> = {
    keputusan: 0,
    cek: 0,
    jodoh: 0,
    beres: 0,
    batal: 0,
  };
  let nilaiTertahan = 0;
  for (const b of baris) {
    perLangkah[b.langkah] += 1;
    if (b.langkah === 'cek' || b.langkah === 'batal') {
      nilaiTertahan += b.nilaiDipotong;
    } else if (b.langkah === 'keputusan' && (b.nilaiKlaim ?? 0) > 0) {
      // Sebagian nota mungkin belum dipotong penuh; yang ditahan hanya porsi
      // dari yang sudah dipotong — prorata yang sama seperti di aturannya.
      nilaiTertahan += b.nilaiDipotong * (b.selisih / (b.nilaiKlaim ?? 1));
    }
  }
  return {
    perLangkah,
    perluDikerjakan: perLangkah.keputusan + perLangkah.cek + perLangkah.jodoh,
    nilaiTertahan,
  };
}

export type RincianRetur = {
  baris: BarisKerjaRetur;
  note: string | null;
  photoUrl: string | null;
  barangKlaim: { itemName: string; qty: number; price: number; amount: number }[];
  /** Baris hitungan asli DITAMBAH baris barang susulan yang sudah final. */
  barangFisik: {
    itemName: string;
    qtyClaim: number;
    qty: number;
    price: number;
    amount: number;
    condition: string;
  }[];
  gudang: {
    id: string;
    noNri: string;
    olehNama: string | null;
    diterimaPada: string;
    catatan: string | null;
  } | null;
  beban: {
    id: string;
    amount: number;
    status: StatusBeban;
    penanggung: Penanggung | null;
    catatan: string | null;
    diputuskanOleh: string | null;
    diputuskanPada: string | null;
  } | null;
  potongan: { docNo: string; amount: number; status: string }[];
};

/** Satu nota retur toko, kedua sisinya, siap dibandingkan per barang. */
export async function rincianRetur(storeReturnId: string): Promise<RincianRetur | null> {
  const r = await prisma.storeReturn.findUnique({
    where: { id: storeReturnId },
    select: {
      ...PILIH_NRT,
      note: true,
      items: { select: { itemName: true, qty: true, price: true, amount: true } },
      warehouseReturn: {
        select: {
          id: true,
          noNri: true,
          physicalAmount: true,
          status: true,
          receivedAt: true,
          note: true,
          warehouseUser: { select: { name: true } },
          items: {
            select: {
              itemName: true,
              qtyClaim: true,
              qty: true,
              price: true,
              amount: true,
              condition: true,
            },
          },
        },
      },
      // Barang susulan ikut di sisi gudang: nilai fisik nota adalah hitungan asli
      // DITAMBAH susulannya (`nilaiFisikNota`), jadi barisnya juga.
      followUps: {
        where: { status: "FINAL" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          physicalAmount: true,
          createdAt: true,
          items: {
            select: {
              itemName: true,
              qtyClaim: true,
              qty: true,
              price: true,
              amount: true,
              condition: true,
            },
          },
        },
      },
      charges: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          amount: true,
          status: true,
          bearer: true,
          note: true,
          decidedAt: true,
          checkStatus: true,
          checkedAt: true,
          decidedBy: { select: { name: true } },
        },
      },
      deductions: {
        select: {
          amount: true,
          paymentClaim: { select: { docNo: true, status: true } },
        },
      },
    },
  });
  if (!r) return null;

  const nri = r.warehouseReturn;
  const beban = r.charges[0] ?? null;
  const dijodohkan = await waktuDijodohkan(r.followUps.map((f) => f.id));

  return {
    baris: dariNrt({
      ...r,
      followUps: r.followUps.map((f) => ({ ...f, dijodohkanAt: dijodohkan.get(f.id) ?? null })),
      warehouseReturn: nri
        ? { noNri: nri.noNri, physicalAmount: nri.physicalAmount, status: nri.status }
        : null,
    }),
    note: r.note,
    photoUrl: r.photoUrl,
    barangKlaim: r.items.map((i) => ({
      itemName: i.itemName,
      qty: i.qty,
      price: angka(i.price),
      amount: angka(i.amount),
    })),
    barangFisik: [...(nri?.items ?? []), ...r.followUps.flatMap((f) => f.items)].map((i) => ({
      itemName: i.itemName,
      qtyClaim: i.qtyClaim,
      qty: i.qty,
      price: angka(i.price),
      amount: angka(i.amount),
      condition: i.condition,
    })),
    gudang: nri
      ? {
          id: nri.id,
          noNri: nri.noNri,
          olehNama: nri.warehouseUser?.name ?? null,
          diterimaPada: nri.receivedAt.toISOString(),
          catatan: nri.note,
        }
      : null,
    beban: beban
      ? {
          id: beban.id,
          amount: angka(beban.amount),
          status: beban.status as StatusBeban,
          penanggung: (beban.bearer as Penanggung) ?? null,
          catatan: beban.note,
          diputuskanOleh: beban.decidedBy?.name ?? null,
          diputuskanPada: beban.decidedAt?.toISOString() ?? null,
        }
      : null,
    potongan: r.deductions.map((d) => ({
      docNo: d.paymentClaim.docNo,
      amount: angka(d.amount),
      status: d.paymentClaim.status,
    })),
  };
}

/** Nota toko yang masih menunggu hitungan gudang — calon pasangan bagi yatim. */
export async function notaBelumBerpasangan(storeId?: string | null) {
  return prisma.storeReturn.findMany({
    where: {
      status: { not: 'BATAL' },
      warehouseReturn: null,
      ...(storeId ? { storeId } : {}),
    },
    orderBy: { claimDate: 'desc' },
    select: {
      id: true,
      noNrt: true,
      claimedAmount: true,
      claimDate: true,
      store: { select: { id: true, name: true } },
    },
  });
}

/**
 * Katalog barang untuk pemilih baris.
 *
 * Hanya barang aktif. Baris yang menunjuk salah satunya akan menambah stok saat
 * gudang menyimpan hitungan; yang hanya diketik namanya tidak.
 */
/**
 * Batas katalog barang.
 *
 * Ada batasnya karena daftar pilihan ribuan baris tidak bisa dipakai siapa pun.
 * Tapi batas yang DIAM berarti barang ke-501 tidak bisa dipilih dan tidak ada
 * yang memberi tahu — jadi kalau terpotong, ia mengeluh ke log.
 */
const BATAS_KATALOG = 500;

export async function katalogBarang(): Promise<{ value: string; label: string; nama: string }[]> {
  // `Item` menyimpan nama dua bahasa. Modul ini berbahasa Indonesia, dan nama
  // itulah yang dipakai menyandingkan baris dengan nota toko.
  const [rows, jumlah] = await Promise.all([
    prisma.item.findMany({
      where: { isActive: true },
      orderBy: { nameId: 'asc' },
      select: { id: true, sku: true, nameId: true },
      take: BATAS_KATALOG,
    }),
    prisma.item.count({ where: { isActive: true } }),
  ]);
  if (jumlah > BATAS_KATALOG) {
    console.warn(
      `[katalogBarang] ${jumlah} barang aktif, hanya ${BATAS_KATALOG} yang bisa dipilih — ` +
        'pemilihnya perlu diganti pencarian sisi server sebelum sisanya jadi tak terjangkau.',
    );
  }
  return rows.map((i) => ({ value: i.id, label: `${i.sku} · ${i.nameId}`, nama: i.nameId }));
}

/**
 * Kandidat penanggung beban ke sales.
 *
 * Beban ke "sales" harus melekat pada ORANG, bukan pada peran — itulah yang
 * membuatnya bisa muncul di layar orang itu dan dipotong dari komisinya nanti.
 * Tanpa id orangnya, beban SALES tersimpan sebagai tuduhan tanpa alamat.
 */
export async function kandidatPenanggung(): Promise<{ id: string; name: string }[]> {
  const BATAS = 200;
  const [rows, jumlah] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true },
      take: BATAS,
    }),
    prisma.user.count(),
  ]);
  if (jumlah > BATAS) {
    console.warn(
      `[kandidatPenanggung] ${jumlah} pengguna, hanya ${BATAS} yang bisa dipilih sebagai penanggung.`,
    );
  }
  // Nama boleh kosong di `User`; surel dipakai sebagai gantinya supaya tidak
  // ada baris pilihan yang tampil tanpa label sama sekali.
  return rows.map((u) => ({ id: u.id, name: u.name ?? u.email }));
}

export type { PotonganReturSales };

/**
 * Kolom "Selisih retur" di Laporan → Komisi salesman (layar dan Excel): potongan
 * beban selisih retur per salesman untuk satu bulan WIB (`YYYY-MM`). SATU-SATUNYA
 * pembacanya — halaman laporan dan ekspor Excel-nya mengimpor dari sini, jangan
 * ada salinan kedua di folder laporan.
 *
 * Aturannya (`ringkasPotonganRetur` dan awalan `refId`-nya) tinggal di
 * `potongan-retur.ts` milik laporan, yang aman diimpor komponen klien; berkas ini
 * hanya mengambil barisnya:
 * - beban = beban SALES milik orang itu yang sudah diputuskan (DITETAPKAN atau
 *   LUNAS) — himpunan yang sama dengan yang dibaca penulisnya
 *   (`tandaiBebanReturDipotong` di potong-beban-retur.ts). Kalau sisanya dihitung
 *   lain, tombol "Tandai dipotong" menawarkan angka yang ditolak penulisnya
 *   (`MELEBIHI_SISA`);
 * - potongan "bulan ini" dikenali dari `refId` yang ditulis penulisnya
 *   (`<sales>:<bulan>:<kunci>`, pengembalian `kembali:<sales>:<bulan>:<kunci>`) —
 *   kunci yang sama yang dipakai penulisnya untuk idempotensi. Beban yang sudah
 *   dipotong tidak bisa lagi berganti penanggung (`SUDAH_DIPOTONG`) dan statusnya
 *   tetap DITETAPKAN/LUNAS, jadi setiap baris potongan selalu jatuh pada beban
 *   di himpunan di atas.
 */
export async function potonganReturSalesBulan(
  salesmanIds: string[],
  bulan: string,
): Promise<Record<string, PotonganReturSales>> {
  const ids = [...new Set(salesmanIds)];
  if (ids.length === 0) return {};
  const [beban, potongan] = await Promise.all([
    prisma.returnCharge.findMany({
      where: { bearer: "SALES", bearerUserId: { in: ids }, status: { in: ["DITETAPKAN", "LUNAS"] } },
      select: { bearerUserId: true, amount: true, settledAmount: true },
    }),
    prisma.returnChargeDeduction.findMany({
      where: {
        refType: REF_KOMISI_SALESMAN,
        OR: ids.flatMap((id) => [
          { refId: { startsWith: awalanPotongRetur(id, bulan) } },
          { refId: { startsWith: awalanKembaliRetur(id, bulan) } },
        ]),
      },
      select: { refId: true, amount: true },
    }),
  ]);
  return ringkasPotonganRetur({
    salesmanIds: ids,
    bulan,
    beban: beban.map((b) => ({ bearerUserId: b.bearerUserId, amount: angka(b.amount), settledAmount: angka(b.settledAmount) })),
    potongan: potongan.map((p) => ({ refId: p.refId, amount: angka(p.amount) })),
  });
}

/**
 * Toko aktif, untuk memilih saat mencatat nota retur. `hanyaMilik` (layar HP
 * saat kunci "hanya toko sendiri" menyala) menyempitkannya ke toko yang
 * dipegang sales itu.
 */
export async function tokoUntukRetur(opsi?: {
  hanyaMilik?: string;
  /** SPG: hanya toko tetapnya sendiri. */
  hanyaToko?: string;
}): Promise<{ id: string; name: string }[]> {
  return prisma.store.findMany({
    where: {
      isActive: true,
      ...(opsi?.hanyaMilik ? { salesmanId: opsi.hanyaMilik } : {}),
      ...(opsi?.hanyaToko ? { id: opsi.hanyaToko } : {}),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

export type FolderArsip = {
  storeId: string | null;
  storeName: string | null;
  jumlah: number;
  nilai: number;
  /** Ada nota di dalamnya yang masih menggantung — titik merah di sudut. */
  menggantung: boolean;
};

export type IsiArsip = {
  id: string;
  jenis: 'NRT' | 'GUDANG_YATIM';
  nomor: string;
  tanggal: string;
  nilai: number;
  fotoUrl: string | null;
  langkah: LangkahRetur;
  menggantung: boolean;
};

/** Sebuah nota masih menggantung selama belum ada yang bisa mengarsipkannya. */
function menggantung(langkah: LangkahRetur): boolean {
  return langkah === 'cek' || langkah === 'keputusan' || langkah === 'jodoh';
}

/**
 * Folder arsip, satu per toko.
 *
 * Disusun dari `daftarKerjaRetur` yang sama, bukan dari kueri agregat sendiri.
 * Kalau "menggantung" di sini dihitung ulang dengan caranya sendiri, titik
 * merah di arsip bisa menyala untuk nota yang di daftar kerja sudah bersih —
 * dan tidak akan ada yang tahu mana yang benar.
 *
 * Folder "Tanpa Nota Toko" (`storeId` null) menampung penerimaan gudang yang
 * belum berpasangan. Ia sengaja berdiri sendiri: barangnya nyata dan sudah di
 * gudang, ia hanya belum tahu milik toko yang mana.
 */
export async function folderArsip(): Promise<FolderArsip[]> {
  const [baris, toko] = await Promise.all([
    daftarKerjaRetur(),
    prisma.store.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const peta = new Map<string, FolderArsip>();
  // Semua toko aktif punya foldernya, termasuk yang masih kosong — folder
  // kosong memberi tahu bahwa toko itu memang belum pernah retur, sedangkan
  // folder yang hilang hanya menimbulkan pertanyaan.
  for (const s of toko) {
    peta.set(s.id, {
      storeId: s.id,
      storeName: s.name,
      jumlah: 0,
      nilai: 0,
      menggantung: false,
    });
  }

  const yatim: FolderArsip = {
    storeId: null,
    storeName: null,
    jumlah: 0,
    nilai: 0,
    menggantung: false,
  };

  for (const b of baris) {
    const folder = b.jenis === 'GUDANG_YATIM' ? yatim : b.storeId ? peta.get(b.storeId) : undefined;
    if (!folder) continue;
    folder.jumlah += 1;
    folder.nilai += b.nilaiKlaim ?? b.nilaiFisik ?? 0;
    if (menggantung(b.langkah)) folder.menggantung = true;
  }

  // Yang berisi lebih dulu, lalu yang menggantung, lalu menurut nama.
  const isi = [...peta.values()].sort(
    (a, b) =>
      Number(b.jumlah > 0) - Number(a.jumlah > 0) ||
      Number(b.menggantung) - Number(a.menggantung) ||
      (a.storeName ?? '').localeCompare(b.storeName ?? ''),
  );
  return yatim.jumlah > 0 ? [yatim, ...isi] : isi;
}

/**
 * Isi satu folder. `storeId` null berarti folder "Tanpa Nota Toko".
 *
 * Fotonya ikut dibawa: di arsip, gambar kecil nota itulah yang membuat orang
 * mengenali notanya sebelum membaca nomornya.
 */
export async function isiArsip(storeId: string | null): Promise<IsiArsip[]> {
  // Satu folder = satu toko. Memuat seluruh daftar kerja untuk menampilkan
  // isinya adalah pemborosan murni.
  const baris = await daftarKerjaRetur(storeId === null ? {} : { storeId });
  const dipilih = baris.filter((b) =>
    storeId === null ? b.jenis === 'GUDANG_YATIM' : b.jenis === 'NRT' && b.storeId === storeId,
  );

  const foto = new Map<string, string | null>();
  const idNrt = dipilih.filter((b) => b.jenis === 'NRT').map((b) => b.id);
  if (idNrt.length > 0) {
    const rows = await prisma.storeReturn.findMany({
      where: { id: { in: idNrt } },
      select: { id: true, photoUrl: true },
    });
    for (const r of rows) foto.set(r.id, r.photoUrl);
  }

  return dipilih.map((b) => ({
    id: b.id,
    jenis: b.jenis,
    nomor: b.nomor,
    tanggal: b.tanggal,
    nilai: b.nilaiKlaim ?? b.nilaiFisik ?? 0,
    fotoUrl: foto.get(b.id) ?? null,
    langkah: b.langkah,
    menggantung: menggantung(b.langkah),
  }));
}

/** Isi awal formulir nota retur yang menyalin nota batal — lihat `bahanSalinRetur`. */
export type AwalRetur = {
  /** Nota batal yang disalin — dikirim sebagai `menggantikanId`. */
  dariId: string;
  dariNoNrt: string;
  noNrt: string;
  tanggal: string;
  caraKirim: 'SALES' | 'TOKO' | 'EKSPEDISI';
  nilai: number;
  foto: { url: string; nama: string } | null;
};

/**
 * Bahan "Laporkan ulang" untuk nota retur yang dibatalkan: nomor, tanggal,
 * cara kirim, nilai, dan foto ikut; toko dipilih ulang (biasanya itu yang
 * salah). Catatannya tidak ikut — sesudah dibatalkan ia membawa alasan
 * pembatalan, bukan keterangan nota.
 *
 * Nomor yang sudah diberi akhiran "(batal)" dikembalikan ke nomor toko aslinya.
 * `salesmanId` (layar HP): hanya nota miliknya sendiri.
 */
export async function bahanSalinRetur(id: string, opsi?: { salesmanId?: string }): Promise<AwalRetur | null> {
  const n = await prisma.storeReturn.findUnique({
    where: { id },
    select: {
      noNrt: true,
      salesmanId: true,
      status: true,
      claimDate: true,
      deliveryMethod: true,
      claimedAmount: true,
      photoUrl: true,
    },
  });
  if (!n || n.status !== 'BATAL') return null;
  if (opsi?.salesmanId && n.salesmanId !== opsi.salesmanId) return null;
  if (await prisma.storeReturn.findUnique({ where: { replacesReturnId: id }, select: { id: true } })) return null;
  return {
    dariId: id,
    dariNoNrt: n.noNrt,
    noNrt: n.noNrt.replace(/ \(batal(?: \d+)?\)$/, ''),
    tanggal: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(n.claimDate),
    caraKirim: n.deliveryMethod,
    nilai: Number(n.claimedAmount),
    foto: n.photoUrl ? { url: n.photoUrl, nama: `${n.noNrt}.jpg` } : null,
  };
}
