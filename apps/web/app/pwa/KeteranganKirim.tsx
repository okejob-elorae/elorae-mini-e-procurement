/**
 * Kenapa tombol kirim masih mati, ditulis tepat di bawah tombolnya.
 *
 * Tombol pucat tanpa keterangan membuat orang menebak isian mana yang kurang
 * dan mengetuknya berulang kali. Formulir menyebut kekurangan PERTAMA menurut
 * urutan isiannya, supaya kalimatnya menunjuk ke tempat yang harus diisi.
 * `null` berarti tidak ada yang perlu dikatakan.
 */
export function KeteranganKirim({ teks }: { teks: string | null }) {
  if (!teks) return null;
  return (
    <p className="text-center text-sm text-muted-foreground" aria-live="polite">
      {teks}
    </p>
  );
}
