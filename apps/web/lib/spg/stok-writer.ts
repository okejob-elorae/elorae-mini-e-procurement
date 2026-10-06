import { Prisma, prisma, type AdminNotification } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { variantDetailForSku } from "@/lib/items/variants";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { dariMutasi, muatKiriman, type JenisKiriman } from "./kiriman";
import { selisihPenerimaan } from "./mutasi-aturan";
import { bacaAlasan, type AlasanPermintaan } from "./saran-minta";
import { bukuDimulai, catatTerimaMutasi, periksaTerimaMutasi, tutupMutasiSaatTerima, type PenolakanTerimaMutasi } from "./mutasi-terima";
import { kunciBaris, rencanaOpname, saldoDariGerakan } from "./stok";
import { dilewatiKarenaLebihBaru, saldoAcuan, waktuHitungPerKunci } from "./opname-acuan";
import { kabariTitipanTersedia } from "./titip-tersedia";
import { catatHilangDariOpname, catatHilangDariPenerimaan } from "./hilang-sumber";
import { KATEGORI_NOTIF_RUSAK, masukBukuSaatTerima, periksaIsianRusak } from "./rusak";
import { BATAS_STOK_LURING_MS, jepitWaktuLuring } from "@/lib/pwa/waktu-luring";

/**
 * Penulis buku stok toko: terima kiriman, opname, minta kiriman, barang dicari.
 *
 * Setiap penulis menerima `storeId` dari PEMANGGIL (aksi server menurunkannya
 * dari toko tetap SPG) — tidak pernah dari layar.
 */

type Gagal<A extends string> = { ok: false; alasan: A };

export type AlasanTolakTerima =
  | "KIRIMAN_TIDAK_DITEMUKAN"
  | "SUDAH_DITERIMA"
  | "JUMLAH_TIDAK_VALID"
  | "LEBIH_DARI_DIKIRIM"
  /** Jumlah rusak bukan bilangan bulat 0..diterima, atau fotonya bukan foto kita. */
  | "RUSAK_TIDAK_VALID"
  /** Baris dengan barang rusak wajib membawa keterangan. */
  | "KETERANGAN_RUSAK_WAJIB"
  /** Dari antrean HP: waktu tangkapnya tidak terbaca atau lebih tua dari batas. */
  | "WAKTU_TIDAK_VALID"
  /** Kunci kiriman sudah dipakai tanda terima toko LAIN. */
  | "KUNCI_DIPAKAI"
  | PenolakanTerimaMutasi;

export type HasilTerimaKiriman = { ok: true; receiptId: string } | (Gagal<AlasanTolakTerima> & { noKonsi?: string[] });

/** Jawaban SPG per baris: yang TIBA, dan dari situ berapa yang rusak (opsional). */
export type JawabanTerima = {
  lineId: string;
  qtyReceived: number;
  qtyDamaged?: number | null;
  damageNote?: string | null;
  damagePhotoUrl?: string | null;
};

/** Diisi di dalam transaksi, disebar sesudahnya. */
type SesudahTerima = {
  notifikasi: AdminNotification | null;
  notifikasiRusak: AdminNotification | null;
  kabarDiterima: { userId: string; docNo: string; transferId: string; kurang: number } | null;
};

export async function terimaKiriman(input: {
  storeId: string;
  userId: string;
  sourceType: JenisKiriman;
  sourceId: string;
  /**
   * `qtyReceived` = yang TIBA (dasar selisih kurang-kirim dan titipan
   * konsinyasi). `qtyDamaged` (≤ diterima) tidak masuk buku stok toko sampai
   * gudang memutuskannya layak jual — lihat `lib/spg/rusak.ts`.
   */
  diterima: JawabanTerima[];
  note?: string | null;
  /**
   * Penerimaan oleh KANTOR atas nama toko (hanya mutasi): toko tujuan tanpa SPG,
   * atau kiriman yang sudah macet. Toko yang belum punya buku stok tidak
   * mendapat baris buku — tanda terimanya saja, dibaca stok titipan konsinyasi.
   */
  kantor?: { setujuSiklusTerkunci?: boolean };
  /**
   * Kunci kiriman dari HP, dibuat SEKALI per formulir. Diperiksa PALING DULU:
   * kiriman ulang (jawaban yang hilang di jalan, atau antrean tanpa sinyal yang
   * sudah pernah sampai) mendapat tanda terima yang sama, apa pun yang berubah
   * sejak itu — termasuk saat kirimannya kini terbaca "sudah diterima".
   */
  idempotencyKey?: string | null;
  /**
   * Antrean HP (dicatat tanpa sinyal): saat SPG menghitung kiriman. Tanda
   * terima dan gerakan bukunya bertanggal ini, bukan saat sinyal kembali.
   * Barang yang sudah dihitung opname toko SESUDAH waktu ini tidak mendapat
   * baris buku lagi — opname itu sudah melihatnya di rak (aturan yang sama
   * dengan nota SPG tanpa sinyal).
   */
  waktuTangkap?: Date | null;
  sekarang?: Date;
}): Promise<HasilTerimaKiriman> {
  const kunci = input.idempotencyKey?.trim() || null;
  if (kunci) {
    const ada = await tandaTerimaDenganKunci(kunci, input.storeId);
    if (ada) return ada;
  }
  let waktuTangkap: Date | null = null;
  if (input.waktuTangkap !== undefined && input.waktuTangkap !== null) {
    waktuTangkap = jepitWaktuLuring(input.waktuTangkap, input.sekarang ?? new Date(), BATAS_STOK_LURING_MS);
    if (!waktuTangkap) return { ok: false, alasan: "WAKTU_TIDAK_VALID" };
  }

  // Diisi di dalam transaksi; percobaan ulang menyetelnya ulang supaya catatan
  // dari percobaan yang dibatalkan tidak pernah ikut disebar.
  const sesudah: SesudahTerima = { notifikasi: null, notifikasiRusak: null, kabarDiterima: null };
  let hasil: HasilTerimaKiriman;
  try {
    hasil = await terimaDalamTransaksi(input, sesudah, { kunci, waktuTangkap });
  } catch (err) {
    // Dua HP yang menerima kiriman yang sama bersamaan: pemeriksaan di atas
    // lolos untuk keduanya, dan kunci unik (sumber) yang menolak yang kalah.
    // Kalau yang menang ternyata kiriman ini sendiri (kunci yang sama), itu
    // bukan penolakan — kembalikan tanda terimanya.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const ada = kunci ? await tandaTerimaDenganKunci(kunci, input.storeId) : null;
      return ada ?? { ok: false, alasan: "SUDAH_DITERIMA" };
    }
    throw err;
  }
  if (hasil.ok) {
    // Barang yang dititip-pesankan pembeli mungkin baru saja datang.
    void kabariTitipanTersedia(input.storeId);
    // Kiriman gudang yang diterima KURANG membuka catatan barang hilang. Mutasi
    // tidak: kurangnya diputuskan lewat selisih mutasi (HILANG/KEMBALI), dan
    // barang hilangnya dibuka dari keputusan itu.
    if (!dariMutasi(input.sourceType)) void catatHilangDariPenerimaan(hasil.receiptId, input.userId);
    if (sesudah.notifikasi) void fanOutAdminNotification(sesudah.notifikasi);
    // Barang rusak: gudang yang memutuskan nasibnya (`/backoffice/spg-kiriman-rusak`).
    if (sesudah.notifikasiRusak) void fanOutAdminNotification(sesudah.notifikasiRusak);
    const k = sesudah.kabarDiterima;
    if (k) {
      await kabariPengguna(k.userId, {
        jenis: JENIS_KABAR.MUTASI_DITERIMA,
        judul: k.kurang > 0 ? `Mutasi ${k.docNo} diterima kurang ${k.kurang} potong` : `Mutasi ${k.docNo} sudah diterima`,
        isi:
          k.kurang > 0
            ? "Toko tujuan menerima lebih sedikit dari yang dikirim. Kantor akan memeriksa selisihnya."
            : "Barang yang Anda kirim sudah dihitung dan diterima toko tujuan.",
        data: { transferId: k.transferId },
      });
    }
  }
  return hasil;
}

/**
 * Tanda terima yang sudah dicatat dengan kunci ini: hasil yang sama untuk
 * kiriman ulang dari toko yang sama; `KUNCI_DIPAKAI` kalau kunci itu milik
 * tanda terima toko lain (tidak pernah membocorkan id-nya).
 */
async function tandaTerimaDenganKunci(kunci: string, storeId: string): Promise<HasilTerimaKiriman | null> {
  const ada = await prisma.storeReceipt.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, storeId: true } });
  if (!ada) return null;
  return ada.storeId === storeId ? { ok: true, receiptId: ada.id } : { ok: false, alasan: "KUNCI_DIPAKAI" };
}

/**
 * Barang (kunci item::varian) yang sudah dihitung di opname toko SESUDAH
 * `waktu`. Pekerjaan dari antrean HP yang bertanggal sebelum opname itu tidak
 * boleh menggerakkan buku untuk barang ini lagi: opname sudah melihat raknya.
 */
export async function terhitungSesudah(
  tx: Prisma.TransactionClient,
  storeId: string,
  itemIds: string[],
  waktu: Date,
): Promise<Set<string>> {
  return new Set((await waktuHitungTerakhir(tx, storeId, itemIds, waktu)).keys());
}

/**
 * Waktu hitung terakhir per kunci barang di opname toko, hanya yang SESUDAH
 * `sejak`. Waktu hitung baris = `StoreOpnameLine.countedAt`; baris lama (atau
 * dari klien tanpa waktu hitung) memakai waktu opnamenya.
 */
export async function waktuHitungTerakhir(
  tx: Prisma.TransactionClient,
  storeId: string,
  itemIds: string[],
  sejak: Date,
): Promise<Map<string, Date>> {
  const hasil = new Map<string, Date>();
  if (itemIds.length === 0) return hasil;
  const baris = await tx.storeOpnameLine.findMany({
    where: {
      itemId: { in: itemIds },
      opname: { storeId },
      OR: [{ countedAt: { gt: sejak } }, { countedAt: null, opname: { countedAt: { gt: sejak } } }],
    },
    select: { itemId: true, variantSku: true, countedAt: true, opname: { select: { countedAt: true } } },
  });
  for (const b of baris) {
    const t = b.countedAt ?? b.opname.countedAt;
    const k = kunciBaris(b.itemId, b.variantSku);
    const ada = hasil.get(k);
    if (!ada || t.getTime() > ada.getTime()) hasil.set(k, t);
  }
  return hasil;
}

function terimaDalamTransaksi(
  input: Parameters<typeof terimaKiriman>[0],
  sesudah: SesudahTerima,
  luring: { kunci: string | null; waktuTangkap: Date | null },
) {
  // Penerimaan dari antrean HP dinilai pada waktu kirimannya dihitung (mis.
  // siklus konsinyasi bulan itu), bukan saat sinyal kembali.
  const sekarang = luring.waktuTangkap ?? input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<HasilTerimaKiriman> => {
    sesudah.notifikasi = null;
    sesudah.notifikasiRusak = null;
    sesudah.kabarDiterima = null;
    const mutasi = dariMutasi(input.sourceType) ? input.sourceType : null;
    // Kantor hanya menerima mutasi atas nama toko; kiriman lain milik SPG.
    if (input.kantor && !mutasi) return { ok: false, alasan: "KIRIMAN_TIDAK_DITEMUKAN" };

    // Kunci kiriman diperiksa lagi DI DALAM transaksi: percobaan ulang sesudah
    // balapan dua kiriman berkunci sama (yang kalah diulang runSerializable)
    // harus mendapat tanda terima pemenangnya, bukan "sudah diterima".
    if (luring.kunci) {
      const ada = await tx.storeReceipt.findUnique({ where: { idempotencyKey: luring.kunci }, select: { id: true, storeId: true } });
      if (ada) return ada.storeId === input.storeId ? { ok: true, receiptId: ada.id } : { ok: false, alasan: "KUNCI_DIPAKAI" };
    }

    // Tanda terima yang sudah ada diperiksa PALING DULU: percobaan ulang
    // sesudah balapan (atau kiriman kedua dari HP lain) harus terbaca "sudah
    // diterima", bukan "tidak ditemukan" karena status mutasinya sudah pindah.
    const sudah = await tx.storeReceipt.findUnique({
      where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } },
      select: { id: true },
    });
    if (sudah) return { ok: false, alasan: "SUDAH_DITERIMA" };

    const kiriman = await muatKiriman(tx, input.storeId, input.sourceType, input.sourceId);
    if (!kiriman) return { ok: false, alasan: "KIRIMAN_TIDAK_DITEMUKAN" };

    // SETIAP baris harus dijawab, dengan bilangan bulat ≥ 0. Baris yang tidak
    // dijawab bukan "nol" — itu layar yang tertinggal dari dokumennya.
    const jawab = new Map(input.diterima.map((d) => [d.lineId, d.qtyReceived]));
    const valid = kiriman.lines.every((l) => {
      const q = jawab.get(l.lineId);
      return q !== undefined && Number.isInteger(q) && q >= 0;
    });
    if (!valid) return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };
    const baris = kiriman.lines.map((l) => ({ qtySent: l.qty, qtyReceived: jawab.get(l.lineId) ?? 0 }));

    // Barang rusak per baris: ≤ diterima, keterangan wajib. Barang rusak tetap
    // dihitung TIBA (selisih kurang-kirim di atas tidak berubah) — hanya buku
    // stok toko yang menahannya sampai gudang memutuskan.
    const isianRusak = new Map(input.diterima.map((d) => [d.lineId, d]));
    const rusak = new Map<string, { qtyDamaged: number; damageNote: string | null; damagePhotoUrl: string | null }>();
    for (const l of kiriman.lines) {
      const d = isianRusak.get(l.lineId);
      const r = periksaIsianRusak({
        qtyReceived: jawab.get(l.lineId) ?? 0,
        qtyDamaged: d?.qtyDamaged,
        damageNote: d?.damageNote,
        damagePhotoUrl: d?.damagePhotoUrl,
      });
      if (!r.ok) return { ok: false, alasan: r.alasan };
      rusak.set(l.lineId, r);
    }
    const rusakDari = (lineId: string) => rusak.get(lineId)?.qtyDamaged ?? 0;

    let periksa: Awaited<ReturnType<typeof periksaTerimaMutasi>> | null = null;
    let tulisBuku = true;
    if (mutasi) {
      // Mutasi berpindah antar toko KITA: jumlah lebih dari yang dikirim
      // berarti barang dari toko asal yang tidak pernah keluar dari bukunya.
      if (baris.some((b) => b.qtyReceived > b.qtySent)) return { ok: false, alasan: "LEBIH_DARI_DIKIRIM" };
      periksa = await periksaTerimaMutasi(tx, {
        sourceType: mutasi,
        transferId: input.sourceId,
        storeId: input.storeId,
        olehKantor: Boolean(input.kantor),
        setujuSiklusTerkunci: Boolean(input.kantor?.setujuSiklusTerkunci),
        sekarang,
      });
      if (!periksa.ok) return { ok: false, alasan: periksa.alasan, ...(periksa.noKonsi ? { noKonsi: periksa.noKonsi } : {}) };
      if (!(await tutupMutasiSaatTerima(tx, { sourceType: mutasi, transferId: input.sourceId, storeId: input.storeId, baris }))) {
        return { ok: false, alasan: "KIRIMAN_TIDAK_DITEMUKAN" };
      }
      // Toko yang belum punya buku stok (tanpa SPG) tidak dibukakan buku oleh
      // penerimaan kantor: angka pertamanya harus dari opname, bukan dari satu kiriman.
      if (input.kantor) tulisBuku = await bukuDimulai(tx, input.storeId);
    }

    const receipt = await tx.storeReceipt.create({
      data: {
        storeId: input.storeId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceDocNo: kiriman.docNo,
        receivedById: input.userId,
        ...(luring.kunci ? { idempotencyKey: luring.kunci } : {}),
        ...(luring.waktuTangkap ? { receivedAt: luring.waktuTangkap } : {}),
        note: input.note?.trim() || null,
        lines: {
          create: kiriman.lines.map((l) => {
            const r = rusak.get(l.lineId);
            return {
              itemId: l.itemId,
              variantSku: l.variantSku,
              productName: l.productName,
              qtySent: l.qty,
              qtyReceived: jawab.get(l.lineId) ?? 0,
              ...(r && r.qtyDamaged > 0
                ? { qtyDamaged: r.qtyDamaged, damageNote: r.damageNote, damagePhotoUrl: r.damagePhotoUrl, damageStatus: "TERBUKA" }
                : {}),
            };
          }),
        },
      },
      select: { id: true },
    });

    // Hanya baris barang katalog yang menggerakkan stok — baris yang diketik
    // nama saja tidak punya saldo untuk ditambah (sama dengan NRI). Mutasi
    // masuk memakai jenisnya sendiri, bukan TERIMA (kiriman dari gudang).
    // Barang rusak tidak masuk buku sampai gudang memutuskannya layak jual.
    // Dari antrean HP: barang yang sudah dihitung opname SESUDAH kiriman ini
    // dihitung tidak ditambah lagi (opname itu sudah melihatnya di rak).
    const sudahTerhitung = luring.waktuTangkap
      ? await terhitungSesudah(
          tx,
          input.storeId,
          [...new Set(kiriman.lines.map((l) => l.itemId).filter((x): x is string => !!x))],
          luring.waktuTangkap,
        )
      : new Set<string>();
    const gerak = tulisBuku
      ? kiriman.lines
          .filter((l) => l.itemId && masukBukuSaatTerima(jawab.get(l.lineId) ?? 0, rusakDari(l.lineId)) > 0)
          .filter((l) => !sudahTerhitung.has(kunciBaris(l.itemId as string, l.variantSku)))
          .map((l) => ({
            storeId: input.storeId,
            itemId: l.itemId as string,
            variantSku: l.variantSku,
            qty: masukBukuSaatTerima(jawab.get(l.lineId) ?? 0, rusakDari(l.lineId)),
            kind: mutasi ? ("MUTASI_MASUK" as const) : ("TERIMA" as const),
            refType: "StoreReceipt",
            refId: receipt.id,
            createdById: input.userId,
            ...(luring.waktuTangkap ? { createdAt: luring.waktuTangkap } : {}),
          }))
      : [];
    if (gerak.length) await tx.storeStockMovement.createMany({ data: gerak });

    const barisRusak = kiriman.lines.filter((l) => rusakDari(l.lineId) > 0);
    if (barisRusak.length > 0) {
      const pcs = barisRusak.reduce((n, l) => n + rusakDari(l.lineId), 0);
      const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { name: true } });
      sesudah.notifikasiRusak = await tx.adminNotification.create({
        data: {
          category: KATEGORI_NOTIF_RUSAK,
          severity: "WARNING",
          title: `Kiriman ${kiriman.docNo} tiba dengan ${pcs} potong rusak`,
          message:
            `${toko?.name ?? "Toko"}: ${barisRusak.length} baris dicatat rusak saat diterima. ` +
            "Putuskan per baris: layak jual, kembali ke gudang, atau dihapuskan.",
          metadata: { receiptId: receipt.id, storeId: input.storeId, pcs },
        },
      });
    }

    if (mutasi && periksa?.ok) {
      sesudah.notifikasi = await catatTerimaMutasi(tx, {
        sourceType: mutasi,
        transfer: periksa.transfer,
        userId: input.userId,
        receiptId: receipt.id,
        baris,
        olehKantor: Boolean(input.kantor),
        tulisBuku,
        siklusTerkunci: periksa.siklusTerkunci,
      });
      if (mutasi === "MUTASI") {
        sesudah.kabarDiterima = {
          userId: periksa.transfer.createdById,
          docNo: periksa.transfer.docNo,
          transferId: periksa.transfer.id,
          kurang: selisihPenerimaan(baris).kurang,
        };
      }
    }

    return { ok: true, receiptId: receipt.id };
  });
}

export type HasilCatatOpname =
  | {
      ok: true;
      opnameId: string;
      /** Baris yang menggerakkan buku (hitungan ≠ saldo sistem). */
      selisih: number;
      /** Hanya dari antrean HP: barang yang sudah dihitung opname yang LEBIH BARU — hitungan lama ini dilewati. */
      dilewati?: number;
    }
  | Gagal<"TANPA_BARIS" | "JUMLAH_TIDAK_VALID" | "BARANG_TIDAK_DITEMUKAN" | "WAKTU_TIDAK_VALID" | "KUNCI_DIPAKAI">;

/**
 * Opname yang sudah dicatat dengan kunci ini: hasil yang sama untuk kiriman
 * ulang dari toko yang sama; `KUNCI_DIPAKAI` kalau kuncinya milik toko lain.
 */
async function opnameDenganKunci(kunci: string, storeId: string): Promise<HasilCatatOpname | null> {
  const ada = await prisma.storeOpname.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, storeId: true } });
  if (!ada) return null;
  if (ada.storeId !== storeId) return { ok: false, alasan: "KUNCI_DIPAKAI" };
  const selisih = await prisma.storeStockMovement.count({ where: { refType: "StoreOpname", refId: ada.id } });
  return { ok: true, opnameId: ada.id, selisih };
}

export async function catatOpname(input: {
  storeId: string;
  userId: string;
  /**
   * `umurHitungMs` (opsional): berapa lama sebelum disimpan baris itu dihitung
   * di HP. Selisih dibandingkan dengan saldo SAAT ITU (lihat `opname-acuan.ts`);
   * tanpa umur berlaku saldo saat disimpan (atau saat tangkap antrean).
   */
  baris: { itemId: string; variantSku: string | null; qtyCounted: number; umurHitungMs?: number | null }[];
  note?: string | null;
  /**
   * Kunci kiriman dari HP, sekali per formulir. Diperiksa PALING DULU: kiriman
   * ulang mendapat opname yang sama — buku stok tidak pernah disesuaikan dua kali.
   */
  idempotencyKey?: string | null;
  /**
   * Antrean HP (dihitung tanpa sinyal): saat rak dihitung. Saldo sistem tetap
   * dinilai SERVER saat sinkron, tapi PER WAKTU HITUNG ITU — gerakan buku yang
   * bertanggal sesudahnya (mis. nota tanpa sinyal yang terjual sesudah
   * menghitung dan terkirim lebih dulu) tidak ikut, karena rak yang dihitung
   * belum mengalaminya. Opname dan gerakannya bertanggal waktu hitung. Barang
   * yang sudah dihitung opname yang LEBIH BARU dilewati: hitungan itu yang
   * berlaku.
   */
  waktuTangkap?: Date | null;
  sekarang?: Date;
}): Promise<HasilCatatOpname> {
  const kunci = input.idempotencyKey?.trim() || null;
  if (kunci) {
    const ada = await opnameDenganKunci(kunci, input.storeId);
    if (ada) return ada;
  }
  if (input.baris.length === 0) return { ok: false, alasan: "TANPA_BARIS" };
  if (input.baris.some((b) => !Number.isInteger(b.qtyCounted) || b.qtyCounted < 0)) {
    return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };
  }
  if (input.baris.some((b) => b.umurHitungMs != null && (!Number.isFinite(b.umurHitungMs) || b.umurHitungMs < 0))) {
    return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };
  }
  let waktu: Date | null = null;
  if (input.waktuTangkap !== undefined && input.waktuTangkap !== null) {
    waktu = jepitWaktuLuring(input.waktuTangkap, input.sekarang ?? new Date(), BATAS_STOK_LURING_MS);
    if (!waktu) return { ok: false, alasan: "WAKTU_TIDAK_VALID" };
  }

  let hasil: HasilCatatOpname;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilCatatOpname> => {
      // Lagi di dalam transaksi: percobaan ulang sesudah balapan dua kiriman
      // berkunci sama mendapat opname pemenangnya.
      if (kunci) {
        const ada = await tx.storeOpname.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, storeId: true } });
        if (ada) {
          if (ada.storeId !== input.storeId) return { ok: false, alasan: "KUNCI_DIPAKAI" };
          const selisih = await tx.storeStockMovement.count({ where: { refType: "StoreOpname", refId: ada.id } });
          return { ok: true, opnameId: ada.id, selisih };
        }
      }
      const itemIds = [...new Set(input.baris.map((b) => b.itemId))];
      const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true, variants: true } });
      if (items.length !== itemIds.length) return { ok: false as const, alasan: "BARANG_TIDAK_DITEMUKAN" as const };
      const itemById = new Map(items.map((i) => [i.id, i]));

      // Saldo dibaca DI DALAM transaksi: penjualan yang masuk bersamaan harus
      // ikut terhitung, bukan tertimpa oleh selisih yang dihitung dari saldo lama.
      // Opname dari antrean: saldo per waktu hitung (lihat `waktuTangkap`).
      const grup = await tx.storeStockMovement.groupBy({
        by: ["itemId", "variantSku"],
        where: { storeId: input.storeId, itemId: { in: itemIds }, ...(waktu ? { createdAt: { lte: waktu } } : {}) },
        _sum: { qty: true },
      });
      const saldoDasar = saldoDariGerakan(grup.map((g) => ({ itemId: g.itemId, variantSku: g.variantSku, qty: g._sum.qty ?? 0 })));

      // Saldo ACUAN per baris = saldo saat barang itu dihitung (umur hitungan
      // dari HP): gerakan yang tercatat sesudahnya belum dialami rak itu.
      const dasar = waktu ?? input.sekarang ?? new Date();
      const waktuHitung = waktuHitungPerKunci(input.baris, dasar);
      let saldo = saldoDasar;
      if (waktuHitung.size > 0) {
        const paling = new Date(Math.min(...[...waktuHitung.values()].map((t) => t.getTime())));
        const sesudah = await tx.storeStockMovement.findMany({
          where: {
            storeId: input.storeId,
            itemId: { in: itemIds },
            createdAt: waktu ? { gt: paling, lte: waktu } : { gt: paling },
          },
          select: { itemId: true, variantSku: true, qty: true, createdAt: true },
        });
        saldo = saldoAcuan(saldoDasar, sesudah, waktuHitung);
      }
      const semua = rencanaOpname(input.baris, saldo);

      // Barang yang sudah dihitung opname LAIN sesudah baris ini dihitung
      // dilewati: hitungan yang lebih baru itu yang berlaku.
      const waktuBaris = new Map<string, Date>();
      for (const r of semua) {
        const k = kunciBaris(r.itemId, r.variantSku);
        const t = waktuHitung.get(k) ?? waktu;
        if (t) waktuBaris.set(k, t);
      }
      let lebihBaru = new Set<string>();
      if (waktuBaris.size > 0) {
        const sejak = new Date(Math.min(...[...waktuBaris.values()].map((t) => t.getTime())));
        lebihBaru = dilewatiKarenaLebihBaru(waktuBaris, await waktuHitungTerakhir(tx, input.storeId, itemIds, sejak));
      }
      const rencana = semua.filter((r) => !lebihBaru.has(kunciBaris(r.itemId, r.variantSku)));
      const waktuDari = (r: { itemId: string; variantSku: string }) => waktuBaris.get(kunciBaris(r.itemId, r.variantSku));

      const nama = (itemId: string, variantSku: string) => {
        const item = itemById.get(itemId);
        const label = item ? variantDetailForSku(item.variants, variantSku || null) : null;
        return label ? `${item?.nameId} — ${label}` : (item?.nameId ?? itemId);
      };

      const opname = await tx.storeOpname.create({
        data: {
          storeId: input.storeId,
          countedById: input.userId,
          ...(kunci ? { idempotencyKey: kunci } : {}),
          ...(waktu ? { countedAt: waktu } : {}),
          note: input.note?.trim() || null,
          lines: {
            create: rencana.map((r) => ({
              itemId: r.itemId,
              variantSku: r.variantSku,
              productName: nama(r.itemId, r.variantSku),
              qtySystem: r.qtySystem,
              qtyCounted: r.qtyCounted,
              countedAt: waktuDari(r) ?? null,
            })),
          },
        },
        select: { id: true },
      });

      const gerak = rencana
        .filter((r) => r.selisih !== 0)
        .map((r) => ({
          storeId: input.storeId,
          itemId: r.itemId,
          variantSku: r.variantSku,
          qty: r.selisih,
          kind: "OPNAME" as const,
          refType: "StoreOpname",
          refId: opname.id,
          createdById: input.userId,
          // Bertanggal saat barang dihitung: saldo per waktu sesudahnya sudah benar.
          ...(waktuDari(r) ? { createdAt: waktuDari(r) } : {}),
        }));
      if (gerak.length) await tx.storeStockMovement.createMany({ data: gerak });

      const dilewati = semua.length - rencana.length;
      return {
        ok: true as const,
        opnameId: opname.id,
        selisih: gerak.length,
        ...(waktu || dilewati > 0 ? { dilewati } : {}),
      };
    });
  } catch (err) {
    // Kiriman kembar dengan kunci yang sama tiba bersamaan: yang kalah
    // mendapat opname milik pemenang, bukan galat.
    if (kunci && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const ada = await opnameDenganKunci(kunci, input.storeId);
      if (ada) return ada;
    }
    throw err;
  }
  // Opname bisa menemukan barang yang dititip-pesankan pembeli, dan opname yang
  // KURANG di toko konsinyasi membuka catatan barang hilang untuk diputuskan kantor.
  if (hasil.ok) {
    void kabariTitipanTersedia(input.storeId);
    void catatHilangDariOpname(hasil.opnameId, input.userId);
  }
  return hasil;
}

/** Nama tampilan barang + varian, untuk baris permintaan dan barang dicari. */
async function namaBarang(itemIds: string[]) {
  const items = await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true, variants: true } });
  return new Map(items.map((i) => [i.id, i]));
}

/**
 * Alasan dua baris yang digabung (barang yang sama ditambahkan dua kali):
 * alasan dari saran mengalahkan MANUAL — "dipilih sendiri" tidak menghapus
 * keterangan bahwa barang itu laku di toko lain. Di antara dua saran, yang
 * pertama tetap.
 */
function alasanGabungan(lama: AlasanPermintaan, baru: AlasanPermintaan): AlasanPermintaan {
  return lama === "MANUAL" ? baru : lama;
}

/**
 * SPG meminta barang. Permintaan masuk ke kantor (seperti sebelumnya) DAN
 * dikabarkan ke salesman pemegang toko (`Store.salesmanId`), yang bisa
 * langsung membuatkan pesanannya dari kotak masuk `/pwa/permintaan`.
 *
 * `alasan` per baris: salah satu `ALASAN_PERMINTAAN`; tanpa alasan = MANUAL.
 * Kabar hanya untuk permintaan yang BARU dibuat — kiriman ulang dengan kunci
 * yang sama mengembalikan permintaan lama tanpa mengabari siapa pun lagi.
 */
export async function mintaKiriman(input: {
  storeId: string;
  userId: string;
  baris: { itemId: string; variantSku: string | null; qty: number; alasan?: string | null }[];
  note?: string | null;
  idempotencyKey?: string | null;
}): Promise<
  { ok: true; requestId: string } | Gagal<"TANPA_BARIS" | "JUMLAH_TIDAK_VALID" | "BARANG_TIDAK_DITEMUKAN" | "ALASAN_TIDAK_VALID">
> {
  // Kunci diperiksa PALING DULU: kiriman ulang dari HP yang jawabannya hilang
  // di jalan harus mendapat permintaan yang sama, apa pun yang berubah sejak itu.
  const kunci = input.idempotencyKey?.trim() || null;
  if (kunci) {
    const ada = await prisma.stockRequest.findUnique({ where: { idempotencyKey: kunci }, select: { id: true } });
    if (ada) return { ok: true, requestId: ada.id };
  }

  const gabung = new Map<string, { itemId: string; variantSku: string; qty: number; alasan: AlasanPermintaan }>();
  for (const b of input.baris) {
    if (!Number.isInteger(b.qty) || b.qty <= 0) return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };
    const alasan = b.alasan == null || b.alasan === "" ? "MANUAL" : bacaAlasan(b.alasan);
    if (!alasan) return { ok: false, alasan: "ALASAN_TIDAK_VALID" };
    const k = kunciBaris(b.itemId, b.variantSku);
    const ada = gabung.get(k);
    if (ada) {
      ada.qty += b.qty;
      ada.alasan = alasanGabungan(ada.alasan, alasan);
    } else gabung.set(k, { itemId: b.itemId, variantSku: b.variantSku ?? "", qty: b.qty, alasan });
  }
  if (gabung.size === 0) return { ok: false, alasan: "TANPA_BARIS" };

  const baris = [...gabung.values()];
  const items = await namaBarang([...new Set(baris.map((b) => b.itemId))]);
  if (baris.some((b) => !items.has(b.itemId))) return { ok: false, alasan: "BARANG_TIDAK_DITEMUKAN" };

  let req: { id: string };
  try {
    req = await prisma.stockRequest.create({
      data: {
        storeId: input.storeId,
        requestedById: input.userId,
        note: input.note?.trim() || null,
        idempotencyKey: kunci,
        lines: {
          create: baris.map((b) => {
            const item = items.get(b.itemId)!;
            const label = variantDetailForSku(item.variants, b.variantSku || null);
            return {
              itemId: b.itemId,
              variantSku: b.variantSku,
              productName: label ? `${item.nameId} — ${label}` : item.nameId,
              qty: b.qty,
              alasan: b.alasan,
            };
          }),
        },
      },
      select: { id: true },
    });
  } catch (err) {
    // Dua kiriman dengan kunci yang sama bersamaan: yang kalah membaca milik pemenangnya.
    if (kunci && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const ada = await prisma.stockRequest.findUnique({ where: { idempotencyKey: kunci }, select: { id: true } });
      if (ada) return { ok: true, requestId: ada.id };
    }
    throw err;
  }

  await kabariPemegangToko({
    storeId: input.storeId,
    requestId: req.id,
    pemintaId: input.userId,
    jumlahBarang: baris.length,
    jumlahPcs: baris.reduce((n, b) => n + b.qty, 0),
  });
  return { ok: true, requestId: req.id };
}

/**
 * Kabar `PERMINTAAN_SPG_MASUK` ke salesman pemegang toko. Toko tanpa pemegang
 * tidak mengabari siapa pun (kantor tetap melihatnya di daftar permintaan).
 * Tidak pernah melempar: permintaan sudah tersimpan, kabar yang gagal tidak
 * boleh membuat HP mengira permintaannya gagal dan mengirim ulang.
 */
async function kabariPemegangToko(input: {
  storeId: string;
  requestId: string;
  pemintaId: string;
  jumlahBarang: number;
  jumlahPcs: number;
}): Promise<void> {
  try {
    const [toko, peminta] = await Promise.all([
      prisma.store.findUnique({ where: { id: input.storeId }, select: { name: true, salesmanId: true } }),
      prisma.user.findUnique({ where: { id: input.pemintaId }, select: { name: true, email: true } }),
    ]);
    if (!toko?.salesmanId || toko.salesmanId === input.pemintaId) return;
    await kabariPengguna(toko.salesmanId, {
      jenis: JENIS_KABAR.PERMINTAAN_SPG_MASUK,
      judul: `Permintaan barang dari ${toko.name}`,
      isi: `${peminta?.name ?? peminta?.email ?? "SPG"} meminta ${input.jumlahBarang} barang (${input.jumlahPcs} potong). Buka untuk membuatkan pesanannya.`,
      data: { requestId: input.requestId },
    });
  } catch (err) {
    console.error("kabariPemegangToko gagal", err);
  }
}

export async function catatBarangDicari(input: {
  storeId: string;
  userId: string;
  itemId?: string | null;
  variantSku?: string | null;
  description: string;
  qty: number;
}): Promise<{ ok: true } | Gagal<"KETERANGAN_WAJIB" | "JUMLAH_TIDAK_VALID" | "BARANG_TIDAK_DITEMUKAN">> {
  const keterangan = input.description.trim();
  if (!keterangan) return { ok: false, alasan: "KETERANGAN_WAJIB" };
  if (!Number.isInteger(input.qty) || input.qty <= 0 || input.qty > 999) return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };
  if (input.itemId) {
    const ada = await prisma.item.count({ where: { id: input.itemId } });
    if (!ada) return { ok: false, alasan: "BARANG_TIDAK_DITEMUKAN" };
  }
  await prisma.lostSale.create({
    data: {
      storeId: input.storeId,
      userId: input.userId,
      itemId: input.itemId || null,
      variantSku: input.variantSku ?? "",
      description: keterangan.slice(0, 200),
      qty: input.qty,
    },
  });
  return { ok: true };
}

const LANJUTAN: Record<string, string[]> = {
  BARU: ["DIPROSES", "SELESAI", "DITOLAK"],
  DIPROSES: ["SELESAI", "DITOLAK"],
  SELESAI: [],
  DITOLAK: [],
};

/** Ubah status permintaan kiriman (kantor). SELESAI dan DITOLAK adalah akhir. */
export async function ubahStatusPermintaan(input: {
  requestId: string;
  status: "DIPROSES" | "SELESAI" | "DITOLAK";
  userId: string;
  note?: string | null;
  /**
   * Siapa yang memutuskan — hanya mengubah kalimat kabar ke SPG. Bawaan kantor;
   * kotak masuk salesman (`/pwa/permintaan`) mengirim "SALESMAN".
   */
  oleh?: "KANTOR" | "SALESMAN";
}): Promise<{ ok: true } | Gagal<"TIDAK_DITEMUKAN" | "STATUS_TIDAK_BOLEH" | "ALASAN_WAJIB">> {
  if (input.status === "DITOLAK" && !input.note?.trim()) return { ok: false, alasan: "ALASAN_WAJIB" };
  const catatan = input.note?.trim() || null;
  const hasil = await runSerializable(async (tx) => {
    const req = await tx.stockRequest.findUnique({ where: { id: input.requestId }, select: { status: true, requestedById: true } });
    if (!req) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as const };
    if (!LANJUTAN[req.status]?.includes(input.status)) return { ok: false as const, alasan: "STATUS_TIDAK_BOLEH" as const };
    // Bandingkan-lalu-tukar di dalam transaksi serializable: dua orang kantor
    // yang menekan bersamaan tidak bisa sama-sama memindahkan status yang sama.
    const r = await tx.stockRequest.updateMany({
      where: { id: input.requestId, status: req.status },
      data: { status: input.status, handledById: input.userId, handledAt: new Date(), handleNote: catatan },
    });
    if (r.count !== 1) return { ok: false as const, alasan: "STATUS_TIDAK_BOLEH" as const };
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "STOCK_REQUEST_STATUS",
        entityType: "StockRequest",
        entityId: input.requestId,
        changes: { before: { status: req.status }, after: { status: input.status } },
        reason: catatan,
      },
    });
    return { ok: true as const, peminta: req.requestedById };
  });
  if (!hasil.ok) return hasil;

  // SPG yang meminta diberi tahu — SESUDAH transaksi, dan tidak pernah melempar.
  const judul =
    input.status === "DITOLAK"
      ? "Permintaan kiriman ditolak"
      : input.status === "SELESAI"
        ? "Permintaan kiriman selesai diproses"
        : "Permintaan kiriman sedang diproses";
  await kabariPengguna(hasil.peminta, {
    jenis: JENIS_KABAR.PERMINTAAN_STOK_DIPROSES,
    judul,
    isi:
      input.status === "DITOLAK"
        ? `Alasan: ${catatan ?? "-"}`
        : input.status === "SELESAI"
          ? `${input.oleh === "SALESMAN" ? "Salesman" : "Kantor"} sudah menyelesaikan permintaan Anda.${catatan ? ` Catatan: ${catatan}` : ""} Terima barangnya di menu Terima kiriman saat tiba.`
          : `${input.oleh === "SALESMAN" ? "Salesman" : "Kantor"} sedang menyiapkan barang yang Anda minta.${catatan ? ` Catatan: ${catatan}` : ""}`,
    data: { requestId: input.requestId, status: input.status },
  });
  return { ok: true };
}
