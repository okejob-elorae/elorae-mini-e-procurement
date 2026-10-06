import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { HARI_KIRIMAN_AWAL, muatKiriman, type JenisKiriman } from "./kiriman";

/**
 * Pesanan yang sedang menuju toko SPG, dan kabar saat barangnya berangkat.
 *
 * SPG tidak memesan — salesman (atau toko lewat portal) yang memesan — jadi
 * tanpa daftar ini SPG baru tahu ada barang datang saat dusnya tiba.
 *
 * Isinya HANYA nomor, tanggal, status, dan jumlah potong. Tidak ada rupiah:
 * ini layar HP SPG, dan nilai pesanan (apalagi harga konsinyasi) tidak pernah
 * sampai ke sana. Kuerinya bahkan tidak memilih kolom harga.
 *
 * Komponen klien hanya boleh `import type` dari berkas ini (menarik Prisma).
 */

/**
 * - MENUNGGU_PERSETUJUAN : pesanan belum disetujui kantor.
 * - DISETUJUI            : pesanan putus disetujui, belum ada yang dikirim.
 * - DIKIRIM_SEBAGIAN     : pesanan putus yang sebagian sudah dikirim; yang tampil sisanya.
 * - DALAM_PERJALANAN     : pesanan konsi yang disetujui (barang sudah keluar gudang) dan
 *                          belum diterima toko — juga tampil di daftar kiriman menunggu.
 */
export type StatusPesananMenuju = "MENUNGGU_PERSETUJUAN" | "DISETUJUI" | "DIKIRIM_SEBAGIAN" | "DALAM_PERJALANAN";
export const STATUS_PESANAN_MENUJU: StatusPesananMenuju[] = ["DALAM_PERJALANAN", "DIKIRIM_SEBAGIAN", "DISETUJUI", "MENUNGGU_PERSETUJUAN"];

export type BarangPesananMenuju = { kunci: string; nama: string; varian: string; pcs: number };

export type PesananMenujuToko = {
  id: string;
  orderNo: string;
  status: StatusPesananMenuju;
  dipesanPada: Date;
  /** Pre-order (inden): barangnya belum ada, dikirim sesudah jendelanya dirilis. */
  inden: boolean;
  barang: BarangPesananMenuju[];
  jumlahPcs: number;
};

/** Bentuk yang dikirim ke HP: tanggal sudah diformat di server. */
export type PesananMenujuHp = Omit<PesananMenujuToko, "dipesanPada"> & { tanggalLabel: string };

export type BarisPesananMentah = {
  id: string;
  orderNo: string;
  orderType: string;
  status: string;
  deliveryStatus: string;
  createdAt: Date;
  approvedAt: Date | null;
  preorderWindowId: string | null;
  lines: { itemId: string; variantSku: string | null; productName: string; qty: number; deliveredQty: number; cancelledQty: number }[];
};

function statusDari(o: BarisPesananMentah, sejak: Date, konsiDiterima: ReadonlySet<string>): StatusPesananMenuju | null {
  if (o.status === "PENDING_APPROVAL") return "MENUNGGU_PERSETUJUAN";
  if (o.status !== "APPROVED") return null;
  if (o.orderType === "KONSI") {
    // Sama dengan `kirimanMenunggu`: konsi yang disetujui sebelum toko mulai dilacak
    // sudah lama di rak (masuk lewat opname), bukan barang yang sedang datang.
    if (konsiDiterima.has(o.id) || !o.approvedAt || o.approvedAt < sejak) return null;
    return "DALAM_PERJALANAN";
  }
  if (o.deliveryStatus === "PENDING") return "DISETUJUI";
  if (o.deliveryStatus === "PARTIAL") return "DIKIRIM_SEBAGIAN";
  return null;
}

/**
 * Murni: baris pesanan mentah → daftar yang tampil. Per barang × ukuran,
 * jumlahnya yang BELUM berangkat (dipesan − dikirim − dibatalkan); pesanan tanpa
 * sisa tidak tampil. Urutan: yang sudah di jalan dulu, lalu dikirim sebagian,
 * disetujui, menunggu — yang terlama dulu di tiap status.
 */
export function susunPesananMenuju(
  baris: readonly BarisPesananMentah[],
  opsi: { sejak: Date; konsiDiterima: ReadonlySet<string> },
): PesananMenujuToko[] {
  const hasil: PesananMenujuToko[] = [];
  for (const o of baris) {
    const status = statusDari(o, opsi.sejak, opsi.konsiDiterima);
    if (!status) continue;
    const perBarang = new Map<string, BarangPesananMenuju>();
    for (const l of o.lines) {
      const sisa = l.qty - l.deliveredQty - l.cancelledQty;
      if (sisa <= 0) continue;
      const varian = l.variantSku ?? "";
      const kunci = `${l.itemId}::${varian}`;
      const ada = perBarang.get(kunci);
      if (ada) ada.pcs += sisa;
      else perBarang.set(kunci, { kunci, nama: l.productName, varian, pcs: sisa });
    }
    const barang = [...perBarang.values()].sort((a, b) => a.nama.localeCompare(b.nama, "id") || a.varian.localeCompare(b.varian, "id"));
    const jumlahPcs = barang.reduce((n, b) => n + b.pcs, 0);
    if (jumlahPcs <= 0) continue;
    hasil.push({ id: o.id, orderNo: o.orderNo, status, dipesanPada: o.createdAt, inden: o.preorderWindowId !== null, barang, jumlahPcs });
  }
  const urutan = (s: StatusPesananMenuju) => STATUS_PESANAN_MENUJU.indexOf(s);
  return hasil.sort((a, b) => urutan(a.status) - urutan(b.status) || a.dipesanPada.getTime() - b.dipesanPada.getTime());
}

/**
 * Hitungan untuk daftar tugas beranda SPG: pesanan yang masih diproses kantor.
 * Yang sudah di jalan tidak dihitung — ia sudah terhitung di "Kiriman datang".
 */
export function hitungPesananDiproses(daftar: readonly Pick<PesananMenujuToko, "status">[]): number {
  return daftar.filter((p) => p.status !== "DALAM_PERJALANAN").length;
}

/** Murni: muatan HP — tanggal diformat di server, tidak ada kolom lain yang ditambahkan. */
export function pesananMenujuUntukHp(daftar: readonly PesananMenujuToko[], formatTanggal: (d: Date) => string): PesananMenujuHp[] {
  return daftar.map((p) => ({
    id: p.id,
    orderNo: p.orderNo,
    status: p.status,
    tanggalLabel: formatTanggal(p.dipesanPada),
    inden: p.inden,
    barang: p.barang.map((b) => ({ kunci: b.kunci, nama: b.nama, varian: b.varian, pcs: b.pcs })),
    jumlahPcs: p.jumlahPcs,
  }));
}

const HARI_MS = 86_400_000;
/** Batas daftar per toko — toko dengan ratusan pesanan terbuka adalah data yang perlu dibereskan, bukan dibaca di HP. */
const BATAS_PESANAN = 100;

/** Pesanan yang sedang menuju toko ini. */
export async function pesananMenujuToko(storeId: string, sekarang = new Date()): Promise<PesananMenujuToko[]> {
  // Awal pelacakan toko — aturan yang sama dengan `kirimanMenunggu`.
  const pertama = await prisma.storeStockMovement.findFirst({
    where: { storeId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const sejak = pertama?.createdAt ?? new Date(sekarang.getTime() - HARI_KIRIMAN_AWAL * HARI_MS);

  const baris = await prisma.fieldSalesOrder.findMany({
    where: {
      storeId,
      OR: [
        { status: "PENDING_APPROVAL" },
        { status: "APPROVED", orderType: "PUTUS", deliveryStatus: { in: ["PENDING", "PARTIAL"] } },
        { status: "APPROVED", orderType: "KONSI", approvedAt: { gte: sejak } },
      ],
    },
    // Yang terbaru yang dipertahankan bila melewati batas; urutan tampil disusun sesudahnya.
    orderBy: { createdAt: "desc" },
    take: BATAS_PESANAN,
    select: {
      id: true,
      orderNo: true,
      orderType: true,
      status: true,
      deliveryStatus: true,
      createdAt: true,
      approvedAt: true,
      preorderWindowId: true,
      // Sengaja TANPA unitPrice/lineTotal/discountAmount: harga tidak pernah dibaca untuk HP SPG.
      lines: { select: { itemId: true, variantSku: true, productName: true, qty: true, deliveredQty: true, cancelledQty: true } },
    },
  });

  const konsiIds = baris.filter((o) => o.orderType === "KONSI" && o.status === "APPROVED").map((o) => o.id);
  const diterima =
    konsiIds.length === 0
      ? []
      : await prisma.storeReceipt.findMany({ where: { sourceType: "KONSI_ORDER", sourceId: { in: konsiIds } }, select: { sourceId: true } });

  return susunPesananMenuju(baris, { sejak, konsiDiterima: new Set(diterima.map((r) => r.sourceId)) });
}

// ─── Kabar saat barang berangkat ─────────────────────────────────────────────

/** Dokumen yang membuat barang benar-benar keluar gudang menuju toko. */
export type SumberKirimanBerangkat = Extract<JenisKiriman, "PUTUS_DELIVERY" | "KONSI_ORDER" | "KONSI_SHIPMENT">;

/** Penanda "sudah dikabarkan" di `AuditLog` — satu baris per dokumen, kunci sekali-kirimnya. */
export const JEJAK_KIRIMAN_BERANGKAT = "STORE_SHIPMENT_DEPARTED_NOTIFIED";

const ENTITAS: Record<SumberKirimanBerangkat, string> = {
  PUTUS_DELIVERY: "FieldSalesDelivery",
  KONSI_ORDER: "FieldSalesOrder",
  KONSI_SHIPMENT: "ConsignmentShipment",
};

const LABEL: Record<SumberKirimanBerangkat, string> = {
  PUTUS_DELIVERY: "Pengiriman pesanan",
  KONSI_ORDER: "Pesanan konsinyasi",
  KONSI_SHIPMENT: "Kiriman konsinyasi",
};

async function tokoDokumen(sourceType: SumberKirimanBerangkat, sourceId: string): Promise<string | null> {
  if (sourceType === "PUTUS_DELIVERY") {
    const d = await prisma.fieldSalesDelivery.findUnique({ where: { id: sourceId }, select: { order: { select: { storeId: true } } } });
    return d?.order.storeId ?? null;
  }
  if (sourceType === "KONSI_ORDER") {
    // Pesanan PUTUS yang disetujui belum mengirim apa pun — barangnya berangkat saat pengiriman.
    const o = await prisma.fieldSalesOrder.findFirst({ where: { id: sourceId, orderType: "KONSI", status: "APPROVED" }, select: { storeId: true } });
    return o?.storeId ?? null;
  }
  const k = await prisma.consignmentShipment.findUnique({ where: { id: sourceId }, select: { storeId: true } });
  return k?.storeId ?? null;
}

/**
 * Kabari setiap SPG toko (User.assignedStoreId) bahwa barang berangkat ke tokonya.
 *
 * Dipanggil SESUDAH transaksi dokumennya selesai, dan tidak pernah melempar.
 * Sekali per dokumen: penandanya ditulis di `runSerializable` sebelum kabar
 * dikirim, jadi kiriman ulang idempoten, persetujuan ulang, atau dua panggilan
 * bersamaan hanya menghasilkan satu kabar per SPG. Toko tanpa SPG dan dokumen
 * yang sudah diterima toko tidak menulis apa pun.
 */
export async function kabarkanKirimanBerangkat(input: {
  sourceType: SumberKirimanBerangkat;
  sourceId: string;
  pelakuId: string;
}): Promise<{ penerima: number }> {
  const { sourceType, sourceId, pelakuId } = input;
  if (typeof sourceId !== "string" || sourceId === "" || typeof pelakuId !== "string" || pelakuId === "") return { penerima: 0 };
  try {
    const storeId = await tokoDokumen(sourceType, sourceId);
    if (!storeId) return { penerima: 0 };
    const [kiriman, sudahDiterima, spg] = await Promise.all([
      muatKiriman(prisma, storeId, sourceType, sourceId),
      prisma.storeReceipt.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } }, select: { id: true } }),
      prisma.user.findMany({ where: { assignedStoreId: storeId, id: { not: pelakuId } }, select: { id: true }, orderBy: { id: "asc" } }),
    ]);
    if (!kiriman || kiriman.lines.length === 0 || sudahDiterima || spg.length === 0) return { penerima: 0 };

    const entityType = ENTITAS[sourceType];
    const baru = await runSerializable(async (tx) => {
      const ada = await tx.auditLog.findFirst({
        where: { entityType, entityId: sourceId, action: JEJAK_KIRIMAN_BERANGKAT },
        select: { id: true },
      });
      if (ada) return false;
      await tx.auditLog.create({
        data: {
          userId: pelakuId,
          action: JEJAK_KIRIMAN_BERANGKAT,
          entityType,
          entityId: sourceId,
          metadata: { storeId, docNo: kiriman.docNo, penerima: spg.length, otomatis: true },
        },
      });
      return true;
    });
    if (!baru) return { penerima: 0 };

    // Dimuat di sini, bukan di puncak berkas: halaman yang hanya membaca daftar pesanan
    // (beranda SPG, Terima kiriman) tidak perlu ikut memuat Firebase Admin.
    const { JENIS_KABAR, kabariPengguna } = await import("@/lib/notifications/kabar-pengguna");
    const pcs = kiriman.lines.reduce((n, l) => n + l.qty, 0);
    for (const s of spg) {
      await kabariPengguna(s.id, {
        jenis: JENIS_KABAR.KIRIMAN_BERANGKAT,
        judul: "Barang sedang dikirim ke toko Anda",
        isi: `${LABEL[sourceType]} ${kiriman.docNo} · ${pcs} pcs. Hitung barangnya saat tiba, lalu terima di menu Terima kiriman.`,
        data: { storeId, sourceType, sourceId },
      });
    }
    return { penerima: spg.length };
  } catch (err) {
    console.error("[kabar] kiriman berangkat gagal", sourceType, sourceId, err);
    return { penerima: 0 };
  }
}
