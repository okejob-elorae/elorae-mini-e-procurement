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
  /** Klaim dibuang di server karena penonton ini akan menghitung notanya. */
  klaimTersembunyi?: boolean;
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

/** Buang angka klaim (dan potongannya, yang sama-sama membocorkan klaim) dari baris yang buta. */
export function butakan(baris: BarisKerjaRetur[], p: { bolehMenghitung: boolean; penggunaId: string }): BarisReturTampil[] {
  return baris.map((b) =>
    klaimDisembunyikan(b, p)
      ? { ...b, nilaiKlaim: null, nilaiDipotong: 0, jumlahPotongan: 0, klaimTersembunyi: true }
      : { ...b, klaimTersembunyi: false },
  );
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
