import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMemutuskanBeban, bolehMemverifikasi, bolehMengelola } from "@/lib/receivables/izin";
import { urlFromKey } from "@/lib/r2";
import { pilihanOrangHilang, rincianHilangKantor } from "@/lib/spg/hilang-queries";
import type { BuktiKlaimEkspedisi } from "./KlaimEkspedisiPanel";
import { RincianHilangClient } from "./RincianHilangClient";

export const dynamic = "force-dynamic";

export default async function RincianBarangHilangPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  // Izin tiap tombol = izin aksinya (app/actions/barang-hilang.ts): menandai toko ditagih,
  // membatalkan yang masih TERBUKA, dan mencatat jawaban ekspedisi atas klaimnya =
  // receivables:manage; memutuskan, mengubah, membatalkan keputusan, dan mengubah nilai klaim
  // ekspedisi = receivables:decide_bearer; memeriksa pembayaran klaim ke mutasi rekening =
  // payments:verify (keputusan 11, 29 Okt). Halaman ini tetap hanya untuk ketiga izin pertama di
  // bawah — Keuangan "hanya halaman Komisi SPG" (P28). Jadi sampai pemilik menjawab di mana
  // Keuangan memeriksa uang klaim ekspedisi, pemeriksanya hanya admin (izin `*`), atau peran yang
  // diberi salah satu izin halaman ini sekaligus payments:verify — jangan longgarkan penjaga ini
  // tanpa jawaban itu.
  const bolehKelola = bolehMengelola(izin);
  const bolehPutus = bolehMemutuskanBeban(izin);
  const bolehPeriksa = bolehMemverifikasi(izin);
  if (!bolehKelola && !bolehPutus && !hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const [rincian, orang] = await Promise.all([
    rincianHilangKantor(id),
    // Pilihan orang hanya dipakai dialog keputusan.
    bolehPutus ? pilihanOrangHilang() : Promise.resolve({ spg: [], sales: [] }),
  ]);
  if (!rincian) notFound();

  // Bukti klaim ekspedisi: kunci foto dari kueri, URL-nya dibuat di sini (server).
  const bagianEkspedisi = rincian.bagian.find((b) => b.bearer === "EKSPEDISI") ?? null;
  const klaim: BuktiKlaimEkspedisi | null = rincian.buktiKlaim
    ? {
        ...rincian.buktiKlaim,
        fotoSerahUrl: rincian.buktiKlaim.fotoSerahKey ? urlFromKey(rincian.buktiKlaim.fotoSerahKey) : null,
        fotoTerimaUrl: rincian.buktiKlaim.fotoTerimaKey ? urlFromKey(rincian.buktiKlaim.fotoTerimaKey) : null,
        bagian: bagianEkspedisi
          ? { id: bagianEkspedisi.id, nilai: bagianEkspedisi.nilai, lunas: bagianEkspedisi.lunas, klaim: bagianEkspedisi.klaim }
          : null,
        statusCatatan: rincian.status,
      }
    : null;

  return (
    <RincianHilangClient
      rincian={rincian}
      bolehKelola={bolehKelola}
      bolehPutus={bolehPutus}
      bolehPeriksa={bolehPeriksa}
      orang={orang}
      klaim={klaim}
      userId={session.user.id}
    />
  );
}
