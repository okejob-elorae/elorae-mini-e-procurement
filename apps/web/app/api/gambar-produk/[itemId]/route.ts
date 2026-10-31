import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryImagesBatch } from "@/lib/items/images/queries";

export const dynamic = "force-dynamic";

/** Gambar produk lebih besar dari ini tidak diteruskan — kartu katalog tidak butuh berkas mentah kamera. */
const BATAS_BYTE = 15 * 1024 * 1024;
const BATAS_WAKTU_MS = 10_000;

/**
 * Gambar utama satu barang, disajikan dari asal yang SAMA dengan aplikasi.
 *
 * Kenapa ada: "Kirim katalog" menggambar foto produk ke kanvas lalu
 * mengekspornya jadi berkas. Foto produk tinggal di R2 / CDN Jubelio — asal
 * lain — dan kanvas yang pernah digambari gambar lintas asal menjadi "tercemar":
 * `toBlob` ditolak peramban. Lewat rute ini gambarnya sampai dari asal sendiri.
 *
 * Wajib masuk. Alamat gambarnya diambil dari basis data berdasarkan id barang,
 * TIDAK PERNAH dari masukan pengguna, jadi rute ini tidak bisa dipakai untuk
 * mengambil alamat sembarang. Tidak mencatat apa pun.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "TANPA_AKSES" }, { status: 401 });

  const { itemId } = await params;
  // Aturan pilih gambar yang sama dengan katalog HP: gambar tingkat produk,
  // kalau tidak ada gambar varian mana pun.
  const gambar = await getPrimaryImagesBatch([{ itemId, variantSku: null }]);
  const alamat = gambar.get(`${itemId}|`);
  if (!alamat) return NextResponse.json({ error: "TIDAK_ADA_GAMBAR" }, { status: 404 });

  let sumber: URL;
  try {
    // Alamat relatif (R2 tanpa domain publik) diselesaikan terhadap aplikasi ini.
    sumber = new URL(alamat, req.nextUrl.origin);
  } catch {
    return NextResponse.json({ error: "ALAMAT_RUSAK" }, { status: 404 });
  }
  if (sumber.protocol !== "https:" && sumber.protocol !== "http:") {
    return NextResponse.json({ error: "ALAMAT_RUSAK" }, { status: 404 });
  }

  let hulu: Response;
  try {
    hulu = await fetch(sumber, { cache: "no-store", signal: AbortSignal.timeout(BATAS_WAKTU_MS) });
  } catch {
    return NextResponse.json({ error: "GAGAL_MENGAMBIL" }, { status: 502 });
  }
  const jenis = hulu.headers.get("content-type") ?? "";
  if (!hulu.ok || !hulu.body) {
    return NextResponse.json({ error: "GAGAL_MENGAMBIL" }, { status: hulu.status === 404 ? 404 : 502 });
  }
  // SVG ditolak: ia bisa membawa skrip, dan di sini ia disajikan dari asal aplikasi.
  if (!jenis.startsWith("image/") || jenis.includes("svg")) {
    return NextResponse.json({ error: "BUKAN_GAMBAR" }, { status: 502 });
  }
  const panjang = Number(hulu.headers.get("content-length") ?? 0);
  if (panjang > BATAS_BYTE) return NextResponse.json({ error: "TERLALU_BESAR" }, { status: 413 });

  // Dialirkan, bukan ditampung: hitung byte sambil lewat dan putus kalau hulu
  // ternyata mengirim lebih dari batas (Content-Length bisa tidak ada).
  let terkirim = 0;
  const penjaga = new TransformStream<Uint8Array, Uint8Array>({
    transform(potongan, kendali) {
      terkirim += potongan.byteLength;
      if (terkirim > BATAS_BYTE) {
        kendali.error(new Error("TERLALU_BESAR"));
        return;
      }
      kendali.enqueue(potongan);
    },
  });

  const kepala: Record<string, string> = {
    "Content-Type": jenis,
    // Pribadi: rute ini di balik masuk. Foto produk jarang berubah; sejam cukup
    // supaya membuat ulang kartu tidak mengunduh ulang semuanya.
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (panjang > 0) kepala["Content-Length"] = String(panjang);
  return new NextResponse(hulu.body.pipeThrough(penjaga), { headers: kepala });
}
