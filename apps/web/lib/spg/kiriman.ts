import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { bacaPesananKonsiLama } from "./antaran-queries";

/**
 * Kiriman barang ke toko, dari beberapa sumber, dalam satu bentuk.
 *
 * - PUTUS_DELIVERY  : nota tagihan pesanan putus (`FieldSalesDelivery`). Nota
 *                     sebuah pengiriman terbuka di sini setelah pengirimannya
 *                     BERANGKAT; nota yang dibatalkan tidak pernah.
 * - KONSI_TRANSFER  : SATU ANTARAN pesanan konsinyasi — `KonsiTransfer` yang
 *                     dibuat saat pengiriman (`DeliveryShipment`) DIBUAT (surat
 *                     jalan, Q1) dan masih DALAM PERJALANAN ke Gudang Toko.
 *                     Terbuka di sini setelah pengirimannya berangkat; penerimaan
 *                     toko yang menaruhnya di rak. Pesanan 100 pcs yang dikirim
 *                     60 lalu 40 = dua kiriman, diterima sendiri-sendiri.
 * - KONSI_ORDER     : HANYA pesanan konsinyasi LAMA, yang stoknya keluar saat
 *                     disetujui tanpa pengiriman (`bacaPesananKonsiLama`) — tetap
 *                     diterima sekali per pesanan. Pesanan aturan baru tidak
 *                     pernah terbuka di sini: persetujuan hanya mencadangkan.
 *                     Pesanan lama yang cadangannya MASIH ditahan tidak terbuka
 *                     di sini juga: SPG mengonfirmasi yang sudah sampai dari
 *                     "Pesanan untuk toko ini" (`konfirmasiSampaiPesananLama`).
 * - KONSI_SHIPMENT  : kiriman modul konsinyasi (`ConsignmentShipment`); barisnya
 *                     boleh tanpa `itemId` (diketik nama saja).
 * - MUTASI          : mutasi dari toko lain (`StoreTransfer`) yang sudah DIKIRIM
 *                     ke toko ini.
 * - MUTASI_KEMBALI  : mutasi toko ini yang dibatalkan kantor sesudah dikirim
 *                     (DIKEMBALIKAN) — barangnya kembali dan diterima toko asal.
 *
 * Jumlah yang DIKIRIM selalu dibaca dari dokumen sumbernya di server — layar
 * SPG hanya mengirim jumlah yang DITERIMA (dan yang DITOLAK di pintu). Untuk
 * antaran, "dikirim" adalah isi surat jalan itu dikurangi yang sudah kembali ke
 * gudang, bukan jumlah pesanan: sisa pesanan yang belum dikirim gudang tidak
 * pernah menjadi kekurangan. Untuk nota putus, "dikirim" = yang ditagih + yang
 * sudah dikoreksi kembali/hilang.
 */

/** Status pengiriman yang sudah berangkat dari gudang — kirimannya boleh diterima toko. */
export const STATUS_PENGIRIMAN_BERANGKAT = ["IN_TRANSIT", "DELIVERED", "PARTIALLY_DELIVERED"] as const;

function berangkat(status: string): boolean {
  return (STATUS_PENGIRIMAN_BERANGKAT as readonly string[]).includes(status);
}

export type JenisKiriman = "PUTUS_DELIVERY" | "KONSI_TRANSFER" | "KONSI_ORDER" | "KONSI_SHIPMENT" | "MUTASI" | "MUTASI_KEMBALI";
export const JENIS_KIRIMAN: JenisKiriman[] = ["PUTUS_DELIVERY", "KONSI_TRANSFER", "KONSI_ORDER", "KONSI_SHIPMENT", "MUTASI", "MUTASI_KEMBALI"];

/** Kiriman dari mutasi antar toko: stoknya bergerak sebagai MUTASI_MASUK, bukan TERIMA. */
export function dariMutasi(jenis: JenisKiriman): jenis is "MUTASI" | "MUTASI_KEMBALI" {
  return jenis === "MUTASI" || jenis === "MUTASI_KEMBALI";
}

export type BarisKiriman = {
  /** id baris di dokumen sumber — kunci jawaban jumlah diterima. */
  lineId: string;
  itemId: string | null;
  variantSku: string;
  productName: string;
  qty: number;
};

export type Kiriman = {
  sourceType: JenisKiriman;
  sourceId: string;
  docNo: string;
  tanggal: Date;
  lines: BarisKiriman[];
  /** Nomor pesanan asal (pengiriman putus, antaran konsinyasi); hanya untuk ditampilkan. */
  pesananNo?: string | null;
  /** Pengirimannya masih di jalan (belum dikonfirmasi ekspedisi/kurir) — lencana "Dalam perjalanan". */
  dalamPerjalanan?: boolean;
  /** Barang boleh dicatat "Ditolak, dibawa pulang kurir" (P40): kiriman gudang lewat pengiriman. */
  bolehDitolak?: boolean;
  /**
   * Nota tagihan yang dicatat tangan sebelum aturan pengiriman (tanpa `DeliveryShipment`). R24:
   * tetap bisa dibaca dan diterima seperti dulu, tetapi tidak mendapat jalan koreksi atau
   * pembatalan baru — tidak bisa ditolak di pintu, notanya tidak dikoreksi saat diterima kurang,
   * dan kekurangannya dibuka sebagai barang hilang sesudah commit seperti sebelumnya.
   */
  tanpaPengiriman?: boolean;
  /**
   * Pengirimannya sudah dikonfirmasi ekspedisi/kurir (DELIVERED/PARTIALLY_DELIVERED): barangnya
   * sudah diserahkan ke toko. Syarat penerimaan oleh salesman pemegang (R12, P45a).
   */
  diserahkan?: boolean;
};

type Klien = Prisma.TransactionClient | typeof prisma;

/** Satu kiriman untuk toko ini, atau null kalau tidak ada / bukan milik toko ini. */
export async function muatKiriman(
  klien: Klien,
  storeId: string,
  sourceType: JenisKiriman,
  sourceId: string,
): Promise<Kiriman | null> {
  if (sourceType === "PUTUS_DELIVERY") {
    const d = await klien.fieldSalesDelivery.findFirst({
      where: { id: sourceId, order: { storeId }, voidedAt: null },
      select: {
        id: true,
        docNo: true,
        deliveredAt: true,
        order: { select: { orderNo: true } },
        shipment: { select: { status: true, shippedAt: true, deliveredAt: true } },
        lines: { select: { id: true, itemId: true, variantSku: true, productName: true, qty: true, returnedQty: true, lostQty: true } },
      },
    });
    if (!d) return null;
    return {
      sourceType,
      sourceId: d.id,
      docNo: d.docNo,
      tanggal: d.shipment ? (d.shipment.deliveredAt ?? d.shipment.shippedAt ?? d.deliveredAt) : d.deliveredAt,
      pesananNo: d.order.orderNo,
      dalamPerjalanan: d.shipment?.status === "IN_TRANSIT",
      diserahkan: d.shipment?.status === "DELIVERED" || d.shipment?.status === "PARTIALLY_DELIVERED",
      bolehDitolak: d.shipment !== null,
      tanpaPengiriman: d.shipment === null,
      lines: d.lines.map((l) => ({
        lineId: l.id,
        itemId: l.itemId,
        variantSku: l.variantSku ?? "",
        productName: l.productName,
        qty: l.qty + l.returnedQty + l.lostQty,
      })),
    };
  }
  if (sourceType === "KONSI_TRANSFER") {
    // Hanya antaran yang lahir dari pengiriman dan MASIH DI PERJALANAN. Transfer lama
    // tanpa pengiriman (stok keluar saat disetujui) diterima lewat pesanannya
    // (`KONSI_ORDER`), dan transfer konfirmasi sampai pesanan lama (`oldOrderArrival`)
    // sudah dihitung saat dikonfirmasi — tanda terimanya dibuat bersamanya.
    const t = await klien.konsiTransfer.findFirst({
      where: { id: sourceId, storeId, shipmentId: { not: null }, status: "IN_TRANSIT" },
      select: {
        id: true,
        docNo: true,
        createdAt: true,
        order: { select: { orderNo: true } },
        shipment: { select: { docNo: true, status: true, shippedAt: true, deliveredAt: true } },
        lines: { select: { id: true, itemId: true, variantSku: true, productName: true, qty: true, returnedQty: true } },
      },
    });
    if (!t) return null;
    return {
      sourceType,
      sourceId: t.id,
      // Nomor pengiriman: itu yang tertulis di surat jalan yang dibawa pengantar.
      docNo: t.shipment?.docNo ?? t.docNo,
      tanggal: t.shipment?.deliveredAt ?? t.shipment?.shippedAt ?? t.createdAt,
      pesananNo: t.order.orderNo,
      dalamPerjalanan: t.shipment?.status === "IN_TRANSIT",
      diserahkan: t.shipment?.status === "DELIVERED" || t.shipment?.status === "PARTIALLY_DELIVERED",
      bolehDitolak: true,
      lines: t.lines
        .map((l) => ({
          lineId: l.id,
          itemId: l.itemId,
          variantSku: l.variantSku ?? "",
          productName: l.productName,
          qty: Math.round(Number(l.qty)) - l.returnedQty,
        }))
        .filter((l) => l.qty > 0),
    };
  }
  if (sourceType === "KONSI_ORDER") {
    // Pesanan aturan baru tidak pernah diterima per pesanan — antarannya yang diterima.
    if (!(await bacaPesananKonsiLama(klien, [sourceId])).lama.has(sourceId)) return null;
    const o = await klien.fieldSalesOrder.findFirst({
      where: { id: sourceId, storeId, orderType: "KONSI", status: "APPROVED" },
      select: {
        id: true,
        orderNo: true,
        approvedAt: true,
        createdAt: true,
        lines: { select: { id: true, itemId: true, variantSku: true, productName: true, qty: true, cancelledQty: true } },
      },
    });
    if (!o) return null;
    return {
      sourceType,
      sourceId: o.id,
      docNo: o.orderNo,
      tanggal: o.approvedAt ?? o.createdAt,
      lines: o.lines
        .map((l) => ({ lineId: l.id, itemId: l.itemId, variantSku: l.variantSku ?? "", productName: l.productName, qty: l.qty - l.cancelledQty }))
        .filter((l) => l.qty > 0),
    };
  }
  if (dariMutasi(sourceType)) {
    // Status dibaca di sini juga: mutasi yang dibatalkan, dialihkan ke toko
    // lain, atau sudah diterima tidak bisa dibuka sebagai kiriman.
    const m = await klien.storeTransfer.findFirst({
      where:
        sourceType === "MUTASI"
          ? { id: sourceId, toStoreId: storeId, status: "DIKIRIM" }
          : { id: sourceId, fromStoreId: storeId, status: "DIKEMBALIKAN", shippedAt: { not: null } },
      select: {
        id: true,
        docNo: true,
        shippedAt: true,
        createdAt: true,
        lines: { orderBy: { productName: "asc" }, select: { id: true, itemId: true, variantSku: true, productName: true, qty: true } },
      },
    });
    if (!m) return null;
    return {
      sourceType,
      sourceId: m.id,
      docNo: m.docNo,
      tanggal: m.shippedAt ?? m.createdAt,
      lines: m.lines.map((l) => ({ lineId: l.id, itemId: l.itemId, variantSku: l.variantSku ?? "", productName: l.productName, qty: l.qty })),
    };
  }
  const k = await klien.consignmentShipment.findFirst({
    where: { id: sourceId, storeId },
    select: {
      id: true,
      noKirim: true,
      shippedAt: true,
      items: { select: { id: true, itemId: true, variantSku: true, itemName: true, qty: true } },
    },
  });
  if (!k) return null;
  return {
    sourceType,
    sourceId: k.id,
    docNo: k.noKirim,
    tanggal: k.shippedAt,
    // Varian kiriman diteruskan ke tanda terima: stok titipan dan buku toko dihitung per ukuran.
    lines: k.items.map((l) => ({ lineId: l.id, itemId: l.itemId, variantSku: l.variantSku ?? "", productName: l.itemName, qty: l.qty })),
  };
}

const HARI_MS = 86_400_000;
/** Toko yang belum mulai dilacak: kiriman sebulan terakhir yang ditawarkan. */
export const HARI_KIRIMAN_AWAL = 30;

/**
 * Kiriman ke toko yang belum diterima SPG.
 *
 * Kiriman gudang lewat pengiriman (nota putus, antaran konsinyasi) terbuka sejak
 * pengirimannya berangkat, tanpa jendela tanggal. Sumber lama (nota tanpa
 * pengiriman, kiriman modul konsinyasi, pesanan konsi lama) sejak awal pelacakan
 * toko (gerakan stok pertama) — kiriman sebelum itu sudah lama ada di rak dan
 * masuk lewat opname. Toko yang belum mulai dilacak melihat 30 hari terakhir.
 */
export async function kirimanMenunggu(storeId: string, sekarang = new Date()): Promise<Kiriman[]> {
  const pertama = await prisma.storeStockMovement.findFirst({
    where: { storeId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const sejak = pertama?.createdAt ?? new Date(sekarang.getTime() - HARI_KIRIMAN_AWAL * HARI_MS);

  const [putus, antaran, konsiCalon, kirim, diterima, mutasi] = await Promise.all([
    // Nota sebuah pengiriman: setelah berangkat, TANPA jendela tanggal (kiriman di
    // jalan harus diterima berapa pun umurnya, dan SPG baru melihat semuanya). Nota
    // yang dicatat tangan dulu (tanpa pengiriman) tetap memakai jendela lama.
    prisma.fieldSalesDelivery.findMany({
      where: {
        order: { storeId },
        voidedAt: null,
        OR: [
          { shipment: { is: { status: { in: [...STATUS_PENGIRIMAN_BERANGKAT] } } } },
          { shipment: { is: null }, deliveredAt: { gte: sejak } },
        ],
      },
      select: { id: true },
    }),
    // Antaran konsinyasi: satu per pengiriman yang berangkat dan masih di perjalanan.
    prisma.konsiTransfer.findMany({
      where: {
        storeId,
        shipmentId: { not: null },
        status: "IN_TRANSIT",
        shipment: { is: { status: { in: [...STATUS_PENGIRIMAN_BERANGKAT] } } },
      },
      select: { id: true },
    }),
    // Calon pesanan konsi LAMA — disaring `bacaPesananKonsiLama` di bawah.
    prisma.fieldSalesOrder.findMany({
      where: { storeId, orderType: "KONSI", status: "APPROVED", approvedAt: { gte: sejak } },
      select: { id: true },
    }),
    prisma.consignmentShipment.findMany({
      where: { storeId, shippedAt: { gte: sejak } },
      select: { id: true },
    }),
    prisma.storeReceipt.findMany({ where: { storeId }, select: { sourceType: true, sourceId: true } }),
    // Mutasi TANPA jendela tanggal: kiriman antar toko selalu sesudah buku toko
    // asal dimulai, dan yang sedang di jalan harus diterima berapa pun umurnya.
    prisma.storeTransfer.findMany({
      where: {
        OR: [
          { toStoreId: storeId, status: "DIKIRIM" },
          { fromStoreId: storeId, status: "DIKEMBALIKAN", shippedAt: { not: null } },
        ],
      },
      select: { id: true, toStoreId: true },
    }),
  ]);

  const konsiLama = (await bacaPesananKonsiLama(prisma, konsiCalon.map((o) => o.id))).lama;
  const sudah = new Set(diterima.map((r) => `${r.sourceType}:${r.sourceId}`));
  const calon: { sourceType: JenisKiriman; sourceId: string }[] = [
    ...putus.map((d) => ({ sourceType: "PUTUS_DELIVERY" as const, sourceId: d.id })),
    ...antaran.map((t) => ({ sourceType: "KONSI_TRANSFER" as const, sourceId: t.id })),
    ...konsiCalon.filter((o) => konsiLama.has(o.id)).map((o) => ({ sourceType: "KONSI_ORDER" as const, sourceId: o.id })),
    ...kirim.map((k) => ({ sourceType: "KONSI_SHIPMENT" as const, sourceId: k.id })),
    ...mutasi.map((m) => ({ sourceType: m.toStoreId === storeId ? ("MUTASI" as const) : ("MUTASI_KEMBALI" as const), sourceId: m.id })),
  ].filter((c) => !sudah.has(`${c.sourceType}:${c.sourceId}`));

  const hasil = await Promise.all(calon.map((c) => muatKiriman(prisma, storeId, c.sourceType, c.sourceId)));
  return hasil
    .filter((k): k is Kiriman => k !== null && k.lines.length > 0)
    .sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime());
}

export type KeadaanKiriman = "SIAP" | "BELUM_BERANGKAT" | "DIBATALKAN";

/**
 * Bolehkah kiriman ini diterima toko SEKARANG. Hanya kiriman gudang lewat
 * pengiriman yang punya keadaan: pengiriman yang masih DIKEMAS belum berangkat
 * (BELUM_BERANGKAT); pengiriman yang "tidak jadi dikirim", antaran yang
 * dibatalkan, atau nota yang dibatalkan = DIBATALKAN. Sumber lain selalu SIAP.
 * `null` = dokumennya tidak ada untuk toko ini.
 */
export async function keadaanKiriman(
  klien: Klien,
  storeId: string,
  sourceType: JenisKiriman,
  sourceId: string,
): Promise<KeadaanKiriman | null> {
  if (sourceType === "KONSI_TRANSFER") {
    const t = await klien.konsiTransfer.findFirst({
      where: { id: sourceId, storeId },
      select: { status: true, shipment: { select: { status: true } } },
    });
    if (!t) return null;
    if (t.status === "CANCELLED" || t.shipment?.status === "CANCELLED") return "DIBATALKAN";
    if (t.shipment && !berangkat(t.shipment.status)) return "BELUM_BERANGKAT";
    return "SIAP";
  }
  if (sourceType === "PUTUS_DELIVERY") {
    const d = await klien.fieldSalesDelivery.findFirst({
      where: { id: sourceId, order: { storeId } },
      select: { voidedAt: true, shipment: { select: { status: true } } },
    });
    if (!d) return null;
    if (d.voidedAt || d.shipment?.status === "CANCELLED") return "DIBATALKAN";
    if (d.shipment && !berangkat(d.shipment.status)) return "BELUM_BERANGKAT";
    return "SIAP";
  }
  return "SIAP";
}

/**
 * Jumlah SPG toko ini: pengguna yang toko tetapnya (`assignedStoreId`) toko ini —
 * aturan yang sama dengan penerima kabar pengiriman. SPG yang hanya tidak masuk
 * tetap terhitung (P26: barangnya menunggu sampai ia kembali); SPG yang ditandai
 * berhenti sudah dilepas dari tokonya.
 */
export async function jumlahSpgToko(klien: Klien, storeId: string): Promise<number> {
  return klien.user.count({ where: { assignedStoreId: storeId } });
}

/**
 * Siapa yang mencatat penerimaan toko atas sebuah pengiriman gudang, dilihat saat ekspedisi/kurir
 * mengonfirmasinya. Satu aturan untuk penulis konfirmasi dan layarnya:
 *
 * - `SPG` — toko punya SPG sekarang (P40; yang hanya tidak masuk tetap terhitung, P26): konfirmasi
 *   kurir hanya serah terima, SPG yang menerima dan mencatat yang ditolak atau hilang.
 * - `PEMEGANG` — toko kini tanpa SPG, SPG toko ini berhenti sementara barangnya di jalan (hari
 *   terakhirnya, `spgEndedOn` hari WIB, tidak sebelum hari pengiriman itu dibuat), dan toko aktif
 *   ini punya salesman pemegang: penanggung jawab toko yang menerima, pemegang mencatatnya saat
 *   berkunjung dengan nama penanggung jawab + foto (P45/P45a, "benar"). Toko tanpa pemegang (P47
 *   hanya mewajibkan pemegang di toko konsi) atau yang nonaktif tidak masuk sini: tidak ada yang
 *   bisa mencatat penerimaan itu (`terimaKirimanPemegang` butuh pemegang yang check-in).
 * - `KURIR` — selain itu: konfirmasi kurir sekaligus penerimaan toko (keputusan 2026-10-29
 *   tambahan #3), termasuk toko yang SPG-nya berhenti sebelum pengiriman itu dibuat.
 *
 * Barang yang DITOLAK di pintu pada kasus `PEMEGANG` belum dijawab pemilik (formulir pemegang hanya
 * mencatat yang tiba); sampai dijawab, konfirmasi kurir yang mencatat penolakan tetap menjadi
 * penerimaan toko seperti sebelumnya. Begitu juga konfirmasi yang tidak menyerahkan apa pun: tidak
 * ada yang diterima penanggung jawab, dan pemegang hanya bisa mencatat kiriman yang sudah
 * diserahkan — lihat `completeDeliveryShipment`.
 */
export type PenerimaPod = "SPG" | "PEMEGANG" | "KURIR";

export async function penerimaPod(klien: Klien, storeId: string, pengirimanDibuat: Date): Promise<PenerimaPod> {
  if ((await jumlahSpgToko(klien, storeId)) > 0) return "SPG";
  const toko = await klien.store.findUnique({ where: { id: storeId }, select: { salesmanId: true, isActive: true } });
  if (!toko?.salesmanId || !toko.isActive) return "KURIR";
  const berhentiDiJalan = await klien.user.count({
    where: { spgEndedStoreId: storeId, spgEndedOn: { gte: formatDateOnlyJakarta(pengirimanDibuat) } },
  });
  return berhentiDiJalan > 0 ? "PEMEGANG" : "KURIR";
}

/**
 * Kiriman gudang yang menunggu diterima di toko-toko yang DIPEGANG salesman ini dan kini TANPA SPG
 * (SPG-nya berhenti, P45a): barangnya sudah DISERAHKAN ke toko (pengiriman DELIVERED/PARTIALLY_DELIVERED
 * — yang masih di jalan menunggu konfirmasi ekspedisi/kurir dulu, R12; bila SPG-nya berhenti saat
 * barang itu di jalan, konfirmasi itu hanya serah terima, `penerimaPod` = PEMEGANG), toko belum menerimanya.
 * Bahan tugas di HP pemegang — tanpa ini barangnya bisa tertahan "dalam perjalanan" tanpa ada yang
 * tahu. Toko yang SPG-nya hanya tidak masuk tetap punya SPG dan TIDAK masuk sini (P26: menunggu SPG-nya).
 */
export async function kirimanMenungguPemegang(userId: string): Promise<Array<{ storeId: string; kiriman: Kiriman[] }>> {
  if (!userId) return [];
  const toko = await prisma.store.findMany({ where: { salesmanId: userId, isActive: true }, select: { id: true } });
  const hasil: Array<{ storeId: string; kiriman: Kiriman[] }> = [];
  for (const t of toko) {
    if ((await jumlahSpgToko(prisma, t.id)) > 0) continue;
    const kiriman = (await kirimanMenunggu(t.id)).filter(
      (k) => (k.sourceType === "KONSI_TRANSFER" || k.sourceType === "PUTUS_DELIVERY") && k.diserahkan === true,
    );
    if (kiriman.length > 0) hasil.push({ storeId: t.id, kiriman });
  }
  return hasil;
}
