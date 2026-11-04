/**
 * Antaran (satu pengiriman barang ke toko) dan sisa pesanannya, dalam POTONG
 * saja — dipakai layar terima SPG, kabar ke salesman, catatan barang hilang di
 * kantor, dan daftar "Pesanan untuk toko ini". Tanpa rupiah: harga konsinyasi
 * tidak pernah sampai ke HP SPG maupun salesman.
 *
 * Murni, tanpa impor: komponen klien memakainya langsung.
 *
 * Dua kekurangan yang TIDAK boleh tercampur (keputusan pemilik 2026-11-01):
 * - KURANG DI PERJALANAN: barang yang sudah dikirim gudang di antaran ini
 *   tetapi tidak tiba. Yang dicek pengantar/ekspedisinya (resi, foto serah
 *   terima). Inilah yang menjadi catatan barang hilang.
 * - BELUM DIKIRIM GUDANG: sisa pesanan yang belum masuk pengiriman mana pun.
 *   Barangnya masih di gudang — tidak pernah menjadi kekurangan atau barang
 *   hilang, dan hilang begitu saja kalau kantor menutup sisanya.
 */

export type CaraAntar = "EXPEDITION" | "SALESMAN_CARRY";

/** Pengiriman yang membawa barang ini ke toko. */
export type PengirimanAntaran = {
  id: string;
  docNo: string;
  cara: CaraAntar;
  /** Nama salesman/pengantar yang membawa (dibawa salesman). */
  pengantar: string | null;
  /** Nama ekspedisi dan nomor resinya (ekspedisi). */
  ekspedisi: string | null;
  resi: string | null;
  /** Foto barang / nota bertanda tangan saat serah terima tersimpan di pengiriman itu. */
  adaBuktiSerahTerima: boolean;
  /** Berat kiriman (kg) yang dicatat gudang sebelum berangkat (ekspedisi, P35). */
  beratKg?: number | null;
};

export type InfoAntaran = {
  orderId: string;
  orderNo: string;
  /** null = dicatat kantor tanpa pengiriman (jalur satu langkah). */
  pengiriman: PengirimanAntaran | null;
  /** Sisa pesanan yang belum masuk pengiriman mana pun — masih di gudang. */
  belumDikirimGudang: number;
  /** Sisa pesanan yang sudah dikemas atau sedang di jalan di pengiriman LAIN. */
  dalamPengirimanLain: number;
};

export type BarisSisaPesanan = { id?: string; qty: number; deliveredQty: number; cancelledQty: number };
export type BarisPengirimanBerjalan = { status: string; lines: { orderLineId: string; plannedQty: number }[] };

export type SisaPesanan = {
  /** Belum sampai toko: belum dikirim gudang + dikemas + di jalan. */
  sisa: number;
  /** Sudah dikemas gudang, belum berangkat. */
  dikemas: number;
  /** Sedang di jalan menuju toko. */
  dalamPerjalanan: number;
  /** Belum masuk pengiriman mana pun. */
  belumDikirimGudang: number;
};

/**
 * Sisa satu baris pesanan dibagi ke tiga tempatnya. Yang direncanakan di
 * pengiriman berjalan tidak pernah melebihi sisanya: pengiriman yang berlebih
 * (data rusak) tidak boleh membuat "belum dikirim gudang" negatif.
 */
export function sisaBarisPesanan(
  baris: BarisSisaPesanan,
  pengiriman: readonly BarisPengirimanBerjalan[],
): SisaPesanan {
  /*
   * Barang keluar gudang saat pengiriman DIBUAT (Q1), jadi `deliveredQty` sudah
   * menghitung yang dikemas dan yang sedang di jalan. Yang belum masuk pengiriman
   * mana pun = dipesan − deliveredQty − dibatalkan; yang dikemas/di jalan dibaca
   * dari pengiriman berjalan dan DITAMBAHKAN di atasnya.
   */
  const belumDikirimGudang = Math.max(0, baris.qty - baris.deliveredQty - baris.cancelledQty);
  let dikemas = 0;
  let dalamPerjalanan = 0;
  if (baris.id) {
    for (const p of pengiriman) {
      const rencana = p.lines.filter((l) => l.orderLineId === baris.id).reduce((n, l) => n + Math.max(0, l.plannedQty), 0);
      if (p.status === "PACKED") dikemas += rencana;
      else if (p.status === "IN_TRANSIT") dalamPerjalanan += rencana;
    }
  }
  return { sisa: belumDikirimGudang + dikemas + dalamPerjalanan, dikemas, dalamPerjalanan, belumDikirimGudang };
}

/** Jumlah `sisaBarisPesanan` atas semua baris pesanan. */
export function sisaPesanan(baris: readonly BarisSisaPesanan[], pengiriman: readonly BarisPengirimanBerjalan[]): SisaPesanan {
  const total: SisaPesanan = { sisa: 0, dikemas: 0, dalamPerjalanan: 0, belumDikirimGudang: 0 };
  for (const b of baris) {
    const s = sisaBarisPesanan(b, pengiriman);
    total.sisa += s.sisa;
    total.dikemas += s.dikemas;
    total.dalamPerjalanan += s.dalamPerjalanan;
    total.belumDikirimGudang += s.belumDikirimGudang;
  }
  return total;
}

/** "Budi" / "JNE resi 123" / "JNE" — siapa yang membawa, untuk kalimat kabar. */
export function teksPembawa(p: Pick<PengirimanAntaran, "cara" | "pengantar" | "ekspedisi" | "resi">): string | null {
  if (p.cara === "SALESMAN_CARRY") return p.pengantar?.trim() || null;
  const nama = p.ekspedisi?.trim() || "";
  const resi = p.resi?.trim() || "";
  if (nama && resi) return `${nama} resi ${resi}`;
  if (resi) return `resi ${resi}`;
  return nama || null;
}

/** "pengantar Budi" / "ekspedisi JNE resi 123" — siapa yang perlu dicek. */
export function teksYangDicek(p: Pick<PengirimanAntaran, "cara" | "pengantar" | "ekspedisi" | "resi">): string {
  const pembawa = teksPembawa(p);
  if (p.cara === "SALESMAN_CARRY") return pembawa ? `pengantar ${pembawa}` : "pengantarnya";
  return pembawa ? `ekspedisi ${pembawa}` : "ekspedisinya";
}

/** Tiga bagian kalimat "kurang di perjalanan", urut dari yang paling penting. */
export type BagianKurangPerjalanan = {
  /** "Kurang di perjalanan — cek ke ekspedisi JNE resi 123." — siapa yang dicek. */
  cek: string;
  /** "Gudang mengirim 60 pcs di DLV/…, tiba 57." — berapa dikirim di antaran itu, berapa tiba. */
  rincian: string;
  /** Kalimat bukti serah terima, atau null kalau pengirimannya tidak menyimpan foto/tanda tangan. */
  bukti: string | null;
  /** Nomor pengiriman yang membawa kiriman ini. */
  docNo: string;
};

/**
 * Bagian kalimat "kurang di perjalanan", atau null kalau tidak ada yang kurang.
 * Hanya bila datanya ada — kiriman yang dicatat kantor satu langkah (tanpa
 * pengiriman) tidak punya pengantar untuk disebut, jadi kabarnya tetap seperti
 * biasa. Jumlah kurangnya sengaja tidak ditulis lagi: judul kabar dan catatan
 * kantor sudah menyebutnya.
 *
 * "Siapa yang dicek" ada di depan: kabar dipotong di 191 huruf
 * (`NOTIFICATION_TEXT_MAX`), dan nama ekspedisi + resi adalah bagian yang
 * paling dibutuhkan pembacanya — tidak boleh menjadi yang terpotong.
 */
export function bagianKurangPerjalanan(
  s: { dikirim: number; diterima: number; kurang: number },
  info: Pick<InfoAntaran, "pengiriman"> | null,
): BagianKurangPerjalanan | null {
  if (!(s.kurang > 0)) return null;
  const p = info?.pengiriman ?? null;
  if (!p) return null;
  const berat = p.beratKg !== null && p.beratKg !== undefined && p.beratKg > 0 ? ` (berat ${p.beratKg.toLocaleString("id-ID")} kg)` : "";
  return {
    cek: `Kurang di perjalanan — cek ke ${teksYangDicek(p)}.`,
    rincian: `Gudang mengirim ${s.dikirim} pcs di ${p.docNo}${berat}, tiba ${s.diterima}.`,
    bukti: p.adaBuktiSerahTerima ? "Foto serah terima ada di pengiriman itu." : null,
    docNo: p.docNo,
  };
}

/** Kalimat "kurang di perjalanan" utuh (catatan kantor), atau null. */
export function kalimatKurangPerjalanan(
  s: { dikirim: number; diterima: number; kurang: number },
  info: Pick<InfoAntaran, "pengiriman"> | null,
): string | null {
  const b = bagianKurangPerjalanan(s, info);
  return b ? [b.cek, b.rincian, b.bukti].filter(Boolean).join(" ") : null;
}

/**
 * Rangkai kalimat-kalimat yang muat dalam `batas` huruf (titik kode, sama
 * dengan `capNotificationText`). Urutannya = urutan pentingnya: bagian yang
 * tidak muat DILEWATI utuh, tidak dipotong di tengah. Satu bagian boleh berupa
 * beberapa pilihan, dari yang terlengkap — yang pertama muat dipakai. Bagian
 * pertama selalu ikut (pilihan terpendeknya bila tidak ada yang muat; pemotong
 * kabar yang memendekkannya).
 */
export function rangkaiDalamBatas(bagian: readonly (string | readonly string[] | null | undefined)[], batas: number): string {
  const panjang = (t: string) => Array.from(t).length;
  let hasil = "";
  for (const b of bagian) {
    const mentah: readonly string[] = typeof b === "string" ? [b] : (b ?? []);
    const pilihan = mentah.map((x) => x.trim()).filter(Boolean);
    if (pilihan.length === 0) continue;
    if (!hasil) {
      hasil = pilihan.find((x) => panjang(x) <= batas) ?? pilihan[pilihan.length - 1];
      continue;
    }
    const muat = pilihan.find((x) => panjang(hasil) + 1 + panjang(x) <= batas);
    if (muat) hasil = `${hasil} ${muat}`;
  }
  return hasil;
}

/** "Sisa pesanan 40 pcs belum dikirim gudang — bukan kekurangan." atau null. */
export function kalimatBelumDikirimGudang(info: Pick<InfoAntaran, "belumDikirimGudang" | "orderNo"> | null): string | null {
  if (!info || !(info.belumDikirimGudang > 0)) return null;
  return `Sisa pesanan ${info.orderNo} sebanyak ${info.belumDikirimGudang} pcs belum dikirim gudang — itu bukan kekurangan, cek ke gudang.`;
}
