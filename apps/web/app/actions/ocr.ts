'use server';

import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { bolehMelapor } from '@/lib/receivables/izin';
import { bacaGambar } from '@/lib/ocr/mesin';
import { bacaNota, type HasilBacaNota } from '@/lib/ocr/nota';

/**
 * Membaca foto nota yang SUDAH tersimpan.
 *
 * Menerima id foto, bukan gambarnya. Fotonya memang sudah diunggah sebelum
 * langkah ini — begitulah bentuk formulirnya: sales memotret dulu, melihat
 * hasilnya, baru mengisi. Mengirim ulang gambarnya berarti memindahkan berkas
 * yang sama dua kali lewat jaringan HP.
 *
 * TIDAK MENULIS APA PUN. Hasilnya usulan yang harus ditinjau; yang menyimpan
 * tetap formulir returnya sendiri.
 */

export type HasilAksiBacaNota =
  | { ok: true; hasil: HasilBacaNota; keyakinan: number; msBaca: number }
  | { ok: false; kode: 'TANPA_AKSES' | 'FOTO_TIDAK_ADA' | 'GAGAL' };

export async function bacaNotaAction(fotoId: string): Promise<HasilAksiBacaNota> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: 'TANPA_AKSES' };
  /*
   * Izin yang sama dengan melaporkan retur. Membaca foto TIDAK boleh lebih
   * longgar daripada melihatnya: kalau lebih longgar, siapa pun yang menebak
   * sebuah id foto bisa memanen isi nota orang lain tanpa pernah membuka
   * gambarnya.
   */
  if (!bolehMelapor(session.user.permissions)) return { ok: false, kode: 'TANPA_AKSES' };

  const id = fotoId.replace(/^\/api\/foto\//, '').trim();
  if (!id) return { ok: false, kode: 'FOTO_TIDAK_ADA' };

  try {
    const foto = await prisma.foto.findUnique({ where: { id }, select: { bytes: true } });
    if (!foto) return { ok: false, kode: 'FOTO_TIDAK_ADA' };

    const { baris, keyakinan, msBaca } = await bacaGambar(Buffer.from(foto.bytes));
    return { ok: true, hasil: bacaNota(baris), keyakinan, msBaca };
  } catch (err) {
    // Galat mesin OCR TIDAK boleh menjatuhkan formulirnya. Gagal membaca foto
    // berarti orangnya mengetik sendiri seperti sebelum fitur ini ada — bukan
    // kehilangan isian yang sudah dia isi.
    console.error('bacaNota gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}
