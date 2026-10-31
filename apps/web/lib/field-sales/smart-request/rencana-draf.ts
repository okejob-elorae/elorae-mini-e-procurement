import { labelVarian } from "@/lib/konsinyasi/stok-di-toko";
import type { AlasanRencana, HasilRencana, KurangUkuran, SebabDilewati } from "./rencana";

/**
 * Bentuk draf rencana kirim yang dikirim ke HP.
 *
 * Dua bentuk, bukan satu dengan harga yang dikosongkan: draf toko KONSI tidak
 * punya kunci harga SAMA SEKALI — tidak ada `hargaSatuan`, tidak ada total,
 * tidak ada sebab "anggaran" atau "harga". Dibuktikan dengan tes atas JSON
 * terserialisasinya.
 */

type InfoBarang = { sku: string; nama: string; kategoriId: string; variantsMentah: unknown; harga: number | null };

export type BarisDrafKonsi = {
  variantSku: string;
  /** Label varian untuk layar ("Hitam · M"); null untuk barang tanpa varian. */
  label: string | null;
  /** Nama baris pesanan, sama bentuknya dengan keranjang katalog. */
  namaProduk: string;
  qty: number;
  /** Stok gudang yang boleh dipesan — batas atas tombol tambah. */
  tersedia: number;
};
export type BarisDrafPutus = BarisDrafKonsi & { hargaSatuan: number };

export type ArtikelDraf<B> = {
  itemId: string;
  sku: string;
  nama: string;
  kategori: string | null;
  alasan: AlasanRencana[];
  kurang: KurangUkuran[];
  baris: B[];
};

export type DilewatiDraf = { itemId: string; sku: string; nama: string; sebab: SebabDilewati };

export type DrafRencanaKonsi = { konsi: true; artikel: ArtikelDraf<BarisDrafKonsi>[]; dilewati: DilewatiDraf[]; lebih: number };
export type DrafRencanaPutus = { konsi: false; artikel: ArtikelDraf<BarisDrafPutus>[]; dilewati: DilewatiDraf[]; lebih: number };
export type DrafRencana = DrafRencanaKonsi | DrafRencanaPutus;

export function susunDraf(input: {
  hasil: HasilRencana;
  info: ReadonlyMap<string, InfoBarang>;
  namaKategori: ReadonlyMap<string, string>;
  konsi: boolean;
}): DrafRencana {
  const { hasil, info, namaKategori } = input;
  const ambil = (itemId: string) => info.get(itemId) ?? { sku: "—", nama: "—", kategoriId: "", variantsMentah: null, harga: null };

  const dilewati: DilewatiDraf[] = hasil.dilewati.map((d) => {
    const i = ambil(d.itemId);
    return { itemId: d.itemId, sku: i.sku, nama: i.nama, sebab: d.sebab };
  });

  const artikelKonsi: ArtikelDraf<BarisDrafKonsi>[] = hasil.artikel.map((a) => {
    const i = ambil(a.itemId);
    return {
      itemId: a.itemId,
      sku: i.sku,
      nama: i.nama,
      kategori: namaKategori.get(i.kategoriId) ?? null,
      alasan: a.alasan,
      kurang: a.kurang,
      baris: a.baris.map((b) => {
        const label = b.variantSku ? labelVarian(i.variantsMentah, b.variantSku) ?? (b.ukuran || null) : null;
        return {
          variantSku: b.variantSku,
          label,
          namaProduk: label ? `${i.nama} — ${label}` : i.nama,
          qty: b.qty,
          tersedia: b.tersedia,
        };
      }),
    };
  });

  if (input.konsi) return { konsi: true, artikel: artikelKonsi, dilewati, lebih: hasil.lebih };

  return {
    konsi: false,
    artikel: artikelKonsi.map((a) => {
      const harga = ambil(a.itemId).harga ?? 0;
      return { ...a, baris: a.baris.map((b) => ({ ...b, hargaSatuan: harga })) };
    }),
    dilewati,
    lebih: hasil.lebih,
  };
}
