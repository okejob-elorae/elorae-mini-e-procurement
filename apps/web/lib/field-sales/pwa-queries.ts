import { prisma, type Prisma } from "@elorae/db";
import type { AlasanKredit, TingkatKredit } from "@/lib/salesman/kredit";
import {
  getFieldSalesOrderById,
  petaGanti,
  type FieldSalesDeliveryStatus,
  type FieldSalesOrderStatus,
  type FieldSalesOrderType,
  type TautanPesanan,
} from "./queries";
import { lencanaIndenById } from "./inden-queries";
import { catatanUntukDiubah, dibatalkanSalesman, kunciBaris } from "./ganti-pesanan";
import { pesanPesananWa } from "./pesan-pesanan-wa";
import { tautanWhatsApp } from "@/lib/salesman/dasbor";

/**
 * "Pesanan saya" — pesanan lapangan milik SATU salesman, untuk aplikasi HP.
 *
 * Setiap kueri di sini disaring ke salesman pemiliknya DI KUERI, bukan di layar:
 * alamat detail yang disunting tangan tidak bisa membuka pesanan orang lain.
 */

// ── Tahap & keadaan (murni) ───────────────────────────────────────────────

/**
 * Keadaan yang dibaca salesman, lebih halus dari `status`. Pesanan PUTUS yang
 * sudah disetujui masih punya perjalanan (belum dikirim → sebagian → terkirim /
 * ditutup); pesanan KONSI selesai saat disetujui, karena transfer konsinyasi
 * tercatat saat itu dan tidak ada dokumen kirim sesudahnya.
 */
export type KeadaanPesanan =
  | "MENUNGGU"
  | "DITOLAK"
  | "BELUM_DIKIRIM"
  | "DIKIRIM_SEBAGIAN"
  | "TERKIRIM"
  | "DITUTUP"
  | "KONSI_DISETUJUI";

export const TAB_PESANAN = ["semua", "menunggu", "disetujui", "dikirim", "ditolak"] as const;
export type TabPesanan = (typeof TAB_PESANAN)[number];
export type TahapPesanan = Exclude<TabPesanan, "semua">;

type BentukPesanan = {
  status: FieldSalesOrderStatus;
  orderType: FieldSalesOrderType;
  deliveryStatus: FieldSalesDeliveryStatus;
};

export function keadaanPesanan(o: BentukPesanan): KeadaanPesanan {
  if (o.status === "PENDING_APPROVAL") return "MENUNGGU";
  if (o.status === "REJECTED") return "DITOLAK";
  if (o.orderType === "KONSI") return "KONSI_DISETUJUI";
  switch (o.deliveryStatus) {
    case "PARTIAL":
      return "DIKIRIM_SEBAGIAN";
    case "DELIVERED":
      return "TERKIRIM";
    case "CLOSED":
      return "DITUTUP";
    default:
      return "BELUM_DIKIRIM";
  }
}

/**
 * Tab tempat sebuah pesanan tinggal. Satu pesanan tepat di satu tab.
 *
 * "Disetujui" = disetujui dan MASIH menunggu barang (PUTUS belum/sebagian
 * dikirim) — persis angka "Siap dikirim" di kartu beranda, supaya ketukan dari
 * sana membuka daftar yang jumlahnya sama. Kiriman sebagian ikut di sini:
 * sisanya masih ditunggu toko. "Dikirim" = perjalanannya sudah selesai: PUTUS
 * terkirim penuh atau sisanya ditutup kantor, dan KONSI yang disetujui (barang
 * konsinyasi keluar saat disetujui — `getStoreSentItems` menghitungnya sebagai
 * terkirim dengan alasan yang sama).
 */
export function tahapPesanan(o: BentukPesanan): TahapPesanan {
  switch (keadaanPesanan(o)) {
    case "MENUNGGU":
      return "menunggu";
    case "DITOLAK":
      return "ditolak";
    case "BELUM_DIKIRIM":
    case "DIKIRIM_SEBAGIAN":
      return "disetujui";
    default:
      return "dikirim";
  }
}

export function bacaTab(nilai: string | string[] | undefined): TabPesanan {
  const v = Array.isArray(nilai) ? nilai[0] : nilai;
  return (TAB_PESANAN as readonly string[]).includes(v ?? "") ? (v as TabPesanan) : "semua";
}

const SEMUA_STATUS: FieldSalesOrderStatus[] = ["PENDING_APPROVAL", "APPROVED", "REJECTED"];
const SEMUA_JENIS: FieldSalesOrderType[] = ["PUTUS", "KONSI"];
const SEMUA_KIRIM: FieldSalesDeliveryStatus[] = ["PENDING", "PARTIAL", "DELIVERED", "CLOSED"];

/**
 * Syarat Prisma untuk satu tab, DITURUNKAN dari `tahapPesanan` — bukan ditulis
 * ulang tangan. Dua tulisan aturan yang sama (satu di JS untuk hitungan tab,
 * satu di SQL untuk daftar) cepat atau lambat berbeda pendapat, dan angka di
 * tab tidak lagi cocok dengan isi daftarnya. Di sini keduanya berasal dari satu
 * fungsi: setiap kombinasi status × jenis × status kirim dinilai, lalu yang
 * jatuh di tab itu dikelompokkan per (status, jenis).
 */
export function syaratTab(tab: TabPesanan): Prisma.FieldSalesOrderWhereInput {
  if (tab === "semua") return {};
  const kelompok: Prisma.FieldSalesOrderWhereInput[] = [];
  for (const status of SEMUA_STATUS) {
    for (const orderType of SEMUA_JENIS) {
      const kirim = SEMUA_KIRIM.filter((deliveryStatus) => tahapPesanan({ status, orderType, deliveryStatus }) === tab);
      if (kirim.length === 0) continue;
      kelompok.push(
        kirim.length === SEMUA_KIRIM.length
          ? { status, orderType }
          : { status, orderType, deliveryStatus: { in: kirim } },
      );
    }
  }
  return { OR: kelompok };
}

export type JumlahPerTab = Record<TabPesanan, number>;

/** Hitungan tab dari `groupBy` (status, jenis, status kirim) — lewat pemilah yang sama dengan daftarnya. */
export function hitungPerTab(kelompok: Array<BentukPesanan & { jumlah: number }>): JumlahPerTab {
  const hasil: JumlahPerTab = { semua: 0, menunggu: 0, disetujui: 0, dikirim: 0, ditolak: 0 };
  for (const k of kelompok) {
    hasil.semua += k.jumlah;
    hasil[tahapPesanan(k)] += k.jumlah;
  }
  return hasil;
}

/**
 * Nilai pesanan KONSI TIDAK PERNAH tampil di aplikasi HP — juga sesudah
 * disetujui. Itu aturan tetap aplikasi salesman (katalog konsi mengosongkan
 * harga sejak dari server, "Pesanan terakhir" di halaman toko juga): harga
 * konsinyasi adalah urusan kantor dan toko. Sebelum disetujui pun baris konsi
 * berharga 0, jadi "Rp 0" akan menyatakan sesuatu yang tidak benar.
 */
export function nilaiTampil(o: { orderType: FieldSalesOrderType; status: FieldSalesOrderStatus }, nilai: number): number | null {
  return o.orderType === "KONSI" ? null : nilai;
}

// ── Daftar ────────────────────────────────────────────────────────────────

export const BATAS_BAWAAN = 30;
const BATAS_MAKS = 300;

export function bacaBatas(nilai: string | string[] | undefined): number {
  const v = Number(Array.isArray(nilai) ? nilai[0] : nilai);
  if (!Number.isFinite(v) || v <= 0) return BATAS_BAWAAN;
  return Math.min(BATAS_MAKS, Math.floor(v));
}

/** Alamat daftar untuk satu tab (dan batas, bila bukan bawaan). Dipakai tab, tombol "lebih banyak", dan kartu beranda. */
export function alamatPesanan(tab: TabPesanan, batas?: number): string {
  const q = new URLSearchParams();
  if (tab !== "semua") q.set("status", tab);
  if (batas && batas !== BATAS_BAWAAN) q.set("batas", String(batas));
  const s = q.toString();
  return s ? `/pwa/orders?${s}` : "/pwa/orders";
}

export type BarisPesananSaya = {
  id: string;
  orderNo: string;
  storeId: string;
  storeName: string;
  orderType: FieldSalesOrderType;
  status: FieldSalesOrderStatus;
  deliveryStatus: FieldSalesDeliveryStatus;
  keadaan: KeadaanPesanan;
  total: number | null;
  createdAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  jumlahBaris: number;
  jumlahPcs: number;
  adaBanding: boolean;
  kreditDitahan: boolean;
  /** Pesanan jarak jauh (WA/TELEPON/LAINNYA); null = diambil saat kunjungan. */
  remoteChannel: string | null;
  /** Pre-order: nama jendelanya (null bila jendelanya sudah tidak ada); null = pesanan stok siap. */
  inden: { id: string; name: string | null } | null;
  /** Dibatalkan salesman sendiri — status tetap REJECTED, tapi bukan "ditolak kantor". */
  dibatalkan: boolean;
  menggantikan: TautanPesanan | null;
  digantiDengan: TautanPesanan | null;
};

export async function pesananSaya(
  salesmanId: string,
  opsi: { status?: TabPesanan; batas?: number } = {},
): Promise<{ baris: BarisPesananSaya[]; adaLagi: boolean; jumlah: JumlahPerTab }> {
  const tab = opsi.status ?? "semua";
  const batas = Math.min(BATAS_MAKS, Math.max(1, Math.floor(opsi.batas ?? BATAS_BAWAAN)));

  const [rows, kelompok] = await Promise.all([
    prisma.fieldSalesOrder.findMany({
      where: { salesmanId, ...syaratTab(tab) },
      // `orderNo` memutus seri: dua pesanan pada milidetik yang sama tetap berurutan pasti.
      orderBy: [{ createdAt: "desc" }, { orderNo: "desc" }],
      take: batas + 1,
      select: {
        id: true,
        orderNo: true,
        storeId: true,
        orderType: true,
        status: true,
        deliveryStatus: true,
        total: true,
        createdAt: true,
        approvedAt: true,
        rejectedAt: true,
        rejectReason: true,
        kreditDitahan: true,
        remoteChannel: true,
        preorderWindowId: true,
        cancelledById: true,
        replacesOrderId: true,
        store: { select: { name: true } },
        lines: { select: { qty: true, requestedUnitPrice: true } },
      },
    }),
    prisma.fieldSalesOrder.groupBy({
      by: ["status", "orderType", "deliveryStatus"],
      where: { salesmanId },
      _count: { _all: true },
    }),
  ]);

  const tampil = rows.slice(0, batas);
  const [jendela, ganti] = await Promise.all([lencanaIndenById(tampil.map((r) => r.preorderWindowId)), petaGanti(tampil)]);
  const baris = tampil.map((r) => ({
    id: r.id,
    orderNo: r.orderNo,
    storeId: r.storeId,
    storeName: r.store.name,
    orderType: r.orderType,
    status: r.status,
    deliveryStatus: r.deliveryStatus,
    keadaan: keadaanPesanan(r),
    total: nilaiTampil(r, Number(r.total)),
    createdAt: r.createdAt,
    approvedAt: r.approvedAt,
    rejectedAt: r.rejectedAt,
    rejectReason: r.rejectReason,
    jumlahBaris: r.lines.length,
    jumlahPcs: r.lines.reduce((n, l) => n + l.qty, 0),
    adaBanding: r.lines.some((l) => l.requestedUnitPrice !== null),
    kreditDitahan: r.kreditDitahan,
    remoteChannel: r.remoteChannel,
    inden: r.preorderWindowId ? { id: r.preorderWindowId, name: jendela.get(r.preorderWindowId)?.name ?? null } : null,
    dibatalkan: dibatalkanSalesman(r),
    menggantikan: ganti.menggantikan.get(r.id) ?? null,
    digantiDengan: ganti.digantiDengan.get(r.id) ?? null,
  }));

  return {
    baris,
    adaLagi: rows.length > batas,
    jumlah: hitungPerTab(
      kelompok.map((k) => ({ status: k.status, orderType: k.orderType, deliveryStatus: k.deliveryStatus, jumlah: k._count._all })),
    ),
  };
}

// ── Detail ────────────────────────────────────────────────────────────────

/**
 * Nasib harga yang diajukan salesman pada satu baris.
 *
 * Saat disetujui, pemilik menulis harga akhir LANGSUNG ke `unitPrice` baris itu
 * (lihat `approveFieldSalesOrder`), jadi sesudah disetujui `unitPrice` = harga
 * akhir. Sebelum itu `unitPrice` masih harga toko dan keputusannya belum ada.
 */
export type HasilBanding = "MENUNGGU" | "SESUAI" | "BERBEDA" | "BATAL";

export function hasilBanding(
  status: FieldSalesOrderStatus,
  diajukan: number,
  hargaSatuan: number,
): { hasil: HasilBanding; hargaAkhir: number | null } {
  if (status === "PENDING_APPROVAL") return { hasil: "MENUNGGU", hargaAkhir: null };
  if (status === "REJECTED") return { hasil: "BATAL", hargaAkhir: null };
  // Harga disimpan Decimal(15,2): bandingkan dalam sen, bukan float mentah.
  const sama = Math.round(diajukan * 100) === Math.round(hargaSatuan * 100);
  return { hasil: sama ? "SESUAI" : "BERBEDA", hargaAkhir: hargaSatuan };
}

/**
 * Catatan kredit (`FieldSalesOrder.kreditCatatan`): keadaan tagihan toko saat
 * pesanan dibuat. Ditulis penulis pesanan; bentuknya dibaca longgar — JSON
 * `{ tingkat, alasan[], keadaan }` dirakit jadi kalimat yang ikut bahasa
 * aplikasi, selain itu ditampilkan apa adanya sebagai teks.
 */
export type CatatanKredit =
  | {
      jenis: "terstruktur";
      tingkat: TingkatKredit | null;
      alasan: AlasanKredit[];
      keadaan: { sisa: number; fakturTerbuka: number; lewatJanji: number; fakturLewatJanji: number } | null;
    }
  | { jenis: "teks"; teks: string };

const angkaSah = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function bacaAlasan(x: unknown): AlasanKredit | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  if (a.kode === "LEWAT_JANJI" && angkaSah(a.nilai) && angkaSah(a.faktur)) {
    return { kode: "LEWAT_JANJI", nilai: a.nilai, faktur: a.faktur };
  }
  if (a.kode === "MELEBIHI_BATAS_NILAI" && angkaSah(a.sisaSesudah) && angkaSah(a.batas)) {
    return { kode: "MELEBIHI_BATAS_NILAI", sisaSesudah: a.sisaSesudah, batas: a.batas };
  }
  if (a.kode === "MELEBIHI_BATAS_FAKTUR" && angkaSah(a.faktur) && angkaSah(a.batas)) {
    return { kode: "MELEBIHI_BATAS_FAKTUR", faktur: a.faktur, batas: a.batas };
  }
  return null;
}

export function bacaCatatanKredit(teks: string | null | undefined): CatatanKredit | null {
  const bersih = teks?.trim();
  if (!bersih) return null;
  let x: unknown;
  try {
    x = JSON.parse(bersih);
  } catch {
    return { jenis: "teks", teks: bersih };
  }
  if (!x || typeof x !== "object" || Array.isArray(x)) return { jenis: "teks", teks: bersih };
  const o = x as Record<string, unknown>;
  // Kadang hasil penilaian dibungkus: { hasil: { tingkat, alasan }, keadaan }.
  const inti = o.hasil && typeof o.hasil === "object" ? (o.hasil as Record<string, unknown>) : o;
  const alasan = Array.isArray(inti.alasan) ? inti.alasan.map(bacaAlasan).filter((a): a is AlasanKredit => a !== null) : [];
  const tingkat = ["AMAN", "PERINGATAN", "TAHAN", "BLOKIR"].includes(inti.tingkat as string) ? (inti.tingkat as TingkatKredit) : null;
  const k = o.keadaan && typeof o.keadaan === "object" ? (o.keadaan as Record<string, unknown>) : null;
  const keadaan =
    k && angkaSah(k.sisa) && angkaSah(k.fakturTerbuka) && angkaSah(k.lewatJanji) && angkaSah(k.fakturLewatJanji)
      ? { sisa: k.sisa, fakturTerbuka: k.fakturTerbuka, lewatJanji: k.lewatJanji, fakturLewatJanji: k.fakturLewatJanji }
      : null;
  if (tingkat === null && alasan.length === 0 && keadaan === null) return { jenis: "teks", teks: bersih };
  return { jenis: "terstruktur", tingkat, alasan, keadaan };
}

export type LangkahLinimasa =
  | { jenis: "DIBUAT"; waktu: Date }
  | { jenis: "DISETUJUI"; waktu: Date }
  | { jenis: "DITOLAK"; waktu: Date; alasan: string | null }
  /** Dibatalkan salesman sendiri (bukan ditolak kantor). */
  | { jenis: "DIBATALKAN"; waktu: Date; alasan: string | null }
  | { jenis: "DIKIRIM"; waktu: Date; docNo: string; pcs: number; nilai: number }
  | { jenis: "DITUTUP"; waktu: Date; alasan: string | null };

/**
 * Urutan peristiwa pesanan. Yang tanggalnya tidak ada tidak terjadi.
 *
 * Diurutkan menurut ALUR, bukan menurut jam: dibuat → disetujui/ditolak →
 * kiriman (antar-kiriman menurut tanggal kirim) → ditutup. Alurnya pasti,
 * sedangkan jamnya tidak selalu — pengiriman hasil pengisian-ulang data lama
 * bisa bertanggal sama dengan persetujuannya, dan tanggal kirim diketik orang.
 */
export function susunLinimasa(o: {
  createdAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  closedAt: Date | null;
  closeReason: string | null;
  /** Diisi saat salesman membatalkan pesanannya sendiri; langkahnya menggantikan "ditolak". */
  cancelledAt?: Date | null;
  pengiriman: Array<{ docNo: string; deliveredAt: Date; pcs: number; total: number }>;
}): LangkahLinimasa[] {
  const langkah: LangkahLinimasa[] = [{ jenis: "DIBUAT", waktu: o.createdAt }];
  if (o.approvedAt) langkah.push({ jenis: "DISETUJUI", waktu: o.approvedAt });
  if (o.cancelledAt) langkah.push({ jenis: "DIBATALKAN", waktu: o.cancelledAt, alasan: o.rejectReason });
  else if (o.rejectedAt) langkah.push({ jenis: "DITOLAK", waktu: o.rejectedAt, alasan: o.rejectReason });
  const kiriman = [...o.pengiriman].sort((a, b) => a.deliveredAt.getTime() - b.deliveredAt.getTime());
  for (const d of kiriman) {
    langkah.push({ jenis: "DIKIRIM", waktu: d.deliveredAt, docNo: d.docNo, pcs: d.pcs, nilai: d.total });
  }
  if (o.closedAt) langkah.push({ jenis: "DITUTUP", waktu: o.closedAt, alasan: o.closeReason });
  return langkah;
}

export type BarisDetailPesananSaya = {
  id: string;
  productName: string;
  variantSku: string;
  variantLabel: string | null;
  qty: number;
  deliveredQty: number;
  cancelledQty: number;
  outstanding: number;
  /** null untuk KONSI (lihat `nilaiTampil`). */
  unitPrice: number | null;
  lineTotal: number | null;
  discountAmount: number | null;
  appliedPromoName: string | null;
  /** Baris gratis promo bonus. */
  isBonus: boolean;
  bonusPromoName: string | null;
  banding: {
    requestedUnitPrice: number;
    appealReason: string | null;
    hasil: HasilBanding;
    hargaAkhir: number | null;
  } | null;
};

export type DetailPesananSaya = {
  id: string;
  orderNo: string;
  storeId: string;
  storeName: string;
  orderType: FieldSalesOrderType;
  status: FieldSalesOrderStatus;
  deliveryStatus: FieldSalesDeliveryStatus;
  keadaan: KeadaanPesanan;
  note: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  closedAt: Date | null;
  closeReason: string | null;
  subtotal: number | null;
  /** Jumlah potongan promo per baris. */
  potonganBaris: number | null;
  orderDiscountAmount: number | null;
  appliedOrderPromoName: string | null;
  total: number | null;
  jumlahPcs: number;
  kreditDitahan: boolean;
  /** Pesanan jarak jauh (WA/TELEPON/LAINNYA); null = diambil saat kunjungan. */
  remoteChannel: string | null;
  /** Hanya PUTUS — toko konsinyasi tidak punya piutang untuk dinilai. */
  kreditCatatan: CatatanKredit | null;
  baris: BarisDetailPesananSaya[];
  pengiriman: Array<{ id: string; docNo: string; deliveredAt: Date; pcs: number; total: number }>;
  linimasa: LangkahLinimasa[];
  /** Dibatalkan salesman sendiri (status REJECTED + `cancelledById`). */
  dibatalkan: boolean;
  cancelledAt: Date | null;
  menggantikan: TautanPesanan | null;
  digantiDengan: TautanPesanan | null;
  /** Pre-order: nama jendelanya ("" bila jendelanya sudah tidak ada); null = pesanan stok siap. */
  indenNama: string | null;
};

/**
 * Detail satu pesanan, HANYA bila pemiliknya salesman ini (null untuk pesanan
 * orang lain maupun yang tidak ada — keduanya jadi 404, tidak membocorkan
 * bahwa nomor itu ada).
 *
 * Bentuk uangnya dipinjam dari `getFieldSalesOrderById` (serializer backoffice)
 * supaya Decimal → number, promo, dan pengiriman tidak ditulis dua kali. Yang
 * ditambahkan di sini: saringan pemilik, pembagian kirim/batal per baris, dan
 * kolom kredit. Yang DIBUANG: stok gudang dan tanda di bawah modal — bukan
 * urusan layar HP.
 */
export async function pesananSayaById(orderId: string, salesmanId: string): Promise<DetailPesananSaya | null> {
  const milik = await prisma.fieldSalesOrder.findFirst({
    where: { id: orderId, salesmanId },
    select: {
      id: true,
      storeId: true,
      kreditDitahan: true,
      kreditCatatan: true,
      lines: { select: { id: true, deliveredQty: true, cancelledQty: true } },
    },
  });
  if (!milik) return null;
  const o = await getFieldSalesOrderById(milik.id);
  if (!o) return null;

  const qtyPerBaris = new Map(milik.lines.map((l) => [l.id, l]));
  const tampil = (n: number) => nilaiTampil(o, n);

  // Serializer backoffice tidak mengurutkan baris; HP butuh urutan yang tetap antar-muat.
  const barisUrut = [...o.lines].sort(
    (a, b) => a.productName.localeCompare(b.productName) || a.variantSku.localeCompare(b.variantSku),
  );
  const baris: BarisDetailPesananSaya[] = barisUrut.map((l) => {
    const q = qtyPerBaris.get(l.id);
    return {
      id: l.id,
      productName: l.productName,
      variantSku: l.variantSku,
      variantLabel: l.variantLabel,
      qty: l.qty,
      deliveredQty: q?.deliveredQty ?? 0,
      cancelledQty: q?.cancelledQty ?? 0,
      outstanding: l.outstanding,
      unitPrice: tampil(l.unitPrice),
      lineTotal: tampil(l.lineTotal),
      discountAmount: tampil(l.discountAmount),
      appliedPromoName: l.appliedPromoName,
      isBonus: l.isBonus,
      bonusPromoName: l.bonusPromoName,
      banding:
        l.requestedUnitPrice === null
          ? null
          : {
              requestedUnitPrice: l.requestedUnitPrice,
              appealReason: l.appealReason,
              ...hasilBanding(o.status, l.requestedUnitPrice, l.unitPrice),
            },
    };
  });

  const pengiriman = o.deliveries.map((d) => ({
    id: d.id,
    docNo: d.docNo,
    deliveredAt: d.deliveredAt,
    pcs: d.lines.reduce((n, x) => n + x.qty, 0),
    total: d.total,
  }));

  return {
    id: o.id,
    orderNo: o.orderNo,
    storeId: milik.storeId,
    storeName: o.storeName,
    orderType: o.orderType,
    status: o.status,
    deliveryStatus: o.deliveryStatus,
    keadaan: keadaanPesanan(o),
    note: o.note,
    createdAt: o.createdAt,
    approvedAt: o.approvedAt,
    rejectedAt: o.rejectedAt,
    rejectReason: o.rejectReason,
    closedAt: o.closedAt,
    closeReason: o.closeReason,
    subtotal: tampil(o.subtotal),
    potonganBaris: tampil(o.lines.reduce((n, l) => n + l.discountAmount, 0)),
    orderDiscountAmount: tampil(o.orderDiscountAmount),
    appliedOrderPromoName: o.appliedOrderPromoName,
    total: tampil(o.total),
    jumlahPcs: o.lines.reduce((n, l) => n + l.qty, 0),
    kreditDitahan: milik.kreditDitahan,
    remoteChannel: o.remoteChannel ?? null,
    kreditCatatan: o.orderType === "PUTUS" ? bacaCatatanKredit(milik.kreditCatatan) : null,
    baris,
    pengiriman,
    linimasa: susunLinimasa({ ...o, pengiriman }),
    dibatalkan: o.status === "REJECTED" && o.cancelledAt !== null,
    cancelledAt: o.cancelledAt,
    menggantikan: o.menggantikan ?? null,
    digantiDengan: o.digantiDengan ?? null,
    indenNama: o.preorder ? (o.preorder.name ?? "") : null,
  };
}

// ── Ubah pesanan ──────────────────────────────────────────────────────────

export type PesananUntukDiganti = {
  id: string;
  orderNo: string;
  status: FieldSalesOrderStatus;
  orderType: FieldSalesOrderType;
  remoteChannel: string | null;
  preorderWindowId: string | null;
  /** Catatan salesman tanpa baris yang ditulis sistem (lihat `catatanUntukDiubah`). */
  note: string;
  /** Baris yang dipilih toko (tanpa baris bonus — penulis menyusunnya ulang), dengan ajuan harganya. */
  baris: Array<{ itemId: string; variantSku: string; qty: number; requestedUnitPrice: number | null; appealReason: string | null }>;
  /** Stok yang masih dipegang pesanan ini, per `itemId::variantSku` — dilepas penulis sebelum pengganti dicadangkan. */
  cadangan: Record<string, number>;
};

/**
 * Pesanan yang hendak diubah, HANYA bila milik salesman ini dan di toko ini
 * (selain itu null — pesanan orang lain sama dengan tidak ada). Statusnya ikut
 * dikembalikan: halaman katalog yang menjelaskan kenapa pesanan yang sudah
 * diputuskan tidak bisa diubah; penulis tetap menilai ulang saat dikirim.
 */
export async function pesananUntukDiganti(orderId: string, salesmanId: string, storeId: string): Promise<PesananUntukDiganti | null> {
  const o = await prisma.fieldSalesOrder.findFirst({
    where: { id: orderId, salesmanId, storeId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      orderType: true,
      remoteChannel: true,
      preorderWindowId: true,
      note: true,
      lines: { select: { id: true, itemId: true, variantSku: true, qty: true, isBonus: true, requestedUnitPrice: true, appealReason: true } },
    },
  });
  if (!o) return null;
  const cadanganRows =
    o.status === "PENDING_APPROVAL" && o.lines.length > 0
      ? await prisma.stockReservation.findMany({
          where: { source: "FIELD_SALES", state: "RESERVED", fieldSalesLineId: { in: o.lines.map((l) => l.id) } },
          select: { itemId: true, variantSku: true, qty: true, consumedQty: true },
        })
      : [];
  const cadangan: Record<string, number> = {};
  for (const r of cadanganRows) {
    const dipegang = Number(r.qty) - Number(r.consumedQty);
    if (dipegang <= 0) continue;
    const k = kunciBaris(r.itemId, r.variantSku);
    cadangan[k] = (cadangan[k] ?? 0) + dipegang;
  }
  return {
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    orderType: o.orderType,
    remoteChannel: o.remoteChannel,
    preorderWindowId: o.preorderWindowId,
    note: catatanUntukDiubah(o.note),
    baris: o.lines
      .filter((l) => !l.isBonus)
      .map((l) => ({
        itemId: l.itemId,
        variantSku: l.variantSku,
        qty: l.qty,
        requestedUnitPrice: l.requestedUnitPrice === null ? null : Number(l.requestedUnitPrice),
        appealReason: l.appealReason,
      })),
    cadangan,
  };
}

// ── Salinan WhatsApp ──────────────────────────────────────────────────────

export type SalinanPesananWa = {
  teks: string;
  /** `wa.me/<nomor toko>` bila nomornya terbaca; selain itu `wa.me/?text=` (WhatsApp membuka pemilih kontak). */
  tautan: string;
  adaNomor: boolean;
};

/**
 * Salinan pesanan untuk dikirim ke toko lewat WhatsApp, HANYA untuk pemiliknya,
 * dan tidak untuk pesanan yang ditolak/dibatalkan (null). Harga PUTUS dari
 * server (sesudah promo); KONSI tanpa harga sama sekali (dibuang pembangunnya).
 */
export async function salinanPesananSaya(orderId: string, salesmanId: string): Promise<SalinanPesananWa | null> {
  const d = await pesananSayaById(orderId, salesmanId);
  if (!d) return null;
  return salinanDariDetail(d, salesmanId);
}

/** Sama dengan `salinanPesananSaya`, untuk pemanggil yang sudah memegang detailnya (halaman detail HP). */
export async function salinanDariDetail(d: DetailPesananSaya, salesmanId: string): Promise<SalinanPesananWa | null> {
  if (d.status === "REJECTED") return null;
  const [toko, salesman] = await Promise.all([
    prisma.store.findUnique({ where: { id: d.storeId }, select: { phone: true } }),
    prisma.user.findUnique({ where: { id: salesmanId }, select: { name: true } }),
  ]);
  const putus = d.orderType === "PUTUS";
  const teks = pesanPesananWa({
    toko: d.storeName,
    orderNo: d.orderNo,
    tanggal: d.createdAt,
    orderType: d.orderType,
    status: d.status,
    baris: d.baris.map((b) => ({
      nama: b.productName,
      varian: b.variantLabel,
      qty: b.qty,
      bonus: b.isBonus,
      hargaSatuan: putus ? b.unitPrice : null,
      total: putus ? b.lineTotal : null,
    })),
    subtotal: putus ? d.subtotal : null,
    potongan: putus ? (d.potonganBaris ?? 0) + (d.orderDiscountAmount ?? 0) : null,
    total: putus ? d.total : null,
    catatan: d.note,
    salesman: salesman?.name ?? null,
    inden: d.indenNama ? { nama: d.indenNama } : null,
  });
  const keToko = tautanWhatsApp(toko?.phone, teks);
  return { teks, tautan: keToko ?? `https://wa.me/?text=${encodeURIComponent(teks)}`, adaNomor: keToko !== null };
}
