/**
 * Rencana kirim — penyusun draf pesanan dari kriteria salesman. Murni: tanpa
 * basis data, tanpa jam. Pemuat bahannya di `rencana-queries.ts`.
 *
 * Hasilnya SELALU draf: salesman meninjau, mengubah, lalu mengirim lewat
 * penulis pesanan biasa (`createFieldSalesOrder`) — harga, kredit, dan
 * persetujuan kantor dinilai di sana, tidak di sini.
 *
 * Alurnya:
 *   1. Setiap artikel di kategori pilihan dinilai terhadap SUMBER yang dicentang.
 *      Artikel yang tidak lolos satu sumber pun tidak ikut sama sekali.
 *   2. Urutan: sumber terkuat yang dilolosinya (urutan `SUMBER_RENCANA`), lalu
 *      yang lolos lebih banyak sumber, lalu ukuran khas sumbernya (laku
 *      terbanyak, umur termuda, …), lalu SKU.
 *   3. Kategori diambil bergiliran (satu artikel per kategori per putaran),
 *      supaya kategori yang dipilih semuanya terwakili sebelum batas artikel.
 *   4. Setiap artikel dinilai pengecualiannya (sisa di toko, harga, stok gudang,
 *      anggaran). Yang gagal masuk daftar DILEWATI beserta sebabnya — tidak
 *      pernah hilang diam-diam.
 */

import { expandPack, type PackRatioRow } from "@elorae/db/pack-ratio";
import { bagiSebanding } from "@/lib/konsinyasi/stok-di-toko";
import { MIN_PCS_LARIS } from "@/lib/salesman/saran-tawar";
import { SUMBER_RENCANA, type JumlahPerArtikel, type SumberRencana } from "./kriteria";

export { SUMBER_RENCANA, type JumlahPerArtikel, type SumberRencana };

export type VarianKandidat = { variantSku: string; size: string };

export type KandidatRencana = {
  itemId: string;
  sku: string;
  kategoriId: string;
  /** Varian bertanda ukuran; kosong = barang tanpa varian (satu ember `""`). */
  variants: VarianKandidat[];
  /** Stok gudang yang boleh dipesan per variantSku (`""` untuk tanpa varian): qtyOnHand − reservedQty. */
  available: Record<string, number>;
  /** Harga per pcs untuk toko PUTUS (harga server); null = belum diatur, atau toko KONSI. */
  harga: number | null;
};

/** Stok toko per barang — hanya bila stok toko ini memang tercatat. */
export type StokTokoBarang = { sisa: number; dalamProses: number; laku: number };

export type BahanRencana = {
  kandidat: KandidatRencana[];
  /** Barang yang pernah dikirim/dipesan ke toko ini (tingkat barang, seperti aturan konsinyasi). */
  pernahDikirim: ReadonlySet<string>;
  /**
   * Stok di toko tercatat (buku stok toko, atau titipan konsinyasi). Kalau
   * tidak, `stokToko` diabaikan: "laku di sini" memakai riwayat pesanan dan
   * tidak ada artikel yang dilewati karena sisanya.
   */
  stokTokoDiketahui: boolean;
  stokToko: ReadonlyMap<string, StokTokoBarang>;
  /** Potongan yang pernah dipesan toko ini (disetujui) — dasar "laku di sini" tanpa stok toko. */
  dipesanToko: ReadonlyMap<string, number>;
  /** Penjualan di toko sejenis: potongan dan JUMLAH toko — tanpa nama toko, tanpa rupiah. */
  jualTokoLain: ReadonlyMap<string, { pcs: number; toko: number }>;
  /** Umur barang (hari kalender WIB) untuk barang yang ada stoknya. */
  umurHari: ReadonlyMap<string, number>;
};

export type KriteriaRencana = {
  /** Kategori pilihan, dalam urutan giliran. */
  kategoriIds: string[];
  sumber: SumberRencana[];
  jumlah: JumlahPerArtikel;
  /** Umur maksimal "barang baru" (hari). */
  hariBaru: number;
  /** Lewati artikel yang sisanya di toko (+ yang sedang menuju toko) sudah ≥ angka ini. null = mati. */
  lewatiSisaMin: number | null;
  maksArtikel: number;
  /** Anggaran maksimum (Rp) — PUTUS saja; pemanggil memberi null untuk konsinyasi. */
  anggaran: number | null;
  /** Toko konsinyasi: tidak ada harga dan anggaran di mana pun. */
  konsi: boolean;
};

export type AlasanRencana =
  | { jenis: "BELUM_DIKIRIM" }
  | { jenis: "LAKU_DI_SINI"; laku: number; sisa: number }
  | { jenis: "DIPESAN_DI_SINI"; pcs: number }
  | { jenis: "LAKU_DI_TOKO_LAIN"; pcs: number; toko: number }
  | { jenis: "BARANG_BARU"; umurHari: number };

export type SebabDilewati =
  | { jenis: "SUDAH_CUKUP"; sisa: number; dalamProses: number }
  | { jenis: "HARGA_KOSONG" }
  | { jenis: "UKURAN_TIDAK_ADA"; ukuran: string }
  | { jenis: "STOK_GUDANG_KURANG"; ukuran: string; butuh: number; ada: number }
  | { jenis: "STOK_GUDANG_HABIS" }
  | { jenis: "RASIO_KOSONG" }
  | { jenis: "MELEBIHI_ANGGARAN" };

export type KurangUkuran = { ukuran: string; butuh: number; ada: number };

export type BarisRencana = { variantSku: string; ukuran: string; qty: number; tersedia: number };

export type ArtikelRencana = {
  itemId: string;
  alasan: AlasanRencana[];
  baris: BarisRencana[];
  /** Ukuran yang tidak tertutup stok gudang (mode N pcs) — dilaporkan, tidak disembunyikan. */
  kurang: KurangUkuran[];
  pcs: number;
};

export type DilewatiRencana = { itemId: string; sebab: SebabDilewati };

export type HasilRencana = {
  artikel: ArtikelRencana[];
  dilewati: DilewatiRencana[];
  /** Artikel yang lolos kriteria tapi tidak dinilai karena batas artikel sudah tercapai. */
  lebih: number;
  totalPcs: number;
  /** Estimasi nilai (harga toko, sebelum promo) — null untuk konsinyasi. */
  totalNilai: number | null;
};

const norm = (s: string) => s.trim().toLowerCase();

// ─── Pembagian pcs ke ukuran ──────────────────────────────────────────────────

/**
 * Bagi `pcs` ke ukuran sebuah artikel.
 *
 * - Ukuran yang ada di rasio pack dibagi sebanding rasionya (sisa terbesar,
 *   `bagiSebanding`) — termasuk ukuran yang stoknya kosong, supaya
 *   kekurangannya terlihat.
 * - Artikel yang tidak punya satu pun ukuran rasio (atau rasionya kosong)
 *   dibagi rata ke ukuran yang ADA stoknya.
 * - Barang tanpa varian: semuanya ke satu ember `""`.
 *
 * Jumlah per ukuran tidak pernah melebihi stok tersedia; kekurangannya
 * dikembalikan di `kurang` dan TIDAK dipindah ke ukuran lain (memindahkannya
 * merusak susunan ukuran yang diminta toko).
 */
export function bagiPcsKeUkuran(input: {
  pcs: number;
  variants: VarianKandidat[];
  available: Record<string, number>;
  ratio: PackRatioRow[];
}): { baris: BarisRencana[]; kurang: KurangUkuran[] } {
  const tersedia = (sku: string) => Math.max(0, Math.floor(input.available[sku] ?? 0));

  let ember: VarianKandidat[];
  let bobot: number[];
  if (input.variants.length === 0) {
    ember = [{ variantSku: "", size: "" }];
    bobot = [1];
  } else {
    const rasio = new Map(input.ratio.map((r) => [norm(r.size), r.qty]));
    const cocok = input.variants.filter((v) => (rasio.get(norm(v.size)) ?? 0) > 0);
    if (cocok.length > 0) {
      ember = cocok;
      bobot = cocok.map((v) => rasio.get(norm(v.size)) as number);
    } else {
      ember = input.variants.filter((v) => tersedia(v.variantSku) > 0);
      bobot = ember.map(() => 1);
    }
  }
  if (ember.length === 0 || input.pcs <= 0) return { baris: [], kurang: [] };

  const bagian = bagiSebanding(input.pcs, bobot);
  const baris: BarisRencana[] = [];
  const kurang: KurangUkuran[] = [];
  ember.forEach((v, i) => {
    const butuh = bagian[i];
    if (butuh <= 0) return;
    const ada = tersedia(v.variantSku);
    const qty = Math.min(butuh, ada);
    if (qty > 0) baris.push({ variantSku: v.variantSku, ukuran: v.size, qty, tersedia: ada });
    if (qty < butuh) kurang.push({ ukuran: v.size, butuh, ada });
  });
  return { baris, kurang };
}

// ─── Kelolosan sumber ─────────────────────────────────────────────────────────

function alasanArtikel(k: KandidatRencana, bahan: BahanRencana, kriteria: KriteriaRencana): AlasanRencana[] {
  const alasan: AlasanRencana[] = [];
  for (const s of SUMBER_RENCANA) {
    if (!kriteria.sumber.includes(s)) continue;
    if (s === "BELUM_DIKIRIM") {
      if (!bahan.pernahDikirim.has(k.itemId)) alasan.push({ jenis: "BELUM_DIKIRIM" });
    } else if (s === "LAKU_DI_SINI") {
      if (bahan.stokTokoDiketahui) {
        // Laku tinggi, sisa tipis: yang tersisa (plus yang sedang menuju toko)
        // tidak cukup untuk penjualan satu jendela lagi.
        const st = bahan.stokToko.get(k.itemId);
        if (st && st.laku > 0 && Math.max(0, st.sisa) + st.dalamProses < st.laku) {
          alasan.push({ jenis: "LAKU_DI_SINI", laku: st.laku, sisa: Math.max(0, st.sisa) });
        }
      } else {
        const pcs = bahan.dipesanToko.get(k.itemId) ?? 0;
        if (pcs > 0) alasan.push({ jenis: "DIPESAN_DI_SINI", pcs });
      }
    } else if (s === "LAKU_DI_TOKO_LAIN") {
      const j = bahan.jualTokoLain.get(k.itemId);
      if (j && j.pcs >= MIN_PCS_LARIS) alasan.push({ jenis: "LAKU_DI_TOKO_LAIN", pcs: j.pcs, toko: j.toko });
    } else {
      const umur = bahan.umurHari.get(k.itemId);
      if (umur !== undefined && umur <= kriteria.hariBaru) alasan.push({ jenis: "BARANG_BARU", umurHari: umur });
    }
  }
  return alasan;
}

/** Ukuran khas per sumber: angka lebih besar = lebih dulu. */
function bobotAlasan(a: AlasanRencana, umur: number | undefined): number {
  switch (a.jenis) {
    case "LAKU_DI_SINI":
      return a.laku - a.sisa;
    case "DIPESAN_DI_SINI":
      return a.pcs;
    case "LAKU_DI_TOKO_LAIN":
      return a.pcs * 1000 + a.toko;
    case "BARANG_BARU":
      return -a.umurHari;
    case "BELUM_DIKIRIM":
      // Di antara yang belum pernah dikirim, yang lebih baru dulu.
      return umur === undefined ? Number.NEGATIVE_INFINITY : -umur;
  }
}

type Calon = { k: KandidatRencana; alasan: AlasanRencana[] };

function urutkan(calon: Calon[], bahan: BahanRencana): Calon[] {
  const tingkat = (c: Calon) => SUMBER_RENCANA.indexOf(sumberDari(c.alasan[0]));
  return [...calon].sort((a, b) => {
    const ta = tingkat(a);
    const tb = tingkat(b);
    if (ta !== tb) return ta - tb;
    if (a.alasan.length !== b.alasan.length) return b.alasan.length - a.alasan.length;
    const ba = bobotAlasan(a.alasan[0], bahan.umurHari.get(a.k.itemId));
    const bb = bobotAlasan(b.alasan[0], bahan.umurHari.get(b.k.itemId));
    if (ba !== bb) return bb - ba;
    return a.k.sku.localeCompare(b.k.sku);
  });
}

function sumberDari(a: AlasanRencana): SumberRencana {
  return a.jenis === "DIPESAN_DI_SINI" ? "LAKU_DI_SINI" : a.jenis;
}

// ─── Penyusun ─────────────────────────────────────────────────────────────────

type Nilai =
  | { ok: true; baris: BarisRencana[]; kurang: KurangUkuran[] }
  | { ok: false; sebab: SebabDilewati };

function jumlahArtikel(k: KandidatRencana, jumlah: JumlahPerArtikel, ratio: PackRatioRow[]): Nilai {
  if (jumlah.mode === "PACK") {
    const r = expandPack({ ratio, variants: k.variants, available: k.available });
    if (r.ok) {
      return {
        ok: true,
        baris: r.lines.map((l) => ({
          variantSku: l.variantSku,
          ukuran: l.size,
          qty: l.qty,
          tersedia: Math.max(0, Math.floor(k.available[l.variantSku] ?? 0)),
        })),
        kurang: [],
      };
    }
    if (r.reason === "EMPTY_RATIO") return { ok: false, sebab: { jenis: "RASIO_KOSONG" } };
    if (r.reason === "MISSING_SIZE") return { ok: false, sebab: { jenis: "UKURAN_TIDAK_ADA", ukuran: r.size } };
    return { ok: false, sebab: { jenis: "STOK_GUDANG_KURANG", ukuran: r.size, butuh: r.needed, ada: Math.max(0, r.have) } };
  }
  const hasil = bagiPcsKeUkuran({ pcs: jumlah.pcs, variants: k.variants, available: k.available, ratio });
  if (hasil.baris.length === 0) return { ok: false, sebab: { jenis: "STOK_GUDANG_HABIS" } };
  return { ok: true, ...hasil };
}

export function susunRencanaKirim(bahan: BahanRencana, kriteria: KriteriaRencana, ratio: PackRatioRow[]): HasilRencana {
  // Antrean per kategori, dalam urutan pilihan salesman.
  const urutanKategori = [...new Set(kriteria.kategoriIds)];
  const perKategori = new Map<string, Calon[]>(urutanKategori.map((id) => [id, []]));
  for (const k of bahan.kandidat) {
    const antre = perKategori.get(k.kategoriId);
    if (!antre) continue;
    const alasan = alasanArtikel(k, bahan, kriteria);
    if (alasan.length > 0) antre.push({ k, alasan });
  }
  const antrean = urutanKategori.map((id) => urutkan(perKategori.get(id) ?? [], bahan));

  const artikel: ArtikelRencana[] = [];
  const dilewati: DilewatiRencana[] = [];
  let lebih = 0;
  let sisaAnggaran = kriteria.konsi ? null : kriteria.anggaran;
  const maks = Math.max(0, kriteria.maksArtikel);

  const panjang = Math.max(0, ...antrean.map((a) => a.length));
  for (let putaran = 0; putaran < panjang; putaran++) {
    for (const antre of antrean) {
      const c = antre[putaran];
      if (!c) continue;
      if (artikel.length >= maks) {
        lebih++;
        continue;
      }
      const { k } = c;

      if (kriteria.lewatiSisaMin !== null && bahan.stokTokoDiketahui) {
        const st = bahan.stokToko.get(k.itemId);
        const sisa = Math.max(0, st?.sisa ?? 0);
        const dalamProses = st?.dalamProses ?? 0;
        if (sisa + dalamProses >= kriteria.lewatiSisaMin) {
          dilewati.push({ itemId: k.itemId, sebab: { jenis: "SUDAH_CUKUP", sisa, dalamProses } });
          continue;
        }
      }
      if (!kriteria.konsi && (k.harga === null || k.harga <= 0)) {
        dilewati.push({ itemId: k.itemId, sebab: { jenis: "HARGA_KOSONG" } });
        continue;
      }

      const n = jumlahArtikel(k, kriteria.jumlah, ratio);
      if (!n.ok) {
        dilewati.push({ itemId: k.itemId, sebab: n.sebab });
        continue;
      }
      const pcs = n.baris.reduce((s, b) => s + b.qty, 0);

      if (sisaAnggaran !== null) {
        const nilai = pcs * (k.harga as number);
        // Artikel yang tidak muat dilewati, artikel berikutnya yang lebih murah masih dicoba.
        if (nilai > sisaAnggaran) {
          dilewati.push({ itemId: k.itemId, sebab: { jenis: "MELEBIHI_ANGGARAN" } });
          continue;
        }
        sisaAnggaran -= nilai;
      }

      artikel.push({ itemId: k.itemId, alasan: c.alasan, baris: n.baris, kurang: n.kurang, pcs });
    }
  }

  const harga = new Map(bahan.kandidat.map((k) => [k.itemId, k.harga ?? 0]));
  return {
    artikel,
    dilewati,
    lebih,
    totalPcs: artikel.reduce((s, a) => s + a.pcs, 0),
    totalNilai: kriteria.konsi ? null : artikel.reduce((s, a) => s + a.pcs * (harga.get(a.itemId) ?? 0), 0),
  };
}
