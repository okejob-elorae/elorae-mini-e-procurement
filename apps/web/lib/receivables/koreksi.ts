import { Prisma, prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "./jejak";
import { hitungUlangDariKlaim } from "./writer";
import { balikkanBukuRetur, barisTanpaBukuToko, lepaskanNomorBatal } from "./return-writer";
import { penerjemahPesanToko, pesanPembatalan, tautanPesanToko } from "./pesan-toko";

/**
 * Koreksi laporan yang tercatat ke toko yang salah.
 *
 * Dua jalan, sengaja tidak simetris:
 *
 * - SALES boleh MENARIK laporannya sendiri selama belum ada yang menyentuhnya —
 *   BKM sebelum keuangan memutuskan, nota retur sebelum gudang menghitung.
 *   Tidak pernah diam-diam: barisnya tetap ada, jejaknya mencatat `olehSales`,
 *   dan kantor menerima notifikasi. Tanpa itu, sales yang menerima uang tunai
 *   bisa melapor lalu menarik laporannya tanpa ada yang tahu.
 * - KANTOR boleh MEMINDAHKAN nota retur (bersama hitungan gudang dan beban
 *   terbukanya) ke toko lain, dan menetapkan toko hitungan gudang yatim.
 *
 * BKM tidak pernah dipindah toko: ia terikat pada faktur, potongan, dan nota
 * retur satu toko. Yang benar adalah membatalkan lalu melaporkan ulang.
 *
 * Rancangan: docs/superpowers/specs/2026-10-01-koreksi-salah-toko-design.md.
 */

export const KATEGORI_NOTIF_KLAIM_DIBATALKAN_SALES = "KLAIM_DIBATALKAN_SALES";
export const KATEGORI_NOTIF_RETUR_DIBATALKAN_SALES = "RETUR_DIBATALKAN_SALES";
/** Sales meminta kantor membetulkan laporan yang sudah diproses. */
export const KATEGORI_NOTIF_KOREKSI_BKM = "KOREKSI_DIMINTA_BKM";
export const KATEGORI_NOTIF_KOREKSI_RETUR = "KOREKSI_DIMINTA_RETUR";

/** BKM yang masih bisa mengubah piutang: menunggu verifikasi, atau sudah terverifikasi. */
const KLAIM_HIDUP = ["DIKIRIM", "TERVERIFIKASI"] as const;

export type AlasanKoreksi =
  | "ALASAN_WAJIB"
  | "TIDAK_DITEMUKAN"
  | "BUKAN_MILIK"
  | "SUDAH_DIPUTUSKAN"
  | "SUDAH_DIBATALKAN"
  | "SUDAH_DIHITUNG"
  | "BEBAN_SUDAH_DIPUTUSKAN"
  | "TOKO_SAMA"
  | "TOKO_TIDAK_DITEMUKAN"
  | "TOKO_TIDAK_AKTIF"
  | "NOMOR_DIPAKAI_DI_TUJUAN"
  | "SUDAH_BERPASANGAN"
  /** Laporan masih bisa ditarik sendiri — tidak perlu meminta kantor. */
  | "TARIK_SENDIRI"
  /** Laporan sudah dibatalkan / ditolak — dilaporkan ulang, bukan dikoreksi. */
  | "SUDAH_DITUTUP"
  /** Permintaan sebelumnya belum ditangani kantor. */
  | "SUDAH_DIMINTA"
  /**
   * Nota SPG yang sudah menggerakkan buku stok toko asal. Memindahkannya
   * meninggalkan barang yang "keluar" dari rak toko yang salah — dibatalkan
   * (bukunya dibalik) lalu dilaporkan ulang dari toko yang benar.
   */
  | "ADA_BUKU_TOKO"
  /**
   * Nota yang mengirim balik barang rusak (rusak dari kiriman atau rusak dari
   * pembeli): barisnya menunjuk dokumen TOKO ASAL (tanda terima / retur
   * pembeli di toko itu). Memindah notanya membuat penunjuk itu menunjuk toko
   * lain — dibatalkan lalu dilaporkan ulang dari toko yang benar.
   */
  | "ADA_BARIS_RUSAK";

export type GagalKoreksi =
  | { ok: false; alasan: AlasanKoreksi }
  /** Nota dipakai sebagai potongan di BKM yang masih hidup — BKM itu dibetulkan dulu. */
  | { ok: false; alasan: "DIPAKAI_DI_BKM"; docNo: string[] }
  /**
   * Hitungan gudangnya jatuh di bulan yang siklus konsinyasinya sudah dikunci
   * (toko asal atau tujuan). Bukan larangan: pemanggil mengulang dengan
   * `setujuSiklusTerkunci` sesudah orangnya mengonfirmasi.
   */
  | { ok: false; alasan: "SIKLUS_TERKUNCI"; noKonsi: string[] };

/** Baris notifikasi yang ditulis di dalam transaksi; disebar oleh pemanggil SESUDAH commit. */
export type NotifikasiKoreksi = {
  id: string;
  category: string;
  title: string;
  message: string;
  metadata: unknown;
};

export type HasilTarik = { ok: true; docNo: string; notifikasi: NotifikasiKoreksi } | GagalKoreksi;

const rupiah = (n: unknown) => `Rp ${Math.round(Number(n)).toLocaleString("id-ID")}`;

const gagal = (alasan: AlasanKoreksi): GagalKoreksi => ({ ok: false, alasan });

/**
 * Sales menarik BKM-nya sendiri.
 *
 * Hanya `DIKIRIM`: begitu keuangan memutuskan, uangnya sudah dicocokkan dengan
 * mutasi rekening dan hanya keuangan yang boleh membatalkannya. Ditulis dengan
 * compare-and-swap pada status, jadi verifikasi yang sedang berjalan bersamaan
 * dan penarikan ini tidak bisa sama-sama menang — `putuskanKlaim` memakai
 * penjaga yang sama dari sisinya.
 */
export async function batalkanKlaimSendiri(input: {
  paymentClaimId: string;
  salesmanId: string;
  alasan: string;
}): Promise<HasilTarik> {
  const alasan = input.alasan?.trim();
  if (!alasan) return gagal("ALASAN_WAJIB");

  // Serializable, bukan transaksi biasa: `updateMany` Prisma memilih id lalu
  // memperbarui menurut id saja, jadi syarat status hanya utuh kalau basis data
  // sendiri yang menolak salah satu dari dua penulis bersamaan.
  return runSerializable(async (tx) => {
    const klaim = await tx.paymentClaim.findUnique({
      where: { id: input.paymentClaimId },
      select: {
        id: true,
        docNo: true,
        status: true,
        salesmanId: true,
        receivedAmount: true,
        store: { select: { name: true } },
        salesman: { select: { name: true } },
      },
    });
    if (!klaim) return gagal("TIDAK_DITEMUKAN");
    if (klaim.salesmanId !== input.salesmanId) return gagal("BUKAN_MILIK");
    if (klaim.status === "DIBATALKAN") return gagal("SUDAH_DIBATALKAN");
    if (klaim.status !== "DIKIRIM") return gagal("SUDAH_DIPUTUSKAN");

    const ubah = await tx.paymentClaim.updateMany({
      where: { id: klaim.id, salesmanId: input.salesmanId, status: "DIKIRIM" },
      data: { status: "DIBATALKAN", verifyNote: alasan, verifiedById: input.salesmanId, verifiedAt: new Date() },
    });
    // Keuangan memutuskan di antara baca dan tulis: keputusannya yang berlaku.
    if (ubah.count === 0) return gagal("SUDAH_DIPUTUSKAN");

    // Klaim DIKIRIM mengakui nol, jadi angkanya tidak bergerak — tetap dihitung
    // ulang supaya kolom cache tidak pernah bergantung pada asumsi itu.
    await hitungUlangDariKlaim(tx, klaim.id);

    await catatJejak(tx, {
      userId: input.salesmanId,
      action: JEJAK.KLAIM_DIBATALKAN,
      entityType: "PaymentClaim",
      entityId: klaim.id,
      changes: { before: { status: "DIKIRIM" }, after: { status: "DIBATALKAN" } },
      metadata: { docNo: klaim.docNo, olehSales: true },
      reason: alasan,
    });

    const notifikasi = await tx.adminNotification.create({
      data: {
        category: KATEGORI_NOTIF_KLAIM_DIBATALKAN_SALES,
        severity: "WARNING",
        title: `${klaim.docNo} ditarik sales`,
        message: `${klaim.salesman.name ?? "Sales"} membatalkan laporan pelunasan ${klaim.docNo} (${klaim.store.name}, ${rupiah(klaim.receivedAmount)}). Alasan: ${alasan}`,
        metadata: { paymentClaimId: klaim.id, docNo: klaim.docNo },
      },
      select: { id: true, category: true, title: true, message: true, metadata: true },
    });
    return { ok: true as const, docNo: klaim.docNo, notifikasi };
  });
}

/**
 * Sales menarik nota retur yang ia catat sendiri.
 *
 * Hanya sebelum gudang menghitung: sesudah itu barangnya sudah masuk dan
 * stoknya sudah bertambah, jadi yang membetulkan adalah kantor (pindahkan ke
 * toko yang benar). Ditolak juga kalau nota dipakai potongan di BKM yang masih
 * hidup — membatalkannya akan menahan potongan itu penuh, keputusan uang yang
 * bukan milik sales.
 */
export async function batalkanReturSendiri(input: {
  storeReturnId: string;
  salesmanId: string;
  alasan: string;
}): Promise<HasilTarik> {
  const alasan = input.alasan?.trim();
  if (!alasan) return gagal("ALASAN_WAJIB");

  return runSerializable(async (tx) => {
    const nota = await tx.storeReturn.findUnique({
      where: { id: input.storeReturnId },
      select: {
        id: true,
        noNrt: true,
        status: true,
        note: true,
        salesmanId: true,
        claimedAmount: true,
        store: { select: { name: true } },
        salesman: { select: { name: true } },
        warehouseReturn: { select: { id: true } },
        deductions: {
          where: { paymentClaim: { status: { in: [...KLAIM_HIDUP] } } },
          select: { paymentClaim: { select: { docNo: true } } },
        },
      },
    });
    if (!nota) return gagal("TIDAK_DITEMUKAN");
    if (nota.salesmanId !== input.salesmanId) return gagal("BUKAN_MILIK");
    if (nota.status === "BATAL") return gagal("SUDAH_DIBATALKAN");
    if (nota.warehouseReturn) return gagal("SUDAH_DIHITUNG");
    if (nota.deductions.length > 0) {
      return { ok: false as const, alasan: "DIPAKAI_DI_BKM" as const, docNo: [...new Set(nota.deductions.map((d) => d.paymentClaim.docNo))] };
    }

    const ubah = await tx.storeReturn.updateMany({
      where: { id: nota.id, status: { not: "BATAL" } },
      data: { status: "BATAL", note: [nota.note, alasan].filter(Boolean).join("\n") },
    });
    if (ubah.count === 0) return gagal("SUDAH_DIBATALKAN");
    // Barang yang dilaporkan keluar dari rak toko (NRT SPG) tidak jadi keluar:
    // pembalik +qty di buku toko, di transaksi yang sama. Baris lama tetap ada.
    const barisBukuDibalik = await balikkanBukuRetur(tx, nota.id, input.salesmanId);

    await catatJejak(tx, {
      userId: input.salesmanId,
      action: JEJAK.RETUR_DIBATALKAN,
      entityType: "StoreReturn",
      entityId: nota.id,
      changes: { before: { status: nota.status }, after: { status: "BATAL" } },
      metadata: { noNrt: nota.noNrt, olehSales: true, ...(barisBukuDibalik > 0 ? { barisBukuDibalik } : {}) },
      reason: alasan,
    });

    const notifikasi = await tx.adminNotification.create({
      data: {
        category: KATEGORI_NOTIF_RETUR_DIBATALKAN_SALES,
        severity: "WARNING",
        title: `Nota retur ${nota.noNrt} ditarik sales`,
        message: `${nota.salesman?.name ?? "Sales"} membatalkan nota retur ${nota.noNrt} (${nota.store.name}, ${rupiah(nota.claimedAmount)}). Alasan: ${alasan}`,
        metadata: { storeReturnId: nota.id, noNrt: nota.noNrt },
      },
      select: { id: true, category: true, title: true, message: true, metadata: true },
    });
    return { ok: true as const, docNo: nota.noNrt, notifikasi };
  });
}

type TokoTujuan = { id: string; name: string };

async function periksaTokoTujuan(
  tx: Prisma.TransactionClient,
  tokoTujuanId: string,
  tokoAsalId: string | null,
): Promise<TokoTujuan | GagalKoreksi> {
  if (tokoTujuanId === tokoAsalId) return gagal("TOKO_SAMA");
  const toko = await tx.store.findUnique({
    where: { id: tokoTujuanId },
    select: { id: true, name: true, isActive: true },
  });
  if (!toko) return gagal("TOKO_TIDAK_DITEMUKAN");
  // Toko nonaktif hampir pasti salah pilih lagi — dan nota di toko yang tidak
  // pernah dibuka orang tidak akan pernah diselesaikan.
  if (!toko.isActive) return gagal("TOKO_TIDAK_AKTIF");
  return { id: toko.id, name: toko.name };
}

const bukanGagal = <T extends object>(x: T | GagalKoreksi): x is T => !("ok" in x);

/**
 * Siklus konsinyasi terkunci yang tersentuh bila hitungan gudang yang diterima
 * pada `diterima` pindah antar `tokoIds`. Stok titipan dihitung dari hitungan
 * gudang per toko, jadi memindahkannya mengubah angka bulan itu di KEDUA toko —
 * termasuk bulan yang laporannya sudah dikunci dan mungkin sudah dicetak.
 * Bulannya dibaca WIB: diterima 1 Okt 00.00 WIB adalah Oktober, bukan September.
 */
async function siklusTerkunci(tx: Prisma.TransactionClient, diterima: Date, tokoIds: (string | null)[]): Promise<string[]> {
  const [tahun, bulan] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" })
    .format(diterima)
    .split("-")
    .map(Number);
  const ids = tokoIds.filter((x): x is string => Boolean(x));
  if (ids.length === 0) return [];
  const siklus = await tx.consignmentCycle.findMany({
    where: { storeId: { in: ids }, periodYear: tahun, periodMonth: bulan, lockedAt: { not: null } },
    select: { noKonsi: true },
    orderBy: { noKonsi: "asc" },
  });
  return siklus.map((c) => c.noKonsi);
}

export type HasilPindah = { ok: true } | GagalKoreksi;

/**
 * Pindahkan nota retur ke toko yang benar — beserta hitungan gudang dan beban
 * terbukanya, dalam satu transaksi, supaya keduanya tidak pernah berbeda toko
 * (`jodohkanRetur` menolak pasangan beda toko karena alasan yang sama).
 *
 * Stok tidak digerakkan: barangnya memang sudah masuk gudang, yang salah hanya
 * tokonya. Stok titipan konsinyasi kedua toko ikut benar dengan sendirinya,
 * karena dihitung dari hitungan gudang per toko.
 */
export async function pindahkanReturKeToko(input: {
  storeReturnId: string;
  tokoTujuanId: string;
  alasan: string;
  olehUserId: string;
  /** Orangnya sudah mengonfirmasi bahwa siklus konsinyasi yang terkunci ikut berubah. */
  setujuSiklusTerkunci?: boolean;
}): Promise<HasilPindah> {
  const alasan = input.alasan?.trim();
  if (!alasan) return gagal("ALASAN_WAJIB");

  try {
    return await runSerializable(async (tx) => {
      const nota = await tx.storeReturn.findUnique({
        where: { id: input.storeReturnId },
        select: {
          id: true,
          noNrt: true,
          storeId: true,
          status: true,
          store: { select: { name: true } },
          warehouseReturn: { select: { id: true, noNri: true, receivedAt: true } },
          items: { select: { storeReceiptLineId: true, spgSaleReturnLineId: true } },
          deductions: {
            where: { paymentClaim: { status: { in: [...KLAIM_HIDUP] } } },
            select: { paymentClaim: { select: { docNo: true } } },
          },
        },
      });
      if (!nota) return gagal("TIDAK_DITEMUKAN");
      if (nota.status === "BATAL") return gagal("SUDAH_DIBATALKAN");

      const tujuan = await periksaTokoTujuan(tx, input.tokoTujuanId, nota.storeId);
      if (!bukanGagal(tujuan)) return tujuan;

      // Buku stok toko asal sudah mencatat barangnya keluar. Memindah notanya
      // tidak memindah gerakan itu — dan buku tidak pernah ditulis ulang.
      const adaBuku = await tx.storeStockMovement.count({ where: { refType: "StoreReturn", refId: nota.id } });
      if (adaBuku > 0) return gagal("ADA_BUKU_TOKO");
      if (nota.items.some(barisTanpaBukuToko)) return gagal("ADA_BARIS_RUSAK");

      const milikPasangan = [
        { storeReturnId: nota.id },
        ...(nota.warehouseReturn ? [{ warehouseReturnId: nota.warehouseReturn.id }] : []),
      ];
      // Beban yang sudah ditetapkan menunjuk perbandingan di toko asal; seseorang
      // sudah menanggungnya. Memindahkan diam-diam menulis ulang keputusan itu.
      const diputuskan = await tx.returnCharge.count({
        where: { OR: milikPasangan, status: { not: "TERBUKA" } },
      });
      if (diputuskan > 0) return gagal("BEBAN_SUDAH_DIPUTUSKAN");

      if (nota.deductions.length > 0) {
        return {
          ok: false as const,
          alasan: "DIPAKAI_DI_BKM" as const,
          docNo: [...new Set(nota.deductions.map((d) => d.paymentClaim.docNo))],
        };
      }

      // Nota BATAL bernomor sama di toko tujuan melepas nomornya; nota yang masih
      // hidup adalah bentrok sungguhan. Diperiksa dulu supaya penolakannya
      // bersih; batasan unik tetap penjaga terakhirnya (ditangkap di bawah).
      const bentrok = await tx.storeReturn.findFirst({
        where: { storeId: tujuan.id, noNrt: nota.noNrt, status: { not: "BATAL" } },
        select: { id: true },
      });
      if (bentrok) return gagal("NOMOR_DIPAKAI_DI_TUJUAN");

      // Nota yang belum dihitung gudang tidak menyentuh stok titipan.
      const terkunci = nota.warehouseReturn
        ? await siklusTerkunci(tx, nota.warehouseReturn.receivedAt, [nota.storeId, tujuan.id])
        : [];
      if (terkunci.length > 0 && !input.setujuSiklusTerkunci) {
        return { ok: false as const, alasan: "SIKLUS_TERKUNCI" as const, noKonsi: terkunci };
      }
      const catatLepas = await lepaskanNomorBatal(tx, tujuan.id, nota.noNrt);

      await tx.storeReturn.update({ where: { id: nota.id }, data: { storeId: tujuan.id } });
      if (catatLepas) await catatLepas(nota.id, input.olehUserId);
      if (nota.warehouseReturn) {
        await tx.warehouseReturn.update({ where: { id: nota.warehouseReturn.id }, data: { storeId: tujuan.id } });
      }
      const beban = await tx.returnCharge.updateMany({
        where: { OR: milikPasangan, status: "TERBUKA" },
        data: { storeId: tujuan.id },
      });

      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.RETUR_DIPINDAH_TOKO,
        entityType: "StoreReturn",
        entityId: nota.id,
        changes: { before: { storeId: nota.storeId }, after: { storeId: tujuan.id } },
        metadata: {
          noNrt: nota.noNrt,
          noNri: nota.warehouseReturn?.noNri ?? null,
          tokoAsal: nota.store.name,
          tokoTujuan: tujuan.name,
          bebanIkutPindah: beban.count,
          ...(terkunci.length > 0 ? { siklusTerkunci: terkunci } : {}),
        },
        reason: alasan,
      });
      return { ok: true as const };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return gagal("NOMOR_DIPAKAI_DI_TUJUAN");
    throw err;
  }
}

/**
 * Tetapkan atau betulkan toko sebuah hitungan gudang YATIM (tanpa nota toko).
 *
 * Barang lewat ekspedisi datang mendahului notanya, dan gudang memilih tokonya
 * sendiri — bisa salah, bisa kosong. Yang sudah berpasangan ditolak: ia
 * dipindah lewat notanya, supaya nota dan hitungannya tidak pernah beda toko.
 */
export async function pindahkanNriKeToko(input: {
  warehouseReturnId: string;
  tokoTujuanId: string;
  alasan: string;
  olehUserId: string;
  setujuSiklusTerkunci?: boolean;
}): Promise<HasilPindah> {
  const alasan = input.alasan?.trim();
  if (!alasan) return gagal("ALASAN_WAJIB");

  return runSerializable(async (tx) => {
    const nri = await tx.warehouseReturn.findUnique({
      where: { id: input.warehouseReturnId },
      select: { id: true, noNri: true, storeId: true, storeReturnId: true, receivedAt: true, store: { select: { name: true } } },
    });
    if (!nri) return gagal("TIDAK_DITEMUKAN");
    if (nri.storeReturnId) return gagal("SUDAH_BERPASANGAN");

    const tujuan = await periksaTokoTujuan(tx, input.tokoTujuanId, nri.storeId);
    if (!bukanGagal(tujuan)) return tujuan;

    const diputuskan = await tx.returnCharge.count({
      where: { warehouseReturnId: nri.id, status: { not: "TERBUKA" } },
    });
    if (diputuskan > 0) return gagal("BEBAN_SUDAH_DIPUTUSKAN");

    const terkunci = await siklusTerkunci(tx, nri.receivedAt, [nri.storeId, tujuan.id]);
    if (terkunci.length > 0 && !input.setujuSiklusTerkunci) {
      return { ok: false as const, alasan: "SIKLUS_TERKUNCI" as const, noKonsi: terkunci };
    }

    await tx.warehouseReturn.update({ where: { id: nri.id }, data: { storeId: tujuan.id } });
    await tx.returnCharge.updateMany({
      where: { warehouseReturnId: nri.id, status: "TERBUKA" },
      data: { storeId: tujuan.id },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_DIPINDAH_TOKO,
      entityType: "WarehouseReturn",
      entityId: nri.id,
      changes: { before: { storeId: nri.storeId }, after: { storeId: tujuan.id } },
      metadata: {
        noNri: nri.noNri,
        tokoAsal: nri.store?.name ?? null,
        tokoTujuan: tujuan.name,
        ...(terkunci.length > 0 ? { siklusTerkunci: terkunci } : {}),
      },
      reason: alasan,
    });
    return { ok: true as const };
  });
}

export type HasilMintaKoreksi = { ok: true; notifikasi: NotifikasiKoreksi } | GagalKoreksi;

/**
 * Sales meminta kantor membetulkan laporan yang SUDAH diproses — BKM yang
 * terverifikasi, atau nota retur yang sudah dihitung gudang. Sales sendiri tidak
 * bisa mengubahnya lagi (itu yang menjaga uang dan stok), tapi sebelum ini
 * satu-satunya jalan adalah menelepon kantor, dan permintaannya tidak tercatat
 * di mana pun.
 *
 * Keputusannya tetap di kantor. Permintaan dianggap tertunda sampai dokumennya
 * berubah sesudah permintaan itu (dibatalkan, dipindah, dibetulkan) — lihat
 * `koreksiTertunda`.
 */
export async function mintaKoreksi(input: {
  jenis: "bkm" | "retur";
  id: string;
  salesmanId: string;
  alasan: string;
}): Promise<HasilMintaKoreksi> {
  const alasan = input.alasan?.trim();
  if (!alasan) return gagal("ALASAN_WAJIB");

  return runSerializable(async (tx) => {
    let nomor: string;
    let toko: string;
    let diubahPada: Date;
    let pelapor: string;
    if (input.jenis === "bkm") {
      const k = await tx.paymentClaim.findUnique({
        where: { id: input.id },
        select: {
          docNo: true,
          status: true,
          salesmanId: true,
          updatedAt: true,
          store: { select: { name: true } },
          salesman: { select: { name: true } },
        },
      });
      if (!k) return gagal("TIDAK_DITEMUKAN");
      if (k.salesmanId !== input.salesmanId) return gagal("BUKAN_MILIK");
      if (k.status === "DIKIRIM") return gagal("TARIK_SENDIRI");
      if (k.status !== "TERVERIFIKASI") return gagal("SUDAH_DITUTUP");
      nomor = k.docNo;
      toko = k.store.name;
      diubahPada = k.updatedAt;
      pelapor = k.salesman.name ?? "Sales";
    } else {
      const n = await tx.storeReturn.findUnique({
        where: { id: input.id },
        select: {
          noNrt: true,
          status: true,
          salesmanId: true,
          updatedAt: true,
          store: { select: { name: true } },
          salesman: { select: { name: true } },
          warehouseReturn: { select: { id: true } },
        },
      });
      if (!n) return gagal("TIDAK_DITEMUKAN");
      if (n.salesmanId !== input.salesmanId) return gagal("BUKAN_MILIK");
      if (n.status === "BATAL") return gagal("SUDAH_DITUTUP");
      if (!n.warehouseReturn) return gagal("TARIK_SENDIRI");
      nomor = n.noNrt;
      toko = n.store.name;
      diubahPada = n.updatedAt;
      pelapor = n.salesman?.name ?? "Sales";
    }

    const sebelumnya = await tx.auditLog.findFirst({
      where: { action: JEJAK.KOREKSI_DIMINTA, entityId: input.id, createdAt: { gt: diubahPada } },
      select: { id: true },
    });
    if (sebelumnya) return gagal("SUDAH_DIMINTA");

    await catatJejak(tx, {
      userId: input.salesmanId,
      action: JEJAK.KOREKSI_DIMINTA,
      entityType: input.jenis === "bkm" ? "PaymentClaim" : "StoreReturn",
      entityId: input.id,
      metadata: { nomor },
      reason: alasan,
    });

    const notifikasi = await tx.adminNotification.create({
      data: {
        category: input.jenis === "bkm" ? KATEGORI_NOTIF_KOREKSI_BKM : KATEGORI_NOTIF_KOREKSI_RETUR,
        severity: "WARNING",
        title: `${pelapor} minta koreksi ${nomor}`,
        message: `${pelapor} meminta ${nomor} (${toko}) dibetulkan. Alasan: ${alasan}`,
        metadata: input.jenis === "bkm" ? { paymentClaimId: input.id, docNo: nomor } : { storeReturnId: input.id, noNrt: nomor },
      },
      select: { id: true, category: true, title: true, message: true, metadata: true },
    });
    return { ok: true as const, notifikasi };
  });
}

/**
 * Permintaan koreksi yang belum ditangani, per dokumen: permintaan TERAKHIR
 * yang dibuat sesudah dokumennya terakhir berubah. Begitu kantor membatalkan,
 * memindahkan, atau membetulkan dokumennya, permintaan itu selesai sendiri.
 */
export async function koreksiTertunda(
  jenis: "bkm" | "retur",
  ids: string[],
): Promise<Map<string, { pada: string; alasan: string }>> {
  const hasil = new Map<string, { pada: string; alasan: string }>();
  if (ids.length === 0) return hasil;
  const [dokumen, permintaan] = await Promise.all([
    jenis === "bkm"
      ? prisma.paymentClaim.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true } })
      : prisma.storeReturn.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true } }),
    prisma.auditLog.findMany({
      where: { action: JEJAK.KOREKSI_DIMINTA, entityId: { in: ids } },
      select: { entityId: true, reason: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const diubah = new Map(dokumen.map((d) => [d.id, d.updatedAt.getTime()]));
  for (const p of permintaan) {
    if (hasil.has(p.entityId)) continue;
    const ubah = diubah.get(p.entityId);
    if (ubah !== undefined && p.createdAt.getTime() > ubah) {
      hasil.set(p.entityId, { pada: p.createdAt.toISOString(), alasan: p.reason ?? "" });
    }
  }
  return hasil;
}

export type BarisRiwayat = {
  id: string;
  action: string;
  entityType: string;
  oleh: string | null;
  pada: string;
  alasan: string | null;
  tokoAsal: string | null;
  tokoTujuan: string | null;
  /** Nomor dokumen lain yang terkait: pengganti / yang digantikan. */
  nomorTerkait: string | null;
};

const teks = (x: unknown) => (typeof x === "string" && x.trim() ? x : null);

/**
 * Riwayat keputusan atas satu atau beberapa dokumen (mis. nota retur dan
 * hitungan gudangnya), terbaru dulu. Barisnya sendiri hanya menyimpan keadaan
 * terakhir — siapa memindahkan dari toko mana, dan kenapa, hanya hidup di sini.
 */
export async function riwayatDokumen(entityIds: string[]): Promise<BarisRiwayat[]> {
  if (entityIds.length === 0) return [];
  const baris = await prisma.auditLog.findMany({
    where: { entityId: { in: entityIds } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      action: true,
      entityType: true,
      reason: true,
      metadata: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
  return baris.map((b) => {
    const m = (b.metadata ?? {}) as Record<string, unknown>;
    return {
      id: b.id,
      action: b.action,
      entityType: b.entityType,
      oleh: b.user?.name ?? null,
      pada: b.createdAt.toISOString(),
      alasan: b.reason,
      tokoAsal: teks(m.tokoAsal),
      tokoTujuan: teks(m.tokoTujuan),
      nomorTerkait: teks(m.docNoBaru) ?? teks(m.noNrtBaru) ?? teks(m.menggantikanDocNo),
    };
  });
}

/** Laporan pengganti per laporan lama: id lama → nomor dan id penggantinya. */
export async function penggantiUntuk(
  jenis: "bkm" | "retur",
  ids: string[],
): Promise<Map<string, { id: string; nomor: string }>> {
  const peta = new Map<string, { id: string; nomor: string }>();
  if (ids.length === 0) return peta;
  if (jenis === "bkm") {
    const rows = await prisma.paymentClaim.findMany({
      where: { replacesClaimId: { in: ids } },
      select: { id: true, docNo: true, replacesClaimId: true },
    });
    for (const r of rows) if (r.replacesClaimId) peta.set(r.replacesClaimId, { id: r.id, nomor: r.docNo });
  } else {
    const rows = await prisma.storeReturn.findMany({
      where: { replacesReturnId: { in: ids } },
      select: { id: true, noNrt: true, replacesReturnId: true },
    });
    for (const r of rows) if (r.replacesReturnId) peta.set(r.replacesReturnId, { id: r.id, nomor: r.noNrt });
  }
  return peta;
}

/**
 * Pesan WhatsApp "tanda terima dibatalkan" untuk BKM yang DIBATALKAN — toko
 * mungkin sudah memegang tanda terima untuk nomor itu. `pemilik`: layar HP
 * hanya untuk BKM yang ia laporkan sendiri.
 */
export async function tautanPembatalanKlaim(
  ids: string[],
  opsi?: { pemilik?: string },
): Promise<Map<string, { url: string; adaNomor: boolean }>> {
  const peta = new Map<string, { url: string; adaNomor: boolean }>();
  if (ids.length === 0) return peta;
  const rows = await prisma.paymentClaim.findMany({
    where: { id: { in: ids }, status: "DIBATALKAN", ...(opsi?.pemilik ? { salesmanId: opsi.pemilik } : {}) },
    select: { id: true, docNo: true, claimedTransferAt: true, receivedAmount: true, store: { select: { name: true, phone: true } } },
  });
  const { t, locale } = penerjemahPesanToko("id");
  for (const r of rows) {
    const pesan = pesanPembatalan(
      { toko: r.store.name, docNo: r.docNo, tanggal: r.claimedTransferAt, diterima: Number(r.receivedAmount) },
      t,
      locale,
    );
    peta.set(r.id, tautanPesanToko(r.store.phone, pesan));
  }
  return peta;
}
