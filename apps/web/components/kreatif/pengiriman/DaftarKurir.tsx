import { DAFTAR_KURIR } from "@/lib/creative/sampel-aturan";

/** Id `<datalist>` kurir; isian kurir memakai `list={ID_DAFTAR_KURIR}`. */
export const ID_DAFTAR_KURIR = "kreatif-daftar-kurir";

/**
 * Daftar kurir yang ditawarkan (bukan dibatasi — kurir lain tetap boleh
 * diketik). Pasang SATU kali per halaman.
 */
export function DaftarKurir() {
  return (
    <datalist id={ID_DAFTAR_KURIR}>
      {DAFTAR_KURIR.map((k) => (
        <option key={k} value={k} />
      ))}
    </datalist>
  );
}
