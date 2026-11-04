import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { sidikFoto } from '@/lib/foto/sidik';

export const dynamic = 'force-dynamic';

const MAKS_BYTE = 6 * 1024 * 1024;
const JENIS_DIIZINKAN = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Unggah satu foto.
 *
 * Isinya disimpan di database, bukan di penyimpanan objek: brief modul ini
 * merancangnya begitu, dan syarat penutupnya adalah tidak ada foto yang keluar
 * dari mesin tempat programnya berjalan. Satu sistem, bukan dua.
 *
 * Yang dikembalikan adalah URL, bukan id mentah — kolom penyimpannya
 * (`photoUrl`, `transferPhotoUrl`, …) sudah bertipe URL, jadi pemanggilnya
 * tidak perlu tahu foto ini disimpan di mana.
 *
 * Sidik isinya (`sha256`) ikut disimpan: unggahan ulang berkas yang sama persis
 * menjadi baris baru milik pengunggahnya, tetapi isinya tetap bisa dikenali
 * sebagai kembaran foto orang lain (`lib/foto/kembar.ts`).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'TANPA_AKSES' }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'FILE_WAJIB' }, { status: 400 });
  }
  if (!JENIS_DIIZINKAN.has(file.type)) {
    return NextResponse.json({ error: 'JENIS_TIDAK_DIIZINKAN', jenis: file.type }, { status: 400 });
  }
  // Diperiksa SEBELUM dibaca ke memori. Membaca dulu lalu menolak berarti
  // berkas sebesar apa pun sempat masuk memori proses.
  if (file.size > MAKS_BYTE) {
    return NextResponse.json({ error: 'TERLALU_BESAR', maks: MAKS_BYTE }, { status: 400 });
  }

  const caption = ((form.get('caption') as string | null) ?? '').trim() || null;
  const bytes = Buffer.from(await file.arrayBuffer());

  const foto = await prisma.foto.create({
    data: {
      mime: file.type,
      bytes,
      sizeBytes: bytes.byteLength,
      caption,
      uploadedById: session.user.id,
      sha256: sidikFoto(bytes),
    },
    select: { id: true },
  });

  return NextResponse.json({ id: foto.id, url: `/api/foto/${foto.id}` });
}
