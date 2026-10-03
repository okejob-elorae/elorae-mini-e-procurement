import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { notaSpg, tokoSpg } from "@/lib/spg/queries";
import { NotaSpgClient, type HariNota, type TeksDwibahasa } from "./NotaSpgClient";

export const dynamic = "force-dynamic";

const BATAS = 100;
const HARI_MS = 86_400_000;

/**
 * Tanggal dan jam diformat DI SINI, untuk kedua bahasa sekaligus. Bahasa
 * layar dipilih di HP (localStorage), jadi server tidak tahu; memformat di
 * klien berisiko beda antara Node dan Safari (pernah terjadi dengan rupiah).
 */
function jamWib(d: Date): TeksDwibahasa {
  const fmt = (loc: string) => new Intl.DateTimeFormat(loc, { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(d);
  return { id: fmt("id-ID"), en: fmt("en-GB") };
}

export default async function SpgNotaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/nota");
  const userId = session.user.id;

  const toko = await tokoSpg(userId);
  if (!toko) redirect("/pwa");

  const sekarang = new Date();
  const kunciHariIni = kunciHariWib(sekarang);
  const kunciKemarin = kunciHariWib(new Date(sekarang.getTime() - HARI_MS));

  const [daftar, hariIni] = await Promise.all([
    notaSpg(userId, { batas: BATAS }),
    // Ringkasan hari ini dihitung sendiri, bukan dari 100 nota di bawah: SPG
    // yang sangat laris bisa punya lebih dari 100 nota sehari.
    prisma.spgSale.aggregate({
      where: { salesmanId: userId, createdAt: { gte: new Date(`${kunciHariIni}T00:00:00+07:00`) } },
      _count: { _all: true },
      _sum: { total: true },
    }),
  ]);

  const hari: HariNota[] = [];
  for (const n of daftar) {
    const waktu = new Date(n.waktu);
    const kunci = kunciHariWib(waktu);
    let h = hari[hari.length - 1];
    if (!h || h.kunci !== kunci) {
      const awal = new Date(`${kunci}T00:00:00+07:00`);
      h = {
        kunci,
        jenis: kunci === kunciHariIni ? "hariIni" : kunci === kunciKemarin ? "kemarin" : "tanggal",
        tanggal: { id: formatDisplayDate(awal, "id"), en: formatDisplayDate(awal, "en") },
        jumlah: 0,
        total: 0,
        nota: [],
      };
      hari.push(h);
    }
    h.jumlah += 1;
    h.total += n.total;
    h.nota.push({ id: n.id, docNo: n.docNo, jam: jamWib(waktu), jumlahBarang: n.jumlahBarang, total: n.total });
  }

  return (
    <NotaSpgClient
      hariIni={{ jumlah: hariIni._count._all, total: Number(hariIni._sum.total ?? 0) }}
      hari={hari}
      terpotong={daftar.length >= BATAS ? BATAS : null}
    />
  );
}
