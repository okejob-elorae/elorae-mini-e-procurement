import { prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { computeStorePrice } from "@elorae/db/pricing";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { getPrimaryImagesBatch } from "@/lib/items/images/queries";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
import {
  ENTITAS_TUKAR,
  hitungNilaiTukar,
  kekuranganStok,
  kunciBarisTukar,
  STATUS_TUKAR,
  statusTukarTerbuka,
  type BarisTukar,
  type KurangStok,
  type NilaiTukar,
  type StatusTukar,
} from "./tukar-barang";

/**
 * Kueri tukar barang — formulir HP, daftar milik salesman, daftar dan rincian
 * kantor. Semua tanggal diformat DI SINI (server, WIB) dan dikirim sebagai
 * teks: format tanggal di klien bisa berbeda antara Node dan Safari, dan React
 * menganggapnya hydration error.
 */

const HARI_DIBELI = 365;
const BATAS_DIBELI = 100;

// ─── Stok ────────────────────────────────────────────────────────────────────

type BarisStokRingkas = { itemId: string; variantSku: string | null; qtyOnHand: unknown; reservedQty: unknown };

/**
 * Peta "tersedia" (`qtyOnHand − reservedQty`) dengan aturan pencarian yang SAMA
 * dengan penulis: barang tanpa varian mengambil baris pertama yang `null`/`""`,
 * barang bervarian mengambil baris varian persisnya. Kalau layar menjumlah dua
 * baris kembar sementara penulis mengurangi satu, layar akan menjanjikan stok
 * yang ditolak penulis.
 */
function petaTersedia(rows: BarisStokRingkas[]): (itemId: string, variantSku: string) => number {
  const peta = new Map<string, number>();
  for (const r of rows) {
    const k = kunciBarisTukar(r.itemId, r.variantSku ?? "");
    if (peta.has(k)) continue;
    peta.set(k, Number(r.qtyOnHand ?? 0) - Number(r.reservedQty ?? 0));
  }
  return (itemId, variantSku) => peta.get(kunciBarisTukar(itemId, variantSku)) ?? 0;
}

// ─── Formulir HP ─────────────────────────────────────────────────────────────

export type VarianTukar = { variantSku: string; label: string; tersedia: number };

export type BarangTukar = {
  itemId: string;
  sku: string;
  nama: string;
  /** Harga toko PUTUS — sama dengan harga pesanan. Null = belum diatur kantor. */
  harga: number | null;
  gambar: string | null;
  /** Barang aktif yang dijual — hanya ini yang boleh DIBERIKAN ke toko. */
  bisaKeluar: boolean;
  /** Kosong = barang tanpa varian (pakai `tersedia`). */
  varian: VarianTukar[];
  tersedia: number;
};

/** Barang yang pernah dikirim ke toko ini — sumber utama yang dikembalikan toko. */
export type DibeliToko = { itemId: string; variantSku: string; qty: number; terakhir: string };

export type BahanTukar = { barang: BarangTukar[]; dibeli: DibeliToko[] };

export async function bahanTukarToko(storeId: string, sekarang = new Date()): Promise<BahanTukar> {
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { marginPercent: true } });
  const margin = toko?.marginPercent == null ? null : Number(toko.marginPercent);

  // Yang dibeli toko = baris pengiriman pesanan PUTUS (yang benar-benar sampai),
  // bukan baris pesanan: pesanan yang belum terkirim tidak bisa dikembalikan.
  const sejak = new Date(sekarang.getTime() - HARI_DIBELI * 86_400_000);
  const kiriman = await prisma.fieldSalesDeliveryLine.findMany({
    where: { delivery: { deliveredAt: { gte: sejak }, order: { storeId, orderType: "PUTUS" } } },
    select: { itemId: true, variantSku: true, qty: true, delivery: { select: { deliveredAt: true } } },
  });
  const perKunci = new Map<string, { itemId: string; variantSku: string; qty: number; terakhir: Date }>();
  for (const k of kiriman) {
    const key = kunciBarisTukar(k.itemId, k.variantSku ?? "");
    const ada = perKunci.get(key);
    if (ada) {
      ada.qty += k.qty;
      if (k.delivery.deliveredAt > ada.terakhir) ada.terakhir = k.delivery.deliveredAt;
    } else {
      perKunci.set(key, { itemId: k.itemId, variantSku: k.variantSku ?? "", qty: k.qty, terakhir: k.delivery.deliveredAt });
    }
  }
  const idDibeli = [...new Set([...perKunci.values()].map((d) => d.itemId))];

  const rows = await prisma.item.findMany({
    where: { OR: [{ isActive: true, type: "FINISHED_GOOD" }, { id: { in: idDibeli } }] },
    orderBy: { nameId: "asc" },
    select: {
      id: true,
      sku: true,
      nameId: true,
      isActive: true,
      type: true,
      sellingPrice: true,
      variants: true,
      inventoryValues: { select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true } },
    },
  });
  const gambar = await getPrimaryImagesBatch(rows.map((r) => ({ itemId: r.id, variantSku: null })));

  const barang: BarangTukar[] = rows.map((r) => {
    const tersedia = petaTersedia(r.inventoryValues);
    const pilihan = variantSelectOptions(parseItemVariants(r.variants));
    return {
      itemId: r.id,
      sku: r.sku,
      nama: r.nameId,
      harga: computeStorePrice({
        sellingPrice: r.sellingPrice === null ? null : Number(r.sellingPrice),
        termsType: "PUTUS",
        marginPercent: margin,
      }).price,
      gambar: gambar.get(`${r.id}|`) ?? null,
      bisaKeluar: r.isActive && r.type === "FINISHED_GOOD",
      varian: pilihan.map((p) => ({ variantSku: p.sku, label: p.label, tersedia: tersedia(r.id, p.sku) })),
      tersedia: pilihan.length === 0 ? tersedia(r.id, "") : 0,
    };
  });

  // Baris kiriman lama yang tidak cocok dengan varian barang sekarang (mis.
  // pesanan sebelum varian per ukuran) tidak ditawarkan: penulis akan
  // menolaknya, dan menawarkannya hanya membuat salesman bingung.
  const byId = new Map(barang.map((b) => [b.itemId, b]));
  const dibeli = [...perKunci.values()]
    .filter((d) => {
      const b = byId.get(d.itemId);
      if (!b) return false;
      return b.varian.length === 0 ? d.variantSku === "" : b.varian.some((v) => v.variantSku === d.variantSku);
    })
    .sort((a, b) => b.terakhir.getTime() - a.terakhir.getTime())
    .slice(0, BATAS_DIBELI)
    .map((d) => ({ itemId: d.itemId, variantSku: d.variantSku, qty: d.qty, terakhir: formatDisplayDate(d.terakhir) }));

  return { barang, dibeli };
}

// ─── Bersama ─────────────────────────────────────────────────────────────────

async function namaPengguna(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => !!x))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

async function tokoRingkas(ids: string[]) {
  const unik = [...new Set(ids)];
  if (unik.length === 0) return new Map<string, { nama: string; kode: string }>();
  const rows = await prisma.store.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, code: true } });
  return new Map(rows.map((s) => [s.id, { nama: s.name, kode: s.code }]));
}

async function barisPerDokumen(ids: string[]) {
  if (ids.length === 0) return new Map<string, { direction: string; productName: string; qty: number }[]>();
  const rows = await prisma.storeExchangeLine.findMany({
    where: { exchangeId: { in: ids } },
    orderBy: { productName: "asc" },
    select: { exchangeId: true, direction: true, productName: true, qty: true },
  });
  const peta = new Map<string, { direction: string; productName: string; qty: number }[]>();
  for (const r of rows) {
    const daftar = peta.get(r.exchangeId) ?? [];
    daftar.push(r);
    peta.set(r.exchangeId, daftar);
  }
  return peta;
}

const ringkasBaris = (baris: { direction: string; productName: string; qty: number }[], arah: string) =>
  baris.filter((b) => b.direction === arah).map((b) => ({ nama: b.productName, qty: b.qty }));

// ─── Daftar milik salesman (HP) ──────────────────────────────────────────────

export type BarisTukarSaya = {
  id: string;
  docNo: string;
  toko: string;
  status: string;
  dibuat: string;
  diputuskan: string | null;
  selesai: string | null;
  catatanKeputusan: string | null;
  masuk: { nama: string; qty: number }[];
  keluar: { nama: string; qty: number }[];
};

export async function daftarTukarSaya(salesmanId: string, batas = 50): Promise<BarisTukarSaya[]> {
  const rows = await prisma.storeExchange.findMany({
    where: { salesmanId },
    orderBy: { createdAt: "desc" },
    take: batas,
    select: { id: true, docNo: true, storeId: true, status: true, createdAt: true, reviewedAt: true, completedAt: true, reviewNote: true },
  });
  const [toko, baris] = await Promise.all([tokoRingkas(rows.map((r) => r.storeId)), barisPerDokumen(rows.map((r) => r.id))]);
  return rows.map((r) => {
    const b = baris.get(r.id) ?? [];
    return {
      id: r.id,
      docNo: r.docNo,
      toko: toko.get(r.storeId)?.nama ?? "—",
      status: r.status,
      dibuat: formatDisplayDateTime(r.createdAt),
      diputuskan: r.reviewedAt ? formatDisplayDateTime(r.reviewedAt) : null,
      selesai: r.completedAt ? formatDisplayDateTime(r.completedAt) : null,
      catatanKeputusan: r.reviewNote,
      masuk: ringkasBaris(b, "MASUK"),
      keluar: ringkasBaris(b, "KELUAR"),
    };
  });
}

// ─── Daftar kantor ───────────────────────────────────────────────────────────

export type BarisTukarKantor = {
  id: string;
  docNo: string;
  toko: string;
  tokoKode: string;
  salesman: string;
  status: string;
  dibuat: string;
  pcsMasuk: number;
  pcsKeluar: number;
  jumlahBaris: number;
  catatanKeputusan: string | null;
};

export type DaftarTukarKantor = { baris: BarisTukarKantor[]; perStatus: Record<StatusTukar, number>; total: number };

export async function daftarTukarKantor(saring: {
  status?: StatusTukar | null;
  salesmanId?: string | null;
  cari?: string | null;
  batas?: number;
}): Promise<DaftarTukarKantor> {
  const cari = saring.cari?.trim() || null;
  const dasar = {
    ...(saring.salesmanId ? { salesmanId: saring.salesmanId } : {}),
    ...(cari
      ? {
          OR: [
            { docNo: cariTeks(cari) },
            {
              storeId: {
                in: (
                  await prisma.store.findMany({
                    where: {
                      OR: [
                        { name: cariTeks(cari) },
                        { code: cariTeks(cari) },
                      ],
                    },
                    select: { id: true },
                    take: 200,
                  })
                ).map((s) => s.id),
              },
            },
          ],
        }
      : {}),
  };

  const [rows, kelompok] = await Promise.all([
    prisma.storeExchange.findMany({
      where: { ...dasar, ...(saring.status ? { status: saring.status } : {}) },
      orderBy: { createdAt: "desc" },
      take: saring.batas ?? 200,
      select: { id: true, docNo: true, storeId: true, salesmanId: true, status: true, createdAt: true, reviewNote: true },
    }),
    prisma.storeExchange.groupBy({ by: ["status"], where: dasar, _count: { _all: true } }),
  ]);

  const [toko, nama, baris] = await Promise.all([
    tokoRingkas(rows.map((r) => r.storeId)),
    namaPengguna(rows.map((r) => r.salesmanId)),
    barisPerDokumen(rows.map((r) => r.id)),
  ]);

  const perStatus = Object.fromEntries(STATUS_TUKAR.map((s) => [s, 0])) as Record<StatusTukar, number>;
  for (const k of kelompok) if (k.status in perStatus) perStatus[k.status as StatusTukar] = k._count._all;

  // Yang masih menunggu keputusan atau penyelesaian di atas; di dalamnya tetap terbaru dulu.
  const urutan = (s: string) => (s === "DIAJUKAN" ? 0 : s === "DISETUJUI" ? 1 : 2);
  const hasil: BarisTukarKantor[] = [...rows]
    .sort((a, b) => urutan(a.status) - urutan(b.status))
    .map((r) => {
      const b = baris.get(r.id) ?? [];
      return {
        id: r.id,
        docNo: r.docNo,
        toko: toko.get(r.storeId)?.nama ?? "—",
        tokoKode: toko.get(r.storeId)?.kode ?? "",
        salesman: nama.get(r.salesmanId) ?? "—",
        status: r.status,
        dibuat: formatDisplayDateTime(r.createdAt),
        pcsMasuk: b.filter((x) => x.direction === "MASUK").reduce((s, x) => s + x.qty, 0),
        pcsKeluar: b.filter((x) => x.direction === "KELUAR").reduce((s, x) => s + x.qty, 0),
        jumlahBaris: b.length,
        catatanKeputusan: r.reviewNote,
      };
    });

  return { baris: hasil, perStatus, total: Object.values(perStatus).reduce((s, n) => s + n, 0) };
}

// ─── Rincian kantor ──────────────────────────────────────────────────────────

export type BarisRincianTukar = {
  id: string;
  direction: "MASUK" | "KELUAR";
  itemId: string;
  variantSku: string;
  nama: string;
  qty: number;
  harga: number | null;
  nilai: number | null;
  /** Stok gudang tersedia sekarang — hanya baris KELUAR. */
  tersedia: number | null;
};

export type RincianTukar = {
  id: string;
  docNo: string;
  status: string;
  toko: { id: string; nama: string; kode: string; alamat: string; jenis: string };
  salesmanId: string;
  salesman: string;
  dibuat: string;
  dibuatIso: string;
  catatan: string | null;
  diputuskanOleh: string | null;
  diputuskanPada: string | null;
  catatanKeputusan: string | null;
  selesaiPada: string | null;
  selesaiIso: string | null;
  baris: BarisRincianTukar[];
  /** Null kalau ada barang yang harganya belum diatur. */
  nilai: NilaiTukar | null;
  /** Kekurangan stok KELUAR saat ini — hanya dihitung selama dokumen masih terbuka. */
  kurang: (KurangStok & { nama: string })[];
  jejak: { id: string; aksi: string; oleh: string; pada: string; alasan: string | null }[];
};

export async function rincianTukar(id: string): Promise<RincianTukar | null> {
  const d = await prisma.storeExchange.findUnique({ where: { id } });
  if (!d) return null;

  const [toko, baris, jejakRows] = await Promise.all([
    prisma.store.findUnique({
      where: { id: d.storeId },
      select: { id: true, name: true, code: true, address: true, termsType: true, marginPercent: true },
    }),
    prisma.storeExchangeLine.findMany({
      where: { exchangeId: d.id },
      orderBy: [{ direction: "desc" }, { productName: "asc" }],
      select: { id: true, direction: true, itemId: true, variantSku: true, productName: true, qty: true },
    }),
    prisma.auditLog.findMany({
      where: { entityType: ENTITAS_TUKAR, entityId: d.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, userId: true, reason: true, createdAt: true },
    }),
  ]);

  const itemIds = [...new Set(baris.map((b) => b.itemId))];
  const [items, stok, nama] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, sellingPrice: true } }),
    prisma.inventoryValue.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true },
    }),
    namaPengguna([d.salesmanId, d.reviewedById, ...jejakRows.map((j) => j.userId)]),
  ]);

  const margin = toko?.marginPercent == null ? null : Number(toko.marginPercent);
  const harga = new Map<string, number | null>(
    items.map((i) => [
      i.id,
      computeStorePrice({ sellingPrice: i.sellingPrice === null ? null : Number(i.sellingPrice), termsType: "PUTUS", marginPercent: margin })
        .price,
    ]),
  );
  const tersedia = petaTersedia(stok);
  const barisTukar = baris as BarisTukar[];
  const nilai = hitungNilaiTukar(barisTukar, harga);
  const namaBaris = new Map(baris.map((b) => [kunciBarisTukar(b.itemId, b.variantSku), b.productName]));

  return {
    id: d.id,
    docNo: d.docNo,
    status: d.status,
    toko: {
      id: d.storeId,
      nama: toko?.name ?? "—",
      kode: toko?.code ?? "",
      alamat: toko?.address ?? "",
      jenis: toko?.termsType ?? "",
    },
    salesmanId: d.salesmanId,
    salesman: nama.get(d.salesmanId) ?? "—",
    dibuat: formatDisplayDateTime(d.createdAt),
    dibuatIso: d.createdAt.toISOString(),
    catatan: d.note,
    diputuskanOleh: d.reviewedById ? (nama.get(d.reviewedById) ?? "—") : null,
    diputuskanPada: d.reviewedAt ? formatDisplayDateTime(d.reviewedAt) : null,
    catatanKeputusan: d.reviewNote,
    selesaiPada: d.completedAt ? formatDisplayDateTime(d.completedAt) : null,
    selesaiIso: d.completedAt ? d.completedAt.toISOString() : null,
    baris: baris.map((b) => {
      const h = harga.get(b.itemId) ?? null;
      return {
        id: b.id,
        direction: b.direction === "KELUAR" ? "KELUAR" : "MASUK",
        itemId: b.itemId,
        variantSku: b.variantSku,
        nama: b.productName,
        qty: b.qty,
        harga: h,
        nilai: h == null ? null : b.qty * h,
        tersedia: b.direction === "KELUAR" ? tersedia(b.itemId, b.variantSku) : null,
      };
    }),
    nilai: nilai.ok ? nilai.nilai : null,
    kurang: statusTukarTerbuka(d.status)
      ? kekuranganStok(barisTukar, tersedia).map((k) => ({ ...k, nama: namaBaris.get(kunciBarisTukar(k.itemId, k.variantSku)) ?? k.itemId }))
      : [],
    jejak: jejakRows.map((j) => ({
      id: j.id,
      aksi: j.action,
      oleh: nama.get(j.userId) ?? "—",
      pada: formatDisplayDateTime(j.createdAt),
      alasan: j.reason,
    })),
  };
}

/** Untuk teks kabar: nama toko satu dokumen. */
export async function namaTokoTukar(storeId: string): Promise<string> {
  const t = await prisma.store.findUnique({ where: { id: storeId }, select: { name: true } });
  return t?.name ?? "toko";
}
