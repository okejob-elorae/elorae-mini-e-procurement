-- Huruf pilihan tiap pengguna.
--
-- Disimpan sebagai ID dari daftar di `lib/theme/fonts.ts`, BUKAN nama huruf
-- atau CSS-nya. Nama bisa berubah ejaannya dan CSS bisa berubah bentuknya;
-- id-nya tidak. Yang idnya tidak dikenal lagi jatuh ke bawaan saat dibaca.
--
-- Nullable: belum pernah memilih berbeda artinya dari memilih bawaan, dan
-- bedanya akan terasa kalau bawaannya suatu hari diganti.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themeFontId" TEXT;
