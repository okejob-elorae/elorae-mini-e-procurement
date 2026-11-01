import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { sisaBarisPesanan, type BarisPengirimanBerjalan } from "./antaran";
import { muatKiriman, type JenisKiriman } from "./kiriman";

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
 * Putus dan konsinyasi dibaca dengan aturan yang SAMA (keputusan pemilik
 * 2026-11-01): persetujuan hanya mencadangkan, barang keluar gudang per
 * pengiriman. Sisa pesanan dibagi ke tiga tempat (`sisaBarisPesanan`): sedang
 * dikemas, dalam perjalanan, dan BELUM DIKIRIM GUDANG — yang terakhir masih di
 * gudang dan tidak pernah menjadi kekurangan. Barang yang sudah diserahkan
 * pindah ke daftar "Terima kiriman", dan sisa yang ditutup kantor hilang dari
 * sini begitu saja.
 *
 * Komponen klien hanya boleh `import type` dari berkas ini (menarik Prisma).
 */

/**
 * - MENUNGGU_PERSETUJUAN : pesanan belum disetujui kantor.
 * - DISETUJUI            : disetujui, belum ada barang yang berangkat (boleh sedang dikemas).
 * - DIKIRIM_SEBAGIAN     : sebagian sudah diserahkan ke toko; yang tampil sisanya.
 * - DALAM_PERJALANAN     : ada pengiriman yang sedang di jalan menuju toko.
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
  /** Per barang × ukuran: yang belum sampai toko (menunggu: yang dipesan). */
  barang: BarangPesananMenuju[];
  jumlahPcs: number;
  /** Sisa yang belum masuk pengiriman mana pun — masih di gudang. 0 untuk pesanan yang belum disetujui. */
  belumDikirimGudang: number;
  /** Sisa yang sudah dikemas gudang, belum berangkat. */
  dikemas: number;
  /** Sisa yang sedang di jalan menuju toko. */
  dalamPerjalanan: number;
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
  lines: { id?: string; itemId: string; variantSku: string | null; productName: string; qty: number; deliveredQty: number; cancelledQty: number }[];
  /** Pengiriman pesanan ini yang masih berjalan (PACKED / IN_TRANSIT). */
  shipments?: BarisPengirimanBerjalan[];
};

/**
 * Murni: baris pesanan mentah → daftar yang tampil. Per barang × ukuran,
 * jumlahnya yang BELUM sampai toko (dipesan − diserahkan − dibatalkan); pesanan
 * tanpa sisa tidak tampil. Urutan: yang sedang di jalan dulu, lalu dikirim
 * sebagian, disetujui, menunggu — yang terlama dulu di tiap status.
 */
export function susunPesananMenuju(baris: readonly BarisPesananMentah[]): PesananMenujuToko[] {
  const hasil: PesananMenujuToko[] = [];
  for (const o of baris) {
    const menunggu = o.status === "PENDING_APPROVAL";
    if (!menunggu && !(o.status === "APPROVED" && (o.deliveryStatus === "PENDING" || o.deliveryStatus === "PARTIAL"))) continue;
    const pengiriman = o.shipments ?? [];
    const perBarang = new Map<string, BarangPesananMenuju>();
    let dikemas = 0;
    let dalamPerjalanan = 0;
    let belumDikirimGudang = 0;
    let adaTerkirim = false;
    for (const l of o.lines) {
      if (l.deliveredQty > 0) adaTerkirim = true;
      const s = menunggu
        ? { sisa: Math.max(0, l.qty - l.cancelledQty), dikemas: 0, dalamPerjalanan: 0, belumDikirimGudang: 0 }
        : sisaBarisPesanan(l, pengiriman);
      if (s.sisa <= 0) continue;
      dikemas += s.dikemas;
      dalamPerjalanan += s.dalamPerjalanan;
      belumDikirimGudang += s.belumDikirimGudang;
      const varian = l.variantSku ?? "";
      const kunci = `${l.itemId}::${varian}`;
      const ada = perBarang.get(kunci);
      if (ada) ada.pcs += s.sisa;
      else perBarang.set(kunci, { kunci, nama: l.productName, varian, pcs: s.sisa });
    }
    const barang = [...perBarang.values()].sort((a, b) => a.nama.localeCompare(b.nama, "id") || a.varian.localeCompare(b.varian, "id"));
    const jumlahPcs = barang.reduce((n, b) => n + b.pcs, 0);
    if (jumlahPcs <= 0) continue;
    const status: StatusPesananMenuju = menunggu
      ? "MENUNGGU_PERSETUJUAN"
      : dalamPerjalanan > 0
        ? "DALAM_PERJALANAN"
        : adaTerkirim || o.deliveryStatus === "PARTIAL"
          ? "DIKIRIM_SEBAGIAN"
          : "DISETUJUI";
    hasil.push({
      id: o.id,
      orderNo: o.orderNo,
      status,
      dipesanPada: o.createdAt,
      inden: o.preorderWindowId !== null,
      barang,
      jumlahPcs,
      belumDikirimGudang,
      dikemas,
      dalamPerjalanan,
    });
  }
  const urutan = (s: StatusPesananMenuju) => STATUS_PESANAN_MENUJU.indexOf(s);
  return hasil.sort((a, b) => urutan(a.status) - urutan(b.status) || a.dipesanPada.getTime() - b.dipesanPada.getTime());
}

/**
 * Hitungan untuk daftar tugas beranda SPG: pesanan yang belum sampai toko.
 * Barang yang sudah diserahkan tidak ada di daftar ini lagi — ia terhitung di
 * "Kiriman datang" — jadi setiap baris daftar ini dihitung, termasuk yang
 * sedang di jalan (belum bisa diterima sebelum diserahkan).
 */
export function hitungPesananDiproses(daftar: readonly Pick<PesananMenujuToko, "status">[]): number {
  return daftar.length;
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
    belumDikirimGudang: p.belumDikirimGudang,
    dikemas: p.dikemas,
    dalamPerjalanan: p.dalamPerjalanan,
  }));
}

/** Batas daftar per toko — toko dengan ratusan pesanan terbuka adalah data yang perlu dibereskan, bukan dibaca di HP. */
const BATAS_PESANAN = 100;

/**
 * Pesanan yang sedang menuju toko ini. Argumen kedua (`sekarang`) tidak dipakai
 * lagi — dulu jendela pelacakan untuk konsi yang disetujui, kini konsi dibaca
 * dari pengirimannya seperti putus — dan hanya dipertahankan untuk pemanggil lama.
 */
export function pesananMenujuToko(storeId: string, sekarang?: Date): Promise<PesananMenujuToko[]>;
export async function pesananMenujuToko(storeId: string): Promise<PesananMenujuToko[]> {
  const baris = await prisma.fieldSalesOrder.findMany({
    where: {
      storeId,
      OR: [{ status: "PENDING_APPROVAL" }, { status: "APPROVED", deliveryStatus: { in: ["PENDING", "PARTIAL"] } }],
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
      lines: { select: { id: true, itemId: true, variantSku: true, productName: true, qty: true, deliveredQty: true, cancelledQty: true } },
      shipments: {
        where: { status: { in: ["PACKED", "IN_TRANSIT"] } },
        select: { status: true, lines: { select: { orderLineId: true, plannedQty: true } } },
      },
    },
  });
  return susunPesananMenuju(baris);
}

// ─── Kabar saat barang berangkat ─────────────────────────────────────────────

/**
 * Dokumen JALUR SATU LANGKAH yang membuat barang keluar gudang menuju toko:
 * pengiriman putus yang dicatat kantor sekaligus, dan titipan modul
 * konsinyasi. Pengiriman yang berjalan dua tahap (dikemas → berangkat →
 * diserahkan) dikabarkan per pengiriman di `kabar-pengiriman.ts` — juga untuk
 * konsinyasi, karena persetujuan pesanan konsi hanya mencadangkan.
 */
export type SumberKirimanBerangkat = Extract<JenisKiriman, "PUTUS_DELIVERY" | "KONSI_SHIPMENT">;

/** Penanda "sudah dikabarkan" di `AuditLog` — satu baris per dokumen, kunci sekali-kirimnya. */
export const JEJAK_KIRIMAN_BERANGKAT = "STORE_SHIPMENT_DEPARTED_NOTIFIED";

const ENTITAS: Record<SumberKirimanBerangkat, string> = {
  PUTUS_DELIVERY: "FieldSalesDelivery",
  KONSI_SHIPMENT: "ConsignmentShipment",
};

const LABEL: Record<SumberKirimanBerangkat, string> = {
  PUTUS_DELIVERY: "Pengiriman pesanan",
  KONSI_SHIPMENT: "Kiriman konsinyasi",
};

async function tokoDokumen(sourceType: SumberKirimanBerangkat, sourceId: string): Promise<string | null> {
  if (sourceType === "PUTUS_DELIVERY") {
    const d = await prisma.fieldSalesDelivery.findUnique({ where: { id: sourceId }, select: { order: { select: { storeId: true } } } });
    return d?.order.storeId ?? null;
  }
  if (sourceType !== "KONSI_SHIPMENT") return null;
  const k = await prisma.consignmentShipment.findUnique({ where: { id: sourceId }, select: { storeId: true } });
  return k?.storeId ?? null;
}

/**
 * Kabari setiap SPG toko (User.assignedStoreId) bahwa barang berangkat ke tokonya
 * — jalur satu langkah saja (lihat `SumberKirimanBerangkat`).
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
