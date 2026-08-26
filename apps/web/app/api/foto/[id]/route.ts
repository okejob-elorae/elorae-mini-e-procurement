import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Sajikan satu foto.
 *
 * Wajib masuk dulu. Foto di sini adalah nota retur dan bukti transfer — dokumen
 * keuangan milik toko dan sales, bukan gambar publik.
 *
 * Ditandai `private` di Cache-Control supaya tidak nyangkut di cache bersama;
 * `immutable` aman karena isinya tidak pernah berubah setelah diunggah.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'TANPA_AKSES' }, { status: 401 });
  }

  const { id } = await params;
  const foto = await prisma.foto.findUnique({
    where: { id },
    select: { mime: true, bytes: true },
  });
  if (!foto) return NextResponse.json({ error: 'TIDAK_DITEMUKAN' }, { status: 404 });

  return new NextResponse(Buffer.from(foto.bytes), {
    headers: {
      'Content-Type': foto.mime,
      'Content-Length': String(foto.bytes.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
