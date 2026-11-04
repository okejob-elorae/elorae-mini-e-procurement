import type { BarisKerjaRetur } from "@/lib/receivables/return-queries";
import type { LangkahRetur } from "@/lib/receivables/rules";
import { cocokCari } from "../piutang/_daftar/halaman";

/**
 * Hitungan gudang BUTA di layar kantor.
 *
 * Gudang menghitung barang yang benar-benar sampai tanpa melihat klaim toko —
 * kalau angka klaimnya terlihat, hitungan cenderung "menyesuaikan" dan selisih
 * yang seharusnya ditanggung seseorang lenyap. /gudang-retur sudah membuang
 * klaim di server; daftar kantor dulu menampilkannya di baris yang sama dengan
 * tombol "Cek fisik barang".
 *
 * Aturan: selama nota belum dihitung (`cek`), klaimnya tidak dikirim ke
 * peramban orang yang BOLEH menghitung nota itu. Pelapornya dikecualikan — ia
 * yang mengetik klaimnya, dan penulisnya menolak ia menghitung notanya sendiri
 * (`PENGHITUNG_SAMA_PELAPOR`).
 */

export type BarisReturTampil = BarisKerjaRetur & {
  /** Klaim dibuang di server karena penonton ini akan menghitung notanya (atau susulannya). */
  klaimTersembunyi?: boolean;
};

/**
 * Siapa yang boleh menghitung — dan siapa yang tidak pernah menghitung susulan
 * nota mana. `tanganSusulan` hanya memuat nota yang selisihnya masih bisa
 * menerima barang susulan; nilainya orang-orang yang dikecualikan aturan dua
 * tangan (pelapor nota, pelapor cek, sales yang dibebani, pemegang toko).
 */
export type LingkupButa = {
  bolehMenghitung: boolean;
  penggunaId: string;
  /** Yang memutuskan penanggung harus melihat selisihnya; ia tidak dibutakan. */
  bolehMemutuskan?: boolean;
  tanganSusulan?: ReadonlyMap<string, readonly string[]>;
};

/** Penonton adalah pelapor nota ini — aturan yang sama dengan penulis hitungan gudang. */
export function pelaporNota(b: Pick<BarisKerjaRetur, "jenis" | "salesmanId">, penggunaId: string): boolean {
  return b.jenis === "NRT" && b.salesmanId !== null && penggunaId !== "" && b.salesmanId === penggunaId;
}

export function klaimDisembunyikan(
  b: Pick<BarisKerjaRetur, "jenis" | "langkah" | "salesmanId">,
  p: { bolehMenghitung: boolean; penggunaId: string },
): boolean {
  return p.bolehMenghitung && b.jenis === "NRT" && b.langkah === "cek" && !pelaporNota(b, p.penggunaId);
}

/**
 * Hitungan BARANG SUSULAN juga buta (keputusan 2, 2026-10-29). Selama selisih
 * sebuah nota masih bisa menerima susulan, orang yang boleh menghitungnya tidak
 * menerima klaim, selisih, barang yang kurang per baris, atau catatan cek sales
 * — kalau melihatnya, ia tahu persis apa yang harus "ditemukan". Yang dikecualikan
 * aturan dua tangan tidak pernah menghitung susulannya, jadi tidak dibutakan;
 * begitu pula yang memutuskan penanggung, karena ia harus melihat selisihnya.
 */
export function selisihDisembunyikan(
  b: Pick<BarisKerjaRetur, "id" | "jenis" | "langkah">,
  p: LingkupButa,
): boolean {
  if (!p.bolehMenghitung || p.bolehMemutuskan || b.jenis !== "NRT") return false;
  if (b.langkah === "cek" || b.langkah === "batal") return false;
  const tangan = p.tanganSusulan?.get(b.id);
  if (!tangan) return false;
  return p.penggunaId === "" || !tangan.includes(p.penggunaId);
}

/** Buang angka klaim (dan potongannya, yang sama-sama membocorkan klaim) dari baris yang buta. */
export function butakan(baris: BarisKerjaRetur[], p: LingkupButa): BarisReturTampil[] {
  return baris.map((b) => {
    if (klaimDisembunyikan(b, p)) {
      return { ...b, nilaiKlaim: null, nilaiDipotong: 0, jumlahPotongan: 0, klaimTersembunyi: true };
    }
    if (selisihDisembunyikan(b, p)) {
      return { ...b, nilaiKlaim: null, selisih: 0, nilaiDipotong: 0, jumlahPotongan: 0, klaimTersembunyi: true };
    }
    return { ...b, klaimTersembunyi: false };
  });
}

/**
 * Calon pasangan dialog "Jodohkan" — nota toko yang belum punya hitungan
 * gudang, jadi SEMUANYA nota yang belum dihitung. Dulu daftar ini terkirim
 * utuh dengan klaimnya ke setiap pembaca halaman, termasuk gudang yang tidak
 * pernah melihat dialognya: klaim yang dibuang dari tabel tetap ada di payload.
 *
 * - Hanya yang boleh menjodohkan (`receivables:manage`) yang menerimanya.
 * - Klaim nota yang buta bagi penonton ini dibuang; nota yang tidak ditemukan
 *   di daftar kerja dianggap buta bagi penghitung (aman bila ragu).
 */
export function calonUntukPenonton<C extends { id: string; nilaiKlaim: number }>(
  calon: C[],
  semua: Pick<BarisKerjaRetur, "id" | "jenis" | "langkah" | "salesmanId">[],
  p: { bolehMengelola: boolean; bolehMenghitung: boolean; penggunaId: string },
): (Omit<C, "nilaiKlaim"> & { nilaiKlaim: number | null })[] {
  if (!p.bolehMengelola) return [];
  const baris = new Map(semua.map((b) => [b.id, b]));
  return calon.map((c) => {
    const b = baris.get(c.id);
    const buta = b ? klaimDisembunyikan(b, p) : p.bolehMenghitung;
    return buta ? { ...c, nilaiKlaim: null } : c;
  });
}

export type SaringRetur = "kerja" | "koreksi" | "semua" | LangkahRetur;

const LANGKAH: readonly string[] = ["keputusan", "cek", "jodoh", "beres", "batal", "semua"];

/** `?koreksi=1` (tautan Beranda) atau `?langkah=`; bawaannya daftar kerja. */
export function bacaSaringRetur(sp: { langkah?: string; koreksi?: string }): SaringRetur {
  if (sp.koreksi === "1") return "koreksi";
  return sp.langkah && LANGKAH.includes(sp.langkah) ? (sp.langkah as SaringRetur) : "kerja";
}

export function saringKerjaRetur<T extends BarisKerjaRetur>(
  baris: T[],
  s: { saring: SaringRetur; cari: string; koreksi: ReadonlySet<string> },
): T[] {
  return baris.filter((b) => {
    const lolos =
      s.saring === "semua"
        ? true
        : s.saring === "kerja"
          ? b.langkah !== "beres" && b.langkah !== "batal"
          : s.saring === "koreksi"
            ? b.jenis === "NRT" && s.koreksi.has(b.id)
            : b.langkah === s.saring;
    return lolos && cocokCari(s.cari, b.nomor, b.nomorPasangan, b.storeName, b.salesmanName);
  });
}
