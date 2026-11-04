import { cache } from "react";
import { prisma } from "@elorae/db";

/**
 * Toko tetap milik SPG, atau null untuk salesman keliling.
 *
 * SPG dikenali dari `User.assignedStoreId`, bukan dari izinnya — sesi/JWT tidak
 * membawa kolom itu (lihat callback di `lib/auth.ts`). Di-cache per permintaan:
 * layout `/pwa` dan halaman berandanya sama-sama menanyakannya.
 */
export const ambilTokoTetap = cache(async (userId: string): Promise<string | null> => {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { assignedStoreId: true } });
  return me?.assignedStoreId ?? null;
});

/**
 * SPG yang sudah ditandai BERHENTI (pemilik P66, Pengaturan → Pengguna): hari terakhirnya
 * (`spgEndedOn`, YYYY-MM-DD WIB) dan toko yang dilepasnya (`spgEndedStoreId`), atau null.
 *
 * Penanda berhenti mengosongkan `assignedStoreId`, jadi `ambilTokoTetap` membacanya null —
 * tanpa pembaca ini SPG yang berhenti terbaca sebagai salesman keliling dan mendapat aplikasi
 * salesman. HP-nya menampilkan layar berhenti saja; antreannya tetap dikirim.
 */
export const spgBerhentiPada = cache(async (userId: string): Promise<{ hariTerakhir: string; storeId: string } | null> => {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { assignedStoreId: true, spgEndedOn: true, spgEndedStoreId: true },
  });
  if (!me || me.assignedStoreId || !me.spgEndedOn || !me.spgEndedStoreId) return null;
  return { hariTerakhir: me.spgEndedOn, storeId: me.spgEndedStoreId };
});

/** Akhir hari WIB (23:59:59.999) dari kunci hari `YYYY-MM-DD`. */
function akhirHariWib(hari: string): Date {
  return new Date(`${hari}T23:59:59.999+07:00`);
}

/**
 * Toko SPG untuk pekerjaan dari ANTREAN HP (penjualan, check-in/out tanpa sinyal), menurut saat
 * pekerjaan itu DITANGKAP di HP: toko tetapnya; atau, untuk SPG yang sudah berhenti, toko yang
 * dilepasnya — selama pekerjaan itu ditangkap paling lambat di akhir hari terakhirnya (WIB).
 * Pekerjaan yang ditangkap sebelum ia berhenti tidak boleh hilang hanya karena sinyalnya datang
 * sesudah kantor menandainya berhenti; yang ditangkap sesudah hari terakhirnya ditolak (null).
 *
 * Aturan "sampai hari terakhir" ini belum punya jawaban pemilik (P66 menjawab penandanya, bukan
 * antreannya) — pertanyaan pemilik: apakah pekerjaan antrean sampai hari terakhir tetap dicatat.
 * Penulis nota SPG membaca ulang aturan yang sama di transaksinya (`SPG_BERHENTI`,
 * `recordSpgSaleTx`), jadi mengubahnya berarti mengubah keduanya.
 */
export const tokoSpgUntukAntrean = cache(async (userId: string, waktuTangkap: Date): Promise<string | null> => {
  const tetap = await ambilTokoTetap(userId);
  if (tetap) return tetap;
  const berhenti = await spgBerhentiPada(userId);
  if (!berhenti) return null;
  return waktuTangkap.getTime() <= akhirHariWib(berhenti.hariTerakhir).getTime() ? berhenti.storeId : null;
});
