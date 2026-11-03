import { prisma, type AdminNotification, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { parseItemVariants } from "@/lib/items/variants";
import { labelVarian } from "@/lib/konsinyasi/stok-di-toko";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { bentrokKunciKiriman } from "@/lib/receivables/idempoten";
import { formatRupiah } from "@/lib/format/rupiah";
import {
  BATAS_BARIS_HILANG,
  desimal,
  dariSen,
  JEJAK_HILANG,
  kalimatKeringanan,
  KATEGORI_NOTIF_HILANG,
  keSen,
  penanggungOrang,
  periksaBagian,
  rapikanTeksHilang,
  terapkanDiskonPegawai,
  REF_KOMISI_SALESMAN,
  REF_TAGIH_TOKO_MANUAL,
  REF_KLAIM_EKSPEDISI,
  bacaCaraBayarKlaim,
  type BarisKurang,
  type IsianBagian,
  type JejakKeringanan,
  type KodeTolakBagian,
  type SumberHilang,
  type StatusHilang,
} from "./hilang";
import {
  bacaAturanHilang,
  jejakHilang,
  nilaiBarisHilang,
  potonganUntukRefSen,
  potongBagianOrang,
  segarkanStatusHilang,
  sisaBebanOrangSen,
} from "./hilang-db";
import { balikBukuHilang, tulisBukuHilang } from "./hilang-buku";

/**
 * Penulis barang hilang (`StockLoss`): membuka catatan (manual oleh kantor
 * atau dari dokumen sumbernya), memutuskan siapa yang menanggung, mengubah
 * atau membatalkan keputusan, dan menandai pelunasan yang terjadi di luar
 * sistem (toko putus sudah ditagih, sales sudah dipotong).
 *
 * Aturan yang tidak boleh dilonggarkan:
 * - Setiap langkah di `runSerializable`; penjaga keadaan berbentuk
 *   bandingkan-lalu-tukar pada `status` + `updatedAt` di dalamnya.
 * - Jejak (`JEJAK_HILANG`) ditulis di transaksi yang sama, dengan pasangan
 *   sebelum/sesudah. Baris catatan hanya menyimpan keputusan terakhir.
 * - Keputusan hanya boleh diubah/dibatalkan selama BELUM ada potongan atau
 *   tagihan atas bagian toko/orang — uang yang sudah dipotong dari gaji tidak
 *   pernah hilang diam-diam karena keputusannya ditulis ulang.
 * - Catatan kantor (`STOCK_LOSS_OPEN`) dan kabar ke orang SESUDAH transaksi.
 */

type Tx = Prisma.TransactionClient;
const angka = (v: unknown): number => Number(v ?? 0);

// ─── Membuka catatan ─────────────────────────────────────────────────────────

export type HasilBukaHilang = { ok: true; id: string; ulang: boolean } | { ok: false; kode: "TANPA_BARIS" };

/**
 * Buka satu catatan barang hilang. Idempoten lewat `idempotencyKey`
 * (`opname:<id>`, `mutasi:<id>`, `penerimaan:<id>`, `manual:<kunci>`): kunci
 * yang sudah dipakai mengembalikan catatan yang ada.
 */
export type InputBukaHilang = {
  storeId: string | null;
  source: SumberHilang;
  sourceId: string | null;
  sourceDocNo: string | null;
  baris: BarisKurang[];
  note: string | null;
  createdById: string;
  idempotencyKey: string;
  /**
   * Keterangan asal yang ditambahkan ke catatan kantor, mis. kalimat "kurang di
   * perjalanan" sebuah antaran (berapa dikirim gudang, berapa tiba, siapa dicek).
   */
  keteranganAsal?: string | null;
  sekarang?: Date;
};

export async function bukaCatatanHilang(input: InputBukaHilang): Promise<HasilBukaHilang> {
  const sesudah: { notif: AdminNotification | null } = { notif: null };
  const tulis = () => runSerializable((tx) => bukaCatatanHilangDalamTx(tx, input, sesudah));
  let hasil: HasilBukaHilang;
  try {
    hasil = await tulis();
  } catch (err) {
    // Dua pemicu yang sama tiba bersamaan: yang kalah membaca catatan pemenang.
    if (!bentrokKunciKiriman(err)) throw err;
    hasil = await tulis();
  }
  if (hasil.ok && !hasil.ulang && sesudah.notif) void fanOutAdminNotification(sesudah.notif);
  return hasil;
}

/**
 * `bukaCatatanHilang` di dalam transaksi PEMANGGIL — untuk penerimaan toko atas kiriman
 * gudang lewat pengiriman, yang membuka catatannya di transaksi penerimaan itu sendiri
 * (penerimaan yang batal tidak meninggalkan catatan, dan catatan tidak pernah tertinggal).
 * `shipmentId` = pengiriman asal barang yang hilang di perjalanan; `claimValueSen` = nilai
 * klaim ekspedisi (nilai jual di nota / surat jalan, P37/P42), hanya untuk pengiriman lewat
 * EKSPEDISI. Notifikasi kantornya ditaruh di `sesudah.notif` untuk disebar pemanggil.
 */
export async function bukaCatatanHilangDalamTx(
  tx: Tx,
  input: InputBukaHilang & { shipmentId?: string | null; claimValueSen?: number | null },
  sesudah: { notif: AdminNotification | null },
): Promise<HasilBukaHilang> {
  const baris = input.baris.filter((b) => Number.isInteger(b.qty) && b.qty > 0);
  if (baris.length === 0) return { ok: false, kode: "TANPA_BARIS" };
  const sekarang = input.sekarang ?? new Date();
  const keteranganAsal = input.keteranganAsal?.trim() || "";
  {
    {
      sesudah.notif = null;
      const ada = await tx.stockLoss.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
      if (ada) return { ok: true, id: ada.id, ulang: true };

      const aturan = await bacaAturanHilang(tx);
      const toko = input.storeId
        ? await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true, name: true, termsType: true, markupPercent: true, priceDiscountPercent: true } })
        : null;
      const dinilai = await nilaiBarisHilang(tx, baris, toko, aturan.dasarNilai);
      const totalSen = dinilai.reduce((n, b) => n + b.amountSen, 0);
      const totalQty = dinilai.reduce((n, b) => n + b.qty, 0);

      const loss = await tx.stockLoss.create({
        data: {
          storeId: input.storeId,
          source: input.source,
          sourceId: input.sourceId,
          sourceDocNo: input.sourceDocNo,
          totalQty,
          totalAmount: desimal(totalSen),
          valueBasis: aturan.dasarNilai,
          status: "TERBUKA",
          note: input.note,
          createdById: input.createdById,
          idempotencyKey: input.idempotencyKey,
          createdAt: sekarang,
          ...(input.shipmentId ? { shipmentId: input.shipmentId } : {}),
          ...(input.claimValueSen !== undefined && input.claimValueSen !== null ? { claimValue: desimal(input.claimValueSen) } : {}),
          lines: {
            create: dinilai.map((b) => ({
              itemId: b.itemId,
              variantSku: b.variantSku,
              productName: b.productName,
              qty: b.qty,
              unitValue: desimal(b.unitSen),
              amount: desimal(b.amountSen),
            })),
          },
        },
        select: { id: true },
      });

      // Catatan MANUAL di toko berbuku mengurangi bukunya (lihat `hilang-buku.ts`):
      // opname berikutnya atas potong yang sama tidak membuka catatan kedua.
      const bukuToko =
        input.source === "MANUAL" && input.storeId
          ? await tulisBukuHilang(tx, {
              lossId: loss.id,
              storeId: input.storeId,
              baris: dinilai.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, qty: b.qty })),
              createdById: input.createdById,
              waktu: sekarang,
            })
          : 0;

      const tanpaNilai = dinilai.filter((b) => b.unitSen === 0).length;
      // Dasar HARGA_TERIMA: baris yang toko itu belum pernah terima memakai harga jual Elorae.
      const hargaCadangan = dinilai
        .filter((b) => b.sumberHarga === "HARGA_ELORAE" && b.unitSen > 0)
        .map((b) => ({ itemId: b.itemId, variantSku: b.variantSku }));
      const asal = KALIMAT_SUMBER[input.source](input.sourceDocNo);
      sesudah.notif = await tx.adminNotification.create({
        data: {
          category: KATEGORI_NOTIF_HILANG,
          severity: "WARNING",
          title: `Barang hilang${toko ? ` di ${toko.name}` : ""}: ${totalQty} potong`,
          message:
            `${asal}, senilai ${formatRupiah(dariSen(totalSen))}. ` +
            (keteranganAsal ? `${keteranganAsal} ` : "") +
            (tanpaNilai > 0 ? `${tanpaNilai} baris belum bernilai — isi totalnya saat memutuskan. ` : "") +
            "Putuskan siapa yang menanggung: toko, SPG, sales, atau Elorae.",
          metadata: { lossId: loss.id },
        },
      });

      await jejakHilang(tx, {
        userId: input.createdById,
        action: JEJAK_HILANG.DIBUKA,
        lossId: loss.id,
        changes: { after: { status: "TERBUKA", totalQty, totalAmount: dariSen(totalSen) } },
        metadata: {
          source: input.source,
          sourceId: input.sourceId,
          sourceDocNo: input.sourceDocNo,
          storeId: input.storeId,
          dasarNilai: aturan.dasarNilai,
          barisTanpaNilai: tanpaNilai,
          ...(aturan.dasarNilai === "HARGA_TERIMA" ? { hargaCadangan } : {}),
          ...(bukuToko > 0 ? { bukuToko: { baris: bukuToko } } : {}),
        },
        reason: input.note,
      });
      return { ok: true, id: loss.id, ulang: false };
    }
  }
}

const KALIMAT_SUMBER: Record<SumberHilang, (docNo: string | null) => string> = {
  OPNAME: () => "Opname toko konsinyasi menemukan barang kurang",
  MUTASI: (docNo) => `Selisih mutasi ${docNo ?? ""} diputuskan hilang`.replace(/\s+/g, " "),
  PENERIMAAN: (docNo) => `Kiriman ${docNo ?? ""} diterima kurang`.replace(/\s+/g, " "),
  MANUAL: () => "Dicatat manual oleh kantor",
};

export type KodeTolakBuatManual =
  | "KUNCI_WAJIB"
  | "BARIS_KOSONG"
  | "BARIS_TERLALU_BANYAK"
  | "BARIS_TIDAK_SAH"
  | "BARANG_TIDAK_DITEMUKAN"
  | "VARIAN_TIDAK_DIKENAL"
  | "TOKO_TIDAK_DITEMUKAN"
  | "ALASAN_WAJIB"
  | "TEKS_TERLALU_PANJANG";

export type HasilBuatManual = { ok: true; id: string; ulang: boolean } | { ok: false; kode: KodeTolakBuatManual };

/**
 * Kantor mencatat barang hilang secara manual (toko opsional). Kunci kiriman
 * diperiksa PALING DULU, sebelum isian divalidasi — kiriman ulang dari layar
 * yang sama mengembalikan catatan yang sudah ada.
 */
export async function buatBarangHilang(input: {
  storeId?: unknown;
  baris: unknown;
  catatan: unknown;
  idempotencyKey: unknown;
  userId: string;
  sekarang?: Date;
}): Promise<HasilBuatManual> {
  const kunciMentah = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (kunciMentah.length < 8 || kunciMentah.length > 100) return { ok: false, kode: "KUNCI_WAJIB" };
  const kunci = `manual:${kunciMentah}`;
  const ada = await prisma.stockLoss.findUnique({ where: { idempotencyKey: kunci }, select: { id: true } });
  if (ada) return { ok: true, id: ada.id, ulang: true };

  const catatan = rapikanTeksHilang(input.catatan, true);
  if (!catatan.ok) return { ok: false, kode: catatan.kode };

  if (!Array.isArray(input.baris) || input.baris.length === 0) return { ok: false, kode: "BARIS_KOSONG" };
  if (input.baris.length > BATAS_BARIS_HILANG) return { ok: false, kode: "BARIS_TERLALU_BANYAK" };
  const gabung = new Map<string, { itemId: string; variantSku: string; qty: number }>();
  for (const x of input.baris) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const itemId = typeof o.itemId === "string" ? o.itemId.trim() : "";
    const variantSku = typeof o.variantSku === "string" ? o.variantSku.trim() : "";
    const qty = o.qty;
    if (!itemId || variantSku.length > 191 || typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0 || qty > 100_000) {
      return { ok: false, kode: "BARIS_TIDAK_SAH" };
    }
    const k = `${itemId}\u0000${variantSku}`;
    const lama = gabung.get(k);
    gabung.set(k, { itemId, variantSku, qty: (lama?.qty ?? 0) + qty });
  }

  const storeId = typeof input.storeId === "string" && input.storeId.trim() ? input.storeId.trim() : null;
  if (storeId && !(await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } }))) {
    return { ok: false, kode: "TOKO_TIDAK_DITEMUKAN" };
  }

  const isi = [...gabung.values()];
  const items = await prisma.item.findMany({
    where: { id: { in: [...new Set(isi.map((b) => b.itemId))] } },
    select: { id: true, nameId: true, variants: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const baris: BarisKurang[] = [];
  for (const b of isi) {
    const item = byId.get(b.itemId);
    if (!item) return { ok: false, kode: "BARANG_TIDAK_DITEMUKAN" };
    const skus = parseItemVariants(item.variants)
      .map((v) => (v.sku ?? "").trim())
      .filter(Boolean);
    if (skus.length > 0 ? !skus.includes(b.variantSku) : b.variantSku !== "") return { ok: false, kode: "VARIAN_TIDAK_DIKENAL" };
    const label = b.variantSku ? labelVarian(item.variants, b.variantSku) : null;
    baris.push({ itemId: item.id, variantSku: b.variantSku, productName: label ? `${item.nameId} — ${label}` : item.nameId, qty: b.qty });
  }

  const hasil = await bukaCatatanHilang({
    storeId,
    source: "MANUAL",
    sourceId: null,
    sourceDocNo: null,
    baris,
    note: catatan.teks,
    createdById: input.userId,
    idempotencyKey: kunci,
    sekarang: input.sekarang,
  });
  // `TANPA_BARIS` tidak mungkin di sini — setiap baris sudah diperiksa > 0.
  return hasil.ok ? hasil : { ok: false, kode: "BARIS_KOSONG" };
}

// ─── Keputusan ───────────────────────────────────────────────────────────────

export type KodeTolakKeputusanHilang =
  | KodeTolakBagian
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIPUTUSKAN"
  | "BELUM_DIPUTUSKAN"
  | "SUDAH_DIBATALKAN"
  | "SUDAH_ADA_POTONGAN"
  | "ORANG_TIDAK_DITEMUKAN"
  | "ALASAN_WAJIB"
  | "TEKS_TERLALU_PANJANG"
  | "KERINGANAN_TIDAK_SAH"
  | "KERINGANAN_TANPA_ORANG"
  /** Bagian EKSPEDISI masih DIAJUKAN atau MENUNGGU_CEK: tunggu jawaban/cek klaimnya dulu. */
  | "KLAIM_MENUNGGU"
  | "BERUBAH";

export type HasilKeputusanHilang = { ok: true; id: string; status: StatusHilang } | { ok: false; kode: KodeTolakKeputusanHilang };

type BagianTersimpan = { bearer: string; bearerUserId: string | null; amount: number };

type KabarTertunda = { userId: string; kabar: Kabar };

async function kirimKabar(daftar: KabarTertunda[]): Promise<void> {
  for (const k of daftar) await kabariPengguna(k.userId, k.kabar);
}

const ringkasBagian = (b: { bearer: string; bearerUserId: string | null; amount: unknown }[]): BagianTersimpan[] =>
  b.map((x) => ({ bearer: x.bearer, bearerUserId: x.bearerUserId, amount: angka(x.amount) }));

/**
 * Ada pelunasan yang tidak boleh ditulis ulang: bagian toko/orang yang sudah
 * dipotong atau ditagih (sebagian pun). Bagian ELORAE dihapusbukukan saat
 * diputuskan — itu bukan uang siapa pun, jadi tidak mengunci.
 */
/** Klaim ekspedisi yang masih berjalan (DIAJUKAN atau MENUNGGU_CEK) mengunci keputusannya. */
async function adaKlaimBerjalan(tx: Tx, lossId: string): Promise<boolean> {
  return (
    (await tx.stockLossShare.count({ where: { lossId, bearer: "EKSPEDISI", claimStatus: { in: ["DIAJUKAN", "MENUNGGU_CEK"] } } })) > 0
  );
}

/** Catatan ini berasal dari pengiriman lewat EKSPEDISI (hanya itu yang boleh diklaim ke ekspedisi). */
async function dariEkspedisi(tx: Tx, shipmentId: string | null): Promise<boolean> {
  if (!shipmentId) return false;
  const s = await tx.deliveryShipment.findUnique({ where: { id: shipmentId }, select: { method: true } });
  return s?.method === "EXPEDITION";
}

/** Catatan otomatis saat klaim ekspedisi memakai nilai bawaannya (P42: hanya klaim ekspedisi yang memakai nilai nota). */
const CATATAN_NILAI_KLAIM = "Nilai klaim ekspedisi = nilai jual di nota";

async function adaPotongan(tx: Tx, lossId: string): Promise<boolean> {
  const shares = await tx.stockLossShare.findMany({ where: { lossId }, select: { id: true, bearer: true, settledAmount: true } });
  const bukanElorae = shares.filter((s) => s.bearer !== "ELORAE");
  if (bukanElorae.some((s) => keSen(angka(s.settledAmount)) > 0)) return true;
  if (bukanElorae.length === 0) return false;
  return (await tx.stockLossDeduction.count({ where: { shareId: { in: bukanElorae.map((s) => s.id) } } })) > 0;
}

function kabarBeban(lossId: string, toko: string | null, nilai: number, jenis: "TETAP" | "UBAH" | "BATAL", keringananPersen: number | null = null): Kabar {
  const tempat = toko ? ` di ${toko}` : "";
  if (jenis === "BATAL") {
    return {
      jenis: JENIS_KABAR.BEBAN_HILANG_DITETAPKAN,
      judul: "Beban barang hilang dibatalkan",
      isi: `Beban barang hilang${tempat} yang sebelumnya dibebankan ke Anda dibatalkan kantor.`,
      data: { lossId },
    };
  }
  return {
    jenis: JENIS_KABAR.BEBAN_HILANG_DITETAPKAN,
    judul: jenis === "UBAH" ? "Beban barang hilang diubah" : "Beban barang hilang ditetapkan",
    isi:
      `Anda menanggung ${formatRupiah(nilai)} dari barang hilang${tempat}` +
      (keringananPersen ? `, sudah termasuk keringanan diskon pegawai ${keringananPersen}%` : "") +
      ". Dipotong dari komisi/gaji Anda, dicicil bila perlu.",
    data: { lossId },
  };
}

/**
 * Persen keringanan dari isian: kosong/nol → tanpa keringanan (null);
 * bilangan bulat 1–100 → persennya; selain itu tidak sah.
 */
function bacaKeringananPersen(v: unknown): { ok: true; persen: number | null } | { ok: false } {
  if (v === undefined || v === null || v === "" || v === 0) return { ok: true, persen: null };
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100) return { ok: false };
  return { ok: true, persen: v };
}

type IsianTetapkan = {
  lossId: string;
  /** Pembagian SEBELUM keringanan — server sendiri yang menerapkan keringanannya. */
  bagian: unknown;
  total?: unknown;
  catatan?: unknown;
  /** Keringanan diskon pegawai (persen bulat 1–100) untuk setiap bagian SPG/SALES; kosong = tanpa keringanan. */
  keringananPersen?: unknown;
  olehUserId: string;
  sekarang?: Date;
};

async function tetapkan(mode: "PUTUSKAN" | "UBAH", input: IsianTetapkan): Promise<HasilKeputusanHilang> {
  const sekarang = input.sekarang ?? new Date();
  const keringanan = bacaKeringananPersen(input.keringananPersen);
  if (!keringanan.ok) return { ok: false, kode: "KERINGANAN_TIDAK_SAH" };
  const sesudah: { kabar: KabarTertunda[] } = { kabar: [] };

  const hasil = await runSerializable(async (tx): Promise<HasilKeputusanHilang> => {
    sesudah.kabar = [];
    const loss = await tx.stockLoss.findUnique({
      where: { id: input.lossId },
      select: {
        id: true,
        status: true,
        storeId: true,
        totalAmount: true,
        decisionNote: true,
        updatedAt: true,
        shipmentId: true,
        claimValue: true,
        shares: { select: { bearer: true, bearerUserId: true, amount: true, claimStatus: true } },
        lines: { select: { amount: true } },
      },
    });
    if (!loss) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (loss.status === "DIBATALKAN") return { ok: false, kode: "SUDAH_DIBATALKAN" };
    if (mode === "PUTUSKAN" && loss.status !== "TERBUKA") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    if (mode === "UBAH" && loss.status === "TERBUKA") return { ok: false, kode: "BELUM_DIPUTUSKAN" };
    if (mode === "UBAH" && (await adaKlaimBerjalan(tx, loss.id))) return { ok: false, kode: "KLAIM_MENUNGGU" };
    if (mode === "UBAH" && (await adaPotongan(tx, loss.id))) return { ok: false, kode: "SUDAH_ADA_POTONGAN" };
    const adaEkspedisi = await dariEkspedisi(tx, loss.shipmentId);

    const totalLama = angka(loss.totalAmount);
    /*
     * Total bawaan saat isiannya kosong. Sesudah klaim ekspedisi DITOLAK, total catatan masih nilai
     * klaimnya (nilai jual di nota / surat jalan) — penanggung lain dinilai menurut pengaturan barang
     * hilang (P42), jadi bawaannya kembali ke Σ nilai baris (R19).
     */
    const klaimDitolak = mode === "UBAH" && loss.shares.some((b) => b.bearer === "EKSPEDISI" && b.claimStatus === "DITOLAK");
    const totalBawaan = klaimDitolak ? dariSen(loss.lines.reduce((n, l) => n + keSen(angka(l.amount)), 0)) : totalLama;
    const total = input.total === undefined || input.total === null || input.total === "" ? totalBawaan : input.total;
    if (typeof total !== "number") return { ok: false, kode: "TOTAL_TIDAK_SAH" };
    const totalBerubah = keSen(total) !== keSen(totalLama);
    /*
     * Klaim ekspedisi SATU-SATUNYA bagian dengan total = nilai klaim bawaannya (nilai jual di nota /
     * surat jalan) tidak butuh alasan ketikan — catatannya otomatis. Total lain butuh alasan
     * ("sesuai kesepakatan dengan ekspedisi").
     */
    const isianBagian = Array.isArray(input.bagian) ? (input.bagian as Array<{ bearer?: unknown }>) : [];
    const nilaiKlaim = loss.claimValue === null ? null : angka(loss.claimValue);
    const klaimBawaan =
      adaEkspedisi && isianBagian.length === 1 && isianBagian[0]?.bearer === "EKSPEDISI" && nilaiKlaim !== null && keSen(total) === keSen(nilaiKlaim);
    const catatan = rapikanTeksHilang(input.catatan, mode === "UBAH" || (totalBerubah && !klaimBawaan));
    if (!catatan.ok) return { ok: false, kode: catatan.kode };

    const periksa = periksaBagian(input.bagian, total, Boolean(loss.storeId), adaEkspedisi);
    if (!periksa.ok) return { ok: false, kode: periksa.kode };
    let bagian: IsianBagian[] = periksa.bagian;

    // Keringanan dihitung DI SINI dari pembagian sebelum keringanan — tidak
    // ada angka hasil hitungan layar yang dipercaya. Hasilnya diperiksa ulang
    // dengan aturan yang sama (jumlah tetap sama dengan total).
    let jejakKeringanan: JejakKeringanan | null = null;
    if (keringanan.persen !== null) {
      if (!bagian.some((b) => penanggungOrang(b.bearer))) return { ok: false, kode: "KERINGANAN_TANPA_ORANG" };
      const ringan = terapkanDiskonPegawai(bagian, keringanan.persen);
      const ulang = periksaBagian(ringan.bagian, total, Boolean(loss.storeId));
      if (!ulang.ok) return { ok: false, kode: ulang.kode };
      if (ringan.diserapSen > 0) {
        jejakKeringanan = { persen: keringanan.persen, diserap: dariSen(ringan.diserapSen), sebelum: bagian, perOrang: ringan.perOrang };
        bagian = ulang.bagian;
      }
    }
    const kalimat = jejakKeringanan ? kalimatKeringanan(jejakKeringanan.persen, keSen(jejakKeringanan.diserap)) : null;
    const catatanKeputusan = [catatan.teks, kalimat, klaimBawaan ? CATATAN_NILAI_KLAIM : null].filter(Boolean).join("\n") || null;

    const orangIds = [...new Set(bagian.map((b) => b.bearerUserId).filter((x): x is string => Boolean(x)))];
    if (orangIds.length > 0 && (await tx.user.count({ where: { id: { in: orangIds } } })) !== orangIds.length) {
      return { ok: false, kode: "ORANG_TIDAK_DITEMUKAN" };
    }

    const statusBaru: StatusHilang = bagian.every((b) => b.bearer === "ELORAE") ? "SELESAI" : "DITETAPKAN";
    const cas = await tx.stockLoss.updateMany({
      where: { id: loss.id, status: loss.status, updatedAt: loss.updatedAt },
      data: {
        status: statusBaru,
        totalAmount: desimal(keSen(total)),
        decidedById: input.olehUserId,
        decidedAt: sekarang,
        decisionNote: catatanKeputusan,
      },
    });
    if (cas.count !== 1) return { ok: false, kode: mode === "PUTUSKAN" ? "SUDAH_DIPUTUSKAN" : "BERUBAH" };

    if (mode === "UBAH") await tx.stockLossShare.deleteMany({ where: { lossId: loss.id } });
    for (const b of bagian) {
      const elorae = b.bearer === "ELORAE";
      await tx.stockLossShare.create({
        data: {
          lossId: loss.id,
          bearer: b.bearer,
          bearerUserId: b.bearerUserId,
          amount: desimal(keSen(b.amount)),
          // Bagian Elorae dihapusbukukan saat diputuskan — tidak ada yang menagihnya.
          ...(elorae
            ? { settledAmount: desimal(keSen(b.amount)), settledAt: sekarang, settledById: input.olehUserId, settleNote: "Dihapusbukukan (ditanggung Elorae)" }
            : {}),
          // Klaim ekspedisi diajukan saat diputuskan; jawabannya dicatat lewat `putuskanKlaimEkspedisi`.
          ...(b.bearer === "EKSPEDISI" ? { claimStatus: "DIAJUKAN", claimSubmittedAt: sekarang } : {}),
        },
      });
    }

    const lama = ringkasBagian(loss.shares);
    await jejakHilang(tx, {
      userId: input.olehUserId,
      action: mode === "PUTUSKAN" ? JEJAK_HILANG.DIPUTUSKAN : JEJAK_HILANG.DIUBAH,
      lossId: loss.id,
      changes: {
        before: { status: loss.status, totalAmount: totalLama, bagian: lama, decisionNote: loss.decisionNote },
        after: { status: statusBaru, totalAmount: dariSen(keSen(total)), bagian, decisionNote: catatanKeputusan },
      },
      metadata: { totalBerubah, ...(jejakKeringanan ? { keringanan: jejakKeringanan } : {}) },
      reason: catatanKeputusan,
    });

    // Kabar: setiap orang yang menanggung, dan (saat diubah) yang tidak lagi menanggung.
    const tokoNama = loss.storeId ? ((await tx.store.findUnique({ where: { id: loss.storeId }, select: { name: true } }))?.name ?? null) : null;
    const nilaiOrang = new Map<string, number>();
    for (const b of bagian) if (penanggungOrang(b.bearer) && b.bearerUserId) nilaiOrang.set(b.bearerUserId, (nilaiOrang.get(b.bearerUserId) ?? 0) + b.amount);
    const diringankan = new Set((jejakKeringanan?.perOrang ?? []).map((p) => p.bearerUserId).filter((x): x is string => Boolean(x)));
    for (const [userId, nilai] of nilaiOrang) {
      const persen = diringankan.has(userId) ? (jejakKeringanan?.persen ?? null) : null;
      sesudah.kabar.push({ userId, kabar: kabarBeban(loss.id, tokoNama, nilai, mode === "UBAH" ? "UBAH" : "TETAP", persen) });
    }
    for (const userId of new Set(lama.map((b) => b.bearerUserId).filter((x): x is string => Boolean(x)))) {
      if (!nilaiOrang.has(userId)) sesudah.kabar.push({ userId, kabar: kabarBeban(loss.id, tokoNama, 0, "BATAL") });
    }
    return { ok: true, id: loss.id, status: statusBaru };
  });

  if (hasil.ok) await kirimKabar(sesudah.kabar);
  return hasil;
}

/**
 * Putuskan penanggung catatan yang masih TERBUKA. Dengan `keringananPersen`,
 * setiap bagian SPG/SALES dikurangi persen itu (ke bawah ke rupiah utuh) dan
 * selisihnya ditanggung Elorae; persen dan nilainya tercatat di catatan
 * keputusan dan di metadata jejaknya.
 */
export function putuskanBarangHilang(input: IsianTetapkan): Promise<HasilKeputusanHilang> {
  return tetapkan("PUTUSKAN", input);
}

/** Ubah keputusan yang sudah ada — alasan wajib, ditolak bila sudah ada potongan/tagihan. */
export function ubahKeputusanHilang(input: IsianTetapkan & { catatan: unknown }): Promise<HasilKeputusanHilang> {
  return tetapkan("UBAH", input);
}

export type KodeTolakBatalHilang =
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIBATALKAN"
  | "SUDAH_ADA_POTONGAN"
  | "KLAIM_MENUNGGU"
  | "ALASAN_WAJIB"
  | "TEKS_TERLALU_PANJANG"
  | "BERUBAH"
  | "TANPA_IZIN";

/**
 * Batalkan catatan (mis. ternyata terjual tanpa nota, atau ketemu). Alasan
 * wajib; ditolak bila sudah ada potongan/tagihan atas bagian toko/orang.
 * Bagian-bagiannya dihapus — keputusan yang dibatalkan hanya hidup di jejak.
 */
export async function batalkanBarangHilang(input: {
  lossId: string;
  alasan: unknown;
  olehUserId: string;
  sekarang?: Date;
  /** Izin pemanggil, diperiksa DI DALAM transaksi terhadap status yang dibaca di sana: membatalkan yang masih TERBUKA = receivables:manage, membatalkan yang sudah diputuskan (DITETAPKAN/SELESAI) = receivables:decide_bearer. Aksi kantor WAJIB mengisi keduanya; kosong (= boleh) hanya untuk pemanggil tepercaya (tes, skrip). */
  bolehBatalkanTerbuka?: boolean;
  bolehBatalkanKeputusan?: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; kode: KodeTolakBatalHilang }> {
  const alasan = rapikanTeksHilang(input.alasan, true);
  if (!alasan.ok) return { ok: false, kode: alasan.kode };
  const sekarang = input.sekarang ?? new Date();
  const sesudah: { kabar: KabarTertunda[] } = { kabar: [] };

  const hasil = await runSerializable(async (tx): Promise<{ ok: true; id: string } | { ok: false; kode: KodeTolakBatalHilang }> => {
    sesudah.kabar = [];
    const loss = await tx.stockLoss.findUnique({
      where: { id: input.lossId },
      select: {
        id: true,
        status: true,
        storeId: true,
        totalAmount: true,
        decisionNote: true,
        updatedAt: true,
        shares: { select: { bearer: true, bearerUserId: true, amount: true } },
      },
    });
    if (!loss) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (loss.status === "DIBATALKAN") return { ok: false, kode: "SUDAH_DIBATALKAN" };
    // Keputusan yang masuk di antara baca aksi dan transaksi ini tetap tertolak di sini.
    if (loss.status === "TERBUKA" ? input.bolehBatalkanTerbuka === false : input.bolehBatalkanKeputusan === false) {
      return { ok: false, kode: "TANPA_IZIN" };
    }
    if (await adaKlaimBerjalan(tx, loss.id)) return { ok: false, kode: "KLAIM_MENUNGGU" };
    if (await adaPotongan(tx, loss.id)) return { ok: false, kode: "SUDAH_ADA_POTONGAN" };

    const cas = await tx.stockLoss.updateMany({
      where: { id: loss.id, status: loss.status, updatedAt: loss.updatedAt },
      data: { status: "DIBATALKAN", decidedById: input.olehUserId, decidedAt: sekarang, decisionNote: alasan.teks },
    });
    if (cas.count !== 1) return { ok: false, kode: "BERUBAH" };
    await tx.stockLossShare.deleteMany({ where: { lossId: loss.id } });
    // Catatan MANUAL yang mengurangi buku toko: potongnya dikembalikan ke buku.
    const buku = await balikBukuHilang(tx, { lossId: loss.id, storeId: loss.storeId, createdById: input.olehUserId, waktu: sekarang });

    const lama = ringkasBagian(loss.shares);
    await jejakHilang(tx, {
      userId: input.olehUserId,
      action: JEJAK_HILANG.DIBATALKAN,
      lossId: loss.id,
      changes: {
        before: { status: loss.status, totalAmount: angka(loss.totalAmount), bagian: lama, decisionNote: loss.decisionNote },
        after: { status: "DIBATALKAN", bagian: [] },
      },
      ...(buku.balik.length > 0 || buku.dilewati.length > 0 ? { metadata: { bukuToko: buku } } : {}),
      reason: alasan.teks,
    });

    const orang = new Set(lama.map((b) => b.bearerUserId).filter((x): x is string => Boolean(x)));
    if (orang.size > 0) {
      const tokoNama = loss.storeId ? ((await tx.store.findUnique({ where: { id: loss.storeId }, select: { name: true } }))?.name ?? null) : null;
      for (const userId of orang) sesudah.kabar.push({ userId, kabar: kabarBeban(loss.id, tokoNama, 0, "BATAL") });
    }
    return { ok: true, id: loss.id };
  });

  if (hasil.ok) await kirimKabar(sesudah.kabar);
  return hasil;
}

// ─── Pelunasan di luar sistem ────────────────────────────────────────────────

export type KodeTolakTagihToko = "TIDAK_DITEMUKAN" | "BUKAN_BAGIAN_TOKO" | "BELUM_DITETAPKAN" | "LEWAT_SIKLUS" | "SUDAH_LUNAS" | "TEKS_TERLALU_PANJANG" | "ALASAN_WAJIB";

/**
 * Bagian TOKO di toko PUTUS: kantor menandai sudah ditagih ke toko (di luar
 * sistem — barangnya milik toko, tidak ada siklus yang menagihkannya). Toko
 * konsinyasi ditolak: bagiannya ditagihkan otomatis di siklus bulan itu.
 */
export async function tandaiTokoDitagih(input: {
  shareId: string;
  catatan?: unknown;
  olehUserId: string;
  sekarang?: Date;
}): Promise<{ ok: true; lossId: string } | { ok: false; kode: KodeTolakTagihToko }> {
  const catatan = rapikanTeksHilang(input.catatan, false);
  if (!catatan.ok) return { ok: false, kode: catatan.kode };
  const sekarang = input.sekarang ?? new Date();

  return runSerializable(async (tx) => {
    const share = await tx.stockLossShare.findUnique({
      where: { id: input.shareId },
      select: { id: true, bearer: true, amount: true, settledAmount: true, settledAt: true, loss: { select: { id: true, status: true, storeId: true } } },
    });
    if (!share) return { ok: false as const, kode: "TIDAK_DITEMUKAN" as const };
    if (share.bearer !== "TOKO") return { ok: false as const, kode: "BUKAN_BAGIAN_TOKO" as const };
    if (share.settledAt) return { ok: false as const, kode: "SUDAH_LUNAS" as const };
    if (share.loss.status !== "DITETAPKAN") return { ok: false as const, kode: "BELUM_DITETAPKAN" as const };
    const toko = share.loss.storeId ? await tx.store.findUnique({ where: { id: share.loss.storeId }, select: { termsType: true } }) : null;
    if (toko?.termsType === "KONSI") return { ok: false as const, kode: "LEWAT_SIKLUS" as const };

    const sebelumSen = keSen(angka(share.settledAmount));
    const jumlahSen = keSen(angka(share.amount));
    const cas = await tx.stockLossShare.updateMany({
      where: { id: share.id, settledAt: null },
      data: {
        settledAmount: desimal(jumlahSen),
        settledAt: sekarang,
        settledById: input.olehUserId,
        settleNote: catatan.teks ?? "Sudah ditagih ke toko",
      },
    });
    if (cas.count !== 1) return { ok: false as const, kode: "SUDAH_LUNAS" as const };
    if (jumlahSen > sebelumSen) {
      await tx.stockLossDeduction.create({
        data: {
          shareId: share.id,
          amount: desimal(jumlahSen - sebelumSen),
          refType: REF_TAGIH_TOKO_MANUAL,
          refId: share.id,
          note: catatan.teks,
          createdById: input.olehUserId,
          createdAt: sekarang,
        },
      });
    }
    await jejakHilang(tx, {
      userId: input.olehUserId,
      action: JEJAK_HILANG.LUNAS,
      lossId: share.loss.id,
      changes: { before: { shareId: share.id, settledAmount: dariSen(sebelumSen) }, after: { shareId: share.id, settledAmount: dariSen(jumlahSen) } },
      metadata: { bearer: "TOKO", cara: "DITAGIH_MANUAL" },
      reason: catatan.teks,
    });
    await segarkanStatusHilang(tx, [share.loss.id]);
    return { ok: true as const, lossId: share.loss.id };
  });
}

export type KodeTolakPotongSales = "BULAN_TIDAK_SAH" | "JUMLAH_TIDAK_SAH" | "KUNCI_WAJIB" | "TIDAK_ADA_BEBAN" | "MELEBIHI_SISA" | "TEKS_TERLALU_PANJANG" | "ALASAN_WAJIB";

/**
 * Kantor menandai beban SALES seorang salesman sudah dipotong dari komisinya
 * bulan itu (penggajian salesman belum ada di sistem). Jumlahnya dibagikan ke
 * bagian-bagian SALES-nya yang terlama dulu. Idempoten per `kunci` layar.
 */
export async function tandaiSalesDipotong(input: {
  salesmanId: string;
  bulan: string;
  jumlah: unknown;
  kunci: unknown;
  catatan?: unknown;
  olehUserId: string;
  sekarang?: Date;
}): Promise<{ ok: true; dipotong: number; ulang: boolean } | { ok: false; kode: KodeTolakPotongSales }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.bulan)) return { ok: false, kode: "BULAN_TIDAK_SAH" };
  const kunci = typeof input.kunci === "string" ? input.kunci.trim() : "";
  if (kunci.length < 8 || kunci.length > 100) return { ok: false, kode: "KUNCI_WAJIB" };
  const jumlah = input.jumlah;
  if (typeof jumlah !== "number" || !Number.isFinite(jumlah) || keSen(jumlah) <= 0 || Math.abs(keSen(jumlah) - jumlah * 100) > 1e-6) {
    return { ok: false, kode: "JUMLAH_TIDAK_SAH" };
  }
  const catatan = rapikanTeksHilang(input.catatan, false);
  if (!catatan.ok) return { ok: false, kode: catatan.kode };
  const refId = `${input.salesmanId}:${input.bulan}:${kunci}`;

  return runSerializable(async (tx) => {
    const sudah = await potonganUntukRefSen(tx, REF_KOMISI_SALESMAN, refId);
    if (sudah > 0) return { ok: true as const, dipotong: dariSen(sudah), ulang: true };
    const sisa = await sisaBebanOrangSen(tx, input.salesmanId, ["SALES"]);
    if (sisa <= 0) return { ok: false as const, kode: "TIDAK_ADA_BEBAN" as const };
    if (keSen(jumlah) > sisa) return { ok: false as const, kode: "MELEBIHI_SISA" as const };
    const dipotong = await potongBagianOrang(tx, {
      userId: input.salesmanId,
      bearers: ["SALES"],
      batasSen: keSen(jumlah),
      refType: REF_KOMISI_SALESMAN,
      refId,
      createdById: input.olehUserId,
      note: catatan.teks ?? `Dipotong dari komisi ${input.bulan}`,
      sekarang: input.sekarang,
    });
    return { ok: true as const, dipotong: dariSen(dipotong), ulang: false };
  });
}

// ─── Klaim ekspedisi ─────────────────────────────────────────────────────────

const BATAS_REFERENSI_KLAIM = 191;

/** Bagian EKSPEDISI dengan catatannya — `null` bila bukan bagian klaim ekspedisi. */
async function bacaBagianKlaim(tx: Tx, shareId: string) {
  const share = await tx.stockLossShare.findUnique({
    where: { id: shareId },
    select: {
      id: true,
      lossId: true,
      bearer: true,
      amount: true,
      claimStatus: true,
      claimRecordedById: true,
      loss: { select: { id: true, status: true, totalAmount: true, shares: { select: { id: true } } } },
    },
  });
  return share;
}

export type KodeTolakKlaimEkspedisi =
  | "TIDAK_DITEMUKAN"
  | "BUKAN_KLAIM_EKSPEDISI"
  | "SUDAH_DIPUTUSKAN"
  | "BELUM_DITETAPKAN"
  | "CARA_TIDAK_SAH"
  | "REFERENSI_WAJIB"
  | "ALASAN_WAJIB"
  | "TEKS_TERLALU_PANJANG";

/**
 * Jawaban ekspedisi atas klaimnya (P36), oleh pemegang `receivables:manage`:
 * - `DIBAYAR` = pembayarannya DICATAT (transfer, tunai, atau potong tagihan ongkir — nomor tagihan
 *   ongkirnya wajib untuk potong ongkir): DIAJUKAN → MENUNGGU_CEK. Uangnya baru diakui setelah
 *   dicek Keuangan (`periksaKlaimEkspedisi`, keputusan 11).
 * - `DITOLAK` (alasan wajib): DIAJUKAN → DITOLAK; kantor lalu memilih penanggung lain lewat
 *   "Ubah keputusan".
 * Bandingkan-lalu-tukar pada `claimStatus` di dalam `runSerializable`, jejaknya di transaksi yang sama.
 */
export async function putuskanKlaimEkspedisi(input: {
  shareId: string;
  hasil: "DIBAYAR" | "DITOLAK";
  cara?: unknown;
  referensi?: unknown;
  catatan: unknown;
  olehUserId: string;
  sekarang?: Date;
}): Promise<{ ok: true; lossId: string } | { ok: false; kode: KodeTolakKlaimEkspedisi }> {
  const sekarang = input.sekarang ?? new Date();
  const catatan = rapikanTeksHilang(input.catatan, input.hasil === "DITOLAK");
  if (!catatan.ok) return { ok: false, kode: catatan.kode };
  let cara: ReturnType<typeof bacaCaraBayarKlaim> = null;
  let referensi: string | null = null;
  if (input.hasil === "DIBAYAR") {
    cara = bacaCaraBayarKlaim(input.cara);
    if (!cara) return { ok: false, kode: "CARA_TIDAK_SAH" };
    const ref = typeof input.referensi === "string" ? input.referensi.replace(/\s+/g, " ").trim() : "";
    if (ref.length > BATAS_REFERENSI_KLAIM) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
    if (cara === "potong_ongkir" && !ref) return { ok: false, kode: "REFERENSI_WAJIB" };
    referensi = ref || null;
  }

  return runSerializable(async (tx) => {
    const share = await bacaBagianKlaim(tx, input.shareId);
    if (!share) return { ok: false as const, kode: "TIDAK_DITEMUKAN" as const };
    if (share.bearer !== "EKSPEDISI") return { ok: false as const, kode: "BUKAN_KLAIM_EKSPEDISI" as const };
    if (share.loss.status !== "DITETAPKAN") return { ok: false as const, kode: "BELUM_DITETAPKAN" as const };
    if (share.claimStatus !== "DIAJUKAN") return { ok: false as const, kode: "SUDAH_DIPUTUSKAN" as const };
    const cas = await tx.stockLossShare.updateMany({
      where: { id: share.id, claimStatus: "DIAJUKAN" },
      data:
        input.hasil === "DIBAYAR"
          ? {
              claimStatus: "MENUNGGU_CEK",
              claimPaidMethod: cara,
              claimReference: referensi,
              claimRecordedAt: sekarang,
              claimRecordedById: input.olehUserId,
              claimNote: catatan.teks,
            }
          : { claimStatus: "DITOLAK", claimDecidedAt: sekarang, claimDecidedById: input.olehUserId, claimNote: catatan.teks },
    });
    if (cas.count !== 1) return { ok: false as const, kode: "SUDAH_DIPUTUSKAN" as const };
    await jejakHilang(tx, {
      userId: input.olehUserId,
      action: input.hasil === "DIBAYAR" ? JEJAK_HILANG.KLAIM_DICATAT : JEJAK_HILANG.KLAIM_DITOLAK,
      lossId: share.lossId,
      changes: {
        before: { claimStatus: "DIAJUKAN" },
        after: { claimStatus: input.hasil === "DIBAYAR" ? "MENUNGGU_CEK" : "DITOLAK", cara, referensi },
      },
      metadata: { shareId: share.id, nilai: angka(share.amount) },
      reason: catatan.teks,
    });
    return { ok: true as const, lossId: share.lossId };
  });
}

export type KodeTolakPeriksaKlaim = "TIDAK_DITEMUKAN" | "BUKAN_MENUNGGU_CEK" | "PEMERIKSA_SAMA" | "ALASAN_WAJIB" | "TEKS_TERLALU_PANJANG";

/**
 * Pemeriksaan pembayaran klaim ekspedisi oleh Keuangan (`payments:verify`, keputusan 11): pemeriksa
 * BUKAN pencatatnya (admin juga). `SAH` → DIBAYAR: bagiannya lunas sebesar nilainya, satu
 * `StockLossDeduction` (`KlaimEkspedisi`), status catatan disegarkan. `KEMBALIKAN` (catatan wajib)
 * → kembali DIAJUKAN, isian pembayarannya dihapus, supaya pencatat merevisinya.
 */
export async function periksaKlaimEkspedisi(input: {
  shareId: string;
  hasil: "SAH" | "KEMBALIKAN";
  catatan: unknown;
  olehUserId: string;
  sekarang?: Date;
}): Promise<{ ok: true; lossId: string; dibayar: boolean } | { ok: false; kode: KodeTolakPeriksaKlaim }> {
  const sekarang = input.sekarang ?? new Date();
  const catatan = rapikanTeksHilang(input.catatan, input.hasil === "KEMBALIKAN");
  if (!catatan.ok) return { ok: false, kode: catatan.kode };

  return runSerializable(async (tx) => {
    const share = await bacaBagianKlaim(tx, input.shareId);
    if (!share || share.bearer !== "EKSPEDISI") return { ok: false as const, kode: "TIDAK_DITEMUKAN" as const };
    if (share.claimStatus !== "MENUNGGU_CEK") return { ok: false as const, kode: "BUKAN_MENUNGGU_CEK" as const };
    if (share.claimRecordedById === input.olehUserId) return { ok: false as const, kode: "PEMERIKSA_SAMA" as const };
    const nilaiSen = keSen(angka(share.amount));
    const cas = await tx.stockLossShare.updateMany({
      where: { id: share.id, claimStatus: "MENUNGGU_CEK", claimRecordedById: share.claimRecordedById },
      data:
        input.hasil === "SAH"
          ? {
              claimStatus: "DIBAYAR",
              claimDecidedAt: sekarang,
              claimDecidedById: input.olehUserId,
              settledAmount: desimal(nilaiSen),
              settledAt: sekarang,
              settledById: input.olehUserId,
              settleNote: "Klaim ekspedisi dibayar (dicek Keuangan)",
            }
          : {
              claimStatus: "DIAJUKAN",
              claimPaidMethod: null,
              claimReference: null,
              claimRecordedAt: null,
              claimRecordedById: null,
              claimNote: catatan.teks,
            },
    });
    if (cas.count !== 1) return { ok: false as const, kode: "BUKAN_MENUNGGU_CEK" as const };
    if (input.hasil === "SAH") {
      await tx.stockLossDeduction.create({
        data: {
          shareId: share.id,
          amount: desimal(nilaiSen),
          refType: REF_KLAIM_EKSPEDISI,
          refId: share.id,
          note: catatan.teks,
          createdById: input.olehUserId,
          createdAt: sekarang,
        },
      });
      await segarkanStatusHilang(tx, [share.lossId]);
    }
    await jejakHilang(tx, {
      userId: input.olehUserId,
      action: input.hasil === "SAH" ? JEJAK_HILANG.KLAIM_DIBAYAR : JEJAK_HILANG.KLAIM_DIKEMBALIKAN,
      lossId: share.lossId,
      changes: { before: { claimStatus: "MENUNGGU_CEK" }, after: { claimStatus: input.hasil === "SAH" ? "DIBAYAR" : "DIAJUKAN" } },
      metadata: { shareId: share.id, nilai: dariSen(nilaiSen), pencatat: share.claimRecordedById },
      reason: catatan.teks,
    });
    return { ok: true as const, lossId: share.lossId, dibayar: input.hasil === "SAH" };
  });
}

export type KodeTolakUbahNilaiKlaim = "TIDAK_DITEMUKAN" | "BUKAN_DIAJUKAN" | "TOTAL_TIDAK_SAH" | "ALASAN_WAJIB" | "TEKS_TERLALU_PANJANG" | "BERUBAH";

/**
 * Nilai klaim ekspedisi diubah selama masih DIAJUKAN (kesepakatan dengan ekspedisi), alasan wajib.
 * Bagian EKSPEDISI selalu satu-satunya, jadi nilai bagian dan total catatan berubah bersama.
 */
export async function ubahNilaiKlaimEkspedisi(input: {
  shareId: string;
  nilai: unknown;
  catatan: unknown;
  olehUserId: string;
}): Promise<{ ok: true; lossId: string } | { ok: false; kode: KodeTolakUbahNilaiKlaim }> {
  if (typeof input.nilai !== "number" || !Number.isFinite(input.nilai) || input.nilai <= 0) return { ok: false, kode: "TOTAL_TIDAK_SAH" };
  const nilaiSen = keSen(input.nilai);
  if (Math.abs(nilaiSen - input.nilai * 100) > 1e-6) return { ok: false, kode: "TOTAL_TIDAK_SAH" };
  const catatan = rapikanTeksHilang(input.catatan, true);
  if (!catatan.ok) return { ok: false, kode: catatan.kode };

  return runSerializable(async (tx) => {
    const share = await bacaBagianKlaim(tx, input.shareId);
    if (!share || share.bearer !== "EKSPEDISI") return { ok: false as const, kode: "TIDAK_DITEMUKAN" as const };
    if (share.claimStatus !== "DIAJUKAN") return { ok: false as const, kode: "BUKAN_DIAJUKAN" as const };
    const lamaSen = keSen(angka(share.amount));
    const cas = await tx.stockLossShare.updateMany({
      where: { id: share.id, claimStatus: "DIAJUKAN", amount: desimal(lamaSen) },
      data: { amount: desimal(nilaiSen) },
    });
    if (cas.count !== 1) return { ok: false as const, kode: "BERUBAH" as const };
    await tx.stockLoss.update({ where: { id: share.lossId }, data: { totalAmount: desimal(nilaiSen) } });
    await jejakHilang(tx, {
      userId: input.olehUserId,
      action: JEJAK_HILANG.KLAIM_DIUBAH,
      lossId: share.lossId,
      changes: { before: { nilai: dariSen(lamaSen) }, after: { nilai: dariSen(nilaiSen) } },
      metadata: { shareId: share.id },
      reason: catatan.teks,
    });
    return { ok: true as const, lossId: share.lossId };
  });
}
